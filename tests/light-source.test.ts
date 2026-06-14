/**
 * Light source + distance casting tests (S21-v3-8). A light_source casts
 * illuminance onto the sensors around it by the inverse-square law E = I/d²
 * (I candela, d metres, 1 px = 1 mm), the contributions adding. worldWithCastLight
 * folds each sensor's incident illuminance (ambient + cast) into the world before
 * the solve, so a photoresistor dragged toward a lamp really does drop in
 * resistance. This is the one place canvas POSITION carries physics.
 */

import { describe, expect, test } from 'vitest'
import type { Instance, World } from '../src/cross-fk-validator.ts'
import {
  castIlluminance,
  LIGHT_PX_PER_METRE,
  type LightSource,
  ldrResistance,
  sensorIlluminance,
  worldWithCastLight,
} from '../src/light.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

describe('castIlluminance — the inverse-square law E = I/d²', () => {
  test('a 10 cd source 100 px (0.1 m) away casts 1000 lux', () => {
    const sources: LightSource[] = [{ x: 0, y: 0, intensityCandela: 10 }]
    // d = 100 px = 0.1 m → E = 10 / 0.1² = 1000 lux.
    expect(castIlluminance({ x: 100, y: 0 }, sources)).toBeCloseTo(1000, 6)
  })

  test('twice the distance is a quarter the light (the inverse square)', () => {
    const sources: LightSource[] = [{ x: 0, y: 0, intensityCandela: 10 }]
    const near = castIlluminance({ x: 100, y: 0 }, sources)
    const far = castIlluminance({ x: 200, y: 0 }, sources)
    expect(far).toBeCloseTo(near / 4, 6) // 250 lux
    expect(far).toBeCloseTo(250, 6)
  })

  test('two sources add (superposition of light)', () => {
    const a: LightSource = { x: 0, y: 0, intensityCandela: 10 }
    const b: LightSource = { x: 200, y: 0, intensityCandela: 10 }
    // The midpoint (100,0) is 0.1 m from each → 1000 + 1000 = 2000 lux.
    expect(castIlluminance({ x: 100, y: 0 }, [a, b])).toBeCloseTo(2000, 6)
  })

  test('no sources → no cast light', () => {
    expect(castIlluminance({ x: 50, y: 50 }, [])).toBe(0)
  })

  test('a sensor sitting on the lamp gets a large but FINITE illuminance (no singularity)', () => {
    const e = castIlluminance({ x: 0, y: 0 }, [{ x: 0, y: 0, intensityCandela: 10 }])
    expect(Number.isFinite(e)).toBe(true)
    expect(e).toBeGreaterThan(1e6) // clamped at the 2 mm floor: 10 / 0.002² = 2.5e6 lux
  })

  test('the canvas scale is 1 px = 1 mm', () => {
    expect(LIGHT_PX_PER_METRE).toBe(1000)
  })
})

/** A GL5528-class LDR instance sitting in a given ambient (lux). */
function ldr(ambientLux: number): Instance {
  return {
    id: 'ldr',
    definition: 'photoresistor',
    parameters: {
      reference_resistance: scalar(12000, 'ohm'),
      reference_illuminance: scalar(10, 'lux'),
      gamma: scalar(0.6, 'dimensionless'),
      dark_resistance: scalar(1000000, 'ohm'),
      ambient_illuminance: scalar(ambientLux, 'lux'),
    },
  } as unknown as Instance
}

const worldOf = (inst: Instance): World =>
  ({ instances: new Map([[inst.id, inst]]), nets: new Map() }) as unknown as World

describe('worldWithCastLight folds the cast into each sensor', () => {
  test('a sensor near a lamp sees ambient + cast as its incident light', () => {
    const world = worldOf(ldr(100))
    const positions = new Map([['ldr', { x: 100, y: 0 }]])
    const sources: LightSource[] = [{ x: 0, y: 0, intensityCandela: 10 }] // casts 1000 lux
    const lit = worldWithCastLight(world, positions, sources)
    // incident = 100 ambient + 1000 cast = 1100 lux.
    expect(sensorIlluminance(lit.instances.get('ldr') as Instance)).toBeCloseTo(1100, 6)
  })

  test('the lamp drops the resistance: nearer is brighter is lower-R', () => {
    const positions = (px: number) => new Map([['ldr', { x: px, y: 0 }]])
    const sources: LightSource[] = [{ x: 0, y: 0, intensityCandela: 10 }]
    const near = ldrResistance(
      worldWithCastLight(worldOf(ldr(100)), positions(100), sources).instances.get(
        'ldr',
      ) as Instance,
    )
    const far = ldrResistance(
      worldWithCastLight(worldOf(ldr(100)), positions(400), sources).instances.get(
        'ldr',
      ) as Instance,
    )
    const dark = ldrResistance(ldr(100)) // ambient only, no lamp
    expect(near ?? 0).toBeLessThan(far ?? 0) // closer to the lamp = lower resistance
    expect(far ?? 0).toBeLessThan(dark ?? Number.POSITIVE_INFINITY) // any cast lowers it vs ambient alone
  })

  test('no sources → incident equals the ambient (a plain copy, lamp-free behaviour)', () => {
    const lit = worldWithCastLight(worldOf(ldr(250)), new Map([['ldr', { x: 0, y: 0 }]]), [])
    expect(sensorIlluminance(lit.instances.get('ldr') as Instance)).toBeCloseTo(250, 6)
  })

  test('a non-sensor part is never touched by the light pass', () => {
    const resistor = {
      id: 'r1',
      definition: 'resistor',
      parameters: { resistance: scalar(1000, 'ohm') },
    } as unknown as Instance
    const lit = worldWithCastLight(worldOf(resistor), new Map([['r1', { x: 100, y: 0 }]]), [
      { x: 0, y: 0, intensityCandela: 10 },
    ])
    expect(lit.instances.get('r1')?.parameters?.incident_illuminance).toBeUndefined()
  })

  test('a sensor with no known position stays at its ambient (e.g. inside a block)', () => {
    const lit = worldWithCastLight(worldOf(ldr(100)), new Map(), [
      { x: 0, y: 0, intensityCandela: 10 },
    ])
    expect(sensorIlluminance(lit.instances.get('ldr') as Instance)).toBeCloseTo(100, 6)
  })
})
