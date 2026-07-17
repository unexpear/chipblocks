/**
 * PARAMETERS — `parameter` / `localparam` as compile-time constants. They must fold to an exact value AND an
 * exact bit width BEFORE any gates exist: a parameterized bus `[W-1:0]` sizes the datapath, a parameter used
 * as a value drops in a constant, and a parameter in a select / replication count sizes the slice. A wrong
 * fold is a silent miscompile, so every case below proves the built gates compute the right values by truth
 * table (through the real logic engine), and the honest-report cases prove an un-elaboratable parameter is
 * reported, never faked.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { characterizeBlock } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const num = (b: boolean[]): number => b.reduce((s, x, i) => s + (x ? 1 << i : 0), 0)
const numBits = (v: number, w: number): boolean[] =>
  Array.from({ length: w }, (_, i) => ((v >> i) & 1) === 1)

/** Import a bus module and assert its outputs = fn(inputs), driven through the real logic engine. */
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

const busIn = (name: string, w: number): string[] =>
  Array.from({ length: w }, (_, i) => `${name}[${i}]`)

/** Like assertBus, but tolerates the importer's expected "unconnected port omitted" warnings — a partial
 *  select (`a[W-1:0]` out of a wider bus) legitimately leaves the unselected bits unused. Any OTHER warning
 *  still fails. `ins` lists the bits that should remain connected. */
const assertBusPartial = (
  verilog: string,
  ins: string[],
  outs: string[],
  fn: (b: boolean[]) => boolean[],
) => {
  const { block, warnings } = importVerilog(verilog)
  const unexpected = warnings.filter((w) => !/is not connected to any gate/.test(w))
  expect(unexpected, `unexpected warnings: ${unexpected.join(' | ')}`).toEqual([])
  const tt = characterizeBlock(block as BlockData)
  expect(tt).not.toBeNull()
  if (tt === null) return
  expect(tt.inputs).toEqual(ins)
  expect(tt.outputs).toEqual(outs)
  for (const row of tt.rows) expect(row.out, `in ${row.in.join(',')}`).toEqual(fn(row.in))
}

describe('parameters — bus widths', () => {
  test('a #(parameter W) header sizes the ports and keeps the interface', () => {
    // Without #(...) consumption the whole port list would silently vanish; this proves it survives + sizes.
    assertBus(
      'module m #(parameter W = 4) (input [W-1:0] a, input [W-1:0] b, output [W-1:0] y); assign y = a & b; endmodule',
      [...busIn('a', 4), ...busIn('b', 4)],
      busIn('y', 4),
      (bits) => {
        const a = num(bits.slice(0, 4))
        const b = num(bits.slice(4, 8))
        return numBits(a & b, 4)
      },
    )
  })

  test('a body parameter sizes a bus (declared after the ports, forward-referenced)', () => {
    assertBus(
      'module m(a, y); parameter W = 3; input [W-1:0] a; output [W-1:0] y; assign y = a; endmodule',
      busIn('a', 3),
      busIn('y', 3),
      (bits) => numBits(num(bits.slice(0, 3)), 3),
    )
  })

  test('a parameter that appears in the range BEFORE its own declaration still folds (whole-module pre-pass)', () => {
    assertBus(
      'module m(a, y); input [W-1:0] a; output [W-1:0] y; parameter W = 4; assign y = a; endmodule',
      busIn('a', 4),
      busIn('y', 4),
      (bits) => numBits(num(bits.slice(0, 4)), 4),
    )
  })

  test('a parameter arithmetic range [W/2-1:0] folds', () => {
    assertBus(
      'module m(a, y); parameter W = 8; input [W/2-1:0] a; output [W/2-1:0] y; assign y = a; endmodule',
      busIn('a', 4),
      busIn('y', 4),
      (bits) => numBits(num(bits.slice(0, 4)), 4),
    )
  })
})

describe('parameters — as constant values', () => {
  test('a parameter used as an addend drops in a constant', () => {
    assertBus(
      'module m #(parameter K = 3) (input [3:0] a, output [3:0] y); assign y = a + K; endmodule',
      busIn('a', 4),
      busIn('y', 4),
      (bits) => numBits((num(bits.slice(0, 4)) + 3) & 15, 4),
    )
  })

  test("localparam with a based/sized-literal value (4'hA) folds", () => {
    assertBus(
      "module m(a, y); input [3:0] a; output [3:0] y; localparam K = 4'hA; assign y = a + K; endmodule",
      busIn('a', 4),
      busIn('y', 4),
      (bits) => numBits((num(bits.slice(0, 4)) + 0xa) & 15, 4),
    )
  })

  test('localparam derived from a header parameter (K = W*2)', () => {
    assertBus(
      'module m #(parameter W = 2) (input [3:0] a, output [3:0] y); localparam K = W * 2; assign y = a + K; endmodule',
      busIn('a', 4),
      busIn('y', 4),
      (bits) => numBits((num(bits.slice(0, 4)) + 4) & 15, 4),
    )
  })

  test('two parameters in one declaration', () => {
    assertBus(
      'module m(a, y); input [3:0] a; output [3:0] y; parameter A = 1, B = 2; assign y = a + A + B; endmodule',
      busIn('a', 4),
      busIn('y', 4),
      (bits) => numBits((num(bits.slice(0, 4)) + 3) & 15, 4),
    )
  })
})

