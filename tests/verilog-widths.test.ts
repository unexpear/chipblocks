/**
 * EXPRESSION BIT LENGTHS — IEEE 1364-2005 §5.4.1 (rules for expression bit lengths) and §5.5.2 (steps for
 * evaluating an expression), which is one rule with two halves: an operand is EXTENDED into the width the
 * expression is evaluated at, and the result is TRUNCATED back to it. A round that centralised signedness got
 * the extension right and skipped the truncation, so arithmetic that must wrap stopped wrapping — and the
 * everyday compile-time overflow check `(A + B) < A` answered backwards, because 300 reached the comparison
 * instead of the 44 an eight-bit add really produces.
 *
 * The other half of the same rule is the CONTEXT: the width flows DOWN into the width-preserving operators and
 * STOPS at the self-determined walls. `localparam [7:0] Q = ~4'd0` is 255 because the `~` runs at eight bits;
 * `(4'd15 + 4'd1) == 4'd0` is TRUE because the comparison is a wall that sizes the add at four.
 *
 * EVERY expected value in this file is the output of Icarus Verilog 14.0 (oss-cad-suite) on the same source,
 * never what this implementation happens to return. The suite has been fully green over wrong answers three
 * times, so an expectation read out of current behaviour is worth nothing here.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { characterizeBlock } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const said = (warnings: string[]): string => warnings.join(' | ')
const bitOf = (name: string): number => Number(name.match(/\[(\d+)\]$/)?.[1] ?? 0)

/** Read output `y` (width `outWidth`) for every value of the 4-bit input `a`, through the block's REAL gates. */
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

/**
 * Fold `expr` as a `localparam range Q`, then widen it into a 40-bit SIGNED wire and read all forty bits — so
 * the ONE string this returns pins the fold's value, its width and its signedness at once. Read at a = 0,
 * where `y` is exactly the widened `Q`.
 */
