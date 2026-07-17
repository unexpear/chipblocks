/**
 * Verilog IMPORT — structural Verilog → placed ChipBlocks gates. What must be true: the eight gate
 * primitives read back into real gate cells that SIMULATE correctly (proven by truth table from the logic
 * engine, not by counting gates); N-input primitives decompose into 2-input trees with the RIGHT boolean
 * function (the nand/nor/xnor "invert exactly once" rule — never an inverting chain); the round-trip
 * export→import→export is faithful; and anything outside the structural subset is REPORTED, never faked.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import {
  AND_BLOCK,
  BUFFER_BLOCK,
  INVERTER_BLOCK,
  MUX2_1BIT,
  NAND2_BLOCK,
  NOR2_BLOCK,
  OR_BLOCK,
  XNOR_BLOCK,
  XOR_BLOCK,
} from '../src/renderer/builtin-blocks.ts'
import { characterizeBlock } from '../src/renderer/logic-sim.ts'
import { exportVerilog } from '../src/renderer/verilog.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

/** Assert that `block`, driven through the real logic engine, computes `fn` over inputs in the given order. */
function assertTruth(
  block: BlockData | null,
  inNames: string[],
  fn: (bits: boolean[]) => boolean,
): void {
  expect(block).not.toBeNull()
  const tt = characterizeBlock(block as BlockData)
  expect(tt, 'block should characterize as combinational').not.toBeNull()
  if (tt === null) return
  expect(tt.inputs).toEqual(inNames)
  expect(tt.outputs.length).toBe(1)
  for (const row of tt.rows) {
    expect(row.out[0], `inputs ${row.in.join(',')}`).toBe(fn(row.in))
  }
}

/** The gate keyword multiset of a Verilog string (for structural round-trip comparison). */
function gateMultiset(verilog: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const m of verilog.matchAll(/^\s*(and|or|not|nand|nor|xor|xnor|buf) g\d+\(/gm)) {
    const kw = m[1] as string
    counts[kw] = (counts[kw] ?? 0) + 1
  }
  return counts
}

