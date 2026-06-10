/**
 * canvas-to-world tests (S19-v3-21) — the live re-solve's verifiable core.
 *
 * Build a circuit purely from canvas nodes + wires, turn it into a World, and
 * SOLVE it: a battery + resistor + ground loop must obey Ohm's law. This proves
 * a dropped-and-wired (or edited) part really drives the physics.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import {
  type CanvasNode,
  canvasToWorld,
  groundedComponent,
} from '../src/renderer/canvas-to-world.ts'
import { wireFlow } from '../src/renderer/edge-currents.ts'

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
    // 3 components + 3 wires — each edge is now a real 2-terminal wire element.
    expect(world.instances.size).toBe(6)
    // One net per connection point; bat− is shared by the return + ground wires.
    expect(world.nets.size).toBe(5)

    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(solution.ground).toBeDefined()
    // Bare edges carry no resistance → ideal wires → identical physics: 9 V across
    // 100 Ω + the battery's 1 Ω internal resistance → ~89.1 mA.
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

  test('wires sharing a terminal meet at that terminal’s net (a junction)', () => {
    const nodes: CanvasNode[] = [
      { id: 'a', definition: 'resistor' },
      { id: 'b', definition: 'resistor' },
      { id: 'c', definition: 'resistor' },
    ]
    // a.b → b.a, and b.a → c.a: both wires attach to b.terminal_a — the junction.
    const edges = [
      { source: 'a', sourceHandle: 'terminal_b', target: 'b', targetHandle: 'terminal_a' },
      { source: 'b', sourceHandle: 'terminal_a', target: 'c', targetHandle: 'terminal_a' },
    ]
    const world = canvasToWorld(nodes, edges)
    // 3 connection points (a.b, b.a, c.a) → 3 nets; 2 wires bridge them.
    expect(world.nets.size).toBe(3)
    expect([...world.instances.values()].filter((i) => i.definition === 'wire')).toHaveLength(2)
    // The shared b.terminal_a net holds b's terminal plus both wires' ends.
    const junction = [...world.nets.values()].find((n) =>
      n.members.some((m) => m.instance === 'b' && m.terminal === 'terminal_a'),
    )
    expect(junction?.members).toHaveLength(3)
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

  test('each wire carries its own solved current: loop wires carry, the ground tap does not', () => {
    const nodes: CanvasNode[] = [
      { id: 'bat', definition: 'power_source', parameters: { nominal_voltage: scalar(9, 'volt') } },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    // wire_1 = bat→r1, wire_2 = r1→bat, wire_3 = gnd→bat (named by edge order).
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

    // Both loop wires carry 90 mA (9 V / 100 Ω), flowing source → target. The
    // source endpoint is wired to the wire's terminal_a, so sourceOnPositiveSide.
    const supply = wireFlow(solution, 'wire_1', true)
    expect(supply.carries).toBe(true)
    expect(supply.amps).toBeCloseTo(0.09, 6)
    expect(supply.sourceToTarget).toBe(true) // battery → resistor

    const ret = wireFlow(solution, 'wire_2', true)
    expect(ret.carries).toBe(true)
    expect(ret.amps).toBeCloseTo(0.09, 6)
    expect(ret.sourceToTarget).toBe(true) // resistor → battery

    // The ground stem is a reference tap — no series current, no arrow. This now
    // falls out of the physics (its wire's branch current is 0), not a special case.
    const tap = wireFlow(solution, 'wire_3', true)
    expect(tap.carries).toBe(false)
    expect(tap.amps).toBeCloseTo(0, 9)
  })
})

describe('junctions (S19-v3-61)', () => {
  test('a junction is a pure tie point — wires meeting there share one net, no element is stamped', () => {
    // bat+ —wire— J —wire— r1.a, r1.b —wire— bat− (grounded). Same Ohm's-law
    // loop as above but routed THROUGH a junction dot.
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
      },
      { id: 'j1', definition: 'junction' },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      { source: 'bat', sourceHandle: 'terminal_positive', target: 'j1', targetHandle: 'tie' },
      { source: 'j1', sourceHandle: 'tie', target: 'r1', targetHandle: 'terminal_a' },
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
    expect(world.instances.has('j1')).toBe(false) // no element for the dot
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    // The full loop current flows THROUGH the junction: both wires touching it
    // carry the same ~89.1 mA the direct wiring carries.
    expect(Math.abs(solution.branches.get('r1') ?? -1)).toBeCloseTo(0.0891, 4)
    const intoJunction = wireFlow(solution, 'wire_1', true)
    const outOfJunction = wireFlow(solution, 'wire_2', true)
    expect(intoJunction.carries).toBe(true)
    expect(outOfJunction.carries).toBe(true)
    expect(Math.abs(intoJunction.amps - outOfJunction.amps)).toBeLessThan(1e-9)
  })
})

describe('groundedComponent (S19-v3-61)', () => {
  test('a free-floating section is excluded so the main circuit still solves', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
      // A wire drawn between two free junctions — connected to nothing else.
      { id: 'j1', definition: 'junction' },
      { id: 'j2', definition: 'junction' },
    ]
    const edges = [
      {
        id: 'main1',
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      {
        id: 'main2',
        source: 'r1',
        sourceHandle: 'terminal_b',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'main3',
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'float',
        source: 'j1',
        sourceHandle: 'tie',
        target: 'j2',
        targetHandle: 'tie',
        resistanceOhms: 0.05,
      },
    ]
    const full = canvasToWorld(nodes, edges)
    expect(full.instances.has('wire_float')).toBe(true) // it IS in the world…
    const pruned = groundedComponent(full)
    expect(pruned.instances.has('wire_float')).toBe(false) // …but not in the solve
    expect(pruned.instances.has('r1')).toBe(true)
    const solution = solveDC(pruned)
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('r1') ?? -1)).toBeCloseTo(0.0891, 4)
  })

  test('with no ground anywhere the world passes through unchanged', () => {
    const nodes: CanvasNode[] = [
      { id: 'j1', definition: 'junction' },
      { id: 'j2', definition: 'junction' },
    ]
    const edges = [{ source: 'j1', sourceHandle: 'tie', target: 'j2', targetHandle: 'tie' }]
    const world = canvasToWorld(nodes, edges)
    expect(groundedComponent(world)).toBe(world)
  })
})
