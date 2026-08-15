/**
 * DRIVE STRENGTHS ON A BIT-SELECT — `buf (strong1, strong0) g0(y[1], a[0]);`
 *
 * A gate whose terminals are not plain net names (`y[1]`, `a[0]`, an expression) is carried to the
 * synthesizer as a RAW gate and resolved there, because only the synthesizer knows every net's width. Two
 * things were lost on that trip and both are fixed here:
 *
 *   1. the instance's drive strength was dropped when the raw gate became a real gate, so the ladder saw an
 *      unannotated driver — and a LONE `(strong1, highz0)` on a bit-select built as an ordinary buffer,
 *      answering 0 where Icarus floats the net at z;
 *   2. every net a raw gate merely NAMED was struck off the strength ladder, which took the exemption away
 *      from the very bit the strengths were written on — so the pair became an ordinary contention, both
 *      drivers were retracted, and the module was published with that PIN MISSING from its interface.
 *
 * EVERY expected value below was read off Icarus Verilog 14.0 (oss-cad-suite), never off this
 * implementation. Each design is swept over all sixteen vectors of a 4-bit input `a`, and the probe port is
 * 32 bits wide — far wider than any value under test — so a wrong answer cannot truncate into a right-looking
 * one. A missing pin is checked for EXPLICITLY rather than read as a 0, because a dropped pin is exactly the
 * defect these tests exist to catch.
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
const said = (warnings: string[]): string => warnings.join(' | ')

function solve(
  block: BlockData,
  inputs: Record<string, boolean>,
): ReturnType<typeof simulateLogic> {
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
  let k = 0
  for (const [port, value] of Object.entries(inputs)) {
    const id = `v${k++}`
    nodes.push(src(id, value ? 5 : 0))
    edges.push(wire(`e${id}`, id, 'terminal_positive', 'M', port))
    edges.push(wire(`e${id}n`, id, 'terminal_negative', 'g', 'reference_terminal'))
  }
  return simulateLogic(nodes, edges, new Map())
}

/**
 * Import `source`, then read `y` over all sixteen vectors of `a` and return the values space-separated —
 * the same sweep the Icarus bench ran, so the expected strings transcribe directly. Every one of `y`'s
 * declared bits must be present on the interface: a block published minus a pin is a block whose interface
 * is narrower than the module it claims to be, and reading such a bit as 0 would score that as a pass.
 */
function sweep(source: string, width: number): string {
  const { block, warnings } = importVerilog(source)
  if (block === null) return 'REFUSED'
  const ids = new Set(block.ports.map((p) => p.id))
  for (let bit = 0; bit < width; bit++)
    expect(ids.has(`y[${bit}]`), `pin y[${bit}] is missing — ${said(warnings)}`).toBe(true)
  const values: number[] = []
  for (let vector = 0; vector < 16; vector++) {
    const inputs: Record<string, boolean> = {}
    for (let bit = 0; bit < 4; bit++) inputs[`a[${bit}]`] = ((vector >> bit) & 1) === 1
    const read = solve(block, inputs)
    let value = 0
    for (let bit = 0; bit < width; bit++)
      if (read.value('M', `y[${bit}]`) === true) value += 1 << bit
    values.push(value)
  }
  return values.join(' ')
}

/** True when the design publishes no value at all for `y[bit]` — refused outright, or the pin dropped. */
function carriesNoValue(source: string, bit: number): boolean {
  const { block } = importVerilog(source)
  if (block === null) return true
  return !block.ports.some((p) => p.id === `y[${bit}]`)
}

/** `module top(input [3:0] a, output [31:0] y); <body> endmodule` — the 32-bit probe. */
const wide = (body: string): string =>
  `module top(input [3:0] a, output [31:0] y); ${body} endmodule`

