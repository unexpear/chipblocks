/**
 * SELECT BOUNDS AND DECLARATION RANGES ARE SELF-DETERMINED — IEEE 1364-2005 §5.4.1. A bit-select index, both
 * part-select bounds, a wire/reg/wor declaration range, a submodule port range, a parameter's declared range,
 * a function's declared return range and an array's depth bound are all assigned to nothing, so none of them
 * has a context to take a width from: each folds at its OWN width and wraps there.
 *
 * The evaluator used to fold them at `growWidth` — the lossless width that belongs to a parameter VALUE — and
 * so `wire [(4'd10 + 4'd10):0]` built a twenty-one-bit bus where Icarus builds five, and `w[4'd8 + 4'd8]` read
 * bit sixteen where Icarus reads bit zero. Twenty-odd shapes disagreed, every one of them building with no
 * warning at all.
 *
 * EVERY expected value in this file is the output of Icarus Verilog 14.0 (oss-cad-suite) on the same source,
 * measured through a testbench whose probe is wider than any value it can carry. The suite has been fully
 * green over wrong answers three times, so an expectation read out of current behaviour is worth nothing here.
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

function solve(block: BlockData, inputs: Record<string, boolean>, state: Map<string, boolean>) {
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
  let k = 0
  for (const [port, val] of Object.entries(inputs)) {
    const vid = `v${k++}`
    nodes.push(src(vid, val ? 5 : 0))
    edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', port))
    edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
  }
  return simulateLogic(nodes, edges, state)
}

const aBits = (value: number): Record<string, boolean> => ({
  'a[0]': (value & 1) === 1,
  'a[1]': (value & 2) === 2,
  'a[2]': (value & 4) === 4,
  'a[3]': (value & 8) === 8,
})

/** Read the 32-bit output `y` — always wider than any value these designs carry, so a truncating port can
 *  never hide a wrong bound by clipping it back to the right answer. */
function readY(result: { value: (n: string, p: string) => boolean | undefined }): number {
  let out = 0
  for (let bit = 0; bit < 32; bit++) if (result.value('M', `y[${bit}]`) === true) out += 2 ** bit
  return out
}

/** Build `verilog` and read `y` with the 4-bit input `a` held at `aValue`. */
function yAt(verilog: string, aValue = 0): number {
  return readY(solve(build(verilog), aBits(aValue), new Map()))
}

const mod = (body: string): string =>
  `module top(input [3:0] a, output [31:0] y);\n${body}\nendmodule\n`

