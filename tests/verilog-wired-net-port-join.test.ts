/**
 * A WIRED NET TYPE MEETING A PORT.
 *
 * Two things live here, because they are one mechanism seen from two sides.
 *
 * FIRST, the SCALAR spelling. `output wor y` — no range — is the same declaration as `output wor [7:0] y`,
 * and the resolution has to reach it through both header styles, from one driver or several, from continuous
 * assignments or gate primitives, and from a submodule. verilog-port-net-type.test.ts covers the WIDE forms;
 * a scalar output's pin is named `y` rather than `y[0]`, which is the one thing that could make the narrow
 * case differ from the wide one, so it is pinned separately.
 *
 * SECOND, the DEFECT this file was written for. A port connection COLLAPSES the child's port net into the
 * enclosing net, so when the two carry different wired net types only one survives. Measured on Icarus
 * Verilog 14.0, the ENCLOSING declaration is the one that wins: a child `output wor o` joined to a parent
 * `wand n` reads a0&a1&a2 there, and the flattener — which let the child's resolution overwrite the
 * parent's — published a0|a1|a2. It BUILT and it DISAGREED, in eight shapes, including a plain
 * `output wand y` on the top module. A net the parent did NOT declare has no type to defend, so the child's
 * stands (`x_wor_in_wire`), and a second wired child on such a net overwrites the first — which is what
 * Icarus does with the last connection made (`x_two_children` vs `x_two_children_rev`).
 *
 * A connection to a BIT-SELECT collapses nothing, so both resolutions survive and nest: `x_bitsel_join`
 * reads the child's OR feeding the parent's AND, and Icarus agrees.
 *
 * EVERY expected string below was read off Icarus Verilog 14.0 (oss-cad-suite), never off this
 * implementation. Vectors 1, 2, 5 and 6 are the ones that separate a wired-OR from a wired-AND; a probe run
 * only at a = 0 and a = 3 cannot tell the two apart, and one that did exactly that reported a defect here
 * that was never in the importer.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const VECTORS = [0, 1, 2, 3, 5, 6, 7, 15]

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
 * Import one design and read `y` over every vector.
 *
 * 'REFUSED' means nothing was published, which is always an acceptable answer. 'PIN-ABSENT' means a design
 * WAS published while the `y` its own source declares is missing from the interface — reported apart from a
 * value so it can never be mistaken for one. A scalar port's pin is `y`; a ranged one's bits are `y[k]`.
 */
function readY(source: string): string {
  const { block } = importVerilog(source)
  if (block === null) return 'REFUSED'
  const ids = block.ports.map((p) => p.id)
  const scalar = ids.includes('y')
  const bits = ids.filter((id) => /^y\[\d+\]$/.test(id))
  if (!scalar && bits.length === 0) return 'PIN-ABSENT'
  return VECTORS.map((a) => {
    const result = solve(block, a)
    if (scalar) return `${a}=${result.value('M', 'y') === true ? 1 : 0}`
    let out = 0
    for (const id of bits) if (result.value('M', id) === true) out |= 1 << Number(id.slice(2, -1))
    return `${a}=${out}`
  }).join(' ')
}

const OR_OF_A0_A1 = '0=0 1=1 2=1 3=1 5=1 6=1 7=1 15=1'
const AND_OF_A0_A1 = '0=0 1=0 2=0 3=1 5=0 6=0 7=1 15=1'
const AND_OF_A0_A1_A2 = '0=0 1=0 2=0 3=0 5=0 6=0 7=1 15=1'

/** `assign y = a[0]; assign y = a[1];` — the two drivers a wired net exists to combine. */
const TWO_DRIVERS = '   assign y = a[0];\n   assign y = a[1];'

/** A child whose scalar output port carries a wired net type, with two drivers of its own. */
const child = (kind: string) => `module ch(input p, input q, output ${kind} o);
   assign o = p;
   assign o = q;
endmodule`

