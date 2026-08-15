/**
 * SIGNEDNESS, IN ONE PLACE — the uniform form, not a seventh per-site patch.
 *
 * Six earlier rounds each fixed a signedness defect at the site where it was reported (ports, then
 * concatenations, then comparisons, then parameter substitution) and the same class survived somewhere else,
 * because the knowledge had nowhere to live: `verilog-const.ts` owned `wrap` (truncate) and had NO widening
 * counterpart at all, so a narrower SIGNED operand was silently zero-extended by every fold, and the loop
 * unroller was handed a bare `bigint` with the type stripped off at the boundary.
 *
 * There is now ONE widening rule — `extendTo(v, width, signed)` in verilog-const.ts, IEEE 1364-2005 §5.5.2
 * step 2 — and one `align()` that puts two folded operands side by side at one width and one signedness
 * (§5.4.1 Table 5-22 + §5.5.1) before any operator sees them. `asInteger(v)` is the same rule read the other
 * way: the exact integer a constant denotes under its own signedness, which is what a loop start, a repeat
 * count, a bus bound and a `/ % < <= > >=` fold each need. The synth-side fold now returns that same ConstVal
 * instead of a bare bigint, so the loop unroller can no longer lose the type.
 *
 * EVERY expected value in this file is the output of Icarus Verilog 14.0 (oss-cad-suite) on the same source —
 * swept over all sixteen values of the 4-bit input `a` — never what this implementation happens to return.
 * The suite has twice been fully green over wrong answers, so an expectation read out of current behaviour is
 * worth nothing here.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { characterizeBlock } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const said = (warnings: string[]): string => warnings.join(' | ')
const bitOf = (name: string): number => Number(name.match(/\[(\d+)\]$/)?.[1] ?? 0)

/** Drive every value of the 4-bit input `a` through the block's REAL gates and read `y` as an unsigned
 *  number. Every `y` bit must be built, or the sweep is not comparable with the simulator's. */
