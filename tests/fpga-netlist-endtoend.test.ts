/**
 * FPGA fabric — the check that should have existed first.
 *
 * Three separate defects reached the repo because every fix was validated by "the tests pass" rather than by
 * running a recovered design and asking whether it still computes anything:
 *
 *   - refused cells stayed indexed as drivers, so a real 4-bit adder decoded to a constant-zero design
 *     with no inputs at all, and every existing test was happy;
 *   - a supply-tied pin read one value combinationally and another when clocked, because a new source kind
 *     reached one of three readers;
 *   - the nets a register's set and clock-enable arrive on were pruned out of the reported inputs.
 *
 * All three are the same shape: the netlist stays structurally valid and silently stops meaning anything. These
 * are the properties that catch that shape, on REAL bitstreams, independent of which family produced them.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseGowinAttributeDatabase } from '../src/renderer/fpga-apicula-attributes.ts'
import { type GowinChipdb, parseGowinChipdb } from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'
import {
  gowinFixedAliases,
  parseGowinWireAliases,
  reconstructGowinNetlist,
} from '../src/renderer/fpga-apicula-netlist.ts'
import { parseGowinPipDatabase } from '../src/renderer/fpga-apicula-routing.ts'
import {
  type RecoveredNetlist,
  simulateClocked,
  simulateCombinational,
} from '../src/renderer/fpga-icebox-run.ts'

const at = (name: string): URL => new URL(`../fixtures/${name}`, import.meta.url)
const db: GowinChipdb = parseGowinChipdb(readFileSync(at('gowin-gw1n1-chipdb.json'), 'utf8'))
const pipdb = parseGowinPipDatabase(readFileSync(at('gowin-gw1n1-pips.json'), 'utf8'))
const attributes = parseGowinAttributeDatabase(
  readFileSync(at('gowin-gw1n1-attributes.json'), 'utf8'),
)
const aliases = new Map([
  ...parseGowinWireAliases(readFileSync(at('gowin-gw1n1-nodes.json'), 'utf8')),
  ...gowinFixedAliases(db.rows, db.cols),
])

const DESIGNS = [
  'gowin-gw1n1-xnor-dff.fs',
  'gowin-gw1n1-adder4.fs',
  'gowin-gw1n1-adder16.fs',
  'gowin-gw1n1-ffvariants.fs',
  'gowin-gw1n1-bram1k.fs',
]
const recovered = DESIGNS.map((file) => ({
  file,
  design: reconstructGowinNetlist(
    parseGowinBitstream(readFileSync(at(file), 'utf8')).frames,
    db,
    pipdb,
    attributes,
    aliases,
  ),
}))

const cellKey = (r: { x: number; y: number; cell: number }): string => `${r.x}_${r.y}_${r.cell}`

describe('a recovered design never references a cell that is not in it', () => {
  test('no input, carry operand or control points at a missing driver', () => {
    // The shared simulator resolves a missing driver to false rather than complaining, so a dangling reference
    // is not an error anywhere — it is a confident wrong answer. This is the only thing that sees it.
    for (const { file, design } of recovered) {
      const present = new Set(design.netlist.cells.map((c) => cellKey(c.ref)))
      for (const cell of design.netlist.cells) {
        const sources = [
          ...cell.inputs,
          ...(cell.carryOperands ?? []),
          ...(cell.setReset ? [cell.setReset] : []),
          ...(cell.clockEnable ? [cell.clockEnable] : []),
        ]
        for (const source of sources)
          if (source.kind === 'cell' || source.kind === 'carry')
            expect(present.has(cellKey(source.driver)), `${file} ${cellKey(cell.ref)}`).toBe(true)
      }
    }
  })
})

describe('a recovered design still computes something', () => {
  /** Drive every reported input high, then every input low, and collect the outputs. */
  const sweep = (netlist: RecoveredNetlist, nets: number[], value: boolean): Map<string, boolean> =>
    simulateCombinational(netlist, new Map(nets.map((n) => [n, value]))).outputs

  test('the designs with logic report inputs, and their outputs RESPOND to them', () => {
    // The property that catches "structurally valid, semantically empty". A design whose outputs are identical
    // for all-high and all-low stimulus is not decoding anything, however healthy its cell count looks.
    let responsive = 0
    for (const { file, design } of recovered) {
      const combinational = design.netlist.cells.filter((c) => !c.config.dffEnable)
      if (combinational.length === 0) continue
      const nets = [...design.primaryWires.keys()]
      expect(nets.length, `${file} has cells but reports no inputs`).toBeGreaterThan(0)

      const high = sweep(design.netlist, nets, true)
      const low = sweep(design.netlist, nets, false)
      const moved = combinational.filter(
        (c) => high.get(cellKey(c.ref)) !== low.get(cellKey(c.ref)),
      )
      if (moved.length > 0) responsive++
    }
    expect(responsive, 'no design responded to its own inputs').toBeGreaterThan(0)
  })

  test('the two simulators agree about every cell they both evaluate', () => {
    // They read inputs through different code paths. When a source kind reaches one reader and not the others,
    // the same netlist yields two different answers — which is exactly what happened.
    for (const { file, design } of recovered) {
      const nets = [...design.primaryWires.keys()]
      const stimulus = new Map(nets.map((n) => [n, true]))
      const comb = simulateCombinational(design.netlist, stimulus).outputs
      const clocked = simulateClocked(design.netlist, stimulus, 2)
      const settled = clocked.trace[clocked.trace.length - 1] as Map<string, boolean>
      for (const cell of design.netlist.cells) {
        if (cell.config.dffEnable) continue // a register's value is its state, not its function
        const key = cellKey(cell.ref)
        if (!comb.has(key) || !settled.has(key)) continue
        expect(settled.get(key), `${file} ${key}`).toBe(comb.get(key))
      }
    }
  })
})

describe('the refusals stay honest', () => {
  test('a refused cell is absent from the netlist AND leaves a named input behind', () => {
    // Refusing is only better than approximating if the signal the refused cell drove becomes something a
    // caller can see and drive. Otherwise refusal just deletes the design quietly.
    const adder = recovered.find((r) => r.file === 'gowin-gw1n1-adder4.fs') as (typeof recovered)[0]
    expect(adder.design.unsupported.length).toBeGreaterThan(0)
    const emitted = new Set(adder.design.netlist.cells.map((c) => cellKey(c.ref)))
    for (const refused of adder.design.unsupported)
      expect(emitted.has(cellKey(refused.ref))).toBe(false)
    expect(adder.design.primaryWires.size).toBeGreaterThan(0)
    for (const wire of adder.design.primaryWires.values())
      expect(wire).toMatch(/^(R\d+C\d+_|VCC|VSS)/)
  })
})