describe('drive strengths on a bit-select resolve per bit, and the pin survives', () => {
  test('two strengths on one bit-select: the strong driver wins and y[1] is still a pin', () => {
    // Icarus: y[1] = a[0] (strong beats weak), y[0] = a[2]. Both drivers used to be retracted as an
    // ordinary contention and the module published with no y[1] pin at all.
    expect(
      sweep(
        wide(`buf (strong1, strong0) g0(y[1], a[0]);
              buf (weak1, weak0)     g1(y[1], a[1]);
              assign y[0] = a[2];
              assign y[31:2] = 30'd0;`),
        32,
      ),
    ).toBe('0 2 0 2 1 3 1 3 0 2 0 2 1 3 1 3')
  })

  test('the reported spelling on a narrow port reads 7, not 5', () => {
    // Icarus on `output [2:0] y` with y[1] strength-resolved, y[0] = a[0], y[2] = a[2]: a = 5 gives 7.
    const y = sweep(
      `module top(input [3:0] a, output [2:0] y);
         buf (strong1, strong0) g0(y[1], a[0]);
         buf (weak1, weak0)     g1(y[1], a[1]);
         assign y[0] = a[0];
         assign y[2] = a[2];
       endmodule`,
      3,
    )
    expect(y).toBe('0 3 0 3 4 7 4 7 0 3 0 3 4 7 4 7')
    expect(y.split(' ')[5]).toBe('7')
  })

  test('different bits of one bus each get their own ladder', () => {
    // Icarus: y[0] = a[0] (strong over weak), y[1] = a[2] (pull over weak).
    expect(
      sweep(
        wide(`buf (strong1, strong0) g0(y[0], a[0]);
              buf (weak1, weak0)     g1(y[0], a[1]);
              buf (pull1, pull0)     g2(y[1], a[2]);
              buf (weak1, weak0)     g3(y[1], a[3]);
              assign y[31:2] = 30'd0;`),
        32,
      ),
    ).toBe('0 1 0 1 2 3 2 3 0 1 0 1 2 3 2 3')
  })

  test('a strength-resolved bit sits alongside an ordinary whole-net driver of the rest', () => {
    // Icarus: w[0] = a[0] resolved, w[3:1] = a[3:1] assigned — so y = a on all sixteen vectors.
    expect(
      sweep(
        wide(`wire [3:0] w;
              buf (strong1, strong0) g0(w[0], a[0]);
              buf (weak1, weak0)     g1(w[0], a[1]);
              assign w[3:1] = {a[3], a[2], a[1]};
              assign y = {28'd0, w};`),
        32,
      ),
    ).toBe('0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15')
  })

  test('the whole ladder holds per bit: supply beats strong, and a third driver changes nothing', () => {
    // Icarus gives y = a[0] for both — the top driver owns the bit whatever is under it.
    expect(
      sweep(
        wide(`buf (supply1, supply0) g0(y[0], a[0]);
              buf (strong1, strong0) g1(y[0], a[1]);
              assign y[31:1] = 31'd0;`),
        32,
      ),
    ).toBe('0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1')
    expect(
      sweep(
        wide(`buf (supply1, supply0) g0(y[0], a[0]);
              buf (strong1, strong0) g1(y[0], a[1]);
              buf (weak1, weak0)     g2(y[0], a[2]);
              assign y[31:1] = 31'd0;`),
        32,
      ),
    ).toBe('0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1')
  })

  test('a HIGH-Z side on a bit-select lets the weaker driver through', () => {
    // The high-Z driver is ABSENT while it would drive 0, so Icarus reads a[0] | a[1]: 0,1,1,1 repeating.
    expect(
      sweep(
        wide(`buf (strong1, highz0) g0(y[0], a[0]);
              buf (weak1, weak0)    g1(y[0], a[1]);
              assign y[31:1] = 31'd0;`),
        32,
      ),
    ).toBe('0 1 1 1 0 1 1 1 0 1 1 1 0 1 1 1')
  })

  test('a gate with a bit-select INPUT keeps its strength too', () => {
    // The whole instance is a raw gate as soon as ANY terminal is a select, so the target being a plain net
    // does not save it. Icarus: y = a[0] — and this design used to be refused outright.
    expect(
      sweep(
        wide(`wire t;
              buf (strong1, strong0) g0(t, a[0]);
              buf (weak1, weak0)     g1(t, a[1]);
              assign y = {31'd0, t};`),
        32,
      ),
    ).toBe('0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1')
  })

  test('a multi-output "not" resolves EACH of its bit-select outputs', () => {
    // Icarus: y[0] = ~a[0] strong, y[1] = ~a[0] strong — 3,0,3,0 repeating over the sixteen vectors.
    expect(
      sweep(
        wide(`not (strong1, strong0) g0(y[0], y[1], a[0]);
              buf (weak1, weak0)     g1(y[0], a[1]);
              buf (weak1, weak0)     g2(y[1], a[2]);
              assign y[31:2] = 30'd0;`),
        32,
      ),
    ).toBe('3 0 3 0 3 0 3 0 3 0 3 0 3 0 3 0')
  })

  test('an "and" gate on a bit-select resolves against a weaker buffer', () => {
    // Icarus: y[0] = a[0] & a[1] — the strong AND beating the weak buffer of a[2].
    expect(
      sweep(
        wide(`and (strong1, strong0) g0(y[0], a[0], a[1]);
              buf (weak1, weak0)     g1(y[0], a[2]);
              assign y[31:1] = 31'd0;`),
        32,
      ),
    ).toBe('0 0 0 1 0 0 0 1 0 0 0 1 0 0 0 1')
  })

  test('a gate strength on a bit-select resolves against an ASSIGN strength on the same bit', () => {
    // Icarus: y[0] = a[0]. The two constructs reach the ladder by different routes and must still meet.
    expect(
      sweep(
        wide(`buf (strong1, strong0) g0(y[0], a[0]);
              assign (weak1, weak0) y[0] = a[1];
              assign y[31:1] = 31'd0;`),
        32,
      ),
    ).toBe('0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1')
  })

  test('the pair survives being written in a SUB-MODULE and flattened into the parent', () => {
    // Icarus: the child resolves y[0] = a[0] and passes a[3:1] through, so the top is the identity.
    expect(
      sweep(
        `module ch(input [3:0] a, output [3:0] y);
           buf (strong1, strong0) g0(y[0], a[0]);
           buf (weak1, weak0)     g1(y[0], a[1]);
           assign y[3:1] = a[3:1];
         endmodule
         module top(input [3:0] a, output [31:0] y);
           wire [3:0] w;
           ch u(.a(a), .y(w));
           assign y = {28'd0, w};
         endmodule`,
        32,
      ),
    ).toBe('0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15')
  })

  test('the NON-ANSI spelling resolves the same way', () => {
    expect(
      sweep(
        `module top(a, y);
           input [3:0] a;
           output [31:0] y;
           buf (strong1, strong0) g0(y[1], a[0]);
           buf (weak1, weak0)     g1(y[1], a[1]);
           assign y[0] = a[2];
           assign y[31:2] = 30'd0;
         endmodule`,
        32,
      ),
    ).toBe('0 2 0 2 1 3 1 3 0 2 0 2 1 3 1 3')
  })
})

