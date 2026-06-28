/**
 * Mixed-signal co-simulation, step 4 — the character generator's VIDEO output: MESSAGE ROM + FONT ROM
 * + column MUX, all real gate planes on top of the step-3 scan counters. Clocked through a full raster
 * field on the fast logic engine, the one-bit 'video' output must match the golden glyph model
 * (charGenExpectedVideo) at every scan position — i.e. the real gates correctly implement the ROMs and
 * the mux, painting HELLO WORLD. Also checks the video pin is classified as a logic OUTPUT (the bridge
 * driver into the CRT grid).
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { isOutputDrive } from '../src/renderer/blocks.ts'
import { CHAR_GEN, charGenExpectedVideo } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

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

function makeGen() {
  const state = new Map<string, boolean>()
  const solve = (clk: boolean, clr: boolean): { video: number; settled: boolean } => {
    const nodes: CanvasNodeLike[] = [
      { id: 'CG', position: { x: 0, y: 0 }, data: { definition: 'block', block: CHAR_GEN } },
      { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
      src('vclk', clk ? 5 : 0),
      src('vclr', clr ? 5 : 0),
      src('vp', 5),
    ]
    const edges: CanvasEdgeLike[] = [
      w('e_clk', 'vclk', 'terminal_positive', 'CG', 'clk'),
      w('e_clr', 'vclr', 'terminal_positive', 'CG', 'clr'),
      w('e_vp', 'vp', 'terminal_positive', 'CG', 'v_dd'),
      w('e_gnd', 'CG', 'gnd', 'g', 'reference_terminal'),
      w('e_clkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('e_clrn', 'vclr', 'terminal_negative', 'g', 'reference_terminal'),
      w('e_vpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    const r = simulateLogic(nodes, edges, state)
    return { video: r.value('CG', 'video') === true ? 1 : 0, settled: r.settled }
  }
  const tick = (clr = false) => {
    solve(false, clr)
    return solve(true, clr)
  }
  tick(true) // clear → deterministic top-left start
  return { tick }
}

describe('char-gen video output (step 4)', () => {
  test('the video pin is a logic output (the bridge driver)', () => {
    const v = CHAR_GEN.ports.find((p) => p.id === 'video')
    expect(v).toBeDefined()
    expect(isOutputDrive(v?.drive)).toBe(true)
  })

  test('video matches the golden glyph model across a full raster field (HELLO WORLD)', () => {
    const { tick } = makeGen()
    let mismatches = 0
    let litSeen = 0
    for (let n = 1; n <= 1024; n++) {
      const { video, settled } = tick()
      expect(settled).toBe(true)
      const dot = n % 8
      const char = Math.floor(n / 8) % 16
      const line = Math.floor(n / 128) % 8
      const expected = charGenExpectedVideo(dot, char, line)
      if (video !== expected) mismatches++
      if (expected === 1) litSeen++
    }
    expect(mismatches).toBe(0)
    expect(litSeen).toBeGreaterThan(100) // the letters really do light a lot of pixels
  }, 60000)

  test('the golden glyph model spells recognizable letters (font sanity)', () => {
    // The gate-vs-model equality is proven by the full-field test; this just confirms the model itself
    // draws the right shapes — H's two posts + crossbar, O's bowl, the space slot blank.
    const render = (char: number, line: number) =>
      [0, 1, 2, 3, 4].map((d) => (charGenExpectedVideo(d, char, line) ? '#' : '.')).join('')
    expect(render(0, 0)).toBe('#...#') // H, top
    expect(render(0, 3)).toBe('#####') // H, crossbar
    expect(render(0, 6)).toBe('#...#') // H, bottom
    expect(render(4, 0)).toBe('.###.') // O, top bowl
    expect(render(5, 0)).toBe('.....') // slot 5 = space, blank
  })
})