function sweep(verilog: string, outWidth: number): number[] {
  const { block, warnings } = importVerilog(verilog)
  expect(block, said(warnings)).not.toBeNull()
  const table = characterizeBlock(block as BlockData)
  expect(table, said(warnings)).not.toBeNull()
  if (table === null) return []
  expect(table.outputs.length, `every y bit must be built — ${said(warnings)}`).toBe(outWidth)
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

/** Assert the design is refused whole (nothing published) and that the reason names `phrase`. */
function refuses(verilog: string, phrase: string): void {
  const { block, warnings } = importVerilog(verilog)
  expect(block, `expected no design; got one. ${said(warnings)}`).toBeNull()
  expect(said(warnings)).toContain(phrase)
}

/**
 * Fold `expr` as a constant, then widen it into a 40-bit SIGNED wire and read all forty bits — so the ONE
 * string this returns pins the fold's value, its width and its signedness at once (a 4-bit −1 sign-extends to
 * forty ones; a 4-bit +15 zero-extends to `…001111`). Read at a = 0, where `y` is exactly the widened `Q`.
 */
function folds(expr: string, decls = ''): string {
  const src = `module m(input [3:0] a, output [39:0] y);
${decls}  localparam Q = ${expr};
  wire signed [39:0] z;
  assign z = Q;
  assign y = z ^ {36'd0, a};
endmodule`
  const { block, warnings } = importVerilog(src)
  expect(block, `${expr} — ${said(warnings)}`).not.toBeNull()
  const table = characterizeBlock(block as BlockData)
  expect(table, `${expr} — ${said(warnings)}`).not.toBeNull()
  if (table === null) return ''
  expect(table.outputs.length, `${expr} — every y bit must be built`).toBe(40)
  const inBit = table.inputs.map(bitOf)
  const outBit = table.outputs.map(bitOf)
  const row = table.rows.find((r) =>
    r.in.every((b, i) => b === (((0 >> (inBit[i] as number)) & 1) === 1)),
  )
  expect(row, `${expr} — no row for a=0`).toBeDefined()
  const bits = new Array<string>(40).fill('0')
  row?.out.forEach((b, i) => {
    bits[outBit[i] as number] = b ? '1' : '0'
  })
  return bits.reverse().join('')
}

const SIGNED_B = '  parameter signed [3:0] B = -2;\n'
/** A 40-bit expectation written as the low `n` bits, sign- or zero-extended — keeps the rows readable. */
const ext = (low: string, fill: '0' | '1'): string => fill.repeat(40 - low.length) + low

describe('a loop counter starts at the value its start expression really denotes', () => {
  // Every one of these BUILT before and disagreed with Icarus, because the loop's start folded through a
  // context that hard-coded `unsigned`: a 4-bit signed −2 arrived at the counter as +14.
  const accumulate = (decl: string, header: string): string =>
    `module m(input [3:0] a, output reg [7:0] y);
${decl}  always @* begin
    y = a & 8'h00;
    for (${header}) y = y + a;
  end
endmodule`
  const times = (n: number): number[] => Array.from({ length: 16 }, (_, a) => (n * a) % 256)

  test('a bare signed literal start — for (i = 4she; i < 2; …) runs FOUR times, not none', () => {
    // Icarus: y = 4a. Zero-extended the start is +14, the condition is false at once and y stays 0.
    expect(sweep(accumulate('  integer i;\n', "i = 4'she; i < 2; i = i + 1"), 8)).toEqual(times(4))
  })

  test('a signed literal counting DOWN — for (i = 4shf; i > 0; …) runs NONE, not fifteen', () => {
    expect(sweep(accumulate('  integer i;\n', "i = 4'shf; i > 0; i = i - 1"), 8)).toEqual(times(0))
  })

  test('a $signed() cast as the start runs four times', () => {
    expect(
      sweep(accumulate('  integer i;\n', "i = $signed(4'b1110); i < 2; i = i + 1"), 8),
    ).toEqual(times(4))
  })

  test('a narrow `reg signed [7:0]` counter, not an integer, runs four times', () => {
    expect(sweep(accumulate('  reg signed [7:0] k;\n', "k = 4'she; k < 2; k = k + 1"), 8)).toEqual(
      times(4),
    )
  })

  test('a signed parameter as the start — parameter signed [3:0] LO = -2 — runs four times', () => {
    expect(
      sweep(
        accumulate('  parameter signed [3:0] LO = -2;\n  integer i;\n', 'i = LO; i < 2; i = i + 1'),
        8,
      ),
    ).toEqual(times(4))
  })

  test('a start EXPRESSION sign-extends: 3 + ST with ST = -1 is 2, not 18', () => {
    // Nothing is truncated here — the start is already 32 bits wide. The 4-bit −1 was zero-extended to +15
    // and `3 + ST` folded to 18, so the loop from 18 to 4 ran zero times where Icarus runs two.
    expect(
      sweep(
        accumulate(
          '  parameter signed [3:0] ST = -1;\n  integer i;\n',
          'i = 3 + ST; i < 4; i = i + 1',
        ),
        8,
      ),
    ).toEqual(times(2))
  })

  test('a wrong start silently drops an output bit: for (i = LO; i < 15; …) runs SEVENTEEN times', () => {
    // The design built, half of it was right, and one bit of y was quietly wrong: 17a vs 1a.
    expect(
      sweep(
        accumulate(
          '  parameter signed [3:0] LO = -2;\n  integer i;\n',
          'i = LO; i < 15; i = i + 1',
        ),
        8,
      ),
    ).toEqual(times(17))
  })

  test('the same defect inside a FUNCTION body, where it survived inlining', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
  function [7:0] f;
    input [3:0] v;
    integer i;
    begin
      f = 0;
      for (i = 4'she; i < 2; i = i + 1) f = f + v;
    end
  endfunction
  assign y = f(a);
endmodule`,
        8,
      ),
    ).toEqual(times(4))
  })

  test('an iteration-dependent body never fires when the start is wrong', () => {
    // `if (i == 0) y = a;` — with the start at +14 the loop never reaches 0 and y keeps its 8'hff seed.
    expect(
      sweep(
        `module m(input [3:0] a, output reg [7:0] y);
  parameter signed [3:0] LO = -2;
  integer i;
  always @* begin
    y = 8'hff;
    for (i = LO; i < 3; i = i + 1) begin
      if (i == 0) y = a;
    end
  end
endmodule`,
        8,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  test('repeat (R) with a negative signed R runs the body ZERO times, not fourteen', () => {
    // IEEE 1364-2005 §9.6 — a repeat count that is not positive executes the statement zero times. Icarus
    // leaves y at its seed; the count read as a raw pattern was +14 and published fourteen adders.
    expect(
      sweep(
        `module m(input [3:0] a, output reg [7:0] y);
  parameter signed [3:0] R = -2;
  always @* begin
    y = a & 8'h00;
    repeat (R) y = y + a;
  end
endmodule`,
        8,
      ),
    ).toEqual(times(0))
  })
})

describe('one widening rule: a narrower SIGNED operand sign-extends in every fold', () => {
  test('addition, subtraction and multiplication', () => {
    expect(folds("3 + 4'shf")).toBe(ext('10', '0')) // 2, not 18
    expect(folds("4'shf + 1")).toBe(ext('0000', '0')) // 0, not 16
    expect(folds("8'sd1 + 4'shf")).toBe(ext('00000000', '0')) // 0, not 16
    expect(folds("5'sh1f + 8'sd0")).toBe(ext('', '1')) // −1, not 31
    expect(folds("16'sh8000 + 1")).toBe(ext('1000000000000001', '1')) // −32767, not 32769
    expect(folds("4'shf - 8'sd0")).toBe(ext('', '1')) // −1, not 15
    expect(folds("4'shf * 2")).toBe(ext('10', '1')) // −2, not 30
    expect(folds("3'sd4 * 2")).toBe(ext('1000', '1')) // −8, not 8
    expect(folds("2'sb11 * 3")).toBe(ext('101', '1')) // −3, not 9
    expect(folds("1'sb1 + 1")).toBe(ext('0', '0')) // 0, not 2
    expect(folds("3 * 4'shf")).toBe(ext('101', '1')) // −3
    expect(folds('-2 * -3')).toBe(ext('110', '0')) // 6
  })

  test('bit-wise operators extend the same way the expression is signed', () => {
    expect(folds("4'shf & 8'hff")).toBe(ext('1111', '0')) // unsigned expression ⇒ 15
    expect(folds("4'shf ~^ 8'shff")).toBe(ext('', '1')) // signed expression ⇒ all ones
    expect(folds("4'shf | 8'h00")).toBe(ext('1111', '0'))
    expect(folds("4'shf ^ 4'shf")).toBe(ext('0', '0'))
  })

  test('the ternary widens the arm it CHOSE, sign-extending when both arms are signed', () => {
    expect(folds("1 ? 4'shf : 2")).toBe(ext('', '1')) // −1, not 15
    expect(folds("0 ? 2 : 4'shf")).toBe(ext('', '1'))
    expect(folds("1 ? 4'shf : 32'sd0")).toBe(ext('', '1'))
  })

  test('shifts: the amount stays an unsigned count, the left operand keeps its own width', () => {
    expect(folds("4'shf >> 1")).toBe(ext('111', '0'))
    expect(folds('-1 >> 1')).toBe(ext('1111111111111111111111111111111', '0'))
    expect(folds("1 << 4'shf")).toBe(ext('1000000000000000', '0'))
    expect(folds("4'shf << 8'sd1")).toBe(ext('1110', '1'))
  })

  test('a signed parameter behaves the same in every operator', () => {
    expect(folds('B + 3', SIGNED_B)).toBe(ext('1', '0'))
    expect(folds("B & 8'shff", SIGNED_B)).toBe(ext('10', '1'))
    expect(folds('1 ? B : 0', SIGNED_B)).toBe(ext('10', '1'))
    expect(folds('B >> 1', SIGNED_B)).toBe(ext('111', '0'))
    expect(folds('B * 2', SIGNED_B)).toBe(ext('100', '1'))
    expect(folds('B + B', SIGNED_B)).toBe(ext('100', '1'))
    expect(folds('-B', SIGNED_B)).toBe(ext('10', '0'))
  })
})

describe('a magnitude comparison and a truncating divide are REAL signed operations', () => {
  // These six refused before (the evaluator would not fold `< <= > >= / %` with a negative pattern) — an
  // over-refusal that took ordinary RTL down with it. They fold now, at the pair's shared signedness.
  test('a comparison is signed only when BOTH operands are', () => {
    expect(folds("4'shf > 4'hf")).toBe(ext('0', '0')) // one unsigned operand ⇒ 15 > 15 ⇒ 0
    expect(folds("4'shf >= 4'hf")).toBe(ext('1', '0'))
    expect(folds("4'shf < 0")).toBe(ext('1', '0')) // both signed ⇒ −1 < 0 ⇒ 1
    expect(folds("4'shf >= 0")).toBe(ext('0', '0'))
    expect(folds("4'sd7 > 4'sd1")).toBe(ext('1', '0'))
    expect(folds("4'shf <= 4'sd0")).toBe(ext('1', '0'))
    expect(folds('(B < 0)', SIGNED_B)).toBe(ext('1', '0'))
    expect(folds("(B > 4'hf)", SIGNED_B)).toBe(ext('0', '0'))
  })

  test('a comparison whose negative was already widened away is still right', () => {
    // The old guard only looked at an IMMEDIATE operand, so `(4'shf + 0) < 2` folded 15 at 32 bits and then
    // compared 15 < 2 — a wrong answer the guard existed to prevent.
    expect(folds("(4'shf + 0) < 2")).toBe(ext('1', '0'))
  })

  test('equality compares the operands at the wider size, extended', () => {
    expect(folds("4'sb1110 == -2")).toBe(ext('1', '0'))
    expect(folds("4'shf == -1")).toBe(ext('1', '0'))
    expect(folds("4'shf != -1")).toBe(ext('0', '0'))
  })

  test('divide truncates toward zero and the remainder takes the DIVIDEND sign', () => {
    expect(folds('-3 / 2')).toBe(ext('', '1')) // −1
    expect(folds('-3 % 2')).toBe(ext('', '1')) // −1
    expect(folds('-1 / 2')).toBe(ext('0', '0')) // 0
    expect(folds('-1 % 2')).toBe(ext('', '1')) // −1
    expect(folds('(-8) / 3')).toBe(ext('10', '1')) // −2
    expect(folds('(-8) % 3')).toBe(ext('10', '1')) // −2
    expect(folds('8 / -3')).toBe(ext('10', '1')) // −2
    expect(folds('8 % -3')).toBe(ext('10', '0')) // +2
    expect(folds("4'shf / 4'hf")).toBe(ext('1', '0')) // unsigned ⇒ 15/15 = 1
    expect(folds("4'shf % 4'hd2")).toBe(ext('1', '0')) // unsigned ⇒ 15%2 = 1
    expect(folds("4'shf / 4'sd1")).toBe(ext('', '1')) // signed ⇒ −1
    expect(folds('B / 2', SIGNED_B)).toBe(ext('', '1')) // −1
    expect(folds('B % 3', SIGNED_B)).toBe(ext('10', '1')) // −2
  })
})

describe("a parameter's declared range resizes its value in BOTH directions", () => {
  test('a too-narrow SIGNED default sign-extends into a wider declared range', () => {
    // `parameter signed [7:0] N = -4'sd1` is −1. Truncating with `%` alone made it +15.
    expect(folds('N', "  parameter signed [7:0] N = -4'sd1;\n")).toBe(ext('', '1'))
    expect(folds('N + 1', "  parameter signed [7:0] N = 4'she;\n")).toBe(ext('', '1'))
  })

  test('the same default in an UNSIGNED declared range stays positive', () => {
    expect(folds('N', "  parameter [7:0] N = -4'sd1;\n")).toBe(ext('11111111', '0'))
  })
})

describe('what the central form cannot prove, it refuses by name', () => {
  test('an unsized decimal that needs bit 31 has no portable width', () => {
    // IEEE 1364-2005 §3.11.1 makes it "at least 32 bits" with an implementation-defined size. At 32 bits
    // `4294967295` IS −1 and `-1 == 4294967295` folds to 1; Icarus sizes it at 33 bits and folds it to 0.
    // There is no width here that is provably right, so the literal is not a constant.
    refuses(
      `module m(input [3:0] a, output [3:0] y);
  localparam Q = (-1 == 4294967295);
  assign y = a + Q;
endmodule`,
      'not a constant expression',
    )
  })

  test('an elaboration constant with no declared range is carried losslessly', () => {
    // This test asserted a refusal for all four of these, on the reading that an elaboration constant's width
    // was unprovable. Three of the four are provable, and were being refused wrongly. Re-measured against
    // Icarus Verilog 14.0 with `$bits`: `+ −` size the result at max(operands)+1 and `*` at the sum, so
    // nothing overflows them — `4'd15 + 4'd1` is 16 at FIVE bits, `4'sd7 + 4'sd1` is +8 at five, and
    // `8'd200 + 8'd100` is 300 at NINE. The rule composes (`4'shf + 4'sd1 + 4'sd1` is 6 bits) and it is now
    // what this evaluator does, so all three fold and agree bit for bit.
    expect(folds("4'd15 + 4'd1")).toBe(ext('10000', '0'))
    expect(folds("4'sd7 + 4'sd1")).toBe(ext('1000', '0'))
    expect(folds("8'd200 + 8'd100")).toBe(ext('100101100', '0'))
    // The fourth used to be refused as unprovable, on the reading that a DECLARED RANGE would give it a second
    // meaning the evaluator could not see. It has only one meaning, and the range is now the CONTEXT rather
    // than an afterthought: measured, `localparam Q = 4'd2 - 4'd5` is 29 at five bits and
    // `localparam signed [7:0] Q = 4'd2 - 4'd5` is −3 at eight, which is what evaluating at the declared width
    // gives without any special case.
    expect(folds("4'd2 - 4'd5")).toBe(ext('11101', '0'))
  })

  test('a fold whose width depends on an UNSIZED operand growing is refused', () => {
    // A constant written without a width is "at least 32 bits" (§3.11.1) and Icarus lets it GROW rather than
    // wrap: measured with `$bits`, `1 << 40` is 72 bits, `~0 << 8` is 40, `2 ** 40` is 42 — while the
    // written-out `32'sd1 << 20` stays 32 and `4'shf << 1` wraps at four. Nothing here reproduces the grown
    // width. It only changes the answer when the result is NEGATIVE (the extra bits are ones), so that is
    // exactly what refuses; a written-out left operand is unaffected and still folds.
    for (const expr of ['-1 << 1', '~0 << 8'])
      refuses(
        `module m(input [3:0] a, output [3:0] y);
  localparam Q = ${expr};
  assign y = a + Q;
endmodule`,
        'not a constant expression',
      )
    // Measured on the same designs at a 64-bit output, before this rule existed: `localparam Q = -1 << 1`
    // published 0x0FFFFFFFFE where Icarus gives 0x1FFFFFFFE, and `~0 << 8` published 0x00FFFFFF00 where
    // Icarus gives 0xFFFFFFFF00. Both built, neither warned.
    expect(folds("4'shf << 1")).toBe(ext('1110', '1'))
    expect(folds("4'shf << 8'sd1")).toBe(ext('1110', '1'))
    expect(folds('1 << 20')).toBe(ext('100000000000000000000', '0'))
  })

  test('a NEGATIVE exponent refuses instead of folding a large power', () => {
    refuses(
      `module m(input [3:0] a, output [3:0] y);
  localparam Q = 2 ** 4'shf;
  assign y = a + Q;
endmodule`,
      'not a constant expression',
    )
  })

  test('a negative replication count is SEEN as negative and refused', () => {
    // Icarus rejects this source outright ("Concatenation repeat may not be negative (-2)"). Read as a raw
    // pattern the count was +14 and a 14-wide replication was published for source that does not compile.
    refuses(
      `module m(input [3:0] a, output [13:0] y);
  parameter signed [3:0] B = -2;
  assign y = {B{1'b1}} ^ {10'd0, a};
endmodule`,
      'replication count',
    )
  })

  test('a negative bus bound is reported as negative, not as a 4-billion-bit bus', () => {
    // `[W-1:0]` with W = 0 is `[-1:0]`. Read as a raw pattern the msb was 4 294 967 295 and the refusal
    // claimed an unreasonable width; read through asInteger it names the real fault. Icarus rejects this
    // source outright ("Unable to bind parameter `W'"), so nothing buildable is lost either way.
    const { warnings } = importVerilog(
      'module m(a, y); input a; output [W-1:0] y; parameter W = 0; assign y = a; endmodule',
    )
    expect(said(warnings)).toContain('range [-1:0] must be [N:0]')
  })
})

describe('ordinary RTL that built before still builds and still agrees', () => {
  test('a plain ascending for loop', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output reg [3:0] y);
  integer i;
  always @* begin
    y = 0;
    for (i = 0; i < 4; i = i + 1) y[i] = a[3-i];
  end
endmodule`,
        4,
      ),
    ).toEqual([0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15])
  })

  test('a descending for loop over an integer', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output reg [3:0] y);
  integer i;
  always @* begin
    y = 0;
    for (i = 3; i >= 0; i = i - 1) y[3-i] = a[i];
  end
endmodule`,
        4,
      ),
    ).toEqual([0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15])
  })

  test('a nested for loop', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output reg [7:0] y);
  integer i, j;
  always @* begin
    y = 0;
    for (i = 0; i < 2; i = i + 1)
      for (j = 0; j < 2; j = j + 1) y = y + a;
  end
