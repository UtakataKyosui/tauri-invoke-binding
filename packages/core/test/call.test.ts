import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/internal/tauri.js', () => ({
  rawInvoke: vi.fn(),
  isTauriEnvironment: vi.fn(),
}))

const { rawInvoke, isTauriEnvironment } = await import('../src/internal/tauri.js')
const { callCommand, callCommandSafe, NotInTauriError } = await import('../src/call.js')

const mockRawInvoke = vi.mocked(rawInvoke)
const mockIsTauriEnvironment = vi.mocked(isTauriEnvironment)

beforeEach(() => {
  mockRawInvoke.mockReset()
  mockIsTauriEnvironment.mockReset()
  mockIsTauriEnvironment.mockReturnValue(true)
})

describe('callCommand (throwing call site)', () => {
  it('forwards the command name and args to the underlying invoke', async () => {
    mockRawInvoke.mockResolvedValue('pong')
    const result = await callCommand('ping', { x: 1 })
    expect(result).toBe('pong')
    expect(mockRawInvoke).toHaveBeenCalledWith('ping', { x: 1 })
  })

  it('throws NotInTauriError when called outside a Tauri webview', async () => {
    mockIsTauriEnvironment.mockReturnValue(false)
    await expect(callCommand('ping', undefined)).rejects.toThrow(NotInTauriError)
    expect(mockRawInvoke).not.toHaveBeenCalled()
  })

  it('propagates whatever the underlying invoke rejects with, unmodified', async () => {
    const reason = { custom: 'error shape' }
    mockRawInvoke.mockRejectedValue(reason)
    await expect(callCommand('has_error', undefined)).rejects.toBe(reason)
  })
})

describe('callCommandSafe (issue #11 — never throws)', () => {
  it('resolves { status: "ok", data } on success', async () => {
    mockRawInvoke.mockResolvedValue('pong')
    await expect(callCommandSafe('ping', undefined)).resolves.toEqual({
      status: 'ok',
      data: 'pong',
    })
  })

  it('classifies not-in-tauri without ever calling the underlying invoke', async () => {
    mockIsTauriEnvironment.mockReturnValue(false)
    await expect(callCommandSafe('ping', undefined)).resolves.toEqual({
      status: 'error',
      error: { kind: 'not-in-tauri' },
    })
    expect(mockRawInvoke).not.toHaveBeenCalled()
  })

  it("classifies a plain non-Error, non-string rejection as the command's own Err(E)", async () => {
    mockRawInvoke.mockRejectedValue(42)
    await expect(callCommandSafe('has_error', undefined)).resolves.toEqual({
      status: 'error',
      error: { kind: 'command', value: 42 },
    })
  })

  it("classifies an object-shaped rejection as the command's own Err(E) too", async () => {
    const reason = { code: 'E_NOT_FOUND', path: '/tmp/x' }
    mockRawInvoke.mockRejectedValue(reason)
    await expect(callCommandSafe('read_file', undefined)).resolves.toEqual({
      status: 'error',
      error: { kind: 'command', value: reason },
    })
  })

  it('classifies an Error-instance rejection as a TransportError, not command', async () => {
    mockRawInvoke.mockRejectedValue(new TypeError('window.__TAURI_INTERNALS__ is undefined'))
    const result = await callCommandSafe('ping', undefined)
    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.error.kind).not.toBe('command')
      expect(result.error.kind).toBe('unknown')
    }
  })

  it('classifies a string rejection matching the confirmed InvalidArgs format as deserialization', async () => {
    const message = 'invalid args `myName` for command `hello_world`: type mismatch'
    mockRawInvoke.mockRejectedValue(message)
    await expect(callCommandSafe('hello_world', undefined)).resolves.toEqual({
      status: 'error',
      error: { kind: 'deserialization', command: 'hello_world', message },
    })
  })

  it.each([undefined, null, 0, false, '', [], {}])(
    'never throws regardless of what the underlying invoke rejects with: %p',
    async (reason) => {
      mockRawInvoke.mockRejectedValue(reason)
      await expect(callCommandSafe('cmd', undefined)).resolves.not.toThrow()
    },
  )
})
