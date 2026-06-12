/**
 * Scope channel tests (S19-v3-77; clamps S19-v3-83) — probed terminals become
 * voltage channels through the same terminal→net lookup the multimeter uses;
 * clamped wires become CURRENT channels reading (vA−vB)/R of the wire — the
 * wire is a real resistor the solver already solved, so the branch current is
 * exact Ohm's law per step. A probe whose terminal or wire no longer resolves
 * is dropped, never invented.
 */

import { describe, expect, test } from 'vitest'
import { diodeCurrent, thermalVoltage } from '../src/diode-model.ts'
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
  const partOf = (_: string) => undefined

  test('each probed terminal becomes a labeled voltage channel on its net', () => {
    const channels = channelsForProbes(
      [
        { kind: 'terminal', nodeId: 'led_001', handleId: 'anode' },
        { kind: 'terminal', nodeId: 'block_1', handleId: 'port_1' },
      ],
      lookup,
      wireOf,
      partOf,
    )
    expect(channels).toEqual([
      { key: 'led_001/anode', label: 'led_001 · anode', unit: 'V', net: 'net_3' },
      { key: 'block_1/port_1', label: 'block_1 · port 1', unit: 'V', net: 'net_7' },
    ])
  })

  test('a clamped wire becomes a current channel carrying its nets and ohms', () => {
    const channels = channelsForProbes([{ kind: 'wire', edgeId: 'w1' }], lookup, wireOf, partOf)
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
      partOf,
    )
    expect(channels.map((c) => c.key)).toEqual(['led_001/cathode'])
  })

  test('a 0 Ω ideal short cannot be clamped — ΔV/R has no answer there', () => {
    expect(channelsForProbes([{ kind: 'wire', edgeId: 'w0' }], lookup, wireOf, partOf)).toEqual([])
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
      partOf,
    )
    expect(channels.length).toBe(2)
  })
})

describe('channelValue', () => {
  const point = {
    nodes: new Map([
      ['net_a', 9.0],
      ['net_b', 8.99906],
    ]),
    currents: new Map([['d1/anode', 0.0149]]),
  }

  test('a voltage channel reads its net', () => {
    const channel: ScopeChannel = { key: 'k', label: 'l', unit: 'V', net: 'net_a' }
    expect(channelValue(channel, point)).toBe(9.0)
  })

  test('a current channel reads the wire by Ohm’s law: (vA−vB)/R', () => {
    const channel: ScopeChannel = {
      key: 'k',
      label: 'l',
      unit: 'A',
      diff: { netA: 'net_a', netB: 'net_b', ohms: 0.002 },
    }
    expect(channelValue(channel, point)).toBeCloseTo(0.47, 3)
  })

  test('a part channel reads the device’s recorded terminal current', () => {
    const channel: ScopeChannel = {
      key: 'part:d1',
      label: 'd1 · I(anode→cathode)',
      unit: 'A',
      device: { currentKey: 'd1/anode' },
    }
    expect(channelValue(channel, point)).toBe(0.0149)
  })

  test('a part probe resolves through the part lookup, and drops when absent', () => {
    const partOf = (id: string) =>
      id === 'd1' ? { currentKey: 'd1/anode', label: 'd1 · I(anode→cathode)' } : undefined
    const channels = channelsForProbes(
      [
        { kind: 'part', nodeId: 'd1' },
        { kind: 'part', nodeId: 'ground_1' },
      ],
      () => undefined,
      () => undefined,
      partOf,
    )
    expect(channels).toEqual([
      {
        key: 'part:d1',
        label: 'd1 · I(anode→cathode)',
        unit: 'A',
        device: { currentKey: 'd1/anode' },
      },
    ])
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

describe('the curve tracer identity (S20-v3-3): swept V-I pairs lie ON the device law', () => {
  test('diode exponential and resistor line, from one AC sweep', () => {
    const world = canvasToWorld(
      [
        {
          id: 'src',
          definition: 'power_source',
          parameters: {
            nominal_voltage: { value: { kind: 'scalar', amount: 0, unit: 'volt' } },
            ac_amplitude: { value: { kind: 'scalar', amount: 5, unit: 'volt' } },
            frequency: { value: { kind: 'scalar', amount: 1000, unit: 'hertz' } },
            internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
          },
        },
        {
          id: 'r1',
          definition: 'resistor',
          parameters: { resistance: { value: { kind: 'scalar', amount: 470, unit: 'ohm' } } },
        },
        {
          id: 'd1',
          definition: 'led',
          parameters: {
            forward_voltage: { value: { kind: 'scalar', amount: 2, unit: 'volt' } },
            max_forward_current: { value: { kind: 'scalar', amount: 0.02, unit: 'ampere' } },
            ideality_factor: { value: { kind: 'scalar', amount: 2, unit: 'dimensionless' } },
          },
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
        },
        {
          id: 'e2',
          source: 'r1',
          target: 'd1',
          sourceHandle: 'terminal_b',
          targetHandle: 'anode',
        },
        {
          id: 'e3',
          source: 'd1',
          target: 'src',
          sourceHandle: 'cathode',
          targetHandle: 'terminal_negative',
        },
        {
          id: 'e4',
          source: 'gnd',
          target: 'src',
          sourceHandle: 'reference_terminal',
          targetHandle: 'terminal_negative',
        },
      ],
    )
    const result = solveTransient(world, { timeStep: 2e-6, duration: 1e-3 })
    expect(result.status).toBe('solved')

    const anodeNet = world.instances.get('d1')?.connects?.find((c) => c.terminal === 'anode')?.net
    const cathodeNet = world.instances
      .get('d1')
      ?.connects?.find((c) => c.terminal === 'cathode')?.net
    const r1NetA = world.instances.get('r1')?.connects?.[0]?.net
    const r1NetB = world.instances.get('r1')?.connects?.[1]?.net
    const r1Term = world.instances.get('r1')?.connects?.[0]?.terminal
    if (
      anodeNet === undefined ||
      cathodeNet === undefined ||
      r1NetA === undefined ||
      r1NetB === undefined ||
      r1Term === undefined
    ) {
      throw new Error('missing nets')
    }
    const diodeV: ScopeChannel = { key: 'x', label: 'x', unit: 'V', net: anodeNet }
    const diodeI: ScopeChannel = {
      key: 'y',
      label: 'y',
      unit: 'A',
      device: { currentKey: 'd1/anode' },
    }
    const vT = thermalVoltage()
    const iS = 0.02 / (Math.exp(2 / (2 * vT)) - 1)
    for (const p of result.series) {
      // The diode's (V, I) pair sits on the Shockley exponential — the
      // cathode is at the source return (not exactly ground: it shares the
      // net with the source negative through real solving), so take the
      // junction voltage from both nets.
      const v = (p.nodes.get(anodeNet) ?? 0) - (p.nodes.get(cathodeNet) ?? 0)
      const i = channelValue(diodeI, p)
      expect(i).toBeCloseTo(diodeCurrent(v, iS, 2, vT), 9)
      // The resistor's (V, I) pair sits on the straight line of slope 1/R.
      const vR = (p.nodes.get(r1NetA) ?? 0) - (p.nodes.get(r1NetB) ?? 0)
      const iR = p.currents?.get(`r1/${r1Term}`) ?? Number.NaN
      expect(iR).toBeCloseTo(vR / 470, 9)
      // And the X channel really is the plottable anode voltage.
      expect(channelValue(diodeV, p)).toBe(p.nodes.get(anodeNet) ?? 0)
    }
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
    expect(channelValue(clamp, last)).toBeCloseTo(expected, 6)
  })
})