describe('Verilog import — structural Verilog → gates', () => {
  test('every 2-input primitive round-trips functionally (export → import → same truth table)', () => {
    const gates: [string, BlockData][] = [
      ['NAND', NAND2_BLOCK],
      ['NOR', NOR2_BLOCK],
      ['AND', AND_BLOCK],
      ['OR', OR_BLOCK],
      ['XOR', XOR_BLOCK],
      ['XNOR', XNOR_BLOCK],
    ]
    for (const [label, block] of gates) {
      const { verilog } = exportVerilog(block)
      const { block: back, warnings } = importVerilog(verilog)
      expect(warnings, `${label} clean round-trip has no warnings`).toEqual([])
      expect(characterizeBlock(back as BlockData), label).toEqual(characterizeBlock(block))
    }
  })

  test('the inverter and buffer round-trip functionally', () => {
    for (const block of [INVERTER_BLOCK, BUFFER_BLOCK]) {
      const { block: back } = importVerilog(exportVerilog(block).verilog)
      expect(characterizeBlock(back as BlockData)).toEqual(characterizeBlock(block))
    }
  })

  test('a whole composite (the 2:1 mux) round-trips functionally AND structurally, with no warnings', () => {
    const { verilog } = exportVerilog(MUX2_1BIT)
    const { block, warnings } = importVerilog(verilog)
    expect(warnings).toEqual([])
    // functional: the imported gates compute sel ? x : y, exactly like the source
    expect(characterizeBlock(block as BlockData)).toEqual(characterizeBlock(MUX2_1BIT))
    // structural: re-exporting gives the same gate multiset (not, and, and, or)
    expect(gateMultiset(exportVerilog(block as BlockData).verilog)).toEqual(gateMultiset(verilog))
  })

  test('N-input primitives decompose to the CORRECT boolean function (the odd-N trap)', () => {
    // nand3 = ~(a&b&c), NOT the ~(~(a&b)&c) an inverting-chain would give
    assertTruth(
      importVerilog('module m(a,b,c,o); input a,b,c; output o; nand g(o,a,b,c); endmodule').block,
      ['a', 'b', 'c'],
      ([a, b, c]) => !((a as boolean) && (b as boolean) && (c as boolean)),
    )
    // nor3 = ~(a|b|c)
    assertTruth(
      importVerilog('module m(a,b,c,o); input a,b,c; output o; nor g(o,a,b,c); endmodule').block,
      ['a', 'b', 'c'],
      ([a, b, c]) => !((a as boolean) || (b as boolean) || (c as boolean)),
    )
    // xnor3 = ~(a^b^c) — the classic trap: an xnor-chain would compute a^b^c for odd N
    assertTruth(
      importVerilog('module m(a,b,c,o); input a,b,c; output o; xnor g(o,a,b,c); endmodule').block,
      ['a', 'b', 'c'],
      ([a, b, c]) => !(((a as boolean) !== (b as boolean)) !== (c as boolean)),
    )
    // and4 = a&b&c&d (associative tree)
    assertTruth(
      importVerilog('module m(a,b,c,d,o); input a,b,c,d; output o; and g(o,a,b,c,d); endmodule')
        .block,
      ['a', 'b', 'c', 'd'],
      (v) => v.every(Boolean),
    )
    // xor4 = a^b^c^d
    assertTruth(
      importVerilog('module m(a,b,c,d,o); input a,b,c,d; output o; xor g(o,a,b,c,d); endmodule')
        .block,
      ['a', 'b', 'c', 'd'],
      (v) => v.filter(Boolean).length % 2 === 1,
    )
  })

  test('n_output not with multiple outputs fans out to independent inverters', () => {
    // not (y1, y2, a): last terminal a is the shared input; y1 and y2 are both ~a
    const { block } = importVerilog(
      'module m(a,y1,y2); input a; output y1,y2; not (y1,y2,a); endmodule',
    )
    const tt = characterizeBlock(block as BlockData)
    expect(tt).not.toBeNull()
    if (tt === null) return
    expect(tt.inputs).toEqual(['a'])
    expect(tt.outputs).toEqual(['y1', 'y2'])
    for (const row of tt.rows) expect(row.out).toEqual([!row.in[0], !row.in[0]])
  })

  test('anonymous, multi-instance, and comment-laden gate statements all parse', () => {
    // two anonymous ANDs in one statement, with a block comment splitting a terminal list
    const { block, warnings } = importVerilog(
      'module m(a,b,c,d,o0,o1); input a,b,c,d; output o0,o1; and (o0,a,/* pick */ b), (o1,c,d); endmodule',
    )
    expect(warnings).toEqual([])
    const tt = characterizeBlock(block as BlockData)
    expect(tt).not.toBeNull()
    if (tt === null) return
    expect(tt.outputs).toEqual(['o0', 'o1'])
    for (const row of tt.rows) {
      const [a, b, c, d] = row.in
      expect(row.out).toEqual([(a as boolean) && (b as boolean), (c as boolean) && (d as boolean)])
    }
  })

  test('an output port named "y" (not "out") is still recognized as an output', () => {
    // exercises drive-based classification, not the OUTPUT_PORT_IDS name list
    assertTruth(
      importVerilog('module m(a, y); input a; output y; buf g(y,a); endmodule').block,
      ['a'],
      ([a]) => a as boolean,
    )
  })

  test('the import is deterministic (same block across runs)', () => {
    const v = exportVerilog(MUX2_1BIT).verilog
    expect(importVerilog(v).block).toEqual(importVerilog(v).block)
  })
})

