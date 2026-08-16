/**
 * A MEMORY THAT LIVES IN A SUB-MODULE — `rom r(.addr(a), .d(d));` around `reg [7:0] m [0:3];`, which is how a
 * real design keeps its ROM.
 *
 * Flattening copies a sub-module into its parent with every name prefixed, and it used to copy a power-on
 * value by listing its fields — dropping the WORD number the memory work had just added. A submodule ROM then
 * landed on the SCALAR power-on path at a phantom 1-bit net named after the array (`r.m`), so the refusal that
 * should have stopped the design named something nothing reads, cost nothing, and the module published with
 * every ROM word reading 0. Written FLAT the identical logic behaved correctly the whole time, which is what
 * made it a hierarchy defect rather than a memory one.
 *
 * Two instances of one ROM module must also keep their own word registers: they are two memories, and a design
 * where writing one changes the other is not the design the source describes.
 *
 * Every value asserted here was measured on Icarus Verilog 14.0 by running the exact module text below.
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

function build(verilog: string): BlockData {
  const { block, warnings } = importVerilog(verilog)
  expect(warnings, `warnings: ${warnings.join(' | ')}`).toEqual([])
  expect(block, 'should build a block').not.toBeNull()
  return block as BlockData
}

const bus = (name: string, value: number, width: number): Record<string, boolean> => {
  const r: Record<string, boolean> = {}
  for (let i = 0; i < width; i++) r[`${name}[${i}]`] = ((value >> i) & 1) === 1
  return r
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

function tick(block: BlockData, inputs: Record<string, boolean>, state: Map<string, boolean>) {
  solve(block, { ...inputs, clk: false }, state)
  return solve(block, { ...inputs, clk: true }, state)
}

const readBus = (
  r: { value: (n: string, p: string) => boolean | undefined },
  name: string,
  width: number,
): number => {
  let v = 0
  for (let i = 0; i < width; i++) if (r.value('M', `${name}[${i}]`) === true) v |= 1 << i
  return v
}

/** Read at each address 0…3 with a fresh combinational solve. */
const readAll = (block: BlockData, width = 8): number[] =>
  [0, 1, 2, 3].map((a) =>
    readBus(solve(block, bus('a', a, 2), new Map<string, boolean>()), 'y', width),
  )

/** Every declared output bit must have a pin. A pin ABSENT is not a pin reading 0. */
const expectOutputPins = (block: BlockData, name: string, width: number): void => {
  const have = new Set(block.ports.map((p) => p.id))
  const absent = Array.from({ length: width }, (_, i) => `${name}[${i}]`).filter(
    (pin) => !have.has(pin),
  )
  expect(absent, `output pins missing from the published block`).toEqual([])
}

const ROM_BODY = `  reg [7:0] m [0:3];
  initial begin
    m[0] = 8'h11;
    m[1] = 8'h22;
    m[2] = 8'h33;
    m[3] = 8'h44;
  end
  assign d = m[addr];`

describe('a ROM inside a sub-module reads back what the source put in it', () => {
  // Icarus Verilog 14.0 on this exact text: 17 34 51 68 at a = 0,1,2,3.
  test('one instance, one level down', () => {
    const rom = build(`module rom(input [1:0] addr, output [7:0] d);
${ROM_BODY}
endmodule
module top(input [1:0] a, output [7:0] y);
  rom r(.addr(a), .d(y));
endmodule`)
    expectOutputPins(rom, 'y', 8)
    expect(readAll(rom)).toEqual([17, 34, 51, 68])
  })

  // Icarus Verilog 14.0: 17 34 51 68 — the same answer the flat spelling gives.
  test('three levels down', () => {
    const rom = build(`module rom(input [1:0] addr, output [7:0] d);
${ROM_BODY}
endmodule
module lo(input [1:0] addr, output [7:0] d);
  rom r(.addr(addr), .d(d));
endmodule
module mid(input [1:0] addr, output [7:0] d);
  lo u(.addr(addr), .d(d));
endmodule
module top(input [1:0] a, output [7:0] y);
  mid u(.addr(a), .d(y));
endmodule`)
    expect(readAll(rom)).toEqual([17, 34, 51, 68])
  })

  // Icarus Verilog 14.0: 17425 13090 8755 4420 — {hi, lo} where lo reads address a and hi reads ~a. At a = 0
  // that is 0x4411: the two copies are at DIFFERENT words of their OWN arrays at the same instant, which they
  // could not be if the flattening had given them one shared set of word registers.
  test('two instances of one ROM read different addresses at the same time', () => {
    const rom = build(`module rom(input [1:0] addr, output [7:0] d);
${ROM_BODY}
endmodule
module top(input [1:0] a, output [15:0] y);
  wire [7:0] lo, hi;
  rom r0(.addr(a), .d(lo));
  rom r1(.addr(~a), .d(hi));
  assign y = {hi, lo};
endmodule`)
    expectOutputPins(rom, 'y', 16)
    expect(readAll(rom, 16)).toEqual([17425, 13090, 8755, 4420])
  })

  // Icarus Verilog 14.0: 40976 41233 41490 41747 — {hi, lo} = {0xa0+a, 0x10+a}. Two copies of one module at
  // different parameters hold DIFFERENT contents at the same address, so neither copy can be reading the
  // other's words.
  test('two differently parameterised instances hold different contents', () => {
    const rom = build(`module rom #(parameter BASE = 8'h10) (input [1:0] addr, output [7:0] d);
  reg [7:0] m [0:3];
  integer i;
  initial for (i = 0; i < 4; i = i + 1) m[i] = BASE + i;
  assign d = m[addr];
endmodule
module top(input [1:0] a, output [15:0] y);
  wire [7:0] lo, hi;
  rom #(.BASE(8'h10)) r0(.addr(a), .d(lo));
  rom #(.BASE(8'ha0)) r1(.addr(a), .d(hi));
  assign y = {hi, lo};
endmodule`)
    expect(readAll(rom, 16)).toEqual([40976, 41233, 41490, 41747])
  })

  // Icarus Verilog 14.0, clocking a = 0,1,2,3 through the write enable a[1]: 0 0 255 255. An all-zero power-on
  // is exactly what the flip-flops a clocked write builds already hold, so this one builds despite the clock.
  test('an all-zero power-on beside a clocked write, in a sub-module', () => {
    const ram = build(`module ram(input clk, input [1:0] addr, input we, output [7:0] d);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 8'h00;
    m[1] = 8'h00;
    m[2] = 8'h00;
    m[3] = 8'h00;
  end
  always @(posedge clk) if (we) m[addr] <= 8'hff;
  assign d = m[addr];
endmodule
module top(input clk, input [1:0] a, output [7:0] y);
  ram u(.clk(clk), .addr(a), .we(a[1]), .d(y));
endmodule`)
    const state = new Map<string, boolean>()
    const got = [0, 1, 2, 3].map((a) => readBus(tick(ram, bus('a', a, 2), state), 'y', 8))
    expect(got).toEqual([0, 0, 255, 255])
  })
})

