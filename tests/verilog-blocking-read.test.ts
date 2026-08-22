/**
 * WHAT A LATER STATEMENT IN THE SAME BLOCK READS.
 *
 * A blocking `=` takes effect where it is written, so every statement after it reads the new value; a
 * nonblocking `<=` is scheduled, so every read in the same block still sees the pre-block value (IEEE
 * 1364-2005 §9.2.2). Getting that backwards is invisible in the common shape — a variable that is written
 * once and never rewritten holds the same value at both times — and gives a wrong answer the moment the
 * variable is written twice, which is exactly what a function or task local is for.
 *
 * Two separate holes lived here, both silent:
 *
 *   1. A SELECT of a blocking-assigned variable answered 0. Every store into a declared variable is walled at
 *      its declared width, so a select of one was refused as an unsupported construct — and the function
 *      inliner's guard for a body it cannot build returns zeros, with no gate above it looking for that
 *      refusal. `reg [7:0] t; t = v; f = t[7:0];` read 0x00 0x00 0x00 0x00 where Icarus reads
 *      0xb4 0x5a 0x01 0x80.
 *
 *   2. Three READ SITES never forward-substituted at all — an `if` condition (and so a `case` selector), a
 *      function call's arguments, and a nonblocking assignment's right-hand side. Each bound to the
 *      variable's NET, which carries its LAST value in the block. `t = a; if (t[7]) r = 8'h11; else
 *      r = 8'h22; t = 8'h00;` read 0x22 0x22 0x22 0x22 where Icarus reads 0x11 0x22 0x22 0x11.
 *
 * The fix is one rule: substitution is decided by the WRITE, not by the read. A value a blocking `=` put
 * there is what every later read in the block sees; one a nonblocking `<=` put there is invisible until the
 * block ends. The clocked tests at the bottom are the other half of that rule — blocking `=` is refused in a
 * clocked block, so nothing there substitutes, and an `if` condition on a nonblocking register still reads
 * the pre-clock value.
 *
 * EVERY expected number here is Icarus Verilog 14.0 (oss-cad-suite) on the same source, read through a probe
 * wider than any value these designs carry. Nothing is read off current behaviour: this suite has been green
 * over wrong answers three times.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { compileLogic, simulateLogic, stepLogic } from '../src/renderer/logic-sim.ts'
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

const said = (warnings: string[]): string => warnings.join(' | ')

function build(verilog: string): BlockData {
  const { block, warnings } = importVerilog(verilog)
  expect(block, said(warnings)).not.toBeNull()
  return block as BlockData
}

/** The block on a canvas with power and ground, plus a source per pin named in `drive`. */
function canvas(
  block: BlockData,
  drive: [string, boolean][],
): { nodes: CanvasNodeLike[]; edges: CanvasEdgeLike[] } {
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
  for (const [pin, high] of drive) {
    const id = `v${k++}`
    nodes.push(src(id, high ? 5 : 0))
    edges.push(w(`e${id}`, id, 'terminal_positive', 'M', pin))
    edges.push(w(`e${id}n`, id, 'terminal_negative', 'g', 'reference_terminal'))
  }
  return { nodes, edges }
}

/** Every `a` bit that has a pin, held at `value`. A one-bit input is the bare name `a`, not `a[0]`. */
function inputBits(block: BlockData, value: number): [string, boolean][] {
  const have = new Set(block.ports.map((p) => p.id))
  const out: [string, boolean][] = []
  for (let bit = 0; bit < 8; bit++) {
    const pin = have.has(`a[${bit}]`) ? `a[${bit}]` : bit === 0 && have.has('a') ? 'a' : ''
    if (pin !== '') out.push([pin, ((value >> bit) & 1) === 1])
  }
  return out
}

/** Read `y` at 32 bits — wider than any value below, so a grown answer cannot be truncated back into the
 *  right one by the probe, and a missing pin shows up as a wrong number. */
function readY(
  block: BlockData,
  result: { value: (node: string, pin: string) => boolean | undefined },
): number {
  if (block.ports.some((p) => p.id === 'y')) return result.value('M', 'y') === true ? 1 : 0
  let out = 0
  for (let bit = 0; bit < 32; bit++) if (result.value('M', `y[${bit}]`) === true) out += 2 ** bit
  return out
}

