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

  test('still-unsupported operators (* / % << >> < <= > >=) are reported', () => {
    // (+ and - ARE supported now — see the 2b bus + arithmetic tests)
    reported(mod('a, b', 'assign y = a * b;'), 'not supported')
    reported(mod('a, b', 'assign y = a << b;'), 'not supported')
    reported(mod('a, b', 'assign y = a < b;'), 'not supported')
    reported(mod('a, b', 'assign y = a % b;'), 'not supported')
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
    // p = y & a reads the self-looped y, but p is not on a cycle — exactly ONE loop warning, naming y
    const { warnings } = importVerilog(
      'module m(a, y, p); input a; output y, p; assign p = y & a; assign y = y & a; endmodule',
    )
    const loops = warnings.filter((w) => w.toLowerCase().includes('combinational loop'))
    expect(loops.length).toBe(1)
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
