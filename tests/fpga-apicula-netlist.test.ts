/**
 * FPGA fabric — Gowin: a real bitstream reaches the SHARED simulator.
 *
 * Everything up to here decoded a bitstream into parts. This joins them and runs the result through
 * `simulateCombinational` — the same simulator the iCE40 and ECP5 families use. The test that matters is the
 * last one: the recovered logic has to compute XNOR, because that is what the Verilog said, and nothing in the
 * decode path was told what the design does.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  type GowinChipdb,
  gowinTileAt,
  parseGowinChipdb,
} from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'
import { gowinGlobalWire, reconstructGowinNetlist } from '../src/renderer/fpga-apicula-netlist.ts'
import {
  type GowinPipDatabase,
  parseGowinPipDatabase,
} from '../src/renderer/fpga-apicula-routing.ts'
import { simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'

const db: GowinChipdb = parseGowinChipdb(
  readFileSync(new URL('../fixtures/gowin-gw1n1-chipdb.json', import.meta.url), 'utf8'),
)
const pipdb: GowinPipDatabase = parseGowinPipDatabase(
  readFileSync(new URL('../fixtures/gowin-gw1n1-pips.json', import.meta.url), 'utf8'),
)
const framesOf = (name: string): boolean[][] =>
  parseGowinBitstream(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')).frames

const xnor = framesOf('gowin-gw1n1-xnor-dff.fs')
const adder = framesOf('gowin-gw1n1-adder4.fs')

describe('gowinGlobalWire — reconciling wire names across tiles', () => {
  test('a tile-local wire keeps its tile', () => {
    expect(gowinGlobalWire(9, 2, 'A0', 11, 20)).toBe('R9C2_A0')
    expect(gowinGlobalWire(1, 1, 'F6', 11, 20)).toBe('R1C1_F6')
  })

  test('constants are not tile-scoped', () => {
    expect(gowinGlobalWire(5, 5, 'VCC', 11, 20)).toBe('VCC')
    expect(gowinGlobalWire(5, 5, 'VSS', 11, 20)).toBe('VSS')
  })

  test('an inter-tile wire is named after the tile it STARTS in', () => {
    // `N111` is a north wire whose segment digit is 1, so it originates one tile north.
    expect(gowinGlobalWire(9, 2, 'N111', 11, 20)).toBe('R10C2_N11')
    // and the same copper seen from that tile resolves to the same name, which is the whole point
    expect(gowinGlobalWire(10, 2, 'N110', 11, 20)).toBe('R10C2_N11')
  })

  test('wires running off the edge turn back rather than being clamped', () => {
    // `S112` in row 1 originates two tiles SOUTH, which is off the die at row -1. It reflects to row 2 and the
    // direction flips to north: R2C5_N11. Clamping to the edge instead would merge two genuinely different
    // wires onto one name.
    const reflected = gowinGlobalWire(1, 5, 'S112', 11, 20)
    expect(reflected).toBe('R2C5_N11')
    expect(reflected).not.toBe('R1C5_S11')
    // the same reflection at the far edge, where the fabric is 11 rows tall
    expect(gowinGlobalWire(11, 5, 'N112', 11, 20)).toBe('R10C5_S11')
  })
})

describe('reconstructGowinNetlist — the XNOR design', () => {
  const design = reconstructGowinNetlist(xnor, db, pipdb)

  test('recovers exactly one lookup table, with the XNOR truth table', () => {
    expect(design.cells).toHaveLength(1)
    expect((design.cells[0] as { init: number }).init).toBe(0x9999)
    expect(design.netlist.cells).toHaveLength(1)
  })

  test('the recovered routing spans tiles, so wire names really were reconciled', () => {
    // If globalisation were skipped, every driver key would carry its own tile's name and no connection would
    // ever join two tiles. Check that at least one driver pair names two DIFFERENT tiles.
    const crossing = [...design.drivers.entries()].filter(([dest, src]) => {
      const a = /^R(\d+)C(\d+)_/.exec(dest)
      const b = /^R(\d+)C(\d+)_/.exec(src)
      return a !== null && b !== null && (a[1] !== b[1] || a[2] !== b[2])
    })
    expect(crossing.length).toBeGreaterThan(0)
  })

  test('the two data inputs trace back to real wires, named', () => {
    const cell = design.netlist.cells[0] as { inputs: { kind: string; net?: number }[] }
    const primaries = cell.inputs.filter((i) => i.kind === 'primary')
    expect(primaries.length).toBeGreaterThanOrEqual(2)
    for (const input of primaries)
      expect(design.primaryWires.get(input.net as number)).toMatch(/^R\d+C\d+_/)
  })

  test('THE PAYOFF — the recovered logic computes XNOR in the shared simulator', () => {
    // The decode path was never told what this design does. It read bits out of a real bitstream, worked out a
    // truth table, resolved wire names across tiles, and handed the result to the SAME simulator the iCE40 and
    // ECP5 families use. If any layer were wrong, this would not come out as XNOR.
    const cell = design.netlist.cells[0] as {
      ref: { x: number; y: number; cell: number }
      inputs: { kind: string; net?: number }[]
    }
    const nets = cell.inputs.filter((i) => i.kind === 'primary').map((i) => i.net as number)
    const [first, second] = [nets[0] as number, nets[1] as number]
    const key = `${cell.ref.x}_${cell.ref.y}_${cell.ref.cell}`

    for (const a of [false, true])
      for (const b of [false, true]) {
        const values = new Map<number, boolean>([
          [first, a],
          [second, b],
        ])
        const result = simulateCombinational(design.netlist, values)
        expect(result.outputs.get(key), `a=${a} b=${b}`).toBe(a === b)
      }
  })
})

describe('reconstructGowinNetlist — the adder design', () => {
  const design = reconstructGowinNetlist(adder, db, pipdb)

  test('recovers more logic than the single-gate design', () => {
    expect(design.cells.length).toBeGreaterThan(1)
    expect(design.netlist.cells).toHaveLength(design.cells.length)
  })

  test('every recovered cell has a full four-entry input list and a 16-entry truth table', () => {
    for (const cell of design.netlist.cells) {
      expect(cell.inputs).toHaveLength(4)
      expect(cell.config.truth).toHaveLength(16)
    }
  })

  test('every primary input is NAMED after the wire it dead-ended at', () => {
    // A design is not allowed to start from nowhere. Each primary must point at a real piece of copper, so a
    // caller can tell an external pin from a trace that gave up.
    const primaries = design.netlist.cells.flatMap((c) =>
      c.inputs.filter((i) => i.kind === 'primary'),
    )
    expect(primaries.length).toBeGreaterThan(0)
    for (const input of primaries) {
      const wire = design.primaryWires.get((input as { net: number }).net)
      expect(wire, JSON.stringify(input)).toBeDefined()
      expect(wire).toMatch(/^(R\d+C\d+_|VCC|VSS)/)
    }
  })

  test('one wire feeding several pins is ONE net, not several', () => {
    // Fan-out has to survive the trace: if each pin minted its own primary net, driving the input would only
    // move one of them and the simulation would silently disagree with the hardware.
    const seen = new Map<string, number>()
    for (const cell of design.netlist.cells)
      for (const input of cell.inputs) {
        if (input.kind !== 'primary') continue
        const wire = design.primaryWires.get(input.net) as string
        const existing = seen.get(wire)
        if (existing !== undefined) expect(input.net).toBe(existing)
        seen.set(wire, input.net)
      }
    expect(seen.size).toBe(design.primaryWires.size)
  })
})

describe('the netlist is built from the fabric, not from assumptions', () => {
  test('a blank device yields no cells at all', () => {
    const blank = Array.from({ length: db.bitmapRows }, () =>
      new Array<boolean>(db.bitmapCols).fill(false),
    )
    const design = reconstructGowinNetlist(blank, db, pipdb)
    expect(design.cells).toHaveLength(0)
    expect(design.netlist.cells).toHaveLength(0)
  })

  test('the cell reference points at the tile the lookup table really lives in', () => {
    const design = reconstructGowinNetlist(xnor, db, pipdb)
    const cell = design.cells[0] as { row: number; col: number; ref: { x: number; y: number } }
    expect(gowinTileAt(db, cell.row, cell.col)).not.toBeNull()
    expect([cell.ref.y, cell.ref.x]).toEqual([cell.row, cell.col])
  })
})
