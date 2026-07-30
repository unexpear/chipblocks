/**
 * FPGA fabric — Stage 3a: "watch it run" (fpga-icebox-run.ts).
 * The closure of the round-trip: a design is synthesized to a bitstream, PARSED back, its netlist REBUILT from
 * the recovered cells + routed pips, and SIMULATED — and it computes the same function it started with. The
 * headline demo runs a real 2-LUT design (an AND feeding a buffer) entirely from its bitstream and gets the AND
 * truth table; reconstruction is also validated on the vendored real cell-to-cell slice.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { KLut } from '../src/renderer/fpga-fabric.ts'
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import { assembleBitstream } from '../src/renderer/fpga-icebox-bitstream.ts'
import {
  expandTruth,
  type LcConfig,
  parseLogicTileBits,
} from '../src/renderer/fpga-icebox-logic.ts'
import type { ParsedDesign } from '../src/renderer/fpga-icebox-parse.ts'
import { parseBitstream } from '../src/renderer/fpga-icebox-parse.ts'
import {
  type InputSource,
  type RecoveredCell,
  reconstructNetlist,
  simulateClocked,
  simulateCombinational,
} from '../src/renderer/fpga-icebox-run.ts'
import { type Placement, synthesizeBitstream } from '../src/renderer/fpga-icebox-synth.ts'

const LAYOUT = parseLogicTileBits(
  readFileSync(
    new URL('../fixtures/icebox-ice40-384-logic-tile-bits.chipdb', import.meta.url),
    'utf8',
  ),
)

// A small hand-written device (the real chipdb grammar) that FULLY wires two cells on tile (1,1): cell 0's
// inputs + output, cell 1's input + output, and a routed switch from cell 0's output to cell 1's input 0. This
// lets a simulation exercise both cells' real logic — the vendored real slices only carry the A→B wire, not
// A's own inputs (validated separately below).
const WIRED_DEVICE = parseIceboxChipdb(
  [
    '.device T 8 8 5',
    '.net 0',
    '1 1 lutff_0/in_0',
    '.net 1',
    '1 1 lutff_0/in_1',
    '.net 2',
    '1 1 lutff_0/out',
    '.net 3',
    '1 1 lutff_1/in_0',
    '.net 4',
    '1 1 lutff_1/out',
    '.buffer 1 1 3 B0[14]', // route lutff_0/out (net 2) → lutff_1/in_0 (net 3)
    '1 2',
  ].join('\n'),
)

// A = i0 & i1 into net nA; B = a buffer of its pin 0, reading nA. So B's output should equal i0 & i1.
const A: KLut = {
  id: 'A',
  k: 2,
  config: [false, false, false, true],
  inputs: ['i0', 'i1'],
  output: 'nA',
}
const B: KLut = { id: 'B', k: 1, config: [false, true], inputs: ['nA'], output: 'nB' }
const wiredPlacement: Placement = new Map([
  ['A', { x: 1, y: 1, cell: 0 }],
  ['B', { x: 1, y: 1, cell: 1 }],
])

describe('reconstructNetlist + simulateCombinational — load a bitstream and watch it compute', () => {
  const design = synthesizeBitstream(WIRED_DEVICE, LAYOUT, [A, B], wiredPlacement)
  const parsed = parseBitstream(design.bitstream.bits, WIRED_DEVICE, LAYOUT)
  const netlist = reconstructNetlist(parsed, WIRED_DEVICE)

  test('the netlist is rebuilt from the bitstream: cell 1 reads cell 0, cell 0 reads primaries', () => {
    expect(design.routed).toBe(true)
    const a = netlist.cells.find((c) => c.ref.cell === 0)
    const b = netlist.cells.find((c) => c.ref.cell === 1)
    // cell 1's input pin 0 is driven by cell 0 (traced back through the routed pip); `net` is cell 0's OUTPUT
    // net (2 = lutff_0/out, the source), not cell 1's input-pin net.
    expect(b?.inputs[0]).toEqual({ kind: 'cell', driver: { x: 1, y: 1, cell: 0 }, net: 2 })
    expect(b?.inputs[1]).toEqual({ kind: 'unused' })
    // cell 0's two inputs are primary (external), pins 2/3 unused
    expect(a?.inputs[0]).toEqual({ kind: 'primary', net: 0 })
    expect(a?.inputs[1]).toEqual({ kind: 'primary', net: 1 })
    expect(a?.inputs[2]).toEqual({ kind: 'unused' })
  })

  test('simulating the rebuilt netlist reproduces the design function: out = i0 & i1, straight from the bits', () => {
    for (const i0 of [false, true]) {
      for (const i1 of [false, true]) {
        // primaries are named by net: cell 0's in_0 = net 0, in_1 = net 1
        const sim = simulateCombinational(
          netlist,
          new Map([
            [0, i0],
            [1, i1],
          ]),
        )
        expect(sim.registered).toEqual([]) // purely combinational
        expect(sim.outputs.get('1_1_1')).toBe(i0 && i1) // cell 1's (B's) output = the AND
        expect(sim.outputs.get('1_1_0')).toBe(i0 && i1) // cell 0's (A's) output = i0 & i1
      }
    }
  })
})

describe('reconstructNetlist — recovers connectivity from the REAL vendored slice', () => {
  const DEVICE = parseIceboxChipdb(
    readFileSync(
      new URL('../fixtures/icebox-ice40-384-cell-to-cell.chipdb', import.meta.url),
      'utf8',
    ),
  )
  const P: KLut = {
    id: 'A',
    k: 2,
    config: [false, false, false, true],
    inputs: ['i0', 'i1'],
    output: 'nA',
  }
  const Q: KLut = {
    id: 'B',
    k: 2,
    config: [false, false, true, true],
    inputs: ['i2', 'nA'],
    output: 'nB',
  }
  const placement: Placement = new Map([
    ['A', { x: 1, y: 1, cell: 0 }],
    ['B', { x: 1, y: 1, cell: 5 }],
  ])

  test('on real iCE40 data, cell 5 input pin 1 is traced back to cell 0 through the real routed pips', () => {
    const design = synthesizeBitstream(DEVICE, LAYOUT, [P, Q], placement)
    const netlist = reconstructNetlist(
      parseBitstream(design.bitstream.bits, DEVICE, LAYOUT),
      DEVICE,
    )
    const q = netlist.cells.find((c) => c.ref.cell === 5)
    // net 1121 = lutff_5/in_1 ← (through 1057) ← net 39 = lutff_0/out = cell 0; `net` is the source (39).
    expect(q?.inputs[1]).toEqual({ kind: 'cell', driver: { x: 1, y: 1, cell: 0 }, net: 39 })
  })
})

// --- helpers for hand-built netlists (testing reconstruct classification + the simulator directly) ---
const comb = (truth: boolean[]): LcConfig => ({
  truth,
  carryEnable: false,
  dffEnable: false,
  setNoReset: false,
  asyncSetReset: false,
})
const reg = (truth: boolean[]): LcConfig => ({ ...comb(truth), dffEnable: true }) // a registered (flip-flop) cell
const BUF = expandTruth([false, true]) // out = in0
const AND2_16 = expandTruth([false, false, false, true])
const ref = (cell: number): { x: number; y: number; cell: number } => ({ x: 0, y: 0, cell })
const prim = (net: number): InputSource => ({ kind: 'primary', net })
const cellSrc = (cell: number): InputSource => ({ kind: 'cell', driver: ref(cell), net: cell })
const UNUSED: InputSource = { kind: 'unused' }
const oneIn = (cell: number, config: LcConfig, in0: InputSource): RecoveredCell => ({
  ref: ref(cell),
  config,
  inputs: [in0, UNUSED, UNUSED, UNUSED],
})

describe('reconstructNetlist — real cells declare all 4 pins; unused LUT inputs are not phantom primaries', () => {
  test('a 2-input LUT on a device that declares in_2/in_3 marks those pins UNUSED, not primary', () => {
    const dev = parseIceboxChipdb(
      [
        '.device T 8 8 4',
        '.net 0',
        '1 1 lutff_0/in_0',
        '.net 1',
        '1 1 lutff_0/in_1',
        '.net 5',
        '1 1 lutff_0/in_2', // declared, but the AND2 does not depend on it
        '.net 6',
        '1 1 lutff_0/in_3', // declared, but ignored
      ].join('\n'),
    )
    const parsed: ParsedDesign = {
      cells: [{ x: 1, y: 1, cell: 0, config: comb(AND2_16) }],
      onPips: [],
    }
    const c0 = reconstructNetlist(parsed, dev).cells[0]
    expect(c0?.inputs[0]).toEqual({ kind: 'primary', net: 0 }) // in_0 used ⇒ external primary
    expect(c0?.inputs[1]).toEqual({ kind: 'primary', net: 1 }) // in_1 used ⇒ external primary
    expect(c0?.inputs[2]).toEqual({ kind: 'unused' }) // in_2 declared but a don't-care ⇒ unused
    expect(c0?.inputs[3]).toEqual({ kind: 'unused' }) // in_3 declared but a don't-care ⇒ unused
  })

  test('one external input fanning out to two cells unifies under a single source net', () => {
    const dev = parseIceboxChipdb(
      [
        '.device T 8 8 5',
        '.net 0',
        '1 1 lutff_0/in_0',
        '.net 2',
        '1 1 lutff_0/out',
        '.net 3',
        '1 1 lutff_1/in_0',
        '.net 4',
        '1 1 lutff_1/out',
        '.net 100',
        '0 1 glb_netwk_0', // an external signal, driven by no cell
        '.buffer 1 1 0 B0[1]', // net 100 → cell 0's in_0
        '1 100',
        '.buffer 1 1 3 B0[2]', // net 100 → cell 1's in_0
        '1 100',
      ].join('\n'),
    )
    const parsed: ParsedDesign = {
      cells: [
        { x: 1, y: 1, cell: 0, config: comb(BUF) },
        { x: 1, y: 1, cell: 1, config: comb(BUF) },
      ],
      onPips: dev.pips,
    }
    const nl = reconstructNetlist(parsed, dev)
    // both cells' input pin 0 report the SAME source net (100), not their own pin nets (0 and 3)
    expect(nl.cells[0]?.inputs[0]).toEqual({ kind: 'primary', net: 100 })
    expect(nl.cells[1]?.inputs[0]).toEqual({ kind: 'primary', net: 100 })
    // so driving the one real external net reaches both cells
    const sim = simulateCombinational(nl, new Map([[100, true]]))
    expect(sim.outputs.get('1_1_0')).toBe(true)
    expect(sim.outputs.get('1_1_1')).toBe(true)
  })

  test("a don't-care pin a cell physically drives is still unused — no phantom edge, no false cycle", () => {
    // A = BUF (depends only on in_0); B = BUF. Route A.out → B.in_0 AND B.out → A.in_1. A's in_1 is a don't-care,
    // yet a cell (B) drives it. Classifying that as a real 'cell' edge would close a false A→B→A cycle and, in
    // simulateCombinational, memoize B=false forever. The don't-care guard must win FIRST: A.in_1 is unused, and B
    // correctly equals A. (Reverting the guard-first order regresses B to false when the primary is high.)
    const dev = parseIceboxChipdb(
      [
        '.device T 8 8 5',
        '.net 0',
        '1 1 lutff_0/in_0',
        '.net 1',
        '1 1 lutff_0/in_1',
        '.net 2',
        '1 1 lutff_0/out',
        '.net 3',
        '1 1 lutff_1/in_0',
        '.net 4',
        '1 1 lutff_1/out',
        '.buffer 1 1 3 B0[14]', // A.out (net 2) → B.in_0 (net 3)
        '1 2',
        '.buffer 1 1 1 B0[15]', // B.out (net 4) → A.in_1 (net 1) — into A's don't-care pin
        '1 4',
      ].join('\n'),
    )
    const parsed: ParsedDesign = {
      cells: [
        { x: 1, y: 1, cell: 0, config: comb(BUF) },
        { x: 1, y: 1, cell: 1, config: comb(BUF) },
      ],
      onPips: dev.pips,
    }
    const nl = reconstructNetlist(parsed, dev)
    const a = nl.cells.find((c) => c.ref.cell === 0)
    expect(a?.inputs[0]).toEqual({ kind: 'primary', net: 0 }) // the pin A actually uses
    expect(a?.inputs[1]).toEqual({ kind: 'unused' }) // driven by B, but a don't-care ⇒ NOT a phantom cell edge
    for (const v of [false, true]) {
      const sim = simulateCombinational(nl, new Map([[0, v]]))
      expect(sim.outputs.get('1_1_0')).toBe(v) // A = the primary
      expect(sim.outputs.get('1_1_1')).toBe(v) // B follows A — no false-cycle corruption
    }
  })
})

describe('simulateCombinational — flip-flops, chains, order, cycles', () => {
  test('a registered cell is reported and held false; a cell reading it sees false', () => {
    const registeredCell: RecoveredCell = {
      ref: ref(0),
      config: { ...comb(BUF), dffEnable: true },
      inputs: [prim(0), UNUSED, UNUSED, UNUSED],
    }
    const reader = oneIn(1, comb(BUF), cellSrc(0))
    const sim = simulateCombinational({ cells: [registeredCell, reader] }, new Map([[0, true]]))
    expect(sim.registered).toEqual([ref(0)]) // the flip-flop is reported, not silently mis-evaluated
    expect(sim.outputs.get('0_0_0')).toBe(false) // held false despite its primary being true
    expect(sim.outputs.get('0_0_1')).toBe(false) // the reader sees the held-false value
  })

  test('evaluates correctly regardless of cells[] order — a consumer listed before its driver', () => {
    const driver = oneIn(0, comb(BUF), prim(0))
    const consumer = oneIn(1, comb(BUF), cellSrc(0))
    const sim = simulateCombinational({ cells: [consumer, driver] }, new Map([[0, true]])) // consumer FIRST
    expect(sim.outputs.get('0_0_1')).toBe(true)
  })

  test('a 3-cell chain and a fan-out both propagate correctly', () => {
    const a = oneIn(0, comb(BUF), prim(0))
    const b = oneIn(1, comb(BUF), cellSrc(0))
    const c = oneIn(2, comb(BUF), cellSrc(1)) // chain A→B→C
    const d = oneIn(3, comb(BUF), cellSrc(0)) // fan-out: also reads A
    for (const v of [false, true]) {
      const sim = simulateCombinational({ cells: [a, b, c, d] }, new Map([[0, v]]))
      expect(sim.outputs.get('0_0_2')).toBe(v) // end of the chain
      expect(sim.outputs.get('0_0_3')).toBe(v) // the fan-out branch
    }
  })

  test('a combinational cycle bails to false instead of looping forever', () => {
    const a = oneIn(0, comb(BUF), cellSrc(1))
    const b = oneIn(1, comb(BUF), cellSrc(0)) // A ↔ B
    const sim = simulateCombinational({ cells: [a, b] }, new Map())
    expect(sim.outputs.get('0_0_0')).toBe(false) // bailed on the cycle, no hang
    expect(sim.outputs.get('0_0_1')).toBe(false)
  })
})

describe('simulateClocked — a sequential circuit runs over clock cycles', () => {
  test('a toggle flip-flop, round-tripped from its BITSTREAM, toggles 0,1,0,1', () => {
    // A cell whose LUT is NOT(in0) with its flip-flop enabled, wired output → its own input (a real routed
    // self-feedback). Encoded to a bitstream, parsed back, rebuilt, and clocked — it should toggle.
    const device = parseIceboxChipdb(
      [
        '.device T 8 8 3',
        '.net 0',
        '1 1 lutff_0/in_0',
        '.net 2',
        '1 1 lutff_0/out',
        '.buffer 1 1 0 B0[14]', // route lutff_0/out (net 2) back to lutff_0/in_0 (net 0)
        '1 2',
      ].join('\n'),
    )
    const toggle = reg(expandTruth([true, false])) // out = NOT in0, registered
    const bitstream = assembleBitstream(LAYOUT, {
      cells: [{ x: 1, y: 1, cell: 0, config: toggle }],
      routingPips: device.pips,
    })
    const netlist = reconstructNetlist(parseBitstream(bitstream.bits, device, LAYOUT), device)
    // the rebuilt cell reads its OWN output — the flip-flop feedback, recovered from the bits
    expect(netlist.cells[0]?.inputs[0]).toEqual({
      kind: 'cell',
      driver: { x: 1, y: 1, cell: 0 },
      net: 2,
    })
    const run = simulateClocked(netlist, new Map(), 4)
    expect(run.trace.map((cycle) => cycle.get('1_1_0'))).toEqual([false, true, false, true])
    // finalState is the LATCHED Q entering the next cycle, not the value shown last cycle: after the cycle that
    // SHOWED true, the flip-flop latched D = NOT(true) = false. (Pins finalState to the state, not trace[last].)
    expect(run.finalState.get('1_1_0')).toBe(false)
  })

  test('a 2-stage shift register delays a held input by two cycles', () => {
    // ff0 samples the primary input; ff1 samples ff0. With the input held high from a 0 reset, the high value
    // reaches ff0 after 1 clock and ff1 after 2 — a real synchronous 2-cycle pipeline.
    const ff0 = oneIn(0, reg(BUF), prim(7))
    const ff1 = oneIn(1, reg(BUF), cellSrc(0))
    const run = simulateClocked({ cells: [ff0, ff1] }, new Map([[7, true]]), 4)
    expect(run.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, true, true, true]) // stage 1: 1-cycle delay
    expect(run.trace.map((cy) => cy.get('0_0_1'))).toEqual([false, false, true, true]) // stage 2: 2-cycle delay
    expect(run.finalState.get('0_0_1')).toBe(true) // the pipeline is full after it has run
  })

  test('a flip-flop whose D is driven THROUGH a combinational cell (a counter/next-state path) clocks correctly', () => {
    // ff_a samples a held-high primary; a combinational NOT sits between ff_a and ff_b; ff_b samples that NOT.
    // ff_b therefore registers NOT(ff_a's CURRENT Q), one clock late — this only works if a driver's COMPUTED
    // output (not its stored state) feeds the flip-flop's D, so it pins that path that FF→FF hops cannot.
    const ffA = oneIn(0, reg(BUF), prim(7))
    const notCell = oneIn(1, comb(expandTruth([true, false])), cellSrc(0)) // NOT(ff_a)
    const ffB = oneIn(2, reg(BUF), cellSrc(1)) // samples the combinational NOT
    const run = simulateClocked({ cells: [ffA, notCell, ffB] }, new Map([[7, true]]), 3)
    expect(run.trace.map((cy) => cy.get('0_0_2'))).toEqual([false, true, false])
  })

  test('a purely combinational cell reading a primary is re-evaluated each cycle from the live primary value', () => {
    // The only cell is combinational (NOT of a primary), so this exercises the clocked OUTPUT phase's primary read
    // and its comb path directly — and confirms it reflects the ACTUAL primary, not a stuck constant.
    const notCell = oneIn(0, comb(expandTruth([true, false])), prim(7)) // out = NOT(net 7)
    const high = simulateClocked({ cells: [notCell] }, new Map([[7, true]]), 3)
    expect(high.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, false, false]) // NOT(true)
    const low = simulateClocked({ cells: [notCell] }, new Map([[7, false]]), 2)
    expect(low.trace.map((cy) => cy.get('0_0_0'))).toEqual([true, true]) // NOT(false) — reads the real value
  })

  test('a pure combinational cycle inside a clocked run bails to false instead of hanging', () => {
    // No register breaks the loop, so the clocked output phase must apply the same combinational-cycle guard the
    // combinational simulator does — bail to false, never recurse forever.
    const a = oneIn(0, comb(BUF), cellSrc(1))
    const b = oneIn(1, comb(BUF), cellSrc(0)) // A ↔ B
    const run = simulateClocked({ cells: [a, b] }, new Map(), 3)
    expect(run.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, false, false]) // guard bailed, no hang
    expect(run.trace.map((cy) => cy.get('0_0_1'))).toEqual([false, false, false])
    expect(run.finalState.size).toBe(0) // no registered cells ⇒ empty flip-flop state
  })
})

describe('simulateClocked — a per-cycle input sequence drives primaries differently each cycle', () => {
  test('an array stimulus feeds a distinct value per cycle; a constant map holds it', () => {
    const ff = oneIn(0, reg(BUF), prim(7)) // a plain D-FF sampling net 7
    // per-cycle sequence 1,0,1,0 → the FF echoes it one clock late
    const seq = [
      new Map([[7, true]]),
      new Map([[7, false]]),
      new Map([[7, true]]),
      new Map([[7, false]]),
    ]
    const run = simulateClocked({ cells: [ff] }, seq, 4)
    expect(run.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, true, false, true])
    // contrast: the SAME FF with the input HELD constant fills and stays high (proves the sequence really varied)
    const held = simulateClocked({ cells: [ff] }, new Map([[7, true]]), 4)
    expect(held.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, true, true, true])
  })

  test('a function stimulus, and a short array held past its end, both resolve per cycle', () => {
    const ff = oneIn(0, reg(BUF), prim(7))
    // function: net 7 high only in cycle 1 → FF shows it in cycle 2
    const fn = simulateClocked({ cells: [ff] }, (cy) => new Map([[7, cy === 1]]), 4)
    expect(fn.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, false, true, false])
    // a 1-entry array holds for all 3 cycles (same as the constant map)
    const short = simulateClocked({ cells: [ff] }, [new Map([[7, true]])], 3)
    expect(short.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, true, true])
  })
})

describe('reconstructNetlist — recovers the tile set/reset signal', () => {
  test("a signal routed into lutff_global/s_r is recovered as the flip-flop's setReset source", () => {
    const dev = parseIceboxChipdb(
      [
        '.device T 8 8 5',
        '.net 0',
        '1 1 lutff_0/in_0',
        '.net 2',
        '1 1 lutff_0/out',
        '.net 5',
        '1 1 lutff_global/s_r',
        '.net 9',
        '0 1 glb_netwk_0', // an external signal (driven by no cell)
        '.buffer 1 1 5 B0[20]', // route glb (net 9) → the tile's s_r (net 5)
        '1 9',
      ].join('\n'),
    )
    const parsed: ParsedDesign = {
      cells: [{ x: 1, y: 1, cell: 0, config: reg(BUF) }],
      onPips: dev.pips,
    }
    const c = reconstructNetlist(parsed, dev).cells[0]
    expect(c?.setReset).toEqual({ kind: 'primary', net: 9 }) // the external SR input, recovered from the routing
  })

  test('a flip-flop with nothing routed to s_r has no setReset (a plain D flip-flop)', () => {
    const dev = parseIceboxChipdb(
      [
        '.device T 8 8 5',
        '.net 0',
        '1 1 lutff_0/in_0',
        '.net 2',
        '1 1 lutff_0/out',
        '.net 5',
        '1 1 lutff_global/s_r', // the s_r wire exists but nothing drives it
      ].join('\n'),
    )
    const parsed: ParsedDesign = {
      cells: [{ x: 1, y: 1, cell: 0, config: reg(BUF) }],
      onPips: [],
    }
    expect(reconstructNetlist(parsed, dev).cells[0]?.setReset ?? null).toBeNull()
  })
})

describe('simulateClocked — the recovered set/reset is applied', () => {
  const HIGH = Array.from({ length: 16 }, () => true) // D = constant 1
  const LOW = Array.from({ length: 16 }, () => false) // D = constant 0
  // a registered cell whose next-state D is constant, with its s_r driven by primary net 9
  const srCell = (config: LcConfig): RecoveredCell => ({
    ref: ref(0),
    config,
    inputs: [UNUSED, UNUSED, UNUSED, UNUSED],
    setReset: prim(9),
  })
  // s_r asserted in cycles 0 and 3, deasserted in 1 and 2
  const srSeq = [
    new Map([[9, true]]),
    new Map([[9, false]]),
    new Map([[9, false]]),
    new Map([[9, true]]),
  ]
  const dff = (truth: boolean[], setNoReset: boolean, asyncSetReset: boolean): LcConfig => ({
    truth,
    carryEnable: false,
    dffEnable: true,
    setNoReset,
    asyncSetReset,
  })

  test('an ASYNCHRONOUS reset forces the output the same cycle s_r is asserted', () => {
    const run = simulateClocked({ cells: [srCell(dff(HIGH, false, true))] }, srSeq, 4)
    // cy0 reset→0 (immediate); cy1 loads D=1 → shows 0 then; cy2 shows 1; cy3 reset→0 immediately
    expect(run.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, false, true, false])
  })

  test('a SYNCHRONOUS reset changes only at the next edge — one cycle later than async', () => {
    const run = simulateClocked({ cells: [srCell(dff(HIGH, false, false))] }, srSeq, 4)
    // identical to async EXCEPT cy3: sync s_r does not force the output this cycle, so it still shows the old Q
    expect(run.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, false, true, true])
  })

  test('setNoReset makes s_r a SET — Q is forced to 1', () => {
    const run = simulateClocked({ cells: [srCell(dff(LOW, true, true))] }, srSeq, 4)
    // cy0 set→1 (and latched 1); cy1 shows the latched 1 then loads D=0; cy2 shows 0; cy3 set→1
    expect(run.trace.map((cy) => cy.get('0_0_0'))).toEqual([true, true, false, true])
  })

  test('everything-real: a registered async-reset cell with s_r routed from a primary, round-tripped through its BITSTREAM, resets', () => {
    const dev = parseIceboxChipdb(
      [
        '.device T 8 8 5',
        '.net 2',
        '1 1 lutff_0/out',
        '.net 5',
        '1 1 lutff_global/s_r',
        '.net 9',
        '0 1 glb_netwk_0',
        '.buffer 1 1 5 B0[14]', // glb (net 9) → s_r (net 5)
        '1 9',
      ].join('\n'),
    )
    const config = dff(HIGH, false, true) // load 1, async reset
    const bitstream = assembleBitstream(LAYOUT, {
      cells: [{ x: 1, y: 1, cell: 0, config }],
      routingPips: dev.pips,
    })
    const netlist = reconstructNetlist(parseBitstream(bitstream.bits, dev, LAYOUT), dev)
    // the s_r source was recovered from the real bits, not hand-set
    expect(netlist.cells[0]?.setReset).toEqual({ kind: 'primary', net: 9 })
    const run = simulateClocked(
      netlist,
      [new Map([[9, true]]), new Map([[9, false]]), new Map([[9, false]])],
      3,
    )
    expect(run.trace.map((cy) => cy.get('1_1_0'))).toEqual([false, false, true]) // reset cy0, then loads D=1
  })
})

describe('simulateClocked — the recovered clock-enable is applied', () => {
  const HIGH = Array.from({ length: 16 }, () => true) // D = constant 1
  const dffPlain = (truth: boolean[]): LcConfig => ({
    truth,
    carryEnable: false,
    dffEnable: true,
    setNoReset: false,
    asyncSetReset: false,
  })
  const enCell = (config: LcConfig, cenNet: number): RecoveredCell => ({
    ref: ref(0),
    config,
    inputs: [UNUSED, UNUSED, UNUSED, UNUSED],
    clockEnable: prim(cenNet),
  })

  test('a clock-enable gates the latch: Q updates only on cycles where cen is HIGH', () => {
    const cell = enCell(dffPlain(HIGH), 8) // D = constant 1, gated by cen (net 8)
    const seq = [
      new Map([[8, false]]),
      new Map([[8, true]]),
      new Map([[8, false]]),
      new Map([[8, true]]),
    ]
    const run = simulateClocked({ cells: [cell] }, seq, 4)
    expect(run.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, false, true, true]) // latches only when cen high
    // contrast: the SAME FF with cen held HIGH loads on the first edge (proves cen actually gated the run above)
    const alwaysOn = simulateClocked({ cells: [cell] }, new Map([[8, true]]), 4)
    expect(alwaysOn.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, true, true, true])
  })

  test('a flip-flop with no routed clock-enable is always enabled (cen tied high)', () => {
    const ff = oneIn(0, reg(BUF), prim(7)) // plain D-FF, no clockEnable field
    // "driving" net 8 does nothing — it is not this FF's cen — so it clocks every cycle
    const run = simulateClocked(
      { cells: [ff] },
      new Map([
        [7, true],
        [8, false],
      ]),
      3,
    )
    expect(run.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, true, true])
  })

  test('an async set/reset overrides a disabled clock, but a sync set/reset is gated by it', () => {
    const dff2 = (asyncSetReset: boolean): LcConfig => ({
      truth: HIGH,
      carryEnable: false,
      dffEnable: true,
      setNoReset: false, // reset (Q←0) when s_r asserted
      asyncSetReset,
    })
    const cellSR = (asyncSetReset: boolean, cell: number): RecoveredCell => ({
      ref: ref(cell),
      config: dff2(asyncSetReset),
      inputs: [UNUSED, UNUSED, UNUSED, UNUSED],
      clockEnable: prim(8),
      setReset: prim(9),
    })
    // cy0: cen high, s_r low → both load D=1. cy1: cen LOW, s_r high (reset asserted). cy2: cen LOW, s_r low —
    // reveals the LATCHED value: the async FF reset to 0 at cy1's edge (ignoring cen), the sync FF still holds 1.
    const seq = [
      new Map([
        [8, true],
        [9, false],
      ]),
      new Map([
        [8, false],
        [9, true],
      ]),
      new Map([
        [8, false],
        [9, false],
      ]),
    ]
    const run = simulateClocked({ cells: [cellSR(true, 0), cellSR(false, 1)] }, seq, 3)
    expect(run.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, false, false]) // async: reset applied despite cen LOW
    expect(run.trace.map((cy) => cy.get('0_0_1'))).toEqual([false, true, true]) // sync: reset gated by cen LOW ⇒ holds 1
  })

  test('everything-real: a clock-enable routed from a primary is recovered from the BITSTREAM and gates the FF', () => {
    const dev = parseIceboxChipdb(
      [
        '.device T 8 8 5',
        '.net 2',
        '1 1 lutff_0/out',
        '.net 6',
        '1 1 lutff_global/cen',
        '.net 8',
        '0 1 glb_netwk_1',
        '.buffer 1 1 6 B0[14]', // glb (net 8) → cen (net 6)
        '1 8',
      ].join('\n'),
    )
    const config: LcConfig = {
      truth: HIGH,
      carryEnable: false,
      dffEnable: true,
      setNoReset: false,
      asyncSetReset: false,
    }
    const bitstream = assembleBitstream(LAYOUT, {
      cells: [{ x: 1, y: 1, cell: 0, config }],
      routingPips: dev.pips,
    })
    const netlist = reconstructNetlist(parseBitstream(bitstream.bits, dev, LAYOUT), dev)
    expect(netlist.cells[0]?.clockEnable).toEqual({ kind: 'primary', net: 8 }) // cen recovered from the real bits
    const run = simulateClocked(
      netlist,
      [new Map([[8, false]]), new Map([[8, true]]), new Map([[8, false]])],
      3,
    )
    expect(run.trace.map((cy) => cy.get('1_1_0'))).toEqual([false, false, true]) // loads D=1 only across the cen-high edge
  })
})

describe('the carry chain — a real ripple adder', () => {
  // LUT truth tables (indexed truth[8·in3 + 4·in2 + 2·in1 + in0]):
  const xor2 = Array.from({ length: 16 }, (_, i) => Boolean(((i >> 1) & 1) ^ ((i >> 2) & 1))) // in1 ^ in2
  const xor3 = Array.from({ length: 16 }, (_, i) =>
    Boolean(((i >> 1) & 1) ^ ((i >> 2) & 1) ^ ((i >> 3) & 1)),
  ) // in1 ^ in2 ^ in3
  const carryCfg = (truth: boolean[]): LcConfig => ({
    truth,
    carryEnable: true,
    dffEnable: false,
    setNoReset: false,
    asyncSetReset: false,
  })
  const carryFrom = (cell: number): InputSource => ({ kind: 'carry', driver: ref(cell), net: 0 })

  test('two carry cells add two 2-bit numbers: sum + final carry match a + b', () => {
    // cell 0: sum0 = a0 ^ b0 (carry-in 0); its carry-out = maj(a0, b0, 0) = a0 & b0.
    const cell0: RecoveredCell = {
      ref: ref(0),
      config: carryCfg(xor2),
      inputs: [UNUSED, prim(10), prim(11), UNUSED], // in1 = a0 (net 10), in2 = b0 (net 11)
      carryIn: null, // start of the chain ⇒ carry-in 0
    }
    // cell 1: sum1 = a1 ^ b1 ^ carry0 (carry0 routed into in3); its carry-out = maj(a1, b1, carry0).
    const cell1: RecoveredCell = {
      ref: ref(1),
      config: carryCfg(xor3),
      inputs: [UNUSED, prim(12), prim(13), carryFrom(0)], // in1 = a1, in2 = b1, in3 = cell 0's carry-out
      carryIn: ref(0), // carry chains from cell 0
    }
    // cell 2: a plain buffer that just surfaces cell 1's carry-out as an output, so we can read the final carry.
    const cell2 = oneIn(2, comb(BUF), carryFrom(1))

    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++) {
        const primary = new Map([
          [10, (a & 1) === 1],
          [11, (b & 1) === 1],
          [12, (a & 2) === 2],
          [13, (b & 2) === 2],
        ])
        const sim = simulateCombinational({ cells: [cell0, cell1, cell2] }, primary)
        const sum0 = sim.outputs.get('0_0_0') ? 1 : 0
        const sum1 = sim.outputs.get('0_0_1') ? 1 : 0
        const carry = sim.outputs.get('0_0_2') ? 1 : 0
        expect(sum0 + 2 * sum1 + 4 * carry).toBe(a + b) // a full 2-bit ripple-carry adder
      }
  })

  test('reconstructNetlist resolves a routed carry-out to a carry source and chains carry-in', () => {
    // cell 0's carry output (net 0) is routed into cell 1's in_3 (net 1); both cells are carry-enabled.
    const dev = parseIceboxChipdb(
      [
        '.device T 8 8 5',
        '.net 0',
        '1 1 lutff_0/cout',
        '.net 1',
        '1 1 lutff_1/in_3',
        '.net 2',
        '1 1 lutff_0/out',
        '.net 3',
        '1 1 lutff_1/out',
        '.buffer 1 1 1 B0[14]', // cout (net 0) → cell 1's in_3 (net 1)
        '1 0',
      ].join('\n'),
    )
    const parsed: ParsedDesign = {
      cells: [
        { x: 1, y: 1, cell: 0, config: carryCfg(xor2) },
        { x: 1, y: 1, cell: 1, config: carryCfg(xor3) },
      ],
      onPips: dev.pips,
    }
    const netlist = reconstructNetlist(parsed, dev)
    const c1 = netlist.cells.find((c) => c.ref.cell === 1)
    // in_3, traced back through the routed pip, dead-ends at cell 0's CARRY output ⇒ a carry source (not a primary)
    expect(c1?.inputs[3]).toEqual({ kind: 'carry', driver: { x: 1, y: 1, cell: 0 }, net: 0 })
    expect(c1?.carryIn).toEqual({ x: 1, y: 1, cell: 0 }) // structural chain from the previous cell
    expect(netlist.cells.find((c) => c.ref.cell === 0)?.carryIn ?? null).toBeNull() // cell 0 starts the chain
  })
})
