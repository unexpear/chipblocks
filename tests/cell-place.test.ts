/**
 * Standard-cell PLACEMENT — the floorplan layer. placeCells flattens a design to gate cells (the same
 * boundary the area estimate uses) and packs them into shared-rail rows, giving every cell a real (x, y)
 * in λ plus the die outline. The load-bearing checks: cells never overlap within a row, rows sit at
 * y = row · rowHeight, the die bounds enclose every cell, and utilization stays in (0, 1].
 */

import { describe, expect, test } from 'vitest'
import type { CanvasNodeLike } from '../src/renderer/blocks.ts'
import { CPU_4BIT, NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { PROCESS } from '../src/renderer/cell-layout.ts'
import { placeCells } from '../src/renderer/cell-place.ts'

const nand = (id: string): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'block', block: NAND2_BLOCK },
})

const block = (id: string, b: typeof CPU_4BIT): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'block', block: b },
})

/** Every placed cell fits inside the die and no two cells in the same row overlap. */
function assertLegalPlacement(fp: ReturnType<typeof placeCells>) {
  for (const c of fp.cells) {
    expect(c.h).toBe(PROCESS.rowHeight.lambda) // uniform row height
    expect(c.y).toBe(c.row * PROCESS.rowHeight.lambda) // rows tile downward
    expect(c.x).toBeGreaterThanOrEqual(0)
    expect(c.x + c.w).toBeLessThanOrEqual(fp.dieWidthLambda)
    expect(c.y + c.h).toBeLessThanOrEqual(fp.dieHeightLambda)
  }
  // no overlap within a row: sort each row by x, each cell starts at/after the previous cell's right edge
  const byRow = new Map<number, typeof fp.cells>()
  for (const c of fp.cells) {
    const list = byRow.get(c.row) ?? []
    list.push(c)
    byRow.set(c.row, list)
  }
  for (const list of byRow.values()) {
    const sorted = [...list].sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const cur = sorted[i]
      if (!prev || !cur) continue
      expect(cur.x).toBeGreaterThanOrEqual(prev.x + prev.w)
    }
  }
}

describe('standard-cell placement — the floorplan', () => {
  test('an empty design places nothing', () => {
    const fp = placeCells([], [])
    expect(fp.cells).toHaveLength(0)
    expect(fp.rows).toBe(0)
    expect(fp.dieWidthLambda).toBe(0)
    expect(fp.utilization).toBe(0)
  })

  test('a lone resistor is not a cell — no placement', () => {
    const r: CanvasNodeLike = {
      id: 'r1',
      position: { x: 0, y: 0 },
      data: { definition: 'resistor' },
    }
    expect(placeCells([r], []).cells).toHaveLength(0)
  })

  test('two NAND cells sit side by side in one row, fully packed', () => {
    const fp = placeCells([nand('n1'), nand('n2')], [])
    expect(fp.cells).toHaveLength(2)
    expect(fp.rows).toBe(1)
    // NAND is 24 λ wide; both fit the roughly-square target row → row 0, abutting at x=0 and x=24
    const xs = fp.cells.map((c) => c.x).sort((a, b) => a - b)
    expect(xs).toEqual([0, 24])
    expect(fp.cells.every((c) => c.row === 0)).toBe(true)
    expect(fp.dieWidthLambda).toBe(48)
    expect(fp.dieHeightLambda).toBe(PROCESS.rowHeight.lambda)
    // abutted, single row → 100% utilization
    expect(fp.utilization).toBeCloseTo(1)
    assertLegalPlacement(fp)
  })

  test('many cells wrap into multiple rows', () => {
    const fp = placeCells(
      Array.from({ length: 40 }, (_, i) => nand(`n${i}`)),
      [],
    )
    expect(fp.cells).toHaveLength(40)
    expect(fp.rows).toBeGreaterThan(1) // 40 cells can't fit one roughly-square row
    expect(fp.dieHeightLambda).toBe(fp.rows * PROCESS.rowHeight.lambda)
    assertLegalPlacement(fp)
    // roughly square: width and height within a small factor of each other
    const ratio = fp.dieWidthLambda / fp.dieHeightLambda
    expect(ratio).toBeGreaterThan(0.4)
    expect(ratio).toBeLessThan(2.5)
  })

  test('a real CPU places thousands of legal cells with a sane die + utilization', () => {
    const fp = placeCells([block('cpu', CPU_4BIT)], [])
    expect(fp.cells.length).toBeGreaterThan(100) // the 4-bit CPU is a lot of gates
    expect(fp.rows).toBeGreaterThan(1)
    expect(fp.dieWidthUm).toBeGreaterThan(0)
    expect(fp.dieHeightUm).toBeGreaterThan(0)
    expect(fp.utilization).toBeGreaterThan(0)
    expect(fp.utilization).toBeLessThanOrEqual(1)
    assertLegalPlacement(fp)
  })
})
