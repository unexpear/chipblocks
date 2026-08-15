/**
 * A `wor`/`wand` NET THAT LOST ONE OF ITS DRIVERS.
 *
 * A resolution net deliberately allows several drivers — that is what the net type is for — so the contention
 * check that protects a plain `wire` is switched off for it. That left one door open: a driver whose
 * right-hand side is x builds NO gate (see STAYS_X), and the wired OR/AND was then formed over the drivers
 * that DID get gates. The net answered as if the x driver had never been written, and the design published a
 * value where Icarus Verilog reads x.
 *
 * EVERY expected value below was read off Icarus Verilog 14.0 (oss-cad-suite), never off this implementation.
 * Each design was swept over all eight (a, b, c) vectors with `{c, b, a} = i` and printed with `%b`, so `x`
 * prints as itself rather than as 0 — a harness that folded x to 0 would score every wrong answer here as a
 * pass. The Icarus line is quoted beside each design; a design whose Icarus answer contains an `x` cannot be
 * built by a two-valued netlist at all, so the only acceptable answer for it is a refusal.
 *
 * The first group is the fault. The second group exists to catch the opposite mistake: refusing the ordinary
 * wired nets that have always worked. A count of "how many drivers did the source write for this bit" is the
 * whole mechanism, and a count that runs too high refuses real hardware.
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

const said = (warnings: string[]): string => warnings.join(' | ')

const source = (body: string): string =>
  `module top(a, b, c, y); input a; input b; input c; output y; ${body} endmodule`

/**
 * Import one body and read `y` over all eight (a, b, c) vectors, vector `i` driving a from bit 0 — the order
 * the Icarus bench used, so the expected strings below transcribe directly. Returns the published bits, or
 * 'REFUSED' when no design was published at all.
 */
function answers(body: string): string {
  const { block, warnings } = importVerilog(source(body))
  if (block === null) return 'REFUSED'
  const ids = new Set(block.ports.map((p) => p.id))
  if (!ids.has('y')) return 'REFUSED'
  let bits = ''
  for (let vector = 0; vector < 8; vector++) {
    const inputs: Record<string, boolean> = {}
    ;['a', 'b', 'c'].forEach((name, k) => {
      if (ids.has(name)) inputs[name] = ((vector >> k) & 1) === 1
    })
    const value = solve(block, inputs).value('M', 'y')
    expect(value, `y has no value on vector ${vector} — ${said(warnings)}`).not.toBeUndefined()
    bits += value === true ? '1' : '0'
  }
  return bits
}

/** The warnings of a body, joined — for reading the refusal's wording. */
function why(body: string): string {
  return said(importVerilog(source(body)).warnings)
}