function folds(expr: string, range = '', decls = ''): string {
  const src = `module m(input [3:0] a, output [39:0] y);
${decls}  localparam ${range} Q = ${expr};
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

/** A 40-bit expectation written as the low `n` bits, sign- or zero-extended — keeps the rows readable. */
const ext = (low: string, fill: '0' | '1'): string => fill.repeat(40 - low.length) + low

describe('an arithmetic fold TRUNCATES to the width it was evaluated at', () => {
  test('the compile-time overflow check (A + B) < A is TRUE when the add wraps', () => {
    // Icarus: 200 + 100 truncates to eight bits = 44, and 44 < 200 is 1. Carrying 300 into the comparison
    // answers 0 — the opposite of what every engineer writes this idiom to detect.
    expect(folds('(A + B) < A', '', "  parameter A = 8'd200, B = 8'd100;\n")).toBe(ext('1', '0'))
  })

  test('a 4-bit budget check that overflows reads as NOT over', () => {
    // Icarus: 12 + 4 truncates to four bits = 0, and 0 > 15 is 0.
    expect(folds("(BASE + LEN) > 4'd15", '', "  parameter BASE = 4'd12, LEN = 4'd4;\n")).toBe(
      ext('0', '0'),
    )
  })

  test('a multiply that wraps compares against the wrapped value', () => {
    // Icarus: 9 * 2 truncates to four bits = 2, and 2 > 10 is 0.
    expect(folds("(N * 4'd2) > 4'd10", '', "  parameter N = 4'd9;\n")).toBe(ext('0', '0'))
  })

  test('a 3-bit add that wraps compares against the wrapped value', () => {
    // Icarus: 6 + 3 truncates to three bits = 1, and 1 >= 7 is 0.
    expect(folds("(W + 3'd3) >= 3'd7", '', "  parameter W = 3'd6;\n")).toBe(ext('0', '0'))
  })

  test('a comparison is a WALL that sizes the add at its own four bits', () => {
    // Both measured: against a 4-bit right operand the add wraps to 0 and the equality holds; against a 5-bit
    // one the wall is five bits wide, the add does NOT wrap, and 16 == 16 holds as well. Same add, two sizes.
    expect(folds("(4'd15 + 4'd1) == 4'd0")).toBe(ext('1', '0'))
    expect(folds("(4'd15 + 4'd1) == 5'd16")).toBe(ext('1', '0'))
  })

  test('a subtraction that wraps is a value, not a refusal', () => {
    expect(folds("4'd2 - 4'd5")).toBe(ext('11101', '0')) // 29 at five bits
    expect(folds("4'sh8 / 4'shf", 'signed')).toBe(ext('1000', '1')) // −8 at four: −8 / −1 wraps
  })
})

describe('the context width flows DOWN into the width-preserving operators', () => {
  test('a bit-wise NOT runs at the width around it, not at its operand’s', () => {
    // Every one of these was folded at the operand's own width and then widened, which is a different number:
    // `~2'd0` alone is 3, but inside a 4-bit `|` it is 15.
    expect(folds("4'd1 | ~2'd0")).toBe(ext('1111', '0'))
    expect(folds("4'd0 | ~2'd0")).toBe(ext('1111', '0'))
    expect(folds("8'd0 | ~4'd0")).toBe(ext('11111111', '0'))
    expect(folds("(~2'd0) == 4'd15")).toBe(ext('1', '0'))
  })

  test('a unary minus runs at the width around it', () => {
    expect(folds("5'd0 + (-2'd1)")).toBe(ext('111111', '0')) // −1 at SIX bits, not 3 widened
    expect(folds("8'd0 + (-4'd1)")).toBe(ext('111111111', '0')) // −1 at NINE bits
  })

  test('a ternary arm is context-determined, so the add inside it keeps its carry bit', () => {
    expect(folds("1'b0 ? 4'd0 : (4'd15 + 4'd1)")).toBe(ext('10000', '0'))
  })

  test('a narrower SIGNED operand still zero-extends into an unsigned expression', () => {
    // The signedness half of the rule, re-checked here so a width fix cannot quietly undo it.
    expect(folds("8'hff & 4'shf")).toBe(ext('1111', '0'))
    expect(folds("3 + 4'shf")).toBe(ext('10', '0'))
    expect(folds("~4'd0 + 4'sh1")).toBe(ext('0', '0')) // 31 + 1 at five bits, wrapped
  })

  test('a DECLARED RANGE is the context, not an afterthought applied to a narrower fold', () => {
    expect(folds("~4'd0", '[7:0]')).toBe(ext('11111111', '0')) // 255, not 15 widened
    expect(folds("4'd1 | ~2'd0", '[7:0]')).toBe(ext('11111111', '0'))
    expect(folds("4'sh8 / 4'shf", 'signed [7:0]')).toBe(ext('1000', '0')) // +8: no wrap at eight bits
    expect(folds("4'd2 - 4'd5", 'signed [7:0]')).toBe(ext('11111101', '1')) // −3
    expect(folds("4'd15 + 4'd1", '[7:0]')).toBe(ext('10000', '0'))
    expect(folds("8'd200 + 8'd100", '[3:0]')).toBe(ext('1100', '0')) // 300 → 44 at eight → 12 at four
  })
})

describe('a fold that sizes a loop is the fold the loop really runs', () => {
  const times = (n: number): number[] => Array.from({ length: 16 }, (_, a) => (n * a) % 256)

  test('a bound built from ~ counts fifteen times, not three', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output reg [7:0] y);
  localparam LIM = 4'd1 | ~2'd0;
  integer i;
  always @* begin
    y = a & 8'h00;
    for (i = 0; i < LIM; i = i + 1) y = y + a;
  end
endmodule`,
        8,
      ),
    ).toEqual(times(15))
  })

  test('a repeat count built from ~ repeats fifteen times, not three', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output reg [7:0] y);
  localparam CNT = 4'd0 | ~2'd0;
  always @* begin
    y = a & 8'h00;
    repeat (CNT) y = y + a;
  end
endmodule`,
        8,
      ),
    ).toEqual(times(15))
  })

  test('the same fold through an instance parameter override counts 255 times, not fifteen', () => {
    expect(
      sweep(
        `module cnt(input [3:0] a, output reg [7:0] y);
  parameter N = 4'd1;
  integer i;
  always @* begin
    y = a & 8'h00;
    for (i = 0; i < N; i = i + 1) y = y + a;
  end
endmodule
module m(input [3:0] a, output [7:0] y);
  cnt #(.N(8'd0 | ~4'd0)) u (a, y);
endmodule`,
        8,
      ),
    ).toEqual(times(255))
  })

  test('a NEGATIVE parameter bound still counts down through zero', () => {
    // The signedness fix this width work must not undo: `parameter N = -1` is a signed −1, so `i >= N` is a
    // signed comparison that runs at i = 0 and i = −1. Icarus: y = 2a.
    expect(
      sweep(
        `module m(input [3:0] a, output reg [7:0] y);
  parameter N = -1;
  integer i;
  always @* begin
    y = a & 8'h00;
    for (i = 0; i >= N; i = i - 1) y = y + a;
  end
endmodule`,
        8,
      ),
    ).toEqual(times(2))
  })
})

