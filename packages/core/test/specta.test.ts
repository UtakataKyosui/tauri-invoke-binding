import { describe, expect, it } from 'vitest'
import { createClient } from '../src/specta.js'

type Result<T, E> = { status: 'ok'; data: T } | { status: 'error'; error: E }

function mockCommands() {
  return {
    helloWorld: (myName: string) => Promise.resolve(`hi ${myName}`),
    hasError: (): Promise<Result<string, number>> => Promise.resolve({ status: 'ok', data: 'ok' }),
    alwaysFails: (): Promise<Result<string, number>> =>
      Promise.resolve({ status: 'error', error: 42 }),
    throwsAnError: (): Promise<string> => Promise.reject(new TypeError('boom')),
    ping: () => Promise.resolve(null),
  }
}

describe('tauri-specta adapter createClient (issue #6)', () => {
  it('the flat call site is a thin pass-through to the generated function', async () => {
    const api = createClient(mockCommands())
    await expect(api.helloWorld('Tauri')).resolves.toBe('hi Tauri')
  })

  it('unwraps a Result-shaped resolved value into ok(data) on the safe path', async () => {
    const api = createClient(mockCommands())
    await expect(api.safe.hasError()).resolves.toEqual({ status: 'ok', data: 'ok' })
  })

  it('unwraps a Result-shaped error into { kind: "command", value } on the safe path', async () => {
    const api = createClient(mockCommands())
    await expect(api.safe.alwaysFails()).resolves.toEqual({
      status: 'error',
      error: { kind: 'command', value: 42 },
    })
  })

  it('treats a non-Result resolved value as ok(data) directly', async () => {
    const api = createClient(mockCommands())
    await expect(api.safe.helloWorld('Tauri')).resolves.toEqual({
      status: 'ok',
      data: 'hi Tauri',
    })
  })

  it('never throws — a rejected Error is classified, not re-thrown', async () => {
    const api = createClient(mockCommands())
    const result = await api.safe.throwsAnError()
    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.error.kind).not.toBe('command')
    }
  })

  it('the throwing flat call site still throws for a rejecting command', async () => {
    const api = createClient(mockCommands())
    await expect(api.throwsAnError()).rejects.toThrow('boom')
  })
})