describe('a wor/wand net that lost a driver publishes nothing', () => {
  test('an x-valued assign on a wand still counts as a driver', () => {
    // Icarus: 0,0,x,x,1,1,x,x. The x assign builds no gate, and the wired AND used to be formed over the two
    // survivors alone — which answers y = b ^ c, published on all eight vectors.
    expect(
      answers(
        "wand t; assign (strong1, pull0) t = b; assign t = 1'bx; buf gb2(t, b); assign y = t ^ c;",
      ),
    ).toBe('REFUSED')
  })

  test('an x-valued assign on a wor still counts as a driver', () => {
    // Icarus: x,x,0,0,x,x,0,0 — t is x whenever b is 0, so y is x on four of the eight vectors.
    expect(
      answers(
        "wor t; buf gb0(t, b); assign t = 1'bx; assign (highz1, weak0) t = 1'bx; assign y = ~t;",
      ),
    ).toBe('REFUSED')
  })

  test('a wor whose survivors include a constant-folding gate', () => {
    // Icarus: x,1,x,1,x,0,x,0. `xor gg0(t, c, c)` is a constant 0 driver, so the OR reads a — but the lost x
    // driver makes the whole net x, and only the vectors where the OR is 1 escape it.
    expect(
      answers(
        "wor t; xor gg0(t, c, c); assign (pull1, supply0) t = a; assign t = 1'bx; assign y = t ^ c;",
      ),
    ).toBe('REFUSED')
  })

  test('a wor left with a SINGLE surviving driver is refused, not published as that driver', () => {
    // Icarus: x,x,1,1,x,x,0,0. Two drivers were written, one built. The old code skipped any net with fewer
    // than two drivers left, so the lone survivor drove the net outright and y read b ^ c.
    expect(
      answers(
        "wor t; buf (weak1, weak0) gb0(t, b); assign (highz1, strong0) t = 1'bx; assign y = t ^ c;",
      ),
    ).toBe('REFUSED')
  })

  test('three drivers, one of them x', () => {
    // Icarus: 1,x,1,1,0,x,0,0.
    expect(
      answers(
        "wor t; assign (strong1, pull0) t = 1'bx; assign (weak1, strong0) t = b; assign (pull1, weak0) t = ~a; assign y = t ^ c;",
      ),
    ).toBe('REFUSED')
  })

  test('a wand with four drivers, one of them x', () => {
    // Icarus: 1,1,1,1,x,1,x,1.
    expect(
      answers(
        "wand t; or gg0(t, c, a); buf gb1(t, c); assign (pull1, supply0) t = 1'bx; xor (weak1, supply0) gg3(t, a, c); assign y = ~t;",
      ),
    ).toBe('REFUSED')
  })

  test('a design with NO drive strength anywhere is caught too', () => {
    // Icarus: x,x,0,0,x,x,0,0. This is the trap case for a fix keyed on the drive-strength driver map, which
    // is empty by construction when nothing in the design carries a strength.
    expect(answers("wor t; buf gb0(t, b); assign t = 1'bx; assign y = ~t;")).toBe('REFUSED')
  })

  test('a bus bit driven through a BIT-SELECT gate terminal is counted too', () => {
    // The gate `buf gb0(t[0], a)` reaches the synthesizer as unresolved token spans, because the widths that
    // turn `t[0]` into a bit-net live here. Counting only what the parser already resolved would leave this
    // wor a driver short in the OTHER direction — it would look like the assign was the only one written.
    // Icarus on the pair: x,1,x,1,x,0,x,0 for the wor and 0,1,0,x,0,1,0,x for the wand.
    expect(
      answers(
        "wor [1:0] t; buf gb0(t[0], a); assign t[0] = 1'bx; assign t[1] = c; assign y = t[0] ^ t[1];",
      ),
    ).toBe('REFUSED')
    expect(
      answers(
        "wand [1:0] t; and gg0(t[1], a, b); assign t[1] = 1'bx; assign t[0] = a; assign y = t[0] ^ t[1];",
      ),
    ).toBe('REFUSED')
  })

  test('the refusal names the net and says a driver went missing', () => {
    const said = why("wor t; buf gb0(t, b); assign t = 1'bx; assign y = ~t;")
    expect(said).toContain('"t"')
    expect(said).toContain('a driver the source wrote for it was not built')
    expect(said).toContain('is NOT built')
  })
})

describe('ordinary wired nets still build', () => {
  test('two assigns on a wor and on a wand', () => {
    expect(answers('wor t; assign t = a; assign t = b; assign y = t ^ c;')).toBe('01111000')
    expect(answers('wand t; assign t = a; assign t = b; assign y = t ^ c;')).toBe('00011110')
  })

  test('a structural gate and an assign share one wor', () => {
    expect(answers('wor t; buf gb(t, a); assign t = b; assign y = t ^ c;')).toBe('01111000')
  })

  test('three drivers, all of them built', () => {
    expect(answers('wor t; assign t = a; assign t = b; assign t = c; assign y = t;')).toBe(
      '01111111',
    )
    expect(answers('wor t; buf gb0(t, a); buf gb1(t, b); buf gb2(t, c); assign y = t;')).toBe(
      '01111111',
    )
  })

  test('a gate whose output is a wor, plus an assign', () => {
    expect(answers('wand t; and g0(t, a, b); assign t = c; assign y = t;')).toBe('00000001')
  })

  test('drive strengths on a wor still COMBINE rather than resolve', () => {
    expect(
      answers(
        'wor t; assign (strong1, strong0) t = a; assign (weak1, weak0) t = b; assign y = t ^ c;',
      ),
    ).toBe('01111000')
  })

  test('a CONSTANT driver is a driver and is built', () => {
    expect(answers("wor t; assign t = a & b; assign t = 1'b0; assign y = t ^ c;")).toBe('00011110')
    expect(answers("wand t; assign t = a | b; assign t = 1'b1; assign y = t ^ c;")).toBe('01111000')
  })

  test('a wor BUS resolves bit by bit and every bit is built', () => {
    expect(
      answers('wor [1:0] t; assign t = {a, b}; assign t = {b, c}; assign y = t[0] ^ t[1];'),
    ).toBe('01001000')
  })

  test('a BIT-SELECT gate terminal on a bus wired net still builds', () => {
    // The same two designs as the bit-select refusal above, with the x driver replaced by a real one. If the
    // new count treated an unresolved gate terminal as no driver at all, these would refuse.
    expect(
      answers(
        'wor [1:0] t; buf gb0(t[0], a); assign t[0] = b; assign t[1] = c; assign y = t[0] ^ t[1];',
      ),
    ).toBe('01111000')
    expect(
      answers(
        'wand [1:0] t; and gg0(t[1], a, b); assign t[1] = c; assign t[0] = a; assign y = t[0] ^ t[1];',
      ),
    ).toBe('01010100')
  })
})
