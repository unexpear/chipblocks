/**
 * THE TRANSITIVE-UNBUILT RULE, at the doors the skipped-construct ledger cannot see, plus the two constructs
 * that were being refused although they describe ordinary hardware.
 *
 * A net can reach "no honest value" without any construct being skipped: nothing ever drove it, or every
 * driver it had was retracted (two drivers contending, a combinational loop, a driver on an input port).
 * Verilog reads all three as x; a two-valued netlist reads them as 0. Publishing a design whose output is
 * worked out from that 0 is the worst answer available, so each of them must refuse the design and say so.
 *
 * The other half is the opposite failure: refusing hardware that IS representable. `always @(posedge clk or
 * posedge reset)` and `initial <reg> = 0` are ordinary RTL — the first is a flip-flop with an asynchronous
 * clear, the second is that flip-flop's power-on value — and both are built here rather than reported.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { D_FLIPFLOP_CLEAR_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const bus = 'input [3:0] a; input [3:0] b; output [3:0] o;'
const mod = (body: string): string => `module m(a,b,o); ${bus} ${body} endmodule`

/** Every warning joined, so a test can ask what the user was actually told. */
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

/** One logic solve of a block: drive each named port 0/1, power it, read outputs by port id. */
function solve(
  block: BlockData,
  inputs: Record<string, boolean>,
  state: Map<string, boolean>,
): ReturnType<typeof simulateLogic> {
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

describe('a net with no honest value is unbuilt, however it lost its driver', () => {
  test('a wire nothing drives, read by an output, refuses the design', () => {
    // Icarus Verilog 14.0 on this source gives o = x where a is 0 and 1 where a is 1; a netlist that reads
    // the undriven t as 0 answers o = a. Publishing that is inventing three of the four bits.
    const { block, warnings } = importVerilog(mod('wire [3:0] t; assign o = t | a;'))
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('is NOT built')
    expect(said(warnings)).toContain('no driver at all')
    expect(said(warnings)).toContain('"t[0]"')
  })

  test('two drivers on one net take the design with them, not just that net', () => {
    const { block, warnings } = importVerilog(
      mod('wire t; assign t = a[0]; assign t = b[0]; assign o = {a[3:1], t};'),
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('more than one driver')
  })

  test('a combinational loop is unbuilt rather than published as 0', () => {
    const { block, warnings } = importVerilog(
      mod('wire [3:0] t; assign t = {a[3:1], t[0]}; assign o = t;'),
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('combinational loop')
  })

  test('a gate driving an input port is reported and loses; the pin keeps the net', () => {
    // Driving your own input is illegal Verilog, and Icarus resolves the two drivers to x. A two-valued
    // netlist has no x to publish, so the illegal driver is dropped and the value applied to the PIN is what
    // the design reads — which is the one reading here that is not invented. It is reported eitherway.
    const { block, warnings } = importVerilog(mod('and g(a[0], b[0], b[1]); assign o = a | b;'))
    expect(said(warnings)).toContain('input port')
    expect(block, 'the pin still drives a[0], so the rest of the design is complete').not.toBeNull()
  })

  test('an output port nothing drives is left OUT of the interface, not refused', () => {
    // The other direction of the rule. o[3] has no driver, but lower() gives the block no o[3] pin at all,
    // so there is nothing for anyone to read an invented 0 from — and refusing here would erase o[2:0],
    // which is real hardware. The port that went missing is named.
    const { block, warnings } = importVerilog(mod('assign o[2:0] = a[2:0];'))
    expect(block, said(warnings)).not.toBeNull()
    const ids = (block as BlockData).ports.map((p) => p.id)
    expect(ids).not.toContain('o[3]')
    expect(ids).toEqual(expect.arrayContaining(['o[0]', 'o[1]', 'o[2]']))
    expect(said(warnings)).toContain('"o[3]" is not connected')
  })

  test('a net an unbuildable construct never touched still builds', () => {
    // The rule has to be precise in BOTH directions: the generate below drives t, and nothing reads t, so
    // the o = a & b this design actually publishes is complete and is published.
    const { block, warnings } = importVerilog(
      mod(
        'wire [3:0] t; genvar i; generate for (i=0;i<4;i=i+1) begin: gg assign t[i] = a[i]; end endgenerate assign o = a & b;',
      ),
    )
    expect(block, said(warnings)).not.toBeNull()
  })

  test('an ordinary design is untouched by the rule', () => {
    const { block, warnings } = importVerilog(
      mod('wire [3:0] t; assign t = a & b; assign o = t | a;'),
    )
    expect(warnings).toEqual([])
    expect(block).not.toBeNull()
  })
})

describe('asynchronous reset is a flip-flop with a clear, not an unbuildable construct', () => {
  const asyncMod = (body: string): string =>
    `module m(clk, rst, d, q); input clk; input rst; input [3:0] d; output [3:0] q; ${body} endmodule`

  test('@(posedge clk or posedge rst) builds, with no warning at all', () => {
    const { block, warnings } = importVerilog(
      asyncMod(
        "reg [3:0] r; always @(posedge clk or posedge rst) if (rst) r <= 4'd0; else r <= d; assign q = r;",
      ),
    )
    expect(warnings).toEqual([])
    expect(block).not.toBeNull()
  })

  test('the clear is asynchronous: it clears with no clock edge, and the 0 survives release', () => {
    const { block } = importVerilog(
      asyncMod(
        "reg [3:0] r; always @(posedge clk or posedge rst) if (rst) r <= 4'd0; else r <= d; assign q = r;",
      ),
    )
    const b = block as BlockData
    const state = new Map<string, boolean>()
    const hi = { 'd[0]': true, 'd[1]': true, 'd[2]': true, 'd[3]': true }
    // load 1111 on a rising edge
    solve(b, { ...hi, clk: false, rst: false }, state)
    let r = solve(b, { ...hi, clk: true, rst: false }, state)
    expect(r.value('M', 'q[0]')).toBe(true)
    // raise the clear WITHOUT moving the clock — q must go to 0 anyway
    r = solve(b, { ...hi, clk: true, rst: true }, state)
    expect(r.value('M', 'q[0]'), 'clear must not wait for a clock edge').toBe(false)
    // release the clear, still with no clock edge — the 0 must hold, not spring back
    r = solve(b, { ...hi, clk: true, rst: false }, state)
    expect(r.value('M', 'q[0]'), 'a cleared bit must stay cleared after release').toBe(false)
  })

  test('the reset net is read off the body, so the clock may be written second', () => {
    const { block, warnings } = importVerilog(
      asyncMod(
        "reg [3:0] r; always @(posedge rst or posedge clk) if (rst) r <= 4'd0; else r <= d; assign q = r;",
      ),
    )
    expect(warnings).toEqual([])
    expect(block).not.toBeNull()
  })

  test('a reset that loads a 1 is refused by name, not approximated', () => {
    const { block, warnings } = importVerilog(
      asyncMod(
        "reg [3:0] r; always @(posedge clk or posedge rst) if (rst) r <= 4'd1; else r <= d; assign q = r;",
      ),
    )
    expect(block).toBeNull()
    expect(said(warnings)).toContain('something other than 0')
  })

  test('a register cleared on reset but never assigned otherwise is refused by name', () => {
    const { block, warnings } = importVerilog(
      asyncMod(
        "reg [3:0] r; reg [3:0] s; always @(posedge clk or posedge rst) if (rst) begin r <= 4'd0; s <= 4'd0; end else r <= d; assign q = r ^ s;",
      ),
    )
    expect(block).toBeNull()
    expect(said(warnings)).toContain('never assigned otherwise')
  })

  test('a level-sensitive signal among the edges is still refused', () => {
    const { warnings } = importVerilog(
      asyncMod('reg [3:0] r; always @(posedge clk or rst) r <= d; assign q = r;'),
    )
    expect(said(warnings)).toContain('level-sensitive')
  })

  test('more than two posedge signals is refused', () => {
    const { warnings } = importVerilog(
      `module m(clk, rst, x, d, q); input clk; input rst; input x; input [3:0] d; output [3:0] q; reg [3:0] r; always @(posedge clk or posedge rst or posedge x) if (rst) r <= 4'd0; else r <= d; assign q = r; endmodule`,
    )
    expect(said(warnings)).toContain('more than two posedge')
  })

  test('the reset survives being inside a sub-module', () => {
    // The flattener renames every net of an inlined module; a reset it forgot to rename would dangle.
    const { block, warnings } = importVerilog(
      `module sub(clk, rst, d, q); input clk; input rst; input [3:0] d; output [3:0] q;
         reg [3:0] r; always @(posedge clk or posedge rst) if (rst) r <= 4'd0; else r <= d; assign q = r; endmodule
       module m(clk, rst, d, q); input clk; input rst; input [3:0] d; output [3:0] q;
         sub u(.clk(clk), .rst(rst), .d(d), .q(q)); endmodule`,
    )
    expect(warnings).toEqual([])
    expect(block).not.toBeNull()
  })
})

describe('the D flip-flop with clear is a real asynchronous-clear cell', () => {
  test('CLR forces Q to 0 with the clock parked, and Q stays 0 when CLR is released', () => {
    const state = new Map<string, boolean>()
    const on = { d: true, clk: false, clr: false }
    solve(D_FLIPFLOP_CLEAR_BLOCK, on, state)
    let r = solve(D_FLIPFLOP_CLEAR_BLOCK, { ...on, clk: true }, state)
    expect(r.value('M', 'q'), 'loads D on the rising edge').toBe(true)
    r = solve(D_FLIPFLOP_CLEAR_BLOCK, { d: true, clk: true, clr: true }, state)
    expect(r.value('M', 'q')).toBe(false)
    r = solve(D_FLIPFLOP_CLEAR_BLOCK, { d: true, clk: true, clr: false }, state)
    expect(r.value('M', 'q')).toBe(false)
  })

  test('with CLR low it is exactly the plain flip-flop: Q follows D only at an edge', () => {
    const state = new Map<string, boolean>()
    solve(D_FLIPFLOP_CLEAR_BLOCK, { d: false, clk: false, clr: true }, state)
    solve(D_FLIPFLOP_CLEAR_BLOCK, { d: false, clk: false, clr: false }, state)
    let r = solve(D_FLIPFLOP_CLEAR_BLOCK, { d: true, clk: false, clr: false }, state)
    expect(r.value('M', 'q'), 'D alone must not reach Q').toBe(false)
    r = solve(D_FLIPFLOP_CLEAR_BLOCK, { d: true, clk: true, clr: false }, state)
    expect(r.value('M', 'q')).toBe(true)
  })
})

describe('initial <reg> = <constant> is a power-on value, not a second driver', () => {
  test('a zero power-on value on a clocked register builds, with no contention reported', () => {
    const { block, warnings } = importVerilog(
      `module m(clk, o); input clk; output o; reg phase; initial phase = 1'b0; always @(posedge clk) phase <= ~phase; assign o = phase; endmodule`,
    )
    expect(warnings).toEqual([])
    expect(block).not.toBeNull()
  })

  test('a non-zero power-on value is refused by name', () => {
    const { block, warnings } = importVerilog(
      `module m(clk, o); input clk; output o; reg phase; initial phase = 1'b1; always @(posedge clk) phase <= ~phase; assign o = phase; endmodule`,
    )
    expect(block).toBeNull()
    expect(said(warnings)).toContain('power up holding 0')
  })

  test('a power-on value on a register nothing clocks is refused by name', () => {
    const { block, warnings } = importVerilog(
      mod("reg [3:0] r; initial r = 4'd0; assign o = r | a;"),
    )
    expect(block).toBeNull()
    expect(said(warnings)).toContain('nothing clocks it')
  })

  // An assignment is a CONTEXT, and the context of a power-on value is the register's DECLARED WIDTH. Folding
  // it context-free applied the lossless width a parameter VALUE gets, and that width contains the shift wall:
  // the expression wrapped to zero, matched the flip-flop's power-up 0, and the design BUILT holding the wrong
  // value with nothing said. Every number below is the output of Icarus Verilog 14.0 on the same source, read
  // through a 32-bit probe.
  const clocked = (decl: string, init: string): string =>
    `module m(clk, o); input clk; output [31:0] o; reg ${decl} r; initial r = ${init}; always @(posedge clk) r <= r; assign o = r; endmodule`

  test('a shift in a power-on value takes the register width, not the shift wall (Icarus: 16)', () => {
    const { block, warnings } = importVerilog(clocked('[7:0]', "4'd8 << 1"))
    expect(block).toBeNull()
    expect(said(warnings)).toContain('asks for 16')
  })

  test('a wider register carries the same shift further (Icarus: 48)', () => {
    const { block, warnings } = importVerilog(clocked('[15:0]', "4'd12 << 2"))
    expect(block).toBeNull()
    expect(said(warnings)).toContain('asks for 48')
  })

  test('a shift by ZERO still takes the register width (Icarus: 16)', () => {
    const { block, warnings } = importVerilog(clocked('[15:0]', "(4'd15 + 4'd1) << 0"))
    expect(block).toBeNull()
    expect(said(warnings)).toContain('asks for 16')
  })

  test('a bitwise negate fills to the register width (Icarus: 240)', () => {
    const { block, warnings } = importVerilog(clocked('[7:0]', "~4'd15"))
    expect(block).toBeNull()
    expect(said(warnings)).toContain('asks for 240')
  })

  test('an ordinary sized shift reports its real value (Icarus: 8)', () => {
    const { block, warnings } = importVerilog(clocked('[7:0]', "8'd1 << 3"))
    expect(block).toBeNull()
    expect(said(warnings)).toContain('asks for 8')
  })

  test('a value too wide for the register TRUNCATES to zero and builds (Icarus: 0)', () => {
    const { block, warnings } = importVerilog(clocked('[3:0]', "8'd16"))
    expect(warnings).toEqual([])
    expect(block).not.toBeNull()
  })

  test('an overflowing add truncates to zero in a narrow register and builds (Icarus: 0)', () => {
    const { block, warnings } = importVerilog(clocked('[3:0]', "4'd15 + 4'd1"))
    expect(warnings).toEqual([])
    expect(block).not.toBeNull()
  })

  test('a one-bit register takes the low bit of the shift, which is zero (Icarus: 0)', () => {
    const { block, warnings } = importVerilog(clocked('', "4'd8 << 1"))
    expect(warnings).toEqual([])
    expect(block).not.toBeNull()
  })

  test('an initial block that does anything else is still not built', () => {
    const { block, warnings } = importVerilog(
      mod("wire [3:0] t; assign t = a & b; initial force t = 4'hF; assign o = t;"),
    )
    expect(block).toBeNull()
    expect(said(warnings)).toContain('initial')
  })
})
