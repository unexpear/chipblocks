/**
 * Photodiode + phototransistor tests (S21-v3-9) — the light-driven CURRENT
 * sensors (vs the LDR's resistance). A photodiode sources I = responsivity·E;
 * a phototransistor amplifies that by β, I_C = β·responsivity·E. Both read the
 * same incident illuminance the LDR does (ambient + any cast), and both stamp as
 * a current source in parallel with their shunt resistance.
 */

import { describe, expect, test } from 'vitest'
import type { Instance } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'
import { lightSensorCurrent, worldWithCastLight } from '../src/light.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const photodiode = (perLux: number, ambientLux: number): Instance =>
  ({
    id: 'pd',
    definition: 'photodiode',
    parameters: {
      photocurrent_per_lux: scalar(perLux, 'ampere_per_lux'),
      ambient_illuminance: scalar(ambientLux, 'lux'),
    },
  }) as unknown as Instance

describe('lightSensorCurrent — light into current', () => {
  test('a photodiode sources responsivity · E', () => {
    // 1e-8 A/lux × 1000 lux = 1e-5 A (10 µA).
    expect(lightSensorCurrent(photodiode(1e-8, 1000))).toBeCloseTo(1e-5, 12)
  })

  test('it is linear in the light: double the lux, double the current', () => {
    const dim = lightSensorCurrent(photodiode(1e-8, 500))
    const bright = lightSensorCurrent(photodiode(1e-8, 1000))
    expect(bright).toBeCloseTo(2 * dim, 12)
  })

  test('a phototransistor amplifies the base photocurrent by β', () => {
    const pt = {
      id: 'pt',
      definition: 'phototransistor',
      parameters: {
        photocurrent_per_lux: scalar(1e-8, 'ampere_per_lux'),
        current_gain: scalar(300, 'dimensionless'),
        ambient_illuminance: scalar(1000, 'lux'),
      },
    } as unknown as Instance
    // 300 × 1e-8 × 1000 = 3e-3 A (3 mA) — hundreds× the bare photodiode.
    expect(lightSensorCurrent(pt)).toBeCloseTo(3e-3, 9)
  })

  test('no responsivity → no current', () => {
    const bare = { id: 'pd', definition: 'photodiode', parameters: {} } as unknown as Instance
    expect(lightSensorCurrent(bare)).toBe(0)
  })

  test('the cast incident light is used over the ambient when present', () => {
    const inst = photodiode(1e-8, 100)
    // worldWithCastLight writes incident = ambient + cast; lightSensorCurrent reads it.
    const lit = worldWithCastLight(
      { instances: new Map([['pd', inst]]), nets: new Map() } as never,
      new Map([['pd', { x: 100, y: 0 }]]),
      [{ x: 0, y: 0, intensityCandela: 10 }], // casts 1000 lux at 0.1 m
    )
    // incident = 100 + 1000 = 1100 lux → 1.1e-5 A.
    expect(lightSensorCurrent(lit.instances.get('pd') as Instance)).toBeCloseTo(1.1e-5, 12)
  })
})

/** V+ (ideal) → load R → sensor → ground. The sensor sources its photocurrent
 *  through the load, so the load carries the photocurrent and drops I·R. */
function lightSensorRig(
  definition: 'photodiode' | 'phototransistor',
  loadOhms: number,
  params: Record<string, { value: unknown }>,
) {
  const [hi, lo] =
    definition === 'phototransistor' ? ['collector', 'emitter'] : ['cathode', 'anode']
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(5, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(loadOhms, 'ohm') } },
    { id: 'sensor', definition, parameters: { ...params, shunt_resistance: scalar(1e12, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    {
      source: 'src',
      sourceHandle: 'terminal_positive',
      target: 'rload',
      targetHandle: 'terminal_a',
    },
    { source: 'rload', sourceHandle: 'terminal_b', target: 'sensor', targetHandle: hi },
    { source: 'sensor', sourceHandle: lo, target: 'src', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

describe('the photocurrent drives a real circuit', () => {
  test('a photodiode pushes its photocurrent through the load (I = responsivity·E)', () => {
    // 1e-8 A/lux × 1000 lux = 10 µA through 100 kΩ → 1 V across the load.
    const world = lightSensorRig('photodiode', 100000, {
      photocurrent_per_lux: scalar(1e-8, 'ampere_per_lux'),
      ambient_illuminance: scalar(1000, 'lux'),
    })
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('sensor') ?? 0)).toBeCloseTo(1e-5, 9) // the photocurrent
    expect(Math.abs(solution.branches.get('rload') ?? 0)).toBeCloseTo(1e-5, 8) // load carries it
  })

  test('brighter light → more photocurrent → more drop across the load', () => {
    const dim = Math.abs(
      solveDC(
        lightSensorRig('photodiode', 100000, {
          photocurrent_per_lux: scalar(1e-8, 'ampere_per_lux'),
          ambient_illuminance: scalar(500, 'lux'),
        }),
      ).branches.get('sensor') ?? 0,
    )
    const bright = Math.abs(
      solveDC(
        lightSensorRig('photodiode', 100000, {
          photocurrent_per_lux: scalar(1e-8, 'ampere_per_lux'),
          ambient_illuminance: scalar(2000, 'lux'),
        }),
      ).branches.get('sensor') ?? 0,
    )
    expect(bright).toBeCloseTo(4 * dim, 9) // 4× the light → 4× the current
  })

  test('a phototransistor sources β× the photodiode current for the same light', () => {
    // 300 × 1e-8 × 1000 = 3 mA through 1 kΩ → 3 V across the load.
    const world = lightSensorRig('phototransistor', 1000, {
      photocurrent_per_lux: scalar(1e-8, 'ampere_per_lux'),
      current_gain: scalar(300, 'dimensionless'),
      ambient_illuminance: scalar(1000, 'lux'),
    })
    const solution = solveDC(world)
    expect(solution.status).toBe('solved')
    expect(Math.abs(solution.branches.get('sensor') ?? 0)).toBeCloseTo(3e-3, 7)
  })
})
