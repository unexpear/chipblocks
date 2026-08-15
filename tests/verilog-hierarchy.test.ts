/**
 * VERILOG HIERARCHY — a design written as SEVERAL modules. Our compiler was good at one self-contained
 * module; every real CPU published as Verilog is written the other way, so a sub-module instance had to stop
 * being "reported, not built".
 *
 * Correctness is proven by EXECUTION, not by inspecting the netlist: each design is imported, its real gates
 * are clocked/solved on the logic engine, and the outputs are checked against a truth table computed by hand
 * here. The same designs were also cross-checked against Icarus Verilog (an independent simulator) outside
 * this file; these tests are the regression net that keeps the behaviour.
 *
 * The honest-refusal half matters just as much: an instance of a module the source does not define, a
 * parameter override, an instance array, a recursive instantiation, a duplicate instance name, a connection
 * to a port that does not exist, and an unconnected input are each REPORTED and left unbuilt.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { characterizeBlock, simulateLogic } from '../src/renderer/logic-sim.ts'
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

const hasWarning = (ws: string[], needle: string) => ws.some((w) => w.includes(needle))

/** Import and assert the build is clean. `allowed` names the warnings a design is EXPECTED to raise (an
 *  unrepresentable port, say); anything else still fails, so a new warning can never slip in unnoticed. */
function build(verilog: string, allowed: string[] = []): BlockData {
  const { block, warnings } = importVerilog(verilog)
  const unexpected = warnings.filter((w) => !allowed.some((a) => w.includes(a)))
  expect(unexpected, `warnings: ${warnings.join(' | ')}`).toEqual([])
  expect(block, 'should build a block').not.toBeNull()
  return block as BlockData
}

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

/** Drive a bus of input bit-ports from a number, solve, and read a bus of output bit-ports back. */
function evaluate(
  block: BlockData,
  ins: Record<string, { value: number; width: number }>,
  outs: Record<string, number>,
): Record<string, number> {
  const levels: Record<string, boolean> = {}
  for (const [name, spec] of Object.entries(ins))
    for (let b = 0; b < spec.width; b++)
      levels[spec.width === 1 ? name : `${name}[${b}]`] = ((spec.value >> b) & 1) === 1
  const result = solve(block, levels, new Map())
  const read: Record<string, number> = {}
  for (const [name, width] of Object.entries(outs)) {
    let v = 0
    for (let b = 0; b < width; b++)
      if (result.value('M', width === 1 ? name : `${name}[${b}]`) === true) v |= 1 << b
    read[name] = v
  }
  return read
}

const HALF_ADDER = `
module half_adder(input a, input b, output s, output c);
   assign s = a ^ b;
   assign c = a & b;
endmodule`

