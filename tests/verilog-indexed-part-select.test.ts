/**
 * INDEXED PART-SELECTS — `w[base +: WIDTH]` and `w[base -: WIDTH]`, IEEE 1364-2005 §5.2.1.
 *
 * The width is constant and the base may be computed at run time; `+:` takes WIDTH bits going UP from base,
 * `-:` takes WIDTH bits ending AT base. That fixed width is what makes the slice synthesizable, and it is why
 * this is THE idiom for cutting a bus at a computed offset — `y[g*8 +: 8]` inside a generate loop, or
 * `bus[sel*8 +: 8]` for a byte mux. This importer used to refuse every one of them.
 *
 * A constant base folds to an ordinary `[hi:lo]`; a run-time base builds the same decode/read-mux a memory
 * read builds, but ONLY when every base value it can take keeps the whole slice inside the net. A slice that
 * leaves the net reads x in Verilog, which a two-valued netlist cannot carry, so an unprovable base is
 * refused rather than answered with zeros.
 *
 * EVERY expected number here is Icarus Verilog 14.0 (oss-cad-suite) on the same source, read through a
 * 32-bit probe wider than any value these designs carry. Nothing is read off current behaviour: this suite
 * has been green over wrong answers three times.
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

function build(verilog: string): BlockData {
  const { block, warnings } = importVerilog(verilog)
  expect(block, said(warnings)).not.toBeNull()
  return block as BlockData
}

/** Read `y` with the 8-bit input `a` held at `value`. Every `a` bit is DRIVEN, and every `y` bit is read at
 *  the full 32 bits, so a missing pin shows up as a wrong number rather than hiding behind a narrow probe. */
function yAt(block: BlockData, value: number): number {
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
  for (let bit = 0; bit < 8; bit++) {
    const pin = `a[${bit}]`
    if (!have.has(pin)) continue
    const vid = `v${bit}`
    nodes.push(src(vid, ((value >> bit) & 1) === 1 ? 5 : 0))
    edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', pin))
    edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
  }
  const result = simulateLogic(nodes, edges, new Map())
  let out = 0
  for (let bit = 0; bit < 32; bit++) if (result.value('M', `y[${bit}]`) === true) out += 2 ** bit
  return out
}

/** The four input vectors every expectation below was measured at. */
const VECTORS = [0xb4, 0x5a, 0x01, 0x80]

/** Build `verilog`, check all 32 output pins are published, and read `y` at each vector. */
function sweep(verilog: string): number[] {
  const block = build(verilog)
  const pins = new Set(block.ports.map((p) => p.id))
  for (let bit = 0; bit < 32; bit++)
    expect(pins.has(`y[${bit}]`), `y[${bit}] is published`).toBe(true)
  return VECTORS.map((v) => yAt(block, v))
}

/** Import `verilog` expecting NO published design, and return what it said. */
function refusal(verilog: string): string {
  const { block, warnings } = importVerilog(verilog)
  expect(block, `expected a refusal, got a design — ${said(warnings)}`).toBeNull()
  return said(warnings)
}

const mod = (body: string): string =>
  `module top(input [7:0] a, output [31:0] y);\n${body}\nendmodule\n`

