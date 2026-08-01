/**
 * tauri-invoke-binding
 *
 * A type-safe runtime layer for Tauri v2 IPC. See the repository README for
 * the full design rationale — in short: this package does not generate
 * types from Rust (that's `specta` / `tauri-specta` / `ts-rs`'s job); it
 * consumes generated (or hand-written) command declarations and adds the
 * runtime layer around them — typed transport errors, a never-throws call
 * site, middleware, mocking, `emitTo`, async-iterable channels, raw IPC.
 *
 * @see https://github.com/UtakataKyosui/tauri-invoke-binding
 * @packageDocumentation
 */

export type { BinaryCommand } from './binary.js'
export { toBlob, toUint8Array } from './binary.js'
export type { InvokeFn, SafeInvokeFn } from './call.js'
export { callCommand, callCommandSafe, NotInTauriError } from './call.js'
export type { SnakeToCamel } from './casing.js'
export { camelToSnake, snakeToCamel } from './casing.js'
export type { ChannelOverflowPolicy, ChannelStreamOptions } from './channel.js'
export { createChannel, invokeChannel } from './channel.js'
export type { ClassifyContext } from './classify.js'
export { classifyRejection } from './classify.js'
export type {
  Client,
  CreateClientOptions,
  FlatClient,
  HandWrittenCommandMap,
  NamespacedClient,
  SafeClient,
} from './client.js'
export { createClient } from './client.js'
export type {
  Command,
  CommandArgs,
  CommandArgsShape,
  CommandErr,
  CommandMap,
  CommandOk,
} from './command.js'
export { AbortError, TimeoutError } from './internal/errors.js'
export type {
  CallOptions,
  DedupeOptions,
  InvokeContext,
  Invoker,
  LogEntry,
  LoggerOptions,
  Middleware,
  RetryOptions,
  RetryOverride,
} from './middleware/index.js'
export { composeMiddleware, dedupe, logger, retry, timeout } from './middleware/index.js'
export type {
  CreateRawClientOptions,
  RawBody,
  RawCallOptions,
  RawClient,
  RawCommand,
  RawCommandErr,
  RawCommandMap,
  RawCommandOk,
  RawFlatClient,
  RawInvokeFn,
  RawSafeClient,
  RawSafeInvokeFn,
} from './raw.js'
export { callRaw, callRawSafe, createRawClient } from './raw.js'
export type { Result } from './result.js'
export { err, isErr, isOk, ok } from './result.js'
export type {
  AdjacentlyTagged,
  ExternallyTagged,
  InternallyTagged,
  TaggedHandlers,
} from './tagged.js'
export { matchAdjacentlyTagged, matchExternallyTagged, matchInternallyTagged } from './tagged.js'
export type { SafeError, TransportError } from './transport-error.js'
export { assertExhaustive } from './transport-error.js'

/**
 * Placeholder package version. Changesets bumps the version in `package.json`
 * on release, but nothing currently wires that value into this constant —
 * that plumbing is part of the release infrastructure work (#4).
 */
export const VERSION = '0.0.0'