describe('Verilog hierarchy — a sub-module instance is BUILT', () => {
  test('a two-module design computes the half-adder table its sub-module defines', () => {
    const block = build(`${HALF_ADDER}
module top(input x, input y, output sum, output carry);
   half_adder h(.a(x), .b(y), .s(sum), .c(carry));
endmodule`)
    const table = [
      { x: 0, y: 0, sum: 0, carry: 0 },
      { x: 0, y: 1, sum: 1, carry: 0 },
      { x: 1, y: 0, sum: 1, carry: 0 },
      { x: 1, y: 1, sum: 0, carry: 1 },
    ]
    for (const row of table) {
      const got = evaluate(
        block,
        { x: { value: row.x, width: 1 }, y: { value: row.y, width: 1 } },
        { sum: 1, carry: 1 },
      )
      expect(got, `x=${row.x} y=${row.y}`).toEqual({ sum: row.sum, carry: row.carry })
    }
  })

  test('a whole-net connection of matching width is a RENAME — it costs no extra gate', () => {
    const hierarchical = build(`${HALF_ADDER}
module top(input x, input y, output sum, output carry);
   half_adder h(.a(x), .b(y), .s(sum), .c(carry));
endmodule`)
    const flat = build(`
module top(input x, input y, output sum, output carry);
   assign sum = x ^ y;
   assign carry = x & y;
endmodule`)
    expect(hierarchical.nodes.length).toBe(flat.nodes.length)
  })

  test('the SAME module instantiated twice gives two independent copies', () => {
    const block = build(`${HALF_ADDER}
module top(input a0, input b0, input a1, input b1, output s0, output s1, output c1);
   half_adder h0(.a(a0), .b(b0), .s(s0), .c());
   half_adder h1(.a(a1), .b(b1), .s(s1), .c(c1));
endmodule`)
    // h0 and h1 must not share nets: a carry only in h1 must not appear on h0's sum, and vice versa.
    const got = evaluate(
      block,
      {
        a0: { value: 1, width: 1 },
        b0: { value: 0, width: 1 },
        a1: { value: 1, width: 1 },
        b1: { value: 1, width: 1 },
      },
      { s0: 1, s1: 1, c1: 1 },
    )
    expect(got).toEqual({ s0: 1, s1: 0, c1: 1 })
  })

  test('nested hierarchy + positional connections + bit-selects: a 4-bit ripple adder from four 1-bit cells', () => {
    const block = build(`
module full_adder(input a, input b, input cin, output s, output cout);
   wire p;
   assign p = a ^ b;
   assign s = p ^ cin;
   assign cout = (a & b) | (p & cin);
endmodule

module adder4(input [3:0] a, input [3:0] b, input cin, output [3:0] s, output cout);
   wire [2:0] c;
   full_adder f0(a[0], b[0], cin,  s[0], c[0]);
   full_adder f1(a[1], b[1], c[0], s[1], c[1]);
   full_adder f2(a[2], b[2], c[1], s[2], c[2]);
   full_adder f3(a[3], b[3], c[2], s[3], cout);
endmodule

module top(input [3:0] a, input [3:0] b, output [4:0] y);
   wire cout;
   wire [3:0] s;
   adder4 u(.a(a), .b(b), .cin(1'b0), .s(s), .cout(cout));
   assign y = {cout, s};
endmodule`)
    for (const [a, b] of [
      [0, 0],
      [1, 1],
      [7, 8],
      [9, 9],
      [15, 1],
      [15, 15],
      [6, 5],
    ] as [number, number][]) {
      const got = evaluate(
        block,
        { a: { value: a, width: 4 }, b: { value: b, width: 4 } },
        { y: 5 },
      )
      expect(got.y, `${a} + ${b}`).toBe(a + b)
    }
  })

  test('a sub-module holding flip-flops keeps its own state per instance (two independent toggles)', () => {
    const block = build(`
module toggler(input clk, input en, output q);
   reg r;
   always @(posedge clk) if (en) r <= ~r;
   assign q = r;
endmodule

module top(input clk, input en0, input en1, output q0, output q1);
   toggler t0(.clk(clk), .en(en0), .q(q0));
   toggler t1(.clk(clk), .en(en1), .q(q1));
endmodule`)
    const state = new Map<string, boolean>()
    // Only t0 is enabled: q0 must toggle every clock while q1 stays put.
    const seen: string[] = []
    for (let n = 0; n < 4; n++) {
      solve(block, { clk: false, en0: true, en1: false }, state)
      const r = solve(block, { clk: true, en0: true, en1: false }, state)
      seen.push(`${r.value('M', 'q0') === true ? 1 : 0}${r.value('M', 'q1') === true ? 1 : 0}`)
    }
    expect(seen).toEqual(['10', '00', '10', '00'])
  })

  test('a sub-module used twice keeps its own FUNCTION and its own memory, not the other copy s', () => {
    const block = build(`
module lut(input [1:0] sel, output [3:0] y);
   function [3:0] pick(input [1:0] s);
      pick = 4'd1 << s;
   endfunction
   assign y = pick(sel);
endmodule

module top(input [1:0] s0, input [1:0] s1, output [3:0] y0, output [3:0] y1);
   lut a(.sel(s0), .y(y0));
   lut b(.sel(s1), .y(y1));
endmodule`)
    const got = evaluate(
      block,
      { s0: { value: 0, width: 2 }, s1: { value: 3, width: 2 } },
      { y0: 4, y1: 4 },
    )
    expect(got).toEqual({ y0: 1, y1: 8 })
  })

  test('parameters stay module-scoped: the same name with different values in two modules', () => {
    const block = build(`
module widen #(parameter W = 3) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule

module top #(parameter W = 2) (input [2:0] a, output [2:0] y);
   widen u(.a(a), .y(y));
endmodule`)
    const got = evaluate(block, { a: { value: 0b010, width: 3 } }, { y: 3 })
    expect(got.y).toBe(0b101)
  })

  test('control flow inside a sub-module survives instancing (if/else and case are NOT identifiers)', () => {
    // Our lexer hands `if`/`else`/`case`/`default` to the parsers as id tokens keyed on by VALUE, so a
    // flattener that prefixed every id would rewrite `if` to `u.if` and the statement would parse as a task
    // call. This design is pure control flow: if it builds and computes, none of those words was renamed.
    const block = build(`
module chooser(input [1:0] sel, input a, input b, output reg y);
   always @* begin
      case (sel)
         2'd0: y = a;
         2'd1: y = b;
         default: if (a) y = 1'b1; else y = 1'b0;
      endcase
   end
endmodule

module top(input [1:0] sel, input a, input b, output y);
   chooser u(.sel(sel), .a(a), .b(b), .y(y));
endmodule`)
    const rows = [
      { sel: 0, a: 1, b: 0, y: 1 },
      { sel: 1, a: 1, b: 0, y: 0 },
      { sel: 1, a: 0, b: 1, y: 1 },
      { sel: 2, a: 1, b: 0, y: 1 },
      { sel: 3, a: 0, b: 1, y: 0 },
    ]
    for (const row of rows) {
      const got = evaluate(
        block,
        {
          sel: { value: row.sel, width: 2 },
          a: { value: row.a, width: 1 },
          b: { value: row.b, width: 1 },
        },
        { y: 1 },
      )
      expect(got.y, `sel=${row.sel} a=${row.a} b=${row.b}`).toBe(row.y)
    }
  })

  test('a port is only RENAMED when the widths match — a wider enclosing net is truncated, not aliased', () => {
    // The sub-module reduces its 2-bit port with `&`. Aliasing the port to the 4-bit enclosing net would
    // silently reduce four bits instead of two, so 4'b0011 tells the two apart: 2 bits → 1, 4 bits → 0.
    const block = build(`
module inner(input [1:0] a, output y);
   assign y = &a;
endmodule
module top(input [3:0] a, output y, output all);
   inner u(.a(a), .y(y));
   assign all = &a;
endmodule`)
    // 4'b0011: the two low bits are both 1 (y = 1) while all four are not (all = 0).
    expect(evaluate(block, { a: { value: 0b0011, width: 4 } }, { y: 1, all: 1 })).toEqual({
      y: 1,
      all: 0,
    })
    expect(evaluate(block, { a: { value: 0b1110, width: 4 } }, { y: 1, all: 1 })).toEqual({
      y: 0,
      all: 0,
    })
  })

  test('an instance prefix cannot collide with an escaped identifier that already spells one', () => {
    // `\u0.w ` is a legal net name that spells exactly what prefixing the sub-module's internal `w` for
    // instance `u0` would produce. If the flattener used that name anyway both would drive one net.
    const block = build(`
module inner(input a, output y);
   wire w;
   assign w = ~a;
   assign y = w;
endmodule
module top(input a, input b, output y0, output y1);
   wire \\u0.w ;
   assign \\u0.w = a & b;
   inner u0(.a(a), .y(y0));
   assign y1 = \\u0.w ;
endmodule`)
    const got = evaluate(
      block,
      { a: { value: 0, width: 1 }, b: { value: 1, width: 1 } },
      { y0: 1, y1: 1 },
    )
    expect(got).toEqual({ y0: 1, y1: 0 })
  })

  test('a net whose ESCAPED name spells a reserved word is still scoped per instance', () => {
    // `\posedge ` is a legal net name that lexes to the bare word `posedge`. It must be renamed per instance
    // (or the two copies would short together) while the syntax word `posedge` in `always @(posedge clk)`
    // must not be — the same eight characters, two different jobs.
    const block = build(`
module inner(input clk, input a, output q);
   wire \\posedge ;
   reg r;
   assign \\posedge = ~a;
   always @(posedge clk) r <= \\posedge ;
   assign q = r;
endmodule

module top(input clk, input a0, input a1, output q0, output q1);
   inner u0(.clk(clk), .a(a0), .q(q0));
   inner u1(.clk(clk), .a(a1), .q(q1));
endmodule`)
    const state = new Map<string, boolean>()
    solve(block, { clk: false, a0: true, a1: false }, state)
    const r = solve(block, { clk: true, a0: true, a1: false }, state)
    expect(r.value('M', 'q0')).toBe(false)
    expect(r.value('M', 'q1')).toBe(true)
  })

  test('the top module is the one nothing instantiates, even when it is written LAST', () => {
    const { moduleName, warnings } = importVerilog(`${HALF_ADDER}
module top(input x, input y, output sum, output carry);
   half_adder h(.a(x), .b(y), .s(sum), .c(carry));
endmodule`)
    expect(moduleName).toBe('top')
    expect(warnings).toEqual([])
  })

  test('the top module is found when the sub-module is written FIRST and the top LAST', () => {
    const { moduleName } = importVerilog(`
module top(input x, input y, output sum);
   inner i(.a(x), .b(y), .s(sum));
endmodule
module inner(input a, input b, output s);
   assign s = a | b;
endmodule`)
    expect(moduleName).toBe('top')
  })
})

