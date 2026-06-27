/**
 * Stage 1 of the REAL control-unit build: a CLOSED real switch CONDUCTS a logic level in the fast engine,
 * an OPEN one doesn't — the prerequisite for a keypad of real momentary switches driving the control
 * unit. Before this the engine passed nothing through a switch (it only drove nets from sources/ground),
 * so a real-switch keypad read as dead. simulateLogic now unions a closed switch's two terminals.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { BUFFER_BLOCK } from '../src/renderer/builtin-blocks.ts'
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

const sw = (closed: boolean): CanvasNodeLike => ({
  id: 'sw',
  position: { x: 0, y: 0 },
  data: {
    definition: 'switch_spst_momentary',
    parameters: { state: { value: closed ? 'closed' : 'open' } },
  },
})

describe('switch conduction in the logic engine — a closed switch passes a level', () => {
  // V+ → switch.in; read switch.out directly. Closed: the terminals are one net, so out is HIGH. Open:
  // out is its own isolated, undriven net (an open circuit).
  const readSwitchOut = (closed: boolean): boolean | undefined => {
    const nodes: CanvasNodeLike[] = [
      sw(closed),
      src('vp', 5),
      { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    ]
    const edges: CanvasEdgeLike[] = [
      w('e1', 'vp', 'terminal_positive', 'sw', 'terminal_in'),
      w('vpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    return simulateLogic(nodes, edges).value('sw', 'terminal_out')
  }

  // The real use: V+ → closed switch → a gate input drives the gate.
  const driveGateThroughClosedSwitch = (): boolean | undefined => {
    const nodes: CanvasNodeLike[] = [
      sw(true),
      { id: 'B', position: { x: 0, y: 0 }, data: { definition: 'block', block: BUFFER_BLOCK } },
      src('vp', 5),
      { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    ]
    const edges: CanvasEdgeLike[] = [
      w('e1', 'vp', 'terminal_positive', 'sw', 'terminal_in'),
      w('e2', 'sw', 'terminal_out', 'B', 'in'),
      w('ep', 'vp', 'terminal_positive', 'B', 'v_dd'),
      w('eg', 'B', 'gnd', 'g', 'reference_terminal'),
      w('vpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    return simulateLogic(nodes, edges).value('B', 'out')
  }

  test('a closed switch conducts the level to its other terminal; an open one does not', () => {
    expect(readSwitchOut(true)).toBe(true) // closed → V+ reaches terminal_out
    expect(readSwitchOut(false)).toBe(undefined) // open → terminal_out is an isolated, undriven net
  })

  test('a closed switch drives a downstream gate HIGH (the keypad use)', () => {
    expect(driveGateThroughClosedSwitch()).toBe(true)
  })
})
