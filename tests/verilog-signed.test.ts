/**
 * SIGNED ARITHMETIC — `signed` nets/ports, signed literals (`4'sd3`), and `$signed`/`$unsigned` make the synth
 * two's-complement aware: a narrower value SIGN-extends when widened, comparisons order as signed, `>>>` fills
 * the sign bit, and `* / %` are sign-correct. Per IEEE 1364-2005 §5.5.1 an expression is signed only when ALL
 * its operands are — any unsigned operand makes the whole thing unsigned. Every case is proven by truth table
 * over NEGATIVE values through the real logic engine.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { characterizeBlock } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const num = (b: boolean[]): number => b.reduce((s, x, i) => s + (x ? 1 << i : 0), 0)
/** Two's-complement value of the low `w` bits (JS `>>` already sign-extends within 32 bits). */
const sval = (b: boolean[], w: number): number => {
  const u = num(b.slice(0, w))
  return u >= 1 << (w - 1) ? u - (1 << w) : u
}
/** LSB-first two's-complement bits of a (possibly negative) value at width w. */
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

/** assertBus tolerating the expected "unconnected port omitted" warnings (some input bits legitimately unused). */
const assertBusPartial = (
  verilog: string,
  ins: string[],
  outs: string[],
  fn: (b: boolean[]) => boolean[],
) => {
  const { block, warnings } = importVerilog(verilog)
  const unexpected = warnings.filter((w) => !/is not connected to any gate/.test(w))
  expect(unexpected, `unexpected: ${unexpected.join(' | ')}`).toEqual([])
  const tt = characterizeBlock(block as BlockData)
  expect(tt).not.toBeNull()
  if (tt === null) return
  expect(tt.inputs).toEqual(ins)
  expect(tt.outputs).toEqual(outs)
  for (const row of tt.rows) expect(row.out, `in ${row.in.join(',')}`).toEqual(fn(row.in))
}

describe('signed — extension', () => {
  test('a signed value SIGN-extends when widened (y[7:0] = a signed [3:0])', () => {
    assertBus(
      'module m(a, y); input signed [3:0] a; output [7:0] y; assign y = a; endmodule',
      busIn('a', 4),
      busIn('y', 8),
      (b) => numBits(sval(b, 4), 8),
    )
  })

  test('an UNSIGNED value zero-extends (control: same module without `signed`)', () => {
    assertBus(
      'module m(a, y); input [3:0] a; output [7:0] y; assign y = a; endmodule',
      busIn('a', 4),
      busIn('y', 8),
      (b) => numBits(num(b.slice(0, 4)), 8),
    )
  })

  test('MIXED signedness is UNSIGNED: a(signed) + b(unsigned) zero-extends both', () => {
    assertBus(
      'module m(a, b, y); input signed [3:0] a; input [3:0] b; output [7:0] y; assign y = a + b; endmodule',
      [...busIn('a', 4), ...busIn('b', 4)],
      busIn('y', 8),
      (b) => numBits((num(b.slice(0, 4)) + num(b.slice(4, 8))) & 0xff, 8),
    )
  })
})

