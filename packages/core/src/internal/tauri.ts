/**
 * The one place this package touches `@tauri-apps/api` directly. Kept in a
 * single module so runtime tests can mock exactly this (see test/*.test.ts)
 * without reaching into `@tauri-apps/api` internals, and so a future change
 * to how we call into Tauri (e.g. supporting `InvokeOptions.headers`) has one
 * call site to update.
 */

import type { InvokeArgs } from '@tauri-apps/api/core'
import { Channel, invoke, isTauri } from '@tauri-apps/api/core'

export async function rawInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args)
}

/** Constructs a real `Channel<T>` (issue #22). `new Channel()` registers a
 * callback with `window.__TAURI_INTERNALS__.transformCallback`, so — like
 * `rawInvoke` above — this is kept as its own call site purely so tests can
 * mock it without a real Tauri webview. */
export function createRawChannel<T>(onmessage: (message: T) => void): Channel<T> {
  return new Channel<T>(onmessage)
}

/** The raw-IPC counterpart of `rawInvoke` (issue #24): a raw body
 * (`ArrayBuffer` / `Uint8Array` / `number[]`) instead of a JSON args object,
 * plus optional headers — `tauri::ipc::Request` on the Rust side. */
export async function rawInvokeRequest<T>(
  cmd: string,
  body: ArrayBuffer | Uint8Array | readonly number[],
  headers?: HeadersInit,
): Promise<T> {
  return invoke<T>(cmd, body as InvokeArgs, headers ? { headers } : undefined)
}

export function isTauriEnvironment(): boolean {
  return isTauri()
}
