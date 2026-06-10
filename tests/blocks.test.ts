/**
 * Circuit-block tests (S19-v3-67) — the Layer-5 mechanism. The load-bearing
 * assertion is EQUIVALENCE: a block is pure structure, so grouping the CMOS
 * inverter's transistor pair into a "NOT" block must change NOTHING physical —
 * the flattened solve lands on the same voltages and currents as the flat
 * circuit, to numerical identity. Everything else (ports, round-trips,
 * bubbling, cloning) supports that contract.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import {
  blockPortAliases,
  bubbleBlockHealth,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  cloneBlockData,
  flattenBlocks,
  groupSelection,
  ungroupBlock,
} from '../src/renderer/blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const nmosParams = {
  threshold_voltage: scalar(2.1, 'volt'),
  transconductance_parameter: scalar(0.026, 'ampere_per_volt_squared'),
}
const pmosParams = {
  threshold_voltage: scalar(-2.5, 'volt'),
  transconductance_parameter: scalar(0.0062, 'ampere_per_volt_squared'),
}

/** The CMOS inverter as canvas state (React Flow-ish nodes + edges). */
function inverterCanvas(inputVolts: number): {
  nodes: CanvasNodeLike[]
  edges: CanvasEdgeLike[]
} {
  const node = (
    id: string,
    definition: string,
    x: number,
    y: number,
    parameters?: Record<string, unknown>,
  ): CanvasNodeLike => ({
    id,
    position: { x, y },
    data: {
      definition,
      ...(parameters
        ? { parameters: parameters as NonNullable<CanvasNodeLike['data']['parameters']> }
        : {}),
    },
  })
  const edge = (
    id: string,
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
  ): CanvasEdgeLike => ({ id, source, sourceHandle, target, targetHandle })

  return {
    nodes: [
      node('vdd', 'power_source', 0, 0, {
        nominal_voltage: scalar(5, 'volt'),
        internal_resistance: scalar(0, 'ohm'),
      }),
      node('vin', 'power_source', 0, 200, {
        nominal_voltage: scalar(inputVolts, 'volt'),
        internal_resistance: scalar(0, 'ohm'),
      }),
      node('mp', 'transistor_mosfet_pmos', 200, 40, pmosParams),
      node('mn', 'transistor_mosfet_nmos', 200, 160, nmosParams),
      node('rload', 'resistor', 360, 100, { resistance: scalar(10000, 'ohm') }),
      node('gnd', 'ground', 0, 320),
    ],
    edges: [
      edge('e1', 'vdd', 'terminal_positive', 'mp', 'source'),
      edge('e2', 'mp', 'drain', 'mn', 'drain'),
      edge('e3', 'mn', 'source', 'vdd', 'terminal_negative'),
      edge('e4', 'vin', 'terminal_positive', 'mp', 'gate'),
      edge('e5', 'vin', 'terminal_positive', 'mn', 'gate'),
      edge('e6', 'vin', 'terminal_negative', 'vdd', 'terminal_negative'),
      edge('e7', 'mp', 'drain', 'rload', 'terminal_a'),
      edge('e8', 'rload', 'terminal_b', 'vdd', 'terminal_negative'),
      edge('e9', 'gnd', 'reference_terminal', 'vdd', 'terminal_negative'),
    ],
  }
}

const toWorld = (nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]) =>
  canvasToWorld(
    nodes.map((n) => ({
      id: n.id,
      definition: n.data.definition,
      ...(n.data.parameters ? { parameters: n.data.parameters } : {}),
    })),
    edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  )

function groupedInverter(inputVolts: number) {
  const { nodes, edges } = inverterCanvas(inputVolts)
  const grouped = groupSelection(nodes, edges, new Set(['mp', 'mn']), 'not1', 'NOT')
  if ('reason' in grouped) throw new Error(grouped.reason)
  return grouped
}

