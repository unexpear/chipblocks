/**
 * WHICH MODULE IS THE DESIGN — a source file holds several modules, and the importer builds ONE of them: the
 * module nothing else instantiates.
 *
 * That rule leans on a complete instantiation graph, and a construct this importer skips can hide an
 * instantiation from it. A `generate` body is never parsed, so a module instantiated only in there still
 * looks top-level. Picking it publishes a DIFFERENT module than the source describes — the same port names,
 * different logic, and nothing said about the answer being wrong. Measured against Icarus Verilog 14.0, one
 * such file (a top module whose only sub-module instance sat inside a `generate`) built and disagreed with
 * Icarus on 256 of its 1,024 output bits, with no warning about the ANSWER.
 *
 * So a module named inside a span the importer swallowed without parsing is not a CERTAIN root. When exactly
 * one certain root is left, that root is the design — and it then refuses on its own unbuilt nets, which is
 * the honest outcome. The values below are checked by EXECUTION on the logic engine, not by reading warnings
 * alone, so a test cannot pass on a design that publishes the wrong logic.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { characterizeBlock } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

/** `o` for one (a, b) pair, read off the block's real gates. Null when the design was refused. */
function outputOf(block: BlockData | null, a: number, b: number): number | null {
  if (block === null) return null
  const table = characterizeBlock(block)
  if (table === null) return null
  let row = 0
  for (let i = 0; i < table.inputs.length; i++) {
    const pin = /^([ab])\[([0-3])\]$/.exec(table.inputs[i] as string)
    if (pin === null) throw new Error(`unexpected input pin ${table.inputs[i]}`)
    const value = pin[1] === 'a' ? a : b
    if (((value >> Number(pin[2])) & 1) === 1) row |= 1 << i
  }
  const bits = table.rows[row]
  if (bits === undefined) throw new Error('missing row')
  let out = 0
  for (let bit = 0; bit < 4; bit++) {
    const at = table.outputs.indexOf(`o[${bit}]`)
    if (at !== -1 && bits.out[at] === true) out |= 1 << bit
  }
  return out
}

function outputFor(source: string, a: number, b: number): number | null {
  return outputOf(importVerilog(source).block, a, b)
}

const XOR_HELPER = `module m2(a, b, o);
  input [3:0] a;
  input [3:0] b;
  output [3:0] o;
  assign o = a ^ b;
endmodule
`
const PORTS = `  input [3:0] a;
  input [3:0] b;
  output [3:0] o;
`

