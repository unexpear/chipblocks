/**
 * Scope channel tests (S19-v3-77; clamps S19-v3-83) — probed terminals become
 * voltage channels through the same terminal→net lookup the multimeter uses;
 * clamped wires become CURRENT channels reading (vA−vB)/R of the wire — the
 * wire is a real resistor the solver already solved, so the branch current is
 * exact Ohm's law per step. A probe whose terminal or wire no longer resolves
 * is dropped, never invented.
 */

import { describe, expect, test } from 'vitest'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import {
  channelsForProbes,
  channelValue,
  mathResultUnit,
  type ScopeChannel,
} from '../src/renderer/scope.tsx'
import { solveTransient } from '../src/transient-solver.ts'

describe('channelsForProbes', () => {
  const nets = new Map([
    ['led_001/anode', 'net_3'],
    ['led_001/cathode', 'net_5'],
    ['block_1/port_1', 'net_7'],
  ])
  const lookup = (key: string) => nets.get(key)
  const wires = new Map([
    ['w1', { netA: 'net_3', netB: 'net_5', ohms: 0.002, label: 'clamp · a → b' }],
    ['w0', { netA: 'net_3', netB: 'net_5', ohms: 0, label: 'ideal short' }],
  ])
  const wireOf = (id: string) => wires.get(id)

  test('each probed terminal becomes a labeled voltage channel on its net', () => {
    const channels = channelsForProbes(
      [
        { kind: 'terminal', nodeId: 'led_001', handleId: 'anode' },
        { kind: 'terminal', nodeId: 'block_1', handleId: 'port_1' },
      ],
      lookup,
      wireOf,
    )
    expect(channels).toEqual([
      { key: 'led_001/anode', label: 'led_001 · anode', unit: 'V', net: 'net_3' },
      { key: 'block_1/port_1', label: 'block_1 · port 1', unit: 'V', net: 'net_7' },
    ])
  })

  test('a clamped wire becomes a current channel carrying its nets and ohms', () => {
    const channels = channelsForProbes([{ kind: 'wire', edgeId: 'w1' }], lookup, wireOf)
    expect(channels).toEqual([
      {
        key: 'clamp:w1',
        label: 'clamp · a → b',
        unit: 'A',
        diff: { netA: 'net_3', netB: 'net_5', ohms: 0.002 },
      },
    ])
  })

  test('a probe on a deleted part or wire is dropped, not invented', () => {
    const channels = channelsForProbes(
      [
        { kind: 'terminal', nodeId: 'ghost', handleId: 'anode' },
        { kind: 'wire', edgeId: 'gone' },
        { kind: 'terminal', nodeId: 'led_001', handleId: 'cathode' },
      ],
      lookup,
      wireOf,
    )
    expect(channels.map((c) => c.key)).toEqual(['led_001/cathode'])
  })

  test('a 0 Ω ideal short cannot be clamped — ΔV/R has no answer there', () => {
    expect(channelsForProbes([{ kind: 'wire', edgeId: 'w0' }], lookup, wireOf)).toEqual([])
  })

  test('two probes on the same net stay two channels (overlapping traces are honest)', () => {
    const sameNet = (_: string) => 'net_1'
    const channels = channelsForProbes(
      [
        { kind: 'terminal', nodeId: 'a', handleId: 'terminal_a' },
        { kind: 'terminal', nodeId: 'b', handleId: 'terminal_b' },
      ],
      sameNet,
      wireOf,
    )
    expect(channels.length).toBe(2)
  })
})

describe('channelValue', () => {
  const nodes = new Map([
    ['net_a', 9.0],
    ['net_b', 8.99906],
  ])

  test('a voltage channel reads its net', () => {
    const channel: ScopeChannel = { key: 'k', label: 'l', unit: 'V', net: 'net_a' }
    expect(channelValue(channel, nodes)).toBe(9.0)
  })

  test('a current channel reads the wire by Ohm’s law: (vA−vB)/R', () => {
    const channel: ScopeChannel = {
      key: 'k',
      label: 'l',
      unit: 'A',
      diff: { netA: 'net_a', netB: 'net_b', ohms: 0.002 },
    }
    expect(channelValue(channel, nodes)).toBeCloseTo(0.47, 3)
  })
})

describe('mathResultUnit', () => {
  test('volts × amps is WATTS — real instantaneous power, both orders', () => {
    expect(mathResultUnit('V', 'A', 'mul')).toBe('W')
    expect(mathResultUnit('A', 'V', 'mul')).toBe('W')
  })

  test('matching units multiply into their honest squares', () => {
    expect(mathResultUnit('V', 'V', 'mul')).toBe('V·V')
    expect(mathResultUnit('A', 'A', 'mul')).toBe('A·A')
  })

  test('subtraction needs matching units; mismatches are refused', () => {
    expect(mathResultUnit('V', 'V', 'sub')).toBe('V')
    expect(mathResultUnit('A', 'A', 'sub')).toBe('A')
    expect(mathResultUnit('V', 'A', 'sub')).toBeNull()
  })
})

describe('clamp current against the solved circuit (the analytic check)', () => {
  test('the clamp reads the series-loop current the resistor law demands', () => {
    // 9 V source (50 Ω internal) → wire → 850 Ω resistor → wire back.
    // I = 9 / (50 + 850 + wire resistances) — the clamp must read exactly
    // what flows, derived only from solved node voltages and the wire's R.
    const wireOhms = 0.05
    const world = canvasToWorld(
      [
        {
          id: 'src',
          definition: 'power_source',
          parameters: {
            nominal_voltage: { value: { kind: 'scalar', amount: 9, unit: 'volt' } },
            internal_resistance: { value: { kind: 'scalar', amount: 50, unit: 'ohm' } },
          },
        },
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: { value: { kind: 'scalar', amount: 850, unit: 'ohm' } } },
        },
        { id: 'gnd', definition: 'ground' },
      ],
      [
        {
          id: 'e1',
          source: 'src',
          target: 'r1',
          sourceHandle: 'terminal_positive',
          targetHandle: 'terminal_a',
          resistanceOhms: wireOhms,
        },
        {
          id: 'e2',
          source: 'r1',
          target: 'src',
          sourceHandle: 'terminal_b',
          targetHandle: 'terminal_negative',
          resistanceOhms: wireOhms,
        },
        {
          id: 'e3',
          source: 'gnd',
          target: 'src',
          sourceHandle: 'reference_terminal',
          targetHandle: 'terminal_negative',
          resistanceOhms: wireOhms,
        },
      ],
    )
    const result = solveTransient(world, { timeStep: 1e-5, duration: 1e-3 })
    expect(result.status).toBe('solved')
    const wire = world.instances.get('wire_e1')
    const netA = wire?.connects?.find((c) => c.terminal === 'terminal_a')?.net ?? ''
    const netB = wire?.connects?.find((c) => c.terminal === 'terminal_b')?.net ?? ''
    const clamp: ScopeChannel = {
      key: 'clamp:e1',
      label: 'clamp',
      unit: 'A',
      diff: { netA, netB, ohms: wireOhms },
    }
    const last = result.series[result.series.length - 1]
    if (last === undefined) throw new Error('no samples')
    const expected = 9 / (50 + 850 + 2 * wireOhms)
    expect(channelValue(clamp, last.nodes)).toBeCloseTo(expected, 6)
  })
})
