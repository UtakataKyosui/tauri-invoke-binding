/**
 * Event support (issues #19–#21, roadmap L4): `emitTo`, the 6-way
 * `EventTarget` union, `AbortSignal`-based unlisten, an event scope for bulk
 * unlisten, and typed payloads for the 16 built-in `TauriEvent`s. Kept as
 * its own subpath (`tauri-invoke-binding/events`) rather than folded into
 * the main entry point, the same way `tauri-invoke-binding/specta` is kept
 * separate — most consumers of the command-calling API don't need the event
 * API in the same import, and vice versa.
 *
 * @packageDocumentation
 */

export type {
  BuiltinEventMap,
  DragDropPayload,
  DragEnterPayload,
  DragOverPayload,
  PhysicalPositionPayload,
  PhysicalSizePayload,
  ScaleFactorChangedPayload,
  ThemePayload,
} from './events/builtin.js'
export { TauriEvent } from './events/builtin.js'
export type {
  CreateEventClientOptions,
  EventClient,
  EventClientReserved,
  EventPayloadMap,
  TypedEvent,
} from './events/client.js'
export { createEventClient } from './events/client.js'
export type { EventTarget } from './events/emit-to.js'
export { emitTo } from './events/emit-to.js'
export type { EventScope, ListenOptions } from './events/listen.js'
export { createEventScope, listen, once } from './events/listen.js'