/** The four input vectors every combinational expectation below was measured at. */
const VECTORS = [0xb4, 0x5a, 0x01, 0x80]

/** Build `verilog`, check all eight `y` pins are published, and read `y` at each vector. */
function sweep(verilog: string): number[] {
  const block = build(verilog)
  const pins = new Set(block.ports.map((p) => p.id))
  for (let bit = 0; bit < 8; bit++)
    expect(pins.has(`y[${bit}]`), `y[${bit}] is published`).toBe(true)
  return VECTORS.map((value) => {
    const { nodes, edges } = canvas(block, inputBits(block, value))
    return readY(block, simulateLogic(nodes, edges, new Map()))
  })
}

/** Import `verilog` expecting NO published design, and return what it said. */
function refusal(verilog: string): string {
  const { block, warnings } = importVerilog(verilog)
  expect(block, `expected a refusal, got a design — ${said(warnings)}`).toBeNull()
  return said(warnings)
}

const mod = (body: string): string =>
  `module top(input [7:0] a, output [7:0] y);\n${body}\nendmodule\n`

/** A function whose body is `body`, called as `f(a)`. */
const fn = (body: string): string =>
  mod(`  function [7:0] f;
    input [7:0] v;
    reg [7:0] t;
    begin
${body}
    end
  endfunction
  assign y = f(a);`)

/** A task whose body is `body`, called once from a combinational always block. */
const task = (body: string): string =>
  mod(`  reg [7:0] r;
  task tk;
    input [7:0] v;
    output [7:0] o;
    reg [7:0] t;
    begin
${body}
    end
  endtask
  always @(a) tk(a, r);
  assign y = r;`)

