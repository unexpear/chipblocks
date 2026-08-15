/**
 * A NET TYPE WRITTEN ON A PORT DECLARATION.
 *
 * `output wor [7:0] y` declares a wired-OR net that happens also to be a pin. IEEE 1364-2005 §4.6 makes
 * `trior` a SYNONYM for `wor` and `triand` for `wand` — identical semantics, different spelling.
 *
 * Both port paths used to read the direction, the range and `signed`, and drop the net-type keyword on the
 * floor. The resolution was therefore never registered, the several drivers the source deliberately wrote
 * read as a contention, and the module published with the pin ENTIRELY ABSENT — a block whose own declared
 * interface is a lie, and anything wiring to that pin silently got nothing. The same blind spot let
 * `output tri1 [31:0] y` publish a plain wire, which is a wrong VALUE rather than a missing pin.
 *
 * EVERY expected value below was read off Icarus Verilog 14.0 (oss-cad-suite), never off this
 * implementation. Each design is the same interface — `module top(input [3:0] a, output … [31:0] y)` — swept
 * over a = 0 and a = 3, and the probe is the FULL 32 bits: a narrow probe once truncated a wrong value into
 * a right-looking one. `readY` reports PIN-ABSENT separately from a pin that is present and reads 0, because
 * this defect was a missing pin and a value probe alone cannot see it.
 *
 * The last group exists to catch the opposite mistake. Both port paths now consume a net-type keyword, so
 * every ordinary spelling of a port — `output wire`, `output reg`, `input wire`, `output tri` — has to keep
 * building, and a net type on one port must not leak onto the next direction group.
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
const wire = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

function solve(block: BlockData, a: number): ReturnType<typeof simulateLogic> {
  const nodes: CanvasNodeLike[] = [
    { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    src('vp', 5),
  ]
  const edges: CanvasEdgeLike[] = [
    wire('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
    wire('eg', 'M', 'gnd', 'g', 'reference_terminal'),
    wire('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
  ]
  for (let bit = 0; bit < 4; bit++) {
    const id = `v${bit}`
    nodes.push(src(id, ((a >> bit) & 1) === 1 ? 5 : 0))
    edges.push(wire(`e${id}`, id, 'terminal_positive', 'M', `a[${bit}]`))
    edges.push(wire(`e${id}n`, id, 'terminal_negative', 'g', 'reference_terminal'))
  }
  return simulateLogic(nodes, edges, new Map())
}

/**
 * Import one design and read `y` at a = 0 and a = 3.
 *
 * 'REFUSED' means no design was published at all — always an acceptable answer. 'PIN-ABSENT' means a design
 * WAS published while the `y` its own source declares is missing from the interface; that is the defect this
 * file exists for, and it is reported apart from a value so it can never be mistaken for one.
 */
function readY(source: string): string {
  const { block } = importVerilog(source)
  if (block === null) return 'REFUSED'
  const ids = new Set(block.ports.map((p) => p.id))
  const scalar = ids.has('y')
  if (!scalar && !ids.has('y[0]')) return 'PIN-ABSENT'
  return [0, 3]
    .map((a) => {
      const result = solve(block, a)
      if (scalar) return `${a}=${result.value('M', 'y') === true ? 1 : 0}`
      let out = 0n
      for (let bit = 0; bit < 32; bit++)
        if (result.value('M', `y[${bit}]`) === true) out |= 1n << BigInt(bit)
      return `${a}=${out}`
    })
    .join(' ')
}

/** Two drivers on `y`: a constant 0xF0, and a | 0x3C. Icarus OR-resolves to 252/255, AND-resolves to 48/48. */
const twoDrivers = "assign y = 32'h000000F0;\n   assign y = {28'd0, a} | 32'h0000003C;"

const OR_RESOLVED = '0=252 3=255'
const AND_RESOLVED = '0=48 3=48'

