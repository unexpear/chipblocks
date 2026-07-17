/**
 * FUNCTIONS — `function … endfunction` inlined into REAL gates. This is the feature that was reverted once
 * for silent width miscompiles, so every case proves the built gates compute the right value by truth table
 * (through the real logic engine), with special attention to the WIDTH WALLS that make it exact: a call's
 * result is its declared RETURN width, each argument is truncated/extended to its FORMAL's width, and an
 * intermediate local truncates to its declared width. Un-synthesizable cases (recursion, unknown function,
 * wrong arg count) are REPORTED, never faked.
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

/** assertBus that tolerates the "unconnected port omitted" warnings (an arg/return that uses only some bits). */
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

const reported = (verilog: string, needle: string) => {
  const { warnings } = importVerilog(verilog)
  expect(
    warnings.some((w) => w.toLowerCase().includes(needle.toLowerCase())),
    `warnings: ${warnings.join(' | ')}`,
  ).toBe(true)
}

describe('functions — the basic call', () => {
  test('an ANSI-header function inlines and computes (2-bit adder)', () => {
    assertBus(
      'module m(p, q, y); input [1:0] p; input [1:0] q; output [1:0] y;' +
        ' function [1:0] add(input [1:0] a, input [1:0] b); add = a + b; endfunction' +
        ' assign y = add(p, q); endmodule',
      [...busIn('p', 2), ...busIn('q', 2)],
      busIn('y', 2),
      (bits) => numBits((num(bits.slice(0, 2)) + num(bits.slice(2, 4))) & 3, 2),
    )
  })

  test('a classic-header function (inputs declared in the body) inlines', () => {
    assertBus(
      'module m(p, q, y); input [1:0] p; input [1:0] q; output [1:0] y;' +
        ' function [1:0] add; input [1:0] a; input [1:0] b; add = a + b; endfunction' +
        ' assign y = add(p, q); endmodule',
      [...busIn('p', 2), ...busIn('q', 2)],
      busIn('y', 2),
      (bits) => numBits((num(bits.slice(0, 2)) + num(bits.slice(2, 4))) & 3, 2),
    )
  })

  test('a function is called from a combinational always block', () => {
    assertBus(
      'module m(p, q, y); input [1:0] p; input [1:0] q; output [1:0] y; reg [1:0] y;' +
        ' function [1:0] add(input [1:0] a, input [1:0] b); add = a + b; endfunction' +
        ' always @(*) y = add(p, q); endmodule',
      [...busIn('p', 2), ...busIn('q', 2)],
      busIn('y', 2),
      (bits) => numBits((num(bits.slice(0, 2)) + num(bits.slice(2, 4))) & 3, 2),
    )
  })

  test('two different calls to the same function do not alias (unique inlined nets)', () => {
    assertBus(
      'module m(p, q, y); input [1:0] p; input [1:0] q; output [1:0] y;' +
        ' function [1:0] inc(input [1:0] a); inc = a + 1; endfunction' +
        ' assign y = inc(p) & inc(q); endmodule',
      [...busIn('p', 2), ...busIn('q', 2)],
      busIn('y', 2),
      (bits) => numBits((num(bits.slice(0, 2)) + 1) & 3 & ((num(bits.slice(2, 4)) + 1) & 3) & 3, 2),
    )
  })
})

describe('functions — the width walls (the reason it was reverted)', () => {
  test('the RETURN width is a wall: a 2-bit function used in +1 stays 2-bit', () => {
    // `low` returns only its low 2 bits, so y = (p&3)+1 and the high input bits p[2],p[3] cannot affect y —
    // proven by the truth table being independent of them. A leaked return width would give p+1 instead.
    assertBus(
      'module m(p, y); input [3:0] p; output [3:0] y;' +
        ' function [1:0] low(input [3:0] a); low = a; endfunction' +
        " assign y = low(p) + 4'd1; endmodule",
      busIn('p', 4),
      busIn('y', 4),
      (bits) => numBits(((num(bits.slice(0, 4)) & 3) + 1) & 15, 4),
    )
  })

  test('an ARGUMENT is truncated to its formal width', () => {
    // formal a is 2-bit; the 4-bit p is truncated to p[1:0] at the call boundary.
    assertBusPartial(
      'module m(p, y); input [3:0] p; output [3:0] y;' +
        ' function [3:0] dbl(input [1:0] a); dbl = a + a; endfunction' +
        ' assign y = dbl(p); endmodule',
      busIn('p', 2),
      busIn('y', 4),
      (bits) => numBits(((num(bits.slice(0, 2)) & 3) * 2) & 15, 4),
    )
  })

  test('an intermediate LOCAL truncates to its declared width (the sized wall)', () => {
    // lo is 2-bit, so `lo = a` keeps only a[1:0]; f returns lo zero-extended → y = p&3, independent of p[2..3].
    // Symbolic inlining (the reverted approach) would leak a's full width and give y = p.
    assertBus(
      'module m(p, y); input [3:0] p; output [3:0] y;' +
        ' function [3:0] f(input [3:0] a); reg [1:0] lo; begin lo = a; f = lo; end endfunction' +
        ' assign y = f(p); endmodule',
      busIn('p', 4),
      busIn('y', 4),
      (bits) => numBits(num(bits.slice(0, 4)) & 3, 4),
    )
  })
})

