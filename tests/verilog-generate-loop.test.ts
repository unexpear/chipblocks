/**
 * GENERATE FOR — a loop that says how much hardware to CREATE, unrolled before anything else reads it.
 *
 * The rule the whole feature turns on is SCOPE: each unrolled iteration is its own scope, so a `wire t`
 * inside a block labelled `g` is eight DIFFERENT nets and not one net with eight drivers. Getting that wrong
 * does not refuse — it builds a circuit that computes something else. So every design below drives each
 * iteration with a DIFFERENT input (a[i] against a[7-i], under two probe vectors whose bits all differ), and
 * the answer is read off the real gates. A shared net passes a uniform-input test; it cannot pass these.
 *
 * Every expected number is the output of Icarus Verilog 14.0 on the same source, printed through a 32-bit
 * probe at a = 8'hb4 and then a = 8'h5a. The output port is deliberately 32 bits wide: a narrow port once
 * truncated a wrong value into a right-looking one and hid a real defect for a whole round.
 *
 * What is REFUSED here is refused because it cannot be scoped or cannot be counted, and a refusal is always
 * an acceptable answer. What must never happen is a design that builds and disagrees with Icarus.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const said = (warnings: string[]): string => warnings.join(' | ')

/** A module with an EIGHT-bit input and a THIRTY-TWO-bit output, every bit of it driven. */
const probe = (body: string): string =>
  `module top(input [7:0] a, output [31:0] y);\n${body}\nendmodule\n`

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

/** Drive `a` with an eight-bit number, solve, and read the 32-bit `y` back as one integer. */
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
  for (let b = 0; b < 8; b++) {
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

/** Import, insist the design was built with its full interface, and read it at both probe vectors. */
function icarus(source: string): [bigint, bigint] {
  const { block, warnings } = importVerilog(source)
  expect(block, said(warnings)).not.toBeNull()
  const ports = (block as BlockData).ports.map((p) => p.id)
  // "pin absent" and "pin present reading 0" are different answers, and only one of them is a design.
  expect(
    ports.filter((p) => /^a\[/.test(p)),
    said(warnings),
  ).toHaveLength(8)
  expect(
    ports.filter((p) => /^y\[/.test(p)),
    said(warnings),
  ).toHaveLength(32)
  return [readY(block as BlockData, 0xb4), readY(block as BlockData, 0x5a)]
}

describe('a generate for is unrolled, and each iteration keeps its own nets', () => {
  test('a per-iteration wire is eight different nets — Icarus: 36, 90', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      wire t;
      assign t = a[i] & a[7-i];
      assign r[i] = t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([36n, 90n])
  })

  test('a per-iteration BUS keeps its own bits — Icarus: 245, 10', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 4; i = i + 1) begin : g
      wire [3:0] s;
      assign s = {a[i], a[i+1], a[i+2], a[i+3]};
      assign r[i] = ^s;
      assign r[i+4] = &s ^ a[7];
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([245n, 10n])
  })

  test('eight instances all written "u" become eight instances — Icarus: 144, 0', () => {
    expect(
      icarus(`module zsub(input p, input q, output z);
  assign z = p & ~q;
endmodule
${probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      zsub u(.p(a[i]), .q(a[7-i]), .z(r[i]));
    end
  endgenerate
  assign y = {24'd0, r};`)}`),
    ).toEqual([144n, 0n])
  })

  test('a per-iteration reg written by a per-iteration always — Icarus: 189, 90', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      reg t;
      always @* t = a[i] | a[7-i];
      assign r[i] = t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([189n, 90n])
  })

  test('a per-iteration gate primitive named g1 — Icarus: 219, 165', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      wire t;
      and g1 (t, a[i], a[7-i]);
      assign r[i] = ~t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([219n, 165n])
  })

  test('a per-iteration WOR net resolves its own two drivers — Icarus: 189, 90', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      wor t;
      assign t = a[i];
      assign t = a[7-i];
      assign r[i] = t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([189n, 90n])
  })

  test('an IMPLICIT undeclared net is per-iteration too, as Icarus makes it — Icarus: 36, 90', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      assign t = a[i] & a[7-i];
      assign r[i] = t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([36n, 90n])
  })

  test('a per-iteration wire SHADOWS a module-level one of the same name — Icarus: 292, 90', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  wire t;
  assign t = a[0] ^ a[7];
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      wire t;
      assign t = a[i] & a[7-i];
      assign r[i] = t;
    end
  endgenerate
  assign y = {23'd0, t, r};`),
      ),
    ).toEqual([292n, 90n])
  })

  test('a net really named \\g[0].t is NOT fused with the elaborated g[0].t — Icarus: 292, 90', () => {
    // The separator is proven absent from the real source rather than assumed, which is why an escaped
    // identifier spelling out a scope name stays a different object.
    expect(
      icarus(
        probe(`  wire [7:0] r;
  wire \\g[0].t ;
  assign \\g[0].t = a[0] ^ a[7];
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      wire t;
      assign t = a[i] & a[7-i];
      assign r[i] = t;
    end
  endgenerate
  assign y = {23'd0, \\g[0].t , r};`),
      ),
    ).toEqual([292n, 90n])
  })
})

