/**
 * Thermistor tests (S21-v3-5) — the NTC temperature sensor whose resistance
 * follows the Beta equation R(T) = R₀·exp(B·(1/T − 1/T₀)) on its OWN solved
 * temperature (its ambient plus self-heating), inside the electro-thermal fixed
 * point. The exponential branch beside the resistor's linear tempco.
 */

import { describe, expect, test } from 'vitest'
import type { Instance } from '../src/cross-fk-validator.ts'
import {
  resistanceAtTemperature,
  solveElectroThermal,
  solveTransientThermal,
  thermistorResistance,
  worldAtAmbient,
} from '../src/electro-thermal.ts'
import { readScalarParam } from '../src/instance-params.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const R0 = 10000
const B = 3977
/** The Beta law written out independently, for cross-checking the implementation. */
const betaAt = (tC: number) => R0 * Math.exp(B * (1 / (tC + 273.15) - 1 / (25 + 273.15)))

/** A bare NTC instance (R25 = 10 kΩ, B = 3977 K) for the pure-law tests. */
function ntc(): Instance {
  return {
    id: 'th',
    definition: 'thermistor',
    parameters: {
      resistance: scalar(R0, 'ohm'),
      beta_coefficient: scalar(B, 'kelvin'),
      reference_temperature: scalar(25, 'celsius'),
    },
  } as unknown as Instance
}

describe('the Beta law R(T) = R₀·exp(B·(1/T − 1/T₀))', () => {
  test('at the reference temperature the resistance is exactly R₀', () => {
    expect(thermistorResistance(ntc(), 25)).toBeCloseTo(R0, 6)
  })

  test('warmer → lower resistance (the negative coefficient), matching the law', () => {
    const hot = thermistorResistance(ntc(), 85) ?? Number.NaN
    expect(hot).toBeCloseTo(betaAt(85), 6)
    expect(hot).toBeLessThan(R0)
    // Datasheet sanity: NTCLE100E3103 R85/R25 ≈ 0.107 → ~1070 Ω.
    expect(hot).toBeGreaterThan(1000)
    expect(hot).toBeLessThan(1150)
  })

  test('colder → higher resistance', () => {
    expect(thermistorResistance(ntc(), 0) ?? 0).toBeGreaterThan(R0)
  })

  test('resistanceAtTemperature routes a thermistor through the Beta law', () => {
    expect(resistanceAtTemperature(ntc(), 60)).toBeCloseTo(thermistorResistance(ntc(), 60) ?? 0, 9)
  })

  test('a thermistor missing R₀ or B has no resistance law', () => {
    const bare = { id: 'th', definition: 'thermistor', parameters: {} } as unknown as Instance
    expect(thermistorResistance(bare, 50)).toBeUndefined()
  })
})

/** 9 V → thermistor → ground. By default the thermistor carries its own θ_JA so it self-heats;
 *  pass omitThetaJa to drop it — testing that a placed ambient alone still drives the resistance. */
