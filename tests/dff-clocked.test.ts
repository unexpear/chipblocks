/**
 * Stage 0 of the REAL control-unit build (the calculator's sequencer-as-real-circuit): prove the FAST
 * logic engine reproduces an EDGE-triggered capture on the master-slave D flip-flop — not just the slow
 * transient/.ic path (logic-gates.test.ts). With one persistent state map threaded through simulateLogic,
 * a CLK-LOW solve makes the master transparent (it grabs D) and the next CLK-HIGH solve makes the slave
 * pass it to Q. So one rising edge = a low solve then a high solve, and D is IGNORED while the clock is
 * steady. This is the load-bearing assumption the whole gate-FSM rests on; if it fails, the plan changes.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { D_FLIPFLOP_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const supply = (volts: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
})
const src = (id: string, volts: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(volts) },
})

describe('D flip-flop on the fast logic engine — edge-triggered capture across solves', () => {
  // ONE state map, persisted across the whole clock sequence — the flip-flop's memory.
  const state = new Map<string, boolean>()
  const step = (d: boolean, clk: boolean): boolean | undefined => {
    const nodes: CanvasNodeLike[] = [
      {
        id: 'FF',
        position: { x: 0, y: 0 },
        data: { definition: 'block', block: D_FLIPFLOP_BLOCK },
      },
      { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
      src('vd', d ? 5 : 0),
      src('vc', clk ? 5 : 0),
      src('vp', 5),
    ]
    const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
      id,
      source: s,
      sourceHandle: sh,
      target: t,
      targetHandle: th,
    })
    const edges: CanvasEdgeLike[] = [
      w('ed', 'vd', 'terminal_positive', 'FF', 'd'),
      w('ec', 'vc', 'terminal_positive', 'FF', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'FF', 'v_dd'),
      w('eg', 'FF', 'gnd', 'g', 'reference_terminal'),
      w('edn', 'vd', 'terminal_negative', 'g', 'reference_terminal'),
      w('ecn', 'vc', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    return simulateLogic(nodes, edges, state).value('FF', 'q')
  }
  // One rising edge: a CLK-LOW solve (master grabs D) then a CLK-HIGH solve (slave drives Q).
  const clockIn = (d: boolean): boolean | undefined => {
    step(d, false)
    return step(d, true)
  }

  test('Q captures D on each rising edge and ignores D while the clock is steady', () => {
    expect(clockIn(true)).toBe(true) // edge 1 → Q = 1
    expect(step(false, true)).toBe(true) // D=0 while CLK stays HIGH → Q holds 1 (edge-, not level-, triggered)
    expect(step(true, false)).toBe(true) // CLK falls (master grabs 1) → Q holds 1
    expect(clockIn(false)).toBe(false) // edge 2 → Q = 0
    expect(step(true, true)).toBe(false) // D=1 while CLK stays HIGH → Q holds 0
    expect(clockIn(true)).toBe(true) // edge 3 → Q = 1
    expect(clockIn(false)).toBe(false) // edge 4 → Q = 0
  })
})
