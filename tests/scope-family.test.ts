/**
 * Family-curve tests (S20-v3-4) — the sweep harness's pure pieces, and the
 * showpiece identity: run the NMOS curve-tracer circuit at several stepped
 * gate voltages and check that EVERY point of EVERY traced curve lies on the
 * Level-1 device law at that step's own V_GS — the family picture cannot be
 * drawn wrong quietly.
 */

import { describe, expect, test } from 'vitest'
import { mosfetOperatingPoint } from '../src/mosfet-model.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import type { ScopeChannel } from '../src/renderer/scope.tsx'
import {
  extractXyPath,
  familyExtent,
  stepValues,
  withSourceVoltage,
} from '../src/renderer/scope-family.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

describe('stepValues', () => {
  test('evenly spaced, endpoints included', () => {
    expect(stepValues(2, 4, 5)).toEqual([2, 2.5, 3, 3.5, 4])
  })

  test('count clamps to 2..8', () => {
    expect(stepValues(0, 1, 1).length).toBe(2)
    expect(stepValues(0, 1, 99).length).toBe(8)
  })

  test('a descending range steps downward just as honestly', () => {
    expect(stepValues(4, 2, 3)).toEqual([4, 3, 2])
  })
})

describe('withSourceVoltage', () => {
  const nodes = [
    {
      id: 'vgg',
      data: {
        parameters: { nominal_voltage: scalar(2, 'volt'), internal_resistance: scalar(50, 'ohm') },
      },
    },
    { id: 'other', data: { parameters: { resistance: scalar(470, 'ohm') } } },
  ]

  test('overrides only the named node, keeps its other parameters', () => {
    const out = withSourceVoltage(nodes, 'vgg', 3.5)
    const vgg = out.find((n) => n.id === 'vgg')
    const volts = vgg?.data?.parameters?.nominal_voltage as { value: { amount: number } }
    const ohms = vgg?.data?.parameters?.internal_resistance as { value: { amount: number } }
    expect(volts.value.amount).toBe(3.5)
    expect(ohms.value.amount).toBe(50)
    expect(out.find((n) => n.id === 'other')).toBe(nodes[1])
  })

  test('is pure — the original nodes are untouched', () => {
    withSourceVoltage(nodes, 'vgg', 9)
    const volts = nodes[0]?.data?.parameters?.nominal_voltage as { value: { amount: number } }
    expect(volts.value.amount).toBe(2)
  })
})

describe('familyExtent', () => {
  test('the union of every step, one axis fit for the family', () => {
    const extent = familyExtent([
      {
        label: 'a',
        path: [
          { x: 0, y: 0 },
          { x: 5, y: 0.01 },
        ],
      },
      {
        label: 'b',
        path: [
          { x: -1, y: 0.002 },
          { x: 4, y: 0.03 },
        ],
      },
    ])
    expect(extent).toEqual({ xLo: -1, xHi: 5, yLo: 0, yHi: 0.03 })
  })

  test('no points → null, never a fake box', () => {
    expect(familyExtent([{ label: 'a', path: [] }])).toBeNull()
  })
})

describe('the family identity: every curve lies on the device law at ITS gate voltage', () => {
  test('NMOS I_D–V_DS family from three stepped gate runs', () => {
    // The curve-tracer rig: vdd sweeps the drain 0..9 V (offset 4.5 ± 4.5),
    // the FET hangs straight across it, vgg drives the gate and is stepped.
    const baseNodes = [
      {
        id: 'vdd',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(4.5, 'volt'),
          ac_amplitude: scalar(4.5, 'volt'),
          frequency: scalar(1000, 'hertz'),
          internal_resistance: scalar(50, 'ohm'),
        },
      },
      {
        id: 'vgg',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(2.5, 'volt'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      {
        id: 'm1',
        definition: 'transistor_mosfet_nmos',
        parameters: {
          threshold_voltage: scalar(2.1, 'volt'),
          transconductance_parameter: scalar(0.05, 'ampere_per_volt_squared'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        id: 'e1',
        source: 'vdd',
        target: 'm1',
        sourceHandle: 'terminal_positive',
        targetHandle: 'drain',
      },
      {
        id: 'e2',
        source: 'vgg',
        target: 'm1',
        sourceHandle: 'terminal_positive',
        targetHandle: 'gate',
      },
      {
        id: 'e3',
        source: 'm1',
        target: 'vdd',
        sourceHandle: 'source',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'e4',
        source: 'vgg',
        target: 'vdd',
        sourceHandle: 'terminal_negative',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'e5',
        source: 'gnd',
        target: 'vdd',
        sourceHandle: 'reference_terminal',
        targetHandle: 'terminal_negative',
      },
    ]

    const gateSteps = stepValues(2.5, 3.5, 3)
    for (const vGate of gateSteps) {
      const nodes = withSourceVoltage(
        baseNodes.map((n) => ({
          id: n.id,
          data: { parameters: n.parameters as Record<string, unknown> },
        })),
        'vgg',
        vGate,
      )
      const world = canvasToWorld(
        nodes.map((n, i) => ({
          id: n.id,
          definition: baseNodes[i]?.definition ?? '',
          parameters: n.data?.parameters as never,
        })),
        edges,
      )
      const result = solveTransient(world, { timeStep: 2e-6, duration: 1e-3 })
      expect(result.status).toBe('solved')

      const drainNet = world.instances.get('m1')?.connects?.find((c) => c.terminal === 'drain')?.net
      const sourceNet = world.instances
        .get('m1')
        ?.connects?.find((c) => c.terminal === 'source')?.net
      const gateNet = world.instances.get('m1')?.connects?.find((c) => c.terminal === 'gate')?.net
      if (drainNet === undefined || sourceNet === undefined || gateNet === undefined) {
        throw new Error('missing FET nets')
      }
      const xChannel: ScopeChannel = { key: 'x', label: 'x', unit: 'V', net: drainNet }
      const yChannel: ScopeChannel = {
        key: 'y',
        label: 'y',
        unit: 'A',
        device: { currentKey: 'm1/drain' },
      }
      const path = extractXyPath(result.series, xChannel, yChannel, 1e-3 / 3)
      expect(path.length).toBeGreaterThan(300)

      // Every (V_DS, I_D) pair must sit on the Level-1 law at THIS step's
      // actual gate-source voltage from the same solved instant.
      const settled = result.series.filter((p) => p.time >= 1e-3 / 3)
      for (let i = 0; i < settled.length; i++) {
        const p = settled[i]
        const pair = path[i]
        if (p === undefined || pair === undefined) continue
        const vGS = (p.nodes.get(gateNet) ?? 0) - (p.nodes.get(sourceNet) ?? 0)
        const vDS = (p.nodes.get(drainNet) ?? 0) - (p.nodes.get(sourceNet) ?? 0)
        const { iD } = mosfetOperatingPoint(vGS, vDS, {
          channel: 'nmos',
          thresholdVoltage: 2.1,
          transconductance: 0.05,
          channelLengthModulation: 0,
        })
        expect(pair.y).toBeCloseTo(iD, 9)
        expect(pair.x).toBeCloseTo(vDS, 9)
      }
    }
  })
})