describe('a bit-select the strengths cannot settle is refused, never published', () => {
  test('a LONE driver with a high-Z side refuses instead of building an ordinary buffer', () => {
    // Icarus floats y[0] at z on every vector where a[0] is 0. This used to publish 0 there — a value
    // nothing produced, and the one wrong ANSWER (rather than missing pin) this defect caused.
    const source = wide(`buf (strong1, highz0) g0(y[0], a[0]); assign y[31:1] = 31'd0;`)
    expect(sweep(source, 32)).toBe('REFUSED')
    expect(said(importVerilog(source).warnings)).toContain('is NOT built')
  })

  test('EQUAL strengths in genuine conflict still carry no value', () => {
    // Icarus reads x whenever a[0] and a[1] disagree. Two strong drivers have no winner, so the bit must
    // never come out as a 0 or a 1.
    expect(
      carriesNoValue(
        wide(`buf (strong1, strong0) g0(y[0], a[0]);
              buf (strong1, strong0) g1(y[0], a[1]);
              assign y[31:1] = 31'd0;`),
        0,
      ),
    ).toBe(true)
  })

  test('crossed sides have no winner on two of the four combinations, and carry no value', () => {
    // `(strong1, weak0)` against `(weak1, strong0)` reads 0, x, x, 1 in Icarus — the case that defeats any
    // rule ranking the two drivers once instead of per driven value.
    expect(
      carriesNoValue(
        wide(`buf (strong1, weak0) g0(y[0], a[0]);
              buf (weak1, strong0) g1(y[0], a[1]);
              assign y[31:1] = 31'd0;`),
        0,
      ),
    ).toBe(true)
  })

  test('two open-drain drivers float on the combination where neither is driving', () => {
    // Both `(highz1, strong0)`: Icarus reads z when a[0] and a[1] are both 1. Only enumerating every
    // combination finds that hole — the two drivers have a perfectly strict order on the other three.
    expect(
      carriesNoValue(
        wide(`buf (highz1, strong0) g0(y[0], a[0]);
              buf (highz1, strong0) g1(y[0], a[1]);
              assign y[31:1] = 31'd0;`),
        0,
      ),
    ).toBe(true)
  })

  test('a bit-select pair that LOST one of its drivers refuses rather than resolving the survivor', () => {
    // The weak driver reads x, so no gate is built for it and the strong one would be left looking like a
    // lone driver. Icarus resolves the pair to a[0]; the drivers left here are not the set the source
    // wrote, so the honest answer is a refusal that names the reason.
    const source = wide(`buf (strong1, strong0) g0(y[0], a[0]);
                         buf (weak1, weak0)     g1(y[0], 1'bx);
                         assign y[31:1] = 31'd0;`)
    expect(sweep(source, 32)).toBe('REFUSED')
    expect(said(importVerilog(source).warnings)).toContain(
      'a driver the source wrote for it was not built',
    )
  })
})

