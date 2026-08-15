/**
 * SIGNED PARAMETERS — a `parameter`/`localparam` is elaborated away by substituting its value as a sized
 * literal, and that literal has to carry the parameter's SIGNEDNESS or the substitution quietly changes what
 * the design computes. IEEE 1364-2005 §5.5.1: a comparison with even one unsigned operand is an UNSIGNED
 * comparison. So `parameter N = -1` written out as `32'd4294967295` turns `k >= N` into "3 >= 4294967295",
 * which is false — a loop Icarus Verilog 14.0 runs five times unrolls zero times, and the design still builds.
 *
 * §12.2 decides the parameter's own signedness, and all three branches are pinned below because they give
 * DIFFERENT iteration counts on the same loop:
 *   - a `signed` keyword or an `integer` type  → signed
 *   - a RANGE with no `signed`                 → unsigned, whatever the default expression was
 *   - neither                                  → the default expression's own signedness
 * and the expression's signedness follows §3.11.1: a plain decimal (`-1`) is signed, a based literal is
 * unsigned unless it is marked (`32'hFFFFFFFF` unsigned, `4'sd3` signed).
 *
 * EVERY expected value below is the output of Icarus Verilog 14.0 (oss-cad-suite) on the same source, swept
 * over all sixteen values of the 4-bit input — never what this implementation happens to return.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { characterizeBlock } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const said = (warnings: string[]): string => warnings.join(' | ')
const bitOf = (name: string): number => Number(name.match(/\[(\d+)\]$/)?.[1] ?? 0)

/** Drive every value of the 4-bit input `a` through the block's REAL gates and read `y` as an unsigned
 *  number. Every `y` bit must be built, or the sweep is not comparable with the simulator's. */
function sweep(verilog: string): number[] {
  const { block, warnings } = importVerilog(verilog)
  expect(block, said(warnings)).not.toBeNull()
  const table = characterizeBlock(block as BlockData)
  expect(table, said(warnings)).not.toBeNull()
  if (table === null) return []
  expect(table.outputs.length, `every y bit must be built — ${said(warnings)}`).toBe(4)
  const inBit = table.inputs.map(bitOf)
  const outBit = table.outputs.map(bitOf)
  return Array.from({ length: 16 }, (_, a) => {
    const row = table.rows.find((r) =>
      r.in.every((b, i) => b === (((a >> (inBit[i] as number)) & 1) === 1)),
    )
    expect(row, `no row for a=${a}`).toBeDefined()
    let value = 0
    row?.out.forEach((b, i) => {
      if (b) value += 1 << (outBit[i] as number)
    })
    return value
  })
}

/** `always @* begin y = 0; for (<header>) y = y + a; end` — y ends at (iteration count × a) mod 16, so the
 *  sweep reads the iteration count directly and a miscount cannot hide. */
const countingLoop = (decl: string, header: string): string =>
  `module top(input [3:0] a, output reg [3:0] y);
  ${decl}
  integer k;
  always @* begin y = 0; for (${header}) y = y + a; end
endmodule`

const DOWN_FROM_3 = 'k = 3; k >= N; k = k - 1'

// Icarus, for the loop above: N × a mod 16 for N iterations.
const FOUR_TIMES = [0, 4, 8, 12, 0, 4, 8, 12, 0, 4, 8, 12, 0, 4, 8, 12]
const FIVE_TIMES = [0, 5, 10, 15, 4, 9, 14, 3, 8, 13, 2, 7, 12, 1, 6, 11]
const SIX_TIMES = [0, 6, 12, 2, 8, 14, 4, 10, 0, 6, 12, 2, 8, 14, 4, 10]
const NEVER = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