describe('the equivalence contract — a block changes nothing physical', () => {
  test.each([0, 5, 2.5])('flat and blocked inverters solve identically at Vin = %s V', (vin) => {
    const flat = inverterCanvas(vin)
    const flatSolution = solveDC(toWorld(flat.nodes, flat.edges))

    const grouped = groupedInverter(vin)
    const flattened = flattenBlocks(grouped.nodes, grouped.edges)
    const blockedSolution = solveDC(toWorld(flattened.nodes, flattened.edges))

    expect(flatSolution.status).toBe('solved')
    expect(blockedSolution.status).toBe('solved')
    // Same output voltage, read at the load that stayed OUTSIDE the block.
    const outNet = (w: ReturnType<typeof toWorld>) =>
      w.instances.get('rload')?.connects?.find((c) => c.terminal === 'terminal_a')?.net ?? ''
    const flatWorld = toWorld(flat.nodes, flat.edges)
    const blockedWorld = toWorld(flattened.nodes, flattened.edges)
    const vFlat = flatSolution.nodes.get(outNet(flatWorld)) ?? Number.NaN
    const vBlocked = blockedSolution.nodes.get(outNet(blockedWorld)) ?? Number.NaN
    expect(Math.abs(vFlat - vBlocked)).toBeLessThan(1e-9)
    // Same transistor currents — the namespaced inner parts ARE the parts.
    expect(
      Math.abs(
        (flatSolution.branches.get('mn') ?? 0) - (blockedSolution.branches.get('not1.mn') ?? 1),
      ),
    ).toBeLessThan(1e-12)
    expect(
      Math.abs(
        (flatSolution.branches.get('mp') ?? 0) - (blockedSolution.branches.get('not1.mp') ?? 1),
      ),
    ).toBeLessThan(1e-12)
  })
})

describe('groupSelection', () => {
  test('ports come from the boundary wiring, deduplicated per terminal', () => {
    const grouped = groupedInverter(0)
    const block = grouped.nodes.find((n) => n.id === 'not1')?.data.block
    expect(block).toBeDefined()
    // mp.source, mp.gate, mp.drain (to rload), mn.gate, mn.source — and NOT
    // mn.drain (its only wire is internal).
    expect(block?.ports.length).toBe(5)
    const terminals = new Set(block?.ports.map((p) => `${p.inner.nodeId}/${p.inner.handleId}`))
    expect(terminals.has('mp/drain')).toBe(true)
    expect(terminals.has('mn/drain')).toBe(false)
    // The internal wire between the two drains stays inside.
    expect(block?.edges.length).toBe(1)
    expect(block?.nodes.length).toBe(2)
  })

  test('boundary wires re-attach to the block’s port handles', () => {
    const grouped = groupedInverter(0)
    const toBlock = grouped.edges.filter((e) => e.source === 'not1' || e.target === 'not1')
    expect(toBlock.length).toBe(5) // e1, e3, e4, e5, e7 — e2 (drain↔drain) stays inside
    for (const e of toBlock) {
      const handle = e.source === 'not1' ? e.sourceHandle : e.targetHandle
      expect(handle?.startsWith('port_')).toBe(true)
    }
  })

  test('grouping fewer than two parts refuses with a plain reason', () => {
    const { nodes, edges } = inverterCanvas(0)
    const result = groupSelection(nodes, edges, new Set(['mp']), 'b1', 'X')
    expect('reason' in result).toBe(true)
  })
})

