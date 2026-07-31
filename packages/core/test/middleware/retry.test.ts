import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AbortError, NotInTauriError, TimeoutError } from '../../src/internal/errors.js'
import type { Invoker } from '../../src/middleware/pipeline.js'
import { composeMiddleware } from '../../src/middleware/pipeline.js'
import { retry } from '../../src/middleware/retry.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

async function runToSettle<T>(promise: Promise<T>) {
  // Retry backoff is real (if small) — drain the fake-timer queue until the
  // promise settles, however many attempts it takes.
  let done = false
  promise.then(
    () => {
      done = true
    },
    () => {
      done = true
    },
  )
  for (let i = 0; i < 20 && !done; i++) {
    await vi.advanceTimersByTimeAsync(60_000)
  }
  return promise
}

function alwaysFails(reason: unknown): Invoker {
  return async () => {
    throw reason
  }
}

describe('retry middleware (issue #15)', () => {
  it('retries a plain-value rejection classified as "unknown" up to the configured times', async () => {
    let calls = 0
    const base: Invoker = async () => {
      calls += 1
      if (calls < 3) throw new TypeError('mystery failure')
      return 'ok'
    }
    const pipeline = composeMiddleware([retry({ times: 5 })])(base)

    await expect(
      runToSettle(pipeline({ command: 'cmd', args: undefined, callOptions: {} })),
    ).resolves.toBe('ok')
    expect(calls).toBe(3)
  })

  it('gives up once the retry budget is exhausted', async () => {
    let calls = 0
    const base: Invoker = async () => {
      calls += 1
      throw new TypeError('mystery failure')
    }
    const pipeline = composeMiddleware([retry({ times: 2 })])(base)

    await expect(
      runToSettle(pipeline({ command: 'cmd', args: undefined, callOptions: {} })),
    ).rejects.toBeInstanceOf(TypeError)
    expect(calls).toBe(3) // initial attempt + 2 retries
  })

  it.each([
    ['command-not-found', new TypeError('unknown command `x`')],
    ['deserialization', new TypeError('invalid args `myName` for command `hello_world`: bad')],
    ['permission-denied', new TypeError('capability denied for command x')],
    ['not-in-tauri', new NotInTauriError('cmd')],
    ['timeout', new TimeoutError('cmd', 100)],
  ])('does not retry the default non-retryable kind %s', async (_kind, reason) => {
    let calls = 0
    const base: Invoker = async () => {
      calls += 1
      throw reason
    }
    const pipeline = composeMiddleware([retry({ times: 5 })])(base)

    await expect(
      runToSettle(pipeline({ command: 'cmd', args: undefined, callOptions: {} })),
    ).rejects.toBe(reason)
    expect(calls).toBe(1)
  })

  it("does not retry the Rust command's own declared Err(E) by default", async () => {
    let calls = 0
    const base: Invoker = async () => {
      calls += 1
      throw 42 // a plain value classifies as { kind: 'command', value: 42 }
    }
    const pipeline = composeMiddleware([retry({ times: 5 })])(base)

    await expect(
      runToSettle(pipeline({ command: 'cmd', args: undefined, callOptions: {} })),
    ).rejects.toBe(42)
    expect(calls).toBe(1)
  })

  it('never retries an abort, and rethrows it immediately', async () => {
    let calls = 0
    const base: Invoker = async () => {
      calls += 1
      throw new AbortError('cmd')
    }
    const pipeline = composeMiddleware([retry({ times: 5 })])(base)

    await expect(
      pipeline({ command: 'cmd', args: undefined, callOptions: {} }),
    ).rejects.toBeInstanceOf(AbortError)
    expect(calls).toBe(1)
  })

  it('interrupts the backoff wait immediately when the signal aborts mid-wait', async () => {
    const controller = new AbortController()
    const base = alwaysFails(new TypeError('mystery failure'))
    const pipeline = composeMiddleware([retry({ times: 5 })])(base)

    const promise = pipeline({
      command: 'cmd',
      args: undefined,
      signal: controller.signal,
      callOptions: {},
    })
    const assertion = expect(promise).rejects.toBeInstanceOf(AbortError)

    // Let the first attempt fail and the backoff wait begin, then abort
    // before the wait would naturally elapse.
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    await assertion
  })

  it('lets the caller override retryability via CallOptions.retry.shouldRetry', async () => {
    let calls = 0
    const base: Invoker = async () => {
      calls += 1
      throw new TypeError('unknown command `x`') // classifies as command-not-found
    }
    const pipeline = composeMiddleware([retry({ times: 5 })])(base)

    await expect(
      runToSettle(
        pipeline({
          command: 'cmd',
          args: undefined,
          callOptions: { retry: { times: 1, shouldRetry: () => true } },
        }),
      ),
    ).rejects.toBeInstanceOf(TypeError)
    expect(calls).toBe(2) // initial attempt + 1 retry, forced by the override
  })

  it('lets the caller disable retrying entirely via CallOptions.retry: false', async () => {
    let calls = 0
    const base: Invoker = async () => {
      calls += 1
      throw new TypeError('mystery failure')
    }
    const pipeline = composeMiddleware([retry({ times: 5 })])(base)

    await expect(
      pipeline({ command: 'cmd', args: undefined, callOptions: { retry: false } }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(calls).toBe(1)
  })
})