describe('Verilog hierarchy — what cannot be built is REPORTED, never guessed', () => {
  const has = (ws: string[], needle: string) =>
    ws.some((x) => x.toLowerCase().includes(needle.toLowerCase()))

  test('an instance of a module this source does not define is reported, not built', () => {
    const { warnings } = importVerilog(
      'module m(input a, output y); my_cell u1(.i(a), .o(y)); endmodule',
    )
    expect(has(warnings, 'no module "my_cell" is defined in this source')).toBe(true)
  })

  test('a parameter override on an instance is APPLIED, not built at the module default', () => {
    // Icarus Verilog 14.0 on this exact source, swept over all 16 values of `a`, gives y = ~a on four bits
    // (0101 -> 1010). Built at the module's own default W=1 it would be a one-bit design with a[1..3] and
    // y[1..3] missing from the interface entirely.
    const block = build(`
module inner #(parameter W = 1) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(.W(4)) u(.a(a), .y(y));
endmodule`)
    expect(evaluate(block, { a: { value: 0b0101, width: 4 } }, { y: 4 })).toEqual({ y: 0b1010 })
  })

  test('an instance ARRAY is reported, not silently built as one copy', () => {
    const { warnings } = importVerilog(`${HALF_ADDER}
module top(input [1:0] x, input [1:0] y, output [1:0] s, output [1:0] c);
   half_adder h[1:0](.a(x), .b(y), .s(s), .c(c));
endmodule`)
    expect(has(warnings, 'instance array')).toBe(true)
  })

  test('a module that instantiates itself is reported, not expanded forever', () => {
    const { warnings } = importVerilog(`
module loopy(input a, output y);
   loopy u(.a(a), .y(y));
endmodule
module top(input a, output y);
   loopy l(.a(a), .y(y));
endmodule`)
    expect(has(warnings, 'cannot instantiate itself')).toBe(true)
  })

  test('an indirect instantiation cycle (a → b → a) is reported, not expanded forever', () => {
    const { warnings } = importVerilog(`
module a_mod(input a, output y);
   b_mod u(.a(a), .y(y));
endmodule
module b_mod(input a, output y);
   a_mod u(.a(a), .y(y));
endmodule
module top(input a, output y);
   a_mod u(.a(a), .y(y));
endmodule`)
    expect(has(warnings, 'cannot instantiate itself')).toBe(true)
  })

  test('two instances sharing one name are reported — the second is not built', () => {
    const { warnings } = importVerilog(`${HALF_ADDER}
module top(input x, input y, output s0, output s1);
   half_adder h(.a(x), .b(y), .s(s0), .c());
   half_adder h(.a(y), .b(x), .s(s1), .c());
endmodule`)
    expect(has(warnings, 'shares this name')).toBe(true)
  })

  test('a connection to a port the module does not declare is reported, not connected', () => {
    const { warnings } = importVerilog(`${HALF_ADDER}
module top(input x, input y, output sum);
   half_adder h(.a(x), .b(y), .s(sum), .nonesuch(x));
endmodule`)
    expect(has(warnings, 'does not declare as a usable port')).toBe(true)
  })

  test('an unconnected INPUT port is reported (it reads 0, and that is said out loud)', () => {
    const { warnings } = importVerilog(`${HALF_ADDER}
module top(input x, output sum);
   half_adder h(.a(x), .s(sum));
endmodule`)
    expect(has(warnings, 'leaves input port "b" unconnected')).toBe(true)
  })

  test('an unconnected OUTPUT port is ordinary and is NOT warned about', () => {
    const { warnings } = importVerilog(`${HALF_ADDER}
module top(input x, input y, output sum);
   half_adder h(.a(x), .b(y), .s(sum), .c());
endmodule`)
    expect(warnings).toEqual([])
  })

  test('more positional connections than the module has ports is reported', () => {
    const { warnings } = importVerilog(`${HALF_ADDER}
module top(input x, input y, output sum, output carry);
   half_adder h(x, y, sum, carry, x);
endmodule`)
    expect(has(warnings, 'positional connections')).toBe(true)
  })

  test('two independent top-level modules: the first is imported and which one is SAID', () => {
    const { moduleName, warnings } = importVerilog(`
module one(input a, output y); assign y = ~a; endmodule
module two(input a, output y); assign y = a; endmodule`)
    expect(moduleName).toBe('one')
    expect(has(warnings, 'top-level')).toBe(true)
  })

  test('a module declared twice is reported — the later one does not silently win', () => {
    const { warnings } = importVerilog(`
module m(input a, output y); assign y = ~a; endmodule
module m(input a, output y); assign y = a; endmodule`)
    expect(has(warnings, 'declared more than once')).toBe(true)
  })

  test('an escaped identifier containing a dot cannot collide with an instance prefix', () => {
    const block = build(`${HALF_ADDER}
module top(input x, input y, output sum, output carry);
   wire \\h.a ;
   assign \\h.a = ~x;
   half_adder h(.a(\\h.a ), .b(y), .s(sum), .c(carry));
endmodule`)
    // \h.a is ~x, so sum = ~x ^ y. With x=0,y=0 that is 1 — it would be 0 if the escaped net had been
    // swallowed by the instance's own "h.a" port net.
    const got = evaluate(
      block,
      { x: { value: 0, width: 1 }, y: { value: 0, width: 1 } },
      { sum: 1, carry: 1 },
    )
    expect(got).toEqual({ sum: 1, carry: 0 })
  })
})

