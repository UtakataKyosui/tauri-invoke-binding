/**
 * Result shape, deliberately identical to what `tauri-specta` already generates
 * (`{ status: 'ok', data } | { status: 'error', error }`) — see issue #7. Mixing
 * a second, differently-shaped Result type into an app that also uses
 * tauri-specta's generated bindings would be exactly the kind of confusion this
 * package exists to avoid.
 */
export type Result<T, E> = { status: 'ok'; data: T } | { status: 'error'; error: E }

export function ok<T>(data: T): Result<T, never> {
  return { status: 'ok', data }
}

export function err<E>(error: E): Result<never, E> {
  return { status: 'error', error }
}

export function isOk<T, E>(result: Result<T, E>): result is { status: 'ok'; data: T } {
  return result.status === 'ok'
}

export function isErr<T, E>(result: Result<T, E>): result is { status: 'error'; error: E } {
  return result.status === 'error'
}
