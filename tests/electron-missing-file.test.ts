import { describe, expect, test } from 'vitest'
import { isMissingFile } from '../electron/missing-file.ts'

describe('missing file vs unreadable file', () => {
  test('only a not-found error counts as missing', () => {
    expect(isMissingFile(Object.assign(new Error('gone'), { code: 'ENOENT' }))).toBe(true)
    expect(isMissingFile(Object.assign(new Error('busy'), { code: 'EBUSY' }))).toBe(false)
    expect(isMissingFile(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe(false)
    expect(isMissingFile(new Error('no code'))).toBe(false)
    expect(isMissingFile(null)).toBe(false)
  })
})
