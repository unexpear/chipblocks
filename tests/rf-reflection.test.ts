/**
 * 1-PORT REFLECTION (analog-RF chapter, increment 1) — the keystone read-out: measure the complex input
 * impedance Zin looking into a port from the small-signal AC solve, then reference it to Z0 for the RF
 * quantities Γ, return loss, and VSWR. Checked against exact analytic targets:
 *   - a port across R ⇒ Zin = R, Γ = (R−Z0)/(R+Z0), VSWR = R/Z0 (or Z0/R);
 *   - matched (R = Z0) ⇒ Γ = 0, return loss = +∞, VSWR = 1;
 *   - short ⇒ Γ = −1, open ⇒ Γ = +1;
 *   - a reactive (capacitor) load ⇒ purely-imaginary Zin, |Γ| = 1, frequency-dependent.
 * The single-resistor case also PINS the branch-current sign (the easy-to-invert part of the extraction).
 */
import { describe, expect, test } from 'vitest'
import {
  acResponse,
  portReflection,
  portReflectionSweep,
  type ReflectionOptions,
} from '../src/ac-analysis.ts'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDCRobust } from '../src/dc-robust.ts'

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
  parameters: Record<string, { value: unknown }>,
  pins: { net: string; terminal: string }[],
) {
  world.instances.set(id, {
    id,
    kind_ref: 'primitive_device',
    definition,
    parameters,
    connects: pins.map((p) => ({ net: p.net, terminal: p.terminal, of: id })),
  })
  for (const p of pins) {
    ensureNet(world, p.net)
    world.nets.get(p.net)?.members.push({ instance: id, terminal: p.terminal })
  }
}

