/**
 * Sequential logic (complexity-layer): the logic engine holds state across solves. An SR latch is the
 * basic one-bit memory — cross-coupled NORs that HOLD their value when neither input is asserted. With a
 * persistent state map threaded through simulateLogic, the latch sets, holds, resets, and holds again —
 * exactly a stored bit. (Without the state, a latch's feedback never starts and Q reads undefined.)
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { SR_LATCH_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const supply = (volts: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
})
const src = (id: string, volts: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(volts) },
})

describe('sequential logic — an SR latch holds state across solves', () => {
  // ONE state map, persisted across the whole sequence — the latch's memory.
  const state = new Map<string, boolean>()
  const step = (sHigh: boolean, rHigh: boolean): boolean | undefined => {
    const nodes: CanvasNodeLike[] = [
      { id: 'L', position: { x: 0, y: 0 }, data: { definition: 'block', block: SR_LATCH_BLOCK } },
      { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
      src('vs', sHigh ? 5 : 0),
      src('vr', rHigh ? 5 : 0),
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
      w('es', 'vs', 'terminal_positive', 'L', 's'),
      w('er', 'vr', 'terminal_positive', 'L', 'r'),
      w('ep', 'vp', 'terminal_positive', 'L', 'v_dd'),
      w('eg', 'L', 'gnd', 'g', 'reference_terminal'),
      w('esn', 'vs', 'terminal_negative', 'g', 'reference_terminal'),
      w('ern', 'vr', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    return simulateLogic(nodes, edges, state).value('L', 'q')
  }

  test('set → hold → reset → hold', () => {
    expect(step(true, false)).toBe(true) // SET: S=1, R=0 → Q=1
    expect(step(false, false)).toBe(true) // HOLD: S=0, R=0 → Q stays 1
    expect(step(false, true)).toBe(false) // RESET: S=0, R=1 → Q=0
    expect(step(false, false)).toBe(false) // HOLD: S=0, R=0 → Q stays 0
  })
})
