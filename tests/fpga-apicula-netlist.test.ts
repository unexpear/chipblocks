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
import { parseGowinAttributeDatabase } from '../src/renderer/fpga-apicula-attributes.ts'
import {
  type GowinChipdb,
  gowinTileAt,
  parseGowinChipdb,
} from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'
import {
  GOWIN_FALLING_EDGE,
  gowinFixedAliases,
  gowinGlobalWire,
  parseGowinWireAliases,
  reconstructGowinNetlist,
} from '../src/renderer/fpga-apicula-netlist.ts'
import {
  type GowinPipDatabase,
  parseGowinPipDatabase,
} from '../src/renderer/fpga-apicula-routing.ts'
import { simulateClocked, simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'

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

  test('the shared simulator reports the cell as REGISTERED, needing a clocked run', () => {
    // The design's only cell is clocked, so the combinational simulator correctly declines to give it a value
    // and lists it as registered instead. Asserting that here is what makes the clocked test below meaningful:
    // it shows the register is real rather than the clocked run just re-deriving a combinational answer.
    const cell = design.netlist.cells[0] as { ref: { x: number; y: number; cell: number } }
    const result = simulateCombinational(design.netlist, new Map())
    expect(result.registered.map((r) => `${r.x}_${r.y}_${r.cell}`)).toContain(
      `${cell.ref.x}_${cell.ref.y}_${cell.ref.cell}`,
    )
  })

  test('the recovered truth table IS exclusive-NOR, entry by entry', () => {
    // The lookup table's own function, checked directly: entry i is 1 exactly when the two used inputs agree.
    const truth = (design.netlist.cells[0] as { config: { truth: boolean[] } }).config.truth
    for (let entry = 0; entry < 16; entry++)
      expect(truth[entry], `entry ${entry}`).toBe(((entry >> 0) & 1) === ((entry >> 1) & 1))
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

/**
 * Attaching the flip-flops and the carry chain.
 *
 * The flip-flop MODE decodes even on a blank tile — the fabric's default is a settable flip-flop — so the mode
 * alone cannot tell us a register is in use. A CLOCK routed to the cell is what can: an unclocked flip-flop
 * holds nothing. That is the evidence used here, and the two designs disagree in exactly the way they should.
 */
describe('flip-flops and carry attached to the netlist', () => {
  const attributes = parseGowinAttributeDatabase(
    readFileSync(new URL('../fixtures/gowin-gw1n1-attributes.json', import.meta.url), 'utf8'),
  )
  const xnorDesign = reconstructGowinNetlist(xnor, db, pipdb, attributes)
  const adderDesign = reconstructGowinNetlist(adder, db, pipdb, attributes)

  test('the XNOR design has one clocked cell, a plain rising-edge flip-flop', () => {
    const registered = xnorDesign.netlist.cells.filter((c) => c.config.dffEnable)
    expect(registered).toHaveLength(1)
    expect((xnorDesign.cells[0] as { flipFlop: string | null }).flipFlop).toBe('DFF')
    // `DFF` is the plain variant: rising edge, no set or reset, matching `always @(posedge clk)`
    expect(GOWIN_FALLING_EDGE.has('DFF')).toBe(false)
    expect(registered[0]?.config.setNoReset).toBe(false)
    expect(registered[0]?.config.asyncSetReset).toBe(false)
  })

  test('the adder recovers FOUR registered cells — one per bit of sum[3:0]', () => {
    const registered = adderDesign.netlist.cells.filter((c) => c.config.dffEnable)
    expect(registered).toHaveLength(4)
  })

  test('the adder’s arithmetic cells are REFUSED, not approximated', () => {
    // An arithmetic cell outputs its lookup table XORed with the incoming carry. The shared cell has no way to
    // say that, and an earlier version emitted the lookup table alone — which made the adder cell compute `a`
    // instead of `a XOR b XOR carry`, in a netlist that looked perfectly ordinary. Refusing is the honest form.
    expect(adderDesign.unsupported.length).toBeGreaterThan(0)
    for (const refused of adderDesign.unsupported) expect(refused.kind).toBe('carry')
    // and none of them slipped through as a plain cell
    expect(adderDesign.netlist.cells.filter((c) => c.config.carryEnable)).toHaveLength(0)
    const refusedKeys = new Set(
      adderDesign.unsupported.map((r) => `${r.ref.x}_${r.ref.y}_${r.ref.cell}`),
    )
    for (const cell of adderDesign.netlist.cells)
      expect(refusedKeys.has(`${cell.ref.x}_${cell.ref.y}_${cell.ref.cell}`)).toBe(false)
  })

  test('the design that uses no arithmetic refuses nothing', () => {
    // The negative half: a decoder that refused everything would pass the test above.
    expect(xnorDesign.unsupported).toEqual([])
    expect(xnorDesign.netlist.cells.length).toBeGreaterThan(0)
  })

  test('the refused cells are exactly the ones decoded as arithmetic', () => {
    // Cross-checks the refusal against the separate carry decoder rather than trusting the netlist layer alone.
    const decodedCarry = new Set(
      adderDesign.cells.filter((c) => c.carry).map((c) => `${c.col}_${c.row}_${c.ref.cell}`),
    )
    const refused = new Set(
      adderDesign.unsupported.map((r) => `${r.ref.x}_${r.ref.y}_${r.ref.cell}`),
    )
    expect(refused).toEqual(decodedCarry)
    expect(refused.size).toBe(6)
  })

  test('THE PAYOFF — the recovered flip-flop holds the XNOR result across clock cycles', () => {
    // A clocked run of a design read out of a real bitstream. The register should present the PREVIOUS cycle's
    // XNOR, which is exactly what `q <= a XNOR b` means: one cycle of delay.
    const cell = xnorDesign.netlist.cells[0] as {
      ref: { x: number; y: number; cell: number }
      inputs: { kind: string; net?: number }[]
    }
    const nets = cell.inputs.filter((i) => i.kind === 'primary').map((i) => i.net as number)
    const [first, second] = [nets[0] as number, nets[1] as number]
    const key = `${cell.ref.x}_${cell.ref.y}_${cell.ref.cell}`

    // four cycles of (a, b): (0,0) (1,0) (1,1) (0,1) -> XNOR is 1, 0, 1, 0
    const a = [false, true, true, false]
    const b = [false, false, true, true]
    const stimulus = a.map(
      (_, cycle) =>
        new Map<number, boolean>([
          [first, a[cycle] as boolean],
          [second, b[cycle] as boolean],
        ]),
    )
    const result = simulateClocked(xnorDesign.netlist, stimulus, 4)
    expect(result.trace).toHaveLength(4)
    // the register lags by one cycle, so from cycle 1 onward it shows the previous cycle's XNOR
    for (let cycle = 1; cycle < 4; cycle++)
      expect(result.trace[cycle]?.get(key), `cycle ${cycle}`).toBe(a[cycle - 1] === b[cycle - 1])
    expect(result.finalState.get(key)).toBe(a[3] === b[3])
  })
})

/**
 * Pins a lookup table IGNORES are not inputs to the design.
 *
 * A Gowin cell has four inputs; a two-input gate leaves two of them doing nothing, and the fabric still routes
 * something to them. Counting those as chip inputs invents signals the design does not have.
 */
describe('unused lookup-table pins are not mistaken for chip inputs', () => {
  const design = reconstructGowinNetlist(xnor, db, pipdb)

  test('the XNOR cell reads TWO inputs, not four', () => {
    const cell = design.netlist.cells[0] as { inputs: { kind: string }[] }
    expect(cell.inputs.filter((i) => i.kind !== 'unused')).toHaveLength(2)
    expect(cell.inputs.filter((i) => i.kind === 'unused')).toHaveLength(2)
  })

  test('and the design reports exactly two external signals', () => {
    // Before this, the two ignored pins each dead-ended on a wire and were reported as chip inputs, so a
    // two-input gate claimed four.
    expect(design.primaryWires.size).toBe(2)
  })

  test('the masked pins are the ones the truth table really ignores', () => {
    // 0x9999 depends on inputs 0 and 1 only: entry i is 1 exactly when bit0 == bit1, whatever bits 2 and 3 do.
    const cell = design.netlist.cells[0] as {
      inputs: { kind: string }[]
      config: { truth: boolean[] }
    }
    for (let pin = 0; pin < 4; pin++) {
      let matters = false
      for (let entry = 0; entry < 16; entry++)
        if (
          ((entry >> pin) & 1) === 0 &&
          cell.config.truth[entry] !== cell.config.truth[entry | (1 << pin)]
        )
          matters = true
      expect(cell.inputs[pin]?.kind === 'unused', `pin ${pin}`).toBe(!matters)
    }
  })

  test('every reported external signal is still reachable by name', () => {
    for (const cell of design.netlist.cells)
      for (const input of cell.inputs) {
        if (input.kind !== 'primary') continue
        expect(design.primaryWires.get(input.net)).toBeDefined()
      }
  })

  test('the don’t-care mask still applies to ordinary cells, and no carry leaks through', () => {
    // The carry-operand bypass this test used to check is gone with the cells it protected — arithmetic cells
    // are now refused outright. What must still hold is that a masked pin is masked, and that nothing claims to
    // be a carry cell.
    const attributes = parseGowinAttributeDatabase(
      readFileSync(new URL('../fixtures/gowin-gw1n1-attributes.json', import.meta.url), 'utf8'),
    )
    const design = reconstructGowinNetlist(adder, db, pipdb, attributes)
    for (const cell of design.netlist.cells) {
      expect(cell.config.carryEnable).toBe(false)
      expect(cell.carryOperands ?? null).toBeNull()
      for (let pin = 0; pin < 4; pin++) {
        let matters = false
        for (let entry = 0; entry < 16; entry++)
          if (
            ((entry >> pin) & 1) === 0 &&
            cell.config.truth[entry] !== cell.config.truth[entry | (1 << pin)]
          )
            matters = true
        if (!matters) expect(cell.inputs[pin]?.kind).toBe('unused')
      }
    }
  })
})

/**
 * Wire equivalences from the device database.
 *
 * `gowinGlobalWire` reconciles directional wires by arithmetic, but the global clock network is named quite
 * differently in each tile it crosses — `PCLKL1` here, `SPINE16` there, `GT00` further on — and no arithmetic
 * relates those. The database records which names are the same copper; without applying it a routed clock reads
 * as several disconnected fragments.
 */
describe('parseGowinWireAliases — joining wires the arithmetic cannot', () => {
  const aliases = parseGowinWireAliases(
    readFileSync(new URL('../fixtures/gowin-gw1n1-nodes.json', import.meta.url), 'utf8'),
  )

  test('the database yields thousands of equivalences', () => {
    expect(aliases.size).toBeGreaterThan(3000)
  })

  test('a group collapses to its SHORTEST name, as Apicula chooses it', () => {
    // Both sides must pick the same canonical name or the two decoders would disagree about wire identity.
    for (const [name, root] of aliases) {
      const wireOf = (full: string): string => full.slice(full.indexOf('_') + 1)
      expect(wireOf(root).length, `${name} -> ${root}`).toBeLessThanOrEqual(wireOf(name).length)
    }
  })

  test('applying them JOINS routing that was otherwise in fragments', () => {
    // Measured, not asserted by construction: the same bitstream decoded with and without the table.
    const countNets = (aliasTable: ReadonlyMap<string, string> | null): number => {
      const design = reconstructGowinNetlist(xnor, db, pipdb, null, aliasTable)
      const wires = new Set<string>()
      for (const [to, from] of design.drivers) {
        wires.add(to)
        wires.add(from)
      }
      const parent = new Map<string, string>([...wires].map((w) => [w, w]))
      const find = (x: string): string => {
        let root = x
        while (parent.get(root) !== root) root = parent.get(root) as string
        return root
      }
      for (const [to, from] of design.drivers) parent.set(find(to), find(from))
      return new Set([...wires].map(find)).size
    }
    const fragmented = countNets(null)
    const joined = countNets(aliases)
    expect(joined).toBeLessThan(fragmented)
    expect([fragmented, joined]).toEqual([9, 7])
  })

  test('applying them does not change the recovered LOGIC', () => {
    // Joining wires must not invent or destroy cells: the same lookup table, with the same truth table.
    const plain = reconstructGowinNetlist(xnor, db, pipdb)
    const aliased = reconstructGowinNetlist(xnor, db, pipdb, null, aliases)
    expect(aliased.cells).toHaveLength(plain.cells.length)
    expect((aliased.cells[0] as { init: number }).init).toBe(
      (plain.cells[0] as { init: number }).init,
    )
  })

  test('cell-output wires are NOT covered, which is the remaining blocker', () => {
    // Stated as a test so the limit is not quietly assumed away. A lookup table's output as named from the tile
    // next door is absent from the table, so it still does not join up — and that is exactly what stands between
    // this and naming a design's package pins.
    const outputNames = [...aliases.keys()].filter((n) => /_(F|Q)\d+$/.test(n))
    expect(outputNames).toHaveLength(0)
  })
})

/**
 * The fixed per-tile equivalences, which the database does NOT list because they are pure geometry.
 *
 * A hop between neighbouring tiles is called `N1x1` from one end and `S1x1` from the other, and both are the
 * tile's shared `SN{x}0`. Without them a signal leaving a cell and entering its neighbour is two unrelated
 * wires, so a trace stops dead at the tile boundary.
 */
describe('gowinFixedAliases — the equivalences that are generated, not stored', () => {
  const nodeAliases = parseGowinWireAliases(
    readFileSync(new URL('../fixtures/gowin-gw1n1-nodes.json', import.meta.url), 'utf8'),
  )
  const fixed = gowinFixedAliases(db.rows, db.cols)
  const both = new Map([...nodeAliases, ...fixed])

  const countNets = (aliases: ReadonlyMap<string, string> | null): number => {
    const design = reconstructGowinNetlist(xnor, db, pipdb, null, aliases)
    const wires = new Set<string>()
    for (const [to, from] of design.drivers) {
      wires.add(to)
      wires.add(from)
    }
    const parent = new Map<string, string>([...wires].map((w) => [w, w]))
    const find = (x: string): string => {
      let root = x
      while (parent.get(root) !== root) root = parent.get(root) as string
      return root
    }
    for (const [to, from] of design.drivers) parent.set(find(to), find(from))
    return new Set([...wires].map(find)).size
  }

  test('covers both directions of both axes, for every tile', () => {
    // four aliases per (tile, index) pair, two indices, but ends of the die fold back and collide - so the
    // count is bounded by, not equal to, rows x cols x 8.
    expect(fixed.size).toBeGreaterThan(1000)
    expect(fixed.size).toBeLessThanOrEqual(db.rows * db.cols * 8)
  })

  test('the north hop into a tile is the same wire as that tile’s shared segment', () => {
    // The specific equivalence that unblocked the trace below, checked by name.
    expect(fixed.get('R11C3_N11')).toBe('R11C3_SN10')
  })

  test('they join MORE than the database table does on its own', () => {
    const alone = countNets(nodeAliases)
    const combined = countNets(both)
    expect(combined).toBeLessThan(alone)
    expect([countNets(null), alone, combined]).toEqual([9, 7, 6])
  })

  test('the design’s inputs now reach the I/O tile instead of stopping mid-fabric', () => {
    // Before: the trace died on interconnect wires part-way across the chip. After: both inputs arrive at cell
    // outputs in ONE tile on the chip's edge - which is where a signal from a package pin should appear.
    const before = reconstructGowinNetlist(xnor, db, pipdb, null, nodeAliases)
    const after = reconstructGowinNetlist(xnor, db, pipdb, null, both)
    expect([...before.primaryWires.values()].some((w) => /_N\d+$/.test(w))).toBe(true)
    const wires = [...after.primaryWires.values()]
    expect(wires).toHaveLength(2)
    for (const wire of wires) expect(wire).toMatch(/^R\d+C\d+_[FQ]\d+$/)
    // and both land in the SAME edge tile, as two pins of one I/O block would
    expect(new Set(wires.map((w) => w.slice(0, w.indexOf('_')))).size).toBe(1)
  })

  test('joining more wires still does not change the recovered logic', () => {
    const plain = reconstructGowinNetlist(xnor, db, pipdb)
    const aliased = reconstructGowinNetlist(xnor, db, pipdb, null, both)
    expect(aliased.cells).toHaveLength(plain.cells.length)
    expect((aliased.cells[0] as { init: number }).init).toBe(
      (plain.cells[0] as { init: number }).init,
    )
    expect(aliased.netlist.cells[0]?.config.truth).toEqual(plain.netlist.cells[0]?.config.truth)
  })
})