describe('parameters — in selects and replication', () => {
  test('a parameter part-select bound a[W-1:0] takes exactly the low W bits', () => {
    // W folds to 4 → the select is a[3:0]; the high 4 bits of the 8-bit input go unused (expected omission).
    // If the fold were the old silent bug (a[1:0]), the connected inputs + truth table below would not match.
    assertBusPartial(
      'module m(a, y); input [7:0] a; output [3:0] y; parameter W = 4; assign y = a[W-1:0]; endmodule',
      busIn('a', 4),
      busIn('y', 4),
      (bits) => numBits(num(bits.slice(0, 4)) & 15, 4),
    )
  })

  test('a parameter bit-select index a[I] picks exactly bit I', () => {
    assertBusPartial(
      'module m(a, y); input [7:0] a; output y; parameter I = 5; assign y = a[I]; endmodule',
      ['a[5]'],
      ['y'],
      (bits) => [bits[0] as boolean],
    )
  })

  test('a parameter replication count {N{a}}', () => {
    assertBus(
      'module m(a, y); input a; output [3:0] y; parameter N = 4; assign y = {N{a}}; endmodule',
      ['a'],
      busIn('y', 4),
      (bits) => numBits(bits[0] ? 15 : 0, 4),
    )
  })
})

describe('parameters — in an always block', () => {
  test('a parameter sizes a reg AND folds inside a combinational always body', () => {
    // Proves the substitution reaches the always-block token span (W sizes the reg; ONE folds in `a + ONE`).
    assertBus(
      'module m(a, y); parameter W = 4; localparam ONE = 1; input [W-1:0] a; output [W-1:0] y; reg [W-1:0] y; always @(*) y = a + ONE; endmodule',
      busIn('a', 4),
      busIn('y', 4),
      (bits) => numBits((num(bits.slice(0, 4)) + 1) & 15, 4),
    )
  })
})

describe('parameters — honest reporting', () => {
  test('a parameter with no default value is reported, not defaulted', () => {
    reported(
      'module m #(parameter W) (input [W-1:0] a, output [W-1:0] y); assign y = a; endmodule',
      'no default',
    )
  })

  test('a parameter whose default is not constant (references a net) is reported', () => {
    reported(
      'module m(a, y); input [3:0] a; output [3:0] y; parameter K = a; assign y = a; endmodule',
      'not a constant',
    )
  })
})

// Regression guards for the adversarial review of the parameter elaborator.
describe('parameters — review hardening', () => {
  test('a `parameter integer W` (integer lexes as an id, not a keyword) still folds', () => {
    // Before the fix, `integer` was read as the parameter NAME and W was dropped → `a & W` read an undriven
    // net (silent wrong value). Now `integer` is skipped by value so W = 1 folds and a & 1 = a.
    assertBus(
      'module m(a, y); input a; output y; parameter integer W = 1; assign y = a & W; endmodule',
      ['a'],
      ['y'],
      (bits) => [bits[0] as boolean],
    )
  })

  test('a range/type prefix is sticky across a comma list: `parameter [7:0] A=5, B=2` makes B 8-bit too', () => {
    // If the range weren't sticky, B would fold to 32'd2 and {x,B} would put x at bit 32 (truncated → y[8]=0).
    // With B correctly 8-bit, x lands at bit 8. (A is unused — a parameter, not a net, so no omission warning.)
    assertBus(
      'module m(x, y); input x; output [8:0] y; parameter [7:0] A = 5, B = 2; assign y = {x, B}; endmodule',
      ['x'],
      Array.from({ length: 9 }, (_, i) => `y[${i}]`),
      (bits) => [false, true, false, false, false, false, false, false, bits[0] as boolean],
    )
  })

  test("a signed based literal (n'sd…) is reported (treated as unsigned, never silently)", () => {
    reported("module m(a, y); input [3:0] a; output y; assign y = (a > 4'sd2); endmodule", 'signed')
  })

  test('a parameter underflow [W-1:0] with W=0 is reported, not built as a multi-gigabit bus', () => {
    reported(
      'module m(a, y); input a; output [W-1:0] y; parameter W = 0; assign y = a; endmodule',
      'unreasonably large',
    )
  })

  test('a huge parameterized width (1 << 28) is reported, not hung', () => {
    reported(
      'module m #(parameter W = 1 << 28) (input a, output [W-1:0] y); assign y = a; endmodule',
      'unreasonably large',
    )
  })

  test("an absurd literal width (10000000000'h1) folds to non-constant, not a giant bigint", () => {
    reported(
      "module m(a, y); input a; output y; parameter P = 10000000000'h1; assign y = a; endmodule",
      'not a constant',
    )
  })

  test('a parameter name colliding with a gate INSTANCE name is reported, not silently dropped', () => {
    // Before the guard, `G` was substituted to `32'd2`, so `and G(...)` became `and 32'd2(...)` and the gate
    // vanished with no warning. Now the collision is reported and G is left un-substituted (the gate survives).
    reported(
      'module m #(parameter G = 2) (input a, input b, output y); and G(y, a, b); endmodule',
      'collides',
    )
  })

  test('a parameter name colliding with a port name (an escaped \\W == identifier W) is reported', () => {
    reported(
      'module m #(parameter W = 8) (input \\W , input b, output o); assign o = \\W & b; endmodule',
      'collides',
    )
  })

  test('an out-of-range LHS bit-select (w[9] on a 4-bit w) is reported, not a silent phantom net', () => {
    // Pre-existing bug the parameter review surfaced: the read side already reported out-of-range, the LHS did
    // not — it minted a phantom w[9] and left w[0] undriven with zero warnings.
    reported(
      'module m(a, o); input a; output o; wire [3:0] w; assign w[9] = a; assign o = w[0]; endmodule',
      'out of range',
    )
  })
})
