/**
 * The persisted chip-layout layer — the chip floorplan's own saved state (cell overrides + lens +
 * schematic fingerprint), the twin of the board's hand-placements. These guard the drop-don't-reject
 * validation: a malformed field is dropped (never a reason to reject the whole circuit), and an empty
 * layout reduces to `undefined` so it's omitted from the file (older files stay byte-identical).
 */

import { describe, expect, test } from 'vitest'
import {
  EMPTY_CHIP_LAYOUT,
  isEmptyChipLayout,
  sanitizeChipLayout,
} from '../src/renderer/chip-layout.ts'

describe('chip-layout persistence helpers', () => {
  test('isEmptyChipLayout: the empty layout and undefined are empty; any content is not', () => {
    expect(isEmptyChipLayout(undefined)).toBe(true)
    expect(isEmptyChipLayout(EMPTY_CHIP_LAYOUT)).toBe(true)
    expect(isEmptyChipLayout({ overrides: [{ id: 'a', x: 1, y: 2 }] })).toBe(false)
    expect(isEmptyChipLayout({ overrides: [], lens: 'module' })).toBe(false)
    expect(isEmptyChipLayout({ overrides: [], sourceSignature: 'sig' })).toBe(false)
  })

  test('sanitizeChipLayout keeps well-formed content', () => {
    const layout = sanitizeChipLayout({
      overrides: [{ id: 'cpu.alu.g0', x: 24, y: 90 }],
      lens: 'density',
      sourceSignature: 'sig-1',
    })
    expect(layout).toEqual({
      overrides: [{ id: 'cpu.alu.g0', x: 24, y: 90 }],
      lens: 'density',
      sourceSignature: 'sig-1',
    })
  })

  test('sanitizeChipLayout drops malformed overrides, an unknown lens, and a non-string signature', () => {
    const layout = sanitizeChipLayout({
      overrides: [
        { id: 'ok', x: 1, y: 2 },
        { id: 'bad', x: Number.NaN, y: 2 },
        { x: 1, y: 2 },
        { id: 'noy', x: 1 },
      ],
      lens: 'sparkle',
      sourceSignature: 42,
    })
    expect(layout).toEqual({ overrides: [{ id: 'ok', x: 1, y: 2 }] })
  })

  test('sanitizeChipLayout returns undefined for non-objects and for an empty layout', () => {
    expect(sanitizeChipLayout('nope')).toBeUndefined()
    expect(sanitizeChipLayout(null)).toBeUndefined()
    expect(sanitizeChipLayout(undefined)).toBeUndefined()
    expect(sanitizeChipLayout({ overrides: [] })).toBeUndefined()
    expect(sanitizeChipLayout({ overrides: 'x', lens: 'bad' })).toBeUndefined()
  })
})
