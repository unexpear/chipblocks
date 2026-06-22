/**
 * Carbon arc lamp tests — the strike/hold latch + the burning arc + its light. The arc is the
 * Shockley bistable latch (it STRIKES at its breakover/ignition voltage and HOLDS until the current
 * drops below the holding current), settled through the discrete-state fixed point (solveWithRelays);
 * once struck it burns at a fixed arc voltage, the external ballast setting the current. These cover
 * the strike, the no-strike (below ignition), the hold/extinguish, the burning voltage + light, and
 * that it needs a ballast (the current is what the ballast allows).
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveWithRelays } from '../src/relay.ts'
import { type PartReading, partReadings } from '../src/renderer/part-readings.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/**
 * V+(supply) → R(ballastOhms) → arc.anode; arc.cathode → GND. Returns the settled latch state, the
 * arc current, and the live reading. Arc defaults: burns at 50 V, strikes at 60 V, holds above 0.5 A,
 * 15 lm/W.
 */
function solveArc(
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
      { instance: 'arc', terminal: 'anode' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'src', terminal: 'terminal_negative' },
      { instance: 'arc', terminal: 'cathode' },
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
  world.instances.set('arc', {
    id: 'arc',
    kind_ref: 'primitive_device',
    definition: 'arc_lamp',
    parameters: {
      arc_voltage: scalar(50, 'volt'),
      breakover_voltage: scalar(60, 'volt'),
      holding_current: scalar(0.5, 'ampere'),
      luminous_efficacy: scalar(15, 'lm/W'),
      device_state: { value: startState },
    },
    connects: [
      { net: 'anode', terminal: 'anode', of: 'arc' },
      { net: 'gnd', terminal: 'cathode', of: 'arc' },
    ],
  })
  const result = solveWithRelays(world)
  return {
    latch: result.shockleyStates.get('arc'),
    current: Math.abs(result.solution.branches.get('arc') ?? 0),
    reading: partReadings(world, result.solution).get('arc'),
  }
}

describe('arc lamp — strike / hold latch', () => {
  test('a supply at/above the ignition voltage strikes it, and it conducts', () => {
    const r = solveArc(80, 10, 'blocking') // 80 V ≥ 60 V strikes; (80 − 50)/10 = 3 A through the ballast
    expect(r.latch).toBe('conducting')
    expect(r.current).toBeCloseTo(3, 3)
  })

  test('below the ignition voltage it stays dark (blocking)', () => {
    const r = solveArc(40, 10, 'blocking') // 40 V < 60 V → never strikes
    expect(r.latch).toBe('blocking')
    expect(r.current).toBeLessThan(1e-6)
  })

  test('a struck arc extinguishes when starved below the holding current (no re-strike)', () => {
    // Supply 52 V (below the 60 V strike, so it cannot re-ignite): the arc burns 50 V, leaving only
    // (52 − 50)/10 = 0.2 A ≪ the 0.5 A holding current, so the ionized column collapses and stays out.
    const r = solveArc(52, 10, 'conducting')
    expect(r.latch).toBe('blocking')
  })

  test('the ballast sets the current — a stiffer ballast burns the same arc dimmer', () => {
    const bright = solveArc(80, 10, 'conducting') // 3 A
    const dim = solveArc(80, 30, 'conducting') // (80 − 50)/30 = 1 A
    expect(bright.current).toBeCloseTo(3, 3)
    expect(dim.current).toBeCloseTo(1, 3)
  })
})

describe('arc lamp — burning voltage, power + light', () => {
  test('a struck arc burns at ~its arc voltage and reports its power and light output', () => {
    const r = solveArc(80, 10, 'conducting') // 50 V arc, 3 A → 150 W → 15 lm/W × 150 = 2250 lm
    expect(r.reading?.voltage ?? 0).toBeCloseTo(50, 1)
    expect(r.reading?.current ?? 0).toBeCloseTo(3, 3)
    expect(r.reading?.power ?? 0).toBeCloseTo(150, 0)
    expect(r.reading?.luminousFluxLm ?? 0).toBeCloseTo(2250, 0)
  })

  test('an extinguished arc makes no light', () => {
    const r = solveArc(40, 10, 'blocking')
    expect(r.reading?.luminousFluxLm ?? 0).toBe(0)
  })
})

describe('arc lamp — without a ballast the current runs away', () => {
  test('a struck arc on a stiff supply through tiny resistance draws a huge current', () => {
    // No real ballast (0.1 Ω of wire): (80 − 50)/0.1 = 300 A — the "needs a ballast" failure mode.
    const r = solveArc(80, 0.1, 'conducting')
    expect(r.latch).toBe('conducting')
    expect(r.current).toBeGreaterThan(100)
  })
})
