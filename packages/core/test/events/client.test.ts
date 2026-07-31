import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/internal/tauri-events.js', () => ({
  rawListen: vi.fn(),
  rawOnce: vi.fn(),
  rawEmit: vi.fn(),
  rawEmitTo: vi.fn(),
}))

const { rawListen, rawOnce, rawEmit, rawEmitTo } = await import(
  '../../src/internal/tauri-events.js'
)
const { createEventClient } = await import('../../src/events/client.js')

const mockRawListen = vi.mocked(rawListen)
const mockRawOnce = vi.mocked(rawOnce)
const mockRawEmit = vi.mocked(rawEmit)
const mockRawEmitTo = vi.mocked(rawEmitTo)

interface DemoEvent {
  count: number
}

type AppEvents = {
  myDemoEvent: DemoEvent
}

beforeEach(() => {
  mockRawListen.mockReset()
  mockRawOnce.mockReset()
  mockRawEmit.mockReset()
  mockRawEmitTo.mockReset()
})

describe('createEventClient — per-event accessors (issue #19)', () => {
  it('derives the wire event name from the key by default', async () => {
    mockRawEmitTo.mockResolvedValue(undefined)
    const events = createEventClient<AppEvents>()

    await events.myDemoEvent.emitTo({ kind: 'WebviewWindow', label: 'main' }, { count: 1 })
    expect(mockRawEmitTo).toHaveBeenCalledWith(
      { kind: 'WebviewWindow', label: 'main' },
      'myDemoEvent',
      { count: 1 },
    )
  })

  it('accepts a string shorthand target', async () => {
    mockRawEmitTo.mockResolvedValue(undefined)
    const events = createEventClient<AppEvents>()

    await events.myDemoEvent.emitTo('main', { count: 1 })
    expect(mockRawEmitTo).toHaveBeenCalledWith('main', 'myDemoEvent', { count: 1 })
  })

  it('honors a name override for a key whose wire name differs', async () => {
    mockRawEmitTo.mockResolvedValue(undefined)
    const events = createEventClient<AppEvents>({ names: { myDemoEvent: 'my-demo-event' } })

    await events.myDemoEvent.emitTo('main', { count: 1 })
    expect(mockRawEmitTo).toHaveBeenCalledWith('main', 'my-demo-event', { count: 1 })
  })

  it('emit() calls the underlying emit with the wire name', async () => {
    mockRawEmit.mockResolvedValue(undefined)
    const events = createEventClient<AppEvents>()

    await events.myDemoEvent.emit({ count: 1 })
    expect(mockRawEmit).toHaveBeenCalledWith('myDemoEvent', { count: 1 })
  })

  it('listen()/once() delegate through the signal-aware listen/once', async () => {
    const unlisten = vi.fn()
    mockRawListen.mockResolvedValue(unlisten)
    mockRawOnce.mockResolvedValue(unlisten)
    const events = createEventClient<AppEvents>()

    const handler = vi.fn()
    await events.myDemoEvent.listen(handler)
    expect(mockRawListen).toHaveBeenCalledWith('myDemoEvent', handler, {})

    await events.myDemoEvent.once(handler)
    expect(mockRawOnce).toHaveBeenCalledWith('myDemoEvent', handler, {})
  })

  it('caches the per-event accessor object across accesses', () => {
    const events = createEventClient<AppEvents>()
    expect(events.myDemoEvent).toBe(events.myDemoEvent)
  })
})

describe('createEventClient — generic on/once/emit/emitTo (issue #21)', () => {
  it('on() listens by event key', async () => {
    const unlisten = vi.fn()
    mockRawListen.mockResolvedValue(unlisten)
    const events = createEventClient<AppEvents>()

    const handler = vi.fn()
    await events.on('myDemoEvent', handler)
    expect(mockRawListen).toHaveBeenCalledWith('myDemoEvent', handler, {})
  })

  it('emitTo() emits by event key', async () => {
    mockRawEmitTo.mockResolvedValue(undefined)
    const events = createEventClient<AppEvents>()

    await events.emitTo('myDemoEvent', 'main', { count: 1 })
    expect(mockRawEmitTo).toHaveBeenCalledWith('main', 'myDemoEvent', { count: 1 })
  })

  it('respects a name override in the generic accessors too', async () => {
    mockRawEmit.mockResolvedValue(undefined)
    const events = createEventClient<AppEvents>({ names: { myDemoEvent: 'my-demo-event' } })

    await events.emit('myDemoEvent', { count: 1 })
    expect(mockRawEmit).toHaveBeenCalledWith('my-demo-event', { count: 1 })
  })
})