describe('a CONSTANT base folds to an ordinary part-select', () => {
  test('a[3 +: 4] is a[6:3] (Icarus: 6 11 0 0)', () => {
    expect(sweep(mod('  assign y = a[3 +: 4];'))).toEqual([6, 11, 0, 0])
  })

  test('a[7 -: 4] is a[7:4] (Icarus: 11 5 0 8)', () => {
    expect(sweep(mod('  assign y = a[7 -: 4];'))).toEqual([11, 5, 0, 8])
  })

  test('a[3 -: 4] reaches exactly the bottom bit (Icarus: 4 10 1 0)', () => {
    expect(sweep(mod('  assign y = a[3 -: 4];'))).toEqual([4, 10, 1, 0])
  })

  test('a[4 +: 4] reaches exactly the top bit (Icarus: 11 5 0 8)', () => {
    expect(sweep(mod('  assign y = a[4 +: 4];'))).toEqual([11, 5, 0, 8])
  })

  test('a width of ONE is a bit-select: a[3 +: 1] (Icarus: 0 1 0 0)', () => {
    expect(sweep(mod('  assign y = a[3 +: 1];'))).toEqual([0, 1, 0, 0])
  })

  test('a[0 +: 8] is the whole net (Icarus: 180 90 1 128)', () => {
    expect(sweep(mod('  assign y = a[0 +: 8];'))).toEqual([180, 90, 1, 128])
  })

  test('a localparam base folds: a[B +: 3] with B = 2 (Icarus: 5 6 0 0)', () => {
    expect(sweep(mod('  localparam B = 2;\n  assign y = a[B +: 3];'))).toEqual([5, 6, 0, 0])
  })

  test('a parameter base folds: a[B -: 3] with B = 4 (Icarus: 5 6 0 0)', () => {
    expect(
      sweep(
        `module top #(parameter B = 4) (input [7:0] a, output [31:0] y);
  assign y = a[B -: 3];
endmodule
`,
      ),
    ).toEqual([5, 6, 0, 0])
  })

  test('a computed constant base folds: a[(1+1) +: 3] (Icarus: 5 6 0 0)', () => {
    expect(sweep(mod('  assign y = a[(1+1) +: 3];'))).toEqual([5, 6, 0, 0])
  })

  test('inside a concatenation: {a[4 +: 2], a[0 +: 2]} (Icarus: 12 6 1 0)', () => {
    expect(sweep(mod('  assign y = {a[4 +: 2], a[0 +: 2]};'))).toEqual([12, 6, 1, 0])
  })

  test('as a comparison operand (Icarus: 180 90 1 128)', () => {
    expect(sweep(mod("  assign y = (a[6 +: 2] == 2'b11) ? 32'd7 : {24'b0, a};"))).toEqual([
      180, 90, 1, 128,
    ])
  })

  test('on an instance port connection: .p(a[2 +: 4]) (Icarus: 2 9 15 15)', () => {
    expect(
      sweep(
        `module sub(input [3:0] p, output [3:0] q);
  assign q = ~p;
endmodule
module top(input [7:0] a, output [31:0] y);
  wire [3:0] q;
  sub u(.p(a[2 +: 4]), .q(q));
  assign y = q;
endmodule
`,
      ),
    ).toEqual([2, 9, 15, 15])
  })

  test('inside a function body (Icarus: 11 5 0 8)', () => {
    expect(
      sweep(
        mod(`  function [3:0] hi;
    input [7:0] v;
    begin
      hi = v[4 +: 4];
    end
  endfunction
  assign y = hi(a);`),
      ),
    ).toEqual([11, 5, 0, 8])
  })

  test('reading a register in a combinational block (Icarus: 75 165 30 15)', () => {
    expect(
      sweep(
        mod(`  reg [15:0] r;
  always @* r = {a, ~a};
  assign y = {r[8 +: 4], r[0 +: 4]};`),
      ),
    ).toEqual([75, 165, 30, 15])
  })
})

describe('a constant base as an ASSIGNMENT TARGET', () => {
  test('a procedural target in both directions (Icarus: 180 90 1 128)', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output reg [31:0] y);
  always @* begin
    y = 32'b0;
    y[4 +: 4] = a[7:4];
    y[3 -: 4] = a[3:0];
  end
endmodule
`,
      ),
    ).toEqual([180, 90, 1, 128])
  })

  test('a genvar target: y[g*8 +: 8] inside a generate loop (Icarus: 33751296 16843266 1 33554432)', () => {
    expect(
      sweep(
        mod(`  genvar g;
  generate
    for (g = 0; g < 4; g = g + 1) begin : blk
      assign y[g*8 +: 8] = {6'b0, a[g*2 +: 2]};
    end
  endgenerate`),
      ),
    ).toEqual([33751296, 16843266, 1, 33554432])
  })

  test('a per-copy wire driven through a genvar target (Icarus: 3165697717 1381914715 151323392 2290385537)', () => {
    expect(
      sweep(
        mod(`  genvar g;
  generate
    for (g = 0; g < 4; g = g + 1) begin : blk
      wire [7:0] w;
      assign w = a ^ (8'd1 << g);
      assign y[g*8 +: 8] = w;
    end
  endgenerate`),
      ),
    ).toEqual([3165697717, 1381914715, 151323392, 2290385537])
  })

  test('a target running off the top writes only the bits that exist (Icarus: 0 2147483648 1073741824 0)', () => {
    expect(
      sweep(
        mod(`  assign y[30 +: 4] = {2'b0, a[1:0]};
  assign y[29:0] = 30'b0;`),
      ),
    ).toEqual([0, 2147483648, 1073741824, 0])
  })
})

