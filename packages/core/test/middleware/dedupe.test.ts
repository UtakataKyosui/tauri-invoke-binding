import { describe, expect, it, vi } from 'vitest'
import { dedupe } from '../../src/middleware/dedupe.js'
import type { Invoker } from '../../src/middleware/pipeline.js'
import { composeMiddleware } from '../../src/middleware/pipeline.js'

describe('dedupe middleware (issue #18)', () => {
  it('merges concurrent calls to the same command with the same args into one invoke', async () => {
    const invoke = vi.fn().mockResolvedValue('result')
    const base: Invoker = invoke
    const pipeline = composeMiddleware([dedupe()])(base)

    const ctx = { command: 'read_file', args: { path: '/tmp/x' }, callOptions: { dedupe: true } }
    const [a, b, c] = await Promise.all([pipeline(ctx), pipeline(ctx), pipeline(ctx)])

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(a).toBe('result')
    expect(b).toBe('result')
    expect(c).toBe('result')
  })

  it('treats differently-ordered object keys as the same call', async () => {
    const invoke = vi.fn().mockResolvedValue('result')
    const pipeline = composeMiddleware([dedupe()])(invoke)

    const callOptions = { dedupe: true }
    await Promise.all([
      pipeline({ command: 'cmd', args: { a: 1, b: 2 }, callOptions }),
      pipeline({ command: 'cmd', args: { b: 2, a: 1 }, callOptions }),
    ])

    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('is opt-in: without dedupe: true in CallOptions, every call goes through', async () => {
    const invoke = vi.fn().mockResolvedValue('result')
    const pipeline = composeMiddleware([dedupe()])(invoke)

    const ctx = { command: 'cmd', args: { a: 1 }, callOptions: {} }
    await Promise.all([pipeline(ctx), pipeline(ctx)])

    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('does not merge calls with different args', async () => {
    const invoke = vi.fn().mockResolvedValue('result')
    const pipeline = composeMiddleware([dedupe()])(invoke)

    const callOptions = { dedupe: true }
    await Promise.all([
      pipeline({ command: 'cmd', args: { a: 1 }, callOptions }),
      pipeline({ command: 'cmd', args: { a: 2 }, callOptions }),
    ])

    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('removes a call from in-flight tracking once it settles, so the next call is fresh', async () => {
    const invoke = vi.fn().mockResolvedValue('result')
    const pipeline = composeMiddleware([dedupe()])(invoke)

    const ctx = { command: 'cmd', args: { a: 1 }, callOptions: { dedupe: true } }
    await pipeline(ctx)
    await pipeline(ctx)

    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('also merges concurrent calls that reject, without caching the failure afterward', async () => {
    const failure = new Error('boom')
    const invoke = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce('ok')
    const pipeline = composeMiddleware([dedupe()])(invoke)

    const ctx = { command: 'cmd', args: { a: 1 }, callOptions: { dedupe: true } }
    const [a, b] = await Promise.allSettled([pipeline(ctx), pipeline(ctx)])
    expect(a.status).toBe('rejected')
    expect(b.status).toBe('rejected')
    expect(invoke).toHaveBeenCalledTimes(1)

    await expect(pipeline(ctx)).resolves.toBe('ok')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
