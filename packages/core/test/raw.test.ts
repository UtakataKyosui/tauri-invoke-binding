import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawCommand } from '../src/raw.js'

vi.mock('../src/internal/tauri.js', () => ({
  rawInvokeRequest: vi.fn(),
  isTauriEnvironment: vi.fn(),
}))

const { rawInvokeRequest, isTauriEnvironment } = await import('../src/internal/tauri.js')
const { NotInTauriError } = await import('../src/internal/errors.js')
const { callRaw, callRawSafe, createRawClient } = await import('../src/raw.js')

const mockRawInvokeRequest = vi.mocked(rawInvokeRequest)
const mockIsTauriEnvironment = vi.mocked(isTauriEnvironment)

beforeEach(() => {
  mockRawInvokeRequest.mockReset()
  mockIsTauriEnvironment.mockReset()
  mockIsTauriEnvironment.mockReturnValue(true)
})

describe('callRaw (issue #24 — typed ipc::Request)', () => {
  it('forwards the raw body and headers to the underlying transport', async () => {
    mockRawInvokeRequest.mockResolvedValue(undefined)
    const body = new Uint8Array([1, 2, 3])
    await callRaw('upload', body, undefined, { headers: { Authorization: 'key' } })
    expect(mockRawInvokeRequest).toHaveBeenCalledWith('upload', body, { Authorization: 'key' })
  })

  it('throws NotInTauriError outside a Tauri webview', async () => {
    mockIsTauriEnvironment.mockReturnValue(false)
    await expect(callRaw('upload', new Uint8Array([1]))).rejects.toThrow(NotInTauriError)
    expect(mockRawInvokeRequest).not.toHaveBeenCalled()
  })

  it('propagates whatever the underlying transport rejects with', async () => {
    const reason = { custom: 'error shape' }
    mockRawInvokeRequest.mockRejectedValue(reason)
    await expect(callRaw('upload', new Uint8Array([1]))).rejects.toBe(reason)
  })
})

describe('callRawSafe (never throws)', () => {
  it('resolves ok(data) on success', async () => {
    mockRawInvokeRequest.mockResolvedValue('done')
    await expect(callRawSafe('upload', new Uint8Array([1]))).resolves.toEqual({
      status: 'ok',
      data: 'done',
    })
  })

  it('classifies not-in-tauri without ever calling the underlying transport', async () => {
    mockIsTauriEnvironment.mockReturnValue(false)
    await expect(callRawSafe('upload', new Uint8Array([1]))).resolves.toEqual({
      status: 'error',
      error: { kind: 'not-in-tauri' },
    })
    expect(mockRawInvokeRequest).not.toHaveBeenCalled()
  })
})

type AppRawCommands = {
  upload_file: RawCommand<string, number>
}

describe('createRawClient', () => {
  it('derives the wire command name from the camelCase accessor and forwards the body', async () => {
    mockRawInvokeRequest.mockResolvedValue('ok')
    const api = createRawClient<AppRawCommands>()
    const result = await api.uploadFile(new Uint8Array([9]), { headers: { 'X-Test': '1' } })
    expect(result).toBe('ok')
    expect(mockRawInvokeRequest).toHaveBeenCalledWith('upload_file', new Uint8Array([9]), {
      'X-Test': '1',
    })
  })

  it('exposes api.safe.* as a never-throws call site', async () => {
    mockRawInvokeRequest.mockRejectedValue(new Error('fail'))
    const api = createRawClient<AppRawCommands>()
    const result = await api.safe.uploadFile(new Uint8Array([1]))
    expect(result.status).toBe('error')
  })
})
