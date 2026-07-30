import { describe, expect, it } from 'vitest'
import { err, isErr, isOk, ok, type Result } from '../src/result.js'

describe('Result (issue #7 — matches the shape tauri-specta already generates)', () => {
  it('ok() produces a { status: "ok", data } value', () => {
    expect(ok('value')).toEqual({ status: 'ok', data: 'value' })
  })

  it('err() produces a { status: "error", error } value', () => {
    expect(err('boom')).toEqual({ status: 'error', error: 'boom' })
  })

  it('isOk narrows to the ok branch', () => {
    const result: Result<string, number> = ok('value')
    expect(isOk(result)).toBe(true)
    if (isOk(result)) {
      expect(result.data).toBe('value')
    }
  })

  it('isErr narrows to the error branch', () => {
    const result: Result<string, number> = err(42)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error).toBe(42)
    }
  })
})