/**
 * SIGNEDNESS ACROSS A PORT. `signed` is a property of the DECLARATION that reads a net, not of the wire, and
 * IEEE 1364-2005 lets the two ends of a port disagree. The flattener's whole-net rename fuses the two ends
 * into ONE name with ONE signedness, so a rename can only be taken when both ends agree; otherwise the port
 * keeps its own net and a same-width assignment copies the bits across.
 *
 * Every expected number below was produced by Icarus Verilog 14.0 running the SAME source, exhaustively over
 * all 16 values of the 4-bit input, and the mismatching half of each table is the half a leak corrupts.
 */
describe('Verilog hierarchy — signedness cannot leak across a port', () => {
  const sweep = (block: BlockData, outs: Record<string, number>) =>
    Array.from({ length: 16 }, (_, n) => evaluate(block, { n: { value: n, width: 4 } }, outs))

  test('a child SIGNED input port does not make the parent net signed', () => {
    // top declares `n` unsigned, so `n >>> 1` is a LOGICAL shift there; the sub-module's `a` is signed.
    const block = build(`
module sgn(input signed [3:0] a, output [3:0] y);
   assign y = a;
endmodule
module top(input [3:0] n, output [3:0] sh, output [3:0] ig);
   sgn u(.a(n), .y(ig));
   assign sh = n >>> 1;
endmodule`)
    // iverilog: 0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7 — a leak turns the top half into 12,12,13,13,14,14,15,15.
    expect(sweep(block, { sh: 4 }).map((r) => r.sh)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7,
    ])
  })

  test('a parent SIGNED net does not make the child port signed', () => {
    // The sub-module declares `a` unsigned, so ITS `a >>> 1` is logical even though top's `n` is signed.
    const block = build(`
module uns(input [3:0] a, output [3:0] y);
   assign y = a >>> 1;
endmodule
module top(input signed [3:0] n, output [3:0] r);
   uns u(.a(n), .y(r));
endmodule`)
    expect(sweep(block, { r: 4 }).map((r) => r.r)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7,
    ])
  })

  test('a child SIGNED output does not make the parent net sign-extend', () => {
    // `m` is declared unsigned in top, so `wide = m` ZERO-extends; the sub-module's `y` is signed.
    const block = build(`
module gen(input [3:0] a, output signed [3:0] y);
   assign y = a;
endmodule
module top(input [3:0] n, output [7:0] wide);
   wire [3:0] m;
   gen u(.a(n), .y(m));
   assign wide = m;
endmodule`)
    expect(sweep(block, { wide: 8 }).map((r) => r.wide)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ])
  })

  test('when both ends AGREE the arithmetic shift still happens — and it is still a rename', () => {
    // Both ports and both enclosing nets are signed, so every connection stays a rename and the design costs
    // exactly what the flat one costs. n[0] is genuinely unused — an arithmetic right shift discards it — so
    // its port is honestly omitted.
    const hierarchical = build(
      `
module sgn(input signed [3:0] a, output signed [3:0] y);
   assign y = a >>> 1;
endmodule
module top(input signed [3:0] n, output signed [3:0] r);
   sgn u(.a(n), .y(r));
endmodule`,
      ['port "n[0]" is not connected'],
    )
    // iverilog: the top half sign-fills — 12,12,13,13,14,14,15,15.
    expect(sweep(hierarchical, { r: 4 }).map((r) => r.r)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 12, 12, 13, 13, 14, 14, 15, 15,
    ])
    const flat = build(
      `
module top(input signed [3:0] n, output signed [3:0] r);
   assign r = n >>> 1;
endmodule`,
      ['port "n[0]" is not connected'],
    )
    expect(hierarchical.nodes.length).toBe(flat.nodes.length)
  })

  test('a SIGNED input port keeps its signedness when the enclosing net is unsigned', () => {
    // The arithmetic that reads the port lives INSIDE the sub-module, so the port's own net must carry the
    // signedness — the enclosing `n` is unsigned and must stay that way.
    const block = build(`
module sgn(input signed [3:0] a, output [3:0] y);
   assign y = a >>> 1;
endmodule
module top(input [3:0] n, output [3:0] r);
   sgn u(.a(n), .y(r));
endmodule`)
    // iverilog: the top half sign-fills, because `a` is signed inside sgn.
    expect(sweep(block, { r: 4 }).map((r) => r.r)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 12, 12, 13, 13, 14, 14, 15, 15,
    ])
  })

  test('a signedness disagreement costs one buffer per bit — and nothing more', () => {
    // The disagreeing port stops being a rename and becomes a real same-width copy, which is the honest
    // price named in the module header: four extra buffer cells on a 4-bit port, not a re-synthesis.
    const agree = build(`
module gen(input [3:0] a, output [3:0] y);
   assign y = a;
endmodule
module top(input [3:0] n, output [3:0] m);
   gen u(.a(n), .y(m));
endmodule`)
    const disagree = build(`
module gen(input [3:0] a, output signed [3:0] y);
   assign y = a;
endmodule
module top(input [3:0] n, output [3:0] m);
   gen u(.a(n), .y(m));
endmodule`)
    expect(disagree.nodes.length - agree.nodes.length).toBe(4)
  })

  test("a child's own INTERNAL signed net keeps its signedness through the inlining", () => {
    // `t` is not a port, so only the flattener's copy of the child's signed set can carry it. Without that
    // copy `t >>> 1` becomes a logical shift and the top half of the table collapses.
    const block = build(`
module ch(input [3:0] a, output [3:0] y);
   wire signed [3:0] t;
   assign t = a;
   assign y = t >>> 1;
endmodule
module top(input [3:0] n, output [3:0] r);
   ch u(.a(n), .y(r));
endmodule`)
    expect(sweep(block, { r: 4 }).map((r) => r.r)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 12, 12, 13, 13, 14, 14, 15, 15,
    ])
  })
})