describe('a sub-module memory this importer cannot build is refused by its own word name', () => {
  const refuse = (verilog: string): string[] => {
    const { block, warnings } = importVerilog(verilog)
    expect(block, `should NOT build: ${warnings.join(' | ')}`).toBeNull()
    return warnings
  }

  // Icarus Verilog 14.0 reads 16 32 48 64 at a = 0,1,2,3; our flip-flops power up holding 0. The name in the
  // refusal is the parent's renamed WORD — a phantom net called "r.m" is what the defect used to report.
  test('a nonzero power-on on a word a clocked block writes', () => {
    const said = refuse(`module rom(input clk, input [1:0] addr, output [7:0] d);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 8'h10;
    m[1] = 8'h20;
    m[2] = 8'h30;
    m[3] = 8'h40;
  end
  always @(posedge clk) m[3] <= 8'h40;
  assign d = m[addr];
endmodule
module top(input clk, input [1:0] a, output [7:0] y);
  rom r(.clk(clk), .addr(a), .d(y));
endmodule`).join(' ')
    expect(said).toContain('"r.m[0]"')
    expect(said).toContain('power up holding 0, not 16')
  })

  // The same memory read through a concatenation instead of an address mux, so every word is observable at
  // once. Icarus Verilog 14.0 reads 0x40302010 before the first edge.
  test('a clocked word refuses even when every word is read at once', () => {
    const said = refuse(`module store(input clk, input [7:0] wd, output [31:0] all);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 8'h10;
    m[1] = 8'h20;
    m[2] = 8'h30;
    m[3] = 8'h40;
  end
  always @(posedge clk) m[3] <= wd;
  assign all = {m[3], m[2], m[1], m[0]};
endmodule
module top(input clk, input [7:0] a, output [31:0] y);
  store s(.clk(clk), .wd(a), .all(y));
endmodule`).join(' ')
    expect(said).toContain('"s.m[3]"')
    expect(said).toContain('power up holding 0, not 64')
  })

  test('a word index past the end of a sub-module array', () => {
    const said = refuse(`module rom(input [1:0] addr, output [7:0] d);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 8'h11;
    m[7] = 8'h99;
  end
  assign d = m[addr];
endmodule
module top(input [1:0] a, output [7:0] y);
  rom r(.addr(a), .d(y));
endmodule`).join(' ')
    expect(said).toContain('word 7 is past the end of the 4-word memory "r.m"')
  })

  test('$readmemh in a sub-module names the memory it would have loaded', () => {
    const said = refuse(`module rom(input [1:0] addr, output [7:0] d);
  reg [7:0] m [0:3];
  initial $readmemh("rom.hex", m);
  assign d = m[addr];
endmodule
module top(input [1:0] a, output [7:0] y);
  rom r(.addr(a), .d(y));
endmodule`).join(' ')
    expect(said).toContain('"$readmemh" loads the memory "m" from a file')
    expect(said).toContain('r.m[0][0]')
  })

  // Icarus Verilog 14.0 reads x at the unwritten words, which a two-valued netlist cannot carry — and the
  // nets it names are the parent's real word registers, not a phantom.
  test('a partly filled sub-module ROM names its undriven words', () => {
    const said = refuse(`module rom(input [1:0] addr, output [7:0] d);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 8'h11;
    m[2] = 8'h33;
  end
  assign d = m[addr];
endmodule
module top(input [1:0] a, output [7:0] y);
  rom r(.addr(a), .d(y));
endmodule`).join(' ')
    expect(said).toContain('r.m[1][0]')
  })
})
