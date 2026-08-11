/**
 * RTL synthesis (increment 2a) — `assign y = <expr>;` must build REAL gates that compute the right boolean
 * function (proven by truth table from the logic engine, not by counting gates), with correct Verilog
 * operator precedence, constant folding, and honest reporting of everything outside the scalar subset.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { characterizeBlock } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

/** Import a module and assert its single output = fn(inputs), driven through the real logic engine. */
function assertFn(verilog: string, inNames: string[], fn: (b: boolean[]) => boolean): void {
  const { block, warnings } = importVerilog(verilog)
  expect(warnings, `warnings: ${warnings.join(' | ')}`).toEqual([])
  expect(block).not.toBeNull()
  const tt = characterizeBlock(block as BlockData)
  expect(tt, 'should characterize as combinational').not.toBeNull()
  if (tt === null) return
  expect(tt.inputs).toEqual(inNames)
  expect(tt.outputs.length).toBe(1)
  for (const row of tt.rows) expect(row.out[0], `in ${row.in.join(',')}`).toBe(fn(row.in))
}
const mod = (ins: string, body: string): string =>
  `module m(${ins}, y); input ${ins}; output y; ${body} endmodule`

// bus test helpers (shared by the 2b blocks)
const num = (b: boolean[]): number => b.reduce((s, x, i) => s + (x ? 1 << i : 0), 0)
const numBits = (v: number, w: number): boolean[] =>
  Array.from({ length: w }, (_, i) => ((v >> i) & 1) === 1)
/** Import a bus module and check its outputs against `fn` over the enumerated input bits. */
const assertBus = (
  verilog: string,
  ins: string[],
  outs: string[],
  fn: (b: boolean[]) => boolean[],
) => {
  const { block, warnings } = importVerilog(verilog)
  expect(warnings, `warnings: ${warnings.join(' | ')}`).toEqual([])
  const tt = characterizeBlock(block as BlockData)
  expect(tt).not.toBeNull()
  if (tt === null) return
  expect(tt.inputs).toEqual(ins)
  expect(tt.outputs).toEqual(outs)
  for (const row of tt.rows) expect(row.out, `in ${row.in.join(',')}`).toEqual(fn(row.in))
}

describe('RTL synthesis — boolean operators build the right gates', () => {
  test('the basic gates: & | ^ ~^ ~', () => {
    assertFn(
      mod('a, b', 'assign y = a & b;'),
      ['a', 'b'],
      ([a, b]) => (a as boolean) && (b as boolean),
    )
    assertFn(
      mod('a, b', 'assign y = a | b;'),
      ['a', 'b'],
      ([a, b]) => (a as boolean) || (b as boolean),
    )
    assertFn(
      mod('a, b', 'assign y = a ^ b;'),
      ['a', 'b'],
      ([a, b]) => (a as boolean) !== (b as boolean),
    )
    assertFn(
      mod('a, b', 'assign y = a ~^ b;'),
      ['a', 'b'],
      ([a, b]) => (a as boolean) === (b as boolean),
    )
    assertFn(mod('a', 'assign y = ~a;'), ['a'], ([a]) => !(a as boolean))
  })

  test('a compound expression: y = (a & b) | ~c', () => {
    assertFn(
      mod('a, b, c', 'assign y = (a & b) | ~c;'),
      ['a', 'b', 'c'],
      ([a, b, c]) => ((a as boolean) && (b as boolean)) || !(c as boolean),
    )
  })

  test('logical && || ! collapse to the boolean gates on scalars', () => {
    assertFn(
      mod('a, b', 'assign y = a && b;'),
      ['a', 'b'],
      ([a, b]) => (a as boolean) && (b as boolean),
    )
    assertFn(
      mod('a, b', 'assign y = a || b;'),
      ['a', 'b'],
      ([a, b]) => (a as boolean) || (b as boolean),
    )
    assertFn(mod('a', 'assign y = !a;'), ['a'], ([a]) => !(a as boolean))
  })

  test('equality == becomes XNOR, != becomes XOR', () => {
    assertFn(
      mod('a, b', 'assign y = a == b;'),
      ['a', 'b'],
      ([a, b]) => (a as boolean) === (b as boolean),
    )
    assertFn(
      mod('a, b', 'assign y = a != b;'),
      ['a', 'b'],
      ([a, b]) => (a as boolean) !== (b as boolean),
    )
  })

  test('the ternary ?: becomes a real 2:1 mux', () => {
    assertFn(mod('a, b, s', 'assign y = s ? a : b;'), ['a', 'b', 's'], ([a, b, s]) =>
      (s as boolean) ? (a as boolean) : (b as boolean),
    )
  })
})

describe('RTL synthesis — Verilog operator precedence', () => {
  test('& binds tighter than |: a | b & c = a | (b & c)', () => {
    assertFn(
      mod('a, b, c', 'assign y = a | b & c;'),
      ['a', 'b', 'c'],
      ([a, b, c]) => (a as boolean) || ((b as boolean) && (c as boolean)),
    )
  })

  test('== binds tighter than & (the C gotcha): a & b == c = a & (b == c)', () => {
    assertFn(
      mod('a, b, c', 'assign y = a & b == c;'),
      ['a', 'b', 'c'],
      ([a, b, c]) => (a as boolean) && (b as boolean) === (c as boolean),
    )
  })

  test('^ binds tighter than |, & tighter than ^: a | b ^ c & d', () => {
    assertFn(
      mod('a, b, c, d', 'assign y = a | b ^ c & d;'),
      ['a', 'b', 'c', 'd'],
      ([a, b, c, d]) => (a as boolean) || (b as boolean) !== ((c as boolean) && (d as boolean)),
    )
  })

  test('?: is right-associative and loosest: a ? b : c ? d : e', () => {
    assertFn(
      mod('a, b, c, d, e', 'assign y = a ? b : c ? d : e;'),
      ['a', 'b', 'c', 'd', 'e'],
      ([a, b, c, d, e]) =>
        (a as boolean) ? (b as boolean) : (c as boolean) ? (d as boolean) : (e as boolean),
    )
  })
})

describe('RTL synthesis — constant folding', () => {
  test('identities fold away: a & 1, a | 0, a ^ 0, a ^ 1', () => {
    assertFn(mod('a', "assign y = a & 1'b1;"), ['a'], ([a]) => a as boolean)
    assertFn(mod('a', "assign y = a | 1'b0;"), ['a'], ([a]) => a as boolean)
    assertFn(mod('a', "assign y = a ^ 1'b0;"), ['a'], ([a]) => a as boolean)
    assertFn(mod('a', "assign y = a ^ 1'b1;"), ['a'], ([a]) => !(a as boolean))
  })

  test('a mux with a constant select folds to the chosen arm (the dead branch drops out)', () => {
    // 1'b1 ? a : b → a; b is genuinely dead, so it's dropped from the interface (honest, not faked)
    const t1 = characterizeBlock(
      importVerilog(mod('a, b', "assign y = 1'b1 ? a : b;")).block as BlockData,
    )
    expect(t1?.inputs).toEqual(['a'])
    for (const row of t1?.rows ?? []) expect(row.out[0]).toBe(row.in[0])
    const t0 = characterizeBlock(
      importVerilog(mod('a, b', "assign y = 1'b0 ? a : b;")).block as BlockData,
    )
    expect(t0?.inputs).toEqual(['b'])
    for (const row of t0?.rows ?? []) expect(row.out[0]).toBe(row.in[0])
  })
})

describe('RTL synthesis — mixing with structural gates + multiple assigns', () => {
  test('a structural gate and an assign coexist in one module', () => {
    const v =
      'module m(a, b, c, y); input a, b, c; output y; wire w; and g(w, a, b); assign y = w | c; endmodule'
    assertFn(
      v,
      ['a', 'b', 'c'],
      ([a, b, c]) => ((a as boolean) && (b as boolean)) || (c as boolean),
    )
  })

  test('two outputs from two assigns (comma-separated in one statement)', () => {
    const v =
      'module m(a, b, p, q); input a, b; output p, q; assign p = a & b, q = a | b; endmodule'
    const { block, warnings } = importVerilog(v)
    expect(warnings).toEqual([])
    const tt = characterizeBlock(block as BlockData)
    expect(tt?.inputs).toEqual(['a', 'b'])
    expect(tt?.outputs).toEqual(['p', 'q'])
    for (const row of tt?.rows ?? []) {
      const [a, b] = row.in
      expect(row.out).toEqual([(a as boolean) && (b as boolean), (a as boolean) || (b as boolean)])
    }
  })
})