describe('a select bound folds at its own width, not at a grown one', () => {
  test("an rvalue bit-select w[4'd8 + 4'd8] reads bit ZERO (Icarus: 0)", () => {
    expect(
      yAt(
        mod(`   wire [31:0] w;
   assign w = 32'h0001_0002;
   assign y = {31'd0, w[4'd8 + 4'd8]} | {28'd0, a};`),
      ),
    ).toBe(0)
  })

  test("an index that UNDERFLOWS wraps: w[4'd2 - 4'd5] is bit 13 (Icarus: 1)", () => {
    expect(
      yAt(
        mod(`   wire [31:0] w;
   assign w = 32'h0000_2000;
   assign y = {31'd0, w[4'd2 - 4'd5]} | {28'd0, a};`),
      ),
    ).toBe(1)
  })

  test("a three-bit index wraps at three bits: w[3'd7 + 3'd1] is bit 0 (Icarus: 0)", () => {
    expect(
      yAt(
        mod(`   wire [31:0] w;
   assign w = 32'h0000_0100;
   assign y = {31'd0, w[3'd7 + 3'd1]} | {28'd0, a};`),
      ),
    ).toBe(0)
  })

  test("a multiply wraps too: w[4'd4 * 4'd5] is bit 4 (Icarus: 1)", () => {
    expect(
      yAt(
        mod(`   wire [31:0] w;
   assign w = 32'h0000_0010;
   assign y = {31'd0, w[4'd4 * 4'd5]} | {28'd0, a};`),
      ),
    ).toBe(1)
  })

  test('a SIZED parameter carries its declared width into the index (Icarus: 0)', () => {
    expect(
      yAt(
        mod(`   parameter [3:0] BASE = 4'd8;
   wire [31:0] w;
   assign w = 32'h0001_0002;
   assign y = {31'd0, w[BASE + 4'd8]} | {28'd0, a};`),
      ),
    ).toBe(0)
  })

  test('BOTH part-select bounds wrap (Icarus: 31)', () => {
    expect(
      yAt(
        mod(`   wire [31:0] w;
   assign w = 32'h0000_01F0;
   assign y = {27'd0, w[(4'd12 + 4'd12) : (4'd10 + 4'd10)]} | {28'd0, a};`),
      ),
    ).toBe(31)
  })

  test('a part-select high bound wraps on its own (Icarus: 31)', () => {
    expect(
      yAt(
        mod(`   wire [31:0] w;
   assign w = 32'h000F_FFFF;
   assign y = w[(4'd10 + 4'd10) : 0] | {28'd0, a};`),
      ),
    ).toBe(31)
  })

  test('an LVALUE part-select bound wraps (Icarus: 31)', () => {
    expect(
      yAt(
        mod(`   reg [31:0] r;
   always @(*) begin
      r = 32'd0;
      r[(4'd10 + 4'd10) : 0] = 32'hFFFF_FFFF;
      if (a == 4'd15) r = 32'd1;
   end
   assign y = r;`),
      ),
    ).toBe(31)
  })

  test('an LVALUE bit-select index wraps (Icarus: 1)', () => {
    expect(
      yAt(
        mod(`   reg [31:0] r;
   always @(*) begin
      r = 32'd0;
      r[4'd8 + 4'd8] = 1'b1;
      if (a == 4'd15) r = 32'd1;
   end
   assign y = r;`),
      ),
    ).toBe(1)
  })
})

describe('a declaration range folds at its own width, not at a grown one', () => {
  test("wire [(4'd10 + 4'd10):0] is a FIVE-bit bus (Icarus: 31)", () => {
    expect(
      yAt(
        mod(`   wire [(4'd10 + 4'd10):0] z;
   assign z = 32'hFFFF_FFFF;
   assign y = z | {28'd0, a};`),
      ),
    ).toBe(31)
  })

  test('a reg declaration range wraps the same way (Icarus: 31)', () => {
    expect(
      yAt(
        mod(`   reg [(4'd10 + 4'd10):0] r;
   always @(*) begin
      r = 32'hFFFF_FFFF;
      if (a == 4'd15) r = 0;
   end
   assign y = r;`),
      ),
    ).toBe(31)
  })

  test('a wor declaration range wraps the same way (Icarus: 31)', () => {
    expect(
      yAt(
        mod(`   wor [(4'd10 + 4'd10):0] z;
   assign z = 32'hFFFF_FFFF;
   assign y = z | {28'd0, a};`),
      ),
    ).toBe(31)
  })

  test('a SUBMODULE port range wraps the same way (Icarus: 31)', () => {
    expect(
      yAt(`module sub(input [3:0] a, output [(4'd10 + 4'd10):0] z);
   assign z = 32'hFFFF_FFFF;
endmodule
module top(input [3:0] a, output [31:0] y);
   wire [(4'd10 + 4'd10):0] z;
   sub u(.a(a), .z(z));
   assign y = z | {28'd0, a};
endmodule
`),
    ).toBe(31)
  })

  test("a PARAMETER's declared range wraps the same way (Icarus: 31)", () => {
    expect(
      yAt(
        mod(`   parameter [(4'd10 + 4'd10):0] P = 32'hFFFF_FFFF;
   assign y = P | {28'd0, a};`),
      ),
    ).toBe(31)
  })

  test("a FUNCTION's declared return range wraps the same way (Icarus: 31)", () => {
    expect(
      yAt(
        mod(`   function [(4'd10 + 4'd10):0] f;
      input [3:0] p;
      begin
         f = 32'hFFFF_FFFF;
      end
   endfunction
   assign y = f(a) | {28'd0, a};`),
      ),
    ).toBe(31)
  })

  test("ordinary RTL: parameter [3:0] W = 15 makes wire [W + 4'd1 : 0] ONE bit (Icarus: 1)", () => {
    expect(
      yAt(
        mod(`   parameter [3:0] W = 4'd15;
   wire [W + 4'd1 : 0] z;
   assign z = 32'hFFFF_FFFF;
   assign y = z | {28'd0, a};`),
      ),
    ).toBe(1)
  })

  test("ordinary RTL: parameter [3:0] W = 0 makes wire [W - 4'd1 : 0] SIXTEEN bits (Icarus: 65535)", () => {
    expect(
      yAt(
        mod(`   parameter [3:0] W = 4'd0;
   wire [W - 4'd1 : 0] z;
   assign z = 32'hFFFF_FFFF;
   assign y = z | {28'd0, a};`),
      ),
    ).toBe(65535)
  })

  test("a submodule's parameterized port range wraps at the parameter's width (Icarus: 1)", () => {
    expect(
      yAt(`module sub #(parameter [3:0] W = 4'd15) (output [W + 4'd1 : 0] z);
   assign z = 32'hFFFF_FFFF;
endmodule
module top(input [3:0] a, output [31:0] y);
   wire [17:0] z;
   sub u(.z(z));
   assign y = {14'd0, z} | {28'd0, a};
endmodule
`),
    ).toBe(1)
  })
})

