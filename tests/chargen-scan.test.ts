/**
 * Mixed-signal co-simulation, step 3 — the character generator's SCAN COUNTERS, on the fast logic
 * engine. Three real synchronous up-counters (dot 0..7, char 0..15, line 0..7) all clocked by one
 * pixel clock; the cascade is by combinational count-ENABLE (char counts when dot is at max, line when
 * dot AND char are at max), NOT by ripple-clocking — the construction the design flagged as must-prove
 * (a unique fixed point each settle). One pixel clock = a CLK-low solve then a CLK-high solve, with a
 * persistent state Map (the flip-flops' memory). CLR (= load 0) gives a deterministic power-up.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { CHARGEN_SCAN } from '../src/renderer/builtin-blocks.ts'
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

type Count = { dot: number; char: number; line: number; settled: boolean }

function makeScan() {
  const state = new Map<string, boolean>()
  const solve = (clk: boolean, clr: boolean): Count => {
    const nodes: CanvasNodeLike[] = [
      { id: 'CG', position: { x: 0, y: 0 }, data: { definition: 'block', block: CHARGEN_SCAN } },
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
    const bit = (p: string) => (r.value('CG', p) === true ? 1 : 0)
    return {
      dot: bit('dot0') + 2 * bit('dot1') + 4 * bit('dot2'),
      char: bit('char0') + 2 * bit('char1') + 4 * bit('char2') + 8 * bit('char3'),
      line: bit('line0') + 2 * bit('line1') + 4 * bit('line2'),
      settled: r.settled,
    }
  }
  // one pixel clock = a CLK-low solve then a CLK-high solve (one master-slave edge)
  const tick = (clr = false): Count => {
    solve(false, clr)
    return solve(true, clr)
  }
  tick(true) // synchronous clear → a deterministic 0,0,0 power-up
  return { tick }
}

describe('char-gen scan counters (step 3)', () => {
  test('CLR loads a deterministic zero', () => {
    const { tick } = makeScan()
    // makeScan already cleared; assert the next state still starts the count from 0.
    expect(tick()).toMatchObject({ dot: 1, char: 0, line: 0, settled: true })
  })

  test('DOT increments every clock and wraps mod 8 — and the logic always settles', () => {
    const { tick } = makeScan()
    for (let n = 1; n <= 20; n++) {
      const r = tick()
      expect(r.settled).toBe(true)
      expect(r.dot).toBe(n % 8)
    }
  })

  test('CHAR advances once per 8 dots (synchronous carry), wrapping mod 16', () => {
    const { tick } = makeScan()
    let r: Count = { dot: 0, char: 0, line: 0, settled: true }
    for (let n = 1; n <= 80; n++) {
      r = tick()
      expect(r.char).toBe(Math.floor(n / 8) % 16)
    }
  })

  test('LINE advances once per full scanline (128 dots), all three locked together', () => {
    const { tick } = makeScan()
    let r: Count = { dot: 0, char: 0, line: 0, settled: true }
    for (let n = 1; n <= 130; n++) r = tick()
    // 130 = 1·128 + 2: dot back to 2, char wrapped to 0, line stepped to 1.
    expect(r).toMatchObject({
      dot: 130 % 8,
      char: Math.floor(130 / 8) % 16,
      line: 1,
      settled: true,
    })
    expect(r.char).toBe(0)
  })
})