describe('a RUN-TIME base builds a read-mux, proved to stay inside the net', () => {
  test('a[s*2 +: 2] with a two-bit s (Icarus: 0 1 0 0)', () => {
    expect(
      sweep(
        mod(`  wire [1:0] s;
  assign s = a[1:0];
  assign y = a[s*2 +: 2];`),
      ),
    ).toEqual([0, 1, 0, 0])
  })

  test('a[s*2+1 -: 2] — the downward spelling (Icarus: 0 1 0 0)', () => {
    expect(
      sweep(
        mod(`  wire [1:0] s;
  assign s = a[1:0];
  assign y = a[s*2+1 -: 2];`),
      ),
    ).toEqual([0, 1, 0, 0])
  })

  test('a shifted base TRUNCATES at its own width: a[(s<<1) +: 2] (Icarus: 0 2 0 0)', () => {
    expect(
      sweep(
        mod(`  wire [1:0] s;
  assign s = a[1:0];
  assign y = a[(s<<1) +: 2];`),
      ),
    ).toEqual([0, 2, 0, 0])
  })

  test('a nibble mux into a 16-bit net (Icarus: 11 10 15 15)', () => {
    expect(
      sweep(
        mod(`  wire [15:0] w;
  assign w = {a, ~a};
  assign y = w[a[1:0]*4 +: 4];`),
      ),
    ).toEqual([11, 10, 15, 15])
  })

  test('the same mux written downward (Icarus: 11 10 15 15)', () => {
    expect(
      sweep(
        mod(`  wire [15:0] w;
  assign w = {a, ~a};
  assign y = w[a[1:0]*4+3 -: 4];`),
      ),
    ).toEqual([11, 10, 15, 15])
  })

  test('a concatenated base {a[1:0], 2’b0} bounds tightly enough to build (Icarus: 11 10 15 15)', () => {
    expect(
      sweep(
        mod(`  wire [15:0] w;
  assign w = {a, ~a};
  assign y = w[{a[1:0], 2'b0} +: 4];`),
      ),
    ).toEqual([11, 10, 15, 15])
  })

  test('a localparam stride: a[s*W +: W] (Icarus: 4 10 0 0)', () => {
    expect(
      sweep(
        mod(`  localparam W = 4;
  wire [0:0] s;
  assign s = a[0];
  assign y = a[s*W +: W];`),
      ),
    ).toEqual([4, 10, 0, 0])
  })

  test('read inside an always block (Icarus: 0 1 0 0)', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output reg [31:0] y);
  always @* y = a[a[1:0]*2 +: 2];
endmodule
`,
      ),
    ).toEqual([0, 1, 0, 0])
  })

  test('a real byte mux: bus[sel*8 +: 8] reads AA BB CC DD (Icarus: 170 187 204 221)', () => {
    const block = build(
      `module bytemux(input [1:0] sel, input [31:0] bus, output [7:0] y);
  assign y = bus[sel*8 +: 8];
endmodule
`,
    )
    const bus = 0xddccbbaa
    const read = (sel: number): number => {
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
      const drive = (pin: string, high: boolean, id: string) => {
        nodes.push(src(id, high ? 5 : 0))
        edges.push(w(`e${id}`, id, 'terminal_positive', 'M', pin))
        edges.push(w(`e${id}n`, id, 'terminal_negative', 'g', 'reference_terminal'))
      }
      const have = new Set(block.ports.map((p) => p.id))
      for (let bit = 0; bit < 2; bit++)
        if (have.has(`sel[${bit}]`)) drive(`sel[${bit}]`, ((sel >> bit) & 1) === 1, `s${bit}`)
      for (let bit = 0; bit < 32; bit++)
        if (have.has(`bus[${bit}]`)) drive(`bus[${bit}]`, ((bus >>> bit) & 1) === 1, `b${bit}`)
      const result = simulateLogic(nodes, edges, new Map())
      let out = 0
      for (let bit = 0; bit < 8; bit++) if (result.value('M', `y[${bit}]`) === true) out += 2 ** bit
      return out
    }
    expect([read(0), read(1), read(2), read(3)]).toEqual([170, 187, 204, 221])
  })
})

describe('what it REFUSES rather than answer with a value Verilog does not have', () => {
  test('a constant base running off the top end', () => {
    expect(refusal(mod('  assign y = a[5 +: 4];'))).toContain('a[8:5] is out of range')
  })

  test('a constant base running off the bottom end', () => {
    expect(refusal(mod('  assign y = a[2 -: 4];'))).toContain('a[2:-1] is out of range')
  })

  test('a NON-CONSTANT width, which is not synthesizable', () => {
    const why = refusal(
      mod(`  wire [1:0] s;
  assign s = a[1:0];
  assign y = a[0 +: s];`),
    )
    expect(why).toContain('is not a constant positive integer')
  })

  test('a run-time base that can reach past the end of the net', () => {
    const why = refusal(
      mod(`  wire [2:0] s;
  assign s = a[2:0];
  assign y = a[s +: 4];`),
    )
    expect(why).toContain('can reach bits [10:0] of the 8-bit net "a"')
  })

  test('a SIGNED base, which could be negative', () => {
    const why = refusal(
      mod(`  wire signed [2:0] s;
  assign s = a[2:0];
  assign y = a[s +: 2];`),
    )
    expect(why).toContain('cannot be bounded by this importer')
  })

  test('a run-time base on an assignment TARGET — a write position that moves', () => {
    const why = refusal(
      `module top(input [7:0] a, output reg [31:0] y);
  always @* begin
    y = 32'b0;
    y[a[1:0]*2 +: 2] = 2'b11;
  end
endmodule
`,
    )
    expect(why).toContain('a moving write position')
  })
})

/**
 * A SELECT THAT LEAVES ITS NET IS REFUSED WHEREVER IT IS WRITTEN.
 *
 * `assign y = a[9:6]` on an 8-bit `a` has always refused the whole module here. The same slice written inside
 * a function body used to PUBLISH instead — the bits outside the net came back x, the assign driver dropped
 * them, and the module went out with those pins missing. Two answers to one fault, and the published one is
 * the answer this importer must never give: MEASURED against Icarus Verilog 14.0, a body doing
 * `nib = v[k*4 +: 4]` behind `assign y = {28'h000000a, (nib(a,0) == 4'hf)};` published y = 0x14 at a = 0xbaff
 * where Icarus reads 0x15 — the x vanished behind the comparison and a wrong number reached a pin that WAS
 * published.
 *
 * So the gate every driver runs now descends into the body, and both spellings refuse. The pair below is the
 * whole point: whatever the two do, they must do the SAME thing.
 */
describe('a select that leaves its net refuses, inside a function body as at module scope', () => {
  test('v[9:6] on an eight-bit v refuses, exactly as a[9:6] does at module scope', () => {
    const inBody = refusal(
      mod(`  function [3:0] f;
    input [7:0] v;
    begin
      f = v[9:6];
    end
  endfunction
  assign y = f(a);`),
    )
    expect(inBody).toContain('inside function "f"')
    expect(inBody).toContain('part-select v[9:6] is out of range on the 8-bit net "v"')
    expect(refusal(mod('  assign y = a[9:6];'))).toContain(
      'part-select a[9:6] is out of range on the 8-bit net "a"',
    )
  })

  test('a base that cannot be bounded inside a body refuses rather than publishing an x', () => {
    // Icarus Verilog 14.0 reads y = x here at sel = 5 (the slice leaves the 16-bit net), and a two-valued
    // netlist has no x to carry — so there is no honest design to publish.
    const why = refusal(
      `module top(input [15:0] a, input [3:0] sel, output [31:0] y);
  function [3:0] nib;
    input [15:0] v;
    input [31:0] k;
    begin
      nib = v[k*4 +: 4];
    end
  endfunction
  assign y = nib(a, sel);
endmodule
`,
    )
    expect(why).toContain('inside function "nib"')
  })
})