describe('the shapes a generate loop is written in', () => {
  test('a BARE for with no generate/endgenerate wrapper — Icarus: 246, 255', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  for (i = 0; i < 8; i = i + 1) begin : g
    wire t;
    assign t = a[i] | ~a[7-i];
    assign r[i] = t;
  end
  assign y = {24'd0, r};`),
      ),
    ).toEqual([246n, 255n])
  })

  test('a body that is ONE item, with no begin/end and no label — Icarus: 75, 165', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1)
      assign r[i] = ~a[i];
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([75n, 165n])
  })

  test('an UNLABELLED block that declares a wire still scopes it — Icarus: 153, 204', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin
      wire t;
      assign t = a[i] ^ a[(i+2) % 8];
      assign r[i] = t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([153n, 204n])
  })

  test('a DOWN-counting loop runs eight times, not forever — Icarus: 144, 0', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 7; i >= 0; i = i - 1) begin : g
      wire t;
      assign t = a[i] & ~a[7-i];
      assign r[i] = t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([144n, 0n])
  })

  test('a NEGATIVE genvar range (-4 … 3) — Icarus: 36, 90', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = -4; i < 4; i = i + 1) begin : g
      wire t;
      assign t = a[i+4] & a[3-i];
      assign r[i+4] = t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([36n, 90n])
  })

  test('a step of two — Icarus: 154, 170', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 2) begin : g
      wire t;
      assign t = a[i] & a[i+1];
      assign r[i] = t;
      assign r[i+1] = ~t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([154n, 170n])
  })

  test('a select of the genvar itself, i[1:0] — Icarus: 210, 60', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      wire [1:0] t;
      assign t = i[1:0];
      assign r[i] = a[i] ^ t[0] ^ t[1];
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([210n, 60n])
  })

  test('ZERO iterations generate nothing at all — Icarus: 75, 165', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 0; i = i + 1) begin : g
      wire t;
      assign t = a[i];
      assign r[i] = t;
    end
  endgenerate
  assign r = a ^ 8'hff;
  assign y = {24'd0, r};`),
      ),
    ).toEqual([75n, 165n])
  })

  test('TWO separate generate regions in one module — Icarus: 240, 240', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 4; i = i + 1) begin : glo
      wire t;
      assign t = a[i] & a[i+4];
      assign r[i] = t;
    end
  endgenerate
  generate
    for (i = 4; i < 8; i = i + 1) begin : ghi
      wire t;
      assign t = a[i] | a[i-4];
      assign r[i] = t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([240n, 240n])
  })

  test('a net declared BESIDE the loop inside the region stays module-scope — Icarus: 41, 80', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    wire [7:0] wn;
    assign wn = a ^ 8'h0f;
    for (i = 0; i < 8; i = i + 1) begin : g
      assign r[i] = wn[i] & a[7-i];
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([41n, 80n])
  })
})