/** A port (power_source p1) across a load between `in` and ground. */
function portWithLoad(loadDef: string, params: Record<string, { value: unknown }>): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'load', loadDef, params, [
    { net: 'in', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}
const portIntoR = (rOhm: number) => portWithLoad('resistor', { resistance: scalar(rOhm, 'ohm') })
const OPTS: ReflectionOptions = { inputSource: 'p1', z0Ohms: 50 }
const F = 1e6

describe('portReflection — Zin from the AC solve, referenced to Z0', () => {
  test('a port across R reads Zin = R (and pins the branch-current sign to POSITIVE R)', () => {
    const p = portReflection(portIntoR(150), OPTS, F)
    expect(p.zinRe).toBeCloseTo(150, 2) // real, positive — not −150
    expect(p.zinIm).toBeCloseTo(0, 6)
  })

  test('a matched load (R = Z0) reflects nothing', () => {
    const p = portReflection(portIntoR(50), OPTS, F)
    expect(p.gammaMag).toBeLessThan(1e-6)
    expect(p.returnLossDb).toBeGreaterThan(100) // +∞ in the limit
    expect(p.vswr).toBeCloseTo(1, 4)
  })

  test('R = 3·Z0 gives Γ = +0.5, VSWR = 3, return loss = 6.02 dB', () => {
    const p = portReflection(portIntoR(150), OPTS, F)
    expect(p.gammaRe).toBeCloseTo(0.5, 3)
    expect(p.gammaIm).toBeCloseTo(0, 5)
    expect(p.gammaMag).toBeCloseTo(0.5, 3)
    expect(p.vswr).toBeCloseTo(3, 2)
    expect(p.returnLossDb).toBeCloseTo(6.0206, 2)
  })

  test('R = Z0/3 gives Γ = −0.5, VSWR = 3 (the mirror mismatch)', () => {
    const p = portReflection(portIntoR(50 / 3), OPTS, F)
    expect(p.gammaRe).toBeCloseTo(-0.5, 3)
    expect(p.gammaMag).toBeCloseTo(0.5, 3)
    expect(p.vswr).toBeCloseTo(3, 2)
  })

  test('a near-short reflects with Γ → −1', () => {
    const p = portReflection(portIntoR(1e-3), OPTS, F)
    expect(p.gammaRe).toBeLessThan(-0.999)
    expect(p.gammaMag).toBeGreaterThan(0.999)
  })

  test('an open port reflects with Γ → +1', () => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    const p = portReflection(w, OPTS, F)
    expect(p.gammaRe).toBeGreaterThan(0.999)
    expect(p.gammaMag).toBeGreaterThan(0.999)
    expect(p.vswr).toBeGreaterThan(1e5) // total reflection ⇒ enormous VSWR
  })

  test('a reactive (capacitor) load ⇒ purely-imaginary Zin and |Γ| = 1, frequency-dependent', () => {
    const c = 1e-9
    const w = portWithLoad('capacitor', { capacitance: scalar(c, 'farad') })
    const p = portReflection(w, OPTS, F)
    // Zin = 1/(jωC) = −j/(ωC): reactive, so the real part is ≈ 0 and the imaginary part is negative.
    const expectedIm = -1 / (2 * Math.PI * F * c)
    expect(p.zinIm).toBeCloseTo(expectedIm, 0) // ≈ −159.15 Ω
    expect(Math.abs(p.zinRe)).toBeLessThan(1) // essentially lossless
    expect(p.gammaMag).toBeGreaterThan(0.999) // a lossless load fully reflects
    // and it MOVES with frequency (a decade up ⇒ ten× smaller reactance)
    const p10 = portReflection(w, OPTS, F * 10)
    expect(p10.zinIm).toBeCloseTo(expectedIm / 10, 0)
  })

  test('a matched load sees through a matched transmission line (Zin = Z0 at every frequency)', () => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(
      w,
      'tl',
      'transmission_line',
      {
        characteristic_impedance: scalar(50, 'ohm'),
        length: scalar(1, 'meter'),
        velocity_factor: scalar(0.95, 'dimensionless'),
      },
      [
        { net: 'in', terminal: 'near_a' },
        { net: 'gnd', terminal: 'near_b' },
        { net: 'far', terminal: 'far_a' },
        { net: 'gnd', terminal: 'far_b' },
      ],
    )
    addPart(w, 'rload', 'resistor', { resistance: scalar(50, 'ohm') }, [
      { net: 'far', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    // a line terminated in its own Z0 shows Z0 at the input regardless of length/frequency
    for (const f of [1e6, 5e7, 2e8]) {
      const p = portReflection(w, OPTS, f)
      expect(p.zinRe).toBeCloseTo(50, 1)
      expect(p.gammaMag).toBeLessThan(1e-2)
    }
  })
})

describe('portReflectionSweep', () => {
  test('returns steps+1 points across the band', () => {
    const pts = portReflectionSweep(portIntoR(50), {
      ...OPTS,
      fStartHz: 1e3,
      fStopHz: 1e9,
      pointsPerDecade: 5,
    })
    expect(pts).toHaveLength(6 * 5 + 1) // 6 decades × 5/decade + 1
    expect(pts[0]?.frequencyHz).toBeCloseTo(1e3, 0)
    expect(pts.at(-1)?.frequencyHz).toBeCloseTo(1e9, -3)
  })

  test('a matched resistor stays matched at every frequency (frequency-independent)', () => {
    const pts = portReflectionSweep(portIntoR(50), {
      ...OPTS,
      fStartHz: 1e3,
      fStopHz: 1e9,
      pointsPerDecade: 4,
    })
    for (const p of pts) expect(p.gammaMag).toBeLessThan(1e-5)
  })

  test('a mismatched resistor holds a constant |Γ| across frequency', () => {
    const pts = portReflectionSweep(portIntoR(150), {
      ...OPTS,
      fStartHz: 1e3,
      fStopHz: 1e9,
      pointsPerDecade: 3,
    })
    for (const p of pts) expect(p.gammaMag).toBeCloseTo(0.5, 3)
  })
})

describe('the reference_port part — a driver only in reflection, an open otherwise', () => {
  test('a reference_port can BE the port (reflection drives it, reads Zin = R)', () => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'port', 'reference_port', { reference_impedance: scalar(50, 'ohm') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(w, 'rload', 'resistor', { resistance: scalar(150, 'ohm') }, [
      { net: 'in', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    const p = portReflection(w, { inputSource: 'port', z0Ohms: 50 }, F)
    expect(p.zinRe).toBeCloseTo(150, 1)
    expect(p.gammaMag).toBeCloseTo(0.5, 3)
  })

  test('a reference_port does NOT short a Bode analysis — it is an open outside reflection', () => {
    // RC low-pass driven by a power_source; hang a reference_port from `out` to gnd. If the port shorted
    // (like a real vsource would), `out` would collapse; because it is an open, the −3 dB corner is intact.
    const R = 1000
    const C = 1e-6
    const fc = 1 / (2 * Math.PI * R * C)
    const rc = (withPort: boolean): World => {
      const w = makeWorld()
      ensureNet(w, 'gnd', true)
      addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
        { net: 'in', terminal: 'terminal_positive' },
        { net: 'gnd', terminal: 'terminal_negative' },
      ])
      addPart(w, 'r1', 'resistor', { resistance: scalar(R, 'ohm') }, [
        { net: 'in', terminal: 'terminal_a' },
        { net: 'out', terminal: 'terminal_b' },
      ])
      addPart(w, 'c1', 'capacitor', { capacitance: scalar(C, 'farad') }, [
        { net: 'out', terminal: 'terminal_a' },
        { net: 'gnd', terminal: 'terminal_b' },
      ])
      if (withPort) {
        addPart(w, 'port', 'reference_port', { reference_impedance: scalar(50, 'ohm') }, [
          { net: 'out', terminal: 'terminal_positive' },
          { net: 'gnd', terminal: 'terminal_negative' },
        ])
      }
      return w
    }
    const bode = (w: World) => acResponse(w, { inputSource: 'vin', outputNet: 'out' }, fc).gainDb
    expect(bode(rc(true))).toBeCloseTo(bode(rc(false)), 6) // the port changed nothing
    expect(bode(rc(true))).toBeCloseTo(-3.0103, 2) // still the textbook −3 dB corner
  })

  test('a reference_port is an open at DC — no unsupported-element warning', () => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(5, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(w, 'r1', 'resistor', { resistance: scalar(1000, 'ohm') }, [
      { net: 'in', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    addPart(w, 'port', 'reference_port', { reference_impedance: scalar(50, 'ohm') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    const res = solveDCRobust(w)
    expect(res.warnings.some((warn) => /unsupported/i.test(warn) && /port/.test(warn))).toBe(false)
  })
})

describe('portReflection — degenerate inputs', () => {
  test('no ground net ⇒ empty sweep, NaN single point', () => {
    const w = makeWorld() // no ground
    addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'out', terminal: 'terminal_negative' },
    ])
    expect(
      portReflectionSweep(w, { ...OPTS, fStartHz: 1e3, fStopHz: 1e6, pointsPerDecade: 2 }),
    ).toEqual([])
    expect(portReflection(w, OPTS, F).gammaMag).toBeNaN()
  })

  test('an unknown source id ⇒ NaN reflection', () => {
    const p = portReflection(portIntoR(50), { inputSource: 'nope', z0Ohms: 50 }, F)
    expect(p.zinRe).toBeNaN()
    expect(p.gammaMag).toBeNaN()
  })

  test('Z0 defaults to 50 Ω when unset or non-positive', () => {
    const a = portReflection(portIntoR(150), { inputSource: 'p1' }, F)
    const b = portReflection(portIntoR(150), { inputSource: 'p1', z0Ohms: 0 }, F)
    expect(a.gammaMag).toBeCloseTo(0.5, 3) // (150−50)/(150+50)
    expect(b.gammaMag).toBeCloseTo(0.5, 3)
  })
})