/**
 * THE SHIFT WALL. `<< >> **` take their width from the LEFT operand (§5.4.1 Table 5-22), and that operand is
 * SELF-DETERMINED — the lossless growth an unranged `parameter`/`localparam` gets does not cross into it, so
 * the sub-expression wraps at its own width BEFORE the shift runs. The shift-by-ZERO rows are the proof that
 * this is a real wall and not a rounding accident: `(8'd200 + 8'd100) >> 0` is 44, because the add truncates
 * to eight bits inside the shift's left operand and only then does the shift do nothing at all.
 */
describe('the grown elaboration width STOPS at a shift, and the sub-expression truncates', () => {
  test('the midpoint idiom halves the WRAPPED sum, not the true sum', () => {
    expect(folds('(LO + HI) >> 1', '', "  parameter LO = 8'd100, HI = 8'd200;\n")).toBe(
      ext('10110', '0'), // 22
    )
  })

  test('a shift by ZERO still truncates the add inside it', () => {
    expect(folds("(8'd200 + 8'd100) >> 0")).toBe(ext('101100', '0')) // 44
    expect(folds("(4'd15 + 4'd1) >> 0")).toBe(ext('0', '0')) // 0
  })

  test('an 8-bit add that wraps is shifted at eight bits', () => {
    expect(folds("(8'd200 + 8'd100) >> 2")).toBe(ext('1011', '0')) // 11
    expect(folds("(8'd200 + 8'd100) >> 5")).toBe(ext('1', '0')) // 1
  })

  test('a 4-bit add that wraps to zero shifts to zero', () => {
    expect(folds("(4'd15 + 4'd1) >> 1")).toBe(ext('0', '0')) // 0
  })

  test('a MULTIPLY inside a shift wraps at max(operands), not at the sum of their widths', () => {
    // The `*` grows to eight bits only at the OUTERMOST context; behind the wall it is the plain §5.4.1
    // max(4,4). Icarus: 9*2 = 18 wraps to 2, then 2 >> 1 = 1; 5*4 = 20 wraps to 4, then 4 >> 1 = 2.
    expect(folds("(4'd9 * 4'd2) >> 1")).toBe(ext('1', '0'))
    expect(folds("(4'd5 * 4'd4) >> 1")).toBe(ext('10', '0'))
  })

  test('a LEFT shift wraps its truncated operand too', () => {
    expect(folds("(4'd3 + 4'd1) << 2")).toBe(ext('0', '0')) // 4 << 2 = 16, wraps to 0 at four bits
    expect(folds("8'd200 << 1")).toBe(ext('10010000', '0')) // 144
  })

  test('an unsigned underflow inside a shift is shifted as the wrapped pattern', () => {
    expect(folds("(8'd0 - 8'd1) >> 1")).toBe(ext('1111111', '0')) // 255 >> 1 = 127
  })

  test('a chain of parameter adds wraps at eight bits before the shift', () => {
    expect(folds('(A + B + C) >> 2', '', "  parameter A = 8'd200, B = 8'd100, C = 8'd60;\n")).toBe(
      ext('11010', '0'), // 26
    )
  })

  test('a scaled parameter wraps before the shift', () => {
    expect(folds("(SIZE * 8'd3) >> 1", '', "  parameter SIZE = 8'd100;\n")).toBe(
      ext('10110', '0'), // 22
    )
  })

  test('a parameter subtraction that underflows shifts the wrapped pattern', () => {
    expect(folds('(TOTAL - USED) >> 1', '', "  parameter TOTAL = 8'd10, USED = 8'd20;\n")).toBe(
      ext('1111011', '0'), // 123
    )
  })

  test('the same wall at a bigger shift distance', () => {
    expect(folds('(LO + HI) >> 4', '', "  parameter LO = 8'd100, HI = 8'd200;\n")).toBe(
      ext('10', '0'), // 2
    )
  })

  test('a SIGNED left operand keeps its sign through the wall', () => {
    expect(folds("(4'shf + 4'sd0) >> 0")).toBe(ext('', '1')) // −1 at four bits, sign-extended
  })
})

