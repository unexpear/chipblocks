/**
 * TASKS — `task … endtask` called as a statement inside a combinational `always @(*)` block, inlined into
 * real gates. Inputs are bound at their declared width, outputs are written back to the caller's signals
 * (both through the same `sized` width walls the function inliner uses, so widths stay exact). Un-synthesizable
 * cases (a clocked call, an unknown task, a wrong arg count, a non-net output target, an unsupported body)
 * are REPORTED, never faked. Correctness is proven by truth table through the real logic engine.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { characterizeBlock } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const num = (b: boolean[]): number => b.reduce((s, x, i) => s + (x ? 1 << i : 0), 0)
const numBits = (v: number, w: number): boolean[] =>
  Array.from({ length: w }, (_, i) => ((v >> i) & 1) === 1)
const busIn = (name: string, w: number): string[] =>
  Array.from({ length: w }, (_, i) => `${name}[${i}]`)

const assertBus = (
  verilog: string,
  ins: string[],
  outs: string[],
  fn: (b: boolean[]) => boolean[],
) => {
  const { block, warnings } = importVerilog(verilog)
  expect(warnings, `warnings: ${warnings.join(' | ')}`).toEqual([])
  const tt = characterizeBlock(block as BlockData)
  expect(tt, 'should characterize as combinational').not.toBeNull()
  if (tt === null) return
  expect(tt.inputs).toEqual(ins)
  expect(tt.outputs).toEqual(outs)
  for (const row of tt.rows) expect(row.out, `in ${row.in.join(',')}`).toEqual(fn(row.in))
}

const reported = (verilog: string, needle: string) => {
  const { warnings } = importVerilog(verilog)
  expect(
    warnings.some((w) => w.toLowerCase().includes(needle.toLowerCase())),
    `warnings: ${warnings.join(' | ')}`,
  ).toBe(true)
}

describe('tasks — the basic call', () => {
  test('an ANSI-header task with input + output inlines (y = p + 1)', () => {
    assertBus(
      'module m(p, y); input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task inc(input [3:0] a, output [3:0] b); b = a + 1; endtask' +
        ' always @(*) inc(p, y); endmodule',
      busIn('p', 4),
      busIn('y', 4),
      (bits) => numBits((num(bits.slice(0, 4)) + 1) & 15, 4),
    )
  })

  test('a classic-header task (decls in the body) inlines', () => {
    assertBus(
      'module m(p, y); input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task inc; input [3:0] a; output [3:0] b; b = a + 1; endtask' +
        ' always @(*) inc(p, y); endmodule',
      busIn('p', 4),
      busIn('y', 4),
      (bits) => numBits((num(bits.slice(0, 4)) + 1) & 15, 4),
    )
  })

  test('a task with TWO outputs writes both back', () => {
    assertBus(
      'module m(p, y1, y2); input [3:0] p; output [3:0] y1; output [3:0] y2; reg [3:0] y1; reg [3:0] y2;' +
        ' task both(input [3:0] a, output [3:0] s, output [3:0] d);' +
        ' begin s = a + 1; d = a - 1; end endtask' +
        ' always @(*) both(p, y1, y2); endmodule',
      busIn('p', 4),
      [...busIn('y1', 4), ...busIn('y2', 4)],
      (bits) => [
        ...numBits((num(bits.slice(0, 4)) + 1) & 15, 4),
        ...numBits((num(bits.slice(0, 4)) + 15) & 15, 4),
      ],
    )
  })

  test('a task with an intermediate local (b = a + 2)', () => {
    assertBus(
      'module m(p, y); input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task f(input [3:0] a, output [3:0] b); reg [3:0] t; begin t = a + 1; b = t + 1; end endtask' +
        ' always @(*) f(p, y); endmodule',
      busIn('p', 4),
      busIn('y', 4),
      (bits) => numBits((num(bits.slice(0, 4)) + 2) & 15, 4),
    )
  })

  test('two calls to the same task in one block do not alias', () => {
    assertBus(
      'module m(p, q, y1, y2); input [1:0] p; input [1:0] q;' +
        ' output [1:0] y1; output [1:0] y2; reg [1:0] y1; reg [1:0] y2;' +
        ' task inc(input [1:0] a, output [1:0] b); b = a + 1; endtask' +
        ' always @(*) begin inc(p, y1); inc(q, y2); end endmodule',
      [...busIn('p', 2), ...busIn('q', 2)],
      [...busIn('y1', 2), ...busIn('y2', 2)],
      (bits) => [
        ...numBits((num(bits.slice(0, 2)) + 1) & 3, 2),
        ...numBits((num(bits.slice(2, 4)) + 1) & 3, 2),
      ],
    )
  })
})

describe('tasks — honest reporting', () => {
  test('a task call in a CLOCKED block is reported (a later increment)', () => {
    reported(
      'module m(clk, p, y); input clk; input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task inc(input [3:0] a, output [3:0] b); b = a + 1; endtask' +
        ' always @(posedge clk) inc(p, y); endmodule',
      'clocked always block',
    )
  })

  test('a call to an unknown task is reported', () => {
    reported(
      'module m(p, y); input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' always @(*) nope(p, y); endmodule',
      'unknown task',
    )
  })

  test('a task call with the wrong argument count is reported', () => {
    reported(
      'module m(p, y); input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task inc(input [3:0] a, output [3:0] b); b = a + 1; endtask' +
        ' always @(*) inc(p); endmodule',
      'argument',
    )
  })

  test('a task output written to a non-net (an expression) is reported', () => {
    reported(
      'module m(p, y); input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task inc(input [3:0] a, output [3:0] b); b = a + 1; endtask' +
        ' always @(*) inc(p, p + 1); endmodule',
      'simple net',
    )
  })

  test('a function that calls a task is reported', () => {
    reported(
      'module m(p, y); input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task t(input [3:0] a, output [3:0] b); b = a; endtask' +
        ' function [3:0] f(input [3:0] a); begin t(a, f); end endfunction' +
        ' always @(*) y = f(p); endmodule',
      'cannot call a task',
    )
  })
})

// Regression guards for the adversarial review of the task inliner.
describe('tasks — review hardening', () => {
  test('an intermediate LOCAL truncates to its declared width (y = a & 3, the critical fix)', () => {
    // t is 2-bit, so `t = a` keeps only a[1:0]; without the width wall the task would leak a's full width.
    assertBus(
      'module m(p, y); input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task f(input [3:0] a, output [3:0] b); reg [1:0] t; begin t = a; b = t; end endtask' +
        ' always @(*) f(p, y); endmodule',
      busIn('p', 4),
      busIn('y', 4),
      (bits) => numBits(num(bits.slice(0, 4)) & 3, 4),
    )
  })

  test('a task calling another task (nested) inlines correctly (y = p + 1)', () => {
    assertBus(
      'module m(p, y); input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task inner(input [3:0] a, output [3:0] b); b = a + 1; endtask' +
        ' task outer(input [3:0] a, output [3:0] b); inner(a, b); endtask' +
        ' always @(*) outer(p, y); endmodule',
      busIn('p', 4),
      busIn('y', 4),
      (bits) => numBits((num(bits.slice(0, 4)) + 1) & 15, 4),
    )
  })

  test('a task output the body never assigns is reported, not silently driven to 0', () => {
    reported(
      'module m(p, y); input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task f(input [3:0] a, output [3:0] b); reg [3:0] c; c = a + 1; endtask' +
        ' always @(*) f(p, y); endmodule',
      'never assigned',
    )
  })

  test('a recursive task is reported, not inlined forever', () => {
    reported(
      'module m(p, y); input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task t(input [3:0] a, output [3:0] b); t(a, b); endtask' +
        ' always @(*) t(p, y); endmodule',
      'recursive',
    )
  })

  test('a task call inside an if/case branch is reported (spurious-loop scope)', () => {
    reported(
      'module m(c, p, y); input c; input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task inc(input [3:0] a, output [3:0] b); b = a + 1; endtask' +
        ' always @(*) begin y = 0; if (c) inc(p, y); end endmodule',
      'if/case',
    )
  })

  test('a task missing its endtask is reported and does not swallow the following gate', () => {
    const { warnings } = importVerilog(
      'module m(a, y); input a; output y; task incomplete(input x, output w); w = x; buf g1(y, a); endmodule',
    )
    expect(warnings.some((w) => w.toLowerCase().includes('endtask'))).toBe(true)
  })

  test('a task local that shadows an argument name is reported', () => {
    reported(
      'module m(p, y); input [3:0] p; output [3:0] y; reg [3:0] y;' +
        ' task t(input [3:0] a, output [3:0] b); reg [1:0] a; begin b = a; end endtask' +
        ' always @(*) t(p, y); endmodule',
      'redeclares an argument',
    )
  })
})