endmodule`,
        8,
      ),
    ).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60])
  })

  test('a repeat with a positive parameter count', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output reg [7:0] y);
  parameter R = 3;
  always @* begin
    y = a & 8'h00;
    repeat (R) y = y + a;
  end
endmodule`,
        8,
      ),
    ).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45])
  })

  test('a loop inside a function', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
  function [7:0] acc;
    input [3:0] v;
    integer i;
    begin
      acc = 0;
      for (i = 0; i < 3; i = i + 1) acc = acc + v;
    end
  endfunction
  assign y = acc(a);
endmodule`,
        8,
      ),
    ).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45])
  })

  test('signed divide and remainder on real nets', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
  wire signed [3:0] s = a;
  assign y = (s / 4'sd3) + (s % 4'sd3);
endmodule`,
        8,
      ),
    ).toEqual([0, 1, 2, 1, 2, 3, 2, 3, 252, 253, 254, 253, 254, 255, 254, 255])
  })

  test('an arithmetic right shift on a signed net', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
  wire signed [3:0] s = a;
  assign y = s >>> 1;
endmodule`,
        8,
      ),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 252, 252, 253, 253, 254, 254, 255, 255])
  })

  test('a parameter used as a case label, and localparams derived from one', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output reg [1:0] y);
  parameter K = 3;
  always @* begin
    y = 0;
    case (a[1:0])
      0: y = 1;
      K: y = 2;
      default: y = 3;
    endcase
  end
endmodule`,
        2,
      ),
    ).toEqual([1, 3, 3, 2, 1, 3, 3, 2, 1, 3, 3, 2, 1, 3, 3, 2])
    expect(
      sweep(
        `module m(input [3:0] a, output reg [2:0] y);
  parameter B = 0;
  localparam L0 = B + 0;
  localparam L1 = B + 1;
  localparam L2 = B + 2;
  always @* begin
    case (a[1:0])
      L0: y = 1;
      L1: y = 2;
      L2: y = 3;
      default: y = 4;
    endcase
  end
endmodule`,
        3,
      ),
    ).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4])
  })

  test('a defaultless combinational case with full coverage still drops its last guard', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output reg [1:0] y);
  always @* begin
    case (a[1:0])
      2'd0: y = 2'd1;
      2'd1: y = 2'd2;
      2'd2: y = 2'd3;
      2'd3: y = 2'd0;
    endcase
  end