/**
 * A POSITIONAL connection list counts ports from the left. When this importer cannot represent a header port
 * it leaves that port out of the module's PORT ORDER — but positions are counted against `portPositions`,
 * which keeps an empty place for every dropped port. So position N in the source stays port N: the connection
 * opposite the gap is reported and dropped, and every connection PAST the gap still lands on its real port.
 *
 * These tests used to assert the opposite — that such an instance was refused outright — because counting
 * against the surviving ports was the only option and a misaligned build is worse than no build. Keeping the
 * place made the refusal unnecessary, so what is pinned here now is the ALIGNMENT ITSELF: each design must
 * compute q = ~p. Under the old counting the connection after the gap fell off the end of the list and `q`
 * ended up with no driver at all, reading 0 for both inputs — which is what these assertions would catch.
 */
describe('Verilog hierarchy — a positional list past a dropped port ALIGNS, and is not misaligned', () => {
  const INOUT_CHILD = `
module ch(input a, inout b, output y);
   assign y = ~a;
endmodule`

  test('a positional instance past a dropped inout still reaches the right port', () => {
    const { block, warnings } = importVerilog(`${INOUT_CHILD}
module top(input p, output q);
   wire z;
   ch u(p, z, q);
endmodule`)
    // The connection opposite the gap is named and dropped — position 2, the inout, not some later port.
    expect(
      hasWarning(warnings, 'connects position 2 to a port this importer cannot represent (b)'),
    ).toBe(true)
    expect(block).not.toBeNull()
    // and position 3 still reaches `y`, so the design inverts. `q` reading 0 for both inputs is the
    // misalignment signature: the third connection would have fallen off a two-entry port list.
    expect(evaluate(block as BlockData, { p: { value: 0, width: 1 } }, { q: 1 })).toEqual({ q: 1 })
    expect(evaluate(block as BlockData, { p: { value: 1, width: 1 } }, { q: 1 })).toEqual({ q: 0 })
  })

  test('a dropped port at the END of the list leaves the earlier connections untouched', () => {
    // The control for the case above: with the gap last, both counting schemes agree on positions 1 and 2,
    // so this passes either way and isolates what the previous test is really measuring.
    const block = build(
      `
module ch(input a, output y, inout b);
   assign y = ~a;
endmodule
module top(input p, output q);
   wire z;
   ch u(p, q, z);
endmodule`,
      ['inout port "b"', 'connects position 3'],
    )
    expect(evaluate(block, { p: { value: 0, width: 1 } }, { q: 1 })).toEqual({ q: 1 })
    expect(evaluate(block, { p: { value: 1, width: 1 } }, { q: 1 })).toEqual({ q: 0 })
  })

  test('the SAME module built with NAMED connections still works', () => {
    const block = build(
      `${INOUT_CHILD}
module top(input p, output q);
   ch u(.a(p), .y(q));
endmodule`,
      ['inout port "b"'],
    )
    expect(evaluate(block, { p: { value: 0, width: 1 } }, { q: 1 })).toEqual({ q: 1 })
    expect(evaluate(block, { p: { value: 1, width: 1 } }, { q: 1 })).toEqual({ q: 0 })
  })

  test('a positional instance of a module with NO dropped port still builds', () => {
    const block = build(`
module ch(input a, input b, output y);
   assign y = a & b;
endmodule
module top(input p, input r, output q);
   ch u(p, r, q);
endmodule`)
    expect(
      evaluate(block, { p: { value: 1, width: 1 }, r: { value: 1, width: 1 } }, { q: 1 }),
    ).toEqual({ q: 1 })
    expect(
      evaluate(block, { p: { value: 1, width: 1 }, r: { value: 0, width: 1 } }, { q: 1 }),
    ).toEqual({ q: 0 })
  })

  test('a port whose range this importer cannot read leaves the same gap, and the same alignment', () => {
    // The other way a port gets dropped: the header parses but the range is one this importer will not
    // represent. It must hold a place exactly like the inout, or the gap silently closes again.
    const { block, warnings } = importVerilog(`
module ch(input a, input [3:1] wide, output y);
   assign y = ~a;
endmodule
module top(input p, output q);
   wire [2:0] z;
   ch u(p, z, q);
endmodule`)
    expect(
      hasWarning(warnings, 'connects position 2 to a port this importer cannot represent (wide)'),
    ).toBe(true)
    expect(block).not.toBeNull()
    expect(evaluate(block as BlockData, { p: { value: 0, width: 1 } }, { q: 1 })).toEqual({ q: 1 })
    expect(evaluate(block as BlockData, { p: { value: 1, width: 1 } }, { q: 1 })).toEqual({ q: 0 })
  })
})

