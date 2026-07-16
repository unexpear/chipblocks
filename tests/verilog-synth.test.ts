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

  test('arithmetic + - * and shifts are reported (buses/arithmetic are a later increment)', () => {
    reported(mod('a, b', 'assign y = a + b;'), 'not supported')
    reported(mod('a, b', 'assign y = a * b;'), 'not supported')
    reported(mod('a, b', 'assign y = a << b;'), 'not supported')
    reported(mod('a, b', 'assign y = a < b;'), 'not supported')
  })

  test('bit-select, concatenation, and multi-bit constants are reported', () => {
    reported('module m(a, y); input [3:0] a; output y; assign y = a[0]; endmodule', 'bus support')
    reported(mod('a, b', 'assign y = {a, b};'), 'bus support')
    reported(mod('a', "assign y = a & 4'b1010;"), 'bus support')
  })

  test('driving an input, double-driving, and constant outputs are reported', () => {
    reported('module m(a, b); input a; output b; assign a = b; endmodule', 'input port')
    reported(
      'module m(a, y); input a; output y; assign y = a; assign y = ~a; endmodule',
      'more than once',
    )
    reported(mod('a', "assign y = a & 1'b0;"), 'constant')
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
