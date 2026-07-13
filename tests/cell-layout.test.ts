/**
 * Standard-cell geometry — the first silicon layer. Each CMOS gate gets a real physical cell shape
 * from its own transistor netlist and the cited λ-based scalable design rules (Mead-Conway / Weste-
 * Harris / MOSIS SCMOS). The load-bearing check: the width formula is validated against the primary
 * source — a NAND cell is drawn 24 λ wide, and columns·polyPitch + 2·edgeMargin = 2·8 + 2·4 = 24 λ
 * must reproduce it exactly. The constants are cited real values (project rule #1), pinned here.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasNodeLike } from '../src/renderer/blocks.ts'
import { INVERTER_BLOCK, NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import {
  cellGeometry,
  designCellArea,
  PROCESS,
  standardCells,
} from '../src/renderer/cell-layout.ts'

describe('standard-cell geometry — λ-scalable cell shapes', () => {
  test('the cited process constants (Harris E158 / MOSIS SCMOS, AMI C5N λ=0.3µm)', () => {
    expect(PROCESS.lambdaUm).toBe(0.3)
    expect(PROCESS.rowHeight.lambda).toBe(90)
    expect(PROCESS.polyPitch.lambda).toBe(8)
    expect(PROCESS.edgeMargin.lambda).toBe(4)
    // every constant carries its provenance (project rule #1)
    expect(PROCESS.rowHeight.source).toMatch(/Harris/)
  })

  test('an inverter is one column, 16 λ (4.8 µm) wide × 27 µm tall', () => {
    const g = cellGeometry(INVERTER_BLOCK)
    expect(g.name).toBe('NOT')
    expect(g.transistors).toBe(2) // one PMOS + one NMOS
    expect(g.columns).toBe(1)
    expect(g.widthLambda).toBe(16) // 1·8 + 2·4
    expect(g.widthUm).toBeCloseTo(4.8)
    expect(g.heightUm).toBeCloseTo(27) // 90λ · 0.3µm
    expect(g.reliable).toBe(true)
  })

  test('a NAND is two columns, 24 λ wide — reproduces the primary-source cell exactly', () => {
    const g = cellGeometry(NAND2_BLOCK)
    expect(g.transistors).toBe(4) // 2 series NMOS + 2 parallel PMOS
    expect(g.columns).toBe(2)
    expect(g.widthLambda).toBe(24) // the cited Harris NAND cell is 24 λ wide
    expect(g.widthUm).toBeCloseTo(7.2)
    expect(g.reliable).toBe(true)
  })

  test('the standard-cell library covers the eight primitive gates', () => {
    const cells = standardCells()
    expect(cells).toHaveLength(8)
    expect(cells.map((c) => c.name)).toEqual(
      expect.arrayContaining(['NOT', 'Buffer', 'NAND', 'NOR', 'AND', 'OR', 'XOR', 'XNOR']),
    )
    for (const c of cells) {
      expect(c.widthLambda).toBeGreaterThan(0)
      expect(c.areaUm2).toBeGreaterThan(0)
    }
  })

  test("a design's total cell area sums its gate cells", () => {
    const nand = (id: string): CanvasNodeLike => ({
      id,
      position: { x: 0, y: 0 },
      data: { definition: 'block', block: NAND2_BLOCK },
    })
    const a = designCellArea([nand('n1'), nand('n2')], [])
    expect(a.cellCount).toBe(2)
    // 2 cells × (24 λ × 90 λ, in µm) = 2 × 7.2 × 27
    expect(a.areaUm2).toBeCloseTo(2 * 7.2 * 27)
    expect(a.anyUnreliable).toBe(false)
  })

  test('a plain part (a lone resistor) contributes no standard-cell area', () => {
    const r: CanvasNodeLike = {
      id: 'r1',
      position: { x: 0, y: 0 },
      data: { definition: 'resistor' },
    }
    const a = designCellArea([r], [])
    expect(a.cellCount).toBe(0)
    expect(a.areaUm2).toBe(0)
  })
})
