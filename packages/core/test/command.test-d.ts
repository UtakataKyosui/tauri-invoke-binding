import { describe, expectTypeOf, it } from 'vitest'
import type { Command, CommandArgs, CommandErr, CommandOk } from '../src/command.js'

describe('Command extractor types (issue #5)', () => {
  it('extracts Args, Ok and Err from an object-args command', () => {
    type C = Command<{ myName: string }, string, number>
    expectTypeOf<CommandArgs<C>>().toEqualTypeOf<{ myName: string }>()
    expectTypeOf<CommandOk<C>>().toEqualTypeOf<string>()
    expectTypeOf<CommandErr<C>>().toEqualTypeOf<number>()
  })

  it('defaults Err to never when not specified', () => {
    type C = Command<void, string>
    expectTypeOf<CommandErr<C>>().toEqualTypeOf<never>()
  })

  it('extracts a tuple Args shape unchanged', () => {
    type C = Command<[name: string, count: number], void>
    expectTypeOf<CommandArgs<C>>().toEqualTypeOf<[name: string, count: number]>()
  })

  it('extracts void Args unchanged', () => {
    type C = Command<void, void>
    expectTypeOf<CommandArgs<C>>().toEqualTypeOf<void>()
  })
})
