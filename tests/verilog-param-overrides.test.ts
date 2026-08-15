/**
 * PARAMETER OVERRIDES ON INSTANTIATION — `sub #(.W(4)) u(…)` and `sub #(4) u(…)`.
 *
 * Parameters are elaborated away before a module is parsed, so an override cannot be patched onto a module
 * that is already folded. The child is ELABORATED AGAIN at the overridden values instead — once per distinct
 * value set — which is what the LRM describes and the only way that gets the dependent declarations right: a
 * `localparam N = 2*W` inside the child has to fold against the OVERRIDDEN W, not the default, or the ports
 * are sized from the new value and the internal nets from the old one and the module builds a different
 * answer with nothing said.
 *
 * EVERY expected value below is the output of Icarus Verilog 14.0 (oss-cad-suite) on the same source — swept
 * over the whole input space for a combinational design, or read after each rising edge for a clocked one —
 * not what this implementation happens to return. The full sweep (24 designs, 8,144 compared bits, zero
 * disagreements) was run outside this file; these tests are the regression net that keeps the behaviour.
 *
 * Sub-forms deliberately left REFUSING, each by name, because Icarus rejects the source outright or builds
 * something this importer cannot represent:
 *   - an override naming a parameter the module does not declare (Icarus: "parameter `NOPE` not found")
 *   - an override of a `localparam` (Icarus: "Cannot override localparam")
 *   - an override of a body parameter on a module that HAS a header `#( … )` list (Icarus: "Parameter cannot
 *     be overridden in the scope it has been declared in")
 *   - a list mixing named and positional items (Icarus: a syntax error)
 *   - an override that drives a declared range negative — `#(.W(0))` makes `[W-1:0]` a TWO-bit `[-1:0]` in
 *     Icarus, and this importer only represents zero-based `[N:0]`, so it refuses rather than guess a width
 *   - an override that is not a constant expression, and a name set twice
 *   - a parameter that never converges through a recursive instantiation (bounded and refused, not hung)
 *   - `defparam`, which is a different construct and still refuses at its own site
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

/** Import and assert the build is clean. `allowed` names the warnings a design is EXPECTED to raise; anything
 *  else still fails, so a new warning can never slip in unnoticed. */
function build(verilog: string, allowed: string[] = []): BlockData {
  const { block, warnings } = importVerilog(verilog)
  const unexpected = warnings.filter((warning) => !allowed.some((a) => warning.includes(a)))
  expect(unexpected, `warnings: ${warnings.join(' | ')}`).toEqual([])
  expect(block, 'should build a block').not.toBeNull()
  return block as BlockData
}

/** Drive a bus of input bit-ports from a number, solve, and read a bus of output bit-ports back. */
function evaluate(
  block: BlockData,
  ins: Record<string, { value: number; width: number }>,
  outs: Record<string, number>,
): Record<string, number> {
  const levels: Record<string, boolean> = {}
  for (const [name, spec] of Object.entries(ins))
    for (let b = 0; b < spec.width; b++)
      levels[spec.width === 1 ? name : `${name}[${b}]`] = ((spec.value >> b) & 1) === 1
  const result = solve(block, levels, new Map())
  const read: Record<string, number> = {}
  for (const [name, width] of Object.entries(outs)) {
    let v = 0
    for (let b = 0; b < width; b++)
      if (result.value('M', width === 1 ? name : `${name}[${b}]`) === true) v |= 1 << b
    read[name] = v
  }
  return read
}

/** Every 4-bit value of `a` against `y = ~a`, the table Icarus printed for the designs below. */
function expectInvertsFourBits(block: BlockData, input = 'a', output = 'y'): void {
  for (let a = 0; a < 16; a++)
    expect(
      evaluate(block, { [input]: { value: a, width: 4 } }, { [output]: 4 })[output],
      `a=${a}`,
    ).toBe(~a & 0b1111)
}

