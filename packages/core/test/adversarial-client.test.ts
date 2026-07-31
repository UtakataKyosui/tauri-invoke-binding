/**
 * Adversarial suite aimed at the two runtime dispatch mechanisms rather than
 * the middleware: the hand-written client's `Proxy` (which answers *any*
 * property access) and the `tauri-specta` adapter's arity-based split of
 * positional args from a trailing `CallOptions`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Command } from '../src/command.js'

vi.mock('../src/internal/tauri.js', () => ({
  rawInvoke: vi.fn(),
  isTauriEnvironment: vi.fn(),
}))

const { rawInvoke, isTauriEnvironment } = await import('../src/internal/tauri.js')
const { createClient } = await import('../src/client.js')
const { createClient: createSpectaClient } = await import('../src/specta.js')

type AppCommands = {
  hello_world: Command<{ myName: string }, string>
  ping: Command<void, void>
}

const mockRawInvoke = vi.mocked(rawInvoke)
const mockIsTauriEnvironment = vi.mocked(isTauriEnvironment)

beforeEach(() => {
  mockRawInvoke.mockReset()
  mockIsTauriEnvironment.mockReset()
  mockIsTauriEnvironment.mockReturnValue(true)
})

describe('client Proxy vs. the language (adversarial)', () => {
  it('is not mistaken for a thenable when it lands in a promise chain', async () => {
    mockRawInvoke.mockResolvedValue('should never happen')
    const api = createClient<AppCommands>()

    // `Promise.resolve(x)` — and `await x`, and returning x from an async
    // function — all probe `x.then`. A Proxy that answers every property with
    // an invoker would hand back a function here, and the runtime would call
    // it as a thenable: `invoke('then', resolve)`.
    const resolved = await Promise.resolve(api)

    expect(resolved).toBe(api)
    expect(mockRawInvoke).not.toHaveBeenCalled()
  })

  it('survives being awaited directly', async () => {
    mockRawInvoke.mockResolvedValue('should never happen')
    const api = createClient<AppCommands>()

    const awaited = await api
    expect(awaited).toBe(api)
    expect(mockRawInvoke).not.toHaveBeenCalled()
  })

  it('survives being returned from an async function', async () => {
    mockRawInvoke.mockResolvedValue('should never happen')
    const api = createClient<AppCommands>()

    const wrap = async () => api
    await expect(wrap()).resolves.toBe(api)
    expect(mockRawInvoke).not.toHaveBeenCalled()
  })

  it('still dispatches normally after all that', async () => {
    mockRawInvoke.mockResolvedValue('hi')
    const api = createClient<AppCommands>()

    await Promise.resolve(api)
    await expect(api.helloWorld({ myName: 'x' })).resolves.toBe('hi')
    expect(mockRawInvoke).toHaveBeenCalledWith('hello_world', { myName: 'x' })
  })

  it('does not invent commands for symbol-keyed access', async () => {
    const api = createClient<AppCommands>()

    expect(String(api)).toBeTypeOf('string')
    expect(mockRawInvoke).not.toHaveBeenCalled()
  })

  it('keeps a namespace object non-thenable too', async () => {
    mockRawInvoke.mockResolvedValue('should never happen')
    const api = createClient<AppCommands, { fs: 'fs_' }>({ namespaces: { fs: 'fs_' } })

    await expect(Promise.resolve(api.fs)).resolves.toBe(api.fs)
    expect(mockRawInvoke).not.toHaveBeenCalled()
  })
})

describe('specta adapter arity split (adversarial)', () => {
  it('does not mistake a real positional argument for CallOptions', async () => {
    const generated = vi.fn((a: string, b: string) => Promise.resolve(`${a}${b}`))
    const api = createSpectaClient({ concat: generated })

    await expect(api.concat('x', 'y')).resolves.toBe('xy')
    expect(generated).toHaveBeenCalledWith('x', 'y')
  })

  it('passes an object-shaped command argument through untouched', async () => {
    const generated = vi.fn((data: { a: number }) => Promise.resolve(data.a))
    const api = createSpectaClient({ update: generated })

    await expect(api.update({ a: 1 })).resolves.toBe(1)
    expect(generated).toHaveBeenCalledWith({ a: 1 })
  })

  it('an args object that happens to look like CallOptions is still treated as args', async () => {
    // `{ signal }` is a perfectly legal command payload. Because the split is
    // arity-driven rather than shape-driven, this stays unambiguous.
    const controller = new AbortController()
    const generated = vi.fn((data: { signal: string }) => Promise.resolve(data.signal))
    const api = createSpectaClient({ save: generated })

    await expect(api.save({ signal: 'red' })).resolves.toBe('red')
    expect(generated).toHaveBeenCalledWith({ signal: 'red' })
    expect(controller.signal.aborted).toBe(false)
  })

  it('a zero-arity command treats its only argument as CallOptions, never as args', async () => {
    const generated = vi.fn(() => Promise.resolve('pong'))
    const api = createSpectaClient({ ping: generated })

    await expect(api.ping({ timeoutMs: 5 })).resolves.toBe('pong')
    expect(generated).toHaveBeenCalledWith()
  })
})