describe('RTL synthesis — honesty (unsupported → reported, never faked)', () => {
  const reported = (verilog: string, needle: string) => {
    const { warnings } = importVerilog(verilog)
    expect(
      warnings.some((w) => w.toLowerCase().includes(needle)),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
  }

  test('the still-unsupported operator (**) is reported', () => {
    // + - * / % << >> < <= > >= ARE supported now (see the arithmetic + divide + shift/compare tests);
    // ** (power) is not.
    reported(mod('a, b', 'assign y = a ** b;'), 'not supported')
  })

  test('driving an input and double-driving are reported', () => {
    reported('module m(a, b); input a; output b; assign a = b; endmodule', 'input port')
    reported(
      'module m(a, y); input a; output y; assign y = a; assign y = ~a; endmodule',
      'more than once',
    )
  })

  test('a combinational loop is reported, not built', () => {
    reported('module m(a, y); input a; output y; assign y = y & a; endmodule', 'combinational loop')
  })
})

describe('RTL synthesis — regressions from the adversarial review', () => {
  const reported = (verilog: string, needle: string) => {
    const { warnings } = importVerilog(verilog)
    expect(
      warnings.some((w) => w.toLowerCase().includes(needle)),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
  }

  test('a user net named "syn0" is NOT clobbered by the synthesizer\'s fresh names', () => {
    // fresh() must dodge existing names, or (a & b) | syn0 silently becomes a & b
    assertFn(
      'module m(a, b, syn0, y); input a, b, syn0; output y; assign y = (a & b) | syn0; endmodule',
      ['a', 'b', 'syn0'],
      ([a, b, s]) => ((a as boolean) && (b as boolean)) || (s as boolean),
    )
  })

  test('a folded-away dead branch that names the LHS is NOT a false combinational loop', () => {
    // 1'b1 ? a : y folds to y = a — the dead ": y" arm must not create a phantom self-loop
    assertFn(
      "module m(a, y); input a; output y; assign y = 1'b1 ? a : y; endmodule",
      ['a'],
      ([a]) => a as boolean,
    )
    assertFn(
      "module m(a, y); input a; output y; assign y = (y & 1'b0) | a; endmodule",
      ['a'],
      ([a]) => a as boolean,
    )
  })

  test("a constant-select ternary does not leak the dead arm's gates as phantom input ports", () => {
    // 1'b1 ? a : (b & c) → a; b and c must NOT appear as inputs
    const tt = characterizeBlock(
      importVerilog(
        "module m(a, b, c, y); input a, b, c; output y; assign y = 1'b1 ? a : b & c; endmodule",
      ).block as BlockData,
    )
    expect(tt?.inputs).toEqual(['a'])
    for (const row of tt?.rows ?? []) expect(row.out[0]).toBe(row.in[0])
  })

  test('an assign double-driving a net a STRUCTURAL gate already drives is reported', () => {
    reported(
      'module m(a, b, c, y); input a, b, c; output y; and g(y, a, b); assign y = c; endmodule',
      'more than once',
    )
  })

  test('a combinational loop that closes through a structural gate is reported', () => {
    reported(
      'module m(a, y); input a; output y; wire w; assign y = w; and g(w, y, a); endmodule',
      'combinational loop',
    )
  })

  test('a feed-forward assign that only READS a looped net is not itself flagged as a loop', () => {
    // p = y & a reads the self-looped y, but p is not on a cycle — exactly ONE net is cut, and it is y.
    // (The design as a whole is then refused, because p READS the cut net and so has no honest value
    // either; that refusal names the loop too, so the count here is of the per-net cut, not of the word.)
    const { warnings } = importVerilog(
      'module m(a, y, p); input a; output y, p; assign p = y & a; assign y = y & a; endmodule',
    )
    const loops = warnings.filter((w) => w.includes('feeds back on itself'))
    expect(loops.length, `warnings: ${warnings.join(' | ')}`).toBe(1)
    expect(loops[0]).toContain('"y"')
  })

  test("a 1-bit sized literal whose value exceeds 1 (1'd3) truncates to its LSB", () => {
    // 1'd3 == 1'b1, so a & 1'd3 = a
    assertFn(mod('a', "assign y = a & 1'd3;"), ['a'], ([a]) => a as boolean)
  })
})

describe('RTL synthesis — buses + arithmetic (increment 2b)', () => {
  test('bitwise AND on 2-bit buses is per-bit', () => {
    assertBus(
      'module m(a, b, y); input [1:0] a, b; output [1:0] y; assign y = a & b; endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]'],
      ['y[0]', 'y[1]'],
      (i) => [(i[0] as boolean) && (i[2] as boolean), (i[1] as boolean) && (i[3] as boolean)],
    )
  })

  test('a ripple-carry ADDER: assign s = a + b (3-bit result captures the carry)', () => {
    assertBus(
      'module m(a, b, s); input [1:0] a, b; output [2:0] s; assign s = a + b; endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]'],
      ['s[0]', 's[1]', 's[2]'],
      (i) =>
        numBits(
          num([i[0] as boolean, i[1] as boolean]) + num([i[2] as boolean, i[3] as boolean]),
          3,
        ),
    )
  })

  test('the {cout, sum} = a + b idiom captures the carry in a concat target', () => {
    assertBus(
      'module m(a, b, cout, sum); input [1:0] a, b; output cout; output [1:0] sum; assign {cout, sum} = a + b; endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]'],
      ['cout', 'sum[0]', 'sum[1]'],
      (i) => {
        const s = num([i[0] as boolean, i[1] as boolean]) + num([i[2] as boolean, i[3] as boolean])
        const b3 = numBits(s, 3)
        return [b3[2] as boolean, b3[0] as boolean, b3[1] as boolean]
      },
    )
  })

  test('SUBTRACTION: assign d = a - b (mod 4, two’s complement)', () => {
    assertBus(
      'module m(a, b, d); input [1:0] a, b; output [1:0] d; assign d = a - b; endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]'],
      ['d[0]', 'd[1]'],
      (i) =>
        numBits(
          (num([i[0] as boolean, i[1] as boolean]) - num([i[2] as boolean, i[3] as boolean]) + 4) %
            4,
          2,
        ),
    )
  })

  test('reduction operators: parity ^a, all-ones &a, any |a', () => {
    assertBus(
      'module m(a, p); input [2:0] a; output p; assign p = ^a; endmodule',
      ['a[0]', 'a[1]', 'a[2]'],
      ['p'],
      (i) => [i.filter(Boolean).length % 2 === 1],
    )
    assertBus(
      'module m(a, z); input [2:0] a; output z; assign z = &a; endmodule',
      ['a[0]', 'a[1]', 'a[2]'],
      ['z'],
      (i) => [i.every(Boolean)],
    )
    assertBus(
      'module m(a, z); input [2:0] a; output z; assign z = |a; endmodule',
      ['a[0]', 'a[1]', 'a[2]'],
      ['z'],
      (i) => [i.some(Boolean)],
    )
  })

  test('part-select a[2:1] and bit-select a[2] (unused bus bits drop out honestly)', () => {
    // a[2:1] reads only bits 1,2 of the 4-bit a; the unused a0,a3 drop from the interface
    const t = characterizeBlock(
      importVerilog('module m(a, y); input [3:0] a; output [1:0] y; assign y = a[2:1]; endmodule')
        .block as BlockData,
    )
    expect(t?.inputs).toEqual(['a[1]', 'a[2]'])
    for (const row of t?.rows ?? []) expect(row.out).toEqual([row.in[0], row.in[1]]) // y0=a1, y1=a2
    const t2 = characterizeBlock(
      importVerilog('module m(a, y); input [3:0] a; output y; assign y = a[2]; endmodule')
        .block as BlockData,
    )
    expect(t2?.inputs).toEqual(['a[2]'])
    for (const row of t2?.rows ?? []) expect(row.out).toEqual([row.in[0]])
  })

  test('concatenation {a, b} puts a in the high bit', () => {
    assertBus(
      'module m(a, b, y); input a, b; output [1:0] y; assign y = {a, b}; endmodule',
      ['a', 'b'],
      ['y[0]', 'y[1]'],
      (i) => [i[1] as boolean, i[0] as boolean],
    )
  })

  test('zero-extension via a constant: y = {2’b0, a} ties the high bits low', () => {
    assertBus(
      "module m(a, y); input [1:0] a; output [3:0] y; assign y = {2'b0, a}; endmodule",
      ['a[0]', 'a[1]'],
      ['y[0]', 'y[1]', 'y[2]', 'y[3]'],
      (i) => [i[0] as boolean, i[1] as boolean, false, false],
    )
  })

  test('equality on buses: assign eq = (a == b)', () => {
    assertBus(
      'module m(a, b, eq); input [1:0] a, b; output eq; assign eq = (a == b); endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]'],
      ['eq'],
      (i) => [i[0] === i[2] && i[1] === i[3]],
    )
  })

  test('a per-bit bus mux: assign y = s ? a : b', () => {
    assertBus(
      'module m(a, b, s, y); input [1:0] a, b; input s; output [1:0] y; assign y = s ? a : b; endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]', 's'],
      ['y[0]', 'y[1]'],
      (i) => (i[4] ? [i[0] as boolean, i[1] as boolean] : [i[2] as boolean, i[3] as boolean]),
    )
  })

  test('a nonzero-based / ascending bus range is reported, not faked', () => {
    const { warnings } = importVerilog(
      'module m(a, y); input [7:4] a; output y; assign y = a[4]; endmodule',
    )
    expect(warnings.some((w) => w.toLowerCase().includes('range'))).toBe(true)
  })
})

