/**
 * RTL synthesis (increment 3) — SEQUENTIAL. A clocked `always @(posedge clk)` block must build REAL positive-
 * edge D flip-flops plus the next-state gates that feed them, so a design can remember and count between clock
 * ticks. Correctness is proven the only honest way a stateful block can be: by CLOCKING it on the real logic
 * engine (characterizeBlock refuses stateful blocks). One rising edge = a CLK-LOW solve then a CLK-HIGH solve,
 * with a single persistent state map threaded through simulateLogic — exactly the master-slave capture proven
 * in dff-clocked.test.ts. Nonblocking `<=` semantics (all reads see the pre-edge value), sync reset, enable
 * holds, case state machines, and honest reporting of what can't be built are all exercised here.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const supply = (volts: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
})
const src = (id: string, volts: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(volts) },
})
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

/** Import a Verilog module and assert it builds a block with no warnings; return the block. */
function build(verilog: string): BlockData {
  const { block, warnings } = importVerilog(verilog)
  expect(warnings, `warnings: ${warnings.join(' | ')}`).toEqual([])
  expect(block, 'should build a block').not.toBeNull()
  return block as BlockData
}

/** One logic solve of an imported block: drive each named input port 0/1, power it, read outputs by port id. */
function solve(block: BlockData, inputs: Record<string, boolean>, state: Map<string, boolean>) {
  const nodes: CanvasNodeLike[] = [
    { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    src('vp', 5),
  ]
  const edges: CanvasEdgeLike[] = [
    w('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
    w('eg', 'M', 'gnd', 'g', 'reference_terminal'),
    w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
  ]
  let k = 0
  for (const [port, val] of Object.entries(inputs)) {
    const vid = `v${k++}`
    nodes.push(src(vid, val ? 5 : 0))
    edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', port))
    edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
  }
  return simulateLogic(nodes, edges, state)
}

/** A rising clock edge: solve with clk LOW then clk HIGH (master grabs D, slave drives Q). Returns the high
 *  solve so outputs can be read. `inputs` are the non-clock inputs, held steady across both half-solves. */
function tick(block: BlockData, inputs: Record<string, boolean>, state: Map<string, boolean>) {
  solve(block, { ...inputs, clk: false }, state)
  return solve(block, { ...inputs, clk: true }, state)
}

/** Read a width-w unsigned register from output bit-ports name[0..w-1] (LSB = name[0]). */
const readReg = (
  r: { value: (n: string, p: string) => boolean | undefined },
  name: string,
  w: number,
): number => {
  let v = 0
  for (let i = 0; i < w; i++) if (r.value('M', `${name}[${i}]`) === true) v |= 1 << i
  return v
}

describe('sequential synthesis — a clocked always block builds real flip-flops', () => {
  test('a plain D flip-flop: q captures d on the rising edge and holds between edges', () => {
    const dff = build(
      'module dff(input clk, input d, output reg q); always @(posedge clk) q <= d; endmodule',
    )
    const state = new Map<string, boolean>()
    expect(tick(dff, { d: true }, state).value('M', 'q')).toBe(true) // edge 1 → q = 1
    // d falls while clk stays high → q holds (edge-, not level-, triggered)
    expect(solve(dff, { d: false, clk: true }, state).value('M', 'q')).toBe(true)
    expect(tick(dff, { d: false }, state).value('M', 'q')).toBe(false) // edge 2 → q = 0
    expect(tick(dff, { d: true }, state).value('M', 'q')).toBe(true) // edge 3 → q = 1
  })

  test('a 4-bit counter with synchronous reset counts up and wraps 15 → 0', () => {
    const counter = build(
      `module counter(input clk, input rst, output reg [3:0] count);
         always @(posedge clk)
           if (rst) count <= 0;
           else count <= count + 1;
       endmodule`,
    )
    const state = new Map<string, boolean>()
    expect(readReg(tick(counter, { rst: true }, state), 'count', 4)).toBe(0) // reset → 0
    for (let expected = 1; expected <= 20; expected++) {
      const got = readReg(tick(counter, { rst: false }, state), 'count', 4)
      expect(got, `after ${expected} clocks`).toBe(expected % 16) // 1,2,…,15,0,1,… (wraps)
    }
  })

  test('synchronous reset dominates: asserting rst on any edge forces 0', () => {
    const counter = build(
      `module counter(input clk, input rst, output reg [3:0] count);
         always @(posedge clk) count <= rst ? 4'd0 : count + 4'd1;
       endmodule`,
    )
    const state = new Map<string, boolean>()
    tick(counter, { rst: true }, state)
    tick(counter, { rst: false }, state)
    tick(counter, { rst: false }, state)
    expect(readReg(tick(counter, { rst: false }, state), 'count', 4)).toBe(3)
    expect(readReg(tick(counter, { rst: true }, state), 'count', 4)).toBe(0) // rst mid-count → 0
  })

  test('an enable register holds its value when the enable is low (single-branch if)', () => {
    const en = build(
      'module en(input clk, input en, input d, output reg q); always @(posedge clk) if (en) q <= d; endmodule',
    )
    const state = new Map<string, boolean>()
    expect(tick(en, { en: true, d: true }, state).value('M', 'q')).toBe(true) // load 1
    expect(tick(en, { en: false, d: false }, state).value('M', 'q')).toBe(true) // disabled → holds 1
    expect(tick(en, { en: false, d: true }, state).value('M', 'q')).toBe(true) // still holds
    expect(tick(en, { en: true, d: false }, state).value('M', 'q')).toBe(false) // enabled → loads 0
  })

  test('nonblocking assignment swaps two registers in one edge (reads see the pre-edge value)', () => {
    const swap = build(
      `module sw(input clk, input load, input x, input y, output reg a, output reg b);
         always @(posedge clk)
           if (load) begin a <= x; b <= y; end
           else begin a <= b; b <= a; end
       endmodule`,
    )
    const state = new Map<string, boolean>()
    let r = tick(swap, { load: true, x: true, y: false }, state) // a=1, b=0
    expect([r.value('M', 'a'), r.value('M', 'b')]).toEqual([true, false])
    r = tick(swap, { load: false, x: false, y: false }, state) // swap → a=0, b=1
    expect([r.value('M', 'a'), r.value('M', 'b')]).toEqual([false, true])
    r = tick(swap, { load: false, x: false, y: false }, state) // swap again → a=1, b=0
    expect([r.value('M', 'a'), r.value('M', 'b')]).toEqual([true, false])
  })

  test('an internal register named "syn0" does not collide with a synthesized net (fresh-name guard)', () => {
    // "syn0" is exactly the name fresh() hands out; if the always body's identifiers were not reserved, the
    // synthesized a&b gate would seize "syn0" and short/loop the register. A clean two-stage pipeline proves
    // the reservation holds: q trails (a & b) by two clocks, so a steady input settles q to that value.
    const pipe = build(
      `module m(input clk, input a, input b, output reg q);
         always @(posedge clk) begin
           syn0 <= a & b;
           q <= syn0;
         end
       endmodule`,
    )
    const state = new Map<string, boolean>()
    for (let i = 0; i < 3; i++) tick(pipe, { a: true, b: true }, state)
    expect(tick(pipe, { a: true, b: true }, state).value('M', 'q')).toBe(true)
    for (let i = 0; i < 3; i++) tick(pipe, { a: false, b: false }, state)
    expect(tick(pipe, { a: false, b: false }, state).value('M', 'q')).toBe(false)
  })

  test('a case statement builds a state machine: 0 → 1 → 2 → 0', () => {
    const fsm = build(
      `module fsm(input clk, input rst, output reg [1:0] state);
         always @(posedge clk)
           if (rst) state <= 2'd0;
           else case (state)
             2'd0: state <= 2'd1;
             2'd1: state <= 2'd2;
             2'd2: state <= 2'd0;
             default: state <= 2'd0;
           endcase
       endmodule`,
    )
    const state = new Map<string, boolean>()
    expect(readReg(tick(fsm, { rst: true }, state), 'state', 2)).toBe(0)
    const seen: number[] = []
    for (let i = 0; i < 6; i++) seen.push(readReg(tick(fsm, { rst: false }, state), 'state', 2))
    expect(seen).toEqual([1, 2, 0, 1, 2, 0])
  })
})

describe('sequential synthesis — honest reporting of what cannot be built', () => {
  const warnOf = (verilog: string): string[] => importVerilog(verilog).warnings

  test('an asynchronous reset (posedge clk or posedge rst) BUILDS, with no bogus leftovers', () => {
    // This block used to be reported as unbuildable. It describes a flip-flop with an asynchronous clear,
    // which is real hardware and is now built as one (see verilog-unbuilt-nets.test.ts for the behaviour
    // proof against a clear raised between clock edges).
    const warnings = warnOf(
      `module ff(input clk, input rst, input d, output reg q);
         always @(posedge clk or posedge rst) if (rst) q <= 0; else q <= d;
       endmodule`,
    )
    expect(warnings).toEqual([])
    // the else-branch must be part of the block — never misread as an "else" instance
    expect(warnings.some((x) => /module\/udp|instance "else"/i.test(x))).toBe(false)
  })

  test('a procedural for-loop is read as ONE statement, never as a module instance', () => {
    // `for (` used to look like an instantiation to the structural parser. The loop itself now UNROLLS and
    // builds (see verilog-loops.test.ts for the Icarus-checked behaviour); what is kept here is that neither
    // the building form nor the refusing one ever spills a bogus module/instance warning.
    expect(
      warnOf(
        `module m(input clk, input [3:0] d, output reg [3:0] q);
           integer i;
           always @(posedge clk) for (i = 0; i < 4; i = i + 1) q[i] <= d[i];
         endmodule`,
      ),
    ).toEqual([])
    // Undeclared, the same loop variable reads as a single bit and the loop is refused BY NAME — Icarus
    // Verilog 14.0 rejects that source outright ("register ``i'' unknown in m").
    const undeclared = warnOf(
      `module m(input clk, input [3:0] d, output reg [3:0] q);
         always @(posedge clk) for (i = 0; i < 4; i = i + 1) q[i] <= d[i];
       endmodule`,
    )
    expect(undeclared.some((x) => /reads as a single bit/.test(x))).toBe(true)
    expect(undeclared.some((x) => /module\/udp|instance/i.test(x))).toBe(false)
  })

  test('a blocking assignment in a clocked block is reported', () => {
    const warnings = warnOf(
      'module c(input clk, output reg [3:0] count); always @(posedge clk) count = count + 1; endmodule',
    )
    expect(warnings.some((x) => /blocking/i.test(x))).toBe(true)
  })

  test('a negedge clock is reported (the flip-flop is positive-edge)', () => {
    const warnings = warnOf(
      'module ff(input clk, input d, output reg q); always @(negedge clk) q <= d; endmodule',
    )
    expect(warnings.some((x) => /negedge/i.test(x))).toBe(true)
  })

  test('a combinational always @(*) now SYNTHESIZES to gates (no warning) — see verilog-synth.test.ts', () => {
    const warnings = warnOf(
      'module m(input a, input b, output reg y); always @(*) y = a & b; endmodule',
    )
    expect(warnings, `warnings: ${warnings.join(' | ')}`).toEqual([])
  })

  test('a clocked block that drives a BUS input port is reported at the bit level', () => {
    const warnings = warnOf(
      'module m(input clk, input [3:0] a, input [3:0] b); always @(posedge clk) a <= b; endmodule',
    )
    // "at the bit level" is the point: the report has to NAME the bits, not just the register.
    const named = warnings.filter((x) => /drives an input port/i.test(x))
    expect(named.length, `warnings: ${warnings.join(' | ')}`).toBe(1)
    for (const bit of ['a[0]', 'a[1]', 'a[2]', 'a[3]'])
      expect(named[0], `warnings: ${warnings.join(' | ')}`).toContain(bit)
  })

  test('a register written by two always blocks is reported as a multiple-driver conflict', () => {
    const warnings = warnOf(
      `module m(input clk, input a, input b, output reg q);
         always @(posedge clk) q <= a;
         always @(posedge clk) q <= b;
       endmodule`,
    )
    expect(warnings.some((x) => /more than one always block/i.test(x))).toBe(true)
  })
})

/**
 * PART-SELECT TARGETS — `pc[7:0] <= d`, `r[1] <= bit`. A register is not always written whole: the 8080's own
 * 16-bit register file loads its low and high bytes separately. Each part-write becomes the equivalent
 * whole-signal next state (`prior & keep | value << lo`), so two writes to DISJOINT slices of one register in
 * the same block BOTH take effect — the trap a naive rewrite falls into, where the later write clobbers the
 * earlier one. Checked against Icarus Verilog outside this file, vector for vector.
 */
describe('RTL synthesis — a write to PART of a register', () => {
  const clockOnce = (
    block: BlockData,
    ins: Record<string, boolean>,
    state: Map<string, boolean>,
  ) => {
    solve(block, { ...ins, clk: false }, state)
    return solve(block, { ...ins, clk: true }, state)
  }
  const read = (r: ReturnType<typeof solve>, name: string, width: number): number => {
    let v = 0
    for (let b = 0; b < width; b++) if (r.value('M', `${name}[${b}]`) === true) v |= 1 << b
    return v
  }
  const drive = (name: string, value: number, width: number): Record<string, boolean> =>
    Object.fromEntries(
      Array.from({ length: width }, (_, b) => [`${name}[${b}]`, ((value >> b) & 1) === 1]),
    )

  const REG = `
module m(input clk, input rst, input wl, input wh, input [7:0] d, output [15:0] q);
   reg [15:0] p;
   always @(posedge clk) begin
      if (rst) p <= 16'h0000;
      else begin
         if (wl) p[7:0] <= d;
         if (wh) p[15:8] <= d;
      end
   end
   assign q = p;
endmodule`

  test('a low-byte write leaves the high byte alone', () => {
    const block = build(REG)
    const state = new Map<string, boolean>()
    clockOnce(block, { rst: true, wl: false, wh: false, ...drive('d', 0, 8) }, state)
    clockOnce(block, { rst: false, wl: false, wh: true, ...drive('d', 0xab, 8) }, state)
    const r = clockOnce(block, { rst: false, wl: true, wh: false, ...drive('d', 0xcd, 8) }, state)
    expect(read(r, 'q', 16)).toBe(0xabcd)
  })

  test('TWO part-writes to disjoint slices in ONE block both take effect', () => {
    const block = build(REG)
    const state = new Map<string, boolean>()
    clockOnce(block, { rst: true, wl: false, wh: false, ...drive('d', 0, 8) }, state)
    const r = clockOnce(block, { rst: false, wl: true, wh: true, ...drive('d', 0x5a, 8) }, state)
    expect(read(r, 'q', 16)).toBe(0x5a5a)
  })

  test('a single-bit target writes exactly that bit', () => {
    const block = build(`
module m(input clk, input rst, input b1, input b3, output [3:0] q);
   reg [3:0] r;
   always @(posedge clk) begin
      if (rst) r <= 4'b0000;
      else begin
         r[1] <= b1;
         r[3] <= b3;
      end
   end
   assign q = r;
endmodule`)
    const state = new Map<string, boolean>()
    clockOnce(block, { rst: true, b1: false, b3: false }, state)
    const r = clockOnce(block, { rst: false, b1: true, b3: true }, state)
    expect(read(r, 'q', 4)).toBe(0b1010)
  })

  test('a part-write costs what the hand-written whole-signal form costs', () => {
    const selected = build(
      'module m(input clk, input wl, input [7:0] d, output [15:0] q); reg [15:0] p; always @(posedge clk) if (wl) p[7:0] <= d; assign q = p; endmodule',
    )
    const byHand = build(
      'module m(input clk, input wl, input [7:0] d, output [15:0] q); reg [15:0] p; always @(posedge clk) if (wl) p <= {p[15:8], d}; assign q = p; endmodule',
    )
    expect(selected.nodes.length).toBe(byHand.nodes.length)
  })

  test('a part-select target outside the signal is reported, not wrapped', () => {
    const { warnings } = importVerilog(
      'module m(input clk, input d, output [3:0] q); reg [3:0] r; always @(posedge clk) r[7] <= d; assign q = r; endmodule',
    )
    expect(
      warnings.some((w) => w.includes('outside the 4-bit signal')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
  })

  test('a NON-constant bit-select target is reported (it would need a decoder)', () => {
    const { warnings } = importVerilog(
      'module m(input clk, input [1:0] i, input d, output [3:0] q); reg [3:0] r; always @(posedge clk) r[i] <= d; assign q = r; endmodule',
    )
    expect(
      warnings.some((w) => w.toLowerCase().includes('non-constant bit-select')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
  })
})
