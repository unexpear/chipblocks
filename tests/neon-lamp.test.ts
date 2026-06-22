/**
 * Neon / gas-discharge lamp tests — the same strike/hold latch as the carbon arc, at neon voltages.
 * It STRIKES at its breakover (ignition) voltage, then glows at a lower MAINTAINING voltage and holds
 * until the current drops below the holding current (the strike-above-maintain hysteresis is what
 * makes a neon a relaxation oscillator). Settled through the discrete-state fixed point
 * (solveWithRelays); the external ballast sets the (tiny) current. These cover the strike, the
 * no-strike (below ignition), the holding-current dropout, and the glow voltage + light.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveWithRelays } from '../src/relay.ts'
import { type PartReading, partReadings } from '../src/renderer/part-readings.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/**
 * V+(supply) → R(ballastOhms) → neon.anode; neon.cathode → GND. Returns the settled latch state, the
 * lamp current, and the live reading. Neon defaults: glows at 65 V, strikes at 90 V, holds above
 * 0.1 mA, 0.5 lm/W.
 */
function solveNeon(
  supply: number,
  ballastOhms: number,
  startState: 'blocking' | 'conducting',
): { latch: string | undefined; current: number; reading: PartReading | undefined } {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  world.nets.set('va', {
    id: 'va',
    kind: 'net',
    members: [
      { instance: 'src', terminal: 'terminal_positive' },
      { instance: 'ballast', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('anode', {
    id: 'anode',
    kind: 'net',
    members: [
      { instance: 'ballast', terminal: 'terminal_b' },
      { instance: 'neon', terminal: 'anode' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'src', terminal: 'terminal_negative' },
      { instance: 'neon', terminal: 'cathode' },
    ],
  })
  world.instances.set('src', {
    id: 'src',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(supply, 'volt') },
    connects: [
      { net: 'va', terminal: 'terminal_positive', of: 'src' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'src' },
    ],
  })
  world.instances.set('ballast', {
    id: 'ballast',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(ballastOhms, 'ohm') },
    connects: [
      { net: 'va', terminal: 'terminal_a', of: 'ballast' },
      { net: 'anode', terminal: 'terminal_b', of: 'ballast' },
    ],
  })
  world.instances.set('neon', {
    id: 'neon',
    kind_ref: 'primitive_device',
    definition: 'neon_lamp',
    parameters: {
      maintaining_voltage: scalar(65, 'volt'),
      breakover_voltage: scalar(90, 'volt'),
      holding_current: scalar(0.0001, 'ampere'),
      luminous_efficacy: scalar(0.5, 'lm/W'),
      device_state: { value: startState },
    },
    connects: [
      { net: 'anode', terminal: 'anode', of: 'neon' },
      { net: 'gnd', terminal: 'cathode', of: 'neon' },
    ],
  })
  const result = solveWithRelays(world)
  return {
    latch: result.shockleyStates.get('neon'),
    current: Math.abs(result.solution.branches.get('neon') ?? 0),
    reading: partReadings(world, result.solution).get('neon'),
  }
}

describe('neon lamp — strike / hold latch', () => {
  test('a supply above the striking voltage lights it; the ballast sets the tiny glow current', () => {
    const r = solveNeon(120, 50000, 'blocking') // 120 V ≥ 90 V strikes; (120 − 65)/50k = 1.1 mA
    expect(r.latch).toBe('conducting')
    expect(r.current).toBeCloseTo(0.0011, 4)
  })

  test('below the striking voltage it stays dark (blocking)', () => {
    const r = solveNeon(80, 50000, 'blocking') // 80 V < 90 V → never strikes
    expect(r.latch).toBe('blocking')
    expect(r.current).toBeLessThan(1e-6)
  })

  test('a lit lamp goes dark when starved below the holding current (no re-strike)', () => {
    // Supply 68 V (below the 90 V strike, so it cannot re-ignite): it glows 65 V, leaving only
    // (68 − 65)/50k = 0.06 mA < the 0.1 mA holding current, so the glow collapses and stays dark.
    const r = solveNeon(68, 50000, 'conducting')
    expect(r.latch).toBe('blocking')
  })
})

describe('neon lamp — glow voltage + light', () => {
  test('a struck lamp glows at its maintaining voltage (below the strike) and makes a little light', () => {
    const r = solveNeon(120, 50000, 'conducting')
    expect(r.reading?.voltage ?? 0).toBeCloseTo(65, 1) // the maintaining voltage
    expect(r.reading?.voltage ?? 99).toBeLessThan(90) // runs below the strike voltage — the hysteresis
    expect(r.reading?.luminousFluxLm ?? -1).toBeGreaterThan(0) // dim, but lit: 0.5 lm/W × 65 V × 1.1 mA
  })

  test('a dark lamp makes no light', () => {
    const r = solveNeon(80, 50000, 'blocking')
    expect(r.reading?.luminousFluxLm ?? 0).toBe(0)
  })
})
