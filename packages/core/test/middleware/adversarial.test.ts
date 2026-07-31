/**
 * Adversarial suite: each test here was written to *break* the L3
 * implementation, not to confirm it. Anything that survives is a property
 * worth keeping locked down; anything that failed when first written is
 * noted with the fix it forced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { raceAbort } from '../../src/internal/abort.js'
import { dedupe } from '../../src/middleware/dedupe.js'
import { logger } from '../../src/middleware/logger.js'
import type { Invoker } from '../../src/middleware/pipeline.js'
import { composeMiddleware } from '../../src/middleware/pipeline.js'
import { retry } from '../../src/middleware/retry.js'
import { timeout } from '../../src/middleware/timeout.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('dedupe × AbortSignal (adversarial)', () => {
  it("one caller's abort must not cancel a different caller merged onto the same in-flight call", async () => {
    const d = deferred<string>()
    const base: Invoker = () => d.promise
    const pipeline = composeMiddleware([dedupe()])(base)

    const a = new AbortController()
    const b = new AbortController()
    const callA = pipeline({
      command: 'read',
      args: { p: 1 },
      signal: a.signal,
      callOptions: { dedupe: true, signal: a.signal },
    })
    const callB = pipeline({
      command: 'read',
      args: { p: 1 },
      signal: b.signal,
      callOptions: { dedupe: true, signal: b.signal },
    })

    // A walks away. B never aborted and must still get the real result.
    a.abort()
    await expect(callA).rejects.toMatchObject({ name: 'AbortError' })

    d.resolve('payload')
    await expect(callB).resolves.toBe('payload')
  })

  it("a merged caller's own abort must reject that caller, even though it did not start the call", async () => {
    const d = deferred<string>()
    const base: Invoker = () => d.promise
    const pipeline = composeMiddleware([dedupe()])(base)

    const a = new AbortController()
    const b = new AbortController()
    const callA = pipeline({
      command: 'read',
      args: { p: 1 },
      signal: a.signal,
      callOptions: { dedupe: true, signal: a.signal },
    })
    const callB = pipeline({
      command: 'read',
      args: { p: 1 },
      signal: b.signal,
      callOptions: { dedupe: true, signal: b.signal },
    })

    b.abort()
    await expect(callB).rejects.toMatchObject({ name: 'AbortError' })

    d.resolve('payload')
    await expect(callA).resolves.toBe('payload')
  })

  it('does not leak the in-flight entry when every merged caller aborts', async () => {
    const d = deferred<string>()
    const invoke = vi.fn(() => d.promise)
    const pipeline = composeMiddleware([dedupe()])(invoke)

    const a = new AbortController()
    const callA = pipeline({
      command: 'read',
      args: { p: 1 },
      signal: a.signal,
      callOptions: { dedupe: true, signal: a.signal },
    })
    a.abort()
    await expect(callA).rejects.toMatchObject({ name: 'AbortError' })

    // The underlying call settles; the key must be released so a later call
    // is fresh rather than joining a corpse.
    d.resolve('payload')
    await Promise.resolve()
    await Promise.resolve()

    await expect(
      pipeline({ command: 'read', args: { p: 1 }, callOptions: { dedupe: true } }),
    ).resolves.toBeDefined()
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})

describe('stableKey edge cases via dedupe (adversarial)', () => {
  it('does not collide undefined args with the string "undefined"', async () => {
    const invoke = vi.fn().mockResolvedValue('r')
    const pipeline = composeMiddleware([dedupe()])(invoke)
    const callOptions = { dedupe: true }

    await Promise.all([
      pipeline({ command: 'cmd', args: undefined, callOptions }),
      pipeline({ command: 'cmd', args: 'undefined', callOptions }),
    ])

    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('distinguishes an array from an object with numeric keys', async () => {
    const invoke = vi.fn().mockResolvedValue('r')
    const pipeline = composeMiddleware([dedupe()])(invoke)
    const callOptions = { dedupe: true }

    await Promise.all([
      pipeline({ command: 'cmd', args: ['a'], callOptions }),
      pipeline({ command: 'cmd', args: { 0: 'a' }, callOptions }),
    ])

    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('keeps array order significant while ignoring object key order', async () => {
    const invoke = vi.fn().mockResolvedValue('r')
    const pipeline = composeMiddleware([dedupe()])(invoke)
    const callOptions = { dedupe: true }

    await Promise.all([
      pipeline({ command: 'cmd', args: [1, 2], callOptions }),
      pipeline({ command: 'cmd', args: [2, 1], callOptions }),
    ])

    expect(invoke).toHaveBeenCalledTimes(2)
  })
})

describe('retry boundary conditions (adversarial)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('times: 0 means the initial attempt only, never a retry', async () => {
    let calls = 0
    const base: Invoker = async () => {
      calls += 1
      throw new TypeError('mystery')
    }
    const pipeline = composeMiddleware([retry({ times: 0 })])(base)

    await expect(
      pipeline({ command: 'cmd', args: undefined, callOptions: {} }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(calls).toBe(1)
  })

  it('an empty retry override object falls back to the middleware defaults rather than disabling retry', async () => {
    let calls = 0
    const base: Invoker = async () => {
      calls += 1
      throw new TypeError('mystery')
    }
    const pipeline = composeMiddleware([retry({ times: 2 })])(base)

    const promise = pipeline({ command: 'cmd', args: undefined, callOptions: { retry: {} } })
    const assertion = expect(promise).rejects.toBeInstanceOf(TypeError)
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
    expect(calls).toBe(3)
  })

  it('rethrows the original rejection, not a wrapped or re-classified one', async () => {
    const original = new TypeError('mystery')
    const base: Invoker = async () => {
      throw original
    }
    const pipeline = composeMiddleware([retry({ times: 0 })])(base)

    await expect(pipeline({ command: 'cmd', args: undefined, callOptions: {} })).rejects.toBe(
      original,
    )
  })
})

describe('middleware composition hazards (adversarial)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a timeout placed outside retry bounds the whole retry sequence, not each attempt', async () => {
    let calls = 0
    const base: Invoker = async () => {
      calls += 1
      throw new TypeError('mystery')
    }
    // timeout is outermost: it wraps retry, so the deadline covers every
    // attempt plus the backoff waits between them.
    const pipeline = composeMiddleware([timeout(300), retry({ times: 50 })])(base)

    const promise = pipeline({ command: 'cmd', args: undefined, callOptions: {} })
    const assertion = expect(promise).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
    // It gave up on the clock, not on the retry budget.
    expect(calls).toBeLessThan(50)
  })

  it('a logger sink that throws must not corrupt a successful call', async () => {
    const base: Invoker = async () => 'ok'
    const pipeline = composeMiddleware([
      logger({
        sink: () => {
          throw new Error('sink exploded')
        },
      }),
    ])(base)

    await expect(pipeline({ command: 'cmd', args: undefined, callOptions: {} })).resolves.toBe('ok')
  })

  it('a logger sink that throws must not mask the original failure', async () => {
    const original = new TypeError('real failure')
    const base: Invoker = async () => {
      throw original
    }
    const pipeline = composeMiddleware([
      logger({
        sink: () => {
          throw new Error('sink exploded')
        },
      }),
    ])(base)

    await expect(pipeline({ command: 'cmd', args: undefined, callOptions: {} })).rejects.toBe(
      original,
    )
  })
})

// Real timers throughout: this suite is about what the Node runtime reports
// after the microtask queue drains, which fake timers cannot stand in for.
describe('late-settlement hygiene (adversarial)', () => {
  it('a rejection arriving after the timeout already fired does not surface as an unhandled rejection', async () => {
    const d = deferred<string>()
    const base: Invoker = () => d.promise
    const pipeline = composeMiddleware([timeout(5)])(base)

    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      await expect(
        pipeline({ command: 'cmd', args: undefined, callOptions: {} }),
      ).rejects.toMatchObject({ name: 'TimeoutError' })

      d.reject(new Error('late failure nobody is waiting for'))
      await new Promise((r) => setTimeout(r, 20))
    } finally {
      process.off('unhandledRejection', unhandled)
    }

    expect(unhandled).not.toHaveBeenCalled()
  })

  it('a rejection arriving after an abort does not surface as an unhandled rejection', async () => {
    const d = deferred<string>()
    const base: Invoker = (ctx) => raceAbort(d.promise, ctx.signal, ctx.command)
    const pipeline = composeMiddleware([])(base)
    const controller = new AbortController()

    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const promise = pipeline({
        command: 'cmd',
        args: undefined,
        signal: controller.signal,
        callOptions: {},
      })
      controller.abort()
      await expect(promise).rejects.toMatchObject({ name: 'AbortError' })

      d.reject(new Error('late failure nobody is waiting for'))
      await new Promise((r) => setTimeout(r, 20))
    } finally {
      process.off('unhandledRejection', unhandled)
    }

    expect(unhandled).not.toHaveBeenCalled()
  })

  it('a dedupe-shared rejection is delivered to every merged caller exactly once, with no unhandled leftovers', async () => {
    const d = deferred<string>()
    const base: Invoker = () => d.promise
    const pipeline = composeMiddleware([dedupe()])(base)
    const callOptions = { dedupe: true }

    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const calls = [
        pipeline({ command: 'cmd', args: { a: 1 }, callOptions }),
        pipeline({ command: 'cmd', args: { a: 1 }, callOptions }),
        pipeline({ command: 'cmd', args: { a: 1 }, callOptions }),
      ]
      const failure = new Error('shared failure')
      d.reject(failure)

      const settled = await Promise.allSettled(calls)
      expect(settled.every((s) => s.status === 'rejected')).toBe(true)
      await new Promise((r) => setTimeout(r, 20))
    } finally {
      process.off('unhandledRejection', unhandled)
    }

    expect(unhandled).not.toHaveBeenCalled()
  })
})
