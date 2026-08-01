import { describe, expect, it } from 'vitest'
import type { Command } from '../src/command.js'
import { createMockClient, MockTransportError, mockTransportError } from '../src/testing.js'

type AppCommands = {
  hello_world: Command<{ myName: string }, string>
  has_error: Command<void, string, number>
  ping: Command<void, void>
}

describe('createMockClient — throwing call site (issue #26)', () => {
  it('dispatches to the handler keyed by the wire (snake_case) command name', async () => {
    const api = createMockClient<AppCommands>({
      hello_world: ({ myName }) => `hi ${myName}`,
    })
    await expect(api.helloWorld({ myName: 'Tauri' })).resolves.toBe('hi Tauri')
  })

  it('supports an async handler', async () => {
    const api = createMockClient<AppCommands>({
      hello_world: async ({ myName }) => `async hi ${myName}`,
    })
    await expect(api.helloWorld({ myName: 'x' })).resolves.toBe('async hi x')
  })

  it('a handler returning { status: "error", error } throws the raw error value', async () => {
    const api = createMockClient<AppCommands>({
      has_error: () => ({ status: 'error', error: 42 }),
    })
    await expect(api.hasError()).rejects.toBe(42)
  })

  it('an unregistered command throws a descriptive error by default', async () => {
    const api = createMockClient<AppCommands>({})
    await expect(api.ping()).rejects.toThrow(/no mock handler registered for command "ping"/)
  })

  it('unknownCommand: "command-not-found" throws a MockTransportError instead', async () => {
    const api = createMockClient<AppCommands>({}, { unknownCommand: 'command-not-found' })
    await expect(api.ping()).rejects.toBeInstanceOf(MockTransportError)
  })

  it('mockTransportError() thrown from a handler propagates as a MockTransportError', async () => {
    const api = createMockClient<AppCommands>({
      ping: () => mockTransportError({ kind: 'timeout', command: 'ping', ms: 10 }),
    })
    const rejection = await api.ping().catch((e: unknown) => e)
    expect(rejection).toBeInstanceOf(MockTransportError)
    expect((rejection as MockTransportError).transportError).toEqual({
      kind: 'timeout',
      command: 'ping',
      ms: 10,
    })
  })
})

describe('createMockClient — safe call site (issue #26)', () => {
  it('resolves ok(data) on success', async () => {
    const api = createMockClient<AppCommands>({
      hello_world: ({ myName }) => `hi ${myName}`,
    })
    await expect(api.safe.helloWorld({ myName: 'x' })).resolves.toEqual({
      status: 'ok',
      data: 'hi x',
    })
  })

  it('classifies a declared Err as { kind: "command", value }, never as a TransportError', async () => {
    const api = createMockClient<AppCommands>({
      has_error: () => ({ status: 'error', error: 42 }),
    })
    await expect(api.safe.hasError()).resolves.toEqual({
      status: 'error',
      error: { kind: 'command', value: 42 },
    })
  })

  it("a declared Err that happens to be a string is NOT reclassified as a heuristic TransportError kind — the mock's certainty overrides the heuristic", async () => {
    // Real IPC would run this string through classifyRejection and could
    // mistake it for e.g. deserialization. The mock knows for a fact this is
    // the command's own Err, so it must bypass that heuristic entirely.
    const api = createMockClient<AppCommands & { has_string_error: Command<void, string, string> }>(
      {
        has_string_error: () => ({
          status: 'error',
          error: 'invalid args `x` for command `y`: bad',
        }),
      },
    )
    await expect(api.safe.hasStringError()).resolves.toEqual({
      status: 'error',
      error: { kind: 'command', value: 'invalid args `x` for command `y`: bad' },
    })
  })

  it('injects every TransportError kind on demand', async () => {
    const kinds: Array<[string, () => never]> = [
      [
        'deserialization',
        () => mockTransportError({ kind: 'deserialization', command: 'ping', message: 'x' }),
      ],
      [
        'command-not-found',
        () => mockTransportError({ kind: 'command-not-found', command: 'ping' }),
      ],
      ['permission-denied', () => mockTransportError({ kind: 'permission-denied', message: 'x' })],
      ['panic', () => mockTransportError({ kind: 'panic', message: 'x' })],
      ['aborted', () => mockTransportError({ kind: 'aborted' })],
      ['timeout', () => mockTransportError({ kind: 'timeout', command: 'ping', ms: 1 })],
      ['not-in-tauri', () => mockTransportError({ kind: 'not-in-tauri' })],
      ['unknown', () => mockTransportError({ kind: 'unknown', cause: 'x' })],
    ]
    for (const [kind, throwIt] of kinds) {
      const api = createMockClient<AppCommands>({ ping: throwIt })
      const result = await api.safe.ping()
      expect(result.status).toBe('error')
      if (result.status === 'error') expect(result.error.kind).toBe(kind)
    }
  })

  it('classifies unknownCommand: "command-not-found" the same way an injected one is classified', async () => {
    const api = createMockClient<AppCommands>({}, { unknownCommand: 'command-not-found' })
    await expect(api.safe.ping()).resolves.toEqual({
      status: 'error',
      error: { kind: 'command-not-found', command: 'ping' },
    })
  })

  it('a handler that throws a plain Error falls back to the ordinary classifier, not "command"', async () => {
    const api = createMockClient<AppCommands>({
      ping: () => {
        throw new TypeError('boom')
      },
    })
    const result = await api.safe.ping()
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.error.kind).not.toBe('command')
  })
})

