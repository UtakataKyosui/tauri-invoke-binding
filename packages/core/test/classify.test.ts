import { describe, expect, it } from 'vitest'
import { classifyRejection } from '../src/classify.js'

const ctx = { command: 'hello_world' }

describe('classifyRejection (issue #10)', () => {
  describe('deserialization — confirmed against Tauri source (Error::InvalidArgs)', () => {
    it('classifies the confirmed InvalidArgs message format', () => {
      const message =
        'invalid args `myName` for command `hello_world`: invalid type: floating point `1.5`, expected u32'
      expect(classifyRejection(message, ctx)).toEqual({
        kind: 'deserialization',
        command: 'hello_world',
        message,
      })
    })

    it('extracts the command name from the message, not just the call context', () => {
      const message = 'invalid args `x` for command `some_other_command`: type mismatch'
      const result = classifyRejection(message, ctx)
      expect(result).toMatchObject({ kind: 'deserialization', command: 'some_other_command' })
    })

    it('classifies the confirmed "missing required key" message format', () => {
      const message = 'command hello_world missing required key myName'
      expect(classifyRejection(message, ctx)).toEqual({
        kind: 'deserialization',
        command: 'hello_world',
        message,
      })
    })

    it('works when the rejection is an Error instance wrapping the same message', () => {
      const message = 'invalid args `myName` for command `hello_world`: type mismatch'
      expect(classifyRejection(new Error(message), ctx)).toEqual({
        kind: 'deserialization',
        command: 'hello_world',
        message,
      })
    })
  })

  describe('low-confidence heuristics (unverified against source — see issue #10)', () => {
    it('classifies an "unknown command" style message as command-not-found', () => {
      expect(classifyRejection('unknown command foo_bar', ctx)).toEqual({
        kind: 'command-not-found',
        command: 'hello_world',
      })
    })

    it('classifies a permission-denied style message', () => {
      const message = 'capability not allowed for this command'
      expect(classifyRejection(message, ctx)).toEqual({ kind: 'permission-denied', message })
    })

    it('classifies a panic style message', () => {
      const message = "thread 'main' panicked at src/lib.rs:42: index out of bounds"
      expect(classifyRejection(message, ctx)).toEqual({ kind: 'panic', message })
    })
  })

  describe('unknown fallback — never throws, never loses the original value', () => {
    it('falls back to unknown for an unrecognized string', () => {
      expect(classifyRejection('some totally unrelated message', ctx)).toEqual({
        kind: 'unknown',
        cause: 'some totally unrelated message',
      })
    })

    it('falls back to unknown for an unrecognized Error, preserving the Error as cause', () => {
      const error = new TypeError('failed to fetch')
      expect(classifyRejection(error, ctx)).toEqual({ kind: 'unknown', cause: error })
    })

    it.each([undefined, null, 42, ['array'], { some: 'object' }, true])(
      'never throws for an arbitrary non-Error, non-string rejection: %p',
      (value) => {
        expect(() => classifyRejection(value, ctx)).not.toThrow()
        expect(classifyRejection(value, ctx)).toEqual({ kind: 'unknown', cause: value })
      },
    )

    it('never throws for a Symbol rejection either', () => {
      const value = Symbol('sym')
      expect(() => classifyRejection(value, ctx)).not.toThrow()
      expect(classifyRejection(value, ctx)).toEqual({ kind: 'unknown', cause: value })
    })
  })
})
