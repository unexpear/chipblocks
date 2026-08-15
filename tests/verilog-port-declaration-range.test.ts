/**
 * A PORT WHOSE DECLARED RANGE THIS IMPORTER CANNOT SIZE IS NOT A ONE-BIT PIN.
 *
 * `output [$clog2(16)-1:0] z;` used to warn about the RANGE and then publish anyway. Measured in the running
 * app against Icarus Verilog 14.0, the two spellings failed in two different ways and neither said anything
 * about the ANSWER:
 *
 *   - written in an ANSI header, the port was DROPPED and the block published with no z pin at all, where
 *     Icarus reads z = 15;
 *   - written as a non-ANSI body declaration, the port stayed in the header's name list and published as ONE
 *     BIT, reading 1 where Icarus reads 15. A clocked `output reg [$clog2(256)-1:0]` counter read 1 after
 *     five clock edges where Icarus reads 5.
 *
 * A port's width is the module's INTERFACE — how many pins it has, and which bit of a connection lands on
 * which one — so an unfoldable range does not cost one net, it builds a different module than the source
 * describes. The port is dropped like any other unrepresentable port (a connection to it is refused, an
 * unconnected one costs nothing), and on the module being PUBLISHED the drop itself is refused by name.
 *
 * Every number below is the output of Icarus Verilog 14.0 on the same source, read through a 32-bit probe.
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

/** Drive `a` with a four-bit number, solve, and read a named bus back as one integer. The read spans 32 bits
 *  whatever the port declares: a probe only as wide as the RIGHT answer would hide a too-narrow one. */
function readBus(block: BlockData, name: string, aVal: number): bigint {
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
  for (let b = 0; b < 32; b++) if (res.value('M', `${name}[${b}]`) === true) out |= 1n << BigInt(b)
  return out
}

