/**
 * FPGA fabric — the SHARED simulator: what the two-phase clock must get right beyond the simple case.
 *
 * Reading the falling-edge bit meant splitting each clock into two halves — latch the rising-edge flip-flops,
 * re-evaluate, then latch the falling-edge ones. The first version of that split was checked against one real
 * bitstream with one falling-edge flip-flop between two rising-edge ones, and it was right about that. It was
 * wrong about two things that design does not contain, and this file is those two things.
 *
 * 1. AN ASYNCHRONOUS RESET STOPPED PERSISTING. An asynchronous reset forces its flip-flop the instant it is
 *    asserted and the flip-flop keeps that value until its OWN next edge. With one edge per cycle that needed no
 *    special handling — every flip-flop was latched every cycle, so the force was always written down. With two,
 *    a force asserted in one half applies to flip-flops that clock in the OTHER half, and it was being computed,
 *    used within that half, and then thrown away.
 *
 * 2. WHICH FLIP-FLOPS GO ON WHICH EDGE was not tested by anything. Deleting the falling-edge half of that
 *    partition — so a falling-edge flip-flop latched on BOTH edges — left the entire suite green.
 *
 * THE EXPECTED VALUES ARE NOT DERIVED HERE. Each is the output of iverilog on the behavioural Verilog quoted
 * above the test, run with the same stimulus and the same all-zero starting registers this simulator uses.
 */
import { describe, expect, test } from 'vitest'
import type {
  InputSource,
  RecoveredCell,
  RecoveredNetlist,
} from '../src/renderer/fpga-icebox-run.ts'
import { simulateClocked } from '../src/renderer/fpga-icebox-run.ts'

const UNUSED: InputSource = { kind: 'unused' }
const pad = (used: InputSource[]): InputSource[] =>
  [...used, UNUSED, UNUSED, UNUSED, UNUSED].slice(0, 4)

/** A 16-entry truth table from a function of the four pins. */
const table = (fn: (a: boolean, b: boolean, c: boolean, d: boolean) => boolean): boolean[] =>
  Array.from({ length: 16 }, (_, i) =>
    fn((i & 1) !== 0, (i & 2) !== 0, (i & 4) !== 0, (i & 8) !== 0),
  )

const PASS = table((a) => a)
const ONE = table(() => true)
const AND_NOT = table((a, b) => a && !b) // pin0 AND NOT pin1

let nextNet = 100
function cell(
  id: number,
  opts: {
    truth?: boolean[]
    dff?: boolean
    negClk?: boolean
    inputs?: InputSource[]
    async?: boolean
    setNoReset?: boolean
    setReset?: InputSource | null
    clockEnable?: InputSource | null
  },
): RecoveredCell {
  return {
    ref: { x: 0, y: 0, cell: id },
    config: {
      truth: opts.truth ?? PASS,
      carryEnable: false,
      dffEnable: opts.dff ?? false,
      setNoReset: opts.setNoReset ?? false,
      asyncSetReset: opts.async ?? false,
    },
    inputs: pad(opts.inputs ?? []),
    negClk: opts.negClk ?? false,
    setReset: opts.setReset ?? null,
    clockEnable: opts.clockEnable ?? null,
  }
}

/** An input reading another cell's output. */
const from = (c: RecoveredCell): InputSource => ({
  kind: 'cell',
  driver: c.ref,
  net: nextNet++,
})

const DG = 1
const drive = (high: (cy: number) => boolean) => (cy: number) => new Map([[DG, high(cy)]])

/** Each cell's value per cycle, as a string of 0/1 — the shape the reference simulator prints. */
function run(
  netlist: RecoveredNetlist,
  stim: (cy: number) => Map<number, boolean>,
  cycles: number,
) {
  const { trace } = simulateClocked(netlist, stim, cycles)
  return (c: RecoveredCell): string =>
    trace.map((m) => (m.get(`${c.ref.x}_${c.ref.y}_${c.ref.cell}`) ? '1' : '0')).join('')
}

