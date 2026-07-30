/**
 * The one place this package touches `@tauri-apps/api` directly. Kept in a
 * single module so runtime tests can mock exactly this (see test/*.test.ts)
 * without reaching into `@tauri-apps/api` internals, and so a future change
 * to how we call into Tauri (e.g. supporting `InvokeOptions.headers`) has one
 * call site to update.
 */
import { invoke, isTauri } from '@tauri-apps/api/core'

export async function rawInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args)
}

export function isTauriEnvironment(): boolean {
  return isTauri()
}
