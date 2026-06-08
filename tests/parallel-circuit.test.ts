/**
 * Parallel-topology tests (S19-v3-33 diagnosis) — does the resistive-wire net
 * model (each wire a real element between per-connection-point nets) still solve
 * parallel circuits? Two 100 Ω resistors across 9 V must each draw 90 mA.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

describe('canvasToWorld — parallel', () => {
  const nodes: CanvasNode[] = [
    { id: 'bat', definition: 'power_source', parameters: { nominal_voltage: scalar(9, 'volt') } },
    { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
    { id: 'r2', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]

  test('two resistors wired in parallel off shared handles each draw 90 mA', () => {
    // Both resistors hang off the battery's + terminal and return to its − terminal
    // (the natural "parallel" wiring: two wires from one handle).
    const edges = [
      {
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      {
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'r2',
        targetHandle: 'terminal_a',
      },
      {
        source: 'r1',
        sourceHandle: 'terminal_b',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
      {
        source: 'r2',
        sourceHandle: 'terminal_b',
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
    const sol = solveDC(canvasToWorld(nodes, edges))
    expect(sol.status).toBe('solved')
    expect(Math.abs(sol.branches.get('r1') ?? 0)).toBeCloseTo(0.09, 4)
    expect(Math.abs(sol.branches.get('r2') ?? 0)).toBeCloseTo(0.09, 4)
    // The battery sources the sum, 180 mA.
    expect(Math.abs(sol.branches.get('bat') ?? 0)).toBeCloseTo(0.18, 4)
  })

  test('parallel wired as a chain (r1.a → r2.a, r1.b → r2.b) also each draw 90 mA', () => {
    // The other natural way: chain the two resistors' like-terminals together.
    const edges = [
      {
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      { source: 'r1', sourceHandle: 'terminal_a', target: 'r2', targetHandle: 'terminal_a' },
      { source: 'r1', sourceHandle: 'terminal_b', target: 'r2', targetHandle: 'terminal_b' },
      {
        source: 'r2',
        sourceHandle: 'terminal_b',
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
    const sol = solveDC(canvasToWorld(nodes, edges))
    expect(sol.status).toBe('solved')
    expect(Math.abs(sol.branches.get('r1') ?? 0)).toBeCloseTo(0.09, 4)
    expect(Math.abs(sol.branches.get('r2') ?? 0)).toBeCloseTo(0.09, 4)
  })

  test('three LEDs in parallel across 9 V all conduct (the reported case)', () => {
    const led = () => ({
      forward_voltage: scalar(2, 'volt'),
      max_forward_current: scalar(0.02, 'ampere'),
    })
    const ledNodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
      },
      { id: 'd1', definition: 'led', parameters: led() },
      { id: 'd2', definition: 'led', parameters: led() },
      { id: 'd3', definition: 'led', parameters: led() },
      { id: 'gnd', definition: 'ground' },
    ]
    const ledEdges = [
      { source: 'bat', sourceHandle: 'terminal_positive', target: 'd1', targetHandle: 'anode' },
      { source: 'bat', sourceHandle: 'terminal_positive', target: 'd2', targetHandle: 'anode' },
      { source: 'bat', sourceHandle: 'terminal_positive', target: 'd3', targetHandle: 'anode' },
      { source: 'd1', sourceHandle: 'cathode', target: 'bat', targetHandle: 'terminal_negative' },
      { source: 'd2', sourceHandle: 'cathode', target: 'bat', targetHandle: 'terminal_negative' },
      { source: 'd3', sourceHandle: 'cathode', target: 'bat', targetHandle: 'terminal_negative' },
      {
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
    ]
    const sol = solveDC(canvasToWorld(ledNodes, ledEdges))
    expect(sol.status).toBe('solved')
    // No resistor → overdriven, but every parallel LED must carry real current.
    expect(Math.abs(sol.branches.get('d1') ?? 0)).toBeGreaterThan(0.02)
    expect(Math.abs(sol.branches.get('d2') ?? 0)).toBeGreaterThan(0.02)
    expect(Math.abs(sol.branches.get('d3') ?? 0)).toBeGreaterThan(0.02)
  })
})