describe('a BARE COPY into a local, then a select of it', () => {
  test('the whole width: t = v; f = t[7:0] (Icarus: 180 90 1 128)', () => {
    expect(sweep(fn('      t = v;\n      f = t[7:0];'))).toEqual([0xb4, 0x5a, 0x01, 0x80])
  })

  test('the top half: f = {4’b0, t[7:4]} (Icarus: 11 5 0 8)', () => {
    expect(sweep(fn("      t = v;\n      f = {4'b0, t[7:4]};"))).toEqual([0x0b, 0x05, 0x00, 0x08])
  })

  test('one bit: f = {7’b0, t[3]} (Icarus: 0 1 0 0)', () => {
    expect(sweep(fn("      t = v;\n      f = {7'b0, t[3]};"))).toEqual([0, 1, 0, 0])
  })

  test('an indexed part-select with a constant base: t[4 +: 4] (Icarus: 11 5 0 8)', () => {
    expect(sweep(fn("      t = v;\n      f = {4'b0, t[4 +: 4]};"))).toEqual([0x0b, 0x05, 0, 0x08])
  })

  test('an indexed part-select with a RUN-TIME base: t[k*2 +: 2] (Icarus: 0 1 0 0)', () => {
    expect(
      sweep(
        mod(`  function [7:0] f;
    input [7:0] v;
    input [1:0] k;
    reg [7:0] t;
    begin
      t = v;
      f = {6'b0, t[k*2 +: 2]};
    end
  endfunction
  assign y = f(a, a[1:0]);`),
      ),
    ).toEqual([0, 1, 0, 0])
  })

  test('TWO selects of the same local: f = {t[3:0], t[7:4]} (Icarus: 75 165 16 8)', () => {
    expect(sweep(fn('      t = v;\n      f = {t[3:0], t[7:4]};'))).toEqual([0x4b, 0xa5, 0x10, 0x08])
  })

  test('a local WIDER than the source truncates nothing (Icarus: 180 90 1 128)', () => {
    expect(
      sweep(
        mod(`  function [7:0] f;
    input [7:0] v;
    reg [15:0] t;
    begin
      t = v;
      f = t[7:0];
    end
  endfunction
  assign y = f(a);`),
      ),
    ).toEqual([0xb4, 0x5a, 0x01, 0x80])
  })

  test('a local NARROWER than the source keeps only what fits (Icarus: 4 10 1 0)', () => {
    expect(
      sweep(
        mod(`  function [7:0] f;
    input [7:0] v;
    reg [3:0] t;
    begin
      t = v;
      f = {4'b0, t[3:0]};
    end
  endfunction
  assign y = f(a);`),
      ),
    ).toEqual([0x04, 0x0a, 0x01, 0x00])
  })

  test('a copy from a MODULE NET, not an argument (Icarus: 180 90 1 128)', () => {
    expect(
      sweep(
        mod(`  wire [7:0] n;
  assign n = a;
  function [7:0] f;
    input [7:0] v;
    reg [7:0] t;
    begin
      t = n;
      f = t[7:0] ^ (v & 8'h00);
    end
  endfunction
  assign y = f(a);`),
      ),
    ).toEqual([0xb4, 0x5a, 0x01, 0x80])
  })

  test('a copy from ANOTHER LOCAL (Icarus: 180 90 1 128)', () => {
    expect(
      sweep(
        mod(`  function [7:0] f;
    input [7:0] v;
    reg [7:0] t1;
    reg [7:0] t2;
    begin
      t1 = v;
      t2 = t1;
      f = t2[7:0];
    end
  endfunction
  assign y = f(a);`),
      ),
    ).toEqual([0xb4, 0x5a, 0x01, 0x80])
  })

  test('an `integer` local is 32 bits and its low byte is still the copy (Icarus: 180 90 1 128)', () => {
    expect(
      sweep(
        mod(`  function [7:0] f;
    input [7:0] v;
    integer t;
    begin
      t = v;
      f = t[7:0];
    end
  endfunction
  assign y = f(a);`),
      ),
    ).toEqual([0xb4, 0x5a, 0x01, 0x80])
  })

  test('an EXPRESSION-assigned local reads the same way — the contrast (Icarus: 180 90 1 128)', () => {
    expect(sweep(fn("      t = v ^ 8'h00;\n      f = t[7:0];"))).toEqual([0xb4, 0x5a, 0x01, 0x80])
  })

  test('a part-WRITE over the copy, then a read: t[0] = 1 (Icarus: 181 91 1 129)', () => {
    expect(sweep(fn("      t = v;\n      t[0] = 1'b1;\n      f = t[7:0];"))).toEqual([
      0xb5, 0x5b, 0x01, 0x81,
    ])
  })

  test('a select of a local assigned a CONSTANT (Icarus: 195 195 195 195)', () => {
    expect(sweep(fn("      t = 8'hc3;\n      f = t[7:0] ^ (v & 8'h00);"))).toEqual([
      0xc3, 0xc3, 0xc3, 0xc3,
    ])
  })

  test('a select whose base cannot be bounded is REFUSED, not answered 0 (Icarus reads x)', () => {
    // Icarus on this design prints x for three of the four vectors, and a two-valued netlist has no x.
    expect(
      refusal(
        mod(`  function [7:0] f;
    input [7:0] v;
    input [31:0] k;
    reg [7:0] t;
    begin
      t = v;
      f = {4'b0, t[k +: 4]};
    end
  endfunction
  assign y = f(a, {24'b0, a});`),
      ),
    ).toContain('out of range')
  })
})