describe('the design is not swapped for a module a skipped construct was hiding', () => {
  // Icarus Verilog 14.0 on both sources below, all 256 vectors: o = (a ^ b) | b. Publishing m2 instead gives
  // o = a ^ b, which differs on every bit where a and b are both 1 — 256 of the 1,024 output bits.
  //
  // The generate-IF here is one this importer CANNOT elaborate: `$clog2` is a real constant function that
  // Icarus folds and this evaluator does not parse, so the region is left exactly as written and m2 goes back
  // inside a span nobody parsed. That is the shape this whole file exists to catch, and it has to keep being
  // testable with a construct the importer genuinely skips as more of them become elaboratable.
  const hiddenInsideGenerate = `${XOR_HELPER}module m(a, b, o);
${PORTS}  wire [3:0] t;
  generate if ($clog2(8) == 3) begin: gg
    m2 u (a, b, t);
  end endgenerate
  assign o = t | b;
endmodule
`

  test('a sub-module instantiated only inside a "generate" is not published as the design', () => {
    const result = importVerilog(hiddenInsideGenerate)
    expect(result.moduleName).not.toBe('m2')
    expect(result.block).toBeNull()
    expect(result.warnings.some((w) => w.includes('generate'))).toBe(true)
  })

  test('and it does not quietly compute m2 logic — a=0b0011 b=0b0001 must not read 0b0010', () => {
    // m2 alone would answer 3 ^ 1 = 2. The real module answers (3 ^ 1) | 1 = 3.
    expect(outputFor(hiddenInsideGenerate, 0b0011, 0b0001)).toBeNull()
  })

  test('a generate IF this importer CAN elaborate makes the instance real, and the top right', () => {
    // The other direction, and the one that has to move as the front end grows: the condition folds, the
    // region becomes ordinary module items before the root is chosen, m2 is instantiated for real, and m is
    // the only root left. The value is the check that matters — a design that quietly published m2 instead
    // would read 2 where this reads 3.
    const source = `${XOR_HELPER}module m(a, b, o);
${PORTS}  wire [3:0] t;
  generate if (1) begin: gg
    m2 u (a, b, t);
  end endgenerate
  assign o = t | b;
endmodule
`
    const result = importVerilog(source)
    expect(result.moduleName).toBe('m')
    expect(result.block).not.toBeNull()
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) expect(outputFor(source, a, b)).toBe((a ^ b) | b)
  })

  test('a bare "for" generate loop is ELABORATED, so its instance is real and the top is right', () => {
    // The loop is unrolled before the module is parsed, so `m2 u (a, b, t)` is an ordinary instantiation by
    // the time the root is chosen — m2 is instantiated, m is the only root, and the design BUILDS. The value
    // is the check that matters: Icarus Verilog 14.0 on this source gives o = (a ^ b) | b for all 256
    // vectors, so a design that quietly published m2 instead would read 2 here where this reads 3.
    const source = `${XOR_HELPER}module m(a, b, o);
${PORTS}  wire [3:0] t;
  genvar gi;
  for (gi = 0; gi < 1; gi = gi + 1) begin: gg
    m2 u (a, b, t);
  end
  assign o = t | b;
endmodule
`
    const result = importVerilog(source)
    expect(result.moduleName).toBe('m')
    expect(result.block).not.toBeNull()
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) expect(outputFor(source, a, b)).toBe((a ^ b) | b)
  })

  test('a bare "for" this importer CANNOT unroll still hides its instance, and is still caught', () => {
    // The bound is a net, so there is no elaboration-time iteration count and the loop is left exactly as it
    // was — which puts m2 back inside a span nobody parsed. The doubt has to come back with it.
    const source = `${XOR_HELPER}module m(a, b, o);
${PORTS}  wire [3:0] t;
  genvar gi;
  for (gi = 0; gi < a; gi = gi + 1) begin: gg
    m2 u (a, b, t);
  end
  assign o = t | b;
endmodule
`
    const result = importVerilog(source)
    expect(result.moduleName).not.toBe('m2')
    expect(result.block).toBeNull()
  })

  test('with a third, genuinely top-level module the choice still never lands on the hidden one', () => {
    const source = `${XOR_HELPER}module spare(a, b, o);
${PORTS}  assign o = a & b;
endmodule
module m(a, b, o);
${PORTS}  wire [3:0] t;
  generate if ($clog2(8) == 3) begin: gg
    m2 u (a, b, t);
  end endgenerate
  assign o = t | b;
endmodule
`
    const result = importVerilog(source)
    expect(result.moduleName).not.toBe('m2')
    expect(['spare', 'm']).toContain(result.moduleName)
    expect(result.warnings.some((w) => w.includes('would not have been seen'))).toBe(true)
  })

  test('a module NAMED in a skipped generate loses only its claim to be the top, not its own import', () => {
    // `other` is used as a NET name inside m's generate-IF, which this importer still does not build. That is
    // not an instantiation, but the importer cannot tell — and treating it as one still lands on the right
    // module here, so the doubt is free.
    const source = `module other(a, b, o);
${PORTS}  assign o = a & b;
endmodule
module m(a, b, o);
${PORTS}  wire [3:0] other;
  generate if ($clog2(8) == 3) begin: gg
    assign other = a;
  end endgenerate
  assign o = other | b;
endmodule
`
    expect(importVerilog(source).moduleName).toBe('m')
  })

  test('once the generate IS elaborated the doubt lifts, and the ambiguity is said out loud', () => {
    // The same file with a `for` this importer can unroll: nothing is left unparsed, so `other` is an
    // ordinary net and BOTH modules genuinely look top-level. Which one is imported is then the pre-existing
    // several-roots case — and the importer has to say so rather than pick in silence.
    const source = `module other(a, b, o);
${PORTS}  assign o = a & b;
endmodule
module m(a, b, o);
${PORTS}  wire [3:0] other;
  genvar i;
  generate for (i = 0; i < 4; i = i + 1) begin: gg
    assign other[i] = a[i];
  end endgenerate
  assign o = other | b;
endmodule
`
    const result = importVerilog(source)
    expect(['other', 'm']).toContain(result.moduleName)
    expect(result.warnings.some((w) => w.includes(`importing "${result.moduleName}"`))).toBe(true)
    expect(result.warnings.some((w) => w.includes('would not have been seen'))).toBe(false)
  })

  test('a module that only mentions ITSELF inside a skipped generate is still a candidate', () => {
    // Self-instantiation is illegal Verilog, so a module's own name in its own generate can never be a
    // hidden instance of it. Without that exemption the file below would import "other" instead.
    const source = `module m(a, b, o);
${PORTS}  wire [3:0] t;
  genvar i;
  generate for (i = 0; i < 4; i = i + 1) begin: m
    assign t[i] = a[i];
  end endgenerate
  assign o = t | b;
endmodule
module other(a, b, o);
${PORTS}  assign o = a & b;
endmodule
`
    expect(importVerilog(source).moduleName).toBe('m')
  })
})

