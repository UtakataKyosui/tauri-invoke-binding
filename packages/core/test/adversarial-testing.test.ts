/**
 * Adversarial suite for the L7 mock client (issue #26). Targets the same
 * classes of bug the L5 channel review found: concurrent calls, cancellation,
 * and edge-case payload shapes that could be misclassified.
 */
import { describe, expect, it } from 'vitest'
import type { Command } from '../src/command.js'
import { createMockClient, mockTransportError } from '../src/testing.js'

type AppCommands = {
  hello_world: Command<{ myName: string }, string>
  has_error: Command<void, string, number>
  ping: Command<void, void>
}

describe('AbortSignal (adversarial)', () => {
  it('an already-aborted signal rejects without ever calling the handler', async () => {
    let called = false
    const api = createMockClient<AppCommands>({
      ping: () => {
        called = true
      },
    })
    const ac = new AbortController()
    ac.abort()
    await expect(api.ping(undefined, { signal: ac.signal })).rejects.toThrow(/aborted/i)
    expect(called).toBe(false)
    // An aborted-before-dispatch call is never recorded — it never happened.
    expect(api.__mock.calls).toEqual([])
  })

  it('aborting while a slow async handler is in flight rejects and is classified as aborted', async () => {
    const api = createMockClient<AppCommands>({
      ping: () => new Promise((resolve) => setTimeout(resolve, 50)),
    })
    const ac = new AbortController()
    const call = api.safe.ping(undefined, { signal: ac.signal })
    ac.abort()
    const result = await call
    expect(result).toEqual({ status: 'error', error: { kind: 'aborted' } })
  })
})

describe('concurrent calls do not cross-contaminate (adversarial)', () => {
  it('two in-flight calls to different commands resolve independently', async () => {
    const api = createMockClient<AppCommands>({
      hello_world: ({ myName }) => new Promise((r) => setTimeout(() => r(`hi ${myName}`), 20)),
      has_error: () => new Promise((r) => setTimeout(() => r({ status: 'error', error: 7 }), 5)),
    })
    const [a, b] = await Promise.allSettled([api.helloWorld({ myName: 'x' }), api.hasError()])
    expect(a).toEqual({ status: 'fulfilled', value: 'hi x' })
    expect(b).toMatchObject({ status: 'rejected' })
  })

  it('call history preserves arrival order under concurrent dispatch, not settlement order', async () => {
    const api = createMockClient<AppCommands>({
      hello_world: ({ myName }) =>
        new Promise((r) => setTimeout(() => r(`hi ${myName}`), myName === 'slow' ? 30 : 1)),
    })
    const p1 = api.helloWorld({ myName: 'slow' })
    const p2 = api.helloWorld({ myName: 'fast' })
    await Promise.all([p1, p2])
    // 'slow' was dispatched first even though 'fast' settles first.
    expect(api.__mock.calls.map((c) => c.args)).toEqual([{ myName: 'slow' }, { myName: 'fast' }])
  })

  it('setHandlers mid-flight does not affect an already-dispatched call', async () => {
    const api = createMockClient<AppCommands>({
      hello_world: () => new Promise((r) => setTimeout(() => r('original'), 20)),
    })
    const inFlight = api.helloWorld({ myName: 'x' })
    api.__mock.setHandlers({ hello_world: () => 'replaced' })
    await expect(inFlight).resolves.toBe('original')
    await expect(api.helloWorld({ myName: 'x' })).resolves.toBe('replaced')
  })
})

describe('MockErrorResult vs. genuinely error-shaped Ok payloads (adversarial)', () => {
  it("a command whose real Ok type happens to look like { status: 'error', error } is a known, documented ambiguity — verify it resolves the documented way", async () => {
    type Ambiguous = { status: 'error'; error: number }
    const api = createMockClient<{ weird: Command<void, Ambiguous> }>({
      // The handler wants to return this as a *successful* Ok payload, but
      // since it structurally matches MockErrorResult, the mock cannot tell
      // the difference — it is treated as a declared Err by design.
      weird: () => ({ status: 'error', error: 1 }),
    })
    const result = await api.safe.weird()
    expect(result).toEqual({ status: 'error', error: { kind: 'command', value: 1 } })
  })

  it('a null or primitive Ok value is never mistaken for MockErrorResult', async () => {
    const api = createMockClient<{ ping: Command<void, null> }>({ ping: () => null })
    await expect(api.safe.ping()).resolves.toEqual({ status: 'ok', data: null })
  })
})

describe('reserved keys are not reachable as commands (adversarial)', () => {
  it('a "safe" or "__mock" accessor always resolves to the reserved surface, never an invoker', async () => {
    const api = createMockClient<AppCommands>({})
    expect(typeof api.safe).toBe('object')
    expect(typeof api.__mock).toBe('object')
    expect(api.__mock.calls).toEqual([])
  })
})

describe('mockTransportError propagation through the throwing site (adversarial)', () => {
  it('the thrown value carries the injected TransportError for assertions', async () => {
    const api = createMockClient<AppCommands>({
      ping: () => mockTransportError({ kind: 'panic', message: 'rust panicked' }),
    })
    try {
      await api.ping()
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect((e as Error).message).toContain('panic')
    }
  })
})
