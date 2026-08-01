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
   * already-aborted signal ends the stream before anything is buffered.
   *
   * An abort discards whatever is still buffered rather than draining it
   * first: the caller asked to stop *now*, and this matches `raceAbort` in
   * internal/abort.ts, where a signal firing means the in-flight result is
   * discarded rather than delivered. Every other terminal condition (a
   * command rejection, a buffer overflow) drains what already arrived before
   * surfacing the error — those messages genuinely came off the wire, and
   * dropping them would lose data the consumer never asked to give up. */
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

interface Waiter<T> {
  resolve: (result: IteratorResult<T>) => void
  reject: (reason: unknown) => void
}

/**
 * The async queue behind every stream this module hands out.
 *
 * Two invariants keep the logic honest:
 *
 *  1. `buffer` and `waiters` are never both non-empty — `push` always hands
 *     a message to a waiting consumer in preference to buffering it, and a
 *     consumer only becomes a waiter when the buffer is already empty.
 *  2. The first terminal condition wins. Once `finish`/`fail` has run, later
 *     ones are ignored, so a command rejection arriving after an abort cannot
 *     replace the abort as the reason the stream ended.
 *
 * `waiters` is a FIFO list rather than a single slot: several consumers may
 * legitimately be awaiting the same stream (a `Promise.all` over two
 * iterations, a queue of workers), and a single slot would let the second
 * overwrite the first, leaving that first promise unsettled forever.
 */
class ChannelQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private buffer: T[] = []
  private readonly waiters: Waiter<T>[] = []
  private done = false
  /** Set when the stream ended in an error that no consumer has observed
   * yet. Cleared the moment it is surfaced, so the iterator reports itself
   * exhausted afterwards instead of re-throwing forever. */
  private failure: { reason: unknown } | undefined
  /** Runs once, when the stream reaches a terminal state — releases whatever
   * the stream had attached to outlive-the-stream resources (today: the
   * caller's `AbortSignal`). */
  private onTerminate: (() => void) | undefined

  constructor(
    private readonly highWaterMark: number,
    private readonly overflow: ChannelOverflowPolicy,
  ) {}

  setOnTerminate(fn: () => void): void {
    if (this.done) {
      // Already terminal (e.g. an already-aborted signal): nothing will call
      // this later, so release immediately rather than never.
      fn()
      return
    }
    this.onTerminate = fn
  }

  private terminate(): void {
    this.done = true
    const release = this.onTerminate
    this.onTerminate = undefined
    release?.()
  }

  push(message: T): void {
    if (this.done) return

    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value: message, done: false })
      return
    }

    if (this.buffer.length >= this.highWaterMark) {
      if (this.overflow === 'drop-newest') return
      if (this.overflow === 'drop-oldest') {
        this.buffer.shift()
      } else {
        // Not an abort: what already arrived is still delivered, and the
        // overflow surfaces once the buffer runs dry.
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
    this.terminate()
    while (this.waiters.length > 0) {
      this.waiters.shift()?.resolve({ value: undefined, done: true })
    }
  }

  /** `discardBuffered` is set only for an abort — see the `signal` doc
   * comment on `ChannelStreamOptions`. */
  fail(reason: unknown, discardBuffered = false): void {
    if (this.done) return
    this.terminate()
    this.failure = { reason }
    if (discardBuffered) this.buffer = []

    // By invariant 1 a waiter implies an empty buffer, so there is nothing
    // left to drain for anyone parked here — surface the error immediately.
    while (this.waiters.length > 0) {
      this.failure = undefined
      this.waiters.shift()?.reject(reason)
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.buffer.length > 0) {
      const value = this.buffer.shift() as T
      return { value, done: false }
    }
    if (this.failure) {
      const { reason } = this.failure
      this.failure = undefined
      throw reason
    }
    if (this.done) return { value: undefined, done: true }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  /** Called by `for await` on `break`/`return`/`throw`. Ends the stream and
   * drops anything still buffered — the consumer is gone, so retaining its
   * messages is pure leak. */
  // biome-ignore lint/suspicious/noExplicitAny: matches the standard AsyncIterator#return signature
  async return(value?: any): Promise<IteratorResult<T>> {
    this.finish()
    this.buffer = []
    this.failure = undefined
    return { value, done: true }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this
  }
}

/**
 * Wires `signal` to the queue and hands back the queue's release hook, so
 * the listener comes off the signal as soon as the stream ends — by any
 * route, not just by aborting. A signal typically outlives any one stream (a
 * component-scoped controller is reused across many calls); leaving the
 * listener attached would retain the whole queue for the signal's lifetime.
 */
function attachAbort(queue: ChannelQueue<never>, signal: AbortSignal | undefined): void {
  if (!signal) return
  if (signal.aborted) {
    queue.fail(new AbortError('channel'), true)
    return
  }
  const onAbort = () => queue.fail(new AbortError('channel'), true)
  signal.addEventListener('abort', onAbort, { once: true })
  queue.setOnTerminate(() => signal.removeEventListener('abort', onAbort))
}

/**
 * The low-level primitive: a fresh `Channel<T>` paired with an
 * `AsyncIterable<T>` fed by its messages. Completion is driven only by
 * `options.isFinished` (or `signal`/manual `channel.onmessage` replacement) —
 * there is no command promise here to tie completion to. Prefer
 * `invokeChannel` when a single command call owns the channel's whole
 * lifetime, which is the common case.
 */
function buildChannel<T>(options: ChannelStreamOptions<T>): {
  channel: Channel<T>
  queue: ChannelQueue<T>
} {
  const { signal, highWaterMark = 1024, overflow = 'error', isFinished } = options
  const queue = new ChannelQueue<T>(highWaterMark, overflow)
  attachAbort(queue as unknown as ChannelQueue<never>, signal)

  const channel = createRawChannel<T>((message) => {
    queue.push(message)
    if (isFinished?.(message)) queue.finish()
  })

  return { channel, queue }
}

export function createChannel<T>(options: ChannelStreamOptions<T> = {}): {
  channel: Channel<T>
  stream: AsyncIterable<T>
} {
  const { channel, queue } = buildChannel(options)
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
  const { channel, queue } = buildChannel(options)

  // A rejection here does not discard what already arrived: those messages
  // came off the wire before the command failed, so they are drained first
  // and the error surfaces after them. If the stream already ended (an abort,
  // or an `isFinished` marker), `fail`/`finish` no-op — the first terminal
  // condition wins.
  call(channel).then(
    () => queue.finish(),
    (reason: unknown) => queue.fail(reason),
  )

  return queue
}