endmodule`,
        2,
      ),
    ).toEqual([1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0])
  })

  test('a NEGATIVE parameter through an instance override', () => {
    expect(
      sweep(
        `module cnt(input [3:0] a, output [7:0] y);
  parameter N = 4'd0;
  assign y = a + N;
endmodule
module m(input [3:0] a, output [7:0] y);
  cnt #(.N(-4'd1)) u (a, y);
endmodule`,
        8,
      ),
    ).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
  })

  test('a bus bound computed from a signed parameter sizes the port correctly', () => {
    // `[LO+6:0]` with LO = −2 is [4:0] — a 5-bit port. Reading the bound as a raw pattern published 21 bits.
    expect(
      sweep(
        `module m #(parameter signed [3:0] LO = -2) (input [3:0] a, output [LO+6:0] y);
  assign y = a;
endmodule`,
        5,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  test('a part-select at a NEGATIVE offset reads the bits it names', () => {
    // `a[B+5:B+4]` with B = −2 is a[3:2]. Read as a raw pattern the bounds were 19:18 and the design was
    // refused as out of range — an over-refusal of source Icarus builds.
    expect(
      sweep(
        `module m(input [3:0] a, output [1:0] y);
  parameter signed [3:0] B = -2;
  assign y = a[B+5:B+4];