describe('an ordinary multi-module file is untouched by that doubt', () => {
  test('a normally instantiated sub-module still makes its parent the top, and it executes', () => {
    const source = `module sub(x, y);
  input [3:0] x;
  output [3:0] y;
  assign y = ~x;
endmodule
module m(a, b, o);
${PORTS}  wire [3:0] t;
  sub u (a, t);
  assign o = t & b;
endmodule
`
    const result = importVerilog(source)
    expect(result.moduleName).toBe('m')
    expect(result.warnings).toEqual([])
    // (~0b0011) & 0b1111 = 0b1100
    expect(outputFor(source, 0b0011, 0b1111)).toBe(0b1100)
  })

  test('two independent top-level modules still import one of them, and say which', () => {
    const source = `module other(a, b, o);
${PORTS}  assign o = a & b;
endmodule
module m(a, b, o);
${PORTS}  assign o = a | b;
endmodule
`
    const result = importVerilog(source)
    expect(['other', 'm']).toContain(result.moduleName)
    expect(result.warnings.some((w) => w.includes(`importing "${result.moduleName}"`))).toBe(true)
  })

  test('a chosen top is never a module the importer just worked out is instantiated by another', () => {
    // `deep` is instantiated by `mid`, so it cannot be the design however early it is declared.
    const source = `module deep(a, b, o);
${PORTS}  assign o = a & b;
endmodule
module mid(a, b, o);
${PORTS}  wire [3:0] w;
  deep v (a, b, w);
  assign o = w ^ b;
endmodule
module m(a, b, o);
${PORTS}  wire [3:0] t;
  generate if (1) begin: gg
    mid u (a, b, t);
  end endgenerate
  assign o = t | b;
endmodule
`
    expect(importVerilog(source).moduleName).not.toBe('deep')
  })
})

/**
 * AND THE CHOICE CANNOT DEPEND ON THE ORDER THE FILES WERE PICKED IN.
 *
 * Measured on the real die-derived Intel 8080: `sys8080.v + vm80a_sync.v` built the 11,155-part system and ran
 * its program; the SAME TWO FILES the other way round refused, because the choice was "the first surviving
 * name in declaration order" and the reversed list put the thin board wrapper `vm80a` first — a genuine root
 * too, but one whose inout data bus this importer cannot represent. Same inputs, opposite result, decided by
 * the order the user happened to click the files in.
 *
 * The designs below are the same shapes, small enough to check by EXECUTION. Every expected value came from
 * Icarus Verilog 14.0 over all 256 (a, b) vectors, not from reading this importer's own output back.
 */
const CORE_AND_WRAPPER = `module wrap(a, d, y);
  input [3:0] a;
  inout [3:0] d;
  output [3:0] y;
  wire [3:0] t;
  core c (.a(a), .b(d), .y(t));
  assign d = 4'bzzzz;
  assign y = t;
endmodule
module core(a, b, y);
  input [3:0] a;
  input [3:0] b;
  output [3:0] y;
  assign y = a ^ b;
endmodule
`
const SYSTEM_ON_THAT_CORE = `module sys(a, b, o);
${PORTS}  wire [3:0] t;
  core c (.a(a), .b(b), .y(t));
  assign o = t | b;
endmodule
`

const TINY_ROOT = `module tiny(a, b, o);
${PORTS}  assign o = a & b;
endmodule
`
const LEAF = `module leaf(a, y);
  input [3:0] a;
  output [3:0] y;
  assign y = ~a;
endmodule
`
const BIG_ROOT = `module big(a, b, o);
${PORTS}  wire [3:0] t;
  leaf u (a, t);
  assign o = (t ^ b) | (a & b);
endmodule
`

const ALPHA = `module alpha(a, b, o);
${PORTS}  assign o = a & b;
endmodule
`
const BETA = `module beta(a, b, o);
${PORTS}  assign o = a | b;
endmodule
`