describe('RTL synthesis — 2b regressions from the adversarial review', () => {
  test('cross-coupled bit-shuffle buses are ACYCLIC and build (not a false loop)', () => {
    // p = {q[0], a}; q = {p[0], b}  →  p0=a, p1=q0=b, q0=b, q1=p0=a. No feedback.
    assertBus(
      'module m(a, b, p, q); input a, b; output [1:0] p, q; assign p = {q[0], a}; assign q = {p[0], b}; endmodule',
      ['a', 'b'],
      ['p[0]', 'p[1]', 'q[0]', 'q[1]'],
      (i) => [i[0] as boolean, i[1] as boolean, i[1] as boolean, i[0] as boolean],
    )
  })

  test('a single-bus bit-shuffle y = {y[0], a} is not a false self-loop', () => {
    // y0 = a, y1 = y0 — a feed-forward shuffle, not feedback
    const tt = characterizeBlock(
      importVerilog('module m(a, y); input a; output [1:0] y; assign y = {y[0], a}; endmodule')
        .block as BlockData,
    )
    expect(tt).not.toBeNull()
    for (const row of tt?.rows ?? []) expect(row.out).toEqual([row.in[0], row.in[0]]) // y0=a, y1=y0=a
  })

  test('a user net named "syn0" (an internal wire) is not clobbered by fresh names', () => {
    assertBus(
      'module m(a, b, y); input a, b; output y; wire syn0; assign syn0 = a & b; assign y = syn0 | a; endmodule',
      ['a', 'b'],
      ['y'],
      (i) => [i[0] as boolean],
    ) // (a&b)|a = a
  })

  test('a bus bit a[1] and a distinct scalar net a1 stay separate (no name merge)', () => {
    // a[1] (bus bit) and a1 (scalar) are DISTINCT signals — they must appear as two separate inputs, not
    // merge into one net. (a[0] is unused → dropped.)
    const tt = characterizeBlock(
      importVerilog(
        'module m(a, a1, y); input [1:0] a; input a1; output y; assign y = a[1] ^ a1; endmodule',
      ).block as BlockData,
    )
    expect(tt?.inputs).toEqual(['a[1]', 'a1']) // TWO independent inputs (not merged to one)
    for (const row of tt?.rows ?? []) expect(row.out).toEqual([row.in[0] !== row.in[1]]) // a[1] XOR a1
  })

  test('a constant tie shared with a dropped (looped) assign still drives the surviving assign', () => {
    // the y assign self-loops on y[0] and is dropped, but z = 1'b1 (which reuses the tie-1) must still be 1
    const { block } = importVerilog(
      "module m(a, y, z); input a; output [1:0] y; output z; assign y = {1'b1, y[0]}; assign z = 1'b1; endmodule",
    )
    const tt = characterizeBlock(block as BlockData)
    expect(tt).not.toBeNull()
    if (tt === null) return
    const zi = tt.outputs.indexOf('z')
    expect(zi).toBeGreaterThanOrEqual(0)
    for (const row of tt.rows) expect(row.out[zi]).toBe(true) // z = 1'b1 for all a
  })

  test('an out-of-range constant select reads x — reported, not silently 0', () => {
    const { warnings } = importVerilog(
      'module m(a, y); input [3:0] a; output y; assign y = a[5]; endmodule',
    )
    expect(warnings.some((w) => w.toLowerCase().includes('out of range'))).toBe(true)
  })
})

describe('RTL synthesis — shifts + comparisons (increment 6a)', () => {
  test('left shift by a constant, captured in a wider result (widening is not truncated)', () => {
    // a << 2 with a 2-bit → the shifted bits must land at positions 2..3, not be truncated to a's width first
    assertBus(
      'module m(a, y); input [1:0] a; output [3:0] y; assign y = a << 2; endmodule',
      ['a[0]', 'a[1]'],
      ['y[0]', 'y[1]', 'y[2]', 'y[3]'],
      (i) => numBits(num([i[0] as boolean, i[1] as boolean]) << 2, 4),
    )
  })

  test('right shift by a constant zero-fills the top', () => {
    assertBus(
      'module m(a, y); input [2:0] a; output [2:0] y; assign y = a >> 1; endmodule',
      ['a[0]', 'a[1]', 'a[2]'],
      ['y[0]', 'y[1]', 'y[2]'],
      (i) => numBits(num([i[0] as boolean, i[1] as boolean, i[2] as boolean]) >> 1, 3),
    )
  })

  test('a VARIABLE left shift builds a barrel shifter: y = a << b', () => {
    assertBus(
      'module m(a, b, y); input [1:0] a; input [1:0] b; output [4:0] y; assign y = a << b; endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]'],
      ['y[0]', 'y[1]', 'y[2]', 'y[3]', 'y[4]'],
      (i) => {
        const a = num([i[0] as boolean, i[1] as boolean])
        const b = num([i[2] as boolean, i[3] as boolean])
        return numBits((a << b) & 0x1f, 5)
      },
    )
  })

  test('a variable shift by ≥ the width falls off the end to 0 (barrel high-bit zeroing)', () => {
    // y is only 2 bits, so any b ≥ 2 must yield 0 — the barrel stage for b[1] (shift by 2) must zero it
    assertBus(
      'module m(a, b, y); input [1:0] a; input [1:0] b; output [1:0] y; assign y = a << b; endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]'],
      ['y[0]', 'y[1]'],
      (i) => {
        const a = num([i[0] as boolean, i[1] as boolean])
        const b = num([i[2] as boolean, i[3] as boolean])
        return numBits((a << b) & 0x3, 2)
      },
    )
  })

  test('unsigned magnitude comparisons: < <= > >=', () => {
    const cmp = (op: string, f: (a: number, b: number) => boolean) =>
      assertBus(
        `module m(a, b, y); input [1:0] a; input [1:0] b; output y; assign y = a ${op} b; endmodule`,
        ['a[0]', 'a[1]', 'b[0]', 'b[1]'],
        ['y'],
        (i) => [
          f(num([i[0] as boolean, i[1] as boolean]), num([i[2] as boolean, i[3] as boolean])),
        ],
      )
    cmp('<', (a, b) => a < b)
    cmp('<=', (a, b) => a <= b)
    cmp('>', (a, b) => a > b)
    cmp('>=', (a, b) => a >= b)
  })

  test('a comparison of unequal-width operands compares at the wider width', () => {
    assertBus(
      'module m(a, b, y); input [1:0] a; input [2:0] b; output y; assign y = a < b; endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]', 'b[2]'],
      ['y'],
      (i) => [
        num([i[0] as boolean, i[1] as boolean]) <
          num([i[2] as boolean, i[3] as boolean, i[4] as boolean]),
      ],
    )
  })

  test('arithmetic shifts <<< / >>> synthesize — on an UNSIGNED value >>> fills 0 (= >>)', () => {
    // Signed >>> (sign-fill) + signed nets are covered in verilog-signed.test.ts; here a is unsigned so >>> = >>.
    assertBus(
      'module m(a, y); input [3:0] a; output [3:0] y; assign y = a >>> 1; endmodule',
      ['a[0]', 'a[1]', 'a[2]', 'a[3]'],
      ['y[0]', 'y[1]', 'y[2]', 'y[3]'],
      (b) => numBits(num(b) >> 1, 4),
    )
  })
})

describe('RTL synthesis — unsigned multiply (increment 6b)', () => {
  test('a full product: p = a * b (2-bit × 2-bit → 4-bit)', () => {
    assertBus(
      'module m(a, b, p); input [1:0] a; input [1:0] b; output [3:0] p; assign p = a * b; endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]'],
      ['p[0]', 'p[1]', 'p[2]', 'p[3]'],
      (i) =>
        numBits(
          num([i[0] as boolean, i[1] as boolean]) * num([i[2] as boolean, i[3] as boolean]),
          4,
        ),
    )
  })

  test('a wider product: p = a * b (3-bit × 3-bit → 6-bit, e.g. 3×3=9, 7×7=49)', () => {
    assertBus(
      'module m(a, b, p); input [2:0] a; input [2:0] b; output [5:0] p; assign p = a * b; endmodule',
      ['a[0]', 'a[1]', 'a[2]', 'b[0]', 'b[1]', 'b[2]'],
      ['p[0]', 'p[1]', 'p[2]', 'p[3]', 'p[4]', 'p[5]'],
      (i) =>
        numBits(
          num([i[0] as boolean, i[1] as boolean, i[2] as boolean]) *
            num([i[3] as boolean, i[4] as boolean, i[5] as boolean]),
          6,
        ),
    )
  })

  test('a narrow context truncates the product mod 2^w', () => {
    assertBus(
      'module m(a, b, p); input [1:0] a; input [1:0] b; output [1:0] p; assign p = a * b; endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]'],
      ['p[0]', 'p[1]'],
      (i) =>
        numBits(
          (num([i[0] as boolean, i[1] as boolean]) * num([i[2] as boolean, i[3] as boolean])) & 0x3,
          2,
        ),
    )
  })

  test('multiply by a constant folds (× 0, × 1, × 2 = << 1)', () => {
    assertBus(
      'module m(a, y); input [1:0] a; output [3:0] y; assign y = a * 2; endmodule',
      ['a[0]', 'a[1]'],
      ['y[0]', 'y[1]', 'y[2]', 'y[3]'],
      (i) => numBits(num([i[0] as boolean, i[1] as boolean]) * 2, 4),
    )
  })
})

