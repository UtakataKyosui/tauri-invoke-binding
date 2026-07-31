/**
 * Payload types for the 16 built-in `TauriEvent`s (issue #21).
 *
 * Every entry below is grounded in `@tauri-apps/api`'s own source
 * (`node_modules/@tauri-apps/api/window.js`, v2.11.1 — the version this
 * package develops against, see package.json), not guessed: each comment
 * cites the exact wrapper method whose implementation reads (or explicitly
 * ignores) the raw event payload for that wire name. Where no wrapper in
 * `@tauri-apps/api` ever reads a payload for an event, that event's Rust
 * side is a unit variant / has no dedicated payload, and the type here is
 * `null`.
 *
 * These are the *raw wire* payload shapes — i.e. what `event.payload` is
 * before `@tauri-apps/api`'s own higher-level wrappers (`onResized`,
 * `onDragDropEvent`, ...) re-wrap plain objects into classes like
 * `PhysicalSize`. Listening to `TauriEvent.WINDOW_RESIZED` directly (as
 * `BuiltinEventMap` types it) gets you the plain `{ width, height }` object,
 * the same as any other typed event through this package's event client —
 * not a `PhysicalSize` instance.
 */
import { TauriEvent } from '@tauri-apps/api/event'

export { TauriEvent }

export interface PhysicalSizePayload {
  width: number
  height: number
}

export interface PhysicalPositionPayload {
  x: number
  y: number
}

export interface ScaleFactorChangedPayload {
  scaleFactor: number
  size: PhysicalSizePayload
}

export type ThemePayload = 'light' | 'dark'

export interface DragEnterPayload {
  paths: string[]
  position: PhysicalPositionPayload
}

export interface DragOverPayload {
  position: PhysicalPositionPayload
}

export interface DragDropPayload {
  paths: string[]
  position: PhysicalPositionPayload
}

export type BuiltinEventMap = {
  // window.js `onResized`: `e.payload = new PhysicalSize(e.payload)` — the
  // raw payload is `PhysicalSize`'s plain-object constructor shape.
  [TauriEvent.WINDOW_RESIZED]: PhysicalSizePayload
  // window.js `onMoved`: `e.payload = new PhysicalPosition(e.payload)`.
  [TauriEvent.WINDOW_MOVED]: PhysicalPositionPayload
  // window.js `onCloseRequested` builds `CloseRequestedEvent` from `.event`
  // and `.id` only (window.d.ts: `constructor(event: Event<unknown>)`) —
  // the raw payload is never read.
  [TauriEvent.WINDOW_CLOSE_REQUESTED]: null
  // docs.rs `tauri::WindowEvent::Destroyed` carries no data, and no
  // `@tauri-apps/api` wrapper reads a payload for this wire event either.
  [TauriEvent.WINDOW_DESTROYED]: null
  // window.js `onFocusChanged`: `this.listen(TauriEvent.WINDOW_FOCUS, (event) =>
  // handler({ ...event, payload: true }))` — the raw payload is discarded
  // and replaced with a hardcoded boolean.
  [TauriEvent.WINDOW_FOCUS]: null
  // Same as WINDOW_FOCUS, mirrored for `WINDOW_BLUR` with `payload: false`.
  [TauriEvent.WINDOW_BLUR]: null
  // window.js `onScaleChanged`: `return this.listen(TauriEvent.WINDOW_SCALE_FACTOR_CHANGED,
  // handler)` — passed straight through, typed as `ScaleFactorChanged` in window.d.ts.
  [TauriEvent.WINDOW_SCALE_FACTOR_CHANGED]: ScaleFactorChangedPayload
  // window.js `onThemeChanged`: passed straight through, typed as `Theme`
  // (`'light' | 'dark'`) in window.d.ts.
  [TauriEvent.WINDOW_THEME_CHANGED]: ThemePayload
  // Internal window-lifecycle notification; no `@tauri-apps/api` wrapper
  // reads a payload for it (distinct from the local, unprefixed
  // `tauri://created` event webview.js/window.js emit after setup, which
  // also carries no payload).
  [TauriEvent.WINDOW_CREATED]: null
  // App-level lifecycle event (mirrors `tauri::RunEvent::Suspended`), no
  // payload; not read by any `@tauri-apps/api` wrapper.
  [TauriEvent.WINDOW_SUSPENDED]: null
  // Mirrors `tauri::RunEvent::Resumed`; same as WINDOW_SUSPENDED.
  [TauriEvent.WINDOW_RESUMED]: null
  // Internal webview-lifecycle notification; same as WINDOW_CREATED.
  [TauriEvent.WEBVIEW_CREATED]: null
  // window.js `onDragDropEvent`'s `unlistenDrag`: `payload: { type: 'enter',
  // paths: event.payload.paths, position: new PhysicalPosition(event.payload.position) }`.
  [TauriEvent.DRAG_ENTER]: DragEnterPayload
  // Same handler's `unlistenDragOver`: only `event.payload.position` is read.
  [TauriEvent.DRAG_OVER]: DragOverPayload
  // Same handler's `unlistenDrop`: `event.payload.paths` and `.position`, like DRAG_ENTER.
  [TauriEvent.DRAG_DROP]: DragDropPayload
  // Same handler's `unlistenCancel`: `payload: { type: 'leave' }` — built
  // without reading `event.payload` at all.
  [TauriEvent.DRAG_LEAVE]: null
}
