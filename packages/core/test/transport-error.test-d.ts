import { match } from 'ts-pattern'
import { describe, expectTypeOf, it } from 'vitest'
import { assertExhaustive, type SafeError, type TransportError } from '../src/transport-error.js'

function handleTransportError(e: TransportError): string {
  switch (e.kind) {
    case 'deserialization':
      return e.message
    case 'command-not-found':
      return e.command
    case 'permission-denied':
      return e.message
    case 'panic':
      return e.message
    case 'aborted':
      return 'aborted'
    case 'not-in-tauri':
      return 'not-in-tauri'
    case 'unknown':
      return String(e.cause)
    default:
      return assertExhaustive(e)
  }
}

function handleTransportErrorMissingCase(e: TransportError): string {
  switch (e.kind) {
    case 'deserialization':
      return e.message
    case 'command-not-found':
      return e.command
    case 'permission-denied':
      return e.message
    case 'panic':
      return e.message
    case 'aborted':
      return 'aborted'
    case 'not-in-tauri':
      return 'not-in-tauri'
    // 'unknown' intentionally left unhandled
    default:
      // @ts-expect-error - e is narrowed to { kind: 'unknown'; cause } here,
      // not `never`, because the switch above doesn't handle every kind.
      return assertExhaustive(e)
  }
}

function handleSafeError<E>(e: SafeError<E>): string {
  switch (e.kind) {
    case 'command':
      return String(e.value)
    case 'deserialization':
      return e.message
    case 'command-not-found':
      return e.command
    case 'permission-denied':
      return e.message
    case 'panic':
      return e.message
    case 'aborted':
      return 'aborted'
    case 'not-in-tauri':
      return 'not-in-tauri'
    case 'unknown':
      return String(e.cause)
    default:
      return assertExhaustive(e)
  }
}

function handleWithTsPattern(e: TransportError): string {
  return match(e)
    .with({ kind: 'deserialization' }, (x) => x.message)
    .with({ kind: 'command-not-found' }, (x) => x.command)
    .with({ kind: 'permission-denied' }, (x) => x.message)
    .with({ kind: 'panic' }, (x) => x.message)
    .with({ kind: 'aborted' }, () => 'aborted')
    .with({ kind: 'not-in-tauri' }, () => 'not-in-tauri')
    .with({ kind: 'unknown' }, (x) => String(x.cause))
    .exhaustive()
}

describe('TransportError / SafeError exhaustiveness (issue #12)', () => {
  it('a switch handling every kind, with assertExhaustive in default, type-checks', () => {
    expectTypeOf(handleTransportError).returns.toEqualTypeOf<string>()
  })

  it('omitting a kind turns the default arm into a type error (@ts-expect-error above)', () => {
    expectTypeOf(handleTransportErrorMissingCase).returns.toEqualTypeOf<string>()
  })

  it("ts-pattern's .exhaustive() also type-checks over every kind", () => {
    expectTypeOf(handleWithTsPattern).returns.toEqualTypeOf<string>()
  })

  it('SafeError<E> switches type-check with the extra "command" case included', () => {
    expectTypeOf(handleSafeError).returns.toEqualTypeOf<string>()
  })
})

/**
 * How "adding a new kind breaks existing exhaustive switches" (the 4th
 * completion criterion on issue #12) is verified: it's a structural property
 * of the `assertExhaustive(value: never)` idiom used above and of
 * `ts-pattern`'s `.exhaustive()`, not something a single commit can
 * demonstrate against itself — the kind and the switch handling it are
 * necessarily introduced together. Concretely: if a future change adds a new
 * `TransportError` variant without updating `handleTransportError` above,
 * the `default` arm's narrowed type stops being `never` and `assertExhaustive`
 * no longer accepts it, so `pnpm typecheck` fails at that call site. The same
 * applies to `handleWithTsPattern`'s `.exhaustive()` call. `handleTransportErrorMissingCase`
 * above demonstrates the identical mechanism from the other direction —
 * removing a case from what's handled has the same effect as adding one that
 * isn't handled yet, which is exactly why it needs its `@ts-expect-error`.
 */
