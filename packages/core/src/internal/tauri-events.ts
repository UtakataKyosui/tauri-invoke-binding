/**
 * The one place this package touches `@tauri-apps/api/event` directly —
 * mirrors internal/tauri.ts's role for `@tauri-apps/api/core`. Kept separate
 * from that module (rather than folded in) because the two wrap different
 * `@tauri-apps/api` entry points; keeping a single call site per wrapped
 * export still lets runtime tests mock exactly this module (see
 * test/events/*.test.ts) without reaching into `@tauri-apps/api` internals.
 */

import type {
  EventCallback,
  EventName,
  EventTarget,
  Options,
  UnlistenFn,
} from '@tauri-apps/api/event'
import { emit, emitTo, listen, once } from '@tauri-apps/api/event'

export async function rawListen<T>(
  event: EventName,
  handler: EventCallback<T>,
  options?: Options,
): Promise<UnlistenFn> {
  return listen<T>(event, handler, options)
}

export async function rawOnce<T>(
  event: EventName,
  handler: EventCallback<T>,
  options?: Options,
): Promise<UnlistenFn> {
  return once<T>(event, handler, options)
}

export async function rawEmit<T>(event: string, payload?: T): Promise<void> {
  return emit(event, payload)
}

export async function rawEmitTo<T>(
  target: EventTarget | string,
  event: string,
  payload?: T,
): Promise<void> {
  return emitTo(target, event, payload)
}