describe('Verilog import — honesty (unsupported constructs are reported, never faked)', () => {
  const has = (ws: string[], needle: string) => ws.some((w) => w.toLowerCase().includes(needle))

  test('a combinational always @* is now SYNTHESIZED into gates (see verilog-synth.test.ts for the truth tables)', () => {
    const { block, warnings } = importVerilog(
      'module m(input a, input b, output reg y); always @* y = a & b; endmodule',
    )
    expect(warnings, `warnings: ${warnings.join(' | ')}`).toEqual([])
    expect(block).not.toBeNull()
  })

  test('a non-primitive module/UDP instance is reported, not synthesized', () => {
    const { warnings } = importVerilog(
      'module m(a,y); input a; output y; my_cell u1(.i(a), .o(y)); endmodule',
    )
    expect(has(warnings, 'module/udp')).toBe(true)
  })

  test('the 18 non-mapped gate/switch primitives are reported', () => {
    for (const prim of ['bufif1', 'notif0', 'nmos', 'pmos', 'tran', 'pullup']) {
      const { warnings } = importVerilog(
        `module m(a,e,o); input a,e; output o; ${prim} g(o,a,e); endmodule`,
      )
      expect(has(warnings, 'no chipblocks gate'), prim).toBe(true)
    }
  })

  test('an inout port is reported (a vector port is now supported — see the synth bus tests)', () => {
    expect(has(importVerilog('module m(io); inout io; endmodule').warnings, 'inout')).toBe(true)
    // a nonzero-based / ascending bus range is still reported (only [N:0] is representable)
    expect(has(importVerilog('module m(a); input [7:4] a; endmodule').warnings, 'range')).toBe(true)
  })

  test('drive strength and delay are reported but the gate is still built', () => {
    const s = importVerilog(
      'module m(a,b,o); input a,b; output o; and (weak0,weak1) g(o,a,b); endmodule',
    )
    expect(has(s.warnings, 'drive strength')).toBe(true)
    assertTruth(s.block, ['a', 'b'], ([a, b]) => (a as boolean) && (b as boolean))
    const d = importVerilog('module m(a,b,o); input a,b; output o; and #3 g(o,a,b); endmodule')
    expect(has(d.warnings, 'delay')).toBe(true)
    assertTruth(d.block, ['a', 'b'], ([a, b]) => (a as boolean) && (b as boolean))
  })

  test('the DEFAULT drive strength (strong0,strong1) is NOT reported (it is a no-op)', () => {
    const { warnings } = importVerilog(
      'module m(a,b,o); input a,b; output o; and (strong1,strong0) g(o,a,b); endmodule',
    )
    expect(warnings.some((w) => w.includes('drive strength'))).toBe(false)
  })
})

describe('Verilog import — lexer robustness (never corrupts, always survives)', () => {
  test('an unterminated block comment is reported, not silently swallowed', () => {
    const { warnings } = importVerilog(
      'module m(a,o); input a; output o; buf g(o,a); /* oops no close',
    )
    expect(warnings.some((w) => w.includes('never closed'))).toBe(true)
  })

  test('a line comment containing ; and // does not truncate the following gate', () => {
    const { block } = importVerilog(
      'module m(a,b,o); input a,b; output o;\n// note: a; b; // tricky\nand g(o,a,b); endmodule',
    )
    assertTruth(block, ['a', 'b'], ([a, b]) => (a as boolean) && (b as boolean))
  })

  test('a `timescale directive is skipped silently; a `define is reported', () => {
    const ts = importVerilog(
      '`timescale 1ns/1ps\nmodule m(a,o); input a; output o; buf g(o,a); endmodule',
    )
    expect(ts.warnings).toEqual([])
    const def = importVerilog(
      '`define W 8\nmodule m(a,o); input a; output o; buf g(o,a); endmodule',
    )
    expect(def.warnings.some((w) => w.includes('define'))).toBe(true)
  })

  test('junk / empty input never throws — it returns a null block with a warning', () => {
    expect(importVerilog('').block).toBeNull()
    expect(importVerilog('@#$%^&').block).toBeNull()
    expect(() => importVerilog('module (((')).not.toThrow()
  })
})

