import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Invoker } from '../../src/middleware/pipeline.js'
import { composeMiddleware } from '../../src/middleware/pipeline.js'
import { timeout } from '../../src/middleware/timeout.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('timeout middleware (issue #14)', () => {
  it('resolves normally when the call finishes before the deadline', async () => {
    const base: Invoker = async () => 'ok'
    const pipeline = composeMiddleware([timeout(1_000)])(base)

    const promise = pipeline({ command: 'cmd', args: undefined, callOptions: {} })
    await vi.advanceTimersByTimeAsync(10)
    await expect(promise).resolves.toBe('ok')
  })

  it('rejects with a TimeoutError once the deadline elapses', async () => {
    const base: Invoker = () => new Promise(() => {}) // never resolves
    const pipeline = composeMiddleware([timeout(1_000)])(base)

    const promise = pipeline({ command: 'slow_cmd', args: undefined, callOptions: {} })
    const assertion = expect(promise).rejects.toMatchObject({
      name: 'TimeoutError',
      command: 'slow_cmd',
      ms: 1_000,
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
  })

  it('is observable as a typed { kind: "timeout" } error on the safe path', async () => {
    const { callCommandSafe } = await import('../../src/call.js')
    const base: Invoker = () => new Promise(() => {})
    const pipeline = composeMiddleware([timeout(500)])(base)

    const promise = callCommandSafe('slow_cmd', undefined, pipeline)
    const assertion = expect(promise).resolves.toEqual({
      status: 'error',
      error: { kind: 'timeout', command: 'slow_cmd', ms: 500 },
    })
    await vi.advanceTimersByTimeAsync(500)
    await assertion
  })

  it('discards a result that resolves after the timeout has already fired', async () => {
    let resolveLate: (value: string) => void = () => {}
    const base: Invoker = () =>
      new Promise((resolve) => {
        resolveLate = resolve
      })
    const pipeline = composeMiddleware([timeout(100)])(base)

    const promise = pipeline({ command: 'slow_cmd', args: undefined, callOptions: {} })
    const assertion = expect(promise).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(100)
    await assertion

    // Resolving late must not throw an unhandled rejection or otherwise
    // surface — there is nothing listening for it anymore.
    expect(() => resolveLate('too late')).not.toThrow()
  })

  it('uses a per-call timeoutMs override instead of the middleware default', async () => {
    const base: Invoker = () => new Promise(() => {})
    const pipeline = composeMiddleware([timeout(10_000)])(base)

    const promise = pipeline({ command: 'cmd', args: undefined, callOptions: { timeoutMs: 50 } })
    const assertion = expect(promise).rejects.toMatchObject({ name: 'TimeoutError', ms: 50 })
    await vi.advanceTimersByTimeAsync(50)
    await assertion
  })

  it('disables the timeout when timeoutMs is 0', async () => {
    const base: Invoker = async () => 'ok'
    const pipeline = composeMiddleware([timeout(10_000)])(base)

    await expect(
      pipeline({ command: 'cmd', args: undefined, callOptions: { timeoutMs: 0 } }),
    ).resolves.toBe('ok')
  })
})