describe('a NEGATIVE parameter bound counts the iterations Icarus counts', () => {
  test('`parameter N = -1` runs k = 3, 2, 1, 0, -1 — five times, not zero', () => {
    // The whole defect in one line. Substituted unsigned, `3 >= 4294967295` is false on the first test and
    // the design builds with the loop body gone: y = 0 for every input, with nothing said.
    expect(sweep(countingLoop('parameter N = -1;', DOWN_FROM_3))).toEqual(FIVE_TIMES)
  })

  test('a localparam, an explicit `signed`, and a computed negative all count the same', () => {
    expect(sweep(countingLoop('localparam N = -1;', DOWN_FROM_3))).toEqual(FIVE_TIMES)
    expect(sweep(countingLoop('parameter signed N = -1;', DOWN_FROM_3))).toEqual(FIVE_TIMES)
    expect(sweep(countingLoop('parameter N = 0 - 1;', DOWN_FROM_3))).toEqual(FIVE_TIMES)
    expect(sweep(countingLoop('parameter integer N = -1;', DOWN_FROM_3))).toEqual(FIVE_TIMES)
    expect(sweep(countingLoop('parameter signed [3:0] N = -1;', DOWN_FROM_3))).toEqual(FIVE_TIMES)
  })

  test('the bound itself decides the count — -2 runs six times, `>` runs four', () => {
    expect(sweep(countingLoop('parameter N = -2;', DOWN_FROM_3))).toEqual(SIX_TIMES)
    expect(sweep(countingLoop('localparam signed N = -2;', DOWN_FROM_3))).toEqual(SIX_TIMES)
    expect(sweep(countingLoop('parameter N = -1;', 'k = 3; k > N; k = k - 1'))).toEqual(FOUR_TIMES)
  })

  test('a negative parameter as the START value, and as the STEP', () => {
    expect(sweep(countingLoop('parameter N = -2;', 'k = N; k < 2; k = k + 1'))).toEqual(FOUR_TIMES)
    expect(sweep(countingLoop('parameter N = -1;', 'k = 3; k >= 0; k = k + N'))).toEqual(FOUR_TIMES)
    expect(sweep(countingLoop('parameter N = -1;', 'k = -4; k <= N; k = k + 1'))).toEqual(
      FOUR_TIMES,
    )
  })

  test('a POSITIVE parameter bound against a counter that starts negative', () => {
    // The mirror of the same defect: `parameter N = 2` is signed too, and at k = -2 an unsigned `k < N` is
    // "4294967294 < 2" — false. Icarus runs k = -2, -1, 0, 1.
    expect(sweep(countingLoop('parameter N = 2;', 'k = -2; k < N; k = k + 1'))).toEqual(FOUR_TIMES)
  })

  test('the negative bound reaches through a nested loop and an instance override', () => {
    expect(
      sweep(
        `module top(input [3:0] a, output reg [3:0] y);
  parameter N = -1;
  integer i;
  integer k;
  always @* begin
    y = 0;
    for (i = 0; i < 2; i = i + 1) for (k = 1; k >= N; k = k - 1) y = y + a;
  end
endmodule`,
      ),
    ).toEqual(SIX_TIMES)
    expect(
      sweep(
        `module inner(input [3:0] a, output reg [3:0] y);
  parameter N = 0;
  integer k;
  always @* begin y = 0; for (k = 3; k >= N; k = k - 1) y = y + a; end
endmodule
module top(input [3:0] a, output [3:0] y);
  inner #(.N(-1)) u(.a(a), .y(y));
endmodule`,
      ),
    ).toEqual(FIVE_TIMES)
  })

  test('a bit index the negative-bounded unroll produces still lands where Icarus puts it', () => {
    expect(
      sweep(
        `module top(input [3:0] a, output reg [3:0] y);
  parameter N = -2;
  integer k;
  always @* begin
    y = 0;
    for (k = 1; k > N; k = k - 1) y[k+2] = a[k+2];
  end
endmodule`,
      ),
    ).toEqual([0, 0, 2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12, 14, 14])
  })
})

describe('an UNSIGNED parameter stays unsigned, and the same loop runs zero times', () => {
  test('a based literal without the `s` marker is unsigned even when every bit is set', () => {
    // Icarus: zero iterations. Reading this one signed would be the defect in reverse — five iterations for a
    // loop the simulator never enters.
    expect(sweep(countingLoop("parameter N = 32'hFFFFFFFF;", DOWN_FROM_3))).toEqual(NEVER)
    expect(sweep(countingLoop("parameter N = -4'd1;", DOWN_FROM_3))).toEqual(NEVER)
  })

  test('a RANGE with no `signed` makes the parameter unsigned, negative default or not', () => {
    expect(sweep(countingLoop('parameter [3:0] N = -1;', DOWN_FROM_3))).toEqual(NEVER)
  })
})

describe('ordinary non-negative parameters are untouched', () => {
  test('plain, computed, ranged, sized, localparam, signed and integer bounds all still count', () => {
    expect(sweep(countingLoop('parameter N = 4;', 'k = 0; k < N; k = k + 1'))).toEqual(FOUR_TIMES)
    expect(sweep(countingLoop('parameter N = 5 - 1;', 'k = 0; k < N; k = k + 1'))).toEqual(
      FOUR_TIMES,
    )
    expect(sweep(countingLoop('localparam N = 5;', 'k = 0; k < N; k = k + 1'))).toEqual(FIVE_TIMES)
    expect(sweep(countingLoop("parameter N = 8'd6;", 'k = 0; k < N; k = k + 1'))).toEqual(SIX_TIMES)
    expect(sweep(countingLoop('parameter integer N = 2;', 'k = 0; k < N; k = k + 1'))).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14, 0, 2, 4, 6, 8, 10, 12, 14,
    ])
    const THREE_TIMES = [0, 3, 6, 9, 12, 15, 2, 5, 8, 11, 14, 1, 4, 7, 10, 13]
    expect(sweep(countingLoop('parameter [7:0] N = 3;', 'k = 0; k < N; k = k + 1'))).toEqual(
      THREE_TIMES,
    )
    expect(sweep(countingLoop('parameter signed N = 3;', 'k = 0; k < N; k = k + 1'))).toEqual(
      THREE_TIMES,
    )
    expect(sweep(countingLoop('parameter N = 2 + 1;', 'k = 0; k < N; k = k + 1'))).toEqual(
      THREE_TIMES,
    )
  })

  test('a parameter still sizes a bus, a replication, a case label, a shift and a compare', () => {
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter W = 4;
  wire [W-1:0] t;
  assign t = a;
  assign y = {t[W-1], t[W-2:0]};
endmodule`,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter R = 2;
  assign y = {{R{a[0]}}, {R{a[3]}}};
endmodule`,
      ),
    ).toEqual([0, 12, 0, 12, 0, 12, 0, 12, 3, 15, 3, 15, 3, 15, 3, 15])
    expect(
      sweep(
        `module top(input [3:0] a, output reg [3:0] y);
  parameter SEL = 2;
  always @* casez (a[1:0])
    SEL: y = 4'd7;
    2'b1?: y = 4'd5;
    default: y = 4'd1;
  endcase
endmodule`,
      ),
    ).toEqual([1, 1, 7, 5, 1, 1, 7, 5, 1, 1, 7, 5, 1, 1, 7, 5])
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter S = 1;
  assign y = a << S;
