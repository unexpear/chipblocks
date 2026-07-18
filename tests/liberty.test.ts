/**
 * LIBERTY (.lib) TIMING LIBRARY (chip-physical chapter, signoff C2). Verifies the .lib is well-formed (units,
 * template, balanced cells), that every gate — INCLUDING the composites (AND/OR/XOR = NAND+INV inside), which
 * only characterize if the writer flattens them to transistors — gets a real positive RC delay + input
 * capacitance, and that the boolean function + timing sense match each gate's truth table.
 */
import { describe, expect, test } from 'vitest'
import { STANDARD_CELL_BLOCKS } from '../src/renderer/cell-drc.ts'
import { PROCESS } from '../src/renderer/cell-layout.ts'
import type { Floorplan } from '../src/renderer/cell-place.ts'
import { cellLiberty, floorplanToLib, LIB_NAME, standardCellLib } from '../src/renderer/liberty.ts'

// pull the two numeric values out of a `... ("v0, v1");` line inside a named table of a cell block.
const tableValues = (cellText: string, group: string): number[] => {
  const at = cellText.indexOf(`${group} (`)
  if (at < 0) return []
  const m = cellText.slice(at).match(/values \("([^"]+)"\)/)
  return m ? (m[1] as string).split(',').map((s) => Number(s.trim())) : []
}
const senseOf = (cellText: string): string[] =>
  [...cellText.matchAll(/timing_sense : (\w+) ;/g)].map((m) => m[1] as string)
const capOf = (cellText: string): number[] =>
  [...cellText.matchAll(/capacitance : ([\d.]+) ;/g)].map((m) => Number(m[1]))

describe('standardCellLib — the .lib header + all 8 cells', () => {
  const lib = standardCellLib()

  test('has the library header, units, and the load template', () => {
    expect(lib).toContain(`library (${LIB_NAME}) {`)
    expect(lib).toContain('delay_model : table_lookup ;')
    expect(lib).toContain('time_unit : "1ns" ;')
    expect(lib).toContain('capacitive_load_unit (1, pf) ;')
    expect(lib).toContain('lu_table_template (delay_load) {')
    expect(lib).toContain('variable_1 : total_output_net_capacitance ;')
  })

  test('braces balance (a parseable library) and every gate is a cell', () => {
    const open = (lib.match(/\{/g) ?? []).length
    const close = (lib.match(/\}/g) ?? []).length
    expect(open).toBe(close)
    for (const block of STANDARD_CELL_BLOCKS) {
      expect(lib).toContain(`cell (cell_${block.name === 'Buffer' ? 'Buffer' : block.name})`)
    }
  })

  test('is deterministic', () => {
    expect(standardCellLib()).toBe(lib)
  })
})

describe('cellLiberty — real RC timing for every gate (composites included)', () => {
  // The load-dependent cell delay must be positive AND monotonic in load for ALL 8 gates. For the composite
  // gates this only holds if the writer flattened them to transistors before characterizing — otherwise R=0
  // and the delays collapse to zero. This is the load-bearing check of the transistor-flatten step.
  test.each(
    STANDARD_CELL_BLOCKS.map((b) => b.name),
  )('%s has positive, load-increasing delay', (name) => {
    const cell = cellLiberty(name)
    if (cell === undefined) throw new Error(`no cell for ${name}`)
    const rise = tableValues(cell, 'cell_rise')
    expect(rise).toHaveLength(2)
    expect(rise[0]).toBeGreaterThan(0)
    expect(rise[1]).toBeGreaterThan(rise[0] as number) // heavier load ⇒ slower
    // an output transition table too, also positive
    expect(tableValues(cell, 'rise_transition')[1]).toBeGreaterThan(0)
    // real input capacitance on every input pin
    for (const c of capOf(cell)) expect(c).toBeGreaterThan(0)
  })

  test('the boolean function + pin count match each gate', () => {
    expect(cellLiberty('NOT')).toContain('function : "A\'" ;')
    expect(cellLiberty('AND')).toContain('function : "(A * B)" ;')
    expect(cellLiberty('NAND')).toContain('function : "(A * B)\'" ;')
    expect(cellLiberty('XOR')).toContain('function : "(A ^ B)" ;')
    // NOT is a 1-input cell → pin A only, no B
    const not = cellLiberty('NOT') as string
    expect(not).toContain('pin (A)')
    expect(not).not.toContain('pin (B)')
    // NAND is 2-input → A and B
    const nand = cellLiberty('NAND') as string
    expect(nand).toContain('pin (A)')
    expect(nand).toContain('pin (B)')
  })

  test('timing sense is derived from the truth table', () => {
    // AND/OR/Buffer rise with their inputs; NAND/NOR/NOT invert; XOR/XNOR are non-unate.
    expect(new Set(senseOf(cellLiberty('AND') as string))).toEqual(new Set(['positive_unate']))
    expect(new Set(senseOf(cellLiberty('NOR') as string))).toEqual(new Set(['negative_unate']))
    expect(new Set(senseOf(cellLiberty('NOT') as string))).toEqual(new Set(['negative_unate']))
    expect(new Set(senseOf(cellLiberty('XOR') as string))).toEqual(new Set(['non_unate']))
  })

  test('an unknown cell name has no Liberty cell', () => {
    expect(cellLiberty('MYSTERY')).toBeUndefined()
  })
})

describe('floorplanToLib — only the cells a design uses', () => {
  const mk = (names: string[]): Floorplan => ({
    cells: names.map((name, i) => ({
      id: `c${i}`,
      name,
      x: i * 32,
      y: 0,
      w: 32,
      h: PROCESS.rowHeight.lambda,
      row: 0,
      reliable: true,
    })),
    rows: 1,
    dieWidthLambda: names.length * 32,
    dieHeightLambda: PROCESS.rowHeight.lambda,
    dieWidthUm: names.length * 32 * PROCESS.lambdaUm,
    dieHeightUm: PROCESS.rowHeight.lambda * PROCESS.lambdaUm,
    cellAreaLambda2: names.length * 32 * PROCESS.rowHeight.lambda,
    dieAreaLambda2: names.length * 32 * PROCESS.rowHeight.lambda,
    utilization: 1,
    anyUnreliable: false,
  })

  test('dedups the used cell types and black-lists the unknown', () => {
    const { text, cells, fallbacks } = floorplanToLib(mk(['NAND', 'NAND', 'NOT', 'MYSTERY']))
    expect(cells).toBe(2) // NAND + NOT (deduped); MYSTERY has no timing
    expect(fallbacks).toEqual(['MYSTERY'])
    expect(text).toContain('cell (cell_NAND)')
    expect(text).toContain('cell (cell_NOT)')
    expect(text).not.toContain('cell_MYSTERY')
    // still a closed, balanced library
    expect((text.match(/\{/g) ?? []).length).toBe((text.match(/\}/g) ?? []).length)
  })

  test('an empty floorplan yields a valid, cell-free library', () => {
    const { text, cells } = floorplanToLib(mk([]))
    expect(cells).toBe(0)
    expect(text).toContain(`library (${LIB_NAME}) {`)
    expect((text.match(/\{/g) ?? []).length).toBe((text.match(/\}/g) ?? []).length)
  })
})
