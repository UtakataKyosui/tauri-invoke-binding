/**
 * tauri-invoke-binding
 *
 * A type-safe runtime layer for Tauri v2 IPC.
 *
 * This package is **pre-alpha and intentionally empty**. The scaffold, the
 * design docs (see the repository README) and the issue tracker landed first so
 * that the public API could be settled before any of it is written.
 *
 * Design constraint worth repeating here, because it shapes every module that
 * will be added next: this package does **not** generate types from Rust.
 * `specta` / `tauri-specta` / `ts-rs` already do that well. What is missing is
 * everything *around* the generated bindings — typed transport errors,
 * middleware, mocking, `emitTo`, async-iterable channels, raw IPC. That layer
 * is what gets built here.
 *
 * @see https://github.com/UtakataKyosui/tauri-invoke-binding
 * @packageDocumentation
 */

/** The package version. Replaced at release time by Changesets. */
export const VERSION = '0.0.0'