describe('a memory depth bound folds at its own width', () => {
  const memory = (address: number): string =>
    mod(`   wire clk;
   assign clk = a[0];
   reg [7:0] mem [0:(4'd10 + 4'd10)];
   always @(posedge clk) mem[${address}] <= 8'd85;
   assign y = {24'd0, mem[${address}]};`)

  test("reg [7:0] mem [0:(4'd10 + 4'd10)] is FIVE words: a clocked write at 3 reads back (Icarus: 85)", () => {
    const block = build(memory(3))
    const state = new Map<string, boolean>()
    solve(block, aBits(14), state)
    solve(block, aBits(15), state)
    expect(readY(solve(block, aBits(14), state))).toBe(85)
  })

  test('word 7 does not exist in those five words — refused by name, never answered', () => {
    const { block, warnings } = importVerilog(memory(7))
    expect(block).toBeNull()
    expect(said(warnings)).toContain('5-word memory')
  })

  test("a sized-parameter depth [0:(D + 4'd10)] refuses word 7 the same way", () => {
    const { block, warnings } = importVerilog(
      mod(`   parameter [3:0] D = 4'd10;
   wire clk;
   assign clk = a[0];
   reg [7:0] mem [0:(D + 4'd10)];
   always @(posedge clk) mem[7] <= 8'd85;
   assign y = {24'd0, mem[7]};`),
    )
    expect(block).toBeNull()
    expect(said(warnings)).toContain('5-word memory')
  })
})

