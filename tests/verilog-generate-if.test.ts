/**
 * GENERATE IF / GENERATE CASE — the conditional forms, which choose ONE branch at elaboration time and
 * discard the rest. Unlike a mux, the branch not taken is not built at all: it contributes no nets, no gates
 * and no instances, and a name it declares never exists.
 *
 * Two mistakes here build a wrong circuit instead of refusing, so both are tested by construction rather than
 * assumed. The first is picking the WRONG branch — a fully-driven, entirely plausible design that computes
 * something else and says nothing, which is why every case-comparison shape below is checked against the
 * oracle rather than against a width model written here. The second is SHARING a net between blocks that the
 * language keeps apart, which is why the conditional forms are tested nested inside a loop, with each
 * iteration given a DIFFERENT input: a shared net passes a uniform-input test and fails these.
 *
 * Every expected number is the output of Icarus Verilog 14.0 on exactly this source, printed through a 32-bit
 * probe at a = 8'hb4 and then a = 8'h5a. The output port is deliberately 32 bits wide, and the helper insists
 * on the full pin count: a narrow port once truncated a wrong value into a right-looking one.
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

const refused = (source: string): string => {
  const { block, warnings } = importVerilog(source)
  expect(block, said(warnings)).toBeNull()
  return said(warnings)
}

describe('a generate if keeps one branch and discards the other', () => {
  test('the taken branch is built and scopes its own wire — Icarus: 187, 85', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  generate
    if (1) begin : g
      wire [7:0] t;
      assign t = a ^ 8'h0f;
      assign r = t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([187n, 85n])
  })

  test('a false condition takes the else branch — Icarus: 187, 85', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  generate
    if (0) begin : g
      assign r = a;
    end else begin : h
      assign r = a ^ 8'h0f;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([187n, 85n])
  })

  test('both arms drive one net, and only the taken one may — Icarus: 183, 93', () => {
    // If the discarded arm contributed a driver this net would have two, which this importer refuses as the
    // x it reads in Verilog. Building it, at the taken arm's value, is the whole claim of a generate if.
    expect(
      icarus(
        probe(`  wire [7:0] r;
  generate
    if (1) assign r = a + 8'd3;
    else assign r = a - 8'd3;
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([183n, 93n])
  })

  test('the two arms of one if may share a label — Icarus: 75, 165', () => {
    // Legal Verilog, and measured legal in Icarus Verilog 14.0: only one arm is ever elaborated, so the two
    // never exist at once. The duplicate-label rule applies to SIBLING blocks, not to the arms of one choice.
    expect(
      icarus(
        probe(`  wire [7:0] r;
  generate
    if (0) begin : g
      wire [7:0] t;
      assign t = a;
      assign r = t;
    end else begin : g
      wire [7:0] t;
      assign t = ~a;
      assign r = t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([75n, 165n])
  })

  test('two UNLABELLED arms each declaring wire t do not collide — Icarus: 136, 102', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  generate
    if (1) begin
      wire [7:0] t;
      assign t = a ^ 8'h3c;
      assign r = t;
    end else begin
      wire [7:0] t;
      assign t = a ~^ 8'h3c;
      assign r = t;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([136n, 102n])
  })

  test('a false if with no else generates nothing at all — Icarus: 30, 240', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  assign r = a ^ 8'haa;
  generate
    if (0) begin : g
      wire [7:0] t;
      assign t = a;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([30n, 240n])
  })

  test('a discarded branch may hold a construct this importer refuses — Icarus: 147, 125', () => {
    // A localparam inside a generate block has no scope here and is refused when it is BUILT. In the arm that
    // is thrown away it is not built, so it cannot refuse anything: the discarded tokens never reach the
    // output span at all.
    expect(
      icarus(
        probe(`  wire [7:0] r;
  generate
    if (1) begin : g
      assign r = a ^ 8'h27;
    end else begin : h
      localparam K = 3;
      assign r = a ^ K;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([147n, 125n])
  })

  test('an else-if chain picks the middle arm — Icarus: 182, 92', () => {
    expect(
      icarus(`module top(input [7:0] a, output [31:0] y);
  parameter MODE = 2;
  wire [7:0] r;
  generate
    if (MODE == 1) begin : g1 assign r = a + 8'd1; end
    else if (MODE == 2) begin : g2 assign r = a + 8'd2; end
    else begin : g3 assign r = a + 8'd3; end
  endgenerate
  assign y = {24'd0, r};
endmodule
`),
    ).toEqual([182n, 92n])
  })

  test('an else-if chain falls through to the last arm — Icarus: 183, 93', () => {
    expect(
      icarus(`module top(input [7:0] a, output [31:0] y);
  parameter MODE = 7;
  wire [7:0] r;
  generate
    if (MODE == 1) begin : g1 assign r = a + 8'd1; end
    else if (MODE == 2) begin : g2 assign r = a + 8'd2; end
    else begin : g3 assign r = a + 8'd3; end
  endgenerate
  assign y = {24'd0, r};
endmodule
`),
    ).toEqual([183n, 93n])
  })

  test('a branch with no begin/end at all — Icarus: 75, 165', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  generate
    if (0) assign r = a;
    else assign r = a ^ 8'hff;
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([75n, 165n])
  })

  test('an if nested directly inside an if branch — Icarus: 187, 97', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  generate
    if (1) begin : g
      if (0) begin : h
        assign r = a;
      end else begin : k
        assign r = a + 8'd7;
      end
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([187n, 97n])
  })

  test('a module-level if with NO generate wrapper — Icarus: 136, 102', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  if (1) begin : g
    wire [7:0] t;
    assign t = a ^ 8'h3c;
    assign r = t;
  end else begin : h
    assign r = 8'd0;
  end
  assign y = {24'd0, r};`),
      ),
    ).toEqual([136n, 102n])
  })
})

describe('a generate case picks one arm by folding the selector', () => {
  const w3 = (mode: number, body: string): string =>
    `module top(input [7:0] a, output [31:0] y);
  parameter W = ${mode};
  wire [7:0] r;
  generate
    case (${body})
      1: begin : g1 assign r = a + 8'd1; end
      2: begin : g2 assign r = a + 8'd2; end
      3: begin : g3 assign r = a + 8'd3; end
      default: begin : gd assign r = a + 8'd9; end
    endcase
  endgenerate
  assign y = {24'd0, r};
endmodule
`

  test('the matching arm wins — Icarus: 182, 92', () => {
    expect(icarus(w3(2, 'W'))).toEqual([182n, 92n])
  })

  test('a selector matching nothing falls to default — Icarus: 189, 99', () => {
    expect(icarus(w3(5, 'W'))).toEqual([189n, 99n])
  })

  test('the selector may be an expression over a parameter — Icarus: 183, 93', () => {
    expect(icarus(w3(6, 'W / 2'))).toEqual([183n, 93n])
  })

  test('several labels on one arm — Icarus: 182, 92', () => {
    expect(
      icarus(`module top(input [7:0] a, output [31:0] y);
  parameter W = 3;
  wire [7:0] r;
  generate
    case (W)
      0, 1: begin : g1 assign r = a + 8'd1; end
      2, 3: begin : g2 assign r = a + 8'd2; end
      default: begin : gd assign r = a + 8'd9; end
    endcase
  endgenerate
  assign y = {24'd0, r};
endmodule
`),
    ).toEqual([182n, 92n])
  })

  test('matching no arm with no default generates nothing — Icarus: 225, 15', () => {
    expect(
      icarus(`module top(input [7:0] a, output [31:0] y);
  parameter W = 5;
  wire [7:0] r;
  assign r = a ^ 8'h55;
  generate
    case (W)
      1: begin : g1 wire [7:0] t; assign t = a; end
      2: begin : g2 wire [7:0] t; assign t = a; end
    endcase
  endgenerate
  assign y = {24'd0, r};
endmodule
`),
    ).toEqual([225n, 15n])
  })

  test('an arm whose body is a bare item with no begin/end — Icarus: 182, 92', () => {
    expect(
      icarus(`module top(input [7:0] a, output [31:0] y);
  parameter W = 2;
  wire [7:0] r;
  generate
    case (W)
      1: assign r = a + 8'd1;
      2: assign r = a + 8'd2;
      default: assign r = a + 8'd9;
    endcase
  endgenerate
  assign y = {24'd0, r};
endmodule
`),
    ).toEqual([182n, 92n])
  })

  test('a module-level case with NO generate wrapper — Icarus: 182, 92', () => {
    expect(
      icarus(`module top(input [7:0] a, output [31:0] y);
  parameter W = 2;
  wire [7:0] r;
  case (W)
    1: begin : g1 assign r = a + 8'd1; end
    2: begin : g2 assign r = a + 8'd2; end
    default: begin : gd assign r = a + 8'd9; end
  endcase
  assign y = {24'd0, r};
endmodule
`),
    ).toEqual([182n, 92n])
  })

  test('a parenthesised ternary label folds like any constant — Icarus: 181, 91', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  generate
    case (2)
      (1 ? 2 : 3): assign r = a + 8'd1;
      default: assign r = a + 8'd2;
    endcase
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([181n, 91n])
  })
})

describe('a case arm is chosen by the comparison the language specifies', () => {
  // The arm is picked by folding `(selector) == (label)` with the evaluator that already implements the IEEE
  // 1364-2005 §5.5.1 width and signedness rules, rather than by a comparison written for generate alone.
  // Every number below is what Icarus Verilog 14.0 answers, including the two that a naive reading gets wrong.
  const pick = (selector: string, arms: string): string =>
    probe(`  wire [7:0] r;
  generate
    case (${selector})
${arms}
      default: assign r = a + 8'd9;
    endcase
  endgenerate
  assign y = {24'd0, r};`)

  test('a 4-bit selector matches a plain decimal of the same value — Icarus: 181, 91', () => {
    expect(icarus(pick("4'b1000", "      8: assign r = a + 8'd1;"))).toEqual([181n, 91n])
  })

  test('a signed selector matches a negative label past an unsigned sibling — Icarus: 181, 91', () => {
    // The discriminating case: reading the whole statement as unsigned because SOME arm is unsigned would
    // take the default instead. Icarus decides each arm against the selector on its own, and so does this.
    expect(
      icarus(pick("2'sb11", "      -1: assign r = a + 8'd1;\n      2'b00: assign r = a + 8'd2;")),
    ).toEqual([181n, 91n])
  })

  test('an unsigned selector does NOT match a negative label — Icarus: 182, 92', () => {
    expect(
      icarus(pick("3'b111", "      -1: assign r = a + 8'd1;\n      7: assign r = a + 8'd2;")),
    ).toEqual([182n, 92n])
  })

  test('a wider sibling label does not change which arm wins — Icarus: 182, 92', () => {
    expect(
      icarus(
        pick("2'b11", "      3'b111: assign r = a + 8'd1;\n      2'b11: assign r = a + 8'd2;"),
      ),
    ).toEqual([182n, 92n])
  })

  test('a signed selector against a wide unsigned label matches neither — Icarus: 189, 99', () => {
    expect(icarus(pick("2'sb11", "      8'hFF: assign r = a + 8'd1;"))).toEqual([189n, 99n])
  })
})

describe('the conditional forms nest, and keep every block its own scope', () => {
  test('an if inside a loop, each iteration a different branch and a different wire — Icarus: 240, 240', () => {
    // THE SCOPE TEST. Each iteration declares `t` and drives one bit of r from a DIFFERENT pair of inputs, so
    // one shared `t` would give every bit the last iteration's value rather than eight separate answers.
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      if (i < 4) begin : lo
        wire t;
        assign t = a[i] & a[i+4];
        assign r[i] = t;
      end else begin : hi
        wire t;
        assign t = a[i] | a[i-4];
        assign r[i] = t;
      end
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([240n, 240n])
  })

  test('CONTROL: the same eight branches written out by hand — Icarus: 240, 240', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  assign r[0] = a[0] & a[4];
  assign r[1] = a[1] & a[5];
  assign r[2] = a[2] & a[6];
  assign r[3] = a[3] & a[7];
  assign r[4] = a[4] | a[0];
  assign r[5] = a[5] | a[1];
  assign r[6] = a[6] | a[2];
  assign r[7] = a[7] | a[3];
  assign y = {24'd0, r};`),
      ),
    ).toEqual([240n, 240n])
  })

  test('a loop inside an if branch — Icarus: 153, 0', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    if (1) begin : g
      for (i = 0; i < 8; i = i + 1) begin : f
        wire t;
        assign t = a[i] ^ a[7-i];
        assign r[i] = t;
      end
    end else begin : h
      assign r = 8'd0;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([153n, 0n])
  })

  test('a case on the genvar inside a loop — Icarus: 2, 200', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      case (i % 3)
        0: begin : m0 assign r[i] = a[i]; end
        1: begin : m1 assign r[i] = ~a[i]; end
        default: begin : md assign r[i] = a[i] ^ a[7-i]; end
      endcase
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([2n, 200n])
  })

  test('CONTROL: the same three arms written out by hand — Icarus: 2, 200', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  assign r[0] = a[0];
  assign r[1] = ~a[1];
  assign r[2] = a[2] ^ a[5];
  assign r[3] = a[3];
  assign r[4] = ~a[4];
  assign r[5] = a[5] ^ a[2];
  assign r[6] = a[6];
  assign r[7] = ~a[7];
  assign y = {24'd0, r};`),
      ),
    ).toEqual([2n, 200n])
  })

  test('an else-if chain on the genvar, five different branches — Icarus: 154, 8', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      if (i == 0) begin : b0 assign r[i] = a[0]; end
      else if (i == 1) begin : b1 assign r[i] = ~a[1]; end
      else if (i == 2) begin : b2 assign r[i] = a[2] & a[3]; end
      else if (i == 3) begin : b3 assign r[i] = a[3] | a[4]; end
      else begin : bd assign r[i] = a[i] ^ a[7-i]; end
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([154n, 8n])
  })

  test('three levels — for inside if inside for, each scoping its own wire — Icarus: 240, 240', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i, j;
  generate
    for (i = 0; i < 2; i = i + 1) begin : g
      if (i == 0) begin : lo
        for (j = 0; j < 4; j = j + 1) begin : f
          wire t;
          assign t = a[j] & a[j+4];
          assign r[j] = t;
        end
      end else begin : hi
        for (j = 0; j < 4; j = j + 1) begin : f
          wire t;
          assign t = a[j] | a[j+4];
          assign r[j+4] = t;
        end
      end
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([240n, 240n])
  })

  test('an if inside a case arm inside a loop — Icarus: 158, 0', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      case (i / 4)
        0: begin : c0
          if (i[0] == 0) begin : ev assign r[i] = a[i]; end
          else begin : od assign r[i] = ~a[i]; end
        end
        default: begin : cd
          assign r[i] = a[i] ^ a[7-i];
        end
      endcase
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([158n, 0n])
  })

  test('CONTROL: the same case-and-if written out by hand — Icarus: 158, 0', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  assign r[0] = a[0];
  assign r[1] = ~a[1];
  assign r[2] = a[2];
  assign r[3] = ~a[3];
  assign r[4] = a[4] ^ a[3];
  assign r[5] = a[5] ^ a[2];
  assign r[6] = a[6] ^ a[1];
  assign r[7] = a[7] ^ a[0];
  assign y = {24'd0, r};`),
      ),
    ).toEqual([158n, 0n])
  })

  test('a branch reads a wire declared in the ENCLOSING block, not a scoped copy — Icarus: 30, 135', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      wire s;
      assign s = a[i] ^ a[(i+1) % 8];
      if (i < 4) begin : lo
        assign r[i] = s;
      end else begin : hi
        assign r[i] = ~s;
      end
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([30n, 135n])
  })

  test('an IMPLICIT undeclared net inside a branch is scoped to it — Icarus: 36, 90', () => {
    // Measured: Icarus Verilog 14.0 makes an undeclared net inside a generate block per-block, which is only
    // visible because each iteration reads a different pair of bits.
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      if (1) begin : b
        assign t = a[i] & a[7-i];
        assign r[i] = t;
      end
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([36n, 90n])
  })

  test('a branch wire SHADOWS a module-level wire of the same name — Icarus: 46518, 23388', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  wire [7:0] t;
  assign t = a + 8'd1;
  generate
    if (1) begin : g
      wire [7:0] t;
      assign t = a + 8'd2;
      assign r = t;
    end
  endgenerate
  assign y = {16'd0, t, r};`),
      ),
    ).toEqual([46518n, 23388n])
  })

  test('a net named \\g.t is not fused with the elaborated scope name — Icarus: 30600, 39270', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  wire [7:0] \\g.t ;
  assign \\g.t = a ^ 8'hc3;
  generate
    if (1) begin : g
      wire [7:0] t;
      assign t = a ^ 8'h3c;
      assign r = t;
    end
  endgenerate
  assign y = {16'd0, \\g.t , r};`),
      ),
    ).toEqual([30600n, 39270n])
  })

  test('an escaped identifier declared inside a branch — Icarus: 170, 68', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  generate
    if (1) begin : g
      wire [7:0] \\odd-name$ ;
      assign \\odd-name$ = a ^ 8'h1e;
      assign r = \\odd-name$ ;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([170n, 68n])
  })
})

describe('what a branch may hold, it builds like any module item', () => {
  test('a module instance inside a branch — Icarus: 238, 0', () => {
    expect(
      icarus(`module zsub(input [7:0] p, output [7:0] z);
  assign z = p ^ 8'h5a;
endmodule
module top(input [7:0] a, output [31:0] y);
  wire [7:0] r;
  generate
    if (1) begin : g
      zsub u (.p(a), .z(r));
    end else begin : h
      assign r = 8'd0;
    end
  endgenerate
  assign y = {24'd0, r};
endmodule
`),
    ).toEqual([238n, 0n])
  })

  test('a per-iteration instance chosen by an if on the genvar — Icarus: 172, 90', () => {
    // All eight instances are written `u`; scoped they are eight instances, shared they would be a duplicate
    // name. Half are AND and half are OR, so a branch chosen once for all of them would show immediately.
    expect(
      icarus(`module zand(input p, input q, output z);
  assign z = p & q;
endmodule
module zor(input p, input q, output z);
  assign z = p | q;
endmodule
module top(input [7:0] a, output [31:0] y);
  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      if (i[0] == 0) begin : ev
        zand u (.p(a[i]), .q(a[7-i]), .z(r[i]));
      end else begin : od
        zor u (.p(a[i]), .q(a[7-i]), .z(r[i]));
      end
    end
  endgenerate
  assign y = {24'd0, r};
endmodule
`),
    ).toEqual([172n, 90n])
  })

  test('CONTROL: the same eight instances written out by hand — Icarus: 172, 90', () => {
    expect(
      icarus(`module zand(input p, input q, output z);
  assign z = p & q;
endmodule
module zor(input p, input q, output z);
  assign z = p | q;
endmodule
module top(input [7:0] a, output [31:0] y);
  wire [7:0] r;
  zand u0 (.p(a[0]), .q(a[7]), .z(r[0]));
  zor  u1 (.p(a[1]), .q(a[6]), .z(r[1]));
  zand u2 (.p(a[2]), .q(a[5]), .z(r[2]));
  zor  u3 (.p(a[3]), .q(a[4]), .z(r[3]));
  zand u4 (.p(a[4]), .q(a[3]), .z(r[4]));
  zor  u5 (.p(a[5]), .q(a[2]), .z(r[5]));
  zand u6 (.p(a[6]), .q(a[1]), .z(r[6]));
  zor  u7 (.p(a[7]), .q(a[0]), .z(r[7]));
  assign y = {24'd0, r};
endmodule
`),
    ).toEqual([172n, 90n])
  })

  test('an always block inside a branch — Icarus: 53, 219', () => {
    expect(
      icarus(
        probe(`  reg [7:0] r;
  generate
    if (1) begin : g
      always @* r = a ^ 8'h81;
    end else begin : h
      always @* r = 8'd0;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([53n, 219n])
  })

  test('a named gate primitive inside a branch — Icarus: 15, 15', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      if (i < 4) begin : lo
        xor gx (r[i], a[i], a[i+4]);
      end else begin : hi
        xnor gx (r[i], a[i], a[i-4]);
      end
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([15n, 15n])
  })

  test('a per-iteration bus declared inside a branch — Icarus: 165, 165', () => {
    expect(
      icarus(
        probe(`  wire [7:0] r;
  genvar i;
  generate
    for (i = 0; i < 4; i = i + 1) begin : g
      if (i[0] == 0) begin : ev
        wire [1:0] s;
        assign s[0] = a[i];
        assign s[1] = a[i+4];
        assign r[i] = ^s;
        assign r[i+4] = &s;
      end else begin : od
        wire [1:0] s;
        assign s[0] = a[i];
        assign s[1] = a[i+4];
        assign r[i] = ~^s;
        assign r[i+4] = |s;
      end
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toEqual([165n, 165n])
  })

  test('a parameter override flips which arm a sub-module takes — Icarus: 56501, 33371', () => {
    expect(
      icarus(`module zsub(input [7:0] p, output [7:0] z);
  parameter MODE = 1;
  generate
    if (MODE == 1) begin : g assign z = p + 8'd1; end
    else begin : h assign z = p + 8'd40; end
  endgenerate
endmodule
module top(input [7:0] a, output [31:0] y);
  wire [7:0] r1, r2;
  zsub #(.MODE(1)) u1 (.p(a), .z(r1));
  zsub #(.MODE(2)) u2 (.p(a), .z(r2));
  assign y = {16'd0, r2, r1};
endmodule
`),
    ).toEqual([56501n, 33371n])
  })

  test('two overrides give one sub-module two different unrollings — Icarus: 29768, 39590', () => {
    expect(
      icarus(`module zsub(input [7:0] p, output [7:0] z);
  parameter N = 4;
  genvar i;
  generate
    for (i = 0; i < 8; i = i + 1) begin : g
      if (i < N) begin : lo
        wire t;
        assign t = p[i];
        assign z[i] = t;
      end else begin : hi
        wire t;
        assign t = ~p[i];
        assign z[i] = t;
      end
    end
  endgenerate
endmodule
module top(input [7:0] a, output [31:0] y);
  wire [7:0] r1, r2;
  zsub #(.N(2)) u1 (.p(a), .z(r1));
  zsub #(.N(6)) u2 (.p(a), .z(r2));
  assign y = {16'd0, r2, r1};
endmodule
`),
    ).toEqual([29768n, 39590n])
  })
})

describe('what a conditional generate cannot decide, it says rather than guesses', () => {
  test('a condition that is not a constant is refused — Icarus rejects it too', () => {
    // Measured: Icarus Verilog 14.0 answers "A reference to a net or variable (`a['sd0]') is not allowed in a
    // constant expression", so this is illegal source rather than merely unsupported.
    expect(
      refused(
        probe(`  wire [7:0] r;
  generate
    if (a[0]) begin : g assign r = a; end
    else begin : h assign r = ~a; end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('not an elaboration-time constant')
  })

  test('a case selector that is not a constant is refused — Icarus rejects it too', () => {
    expect(
      refused(
        probe(`  wire [7:0] r;
  generate
    case (a[1:0])
      0: assign r = a;
      default: assign r = ~a;
    endcase
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('not an elaboration-time constant')
  })

  test('a condition this evaluator cannot fold is refused, not assumed', () => {
    // `$clog2` is a real constant function that Icarus folds (it takes the first branch here). This evaluator
    // does not parse it, and a condition it cannot prove picks no branch at all: choosing wrong would publish
    // a complete, fully-driven design that computes something else and says nothing.
    expect(
      refused(
        probe(`  wire [7:0] r;
  generate
    if ($clog2(8) == 3) assign r = a + 8'd1;
    else assign r = a + 8'd2;
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('not an elaboration-time constant')
  })

  test('an unfoldable label AFTER the matching one still refuses the case', () => {
    // The standard sizes a case comparison against ALL of its item expressions, so an arm whose width cannot
    // be worked out is an arm that cannot be shown not to change the answer — even one that comes later.
    expect(
      refused(
        probe(`  wire [7:0] r;
  generate
    case (3)
      3: assign r = a + 8'd1;
      $clog2(8): assign r = a + 8'd2;
      default: assign r = a + 8'd3;
    endcase
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('not an elaboration-time constant')
  })

  test('two default arms are refused — Icarus takes the last, which is nothing to agree with', () => {
    // Measured: Icarus Verilog 14.0 compiles this and generates the SECOND default. That is a choice this
    // importer has no standard to check against, so it is named rather than copied.
    expect(
      refused(
        probe(`  wire [7:0] r;
  generate
    case (2)
      1: assign r = a + 8'd1;
      default: assign r = a + 8'd2;
      default: assign r = a + 8'd3;
    endcase
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('two "default" arms')
  })

  test('a generate casex is refused — Icarus rejects it too', () => {
    // IEEE 1364-2005 §12.1.3.2 admits `case` alone as a generate construct, and Icarus Verilog 14.0 answers
    // a generate `casex` with a syntax error.
    expect(
      refused(
        probe(`  wire [7:0] r;
  generate
    casex (2)
      2: assign r = a + 8'd2;
      default: assign r = a;
    endcase
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('is not a generate case')
  })

  test('a nested generate/endgenerate region is refused — Icarus rejects it too', () => {
    expect(
      refused(
        probe(`  wire [7:0] r;
  generate
    if (1) begin : g
      generate
        if (1) begin : h assign r = a; end
      endgenerate
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('"generate" inside a generate block has no scope')
  })

  test('a localparam inside the taken branch is refused, as it is inside a loop', () => {
    expect(
      refused(
        probe(`  wire [7:0] r;
  generate
    if (1) begin : g
      localparam K = 8'h3c;
      assign r = a ^ K;
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('"localparam" inside a generate block has no scope')
  })

  test('a function defined inside a branch is refused', () => {
    expect(
      refused(
        probe(`  wire [7:0] r;
  generate
    if (1) begin : g
      function [7:0] f; input [7:0] p; f = p ^ 8'h11; endfunction
      assign r = f(a);
    end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('"function" inside a generate block has no scope')
  })

  test('a hierarchical read into an if scope is named, not resolved', () => {
    expect(
      refused(
        probe(`  wire [7:0] r;
  generate
    if (1) begin : g
      wire [7:0] t;
      assign t = a ^ 8'h0f;
      assign r = t;
    end
  endgenerate
  assign y = {16'd0, g.t, r};`),
      ),
    ).toContain('is named outside its own generate block')
  })

  test('two SIBLING blocks sharing a label are refused — Icarus rejects it too', () => {
    // The arms of ONE if may share a label because only one is elaborated. Two separate ifs at the same level
    // may not: both would be built, and their nets would be one set of names.
    expect(
      refused(
        probe(`  wire [7:0] r;
  generate
    if (1) begin : g assign r[3:0] = a[3:0]; end
    if (1) begin : g assign r[7:4] = a[7:4]; end
  endgenerate
  assign y = {24'd0, r};`),
      ),
    ).toContain('are both labelled "g"')
  })
})
