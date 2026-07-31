import { describe, expect, it } from 'vitest'
import type { Invoker, Middleware } from '../../src/middleware/pipeline.js'
import { composeMiddleware } from '../../src/middleware/pipeline.js'

function tracer(name: string, log: string[]): Middleware {
  return (next: Invoker): Invoker => {
    return async (ctx) => {
      log.push(`before:${name}`)
      try {
        const result = await next(ctx)
        log.push(`after:${name}`)
        return result
      } catch (e) {
        log.push(`error:${name}`)
        throw e
      }
    }
  }
}

describe('composeMiddleware (issue #13)', () => {
  it('runs "before" logic front-to-back and "after" logic back-to-front', async () => {
    const log: string[] = []
    const base: Invoker = async () => 'ok'
    const pipeline = composeMiddleware([tracer('A', log), tracer('B', log), tracer('C', log)])(base)

    await pipeline({ command: 'cmd', args: undefined, callOptions: {} })

    expect(log).toEqual(['before:A', 'before:B', 'before:C', 'after:C', 'after:B', 'after:A'])
  })

  it('propagates an error through every middleware, back-to-front, unwrapped', async () => {
    const log: string[] = []
    const failure = new Error('boom')
    const base: Invoker = async () => {
      throw failure
    }
    const pipeline = composeMiddleware([tracer('A', log), tracer('B', log)])(base)

    await expect(pipeline({ command: 'cmd', args: undefined, callOptions: {} })).rejects.toBe(
      failure,
    )
    expect(log).toEqual(['before:A', 'before:B', 'error:B', 'error:A'])
  })

  it('with zero middleware, the base invoker runs as-is', async () => {
    const base: Invoker = async (ctx) => `${ctx.command}:${JSON.stringify(ctx.args)}`
    const pipeline = composeMiddleware([])(base)

    await expect(pipeline({ command: 'ping', args: { x: 1 }, callOptions: {} })).resolves.toBe(
      'ping:{"x":1}',
    )
  })

  it('with a single middleware, it wraps the base invoker directly', async () => {
    const log: string[] = []
    const base: Invoker = async () => 'ok'
    const pipeline = composeMiddleware([tracer('only', log)])(base)

    await pipeline({ command: 'cmd', args: undefined, callOptions: {} })
    expect(log).toEqual(['before:only', 'after:only'])
  })

  it('passes ctx through unmodified to the base invoker when middleware do not touch it', async () => {
    let seen: unknown
    const base: Invoker = async (ctx) => {
      seen = ctx
      return 'ok'
    }
    const passthrough: Middleware = (next) => (ctx) => next(ctx)
    const pipeline = composeMiddleware([passthrough])(base)

    const ctx = { command: 'cmd', args: { a: 1 }, callOptions: { timeoutMs: 5 } }
    await pipeline(ctx)
    expect(seen).toEqual(ctx)
  })
})
