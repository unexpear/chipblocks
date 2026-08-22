/**
 * A SELECT BASE OR MEMORY ADDRESS WIDER THAN 32 BITS.
 *
 * A memory read and a run-time indexed part-select are both built as a one-hot decode: one line per word (or
 * per reachable base value), each line asserting "the address bit-for-bit equals MY index". The index is a
 * small plain number; the address is as wide as the user declared it. Those two met in `(index >> j) & 1`,
 * and JavaScript's `>>` takes its shift count MOD 32 — so at j = 32 the test read bit 0 of the index again,
 * every line with an odd index demanded that address bit 32 be 1, that bit was constantly 0, the line never
 * matched, and the read answered 0 for a word Verilog reads perfectly well.
 *
 * The wide declared types are what made this reachable: `time` is 64 bits and only just became so.
 *
 * MEASURED before the fix, against Icarus Verilog 14.0 (oss-cad-suite), on the `reg [32:0]` memory address
 * below: 17 0 51 0 where Icarus reads 17 34 51 68 — the EVEN-indexed words right and the odd ones zero, which
 * is exactly the aliased bit choosing them. At 36 and 64 bits more lines fall away and only word 0 survives.
 *
 * EVERY expected number here is Icarus Verilog 14.0 on the same source, read through a full 32-bit probe.
 * Nothing is read off current behaviour: this suite has been green over wrong answers three times.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import { createDebugSession } from '../src/renderer/verilog-debug.ts'
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

/** The eight input vectors every expectation below was measured at. */
const VECTORS = [0x00, 0x01, 0x02, 0x03, 0x04, 0x0a, 0x0f, 0x80]

/** Build `verilog`, check all 32 output pins are published, and read `y` at each vector. */
function sweep(verilog: string): number[] {
  const { block, warnings } = importVerilog(verilog)
  expect(block, said(warnings)).not.toBeNull()
  const built = block as BlockData
  const pins = new Set(built.ports.map((p) => p.id))
  for (let bit = 0; bit < 32; bit++)
    expect(pins.has(`y[${bit}]`), `y[${bit}] is published`).toBe(true)
  return VECTORS.map((v) => yAt(built, v))
}

/** Import `verilog` expecting NO published design, and return what it said. */
function refusal(verilog: string): string {
  const { block, warnings } = importVerilog(verilog)
  expect(block, `expected a refusal, got a design — ${said(warnings)}`).toBeNull()
  return said(warnings)
}

/** A 4-word ROM holding 11h/22h/33h/44h, addressed through a register of the declared type `decl`. */
const memory = (decl: string): string => `module top(input [7:0] a, output [31:0] y);
  reg [7:0] m [0:3];
  ${decl}
  reg [7:0] r;
  initial begin m[0] = 8'h11; m[1] = 8'h22; m[2] = 8'h33; m[3] = 8'h44; end
  always @* begin
    ad = a[1:0];
    r = m[ad];
  end
  assign y = {24'b0, r};
endmodule`

/** A 32-bit bus byte-muxed through a base of the declared type `decl`, masked to 0/8/16/24. */
const byteMux = (decl: string, mask: string): string => `module top(input [7:0] a, output [31:0] y);
  wire [31:0] bus;
  ${decl}
  assign bus = 32'hddccbbaa;
  always @* k = a * 8;
  assign y = {24'b0, bus[(k & ${mask}) +: 8]};
endmodule`

/** Icarus reads the ROM word the low two bits of `a` address, at every vector. */
const WORDS = [17, 34, 51, 68, 17, 51, 68, 17]
/** Icarus reads the byte of 32'hddccbbaa that `a * 8` masked to 0/8/16/24 selects, at every vector. */
const BYTES = [170, 187, 204, 221, 170, 204, 221, 170]

describe('a memory address wider than 32 bits reads the word it names', () => {
  test('an address declared 32 bits — the boundary — is unaffected (Icarus: 17 34 51 68 17 51 68 17)', () => {
    expect(sweep(memory('reg [31:0] ad;'))).toEqual(WORDS)
  })

  test('an address declared 33 bits, one past the boundary (measured 17 0 51 0 17 51 0 17 before)', () => {
    expect(sweep(memory('reg [32:0] ad;'))).toEqual(WORDS)
  })

  test('an address declared 36 bits (measured 17 0 0 0 17 0 0 17 before)', () => {
    expect(sweep(memory('reg [35:0] ad;'))).toEqual(WORDS)
  })

  test('an address declared 64 bits', () => {
    expect(sweep(memory('reg [63:0] ad;'))).toEqual(WORDS)
  })

  test('an address declared `time`, which is 64 bits', () => {
    expect(sweep(memory('time ad;'))).toEqual(WORDS)
  })

  test('an address declared `integer`, which is 32 bits — the boundary from the other side', () => {
    expect(sweep(memory('integer ad;'))).toEqual(WORDS)
  })
})

