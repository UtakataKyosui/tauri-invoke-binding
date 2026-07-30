import { describe, expect, it } from 'vitest'
import { camelToSnake, snakeToCamel } from '../src/casing.js'

describe('snakeToCamel', () => {
  it('converts a snake_case command name to camelCase', () => {
    expect(snakeToCamel('hello_world')).toBe('helloWorld')
    expect(snakeToCamel('has_error')).toBe('hasError')
  })

  it('leaves a name with no underscores unchanged', () => {
    expect(snakeToCamel('ping')).toBe('ping')
  })

  it('handles multiple underscores', () => {
    expect(snakeToCamel('fs_read_file')).toBe('fsReadFile')
  })
})

describe('camelToSnake', () => {
  it('converts a camelCase accessor name back to snake_case', () => {
    expect(camelToSnake('helloWorld')).toBe('hello_world')
    expect(camelToSnake('hasError')).toBe('has_error')
  })

  it('round-trips through snakeToCamel', () => {
    for (const original of ['hello_world', 'has_error', 'fs_read_file', 'ping']) {
      expect(camelToSnake(snakeToCamel(original))).toBe(original)
    }
  })
})