endmodule`,
        2,
      ),
    ).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3])
  })

  test('a localparam chain, a shift by a parameter and a power still fold', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
  parameter B = 2;
  localparam C = B * 3;
  localparam D = C + 1;
  assign y = a + D;
endmodule`,
        8,
      ),
    ).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22])
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
  parameter S = 2;
  assign y = a << S;
endmodule`,
        8,
      ),
    ).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60])
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
  localparam Q = 2 ** 3;
  assign y = a + Q;
endmodule`,
        8,
      ),
    ).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])
  })
})

describe('the OTHER evaluator: a self-determined operand keeps its OWN type in synthesis too', () => {
  // verilog-synth.ts had eleven hard-coded `false`s where §5.4.1 asks for the operand's own signedness, and a
  // shift whose left operand was truncated by a narrower context. Each row below BUILT and disagreed with
  // Icarus Verilog 14.0; each is now routed through the one `synthSelf` rule.
  const S4 = '  wire signed [3:0] s;\n  assign s = a;\n'
  const one = (body: string, decls = S4): string =>
    `module m(input [3:0] a, output y);\n${decls}${body}\nendmodule`
  const wide = (body: string, decls = S4): string =>
    `module m(input [3:0] a, output [7:0] y);\n${decls}${body}\nendmodule`

  test("a reduction's operand is self-determined, so a signed sub-expression stays signed", () => {
    expect(sweep(one("  assign y = &(s + 8'sd0);"), 1)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ])
    expect(sweep(one('  assign y = &(s >>> 1);'), 1)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
    ])
    expect(sweep(one('  assign y = ^(s >>> 1);'), 1)).toEqual([
      0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0,
    ])
  })

  test('a narrow context cannot truncate a shift before it runs', () => {
    // §5.4.1 Table 5-22 — a shift's size is max(context, L(left)); the context can only GROW it. At width 1
    // `a >> 1` had nothing left to shift and read 0 on every input.
    expect(sweep(one('  assign y = a >> 1;', ''), 1)).toEqual([
      0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1,
    ])
    expect(sweep(one('  assign y = s >>> 3;'), 1)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
    ])
  })

  test('a shift AMOUNT is unsigned, but its own internals keep their type', () => {
    expect(sweep(wide("  assign y = 8'd1 << (s >>> 2);"), 8)).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
  })

  test('a $signed() cast evaluates its operand self-determined, so >>> inside it stays arithmetic', () => {
    expect(sweep(wide('  assign y = $signed(s >>> 3);'), 8)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255,
    ])
  })

  test('a structural gate terminal reads the LSB of the whole expression', () => {
    expect(sweep(one("  and g (y, s >>> 3, 1'b1);"), 1)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
    ])
  })

  test('a narrower SIGNED actual sign-extends into an unsigned formal', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
${S4}  function [7:0] f;
    input [7:0] x;
    f = x;
  endfunction
  assign y = f(s);
endmodule`,
        8,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 248, 249, 250, 251, 252, 253, 254, 255])
  })

  test('an UNSIGNED local inside a function stays unsigned however it was written', () => {
    // `reg [3:0] t; t = $signed(x); h = t;` — a read of t takes t's declared type, not the cast's.
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
  function [7:0] h;
    input [3:0] x;
    reg [3:0] t;
    begin
      t = $signed(x);
      h = t;
    end
  endfunction
  assign y = h(a);
endmodule`,
        8,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  test('a ONE-element concatenation is a concatenation, and a concatenation is unsigned', () => {
    expect(sweep(wide('  assign y = {s};'), 8)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ])
  })

  test('a blocking intermediate is a real WALL — its declared signedness and its declared width', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output reg [7:0] y);
  reg signed [3:0] t;
  always @* begin
    t = a;
    y = t;
  end
