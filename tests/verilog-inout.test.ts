/**
 * A WIDE `inout` IS NOT A ONE-BIT NET, AND NOT A MISSING PIN EITHER.
 *
 * A bidirectional port has never been buildable here — there is no direction to build it in and no third
 * value to give it — and it has always been dropped with a warning. But the drop published the module
 * anyway, and the net the drop left behind was registered ONE BIT wide. Measured in the running app against
 * Icarus Verilog 14.0, with `a` driven to 4'd5 and every answer read through a 32-bit probe:
 *
 *   - ANSI `inout [7:0] b; assign b = 8'hFF; assign y = b;` read 1 where Icarus reads 255, and the block
 *     published with no b pin at all;
 *   - the same in non-ANSI spelling (`inout [7:0] b;` in the body, 8'hAA) read 0 where Icarus reads 170 —
 *     and `b` additionally stayed in the published interface as a ONE-BIT pin;
 *   - the same loss through a SUB-MODULE inout, flattened into the parent, read 0 where Icarus reads 170.
 *
 * A port's width is the module's INTERFACE, so the drop cost the design a pin its own source declares. The
 * inout now goes the way a port with an unfoldable range already goes: the name is claimed as a refused
 * driver — at its full declared width, so a bit-select read of it is claimed too — its position keeps a null
 * place so a positional instantiation still aligns, and on the module being PUBLISHED the drop is refused by
 * name rather than handed back as a smaller module.
 *
 * A sub-module inout still costs nothing when nothing reads it: the last four tests are the over-refusal
 * controls, and each one must BUILD.
 *
 * Every number below is the output of Icarus Verilog 14.0 on the same source.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const said = (warnings: string[]): string => warnings.join(' | ')

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

/** Drive `a` with a four-bit number, solve, and read `y` back as one integer. The read spans 32 bits
 *  whatever the port declares: a probe only as wide as the RIGHT answer would hide a too-narrow one. */
function readY(block: BlockData, aVal: number): bigint {
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
  const pins = new Set(block.ports.map((p) => p.id))
  for (let b = 0; b < 4; b++) {
    if (!pins.has(`a[${b}]`)) continue
    const vid = `v${b}`
    nodes.push(src(vid, ((aVal >> b) & 1) === 1 ? 5 : 0))
    edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', `a[${b}]`))
    edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
  }
  const res = simulateLogic(nodes, edges, new Map())
  let out = 0n
  for (let b = 0; b < 32; b++) if (res.value('M', `y[${b}]`) === true) out |= 1n << BigInt(b)
  return out
}

/** Every pin the published block actually carries, so "pin absent" is never confused with "pin reads 0". */
const pinsOf = (block: BlockData): string[] => block.ports.map((p) => p.id)

