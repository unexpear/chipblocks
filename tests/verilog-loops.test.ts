/**
 * PROCEDURAL LOOPS — `for` and `repeat` inside always blocks, function bodies and task bodies, unrolled at
 * elaboration time. Hardware has no run-time loop: `for (i = 0; i < 4; i = i + 1) y[i] = a[i];` IS four
 * statements, written once, and the four the unroller emits are the four a hand-written design would have.
 *
 * The importer refused every loop before this. It now substitutes the counter as a sized literal and
 * RE-PARSES the body per iteration, so nothing about the result is decided here: a constant bit-select goes
 * through the ordinary select path, an index the unroll pushes off the end of a bus meets the same
 * out-of-range refusal a hand-written `a[5]` meets, and a nonblocking `<=` still lowers to the node that
 * binds to the pre-block value.
 *
 * EVERY expected value below is the output of Icarus Verilog 14.0 (oss-cad-suite) on the same source — swept
 * over all sixteen (or 256) input values for a combinational design, or read after each rising edge for a
 * clocked one — not what this implementation happens to return.
 *
 * Sub-forms deliberately left REFUSING, each by name, because building them would mean guessing:
 *   - `while` and `forever` (no elaboration-time iteration count)
 *   - a named block `begin : label` and the `disable` that breaks out of one — together, because they decide
 *     what a loop COMPUTES and building one without the other silently changes the function
 *   - a counter that wraps at its declared width and therefore never terminates (Icarus loops forever on
 *     exactly that source — measured below)
 *   - an undeclared loop variable (Icarus rejects that source outright)
 *   - a read of the loop variable AFTER the loop (no residual value is invented; the read refuses)
 *   - an assignment to the loop variable inside its own body
 *   - a non-constant `repeat` count or loop bound
 *   - more unrolled iterations than the per-body cap: refused, never truncated
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { characterizeBlock, simulateLogic } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const said = (warnings: string[]): string => warnings.join(' | ')
const bitOf = (name: string): number => Number(name.match(/\[(\d+)\]$/)?.[1] ?? 0)

/** Drive every value of the input bus `a` through the block's REAL gates and read `y` as an unsigned number.
 *  Input bits no gate reads are dropped from the interface, so each row is matched on the bits that ARE
 *  present; every output bit must be built, or the sweep is not comparable. */
function sweep(verilog: string, inWidth: number, outWidth: number): number[] {
  const { block, warnings } = importVerilog(verilog)
  expect(block, said(warnings)).not.toBeNull()
  const table = characterizeBlock(block as BlockData)
  expect(table, said(warnings)).not.toBeNull()
  if (table === null) return []
  expect(table.outputs.length, `every y bit must be built — ${said(warnings)}`).toBe(outWidth)
  const inBit = table.inputs.map(bitOf)
  const outBit = table.outputs.map(bitOf)
  return Array.from({ length: 2 ** inWidth }, (_, a) => {
    const row = table.rows.find((r) =>
      r.in.every((b, i) => b === (((a >> (inBit[i] as number)) & 1) === 1)),
    )
    expect(row, `no row for a=${a}`).toBeDefined()
    let value = 0
    row?.out.forEach((b, i) => {
      if (b) value += 1 << (outBit[i] as number)
    })
    return value
  })
}