describe('the same copy inside a TASK, and at module scope', () => {
  test('task: t = v; o = t[7:0] (Icarus: 180 90 1 128)', () => {
    expect(sweep(task('      t = v;\n      o = t[7:0];'))).toEqual([0xb4, 0x5a, 0x01, 0x80])
  })

  test('task: a part-select of the copy (Icarus: 11 5 0 8)', () => {
    expect(sweep(task("      t = v;\n      o = {4'b0, t[7:4]};"))).toEqual([0x0b, 0x05, 0x00, 0x08])
  })

  test('task: the local is REUSED after the read, which must not reach back (Icarus: 180 90 1 128)', () => {
    expect(
      sweep(
        mod(`  reg [7:0] r;
  task tk;
    input [7:0] v;
    output [7:0] o;
    reg [7:0] t;
    reg [7:0] u;
    begin
      t = v;
      u = t;
      t = 8'h00;
      o = u;
    end
  endtask
  always @(a) tk(a, r);
  assign y = r;`),
      ),
    ).toEqual([0xb4, 0x5a, 0x01, 0x80])
  })

  test('task: a SELECT read before the local is reused (Icarus: 11 5 0 8)', () => {
    expect(
      sweep(
        mod(`  reg [7:0] r;
  task tk;
    input [7:0] v;
    output [7:0] o;
    reg [7:0] t;
    reg [7:0] u;
    begin
      t = v;
      u = {4'b0, t[7:4]};
      t = 8'h00;
      o = u;
    end
  endtask
  always @(a) tk(a, r);
  assign y = r;`),
      ),
    ).toEqual([0x0b, 0x05, 0x00, 0x08])
  })

  test('module scope: t = a in an always block, then a select of it (Icarus: 11 5 0 8)', () => {
    expect(
      sweep(
        mod(`  reg [7:0] t;
  reg [7:0] r;
  always @(a) begin
    t = a;
    r = {4'b0, t[7:4]};
  end
  assign y = r;`),
      ),
    ).toEqual([0x0b, 0x05, 0x00, 0x08])
  })

  test('module scope: three statements deep, the middle local reused after (Icarus: 79 175 31 15)', () => {
    expect(
      sweep(
        mod(`  reg [7:0] t;
  reg [7:0] u;
  reg [7:0] r;
  always @(a) begin
    t = a;
    u = {t[3:0], 4'b0};
    t = 8'h0f;
    r = {u[7:4], t[3:0]};
  end
  assign y = r;`),
      ),
    ).toEqual([0x4f, 0xaf, 0x1f, 0x0f])
  })
})

describe('an IF CONDITION reads the in-flight value, not the last one', () => {
  test('a bit-select condition, the local reused after (Icarus: 17 34 34 17)', () => {
    expect(
      sweep(
        mod(`  reg [7:0] t;
  reg [7:0] r;
  always @(a) begin
    t = a;
    if (t[7]) r = 8'h11; else r = 8'h22;
    t = 8'h00;
  end
  assign y = r;`),
      ),
    ).toEqual([0x11, 0x22, 0x22, 0x11])
  })

  test('a WHOLE-signal comparison in the condition (Icarus: 17 34 34 34)', () => {
    expect(
      sweep(
        mod(`  reg [7:0] t;
  reg [7:0] r;
  always @(a) begin
    t = a;
    if (t == 8'hb4) r = 8'h11; else r = 8'h22;
    t = 8'h00;
  end
  assign y = r;`),
      ),
    ).toEqual([0x11, 0x22, 0x22, 0x22])
  })

  test('CONTROL — the same condition with no reuse still reads right (Icarus: 17 34 34 17)', () => {
    expect(
      sweep(
        mod(`  reg [7:0] t;
  reg [7:0] r;
  always @(a) begin
    t = a;
    if (t[7]) r = 8'h11; else r = 8'h22;
  end
  assign y = r;`),
      ),
    ).toEqual([0x11, 0x22, 0x22, 0x11])
  })

  test('a CASE selector is the same condition (Icarus: 16 18 17 16)', () => {
    expect(
      sweep(
        mod(`  reg [1:0] t;
  reg [7:0] r;
  always @(a) begin
    t = a[1:0];
    case (t)
      2'b00: r = 8'h10;
      2'b01: r = 8'h11;
      2'b10: r = 8'h12;
      default: r = 8'h13;
    endcase
    t = 2'b11;
  end
  assign y = r;`),
      ),
    ).toEqual([0x10, 0x12, 0x11, 0x10])
  })

  test('the condition reads a SECOND local built from the first (Icarus: 17 17 34 34)', () => {
    expect(
      sweep(
        mod(`  reg [7:0] t;
  reg [7:0] u;
  reg [7:0] r;
  always @(a) begin
    t = a;
    u = {t[3:0], t[7:4]};
    t = 8'hff;
    if (u[0]) r = 8'h11; else r = 8'h22;
  end
  assign y = r;`),
      ),
    ).toEqual([0x11, 0x11, 0x22, 0x22])
  })

  test('a NESTED if whose inner condition reads a local rewritten inside the outer branch (Icarus: 50 51 51 50)', () => {
    expect(
      sweep(
        mod(`  reg [7:0] t;
  reg [7:0] r;
  always @(a) begin
    t = a;
    if (t[7]) begin
      t = 8'h00;
      if (t[6]) r = 8'h31; else r = 8'h32;
    end else r = 8'h33;
  end
  assign y = r;`),
      ),
    ).toEqual([0x32, 0x33, 0x33, 0x32])
  })

  test('inside a FUNCTION (Icarus: 17 34 34 17)', () => {
    expect(
      sweep(fn("      t = v;\n      if (t[7]) f = 8'h11; else f = 8'h22;\n      t = 8'h00;")),
    ).toEqual([0x11, 0x22, 0x22, 0x11])
  })

  test('inside a TASK (Icarus: 17 34 34 17)', () => {
    expect(
      sweep(task("      t = v;\n      if (t[7]) o = 8'h11; else o = 8'h22;\n      t = 8'h00;")),
    ).toEqual([0x11, 0x22, 0x22, 0x11])
  })

  test('a local assigned inside ONE branch, then selected after the if (Icarus: 3 3 0 3)', () => {
    expect(sweep(fn("      if (v[0]) t = v; else t = 8'h33;\n      f = {4'b0, t[7:4]};"))).toEqual([
      0x03, 0x03, 0x00, 0x03,
    ])
  })
})