describe('a wired net type on an output PORT resolves its drivers', () => {
  // Icarus 14.0, `module top(input [3:0] a, output <kind> [31:0] y)` with the two drivers above:
  //   wor 252/255 · trior 252/255 · wand 48/48 · triand 48/48 — the tri* spellings are synonyms.
  for (const [kind, expected] of [
    ['wor', OR_RESOLVED],
    ['trior', OR_RESOLVED],
    ['wand', AND_RESOLVED],
    ['triand', AND_RESOLVED],
  ] as const) {
    test(`${kind} on an ANSI output port`, () => {
      expect(
        readY(`module top(input [3:0] a, output ${kind} [31:0] y);
   ${twoDrivers}
endmodule`),
      ).toBe(expected)
    })

    test(`${kind} on a non-ANSI output port`, () => {
      expect(
        readY(`module top(a, y);
   input [3:0] a;
   output ${kind} [31:0] y;
   ${twoDrivers}
endmodule`),
      ).toBe(expected)
    })

    test(`${kind} declared separately from a non-ANSI port`, () => {
      expect(
        readY(`module top(a, y);
   input [3:0] a;
   output [31:0] y;
   ${kind} [31:0] y;
   ${twoDrivers}
endmodule`),
      ).toBe(expected)
    })

    test(`${kind} as an internal net still resolves`, () => {
      expect(
        readY(`module top(input [3:0] a, output [31:0] y);
   ${kind} [31:0] t;
   assign t = 32'h000000F0;
   assign t = {28'd0, a} | 32'h0000003C;
   assign y = t;
endmodule`),
      ).toBe(expected)
    })
  }

  // Icarus: a = 0 → 0, a = 3 → 1 for all four (a[0] and a[1] are both 1 at a = 3, so OR and AND agree).
  for (const kind of ['wor', 'trior', 'wand', 'triand'] as const)
    test(`${kind} on a SCALAR port (no range) resolves`, () => {
      expect(
        readY(`module top(input [3:0] a, output ${kind} y);
   assign y = a[0];
   assign y = a[1];
endmodule`),
      ).toBe('0=0 3=1')
    })

  test('a wired PORT is exempt from the drive-strength ladder, as a wired net is', () => {
    // Icarus 252/255: the strengths annotate drivers that COMBINE, they do not out-drive one another.
    expect(
      readY(`module top(input [3:0] a, output wor [31:0] y);
   assign (strong1, strong0) y = 32'h000000F0;
   assign (weak1, weak0)     y = {28'd0, a} | 32'h0000003C;
endmodule`),
    ).toBe(OR_RESOLVED)
  })

  test('a wired PORT resolves a submodule driver against a local one', () => {
    expect(
      readY(`module child(input [7:0] p, output [31:0] q);
   assign q = {24'd0, p};
endmodule
module top(input [3:0] a, output wor [31:0] y);
   child u(.p(8'hF0), .q(y));
   assign y = {28'd0, a} | 32'h0000003C;
endmodule`),
    ).toBe(OR_RESOLVED)
  })
})

describe('a wired PORT that lost a driver publishes nothing', () => {
  // The lost-driver rule has to reach ports too: `initial r = …` is not built, so the second driver of the
  // wired OR never gets a gate. Answering from the survivor alone would publish 240 where Icarus reads 252.
  for (const kind of ['wor', 'trior'] as const)
    test(`${kind} port with a driver behind an unbuilt construct refuses`, () => {
      expect(
        readY(`module top(input [3:0] a, output ${kind} [31:0] y);
   reg [31:0] r;
   initial r = 32'h0000003C;
   assign y = 32'h000000F0;
   assign y = r;
endmodule`),
      ).toBe('REFUSED')
    })
})

