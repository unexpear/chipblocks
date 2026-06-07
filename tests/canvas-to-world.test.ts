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
import { canvasEdgeFlow } from '../src/renderer/edge-currents.ts'

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
    // 9 V across 100 Ω + the battery's 1 Ω internal resistance → ~89.1 mA
    expect(Math.abs(solution.branches.get('r1') ?? -1)).toBeCloseTo(0.0891, 4)
  })

  test('the battery’s internal resistance limits the current (a near-short isn’t infinite)', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
      },
      { id: 'short', definition: 'resistor', parameters: { resistance: scalar(0.001, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'short',
        targetHandle: 'terminal_a',
      },
      {
        source: 'short',
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
    const solution = solveDC(canvasToWorld(nodes, edges))
    expect(solution.status).toBe('solved')
    // Limited to ~9 A by the 1 Ω internal resistance (9 V / (1 + 0.001) Ω). An
    // ideal source would compute a runaway current into the near-short.
    expect(Math.abs(solution.branches.get('short') ?? 0)).toBeCloseTo(9 / 1.001, 4)
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

  test('an open switch breaks the circuit; closed conducts (state drives the solve)', () => {
    const make = (state: string): CanvasNode[] => [
      { id: 'bat', definition: 'power_source', parameters: { nominal_voltage: scalar(9, 'volt') } },
      { id: 'sw', definition: 'switch_spst_toggle', parameters: { state: { value: state } } },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'sw',
        targetHandle: 'terminal_in',
      },
      { source: 'sw', sourceHandle: 'terminal_out', target: 'r1', targetHandle: 'terminal_a' },
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

    const closed = solveDC(canvasToWorld(make('closed'), edges))
    expect(closed.status).toBe('solved')
    expect(Math.abs(closed.branches.get('r1') ?? 0)).toBeCloseTo(0.09, 6) // 9 V / 100 Ω

    const open = solveDC(canvasToWorld(make('open'), edges))
    expect(Math.abs(open.branches.get('r1') ?? 0)).toBeCloseTo(0, 6) // open → no current
  })

  test('canvasEdgeFlow reads per-wire current: loop wires carry, the ground tap does not', () => {
    const nodes: CanvasNode[] = [
      { id: 'bat', definition: 'power_source', parameters: { nominal_voltage: scalar(9, 'volt') } },
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
    const solution = solveDC(canvasToWorld(nodes, edges))

    // Both loop wires carry 90 mA (9 V / 100 Ω), flowing source → target.
    const supply = canvasEdgeFlow(solution, 'bat', 'terminal_positive', 'terminal_a')
    expect(supply.carries).toBe(true)
    expect(supply.amps).toBeCloseTo(0.09, 6)
    expect(supply.sourceToTarget).toBe(true) // battery → resistor

    const ret = canvasEdgeFlow(solution, 'r1', 'terminal_b', 'terminal_negative')
    expect(ret.carries).toBe(true)
    expect(ret.amps).toBeCloseTo(0.09, 6)
    expect(ret.sourceToTarget).toBe(true) // resistor → battery

    // The ground stem is a reference tap — no series current, no arrow.
    const tap = canvasEdgeFlow(solution, 'gnd', 'reference_terminal', 'terminal_negative')
    expect(tap.carries).toBe(false)
    expect(tap.amps).toBe(0)
  })
})
