import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Command } from '../src/command.js'

vi.mock('../src/internal/tauri.js', () => ({
  rawInvoke: vi.fn(),
  isTauriEnvironment: vi.fn(),
}))

const { rawInvoke, isTauriEnvironment } = await import('../src/internal/tauri.js')
const { createClient } = await import('../src/client.js')

type AppCommands = {
  hello_world: Command<{ myName: string }, string>
  ping: Command<void, void>
  has_error: Command<void, string, number>
  fs_read_file: Command<{ path: string }, string>
}

const mockRawInvoke = vi.mocked(rawInvoke)
const mockIsTauriEnvironment = vi.mocked(isTauriEnvironment)

beforeEach(() => {
  mockRawInvoke.mockReset()
  mockIsTauriEnvironment.mockReset()
  mockIsTauriEnvironment.mockReturnValue(true)
})

describe('createClient runtime behavior (issue #5)', () => {
  it('derives the snake_case wire command name from the camelCase accessor', async () => {
    mockRawInvoke.mockResolvedValue('hi Tauri')
    const api = createClient<AppCommands>()

    await expect(api.helloWorld({ myName: 'Tauri' })).resolves.toBe('hi Tauri')
    expect(mockRawInvoke).toHaveBeenCalledWith('hello_world', { myName: 'Tauri' })
  })

  it('calls a no-args command with undefined args', async () => {
    mockRawInvoke.mockResolvedValue(undefined)
    const api = createClient<AppCommands>()

    await api.ping()
    expect(mockRawInvoke).toHaveBeenCalledWith('ping', undefined)
  })

  it('caches the derived invoker per property, deriving the name only once', async () => {
    mockRawInvoke.mockResolvedValue('x')
    const api = createClient<AppCommands>()

    const first = api.helloWorld
    const second = api.helloWorld
    expect(first).toBe(second)
  })

  it('the throwing call site rejects with whatever the underlying invoke rejects with', async () => {
    const reason = 404
    mockRawInvoke.mockRejectedValue(reason)
    const api = createClient<AppCommands>()

    await expect(api.hasError()).rejects.toBe(reason)
  })

  it('.safe never throws and classifies a plain rejection as the command Err', async () => {
    mockRawInvoke.mockRejectedValue(42)
    const api = createClient<AppCommands>()

    await expect(api.safe.hasError()).resolves.toEqual({
      status: 'error',
      error: { kind: 'command', value: 42 },
    })
    expect(mockRawInvoke).toHaveBeenCalledWith('has_error', undefined)
  })

  it('.safe resolves { status: "ok", data } on success', async () => {
    mockRawInvoke.mockResolvedValue('hi Tauri')
    const api = createClient<AppCommands>()

    await expect(api.safe.helloWorld({ myName: 'Tauri' })).resolves.toEqual({
      status: 'ok',
      data: 'hi Tauri',
    })
  })
})

describe('createClient namespacing runtime behavior (issue #8)', () => {
  it('prefixes the derived command name with the configured namespace prefix', async () => {
    mockRawInvoke.mockResolvedValue('file contents')
    const api = createClient<AppCommands, { fs: 'fs_' }>({ namespaces: { fs: 'fs_' } })

    await expect(api.fs.readFile({ path: '/tmp/x' })).resolves.toBe('file contents')
    expect(mockRawInvoke).toHaveBeenCalledWith('fs_read_file', { path: '/tmp/x' })
  })

  it('keeps flat top-level access working alongside a configured namespace', async () => {
    mockRawInvoke.mockResolvedValue('hi Tauri')
    const api = createClient<AppCommands, { fs: 'fs_' }>({ namespaces: { fs: 'fs_' } })

    await api.helloWorld({ myName: 'Tauri' })
    expect(mockRawInvoke).toHaveBeenCalledWith('hello_world', { myName: 'Tauri' })
  })

  it('gives each namespace its own working .safe accessor', async () => {
    mockRawInvoke.mockRejectedValue(
      new Error('invalid args `path` for command `fs_read_file`: bad'),
    )
    const api = createClient<AppCommands, { fs: 'fs_' }>({ namespaces: { fs: 'fs_' } })

    const result = await api.fs.safe.readFile({ path: '/tmp/x' })
    expect(result).toEqual({
      status: 'error',
      error: {
        kind: 'deserialization',
        command: 'fs_read_file',
        message: 'invalid args `path` for command `fs_read_file`: bad',
      },
    })
  })

  it('rejects a namespace literally named "safe" at runtime instead of silently shadowing the reserved accessor', () => {
    // Not a type error (see the doc comment on `Client` in client.ts for why
    // this collision can't be reliably caught at the type level) — this is
    // exactly why the runtime guard below exists.
    expect(() => createClient<AppCommands, { safe: 'x_' }>({ namespaces: { safe: 'x_' } })).toThrow(
      /reserved/,
    )
  })
})

describe('createClient middleware wiring (issue #13/#16)', () => {
  it('applies configured middleware to every call, in order', async () => {
    mockRawInvoke.mockResolvedValue('hi Tauri')
    const log: string[] = []
    const tag =
      (name: string): import('../src/middleware/index.js').Middleware =>
      (next) =>
      async (ctx) => {
        log.push(name)
        return next(ctx)
      }
    const api = createClient<AppCommands>({ middleware: [tag('A'), tag('B')] })

    await api.helloWorld({ myName: 'Tauri' })
    expect(log).toEqual(['A', 'B'])
  })

  it('passes a per-call signal through to the underlying invoke race', async () => {
    const controller = new AbortController()
    controller.abort()
    const api = createClient<AppCommands>()

    await expect(
      api.helloWorld({ myName: 'x' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockRawInvoke).not.toHaveBeenCalled()
  })

  it('merges commandOptions defaults with call-site CallOptions, call site winning', async () => {
    mockRawInvoke.mockResolvedValue('ok')
    let seenOptions: unknown
    const capture: import('../src/middleware/index.js').Middleware = (next) => async (ctx) => {
      seenOptions = ctx.callOptions
      return next(ctx)
    }
    const api = createClient<AppCommands>({
      middleware: [capture],
      commandOptions: { hello_world: { timeoutMs: 1_000, dedupe: true } },
    })

    await api.helloWorld({ myName: 'x' }, { timeoutMs: 5_000 })
    expect(seenOptions).toMatchObject({ timeoutMs: 5_000, dedupe: true })
  })

  it('gives the .safe accessor the same middleware pipeline as the throwing accessor', async () => {
    mockRawInvoke.mockRejectedValue(new TypeError('boom'))
    const log: string[] = []
    const tag: import('../src/middleware/index.js').Middleware = (next) => async (ctx) => {
      log.push(ctx.command)
      return next(ctx)
    }
    const api = createClient<AppCommands>({ middleware: [tag] })

    await api.safe.helloWorld({ myName: 'x' })
    expect(log).toEqual(['hello_world'])
  })
})
