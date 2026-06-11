/**
 * Multi-lead source tests (S19-v3-74) — a source with N leads expands into
 * what it physically is: (N−1) real two-lead sections with junctions at the
 * seams (N ≥ 3), a ground-bonded rail lead (N = 1), or itself (N = 2). The
 * headline check is SOLVER-LEVEL: tap voltages land exactly where a stack of
 * real cells puts them.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { expandMultiLeadSources, multiLeadAliases } from '../src/renderer/multi-tap-source.ts'
import { sourceTerminalCount, sourceTerminalIds } from '../src/renderer/part-defaults.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const sourceNode = (id: string, count: number, volts = 9): CanvasNodeLike => ({
  id,
  type: 'device',
  position: { x: 100, y: 100 },
  data: {
    definition: 'power_source',
    parameters: {
      nominal_voltage: scalar(volts, 'volt'),
      internal_resistance: scalar(0, 'ohm'),
      terminal_count: scalar(count, 'count'),
    },
  },
})

describe('lead naming + count clamping', () => {
  test('the one naming scheme: +, taps in stack order, −', () => {
    expect(sourceTerminalIds(1)).toEqual(['terminal_positive'])
    expect(sourceTerminalIds(2)).toEqual(['terminal_positive', 'terminal_negative'])
    expect(sourceTerminalIds(4)).toEqual([
      'terminal_positive',
      'tap_1',
      'tap_2',
      'terminal_negative',
    ])
  })
  test('count clamps to the real 1–6 range and defaults to 2', () => {
    expect(sourceTerminalCount(undefined)).toBe(2)
    expect(sourceTerminalCount({ terminal_count: scalar(0, 'count') })).toBe(1)
    expect(sourceTerminalCount({ terminal_count: scalar(99, 'count') })).toBe(6)
    expect(sourceTerminalCount({ terminal_count: scalar(3.4, 'count') })).toBe(3)
  })
})

describe('expandMultiLeadSources — structure', () => {
  test('a plain two-lead source passes through untouched', () => {
    const node = sourceNode('bat', 2)
    const out = expandMultiLeadSources([node], [])
    expect(out.nodes).toEqual([node])
    expect(out.aliases).toEqual([])
  })

  test('N = 3 becomes two real sections joined at one tap junction', () => {
    const out = expandMultiLeadSources([sourceNode('bat', 3)], [])
    const ids = out.nodes.map((n) => n.id).sort()
    expect(ids).toEqual(['bat.sec1', 'bat.sec2', 'bat.tap1'])
    // sections are plain two-lead sources — terminal_count removed, spec kept
    const sec = out.nodes.find((n) => n.id === 'bat.sec1')
    expect(sec?.data.parameters?.terminal_count).toBeUndefined()
    expect(
      (sec?.data.parameters?.nominal_voltage as { value: { amount: number } }).value.amount,
    ).toBe(9)
    // the seams are internal bonds (zero-length inside the pack)
    const seams = out.edges.filter((e) => e.data?.internalBond === true)
    expect(seams.length).toBe(2)
    // user-facing leads re-home onto the real terminals
    expect(out.aliases).toContainEqual({
      outer: 'bat/terminal_positive',
      inner: 'bat.sec1/terminal_positive',
    })
    // The tap probe lands on the section terminal at the same zero-ohm seam
    // (the junction itself is a tie point, not a world instance).
    expect(out.aliases).toContainEqual({ outer: 'bat/tap_1', inner: 'bat.sec1/terminal_negative' })
    expect(multiLeadAliases([sourceNode('bat', 3)])).toEqual(out.aliases)
  })

  test('user wires onto the leads are re-pointed at the expansion', () => {
    const edges: CanvasEdgeLike[] = [
      { id: 'w1', source: 'bat', sourceHandle: 'tap_1', target: 'r1', targetHandle: 'terminal_a' },
      {
        id: 'w2',
        source: 'r1',
        sourceHandle: 'terminal_b',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
    ]
    const out = expandMultiLeadSources([sourceNode('bat', 3)], edges)
    const w1 = out.edges.find((e) => e.id === 'w1')
    const w2 = out.edges.find((e) => e.id === 'w2')
    expect(w1).toMatchObject({ source: 'bat.tap1', sourceHandle: 'tie' })
    expect(w2).toMatchObject({ target: 'bat.sec2', targetHandle: 'terminal_negative' })
  })

  test('a 1-lead rail bonds its hidden return to the first ground', () => {
    const ground: CanvasNodeLike = {
      id: 'gnd',
      position: { x: 0, y: 0 },
      data: { definition: 'ground' },
    }
    const out = expandMultiLeadSources([sourceNode('rail', 1), ground], [])
    const bond = out.edges.find((e) => e.id === 'rail.rail_return')
    expect(bond).toMatchObject({
      source: 'rail',
      sourceHandle: 'terminal_negative',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    })
    expect(bond?.data?.internalBond).toBe(true)
  })

  test('a 1-lead rail with NO ground stays honestly floating (no bond invented)', () => {
    const out = expandMultiLeadSources([sourceNode('rail', 1)], [])
    expect(out.edges.length).toBe(0)
  })
})

describe('solver-level truth — the stack puts taps exactly where real cells do', () => {
  test('3-lead 9 V stack: + at 18 V, tap at 9 V, loads on both spans solve right', () => {
    // bat (3 leads, 9 V/section, 0 Ω): r1 = 1 kΩ from + to −, r2 = 1 kΩ from
    // tap_1 to −, ground on −.
    //   V(+) = 18 V → I(r1) = 18 mA;  V(tap) = 9 V → I(r2) = 9 mA.
    //   Bottom section carries both loops: 27 mA. Top section only r1: 18 mA.
    const nodes: CanvasNodeLike[] = [
      sourceNode('bat', 3),
      {
        id: 'r1',
        position: { x: 300, y: 0 },
        data: { definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
      },
      {
        id: 'r2',
        position: { x: 300, y: 200 },
        data: { definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
      },
      { id: 'gnd', position: { x: 0, y: 300 }, data: { definition: 'ground' } },
    ]
    const edges: CanvasEdgeLike[] = [
      {
        id: 'e1',
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      {
        id: 'e2',
        source: 'r1',
        sourceHandle: 'terminal_b',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
      { id: 'e3', source: 'bat', sourceHandle: 'tap_1', target: 'r2', targetHandle: 'terminal_a' },
      {
        id: 'e4',
        source: 'r2',
        sourceHandle: 'terminal_b',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'e5',
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
    ]
    const expanded = expandMultiLeadSources(nodes, edges)
    const world = canvasToWorld(
      expanded.nodes.map(
        (n) =>
          ({
            id: n.id,
            definition: n.data.definition,
            ...(n.data.parameters ? { parameters: n.data.parameters } : {}),
          }) as CanvasNode,
      ),
      expanded.edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? null,
        target: e.target,
        targetHandle: e.targetHandle ?? null,
      })),
    )
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')

    const netOf = (instId: string, terminal: string) =>
      [...world.instances.values()]
        .find((i) => i.id === instId)
        ?.connects?.find((c) => c.terminal === terminal)?.net
    const volts = (net: string | undefined) => (net ? (solution.nodes.get(net) ?? null) : null)

    expect(volts(netOf('r1', 'terminal_a'))).toBeCloseTo(18, 9)
    expect(volts(netOf('r2', 'terminal_a'))).toBeCloseTo(9, 9)
    expect(Math.abs(solution.branches.get('r1') ?? 0)).toBeCloseTo(0.018, 9)
    expect(Math.abs(solution.branches.get('r2') ?? 0)).toBeCloseTo(0.009, 9)
    // KCL at the stack: the bottom section carries both loops, the top only r1.
    expect(Math.abs(solution.branches.get('bat.sec2') ?? 0)).toBeCloseTo(0.027, 9)
    expect(Math.abs(solution.branches.get('bat.sec1') ?? 0)).toBeCloseTo(0.018, 9)
  })

  test('a 1-lead rail drives a load whose far side returns through ground', () => {
    // rail (9 V, 1 lead) → r1 1 kΩ → ground. The return is the internal bond:
    // I = 9 mA, the load's far side sits AT ground.
    const nodes: CanvasNodeLike[] = [
      sourceNode('rail', 1),
      {
        id: 'r1',
        position: { x: 300, y: 0 },
        data: { definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
      },
      { id: 'gnd', position: { x: 0, y: 300 }, data: { definition: 'ground' } },
    ]
    const edges: CanvasEdgeLike[] = [
      {
        id: 'e1',
        source: 'rail',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      {
        id: 'e2',
        source: 'r1',
        sourceHandle: 'terminal_b',
        target: 'gnd',
        targetHandle: 'reference_terminal',
      },
    ]
    const expanded = expandMultiLeadSources(nodes, edges)
    const world = canvasToWorld(
      expanded.nodes.map(
        (n) =>
          ({
            id: n.id,
            definition: n.data.definition,
            ...(n.data.parameters ? { parameters: n.data.parameters } : {}),
          }) as CanvasNode,
      ),
      expanded.edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? null,
        target: e.target,
        targetHandle: e.targetHandle ?? null,
      })),
    )
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('r1') ?? 0)).toBeCloseTo(0.009, 9)
  })
})
