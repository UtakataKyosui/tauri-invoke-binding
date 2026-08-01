/**
 * Adversarial suite for the L5 channel stream (issue #22). Targets the queue
 * itself rather than the happy path: concurrent consumers, early `break`,
 * listener retention on long-lived signals, and what a stream does *after*
 * it has already ended.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/internal/tauri.js', () => ({
  createRawChannel: vi.fn(),
}))

const { createRawChannel } = await import('../src/internal/tauri.js')
const { createChannel, invokeChannel } = await import('../src/channel.js')

const mockCreateRawChannel = vi.mocked(createRawChannel)

function fakeChannel<T>() {
  let onmessage: (message: T) => void = () => undefined
  mockCreateRawChannel.mockImplementationOnce((handler) => {
    onmessage = handler as (message: T) => void
    return {} as never
  })
  return { emit: (message: T) => onmessage(message) }
}

beforeEach(() => {
  mockCreateRawChannel.mockReset()
})

describe('concurrent consumers (adversarial)', () => {
  it('does not strand a consumer when next() is called twice before any message arrives', async () => {
    const fake = fakeChannel<number>()
    const { stream } = createChannel<number>()
    const iterator = stream[Symbol.asyncIterator]()

    // Two pending consumers with an empty buffer. A single-slot `pending`
    // field would let the second overwrite the first, leaving `first`
    // unsettled forever.
    const first = iterator.next()
    const second = iterator.next()
    fake.emit(1)
    fake.emit(2)

    await expect(first).resolves.toEqual({ value: 1, done: false })
    await expect(second).resolves.toEqual({ value: 2, done: false })
  })

  it('settles every pending consumer when the stream finishes', async () => {
    fakeChannel<number>()
    const { stream } = createChannel<number>()
    const iterator = stream[Symbol.asyncIterator]()

    const first = iterator.next()
    const second = iterator.next()
    await (iterator.return?.() ?? Promise.resolve())

    await expect(first).resolves.toEqual({ value: undefined, done: true })
    await expect(second).resolves.toEqual({ value: undefined, done: true })
  })

  it('rejects every pending consumer when the stream fails', async () => {
    fakeChannel<number>()
    const ac = new AbortController()
    const { stream } = createChannel<number>({ signal: ac.signal })
    const iterator = stream[Symbol.asyncIterator]()

    const first = iterator.next()
    const second = iterator.next()
    ac.abort()

    await expect(first).rejects.toThrow(/aborted/i)
    await expect(second).rejects.toThrow(/aborted/i)
  })
})

describe('early termination and resource release (adversarial)', () => {
  it('stops buffering after the consumer breaks out of the loop', async () => {
    const fake = fakeChannel<number>()
    let resolveCommand: (() => void) | undefined
    const stream = invokeChannel<number>(
      () =>
        new Promise<void>((resolve) => {
          resolveCommand = resolve
        }),
    )

    fake.emit(1)
    for await (const _ of stream) break

    // The consumer is gone. Anything Rust keeps pushing must not accumulate:
    // an unconsumed channel that grows without bound is the memory leak the
    // issue's completion criteria call out.
    for (let i = 0; i < 10_000; i++) fake.emit(i)

    const iterator = stream[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true })
    resolveCommand?.()
  })

  it('releases the abort listener once the stream ends normally', async () => {
    const fake = fakeChannel<number>()
    const ac = new AbortController()
    const addSpy = vi.spyOn(ac.signal, 'addEventListener')
    const removeSpy = vi.spyOn(ac.signal, 'removeEventListener')

    const stream = invokeChannel<number>(
      async () => {
        fake.emit(1)
      },
      { signal: ac.signal },
    )
    for await (const _ of stream) {
      // drain
    }

    // A signal outlives any one stream (a component-scoped controller is
    // reused across many calls). Leaving the listener attached retains the
    // whole queue for the signal's lifetime.
    expect(addSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledTimes(1)
  })

  it('does not retain buffered messages after the stream fails', async () => {
    const fake = fakeChannel<{ big: string }>()
    const ac = new AbortController()
    const { stream } = createChannel<{ big: string }>({ signal: ac.signal })
    fake.emit({ big: 'payload' })
    ac.abort()

    const iterator = stream[Symbol.asyncIterator]()
    // Buffered-then-failed: the error is what surfaces, and nothing is left
    // holding the payload afterwards.
    await expect(iterator.next()).rejects.toThrow(/aborted/i)
  })
})

describe('post-termination behaviour (adversarial)', () => {
  it('reports done (not a repeated throw) on next() after an error was surfaced', async () => {
    fakeChannel<number>()
    const ac = new AbortController()
    ac.abort()
    const { stream } = createChannel<number>({ signal: ac.signal })
    const iterator = stream[Symbol.asyncIterator]()

    await expect(iterator.next()).rejects.toThrow(/aborted/i)
    // An async iterator is finished once it throws; re-throwing forever means
    // a caller that loops defensively never terminates.
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('a command rejection after the stream was already aborted does not replace the abort', async () => {
    const fake = fakeChannel<number>()
    const ac = new AbortController()
    const stream = invokeChannel<number>(
      async () => {
        fake.emit(1)
        ac.abort()
        throw new Error('late command failure')
      },
      { signal: ac.signal },
    )

    const iterator = stream[Symbol.asyncIterator]()
    // The abort won the race, so that is the reason the stream ended — the
    // later command rejection must not overwrite it.
    await expect(iterator.next()).rejects.toThrow(/aborted/i)
  })

  it('a command rejection with no abort drains what arrived before surfacing', async () => {
    const fake = fakeChannel<number>()
    const stream = invokeChannel<number>(async () => {
      fake.emit(1)
      fake.emit(2)
      throw new Error('command failed')
    })

    const iterator = stream[Symbol.asyncIterator]()
    // These two genuinely came off the wire before the failure; dropping them
    // would lose data the consumer never asked to give up.
    await expect(iterator.next()).resolves.toEqual({ value: 1, done: false })
    await expect(iterator.next()).resolves.toEqual({ value: 2, done: false })
    await expect(iterator.next()).rejects.toThrow(/command failed/)
  })
})
