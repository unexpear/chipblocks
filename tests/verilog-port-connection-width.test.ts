/**
 * PORT-CONNECTION WIDTH — the expression written in an instance's connection list is SELF-DETERMINED, and
 * only the finished value is extended (or truncated) to the port's width (IEEE 1364-2005 §12.3.6). The port's
 * width is NOT a context that reaches down into the expression.
 *
 * The importer used to hand the port's width down as the evaluation context, so an eight-bit add feeding a
 * `[31:0]` port never wrapped: `.p(8'd200 + 8'd100)` carried 300 and `.p(a + a)` on a four-bit `a` carried 18.
 * Both BUILT, with no warning. Every expectation below is a number Icarus Verilog 14.0 printed for exactly
 * this source — measured, never reasoned out here — and the designs that were already right (an exact-width
 * port, a plain net connection, a port narrower than the expression) are in the table for the same reason the
 * wrong ones are: to keep them right.
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

/** A design whose port expression is a constant never reads `a`, and the unread input bits are dropped from
 *  the interface. That warning is expected; anything else fails the build. */
const UNCONNECTED_INPUT = 'is not connected to any gate'

function build(verilog: string): BlockData {
  const { block, warnings } = importVerilog(verilog)
  const unexpected = warnings.filter((one) => !one.includes(UNCONNECTED_INPUT))
  expect(unexpected, `warnings: ${warnings.join(' | ')}`).toEqual([])
  expect(block, 'should build a block').not.toBeNull()
  return block as BlockData
}

/** Drive the four-bit `a` and read the thirty-two-bit `y` back as an exact number. The read uses 2**bit
 *  rather than a shift: `1 << 31` is negative in JavaScript, and a probe that reports -1 for 4294967295
 *  would hide exactly the sign-extension this file is here to pin down. */
function readY(block: BlockData, aValue: number): number {
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
  for (let bit = 0; bit < 4; bit++) {
    const vid = `v${bit}`
    nodes.push(src(vid, ((aValue >> bit) & 1) === 1 ? 5 : 0))
    edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', `a[${bit}]`))
    edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
  }
  const result = simulateLogic(nodes, edges, new Map())
  let value = 0
  for (let bit = 0; bit < 32; bit++) if (result.value('M', `y[${bit}]`) === true) value += 2 ** bit
  return value
}

const CHILD = `module child(input [31:0] p, output [31:0] q);
  assign q = p;
endmodule
`
const wide = (body: string) => `${CHILD}module top(input [3:0] a, output [31:0] y);
${body}
endmodule
`

/** `a` is driven with 9 everywhere below, matching the Icarus testbench these numbers came from. */
const A = 9

describe('a port-connection expression is self-determined, then extended to the port width', () => {
  const cases: { what: string; verilog: string; icarus: number }[] = [
    {
      what: 'a named constant connection wraps at its own eight bits, not at the port',
      verilog: wide("  child u(.p(8'd200 + 8'd100), .q(y));"),
      icarus: 44,
    },
    {
      what: 'a four-bit multiply wraps at four bits',
      verilog: wide("  child u(.p(4'd9 * 4'd2), .q(y));"),
      icarus: 2,
    },
    {
      what: 'a DYNAMIC connection wraps at the operand width',
      verilog: wide('  child u(.p(a + a), .q(y));'),
      icarus: 2,
    },
    {
      what: 'a POSITIONAL connection follows the same rule as a named one',
      verilog: wide("  child u(4'd9 * 4'd2, y);"),
      icarus: 2,
    },
    {
      what: 'a subtraction borrows at four bits',
      verilog: wide("  child u(.p(4'd1 - 4'd2), .q(y));"),
      icarus: 15,
    },
    {
      what: 'a shift inside the connection sees the wrapped left operand',
      verilog: wide("  child u(.p((8'd200 + 8'd100) >> 1), .q(y));"),
      icarus: 22,
    },
    {
      what: 'a divide inside the connection divides the wrapped sum',
      verilog: wide("  child u(.p((8'd200 + 8'd100) / 8'd3), .q(y));"),
      icarus: 14,
    },
    {
      what: 'a parameter operand wraps at the parameter width',
      verilog: `${CHILD}module top(input [3:0] a, output [31:0] y);
  parameter P = 8'd200;
  child u(.p(P + P), .q(y));
endmodule
`,
      icarus: 144,
    },
    {
      what: 'the wrap happens again at every level of hierarchy',
      verilog: `module leaf(input [31:0] p, output [31:0] q);
  assign q = p;
endmodule
module mid(input [31:0] r, output [31:0] s);
  leaf u(.p(r + 8'd0), .q(s));
endmodule
module top(input [3:0] a, output [31:0] y);
  mid m(.r(8'd200 + 8'd100), .s(y));
endmodule
`,
      icarus: 44,
    },
    {
      what: 'one wrapping and one non-wrapping connection on the same instance',
      verilog: `module child(input [31:0] p, input [31:0] r, output [31:0] q);
  assign q = p + r;
endmodule
module top(input [3:0] a, output [31:0] y);
  child u(.p(8'd200 + 8'd100), .r(32'd1000), .q(y));
endmodule
`,
      icarus: 1044,
    },
    {
      what: 'a one-bit port keeps only the low bit of the wrapped value',
      verilog: `module child(input p, output [31:0] q);
  assign q = {31'd0, p};
endmodule
module top(input [3:0] a, output [31:0] y);
  child u(.p(4'd9 * 4'd2), .q(y));
endmodule
`,
      icarus: 0,
    },
  ]

  for (const one of cases)
    test(one.what, () => {
      expect(readY(build(one.verilog), A)).toBe(one.icarus)
    })
})