describe('the everyday shapes are untouched', () => {
  test('wire [W-1:0] with an UNSIZED parameter W = 20 (Icarus: 1048575)', () => {
    expect(
      yAt(
        mod(`   parameter W = 20;
   wire [W-1:0] z;
   assign z = 32'hFFFF_FFFF;
   assign y = z | {28'd0, a};`),
      ),
    ).toBe(1048575)
  })

  test('a bound of UNSIZED decimals w[8 + 8] still reads bit 16 (Icarus: 1)', () => {
    expect(
      yAt(
        mod(`   wire [31:0] w;
   assign w = 32'h0001_0002;
   assign y = {31'd0, w[8 + 8]} | {28'd0, a};`),
      ),
    ).toBe(1)
  })

  test('an unsized parameter N = 15 in an index w[N + 1] still reads bit 16 (Icarus: 1)', () => {
    expect(
      yAt(
        mod(`   parameter N = 15;
   wire [31:0] w;
   assign w = 32'h0001_0002;
   assign y = {31'd0, w[N + 1]} | {28'd0, a};`),
      ),
    ).toBe(1)
  })

  test('an ordinary parameterized memory [0:DEPTH-1] still holds word 9 (Icarus: 77)', () => {
    const block = build(
      mod(`   parameter DEPTH = 16;
   wire clk;
   assign clk = a[0];
   reg [7:0] mem [0:DEPTH-1];
   always @(posedge clk) mem[9] <= 8'd77;
   assign y = {24'd0, mem[9]};`),
    )
    const state = new Map<string, boolean>()
    solve(block, aBits(14), state)
    solve(block, aBits(15), state)
    expect(readY(solve(block, aBits(14), state))).toBe(77)
  })

  test('a whole-expression widen still applies: wire [W*W-1:0] with [7:0] W = 20 holds bit 300 (Icarus: 0, in range)', () => {
    expect(
      yAt(
        mod(`   parameter [7:0] W = 8'd20;
   wire [W*W-1:0] z;
   assign z = 32'hFFFF_FFFF;
   assign y = {31'd0, z[300]} | {28'd0, a};`),
      ),
    ).toBe(0)
  })
})

describe('the shift wall is still where it was', () => {
  test("an index that shifts a wrapping add: w[(8'd200 + 8'd100) >> 2] is bit 11 (Icarus: 1)", () => {
    expect(
      yAt(
        mod(`   wire [31:0] w;
   assign w = 32'h0000_0800;
   assign y = {31'd0, w[(8'd200 + 8'd100) >> 2]} | {28'd0, a};`),
      ),
    ).toBe(1)
  })

  test("a bound that shifts a wrapping add: wire [((8'd200 + 8'd100) >> 2):0] is 12 bits (Icarus: 4095)", () => {
    expect(
      yAt(
        mod(`   wire [((8'd200 + 8'd100) >> 2):0] z;
   assign z = 32'hFFFF_FFFF;
   assign y = z | {28'd0, a};`),
      ),
    ).toBe(4095)
  })

  test("a bare wrapping multiply as a bound: wire [8'd20 * 8'd20 : 0] holds bit 100 (Icarus: 0, in range)", () => {
    expect(
      yAt(
        mod(`   wire [8'd20 * 8'd20 : 0] z;
   assign z = 32'hFFFF_FFFF;
   assign y = {31'd0, z[100]} | {28'd0, a};`),
      ),
    ).toBe(0)
  })

  test('the same bus has NO bit 300 — refused by name, not answered (Icarus reads x)', () => {
    const { block, warnings } = importVerilog(
      mod(`   wire [8'd20 * 8'd20 : 0] z;
   assign z = 32'hFFFF_FFFF;
   assign y = {31'd0, z[300]} | {28'd0, a};`),
    )
    expect(block).toBeNull()
    // 20 × 20 wraps to 144 at eight bits, so the bus is 145 bits and has no bit 300. The refusal names the
    // real width, which is the whole point: a grown fold would have built a 401-bit bus and answered.
    expect(said(warnings)).toContain('145-bit net')
  })
})

describe('a width this evaluator cannot prove is still refused, never guessed', () => {
  test('a `**` over a compound base in a bound is reported rather than folded narrow', () => {
    const { warnings } = importVerilog(
      mod(`   wire [((4'd15 + 4'd2) ** 3):0] z;
   assign z = 32'hFFFF_FFFF;
   assign y = z[31:0] | {28'd0, a};`),
    )
    expect(said(warnings)).toContain('non-constant range')
  })
})
