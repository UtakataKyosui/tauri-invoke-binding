import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/internal/tauri.js', () => ({
  rawInvoke: vi.fn(),
  isTauriEnvironment: vi.fn(),
}))

const { rawInvoke, isTauriEnvironment } = await import('../src/internal/tauri.js')
const { callCommand, callCommandSafe } = await import('../src/call.js')
const { AbortError } = await import('../src/internal/errors.js')

const mockRawInvoke = vi.mocked(rawInvoke)
const mockIsTauriEnvironment = vi.mocked(isTauriEnvironment)

beforeEach(() => {
  mockRawInvoke.mockReset()
  mockIsTauriEnvironment.mockReset()
  mockIsTauriEnvironment.mockReturnValue(true)
})

describe('AbortSignal cancellation (issue #16)', () => {
  it('aborts immediately, without calling invoke, when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    mockRawInvoke.mockResolvedValue('never seen')

    await expect(
      callCommand('cmd', undefined, undefined, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AbortError)
    expect(mockRawInvoke).not.toHaveBeenCalled()
  })

  it('rejects with AbortError once the signal fires mid-flight, discarding a later resolution', async () => {
    const controller = new AbortController()
    let resolveInvoke: (value: string) => void = () => {}
    mockRawInvoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve
        }),
    )

    const promise = callCommand('cmd', undefined, undefined, { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(AbortError)

    // The underlying invoke eventually resolves — this must not throw an
    // unhandled rejection or otherwise resurface.
    expect(() => resolveInvoke('too late')).not.toThrow()
  })

  it('the .safe call site reports an abort as { kind: "aborted" }', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      callCommandSafe('cmd', undefined, undefined, { signal: controller.signal }),
    ).resolves.toEqual({ status: 'error', error: { kind: 'aborted' } })
    expect(mockRawInvoke).not.toHaveBeenCalled()
  })

  it('a call without a signal is unaffected', async () => {
    mockRawInvoke.mockResolvedValue('ok')
    await expect(callCommand('cmd', undefined)).resolves.toBe('ok')
  })
})
