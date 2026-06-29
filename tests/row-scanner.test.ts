/**
 * The ROW SCANNER is a REAL clocked digital circuit — a synchronous up-counter feeding a binary→one-hot
 * decoder — not a loop in code. A synchronous CLR loads row 0; then every rising clock edge advances the
 * counter, and the decoder drives EXACTLY one row line high: 0,1,2,…,7, wrap to 0. That one-row-at-a-time
 * output is what a multiplexed matrix scans, and the "exactly one high" invariant is what keeps a passive
 * matrix free of sneak-path ghosting. Verified through the fast logic engine (compileLogic + stepLogic),
 * the same path the live app clocks sequential blocks on.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { ROW_SCANNER_8 } from '../src/renderer/builtin-blocks.ts'
import { compileLogic, stepLogic } from '../src/renderer/logic-sim.ts'

const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
})
const src = (id: string, v: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(v) },
})
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

const nodes: CanvasNodeLike[] = [
  { id: 'scan', position: { x: 0, y: 0 }, data: { definition: 'block', block: ROW_SCANNER_8 } },
  src('vp', 5),
  src('clk', 0),
  src('clr', 0),
  { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
]
const edges: CanvasEdgeLike[] = [
  w('e_clk', 'clk', 'terminal_positive', 'scan', 'clk'),
  w('e_clkn', 'clk', 'terminal_negative', 'g', 'reference_terminal'),
  w('e_clr', 'clr', 'terminal_positive', 'scan', 'clr'),
  w('e_clrn', 'clr', 'terminal_negative', 'g', 'reference_terminal'),
  w('e_vp', 'vp', 'terminal_positive', 'scan', 'v_dd'),
  w('e_vpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
  w('e_g', 'scan', 'gnd', 'g', 'reference_terminal'),
]

/** The single high row (or -1 if not exactly one is high — a ghosting failure). */
function activeRow(r: ReturnType<typeof stepLogic>): number {
  let hi = -1
  let count = 0
  for (let i = 0; i < 8; i++)
    if (r.value('scan', `row_${i}`) === true) {
      hi = i
      count++
    }
  return count === 1 ? hi : -1
}

describe('row scanner — a real clocked counter + one-hot decoder cycles the rows', () => {
  const fresh = () => {
    const compiled = compileLogic(nodes, edges)
    const state = new Map<string, boolean>()
    return (clk: boolean, clr: boolean) =>
      stepLogic(
        compiled,
        new Map<string, boolean>([
          ['clk', clk],
          ['clr', clr],
        ]),
        state,
      )
  }

  test('CLR loads row 0, then each clock advances one-hot through all 8 rows and wraps', () => {
    const step = fresh()
    step(false, true) // synchronous clear: hold CLR, then a rising edge loads row 0
    expect(activeRow(step(true, true))).toBe(0)
    const seq: number[] = []
    for (let i = 0; i < 8; i++) {
      step(false, false)
      seq.push(activeRow(step(true, false))) // each rising edge advances one row
    }
    expect(seq).toEqual([1, 2, 3, 4, 5, 6, 7, 0]) // count up, then wrap
  })

  test('exactly one row is ever high — the no-ghosting invariant, across many ticks', () => {
    const step = fresh()
    step(false, true)
    step(true, true)
    for (let i = 0; i < 20; i++) {
      step(false, false)
      const r = step(true, false)
      const high = Array.from({ length: 8 }, (_, k) => k).filter(
        (k) => r.value('scan', `row_${k}`) === true,
      )
      expect(high.length).toBe(1)
    }
  })
})
