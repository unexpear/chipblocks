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

  test('from = to collapses to ONE step — not N identical simulations', () => {
    // Found by a verification probe: five identical runs also gave five
    // identical labels, which collided as render keys.
    expect(stepValues(2.5, 2.5, 5)).toEqual([2.5])
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
        value: 1,
        label: 'a',
        path: [
          { x: 0, y: 0 },
          { x: 5, y: 0.01 },
        ],
      },
      {
        value: 2,
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
    expect(familyExtent([{ value: 0, label: 'a', path: [] }])).toBeNull()
  })
})

describe('the BJT family (S20-v3-6/7): I_C vs V_CE at stepped base drive', () => {
  test('equally spaced curves at β·I_B, plateaus tilting toward −V_A (the Early effect)', () => {
    // The classic rig: vcc sweeps the collector 0..9 V; the base is driven
    // through a 100 kΩ resistor from the STEPPED source, so equal voltage
    // steps make near-equal base-current steps — and β multiplies them into
    // equally spaced collector plateaus (the MOSFET's family spacing grows
    // quadratically; the BJT's is linear — the device-physics fingerprint).
    // With a cited V_A (S20-v3-7) the plateaus are no longer flat: each one
    // climbs gently, and extrapolated backward they all meet near −V_A on
    // the voltage axis — the convergent fan on every datasheet.
    const betaForward = 100
    const earlyVoltage = 74
    const baseNodes = [
      {
        id: 'vcc',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(4.5, 'volt'),
          ac_amplitude: scalar(4.5, 'volt'),
          frequency: scalar(1000, 'hertz'),
          internal_resistance: scalar(50, 'ohm'),
        },
      },
      {
        id: 'vbb',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(2, 'volt'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      {
        id: 'rb',
        definition: 'resistor',
        parameters: { resistance: scalar(100000, 'ohm') },
      },
      {
        id: 'q1',
        definition: 'transistor_bjt_npn',
        parameters: {
          saturation_current: scalar(1e-14, 'ampere'),
          forward_current_gain: scalar(betaForward, 'dimensionless'),
          forward_early_voltage: scalar(earlyVoltage, 'volt'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        id: 'e1',
        source: 'vcc',
        target: 'q1',
        sourceHandle: 'terminal_positive',
        targetHandle: 'collector',
      },
      {
        id: 'e2',
        source: 'vbb',
        target: 'rb',
        sourceHandle: 'terminal_positive',
        targetHandle: 'terminal_a',
      },
      { id: 'e3', source: 'rb', target: 'q1', sourceHandle: 'terminal_b', targetHandle: 'base' },
      {
        id: 'e4',
        source: 'q1',
        target: 'vcc',
        sourceHandle: 'emitter',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'e5',
        source: 'vbb',
        target: 'vcc',
        sourceHandle: 'terminal_negative',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'e6',
        source: 'gnd',
        target: 'vcc',
        sourceHandle: 'reference_terminal',
        targetHandle: 'terminal_negative',
      },
    ]

    const plateaus: number[] = []
    const xIntercepts: number[] = []
    for (const vBase of stepValues(2, 4, 3)) {
      const nodes = withSourceVoltage(
        baseNodes.map((n) => ({
          id: n.id,
          data: { parameters: n.parameters as Record<string, unknown> },
        })),
        'vbb',
        vBase,
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

      const collectorNet = world.instances
        .get('q1')
        ?.connects?.find((c) => c.terminal === 'collector')?.net
      const baseNet = world.instances.get('q1')?.connects?.find((c) => c.terminal === 'base')?.net
      const emitterNet = world.instances
        .get('q1')
        ?.connects?.find((c) => c.terminal === 'emitter')?.net
      if (collectorNet === undefined || baseNet === undefined || emitterNet === undefined)
        throw new Error('missing nets')

      // Forward-active samples (V_CE well past saturation): the Early effect
      // scales only the transport current, so I_C/I_B = β·(1 − V_BC/V_A)
      // EXACTLY — both currents AND both voltages RECORDED, not derived.
      const settled = result.series.filter((p) => p.time >= 1e-3 / 3)
      const active = settled.filter((p) => {
        const vce = (p.nodes.get(collectorNet) ?? 0) - (p.nodes.get(emitterNet) ?? 0)
        return vce > 1
      })
      expect(active.length).toBeGreaterThan(50)
      for (const p of active) {
        const iC = p.currents?.get('q1/collector') ?? 0
        const iB = p.currents?.get('q1/base') ?? 0
        const vBC = (p.nodes.get(baseNet) ?? 0) - (p.nodes.get(collectorNet) ?? 0)
        expect(iC / iB).toBeCloseTo(betaForward * (1 - vBC / earlyVoltage), 3)
      }

      // The plateau TILTS (S20-v3-7): along one curve V_BE is pinned by the
      // base loop, so I_C is exactly proportional to (1 − V_BC/V_A) — the
      // sampled pair must sit in that ratio, and the line through them must
      // extrapolate back to V_CE = V_BE − V_A ≈ −V_A: the datasheet fan.
      const sampleAt = (vceTarget: number) => {
        let best = Number.POSITIVE_INFINITY
        let amps = 0
        let vce = 0
        let vbc = 0
        for (const p of active) {
          const v = (p.nodes.get(collectorNet) ?? 0) - (p.nodes.get(emitterNet) ?? 0)
          if (Math.abs(v - vceTarget) < best) {
            best = Math.abs(v - vceTarget)
            amps = p.currents?.get('q1/collector') ?? 0
            vce = v
            vbc = (p.nodes.get(baseNet) ?? 0) - (p.nodes.get(collectorNet) ?? 0)
          }
        }
        return { amps, vce, vbc }
      }
      const low = sampleAt(2)
      const high = sampleAt(7)
      expect(high.amps).toBeGreaterThan(low.amps)
      expect(high.amps / low.amps).toBeCloseTo(
        (1 - high.vbc / earlyVoltage) / (1 - low.vbc / earlyVoltage),
        3,
      )
      const slope = (high.amps - low.amps) / (high.vce - low.vce)
      xIntercepts.push(low.vce - low.amps / slope)
      // Every step's plateau magnitude brackets β·(V_BB − V_BE)/R_B once its
      // own measured Early factor is divided out — V_BE sits between 0.6 and
      // 0.7 V at these microamp base currents.
      const plateauFlat = high.amps / (1 - high.vbc / earlyVoltage)
      expect(plateauFlat).toBeGreaterThan((betaForward * (vBase - 0.7)) / 100000)
      expect(plateauFlat).toBeLessThan((betaForward * (vBase - 0.6)) / 100000)
      plateaus.push(high.amps)
    }

    // Equal vbb steps → near-equal I_C spacing (β·ΔV/R_B), the linear law.
    const gap1 = (plateaus[1] ?? 0) - (plateaus[0] ?? 0)
    const gap2 = (plateaus[2] ?? 0) - (plateaus[1] ?? 0)
    expect(gap1).toBeGreaterThan(0)
    expect(gap2 / gap1).toBeCloseTo(1, 1)

    // The convergent fan: every plateau's extrapolation lands near −V_A
    // (exactly V_BE − V_A per curve, so all three agree within ~20 mV of
    // each other plus sampling noise).
    for (const x0 of xIntercepts) {
      expect(x0).toBeGreaterThan(-(earlyVoltage + 0.5))
      expect(x0).toBeLessThan(-(earlyVoltage - 1.5))
    }
    const spread = Math.max(...xIntercepts) - Math.min(...xIntercepts)
    expect(spread).toBeLessThan(0.3)
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