describe('Verilog parameter overrides — the value the instantiation asks for is the value built', () => {
  test('a NAMED override of a header parameter sizes the child', () => {
    // Icarus: y = ~a on four bits for all 16 values of a. At the module default W=1 this would be a one-bit
    // design with a[1..3] and y[1..3] missing from the interface entirely.
    expectInvertsFourBits(
      build(`
module inner #(parameter W = 1) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(.W(4)) u(.a(a), .y(y));
endmodule`),
    )
  })

  test('a POSITIONAL override of a header parameter sizes the child', () => {
    expectInvertsFourBits(
      build(`
module inner #(parameter W = 1) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(4) u(.a(a), .y(y));
endmodule`),
    )
  })

  test('a NAMED override reaches a BODY parameter when the module has no header list', () => {
    // Icarus accepts this: with no `#( … )` parameter port list, the body `parameter` declarations ARE the
    // overridable ones, by name and by position alike.
    expectInvertsFourBits(
      build(`
module inner(a, y);
   parameter W = 1;
   input [W-1:0] a;
   output [W-1:0] y;
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(.W(4)) u(.a(a), .y(y));
endmodule`),
    )
  })

  test('a POSITIONAL override reaches a BODY parameter when the module has no header list', () => {
    expectInvertsFourBits(
      build(`
module inner(a, y);
   parameter W = 1;
   input [W-1:0] a;
   output [W-1:0] y;
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(4) u(.a(a), .y(y));
endmodule`),
    )
  })

  test('a dependent LOCALPARAM folds against the overridden value, not the default', () => {
    // The whole reason an override has to be applied at the DECLARATION POINT. `N = 2*W` sizes the internal
    // wire; with a stale N the ports would be four bits and `t` two, and the module would still build.
    // Icarus: y = ~a over four bits.
    expectInvertsFourBits(
      build(`
module inner #(parameter W = 2) (input [W-1:0] a, output [W-1:0] y);
   localparam N = 2 * W;
   wire [N-1:0] t;
   assign t = {~a, ~a};
   assign y = t[W-1:0];
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(.W(4)) u(.a(a), .y(y));
endmodule`),
    )
  })

  test('a later HEADER parameter folds against the overridden earlier one', () => {
    // Icarus: with W=4, N=8 and the ports are eight bits; y = ~a. Spot-checked here at three values of the
    // full 256-row sweep that agreed outside this file.
    const block = build(`
module inner #(parameter W = 2, parameter N = 2 * W) (input [N-1:0] a, output [N-1:0] y);
   assign y = ~a;
endmodule
module top(input [7:0] a, output [7:0] y);
   inner #(.W(4)) u(.a(a), .y(y));
endmodule`)
    for (const a of [0, 0b01011010, 255])
      expect(evaluate(block, { a: { value: a, width: 8 } }, { y: 8 }).y, `a=${a}`).toBe(~a & 0xff)
  })

  test('an override PROPAGATES two levels down: mid passes its own W to leaf', () => {
    // The ordinary real-world shape. `.W(W)` inside `mid` is folded in mid's own (already overridden) scope.
    expectInvertsFourBits(
      build(`
module leaf #(parameter W = 1) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module mid #(parameter W = 1) (input [W-1:0] a, output [W-1:0] y);
   leaf #(.W(W)) g(.a(a), .y(y));
endmodule
module top(input [3:0] a, output [3:0] y);
   mid #(.W(4)) u(.a(a), .y(y));
endmodule`),
    )
  })

  test('two DIFFERENT overrides and a default instance of one module all build at their own widths', () => {
    // The cache-collision test. Keyed by module name alone, the first elaboration would be reused for all
    // three and two of them would be silently wrong. Icarus: y4 = ~a4 on four bits, y2 = ~a2 on two, and the
    // un-overridden `up` at the module's own default W=4.
    const block = build(`
module inner #(parameter W = 4) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a4, input [1:0] a2, output [3:0] y4, output [1:0] y2, output [3:0] yp);
   inner #(.W(4)) u4(.a(a4), .y(y4));
   inner #(.W(2)) u2(.a(a2), .y(y2));
   inner up(.a(a4), .y(yp));
endmodule`)
    for (let a = 0; a < 16; a++) {
      const got = evaluate(
        block,
        { a4: { value: a, width: 4 }, a2: { value: a & 0b11, width: 2 } },
        { y4: 4, y2: 2, yp: 4 },
      )
      expect(got, `a=${a}`).toEqual({ y4: ~a & 0b1111, y2: ~a & 0b11, yp: ~a & 0b1111 })
    }
  })

  test('two CLOCKED copies at different widths keep their own modulus', () => {
    // Icarus on this source, reading q4/q2 after each rising edge once reset is released:
    //   1 1 / 2 2 / 3 3 / 4 0 / 5 1 / 6 2 / 7 3 / 8 0 / 9 1 / 10 2
    // The two-bit counter wraps at 4 and the four-bit one does not — which is exactly what a name-keyed
    // elaboration cache would lose, by building both at the first instance's width.
    const block = build(`
module counter #(parameter W = 2) (input clk, input rst, output [W-1:0] q);
   reg [W-1:0] r;
   always @(posedge clk) begin
      if (rst) r <= 0;
      else r <= r + 1;
   end
   assign q = r;
endmodule
module top(input clk, input rst, output [3:0] q4, output [1:0] q2);
   counter #(.W(4)) a(.clk(clk), .rst(rst), .q(q4));
   counter #(.W(2)) b(.clk(clk), .rst(rst), .q(q2));
endmodule`)
    const state = new Map<string, boolean>()
    solve(block, { clk: false, rst: true }, state)
    solve(block, { clk: true, rst: true }, state)
    const seen: string[] = []
    for (let n = 0; n < 10; n++) {
      solve(block, { clk: false, rst: false }, state)
      const r = solve(block, { clk: true, rst: false }, state)
      const read = (name: string, width: number): number => {
        let v = 0
        for (let b = 0; b < width; b++) if (r.value('M', `${name}[${b}]`) === true) v |= 1 << b
        return v
      }
      seen.push(`${read('q4', 4)} ${read('q2', 2)}`)
    }
    expect(seen).toEqual(['1 1', '2 2', '3 3', '4 0', '5 1', '6 2', '7 3', '8 0', '9 1', '10 2'])
  })

  test('an override expression read from the PARENT parameter builds both instances', () => {
    // `.W(W)` here names the CHILD's parameter with the PARENT's value, and `.W(4)` a literal, in one module.
    // Icarus: y = ~a on four bits, z = ~a[2:0] on three.
    const block = build(`
module inner #(parameter W = 2) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top #(parameter W = 3) (input [3:0] a, output [3:0] y, output [2:0] z);
   wire [2:0] iz;
   inner #(.W(4)) u(.a(a), .y(y));
   inner #(.W(W)) v(.a(a[2:0]), .y(iz));
   assign z = iz;
endmodule`)
    for (let a = 0; a < 16; a++)
      expect(evaluate(block, { a: { value: a, width: 4 } }, { y: 4, z: 3 }), `a=${a}`).toEqual({
        y: ~a & 0b1111,
        z: ~a & 0b111,
      })
  })

  test('the same value written two ways is one elaboration and both instances are right', () => {
    // `#(.W(4))` and `#(.W(2 + 2))` resolve to the same value, so they share a copy — and sharing must not
    // cost either instance its own connections. Icarus: ya = ~a, yb = ~b, both four bits.
    const block = build(`
module inner #(parameter W = 1) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a, input [3:0] b, output [3:0] ya, output [3:0] yb);
   inner #(.W(4)) u1(.a(a), .y(ya));
   inner #(.W(2 + 2)) u2(.a(b), .y(yb));
endmodule`)
    expect(
      evaluate(
        block,
        { a: { value: 0b0101, width: 4 }, b: { value: 0b0011, width: 4 } },
        { ya: 4, yb: 4 },
      ),
    ).toEqual({ ya: 0b1010, yb: 0b1100 })
  })

  test('a declared parameter RANGE narrows the override exactly as it narrows a default', () => {
    // Icarus on `parameter [1:0] K = 2'd1` overridden `.K(7)`: K is 3, so y = a + 3 on four bits. Taking the
    // override whole would give a + 7.
    const block = build(`
module inner #(parameter [1:0] K = 2'd1) (input [3:0] a, output [3:0] y);
   assign y = a + K;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(.K(7)) u(.a(a), .y(y));
endmodule`)
    for (let a = 0; a < 16; a++)
      expect(evaluate(block, { a: { value: a, width: 4 } }, { y: 4 }).y, `a=${a}`).toBe(
        (a + 3) & 0b1111,
      )
  })

  test('an UNRANGED parameter takes the override its own size, not the default value s', () => {
    // `parameter K = 4'd2` is unranged (the size is the default VALUE's, not a declared range), and Icarus
    // gives `.K(20)` the value 20 rather than 20 masked to four bits: y = a + 20.
    const block = build(`
module inner #(parameter K = 4'd2) (input [7:0] a, output [7:0] y);
   assign y = a + K;
endmodule
module top(input [4:0] a, output [7:0] y);
   inner #(.K(20)) u(.a({3'b000, a}), .y(y));
endmodule`)
    for (const a of [0, 1, 17, 31])
      expect(evaluate(block, { a: { value: a, width: 5 } }, { y: 8 }).y, `a=${a}`).toBe(a + 20)
  })

  test('POSITIONAL items count against `parameter` declarations only, skipping a localparam', () => {
    // `parameter A = 1; localparam L = 0; parameter B = 0;` with `#(0, 1)`. Icarus: A=0, B=1, L untouched, so
    // y = a + 4. Counting L as a position would give y = a + 2; ignoring the list entirely, y = a + 1.
    const block = build(`
module inner(a, y);
   parameter A = 1;
   localparam L = 0;
   parameter B = 0;
   input [3:0] a;
   output [3:0] y;
   assign y = a + A + (B * 4) + (L * 2);
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(0, 1) u(.a(a), .y(y));
endmodule`)
    for (let a = 0; a < 16; a++)
      expect(evaluate(block, { a: { value: a, width: 4 } }, { y: 4 }).y, `a=${a}`).toBe(
        (a + 4) & 0b1111,
      )
  })

  test('a HEADER list hides a body parameter from the positional count', () => {
    // `#(parameter W = 1)` in the header and `parameter B = 0;` in the body. Icarus warns "expects 1
    // parameter(s)" and applies only W, leaving B at 0: y = ~a on four bits, not ~a + 1.
    const block = build(
      `
module inner #(parameter W = 1) (a, y);
   parameter B = 0;
   input [W-1:0] a;
   output [W-1:0] y;
   assign y = ~a + B;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(4, 1) u(.a(a), .y(y));
endmodule`,
      ['has 1 overridable parameter'],
    )
    expectInvertsFourBits(block)
  })

  test('NAMED items bind by name, not by position', () => {
    // `#(.B(1), .W(4))` against `#(parameter W = 1, parameter B = 0)`. Icarus: W=4 and B=1, so y = ~a + 1.
    const block = build(`
module inner #(parameter W = 1, parameter B = 0) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a + B;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(.B(1), .W(4)) u(.a(a), .y(y));
endmodule`)
    for (let a = 0; a < 16; a++)
      expect(evaluate(block, { a: { value: a, width: 4 } }, { y: 4 }).y, `a=${a}`).toBe(
        ((~a & 0b1111) + 1) & 0b1111,
      )
  })

  test('MORE positional items than the module has parameters warns and builds, as Icarus does', () => {
    // Icarus: "ignoring 1 extra parameter override(s) … which expects 1 parameter(s)" — a warning, then it
    // builds with W=4. Refusing here would diverge from the oracle in the other direction.
    expectInvertsFourBits(
      build(
        `
module inner #(parameter W = 1) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(4, 9) u(.a(a), .y(y));
endmodule`,
        ['has 1 overridable parameter'],
      ),
    )
  })

  test('an override list on a module with NO parameters warns and builds it unchanged', () => {
    expectInvertsFourBits(
      build(
        `
module inner(input [3:0] a, output [3:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(4) u(.a(a), .y(y));
endmodule`,
        ['has 0 overridable parameters'],
      ),
    )
  })

  test('an EMPTY `#()` is legal and changes nothing', () => {
    expectInvertsFourBits(
      build(`
module inner #(parameter W = 4) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #() u(.a(a), .y(y));
endmodule`),
    )
  })

  test('a named PORT called `.W` no longer deletes the enclosing module s parameter W', () => {
    // A live defect at HEAD, independent of overrides: any identifier before a `(` was read as an instance
    // name, so `.W(e)` — a named PORT connection — flagged the parent's parameter `W` as an illegal
    // redeclaration and dropped it. The `[W-1:0]` ports then vanished from the published interface, warned
    // but never refused. Measured at HEAD against this exact source: 64 of the 160 swept bits were wrong.
    // Icarus: y = ~a on four bits and f = ~e.
    const block = build(`
module sub(input W, output o);
   assign o = ~W;
endmodule
module top #(parameter W = 4) (input [W-1:0] a, input e, output [W-1:0] y, output f);
   assign y = ~a;
   sub s(.W(e), .o(f));
endmodule`)
    for (let a = 0; a < 16; a++)
      for (const e of [0, 1])
        expect(
          evaluate(block, { a: { value: a, width: 4 }, e: { value: e, width: 1 } }, { y: 4, f: 1 }),
          `a=${a} e=${e}`,
        ).toEqual({ y: ~a & 0b1111, f: e === 0 ? 1 : 0 })
  })
})

