/**
 * Incandescent bulb tests — a tungsten-filament lamp wired into the circuit: a
 * temperature-dependent resistor that self-heats until it glows, solved inside the
 * electro-thermal fixed point. Two coupled laws:
 *   - resistance RISES with temperature, R(T) = R_op·(T/T_op)^1.2 (the opposite of
 *     the NTC thermistor) — so a cold filament is ~14× lower-resistance (inrush);
 *   - the filament is RADIATION-cooled, T = (T_amb⁴ + P/k)^¼, not conduction-cooled,
 *     so its temperature climbs only as the fourth root of power.
 */

import { describe, expect, test } from 'vitest'
import type { Instance } from '../src/cross-fk-validator.ts'
import {
  resistanceAtTemperature,
  solveElectroThermal,
  solveTransientThermal,
  tungstenResistance,
  worldAtAmbient,
} from '../src/electro-thermal.ts'
import { detectFailures } from '../src/failure-detector.ts'
import { readScalarParam } from '../src/instance-params.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { canvasHealth, incandescentColor } from '../src/renderer/health.ts'
import { defaultParameters, primaryValue } from '../src/renderer/part-defaults.ts'
import { bulbFilamentTemperatureC, filamentTemperatureC } from '../src/thermal-model.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** A 120 V / 60 W household incandescent: hot R = V²/P = 240 Ω at the ~2700 K
 *  (2427 °C) operating filament temperature. */
const BULB = {
  resistance: scalar(240, 'ohm'),
  reference_temperature: scalar(2427, 'celsius'),
  rated_power: scalar(60, 'watt'),
  rated_voltage: scalar(120, 'volt'),
  max_operating_temperature: scalar(2900, 'celsius'),
  filament_material: { value: 'tungsten' },
}

function bulbInst(): Instance {
  return {
    id: 'b',
    definition: 'incandescent_bulb',
    parameters: { ...BULB },
  } as unknown as Instance
}

describe('the tungsten power law R(T) = R_op·(T/T_op)^1.2', () => {
  test('at the operating temperature the resistance is exactly R_op', () => {
    expect(tungstenResistance(bulbInst(), 2427)).toBeCloseTo(240, 6)
  })

  test('cold → far lower resistance (the switch-on inrush), ~14× below hot', () => {
    const cold = tungstenResistance(bulbInst(), 25) ?? Number.NaN
    expect(cold).toBeLessThan(240)
    expect(240 / cold).toBeGreaterThan(10) // tungsten cold/hot ratio ~14
    expect(240 / cold).toBeLessThan(18)
  })

  test('warmer → higher resistance (the positive coefficient)', () => {
    expect(tungstenResistance(bulbInst(), 2700) ?? 0).toBeGreaterThan(240)
  })

  test('resistanceAtTemperature routes the bulb through the tungsten law', () => {
    expect(resistanceAtTemperature(bulbInst(), 1500)).toBeCloseTo(
      tungstenResistance(bulbInst(), 1500) ?? 0,
      9,
    )
  })

  test('a bulb missing its resistance has no law', () => {
    const bare = { id: 'b', definition: 'incandescent_bulb', parameters: {} } as unknown as Instance
    expect(tungstenResistance(bare, 1500)).toBeUndefined()
  })
})

describe('the radiation-cooled filament temperature T = (T_amb⁴ + P/k)^¼', () => {
  test('at rated power the filament sits at exactly its operating temperature', () => {
    expect(filamentTemperatureC(60, 60, 2427, 25)).toBeCloseTo(2427, 6)
  })

  test('fourth-root law: a quarter of rated power is FAR above a quarter of the rise', () => {
    const quarter = filamentTemperatureC(15, 60, 2427, 25)
    // A linear (P·θ) law would give ~25 + 0.25·2402 ≈ 626 °C; the T⁴ law keeps it
    // far hotter — the bulb barely dims when the drive is cut.
    expect(quarter).toBeGreaterThan(1400)
    expect(quarter).toBeLessThan(2427)
  })

  test('no power → ambient (an unlit bulb is cold)', () => {
    expect(filamentTemperatureC(0, 60, 2427, 25)).toBeCloseTo(25, 6)
    expect(filamentTemperatureC(0, 60, 2427, 40)).toBeCloseTo(40, 6)
  })

  test('bulbFilamentTemperatureC reads the rated point off the instance', () => {
    expect(bulbFilamentTemperatureC(bulbInst(), 60)).toBeCloseTo(2427, 6)
  })
})