describe('signed — operators', () => {
  test('signed comparison a < b (−1 < 2 = 1, 3 < −1 = 0)', () => {
    assertBus(
      'module m(a, b, y); input signed [3:0] a; input signed [3:0] b; output y; assign y = (a < b); endmodule',
      [...busIn('a', 4), ...busIn('b', 4)],
      ['y'],
      (b) => [sval(b.slice(0, 4), 4) < sval(b.slice(4, 8), 4)],
    )
  })

  test('arithmetic right shift >>> sign-fills (−4 >>> 1 = −2)', () => {
    // y = a >>> 1: y[i] = a[i+1], y[3] = a[3] (the sign). a[0] is unused (shifted out).
    assertBusPartial(
      'module m(a, y); input signed [3:0] a; output [3:0] y; assign y = a >>> 1; endmodule',
      ['a[1]', 'a[2]', 'a[3]'],
      busIn('y', 4),
      (b) => [b[0] as boolean, b[1] as boolean, b[2] as boolean, b[2] as boolean],
    )
  })

  test('unary minus −a (−(−1) = 1, −(1) = −1)', () => {
    assertBus(
      'module m(a, y); input signed [3:0] a; output [3:0] y; assign y = -a; endmodule',
      busIn('a', 4),
      busIn('y', 4),
      (b) => numBits(-sval(b, 4), 4),
    )
  })

  test('signed multiply a * b (−1×−1 = 1, −2×−2 = 4, −1×1 = −1)', () => {
    assertBus(
      'module m(a, b, p); input signed [1:0] a; input signed [1:0] b; output [3:0] p; assign p = a * b; endmodule',
      [...busIn('a', 2), ...busIn('b', 2)],
      busIn('p', 4),
      (b) => numBits(sval(b.slice(0, 2), 2) * sval(b.slice(2, 4), 2), 4),
    )
  })

  test('signed divide a / 2 truncates toward zero (−6/2 = −3, −3/2 = −1)', () => {
    assertBus(
      "module m(a, q); input signed [3:0] a; output [3:0] q; assign q = a / 4'sd2; endmodule",
      busIn('a', 4),
      busIn('q', 4),
      (b) => numBits(Math.trunc(sval(b, 4) / 2), 4),
    )
  })
})

describe('signed — $signed / $unsigned casts', () => {
  test('$signed(x) makes an unsigned net sign-extend', () => {
    assertBus(
      'module m(a, y); input [3:0] a; output [7:0] y; assign y = $signed(a); endmodule',
      busIn('a', 4),
      busIn('y', 8),
      (b) => numBits(sval(b, 4), 8),
    )
  })

  test('$unsigned(x) makes a signed net zero-extend', () => {
    assertBus(
      'module m(a, y); input signed [3:0] a; output [7:0] y; assign y = $unsigned(a); endmodule',
      busIn('a', 4),
      busIn('y', 8),
      (b) => numBits(num(b.slice(0, 4)), 8),
    )
  })
})

// Regression guards for the adversarial review of signed arithmetic.
describe('signed — review hardening (context propagation)', () => {
  test('a signed subexpression inside an UNSIGNED expression is treated unsigned: u + (a + b)', () => {
    // The critical fix: because u is unsigned the WHOLE RHS is unsigned, so a and b ZERO-extend even though the
    // inner (a+b) is all-signed. A local recompute would sign-extend and give the wrong (grouping-dependent)
    // value. IEEE-correct: y = (u + a + b) with a,b unsigned.
    assertBus(
      'module m(a, b, u, y); input signed [1:0] a; input signed [1:0] b; input [1:0] u; output [3:0] y;' +
        ' assign y = u + (a + b); endmodule',
      [...busIn('a', 2), ...busIn('b', 2), ...busIn('u', 2)],
      busIn('y', 4),
      (bits) =>
        numBits((num(bits.slice(0, 2)) + num(bits.slice(2, 4)) + num(bits.slice(4, 6))) & 15, 4),
    )
  })

  test('a $signed cast inside an UNSIGNED operator zero-extends: $signed(a) | b', () => {
    // The `|` is unsigned (b unsigned), so $signed(a) is treated unsigned (zero-extended) — the cast only sets
    // the cast operand's self-sign, which does not survive the unsigned `|`.
    assertBus(
      'module m(a, b, y); input [3:0] a; input [3:0] b; output [7:0] y; assign y = $signed(a) | b; endmodule',
      [...busIn('a', 4), ...busIn('b', 4)],
      busIn('y', 8),
      (bits) => numBits(num(bits.slice(0, 4)) | num(bits.slice(4, 8)), 8),
    )
  })

  test('a signed function argument is reported (treated unsigned), not silently faked', () => {
    const { warnings } = importVerilog(
      'module m(a, y); input signed [3:0] a; output [3:0] y;' +
        ' function [3:0] f(input signed [3:0] x); f = x; endfunction assign y = f(a); endmodule',
    )
    expect(warnings.some((w) => /signed/i.test(w))).toBe(true)
  })
})
