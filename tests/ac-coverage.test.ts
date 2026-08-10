/**
 * AC COVERAGE — the rule, asserted over the WHOLE palette rather than over a list of parts someone thought of.
 *
 * THE RULE: no part that declares a resistance, an inductance or a capacitance may be silently absent from
 * the AC solve, and no part that declares loss may be solved as perfect, without the on-screen notice naming
 * it and saying why.
 *
 * A part therefore ends in one of three honest states, and this file pins all three EMPIRICALLY — not by
 * reading the classification tables back to themselves:
 *   solved   — the declared value is in the answer; pinned to a closed-form impedance computed here.
 *   ignored  — the part is in the matrix but this value is not; proved by making the value enormous and
 *              watching Zin refuse to move, and then found in the notice text.
 *   absent   — the part is not in the matrix at all; proved by measuring the gmin OPEN, and then found in
 *              the notice text.
 * The fourth state — absent and unnamed — is what `every declared electrical value is classified` forbids,
 * and it forbids it for every definition the app ships, so a new part with a `rotor_reactance` fails here
 * until somebody decides which of the three it is.
 *
 * WHY THE SWEEP IS OVER DEFINITIONS_WITH_DEFAULTS AND NOT A LITERAL LIST: the defect this file exists for was
 * eight rotating machines reading Zin = 1 GΩ (the gmin floor — an open) with the notice showing nothing. Every
 * one of them declared its impedances in plain sight. A hand-listed property would have been written against
 * the parts already known to be broken and would have passed on the day it shipped.
 *
 * TERMINAL NAMES ARE TAKEN FROM terminalsOf(), NEVER GUESSED. A part wired through a terminal it does not
 * have is simply UNSTAMPED, and an unstamped part reads as an open — which looks exactly like the bug being
 * tested for, so a guessed name turns this whole file into a pass for the wrong reason.
 */
import { describe, expect, test } from 'vitest'
import {
  acGminFloorOhms,
  acRelevantParameters,
  acValueState,
  partsDroppedFromAcSolve,
  partsWithAcValueIgnored,
  portReflection,
} from '../src/ac-analysis.ts'
import type { Instance, World } from '../src/cross-fk-validator.ts'
import { ldrResistance } from '../src/light.ts'
import { acLossNoticeText } from '../src/renderer/ac-loss-notice.tsx'
import { PART_CATEGORIES } from '../src/renderer/part-categories.ts'
import {
  DEFINITIONS_WITH_DEFAULTS,
  defaultParameters,
  type Parameters,
} from '../src/renderer/part-defaults.ts'
import { terminalsOf } from '../src/renderer/symbols.tsx'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