describe('a top-level port whose declared range will not fold refuses the design by name', () => {
  test('ANSI header: output [$clog2(16)-1:0] z (Icarus: 15, this published with no z pin)', () => {
    const { block, warnings } = importVerilog(
      `module top(input [3:0] a, output [31:0] y, output [$clog2(16)-1:0] z);
         assign z = 4'hF;
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('port "z" range')
    expect(said(warnings)).toContain('is NOT built')
    expect(said(warnings)).toContain('inventing an interface')
  })

  test('non-ANSI body declaration: output [$clog2(16)-1:0] z (Icarus: 15, this built 1)', () => {
    const { block, warnings } = importVerilog(
      `module top(a, y, z);
         input [3:0] a;
         output [31:0] y;
         output [$clog2(16)-1:0] z;
         assign z = 4'hF;
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('port "z" range')
    expect(said(warnings)).toContain('is NOT built')
  })

  test('a CLOCKED output reg [$clog2(256)-1:0] counter (Icarus: 5 after five edges, this built 1)', () => {
    const { block, warnings } = importVerilog(
      `module top(a, y, z, clk, rst);
         input [3:0] a;
         input clk;
         input rst;
         output [31:0] y;
         output reg [$clog2(256)-1:0] z;
         always @(posedge clk) begin
           if (rst) z <= 8'd0;
           else z <= z + 8'd1;
         end
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('port "z" range')
  })

  test('an INPUT port with an unfoldable range is refused too', () => {
    const { block, warnings } = importVerilog(
      `module top(a, y, wide);
         input [3:0] a;
         input [$clog2(16)-1:0] wide;
         output [31:0] y;
         assign y = wide;
       endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('port "wide" range')
  })

  test('an INOUT port with an unfoldable range is refused, not quietly dropped', () => {
    const { block, warnings } = importVerilog(
      `module top(input [3:0] a, output [31:0] y, inout [$clog2(16)-1:0] z);
         assign z = 4'hF;
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('port "z" range')
  })

  test('a $bits range on a port is refused (Icarus: 15, this built 1)', () => {
    const { block, warnings } = importVerilog(
      `module top(a, y, z);
         input [3:0] a;
         output [31:0] y;
         output [$bits(a)-1:0] z;
         assign z = 4'hF;
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('port "z" range')
  })

  test('a user FUNCTION call in a port range is refused (Icarus: 15, this built 1)', () => {
    const { block, warnings } = importVerilog(
      `module top(a, y, z);
         input [3:0] a;
         output [31:0] y;
         function integer f;
           input integer n;
           f = n;
         endfunction
         output [f(4)-1:0] z;
         assign z = 4'hF;
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('port "z" range')
  })

  test('an ASCENDING port range folds but is not representable, and is refused (Icarus: 15)', () => {
    const { block, warnings } = importVerilog(
      `module top(input [3:0] a, output [31:0] y, output [0:3] z);
         assign z = 4'hF;
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('must be [N:0]')
    expect(said(warnings)).toContain('port "z" range')
  })

  test('every name on one unfoldable declaration is named, not just the first', () => {
    const { block, warnings } = importVerilog(
      `module top(input [3:0] a, output [31:0] y, output [$clog2(16)-1:0] z, zz);
         assign z = 4'hF;
         assign zz = 4'hF;
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('port "z" range')
    expect(said(warnings)).toContain('port "zz" range')
  })
})

describe('a SUB-module port is dropped, and only what touches it is refused', () => {
  test('a connection to an unfoldable sub-module port refuses the design (Icarus: 15)', () => {
    const { block, warnings } = importVerilog(
      `module sub(p, q);
         input [3:0] p;
         output [$clog2(16)-1:0] q;
         assign q = 4'hF;
       endmodule
       module top(a, y, z);
         input [3:0] a;
         output [31:0] y;
         output [7:0] z;
         sub u(.p(a), .q(z));
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('port "q" range')
    expect(said(warnings)).toContain('is NOT built')
  })

  test('an UNCONNECTED unfoldable sub-module port costs nothing (Icarus: 165)', () => {
    const { block, warnings } = importVerilog(
      `module sub(input [3:0] p, output [7:0] o, output [$clog2(16)-1:0] q);
         assign o = 8'hA5;
         assign q = 4'hF;
       endmodule
       module top(a, y, z);
         input [3:0] a;
         output [31:0] y;
         output [7:0] z;
         sub u(.p(a), .o(z));
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(readBus(block as BlockData, 'z', 0)).toBe(165n)
  })
})

describe('a port range that DOES fold still builds — the refusal is not widened', () => {
  test('a plain constant port range (Icarus: 165)', () => {
    const { block, warnings } = importVerilog(
      `module top(input [3:0] a, output [31:0] y, output [7:0] z);
         assign z = 8'hA5;
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(readBus(block as BlockData, 'z', 0)).toBe(165n)
  })

  test('a header-parameter port range [W-1:0] (Icarus: 165)', () => {
    const { block, warnings } = importVerilog(
      `module top #(parameter W = 8) (input [3:0] a, output [31:0] y, output [W-1:0] z);
         assign z = 8'hA5;
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(readBus(block as BlockData, 'z', 0)).toBe(165n)
  })

  test('a non-ANSI port sized from a localparam (Icarus: 15)', () => {
    const { block, warnings } = importVerilog(
      `module top(a, y, z);
         input [3:0] a;
         output [31:0] y;
         localparam N = 4;
         output [N-1:0] z;
         assign z = 4'hF;
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(readBus(block as BlockData, 'z', 0)).toBe(15n)
  })

  test('an ordinary sub-module with foldable non-ANSI ports (Icarus: 165)', () => {
    const { block, warnings } = importVerilog(
      `module sub(p, q);
         input [3:0] p;
         output [7:0] q;
         assign q = 8'hA5;
       endmodule
       module top(a, y, z);
         input [3:0] a;
         output [31:0] y;
         output [7:0] z;
         sub u(.p(a), .q(z));
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(readBus(block as BlockData, 'z', 0)).toBe(165n)
  })
})

describe('a function RETURN range this importer cannot size drops the function', () => {
  test('an unfoldable return range refuses the design (Icarus: 15, this built 1)', () => {
    const { block, warnings } = importVerilog(
      `module top(a, y, z);
         input [3:0] a;
         output [31:0] y;
         output [7:0] z;
         function [$clog2(16)-1:0] f;
           input [3:0] n;
           f = 4'hF;
         endfunction
         assign z = f(a);
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('function return range')
    expect(said(warnings)).toContain('is NOT built')
  })

  test('a foldable return range still builds (Icarus: 165 at a = 5)', () => {
    const { block, warnings } = importVerilog(
      `module top(a, y, z);
         input [3:0] a;
         output [31:0] y;
         output [7:0] z;
         function [7:0] f;
           input [3:0] n;
           f = {4'hA, n};
         endfunction
         assign z = f(a);
         assign y = 32'd4040;
       endmodule`,
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(readBus(block as BlockData, 'z', 5)).toBe(165n)
  })
})