describe('the connections that were already right stay right', () => {
  const cases: { what: string; verilog: string; icarus: number }[] = [
    {
      what: 'an EXACT-width eight-bit port',
      verilog: `module child(input [7:0] p, output [31:0] q);
  assign q = p;
endmodule
module top(input [3:0] a, output [31:0] y);
  child u(.p(8'd200 + 8'd100), .q(y));
endmodule
`,
      icarus: 44,
    },
    {
      what: 'an EXACT-width four-bit port fed a dynamic sum',
      verilog: `module child(input [3:0] p, output [31:0] q);
  assign q = p;
endmodule
module top(input [3:0] a, output [31:0] y);
  child u(.p(a + a), .q(y));
endmodule
`,
      icarus: 2,
    },
    {
      what: 'a plain narrow net widening into a wide port',
      verilog: wide('  child u(.p(a), .q(y));'),
      icarus: 9,
    },
    {
      what: 'a port NARROWER than the expression still truncates',
      verilog: `module child(input [7:0] p, output [31:0] q);
  assign q = p;
endmodule
module top(input [3:0] a, output [31:0] y);
  child u(.p(32'd300), .q(y));
endmodule
`,
      icarus: 44,
    },
    {
      what: 'a sum that does not overflow its eight bits is unchanged',
      verilog: wide("  child u(.p(8'd5 + 8'd6), .q(y));"),
      icarus: 11,
    },
    {
      what: 'an unsized-decimal sum keeps its thirty-two bits',
      verilog: wide('  child u(.p(200 + 100), .q(y));'),
      icarus: 300,
    },
    {
      what: 'a ternary is self-determined at the WIDER of its arms, so this one does not wrap',
      verilog: wide("  child u(.p(a[0] ? (8'd200 + 8'd100) : 32'd7), .q(y));"),
      icarus: 300,
    },
    {
      what: 'a concatenation carries its own width',
      verilog: wide('  child u(.p({a, a}), .q(y));'),
      icarus: 153,
    },
    {
      what: 'a concatenation is a wall of its own inside a connection',
      verilog: wide("  child u(.p({4'd9 + 4'd9}), .q(y));"),
      icarus: 2,
    },
    {
      what: 'a signed four-bit -1 SIGN-extends into an unsigned thirty-two-bit port',
      verilog: wide(`  wire signed [3:0] s;
  assign s = -1;
  child u(.p(s), .q(y));`),
      icarus: 4294967295,
    },
    {
      what: 'a signed four-bit sum wraps at four bits and then sign-extends',
      verilog: wide(`  wire signed [3:0] s;
  assign s = -1;
  child u(.p(s + s), .q(y));`),
      icarus: 4294967294,
    },
    {
      what: 'an OUTPUT port join is unaffected — the child truncates, the parent widens',
      verilog: `module child(input [31:0] p, output [3:0] q);
  assign q = p;
endmodule
module top(input [3:0] a, output [31:0] y);
  child u(.p(4'd9 * 4'd2), .q(y[3:0]));
  assign y[31:4] = 28'd0;
endmodule
`,
      icarus: 2,
    },
  ]

  for (const one of cases)
    test(one.what, () => {
      expect(readY(build(one.verilog), A)).toBe(one.icarus)
    })
})