/**
 * CONTENTION THROUGH A SUB-MODULE PORT. A port connection of matching width is a rename, so the sub-module's
 * driver becomes a continuous assignment in the parent — one that lands AFTER the parent's own assignments.
 * That order is the whole difference: when the parent drove one bit first, the sub-module's whole-bus driver
 * was the one thrown away, and every bit of the bus went dead while the warning named a single bit.
 *
 * Each expectation below was taken from Icarus Verilog 14.0 run on the same source over all 256 (a, b)
 * vectors: a bit Icarus prints as x has NO driver here, and a bit it prints as 0/1 keeps its driver and
 * carries that value. `hierPorts` reads the interface; `hierTable` proves the surviving bits still compute.
 */
describe('Verilog hierarchy — a contended bit costs one bit, not the bus', () => {
  const SUB = 'module g(input [3:0] d, output [3:0] o); assign o = d; endmodule'
  const importOf = (verilog: string) => {
    const { block, warnings } = importVerilog(verilog)
    return { block, warnings, ids: block === null ? [] : block.ports.map((p) => p.id) }
  }
  /**
   * Every surviving output bit must equal the same-numbered `a` bit — the sub-module's own function — and
   * every other bit of `o` must be absent. Read by NAME rather than by position, because a retracted driver
   * can leave its now-dead input gates behind, and those keep their input ports in the interface.
   */
  const assertPassesThrough = (block: BlockData, bits: number[]) => {
    const tt = characterizeBlock(block)
    expect(tt, 'should characterize as combinational').not.toBeNull()
    if (tt === null) return
    expect(tt.outputs.filter((id) => id.startsWith('o['))).toEqual(bits.map((i) => `o[${i}]`))
    const pairs = bits.map((i) => [tt.inputs.indexOf(`a[${i}]`), tt.outputs.indexOf(`o[${i}]`)])
    for (const [ai] of pairs) expect(ai).toBeGreaterThanOrEqual(0)
    for (const row of tt.rows)
      for (const [ai, oi] of pairs)
        expect(row.out[oi as number], `in ${row.in.join(',')}`).toBe(row.in[ai as number])
  }

  test('one contended bit: the other three still carry the sub-module output', () => {
    // iverilog: o[3:1] = a[3:1] on all 256 vectors; o[0] = x whenever a[0] and b[0] differ.
    const { block, ids, warnings } = importOf(`${SUB}
module top(input [3:0] a, input [3:0] b, output [3:0] o);
   g u(.d(a), .o(o));
   assign o[0] = b[0];
endmodule`)
    expect(block, `warnings: ${warnings.join(' | ')}`).not.toBeNull()
    expect(ids).not.toContain('o[0]')
    assertPassesThrough(block as BlockData, [1, 2, 3])
  })

  test('two contended bits, named together in one warning', () => {
    // iverilog: o[1] = a[1] and o[3] = a[3] always; o[0] and o[2] are x wherever a and b disagree there.
    const { block, ids, warnings } = importOf(`${SUB}
module top(input [3:0] a, input [3:0] b, output [3:0] o);
   g u(.d(a), .o(o));
   assign o[0] = b[0];
   assign o[2] = b[2];
endmodule`)
    expect(ids).not.toContain('o[0]')
    expect(ids).not.toContain('o[2]')
    assertPassesThrough(block as BlockData, [1, 3])
    const contention = warnings.filter((w) => w.includes('assigned more than once'))
    expect(contention.length, `warnings: ${warnings.join(' | ')}`).toBe(1)
    for (const dead of ['"o[0]"', '"o[2]"']) expect(contention[0]).toContain(dead)
  })

  test('a contended part-select range', () => {
    const { block, ids } = importOf(`${SUB}
module top(input [3:0] a, input [3:0] b, output [3:0] o);
   g u(.d(a), .o(o));
   assign o[2:1] = b[2:1];
endmodule`)
    expect(ids).not.toContain('o[1]')
    expect(ids).not.toContain('o[2]')
    assertPassesThrough(block as BlockData, [0, 3])
  })

  test('the WHOLE bus contended: nothing is built, and the message says every bit', () => {
    const { ids, warnings } = importOf(`${SUB}
module top(input [3:0] a, input [3:0] b, output [3:0] o);
   g u(.d(a), .o(o));
   assign o = b;
endmodule`)
    for (const bit of ['o[0]', 'o[1]', 'o[2]', 'o[3]']) expect(ids).not.toContain(bit)
    const contention = warnings.filter((w) => w.includes('assigned more than once'))
    expect(contention.length, `warnings: ${warnings.join(' | ')}`).toBe(1)
    expect(contention[0]).toContain('every bit')
  })

  test('TWO sub-modules driving one bus: neither drives it', () => {
    const { ids, warnings } = importOf(`${SUB}
module h(input [3:0] d, output [3:0] o); assign o = d; endmodule
module top(input [3:0] a, input [3:0] b, output [3:0] o);
   g u0(.d(a), .o(o));
   h u1(.d(b), .o(o));
endmodule`)
    for (const bit of ['o[0]', 'o[1]', 'o[2]', 'o[3]']) expect(ids).not.toContain(bit)
    expect(
      warnings.some((w) => w.includes('every bit') && w.includes('assigned more than once')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
  })

  test('TWO sub-modules sharing ONE bit: the other three bits survive', () => {
    // iverilog: o[3:1] = a[3:1]; o[0] = x where a[0] and b[0] differ.
    const { block, ids } = importOf(`${SUB}
module h(input d, output o); assign o = d; endmodule
module top(input [3:0] a, input [3:0] b, output [3:0] o);
   g u0(.d(a), .o(o));
   h u1(.d(b[0]), .o(o[0]));
endmodule`)
    expect(ids).not.toContain('o[0]')
    assertPassesThrough(block as BlockData, [1, 2, 3])
  })

  test('contention on a bus driven through TWO levels of hierarchy', () => {
    const { block, ids } = importOf(`
module inner(input [3:0] d, output [3:0] o); assign o = d; endmodule
module mid(input [3:0] d, output [3:0] o); inner i(.d(d), .o(o)); endmodule
module top(input [3:0] a, input [3:0] b, output [3:0] o);
   mid m(.d(a), .o(o));
   assign o[1] = b[1];
endmodule`)
    expect(ids).not.toContain('o[1]')
    assertPassesThrough(block as BlockData, [0, 2, 3])
  })

  test('a sub-module output contending with a parent assign fed by an always block', () => {
    // iverilog: o[3:1] = a[3:1] on all 256 vectors; o[0] has two drivers and is x wherever they differ.
    // (A parent always block cannot contend with a port DIRECTLY — an always block writes a reg and a
    // sub-module output must connect to a wire — so the parent's driver is an assign reading that reg.)
    const { block, ids, warnings } = importOf(`${SUB}
module top(input [3:0] a, input [3:0] b, output [3:0] o);
   reg  [3:0] r;
   always @(*) r = b;
   g u(.d(a), .o(o));
   assign o[0] = r[0];
endmodule`)
    expect(block, `warnings: ${warnings.join(' | ')}`).not.toBeNull()
    expect(ids).not.toContain('o[0]')
    assertPassesThrough(block as BlockData, [1, 2, 3])
  })

  test('DISJOINT bits from two sources are not contention at all', () => {
    // The control: nothing here is driven twice, so every bit must build and pass through.
    const { block, warnings } = importOf(`
module g2(input [3:0] d, output [3:0] o); assign o[1:0] = d[1:0]; endmodule
module top(input [3:0] a, output [3:0] o);
   g2 u(.d(a), .o(o));
   assign o[3:2] = a[3:2];
endmodule`)
    expect(warnings, `warnings: ${warnings.join(' | ')}`).toEqual([])
    assertPassesThrough(block as BlockData, [0, 1, 2, 3])
  })
})

/**
 * A DRIVER THE IMPORTER REFUSED IS STILL A DRIVER — ACROSS THE HIERARCHY.
 *
 * Two forms of that reach the flattener. A refused PRIMITIVE inside a child owns bits in the child's own
 * namespace, so its claim has to be renamed with everything else the copy renames, or it lands on a net the
 * parent never sees. A refused INSTANCE owns the nets its output ports connect to in the parent, even though
 * no gate of it is built; without that, the parent's own driver on those nets becomes their only one.
 *
 * The expected values are Icarus Verilog 14.0's on the same source over all 256 (a, b) vectors.
 */
describe('Verilog hierarchy — a refused driver claims its bits through the copy', () => {
  const importOf = (verilog: string) => {
    const { block, warnings } = importVerilog(verilog)
    return { block, warnings, ids: block === null ? [] : block.ports.map((p) => p.id) }
  }

  test('a refused primitive INSIDE a child claims the parent net its port renames to', () => {
    // iverilog: o[0] = x wherever a[0] and b[0] differ, o[3:1] = a[3:1] on all 256 vectors. The child's
    // `buf g0(y[0], x[0])` has a bit-select terminal we do not build; its claim on y[0] has to follow the
    // port rename onto o[0], or the parent's assign becomes o[0]'s only driver and publishes b[0].
    const { ids, warnings } = importOf(`
module sub(x, y);
   input [3:0] x;
   output [3:0] y;
   buf g0(y[0], x[0]);
   assign y[3:1] = x[3:1];
endmodule
module top(input [3:0] a, input [3:0] b, output [3:0] o);
   sub u(.x(a), .y(o));
   assign o[0] = b[0];
endmodule`)
    expect(
      warnings.some((w) => w.includes('"o[0]"') && w.includes('assigned more than once')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(ids).not.toContain('o[0]')
    expect(ids).toEqual(expect.arrayContaining(['o[1]', 'o[2]', 'o[3]']))
  })

  test('an INSTANCE we refuse to build still claims the nets its output ports drive', () => {
    // An instance ARRAY (one name covering several copies) is not built, so this instance is reported and not
    // built. iverilog builds it: o is x on every bit wherever ~a and b differ. Leaving the instance unclaimed
    // made the parent's `assign o = b` the sole driver of all four bits.
    const { ids, warnings } = importOf(`
module sub(x, y);
   input [3:0] x;
   output [3:0] y;
   assign y = ~x;
endmodule
module top(input [3:0] a, input [3:0] b, output [3:0] o);
   sub u[1:0](.x(a), .y(o));
   assign o = b;
endmodule`)
    expect(
      warnings.some((w) => w.includes('every bit') && w.includes('assigned more than once')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    for (const bit of ['o[0]', 'o[1]', 'o[2]', 'o[3]']) expect(ids).not.toContain(bit)
  })

  test('a refused instance claims only its OUTPUT ports, so an input connection still builds', () => {
    // The over-refusal control for the claim above: `t` is only READ by the refused instance, so the
    // parent's driver on it must survive whole. The claimed net `o` is an INTERNAL wire here rather than a
    // module output, which is what keeps the design publishable at all — an unbuilt OUTPUT PORT refuses the
    // whole module, and that rule has its own test below.
    const { block, ids, warnings } = importOf(`
module sub(x, y);
   input [3:0] x;
   output [3:0] y;
   assign y = ~x;
endmodule
module top(input [3:0] a, input [3:0] b, output [3:0] t);
   wire [3:0] o;
   sub u[1:0](.x(t), .y(o));
   assign t = a;
   assign o[3:2] = b[3:2];
endmodule`)
    expect(
      warnings.some((w) => w.includes('assigned more than once')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(ids, `warnings: ${warnings.join(' | ')}`).toEqual(
      expect.arrayContaining(['t[0]', 't[1]', 't[2]', 't[3]']),
    )
    // and the surviving driver is the RIGHT one, not merely present: t = a, bit for bit.
    expect(evaluate(block as BlockData, { a: { value: 0b0101, width: 4 } }, { t: 4 })).toEqual({
      t: 0b0101,
    })
  })

  test('when the claimed net IS a module output port, the whole design is refused', () => {
    // The same source with `o` promoted to an output port. Its bits are worked out from what the refused
    // instance would have driven, so publishing would put invented values on the block's own interface.
    // Refusing whole is the point of the rule; this pins that it fires and names the bits it is refusing for.
    const { block, warnings } = importVerilog(`
module sub(x, y);
   input [3:0] x;
   output [3:0] y;
   assign y = ~x;
endmodule
module top(input [3:0] a, input [3:0] b, output [3:0] o, output [3:0] t);
   sub u[1:0](.x(t), .y(o));
   assign t = a;
   assign o[3:2] = b[3:2];
endmodule`)
    expect(block).toBeNull()
    expect(
      hasWarning(warnings, 'module "top" is NOT built'),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(hasWarning(warnings, 'o[0]') && hasWarning(warnings, 'o[3]')).toBe(true)
  })
})

describe('Verilog hierarchy — a refused instance claims the net it really aligns to', () => {
  test('a POSITIONAL list against a module with a dropped port claims the ALIGNED output', () => {
    // A refused instance still wrote a driver onto whatever its output ports connect to, so those nets are
    // claimed. With a dropped port in the header the question is WHICH net that is, and the answer has to
    // come from the same position-keeping that builds such a list — otherwise the claim lands on a net the
    // instance never drove, and takes a legitimate driver off it.
    //
    // The instance array is what makes this reachable: it refuses the instance FIRST, which is the path that
    // claims. The parent drives ONLY `q`, and that is what makes this discriminate: position 3 is the child's
    // output `y`, so `q` is the contended net. Counting against the surviving ports (a, y) would put the
    // output on `z` instead, and `q` would keep b's driver with no contention reported at all.
    const { block, warnings } = importVerilog(`
module ch(input a, inout w, output y);
   assign y = ~a;
endmodule
module top(input p, input b, output q, output z);
   ch u[1:0](p, z, q);
   assign q = b;
endmodule`)
    expect(
      warnings.some((w) => w.includes('instance array')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(
      warnings.some((w) => w.includes('assign to "q"') && w.includes('assigned more than once')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    // `q` is a module output whose bits are now worked out from a refused instance, so nothing is published.
    expect(block).toBeNull()
    expect(hasWarning(warnings, 'module "top" is NOT built')).toBe(true)
  })
})