/** 120 V straight across the bulb (no series R), the bulb returning to the source. */
function bulbRig(voltage: number) {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(voltage, 'volt'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    { id: 'b', definition: 'incandescent_bulb', parameters: { ...BULB } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'src', sourceHandle: 'terminal_positive', target: 'b', targetHandle: 'terminal_a' },
    { source: 'b', sourceHandle: 'terminal_b', target: 'src', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

describe('self-heating to incandescence inside the electro-thermal loop', () => {
  test('120 V drives the filament to ~2427 °C and the hot ~240 Ω operating point', () => {
    const world = bulbRig(120)
    const result = solveElectroThermal(world)
    expect(result.solution.status).toBe('solved')
    expect(result.thermalConverged).toBe(true)
    const t = result.temperaturesC.get('b') ?? 0
    expect(t).toBeGreaterThan(2300)
    expect(t).toBeLessThan(2550) // ~2427 °C
    const hotR = resistanceAtTemperature(world.instances.get('b') as Instance, t) ?? 0
    expect(hotR).toBeGreaterThan(220)
    expect(hotR).toBeLessThan(260) // ~240 Ω
    expect(Math.abs(result.solution.branches.get('b') ?? 0)).toBeCloseTo(0.5, 1) // 120 V / 240 Ω
  })

  test('dimming it (60 V) runs the filament cooler — but nowhere near halved', () => {
    const t = solveElectroThermal(bulbRig(60)).temperaturesC.get('b') ?? 0
    expect(t).toBeLessThan(2427) // cooler than rated
    expect(t).toBeGreaterThan(1700) // but far above half the rated rise — the T⁴ law
  })

  test('both engines agree on the self-heated filament temperature', () => {
    const world = bulbRig(120)
    const dc = solveElectroThermal(world).temperaturesC.get('b') ?? 0
    const tr =
      solveTransientThermal(world, { timeStep: 1e-4, duration: 6e-3 }).temperaturesC.get('b') ?? -1
    expect(Math.abs(tr - dc)).toBeLessThan(5)
  })
})

describe('the powered-off ohmmeter reads the COLD filament resistance', () => {
  test('worldAtAmbient sets the bulb to its cold ~17 Ω, not the hot 240 Ω', () => {
    const adjusted = worldAtAmbient(bulbRig(120), 25)
    const r = readScalarParam(adjusted.instances.get('b') as Instance, 'resistance') ?? 0
    expect(r).toBeLessThan(25) // cold filament, ~17 Ω
    expect(r).toBeGreaterThan(10)
  })
})

describe('burnout — over-voltage drives the filament past its rated temperature', () => {
  test('double the rated voltage fires the over-temperature (burnout) failure', () => {
    const world = bulbRig(240)
    const result = solveElectroThermal(world)
    const overtemp = detectFailures(world, result.solution).find(
      (f) => f.source === 'b' && f.code === 'part-overtemperature',
    )
    expect(overtemp).toBeDefined()
  })

  test('at rated voltage the bulb is within its temperature rating (no failure)', () => {
    const world = bulbRig(120)
    const result = solveElectroThermal(world)
    expect(detectFailures(world, result.solution).find((f) => f.source === 'b')).toBeUndefined()
  })
})

describe('the bulb glows the color of its filament temperature', () => {
  test('a lit bulb is lit, with a blackbody glow color', () => {
    const world = bulbRig(120)
    const health = canvasHealth(world, solveElectroThermal(world).solution)
    expect(health.get('b')?.lit).toBe(true)
    expect(health.get('b')?.glow).toMatch(/^rgb\(/)
  })

  test('the glow shifts toward white as the filament heats (color temperature)', () => {
    const greenOf = (s: string) => Number(/rgb\((\d+), (\d+), (\d+)\)/.exec(s)?.[2] ?? 0)
    // 1200 °C is a dull orange-red; 2400 °C is warm white — whiter = more green.
    expect(greenOf(incandescentColor(2400))).toBeGreaterThan(greenOf(incandescentColor(1200)))
  })
})

describe('a dropped bulb gets real defaults + a nameplate headline', () => {
  test('defaultParameters fills the operating point (solver + glow + burnout)', () => {
    const p = defaultParameters('incandescent_bulb')
    expect(p.resistance?.value).toEqual({ kind: 'scalar', amount: 240, unit: 'ohm' })
    expect(p.rated_power?.value).toEqual({ kind: 'scalar', amount: 60, unit: 'watt' })
    expect(p.reference_temperature?.value).toEqual({
      kind: 'scalar',
      amount: 2427,
      unit: 'celsius',
    })
    expect(p.filament_material?.value).toBe('tungsten')
  })

  test('the headline is the nameplate (wattage · voltage)', () => {
    expect(primaryValue('incandescent_bulb', defaultParameters('incandescent_bulb'))).toBe(
      '60.0 W · 120 V',
    )
  })
})
