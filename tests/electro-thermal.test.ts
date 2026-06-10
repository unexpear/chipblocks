/**
 * Electro-thermal tests (stage 7 rung 2) — temperature feeding BACK into the
 * electrical solve. Canonical checks: the SPICE I_S(T) law reproduces the real
 * ≈ −2 mV/°C diode forward-voltage drift; a self-heating resistor walks to its
 * electro-thermal fixed point; a warm LED conducts more than a cold solve says;
 * and thermal runaway / out-of-range tempco is reported, never faked.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'
import { scaleSaturationCurrent, thermalVoltage } from '../src/diode-model.ts'
import { resistanceAtTemperature, solveElectroThermal } from '../src/electro-thermal.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

describe('scaleSaturationCurrent — the SPICE I_S(T) law', () => {
  test('reproduces the real ≈ −2 mV/°C silicon forward-voltage drift', () => {
    // V at a fixed 1 mA: V(T) = n·V_T(T)·ln(I/I_S(T)). Si: n = 1, E_g = 1.11 eV.
    const vAt = (tK: number) => {
      const iS = scaleSaturationCurrent(1e-14, tK, 300, 1, 1.11)
      return thermalVoltage(tK) * Math.log(1e-3 / iS)
    }
    const driftPerKelvin = (vAt(310) - vAt(300)) / 10
    expect(driftPerKelvin).toBeLessThan(-0.0015) // falls…
    expect(driftPerKelvin).toBeGreaterThan(-0.0025) // …by about 2 mV/°C
  })
  test('identity at the calibration temperature', () => {
    expect(scaleSaturationCurrent(1e-14, 300, 300, 2, 1.9)).toBeCloseTo(1e-14, 20)
  })
})

/** 5 V ideal source — r1 — ground, with optional tempco + θ_JA on r1. */
function selfHeatingResistor(opts: { alpha?: number; thetaJa?: number }): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  world.nets.set('vs', {
    id: 'vs',
    kind: 'net',
    members: [
      { instance: 'bat', terminal: 'terminal_positive' },
      { instance: 'r1', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'r1', terminal: 'terminal_b' },
    ],
  })
  world.instances.set('bat', {
    id: 'bat',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(5, 'volt') },
    connects: [
      { net: 'vs', terminal: 'terminal_positive', of: 'bat' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
    ],
  })
  world.instances.set('r1', {
    id: 'r1',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: {
      resistance: scalar(100, 'ohm'),
      ...(opts.alpha !== undefined
        ? { temperature_coefficient: scalar(opts.alpha, 'per_kelvin') }
        : {}),
      ...(opts.thetaJa !== undefined
        ? { thermal_resistance_junction_ambient: scalar(opts.thetaJa, 'kelvin_per_watt') }
        : {}),
    },
    connects: [
      { net: 'vs', terminal: 'terminal_a', of: 'r1' },
      { net: 'gnd', terminal: 'terminal_b', of: 'r1' },
    ],
  })
  return world
}