describe('RTL synthesis — multiply review regression (context-width right operand)', () => {
  test('a compound right operand is NOT truncated to its self-width: a*(b+c) == (b+c)*a', () => {
    const p1 = (i: boolean[]) => {
      const a = num([i[0] as boolean, i[1] as boolean])
      const bc = num([i[2] as boolean, i[3] as boolean]) + num([i[4] as boolean, i[5] as boolean])
      return numBits((a * bc) & 0xf, 4)
    }
    assertBus(
      'module m(a, b, c, p); input [1:0] a; input [1:0] b; input [1:0] c; output [3:0] p; assign p = a * (b + c); endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]', 'c[0]', 'c[1]'],
      ['p[0]', 'p[1]', 'p[2]', 'p[3]'],
      p1,
    )
    assertBus(
      'module m(a, b, c, p); input [1:0] a; input [1:0] b; input [1:0] c; output [3:0] p; assign p = (b + c) * a; endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]', 'c[0]', 'c[1]'],
      ['p[0]', 'p[1]', 'p[2]', 'p[3]'],
      p1, // commutativity: same result whichever side the compound factor is on
    )
  })

  test('a full-width product with a shifted right operand: a * (b << 1)', () => {
    assertBus(
      'module m(a, b, p); input [1:0] a; input [1:0] b; output [3:0] p; assign p = a * (b << 1); endmodule',
      ['a[0]', 'a[1]', 'b[0]', 'b[1]'],
      ['p[0]', 'p[1]', 'p[2]', 'p[3]'],
      (i) => {
        const a = num([i[0] as boolean, i[1] as boolean])
        const b = num([i[2] as boolean, i[3] as boolean])
        return numBits((a * ((b << 1) & 0xf)) & 0xf, 4)
      },
    )
  })
})

describe('RTL synthesis — divide + modulo (unsigned)', () => {
  const busIns = ['a[0]', 'a[1]', 'a[2]', 'b[0]', 'b[1]', 'b[2]']
  const a3 = (i: boolean[]) => num([i[0] as boolean, i[1] as boolean, i[2] as boolean])
  const b3 = (i: boolean[]) => num([i[3] as boolean, i[4] as boolean, i[5] as boolean])

  test('DIVIDE: q = a / b over all 3-bit inputs (÷0 → all ones)', () => {
    assertBus(
      'module m(a, b, q); input [2:0] a, b; output [2:0] q; assign q = a / b; endmodule',
      busIns,
      ['q[0]', 'q[1]', 'q[2]'],
      (i) => numBits(b3(i) === 0 ? 7 : Math.floor(a3(i) / b3(i)), 3),
    )
  })

  test('MODULO: r = a % b over all 3-bit inputs (%0 → a)', () => {
    assertBus(
      'module m(a, b, r); input [2:0] a, b; output [2:0] r; assign r = a % b; endmodule',
      busIns,
      ['r[0]', 'r[1]', 'r[2]'],
      (i) => numBits(b3(i) === 0 ? a3(i) : a3(i) % b3(i), 3),
    )
  })

  test('divide + modulo together satisfy a = (a/b)*b + a%b for b != 0', () => {
    assertBus(
      'module m(a, b, q, r); input [2:0] a, b; output [2:0] q; output [2:0] r;' +
        ' assign q = a / b; assign r = a % b; endmodule',
      busIns,
      ['q[0]', 'q[1]', 'q[2]', 'r[0]', 'r[1]', 'r[2]'],
      (i) => {
        const a = a3(i)
        const b = b3(i)
        const q = b === 0 ? 7 : Math.floor(a / b)
        const r = b === 0 ? a : a % b
        return [...numBits(q, 3), ...numBits(r, 3)]
      },
    )
  })

  test('a NARROWING divide evaluates operands at FULL width, then truncates the result', () => {
    // y is only 2 bits, but a/b must be computed at the operands' 4-bit width and THEN truncated — division
    // depends on the high bits, so truncating the operands first (as + - * safely can) would be wrong.
    assertBus(
      'module m(a, b, y); input [3:0] a, b; output [1:0] y; assign y = a / b; endmodule',
      ['a[0]', 'a[1]', 'a[2]', 'a[3]', 'b[0]', 'b[1]', 'b[2]', 'b[3]'],
      ['y[0]', 'y[1]'],
      (i) => {
        const a = num([i[0] as boolean, i[1] as boolean, i[2] as boolean, i[3] as boolean])
        const b = num([i[4] as boolean, i[5] as boolean, i[6] as boolean, i[7] as boolean])
        return numBits((b === 0 ? 15 : Math.floor(a / b)) & 3, 2)
      },
    )
  })

  test('a constant divisor folds (a / 2 == a >> 1 for unsigned)', () => {
    assertBus(
      'module m(a, y); input [2:0] a; output [2:0] y; assign y = a / 2; endmodule',
      ['a[0]', 'a[1]', 'a[2]'],
      ['y[0]', 'y[1]', 'y[2]'],
      (i) => numBits(Math.floor(a3([...i, false, false, false]) / 2), 3),
    )
  })
})

