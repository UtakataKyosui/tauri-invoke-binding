import type { TransportError } from './transport-error.js'

export interface ClassifyContext {
  /** The command name being invoked, used as a fallback when a message
   * doesn't carry its own (e.g. the confirmed `InvalidArgs` format does). */
  command: string
}

/**
 * Normalizes a raw `invoke()` rejection into a `TransportError`. Never
 * throws — an unrecognized shape always falls back to `{ kind: 'unknown' }`
 * with the original value preserved, rather than guessing wrong or letting
 * the rejection propagate untyped. See issue #10 for the investigation this
 * is based on (grounded in Tauri's actual source where possible; several
 * kinds are lower-confidence heuristics because the exact runtime message
 * could not be confirmed without a live app — that gap is documented per
 * kind in transport-error.ts).
 *
 * This function only ever returns `TransportError` variants — it does not
 * decide whether a rejection is instead the command's own declared
 * `Err(E)`. That decision happens one level up, in `callSafe` (call.ts),
 * because it depends on information (whether the command declares an `Err`
 * at all) that only the call site has.
 */
export function classifyRejection(reason: unknown, ctx: ClassifyContext): TransportError {
  if (reason instanceof Error) {
    return classifyMessage(reason.message, ctx.command) ?? { kind: 'unknown', cause: reason }
  }
  if (typeof reason === 'string') {
    return classifyMessage(reason, ctx.command) ?? { kind: 'unknown', cause: reason }
  }
  return { kind: 'unknown', cause: reason }
}

// Confirmed against crates/tauri/src/error.rs (`Error::InvalidArgs`) and
// crates/tauri/src/ipc/command.rs on the tauri-apps/tauri `dev` branch,
// checked 2026-07-30 (see issue #10 comment for the full investigation).
const INVALID_ARGS =
  /^invalid args `(?<arg>[^`]*)` for command `(?<command>[^`]*)`:\s*(?<cause>[\s\S]*)$/
const MISSING_OR_MALFORMED_ARGS =
  /^command (?<command>\S+) (?:missing required key|expected a value for key|has an argument with no name)/

// The following patterns are unconfirmed against Tauri's source (see the
// issue #10 comment for what was and wasn't found) — best-effort keyword
// heuristics, not verified wire-format strings. They exist so that an
// educated guess is attempted before giving up to `unknown`, but they should
// not be trusted with the same confidence as the two above.
const COMMAND_NOT_FOUND = /\b(?:unknown|unrecognized) command\b|command .* not found/i
const PERMISSION_DENIED =
  /\b(?:permission|capability)\b.*\b(?:denied|not allowed|not granted)\b|not allowed by/i
const PANIC = /\bpanicked at\b|\bpanic\b/i

function classifyMessage(message: string, fallbackCommand: string): TransportError | undefined {
  const invalidArgs = INVALID_ARGS.exec(message)
  if (invalidArgs?.groups) {
    return {
      kind: 'deserialization',
      // biome-ignore lint/complexity/useLiteralKeys: bracket notation is required here by noPropertyAccessFromIndexSignature (RegExpMatchArray.groups is a string index signature)
      command: invalidArgs.groups['command'] || fallbackCommand,
      message,
    }
  }

  const missingArgs = MISSING_OR_MALFORMED_ARGS.exec(message)
  if (missingArgs?.groups) {
    return {
      kind: 'deserialization',
      // biome-ignore lint/complexity/useLiteralKeys: bracket notation is required here by noPropertyAccessFromIndexSignature
      command: missingArgs.groups['command'] || fallbackCommand,
      message,
    }
  }

  if (COMMAND_NOT_FOUND.test(message)) {
    return { kind: 'command-not-found', command: fallbackCommand }
  }

  if (PERMISSION_DENIED.test(message)) {
    return { kind: 'permission-denied', message }
  }

  if (PANIC.test(message)) {
    return { kind: 'panic', message }
  }

  return undefined
}
