/**
 * 2-PORT S-PARAMETERS (analog-RF increment 5) — the scattering matrix S11/S21/S12/S22 read off the AC engine
 * by driving one port with a Z0-referenced generator and terminating the other in Z0. Checked against closed
 * form: (1) a matched lossless transmission line is a pure delay — S11 = 0, |S21| = 1, and ∠S21 = −θ (its
 * electrical length); (2) a series resistor between two Z0 ports has the textbook S11 = Z/(2Z0+Z),
 * S21 = 2Z0/(2Z0+Z); (3) passive networks are reciprocal (S12 = S21) and symmetric ones have S11 = S22.
 */
import { describe, expect, test } from 'vitest'
import { portSParameters } from '../src/ac-analysis.ts'
import type { World } from '../src/cross-fk-validator.ts'
import { propagationDelayS } from '../src/transmission-line-model.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const makeWorld = (): World => ({
  definitions: new Map(),
  instances: new Map(),
  behaviors: new Map(),
  activeVariables: new Map(),
  nets: new Map(),
})
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
/** A reference port (p+ on `sigNet`, p− on ground) — the S-param engine drives/terminates across it. */
function port(world: World, id: string, sigNet: string) {
  addPart(world, id, 'reference_port', { reference_impedance: scalar(50, 'ohm') }, [
    { net: sigNet, terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
}

/** A transmission line as a 2-port: near end at port p1, far end at port p2, both returns to ground. */
function lineTwoPort(z0 = 50, lengthM = 10, vf = 0.66): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  port(w, 'p1', 'n1')
  port(w, 'p2', 'n2')
  addPart(
    w,
    'tl',
    'transmission_line',
    {
      characteristic_impedance: scalar(z0, 'ohm'),
      length: scalar(lengthM, 'meter'),
      velocity_factor: scalar(vf, 'dimensionless'),
    },
    [
      { net: 'n1', terminal: 'near_a' },
      { net: 'gnd', terminal: 'near_b' },
      { net: 'n2', terminal: 'far_a' },
      { net: 'gnd', terminal: 'far_b' },
    ],
  )
  return w
}

/** A single series impedance Z between two Z0 ports (the classic series-element 2-port). */
function seriesR(rOhm: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  port(w, 'p1', 'a')
  port(w, 'p2', 'b')
  addPart(w, 'rs', 'resistor', { resistance: scalar(rOhm, 'ohm') }, [
    { net: 'a', terminal: 'terminal_a' },
    { net: 'b', terminal: 'terminal_b' },
  ])
  return w
}

/** A bare wire between the two ports — a perfect (0 Ω) through. */
function throughWire(): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  port(w, 'p1', 'a')
  port(w, 'p2', 'b')
  addPart(w, 'link', 'wire', {}, [
    { net: 'a', terminal: 'lead_a' },
    { net: 'b', terminal: 'lead_b' },
  ])
  return w
}

/** An L-network: series R from port 1 to node b, shunt C from b to ground, port 2 at b. Reciprocal but NOT
 *  symmetric (the two ports see different networks) and reactive (complex S). */
function lNetwork(rOhm: number, cFarad: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  port(w, 'p1', 'a')
  port(w, 'p2', 'b')
  addPart(w, 'rs', 'resistor', { resistance: scalar(rOhm, 'ohm') }, [
    { net: 'a', terminal: 'terminal_a' },
    { net: 'b', terminal: 'terminal_b' },
  ])
  addPart(w, 'cs', 'capacitor', { capacitance: scalar(cFarad, 'farad') }, [
    { net: 'b', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

const OPTS = { port1: 'p1', port2: 'p2', z0Ohms: 50 }
const mag = (c: { re: number; im: number }) => Math.hypot(c.re, c.im)

describe('a matched lossless transmission line is a pure delay', () => {
  const F = 2.5e6 // θ ≈ π/4 for this line
  test('S11 ≈ 0, |S21| ≈ 1, and ∠S21 = −θ (its electrical length)', () => {
    const s = portSParameters(lineTwoPort(), OPTS, F)
    expect(mag(s.s11)).toBeLessThan(1e-6) // matched at both ports → nothing reflects
    expect(mag(s.s21)).toBeCloseTo(1, 6) // lossless → all the power gets through
    const thetaDeg = (2 * Math.PI * F * propagationDelayS(10, 0.66) * 180) / Math.PI
    expect(s.s21Deg).toBeCloseTo(-thetaDeg, 1) // the transmitted wave lags by the electrical length
    expect(s.s21Db).toBeCloseTo(0, 4) // |S21| = 1 → 0 dB insertion loss
  })

  test('the line is reciprocal (S12 = S21) and symmetric (S11 = S22)', () => {
    const s = portSParameters(lineTwoPort(), OPTS, F)
    expect(s.s12.re).toBeCloseTo(s.s21.re, 9)
    expect(s.s12.im).toBeCloseTo(s.s21.im, 9)
    expect(s.s22.re).toBeCloseTo(s.s11.re, 9)
    expect(s.s22.im).toBeCloseTo(s.s11.im, 9)
  })
})

describe('a series resistor between two 50 Ω ports matches the closed form', () => {
  // Absolute values carry a ~5e-8 offset from the engine's 1 GΩ node-to-ground AC_GMIN leak, so they are
  // checked to 6 places; the reciprocity/symmetry RELATIONS are exact (the leak cancels) and checked to 9.
  test('Z = Z0 gives S11 = 1/3, S21 = 2/3 (both real)', () => {
    const s = portSParameters(seriesR(50), OPTS, 1e6)
    // S11 = Z/(2Z0+Z) = 50/150 = 1/3 ; S21 = 2Z0/(2Z0+Z) = 100/150 = 2/3.
    expect(s.s11.re).toBeCloseTo(1 / 3, 6)
    expect(s.s11.im).toBeCloseTo(0, 6)
    expect(s.s21.re).toBeCloseTo(2 / 3, 6)
    expect(s.s21.im).toBeCloseTo(0, 6)
    // |S11|² + |S21|² = 1/9 + 4/9 = 5/9 < 1 — a lossy resistor absorbs the rest (not unitary).
    expect(mag(s.s11) ** 2 + mag(s.s21) ** 2).toBeCloseTo(5 / 9, 6)
  })

  test('a general Z follows S11 = Z/(2Z0+Z), S21 = 2Z0/(2Z0+Z), and stays reciprocal/symmetric', () => {
    const Z = 150
    const s = portSParameters(seriesR(Z), OPTS, 1e6)
    expect(s.s11.re).toBeCloseTo(Z / (100 + Z), 6) // 150/250 = 0.6
    expect(s.s21.re).toBeCloseTo(100 / (100 + Z), 6) // 100/250 = 0.4
    expect(s.s12.re).toBeCloseTo(s.s21.re, 9) // reciprocal (exact)
    expect(s.s22.re).toBeCloseTo(s.s11.re, 9) // symmetric (exact)
  })

  test('a bare wire is a perfect through: S11 = 0, S21 = 1', () => {
    const s = portSParameters(throughWire(), OPTS, 1e6)
    expect(mag(s.s11)).toBeLessThan(1e-6)
    expect(s.s21.re).toBeCloseTo(1, 6)
  })

  test('the closed form holds at a NON-default reference impedance (Z0 = 75)', () => {
    // Z = Z0 = 75 → S11 = 75/225 = 1/3, S21 = 150/225 = 2/3, independent of the actual Z0 value.
    const s = portSParameters(seriesR(75), { port1: 'p1', port2: 'p2', z0Ohms: 75 }, 1e6)
    expect(s.s11.re).toBeCloseTo(1 / 3, 6)
    expect(s.s21.re).toBeCloseTo(2 / 3, 6)
  })
})

describe('an asymmetric reactive network stays reciprocal but not symmetric', () => {
  test('an R–C L-network has S12 = S21, S11 ≠ S22, and complex (reactive) parameters', () => {
    const s = portSParameters(lNetwork(50, 100e-12), OPTS, 30e6) // 50 Ω series, 100 pF shunt, 30 MHz
    // Reciprocal (passive) → S12 = S21 to numerical precision.
    expect(s.s12.re).toBeCloseTo(s.s21.re, 9)
    expect(s.s12.im).toBeCloseTo(s.s21.im, 9)
    // Asymmetric → the two input reflections differ (port 1 sees R then C; port 2 sees C then R).
    expect(mag({ re: s.s11.re - s.s22.re, im: s.s11.im - s.s22.im })).toBeGreaterThan(0.05)
    // Reactive → the transmission carries real phase (a non-trivial imaginary part).
    expect(Math.abs(s.s21.im)).toBeGreaterThan(0.01)
  })
})

describe('S-parameters — degenerate inputs', () => {
  test('an unknown port id yields an all-NaN point', () => {
    const s = portSParameters(seriesR(50), { port1: 'nope', port2: 'p2', z0Ohms: 50 }, 1e6)
    expect(Number.isNaN(s.s11.re)).toBe(true)
    expect(Number.isNaN(s.s21.re)).toBe(true)
  })

  test('the same port for both ends yields an all-NaN point', () => {
    const s = portSParameters(seriesR(50), { port1: 'p1', port2: 'p1', z0Ohms: 50 }, 1e6)
    expect(Number.isNaN(s.s21.re)).toBe(true)
  })
})
