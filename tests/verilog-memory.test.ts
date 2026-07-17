/**
 * RTL synthesis (increment 4) — MEMORY. A `reg [D-1:0] m [0:W-1]` array with a COMPUTED address is the last
 * piece a CPU's data RAM (LDA/STA) needs. Each word becomes real D flip-flops; a read `m[addr]` synthesizes a
 * one-hot address decoder + read mux and a clocked write `m[addr] <= x` synthesizes per-word write-enables —
 * exactly the gate Data RAM's construction, but authored in Verilog. Proven by CLOCKING the built block on the
 * real logic engine: store a word, read it back, confirm persistence and nonblocking (read-old-value) timing.
 * Anything out of the supported subset (out-of-range address, unclocked array write, bit-select on a read,
 * memory-as-vector, non-`[0:W-1]` range) is REPORTED, never faked.
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

/** Expand a numeric value onto a bus input's bit-ports name[0..width-1] (LSB = name[0]). */
function bus(name: string, value: number, width: number): Record<string, boolean> {
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

/** A rising clock edge: clk LOW then HIGH, inputs held steady; returns the high solve. */
function tick(block: BlockData, inputs: Record<string, boolean>, state: Map<string, boolean>) {
  solve(block, { ...inputs, clk: false }, state)
  return solve(block, { ...inputs, clk: true }, state)
}

const readReg = (
  r: { value: (n: string, p: string) => boolean | undefined },
  name: string,
  width: number,
): number => {
  let v = 0
  for (let i = 0; i < width; i++) if (r.value('M', `${name}[${i}]`) === true) v |= 1 << i
  return v
}

describe('memory synthesis — a reg array with a computed address builds a real RAM', () => {
  // The canonical read/write RAM: write mem[addr] on the clock when we is high, read mem[addr] combinationally.
  const RAM = `module ram(input clk, input we, input [3:0] addr, input [3:0] din, output [3:0] dout);
      reg [3:0] mem [0:15];
      always @(posedge clk) if (we) mem[addr] <= din;
      assign dout = mem[addr];
    endmodule`

  test('stores a word and reads it back at the same address', () => {
    const ram = build(RAM)
    const state = new Map<string, boolean>()
    tick(ram, { we: true, ...bus('addr', 3, 4), ...bus('din', 5, 4) }, state) // mem[3] <= 5
    const r = solve(
      ram,
      { we: false, clk: false, ...bus('addr', 3, 4), ...bus('din', 0, 4) },
      state,
    )
    expect(readReg(r, 'dout', 4)).toBe(5)
  })

  test('words are independent and persist (write two, read both back)', () => {
    const ram = build(RAM)
    const state = new Map<string, boolean>()
    tick(ram, { we: true, ...bus('addr', 3, 4), ...bus('din', 5, 4) }, state) // mem[3] <= 5
    tick(ram, { we: true, ...bus('addr', 7, 4), ...bus('din', 9, 4) }, state) // mem[7] <= 9
    const read = (a: number) =>
      readReg(
        solve(ram, { we: false, clk: false, ...bus('addr', a, 4), ...bus('din', 0, 4) }, state),
        'dout',
        4,
      )
    expect(read(7)).toBe(9)
    expect(read(3)).toBe(5) // unchanged by the write to word 7
    expect(read(0)).toBe(0) // never written → powers up 0
  })

  test('write-enable low holds the memory (no write when we = 0)', () => {
    const ram = build(RAM)
    const state = new Map<string, boolean>()
    tick(ram, { we: true, ...bus('addr', 2, 4), ...bus('din', 6, 4) }, state) // mem[2] <= 6
    tick(ram, { we: false, ...bus('addr', 2, 4), ...bus('din', 15, 4) }, state) // we=0 → no write
    const r = solve(
      ram,
      { we: false, clk: false, ...bus('addr', 2, 4), ...bus('din', 0, 4) },
      state,
    )
    expect(readReg(r, 'dout', 4)).toBe(6) // still 6, not 15
  })

  test('nonblocking read sees the PRE-edge memory (read and write the same address in one block)', () => {
    // q <= mem[addr] reads the OLD contents even though mem[addr] <= din writes the same word this edge.
    const m = build(
      `module m(input clk, input [3:0] addr, input [3:0] din, output reg [3:0] q);
         reg [3:0] mem [0:15];
         always @(posedge clk) begin
           mem[addr] <= din;
           q <= mem[addr];
         end
       endmodule`,
    )
    const state = new Map<string, boolean>()
    let r = tick(m, { ...bus('addr', 2, 4), ...bus('din', 7, 4) }, state) // mem[2] was 0 → q = 0; mem[2] ← 7
    expect(readReg(r, 'q', 4)).toBe(0)
    r = tick(m, { ...bus('addr', 2, 4), ...bus('din', 7, 4) }, state) // now mem[2] = 7 → q = 7
    expect(readReg(r, 'q', 4)).toBe(7)
  })

  test('a byte-wide 4-word RAM works too (different width and depth)', () => {
    const ram = build(
      `module ram(input clk, input we, input [1:0] a, input [7:0] d, output [7:0] q);
         reg [7:0] mem [0:3];
         always @(posedge clk) if (we) mem[a] <= d;
         assign q = mem[a];
       endmodule`,
    )
    const state = new Map<string, boolean>()
    tick(ram, { we: true, ...bus('a', 1, 2), ...bus('d', 200, 8) }, state)
    tick(ram, { we: true, ...bus('a', 2, 2), ...bus('d', 42, 8) }, state)
    const read = (addr: number) =>
      readReg(
        solve(ram, { we: false, clk: false, ...bus('a', addr, 2), ...bus('d', 0, 8) }, state),
        'q',
        8,
      )
    expect(read(1)).toBe(200)
    expect(read(2)).toBe(42)
  })
})

describe('memory synthesis — honest reporting of what cannot be built', () => {
  const warnOf = (verilog: string): string[] => importVerilog(verilog).warnings

  test('a constant out-of-range read address is reported (reads x in Verilog)', () => {
    const warnings = warnOf(
      `module m(input clk, input [3:0] din, output [3:0] q);
         reg [3:0] mem [0:15];
         assign q = mem[20];
       endmodule`,
    )
    expect(warnings.some((x) => /out of range/i.test(x) && /mem/.test(x))).toBe(true)
  })

  test('a constant out-of-range store address is reported', () => {
    const warnings = warnOf(
      `module m(input clk, input we, input [3:0] din, output [3:0] q);
         reg [3:0] mem [0:15];
         always @(posedge clk) if (we) mem[20] <= din;
       endmodule`,
    )
    expect(warnings.some((x) => /out of range/i.test(x))).toBe(true)
  })

  test('an unclocked continuous assign to a memory is reported (not silently a bus)', () => {
    const warnings = warnOf(
      `module m(input [3:0] din, output [3:0] q);
         reg [3:0] mem [0:15];
         assign mem[0] = din;
       endmodule`,
    )
    expect(warnings.some((x) => /continuous assign to memory|unclocked/i.test(x))).toBe(true)
  })

  test('a bit-select on a memory read is reported as a later increment', () => {
    const warnings = warnOf(
      `module m(input [3:0] addr, output q);
         reg [3:0] mem [0:15];
         assign q = mem[addr][0];
       endmodule`,
    )
    expect(warnings.some((x) => /bit-select on a memory read/i.test(x))).toBe(true)
  })

  test('using a memory name as a plain value is reported', () => {
    const warnings = warnOf(
      `module m(output [3:0] q);
         reg [3:0] mem [0:15];
         assign q = mem;
       endmodule`,
    )
    expect(warnings.some((x) => /used as a plain value/i.test(x))).toBe(true)
  })

  test('a descending / nonzero-based array range is reported (needs [0:W-1])', () => {
    const warnings = warnOf(
      `module m(input clk, input [3:0] din, output [3:0] q);
         reg [3:0] mem [15:0];
         assign q = din;
       endmodule`,
    )
    expect(warnings.some((x) => /array range/i.test(x) && /\[0:N-1\]/.test(x))).toBe(true)
  })

  test('a memory read but never written is reported (write before read)', () => {
    const warnings = warnOf(
      `module m(input [3:0] addr, output [3:0] q);
         reg [3:0] mem [0:15];
         assign q = mem[addr];
       endmodule`,
    )
    expect(warnings.some((x) => /never written|write a location before/i.test(x))).toBe(true)
  })
})

// Regressions for the adversarial review of increment 4 (findings A, B, D, E).
describe('memory synthesis — review-fix regressions', () => {
  const warnOf = (verilog: string): string[] => importVerilog(verilog).warnings

  test('A: an address WIDER than the memory needs does not alias onto a low word', () => {
    // 8-bit address into a 16-word RAM: the read must decode all 8 bits (like the write), so 0x15 = 21 reads
    // nothing (0), NOT word 5. Before the fix the read truncated to 4 bits and aliased 0x15 → word 5.
    const ram = build(
      `module ram(input clk, input we, input [7:0] addr, input [3:0] din, output [3:0] dout);
         reg [3:0] mem [0:15];
         always @(posedge clk) if (we) mem[addr] <= din;
         assign dout = mem[addr];
       endmodule`,
    )
    const state = new Map<string, boolean>()
    tick(ram, { we: true, ...bus('addr', 5, 8), ...bus('din', 9, 8) }, state) // mem[5] <= 9
    const read = (a: number) =>
      readReg(
        solve(ram, { we: false, clk: false, ...bus('addr', a, 8), ...bus('din', 0, 8) }, state),
        'dout',
        4,
      )
    expect(read(5)).toBe(9)
    expect(read(21)).toBe(0) // 0x15 — high bits set → no word matches → 0, not the aliased word 5
  })

  test('B: a constant-FOLDED out-of-range address is reported (read and store), not silently aliased', () => {
    const readW = warnOf(
      `module m(input clk, input we, input [1:0] a, input [3:0] din, output [3:0] q);
         reg [3:0] mem [0:3];
         always @(posedge clk) if (we) mem[a] <= din;
         assign q = mem[3 + 2];
       endmodule`,
    )
    expect(readW.some((x) => /out of range/i.test(x))).toBe(true)
    const writeW = warnOf(
      `module m(input clk, input [1:0] a, input [3:0] din, output [3:0] q);
         reg [3:0] mem [0:3];
         always @(posedge clk) mem[2 + 2] <= din;
         assign q = mem[a];
       endmodule`,
    )
    expect(writeW.some((x) => /out of range/i.test(x))).toBe(true)
  })

  test('D: a parameterized array/bus range is reported, not silently built with the wrong size', () => {
    const arr = warnOf(
      `module m(input clk, input [3:0] din, output [3:0] q);
         reg [3:0] mem [0:DEPTH-1];
         always @(posedge clk) mem[0] <= din;
         assign q = mem[0];
       endmodule`,
    )
    expect(arr.some((x) => /non-constant array range|parameterized/i.test(x))).toBe(true)
    const busW = warnOf('module m(output [3:0] q); reg [WIDTH-1:0] x; assign q = x; endmodule')
    expect(busW.some((x) => /non-constant range|parameterized/i.test(x))).toBe(true)
  })

  test('E: a faulty store address is reported ONCE, not once per memory word', () => {
    const warnings = warnOf(
      `module m(input clk, input [3:0] addr, input [3:0] din, output [3:0] q);
         reg [3:0] mem [0:15];
         always @(posedge clk) mem[addr[9]] <= din;
         assign q = mem[addr];
       endmodule`,
    )
    // addr[9] is out of range on a 4-bit net; before the fix this fired 16 times (once per word).
    expect(warnings.filter((x) => /addr\[9\]/.test(x)).length).toBe(1)
  })
})
