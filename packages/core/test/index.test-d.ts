import { describe, expectTypeOf, it } from 'vitest'
import { VERSION } from '../src/index.js'

// Placeholder type-level suite. It exists so the `typecheck` half of the vitest
// run is wired up and enforced from the very first commit — the real assertions
// arrive with the first typed API.
describe('package entrypoint (types)', () => {
  it('types VERSION as a string', () => {
    expectTypeOf(VERSION).toEqualTypeOf<string>()
  })
})