const supply = (volts: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
})
const source = (id: string, volts: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(volts) },
})
const wire = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
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
    source('vp', 5),
  ]
  const edges: CanvasEdgeLike[] = [
    wire('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
    wire('eg', 'M', 'gnd', 'g', 'reference_terminal'),
    wire('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
  ]
  let k = 0
  for (const [port, value] of Object.entries(inputs)) {
    const vid = `v${k++}`
    nodes.push(source(vid, value ? 5 : 0))
    edges.push(wire(`e${vid}`, vid, 'terminal_positive', 'M', port))
    edges.push(wire(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
  }
  return simulateLogic(nodes, edges, state)
}

/** One rising clock edge: solve with clk LOW then clk HIGH (master grabs D, slave drives Q). */
function tick(block: BlockData, inputs: Record<string, boolean>, state: Map<string, boolean>) {
  solve(block, { ...inputs, clk: false }, state)
  return solve(block, { ...inputs, clk: true }, state)
}

/** Reset the design, then read the `y` register after each of `cycles` further rising edges. */
function clocked(verilog: string, cycles: number, outWidth: number): number[] {
  const { block, warnings } = importVerilog(verilog)
  expect(block, said(warnings)).not.toBeNull()
  const state = new Map<string, boolean>()
  tick(block as BlockData, { rst: true }, state)
  return Array.from({ length: cycles }, () => {
    const r = tick(block as BlockData, { rst: false }, state)
    let value = 0
    for (let i = 0; i < outWidth; i++) if (r.value('M', `y[${i}]`) === true) value |= 1 << i
    return value
  })
}

/** Assert the design is refused whole (nothing published) and that the reason names `phrase`. */
function refuses(verilog: string, phrase: string): string {
  const { block, warnings } = importVerilog(verilog)
  expect(block, `expected no design; got one. ${said(warnings)}`).toBeNull()
  expect(said(warnings)).toContain(phrase)
  return said(warnings)
}

const comb = (decls: string, body: string, outWidth = 4): string =>
  `module m(input [3:0] a, output reg [${outWidth - 1}:0] y);\n${decls}\nalways @* begin\n${body}\nend endmodule`

describe('a for loop is unrolled into the statements it stands for', () => {
  test('the plainest loop copies a bus bit by bit', () => {
    // Icarus: y = a for all 16 values.
    expect(sweep(comb('integer i;', 'for (i = 0; i < 4; i = i + 1) y[i] = a[i];'), 4, 4)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ])
  })

  test('a constant index computed FROM the counter reverses the bus', () => {
    // The counter appears inside an expression (3-i), so each iteration must produce a different constant
    // select. Getting the substitution wrong here reads one bit four times and the sweep goes flat.
    expect(sweep(comb('integer i;', 'for (i = 0; i < 4; i = i + 1) y[i] = a[3-i];'), 4, 4)).toEqual(
      [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15],
    )
  })

  test('an `integer` counts DOWN, because IEEE 1364-2005 makes it signed', () => {
    // Measured with Icarus: `integer j; for (j = 3; j >= 0; j = j - 1)` terminates after 4 iterations with
    // j = -1 at exit. Counting the same loop unsigned would take j = -1 to 4294967295, `>= 0` would stay
    // true, and the loop would never end — so this is the test that pins the signedness of `integer`.
    expect(sweep(comb('integer i;', 'for (i = 3; i >= 0; i = i - 1) y[i] = ~a[i];'), 4, 4)).toEqual(
      [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    )
  })

  test('a `reg` counter is UNSIGNED and may legitimately run into its top half', () => {
    // reg [3:0] k over 0..11 — k[3] is set for 8..11, which is a perfectly ordinary unsigned count. Modelling
    // a declared reg as signed would make k = 8 read as −8 and the loop never terminate.
    expect(
      sweep(
        comb(
          'reg [3:0] k;',
          'y = 0;\nfor (k = 0; k < 12; k = k + 1) if (k[3]) y[k[1:0]] = a[k[1:0]];',
        ),
        4,
        4,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  test('a counter that starts NEGATIVE iterates over the signed range', () => {
    // Icarus: i = −2, −1, 0, 1. Reading the same start unsigned gives 4294967294, `< 2` is false, and the
    // loop would run zero times — a clean-looking build of a completely different circuit.
    expect(
      sweep(comb('integer i;', 'y = 0;\nfor (i = -2; i < 2; i = i + 1) y[i+2] = a[1-i];'), 4, 4),
    ).toEqual([0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15])
  })

  test('the step expression is arbitrary — multiply, and a `!=` bound', () => {
    // i = 1, 2, 4 (three iterations, not eight): assuming a +1 step silently changes the iteration set.
    expect(
      sweep(
        `module m(input [7:0] a, output reg [7:0] y);
integer i;
always @* begin
  y = 0;
  for (i = 1; i < 8; i = i * 2) y[i] = a[i];
end endmodule`,
        8,
        8,
      ).slice(0, 16),
    ).toEqual([0, 0, 2, 2, 4, 4, 6, 6, 0, 0, 2, 2, 4, 4, 6, 6])
    expect(sweep(comb('integer i;', 'for (i = 0; i != 4; i = i + 1) y[i] = ~a[i];'), 4, 4)).toEqual(
      [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    )
  })

  test('the counter is a VALUE too — read whole, sliced, and added', () => {
    // y = i truncates a 32-bit signed integer into a 4-bit register; y = {i[1:0], a[1:0]} takes a slice of it.
    expect(
      sweep(comb('integer i;', 'y = 0;\nfor (i = 0; i < 4; i = i + 1) if (a[i]) y = i;'), 4, 4),
    ).toEqual([0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3])
    expect(
      sweep(
        comb('integer i;', 'y = 0;\nfor (i = 0; i < 4; i = i + 1) if (a[i]) y = {i[1:0], a[1:0]};'),
        4,
        4,
      ),
    ).toEqual([0, 1, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 12, 13, 14, 15])
    expect(
      sweep(comb('integer i;', 'y = 0;\nfor (i = 0; i < 4; i = i + 1) y = y + a[i];', 3), 4, 3),
    ).toEqual([0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4])
  })

  test('loops nest, and the inner counter is independent of the outer one', () => {
    expect(
      sweep(
        comb(
          'integer i;\ninteger j;',
          'y = 0;\nfor (i = 0; i < 2; i = i + 1)\n  for (j = 0; j < 2; j = j + 1)\n    y[i*2+j] = a[(1-i)*2+j];',
        ),
        4,
        4,
      ),
    ).toEqual([0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15])
  })

  test('a loop sits inside a case, and a case inside a loop', () => {
    expect(
      sweep(
        comb(
          'integer i;',
          `y = 0;
case (a[1:0])
  2'b00: for (i = 0; i < 4; i = i + 1) y[i] = a[i];
  2'b01: for (i = 0; i < 4; i = i + 1) y[i] = a[3-i];
  default: y = a;
endcase`,
        ),
        4,
        4,
      ),
    ).toEqual([0, 8, 2, 3, 4, 10, 6, 7, 8, 9, 10, 11, 12, 11, 14, 15])
    expect(
      sweep(
        comb(
          'integer i;',
          `y = 0;
for (i = 0; i < 4; i = i + 1)
  case (i[1:0])
    2'd0: y[0] = a[3];
    2'd1: y[1] = a[2];
    2'd2: y[2] = a[1];
    default: y[3] = a[0];
  endcase`,
        ),
        4,
        4,
      ),
    ).toEqual([0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15])
  })

  test('a parameter, and a constant expression, may bound the loop', () => {
    expect(
      sweep(
        comb(
          'parameter N = 4;\ninteger i;',
          'y = 0;\nfor (i = 0; i < N; i = i + 1) y[i] = a[N-1-i];',
        ),
        4,
        4,
      ),
    ).toEqual([0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15])
    expect(
      sweep(
        comb('integer i;', 'y = 0;\nfor (i = 0; i < 2 + 2; i = i + 1) y[i] = a[i] ^ a[0];'),
        4,
        4,
      ),
    ).toEqual([0, 14, 2, 12, 4, 10, 6, 8, 8, 6, 10, 4, 12, 2, 14, 0])
  })

  test('two always blocks may share ONE module-level `integer`', () => {
    // The unroller substitutes the counter away and emits no residual driver for it, so neither block claims
    // "i" and the two do not contend — the ordinary way this is written in real RTL.
    expect(
      sweep(
        `module m(input [3:0] a, output [3:0] y);
integer i;
reg [1:0] lo;
reg [1:0] hi;
always @* begin lo = 0; for (i = 0; i < 2; i = i + 1) lo[i] = a[i]; end
always @* begin hi = 0; for (i = 0; i < 2; i = i + 1) hi[i] = a[i+2]; end
assign y = {hi, lo};
endmodule`,
        4,
        4,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  test('a loop inside a SUB-MODULE survives flattening', () => {
    expect(
      sweep(
        `module rev4(input [3:0] p, output reg [3:0] q);
integer i;
always @* for (i = 0; i < 4; i = i + 1) q[i] = p[3-i];
endmodule
module m(input [3:0] a, output [3:0] y);
rev4 u1(.p(a), .q(y));
endmodule`,
        4,
        4,
      ),
    ).toEqual([0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15])
  })
})

describe('a loop in a function body unrolls at the call site', () => {
  test('the parity idiom builds from a function-scoped `integer`', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output y);
function parity;
  input [3:0] v;
  integer i;
  begin
    parity = 0;
    for (i = 0; i < 4; i = i + 1) parity = parity ^ v[i];
  end
endfunction
assign y = parity(a);
endmodule`,
        4,
        1,
      ),
    ).toEqual([0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0])
  })

  test('a function-scoped `integer` counts DOWN too (it is signed inside a function as well)', () => {
    expect(
      sweep(
        `module m(input [3:0] a, output [3:0] y);
function [3:0] rev;
  input [3:0] v;
  integer i;
  begin
    rev = 0;
    for (i = 3; i >= 0; i = i - 1) rev[3-i] = v[i];
  end
endfunction
assign y = rev(a);
endmodule`,
        4,
        4,
      ),
    ).toEqual([0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15])
  })
})

describe('a repeat loop is the body written N times', () => {
  test('a constant count repeats the body exactly that many times', () => {
    // Icarus: y = a + 3 (mod 16).
    expect(sweep(comb('', 'y = a;\nrepeat (3) y = y + 1;'), 4, 4)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2,
    ])
  })

  test('a repeat nested inside a for multiplies out', () => {
    // 2 outer × 2 inner = y + 4.
    expect(
      sweep(
        comb('integer i;', 'y = a;\nfor (i = 0; i < 2; i = i + 1) repeat (2) y = y + 1;'),
        4,
        4,
      ),
    ).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3])
  })
})

describe('a loop in a CLOCKED block keeps nonblocking semantics', () => {
  test('four `y <= y + 1` in one block increment y by ONE, not four', () => {
    // The trap the whole lowering turns on. Icarus: y = 1, 2, 3, 4, 5, 6 over six edges after reset. An
    // unroller that chained the assignments at the expression level would build a +4 adder here — the most
    // common accumulator idiom, silently wrong.
    expect(
      clocked(
        `module m(input clk, input rst, output reg [3:0] y);
integer i;
always @(posedge clk) begin
  if (rst) y <= 0;
  else for (i = 0; i < 4; i = i + 1) y <= y + 1;
end endmodule`,
        6,
        4,
      ),
    ).toEqual([1, 2, 3, 4, 5, 6])
  })

  test('unrolled bit-writes all read the PRE-EDGE register, so the word reverses in place', () => {
    // y <= 4'b1101 on reset, then y[i] <= y[3-i] every edge: 1011, 1101, 1011, 1101 in Icarus. If any
    // iteration read the value a previous iteration had just written, the pattern would collapse.
    expect(
      clocked(
        `module m(input clk, input rst, output reg [3:0] y);
integer i;
always @(posedge clk) begin
  if (rst) y <= 4'b1101;
  else for (i = 0; i < 4; i = i + 1) y[i] <= y[3-i];
end endmodule`,
        4,
        4,
      ),
    ).toEqual([11, 13, 11, 13])
  })

  test('a loop may initialise a real memory array', () => {
    expect(
      clocked(
        `module m(input clk, input rst, output [3:0] y);
reg [3:0] mem [0:3];
reg [1:0] sel;
integer i;
always @(posedge clk) begin
  if (rst) begin
    sel <= 0;
    for (i = 0; i < 4; i = i + 1) mem[i] <= i + 1;
  end else sel <= sel + 1;
end
assign y = mem[sel];
endmodule`,
        4,
        4,
      ),
    ).toEqual([2, 3, 4, 1])
  })
})

describe('what a loop still refuses, by name', () => {
  test('a counter that WRAPS at its declared width never terminates, and is refused', () => {
    // Measured with Icarus 14.0 on exactly this loop: `reg [3:0] i; for (i = 0; i <= 15; i = i + 1)` was
    // still going after 101 iterations at simulation time 0, because i + 1 wraps 15 → 0 and `i <= 15` is
    // therefore always true. Counting in JavaScript numbers would unroll sixteen iterations and publish a
    // design for source that cannot be simulated at all.
    refuses(
      comb('reg [3:0] i;', 'y = 0;\nfor (i = 0; i <= 15; i = i + 1) y = y ^ a;'),
      'returns to a counter value it already had',
    )
    // The same trap from the other end: an UNSIGNED 4-bit counter decrementing past 0 wraps to 15. Measured
    // with Icarus on `reg [3:0] k; for (k = 3; k >= 0; k = k - 1)`: still looping after 101 iterations.
    refuses(
      comb('reg [3:0] k;', 'y = 0;\nfor (k = 3; k >= 0; k = k - 1) y = y ^ a;'),
      'returns to a counter value it already had',
    )
  })

  test('an UNDECLARED loop variable is refused (Icarus rejects that source outright)', () => {
    refuses(
      'module m(input clk, input [3:0] d, output reg [3:0] q);\n always @(posedge clk) for (i = 0; i < 4; i = i + 1) q[i] <= d[i];\nendmodule',
      'reads as a single bit',
    )
  })

  test('a read of the loop variable AFTER the loop refuses rather than inventing its exit value', () => {
    // Icarus gives i = 4 there (the value that failed the condition). The unroller emits no residual driver,
    // so the read lands on an undriven net and the design refuses — the safe half of that trade.
    refuses(
      `module m(input [3:0] a, output reg [3:0] y, output reg [3:0] z);
integer i;
always @* begin
  for (i = 0; i < 4; i = i + 1) y[i] = a[i];
  z = i;
end endmodule`,
      'no driver at all',
    )
  })

  test('a body that assigns its own loop variable is refused', () => {
    refuses(
      comb('integer i;', 'y = 0;\nfor (i = 0; i < 4; i = i + 1) begin y[i] = a[i]; i = i + 1; end'),
      'cannot be an assignment target',
    )
  })

  test('an out-of-range select the UNROLL creates is refused, exactly like a hand-written one', () => {
    refuses(
      `module m(input [3:0] a, output reg [7:0] y);
integer i;
always @* for (i = 0; i < 8; i = i + 1) y[i] = a[i];
endmodule`,
      'bit-select a[4] is out of range',
    )
    // and a select of the COUNTER past its own declared width
    refuses(
      comb('reg [2:0] k;', 'y = 0;\nfor (k = 0; k < 4; k = k + 1) y[k] = a[k[3:0]];'),
      'is outside the 3-bit loop variable',
    )
  })

  test('`while` and `forever` are refused by name', () => {
    // Icarus builds the while form (it sweeps to y = a); we have no elaboration-time iteration count for a
    // condition whose variable is only known as gates, so it stays refused rather than guessed.
    refuses(
      comb('integer i;', 'y = 0;\ni = 0;\nwhile (i < 4) begin y[i] = a[i]; i = i + 1; end'),
      '`while` loop',
    )
    refuses(comb('', 'forever y = a;'), '`forever` loop')
  })

  test('a named block and `disable` are refused TOGETHER', () => {
    // Without `disable` this priority scan returns the LAST set bit; with it, the FIRST — a different
    // circuit. Building named blocks while ignoring disable would silently pick the wrong one.
    refuses(
      comb(
        'integer i;',
        'y = 0;\nfor (i = 0; i < 4; i = i + 1) begin : scan\n  if (a[i]) begin y = i; disable scan; end\nend',
      ),
      'a named block (begin : label)',
    )
    refuses(comb('', 'y = a;\ndisable m;'), '`disable`')
  })

  test('a non-constant repeat count or loop bound is refused', () => {
    refuses(
      comb('', 'y = a;\nrepeat (a) y = y + 1;'),
      'repeat count that is not an elaboration-time constant',
    )
    refuses(
      comb('integer i;', 'y = 0;\nfor (i = 0; i < a; i = i + 1) y[i] = a[i];'),
      'is not an elaboration-time constant',
    )
  })

  test('past the per-body iteration cap the loop is REFUSED, never truncated', () => {
    // Truncating at the cap would publish a design computing a different function with nothing said.
    refuses(
      comb('integer i;', 'y = 0;\nfor (i = 0; i < 5000; i = i + 1) y = y ^ a;'),
      'more than 4096 iterations in one block',
    )
    // The cap is the TOTAL across nesting, not per loop: 100 × 100 is 10,000 unrolled bodies.
    refuses(
      comb(
        'integer i;\ninteger j;',
        'y = 0;\nfor (i = 0; i < 100; i = i + 1) for (j = 0; j < 100; j = j + 1) y = y ^ a;',
      ),
      'more than 4096 iterations in one block',
    )
  })

  test('a loop counter that is ALSO a real driven register is refused where it is read', () => {
    // One module-level `integer i` may serve every always block, because the unroller substitutes it away and
    // emits no driver for it. That only holds while nothing else drives the name. Here a clocked block also
    // counts `i`, so `i` has two writers — a race. Icarus 14.0 resolves it to 5, 6, 7 over three edges (the
    // combinational block's loop-exit write of 4 lands first, then the register increments); taking the
    // register's value alone would report 1, 2, 3 with nothing said, so the read refuses instead.
    refuses(
      `module m(input clk, input [3:0] a, output reg [3:0] y, output [31:0] c);
integer i;
always @(posedge clk) i <= i + 1;
always @* for (i = 0; i < 4; i = i + 1) y[i] = a[i];
assign c = i;
endmodule`,
      'a loop counter, which a loop unrolls away, is also driven as a real signal here',
    )
  })

  test('an indexed part-select on both sides: unrolling substitutes the counter, so each slice is constant', () => {
    // `y[i*2 +: 2] = a[i*2 +: 2]` over i = 0, 1 copies a straight through. Unrolling replaces `i` with a
    // literal, so each `+:` folds to a fixed [hi:lo] — the same thing a hand-written y[1:0]/y[3:2] pair is.
    // Icarus Verilog 14.0 sweeps 0..15 to 0..15.
    expect(
      sweep(
        `module m(input [3:0] a, output reg [3:0] y);
integer i;
always @* for (i = 0; i < 2; i = i + 1) y[i*2 +: 2] = a[i*2 +: 2];
endmodule`,
        4,
        4,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })
})