describe('call history (issue #26)', () => {
  it('records every call in order, throwing and safe alike', async () => {
    const api = createMockClient<AppCommands>({
      hello_world: ({ myName }) => `hi ${myName}`,
      ping: () => undefined,
    })
    await api.helloWorld({ myName: 'a' })
    await api.safe.ping()
    expect(api.__mock.calls).toEqual([
      { command: 'hello_world', args: { myName: 'a' } },
      { command: 'ping', args: undefined },
    ])
  })

  it('callsFor filters by wire command name', async () => {
    const api = createMockClient<AppCommands>({
      hello_world: ({ myName }) => `hi ${myName}`,
      ping: () => undefined,
    })
    await api.helloWorld({ myName: 'a' })
    await api.ping()
    await api.helloWorld({ myName: 'b' })
    expect(api.__mock.callsFor('hello_world')).toHaveLength(2)
    expect(api.__mock.callsFor('ping')).toHaveLength(1)
  })

  it('reset() clears history without touching handlers', async () => {
    const api = createMockClient<AppCommands>({ ping: () => undefined })
    await api.ping()
    api.__mock.reset()
    expect(api.__mock.calls).toEqual([])
    await expect(api.ping()).resolves.toBeUndefined()
  })

  it('records a call that later throws (an unregistered command)', async () => {
    const api = createMockClient<AppCommands>({})
    await api.ping().catch(() => undefined)
    expect(api.__mock.calls).toEqual([{ command: 'ping', args: undefined }])
  })
})

describe('setHandlers (issue #26)', () => {
  it('adds a handler after construction', async () => {
    const api = createMockClient<AppCommands>({})
    api.__mock.setHandlers({ ping: () => undefined })
    await expect(api.ping()).resolves.toBeUndefined()
  })

  it('overrides a previously registered handler', async () => {
    const api = createMockClient<AppCommands>({ hello_world: () => 'first' })
    api.__mock.setHandlers({ hello_world: () => 'second' })
    await expect(api.helloWorld({ myName: 'x' })).resolves.toBe('second')
  })

  it('leaves other handlers untouched', async () => {
    const api = createMockClient<AppCommands>({
      hello_world: ({ myName }) => `hi ${myName}`,
      ping: () => undefined,
    })
    api.__mock.setHandlers({ ping: () => undefined })
    await expect(api.helloWorld({ myName: 'x' })).resolves.toBe('hi x')
  })
})

describe('no Tauri webview required (issue #26 completion condition)', () => {
  it('works with no window.__TAURI_INTERNALS__ at all', async () => {
    const hasTauriInternals =
      typeof window !== 'undefined' &&
      Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
    expect(hasTauriInternals).toBe(false)
    const api = createMockClient<AppCommands>({ hello_world: ({ myName }) => `hi ${myName}` })
    await expect(api.helloWorld({ myName: 'vitest' })).resolves.toBe('hi vitest')
  })
})
