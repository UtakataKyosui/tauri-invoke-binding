/**
 * A failure that happened *before* the command's own `Result<T, E>` could be
 * consulted — Tauri never dispatched to the handler, or something failed at
 * the IPC transport layer itself. `tauri-specta`'s generated code throws
 * these untyped (`if (e instanceof Error) throw e`); this type is the fix
 * (see issue #9 / upstream specta-rs/tauri-specta#169).
 *
 * `unknown` is not a last resort to be avoided — see classify.ts. Given the
 * evidence gathered there (issue #10), most of these kinds cannot be detected
 * with full confidence from the frontend alone, so misclassifying a rejection
 * as a specific kind is worse than honestly reporting `unknown` with the
 * original value preserved in `cause`.
 */
export type TransportError =
  /** Argument or return value failed to (de)serialize. Confirmed against
   * Tauri's source: `Error::InvalidArgs` — `"invalid args \`{name}\` for
   * command \`{command}\`: {cause}"` (crates/tauri/src/error.rs, dev branch,
   * checked 2026-07-30). This is the exact failure mode upstream issue #169
   * was originally filed about (a float passed where an integer was
   * expected). */
  | { kind: 'deserialization'; command: string; message: string }
  /** The command name has no handler in `generate_handler!`. The exact
   * runtime message could not be confirmed from source in this session (see
   * issue #10) — classification of this kind is a low-confidence heuristic
   * and readily falls back to `unknown`. */
  | { kind: 'command-not-found'; command: string }
  /** The webview's capability/ACL configuration does not allow this command.
   * Unconfirmed from source (see issue #10); low-confidence heuristic. */
  | { kind: 'permission-denied'; message: string }
  /** The Rust command handler panicked. Unconfirmed from source (see issue
   * #10); low-confidence heuristic. */
  | { kind: 'panic'; message: string }
  /** The caller's `AbortSignal` fired. Detected by this package itself (a
   * race against the signal), not by inspecting the rejection value — this
   * is the one kind that needs no heuristic at all. */
  | { kind: 'aborted' }
  /** Called outside a Tauri webview (browser, SSR, Storybook, plain vitest).
   * Detected before `invoke` is even called — see `isTauriEnvironment` in
   * internal/tauri.ts — so this is also not a heuristic. */
  | { kind: 'not-in-tauri' }
  /** Anything that didn't match one of the above. The original rejection is
   * preserved in `cause` so nothing is lost to a failed guess. */
  | { kind: 'unknown'; cause: unknown }

/**
 * The error a `safe.*` call resolves with: either the command's own declared
 * `Err` (Rust's `Result::Err(E)`, tagged `'command'` to keep it in the same
 * `switch` as `TransportError`) or a `TransportError`. See issue #11.
 */
export type SafeError<Err> = { kind: 'command'; value: Err } | TransportError

/**
 * The standard exhaustiveness idiom: call this from a `switch`'s `default`
 * arm (or the final `else`) over a `kind`-discriminated union. If a new kind
 * is later added to `TransportError` or `SafeError`, every `switch` written
 * this way stops compiling until it handles the new case — see issue #12.
 */
export function assertExhaustive(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`)
}