describe('functions — control flow + nesting', () => {
  test('a function with if/else selects the return value', () => {
    assertBus(
      'module m(s, p, q, y); input s; input [1:0] p; input [1:0] q; output [1:0] y;' +
        ' function [1:0] pick(input c, input [1:0] a, input [1:0] b);' +
        ' if (c) pick = a; else pick = b; endfunction' +
        ' assign y = pick(s, p, q); endmodule',
      ['s', ...busIn('p', 2), ...busIn('q', 2)],
      busIn('y', 2),
      (bits) => (bits[0] ? numBits(num(bits.slice(1, 3)), 2) : numBits(num(bits.slice(3, 5)), 2)),
    )
  })

  test('a function calling another function (nested inline)', () => {
    assertBus(
      'module m(p, y); input [1:0] p; output [1:0] y;' +
        ' function [1:0] inc(input [1:0] a); inc = a + 1; endfunction' +
        ' function [1:0] inc2(input [1:0] a); inc2 = inc(inc(a)); endfunction' +
        ' assign y = inc2(p); endmodule',
      busIn('p', 2),
      busIn('y', 2),
      (bits) => numBits((num(bits.slice(0, 2)) + 2) & 3, 2),
    )
  })
})

describe('functions — honest reporting', () => {
  test('a recursive function is reported, not inlined forever', () => {
    reported(
      'module m(p, y); input [3:0] p; output [3:0] y;' +
        ' function [3:0] f(input [3:0] a); f = f(a); endfunction' +
        ' assign y = f(p); endmodule',
      'recursive',
    )
  })

  test('a call to an unknown function is reported', () => {
    reported(
      'module m(p, y); input [1:0] p; output [1:0] y; assign y = nope(p); endmodule',
      'unknown function',
    )
  })

  test('a call with the wrong argument count is reported', () => {
    reported(
      'module m(p, y); input [1:0] p; output [1:0] y;' +
        ' function [1:0] add(input [1:0] a, input [1:0] b); add = a + b; endfunction' +
        ' assign y = add(p); endmodule',
      'argument',
    )
  })
})

// Regression guards for the adversarial review of the function inliner (the silent-zero class it flagged).
describe('functions — review hardening', () => {
  test('an unsynthesizable BODY (** in it) is reported, not silently inlined to zero', () => {
    reported(
      'module m(p, y); input [3:0] p; output [3:0] y;' +
        ' function [3:0] f(input [3:0] a); reg [3:0] t; begin t = a ** 2; f = t; end endfunction' +
        ' assign y = f(p); endmodule',
      'not synthesizable',
    )
  })

  test('a function that never assigns its return is reported, not silent zero', () => {
    reported(
      'module m(p, y); input [3:0] p; output [3:0] y;' +
        ' function [3:0] f(input [3:0] a); reg [3:0] t; begin t = a; end endfunction' +
        ' assign y = f(p); endmodule',
      'never assigns',
    )
  })

  test('a function whose body calls an unknown function is reported', () => {
    reported(
      'module m(p, y); input [3:0] p; output [3:0] y;' +
        ' function [3:0] f(input [3:0] a); f = g(a); endfunction' +
        ' assign y = f(p); endmodule',
      'unknown function',
    )
  })

  test('a function with a nonzero-based formal range is reported, not built at width 1', () => {
    reported(
      'module m(p, y); input [7:0] p; output [7:0] y;' +
        ' function [7:0] f(input [8:1] a); f = a; endfunction' +
        ' assign y = f(p); endmodule',
      'unsupported declaration',
    )
  })

  test('an `integer` local is 32-bit, not silently 1-bit (y = 2*p)', () => {
    assertBus(
      'module m(p, y); input [3:0] p; output [7:0] y;' +
        ' function [7:0] f(input [3:0] a); integer t; begin t = a + a; f = t; end endfunction' +
        ' assign y = f(p); endmodule',
      busIn('p', 4),
      busIn('y', 8),
      (bits) => numBits((num(bits.slice(0, 4)) * 2) & 255, 8),
    )
  })

  test('a constant function argument folds correctly (y = 2 ^ p)', () => {
    assertBus(
      'module m(p, y); input [1:0] p; output [1:0] y;' +
        ' function [1:0] f(input [1:0] a); f = a; endfunction' +
        " assign y = f(2'b10) ^ p; endmodule",
      busIn('p', 2),
      busIn('y', 2),
      (bits) => [bits[0] as boolean, !(bits[1] as boolean)],
    )
  })

  test('a task definition does not corrupt the parse — its decls do not leak as ports, the real gate builds', () => {
    // The task is captured as a whole unit (uncalled → no warning); its `input b` must NOT leak in as a module
    // port, and the `buf g(y, a)` that follows it must still build (y = a).
    const { block, warnings } = importVerilog(
      'module m(a, y); input a; output y; task t; input b; begin end endtask buf g(y, a); endmodule',
    )
    expect(warnings, `warnings: ${warnings.join(' | ')}`).toEqual([])
    const tt = characterizeBlock(block as BlockData)
    expect(tt).not.toBeNull()
    if (tt === null) return
    expect(tt.inputs).toEqual(['a'])
    for (const row of tt.rows) expect(row.out).toEqual([row.in[0]])
  })
})