function selfHeatRig(seriesOhms: number, ambientC?: number, omitThetaJa?: boolean) {
  const params: Record<string, { value?: unknown; ref?: string }> = {
    resistance: scalar(R0, 'ohm'),
    beta_coefficient: scalar(B, 'kelvin'),
    reference_temperature: scalar(25, 'celsius'),
  }
  if (!omitThetaJa) params.thermal_resistance_junction_ambient = scalar(667, 'kelvin_per_watt')
  if (ambientC !== undefined) params.ambient_temperature = scalar(ambientC, 'celsius')
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    { id: 'rs', definition: 'resistor', parameters: { resistance: scalar(seriesOhms, 'ohm') } },
    { id: 'th', definition: 'thermistor', parameters: params },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'src', sourceHandle: 'terminal_positive', target: 'rs', targetHandle: 'terminal_a' },
    { source: 'rs', sourceHandle: 'terminal_b', target: 'th', targetHandle: 'terminal_a' },
    { source: 'th', sourceHandle: 'terminal_b', target: 'src', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

describe('self-heating drives an NTC down inside the electro-thermal loop', () => {
  test('current through it warms it above ambient and its resistance falls below R₀', () => {
    // 9 V across the 10 kΩ NTC through a negligible 1 Ω: ~0.9 mA → a few mW → a
    // few °C of self-heating → R drops, raising the current to a fixed point.
    const world = selfHeatRig(1)
    const result = solveElectroThermal(world)
    expect(result.solution.status).toBe('solved')
    const temp = result.temperaturesC.get('th') ?? 25
    expect(temp).toBeGreaterThan(28) // self-heated above the 25 °C ambient
    const hotR = resistanceAtTemperature(world.instances.get('th') as Instance, temp) ?? Number.NaN
    expect(hotR).toBeLessThan(R0) // the NTC fell from its cold value
    // More current than the cold 0.9 mA, because the resistance dropped.
    expect(Math.abs(result.solution.branches.get('th') ?? 0)).toBeGreaterThan(9 / R0)
  })
})

describe('the ambient knob places the thermistor in a warmer spot', () => {
  test('a near-zero-current NTC at 85 °C ambient settles at 85 °C with R ≈ R(85)', () => {
    // A 1 MΩ series resistor keeps the current to ~9 µA, so self-heating is
    // negligible and the thermistor reads its ambient (85 °C).
    const world = selfHeatRig(1e6, 85)
    const result = solveElectroThermal(world)
    expect(result.solution.status).toBe('solved')
    expect(result.temperaturesC.get('th') ?? 25).toBeCloseTo(85, 1)
    const r = resistanceAtTemperature(
      world.instances.get('th') as Instance,
      result.temperaturesC.get('th') ?? 85,
    )
    expect(r ?? 0).toBeCloseTo(betaAt(85), 0)
  })
})

describe('the ambient knob works without a θ_JA (a placed environment, no self-heating)', () => {
  test('DC: a thermistor with ambient set but no θ_JA reads R at that ambient, not R₀', () => {
    // 85 °C ambient, NO θ_JA, ~9 µA so self-heating is moot anyway — the ambient must take effect
    // on its own. Before the fix this thermistor was skipped (no θ_JA) and stayed at R₀ (25 °C).
    const world = selfHeatRig(1e6, 85, true)
    const result = solveElectroThermal(world)
    expect(result.solution.status).toBe('solved')
    expect(result.temperaturesC.get('th') ?? 25).toBeCloseTo(85, 1)
    const r = resistanceAtTemperature(
      world.instances.get('th') as Instance,
      result.temperaturesC.get('th') ?? 85,
    )
    expect(r ?? 0).toBeCloseTo(betaAt(85), 0)
    expect(r ?? 0).toBeLessThan(R0) // the NTC fell below its 25 °C R₀
  })

  test('transient: the scope agrees — the same ambient-only thermistor settles at 85 °C', () => {
    const world = selfHeatRig(1e6, 85, true)
    const tr = solveTransientThermal(world, { timeStep: 1e-4, duration: 3e-3 })
    expect(tr.temperaturesC.get('th') ?? 25).toBeCloseTo(85, 1)
  })
})

describe('a project-wide ambient places parts that set no ambient of their own', () => {
  test('DC: a thermistor with no own ambient inherits the 85 °C project ambient → R(85)', () => {
    const world = selfHeatRig(1e6) // θ_JA present, NO own ambient, ~9 µA so self-heating is negligible
    const result = solveElectroThermal(world, { projectAmbientC: 85 })
    expect(result.solution.status).toBe('solved')
    expect(result.temperaturesC.get('th') ?? 25).toBeCloseTo(85, 0)
    const r = resistanceAtTemperature(
      world.instances.get('th') as Instance,
      result.temperaturesC.get('th') ?? 85,
    )
    expect(r ?? 0).toBeCloseTo(betaAt(85), 0)
  })

  test('DC: the project ambient reaches a θ_JA-less thermistor too (placement, no self-heating)', () => {
    const world = selfHeatRig(1e6, undefined, true) // no θ_JA, no own ambient
    const result = solveElectroThermal(world, { projectAmbientC: 85 })
    expect(result.temperaturesC.get('th') ?? 25).toBeCloseTo(85, 1)
  })

  test("a part's own ambient_temperature overrides the project ambient", () => {
    const world = selfHeatRig(1e6, 50) // own ambient 50 °C, θ_JA present
    const result = solveElectroThermal(world, { projectAmbientC: 85 })
    expect(result.temperaturesC.get('th') ?? 0).toBeCloseTo(50, 0) // own 50 wins over project 85
  })

  test('transient: the scope inherits the same project ambient', () => {
    const world = selfHeatRig(1e6)
    const tr = solveTransientThermal(world, { timeStep: 1e-4, duration: 3e-3, projectAmbientC: 85 })
    expect(tr.temperaturesC.get('th') ?? 25).toBeCloseTo(85, 0)
  })
})

describe('worldAtAmbient — the powered-off ohmmeter reads R(board ambient)', () => {
  test('a thermistor with no own ambient is set to R(85) under an 85 °C board ambient', () => {
    const adjusted = worldAtAmbient(selfHeatRig(1e6), 85)
    const r = readScalarParam(adjusted.instances.get('th') as Instance, 'resistance')
    expect(r ?? 0).toBeCloseTo(betaAt(85), 0) // R(85), not the 25 °C nominal R₀
  })
})

describe('both engines agree on the self-heated thermistor', () => {
  test('the transient steady-state temperature matches the DC loop', () => {
    const world = selfHeatRig(1)
    const dc = solveElectroThermal(world)
    const tr = solveTransientThermal(world, { timeStep: 1e-4, duration: 3e-3 })
    expect(tr.temperaturesC.get('th') ?? 25).toBeCloseTo(dc.temperaturesC.get('th') ?? 0, 0)
  })
})