endmodule`,
        8,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 248, 249, 250, 251, 252, 253, 254, 255])
    // The same wall on the WIDTH side: `reg [3:0] t; t = a + 4'd1;` truncates at t, so a = 15 gives 0.
    expect(
      sweep(
        `module m(input [3:0] a, output reg [7:0] y);
  reg [3:0] t;
  always @* begin
    t = a + 4'd1;
    y = t;
  end
endmodule`,
        8,
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0])
  })

  test('a SIGNED function return is refused, not warned about and then built unsigned', () => {
    // §10.3.1 makes the call a signed operand and a `call` node carries no signedness, so building it
    // zero-extended is a measured wrong answer: Icarus gives 248…255 for a ≥ 8, this gave 8…15.
    refuses(
      `module m(input [3:0] a, output [7:0] y);
  function signed [3:0] g;
    input [3:0] v;
    g = v;
  endfunction
  assign y = g(a);
endmodule`,
      'a signed function return is not built',
    )
  })

  test('a SIGNED local or argument inside a function or task is refused', () => {
    refuses(
      `module m(input [3:0] a, output [7:0] y);
  function [7:0] f;
    input [3:0] v;
    reg signed [3:0] t;
    begin
      t = v;
      f = t;
    end
  endfunction
  assign y = f(a);
endmodule`,
      'is not built',
    )
    refuses(
      `module m(input [3:0] a, output [7:0] y);
  function [7:0] f;
    input signed [3:0] v;
    f = v;
  endfunction
  assign y = f(a);
endmodule`,
      'is not built',
    )
  })

  test('&& || and a ?: condition are unchanged — a nonzero test cannot notice an extension', () => {
    expect(sweep(one("  assign y = (s >>> 3) && 1'b1;"), 1)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
    ])
    expect(sweep(wide("  assign y = (s >>> 3) ? 8'd7 : 8'd9;"), 8)).toEqual([
      9, 9, 9, 9, 9, 9, 9, 9, 7, 7, 7, 7, 7, 7, 7, 7,
    ])
  })
})

