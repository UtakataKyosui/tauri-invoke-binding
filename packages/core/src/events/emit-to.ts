/**
 * Typed `emitTo` (issue #19). `@tauri-apps/api/event` already types
 * `EventTarget` as the 6-way discriminated union described in the issue —
 * `label` is required on `'AnyLabel' | 'Window' | 'Webview' | 'WebviewWindow'`
 * and absent on `'Any' | 'App'` — and already accepts a bare string as
 * shorthand for `{ kind: 'AnyLabel', label: <string> }`. Re-exported here
 * unchanged so callers of this package's event APIs don't need a second
 * import from `@tauri-apps/api/event` alongside it.
 */
import type { EventTarget } from '@tauri-apps/api/event'
import { rawEmitTo } from '../internal/tauri-events.js'

export type { EventTarget }

export async function emitTo<T>(
  target: EventTarget | string,
  event: string,
  payload?: T,
): Promise<void> {
  return rawEmitTo(target, event, payload)
}
