import { describe, expectTypeOf, it } from 'vitest'
import type { BinaryCommand } from '../src/binary.js'
import type { CommandArgs, CommandErr, CommandOk } from '../src/command.js'

describe('BinaryCommand typing (issue #25)', () => {
  it('resolves to ArrayBuffer, never a parsed JSON shape', () => {
    type C = BinaryCommand<{ path: string }, string>
    expectTypeOf<CommandOk<C>>().toEqualTypeOf<ArrayBuffer>()
    expectTypeOf<CommandArgs<C>>().toEqualTypeOf<{ path: string }>()
    expectTypeOf<CommandErr<C>>().toEqualTypeOf<string>()
  })

  it('treating the resolved value as parsed JSON is a type error', () => {
    type C = BinaryCommand<void>
    type Ok = CommandOk<C>

    function handle(value: Ok) {
      // @ts-expect-error - ArrayBuffer has no arbitrary JSON properties
      return value.someField
    }
    expectTypeOf(handle).toBeFunction()
  })
})