describe('Verilog import — regressions from the adversarial review', () => {
  const has = (ws: string[], needle: string) => ws.some((w) => w.toLowerCase().includes(needle))

  test('ANSI header with a SHARED direction keeps every port (input a, b → both inputs)', () => {
    // `input a, b` declares BOTH as inputs — the direction must persist across the comma
    const { block, warnings } = importVerilog(
      'module m(input a, b, output o); and g(o, a, b); endmodule',
    )
    expect(warnings).toEqual([])
    assertTruth(block, ['a', 'b'], ([a, b]) => (a as boolean) && (b as boolean))
  })

  test('an ANSI header simple case (input a, output o) still works', () => {
    assertTruth(
      importVerilog('module m(input a, output o); buf g(o, a); endmodule').block,
      ['a'],
      ([a]) => a as boolean,
    )
  })

  test('a module named after a primitive but computing something else is simulated by its REAL cells', () => {
    // module named "AND" but its gate is an OR — must NOT be simulated as a 2-input AND by name
    const { block, warnings } = importVerilog(
      'module AND(a, b, o); input a, b; output o; or g0(o, a, b); endmodule',
    )
    expect(has(warnings, 'shares a name')).toBe(true)
    assertTruth(block, ['a', 'b'], ([a, b]) => (a as boolean) || (b as boolean))
  })

  test('a genuine single gate keeps its primitive name (faithful round-trip, no rename)', () => {
    // exportVerilog emits `module NAND(...)`; importing it back must stay named NAND and simulate as NAND
    const { block, warnings } = importVerilog(exportVerilog(NAND2_BLOCK).verilog)
    expect(warnings).toEqual([])
    expect((block as BlockData).name).toBe('NAND')
    expect(characterizeBlock(block as BlockData)).toEqual(characterizeBlock(NAND2_BLOCK))
  })

  test('an INPUT named like an output keyword (s, q, sum, carry…) is still an input', () => {
    // 's' is in OUTPUT_PORT_IDS; the declared `input s` must win over the name heuristic
    for (const nm of ['s', 'q', 'sum', 'carry', 'cout']) {
      assertTruth(
        importVerilog(`module m(${nm}, o); input ${nm}; output o; buf g(o, ${nm}); endmodule`)
          .block,
        [nm],
        ([x]) => x as boolean,
      )
    }
  })

  test('a signal port named like a power rail (gnd/vcc) stays a real signal, not a swallowed rail', () => {
    const { block, warnings } = importVerilog(
      'module m(a, gnd, o); input a, gnd; output o; nand g(o, a, gnd); endmodule',
    )
    expect(has(warnings, 'collides with a power rail')).toBe(true)
    const tt = characterizeBlock(block as BlockData)
    expect(tt).not.toBeNull()
    if (tt === null) return
    // two real inputs survive (renamed for the collision) → the NAND actually reads both
    expect(tt.inputs.length).toBe(2)
    expect(tt.outputs.length).toBe(1)
    // no two ports share an id (the synthesized v_dd/gnd no longer duplicate a signal id)
    const ids = (block as BlockData).ports.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('a net-declaration or port-declaration continuous assignment is reported (like assign)', () => {
    expect(
      has(
        importVerilog('module m(a,b,o); input a,b; output o; wire w = a & b; buf g(o,w); endmodule')
          .warnings,
        'continuous assignment',
      ),
    ).toBe(true)
    expect(
      has(
        importVerilog('module m(a,b,o); input a,b; output o; output o2 = a & b; endmodule')
          .warnings,
        'continuous assignment',
      ),
    ).toBe(true)
  })

  test('a deep reverse-declared chain places without a stack overflow', () => {
    // depth() must be iterative: a chain far past the native recursion limit must not throw
    const N = 12000
    const lines = ['module m(a, o); input a; output o;']
    lines.push('buf b0(o, w1);')
    for (let k = 1; k < N - 1; k++) lines.push(`buf b${k}(w${k}, w${k + 1});`)
    lines.push(`buf b${N - 1}(w${N - 1}, a);`)
    lines.push('endmodule')
    let result: ReturnType<typeof importVerilog> | undefined
    expect(() => {
      result = importVerilog(lines.join('\n'))
    }).not.toThrow()
    expect((result?.block as BlockData).nodes.length).toBe(N)
  })
})