describe('an indexed part-select base wider than 32 bits reads the slice it names', () => {
  test('a base declared 32 bits — the boundary — is unaffected (Icarus: 170 187 204 221 …)', () => {
    expect(sweep(byteMux('reg [31:0] k;', "32'd24"))).toEqual(BYTES)
  })

  test('a base declared 36 bits (measured 170 0 204 0 170 204 0 170 before)', () => {
    expect(sweep(byteMux('reg [35:0] k;', "36'd24"))).toEqual(BYTES)
  })

  test('a base declared 64 bits (measured 170 0 0 0 170 0 0 170 before)', () => {
    expect(sweep(byteMux('reg [63:0] k;', "64'd24"))).toEqual(BYTES)
  })

  test('a base declared `time`, which is 64 bits', () => {
    expect(sweep(byteMux('time k;', "64'd24"))).toEqual(BYTES)
  })

  test('a base that is a 36-bit CONCATENATION (measured 170 0 204 0 170 204 0 170 before)', () => {
    expect(
      sweep(`module top(input [7:0] a, output [31:0] y);
  wire [31:0] bus;
  assign bus = 32'hddccbbaa;
  assign y = {24'b0, bus[{34'b0, a[1:0]}*8 +: 8]};
endmodule`),
    ).toEqual(BYTES)
  })

  test('a base that is a 32-bit concatenation — the boundary — is unaffected', () => {
    expect(
      sweep(`module top(input [7:0] a, output [31:0] y);
  wire [31:0] bus;
  assign bus = 32'hddccbbaa;
  assign y = {24'b0, bus[{30'b0, a[1:0]}*8 +: 8]};
endmodule`),
    ).toEqual(BYTES)
  })

  test('a base that is a FUNCTION LOCAL declared `time`', () => {
    expect(
      sweep(`module top(input [7:0] a, output [31:0] y);
  function [7:0] pick;
    input [31:0] v;
    input [7:0] s;
    time k;
    begin
      k = s * 8;
      pick = v[(k & 64'd24) +: 8];
    end
  endfunction
  assign y = {24'b0, pick(32'hddccbbaa, a)};
endmodule`),
    ).toEqual(BYTES)
  })

  test('a base that is a TASK ARGUMENT declared 64 bits', () => {
    expect(
      sweep(`module top(input [7:0] a, output [31:0] y);
  reg [7:0] r;
  task pick;
    input [31:0] v;
    input [63:0] s;
    output [7:0] o;
    begin
      o = v[(s & 64'd24) +: 8];
    end
  endtask
  always @* pick(32'hddccbbaa, a * 8, r);
  assign y = {24'b0, r};
endmodule`),
    ).toEqual(BYTES)
  })

  test('a wide base nothing bounds is still REFUSED BY NAME, not answered with zeros', () => {
    const why = refusal(`module top(input [7:0] a, output [31:0] y);
  wire [31:0] bus;
  reg [35:0] k;
  assign bus = 32'hddccbbaa;
  always @* k = a;
  assign y = {24'b0, bus[k +: 8]};
endmodule`)
    expect(why).toContain('bus[base +: 8]')
    expect(why).toContain('NOT built')
  })
})

describe('a case label too wide for a number cannot claim coverage it does not have', () => {
  // A 2-bit selector covered by four ordinary labels — the optimisation this guards must still fire.
  const CASE = (first: string) => `module top(input [7:0] a, output [31:0] y);
  reg [7:0] r;
  wire [1:0] s = a[1:0];
  always @* begin
    case (s)
      ${first}: r = 8'h11;
      2'd1: r = 8'h22;
      2'd2: r = 8'h33;
      2'd3: r = 8'h44;
    endcase
  end
  assign y = {24'b0, r};
endmodule`

  test('four ordinary labels still cover the selector (Icarus: 17 34 51 68 17 51 68 17)', () => {
    expect(sweep(CASE("2'd0"))).toEqual(WORDS)
  })

  test('a 64-bit label whose residue is 1, not 0, leaves selector 0 uncovered and is refused', () => {
    // Read through a number, 64'hFFFFFFFFFFFFFFFD rounds to a multiple of 4096 and lands on residue 0 —
    // filling the coverage set and dropping the last item's guard. Icarus reads x at selector 0, and the
    // same case written with label 0 plainly missing is refused, so a refusal is the only honest answer.
    expect(refusal(CASE("64'hFFFFFFFFFFFFFFFD"))).toContain('NOT built')
  })
})

describe('the inspectors read a signal wider than 31 bits at its real value', () => {
  const WIDE = `module top(input [39:0] a, output [39:0] y);
  assign y = a;
endmodule`

  test('a 40-bit signal round-trips 2^33 + 7 and 2^31 (measured 7 and -2147483648 before)', () => {
    const { block, warnings } = importVerilog(WIDE)
    expect(block, said(warnings)).not.toBeNull()
    const session = createDebugSession(block as BlockData)
    expect(session, 'the 40-bit module has drivable inputs').not.toBeNull()
    const live = session as NonNullable<typeof session>
    for (const value of [5, 2 ** 31, 2 ** 33 + 7, 2 ** 39 - 1]) {
      live.setInputValue('a', value)
      live.step()
      expect(live.readValue('y'), `a = ${value}`).toBe(value)
    }
  })
})