describe('Verilog parameter overrides — what is refused, and by name', () => {
  /** Refusals must reach the design-level rule: nothing published, and the reason said out loud. */
  function refuses(verilog: string, needle: string): void {
    const { block, warnings } = importVerilog(verilog)
    expect(block, `warnings: ${warnings.join(' | ')}`).toBeNull()
    expect(
      warnings.some((warning) => warning.includes(needle)),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
    expect(
      warnings.some((warning) => warning.includes('is NOT built')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
  }

  test('a name the module does not declare is refused, not ignored', () => {
    // Icarus: "parameter `NOPE` not found in `top.u`. 2 error(s) during elaboration." Ignoring the item would
    // build the module at its default W and say nothing.
    refuses(
      `
module inner #(parameter W = 4) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(.NOPE(4)) u(.a(a), .y(y));
endmodule`,
      'a parameter override for "NOPE", which "inner" does not declare',
    )
  })

  test('an override of a LOCALPARAM is refused', () => {
    // Icarus: "Cannot override localparam `K`".
    refuses(
      `
module inner #(parameter W = 4) (input [W-1:0] a, output [W-1:0] y);
   localparam K = 2;
   assign y = ~a + K;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(.K(3)) u(.a(a), .y(y));
endmodule`,
      'declares as a localparam',
    )
  })

  test('an override of a BODY parameter on a module with a header list is refused', () => {
    // Icarus: "Cannot override parameter `B` … Parameter cannot be overridden in the scope it has been
    // declared in."
    refuses(
      `
module inner #(parameter W = 1) (a, y);
   parameter B = 0;
   input [W-1:0] a;
   output [W-1:0] y;
   assign y = ~a + B;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(.B(1)) u(.a(a), .y(y));
endmodule`,
      'declares in its body rather than in its #( … ) parameter list',
    )
  })

  test('a list that MIXES named and positional items is refused', () => {
    // Icarus: "Syntax error in parameter value assignment list."
    refuses(
      `
module inner #(parameter W = 1, parameter B = 0) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a + B;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(4, .B(1)) u(.a(a), .y(y));
endmodule`,
      'mixes named and positional items',
    )
  })

  test('an override that drives a range past what this importer represents is refused', () => {
    // `#(.W(0))` makes `[W-1:0]` the range `[-1:0]`, which Icarus builds as TWO bits (a=0 gives y=11). This
    // importer only represents zero-based `[N:0]`, so the honest answer is to refuse the instance — not to
    // drop the ports and publish a design whose interface quietly lost them.
    refuses(
      `
module inner #(parameter W = 1) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(.W(0)) u(.a(a), .y(y));
endmodule`,
      'a parameter override that makes "inner" report',
    )
  })

  test('an override that is not a constant expression is refused', () => {
    refuses(
      `
module inner #(parameter W = 4) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(.W(a)) u(.a(a), .y(y));
endmodule`,
      'is not a constant expression',
    )
  })

  test('the same parameter set twice in one list is refused', () => {
    refuses(
      `
module inner #(parameter W = 4) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner #(.W(4), .W(4)) u(.a(a), .y(y));
endmodule`,
      'sets "W" twice',
    )
  })

  test('a parameter that never converges through recursion is refused, not elaborated forever', () => {
    // Re-keying the recursion guard by (module, parameter set) is what makes a self-instantiation with a
    // CHANGING parameter invisible to it — every copy is a different module. A depth bound catches it and
    // refuses; without one the app would elaborate copies until it ran out of memory.
    const started = Date.now()
    refuses(
      `
module rec #(parameter N = 8) (input [3:0] a, output [3:0] y);
   rec #(.N(N + 1)) g(.a(a), .y(y));
endmodule
module top(input [3:0] a, output [3:0] y);
   rec #(.N(1)) u(.a(a), .y(y));
endmodule`,
      'nested more than 64 modules deep',
    )
    expect(Date.now() - started).toBeLessThan(5000)
  })

  test('`defparam` is a different construct and still refuses at its own site', () => {
    refuses(
      `
module inner #(parameter W = 1) (input [W-1:0] a, output [W-1:0] y);
   assign y = ~a;
endmodule
module top(input [3:0] a, output [3:0] y);
   inner u(.a(a), .y(y));
   defparam u.W = 4;
endmodule`,
      '"defparam" is a construct this importer does not build',
    )
  })

  test('a refused override still CLAIMS the nets it would have driven', () => {
    // The rule commit 9c20f7a added has to keep holding for the sub-forms that still refuse: the instance
    // wrote a driver onto `o`, so the parent's `assign o = b` is not its sole driver and the contention is
    // reported rather than one driver silently winning.
    const { block, warnings } = importVerilog(`
module sub #(parameter W = 4) (x, y);
   input [3:0] x;
   output [3:0] y;
   assign y = ~x;
endmodule
module top(input [3:0] a, input [3:0] b, output [3:0] o);
   sub #(.NOPE(4)) u(.x(a), .y(o));
   assign o = b;
endmodule`)
    expect(block).toBeNull()
    expect(
      warnings.some((warning) => warning.includes('assigned more than once')),
      `warnings: ${warnings.join(' | ')}`,
    ).toBe(true)
  })
})
