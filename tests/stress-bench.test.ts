import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { runStressSweep } from '../src/renderer/stress-bench.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const node = (id: string, definition: string, parameters?: Record<string, unknown>): Node =>
  ({
    id,
    position: { x: 0, y: 0 },
    data: { definition, ...(parameters ? { parameters } : {}) },
  }) as unknown as Node

// Battery → 100 Ω resistor → back to battery, with ground. Power in the resistor = (V/101)^2 · 100, so a
// 0.25 W resistor crosses its rating at V ≈ 5.05 V.
const nodes: Node[] = [
  node('bat', 'power_source', {
    nominal_voltage: scalar(1, 'volt'),
    internal_resistance: scalar(1, 'ohm'),
  }),
  node('r1', 'resistor', { resistance: scalar(100, 'ohm'), power_rating: scalar(0.25, 'watt') }),
  node('gnd', 'ground'),
]
const edges: Edge[] = [
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
  {
    id: 'e3',
    source: 'gnd',
    sourceHandle: 'reference_terminal',
    target: 'bat',
    targetHandle: 'terminal_negative',
  },
] as unknown as Edge[]

const supplyAxis = {
  kind: 'param' as const,
  targets: [{ nodeId: 'bat', param: 'nominal_voltage' }],
}

describe('stress-bench sweep', () => {
  it('ramps the supply and finds where the resistor overpowers', () => {
    const r = runStressSweep(nodes, edges, supplyAxis, 1, 20, 20, 25)
    expect(r.values.length).toBe(20)
    expect(r.values[0]).toBeCloseTo(1, 6)
    expect(r.values[r.values.length - 1]).toBeCloseTo(20, 6)

    const r1 = r.failingParts.find((p) => p.partId === 'r1')
    expect(r1).toBeDefined()
    if (!r1) return
    expect(r1.worstCode).toBe('resistor-overpower')
    // crosses ~5.05 V — first failing sweep point is just above that
    expect(r1.firstFailValue).toBeGreaterThan(4)
    expect(r1.firstFailValue).toBeLessThan(7)
    // it's safe from the bottom of the range up to the failure boundary
    expect(r1.safeFrom).toBeCloseTo(1, 5)
    expect((r1.safeTo ?? 99) < r1.firstFailValue).toBe(true)
    // the circuit's overall safe window starts at the low end
    expect(r.safeWindow?.from).toBeCloseTo(1, 5)
  })

  it('reports no failures across a benign range', () => {
    const r = runStressSweep(nodes, edges, supplyAxis, 1, 4, 8, 25)
    expect(r.failingParts).toEqual([])
    expect(r.totalParts).toBeGreaterThan(0)
    expect(r.noFailure).toBe(r.totalParts)
    // the whole swept range is safe
    expect(r.safeWindow?.from).toBeCloseTo(1, 6)
    expect(r.safeWindow?.to).toBeCloseTo(4, 6)
  })

  it('reports the first failure in SWEEP ORDER, not the numeric minimum (descending sweep)', () => {
    // 20 → 1 V: the resistor overpowers at the HIGH end, which comes first in this sweep.
    const r = runStressSweep(nodes, edges, supplyAxis, 20, 1, 20, 25)
    const r1 = r.failingParts.find((p) => p.partId === 'r1')
    expect(r1?.firstFailValue).toBeGreaterThan(15)
  })

  it('warns (and doesn’t claim safe) when the swept parameter isn’t on the target', () => {
    const bogus = { kind: 'param' as const, targets: [{ nodeId: 'r1', param: 'not_a_param' }] }
    const r = runStressSweep(nodes, edges, bogus, 1, 20, 10, 25)
    expect(r.warning).toBeDefined()
  })

  it('clamps the step count and always returns at least two points', () => {
    const r = runStressSweep(nodes, edges, supplyAxis, 1, 20, 100000, 25)
    expect(r.values.length).toBeLessThanOrEqual(80)
    expect(r.values.length).toBeGreaterThanOrEqual(2)
  })
})