function makeWorld(): World {
  return {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
}
function ensureNet(world: World, id: string, ground = false) {
  if (!world.nets.has(id)) {
    world.nets.set(id, {
      id,
      kind: 'net',
      ...(ground ? { type: 'ground' as const } : {}),
      members: [],
    })
  }
}
function addPart(
  world: World,
  id: string,
  definition: string,
  parameters: Parameters,
  pins: { net: string; terminal: string }[],
) {
  world.instances.set(id, {
    id,
    kind_ref: 'primitive_device',
    definition,
    parameters,
    connects: pins.map((pin) => ({ net: pin.net, terminal: pin.terminal, of: id })),
  })
  for (const pin of pins) {
    ensureNet(world, pin.net)
    world.nets.get(pin.net)?.members.push({ instance: id, terminal: pin.terminal })
  }
}

/** A 1 V port with the part's FIRST terminal on the live net and every other terminal grounded, so the port
 *  reads the part's own impedance from that terminal. Terminal names come from terminalsOf. */
function portAcrossPart(definition: string, parameters: Parameters): World {
  const world = makeWorld()
  ensureNet(world, 'gnd', true)
  addPart(world, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  const terminals = terminalsOf(definition, parameters).map((t) => t.id)
  addPart(
    world,
    'dut',
    definition,
    parameters,
    terminals.map((terminal, i) => ({ net: i === 0 ? 'in' : 'gnd', terminal })),
  )
  return world
}
const zinAt = (world: World, frequencyHz: number, source = 'p1') => {
  const point = portReflection(world, { inputSource: source, z0Ohms: 50 }, frequencyHz)
  return { re: point.zinRe, im: point.zinIm }
}

/**
 * The impedance the AC_GMIN node-to-ground floor leaves an OPEN port reading: 1/AC_GMIN = 1 GΩ. Every part
 * missing from the matrix reads exactly this, which is what made the absent machines so easy to miss —
 * a big, tidy, entirely fictional number.
 */
const OPEN_PORT_OHMS = 1e9

/** The engine's node-to-ground floor conductance, taken from the engine's own published error term
 *  (acGminFloorOhms(X) = AC_GMIN·X²) rather than written out again as a number that could drift from it. */
const AC_GMIN_SIEMENS = acGminFloorOhms(1)

/** A resistance R measured through a port also carries the gmin conductance in parallel:
 *  Zin = 1/(1/R + AC_GMIN) = R/(1 + R·AC_GMIN). The closed form every 'solved' resistance is pinned to. */
const withGminInParallel = (resistanceOhms: number): number =>
  resistanceOhms / (1 + resistanceOhms * AC_GMIN_SIEMENS)

/** Every definition the app can put on a canvas: the ones shipping cited defaults, plus every palette
 *  member (blocks, composites), so nothing is swept under a category heading. */
const wholePalette = (): string[] => {
  const names = new Set(DEFINITIONS_WITH_DEFAULTS)
  for (const category of PART_CATEGORIES) for (const member of category.members) names.add(member)
  return [...names].sort()
}

describe('the rule, over the whole palette', () => {
  test('every declared electrical value is classified — none is silently absent', () => {
    const unclassified: string[] = []
    for (const definition of wholePalette()) {
      const parameters = defaultParameters(definition)
      const instance = { id: 'x', definition, parameters } as unknown as Instance
      for (const parameter of acRelevantParameters(instance)) {
        if (acValueState(definition, parameter) === 'unclassified') {
          unclassified.push(`${definition}.${parameter}`)
        }
      }
    }
    expect(unclassified).toEqual([])
  })

  test('the detector itself catches every kind of declared value, one shipped example each', () => {
    // The sweep above is only as good as what it considers RELEVANT, and a detector that quietly stops
    // recognising a word takes a whole class of parts out of the rule while every other test stays green —
    // a mutation that narrowed the pattern to drop `reactance` did exactly that, and nothing failed. So
    // each alternative in the pattern is nailed to a real shipped parameter here.
    const shipped: [string, string, Parameters | undefined][] = [
      ['generator', 'armature_resistance', undefined],
      ['induction_motor', 'magnetizing_reactance', undefined],
      ['dc_motor', 'armature_inductance', undefined],
      ['transistor_mosfet_nmos', 'gate_capacitance', undefined],
      ['diode_varactor', 'junction_capacitance_zero_bias', undefined],
      ['transmission_line', 'characteristic_impedance', undefined],
      ['transmission_line', 'shunt_conductance', undefined],
      ['transmission_line', 'loss_tangent', undefined],
      ['capacitor', 'dissipation_factor', undefined],
      ['transformer', 'coupling_coefficient', undefined],
      ['vccs', 'transconductance', undefined],
      ['transistor_mosfet_nmos', 'transconductance_parameter', undefined],
      ['capacitor', 'esr', { esr: scalar(0.5, 'ohm') }],
    ]
    for (const [definition, parameter, override] of shipped) {
      const parameters = override ?? defaultParameters(definition)
      expect(Object.keys(parameters)).toContain(parameter)
      const instance = { id: 'x', definition, parameters } as unknown as Instance
      expect(acRelevantParameters(instance)).toContain(parameter)
    }
    // And the two names that look like impedances and are not stay out, or the notice fills with noise.
    const notElements = {
      id: 'x',
      definition: 'reference_port',
      parameters: {
        reference_impedance: scalar(50, 'ohm'),
        thermal_resistance_junction_ambient: scalar(300, 'kelvin_per_watt'),
      },
    } as unknown as Instance
    expect(acRelevantParameters(notElements)).toEqual([])
  })

  test('the sweep is wide enough to have found the machines it was written for', () => {
    // If this list ever stops being covered, the sweep above has been narrowed and proves nothing.
    const machines = [
      'dc_motor',
      'induction_motor',
      'generator',
      'alternator',
      'alternator_three_phase',
    ]
    for (const definition of machines) {
      expect(wholePalette()).toContain(definition)
      const instance = {
        id: 'x',
        definition,
        parameters: defaultParameters(definition),
      } as unknown as Instance
      expect(acRelevantParameters(instance).length).toBeGreaterThan(0)
      for (const parameter of acRelevantParameters(instance)) {
        expect(acValueState(definition, parameter)).toBe('absent')
      }
    }
  })

  test('a part that is absent from the solve is NAMED by the notice, every one of them', () => {
    const silent: string[] = []
    for (const definition of wholePalette()) {
      const parameters = defaultParameters(definition)
      const instance = { id: 'dut', definition, parameters } as unknown as Instance
      const absent = acRelevantParameters(instance).some(
        (parameter) => acValueState(definition, parameter) === 'absent',
      )
      if (!absent) continue
      const world = portAcrossPart(definition, parameters)
      const report = partsDroppedFromAcSolve(world).find((part) => part.id === 'dut')
      const notice = acLossNoticeText(world) ?? ''
      // The rule is "named AND says why", so an empty or one-word reason is the same failure as silence:
      // a mutant that reported every dropped part with reason '' passed a version of this that only
      // checked the part was mentioned.
      const saysWhy = (report?.reason ?? '').split(' ').length >= 8
      const reasonReachesTheScreen = report !== undefined && notice.includes(report.reason)
      if (!report || !notice.includes('dut') || !saysWhy || !reasonReachesTheScreen) {
        silent.push(`${definition} (reason: ${JSON.stringify(report?.reason ?? null)})`)
      }
    }
    expect(silent).toEqual([])
  })

  test('a part that is absent really is absent — the port reads the gmin open', () => {
    // The other half of the claim: the notice must not be naming a part the engine actually solves.
    for (const definition of ['dc_motor', 'induction_motor', 'generator', 'alternator', 'triode']) {
      const zin = zinAt(portAcrossPart(definition, defaultParameters(definition)), 1e3)
      expect(zin.re).toBeCloseTo(OPEN_PORT_OHMS, -3)
      expect(zin.im).toBeCloseTo(0, 12)
    }
  })
})

describe('the five the independent sweep measured — each now names itself', () => {
  const measured: [string, string][] = [
    ['dc_motor', 'armature_inductance'],
    ['induction_motor', 'magnetizing_reactance'],
    ['generator', 'armature_resistance'],
    ['alternator', 'winding_resistance'],
    ['alternator_three_phase', 'winding_resistance'],
  ]
  for (const [definition, parameter] of measured) {
    test(`${definition} declares ${parameter}, reads 1 GΩ, and the notice says so`, () => {
      const parameters = defaultParameters(definition)
      expect(Object.keys(parameters)).toContain(parameter)
      const world = portAcrossPart(definition, parameters)
      expect(zinAt(world, 1e3).re).toBeCloseTo(OPEN_PORT_OHMS, -3)
      const notice = acLossNoticeText(world)
      expect(notice).not.toBeNull()
      expect(notice).toContain('dut')
      expect(notice).toContain('LEFT OUT of the AC solve entirely')
    })
  }
})

describe('the resistances that used to be openings are now in the answer', () => {
  test('a thermistor is its declared resistance — closed form R = 10 kΩ', () => {
    const parameters = defaultParameters('thermistor')
    // Pin the shipped value the closed form is built from, so a default change cannot quietly pass this.
    expect((parameters.resistance?.value as { amount: number }).amount).toBe(10000)
    const zin = zinAt(portAcrossPart('thermistor', parameters), 1e3)
    expect(zin.re).toBeCloseTo(withGminInParallel(10000), 6)
    expect(zin.im).toBeCloseTo(0, 12)
  })

  test('a photoresistor is its light-law resistance — R = R₀·(E/E₀)^−γ', () => {
    const parameters = defaultParameters('photoresistor')
    // The closed form, computed HERE from the shipped numbers rather than taken from the engine:
    // 12000 Ω at 10 lux, γ = 0.6, sitting in 100 lux → 12000·(100/10)^−0.6 = 3014.2637 Ω.
    const expected = 12000 * (100 / 10) ** -0.6
    expect(expected).toBeCloseTo(3014.2637, 3)
    expect(ldrResistance({ parameters } as unknown as Instance)).toBeCloseTo(expected, 9)
    const zin = zinAt(portAcrossPart('photoresistor', parameters), 1e3)
    expect(zin.re).toBeCloseTo(withGminInParallel(expected), 6)
  })

  test('a potentiometer is its two track segments, and the wiper moves them', () => {
    // BOTH segments are measured, each in isolation, or half the track goes unpinned: a mutant that
    // stamped the bottom segment at the wrong resistance survived a version of this test that only ever
    // put current through the top one.
    //   live terminal_a, wiper + terminal_b grounded → the TOP segment alone,    R·p
    //   live terminal_b, wiper + terminal_a grounded → the BOTTOM segment alone, R·(1−p)
    // (the far segment spans two grounded nets, so it carries nothing.) Closed form: 10 kΩ track.
    const trackOhms = 10000
    for (const position of [0.25, 0.5, 0.75]) {
      for (const live of ['terminal_a', 'terminal_b'] as const) {
        const grounded = live === 'terminal_a' ? 'terminal_b' : 'terminal_a'
        const expectedOhms =
          live === 'terminal_a' ? trackOhms * position : trackOhms * (1 - position)
        const world = makeWorld()
        ensureNet(world, 'gnd', true)
        addPart(world, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
          { net: 'in', terminal: 'terminal_positive' },
          { net: 'gnd', terminal: 'terminal_negative' },
        ])
        addPart(
          world,
          'dut',
          'potentiometer',
          {
            ...defaultParameters('potentiometer'),
            wiper_position: scalar(position, 'dimensionless'),
          },
          [
            { net: 'in', terminal: live },
            { net: 'gnd', terminal: 'wiper' },
            { net: 'gnd', terminal: grounded },
          ],
        )
        expect(zinAt(world, 1e3).re).toBeCloseTo(withGminInParallel(expectedOhms), 5)
      }
    }
  })

  test('a potentiometer end to end is the whole track, whatever the wiper is doing', () => {
    // Through the wiper: R·p + R·(1−p) = R, at every position. Pins the two segments AGAINST each other
    // — a stamp that got either one wrong breaks the sum even where the isolated readings look plausible.
    // The wiper net is a real node, so it carries its own gmin to ground and the ladder reads
    //   Zin = (R·p + [R·(1−p) ∥ 1/gmin]) ∥ 1/gmin
    // which is where the last 0.2 Ω of the 10 kΩ goes. Written out rather than tolerated, so the number
    // being asserted is one that was derived, not one that was observed and then accepted.
    const trackOhms = 10000
    for (const position of [0.1, 0.5, 0.9]) {
      const top = trackOhms * position
      const throughWiper = top + withGminInParallel(trackOhms * (1 - position))
      const expected = withGminInParallel(throughWiper)
      expect(Math.abs(expected - trackOhms)).toBeLessThan(0.2)
      const world = makeWorld()
      ensureNet(world, 'gnd', true)
      addPart(world, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
        { net: 'in', terminal: 'terminal_positive' },
        { net: 'gnd', terminal: 'terminal_negative' },
      ])
      addPart(
        world,
        'dut',
        'potentiometer',
        {
          ...defaultParameters('potentiometer'),
          wiper_position: scalar(position, 'dimensionless'),
        },
        [
          { net: 'in', terminal: 'terminal_a' },
          { net: 'mid', terminal: 'wiper' },
          { net: 'gnd', terminal: 'terminal_b' },
        ],
      )
      expect(zinAt(world, 1e3).re).toBeCloseTo(expected, 6)
    }
  })

  test('a potentiometer in an RC low-pass sets the corner — the Bode curve has the track in it', () => {
    // The whole point of stamping it: R·p feeding 100 nF is a first-order low-pass at
    // f_c = 1/(2π·R·C). With R = 10 kΩ·0.5 = 5 kΩ and C = 100 nF, f_c = 318.31 Hz, and the closed-form
    // magnitude there is exactly 1/√2. An unstamped pot is an open, and the output would sit at 1.
    const world = makeWorld()
    ensureNet(world, 'gnd', true)
    addPart(world, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(world, 'dut', 'potentiometer', defaultParameters('potentiometer'), [
      { net: 'in', terminal: 'terminal_a' },
      { net: 'out', terminal: 'wiper' },
      { net: 'out', terminal: 'terminal_b' },
    ])
    addPart(world, 'c1', 'capacitor', { capacitance: scalar(100e-9, 'farad') }, [
      { net: 'out', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    const resistanceOhms = 10000 * 0.5
    const cornerHz = 1 / (2 * Math.PI * resistanceOhms * 100e-9)
    expect(cornerHz).toBeCloseTo(318.31, 2)
    const point = portReflection(world, { inputSource: 'p1', z0Ohms: 50 }, cornerHz)
    // Read it as an impedance instead of a gain: Zin = R + 1/(jωC), and at the corner the reactance
    // equals the resistance exactly, so Zin = R − jR. The measured pair lands 0.02 / 0.05 Ω off that,
    // which is the AC_GMIN shunt on the output node, not the track — 1 part in 10⁵ of 5 kΩ.
    expect(point.zinRe).toBeCloseTo(resistanceOhms, 0)
    expect(point.zinIm).toBeCloseTo(-resistanceOhms, 0)
    expect(Math.abs(point.zinIm + resistanceOhms)).toBeLessThan(0.1)
  })
})

describe('a declared value the solve does not read is named, not hidden', () => {
  const ignored: [string, string, number, { net: string; terminal: string }[]][] = [
    [
      'switch_spst_toggle',
      'contact_resistance_closed',
      1e5,
      [
        { net: 'in', terminal: 'terminal_a' },
        { net: 'mid', terminal: 'terminal_b' },
      ],
    ],
    [
      'fuse',
      'element_resistance',
      1e5,
      [
        { net: 'in', terminal: 'terminal_a' },
        { net: 'mid', terminal: 'terminal_b' },
      ],
    ],
    [
      'relay',
      'contact_resistance',
      1e5,
      [
        { net: 'in', terminal: 'common' },
        { net: 'mid', terminal: 'normally_closed' },
        { net: 'nc2', terminal: 'normally_open' },
        { net: 'ca', terminal: 'coil_a' },
        { net: 'gnd', terminal: 'coil_b' },
      ],
    ],
  ]
  for (const [definition, parameter, hugeOhms, pins] of ignored) {
    test(`${definition}.${parameter} does not move Zin, and the notice admits it`, () => {
      const build = (ohms: number) => {
        const world = makeWorld()
        ensureNet(world, 'gnd', true)
        addPart(world, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
          { net: 'in', terminal: 'terminal_positive' },
          { net: 'gnd', terminal: 'terminal_negative' },
        ])
        addPart(
          world,
          'dut',
          definition,
          { ...defaultParameters(definition), [parameter]: scalar(ohms, 'ohm') },
          pins,
        )
        addPart(world, 'r1', 'resistor', { resistance: scalar(1000, 'ohm') }, [
          { net: 'mid', terminal: 'terminal_a' },
          { net: 'gnd', terminal: 'terminal_b' },
        ])
        return world
      }
      // The part IS stamped — the port reads the 1 kΩ load through it, not an open. Without this the
      // "value ignored" claim below would pass for the wrong reason: an unwired part is an open too.
      const small = zinAt(build(1e-3), 1e3)
      expect(small.re).toBeCloseTo(withGminInParallel(1000), 2)
      // 100 kΩ of contact resistance would be impossible to miss if it were read; Zin does not budge.
      expect(zinAt(build(hugeOhms), 1e3).re).toBeCloseTo(small.re, 9)
      const world = build(hugeOhms)
      expect(partsWithAcValueIgnored(world).map((p) => p.id)).toContain('dut')
      const notice = acLossNoticeText(world) ?? ''
      expect(notice).toContain(`dut declares ${parameter}`)
      expect(notice).toContain('will not move these curves')
    })
  }

  test("a power source's internal resistance is not in the AC answer, and says so", () => {
    // A reference_port measures; the battery is AC-grounded, so the port would see its internal
    // resistance in series with the 1 kΩ if the engine read it. Closed form if read: 1001.7 Ω.
    const world = makeWorld()
    ensureNet(world, 'gnd', true)
    addPart(world, 'port', 'reference_port', defaultParameters('reference_port'), [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(world, 'dut', 'power_source', defaultParameters('power_source'), [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'mid', terminal: 'terminal_negative' },
    ])
    addPart(world, 'r1', 'resistor', { resistance: scalar(1000, 'ohm') }, [
      { net: 'mid', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    const zin = zinAt(world, 1e3, 'port')
    expect(zin.re).toBeCloseTo(withGminInParallel(1000), 2)
    expect(zin.re).not.toBeCloseTo(1001.7, 1)
    expect(acLossNoticeText(world) ?? '').toContain('dut declares internal_resistance')
  })

  test("a MOSFET's declared gate capacitance is not in the AC answer, and says so", () => {
    // 60 pF at 1 kHz would be −j2.653 MΩ at the gate. The gate reads the gmin open instead.
    const parameters = defaultParameters('transistor_mosfet_nmos')
    expect((parameters.gate_capacitance?.value as { amount: number }).amount).toBe(60e-12)
    const world = makeWorld()
    ensureNet(world, 'gnd', true)
    addPart(world, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(world, 'dut', 'transistor_mosfet_nmos', parameters, [
      { net: 'in', terminal: 'gate' },
      { net: 'gnd', terminal: 'drain' },
      { net: 'gnd', terminal: 'source' },
    ])
    const ifStamped = -1 / (2 * Math.PI * 1e3 * 60e-12)
    expect(ifStamped).toBeCloseTo(-2652582.38, 2)
    const zin = zinAt(world, 1e3)
    expect(zin.im).not.toBeCloseTo(ifStamped, -3)
    expect(zin.re).toBeCloseTo(OPEN_PORT_OHMS, -3)
    expect(acLossNoticeText(world) ?? '').toContain('dut declares gate_capacitance')
  })

  test('a value declared as zero is NOT reported as ignored — nothing is being discarded', () => {
    const world = makeWorld()
    ensureNet(world, 'gnd', true)
    addPart(world, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(
      world,
      'dut',
      'fuse',
      { ...defaultParameters('fuse'), element_resistance: scalar(0, 'ohm') },
      [
        { net: 'in', terminal: 'terminal_a' },
        { net: 'mid', terminal: 'terminal_b' },
      ],
    )
    addPart(world, 'r1', 'resistor', { resistance: scalar(1000, 'ohm') }, [
      { net: 'mid', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    expect(partsWithAcValueIgnored(world)).toEqual([])
  })
})

describe('the parts that were already honest stay exactly as they were', () => {
  test('a plain resistor + capacitor circuit says nothing new', () => {
    const world = makeWorld()
    ensureNet(world, 'gnd', true)
    addPart(world, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(world, 'r1', 'resistor', { resistance: scalar(1000, 'ohm') }, [
      { net: 'in', terminal: 'terminal_a' },
      { net: 'out', terminal: 'terminal_b' },
    ])
    addPart(
      world,
      'c1',
      'capacitor',
      { capacitance: scalar(100e-9, 'farad'), esr: scalar(0.5, 'ohm') },
      [
        { net: 'out', terminal: 'terminal_a' },
        { net: 'gnd', terminal: 'terminal_b' },
      ],
    )
    expect(partsWithAcValueIgnored(world)).toEqual([])
    expect(partsDroppedFromAcSolve(world)).toEqual([])
    expect(acLossNoticeText(world)).toBeNull()
    // Closed form: Zin = R + ESR − j/(ωC) = 1000.5 − j1591.55 at 1 kHz.
    const zin = zinAt(world, 1e3)
    expect(zin.re).toBeCloseTo(1000.5, 2)
    expect(zin.im).toBeCloseTo(-1 / (2 * Math.PI * 1e3 * 100e-9), 2)
  })
})