describe('RTL synthesis — combinational always blocks', () => {
  test('a @(*) mux with blocking =', () => {
    assertFn(
      'module m(sel, a, b, y); input sel, a, b; output reg y; always @(*) y = sel ? a : b; endmodule',
      ['sel', 'a', 'b'],
      ([sel, a, b]) => ((sel as boolean) ? (a as boolean) : (b as boolean)),
    )
  })

  test('the bare @* form works too', () => {
    assertFn(
      'module m(a, b, y); input a, b; output reg y; always @* y = a & b; endmodule',
      ['a', 'b'],
      ([a, b]) => (a as boolean) && (b as boolean),
    )
  })

  test('blocking temps chain: t = a & b; y = t | c (reads the just-written temp)', () => {
    assertFn(
      'module m(a, b, c, y); input a, b, c; output reg y; reg t; always @(*) begin t = a & b; y = t | c; end endmodule',
      ['a', 'b', 'c'],
      ([a, b, c]) => ((a as boolean) && (b as boolean)) || (c as boolean),
    )
  })

  test('a case decoder in @(*) → a 4-bit one-hot bus', () => {
    assertBus(
      'module m(s, y); input [1:0] s; output reg [3:0] y;' +
        ' always @(*) case (s) 0: y = 1; 1: y = 2; 2: y = 4; default: y = 8; endcase endmodule',
      ['s[0]', 's[1]'],
      ['y[0]', 'y[1]', 'y[2]', 'y[3]'],
      (i) => numBits([1, 2, 4, 8][num([i[0] as boolean, i[1] as boolean])] as number, 4),
    )
  })

  test('blocking temp REUSE is correct: t=a&b; y=t; t=c&d; z=t → y=a&b, z=c&d (not both c&d)', () => {
    assertBus(
      'module m(a, b, c, d, y, z); input a, b, c, d; output reg y; output reg z; reg t;' +
        ' always @(*) begin t = a & b; y = t; t = c & d; z = t; end endmodule',
      ['a', 'b', 'c', 'd'],
      ['y', 'z'],
      (i) => [(i[0] as boolean) && (i[1] as boolean), (i[2] as boolean) && (i[3] as boolean)],
    )
  })

  test('a blocking self-update after an assign builds (not a loop): y=a; y=y+1 → a+1', () => {
    assertBus(
      'module m(a, y); input [1:0] a; output reg [1:0] y;' +
        ' always @(*) begin y = a; y = y + 1; end endmodule',
      ['a[0]', 'a[1]'],
      ['y[0]', 'y[1]'],
      (i) => numBits((num([i[0] as boolean, i[1] as boolean]) + 1) & 3, 2),
    )
  })

  test('a FULLY-COVERED case with no default builds (no latch): case(s) covers 0..3', () => {
    assertBus(
      'module m(s, a, b, c, d, y); input [1:0] s; input a, b, c, d; output reg y;' +
        ' always @(*) case (s) 0: y = a; 1: y = b; 2: y = c; 3: y = d; endcase endmodule',
      ['s[0]', 's[1]', 'a', 'b', 'c', 'd'],
      ['y'],
      (i) => {
        const s = num([i[0] as boolean, i[1] as boolean])
        return [[i[2], i[3], i[4], i[5]][s] as boolean]
      },
    )
  })

  test('a NON-fully-covered case with no default still infers a latch → reported (not silently built)', () => {
    const { warnings } = importVerilog(
      'module m(s, a, b, y); input [1:0] s; input a, b; output reg y;' +
        ' always @(*) case (s) 0: y = a; 1: y = b; endcase endmodule',
    )
    expect(warnings.some((w) => w.toLowerCase().includes('loop'))).toBe(true)
  })

  test('an incomplete assignment infers a latch → reported (a comb feedback loop), not built', () => {
    const { warnings } = importVerilog(
      'module m(en, d, y); input en, d; output reg y; always @(*) if (en) y = d; endmodule',
    )
    expect(
      warnings.some((w) => w.toLowerCase().includes('loop')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
  })

  test("a clocked block still REJECTS blocking '=' (only combinational blocks allow it)", () => {
    const { warnings } = importVerilog(
      'module m(clk, a, q); input clk, a; output reg q; always @(posedge clk) q = a; endmodule',
    )
    expect(warnings.some((w) => w.toLowerCase().includes('blocking'))).toBe(true)
  })
})

/**
 * X CONSTANTS — Verilog's don't-care. `x` is not a wire level a ChipBlocks net can carry, but it IS a value
 * that folding can carry, and real designs rely on that: the 8080's own instruction decoder is written
 * `&(~(i ^ 8'b00xxx000) | 8'b00111000)`, where the mask ORs every x away before anything drives a net.
 * So an x is folded per IEEE 1364-2005 §5.1.9 (`0 & x` = 0, `1 | x` = 1, everything else with an x is x) and
 * only REPORTED when one survives to something that must drive a net or clock a flip-flop.
 * Cross-checked against Icarus Verilog over all 256 opcodes outside this file.
 */
describe('RTL synthesis — an x constant folds where it is masked and is reported where it is not', () => {
  test('a mask ORs an x away: 1 | x is 1', () => {
    assertFn(mod('a', "assign y = a | 1'bx | 1'b1;"), ['a'], () => true)
  })

  test('a mask ANDs an x away: 0 & x is 0', () => {
    assertFn(mod('a', "assign y = (a & 1'bx) & 1'b0;"), ['a'], () => false)
  })

  test('the 8080 decoder idiom: don’t-care bits masked by their own mask', () => {
    // cmp(i, 8'b00xxx000, 8'b00111000) is the real vm80a NOP decode: opcodes 00, 08, 10, 18, 20, 28, 30, 38.
    const nop = new Set([0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38])
    assertBus(
      `module m(i, y); input [7:0] i; output y;
       function cmp(input [7:0] a, input [7:0] c, input [7:0] msk);
          cmp = &(~(a ^ c) | msk);
       endfunction
       assign y = cmp(i, 8'b00xxx000, 8'b00111000); endmodule`,
      ['i[0]', 'i[1]', 'i[2]', 'i[3]', 'i[4]', 'i[5]', 'i[6]', 'i[7]'],
      ['y'],
      (b) => [nop.has(num(b))],
    )
  })

  test('an x that nothing masks is REPORTED, never quietly made 0', () => {
    const { warnings } = importVerilog(mod('a', "assign y = a & 1'bx;"))
    expect(
      warnings.some((w) => w.includes('stays x')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
  })

  test('an x that would be clocked into a flip-flop is REPORTED', () => {
    const { warnings } = importVerilog(
      "module m(clk, a, q); input clk, a; output reg q; always @(posedge clk) q <= a & 1'bx; endmodule",
    )
    expect(
      warnings.some((w) => w.includes('clocks in an x')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
  })

  test('z (high impedance) is still refused — it is a wire state, not a value', () => {
    const { warnings } = importVerilog(mod('a', "assign y = a & 1'bz;"))
    expect(
      warnings.some((w) => w.includes('high-impedance')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
  })

  test('a hex x digit makes all FOUR of its bits unknown, and only those', () => {
    // 8'hx5 = xxxx0101: the low nibble is real, so ORing 8'hf0 over the high one leaves a defined value.
    assertBus(
      "module m(a, y); input a; output [7:0] y; assign y = (8'hx5 | 8'hf0) & {8{a}}; endmodule",
      ['a'],
      ['y[0]', 'y[1]', 'y[2]', 'y[3]', 'y[4]', 'y[5]', 'y[6]', 'y[7]'],
      ([a]) => numBits(a === true ? 0xf5 : 0x00, 8),
    )
  })
})

/**
 * THE THREE x-FOLDING GUARDS, each pinned by a design where weakening it turns an honest REFUSAL into a
 * silently-zero build — the exact failure the x machinery exists to prevent. Icarus Verilog 14.0 was run on
 * each source and returns x for every bit this file expects to be refused, so refusing is the right answer
 * and a built 0 would be a wrong one.
 */
describe('Verilog synth — an x nothing masks away is refused, never folded to 0', () => {
  const portIds = (verilog: string) => {
    const { block } = importVerilog(verilog)
    return block === null ? [] : block.ports.map((p) => p.id)
  }

  test('`0 | x` stays x — iverilog gives xxxx, so no driver is built', () => {
    const source = "module m(input a, output [3:0] y); assign y = 4'b0000 | 4'bxxxx; endmodule"
    const { block, warnings } = importVerilog(source)
    expect(
      warnings.some((w) => w.includes('stays x')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    // Folding `0 | x` to 0 would build a 4-bit constant-zero driver instead.
    expect(block).toBeNull()
  })

  test('`~x` stays x — iverilog gives xxxx, so no driver is built', () => {
    const { block, warnings } = importVerilog(
      "module m(input a, output [3:0] y); assign y = ~4'bxxxx; endmodule",
    )
    expect(
      warnings.some((w) => w.includes('stays x')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(block).toBeNull()
  })

  test('a based literal whose top digit is x left-extends with x, not 0', () => {
    // 4'bx is xxxx (IEEE 1364-2005 §3.2), so 4'bx | 4'b0001 is xxx1. MEASURED: Icarus Verilog 14.0 prints
    // `y = xxx1` for exactly this source. Extending with 0 instead would make it 0001 and build a driver for
    // every bit — so y[3:1] must have NO driver, while y[0] (the one bit that is not x) must have one.
    const source = "module m(input a, output [3:0] y); assign y = 4'bx | 4'b0001; endmodule"
    const { warnings } = importVerilog(source)
    expect(
      warnings.some((w) => w.includes('stays x')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(portIds(source).filter((id) => id.startsWith('y'))).toEqual(['y[0]'])
  })
})

/**
 * TWO DRIVERS ON ONE NET. Real hardware resolves that to a contention — iverilog returns x for every one of
 * the designs below — and a two-valued netlist has no x to return. Keeping the first driver would put a
 * made-up value on a net whose real value is unknown, so NO driver is built for a contended bit and the
 * warning that says so is true.
 */
describe('Verilog synth — a contended net gets NO driver, exactly as reported', () => {
  test('two continuous assigns to one net: neither is built', () => {
    const { block, warnings } = importVerilog(
      'module m(input p, output o, output good); assign o = p; assign o = ~p; assign good = ~p; endmodule',
    )
    expect(
      warnings.some((w) => w.includes('assigned more than once')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(block).not.toBeNull()
    // The contended net is undriven, so it is honestly absent from the interface — while the rest builds.
    const ids = (block as BlockData).ports.map((p) => p.id)
    expect(ids).toContain('good')
    expect(ids).not.toContain('o')
  })

  test('contention on ONE bit of a bus leaves the other bits driven', () => {
    const { block, warnings } = importVerilog(
      'module m(input [3:0] p, output [3:0] o); assign o = p; assign o[0] = ~p[0]; endmodule',
    )
    expect(
      warnings.some((w) => w.includes('"o[0]" is assigned more than once')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    const ids = (block as BlockData).ports.map((p) => p.id)
    expect(ids).not.toContain('o[0]')
    expect(ids).toEqual(expect.arrayContaining(['o[1]', 'o[2]', 'o[3]']))
  })

  test('a structural gate and an assign on one net: neither drives it', () => {
    const { block, warnings } = importVerilog(
      'module m(input a, input b, output o, output good); and g1(o, a, b); assign o = a | b; assign good = a ^ b; endmodule',
    )
    expect(
      warnings.some((w) => w.includes('already driven by a gate')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    const ids = (block as BlockData).ports.map((p) => p.id)
    expect(ids).toContain('good')
    expect(ids).not.toContain('o')
  })

  test('a clocked register on a net an assign already drives: neither drives it', () => {
    const { block, warnings } = importVerilog(
      'module m(input clk, input a, output o, output good); assign o = a; assign good = ~a; always @(posedge clk) o <= ~a; endmodule',
    )
    expect(
      warnings.some((w) => w.includes('already driven by a gate or assign')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    const ids = (block as BlockData).ports.map((p) => p.id)
    expect(ids).toContain('good')
    expect(ids).not.toContain('o')
  })
})

/**
 * A register written by TWO clocked always blocks is the same contention as two drivers on one net — and
 * the first block's flip-flops are the thing that has to be retracted, since they were already built when
 * the second block was rejected.
 */
describe('Verilog synth — a register two always blocks write is left undriven', () => {
  test('neither block’s flip-flops survive, and the rest of the module still builds', () => {
    const { block, warnings } = importVerilog(
      'module m(input clk, input a, output q, output good); assign good = ~a; always @(posedge clk) q <= a; always @(posedge clk) q <= ~a; endmodule',
    )
    expect(
      warnings.some((w) => w.includes('written by more than one always block')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    const ids = (block as BlockData).ports.map((p) => p.id)
    expect(ids).toContain('good')
    expect(ids).not.toContain('q')
  })
})

/**
 * A concatenation's OPERANDS are self-determined (IEEE 1364-2005 §5.4.1) — each takes its own width AND its
 * own signedness. Only the concatenation's RESULT is unsigned (§5.5.1). Forcing the operands unsigned made
 * `{a >>> 1, …}` on a signed `a` a LOGICAL shift: a silently wrong answer with no warning, and one that no
 * other test in this suite reached, because every other signed test writes the expression at the top of an
 * assignment where the context signedness happens to be right.
 *
 * The expected numbers below are not derived from this code. Each design was run through Icarus Verilog
 * 14.0 (`vvp -V` → 14.0 (devel) s20251012-184-ge4c424726) over all 16 values of `a`, and these are the
 * values it printed.
 */
describe('Verilog synth — a signed operand keeps its sign inside {…} and {n{…}}', () => {
  const sweep = (verilog: string, expected: number[]): void => {
    const { block, warnings } = importVerilog(verilog)
    // A bit of `a` that no gate reads (a[0] under `a >>> 1`) is honestly dropped from the interface; that
    // report is expected here. Anything else still fails.
    const unexpected = warnings.filter((w) => !w.includes('is not connected to any gate'))
    expect(unexpected, `warnings: ${warnings.join(' | ')}`).toEqual([])
    const tt = characterizeBlock(block as BlockData)
    expect(tt, 'should characterize as combinational').not.toBeNull()
    if (tt === null) return
    // Rebuild `a` from the port NAMES, so a dropped bit shifts nothing.
    const place = tt.inputs.map((name) => Number(name.replace(/^a\[(\d+)]$/, '$1')))
    for (const row of tt.rows) {
      const a = place.reduce((s, bit, i) => s + (row.in[i] === true ? 1 << bit : 0), 0)
      expect(row.out.length, `a=${a}`).toBe(8)
      expect(num(row.out), `a=${a}`).toBe(expected[a])
    }
  }

  test('an arithmetic right shift stays arithmetic as a concatenation operand', () => {
    sweep(
      "module m(input signed [3:0] a, output [7:0] y); assign y = {a >>> 1, 4'b0}; endmodule",
      [0, 0, 16, 16, 32, 32, 48, 48, 192, 192, 208, 208, 224, 224, 240, 240],
    )
  })

  test('a signed divide stays signed as a concatenation operand', () => {
    sweep(
      "module m(input signed [3:0] a, output [7:0] y); assign y = {4'b0, a / 4'sd2}; endmodule",
      [0, 0, 1, 1, 2, 2, 3, 3, 12, 13, 13, 14, 14, 15, 15, 0],
    )
  })

  test('a signed operand keeps its sign inside a REPLICATION too', () => {
    sweep(
      'module m(input signed [3:0] a, output [7:0] y); assign y = {2{a >>> 1}}; endmodule',
      [0, 0, 17, 17, 34, 34, 51, 51, 204, 204, 221, 221, 238, 238, 255, 255],
    )
  })

  test("a sub-module's signed port survives into the parent's concatenation", () => {
    sweep(
      `module sgn(input signed [3:0] p, output [3:0] q);
          assign q = p;
       endmodule
       module m(input [3:0] a, output [7:0] y);
          wire [3:0] t;
          sgn u(.p(a), .q(t));
          assign y = {a >>> 1, t};
       endmodule`,
      [0, 1, 18, 19, 36, 37, 54, 55, 72, 73, 90, 91, 108, 109, 126, 127],
    )
  })
})

/**
 * A FAULT ON ONE BIT COSTS THAT BIT ITS DRIVER — NOT THE WHOLE VECTOR.
 *
 * `assign o = a; assign o[0] = b[0];` contends on bit 0 alone, and Icarus Verilog 14.0 returns a[3:1] on the
 * other three bits. Retracting the whole assignment took those three drivers away too, and the warning still
 * named only o[0] — a message that described a small local problem while four bits died. The same
 * whole-vector retraction lived in five places (the continuous-assign contention and x faults, the
 * combinational-loop cut, the combinational always block and the clocked always block), so each is pinned
 * here.
 *
 * Every expected value below comes from Icarus Verilog 14.0 run on the same source, never from this code: a
 * bit Icarus prints as x or z has NO driver here (its port is absent from the interface), and a bit Icarus
 * prints as 0/1 keeps its driver and carries that value.
 *
 * THAT SECOND HALF HOLDS FOR THE BIT THE FAULT IS ON, NOT FOR EVERYTHING DOWNSTREAM OF IT. A net left
 * undriven still reads 0 to anything inside the module that reads it (logic-sim.ts stepLogic — see the note
 * beside CONTENDED_ASSIGN in verilog-synth.ts), so a driver reading a refused net publishes 0 rather than
 * disappearing. The last test in this block is exactly that case, and its own numbers are stated there.
 */
describe('Verilog synth — one bad bit retracts one bit', () => {
  const built = (
    verilog: string,
  ): { ids: string[]; warnings: string[]; block: BlockData | null } => {
    const { block, warnings } = importVerilog(verilog)
    return { ids: block === null ? [] : block.ports.map((p) => p.id), warnings, block }
  }

  test('contention written AFTER the whole-bus driver leaves the other bits driven', () => {
    // The forward order already worked; this is the order a sub-module port produces, and it did not.
    // iverilog: o[3:1] = a[3:1], o[0] = x.
    const { ids, warnings, block } = built(
      'module m(input [3:0] a, input [3:0] b, output [3:0] o); assign o[0] = b[0]; assign o = a; endmodule',
    )
    expect(ids, `warnings: ${warnings.join(' | ')}`).toEqual(
      expect.arrayContaining(['o[1]', 'o[2]', 'o[3]']),
    )
    expect(ids).not.toContain('o[0]')
    const tt = characterizeBlock(block as BlockData)
    expect(tt?.inputs).toEqual(['a[1]', 'a[2]', 'a[3]'])
    expect(tt?.outputs).toEqual(['o[1]', 'o[2]', 'o[3]'])
    for (const row of tt?.rows ?? []) expect(row.out, `in ${row.in.join(',')}`).toEqual(row.in)
  })

  test('the warning names EVERY bit that lost its driver, and the bits that kept theirs', () => {
    const { warnings } = built(
      'module m(input [3:0] a, input [3:0] b, output [3:0] o); assign o[0] = b[0]; assign o[2] = b[2]; assign o = a; endmodule',
    )
    const contention = warnings.filter((w) => w.includes('assigned more than once'))
    expect(contention.length, `warnings: ${warnings.join(' | ')}`).toBe(1)
    for (const dead of ['"o[0]"', '"o[2]"']) expect(contention[0]).toContain(dead)
    for (const kept of ['"o[1]"', '"o[3]"']) expect(contention[0]).toContain(kept)
    expect(contention[0]).toContain('keep this driver')
  })

  test('when every bit is contended the message says so instead of naming one', () => {
    const { ids, warnings } = built(
      'module m(input [3:0] a, input [3:0] b, output [3:0] o); assign o = a; assign o = b; endmodule',
    )
    const contention = warnings.filter((w) => w.includes('assigned more than once'))
    expect(contention.length, `warnings: ${warnings.join(' | ')}`).toBe(1)
    expect(contention[0]).toContain('every bit')
    expect(contention[0]).not.toContain('keep this driver')
    for (const bit of ['o[0]', 'o[1]', 'o[2]', 'o[3]']) expect(ids).not.toContain(bit)
  })

  test('an x on one bit leaves the other bits driven', () => {
    // iverilog on `assign o = {a[3:1], 1'bx}` prints a[3:1] then x — three bits have a real driver.
    const { ids, warnings, block } = built(
      "module m(input [3:0] a, output [3:0] o); assign o = {a[3:1], 1'bx}; endmodule",
    )
    expect(
      warnings.some((w) => w.includes('stays x')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(ids).not.toContain('o[0]')
    const tt = characterizeBlock(block as BlockData)
    expect(tt?.inputs).toEqual(['a[1]', 'a[2]', 'a[3]'])
    expect(tt?.outputs).toEqual(['o[1]', 'o[2]', 'o[3]'])
    for (const row of tt?.rows ?? []) expect(row.out, `in ${row.in.join(',')}`).toEqual(row.in)
  })

  test('a combinational loop on one bit leaves the other bits driven', () => {
    // iverilog on `assign o = {a[3:1], o[0]}` prints o[3:1] = a[3:1] and o[0] = z — it never resolves.
    const { ids, warnings, block } = built(
      'module m(input [3:0] a, output [3:0] o); assign o = {a[3:1], o[0]}; endmodule',
    )
    expect(
      warnings.some((w) => w.includes('combinational loop')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(ids).not.toContain('o[0]')
    const tt = characterizeBlock(block as BlockData)
    expect(tt?.inputs).toEqual(['a[1]', 'a[2]', 'a[3]'])
    expect(tt?.outputs).toEqual(['o[1]', 'o[2]', 'o[3]'])
    for (const row of tt?.rows ?? []) expect(row.out, `in ${row.in.join(',')}`).toEqual(row.in)
  })

  test('a multi-output buf keeps the output nothing else drives', () => {
    // `buf u(x, y, a)` drives TWO nets from one input (IEEE 1364-2005 §7.3). Contention on x must not take y
    // down with it. MEASURED on this exact source, Icarus Verilog 14.0 prints
    //   a=0 b=0 -> x=0 y=0 | a=0 b=1 -> x=x y=0 | a=1 b=0 -> x=x y=1 | a=1 b=1 -> x=1 y=1
    // so y = a on every vector while x is unknown whenever a and b differ.
    const { ids, warnings, block } = built(
      'module m(input a, input b, output x, output y); buf u(x, y, a); assign x = b; endmodule',
    )
    expect(ids, `warnings: ${warnings.join(' | ')}`).not.toContain('x')
    expect(ids).toContain('y')
    const tt = characterizeBlock(block as BlockData)
    expect(tt?.inputs).toEqual(['a'])
    expect(tt?.outputs).toEqual(['y'])
    for (const row of tt?.rows ?? []) expect(row.out[0], `a=${row.in[0]}`).toBe(row.in[0])
  })

  test('a driver we REFUSED still claims its bit — a second driver cannot become the only one', () => {
    // iverilog on `assign o = {a[3:1], 1'bx}; assign o[0] = b[0];` gives o[0] = x for every b[0]: the refused
    // x driver is still a driver. Building b[0] onto o[0] would publish a value the hardware does not have.
    const { ids, warnings } = built(
      "module m(input [3:0] a, input [3:0] b, output [3:0] o); assign o = {a[3:1], 1'bx}; assign o[0] = b[0]; endmodule",
    )
    expect(ids, `warnings: ${warnings.join(' | ')}`).not.toContain('o[0]')
    expect(ids).toEqual(expect.arrayContaining(['o[1]', 'o[2]', 'o[3]']))
  })

  test('the kept-bits clause never names a bit that a LATER fault killed', () => {
    // Two combinational always blocks writing disjoint parts of one register: our lowering gives each block a
    // whole-register next state, so both drive all four bits and the register is refused. The loop cut runs
    // first and spares r[1:0]; the contention retraction then takes them. Claiming they were kept would
    // describe something that did not happen.
    //
    // WHAT IS AND IS NOT TRUE OF THE OUTPUT, MEASURED. `r` really does get no driver and both faults are
    // reported. `o` is NOT refused with it: `assign o = r` builds four buffers that read the now-undriven r,
    // and an undriven net reads 0 in this two-valued engine, so o[3:0] reads 0000 on all 256 (a, b) vectors.
    // Icarus Verilog 14.0 on this source resolves the two blocks and gives o = {b[3:2], a[1:0]}, which
    // differs from 0000 on 512 of the 4 x 256 = 1024 published output bits. That gap belongs to the
    // floating-input rule in logic-sim.ts, not to the contention guard — the x form suffers it identically
    // (see the note beside CONTENDED_ASSIGN) — and it is left open here rather than described away.
    const { ids, warnings } = built(
      `module m(input [3:0] a, input [3:0] b, output [3:0] o);
         reg [3:0] r;
         always @(*) r[1:0] = a[1:0];
         always @(*) r[3:2] = b[3:2];
         assign o = r;
       endmodule`,
    )
    for (const w of warnings)
      expect(w, `warnings: ${warnings.join(' | ')}`).not.toContain('keep this driver')
    expect(ids).not.toContain('r[0]')
  })

  test('the x guard and the contention guard resolve to the SAME netlist', () => {
    // Both leave one bit with no driver and every other bit driven. The two mechanisms are meant to agree
    // about an unknown bit; if they ever stop agreeing, these two builds stop matching.
    const shape = (inner: string) =>
      `module m(input [3:0] a, input [3:0] b, output [3:0] o); wire [3:0] t; ${inner} assign o = t | b; endmodule`
    // Both leave t[0] with no driver, and `o = t | b` READS it — so under the transitive-unbuilt rule both
    // are refused rather than published with o[0] worked out from a 0 nothing produced. They still agree,
    // which is what this test is for; what they agree ON is now a refusal that names the same bit.
    const x = built(shape("assign t = {a[3:1], 1'bx};"))
    const c = built(shape('assign t = a; assign t[0] = b[0];'))
    expect(x.block).toBeNull()
    expect(c.block).toBeNull()
    for (const r of [x, c])
      expect(r.warnings.join(' | '), `warnings: ${r.warnings.join(' | ')}`).toContain('"t[0]"')
  })

  test('a clocked register keeps the bits an assign does not already drive', () => {
    // iverilog: q[0] has two drivers (x), q[3:1] clock in a[3:1]. The flip-flops for those three must survive.
    const { ids, warnings } = built(
      'module m(input clk, input [3:0] a, input [3:0] b, output reg [3:0] q); assign q[0] = b[0]; always @(posedge clk) q <= a; endmodule',
    )
    expect(
      warnings.some((w) => w.includes('already driven by a gate or assign')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(ids).not.toContain('q[0]')
    expect(ids).toEqual(expect.arrayContaining(['q[1]', 'q[2]', 'q[3]']))
  })
  test('a COMBINATIONAL always block keeps the bits that are not x', () => {
    // MEASURED, Icarus Verilog 14.0 on this exact source: a=1010 -> y=101x, a=0101 -> y=010x. So y[3:1]
    // follow a[3:1] and only y[0] is unknown — the always-block path has to refuse per bit like the assign
    // path does, or three good drivers die with the one bad bit.
    const { ids, warnings, block } = built(
      "module m(input [3:0] a, output reg [3:0] y); always @(*) y = {a[3:1], 1'bx}; endmodule",
    )
    expect(
      warnings.some((w) => w.includes('stays x')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(ids).not.toContain('y[0]')
    const tt = characterizeBlock(block as BlockData)
    expect(tt?.inputs).toEqual(['a[1]', 'a[2]', 'a[3]'])
    expect(tt?.outputs).toEqual(['y[1]', 'y[2]', 'y[3]'])
    for (const row of tt?.rows ?? []) expect(row.out, `in ${row.in.join(',')}`).toEqual(row.in)
  })

  test('a CLOCKED always block keeps the bits that do not clock in an x', () => {
    // Same shape one register deep: q[3:1] must still get flip-flops when q[0] clocks in an x.
    const { ids, warnings } = built(
      "module m(input clk, input [3:0] a, output reg [3:0] q); always @(posedge clk) q <= {a[3:1], 1'bx}; endmodule",
    )
    expect(
      warnings.some((w) => w.includes('clocks in an x')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(ids, `warnings: ${warnings.join(' | ')}`).not.toContain('q[0]')
    expect(ids).toEqual(expect.arrayContaining(['q[1]', 'q[2]', 'q[3]']))
  })
})

/**
 * ONE LEDGER FOR EVERY DRIVER.
 *
 * A continuous assign, a combinational or clocked always block, a structural primitive, a sub-module output
 * port and the REFUSED form of each all register their target bits through a single claim, so a second claim
 * on a bit is caught whichever pair of producers made the two claims. Two pairings had never been compared at
 * all: a structural gate against another structural gate (they were seeded into a Set, where a duplicate
 * output collapsed silently), and a driver the importer refused against one it built (the refused driver
 * claimed nothing, so the built one became the bit's only owner and published a value the hardware does not
 * have).
 *
 * Every expected value below is Icarus Verilog 14.0's, run on the same source over all 256 (a, b) vectors,
 * never derived from this code. A bit Icarus prints as x has NO driver here — its port is absent from the
 * interface — and a bit it prints as 0/1 keeps its driver.
 */
describe('Verilog synth — every producer of a driver claims its bits in one place', () => {
  const built = (
    verilog: string,
  ): { ids: string[]; warnings: string[]; block: BlockData | null } => {
    const { block, warnings } = importVerilog(verilog)
    return { ids: block === null ? [] : block.ports.map((p) => p.id), warnings, block }
  }
  const SCALARS =
    'module m(a0,a1,a2,a3,b0,b1,b2,b3,o0,o1,o2,o3); input a0,a1,a2,a3,b0,b1,b2,b3; output o0,o1,o2,o3;'

  test('TWO STRUCTURAL GATES on one net: neither drives it, and it is reported', () => {
    // iverilog: o0 = x wherever a0 and b0 differ (128 of the 256 vectors) and o1..o3 = a1..a3 always. This
    // pairing produced NO warning of any kind before: the driver set was seeded from every gate output at
    // once, so the second buf collapsed into the first entry and nothing ever compared them.
    const { ids, warnings } = built(
      `${SCALARS} buf g0(o0, a0); buf g1(o0, b0); buf g2(o1, a1); buf g3(o2, a2); buf g4(o3, a3); endmodule`,
    )
    expect(
      // The whole source is on one line, so the second buf is on line 1 — a gate has to carry where it was
      // written, or the message can only say that SOMETHING contends.
      warnings.some(
        (w) => w.includes('line 1: "buf" gate') && w.includes('assigned more than once'),
      ),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(ids).not.toContain('o0')
    expect(ids).toEqual(expect.arrayContaining(['o1', 'o2', 'o3']))
  })

  test('THREE structural gates on one net: every one of them is reported', () => {
    // iverilog: o0 is x unless all three sources agree. Two contentions are found, not one — the third gate
    // is compared against the ledger too, not against a "was anything already there" answered once.
    const { ids, warnings } = built(
      `${SCALARS} buf g0(o0,a0); buf g1(o0,b0); buf g2(o0,a1); buf g3(o1,a1); buf g4(o2,a2); buf g5(o3,a3); endmodule`,
    )
    expect(
      warnings.filter((w) => w.includes('assigned more than once')).length,
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(2)
    expect(ids).not.toContain('o0')
  })

  test('a MULTI-OUTPUT buf loses only the output another gate also drives', () => {
    // `buf g0(o0, o1, a0)` drives two nets from one input (IEEE 1364-2005 §7.3). MEASURED, iverilog on this
    // source: a0=1 gives o0=1 with o1=x, a0=0 gives o0=0 with o1=x — o1 is unknown on every vector because
    // g1 drives it too, while o0 follows a0 throughout. Dropping the whole gate would take o0 down with o1.
    const { ids, warnings } = built(
      `${SCALARS} buf g0(o0, o1, a0); buf g1(o1, b1); buf g2(o2, a2); buf g3(o3, a3); endmodule`,
    )
    expect(ids, `warnings: ${warnings.join(' | ')}`).not.toContain('o1')
    expect(ids).toEqual(expect.arrayContaining(['o0', 'o2', 'o3']))
  })

  test('a structural gate we REFUSED still claims its bits — an assign cannot become the only driver', () => {
    // `buf g0(o[0], a[0])` has a bit-select terminal, which this importer does not build. iverilog builds it
    // and reads o[0] = x wherever a[0] and b[0] differ, o[3:1] = b[3:1]. Publishing b[0] on o[0] because we
    // declined to build the buf invents a value on 128 of the 256 vectors.
    const { ids, warnings } = built(
      'module m(input [3:0] a, input [3:0] b, output [3:0] o); buf g0(o[0], a[0]); assign o = b; endmodule',
    )
    expect(
      warnings.some((w) => w.includes('"o[0]"') && w.includes('assigned more than once')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(ids).not.toContain('o[0]')
    expect(ids).toEqual(expect.arrayContaining(['o[1]', 'o[2]', 'o[3]']))
  })

  test('the claim holds when the refused gate is written AFTER the driver it contends with', () => {
    const { ids } = built(
      'module m(input [3:0] a, input [3:0] b, output [3:0] o); assign o = b; buf g0(o[0], a[0]); endmodule',
    )
    expect(ids).not.toContain('o[0]')
    expect(ids).toEqual(expect.arrayContaining(['o[1]', 'o[2]', 'o[3]']))
  })

  test('a refused MULTI-OUTPUT buf claims every output it names', () => {
    // `buf g0(o[1], o[0], a[0])`: the refused gate drives both o[1] and o[0]. iverilog reads both as x
    // wherever they disagree with the assign, and o[3:2] = b[3:2].
    const { ids, warnings } = built(
      'module m(input [3:0] a, input [3:0] b, output [3:0] o); buf g0(o[1], o[0], a[0]); assign o = b; endmodule',
    )
    expect(ids, `warnings: ${warnings.join(' | ')}`).not.toContain('o[0]')
    expect(ids).not.toContain('o[1]')
    expect(ids).toEqual(expect.arrayContaining(['o[2]', 'o[3]']))
  })

  test('a refused gate claims against a BUILT GATE, not only against an assign', () => {
    // `buf g0(o0, 1)` has a constant terminal — refused. iverilog: o0 = x wherever a0 is 0 (the constant 1
    // and a0 disagree) and 1 where a0 is 1.
    const { ids, warnings } = built(
      `${SCALARS} buf g0(o0, 1); buf g1(o0, a0); buf g2(o1,a1); buf g3(o2,a2); buf g4(o3,a3); endmodule`,
    )
    expect(ids, `warnings: ${warnings.join(' | ')}`).not.toContain('o0')
    expect(ids).toEqual(expect.arrayContaining(['o1', 'o2', 'o3']))
  })

  test('a refused gate claims against a COMBINATIONAL ALWAYS block', () => {
    const { ids } = built(
      `module m(input [3:0] a, input [3:0] b, output [3:0] o);
         buf g0(o[0], a[0]);
         reg [3:0] r;
         always @(*) r = b;
         assign o = r;
       endmodule`,
    )
    expect(ids).not.toContain('o[0]')
    expect(ids).toEqual(expect.arrayContaining(['o[1]', 'o[2]', 'o[3]']))
  })

  test('a structural gate driving an INPUT port is reported like an assign that does the same', () => {
    // Both producers now say the same thing about the same illegal source. iverilog accepts it and resolves
    // the port to x wherever the internal driver and the parent disagree; we refuse the internal driver and
    // report it, exactly as the assign form has always done.
    const gate = built(`${SCALARS} buf g0(a0, b0); buf g1(o0, a0); endmodule`)
    const assign = built(`${SCALARS} assign a0 = b0; buf g1(o0, a0); endmodule`)
    for (const r of [gate, assign])
      expect(
        r.warnings.some((w) => w.includes('drives an input port')),
        `warnings: ${r.warnings.join(' | ')}`,
      ).toBe(true)
  })

  test('a combinational always block we cannot synthesize still claims its register', () => {
    // The reasons a block is not built used to run BEFORE the claim, so an unsynthesizable block owned
    // nothing and the next block writing the same register became its only driver. `a[7:4]` is out of range
    // on a 4-bit a — Verilog reads x there — so neither block may drive r.
    const { ids, warnings } = built(
      `module m(input [3:0] a, input [3:0] b, output [3:0] o);
         reg [3:0] r;
         always @(*) r = a[7:4];
         always @(*) r = b;
         assign o = r;
       endmodule`,
    )
    expect(
      warnings.some((w) => w.includes('already driven by a gate or assign')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(ids).not.toContain('r[0]')
  })

  test('a purely STRUCTURAL module is driver-checked at all', () => {
    // Synthesis used to return early when a module had no assign and no always block, which is why two
    // structural gates on one net were never compared: the only code that compares drivers lives after that
    // return. A module of nothing but gates must still be checked.
    const { warnings } = built(
      'module m(input a, input b, output o); buf g0(o,a); buf g1(o,b); endmodule',
    )
    expect(
      warnings.some((w) => w.includes('assigned more than once')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
  })

  test('one surviving bit reads "keeps this driver", not "keep"', () => {
    const { warnings } = built(
      'module m(input [3:0] a, input [3:0] b, output [3:0] o); assign o[2:0] = b[2:0]; assign o = a; endmodule',
    )
    const contention = warnings.filter((w) => w.includes('assigned more than once'))
    expect(contention.length, `warnings: ${warnings.join(' | ')}`).toBe(1)
    expect(contention[0]).toContain('the other bit ("o[3]") keeps this driver')
  })

  test('DISJOINT drivers are not contention: a gate and an assign on different nets both build', () => {
    // The over-refusal control. Nothing here is driven twice, so nothing may be refused. The unread input
    // ports report themselves — that is the interface, not a driver — and anything else still fails.
    const { ids, warnings } = built(
      `${SCALARS} buf g0(o0,a0); assign o1 = b1; buf g1(o2,a2); assign o3 = b3; endmodule`,
    )
    expect(
      warnings.filter((w) => !w.includes('is not connected to any gate')),
      `warnings: ${warnings.join(' | ')}`,
    ).toEqual([])
    expect(ids).toEqual(expect.arrayContaining(['o0', 'o1', 'o2', 'o3']))
  })

  test('a refused gate claims what it DRIVES and nothing it reads', () => {
    // The over-refusal control for the refused-driver claim. `buf g0(o[0], t[0])` drives o[0] and READS
    // t[0]; claiming the input terminal too would refuse the assign that feeds it, and iverilog builds
    // that assign — t = a on all 256 vectors, with o[3:1] = b[3:1].
    const { ids, warnings } = built(
      `module m(input [3:0] a, input [3:0] b, output [3:0] o, output [3:0] t);
         buf g0(o[0], t[0]);
         assign t = a;
         assign o[3:1] = b[3:1];
       endmodule`,
    )
    expect(ids, `warnings: ${warnings.join(' | ')}`).toEqual(
      expect.arrayContaining(['t[0]', 't[1]', 't[2]', 't[3]', 'o[1]', 'o[2]', 'o[3]']),
    )
  })

  test('a clocked always block we cannot synthesize still claims its register', () => {
    // Same ordering fault as the combinational path, one register deep: `a[7:4]` is out of range on a 4-bit
    // a, so the first block is not built — but it wrote a driver, and the second block writing the same
    // register is a contention rather than that register's only driver.
    const { ids, warnings } = built(
      `module m(input clk, input [3:0] a, input [3:0] b, output reg [3:0] q);
         always @(posedge clk) q <= a[7:4];
         always @(posedge clk) q <= b;
       endmodule`,
    )
    expect(
      warnings.some((w) => w.includes('already driven by a gate or assign')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    for (const bit of ['q[0]', 'q[1]', 'q[2]', 'q[3]']) expect(ids).not.toContain(bit)
  })

  test('a multi-output buf with no contention keeps BOTH outputs', () => {
    const { ids, warnings } = built(
      `${SCALARS} buf g0(o0, o1, a0); buf g1(o2, a2); buf g2(o3, a3); endmodule`,
    )
    expect(ids, `warnings: ${warnings.join(' | ')}`).toEqual(
      expect.arrayContaining(['o0', 'o1', 'o2', 'o3']),
    )
  })
})