describe('an asynchronous reset survives BOTH halves of the clock', () => {
  /*
   * always @(posedge clk) r1 <= dg;
   * always @(negedge clk) n1 <= dg;
   * wire sr = r1 & ~n1;                          // high for exactly one half-period
   * always @(posedge clk or posedge sr) if (sr) r2 <= 1'b0; else r2 <= 1'b1;
   *
   * dg rises at cycle 2; all registers start 0.   iverilog:  r2 = 01101111
   */
  test('a RISING-edge flip-flop cleared between the edges stays cleared', () => {
    const r1 = cell(0, { dff: true, inputs: [{ kind: 'primary', net: DG }] })
    const n1 = cell(1, { dff: true, negClk: true, inputs: [{ kind: 'primary', net: DG }] })
    const sr = cell(2, { truth: AND_NOT, inputs: [from(r1), from(n1)] })
    const r2 = cell(3, {
      dff: true,
      truth: ONE,
      async: true,
      setNoReset: false,
      setReset: from(sr),
    })
    const at = run(
      { cells: [r1, n1, sr, r2] },
      drive((cy) => cy >= 2),
      8,
    )
    // Before the fix this read 01111111 — the clear was computed, used inside that half of the clock, and then
    // dropped, so the flip-flop sprang straight back at the next rising edge.
    expect(at(r2)).toBe('01101111')
  })

  /*
   * always @(negedge clk) n  <= dg;
   * always @(posedge clk) r  <= n;
   * always @(posedge clk) r2 <= r;
   * wire sr = n & ~r2;
   * always @(negedge clk or posedge sr) if (sr) a <= 1'b0; else a <= 1'b1;
   * always @(negedge clk) b <= a;
   *
   * dg high at cycle 2 only; all registers start 0.   iverilog:  a = 01100111,  b = 00110011
   */
  test('a FALLING-edge flip-flop cleared before the rising edge is not sampled stale', () => {
    const n = cell(0, { dff: true, negClk: true, inputs: [{ kind: 'primary', net: DG }] })
    const r = cell(1, { dff: true, inputs: [from(n)] })
    const r2 = cell(2, { dff: true, inputs: [] })
    const sr = cell(3, { truth: AND_NOT, inputs: [from(n), from(r2)] })
    const a = cell(4, {
      dff: true,
      negClk: true,
      truth: ONE,
      async: true,
      setNoReset: false,
      setReset: from(sr),
    })
    const b = cell(5, { dff: true, negClk: true, inputs: [from(a)] })
    r2.inputs = pad([from(r)])
    const at = run(
      { cells: [n, r, r2, sr, a, b] },
      drive((cy) => cy === 2),
      8,
    )
    // The worse of the two: `b` samples `a` AT the falling edge, so losing the force does not merely blip — it
    // writes the wrong value into the design's state and carries it forward.
    expect(at(a)).toBe('01100111')
    expect(at(b)).toBe('00110011')
  })

  /*
   * always @(posedge clk) r1 <= dg;
   * always @(negedge clk) n1 <= dg;
   * wire sr = r1 & ~n1;   wire cen = 1'b0;
   * always @(negedge clk or posedge sr) if (sr) a <= 1'b1; else if (cen) a <= 1'b0;
   *
   * dg rises at cycle 2; all registers start 0.   iverilog:  a = 00011111
   */
  test('a set asserted in the FIRST half is remembered even when nothing ever clocks it', () => {
    // The half of the fix the other tests could not see, and it took three attempts to find a case that does.
    // Only a RISING-edge flip-flop's output differs between the two halves of a cycle, so `sr` has to be driven
    // by one: `sr = ~r1` is high before the rising edge and low after it. `a` clocks on the falling edge with
    // its clock-enable low, so it never latches D — the set from the first half is the ONLY thing that will
    // ever write to it. Without committing that set, `a` reads 1 for one cycle and then falls back to 0 forever.
    const r1 = cell(0, { dff: true, inputs: [{ kind: 'primary', net: DG }] })
    const sr = cell(1, { truth: table((a) => !a), inputs: [from(r1)] })
    const a = cell(2, {
      dff: true,
      negClk: true,
      async: true,
      setNoReset: true, // asserted s_r SETS
      setReset: from(sr),
      clockEnable: { kind: 'const', value: false },
    })
    const at = run(
      { cells: [r1, sr, a] },
      drive(() => true),
      6,
    )
    expect(at(a)).toBe('111111')
  })
})

describe('which flip-flops clock on which edge', () => {
  test('two FALLING-edge flip-flops in series take a full cycle each, like any other pair', () => {
    // The partition predicate had no test at all: making a falling-edge flip-flop latch on BOTH edges left the
    // whole suite green. It shows up here — a negedge shift register would shuffle two places per clock, which
    // no shift register does.
    const head = cell(0, { dff: true, negClk: true, inputs: [{ kind: 'primary', net: DG }] })
    const tail = cell(1, { dff: true, negClk: true, inputs: [from(head)] })
    const at = run(
      { cells: [head, tail] },
      drive((cy) => cy === 1),
      8,
    )
    expect(at(head)).toBe('00100000')
    expect(at(tail)).toBe('00010000')
  })

  test('a falling-edge flip-flop feeding a RISING-edge one takes a full cycle, not half', () => {
    // The reverse of the fixed case, and the one an over-eager fix gets backwards: data crossing from a falling
    // edge to the NEXT rising edge has a full half-period to wait, so it lands one cycle later, not the same one.
    const head = cell(0, { dff: true, negClk: true, inputs: [{ kind: 'primary', net: DG }] })
    const tail = cell(1, { dff: true, inputs: [from(head)] })
    const at = run(
      { cells: [head, tail] },
      drive((cy) => cy === 1),
      8,
    )
    expect(at(head)).toBe('00100000')
    expect(at(tail)).toBe('00010000')
  })

  test('a RISING-edge flip-flop feeding a FALLING-edge one crosses within ONE cycle', () => {
    // And this is the case the whole change exists for, stated on its own rather than only inside a bitstream:
    // the falling-edge flip-flop samples half a period after the rising one latched, so both read 1 together.
    const head = cell(0, { dff: true, inputs: [{ kind: 'primary', net: DG }] })
    const tail = cell(1, { dff: true, negClk: true, inputs: [from(head)] })
    const at = run(
      { cells: [head, tail] },
      drive((cy) => cy === 1),
      8,
    )
    expect(at(head)).toBe('00100000')
    expect(at(tail)).toBe('00100000')
  })
})