/**
 * A FOLD'S WIDTH IS PART OF ITS ANSWER. Everything above pins what a constant's bits ARE; this pins how MANY
 * there are, which is the half that was still wrong. The width is invisible while a value is positive or
 * while it is read into a signed context — a negative sign-extends to the same number from any size — and it
 * decides the whole answer the moment a NEGATIVE fold is read into an UNSIGNED one, because then the extra
 * bits are ones that get counted.
 *
 * `assign y = Q + a` with an unsigned `a` is exactly that unsigned context. Measured against Icarus Verilog
 * 14.0 (`$bits` for the size, then the eight-bit sweep for the value): a parameter's arithmetic is sized to
 * hold itself losslessly — `+ −` at max(operands)+1 and `*` at the sum — so `4'shf + 4'shf` is −2 at FIVE
 * bits and reads 30, where four bits would have read 14. Every row below is Icarus's, swept over all sixteen
 * values of `a`.
 */
describe("a folded constant's WIDTH survives into an unsigned read", () => {
  const use = (expr: string): string => `module m(input [3:0] a, output [7:0] y);
  localparam Q = ${expr};
  assign y = Q + a;
endmodule`

  test('a NEGATIVE fold read unsigned reads its own width, not the operands’', () => {
    // 5 bits (11110), not 4 (1110) — this design built and published 14 + a with no warning.
    expect(sweep(use("4'shf + 4'shf"), 8)).toEqual([
      30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
    ])
    // `*` is sized at the SUM of the operand widths: 8 bits, so −1 reads 255 rather than 15.
    expect(sweep(use("4'shf * 4'sd1"), 8)).toEqual([
      255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ])
    // The rule composes: the inner `+` is 5 bits, so the outer is max(5,4)+1 = 6, and −3 reads 61.
    expect(sweep(use("(4'shf + 4'shf) + 4'shf"), 8)).toEqual([
      61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76,
    ])
    // Same rule one width up: 6-bit operands give a 7-bit result, and −2 reads 126.
    expect(sweep(use("6'sh3f + 6'sh3f"), 8)).toEqual([
      126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141,
    ])
  })

  test('the extra bit is real: a fold that used to overflow now carries its own value', () => {
    // All three of these were refused outright before, on the reading that the width was unprovable.
    expect(sweep(use("4'd15 + 4'd1"), 8)).toEqual([
      16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    ])
    expect(sweep(use("4'sd7 + 4'sd1"), 8)).toEqual([
      8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ])
    expect(sweep(use("3'sd3 * 3'sd3"), 8)).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ])
  })

  test('a bitwise read sees the same width', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
  localparam Q = 4'shf + 4'shf;
  assign y = {4'd0, a} | Q;
endmodule`,
        8,
      ),
    ).toEqual([30, 31, 30, 31, 30, 31, 30, 31, 30, 31, 30, 31, 30, 31, 30, 31])
  })
})