describe('a clocked generate loop builds one flip-flop per iteration', () => {
  /** One rising edge: a clk-LOW solve then a clk-HIGH solve, through one persistent state map. */
  function tick(block: BlockData, d: number, state: Map<string, boolean>) {
    const drive = (clk: boolean) => {
      const nodes: CanvasNodeLike[] = [
        { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
        { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
        src('vp', 5),
        src('vc', clk ? 5 : 0),
      ]
      const edges: CanvasEdgeLike[] = [
        w('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
        w('eg', 'M', 'gnd', 'g', 'reference_terminal'),
        w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
        w('ec', 'vc', 'terminal_positive', 'M', 'clk'),
        w('ecn', 'vc', 'terminal_negative', 'g', 'reference_terminal'),
      ]
      for (let b = 0; b < 4; b++) {
        const vid = `v${b}`
        nodes.push(src(vid, ((d >> b) & 1) === 1 ? 5 : 0))
        edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', `d[${b}]`))
        edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
      }
      return simulateLogic(nodes, edges, state)
    }
    drive(false)
    const high = drive(true)
    let q = 0
    for (let b = 0; b < 4; b++) if (high.value('M', `q[${b}]`) === true) q |= 1 << b
    return q
  }

  test('four per-iteration flip-flops hold four different values — Icarus: 2 then 5', () => {
    // The register-file / pipeline shape every real CPU is written in. Each flip-flop is fed from a different
    // pair of input bits, so one SHARED reg would put the same value on all four q bits — 2 (0b0010) and
    // 5 (0b0101) both have bits that differ, so neither can have come from one register.
    const { block, warnings } = importVerilog(`module top(input clk, input [3:0] d, output [3:0] q);
  genvar i;
  generate
    for (i = 0; i < 4; i = i + 1) begin : g
      reg r;
      always @(posedge clk) r <= d[i] & ~d[3-i];
      assign q[i] = r;
    end
  endgenerate
endmodule
`)
    expect(block, said(warnings)).not.toBeNull()
    const state = new Map<string, boolean>()
    expect(tick(block as BlockData, 0b1011, state)).toBe(2)
    expect(tick(block as BlockData, 0b0101, state)).toBe(5)
  })
})

describe('nesting, hierarchy and parameters', () => {
  test('a nested loop gets its own scope inside the outer one — Icarus: 71, 150', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i, j;
  generate
    for (i = 0; i < 4; i = i + 1) begin : go
      for (j = 0; j < 2; j = j + 1) begin : gi
        wire t;
        assign t = a[i*2+j] ^ a[7-i];
        assign r[i*2+j] = t;
      end
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([71n, 150n])
  })

  test('a nested loop reads a wire the ENCLOSING block declared — Icarus: 180, 90', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i, j;
  generate
    for (i = 0; i < 4; i = i + 1) begin : go
      wire ot;
      assign ot = a[i] ^ a[i+4];
      for (j = 0; j < 2; j = j + 1) begin : gi
        wire it;
        assign it = ot & a[i*2+j];
        assign r[i*2+j] = it;
      end
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([180n, 90n])
  })

  test('THREE levels of nesting — Icarus: 153, 65', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i, j, k;
  generate
    for (i = 0; i < 2; i = i + 1) begin : g1
      wire t1;
      assign t1 = a[i];
      for (j = 0; j < 2; j = j + 1) begin : g2
        wire t2;
        assign t2 = t1 ^ a[j+2];
        for (k = 0; k < 2; k = k + 1) begin : g3
          wire t3;
          assign t3 = t2 & a[k+4] ^ a[k+6];
          assign r[i*4+j*2+k] = t3;
        end
      end
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([153n, 65n])
  })

  test('TWO instances of a generate sub-module keep separate nets — Icarus: 16932, 42330', () => {
    expect(
      icarus(`module zsub(input [7:0] p, output [7:0] z);
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      wire t;
      assign t = p[i] & p[7-i];
      assign z[i] = t;
    end
  endgenerate
endmodule
${probe(`  wire [7:0] r0, r1, na;
  assign na = ~a;
  zsub u0(.p(a), .z(r0));
  zsub u1(.p(na), .z(r1));
  assign y = {16'd0, r1, r0};`)}`),
    ).toEqual([16932n, 42330n])
  })

  test('a parameter OVERRIDE changes the iteration count, twice over — Icarus: 6401, 0', () => {
    expect(
      icarus(`module zsub #(parameter N = 4) (input [7:0] p, output [7:0] z);
  genvar i;
  generate
    for (i = 0; i < N; i = i + 1) begin : g
      wire t;
      assign t = p[i] ^ p[7-i];
      assign z[i] = t;
    end
    for (i = N; i < 8; i = i + 1) begin : h
      assign z[i] = 1'b0;
    end
  endgenerate
endmodule
${probe(`  wire [7:0] r0, r1;
  zsub #(.N(2)) u0(.p(a), .z(r0));
  zsub #(.N(6)) u1(.p(a), .z(r1));
  assign y = {16'd0, r1, r0};`)}`),
    ).toEqual([6401n, 0n])
  })

  test('a parameterised instance whose parameter comes from the genvar — Icarus: 53, 90', () => {
    expect(
      icarus(`module zsub #(parameter K = 1) (input p, input q, output z);
  assign z = K ? (p & q) : (p | q);
endmodule
${probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      zsub #(.K(i % 2)) u(.p(a[i]), .q(a[7-i]), .z(r[i]));
    end
  endgenerate
  assign y = {24'd0, r};`)}`),
    ).toEqual([53n, 90n])
  })

  test('a sub-module PORT called "i" survives the genvar substitution — Icarus: 153, 0', () => {
    // `.i(x)` is a port being connected by name, never a read of the loop variable — rewriting it to
    // `.32'sd0(x)` would destroy the connection.
    expect(
      icarus(`module zsub(input i, input k, output z);
  assign z = i ^ k;
endmodule
${probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      zsub u(.i(a[i]), .k(a[7-i]), .z(r[i]));
    end
  endgenerate
  assign y = {24'd0, r};`)}`),
    ).toEqual([153n, 0n])
  })

  test('a procedural for and a generate for in one module do not disturb each other — Icarus: 39184, 8', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  reg [7:0] q;
  integer k;
  always @* begin
    for (k = 0; k < 8; k = k + 1) q[k] = a[k] ^ a[7-k];
  end
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      wire t;
      assign t = a[i] & a[(i+1) % 8];
      assign r[i] = t;
    end
  endgenerate
  assign y = {16'd0, q, r};`),
      ),
    ).toEqual([39184n, 8n])
  })
})

describe('what a generate loop cannot be, it says rather than builds', () => {
  const refused = (source: string): string => {
    const { block, warnings } = importVerilog(source)
    expect(block, said(warnings)).toBeNull()
    return said(warnings)
  }

  test('a bound that is a net has no iteration count — Icarus rejects the source outright', () => {
    expect(
      refused(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < a; i = i + 1) begin : g
      assign r[i] = a[i];
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('is not an elaboration-time constant')
  })

  test('an unroll count past the cap is REFUSED, never truncated to a narrower design', () => {
    expect(
      refused(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 100000; i = i + 1) begin : g
      assign r[i % 8] = a[i % 8];
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('needs more than 4096 iterations')
  })

  test('a parameter override that pushes the loop past the cap refuses the INSTANCE by name', () => {
    expect(
      refused(`module zsub #(parameter N = 4) (input [7:0] p, output [7:0] z);
  wire [N:0] chain;
  assign chain[0] = p[0];
  genvar i;
  generate
    for (i = 0; i < N; i = i + 1) begin : g
      assign chain[i+1] = chain[i] ^ p[(i+1) % 8];
    end
  endgenerate
  assign z = {7'd0, chain[N]};
endmodule
${probe(`  wire [7:0] r;
  zsub #(.N(4200)) u(.p(a), .z(r));
  assign y = {24'd0, r};`)}`),
    ).toContain('needs more than 4096 iterations')
  })

  test('a per-iteration LOCALPARAM has no per-iteration scope yet, so nothing is built', () => {
    // This is the one shared-name shape with no safety net downstream: two `localparam K` flattened into one
    // module scope publish silently at the LAST value, with no undriven net and no driver contention to catch
    // it. Until the name is scoped per iteration it is named here instead.
    expect(
      refused(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      localparam K = i;
      assign r[i] = a[K];
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('"localparam" inside a generate block has no scope')
  })

  test('a hierarchical read into a generated scope (g[3].t) is named, not resolved', () => {
    expect(
      refused(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      wire t;
      assign t = a[i] & a[7-i];
      assign r[i] = t;
    end
  endgenerate
  assign y = {24'd0, r ^ {8{g[3].t}}};`),
      ),
    ).toContain('is named outside its own generate block')
  })

  test('two blocks in one scope sharing a label would share their nets — Icarus rejects it too', () => {
    expect(
      refused(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 4; i = i + 1) begin : g
      assign r[i] = a[i];
    end
    for (i = 4; i < 8; i = i + 1) begin : g
      assign r[i] = a[i];
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('are both labelled "g"')
  })

  test('a loop variable that is not a genvar is not a generate loop — Icarus rejects it too', () => {
    expect(
      refused(
        probe(`  wire [7:0] r;
  genvar i;
  integer n;
  generate
    for (n = 0; n < 8; n = n + 1) begin : g
      assign r[n] = a[n];
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('is not declared as a genvar')
  })

  test('a loop naming a net declared LATER in the module is refused, as Icarus refuses it', () => {
    // Measured: Icarus Verilog 14.0 answers "Unable to bind wire/reg/memory `later[i]'" rather than
    // elaborating this, so a design built from it would be a design no conforming tool agrees with.
    expect(
      refused(
        probe(`  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      wire t;
      assign t = later[i] & a[7-i];
      assign r[i] = t;
    end
  endgenerate
  wire [7:0] r;
  wire [7:0] later;
  assign later = a ^ 8'h3c;
  assign y = {24'd0, r};`),
      ),
    ).toContain('is NOT built')
  })

  test('a per-iteration bus with bits nothing drives reads x in Verilog, so it is refused', () => {
    expect(
      refused(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 4; i = i + 1) begin : g
      wire [3:0] s;
      assign s[i] = a[i];
      assign r[i] = |s;
      assign r[i+4] = &s;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('no driver at all')
  })

  test('an instance ARRAY inside a loop stays the separate feature it was', () => {
    expect(
      refused(`module zsub(input p, output z);
  assign z = ~p;
endmodule
${probe(`  wire [7:0] r;
  zsub u [7:0] (.p(a), .z(r));
  assign y = {24'd0, r};`)}`),
    ).toContain('an instance array')
  })
})
