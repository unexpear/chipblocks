/**
 * A MEMORY'S POWER-ON CONTENTS — `initial begin m[0] = 8'h11; … end`, which is how every real ROM is written.
 *
 * A word no clock ever writes is a mask-ROM word, so it is built as the constant it holds and the array really
 * reads back what the source put in it. The importer used to publish those designs with every word reading 0:
 * the refusal an unbuilt `initial` raises landed on bit 0 of a phantom 1-bit net named after the array, because
 * `m[0]` reads as an ordinary bit-select to code that knows only nets. Nothing ever read that name, so the
 * refusal cost nothing and a ROM full of zeros went out looking normal.
 *
 * A word a CLOCKED block also writes is a flip-flop, and the flops this importer builds power up holding 0 —
 * so there the scalar power-on rule applies unchanged: a zero is honoured and anything else is refused by name.
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

/** Read the ROM at each address 0…3 with a fresh combinational solve. */
const readAll = (block: BlockData, width = 8): number[] =>
  [0, 1, 2, 3].map((a) =>
    readBus(solve(block, bus('a', a, 2), new Map<string, boolean>()), 'y', width),
  )

/** The pins a built block actually publishes — "absent" and "present but 0" are different answers. */
const pinsOf = (block: BlockData): string[] => block.ports.map((p) => p.id)

describe('a memory loaded by an initial block holds its contents', () => {
  // Icarus Verilog 14.0 on this exact text: 17 34 51 68 at a = 0,1,2,3.
  test('descending array range reg [7:0] m [3:0]', () => {
    const rom = build(`module top(input [1:0] a, output [7:0] y);
  reg [7:0] m [3:0];
  initial begin
    m[0] = 8'h11;
    m[1] = 8'h22;
    m[2] = 8'h33;
    m[3] = 8'h44;
  end
  assign y = m[a];
endmodule`)
    expect(pinsOf(rom)).toEqual(expect.arrayContaining(['a[0]', 'a[1]', 'y[0]', 'y[7]']))
    expect(readAll(rom)).toEqual([17, 34, 51, 68])
  })

  // Icarus Verilog 14.0: 17 34 51 68 — the same memory as the descending spelling above.
  test('ascending array range reg [7:0] m [0:3]', () => {
    const rom = build(`module top(input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 8'h11;
    m[1] = 8'h22;
    m[2] = 8'h33;
    m[3] = 8'h44;
  end
  assign y = m[a];
endmodule`)
    expect(readAll(rom)).toEqual([17, 34, 51, 68])
  })

  // Icarus Verilog 14.0: 0 17 34 51.
  test('filled by a for loop inside the initial block', () => {
    const rom = build(`module top(input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  integer i;
  initial begin
    for (i = 0; i < 4; i = i + 1) m[i] = i * 8'h11;
  end
  assign y = m[a];
endmodule`)
    expect(readAll(rom)).toEqual([0, 17, 34, 51])
  })

  // Icarus Verilog 14.0: 52 205 255 0 — a 16-bit value TRUNCATES into the 8-bit word (0x1234 → 0x34).
  test('a value wider than the word truncates to the word', () => {
    const rom = build(`module top(input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 16'h1234;
    m[1] = 16'habcd;
    m[2] = 16'h00ff;
    m[3] = 16'hff00;
  end
  assign y = m[a];
endmodule`)
    expect(readAll(rom)).toEqual([52, 205, 255, 0])
  })

  // Icarus Verilog 14.0: 5 10 1 15 — a narrow value zero-extends into the word.
  test('a value narrower than the word zero-extends', () => {
    const rom = build(`module top(input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 4'h5;
    m[1] = 4'ha;
    m[2] = 1'b1;
    m[3] = 4'hf;
  end
  assign y = m[a];
endmodule`)
    expect(readAll(rom)).toEqual([5, 10, 1, 15])
  })

  // Icarus Verilog 14.0: 4660 43981 48879 51966.
  test('16-bit words', () => {
    const rom = build(`module top(input [1:0] a, output [15:0] y);
  reg [15:0] m [0:3];
  initial begin
    m[0] = 16'h1234;
    m[1] = 16'habcd;
    m[2] = 16'hbeef;
    m[3] = 16'hcafe;
  end
  assign y = m[a];
endmodule`)
    expect(readAll(rom, 16)).toEqual([4660, 43981, 48879, 51966])
  })

  // Icarus Verilog 14.0: 1 0 1 1.
  test('1-bit words', () => {
    const rom = build(`module top(input [1:0] a, output [7:0] y);
  reg m [0:3];
  initial begin
    m[0] = 1'b1;
    m[1] = 1'b0;
    m[2] = 1'b1;
    m[3] = 1'b1;
  end
  assign y = {7'b0, m[a]};
endmodule`)
    expect(readAll(rom)).toEqual([1, 0, 1, 1])
  })

  // Icarus Verilog 14.0, clocking a = 0,1,2,3: 12 24 170 118 — the value latched on each rising edge.
  test('a ROM read on a clock edge', () => {
    const rom = build(`module top(input clk, input [1:0] a, output [7:0] y);
  reg [7:0] rom [0:3];
  reg [7:0] q;
  initial begin
    rom[0] = 8'h0c;
    rom[1] = 8'h18;
    rom[2] = 8'haa;
    rom[3] = 8'h76;
  end
  always @(posedge clk) q <= rom[a];
  assign y = q;
endmodule`)
    const state = new Map<string, boolean>()
    const got = [0, 1, 2, 3].map((a) => readBus(tick(rom, bus('a', a, 2), state), 'y', 8))
    expect(got).toEqual([12, 24, 170, 118])
  })

  // Icarus Verilog 14.0: 17 34 51 68 before any clock edge (t = 0), 18 35 52 69 after one (t = 1).
  test('one initial block loading a scalar AND array words', () => {
    const rom = build(`module top(input clk, input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  reg t;
  initial begin
    t = 1'b0;
    m[0] = 8'h11;
    m[1] = 8'h22;
    m[2] = 8'h33;
    m[3] = 8'h44;
  end
  always @(posedge clk) t <= 1'b1;
  assign y = {7'b0, t} + m[a];
endmodule`)
    const state = new Map<string, boolean>()
    const before = [0, 1, 2, 3].map((a) =>
      readBus(solve(rom, { clk: false, ...bus('a', a, 2) }, state), 'y', 8),
    )
    expect(before).toEqual([17, 34, 51, 68])
    tick(rom, bus('a', 0, 2), state)
    const after = [0, 1, 2, 3].map((a) =>
      readBus(solve(rom, { clk: false, ...bus('a', a, 2) }, state), 'y', 8),
    )
    expect(after).toEqual([18, 35, 52, 69])
  })

  // Icarus Verilog 14.0, clocking a = 0,1,2,3 through the write enable a[1]: 0 0 255 255.
  test('an all-zero power-on matches the flip-flops a clocked write builds', () => {
    const ram = build(`module top(input clk, input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 8'h00;
    m[1] = 8'h00;
    m[2] = 8'h00;
    m[3] = 8'h00;
  end
  always @(posedge clk) if (a[1]) m[a] <= 8'hff;
  assign y = m[a];
endmodule`)
    const state = new Map<string, boolean>()
    const got = [0, 1, 2, 3].map((a) => readBus(tick(ram, bus('a', a, 2), state), 'y', 8))
    expect(got).toEqual([0, 0, 255, 255])
  })
})

