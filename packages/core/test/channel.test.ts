import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/internal/tauri.js', () => ({
  createRawChannel: vi.fn(),
}))

const { createRawChannel } = await import('../src/internal/tauri.js')
const { createChannel, invokeChannel } = await import('../src/channel.js')

const mockCreateRawChannel = vi.mocked(createRawChannel)

/** A fake `Channel<T>`: `emit` simulates a message arriving from Rust,
 * driving whatever `onmessage` handler `channel.ts` registered. */
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

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}

describe('invokeChannel (issue #22 — Channel<T> as AsyncIterable)', () => {
  it('yields every message pushed before the command resolves, then ends', async () => {
    const fake = fakeChannel<number>()
    const stream = invokeChannel<number>(async () => {
      fake.emit(1)
      fake.emit(2)
      fake.emit(3)
    })
    expect(await collect(stream)).toEqual([1, 2, 3])
  })

  it('yields messages that arrive after the consumer is already awaiting next()', async () => {
    const fake = fakeChannel<number>()
    let resolveCommand: (() => void) | undefined
    const stream = invokeChannel<number>(
      () =>
        new Promise<void>((resolve) => {
          resolveCommand = resolve
        }),
    )
    const iterator = stream[Symbol.asyncIterator]()
    const pending = iterator.next()
    fake.emit(7)
    await expect(pending).resolves.toEqual({ value: 7, done: false })
    resolveCommand?.()
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('ends the stream with an error when the command promise rejects', async () => {
    const fake = fakeChannel<string>()
    const reason = new Error('boom')
    const stream = invokeChannel<string>(async () => {
      fake.emit('a')
      throw reason
    })
    const iterator = stream[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ value: 'a', done: false })
    await expect(iterator.next()).rejects.toBe(reason)
  })

  it('ends the stream early via isFinished without waiting for the command promise', async () => {
    const fake = fakeChannel<{ kind: string }>()
    let resolveCommand: (() => void) | undefined
    const commandPromise = new Promise<void>((resolve) => {
      resolveCommand = resolve
    })
    const stream = invokeChannel<{ kind: string }>(
      () => {
        fake.emit({ kind: 'progress' })
        fake.emit({ kind: 'finished' })
        return commandPromise
      },
      { isFinished: (m) => m.kind === 'finished' },
    )
    expect(await collect(stream)).toEqual([{ kind: 'progress' }, { kind: 'finished' }])
    resolveCommand?.()
  })
})

describe('createChannel backpressure (issue #22)', () => {
  it('buffers messages up to highWaterMark', async () => {
    const fake = fakeChannel<number>()
    const { stream } = createChannel<number>({ highWaterMark: 2 })
    fake.emit(1)
    fake.emit(2)
    const iterator = stream[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ value: 1, done: false })
    await expect(iterator.next()).resolves.toEqual({ value: 2, done: false })
  })

  it("overflow: 'error' (default) fails the stream once highWaterMark is exceeded", async () => {
    const fake = fakeChannel<number>()
    const { stream } = createChannel<number>({ highWaterMark: 1 })
    fake.emit(1)
    fake.emit(2) // exceeds the cap while unconsumed
    const iterator = stream[Symbol.asyncIterator]()
    // The already-buffered message is still delivered first; the overflow
    // only surfaces once the buffer itself is drained.
    await expect(iterator.next()).resolves.toEqual({ value: 1, done: false })
    await expect(iterator.next()).rejects.toThrow(/highWaterMark/)
  })

  it("overflow: 'drop-oldest' discards the oldest buffered message", async () => {
    const fake = fakeChannel<number>()
    const { stream } = createChannel<number>({ highWaterMark: 2, overflow: 'drop-oldest' })
    fake.emit(1)
    fake.emit(2)
    fake.emit(3) // drops 1
    const iterator = stream[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ value: 2, done: false })
    await expect(iterator.next()).resolves.toEqual({ value: 3, done: false })
  })

  it("overflow: 'drop-newest' discards the incoming message", async () => {
    const fake = fakeChannel<number>()
    const { stream } = createChannel<number>({ highWaterMark: 2, overflow: 'drop-newest' })
    fake.emit(1)
    fake.emit(2)
    fake.emit(3) // dropped
    const iterator = stream[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ value: 1, done: false })
    await expect(iterator.next()).resolves.toEqual({ value: 2, done: false })
  })
})

describe('createChannel + AbortSignal (issue #22)', () => {
  it('ends the stream with an error when the signal fires, after any already-buffered message', async () => {
    const fake = fakeChannel<number>()
    const ac = new AbortController()
    const { stream } = createChannel<number>({ signal: ac.signal })
    fake.emit(1)
    ac.abort()
    const iterator = stream[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ value: 1, done: false })
    await expect(iterator.next()).rejects.toThrow(/aborted/i)
  })

  it('an already-aborted signal fails the stream immediately', async () => {
    fakeChannel<number>()
    const ac = new AbortController()
    ac.abort()
    const { stream } = createChannel<number>({ signal: ac.signal })
    const iterator = stream[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toThrow(/aborted/i)
  })
})