describe('a CALL ARGUMENT reads the in-flight value', () => {
  const helper = `  function [7:0] g;
    input [7:0] v;
    g = v ^ 8'h0f;
  endfunction
`

  test('in an always block, the local reused after the call (Icarus: 187 85 14 143)', () => {
    expect(
      sweep(
        mod(`${helper}  reg [7:0] t;
  reg [7:0] r;
  always @(a) begin
    t = a;
    r = g(t[7:0]);
    t = 8'h00;
  end
  assign y = r;`),
      ),
    ).toEqual([0xbb, 0x55, 0x0e, 0x8f])
  })

  test('CONTROL — the same call with no reuse (Icarus: 187 85 14 143)', () => {
    expect(
      sweep(
        mod(`${helper}  reg [7:0] t;
  reg [7:0] r;
  always @(a) begin
    t = a;
    r = g(t[7:0]);
  end
  assign y = r;`),
      ),
    ).toEqual([0xbb, 0x55, 0x0e, 0x8f])
  })

  test('a call inside a FUNCTION body, the local reused after (Icarus: 187 85 14 143)', () => {
    expect(
      sweep(
        mod(`${helper}  function [7:0] f;
    input [7:0] v;
    reg [7:0] t;
    begin
      t = v;
      f = g(t);
      t = 8'h00;
    end
  endfunction
  assign y = f(a);`),
      ),
    ).toEqual([0xbb, 0x55, 0x0e, 0x8f])
  })
})

describe('the other read sites', () => {
  test('a NONBLOCKING right-hand side reads the in-flight blocking value (Icarus: 11 5 0 8)', () => {
    expect(
      sweep(
        mod(`  reg [7:0] t;
  reg [7:0] r;
  always @(a) begin
    t = a;
    r <= {4'b0, t[7:4]};
    t = 8'h00;
  end
  assign y = r;`),
      ),
    ).toEqual([0x0b, 0x05, 0x00, 0x08])
  })

  test('a ternary on the copy (Icarus: 4 10 0 0)', () => {
    expect(sweep(fn("      t = v;\n      f = t[0] ? {4'b0, t[7:4]} : {4'b0, t[3:0]};"))).toEqual([
      0x04, 0x0a, 0x00, 0x00,
    ])
  })

  test('a replication of a select of the copy (Icarus: 5 10 1 0)', () => {
    expect(
      sweep(
        mod(`  function [7:0] f;
    input [7:0] v;
    reg [3:0] t;
    begin
      t = v[3:0];
      f = {2{t[3:2]}} | {4'b0, t[3:0]};
    end
  endfunction
  assign y = f(a);`),
      ),
    ).toEqual([0x05, 0x0a, 0x01, 0x00])
  })

  test('an indexed part-select whose BASE is a select of the copy (Icarus: 0 2 0 0)', () => {
    expect(
      sweep(
        mod(`  reg [7:0] t;
  reg [7:0] r;
  always @(a) begin
    t = a;
    r = {6'b0, a[t[0]*2 +: 2]};
    t = 8'h00;
  end
  assign y = r;`),
      ),
    ).toEqual([0x00, 0x02, 0x00, 0x00])
  })

  test('a part-WRITE whose right-hand side is the copy, read back after (Icarus: 185 89 9 137)', () => {
    expect(sweep(fn("      t = v;\n      t[3:0] = 4'h9;\n      f = t[7:0];"))).toEqual([
      0xb9, 0x59, 0x09, 0x89,
    ])
  })

  test('a task local read, reused, and read again in one call (Icarus: 203 197 192 200)', () => {
    expect(
      sweep(
        task(
          "      t = v;\n      o = {4'b0, t[7:4]};\n      t = 8'hff;\n      o = o | {t[1:0], 6'b0};",
        ),
      ),
    ).toEqual([0xcb, 0xc5, 0xc0, 0xc8])
  })

  test('two locals crossing over each other (Icarus: 180 90 1 128)', () => {
    expect(
      sweep(
        mod(`  function [7:0] f;
    input [7:0] v;
    reg [7:0] t;
    reg [7:0] u;
    begin
      t = v;
      u = {t[3:0], t[7:4]};
      t = 8'h00;
      f = {u[3:0], u[7:4]};
    end
  endfunction
  assign y = f(a);`),
      ),
    ).toEqual([0xb4, 0x5a, 0x01, 0x80])
  })
})