/**
 * The wall lives in the GROWTH, never in the fold. A width that comes from OUTSIDE — a declared range, an
 * enclosing add, a comparison, a ternary arm — is context-determined and still crosses into a shift's left
 * operand, exactly as §5.4.1 says. These two are different things and only the first one changed; a "fix" that
 * walls off `foldAt` as well answers `localparam [15:0] Q = (4'd15 + 4'd1) >> 0` as 0 where Icarus says 16.
 */
describe('a width pushed in from OUTSIDE still crosses into a shift', () => {
  test('a declared range on the parameter is the context the add runs at', () => {
    expect(folds("(4'd15 + 4'd1) >> 0", '[15:0]')).toBe(ext('10000', '0')) // 16
    expect(folds("(8'd200 + 8'd100) >> 0", '[15:0]')).toBe(ext('100101100', '0')) // 300
  })

  test('an enclosing add supplies the context, so the shift sees the grown width', () => {
    expect(folds("((8'd200 + 8'd100) >> 0) + 8'd1")).toBe(ext('100101101', '0')) // 301, at nine bits
    expect(folds("((4'd15 + 4'd1) >> 0) + 4'd1")).toBe(ext('10001', '0')) // 17, at five bits
  })

  test('a comparison sizes the shift against the OTHER operand', () => {
    expect(folds("((8'd200 + 8'd100) >> 0) < 9'd100")).toBe(ext('0', '0')) // 300 < 100 is 0
  })

  test('a ternary arm carries its own width into the shift', () => {
    expect(folds("1'b1 ? ((8'd200 + 8'd100) >> 0) : 16'd0")).toBe(ext('100101100', '0')) // 300
  })

  test('a multiply above the shift grows the product from the WALLED operand', () => {
    expect(folds("((4'd15 + 4'd1) >> 0) * 4'd3")).toBe(ext('110000', '0')) // 16 * 3 = 48
  })

  test('a unary NOT above the shift runs at the walled width', () => {
    expect(folds("~((4'd15 + 4'd1) >> 0)")).toBe(ext('1111', '0')) // 15
  })

  test('a nested shift walls each left operand in turn', () => {
    expect(folds("(((4'd15 + 4'd1) >> 0) + 4'd1) >> 0")).toBe(ext('1', '0')) // 1
  })

  test('the shift AMOUNT stays self-determined on both sides of the wall', () => {
    expect(folds("8'd255 >> (4'd15 + 4'd1)")).toBe(ext('11111111', '0')) // amount wraps to 0
  })
})

/**
 * `**` is the one operator whose grown width this evaluator will not guess. Measured against Icarus Verilog
 * 14.0: with a plain literal or parameter base the result keeps the base's own width (`4'd5 ** 2` is 9 at four
 * bits, `4'd3 ** 4'd3` is 11 at four — both wrapped), but with a COMPOUND base it instead grows to
 * selfWidth(base) × exponent (`(4'd3 + 4'd1) ** 2` is 16 at EIGHT bits, `(4'd15 + 4'd2) ** 3` is 817 at
 * TWELVE). Nothing in §5.4.1 makes the shape of the base decide a width, and Icarus asserts and aborts outright
 * on `(4'd15 + 4'd1) ** 0` — so there is no rule to prove and no oracle for the edge, and an unranged parameter
 * whose value is a compound-base power is reported by name instead of built.
 */
describe('a power whose width cannot be proved is refused, never guessed', () => {
  const refuses = (expr: string): string => {
    const { block, warnings } = importVerilog(`module m(input [3:0] a, output [7:0] y);
  localparam Q = ${expr};
  assign y = Q + {4'd0, a};
endmodule`)
    expect(block, `${expr} must NOT build`).toBeNull()
    return said(warnings)
  }

  test('a compound-base power with no declared range is reported by name', () => {
    expect(refuses("(4'd15 + 4'd1) ** 1")).toContain('not a constant expression')
    expect(refuses("(4'd3 + 4'd1) ** 2")).toContain('not a constant expression')
  })

  test('a declared range SETTLES the width, so the same power builds', () => {
    expect(folds("(4'd15 + 4'd1) ** 2", '[15:0]')).toBe(ext('100000000', '0')) // 256
  })

  test('the everyday depth / mask / shift idioms still build', () => {
    expect(folds('2 ** AW', '', '  parameter AW = 4;\n')).toBe(ext('10000', '0')) // 16
    expect(folds('2 ** AW - 1', '', '  parameter AW = 5;\n')).toBe(ext('11111', '0')) // 31
    expect(folds('1 << AW', '', '  parameter AW = 6;\n')).toBe(ext('1000000', '0')) // 64
  })
})

