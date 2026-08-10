/**
 * FPGA fabric — iCE40: an UNROUTED LUT pin is a tied-low pin, not a drivable input.
 *
 * `reconstructNetlist` used to end every unresolved trace with `{ kind: 'primary' }`. That is right for a pin the
 * bitstream ROUTED whose driver lies outside what we trace (an IO block, a global net) — but it was also applied
 * to a pin with no driver pip at all, which is not a signal from anywhere. It is a pin the vendor never routed,
 * and an unrouted iCE40 input reads LOW on real silicon.
 *
 * THE ORACLE IS THE VENDOR'S OWN, twice over:
 *
 *   1. The RULE. icebox_vlog — icebox's own bitstream-to-Verilog recovery — resolves a LUT input with
 *      `seg_to_net((x, y, "lutff_N/in_p"), "1'b0")`: a segment no routing reaches becomes the constant `1'b0`,
 *      never a module port. (Its carry branch re-fetches in_1/in_2 with the same default, which is why the carry
 *      operands follow the same rule here.)
 *
 *   2. The NUMBERS. `icebox-ice40-{384,1k}-vendor-xor5.bin` are real bitstreams built from
 *      `module top(input [4:0] i, output y); assign y = ^i; endmodule` through yosys -> nextpnr-ice40 -> icepack
 *      (lp384/qn32 and hx1k/tq144, seed 1). Beside each one is the `icebox_vlog` recovery of the SAME `.asc`,
 *      vendored verbatim as `.icebox_vlog.v`, and every count below is read out of that file rather than written
 *      down here: the module port list says how many inputs the design has, and the wire-dump comments say
 *      exactly which LUT input pins carry routing. Both `.bin` and `.icebox_vlog.v` are generated artefacts of
 *      OUR OWN design produced with the ISC-licensed IceStorm tools, like the other `.bin` fixtures.
 *
 * Before the fix, a real 2-flip-flop nextpnr bitstream came back with 11 primary inputs for a design the vendor
 * declares with one data input, and driving any one of the ten invented ones collapsed the simulation to 0.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { CanvasNodeLike } from '../src/renderer/blocks.ts'
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import { lowerNetlistToCanvas } from '../src/renderer/fpga-icebox-canvas.ts'
import { type Ice40ChipDb, loadIce40Bitstream } from '../src/renderer/fpga-icebox-load.ts'
import { type LcConfig, parseLogicTileBits } from '../src/renderer/fpga-icebox-logic.ts'
import type { ParsedDesign } from '../src/renderer/fpga-icebox-parse.ts'
import {
  type InputSource,
  type RecoveredCell,
  reconstructNetlist,
  simulateCombinational,
} from '../src/renderer/fpga-icebox-run.ts'
import { buildWireIndex } from '../src/renderer/fpga-icebox-synth.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const LAYOUT = parseLogicTileBits(fixture('icebox-ice40-384-logic-tile-bits.chipdb'))

/** The vendor's own answer for one design, read out of the vendored `icebox_vlog` recovery. */
function vendorTruth(vlog: string): { inputs: number; routedPins: Set<string> } {
  const header = /^module chip \(([^)]*)\)/m.exec(vlog)
  if (header === null)
    throw new Error('no `module chip (...)` header in the vendored icebox_vlog output')
  const inputs = (header[1] as string)
    .split(',')
    .filter((p) => p.trim().startsWith('input ')).length
  const routedPins = new Set<string>()
  for (const m of vlog.matchAll(/\/\/ \((\d+), (\d+), '(lutff_\d+\/in_\d+)'\)/g))
    routedPins.add(`${m[1]}_${m[2]}_${m[3]}`)
  return { inputs, routedPins }
}

const VENDOR = [
  { device: '384', bin: 'icebox-ice40-384-vendor-xor5.bin' },
  { device: '1k', bin: 'icebox-ice40-1k-vendor-xor5.bin' },
] as const

