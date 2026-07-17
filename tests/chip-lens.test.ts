/**
 * Chip floorplan colouring lenses — module (by the cell's flattened-id hierarchy), gate (by type), and
 * density (by local packing). Pure cell→colour functions so the canvas recolours without re-placing.
 */

import { describe, expect, test } from 'vitest'
import type { Floorplan, PlacedCell } from '../src/renderer/cell-place.ts'
import { buildCellColorer, gateColor, moduleColor, moduleOf } from '../src/renderer/chip-lens.ts'

const cell = (id: string, name: string, x: number, y: number): PlacedCell => ({
  id,
  name,
  x,
  y,
  w: 24,
  h: 90,
  row: Math.round(y / 90),
  reliable: true,
})

const plan = (cells: PlacedCell[]): Floorplan => {
  const dieW = Math.max(1, ...cells.map((c) => c.x + c.w))
  const dieH = Math.max(1, ...cells.map((c) => c.y + c.h))
  return {
    cells,
    rows: Math.max(1, ...cells.map((c) => c.row + 1)),
    dieWidthLambda: dieW,
    dieHeightLambda: dieH,
    dieWidthUm: dieW * 0.3,
    dieHeightUm: dieH * 0.3,
    cellAreaLambda2: cells.reduce((s, c) => s + c.w * c.h, 0),
    dieAreaLambda2: dieW * dieH,
    utilization: 0.9,
    anyUnreliable: false,
  }
}

describe('chip floorplan lenses', () => {
  test('moduleOf splits the flattened id on "." to the chosen depth; a top-level gate is "top"', () => {
    expect(moduleOf('cc_cpu.datapath.alu.and_0')).toBe('cc_cpu')
    expect(moduleOf('cc_cpu.datapath.alu.and_0', 2)).toBe('cc_cpu.datapath')
    expect(moduleOf('g5', 1)).toBe('top') // no dot → top-level
  })

  test('colours are stable — the same module / gate maps to the same colour every time', () => {
    expect(moduleColor('cc_cpu.alu.g0')).toBe(moduleColor('cc_cpu.pc.g9')) // same top module
    expect(moduleColor('cc_cpu.alu.g0')).not.toBe(moduleColor('other.alu.g0'))
    expect(gateColor('NAND')).toBe(gateColor('NAND'))
    expect(gateColor('NAND')).not.toBe(gateColor('NOR'))
    expect(gateColor('mystery')).toBe('#8a8f98') // unknown → neutral fallback
  })

  test('the gate lens colours by type; the module lens colours by hierarchy region', () => {
    const nand = cell('cpu.alu.g0', 'NAND', 0, 0)
    const nor = cell('cpu.pc.g1', 'NOR', 24, 0)
    const fp = plan([nand, nor])
    const byGate = buildCellColorer(fp, 'gate')
    expect(byGate(nand)).toBe(gateColor('NAND'))
    expect(byGate(nor)).toBe(gateColor('NOR'))
    const byModule = buildCellColorer(fp, 'module')
    // both cells are in module 'cpu' → same colour under the module lens (regions, not gate types)
    expect(byModule(nand)).toBe(byModule(nor))
  })

  test('the density lens returns a colour for every cell (a packed vs sparse ramp)', () => {
    const cells = Array.from({ length: 20 }, (_, i) =>
      cell(`cpu.g${i}`, 'NAND', (i % 5) * 24, Math.floor(i / 5) * 90),
    )
    const byDensity = buildCellColorer(plan(cells), 'density')
    for (const c of cells) expect(byDensity(c)).toMatch(/^hsl\(/)
  })
})