/**
 * The walled width has to reach the HARDWARE, not just the number a fold reports. A replication count of 9
 * where Icarus says 1 builds eight extra wires; a case label of 18 where Icarus says 2 makes a reachable branch
 * unreachable; a `[WD:0]` of 9 builds a ten-bit bus. Each row below is Icarus Verilog 14.0's own output for
 * a = 0…15 on the same source.
 */
describe('the walled width builds the real hardware', () => {
  test('a replication REPLICATES the walled count — one bit, not nine', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
  localparam RC = (8'd200 + 8'd100) >> 5;
  wire [7:0] r;
  assign r = {RC{1'b1}};
  assign y = r | {4'd0, a};
endmodule`,
        8,
      ),
    ).toEqual([1, 1, 3, 3, 5, 5, 7, 7, 9, 9, 11, 11, 13, 13, 15, 15])
  })

  test('a case label built from a shift matches at the walled value', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output reg [7:0] y);
  localparam MIDL = (8'd200 + 8'd100) >> 5;
  always @* begin
    case ({4'd0, a})
      MIDL: y = 8'd77;
      default: y = 8'd99;
    endcase
  end
endmodule`,
        8,
      ),
    ).toEqual([99, 77, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99])
  })

  test('a bus declared [WD:0] from a shift is TWO bits wide, not ten', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
  localparam WD = (8'd200 + 8'd100) >> 5;
  wire [WD:0] bus;
  assign bus = {8{1'b1}};
  assign y = bus + {4'd0, a};
endmodule`,
        8,
      ),
    ).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
  })

  test('an INLINE loop bound is sized by the comparison against a 32-bit integer', () => {
    // Not the wall: here the counter is the other operand, and `i < …` sizes the shift's left operand at the
    // integer's 32 bits, so the add does NOT wrap. Icarus runs this nine times, and so must we.
    expect(
      sweep(
        `module m(input [3:0] a, output reg [7:0] y);
  integer i;
  always @* begin
    y = a & 8'h00;
    for (i = 0; i < ((8'd200 + 8'd100) >> 5); i = i + 1) y = y + a;
  end
endmodule`,
        8,
      ),
    ).toEqual(Array.from({ length: 16 }, (_, a) => (9 * a) % 256))
  })

  test('the SAME inline bound against an 8-bit counter runs ONCE', () => {
    // The same source, one declaration different: at eight bits the comparison wraps the add to 44 and 44 >> 5
    // is 1. Two loop counts from one expression — which is why the counter's declared width is load-bearing.
    expect(
      sweep(
        `module m(input [3:0] a, output reg [7:0] y);
  reg [7:0] i;
  always @* begin
    y = a & 8'h00;
    for (i = 0; i < ((8'd200 + 8'd100) >> 5); i = i + 1) y = y + a;
  end
endmodule`,
        8,
      ),
    ).toEqual(Array.from({ length: 16 }, (_, a) => a))
  })

  test('a walled limit decides a comparison against a real signal', () => {
    // `(4'd3 + 4'd1) << 2` is 0, so `a < LIMIT` is false for every a. Read at nine bits it would be 16 and the
    // branch would flip for every input — the same design, two behaviours, no warning.
    expect(
      sweep(
        `module m(input [3:0] a, output [7:0] y);
  localparam LIMIT = (4'd3 + 4'd1) << 2;
  assign y = ({4'd0, a} < LIMIT) ? 8'hAA : 8'h55;
endmodule`,
        8,
      ),
    ).toEqual(new Array(16).fill(0x55))
  })

  test('the wall holds through an INSTANCE PARAMETER OVERRIDE', () => {
    expect(
      sweep(
        `module addk #(parameter K = 0) (input [3:0] i, output [7:0] o);
  assign o = {4'd0, i} + K;
endmodule
module m(input [3:0] a, output [7:0] y);
  addk #(.K((4'd12 + 4'd12) >> 1)) u(a, y);
endmodule`,
        8,
      ),
    ).toEqual(Array.from({ length: 16 }, (_, a) => a + 4))
  })
})