describe('a real vendor bitstream reports exactly the inputs the vendor declares', () => {
  for (const { device, bin } of VENDOR) {
    const chipdb = parseIceboxChipdb(fixture(`icebox-ice40-${device}-chipdb.txt`))
    const chipdbs: Record<string, Ice40ChipDb> = { [device]: { device: chipdb, layout: LAYOUT } }
    const loaded = loadIce40Bitstream(
      new Uint8Array(readFileSync(new URL(`../fixtures/${bin}`, import.meta.url))),
      chipdbs,
    )
    if (!loaded.ok) throw new Error(`could not load ${bin}: ${loaded.reason}`)
    const truth = vendorTruth(fixture(`${bin.replace(/\.bin$/, '')}.icebox_vlog.v`))
    const wireIndex = buildWireIndex(chipdb)
    const primaryNets = [
      ...new Set(
        loaded.netlist.cells.flatMap((c) =>
          c.inputs.filter((i) => i.kind === 'primary').map((i) => i.net),
        ),
      ),
    ]

    test(`${device}: the recovered primary-input count equals the vendor's module input count`, () => {
      expect(loaded.crcOk).toBe(true)
      expect(truth.inputs).toBe(5) // the design is `assign y = ^i` over a 5-bit input
      expect(primaryNets).toHaveLength(truth.inputs)
    })

    test(`${device}: every pin icebox_vlog leaves unrouted comes back tied LOW, and only those`, () => {
      // The per-pin identity, both directions — not just the totals agreeing by luck.
      const tied: string[] = []
      const sourced: string[] = []
      for (const cell of loaded.netlist.cells)
        cell.inputs.forEach((source, pin) => {
          const name = `${cell.ref.x}_${cell.ref.y}_lutff_${cell.ref.cell}/in_${pin}`
          if (source.kind === 'unused') return // the LUT ignores it; it carries no value either way
          if (source.kind === 'const') {
            expect(source.value).toBe(false) // an unrouted iCE40 pin reads LOW, never HIGH
            tied.push(name)
          } else sourced.push(name)
        })
      expect(tied.length).toBeGreaterThan(0) // this design really does exercise the case
      for (const name of tied) expect(truth.routedPins.has(name)).toBe(false)
      for (const name of sourced) expect(truth.routedPins.has(name)).toBe(true)
    })

    test(`${device}: no reported primary is a LUT pin's own wire — the phantom signature is gone`, () => {
      // A phantom always named the pin's OWN wire index, because the backward trace never moved. A genuine
      // primary names the wire the routing dead-ended at, which is somewhere else entirely.
      const ownPinWires = new Set<number>()
      for (const cell of loaded.netlist.cells)
        for (const pin of [0, 1, 2, 3]) {
          const w = wireIndex.get(`${cell.ref.x}_${cell.ref.y}_lutff_${cell.ref.cell}/in_${pin}`)
          if (w !== undefined) ownPinWires.add(w)
        }
      for (const net of primaryNets) expect(ownPinWires.has(net)).toBe(false)
    })

    test(`${device}: driving the five recovered inputs computes the design's function (parity), all 32 cases`, () => {
      // The end-to-end payoff, on a bitstream the vendor toolchain produced: the recovered inputs are the real
      // ones, so sweeping them reproduces `y = ^i` exactly. Exactly one recovered cell is the design's output.
      const parityCells = loaded.netlist.cells.filter((cell) => {
        const key = `${cell.ref.x}_${cell.ref.y}_${cell.ref.cell}`
        for (let pattern = 0; pattern < 32; pattern++) {
          const stimulus = new Map(primaryNets.map((net, k) => [net, ((pattern >> k) & 1) === 1]))
          let parity = false
          for (let k = 0; k < 5; k++) parity = parity !== (((pattern >> k) & 1) === 1)
          if (simulateCombinational(loaded.netlist, stimulus).outputs.get(key) !== parity)
            return false
        }
        return true
      })
      expect(parityCells).toHaveLength(1)
    })
  }
})

// --- hand-built devices: the rule is a classification, not a blanket refusal ---

const comb = (truth: boolean[]): LcConfig => ({
  truth,
  carryEnable: false,
  dffEnable: false,
  setNoReset: false,
  asyncSetReset: false,
})
const BUF16 = Array.from({ length: 16 }, (_, i) => (i & 1) === 1)
const AND2_16 = Array.from({ length: 16 }, (_, i) => (i & 1) === 1 && ((i >> 1) & 1) === 1)

