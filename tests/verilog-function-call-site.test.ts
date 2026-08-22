/**
 * A FUNCTION BODY IS ELABORATED FOR THE CALL SITE IT IS BUILT AT.
 *
 * A function's formals are ordinary nets inside its body, so a slice whose base is built from one — the
 * `nib = v[k*4 +: 4]` idiom — could not be proved to stay inside its net no matter what the caller passed.
 * Every call was refused, including the ones that pass nothing but constants.
 *
 * Two things make those build. `valueRange` now SETTLES a base that reads nothing but literals instead of
 * estimating it (an `integer` local holding 3 is a signed 32-bit type wall around the literal 3, and every
 * estimate gives up on a signed operand). And `inlineCall` specialises the body to the call site: a formal
 * whose actual is a compile-time constant becomes that constant inside the body.
 *
 * The third change is the one that matters most. The gate every driver runs used to stop at a call's
 * ARGUMENTS, so a select this importer cannot bound inside a BODY met no gate at all — synthesis answered it
 * with x, the assign driver dropped those bits, and the module published with the pins missing. That is a
 * design that imports and disagrees with Icarus, which is the one outcome this importer must never produce.
 * The gate descends into the body now, so an unprovable body refuses the module.
 *
 * EVERY expected number here is Icarus Verilog 14.0 (oss-cad-suite) on the same source, read through a 32-bit
 * probe wider than any value these designs carry. Nothing is read off current behaviour.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const supply = (volts: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
})
const src = (id: string, volts: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(volts) },
})
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

const said = (warnings: string[]): string => warnings.join(' | ')

/** Import `verilog` expecting a design, and check every one of `outBits` output pins is published — a pin the
 *  source declares and the block omits is exactly the failure these tests exist to catch. */
function build(verilog: string, outBits: number): BlockData {
  const { block, warnings } = importVerilog(verilog)
  expect(block, said(warnings)).not.toBeNull()
  const pins = new Set((block as BlockData).ports.map((p) => p.id))
  for (let b = 0; b < outBits; b++) expect(pins.has(`y[${b}]`), `y[${b}] is published`).toBe(true)
  return block as BlockData
}

