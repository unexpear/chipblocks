/**
 * Math-view tests (S19-v3-63) — the "show me the math" panel must display the
 * SAME numbers the solver produced, with every KCL sum genuinely re-computed
 * (the checkmark is earned, never assumed). Built on canvas-built circuits
 * whose answers are known exactly.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { buildMathView } from '../src/renderer/math-view.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

function ohmLawCircuit() {
  const nodes: CanvasNode[] = [
    {
      id: 'bat',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
    },
    { id: 'sw', definition: 'switch_spst_toggle' },
    { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'bat', sourceHandle: 'terminal_positive', target: 'sw', targetHandle: 'terminal_in' },
    { source: 'sw', sourceHandle: 'terminal_out', target: 'r1', targetHandle: 'terminal_a' },
    { source: 'r1', sourceHandle: 'terminal_b', target: 'bat', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'bat',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

describe('buildMathView', () => {
  test('the solver section names the real method and the real iteration count', () => {
    const world = ohmLawCircuit()
    const view = buildMathView(world, solveDC(world))
    expect(view.solver.join(' ')).toContain('Modified Nodal Analysis')
    expect(view.solver.join(' ')).toContain('Newton–Raphson')
    expect(view.solver.join(' ')).toContain('converged: yes')
  })

  test('the resistor card shows Ohm’s law with the actual solved numbers', () => {
    const world = ohmLawCircuit()
    const view = buildMathView(world, solveDC(world))
    const resistor = view.parts.find((p) => p.id === 'r1')
    expect(resistor).toBeDefined()
    const text = resistor?.lines.join(' ') ?? ''
    // 9 V across 100 Ω + 1 Ω internal → 89.1 mA; V = I·R ≈ 8.91 V; P ≈ 794 mW.
    expect(text).toContain('V = I·R')
    expect(text).toContain('89.1 mA')
    expect(text).toContain('8.91 V')
    expect(text).toContain('794 mW')
  })

  test('the source card computes its terminal voltage from EMF − I·r', () => {
    const world = ohmLawCircuit()
    const view = buildMathView(world, solveDC(world))
    const text = view.parts.find((p) => p.id === 'bat')?.lines.join(' ') ?? ''
    expect(text).toContain('V_terminal')
    expect(text).toContain('= 8.91 V') // 9 − 0.0891×1
  })

  test('every net’s KCL sum is genuinely re-computed and balances', () => {
    const world = ohmLawCircuit()
    const view = buildMathView(world, solveDC(world))
    expect(view.nets.length).toBeGreaterThan(2)
    for (const net of view.nets) {
      expect(net.sumAmps).not.toBeNull()
      expect(Math.abs(net.sumAmps ?? 1)).toBeLessThan(1e-9)
    }
  })

  test('an LED card shows the Shockley calibration and the solved operating point', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
      {
        id: 'led1',
        definition: 'led',
        parameters: {
          forward_voltage: scalar(2, 'volt'),
          max_forward_current: scalar(0.02, 'ampere'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      { source: 'r1', sourceHandle: 'terminal_b', target: 'led1', targetHandle: 'anode' },
      {
        source: 'led1',
        sourceHandle: 'cathode',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
      {
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
    ]
    const world = canvasToWorld(nodes, edges)
    const view = buildMathView(world, solveDC(world))
    const text = view.parts.find((p) => p.id === 'led1')?.lines.join(' ') ?? ''
    expect(text).toContain('Shockley')
    expect(text).toContain('I_S =')
    expect(text).toContain('14.9 mA') // the canonical anchor operating point
    // The KCL section must balance across the LED's nets too — this exercises
    // the anode/cathode sign convention for real.
    for (const net of view.nets) {
      expect(Math.abs(net.sumAmps ?? 1)).toBeLessThan(1e-9)
    }
  })

  test('an unsolved circuit reports honestly instead of showing stale math', () => {
    const world = ohmLawCircuit()
    world.nets.delete(
      [...world.nets.keys()].find((id) => world.nets.get(id)?.type === 'ground') ?? '',
    )
    const view = buildMathView(world, solveDC(world))
    expect(view.solver.join(' ')).toContain('no-ground')
    expect(view.parts.length).toBe(0)
  })
})
