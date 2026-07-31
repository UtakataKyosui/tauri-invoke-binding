import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/internal/tauri-events.js', () => ({
  rawListen: vi.fn(),
  rawOnce: vi.fn(),
  rawEmit: vi.fn(),
  rawEmitTo: vi.fn(),
}))

const { rawEmitTo } = await import('../../src/internal/tauri-events.js')
const { emitTo } = await import('../../src/events/emit-to.js')

const mockRawEmitTo = vi.mocked(rawEmitTo)

beforeEach(() => {
  mockRawEmitTo.mockReset()
})

describe('emitTo (issue #19)', () => {
  it('accepts a string shorthand target', async () => {
    mockRawEmitTo.mockResolvedValue(undefined)
    await emitTo('main', 'frontend-loaded', { loggedIn: true })
    expect(mockRawEmitTo).toHaveBeenCalledWith('main', 'frontend-loaded', { loggedIn: true })
  })

  it('accepts a full EventTarget object', async () => {
    mockRawEmitTo.mockResolvedValue(undefined)
    const target = { kind: 'WebviewWindow' as const, label: 'main' }
    await emitTo(target, 'frontend-loaded', { loggedIn: true })
    expect(mockRawEmitTo).toHaveBeenCalledWith(target, 'frontend-loaded', { loggedIn: true })
  })

  it('propagates rejection from the underlying emitTo', async () => {
    const reason = new Error('boom')
    mockRawEmitTo.mockRejectedValue(reason)
    await expect(emitTo('main', 'frontend-loaded', {})).rejects.toBe(reason)
  })
})