describe('the net types this netlist has no value for refuse on a PORT too', () => {
  // `tri0`/`tri1` PULL when undriven and `trireg` HOLDS charge — none of them is a wor/wand synonym, and a
  // two-valued netlist has no way to produce any of those values. The net-declaration path already refused
  // them; the port paths published a plain wire. Measured: `output tri1 [31:0] y; assign y[3:0] = a;` reads
  // 4294967280 in Icarus (the undriven bits pull to 1) against 0 here. `output trireg` Icarus rejects outright.
  for (const kind of ['tri0', 'tri1', 'trireg'] as const) {
    test(`${kind} on an ANSI port refuses`, () => {
      expect(
        readY(`module top(input [3:0] a, output ${kind} [31:0] y);
   assign y[3:0] = a;
endmodule`),
      ).toBe('REFUSED')
    })

    test(`${kind} on a non-ANSI port refuses`, () => {
      expect(
        readY(`module top(a, y);
   input [3:0] a;
   output ${kind} [31:0] y;
   assign y[3:0] = a;
endmodule`),
      ).toBe('REFUSED')
    })

    test(`${kind} as an internal net still refuses`, () => {
      expect(
        readY(`module top(input [3:0] a, output [31:0] y);
   ${kind} [31:0] t;
   assign t[3:0] = a;
   assign y = t;
endmodule`),
      ).toBe('REFUSED')
    })
  }

  // A net declaration turns supply0/supply1 into a real constant drive. Both port paths are parsed before the
  // assignment list exists, so there is nowhere to put that drive — the port is claimed, not published bare.
  for (const kind of ['supply0', 'supply1'] as const)
    test(`${kind} on a port refuses rather than publishing an undriven wire`, () => {
      expect(
        readY(`module top(input [3:0] a, output ${kind} [31:0] y);
endmodule`),
      ).toBe('REFUSED')
    })

  test('the refusal names the net type it could not build', () => {
    const { warnings } = importVerilog(`module top(input [3:0] a, output tri1 [31:0] y);
   assign y[3:0] = a;
endmodule`)
    expect(warnings.join(' | ')).toContain('is declared "tri1"')
  })
})

describe('ordinary port spellings still build', () => {
  // `tri` is a synonym for `wire` and `uwire` is an unresolved wire; neither adds a resolution, and both have
  // always built. Icarus reads 0 / 99 for a * 33 at a = 0 and a = 3.
  const MULTIPLIED = '0=0 3=99'
  for (const [name, source] of [
    ['output wire, ANSI', 'module top(input [3:0] a, output wire [31:0] y);'],
    ['output tri, ANSI', 'module top(input [3:0] a, output tri [31:0] y);'],
    ['output uwire, ANSI', 'module top(input [3:0] a, output uwire [31:0] y);'],
    ['input wire and output wire', 'module top(input wire [3:0] a, output wire [31:0] y);'],
    ['output wire signed', 'module top(input [3:0] a, output wire signed [31:0] y);'],
  ] as const)
    test(name, () => {
      expect(readY(`${source}\n   assign y = a * 32'd33;\nendmodule`)).toBe(MULTIPLIED)
    })

  test('output wire, non-ANSI', () => {
    expect(
      readY(`module top(a, y);
   input [3:0] a;
   output wire [31:0] y;
   assign y = a * 32'd33;
endmodule`),
    ).toBe(MULTIPLIED)
  })

  test('output reg still builds', () => {
    expect(
      readY(`module top(input [3:0] a, output reg [31:0] y);
   always @* y = a * 32'd33;
endmodule`),
    ).toBe(MULTIPLIED)
  })

  test('a net type on one ANSI port does not leak onto the next direction group', () => {
    // `z` is a plain wire with ONE driver. If `wor` leaked onto it the design would still read 252/255 here,
    // so the leak is caught by z's own value: Icarus reads 7 for z on both vectors.
    const { block } =
      importVerilog(`module top(input [3:0] a, output wor [31:0] y, output [31:0] z);
   ${twoDrivers}
   assign z = 32'd7;
endmodule`)
    expect(block).not.toBeNull()
    if (block === null) return
    const result = solve(block, 3)
    let z = 0n
    for (let bit = 0; bit < 32; bit++)
      if (result.value('M', `z[${bit}]`) === true) z |= 1n << BigInt(bit)
    expect(z).toBe(7n)
  })
})