describe('a wired net type on a SCALAR port resolves its drivers', () => {
  // Icarus 14.0, `module top(input [3:0] a, output <kind> y)` with the two drivers above. `trior` is a
  // synonym for `wor` and `triand` for `wand` (IEEE 1364-2005 §4.6), and read identically here.
  for (const [kind, expected] of [
    ['wor', OR_OF_A0_A1],
    ['trior', OR_OF_A0_A1],
    ['wand', AND_OF_A0_A1],
    ['triand', AND_OF_A0_A1],
  ] as const) {
    test(`${kind} on an ANSI scalar output port`, () => {
      expect(
        readY(`module top(input [3:0] a, output ${kind} y);
${TWO_DRIVERS}
endmodule`),
      ).toBe(expected)
    })

    test(`${kind} on a non-ANSI scalar output port`, () => {
      expect(
        readY(`module top(a, y);
   input [3:0] a;
   output ${kind} y;
${TWO_DRIVERS}
endmodule`),
      ).toBe(expected)
    })

    test(`${kind} declared separately from a non-ANSI scalar port`, () => {
      expect(
        readY(`module top(a, y);
   input [3:0] a;
   output y;
   ${kind} y;
${TWO_DRIVERS}
endmodule`),
      ).toBe(expected)
    })
  }

  test('one driver on a scalar wor port is that driver', () => {
    expect(
      readY(`module top(input [3:0] a, output wor y);
   assign y = a[0];
endmodule`),
    ).toBe('0=0 1=1 2=0 3=1 5=1 6=0 7=1 15=1')
  })

  test('one driver on a scalar wand port is that driver', () => {
    expect(
      readY(`module top(input [3:0] a, output wand y);
   assign y = a[1];
endmodule`),
    ).toBe('0=0 1=0 2=1 3=1 5=0 6=1 7=1 15=1')
  })

  test('three drivers on a scalar wor port OR together', () => {
    expect(
      readY(`module top(input [3:0] a, output wor y);
   assign y = a[0];
   assign y = a[1];
   assign y = a[2];
endmodule`),
    ).toBe('0=0 1=1 2=1 3=1 5=1 6=1 7=1 15=1')
  })

  test('three drivers on a scalar wand port AND together', () => {
    expect(
      readY(`module top(input [3:0] a, output wand y);
   assign y = a[0];
   assign y = a[1];
   assign y = a[2];
endmodule`),
    ).toBe(AND_OF_A0_A1_A2)
  })

  test('an assignment and a gate primitive both drive a scalar wor port', () => {
    expect(
      readY(`module top(input [3:0] a, output wor y);
   assign y = a[0];
   buf g0(y, a[1]);
endmodule`),
    ).toBe(OR_OF_A0_A1)
  })

  test('two child instances drive a scalar wor port', () => {
    expect(
      readY(`module drv(input v, output o);
   assign o = v;
endmodule
module top(input [3:0] a, output wor y);
   drv d0(a[0], y);
   drv d1(a[1], y);
endmodule`),
    ).toBe(OR_OF_A0_A1)
  })

  test('two child instances drive a scalar wand port', () => {
    expect(
      readY(`module drv(input v, output o);
   assign o = v;
endmodule
module top(input [3:0] a, output wand y);
   drv d0(a[0], y);
   drv d1(a[1], y);
endmodule`),
    ).toBe(AND_OF_A0_A1)
  })
})

describe('across a port connection the ENCLOSING net type wins', () => {
  test('a child wor port joined to a parent wand net that has a driver of its own', () => {
    expect(
      readY(`${child('wor')}
module top(input [3:0] a, output y);
   wand n;
   ch u(a[0], a[1], n);
   assign n = a[2];
   assign y = n;
endmodule`),
    ).toBe(AND_OF_A0_A1_A2)
  })

  test('a child wand port joined to a parent wor net that has a driver of its own', () => {
    expect(
      readY(`${child('wand')}
module top(input [3:0] a, output y);
   wor n;
   ch u(a[0], a[1], n);
   assign n = a[2];
   assign y = n;
endmodule`),
    ).toBe('0=0 1=1 2=1 3=1 5=1 6=1 7=1 15=1')
  })

  test('a child wor port joined to a parent wand net with no other driver', () => {
    expect(
      readY(`${child('wor')}
module top(input [3:0] a, output y);
   wand n;
   ch u(a[0], a[1], n);
   assign y = n;
endmodule`),
    ).toBe(AND_OF_A0_A1)
  })

  test('a child wand port joined to a parent wor net with no other driver', () => {
    expect(
      readY(`${child('wand')}
module top(input [3:0] a, output y);
   wor n;
   ch u(a[0], a[1], n);
   assign y = n;
endmodule`),
    ).toBe(OR_OF_A0_A1)
  })

  test('a child wor port joined straight onto a parent output port declared wand', () => {
    expect(
      readY(`${child('wor')}
module top(input [3:0] a, output wand y);
   ch u(a[0], a[1], y);
   assign y = a[2];
endmodule`),
    ).toBe(AND_OF_A0_A1_A2)
  })

  test('a child wand port joined straight onto a parent output port declared wor', () => {
    expect(
      readY(`${child('wand')}
module top(input [3:0] a, output wor y);
   ch u(a[0], a[1], y);
   assign y = a[2];
endmodule`),
    ).toBe('0=0 1=1 2=1 3=1 5=1 6=1 7=1 15=1')
  })

  test('a wired net type on a child INPUT port does not override the parent net', () => {
    expect(
      readY(`module ch(input wor p, output o);
   assign o = p;
endmodule
module top(input [3:0] a, output y);
   wand n;
   assign n = a[0];
   assign n = a[1];
   ch u(n, y);
endmodule`),
    ).toBe(AND_OF_A0_A1)
  })

  test('a wor grandchild under a wand middle module keeps the middle module type', () => {
    expect(
      readY(`${child('wor')}
module mid(input p, input q, output wand o);
   ch u(p, q, o);
endmodule
module top(input [3:0] a, output y);
   wire n;
   mid m(a[0], a[1], n);
   assign n = a[2];
   assign y = n;
endmodule`),
    ).toBe(AND_OF_A0_A1_A2)
  })

  test('a wor grandchild under a wor middle module meets a wand grandparent', () => {
    expect(
      readY(`${child('wor')}
module mid(input p, input q, output wor o);
   ch u(p, q, o);
endmodule
module top(input [3:0] a, output y);
   wand n;
   mid m(a[0], a[1], n);
   assign n = a[2];
   assign y = n;
endmodule`),
    ).toBe(AND_OF_A0_A1_A2)
  })
})

