/**
 * Makes Tauri's callback-based `Channel<T>` consumable as an `AsyncIterable`
 * (issue #22):
 *
 * ```ts
 * for await (const ev of invokeChannel<DownloadEvent>((channel) =>
 *   api.download({ url }, channel),
 * )) {
 *   // ev: DownloadEvent
 * }
 * ```
 *
 * `Channel<T>` itself has no notion of "the stream is over" — Rust can stop
 * calling `onmessage`, but nothing tells the TS side that happened. This
 * module resolves that with the convention documented on `invokeChannel`
 * below: the *command's own promise* settling is what ends the stream, not a
 * message payload. `createChannel` is the lower-level primitive for callers
 * who want to signal completion themselves (e.g. via a Rust-side "Finished"
 * variant, `isFinished` below) instead of tying it to a command promise.
 *
 * Callback-style consumption remains fully available: both helpers hand back
 * the real `Channel<T>` to pass to `invoke`, so `channel.onmessage = ...` (or
 * constructing a plain `new Channel()` yourself, bypassing this module
 * entirely) still works. `for await` is additive, never required.
 *
 * ## Backpressure
 *
 * Messages arrive from Rust faster than the consumer may `for await` them.
 * Buffering unboundedly would leak memory for a slow or stalled consumer
 * (the concern the issue calls out), so the buffer is capped at
 * `highWaterMark` (default 1024). What happens past the cap is
 * `overflow`-controlled:
 *
 *  - `'error'` (default) — the iterator throws, ending the stream. Loud by
 *    default: a silently-dropped message is usually worse than a visible
 *    failure telling the caller to consume faster or raise the cap.
 *  - `'drop-oldest'` — the oldest buffered message is discarded to make room.
 *  - `'drop-newest'` — the incoming message is discarded.
 */
import type { Channel } from '@tauri-apps/api/core'
import { AbortError } from './internal/errors.js'
import { createRawChannel } from './internal/tauri.js'

export type ChannelOverflowPolicy = 'error' | 'drop-oldest' | 'drop-newest'

export interface ChannelStreamOptions<T> {
  /** Ends the stream (as an error) when this signal fires. An
   * already-aborted signal ends the stream before anything is buffered. */
  signal?: AbortSignal
  /** Maximum number of buffered, not-yet-consumed messages. Default 1024. */
  highWaterMark?: number
  /** What to do when a message arrives with the buffer already at
   * `highWaterMark`. Default `'error'`. */
  overflow?: ChannelOverflowPolicy
  /** Recognizes a Rust-side completion marker (e.g. a tagged enum's
   * `Finished` variant — pair with `tagged.ts`) and ends the stream as soon
   * as it's seen, without waiting for the command's own promise to settle.
   * Optional: the command-promise convention alone is sufficient for
   * `invokeChannel`. */
  isFinished?: (message: T) => boolean
}

class ChannelQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private readonly buffer: T[] = []
  private pending:
    | { resolve: (r: IteratorResult<T>) => void; reject: (e: unknown) => void }
    | undefined
  private done = false
  private errored = false
  private error: unknown

  constructor(
    private readonly highWaterMark: number,
    private readonly overflow: ChannelOverflowPolicy,
  ) {}

  push(message: T): void {
    if (this.done) return
    if (this.pending) {
      const { resolve } = this.pending
      this.pending = undefined
      resolve({ value: message, done: false })
      return
    }
    if (this.buffer.length >= this.highWaterMark) {
      if (this.overflow === 'drop-newest') return
      if (this.overflow === 'drop-oldest') {
        this.buffer.shift()
      } else {
        this.fail(
          new Error(
            `tauri-invoke-binding: channel buffer exceeded highWaterMark (${this.highWaterMark}); consume the stream faster, raise highWaterMark, or use overflow: 'drop-oldest' / 'drop-newest'.`,
          ),
        )
        return
      }
    }
    this.buffer.push(message)
  }

  finish(): void {
    if (this.done) return
    this.done = true
    if (this.pending) {
      const { resolve } = this.pending
      this.pending = undefined
      resolve({ value: undefined, done: true })
    }
  }

  fail(reason: unknown): void {
    if (this.done) return
    this.done = true
    this.errored = true
    this.error = reason
    if (this.pending) {
      const { reject } = this.pending
      this.pending = undefined
      reject(reason)
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.buffer.length > 0) {
      const value = this.buffer.shift() as T
      return { value, done: false }
    }
    if (this.done) {
      if (this.errored) throw this.error
      return { value: undefined, done: true }
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.pending = { resolve, reject }
    })
  }

  // biome-ignore lint/suspicious/noExplicitAny: matches the standard AsyncIterator#return signature
  async return(value?: any): Promise<IteratorResult<T>> {
    this.finish()
    return { value, done: true }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this
  }
}

function attachAbort(queue: ChannelQueue<unknown>, signal: AbortSignal | undefined): void {
  if (!signal) return
  if (signal.aborted) {
    queue.fail(new AbortError('channel'))
    return
  }
  signal.addEventListener('abort', () => queue.fail(new AbortError('channel')), { once: true })
}

/**
 * The low-level primitive: a fresh `Channel<T>` paired with an
 * `AsyncIterable<T>` fed by its messages. Completion is driven only by
 * `options.isFinished` (or `signal`/manual `channel.onmessage` replacement) —
 * there is no command promise here to tie completion to. Prefer
 * `invokeChannel` when a single command call owns the channel's whole
 * lifetime, which is the common case.
 */
export function createChannel<T>(options: ChannelStreamOptions<T> = {}): {
  channel: Channel<T>
  stream: AsyncIterable<T>
} {
  const { signal, highWaterMark = 1024, overflow = 'error', isFinished } = options
  const queue = new ChannelQueue<T>(highWaterMark, overflow)
  attachAbort(queue as ChannelQueue<unknown>, signal)

  const channel = createRawChannel<T>((message) => {
    queue.push(message)
    if (isFinished?.(message)) queue.finish()
  })

  return { channel, stream: queue }
}

/**
 * Ties a `Channel<T>`'s lifetime to the command call that owns it (issue
 * #22's primary completion/error convention): pass a callback that invokes
 * your command with the given channel, and the returned stream ends
 * normally when that call's promise resolves, or throws when it rejects.
 * `options.isFinished` can still end the stream earlier, e.g. on a Rust-side
 * `Finished` tagged-enum variant.
 *
 * ```ts
 * for await (const ev of invokeChannel<DownloadEvent>((channel) =>
 *   api.download({ url }, channel),
 * )) {
 *   // ev: DownloadEvent
 * }
 * ```
 */
export function invokeChannel<T>(
  call: (channel: Channel<T>) => Promise<unknown>,
  options: ChannelStreamOptions<T> = {},
): AsyncIterable<T> {
  const { channel, stream } = createChannel<T>(options)
  const queue = stream as unknown as ChannelQueue<T>

  call(channel).then(
    () => queue.finish(),
    (reason: unknown) => queue.fail(reason),
  )

  return stream
}