/** Read `y` at 32 bits with every named input driven on every one of its declared pins. */
function read(block: BlockData, ins: Record<string, number>): number {
  const nodes: CanvasNodeLike[] = [
    { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    src('vp', 5),
  ]
  const edges: CanvasEdgeLike[] = [
    w('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
    w('eg', 'M', 'gnd', 'g', 'reference_terminal'),
    w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
  ]
  const have = new Set(block.ports.map((p) => p.id))
  let n = 0
  for (const [name, value] of Object.entries(ins))
    for (let bit = 0; bit < 32; bit++) {
      // A one-bit port is named plain `a`, a vector port `a[0]` — a probe that knows only the vector spelling
      // reads nothing at all from a scalar and calls a correct build a wrong answer.
      const pin = bit === 0 && have.has(name) ? name : `${name}[${bit}]`
      if (!have.has(pin)) continue
      const vid = `v${n++}`
      nodes.push(src(vid, ((value >> bit) & 1) === 1 ? 5 : 0))
      edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', pin))
      edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
    }
  const result = simulateLogic(nodes, edges, new Map())
  let out = 0
  for (let bit = 0; bit < 32; bit++) if (result.value('M', `y[${bit}]`) === true) out += 2 ** bit
  return out
}

/** Import `verilog` expecting NO published design, and return what it said. */
function refusal(verilog: string): string {
  const { block, warnings } = importVerilog(verilog)
  expect(block, `expected a refusal, got a design — ${said(warnings)}`).toBeNull()
  return said(warnings)
}

/** The three 16-bit vectors every expectation below was measured at. */
const A_VECTORS = [0xbaff, 0x1234, 0xcafe]
const sweep = (block: BlockData): number[] => A_VECTORS.map((a) => read(block, { a }))

const NIB = `  function [3:0] nib;
    input [15:0] v;
    input [31:0] k;
    begin
      nib = v[k*4 +: 4];
    end
  endfunction
`

describe('a constant argument bounds a slice inside the body', () => {
  test('a [31:0] formal used as a slice base, called only with constants (Icarus: bf 14 ce)', () => {
    expect(
      sweep(
        build(
          `module top(input [15:0] a, output [31:0] y);
${NIB}  assign y = {nib(a,3), nib(a,0)};
endmodule
`,
          8,
        ),
      ),
    ).toEqual([0xbf, 0x14, 0xce])
  })

  test('the same body with an "integer" formal (Icarus: bf 14 ce)', () => {
    expect(
      sweep(
        build(
          `module top(input [15:0] a, output [31:0] y);
${NIB.replace('input [31:0] k;', 'input integer k;')}  assign y = {nib(a,3), nib(a,0)};
endmodule
`,
          8,
        ),
      ),
    ).toEqual([0xbf, 0x14, 0xce])
  })

  test('a nested call passes its own constants down (Icarus: bf 13 cf)', () => {
    expect(
      sweep(
        build(
          `module top(input [15:0] a, output [31:0] y);
${NIB}  function [7:0] two;
    input [15:0] v;
    begin
      two = {nib(v,3), nib(v,1)};
    end
  endfunction
  assign y = two(a);
endmodule
`,
          8,
        ),
      ),
    ).toEqual([0xbf, 0x13, 0xcf])
  })

  test('a NEGATIVE "integer" argument survives the specialisation (Icarus: fc00 d000 f800)', () => {
    // `v << -1` shifts by 32'hFFFFFFFF, so that half of y is 0 — the answer only comes out if the argument
    // stays SIGNED on its way into the body.
    expect(
      sweep(
        build(
          `module top(input [15:0] a, output [31:0] y);
  function [7:0] shl;
    input [7:0] v;
    input integer k;
    begin
      shl = v << k;
    end
  endfunction
  assign y = {shl(a[7:0], 2), shl(a[7:0], -1)};
endmodule
`,
          16,
        ),
      ),
    ).toEqual([0xfc00, 0xd000, 0xf800])
  })
})

describe('an "integer" local holding a constant bounds a slice inside the body', () => {
  test('integer k; k = 3; nib = v[k*4 +: 4] (Icarus: b 1 c)', () => {
    expect(
      sweep(
        build(
          `module top(input [15:0] a, output [31:0] y);
  function [3:0] nib;
    input [15:0] v;
    integer k;
    begin
      k = 3;
      nib = v[k*4 +: 4];
    end
  endfunction
  assign y = nib(a);
endmodule
`,
          4,
        ),
      ),
    ).toEqual([0xb, 0x1, 0xc])
  })

  test('a NEGATIVE "integer" local is refused, not read as four billion', () => {
    const why = refusal(
      `module top(input [15:0] a, output [31:0] y);
  function [3:0] nib;
    input [15:0] v;
    integer k;
    begin
      k = -1;
      nib = v[k*4 +: 4];
    end
  endfunction
  assign y = nib(a);
endmodule
`,
    )
    expect(why).toContain('inside function "nib"')
  })
})

describe('the gate reaches into the body, so an x can never reach a published pin', () => {
  test('the vector that used to publish 0x14 where Icarus reads 0x15 (Icarus: 15 14 14)', () => {
    // THE MEASURED REGRESSION, and the sharpest form of it: the body's slice came back x, the comparison
    // folded that x to a definite 0, y[0] was dropped, and the design answered a number Verilog does not
    // give. The base is the constant 0, so the honest answer is a BUILD — this reads it at all three vectors.
    expect(
      sweep(
        build(
          `module top(input [15:0] a, output [31:0] y);
${NIB}  assign y = {28'h000000a, (nib(a,0) == 4'hf)};
endmodule
`,
          29,
        ),
      ),
    ).toEqual([0x15, 0x14, 0x14])
  })

  test('a constant base that leaves the net refuses through TWO levels of call', () => {
    const why = refusal(
      `module top(input [15:0] a, output [31:0] y);
${NIB}  function [3:0] one;
    input [15:0] v;
    begin
      one = nib(v, 9);
    end
  endfunction
  assign y = one(a);
endmodule
`,
    )
    expect(why).toContain('inside function "one", inside function "nib"')
    expect(why).toContain('can reach bits [39:36] of the 16-bit net "v"')
  })
})
