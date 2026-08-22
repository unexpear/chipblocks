/**
 * A COPY INTO A ONE-BIT VARIABLE, AN ARRAY INSIDE A FUNCTION, AND AN EXPRESSION TOO BIG TO BUILD.
 *
 * Three ways a procedural block could get a wrong answer, or no answer at all.
 *
 * ONE-BIT WALL. A store into a declared variable takes that variable's own width (IEEE 1364-2005 §6.2), so
 * `reg q; q = a;` keeps bit 0 of `a` and throws the rest away. The width map records only widths ABOVE one,
 * so a scalar `reg` had no wall at all and a copy into one carried the whole value onward.
 *
 * ARRAY LOCAL. `reg [7:0] t [0:1];` inside a function declares two eight-bit words. The trailing dimension
 * was skipped in silence, registering `t` as one plain 8-bit reg, and `t[0]`/`t[1]` then read as BIT-selects
 * of it — a built, silently wrong answer. It is refused by name now.
 *
 * SIZE. Forward substitution puts a blocking value into every later read of it, so a statement that reads its
 * own variable three times and writes it back triples the expression each time round a loop. Eight rounds of
 * an ordinary CRC/LFSR shift asks for a netlist of a quarter of a million gates, which the importer used to
 * answer with `RangeError: Maximum call stack size exceeded` — no result and no reason. There are three caps
 * now (tree size, nesting depth, gates per target) and each one REFUSES by name.
 *
 * EVERY expected number here is Icarus Verilog 14.0 (oss-cad-suite) on the same source, read through a full
 * 32-bit probe. Nothing is read off current behaviour: this suite has been green over wrong answers before.
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

const said = (warnings: string[]): string => warnings.join(' | ')

/** Read `y` with the 8-bit input `a` held at `value`. Every `a` bit is DRIVEN and every `y` bit is read at
 *  the full 32 bits, so a missing pin shows up as a wrong number instead of hiding behind a narrow probe. */
function yAt(block: BlockData, value: number): number {
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
  const have = new Set(block.ports.map((p) => p.id))
  for (let bit = 0; bit < 8; bit++) {
    const pin = `a[${bit}]`
    if (!have.has(pin)) continue
    const vid = `v${bit}`
    nodes.push(src(vid, ((value >> bit) & 1) === 1 ? 5 : 0))
    edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', pin))
    edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
  }
  const result = simulateLogic(nodes, edges, new Map())
  let out = 0
  for (let bit = 0; bit < 32; bit++) if (result.value('M', `y[${bit}]`) === true) out += 2 ** bit
  return out
}

/** Build `verilog`, check all `outBits` output pins are published, and read `y` at each vector. */
function sweep(verilog: string, vectors: number[], outBits: number): number[] {
  const { block, warnings } = importVerilog(verilog)
  expect(block, said(warnings)).not.toBeNull()
  const built = block as BlockData
  const pins = new Set(built.ports.map((p) => p.id))
  for (let bit = 0; bit < outBits; bit++)
    expect(pins.has(`y[${bit}]`), `y[${bit}] is published`).toBe(true)
  return vectors.map((v) => yAt(built, v))
}

/** Import `verilog` expecting NO published design, and return what it said. A THROW fails here rather than
 *  passing as a refusal: an importer may refuse, and may never crash. */
function refusal(verilog: string): string {
  const { block, warnings } = importVerilog(verilog)
  expect(block, `expected a refusal, got a design — ${said(warnings)}`).toBeNull()
  return said(warnings)
}