describe('a memory power-on this importer cannot build is refused by name', () => {
  const refuse = (verilog: string): string[] => {
    const { block, warnings } = importVerilog(verilog)
    expect(block, `should NOT build: ${warnings.join(' | ')}`).toBeNull()
    return warnings
  }

  // Icarus Verilog 14.0 reads 17 x 51 x — the unwritten words hold x, which a two-valued netlist cannot carry.
  test('a partly filled ROM leaves its unwritten words undriven, so nothing is published', () => {
    const said = refuse(`module top(input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 8'h11;
    m[2] = 8'h33;
  end
  assign y = m[a];
endmodule`)
    expect(said.join(' ')).toContain('m[1][0]')
  })

  test('$readmemh names the memory it would have loaded from a file', () => {
    const said = refuse(`module top(input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  initial $readmemh("rom.hex", m);
  assign y = m[a];
endmodule`)
    expect(said.join(' ')).toContain('"$readmemh" loads the memory "m" from a file')
  })

  test('$readmemb names the memory it would have loaded from a file', () => {
    const said = refuse(`module top(input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  initial $readmemb("rom.bin", m);
  assign y = m[a];
endmodule`)
    expect(said.join(' ')).toContain('"$readmemb" loads the memory "m" from a file')
  })

  // Icarus Verilog 14.0 powers this memory up holding 17/34/51/68; our flip-flops power up holding 0.
  test('a nonzero power-on on a word a clocked block writes', () => {
    const said = refuse(`module top(input clk, input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 8'h11;
    m[1] = 8'h22;
    m[2] = 8'h33;
    m[3] = 8'h44;
  end
  always @(posedge clk) if (a[1]) m[a] <= 8'hff;
  assign y = m[a];
endmodule`)
    expect(said.join(' ')).toContain('power up holding 0, not 17')
  })

  test('a word index past the end of the array', () => {
    const said = refuse(`module top(input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 8'h11;
    m[7] = 8'h99;
  end
  assign y = m[a];
endmodule`)
    expect(said.join(' ')).toContain('word 7 is past the end of the 4-word memory "m"')
  })

  // Icarus Verilog 14.0 reads x at m[1]; an x has no value a two-valued net can carry.
  test('an x in a power-on value', () => {
    refuse(`module top(input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  initial begin
    m[0] = 8'h11;
    m[1] = 8'hxx;
    m[2] = 8'h33;
    m[3] = 8'h44;
  end
  assign y = m[a];
endmodule`)
  })

  test('a non-constant word index in the initial block', () => {
    refuse(`module top(input [1:0] a, output [7:0] y);
  reg [7:0] m [0:3];
  initial begin
    m[a] = 8'h11;
  end
  assign y = m[a];
endmodule`)
  })

  test('a bit-select power-on on a plain register is not a memory word', () => {
    const said = refuse(`module top(input [1:0] a, output [7:0] y);
  reg [7:0] r;
  initial r[3] = 1'b1;
  assign y = r | {6'b0, a};
endmodule`)
    expect(said.join(' ')).toContain('is not a declared memory')
  })
})