describe('the rule is a classification, not a blanket refusal', () => {
  test('a ROUTED pin whose driver lies outside the design is still a primary input', () => {
    const dev = parseIceboxChipdb(
      [
        '.device T 8 8 5',
        '.net 0',
        '1 1 lutff_0/in_0',
        '.net 1',
        '1 1 lutff_0/in_1', // routed from the external net below
        '.net 2',
        '1 1 lutff_0/out',
        '.net 100',
        '0 1 glb_netwk_0', // an external signal, driven by no cell
        '.buffer 1 1 1 B0[1]',
        '1 100',
      ].join('\n'),
    )
    const parsed: ParsedDesign = {
      cells: [{ x: 1, y: 1, cell: 0, config: comb(AND2_16) }],
      onPips: dev.pips,
    }
    const cell = reconstructNetlist(parsed, dev).cells[0] as RecoveredCell
    expect(cell.inputs[1]).toEqual({ kind: 'primary', net: 100 }) // routed ⇒ a real input
    expect(cell.inputs[0]).toEqual({ kind: 'const', value: false }) // unrouted ⇒ tied low
    // and the classification is load-bearing: driving the real input still works, and the AND is gated to 0 by
    // the tied pin exactly as the silicon gates it.
    for (const v of [false, true])
      expect(
        simulateCombinational({ cells: [cell] }, new Map([[100, v]])).outputs.get('1_1_0'),
      ).toBe(false)
  })

  test('a driving CELL is found before the unrouted rule can fire (the order of the checks)', () => {
    // A synthetic device in which one net group carries BOTH a cell output and the next cell's input pin — so the
    // consumer's pin has no driver pip of its own, yet it is genuinely driven. Checking "no driver pip ⇒ tied
    // low" before "which cell drives this?" would delete the connection.
    const dev = parseIceboxChipdb(
      [
        '.device T 8 8 5',
        '.net 0',
        '1 1 lutff_0/in_0',
        '.net 2',
        '1 1 lutff_0/out',
        '1 1 lutff_1/in_0', // the SAME net group: cell 0's output IS cell 1's input pin
        '.net 4',
        '1 1 lutff_1/out',
      ].join('\n'),
    )
    const parsed: ParsedDesign = {
      cells: [
        { x: 1, y: 1, cell: 0, config: comb(BUF16) },
        { x: 1, y: 1, cell: 1, config: comb(BUF16) },
      ],
      onPips: [],
    }
    const cells = reconstructNetlist(parsed, dev).cells
    expect(cells[1]?.inputs[0]).toEqual({ kind: 'cell', driver: { x: 1, y: 1, cell: 0 }, net: 2 })
  })

  test('an unrouted CARRY operand adds zero instead of inventing an input', () => {
    // icebox fetches in_1/in_2 for the carry unit regardless of the truth table — and defaults them to `1'b0`
    // just the same. A carry operand nothing routed must therefore be a tied-low constant, not a drivable input,
    // or a half-routed adder gains phantom operands.
    const dev = parseIceboxChipdb(
      [
        '.device T 8 8 5',
        '.net 0',
        '1 1 lutff_0/in_1',
        '.net 1',
        '1 1 lutff_0/in_2',
        '.net 2',
        '1 1 lutff_0/out',
        '.net 100',
        '0 1 glb_netwk_0',
        '.buffer 1 1 0 B0[1]', // net 100 → in_1 only; in_2 is left unrouted
        '1 100',
      ].join('\n'),
    )
    const parsed: ParsedDesign = {
      cells: [
        {
          x: 1,
          y: 1,
          cell: 0,
          config: { ...comb(BUF16), carryEnable: true },
        },
      ],
      onPips: dev.pips,
    }
    const cell = reconstructNetlist(parsed, dev).cells[0] as RecoveredCell
    expect(cell.carryOperands?.[0]).toEqual({ kind: 'primary', net: 100 })
    expect(cell.carryOperands?.[1]).toEqual({ kind: 'const', value: false })
  })
})

// --- the canvas consumer ---

/** Re-drive one power-source node to a given level (5 V = HIGH, 0 V = LOW). */
const drive = (node: CanvasNodeLike, volts: number): CanvasNodeLike => ({
  ...node,
  data: {
    ...node.data,
    parameters: { nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } } },
  },
})

