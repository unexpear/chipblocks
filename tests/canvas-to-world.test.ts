/**
 * canvas-to-world tests (S19-v3-21) — the live re-solve's verifiable core.
 *
 * Build a circuit purely from canvas nodes + wires, turn it into a World, and
 * SOLVE it: a battery + resistor + ground loop must obey Ohm's law. This proves
 * a dropped-and-wired (or edited) part really drives the physics.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

describe('canvasToWorld', () => {
  test('a canvas-built battery + resistor + ground loop solves to Ohm’s law', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      {
        source: 'r1',
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

    const world = canvasToWorld(nodes, edges)
    expect(world.instances.size).toBe(3)
    expect(world.nets.size).toBe(2) // {bat+,r1.a} and {r1.b, bat-, gnd}

    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(solution.ground).toBeDefined()
    // 9 V across 100 Ω → 90 mA (the solver treats the source as ideal)
    expect(Math.abs(solution.branches.get('r1') ?? -1)).toBeCloseTo(0.09, 6)
  })

  test('editing the resistance changes the solved current', () => {
    const make = (ohms: number): CanvasNode[] => [
      { id: 'bat', definition: 'power_source', parameters: { nominal_voltage: scalar(9, 'volt') } },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(ohms, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      {
        source: 'r1',
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
    const at100 = solveDC(canvasToWorld(make(100), edges)).branches.get('r1') ?? 0
    const at1000 = solveDC(canvasToWorld(make(1000), edges)).branches.get('r1') ?? 0
    expect(Math.abs(at100)).toBeCloseTo(0.09, 6)
    expect(Math.abs(at1000)).toBeCloseTo(0.009, 6) // 10× resistance → 1/10 current
  })

  test('wires sharing a terminal merge into one net (a 3-way junction)', () => {
    const nodes: CanvasNode[] = [
      { id: 'a', definition: 'resistor' },
      { id: 'b', definition: 'resistor' },
      { id: 'c', definition: 'resistor' },
    ]
    // a.b ↔ b.a, and b.a ↔ c.a — all three share one electrical node
    const edges = [
      { source: 'a', sourceHandle: 'terminal_b', target: 'b', targetHandle: 'terminal_a' },
      { source: 'b', sourceHandle: 'terminal_a', target: 'c', targetHandle: 'terminal_a' },
    ]
    const world = canvasToWorld(nodes, edges)
    expect(world.nets.size).toBe(1)
    const net = [...world.nets.values()][0]
    expect(net?.members.length).toBe(3)
  })

  test('an unwired part still becomes an instance (floating, no nets)', () => {
    const world = canvasToWorld([{ id: 'r1', definition: 'resistor' }], [])
    expect(world.instances.size).toBe(1)
    expect(world.nets.size).toBe(0)
  })
})