describe('the constructs around a bit-select strength are unchanged', () => {
  test('bit-select gates with NO strength anywhere still build exactly as before', () => {
    // Icarus: y[0] = a[0] & a[1], y[1] = a[2] | a[3]. A module with no strength in it must not be routed
    // through the ladder at all.
    expect(
      sweep(
        wide(`and g0(y[0], a[0], a[1]);
              or  g1(y[1], a[2], a[3]);
              assign y[31:2] = 30'd0;`),
        32,
      ),
    ).toBe('0 0 0 1 2 2 2 3 2 2 2 3 2 2 2 3')
  })

  test('an unstrengthened bit-select gate on a bus resolved ELSEWHERE still builds', () => {
    // The over-refusal check: a ladder on y[0] must not cost y[2] its ordinary AND. Icarus:
    // y[0] = a[0], y[1] = a[3], y[2] = a[0] & a[1].
    expect(
      sweep(
        wide(`and g0(y[2], a[0], a[1]);
              buf (strong1, strong0) g1(y[0], a[0]);
              buf (weak1, weak0)     g2(y[0], a[1]);
              assign y[1] = a[3];
              assign y[31:3] = 29'd0;`),
        32,
      ),
    ).toBe('0 1 0 5 0 1 0 5 2 3 2 7 2 3 2 7')
  })

  test('a WOR net still COMBINES its bit drivers instead of laddering them', () => {
    // Icarus: w[0] = a[0] | a[1], w[1] = a[2]. Resolving a wired net by strength would drop the driver the
    // OR needs and turn this into w[0] = a[0].
    expect(
      sweep(
        wide(`wor [1:0] w;
              buf (strong1, strong0) g0(w[0], a[0]);
              buf (strong1, strong0) g1(w[0], a[1]);
              assign w[1] = a[2];
              assign y = {30'd0, w};`),
        32,
      ),
    ).toBe('0 1 1 1 2 3 3 3 0 1 1 1 2 3 3 3')
  })

  test('strengths on PLAIN-NET terminals resolve as they always did', () => {
    // The path that never went through a raw gate: Icarus reads y = a[0].
    expect(
      sweep(
        wide(`wire s0, s1, t;
              assign s0 = a[0];
              assign s1 = a[1];
              buf (strong1, strong0) g0(t, s0);
              buf (weak1, weak0)     g1(t, s1);
              assign y = {31'd0, t};`),
        32,
      ),
    ).toBe('0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1')
  })

  test('a strength on a switch primitive or an instance array is still not built', () => {
    // `bufif1` goes to z when its enable is low and an instance array is one name over several copies —
    // neither has a faithful image here, and carrying a strength must not talk either into being built.
    expect(
      sweep(wide(`bufif1 (strong1, strong0) g0(y[0], a[0], a[1]); assign y[31:1] = 31'd0;`), 32),
    ).toBe('REFUSED')
    expect(
      sweep(wide(`buf (strong1, strong0) g[1:0](y[1:0], a[1:0]); assign y[31:2] = 30'd0;`), 32),
    ).toBe('REFUSED')
  })
})