endmodule`,
      ),
    ).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 0, 2, 4, 6, 8, 10, 12, 14])
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter LIM = 8;
  assign y = (a < LIM) ? a + 4'd1 : a - 4'd1;
endmodule`,
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 7, 8, 9, 10, 11, 12, 13, 14])
  })
})

describe('a parameter meeting a SIGNED net compares the way the simulator compares', () => {
  const compare = (decl: string): string =>
    `module top(input [3:0] a, output [3:0] y);
  ${decl}
  wire signed [3:0] s = a;
  assign y = (s >= N) ? 4'd9 : 4'd2;
endmodule`

  test('a negative parameter against a signed wire: only s = -1 clears the bar', () => {
    expect(sweep(compare('parameter N = -1;'))).toEqual([
      9, 9, 9, 9, 9, 9, 9, 9, 2, 2, 2, 2, 2, 2, 2, 9,
    ])
  })

  test('a POSITIVE parameter is signed too, so the negative half of s falls below it', () => {
    expect(sweep(compare('parameter N = 4;'))).toEqual([
      2, 2, 2, 2, 9, 9, 9, 9, 2, 2, 2, 2, 2, 2, 2, 2,
    ])
  })

  test('the same value written unsigned makes the comparison unsigned, and the answer differs', () => {
    // Same 4, but `32'd4` and `[7:0] N = 4` are unsigned, so s is compared as an unsigned 32-bit number and
    // the whole top half passes. Icarus draws the same distinction; getting it backwards either way is a
    // silently different circuit.
    const ALL_HIGH_PASS = [2, 2, 2, 2, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]
    expect(sweep(compare("parameter N = 32'd4;"))).toEqual(ALL_HIGH_PASS)
    expect(sweep(compare('parameter [7:0] N = 4;'))).toEqual(ALL_HIGH_PASS)
  })

  test('an unsigned input compared against a negative parameter never passes', () => {
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter N = -1;
  assign y = (a >= N) ? 4'd9 : 4'd2;
endmodule`,
      ),
    ).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2])
  })

  test('a narrow signed parameter widens by its SIGN bit into a signed sum', () => {
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter signed [3:0] N = -3;
  wire signed [7:0] s = a;
  assign y = (s + N) >= 0 ? 4'd9 : 4'd2;
endmodule`,
      ),
    ).toEqual([2, 2, 2, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9])
  })

  test('plain arithmetic on a negative parameter is unchanged — the low bits never depended on sign', () => {
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter N = -1;
  assign y = a + N;
endmodule`,
      ),
    ).toEqual([15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter N = -1;
  assign y = a * N;
endmodule`,
      ),
    ).toEqual([0, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter N = -1;
  assign y = a + (N << 1);
endmodule`,
      ),
    ).toEqual([14, 15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  })
})

describe('a constant fold with a NEGATIVE operand is done signed, not refused and not guessed', () => {
  // These three refused before, because the evaluator folded on the raw two's-complement pattern and unsigned
  // −1 is 4294967295: rather than answer wrong it answered nothing. The pattern is now re-read at the pair's
  // shared signedness before the operator sees it, so a magnitude comparison and a truncating divide are REAL
  // signed operations and the refusals are gone. Every expectation below is Icarus Verilog 14.0's own sweep.
  test('a magnitude comparison with a negative operand folds signed', () => {
    // Icarus: y = a + 4 (`-1 < 0` is TRUE). Folded on the raw pattern it was 8 — the wrong constant.
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter N = (-1 < 0) ? 4 : 8;
  assign y = a + N;
endmodule`,
      ),
    ).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3])
  })

  test('a divide and a remainder with a negative operand fold signed', () => {
    // Icarus: -3 % 2 is −1, so y = a − 1. On the raw pattern, 4294967293 % 2 is 1 and y = a + 1.
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter N = -3 % 2;
  assign y = a + N;
endmodule`,
      ),
    ).toEqual([15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    // Icarus: -6 / 2 is −3, so y = a − 3.
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter N = -6 / 2;
  assign y = a + N;
endmodule`,
      ),
    ).toEqual([13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  test('the same operators on non-negative operands still fold and still build', () => {
    expect(
      sweep(
        `module top(input [3:0] a, output [3:0] y);
  parameter N = 6 / 2;
  assign y = a + N;
endmodule`,
      ),
    ).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2])
  })
})