describe('a net the parent did not declare keeps the type it is given', () => {
  test('a child wor port carries its resolution onto a plain parent wire', () => {
    expect(
      readY(`${child('wor')}
module top(input [3:0] a, output y);
   wire n;
   ch u(a[0], a[1], n);
   assign n = a[2];
   assign y = n;
endmodule`),
    ).toBe('0=0 1=1 2=1 3=1 5=1 6=1 7=1 15=1')
  })

  test('a child wor port carries its resolution onto a parent tri net', () => {
    expect(
      readY(`${child('wor')}
module top(input [3:0] a, output y);
   tri n;
   ch u(a[0], a[1], n);
   assign n = a[2];
   assign y = n;
endmodule`),
    ).toBe('0=0 1=1 2=1 3=1 5=1 6=1 7=1 15=1')
  })

  test('a plain child port leaves the parent wand net resolving', () => {
    expect(
      readY(`module ch(input p, input q, output o);
   assign o = p & q;
endmodule
module top(input [3:0] a, output y);
   wand n;
   ch u(a[0], a[1], n);
   assign n = a[2];
   assign y = n;
endmodule`),
    ).toBe(AND_OF_A0_A1_A2)
  })

  test('two wired children on one plain wire: the LAST connection made decides', () => {
    // Icarus reads AND of all four with the wand child connected second, OR of all four with the wor child
    // second — the same source in the other order. Nothing the parent declared is being defended here, so
    // the later child overwrites the earlier one, which is what the oracle does.
    const both = (first: string, second: string) => `module cwor(input p, input q, output wor o);
   assign o = p;
   assign o = q;
endmodule
module cwand(input p, input q, output wand o);
   assign o = p;
   assign o = q;
endmodule
module top(input [3:0] a, output y);
   wire n;
   ${first} u0(a[0], a[1], n);
   ${second} u1(a[2], a[3], n);
   assign y = n;
endmodule`
    expect(readY(both('cwor', 'cwand'))).toBe('0=0 1=0 2=0 3=0 5=0 6=0 7=0 15=1')
    expect(readY(both('cwand', 'cwor'))).toBe('0=0 1=1 2=1 3=1 5=1 6=1 7=1 15=1')
  })

  test('a connection to a BIT-SELECT collapses nothing, so both resolutions nest', () => {
    // y[0] is the parent's wand of {the child's wor of a0,a1} and a2; y[1] is a3 alone. Icarus reads
    // 1 at a=5 — which the collapsed reading, a0&a1&a2, could not produce.
    expect(
      readY(`${child('wor')}
module top(input [3:0] a, output [1:0] y);
   wand [1:0] n;
   ch u(a[0], a[1], n[0]);
   assign n[0] = a[2];
   assign n[1] = a[3];
   assign y = n;
endmodule`),
    ).toBe('0=0 1=0 2=0 3=0 5=1 6=1 7=1 15=3')
  })
})