describe('which module is the design cannot depend on the order the files arrived in', () => {
  test('a two-file design imports the same way round either way, down to the warnings', () => {
    // Icarus Verilog 14.0 on `sys`, all 256 vectors: o = (a ^ b) | b. `wrap` is the other genuine root and
    // this importer must refuse it (inout data bus), so the design is `sys` whichever file came first.
    const system = { name: 'system.v', text: SYSTEM_ON_THAT_CORE }
    const wrapper = { name: 'wrapper.v', text: CORE_AND_WRAPPER }
    const forward = importVerilog([system, wrapper])
    const reversed = importVerilog([wrapper, system])
    expect(forward.moduleName).toBe('sys')
    expect(reversed.moduleName).toBe('sys')
    expect(reversed.warnings).toEqual(forward.warnings)
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) {
        expect(outputOf(forward.block, a, b)).toBe((a ^ b) | b)
        expect(outputOf(reversed.block, a, b)).toBe((a ^ b) | b)
      }
  })

  test('a root that could only ever be refused loses to one that can be built, and it says so', () => {
    const result = importVerilog([
      { name: 'wrapper.v', text: CORE_AND_WRAPPER },
      { name: 'system.v', text: SYSTEM_ON_THAT_CORE },
    ])
    expect(result.warnings.some((w) => w.includes('importing "sys"'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('cannot represent'))).toBe(true)
  })

  test('the real top is the design when it is declared LAST, and when it is declared first', () => {
    // Icarus Verilog 14.0 on `big`, all 256 vectors: o = ((~a) ^ b) | (a & b). `tiny` is the other root and
    // answers a & b, so a choice that landed on it would read 1 where this reads 15 at a = 0, b = 15.
    const lastPlace = importVerilog(`${TINY_ROOT}${LEAF}${BIG_ROOT}`)
    const firstPlace = importVerilog(`${BIG_ROOT}${LEAF}${TINY_ROOT}`)
    expect(lastPlace.moduleName).toBe('big')
    expect(firstPlace.moduleName).toBe('big')
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) {
        const expected = ((~a & 15) ^ b) | (a & b)
        expect(outputOf(lastPlace.block, a, b)).toBe(expected)
        expect(outputOf(firstPlace.block, a, b)).toBe(expected)
      }
  })

  test('two genuinely independent tops are separated by name, never by position', () => {
    // Nothing in the source tells these two apart — same size, both buildable, neither instantiates the
    // other. Icarus Verilog 14.0 on `alpha`, all 256 vectors: o = a & b.
    const betaFirst = importVerilog(`${BETA}${ALPHA}`)
    const alphaFirst = importVerilog(`${ALPHA}${BETA}`)
    expect(betaFirst.moduleName).toBe('alpha')
    expect(alphaFirst.moduleName).toBe('alpha')
    expect(betaFirst.warnings.some((w) => w.includes('chosen by name'))).toBe(true)
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) {
        expect(outputOf(betaFirst.block, a, b)).toBe(a & b)
        expect(outputOf(alphaFirst.block, a, b)).toBe(a & b)
      }
  })

  test('one module on its own is the design, with no choice to report', () => {
    // Icarus Verilog 14.0, all 256 vectors: o = (a + b) truncated to 4 bits.
    const source = `module solo(a, b, o);
${PORTS}  assign o = a + b;
endmodule
`
    const result = importVerilog(source)
    expect(result.moduleName).toBe('solo')
    expect(result.warnings.some((w) => w.includes('look top-level'))).toBe(false)
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) expect(outputOf(result.block, a, b)).toBe((a + b) & 15)
  })

  test('a root hidden by a construct this importer skips stays hidden in either file order', () => {
    // The doubt that keeps a hidden sub-module from being published as the design has to survive the files
    // being listed the other way round, or the whole guard is order-dependent too.
    const helper = { name: 'helper.v', text: XOR_HELPER }
    const design = {
      name: 'design.v',
      text: `module m(a, b, o);
${PORTS}  wire [3:0] t;
  generate if ($clog2(8) == 3) begin: gg
    m2 u (a, b, t);
  end endgenerate
  assign o = t | b;
endmodule
`,
    }
    for (const files of [
      [helper, design],
      [design, helper],
    ]) {
      const result = importVerilog(files)
      expect(result.moduleName).not.toBe('m2')
      expect(result.block).toBeNull()
    }
  })
})
