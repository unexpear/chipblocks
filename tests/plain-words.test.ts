import { describe, expect, test } from 'vitest'
import { listPhrase, plural } from '../src/renderer/plain-words.ts'

describe('the two bits of English every count-carrying message needs', () => {
  test('a count takes the right noun after it', () => {
    // The shipped bug this exists to stop: "the 1 kinds of tile you gave a description for".
    expect(plural(1, 'kind of place', 'kinds of place')).toBe('1 kind of place')
    expect(plural(3, 'kind of place', 'kinds of place')).toBe('3 kinds of place')
    expect(plural(0, 'part', 'parts')).toBe('0 parts')
  })

  test('a list reads the way a person says it', () => {
    expect(listPhrase([])).toBe('')
    expect(listPhrase(['PLC2'])).toBe('PLC2')
    expect(listPhrase(['CIB', 'PLC2'])).toBe('CIB and PLC2')
    expect(listPhrase(['CIB', 'CIB_EBR', 'PLC2'])).toBe('CIB, CIB_EBR and PLC2')
  })
})
