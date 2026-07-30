import { describe, expectTypeOf, it } from 'vitest'
import type { Result } from '../src/result.js'
import { createClient } from '../src/specta.js'
import type { SafeError } from '../src/transport-error.js'
import { commands } from './fixtures/specta-bindings.js'

describe('tauri-specta adapter (issue #6)', () => {
  it('infers Args/Ok from a command with no declared Result, preserving positional params', () => {
    const api = createClient(commands)
    expectTypeOf(api.helloWorld).toEqualTypeOf<(myName: string) => Promise<string>>()
  })

  it('infers Ok/Err from a command using typedError (a declared Rust Result<T, E>)', () => {
    const api = createClient(commands)
    expectTypeOf(api.safe.hasError).toEqualTypeOf<
      () => Promise<Result<string, SafeError<number>>>
    >()
  })

  it('infers a no-args command as callable with zero parameters', () => {
    const api = createClient(commands)
    expectTypeOf(api.ping).toEqualTypeOf<() => Promise<null>>()
  })

  it('gives a command with no declared Result an Err of never on the safe path', () => {
    const api = createClient(commands)
    expectTypeOf(api.safe.helloWorld).toEqualTypeOf<
      (myName: string) => Promise<Result<string, SafeError<never>>>
    >()
  })

  it('requires zero type redeclaration — no type parameter passed to createClient', () => {
    // this compiling at all (T inferred purely from `commands`) is the test
    const api = createClient(commands)
    expectTypeOf(api).toHaveProperty('helloWorld')
    expectTypeOf(api).toHaveProperty('hasError')
    expectTypeOf(api).toHaveProperty('ping')
  })
})
