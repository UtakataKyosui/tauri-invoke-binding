import { afterEach, describe, expect, it } from 'vitest'
import { logger } from '../../src/middleware/logger.js'
import type { Invoker } from '../../src/middleware/pipeline.js'
import { composeMiddleware } from '../../src/middleware/pipeline.js'

const originalNodeEnv = process.env['NODE_ENV']

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env['NODE_ENV']
  } else {
    process.env['NODE_ENV'] = originalNodeEnv
  }
})

describe('logger middleware (issue #17)', () => {
  it('logs command, args, status, and duration on success via a custom sink', async () => {
    const entries: unknown[] = []
    const base: Invoker = async () => 'ok'
    const pipeline = composeMiddleware([logger({ sink: (e) => entries.push(e) })])(base)

    await pipeline({ command: 'hello_world', args: { myName: 'x' }, callOptions: {} })

    expect(entries).toEqual([
      expect.objectContaining({
        command: 'hello_world',
        args: { myName: 'x' },
        status: 'ok',
      }),
    ])
    expect((entries[0] as { ms: number }).ms).toBeGreaterThanOrEqual(0)
  })

  it('logs the classified error kind on failure and rethrows', async () => {
    const entries: unknown[] = []
    const base: Invoker = async () => {
      throw 42
    }
    const pipeline = composeMiddleware([logger({ sink: (e) => entries.push(e) })])(base)

    await expect(pipeline({ command: 'has_error', args: undefined, callOptions: {} })).rejects.toBe(
      42,
    )
    expect(entries).toEqual([
      expect.objectContaining({ command: 'has_error', status: 'error', kind: 'command' }),
    ])
  })

  it('masks configured keys, recursively, before they reach the sink', async () => {
    const entries: unknown[] = []
    const base: Invoker = async () => 'ok'
    const pipeline = composeMiddleware([
      logger({ sink: (e) => entries.push(e), mask: ['apiToken'] }),
    ])(base)

    await pipeline({
      command: 'login',
      args: {
        label: 'example',
        apiToken: 'placeholder-value-not-a-real-token',
        nested: { apiToken: 'another-placeholder-value' },
      },
      callOptions: {},
    })

    expect((entries[0] as { args: unknown }).args).toEqual({
      label: 'example',
      apiToken: '***',
      nested: { apiToken: '***' },
    })
  })

  it('supports a custom mask function instead of a key list', async () => {
    const entries: unknown[] = []
    const base: Invoker = async () => 'ok'
    const pipeline = composeMiddleware([
      logger({ sink: (e) => entries.push(e), mask: () => '[redacted]' }),
    ])(base)

    await pipeline({ command: 'cmd', args: { a: 1 }, callOptions: {} })
    expect((entries[0] as { args: unknown }).args).toBe('[redacted]')
  })

  it('calls onDuration independently of sink', async () => {
    const durations: unknown[] = []
    const base: Invoker = async () => 'ok'
    const pipeline = composeMiddleware([
      logger({ sink: () => {}, onDuration: (d) => durations.push(d) }),
    ])(base)

    await pipeline({ command: 'cmd', args: undefined, callOptions: {} })
    expect(durations).toEqual([expect.objectContaining({ command: 'cmd', status: 'ok' })])
  })

  it('is disabled by default when NODE_ENV is production', async () => {
    process.env['NODE_ENV'] = 'production'
    const entries: unknown[] = []
    const base: Invoker = async () => 'ok'
    const pipeline = composeMiddleware([logger({ sink: (e) => entries.push(e) })])(base)

    await pipeline({ command: 'cmd', args: undefined, callOptions: {} })
    expect(entries).toEqual([])
  })

  it('enabled: true overrides the production default', async () => {
    process.env['NODE_ENV'] = 'production'
    const entries: unknown[] = []
    const base: Invoker = async () => 'ok'
    const pipeline = composeMiddleware([logger({ enabled: true, sink: (e) => entries.push(e) })])(
      base,
    )

    await pipeline({ command: 'cmd', args: undefined, callOptions: {} })
    expect(entries).toHaveLength(1)
  })

  it('is enabled by default outside production', async () => {
    process.env['NODE_ENV'] = 'development'
    const entries: unknown[] = []
    const base: Invoker = async () => 'ok'
    const pipeline = composeMiddleware([logger({ sink: (e) => entries.push(e) })])(base)

    await pipeline({ command: 'cmd', args: undefined, callOptions: {} })
    expect(entries).toHaveLength(1)
  })
})
