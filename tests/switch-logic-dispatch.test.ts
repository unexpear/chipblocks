/**
 * A switch drives a logic input through the REAL solve dispatch (solveCanvasDispatch) — not just the
 * bare logic engine. A switch carries no analog load of its own, so a canvas of {gates + switches +
 * rails} must classify as 'logic' (fast engine, which conducts a closed switch), NOT 'mixed'. Before
 * this, the switch pushed the canvas onto the co-sim path and the gate read its input as undriven — a
 * flipped switch did nothing (a dead keypad). Guards partition.ts keeping switches in ANALOG_PASSIVE.
 */
import { describe, expect, test } from 'vitest'
import { BUFFER_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { defaultParameters } from '../src/renderer/part-defaults.ts'
import { classifyCanvas } from '../src/renderer/pipeline/partition.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'

const V = (v: number) => ({
  ...defaultParameters('power_source'),
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
})
// biome-ignore lint/suspicious/noExplicitAny: React Flow node/edge shapes, minimal for the solve
const build = (state: 'closed' | 'open'): { nodes: any[]; edges: any[] } => ({
  nodes: [
    {
      id: 'sw',
      type: 'device',
      position: { x: 0, y: 0 },
      data: {
        definition: 'switch_spst_toggle',
        parameters: { ...defaultParameters('switch_spst_toggle'), state: { value: state } },
      },
    },
    {
      id: 'B',
      type: 'block',
      position: { x: 0, y: 0 },
      data: { definition: 'block', block: BUFFER_BLOCK },
    },
    {
      id: 'vp',
      type: 'device',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: V(5) },
    },
    {
      id: 'g',
      type: 'device',
      position: { x: 0, y: 0 },
      data: { definition: 'ground', parameters: defaultParameters('ground') },
    },
  ],
  edges: [
    {
      id: 'e1',
      type: 'net',
      source: 'vp',
      sourceHandle: 'terminal_positive',
      target: 'sw',
      targetHandle: 'terminal_in',
    },
    {
      id: 'e2',
      type: 'net',
      source: 'sw',
      sourceHandle: 'terminal_out',
      target: 'B',
      targetHandle: 'in',
    },
    {
      id: 'ep',
      type: 'net',
      source: 'vp',
      sourceHandle: 'terminal_positive',
      target: 'B',
      targetHandle: 'v_dd',
    },
    {
      id: 'eg',
      type: 'net',
      source: 'B',
      sourceHandle: 'gnd',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
    {
      id: 'vpn',
      type: 'net',
      source: 'vp',
      sourceHandle: 'terminal_negative',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
  ],
})

describe('a switch drives a logic input through the solve dispatch', () => {
  test('gates + switches + rails classify as logic, not mixed', () => {
    expect(classifyCanvas(build('closed').nodes)).toBe('logic')
  })

  test('a CLOSED switch drives the gate HIGH; an OPEN one leaves it LOW', () => {
    const closed = solveCanvasDispatch(build('closed').nodes, build('closed').edges)
    const open = solveCanvasDispatch(build('open').nodes, build('open').edges)
    // The buffer output follows its input: closed switch → V+ reaches the input → HIGH.
    expect(closed.terminalVolts.get('B/out')).toBeGreaterThan(4)
    expect(open.terminalVolts.get('B/out') ?? 0).toBeLessThan(1)
  })
})