describe('the canvas lowering wires a tied pin to a real source', () => {
  const cellWith = (inputs: InputSource[]): RecoveredCell => ({
    ref: { x: 0, y: 0, cell: 0 },
    config: comb(BUF16), // out = in_0
    inputs,
  })

  test('a HIGH tie reads TRUE on the canvas (it used to read 0 — the wrong value)', () => {
    // The Gowin path emits `{ kind: 'const', value: true }` for a pin tied to the supply rail. The lowering
    // returned null for it, which the minterm builder reads as 0, so a buffer of a supply-tied pin came out LOW.
    const lowered = lowerNetlistToCanvas({
      cells: [
        cellWith([
          { kind: 'const', value: true },
          { kind: 'unused' },
          { kind: 'unused' },
          { kind: 'unused' },
        ]),
      ],
    })
    const result = simulateLogic(lowered.nodes, lowered.edges)
    expect(result.settled).toBe(true)
    expect(result.value(lowered.cellOutputs.get('0_0_0') as string, 'out')).toBe(true)
    expect(lowered.unfaithful).toEqual([]) // a known level is a faithful lowering, not an unresolved driver
  })

  test('a LOW tie reads FALSE and is NOT reported unfaithful', () => {
    const lowered = lowerNetlistToCanvas({
      cells: [
        cellWith([
          { kind: 'const', value: false },
          { kind: 'unused' },
          { kind: 'unused' },
          { kind: 'unused' },
        ]),
      ],
    })
    const result = simulateLogic(lowered.nodes, lowered.edges)
    expect(result.value(lowered.cellOutputs.get('0_0_0') as string, 'out')).toBe(false)
    expect(lowered.unfaithful).toEqual([]) // this cell IS faithfully lowered — the pin's value is known
    expect(lowered.unlowered).toEqual([])
  })

  test('a tied pin is not offered as a drivable input', () => {
    const lowered = lowerNetlistToCanvas({
      cells: [
        cellWith([
          { kind: 'const', value: true },
          { kind: 'primary', net: 42 },
          { kind: 'unused' },
          { kind: 'unused' },
        ]),
      ],
    })
    expect([...lowered.inputNodes.keys()]).toEqual([42]) // only the real input, not the tie
  })

  test('a whole real vendor bitstream lowers with every tie faithful, and the canvas computes parity', () => {
    // The consumer end of the same real file: the app's own fast logic engine, running the lowered gates, gets
    // the vendor design's function out of the recovered inputs — with several tied pins in the middle of it.
    const chipdbs: Record<string, Ice40ChipDb> = {
      '384': { device: parseIceboxChipdb(fixture('icebox-ice40-384-chipdb.txt')), layout: LAYOUT },
    }
    const loaded = loadIce40Bitstream(
      new Uint8Array(
        readFileSync(new URL('../fixtures/icebox-ice40-384-vendor-xor5.bin', import.meta.url)),
      ),
      chipdbs,
    )
    if (!loaded.ok) throw new Error(loaded.reason)
    const lowered = lowerNetlistToCanvas(loaded.netlist)
    expect(lowered.inputNodes.size).toBe(5) // the vendor's five inputs, and nothing else
    expect(lowered.unlowered).toEqual([])
    expect(lowered.unfaithful).toEqual([]) // every pin is a cell, a real input, or a known level

    const nets = [...lowered.inputNodes.entries()]
    const outKey = loaded.netlist.cells
      .map((c) => `${c.ref.x}_${c.ref.y}_${c.ref.cell}`)
      .find((key) => {
        const stim = new Map(nets.map(([net], k) => [net, k === 0]))
        return simulateCombinational(loaded.netlist, stim).outputs.get(key) === true
      }) as string
    const outNode = lowered.cellOutputs.get(outKey) as string
    for (let pattern = 0; pattern < 32; pattern++) {
      const nodes = lowered.nodes.map((n) => {
        const at = nets.findIndex(([, id]) => id === n.id)
        return at < 0 ? n : drive(n, ((pattern >> at) & 1) === 1 ? 5 : 0)
      })
      let parity = false
      for (let k = 0; k < 5; k++) parity = parity !== (((pattern >> k) & 1) === 1)
      const result = simulateLogic(nodes, lowered.edges)
      expect(result.settled).toBe(true)
      expect(result.value(outNode, 'out')).toBe(parity)
    }
  })
})

describe('our OWN place-and-route flow does not route IO, and the recovery says so', () => {
  test('icebox-ice40-384-routed.bin has no external inputs at all — its LUT pins are tied low', () => {
    // `synthesizeBitstream` states its scope plainly: "Primary inputs and design outputs are left at the fabric
    // edge (they are not routed to IO pads — IO/clock/reset are not modeled)". So a bitstream from our own flow
    // genuinely has dangling LUT input pins, and on silicon it computes a constant. Three tests used to drive
    // those pins and assert `B = A = i0 & i1`; that was asserting something the hardware does not do. The
    // end-to-end "drive the inputs and get the function" proof now runs on the real vendor bitstreams above,
    // where the inputs are really routed.
    const chipdbs: Record<string, Ice40ChipDb> = {
      '384': { device: parseIceboxChipdb(fixture('icebox-ice40-384-chipdb.txt')), layout: LAYOUT },
    }
    const loaded = loadIce40Bitstream(
      new Uint8Array(
        readFileSync(new URL('../fixtures/icebox-ice40-384-routed.bin', import.meta.url)),
      ),
      chipdbs,
    )
    if (!loaded.ok) throw new Error(loaded.reason)
    const a = loaded.netlist.cells.find((c) => c.ref.cell === 0) as RecoveredCell
    const b = loaded.netlist.cells.find((c) => c.ref.cell === 5) as RecoveredCell
    expect(a.inputs[0]).toEqual({ kind: 'const', value: false })
    expect(a.inputs[1]).toEqual({ kind: 'const', value: false })
    // the CELL-to-CELL routing our flow does do is still recovered — only the IO is absent
    expect(b.inputs[0]).toEqual({ kind: 'cell', driver: { x: 1, y: 1, cell: 0 }, net: 39 })
    expect(
      loaded.netlist.cells.flatMap((c) => c.inputs).filter((i) => i.kind === 'primary'),
    ).toEqual([])
    expect(simulateCombinational(loaded.netlist, new Map()).outputs.get('1_1_5')).toBe(false)
  })
})
