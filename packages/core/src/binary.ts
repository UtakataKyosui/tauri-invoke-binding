/**
 * Typed declaration for commands returning Tauri v2's `tauri::ipc::Response`
 * (issue #25, the other half of the gap left by
 * specta-rs/tauri-specta#170):
 *
 * ```rust
 * #[tauri::command]
 * fn read_file() -> tauri::ipc::Response {
 *   let data = std::fs::read("/path/to/file").unwrap();
 *   tauri::ipc::Response::new(data)
 * }
 * ```
 *
 * On the TS side this resolves to a plain `ArrayBuffer` — no special calling
 * convention is needed (unlike raw *request* bodies, see raw.ts), the
 * distinction only matters for the *declared* type. `BinaryCommand<Args,
 * Err>` is `Command<Args, ArrayBuffer, Err>` (see command.ts) plus a brand,
 * so it can be declared and called through the ordinary `createClient` /
 * `createClient` (specta.ts) the same as any other command — the type-level
 * separation from JSON-returning commands falls out of `Ok` being
 * `ArrayBuffer`: treating the result as parsed JSON (property access, etc.)
 * is a type error, no extra machinery required.
 */
import type { Command, CommandArgsShape } from './command.js'

declare const BINARY_COMMAND_BRAND: unique symbol

/** A `Command` whose Rust handler returns `tauri::ipc::Response` — its
 * resolved value is a raw `ArrayBuffer`, never parsed as JSON. */
export type BinaryCommand<Args extends CommandArgsShape, Err = never> = Command<
  Args,
  ArrayBuffer,
  Err
> & {
  readonly [BINARY_COMMAND_BRAND]: true
}

/** Copies `buffer` into a new `Uint8Array` view. */
export function toUint8Array(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer)
}

/** Wraps `buffer` in a `Blob`, e.g. for `URL.createObjectURL` or a `File`
 * download. `type` is the `Blob`'s MIME type, if known. */
export function toBlob(buffer: ArrayBuffer, type?: string): Blob {
  return new Blob([buffer], type ? { type } : undefined)
}