describe('ungroupBlock — the exact inverse', () => {
  test('group then ungroup restores the same circuit (and it still solves the same)', () => {
    const original = inverterCanvas(5)
    const originalSolution = solveDC(toWorld(original.nodes, original.edges))

    const grouped = groupedInverter(5)
    const ungrouped = ungroupBlock(grouped.nodes, grouped.edges, 'not1')
    if ('reason' in ungrouped) throw new Error(ungrouped.reason)

    expect(new Set(ungrouped.nodes.map((n) => n.id))).toEqual(
      new Set(original.nodes.map((n) => n.id)),
    )
    // EVERY wire comes back — including the internal ones. (This exact line
    // exists because a live check once caught the internal wires being
    // dropped while the current-comparison below passed at a ~0 A operating
    // point. Structure first, then physics.)
    expect(new Set(ungrouped.edges.map((e) => e.id))).toEqual(
      new Set(original.edges.map((e) => e.id)),
    )
    const solution = solveDC(toWorld(ungrouped.nodes, ungrouped.edges))
    expect(solution.status).toBe('solved')
    // Node order (and so net numbering / float-op order) differs after the
    // round trip — 1e-9 A is still a millionth of a percent at these currents.
    expect(
      Math.abs((solution.branches.get('mn') ?? 0) - (originalSolution.branches.get('mn') ?? 1)),
    ).toBeLessThan(1e-9)
  })

  test('a moved block carries its internals along when exploded', () => {
    const grouped = groupedInverter(0)
    const moved = grouped.nodes.map((n) =>
      n.id === 'not1' ? { ...n, position: { x: n.position.x + 100, y: n.position.y + 50 } } : n,
    )
    const ungrouped = ungroupBlock(moved, grouped.edges, 'not1')
    if ('reason' in ungrouped) throw new Error(ungrouped.reason)
    const mp = ungrouped.nodes.find((n) => n.id === 'mp')
    expect(mp?.position).toEqual({ x: 300, y: 90 }) // 200+100, 40+50
  })
})

describe('flattening, bubbling, aliases, cloning', () => {
  test('nested blocks flatten recursively with stacked namespaces', () => {
    const grouped = groupedInverter(0)
    // Group AGAIN: the block plus the load resistor into an outer block.
    const outer = groupSelection(
      grouped.nodes,
      grouped.edges,
      new Set(['not1', 'rload']),
      'stage1',
      'STAGE',
    )
    if ('reason' in outer) throw new Error(outer.reason)
    const flat = flattenBlocks(outer.nodes, outer.edges)
    const ids = new Set(flat.nodes.map((n) => n.id))
    expect(ids.has('stage1.not1.mn')).toBe(true)
    expect(ids.has('stage1.rload')).toBe(true)
    // And it still solves to the inverter's answer.
    const solution = solveDC(toWorld(flat.nodes, flat.edges))
    expect(solution.status).toBe('solved')
  })

  test('an internal failure bubbles up to mark the block node', () => {
    const health = new Map<string, { failed?: boolean; note?: string }>([
      ['not1.mn', { failed: true, note: 'cooked' }],
      ['rload', { failed: false }],
    ])
    const bubbled = bubbleBlockHealth(health)
    expect(bubbled.get('not1')?.failed).toBe(true)
    expect(bubbled.get('not1')?.note).toContain('mn')
  })

  test('port aliases route a probed port to the real internal terminal', () => {
    const grouped = groupedInverter(0)
    const aliases = blockPortAliases(grouped.nodes)
    expect(aliases.length).toBe(5)
    const gatePort = aliases.find((a) => a.inner === 'not1.mn/gate')
    expect(gatePort?.outer.startsWith('not1/port_')).toBe(true)
  })

  test('cloning remaps every internal id and deep-copies parameters', () => {
    const grouped = groupedInverter(0)
    const block = grouped.nodes.find((n) => n.id === 'not1')?.data.block
    if (!block) throw new Error('no block')
    const clone = cloneBlockData(block, 'c7')
    expect(clone.nodes.map((n) => n.id)).toEqual(['mp_c7', 'mn_c7'])
    expect(clone.edges[0]?.source).toBe('mp_c7')
    expect(clone.ports.every((p) => p.inner.nodeId.endsWith('_c7'))).toBe(true)
    // Deep copy: editing the clone's parameters must not touch the original.
    const cloneParams = clone.nodes[0]?.parameters as Record<string, { value: unknown }>
    cloneParams.threshold_voltage = { value: { kind: 'scalar', amount: 9, unit: 'volt' } }
    const originalVth = (
      block.nodes[0]?.parameters as Record<string, { value: { amount: number } }> | undefined
    )?.threshold_voltage?.value.amount
    expect(originalVth).toBe(-2.5)
  })
})
