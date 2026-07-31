import { describe, expectTypeOf, it } from 'vitest'
import { type BuiltinEventMap, TauriEvent } from '../../src/events/builtin.js'
import { createEventClient } from '../../src/events/client.js'
import type { EventTarget } from '../../src/events/emit-to.js'

interface DemoEvent {
  count: number
}

type AppEvents = {
  myDemoEvent: DemoEvent
}

describe('createEventClient (issue #19 — typed emitTo + EventTarget)', () => {
  it("narrows emitTo's payload to the declared event type", () => {
    const events = createEventClient<AppEvents>()
    events.myDemoEvent.emitTo({ kind: 'WebviewWindow', label: 'main' }, { count: 1 })
    // @ts-expect-error - payload must be a DemoEvent, not a string
    events.myDemoEvent.emitTo({ kind: 'WebviewWindow', label: 'main' }, 'nope')
  })

  it('accepts the string shorthand for EventTarget', () => {
    const events = createEventClient<AppEvents>()
    events.myDemoEvent.emitTo('main', { count: 1 })
  })

  it('requires label on the four kinds that need it', () => {
    const target: EventTarget = { kind: 'AnyLabel', label: 'main' }
    expectTypeOf(target).toMatchTypeOf<EventTarget>()
    // @ts-expect-error - 'Window' requires a label
    const missingLabel: EventTarget = { kind: 'Window' }
    void missingLabel
  })

  it('rejects a label on the two kinds that forbid it', () => {
    // @ts-expect-error - 'App' does not take a label
    const target: EventTarget = { kind: 'App', label: 'main' }
    void target
  })
})

describe('createEventClient (issue #21 — BuiltinEventMap payloads)', () => {
  it('narrows the payload of a built-in TauriEvent through the generic on() accessor', () => {
    const events = createEventClient<BuiltinEventMap>()
    events.on(TauriEvent.WINDOW_RESIZED, (e) => {
      expectTypeOf(e.payload).toEqualTypeOf<{ width: number; height: number }>()
    })
    events.on(TauriEvent.WINDOW_THEME_CHANGED, (e) => {
      expectTypeOf(e.payload).toEqualTypeOf<'light' | 'dark'>()
    })
  })

  it('merges with an app-defined EventPayloadMap', () => {
    const events = createEventClient<BuiltinEventMap & AppEvents>()
    events.on(TauriEvent.WINDOW_MOVED, (e) => {
      expectTypeOf(e.payload).toEqualTypeOf<{ x: number; y: number }>()
    })
    events.myDemoEvent.emitTo('main', { count: 1 })
  })

  it('covers all 16 built-in TauriEvent keys', () => {
    expectTypeOf<BuiltinEventMap[TauriEvent.WINDOW_RESIZED]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.WINDOW_MOVED]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.WINDOW_CLOSE_REQUESTED]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.WINDOW_DESTROYED]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.WINDOW_FOCUS]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.WINDOW_BLUR]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.WINDOW_SCALE_FACTOR_CHANGED]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.WINDOW_THEME_CHANGED]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.WINDOW_CREATED]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.WINDOW_SUSPENDED]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.WINDOW_RESUMED]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.WEBVIEW_CREATED]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.DRAG_ENTER]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.DRAG_OVER]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.DRAG_DROP]>().not.toBeNever()
    expectTypeOf<BuiltinEventMap[TauriEvent.DRAG_LEAVE]>().not.toBeNever()
  })
})
