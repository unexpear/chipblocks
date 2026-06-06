/**
 * Failure-mode detector tests — S15-v3-3 layer (LED forward overload).
 *
 * Covers:
 *   1. checkLedForwardOverload unit cases — fires when |I| > max, silent
 *      when within rating, silent when rating or current is missing.
 *   2. detectFailures end-to-end on the EDUCATIONAL ANCHOR CIRCUIT — the
 *      cross-sprint contract: load fixtures → cross-FK → solveDC →
 *      detectFailures fires led-overloaded with measured 0.07 A, rated
 *      0.02 A, ratio 3.5×.
 *
 * resistor-overpower (S15-v3-4) and led-reverse-breakdown (S15-v3-5) get
 * their own test groups when those checks land.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse as parseYAML } from 'yaml'
import {
  type ActiveVariableEntry,
  type BehaviorEntry,
  type Definition,
  type Instance,
  type Net,
  validateWorld,
  type World,
} from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'
import {
  checkLedForwardOverload,
  checkLedReverseBreakdown,
  checkResistorOverpower,
  detectFailures,
} from '../src/failure-detector.ts'

// Load every *.yaml in `dir` into a World, sorting by kind.
function loadWorld(dir: string): World {
  const definitions = new Map<string, Definition>()
  const instances = new Map<string, Instance>()
  const behaviors = new Map<string, BehaviorEntry>()
  const activeVariables = new Map<string, ActiveVariableEntry>()
  const nets = new Map<string, Net>()

  const files = readdirSync(dir).filter((f) => f.endsWith('.yaml'))
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf-8')
    const data = parseYAML(raw) as Record<string, unknown>
    const id = typeof data.id === 'string' ? data.id : undefined
    if (id === undefined) throw new Error(`${file}: missing or non-string 'id' field`)

    if (data.kind === 'behavior') behaviors.set(id, data as unknown as BehaviorEntry)
    else if (data.kind === 'active_variable')
      activeVariables.set(id, data as unknown as ActiveVariableEntry)
    else if (data.kind === 'net') nets.set(id, data as unknown as Net)
    else if ('kind' in data) definitions.set(id, data as unknown as Definition)
    else if ('kind_ref' in data) instances.set(id, data as unknown as Instance)
    else throw new Error(`${file}: fixture has neither 'kind' nor 'kind_ref'`)
  }

  return { definitions, instances, behaviors, activeVariables, nets }
}

// A minimal Solution with just the maps the detector reads.
function solutionWith(branches: Record<string, number>, nodes: Record<string, number> = {}) {
  return {
    status: 'solved' as const,
    nodes: new Map(Object.entries(nodes)),
    branches: new Map(Object.entries(branches)),
    ground: 'net_gnd',
    warnings: [],
    iterations: 1,
    converged: true,
  }
}

function ledInstance(id: string, maxForwardCurrent: number): Instance {
  return {
    id,
    kind_ref: 'primitive_device',
    definition: 'led',
    parameters: {
      max_forward_current: {
        value: { kind: 'scalar', amount: maxForwardCurrent, unit: 'ampere' },
      },
    },
    connects: [
      { net: 'net_a', terminal: 'anode', of: id },
      { net: 'net_gnd', terminal: 'cathode', of: id },
    ],
  }
}

function ledWithReverseRating(id: string, reverseBreakdownVolts: number): Instance {
  return {
    id,
    kind_ref: 'primitive_device',
    definition: 'led',
    parameters: {
      reverse_breakdown_voltage: {
        value: { kind: 'scalar', amount: reverseBreakdownVolts, unit: 'volt' },
      },
    },
    connects: [
      { net: 'net_anode', terminal: 'anode', of: id },
      { net: 'net_cathode', terminal: 'cathode', of: id },
    ],
  }
}

function resistorInstance(id: string, resistanceOhms: number, powerRatingWatts: number): Instance {
  return {
    id,
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: {
      resistance: { value: { kind: 'scalar', amount: resistanceOhms, unit: 'ohm' } },
      power_rating: { value: { kind: 'scalar', amount: powerRatingWatts, unit: 'watt' } },
    },
    connects: [
      { net: 'net_a', terminal: 'terminal_a', of: id },
      { net: 'net_gnd', terminal: 'terminal_b', of: id },
    ],
  }
}

// ===========================================================================
// 1. checkLedForwardOverload unit cases
// ===========================================================================

describe('checkLedForwardOverload', () => {
  test('fires when |I| exceeds max_forward_current', () => {
    const inst = ledInstance('led_x', 0.02)
    const sol = solutionWith({ led_x: 0.07 })
    const failure = checkLedForwardOverload(inst, sol)
    expect(failure).not.toBeNull()
    if (failure === null) return
    expect(failure.code).toBe('led-overloaded')
    expect(failure.source).toBe('led_x')
    expect(failure.kind).toBe('max_forward_current')
    expect(failure.measured).toBeCloseTo(0.07, 9)
    expect(failure.rated).toBeCloseTo(0.02, 9)
    expect(failure.ratio).toBeCloseTo(3.5, 9)
    expect(failure.units).toBe('ampere')
    expect(failure.severity).toBe('error')
  })

  test('fires on the absolute value — negative current overloads too', () => {
    // The §19.6 sign convention: |I| is compared. A negative branch current
    // of -0.07 A is just as much an overload as +0.07 A.
    const inst = ledInstance('led_x', 0.02)
    const sol = solutionWith({ led_x: -0.07 })
    const failure = checkLedForwardOverload(inst, sol)
    expect(failure).not.toBeNull()
    if (failure === null) return
    expect(failure.measured).toBeCloseTo(0.07, 9) // magnitude, not signed
    expect(failure.ratio).toBeCloseTo(3.5, 9)
  })

  test('silent when current is within rating', () => {
    const inst = ledInstance('led_x', 0.02)
    const sol = solutionWith({ led_x: 0.015 }) // 15 mA < 20 mA rating
    expect(checkLedForwardOverload(inst, sol)).toBeNull()
  })

  test('silent at exactly the rating (boundary is not a violation)', () => {
    const inst = ledInstance('led_x', 0.02)
    const sol = solutionWith({ led_x: 0.02 }) // exactly at rating
    expect(checkLedForwardOverload(inst, sol)).toBeNull()
  })

  test('silent when max_forward_current is missing (rating unknown, not a failure)', () => {
    const inst: Instance = {
      id: 'led_x',
      kind_ref: 'primitive_device',
      definition: 'led',
      // no max_forward_current
      connects: [
        { net: 'net_a', terminal: 'anode', of: 'led_x' },
        { net: 'net_gnd', terminal: 'cathode', of: 'led_x' },
      ],
    }
    const sol = solutionWith({ led_x: 0.07 })
    expect(checkLedForwardOverload(inst, sol)).toBeNull()
  })

  test('silent when the branch current is missing from the solution', () => {
    const inst = ledInstance('led_x', 0.02)
    const sol = solutionWith({}) // led_x not in branches
    expect(checkLedForwardOverload(inst, sol)).toBeNull()
  })
})

// ===========================================================================
// 1b. checkResistorOverpower unit cases (S15-v3-4)
// ===========================================================================

describe('checkResistorOverpower', () => {
  test('fires when I²R exceeds power_rating', () => {
    // 100 mA through a 100 Ω resistor → I²R = 0.1² × 100 = 1.0 W.
    // In a 1/4 W (0.25 W) part → 4× over rating.
    const inst = resistorInstance('r_x', 100, 0.25)
    const sol = solutionWith({ r_x: 0.1 })
    const failure = checkResistorOverpower(inst, sol)
    expect(failure).not.toBeNull()
    if (failure === null) return
    expect(failure.code).toBe('resistor-overpower')
    expect(failure.source).toBe('r_x')
    expect(failure.kind).toBe('power_rating')
    expect(failure.measured).toBeCloseTo(1.0, 9)
    expect(failure.rated).toBeCloseTo(0.25, 9)
    expect(failure.ratio).toBeCloseTo(4.0, 9)
    expect(failure.units).toBe('watt')
    expect(failure.severity).toBe('error')
  })

  test('sign-independent — negative current dissipates the same power', () => {
    // I²R squares the current, so -0.1 A gives the same 1.0 W.
    const inst = resistorInstance('r_x', 100, 0.25)
    const sol = solutionWith({ r_x: -0.1 })
    const failure = checkResistorOverpower(inst, sol)
    expect(failure).not.toBeNull()
    if (failure === null) return
    expect(failure.measured).toBeCloseTo(1.0, 9)
  })

  test('silent when dissipation is within rating — the anchor-circuit case', () => {
    // The educational anchor circuit: 70 mA through 100 Ω = 0.49 W,
    // in a 5 W part. 10.2× headroom — does NOT fire.
    const inst = resistorInstance('r_x', 100, 5)
    const sol = solutionWith({ r_x: 0.07 })
    expect(checkResistorOverpower(inst, sol)).toBeNull()
  })

  test('silent when power_rating is missing (rating unknown, not a failure)', () => {
    const inst: Instance = {
      id: 'r_x',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: { value: { kind: 'scalar', amount: 100, unit: 'ohm' } } },
      connects: [
        { net: 'net_a', terminal: 'terminal_a', of: 'r_x' },
        { net: 'net_gnd', terminal: 'terminal_b', of: 'r_x' },
      ],
    }
    const sol = solutionWith({ r_x: 0.5 }) // 0.5² × 100 = 25 W, but no rating to check
    expect(checkResistorOverpower(inst, sol)).toBeNull()
  })

  test('silent when the branch current is missing from the solution', () => {
    const inst = resistorInstance('r_x', 100, 0.25)
    const sol = solutionWith({}) // r_x not in branches
    expect(checkResistorOverpower(inst, sol)).toBeNull()
  })
})

// ===========================================================================
// 1c. checkLedReverseBreakdown unit cases (S15-v3-5)
// ===========================================================================

describe('checkLedReverseBreakdown', () => {
  test('fires when reverse voltage (V_cathode - V_anode) exceeds the rating', () => {
    // LED reverse-biased: cathode at +8 V, anode at 0 V → reverse voltage 8 V.
    // In a 5 V breakdown-rated LED → over by 1.6×.
    const inst = ledWithReverseRating('led_x', 5)
    const sol = solutionWith({}, { net_anode: 0, net_cathode: 8 })
    const failure = checkLedReverseBreakdown(inst, sol)
    expect(failure).not.toBeNull()
    if (failure === null) return
    expect(failure.code).toBe('led-reverse-breakdown')
    expect(failure.source).toBe('led_x')
    expect(failure.kind).toBe('reverse_breakdown_voltage')
    expect(failure.measured).toBeCloseTo(8, 9)
    expect(failure.rated).toBeCloseTo(5, 9)
    expect(failure.ratio).toBeCloseTo(1.6, 9)
    expect(failure.units).toBe('volt')
    expect(failure.severity).toBe('error')
  })

  test('silent when forward-biased — the anchor-circuit case', () => {
    // Forward-biased: anode at +2 V, cathode at 0 V → reverse voltage = -2 V,
    // which can't exceed the +5 V positive breakdown rating.
    const inst = ledWithReverseRating('led_x', 5)
    const sol = solutionWith({}, { net_anode: 2, net_cathode: 0 })
    expect(checkLedReverseBreakdown(inst, sol)).toBeNull()
  })

  test('silent when reverse voltage is within the rating', () => {
    // Reverse-biased but only 3 V, under the 5 V rating.
    const inst = ledWithReverseRating('led_x', 5)
    const sol = solutionWith({}, { net_anode: 0, net_cathode: 3 })
    expect(checkLedReverseBreakdown(inst, sol)).toBeNull()
  })

  test('silent at exactly the rating (boundary is not a violation)', () => {
    const inst = ledWithReverseRating('led_x', 5)
    const sol = solutionWith({}, { net_anode: 0, net_cathode: 5 }) // exactly 5 V reverse
    expect(checkLedReverseBreakdown(inst, sol)).toBeNull()
  })

  test('silent when reverse_breakdown_voltage is missing (rating unknown)', () => {
    const inst: Instance = {
      id: 'led_x',
      kind_ref: 'primitive_device',
      definition: 'led',
      // no reverse_breakdown_voltage
      connects: [
        { net: 'net_anode', terminal: 'anode', of: 'led_x' },
        { net: 'net_cathode', terminal: 'cathode', of: 'led_x' },
      ],
    }
    const sol = solutionWith({}, { net_anode: 0, net_cathode: 100 })
    expect(checkLedReverseBreakdown(inst, sol)).toBeNull()
  })

  test('silent when an anode/cathode net voltage is unresolved', () => {
    const inst = ledWithReverseRating('led_x', 5)
    const sol = solutionWith({}, { net_anode: 0 }) // net_cathode missing
    expect(checkLedReverseBreakdown(inst, sol)).toBeNull()
  })
})

// ===========================================================================
// 2. detectFailures — minimal world + status guard
// ===========================================================================

describe('detectFailures (basic)', () => {
  test('returns empty for a non-solved solution', () => {
    const world: World = {
      definitions: new Map(),
      instances: new Map([['led_x', ledInstance('led_x', 0.02)]]),
      behaviors: new Map(),
      activeVariables: new Map(),
      nets: new Map(),
    }
    const noGround = {
      status: 'no-ground' as const,
      nodes: new Map<string, number>(),
      branches: new Map<string, number>([['led_x', 0.07]]),
      ground: undefined,
      warnings: [],
      iterations: 0,
      converged: false,
    }
    expect(detectFailures(world, noGround)).toEqual([])
  })

  test('fires led-overloaded for an overloaded LED in a solved world', () => {
    const world: World = {
      definitions: new Map(),
      instances: new Map([['led_x', ledInstance('led_x', 0.02)]]),
      behaviors: new Map(),
      activeVariables: new Map(),
      nets: new Map(),
    }
    const sol = solutionWith({ led_x: 0.07 })
    const failures = detectFailures(world, sol)
    expect(failures.length).toBe(1)
    expect(failures[0]?.code).toBe('led-overloaded')
  })
})

// ===========================================================================
// 3. End-to-end on the educational anchor circuit (THE cross-sprint contract)
// ===========================================================================

describe('detectFailures end-to-end: educational anchor circuit', () => {
  test('the full pipeline fires led-overloaded with the Shockley 3.47× numbers', () => {
    // load → cross-FK (clean) → solveDC (70 mA) → detectFailures → led-overloaded.
    // This is the contract that's been alive since Sprint 12: the deliberately-
    // undersized 100 Ω resistor + 9 V supply + 2 V LED produces 70 mA, which
    // is 3.5× the LED's 20 mA rating.
    const world = loadWorld('fixtures/valid')

    const fkErrors = validateWorld(world)
    expect(fkErrors).toEqual([])

    const sol = solveDC(world)
    expect(sol.status).toBe('solved')

    const failures = detectFailures(world, sol)

    const ledOverload = failures.find((f) => f.code === 'led-overloaded' && f.source === 'led_001')
    expect(ledOverload).toBeDefined()
    if (ledOverload === undefined) return
    // Sprint 16 Shockley result: 69.36 mA (was 70.00 mA under fixed-V_F).
    expect(ledOverload.measured).toBeCloseTo(0.069357, 6)
    expect(ledOverload.rated).toBeCloseTo(0.02, 9)
    expect(ledOverload.ratio).toBeCloseTo(3.468, 3)
    expect(ledOverload.units).toBe('ampere')
    expect(ledOverload.severity).toBe('error')
  })

  test('only led_001 overloads — the idle catalog LEDs (led_002..005) do not fire', () => {
    // led_002..led_005 are catalog examples without connects: — they have no
    // branch current in the solution, so the detector correctly stays silent
    // about them (no current = nothing to overload).
    const world = loadWorld('fixtures/valid')
    const sol = solveDC(world)
    const ledOverloads = detectFailures(world, sol).filter((f) => f.code === 'led-overloaded')
    expect(ledOverloads.length).toBe(1)
    expect(ledOverloads[0]?.source).toBe('led_001')
  })

  test('resistor_001 does NOT overpower — 0.49 W in a 5 W part (10.2× headroom)', () => {
    // The §19.10 corrected result: exactly one failure fires on the anchor
    // circuit. resistor_001 dissipates 0.07² × 100 = 0.49 W against its
    // declared power_rating: 5 W. The detector correctly stays silent about
    // the safely-operating resistor.
    const world = loadWorld('fixtures/valid')
    const sol = solveDC(world)
    const failures = detectFailures(world, sol)

    const resistorFailures = failures.filter((f) => f.code === 'resistor-overpower')
    expect(resistorFailures).toEqual([])

    // The whole anchor circuit fires exactly ONE failure — led-overloaded.
    expect(failures.length).toBe(1)
    expect(failures[0]?.code).toBe('led-overloaded')
  })

  test('led_001 does NOT reverse-breakdown — it is forward-biased', () => {
    // The §19.10 corrected result, third check: led_001's anode net
    // (net_resistor_led = 2 V) is above its cathode net (net_led_wire2 ≈ 0 V),
    // so the LED is forward-biased. Reverse voltage = 0 - 2 = -2 V, nowhere
    // near the +5 V reverse_breakdown_voltage rating. The detector correctly
    // stays silent.
    const world = loadWorld('fixtures/valid')
    const sol = solveDC(world)
    const reverseFailures = detectFailures(world, sol).filter(
      (f) => f.code === 'led-reverse-breakdown',
    )
    expect(reverseFailures).toEqual([])
  })
})

// ===========================================================================
// 4. S15-v3-6 — the cross-sprint contract, consolidated + edge cases
// ===========================================================================

describe('detectFailures: the consolidated cross-sprint contract (S15-v3-6)', () => {
  test('the anchor circuit produces exactly one Failure, with the complete §19.10 field set', () => {
    // This is the authoritative documentation of the contract that's been
    // alive since Sprint 12. Four sprints compose:
    //   §16 equation values → §17 nets → §18 DC solver → §19 failure detection
    // The deliberately-undersized circuit (9 V, 100 Ω, LED V_F=2 V) produces
    // 70 mA, 3.5× the LED's 20 mA rating, and exactly one failure fires with
    // every field populated as the spec's §19.10 example shows.
    const world = loadWorld('fixtures/valid')
    expect(validateWorld(world)).toEqual([])

    const sol = solveDC(world)
    expect(sol.status).toBe('solved')

    const failures = detectFailures(world, sol)
    expect(failures.length).toBe(1)

    const f = failures[0]
    expect(f).toBeDefined()
    if (f === undefined) return
    expect(f.code).toBe('led-overloaded')
    expect(f.source).toBe('led_001')
    expect(f.kind).toBe('max_forward_current')
    // Sprint 16 Shockley result: 69.36 mA / 3.47× (was 70.00 mA / 3.50×).
    expect(f.measured).toBeCloseTo(0.069357, 6)
    expect(f.rated).toBe(0.02)
    expect(f.ratio).toBeCloseTo(3.468, 3)
    expect(f.units).toBe('ampere')
    expect(f.severity).toBe('error')
  })

  test('collects multiple failures when a synthetic circuit violates more than one rating', () => {
    // A synthetic single-loop circuit deliberately overdriven so BOTH an LED
    // and its current-limit resistor are over rating at once. Proves the
    // detector accumulates all violations rather than stopping at the first.
    //   9 V battery → net_a — [r1 10Ω, 1/8 W] — net_b — [led V_F=2V] — gnd
    //   Shockley solve: current ≈ 681.75 mA (the LED settles above 2 V at
    //   this high current). Both ratings are still grossly exceeded:
    //   • LED: 681.75 mA vs 20 mA rating → led-overloaded (34×)
    //   • Resistor: 0.68² × 10 ≈ 4.648 W vs 0.125 W rating → resistor-overpower
    const world: World = {
      definitions: new Map(),
      instances: new Map(),
      behaviors: new Map(),
      activeVariables: new Map(),
      nets: new Map(),
    }
    world.nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      members: [
        { instance: 'bat', terminal: 'terminal_positive' },
        { instance: 'r1', terminal: 'terminal_a' },
      ],
    })
    world.nets.set('net_b', {
      id: 'net_b',
      kind: 'net',
      members: [
        { instance: 'r1', terminal: 'terminal_b' },
        { instance: 'led_1', terminal: 'anode' },
      ],
    })
    world.nets.set('net_gnd', {
      id: 'net_gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'bat', terminal: 'terminal_negative' },
        { instance: 'led_1', terminal: 'cathode' },
      ],
    })
    world.instances.set('bat', {
      id: 'bat',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: { nominal_voltage: { value: { kind: 'scalar', amount: 9, unit: 'volt' } } },
      connects: [
        { net: 'net_a', terminal: 'terminal_positive', of: 'bat' },
        { net: 'net_gnd', terminal: 'terminal_negative', of: 'bat' },
      ],
    })
    world.instances.set('r1', {
      id: 'r1',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: {
        resistance: { value: { kind: 'scalar', amount: 10, unit: 'ohm' } },
        power_rating: { value: { kind: 'scalar', amount: 0.125, unit: 'watt' } },
      },
      connects: [
        { net: 'net_a', terminal: 'terminal_a', of: 'r1' },
        { net: 'net_b', terminal: 'terminal_b', of: 'r1' },
      ],
    })
    world.instances.set('led_1', {
      id: 'led_1',
      kind_ref: 'primitive_device',
      definition: 'led',
      parameters: {
        forward_voltage: { value: { kind: 'scalar', amount: 2, unit: 'volt' } },
        max_forward_current: { value: { kind: 'scalar', amount: 0.02, unit: 'ampere' } },
      },
      connects: [
        { net: 'net_b', terminal: 'anode', of: 'led_1' },
        { net: 'net_gnd', terminal: 'cathode', of: 'led_1' },
      ],
    })

    const sol = solveDC(world)
    expect(sol.status).toBe('solved')

    const failures = detectFailures(world, sol)
    const codes = failures.map((f) => f.code).sort()
    expect(codes).toEqual(['led-overloaded', 'resistor-overpower'])

    const ledF = failures.find((f) => f.code === 'led-overloaded')
    expect(ledF?.measured).toBeCloseTo(0.68175, 4) // ~681.75 mA (Shockley)
    const rF = failures.find((f) => f.code === 'resistor-overpower')
    expect(rF?.measured).toBeCloseTo(4.648, 3) // ~4.648 W
  })

  test('an empty world produces no failures', () => {
    const world: World = {
      definitions: new Map(),
      instances: new Map(),
      behaviors: new Map(),
      activeVariables: new Map(),
      nets: new Map(),
    }
    const sol = solveDC(world)
    expect(detectFailures(world, sol)).toEqual([])
  })
})
