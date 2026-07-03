/**
 * The PCB board model + auto-placement. Jobs: only footprinted parts land on the board (a BJT with no
 * footprint is skipped, not dropped somewhere wrong), placements don't overlap, and the outline fits
 * around everything — the invariants a physical layout must hold before routing can trust it.
 */
import { describe, expect, test } from 'vitest'
import {
  type BoardPart,
  deriveBoard,
  footprintByPlacement,
  placementBounds,
} from '../src/renderer/pcb-board.ts'

const parts = (defs: [string, string][]): BoardPart[] =>
  defs.map(([id, definition]) => ({ id, definition }))

describe('deriveBoard', () => {
  test('places only the footprinted parts; skips ones with no package', () => {
    // R1, C1 have footprints (0603); Q1 (BJT) and D1 (LED) do not yet.
    const board = deriveBoard(
      parts([
        ['R1', 'resistor'],
        ['Q1', 'transistor_bjt_npn'],
        ['C1', 'capacitor'],
        ['D1', 'led'],
      ]),
    )
    expect(board.placements.map((p) => p.partId)).toEqual(['R1', 'C1'])
    expect(board.placements.every((p) => p.footprintId === 'R_0603_1608Metric')).toBe(true)
  })

  test('lays parts out left-to-right without overlapping courtyards', () => {
    const board = deriveBoard(
      parts([
        ['R1', 'resistor'],
        ['R2', 'resistor'],
        ['R3', 'resistor'],
      ]),
    )
    expect(board.placements).toHaveLength(3)
    const boxes = board.placements.map((p) => {
      const fp = footprintByPlacement(p)
      if (fp === undefined) throw new Error('missing footprint')
      return placementBounds(p, fp)
    })
    // each part sits strictly to the right of the previous (no overlap in x)
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]?.minX ?? 0).toBeGreaterThanOrEqual((boxes[i - 1]?.maxX ?? 0) - 1e-9)
    }
  })

  test('the outline contains every placed footprint', () => {
    const board = deriveBoard(
      parts([
        ['R1', 'resistor'],
        ['C1', 'capacitor'],
      ]),
    )
    const o = board.outline
    for (const p of board.placements) {
      const fp = footprintByPlacement(p)
      if (fp === undefined) continue
      const bb = placementBounds(p, fp)
      expect(bb.minX).toBeGreaterThanOrEqual(o.x - 1e-9)
      expect(bb.minY).toBeGreaterThanOrEqual(o.y - 1e-9)
      expect(bb.maxX).toBeLessThanOrEqual(o.x + o.w + 1e-9)
      expect(bb.maxY).toBeLessThanOrEqual(o.y + o.h + 1e-9)
    }
  })

  test('an empty (or footprint-free) schematic yields an empty board, not a crash', () => {
    expect(deriveBoard([]).placements).toEqual([])
    expect(deriveBoard(parts([['Q1', 'transistor_bjt_npn']])).placements).toEqual([])
    expect(deriveBoard([]).outline.w).toBeGreaterThan(0)
  })
})

describe('placementBounds respects rotation', () => {
  test('a 90° turn swaps the footprint width and height', () => {
    const p0 = { partId: 'R1', footprintId: 'R_0603_1608Metric', x: 0, y: 0, rotation: 0 as const }
    const p90 = { ...p0, rotation: 90 as const }
    const fp = footprintByPlacement(p0)
    if (fp === undefined) throw new Error('missing')
    const b0 = placementBounds(p0, fp)
    const b90 = placementBounds(p90, fp)
    expect(b90.maxX - b90.minX).toBeCloseTo(b0.maxY - b0.minY, 6)
    expect(b90.maxY - b90.minY).toBeCloseTo(b0.maxX - b0.minX, 6)
  })
})