describe('a copy into a one-bit variable keeps only bit 0', () => {
  // Icarus Verilog 14.0 on `q = a; r = scale(q);` with `scale(v) = v * 8'd17`, y = {16'd0, a, r}:
  // 0 273 512 785 1297 1536 2560 36625 — it scales a[0] alone. Ours read 546 819 1365 1638 2730 36735 at the
  // same vectors, which is all eight bits of `a` scaled: the copy carried more bits than its target declares.
  const VECTORS = [0x00, 0x01, 0x02, 0x03, 0x05, 0x06, 0x0a, 0x8f]
  const ICARUS = [0, 273, 512, 785, 1297, 1536, 2560, 36625]

  const scaled = (decl: string): string => `module top(input [7:0] a, output [31:0] y);
  ${decl}
  reg [7:0] r;
  function [7:0] scale;
    input [7:0] v;
    scale = v * 8'd17;
  endfunction
  always @* begin
    q = a;
    r = scale(q);
  end
  assign y = {16'd0, a, r};
endmodule
`

  test('a scalar `reg q` walls the copy at one bit', () => {
    expect(sweep(scaled('reg q;'), VECTORS, 32)).toEqual(ICARUS)
  })

  test('`reg [0:0] q` is the same one bit, written the long way', () => {
    expect(sweep(scaled('reg [0:0] q;'), VECTORS, 32)).toEqual(ICARUS)
  })

  test('a two-bit target keeps two bits — the wall is the declared width, not a special case', () => {
    // Icarus on the same module with `reg [1:0] q;`: a[1:0] scaled, so 0x03 gives 3 * 17 = 51 in the low byte.
    expect(sweep(scaled('reg [1:0] q;'), VECTORS, 32)).toEqual([
      0, 273, 546, 819, 1297, 1570, 2594, 36659,
    ])
  })
})

describe('an array declared inside a function', () => {
  const arrayLocal = `module top(input [7:0] a, output [31:0] y);
  function [31:0] f;
    input [7:0] v;
    reg [7:0] t [0:1];
    begin
      t[0] = v;
      t[1] = ~v;
      f = {16'b0, t[0], t[1]};
    end
  endfunction
  assign y = f(a);
endmodule
`

  test('is refused by name, not read as bit-selects of one reg', () => {
    // Icarus reads 0x0000b44b 0x00005aa5 0x000001fe 0x0000807f. Ours built 1 1 2 1 — `t[0]`/`t[1]` had become
    // bit 0 and bit 1 of a single 8-bit reg. Refusing is the honest answer until arrays inside a function work.
    const why = refusal(arrayLocal)
    expect(why).toContain('an array declaration ("t") inside a function/task is not built')
  })
})

describe('an expression too big to build is refused, never thrown', () => {
  /** N rounds of an ordinary CRC-8/LFSR shift — the value is read three times and written back each round. */
  const shift = (rounds: number): string => `module top(input [7:0] a, output reg [7:0] y);
  reg [7:0] t;
  integer i;
  always @* begin
    t = a ^ 8'h0f;
    for (i = 0; i < ${rounds}; i = i + 1)
      t = t[7] ? ((t << 1) ^ 8'h07) : (t << 1);
    y = t;
  end
endmodule
`

  /** A chain that grows in DEPTH without growing in width — one nesting level deeper per round. */
  const chain = (rounds: number): string => `module top(input [7:0] a, output reg [7:0] y);
  reg [7:0] t;
  integer i;
  always @* begin
    t = a ^ 8'h0f;
    for (i = 0; i < ${rounds}; i = i + 1)
      t = (t + 8'd3) ^ 8'd5;
    y = t;
  end
endmodule
`

  const VECTORS = [0x00, 0x01, 0xb4, 0x5a, 0xff]

  test('the rounds that fit are built, and agree with Icarus', () => {
    // Icarus Verilog 14.0 on rounds 1, 4 and 6 of the shift above.
    expect(sweep(shift(1), VECTORS, 8)).toEqual([30, 28, 113, 170, 231])
    expect(sweep(shift(4), VECTORS, 8)).toEqual([240, 224, 129, 75, 45])
    expect(sweep(shift(6), VECTORS, 8)).toEqual([201, 137, 10, 43, 180])
  })

  test('a round past the gate budget names the size it would have been', () => {
    // Icarus reads 45 42 40 172 222 for eight rounds — a real answer, for a netlist of 255,864 parts. Built,
    // it broke the app: the NEXT design threw `RangeError: Invalid string length` serializing the project.
    const why = refusal(shift(8))
    expect(why).toContain('127924 gates')
    expect(why).toContain('past the 25000 this importer will build for one target')
  })

  test('a round past the tree-size cap is refused before any walk is attempted', () => {
    expect(refusal(shift(10))).toContain('more than 250000 expression nodes')
  })

  test('a chain past the depth cap is refused rather than overflowing the stack', () => {
    // Every walk over an expression is recursion, so nesting depth is stack depth: this used to throw
    // `RangeError: Maximum call stack size exceeded` while binding the calls in it.
    expect(sweep(chain(100), VECTORS, 8)).toEqual([47, 214, 187, 117, 184])
    expect(refusal(chain(2000))).toContain('nested more than 1000 levels deep')
  })
})
