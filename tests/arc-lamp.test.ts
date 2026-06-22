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
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { type PartReading, partReadings } from '../src/renderer/part-readings.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

/**
 * V+(supply) → R(ballastOhms) → arc.anode; arc.cathode → GND. Returns the settled latch state, the
 * arc current, and the live reading. Arc defaults: burns at 50 V, strikes at 60 V, holds above 0.5 A,
 * 15 lm/W.
 */
function solveArc(
  supply: number,
  ballastOhms: number,
  startState: 'blocking' | 'conducting',
  ayrtonCoeff?: number,
): {
  latch: string | undefined
  current: number
  reading: PartReading | undefined
  settled: boolean
} {
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
      ...(ayrtonCoeff === undefined ? {} : { ayrton_coefficient: scalar(ayrtonCoeff, 'V·A') }),
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
    settled: result.relaysSettled,
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

describe('arc lamp — the Ayrton fall (V = V_min + B/I, negative resistance)', () => {
  test('the burning voltage falls as the current rises, settling on V = V_min + B/I', () => {
    // V_min 50 V, Ayrton coefficient B = 48 V·A (Ayrton 1902). A 5 Ω ballast burns it hard (~13 A); a
    // 10 Ω ballast softer (~6 A). More current → LESS voltage — the arc's defining negative resistance,
    // settled by the discrete-state fixed point (no negative conductance ever stamped into the matrix).
    const hot = solveArc(120, 5, 'conducting', 48)
    const cool = solveArc(120, 10, 'conducting', 48)
    expect(hot.settled).toBe(true) // a well-ballasted arc finds a steady burn
    expect(cool.settled).toBe(true)
    expect(hot.current).toBeGreaterThan(cool.current) // stiffer ballast → more current
    expect(hot.reading?.voltage ?? 0).toBeLessThan(cool.reading?.voltage ?? 0) // …and lower voltage
    // each lands on the Ayrton curve V = 50 + 48/I
    expect(hot.reading?.voltage ?? 0).toBeCloseTo(50 + 48 / hot.current, 0)
    expect(cool.reading?.voltage ?? 0).toBeCloseTo(50 + 48 / cool.current, 0)
  })

  test('with no Ayrton coefficient it still burns at the flat arc voltage (the earlier model)', () => {
    const r = solveArc(80, 10, 'conducting') // no B → constant 50 V
    expect(r.reading?.voltage ?? 0).toBeCloseTo(50, 1)
  })

  test('the fall carries into the transient — a falling arc settles to LESS current than a flat one', () => {
    // Same 120 V DC through a 10 Ω ballast, marched to steady state. The falling arc (B = 48) lifts
    // above V_min at finite current, so it burns higher and draws LESS than the flat (B = 0) arc.
    const steadyCurrent = (ayrton: number) => {
      const nodes: CanvasNode[] = [
        {
          id: 'src',
          definition: 'power_source',
          parameters: {
            nominal_voltage: scalar(120, 'volt'),
            internal_resistance: scalar(0, 'ohm'),
          },
        },
        { id: 'r', definition: 'resistor', parameters: { resistance: scalar(10, 'ohm') } },
        {
          id: 'arc',
          definition: 'arc_lamp',
          parameters: {
            arc_voltage: scalar(50, 'volt'),
            breakover_voltage: scalar(60, 'volt'),
            holding_current: scalar(0.5, 'ampere'),
            device_state: { value: 'conducting' },
            ...(ayrton > 0 ? { ayrton_coefficient: scalar(ayrton, 'V·A') } : {}),
          },
        },
        { id: 'gnd', definition: 'ground' },
      ]
      const edges = [
        g('src', 'terminal_positive', 'r', 'terminal_a'),
        g('src', 'terminal_negative', 'gnd', 'reference_terminal'),
        g('r', 'terminal_b', 'arc', 'anode'),
        g('arc', 'cathode', 'gnd', 'reference_terminal'),
      ]
      const result = solveTransient(canvasToWorld(nodes, edges), { timeStep: 1e-4, duration: 2e-2 })
      return Math.abs(result.series.at(-1)?.currents?.get('arc/anode') ?? 0)
    }
    const flat = steadyCurrent(0)
    const falling = steadyCurrent(48)
    expect(flat).toBeGreaterThan(1) // both arcs are burning
    expect(falling).toBeGreaterThan(1)
    expect(falling).toBeLessThan(flat) // the Ayrton lift draws less current
  })
})

describe('arc lamp — AC re-striking (transient latch)', () => {
  test('on AC through a ballast it conducts on the positive peaks and re-strikes each cycle', () => {
    // 120 V peak, 50 Hz → R(10 Ω) → arc; the arc strikes when the line tops the 60 V breakover, burns
    // at 50 V, and goes out as the line falls — re-striking on the next positive half-cycle.
    const nodes: CanvasNode[] = [
      {
        id: 'ac',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(0, 'volt'),
          ac_amplitude: scalar(120, 'volt'),
          frequency: scalar(50, 'hertz'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      { id: 'r', definition: 'resistor', parameters: { resistance: scalar(10, 'ohm') } },
      {
        id: 'arc',
        definition: 'arc_lamp',
        parameters: {
          arc_voltage: scalar(50, 'volt'),
          breakover_voltage: scalar(60, 'volt'),
          holding_current: scalar(0.5, 'ampere'),
          device_state: { value: 'blocking' },
        },
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('ac', 'terminal_positive', 'r', 'terminal_a'),
      g('ac', 'terminal_negative', 'gnd', 'reference_terminal'),
      g('r', 'terminal_b', 'arc', 'anode'),
      g('arc', 'cathode', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const result = solveTransient(world, { timeStep: 1e-4, duration: 5e-2 }) // ~2.5 cycles at 50 Hz
    expect(result.status).toBe('solved')
    const current = result.series.map((s) => Math.abs(s.currents?.get('arc/anode') ?? 0))
    expect(Math.max(...current)).toBeGreaterThan(1) // strikes + conducts on the positive peaks
    expect(Math.min(...current)).toBeLessThan(0.01) // dark on the negative half-cycles
    const half = Math.floor(current.length / 2)
    expect(Math.max(...current.slice(half))).toBeGreaterThan(1) // re-strikes — not just the first cycle
  })
})
