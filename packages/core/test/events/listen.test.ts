import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/internal/tauri-events.js', () => ({
  rawListen: vi.fn(),
  rawOnce: vi.fn(),
  rawEmit: vi.fn(),
  rawEmitTo: vi.fn(),
}))

const { rawListen, rawOnce } = await import('../../src/internal/tauri-events.js')
const { listen, once, createEventScope } = await import('../../src/events/listen.js')

const mockRawListen = vi.mocked(rawListen)
const mockRawOnce = vi.mocked(rawOnce)

beforeEach(() => {
  mockRawListen.mockReset()
  mockRawOnce.mockReset()
})

describe('listen (issue #20 — AbortSignal-based unlisten)', () => {
  it('forwards to the underlying listen and returns its unlisten fn when there is no signal', async () => {
    const realUnlisten = vi.fn()
    mockRawListen.mockResolvedValue(realUnlisten)
    const handler = vi.fn()

    const unlisten = await listen('foo', handler)
    expect(mockRawListen).toHaveBeenCalledWith('foo', handler, {})

    unlisten()
    expect(realUnlisten).toHaveBeenCalledOnce()
  })

  it('never registers a listener when the signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()

    const unlisten = await listen('foo', vi.fn(), { signal: ac.signal })
    expect(mockRawListen).not.toHaveBeenCalled()
    expect(() => unlisten()).not.toThrow()
  })

  it('unlistens when the signal aborts after registration completes', async () => {
    const realUnlisten = vi.fn()
    mockRawListen.mockResolvedValue(realUnlisten)
    const ac = new AbortController()

    await listen('foo', vi.fn(), { signal: ac.signal })
    expect(realUnlisten).not.toHaveBeenCalled()

    ac.abort()
    expect(realUnlisten).toHaveBeenCalledOnce()
  })

  it('does not double-unlisten when the caller unlistens manually after an abort', async () => {
    const realUnlisten = vi.fn()
    mockRawListen.mockResolvedValue(realUnlisten)
    const ac = new AbortController()

    const unlisten = await listen('foo', vi.fn(), { signal: ac.signal })
    ac.abort()
    unlisten()

    expect(realUnlisten).toHaveBeenCalledOnce()
  })

  it('does not leak a listener when the signal aborts mid-registration (race)', async () => {
    const realUnlisten = vi.fn()
    let resolveRegister: (fn: () => void) => void = () => {}
    mockRawListen.mockReturnValue(
      new Promise((resolve) => {
        resolveRegister = resolve
      }),
    )
    const ac = new AbortController()

    const listenPromise = listen('foo', vi.fn(), { signal: ac.signal })
    // Abort fires while `register` is still pending.
    ac.abort()
    expect(realUnlisten).not.toHaveBeenCalled()

    // Registration now resolves, after the abort already happened.
    resolveRegister(realUnlisten)
    const unlisten = await listenPromise

    expect(realUnlisten).toHaveBeenCalledOnce()
    expect(() => unlisten()).not.toThrow()
    expect(realUnlisten).toHaveBeenCalledOnce()
  })

  it('strips signal out of the options forwarded to the underlying listen', async () => {
    mockRawListen.mockResolvedValue(vi.fn())
    const ac = new AbortController()

    await listen('foo', vi.fn(), { signal: ac.signal, target: 'main' })
    expect(mockRawListen).toHaveBeenCalledWith('foo', expect.any(Function), { target: 'main' })
  })
})

describe('once (issue #20)', () => {
  it('delegates to the underlying once, with the same signal handling as listen', async () => {
    const realUnlisten = vi.fn()
    mockRawOnce.mockResolvedValue(realUnlisten)
    const ac = new AbortController()

    const unlisten = await once('foo', vi.fn(), { signal: ac.signal })
    expect(mockRawOnce).toHaveBeenCalledWith('foo', expect.any(Function), {})
    unlisten()
    expect(realUnlisten).toHaveBeenCalledOnce()
  })
})

describe('createEventScope (issue #20 — bulk unlisten)', () => {
  it('unlistens every listener registered through the scope on dispose()', async () => {
    const unlistenA = vi.fn()
    const unlistenB = vi.fn()
    mockRawListen.mockResolvedValueOnce(unlistenA).mockResolvedValueOnce(unlistenB)

    const scope = createEventScope()
    scope.listen('a', vi.fn())
    scope.listen('b', vi.fn())
    // Let the fire-and-forget registration promises settle.
    await Promise.resolve()
    await Promise.resolve()

    scope.dispose()
    await Promise.resolve()

    expect(unlistenA).toHaveBeenCalledOnce()
    expect(unlistenB).toHaveBeenCalledOnce()
  })

  it('exposes its signal so it can be composed with other signal-aware APIs', () => {
    const scope = createEventScope()
    expect(scope.signal).toBeInstanceOf(AbortSignal)
    expect(scope.signal.aborted).toBe(false)
    scope.dispose()
    expect(scope.signal.aborted).toBe(true)
  })
})