describe('a top-level inout refuses the design by name instead of publishing a narrower module', () => {
  test('ANSI header: inout [7:0] b, read inside (Icarus: 255, this read 1 with no b pin)', () => {
    const { block, warnings } = importVerilog(
      `module top(input [3:0] a, output [31:0] y, inout [7:0] b);
   assign b = 8'hFF;
   assign y = b;
endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('inout port "b"')
    expect(said(warnings)).toContain('is NOT built')
    expect(said(warnings)).toContain('inventing an interface')
  })

  test('non-ANSI body: inout [7:0] b, read inside (Icarus: 170, this read 0 through a ONE-BIT b pin)', () => {
    const { block, warnings } = importVerilog(
      `module top(a, y, b);
   input [3:0] a;
   output [31:0] y;
   inout [7:0] b;
   assign b = 8'hAA;
   assign y = b;
endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('inout port "b"')
    expect(said(warnings)).toContain('is NOT built')
  })

  test('a 1-bit inout refuses too — the value agreed by luck, the interface still lost a pin', () => {
    // Icarus reads 1 and so did this, because at one bit the invented width happens to be the real one.
    // The pin was gone from the published block all the same, which is the module's interface telling a lie.
    for (const source of [
      `module top(input [3:0] a, output [31:0] y, inout b);
   assign b = 1'b1;
   assign y = b;
endmodule`,
      `module top(a, y, b);
   input [3:0] a;
   output [31:0] y;
   inout b;
   assign b = 1'b1;
   assign y = b;
endmodule`,
    ]) {
      const { block, warnings } = importVerilog(source)
      expect(block, said(warnings)).toBeNull()
      expect(said(warnings)).toContain('inout port "b"')
    }
  })

  test('an inout nothing reads still refuses — the block would publish without the pin', () => {
    // Icarus reads y = 5 here and so did this, but the published block had no b pin (ANSI) or a one-bit b
    // (non-ANSI) where the source declares eight. The ANSWER was right and the INTERFACE was not.
    for (const source of [
      `module top(input [3:0] a, output [31:0] y, inout [7:0] b);
   assign y = a;
endmodule`,
      `module top(a, y, b);
   input [3:0] a;
   output [31:0] y;
   inout [7:0] b;
   assign b = 8'hAA;
   assign y = a;
endmodule`,
    ]) {
      const { block, warnings } = importVerilog(source)
      expect(block, said(warnings)).toBeNull()
      expect(said(warnings)).toContain('inout port "b"')
    }
  })

  test('one direction keyword governs both names: `inout [7:0] b, c` drops BOTH (Icarus: 255, this read 1)', () => {
    for (const source of [
      `module top(input [3:0] a, output [31:0] y, inout [7:0] b, c);
   assign b = 8'hF0;
   assign c = 8'h0F;
   assign y = b | c;
endmodule`,
      `module top(a, y, b, c);
   input [3:0] a;
   output [31:0] y;
   inout [7:0] b, c;
   assign b = 8'hF0;
   assign c = 8'h0F;
   assign y = b | c;
endmodule`,
    ]) {
      const { block, warnings } = importVerilog(source)
      expect(block, said(warnings)).toBeNull()
      expect(said(warnings)).toContain('inout port "b"')
      expect(said(warnings)).toContain('inout port "c"')
    }
  })
})

describe('a sub-module inout that something reads poisons the design instead of publishing 0', () => {
  const CHILD = `
module ch(input [7:0] a, inout [7:0] b, output [7:0] y);
   assign b = 8'hAA;
   assign y = b;
endmodule`

  test('CONNECTED to a parent wire that is read (Icarus: 170, this read 0)', () => {
    const { block, warnings } = importVerilog(`${CHILD}
module top(input [3:0] a, output [31:0] y);
   wire [7:0] bus;
   ch u(.a({4'd0, a}), .b(bus), .y(y[7:0]));
   assign y[31:8] = 24'd0;
endmodule`)
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('is NOT built')
  })

  test('UNCONNECTED but read inside the child (Icarus: 170, this read 0)', () => {
    const { block, warnings } = importVerilog(`${CHILD}
module top(input [3:0] a, output [31:0] y);
   ch u(.a({4'd0, a}), .y(y[7:0]));
   assign y[31:8] = 24'd0;
endmodule`)
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('is NOT built')
  })

  test('read by BIT-SELECT — the claim covers the declared width, not just bit 0 (Icarus: 1)', () => {
    // b[3] of 8'hAA is 1. The claim has to name u.b[3] specifically: a claim on a one-bit `b` would have
    // left this bit unclaimed the moment the net stopped being one bit wide.
    const { block, warnings } = importVerilog(`
module ch(input [7:0] a, inout [7:0] b, output [7:0] y);
   assign b = 8'hAA;
   assign y = {7'd0, b[3]};
endmodule
module top(input [3:0] a, output [31:0] y);
   ch u(.a({4'd0, a}), .y(y[7:0]));
   assign y[31:8] = 24'd0;
endmodule`)
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('u.b[3]')
  })

  test("read by PART-SELECT — b[7:4] of 8'hAA (Icarus: 10)", () => {
    const { block, warnings } = importVerilog(`
module ch(input [7:0] a, inout [7:0] b, output [7:0] y);
   assign b = 8'hAA;
   assign y = {4'd0, b[7:4]};
endmodule
module top(input [3:0] a, output [31:0] y);
   ch u(.a({4'd0, a}), .y(y[7:0]));
   assign y[31:8] = 24'd0;
endmodule`)
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('u.b[7]')
  })
})

describe('OVER-REFUSAL CONTROLS — a sub-module inout nothing reads still BUILDS', () => {
  const CHILD = `
module ch(input [7:0] a, inout [7:0] b, output [7:0] y);
   assign y = ~a;
endmodule`
  // ~8'd5 is 8'hFA. Every control below must read 250, not refuse and not read 0.
  const INVERTED = 250n

  test('the inout is left UNCONNECTED and never read (Icarus: 250)', () => {
    const { block, warnings } = importVerilog(`${CHILD}
module top(input [3:0] a, output [31:0] y);
   ch u(.a({4'd0, a}), .y(y[7:0]));
   assign y[31:8] = 24'd0;
endmodule`)
    expect(block, said(warnings)).not.toBeNull()
    expect(readY(block as BlockData, 5)).toBe(INVERTED)
  })

  test('the inout IS connected, but the parent never reads that wire (Icarus: 250)', () => {
    const { block, warnings } = importVerilog(`${CHILD}
module top(input [3:0] a, output [31:0] y);
   wire [7:0] bus;
   ch u(.a({4'd0, a}), .b(bus), .y(y[7:0]));
   assign y[31:8] = 24'd0;
endmodule`)
    expect(block, said(warnings)).not.toBeNull()
    expect(readY(block as BlockData, 5)).toBe(INVERTED)
  })

  test('a POSITIONAL instance still aligns past the dropped inout (Icarus: 250)', () => {
    // The dropped port keeps a null place in portPositions, so the third connection still reaches `y`. If
    // it did not, `y` would have no driver at all and this would read 0.
    const { block, warnings } = importVerilog(`${CHILD}
module top(input [3:0] a, output [31:0] y);
   wire [7:0] bus;
   ch u({4'd0, a}, bus, y[7:0]);
   assign y[31:8] = 24'd0;
endmodule`)
    expect(block, said(warnings)).not.toBeNull()
    expect(readY(block as BlockData, 5)).toBe(INVERTED)
  })

  test("the PARENT owns a net named `b` too — the child's claim must not reach it (Icarus: 50170)", () => {
    // The child's refused `b` is renamed to `u.b` when it is inlined, so the parent's own `b` (8'hC3, read
    // into y[31:8]) is untouched: 0xC3 << 8 | 0xFA. A claim that leaked across the boundary would refuse.
    const { block, warnings } = importVerilog(`${CHILD}
module top(input [3:0] a, output [31:0] y);
   wire [7:0] b;
   assign b = 8'hC3;
   ch u(.a({4'd0, a}), .y(y[7:0]));
   assign y[31:8] = {16'd0, b};
endmodule`)
    expect(block, said(warnings)).not.toBeNull()
    expect(readY(block as BlockData, 5)).toBe(50170n)
  })

  test('a module with no inout at all is untouched (Icarus: 165)', () => {
    const { block, warnings } = importVerilog(
      `module top(input [3:0] a, output [31:0] y);
   assign y = a * 8'd33;
endmodule`,
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(readY(block as BlockData, 5)).toBe(165n)
    expect(pinsOf(block as BlockData)).toContain('y[7]')
  })
})
