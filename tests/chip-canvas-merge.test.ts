/**
 * mergeOverrides — the chip canvas's data path for hand-placed cells. A dragged cell writes a
 * {id,x,y} override; this merges it onto the auto-placed floorplan so the canvas renders the saved
 * layer (auto layout ⊕ your edits). Persistence and undo both ride on this being exact: an override
 * moves ONLY position, never a cell's size / name / row, and only the matching id.
 */

import { describe, expect, test } from 'vitest'
import type { PlacedCell } from '../src/renderer/cell-place.ts'
import { mergeOverrides } from '../src/renderer/chip-canvas.tsx'

const cell = (id: string, x: number, y: number): PlacedCell => ({
  id,
  name: `cell ${id}`,
  x,
  y,
  w: 30,
  h: 90,
  row: y / 90,
  reliable: true,
})

describe('mergeOverrides', () => {
  test('no overrides returns the base cells unchanged (same reference)', () => {
    const base = [cell('a', 0, 0), cell('b', 30, 0)]
    expect(mergeOverrides(base, [])).toBe(base)
  })

  test('an override moves only its cell, only its x/y — size, name, and row stay from the base', () => {
    const base = [cell('a', 0, 0), cell('b', 30, 0), cell('c', 60, 90)]
    const merged = mergeOverrides(base, [{ id: 'b', x: 300, y: 90 }])
    expect(merged[0]).toEqual(base[0])
    expect(merged[2]).toEqual(base[2])
    const moved = merged[1]
    expect(moved).toMatchObject({ id: 'b', x: 300, y: 90, w: 30, h: 90, name: 'cell b', row: 0 })
  })

  test('multiple overrides each hit their own cell; an override for an absent id is ignored', () => {
    const base = [cell('a', 0, 0), cell('b', 30, 0)]
    const merged = mergeOverrides(base, [
      { id: 'a', x: 500, y: 0 },
      { id: 'ghost', x: 999, y: 999 },
    ])
    expect(merged[0]).toMatchObject({ id: 'a', x: 500, y: 0 })
    expect(merged[1]).toEqual(base[1])
    expect(merged.some((c) => c.id === 'ghost')).toBe(false)
  })
})