/**
 * A CLOCKED block is the other half of the rule. Blocking `=` is refused there, so nothing in a clocked block
 * is ever substitutable — an `if` condition on a nonblocking register still reads the value the register held
 * BEFORE the edge. The probe applies the inputs on the low half-step and then raises the clock, which is the
 * same edge Icarus's testbench sees, so the sequences line up exactly.
 */
describe('a CLOCKED block substitutes nothing', () => {
  const clockThrough = (verilog: string): number[] => {
    const block = build(verilog)
    const pins = ['clk', ...inputBits(block, 0).map(([pin]) => pin)]
    const { nodes, edges } = canvas(
      block,
      pins.map((pin) => [pin, false] as [string, boolean]),
    )
    // canvas() names its sources v0, v1, … in the order the pins were given, so this is the same order.
    const compiled = compileLogic(nodes, edges)
    const levels = (clk: boolean, value: number): Map<string, boolean> => {
      const map = new Map<string, boolean>()
      pins.forEach((pin, k) => {
        const bit = pin.startsWith('a[') ? Number(pin.slice(2, -1)) : 0
        map.set(`v${k}`, pin === 'clk' ? clk : ((value >> bit) & 1) === 1)
      })
      return map
    }
    const state = new Map<string, boolean>()
    stepLogic(compiled, levels(false, 0), state)
    return VECTORS.map((value) => {
      stepLogic(compiled, levels(false, value), state)
      return readY(block, stepLogic(compiled, levels(true, value), state))
    })
  }

  test('an if condition on a nonblocking register reads the PRE-clock value (Icarus: 34 17 34 34)', () => {
    expect(
      clockThrough(
        `module top(input clk, input [7:0] a, output [7:0] y);
  reg [7:0] q;
  reg [7:0] r;
  always @(posedge clk) begin
    q <= a;
    if (q[7]) r <= 8'h11; else r <= 8'h22;
  end
  assign y = r;
endmodule
`,
      ),
    ).toEqual([0x22, 0x11, 0x22, 0x22])
  })

  test('a two-stage shift register still shifts once per edge (Icarus: 0 180 90 1)', () => {
    expect(
      clockThrough(
        `module top(input clk, input [7:0] a, output [7:0] y);
  reg [7:0] q;
  reg [7:0] r;
  always @(posedge clk) begin
    q <= a;
    r <= q;
  end
  assign y = r;
endmodule
`,
      ),
    ).toEqual([0x00, 0xb4, 0x5a, 0x01])
  })

  test('a blocking `=` in a clocked block is refused, which is what keeps the rule simple', () => {
    expect(
      refusal(
        `module top(input clk, input [7:0] a, output [7:0] y);
  reg [7:0] q;
  reg [7:0] r;
  always @(posedge clk) begin
    q <= a;
    r = q;
  end
  assign y = r;
endmodule
`,
      ),
    ).toContain("blocking assignment '=' in a clocked block")
  })
})
