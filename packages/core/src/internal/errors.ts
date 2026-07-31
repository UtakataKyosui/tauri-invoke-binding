/**
 * Error classes recognized by name inside `classifyForMiddleware` (see
 * classify-for-middleware.ts) and handled specially before the generic
 * `classifyRejection` heuristics apply — each one is detected structurally
 * (an `instanceof` check), never guessed from a message string.
 */

export class NotInTauriError extends Error {
  constructor(command: string) {
    super(
      `"${command}" was called outside a Tauri webview (window.__TAURI_INTERNALS__ is not available).`,
    )
    this.name = 'NotInTauriError'
  }
}

/** Thrown by the `timeout` middleware (issue #14). Rust-side processing is
 * not stopped — this only tells the TS side to stop waiting. */
export class TimeoutError extends Error {
  readonly command: string
  readonly ms: number

  constructor(command: string, ms: number) {
    super(`"${command}" timed out after ${ms}ms.`)
    this.name = 'TimeoutError'
    this.command = command
    this.ms = ms
  }
}

/** Thrown when an `AbortSignal` fires (issue #16). Rust-side processing is
 * not stopped — this only tells the TS side to discard the eventual result. */
export class AbortError extends Error {
  readonly command: string

  constructor(command: string) {
    super(`"${command}" was aborted.`)
    this.name = 'AbortError'
    this.command = command
  }
}