/** 9 V — 470 Ω — LED — ground: the anchor loop with a thermally-rated LED. */
function ledLoop(): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  world.nets.set('vs', {
    id: 'vs',
    kind: 'net',
    members: [
      { instance: 'bat', terminal: 'terminal_positive' },
      { instance: 'r1', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('mid', {
    id: 'mid',
    kind: 'net',
    members: [
      { instance: 'r1', terminal: 'terminal_b' },
      { instance: 'd1', terminal: 'anode' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'd1', terminal: 'cathode' },
    ],
  })
  world.instances.set('bat', {
    id: 'bat',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(9, 'volt') },
    connects: [
      { net: 'vs', terminal: 'terminal_positive', of: 'bat' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
    ],
  })
  world.instances.set('r1', {
    id: 'r1',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(470, 'ohm') },
    connects: [
      { net: 'vs', terminal: 'terminal_a', of: 'r1' },
      { net: 'mid', terminal: 'terminal_b', of: 'r1' },
    ],
  })
  world.instances.set('d1', {
    id: 'd1',
    kind_ref: 'primitive_device',
    definition: 'led',
    parameters: {
      forward_voltage: scalar(2, 'volt'),
      max_forward_current: scalar(0.02, 'ampere'),
      peak_wavelength: scalar(640, 'nanometer'),
      thermal_resistance_junction_ambient: scalar(300, 'kelvin_per_watt'),
    },
    connects: [
      { net: 'mid', terminal: 'anode', of: 'd1' },
      { net: 'gnd', terminal: 'cathode', of: 'd1' },
    ],
  })
  return world
}

describe('solveElectroThermal', () => {
  test('a self-heating resistor walks to its electro-thermal fixed point', () => {
    // 0.25 W at θ 340 heats it ~85 °C; carbon-film α −500 ppm/K shrinks R; more
    // current → hotter → … converges at R ≈ 95.5 Ω, T ≈ 114 °C, I ≈ 52.3 mA.
    const result = solveElectroThermal(selfHeatingResistor({ alpha: -5e-4, thetaJa: 340 }))
    expect(result.solution.status).toBe('solved')
    expect(result.thermalConverged).toBe(true)
    expect(result.thermalIterations).toBeGreaterThanOrEqual(3)
    expect(result.temperaturesC.get('r1') ?? 0).toBeCloseTo(114, 0)
    expect(Math.abs(result.solution.branches.get('r1') ?? 0)).toBeCloseTo(0.0523, 3)
  })

  test('without thermal ratings it reduces to the plain DC solve, immediately settled', () => {
    const world = selfHeatingResistor({})
    const cold = solveDC(world)
    const result = solveElectroThermal(world)
    expect(result.thermalConverged).toBe(true)
    expect(result.thermalIterations).toBe(1)
    expect(result.solution.branches.get('r1')).toBeCloseTo(cold.branches.get('r1') ?? 0, 12)
  })

  test('a warm LED conducts more than the cold solve says (V_F falls with heat)', () => {
    const world = ledLoop()
    const cold = Math.abs(solveDC(world).branches.get('d1') ?? 0)
    const result = solveElectroThermal(world)
    const warm = Math.abs(result.solution.branches.get('d1') ?? 0)
    expect(result.thermalConverged).toBe(true)
    expect(warm).toBeGreaterThan(cold) // the junction warmed → V_F fell → more current
    expect(warm - cold).toBeLessThan(0.001) // …by a real, small amount (< 1 mA here)
    expect(result.temperaturesC.get('d1') ?? 0).toBeGreaterThan(30) // it did warm
  })

  test('thermal runaway / out-of-range tempco reports honestly instead of faking', () => {
    // α −4000 ppm/K at θ 1000: heating collapses the linear-model resistance past
    // zero — unphysical for the model, so it clamps, warns, and reports unsettled.
    const result = solveElectroThermal(selfHeatingResistor({ alpha: -4e-3, thetaJa: 1000 }))
    expect(result.thermalConverged).toBe(false)
    expect(result.warnings.some((w) => w.includes('out of range'))).toBe(true)
  })

  test('a MOSFET heats like any other rated part — V_DS·I_D through its θ_JA', () => {
    // 10 V supply → 100 Ω → drain; gate at 3.1 V (V_OV = 1 V, k = 26 mA/V², no λ)
    // → saturation: I_D = 13 mA exactly, V_DS = 10 − 1.3 = 8.7 V.
    // P = 8.7 V × 13 mA = 113.1 mW; θ_JA 312.5 → T = 25 + 35.34 = 60.34 °C.
    const nodes: CanvasNode[] = [
      {
        id: 'vdd',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(10, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      {
        id: 'vg',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(3.1, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      {
        id: 'm1',
        definition: 'transistor_mosfet_nmos',
        parameters: {
          threshold_voltage: scalar(2.1, 'volt'),
          transconductance_parameter: scalar(0.026, 'ampere_per_volt_squared'),
          thermal_resistance_junction_ambient: scalar(312.5, 'kelvin_per_watt'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ] as CanvasNode[]
    const edges = [
      {
        source: 'vdd',
        sourceHandle: 'terminal_positive',
        target: 'rload',
        targetHandle: 'terminal_a',
      },
      { source: 'rload', sourceHandle: 'terminal_b', target: 'm1', targetHandle: 'drain' },
      { source: 'm1', sourceHandle: 'source', target: 'vdd', targetHandle: 'terminal_negative' },
      { source: 'vg', sourceHandle: 'terminal_positive', target: 'm1', targetHandle: 'gate' },
      {
        source: 'vg',
        sourceHandle: 'terminal_negative',
        target: 'vdd',
        targetHandle: 'terminal_negative',
      },
      {
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'vdd',
        targetHandle: 'terminal_negative',
      },
    ]
    const result = solveElectroThermal(canvasToWorld(nodes, edges))
    expect(result.solution.status).toBe('solved')
    expect(result.thermalConverged).toBe(true)
    expect(result.temperaturesC.get('m1') ?? 0).toBeCloseTo(60.34, 1)
  })

  test('the live-canvas regression: a hot tempco resistor in an NMOS switch keeps KVL', () => {
    // The exact circuit a live verification flagged (2026-06-10): 9 V EMF with
    // 1 Ω inside, 470 Ω carbon-film resistor (α −500 ppm/K, θ_JA 340) into an
    // NMOS switch, gate tied to the battery terminal. The resistor runs ~58 °C
    // over ambient, drifts DOWN ~3%, and the loop current rises to ~19.4 mA —
    // a COLD hand-solve says 18.9 mA. The numbers must close the loop with the
    // HOT resistance: EMF = I·r + I·R(T) + V_DS.
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
      },
      {
        id: 'r1',
        definition: 'resistor',
        parameters: {
          resistance: scalar(470, 'ohm'),
          temperature_coefficient: scalar(-5e-4, 'per_kelvin'),
          thermal_resistance_junction_ambient: scalar(340, 'kelvin_per_watt'),
        },
      },
      {
        id: 'm1',
        definition: 'transistor_mosfet_nmos',
        parameters: {
          threshold_voltage: scalar(2.1, 'volt'),
          transconductance_parameter: scalar(0.026, 'ampere_per_volt_squared'),
          channel_length_modulation: scalar(0.02, 'per_volt'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ] as CanvasNode[]
    const edges = [
      {
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      { source: 'r1', sourceHandle: 'terminal_b', target: 'm1', targetHandle: 'drain' },
      { source: 'm1', sourceHandle: 'source', target: 'bat', targetHandle: 'terminal_negative' },
      { source: 'bat', sourceHandle: 'terminal_positive', target: 'm1', targetHandle: 'gate' },
      {
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
    ]
    const world = canvasToWorld(nodes, edges)
    const result = solveElectroThermal(world)
    expect(result.solution.status).toBe('solved')
    expect(result.thermalConverged).toBe(true)

    const current = Math.abs(result.solution.branches.get('r1') ?? 0)
    expect(current).toBeGreaterThan(0.019) // the hot answer…
    expect(current).toBeLessThan(0.0198) // …not the cold 18.9 mA

    const r1 = world.instances.get('r1')
    if (r1 === undefined) throw new Error('r1 missing')
    const hotOhms = resistanceAtTemperature(r1, result.temperaturesC.get('r1'))
    if (hotOhms === undefined) throw new Error('hot resistance missing')
    expect(hotOhms).toBeLessThan(460) // it really drifted

    // KVL around the loop with the values the solver USED. V_DS is read from
    // the solved nodes via the drain/source nets. The loop settles at ΔT <
    // 0.1 °C, so R(T_final) can differ from the R the last solve used by up to
    // ~0.024 Ω (≈0.5 mV here) — ±5 mV is far inside that AND 50× tighter than
    // the 270 mV cold-R inconsistency this test exists to catch.
    const netOf = (terminal: string) =>
      world.instances.get('m1')?.connects?.find((c) => c.terminal === terminal)?.net ?? ''
    const vDrain = result.solution.nodes.get(netOf('drain')) ?? Number.NaN
    const vSource = result.solution.nodes.get(netOf('source')) ?? Number.NaN
    const kvl = current * 1 + current * hotOhms + (vDrain - vSource)
    expect(kvl).toBeCloseTo(9, 2)
  })
})
