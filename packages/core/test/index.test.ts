import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/index.js'

describe('package entrypoint', () => {
  it('exposes a version string', () => {
    expect(typeof VERSION).toBe('string')
  })
})
