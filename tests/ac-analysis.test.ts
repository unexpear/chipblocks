/**
 * AC analysis vs the textbook (Sprint 22) — the new frequency-domain engine, checked
 * against the two first-order responses every engineer knows cold:
 *
 *   • RC low-pass  H = 1/(1+jwRC):  −3 dB and −45° at the corner f_c = 1/(2πRC),
 *     flat (0 dB, 0°) well below, rolling off −20 dB/decade toward −90° above.
 *   • CR high-pass H = jwRC/(1+jwRC): the mirror image — −3 dB and +45° at f_c,
 *     flat above, +90° far below.
 *
 * Exact analytic targets, so the engine has to match to several digits, not roughly.
 */

import { describe, expect, test } from 'vitest'
import { acResponse, acSweep } from '../src/ac-analysis.ts'
import type { Instance, World } from '../src/cross-fk-validator.ts'
import { solveDCRobust } from '../src/dc-robust.ts'
import { diodeSmallSignalModel } from '../src/small-signal.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const enumValue = (value: string) => ({ value })

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

/** vin -> R -> out -> C -> gnd : the classic low-pass. */
function rcLowPass(rOhm: number, cFarad: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'r1', 'resistor', { resistance: scalar(rOhm, 'ohm') }, [
    { net: 'in', terminal: 'terminal_a' },
    { net: 'out', terminal: 'terminal_b' },
  ])
  addPart(w, 'c1', 'capacitor', { capacitance: scalar(cFarad, 'farad') }, [
    { net: 'out', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

/** vin -> C -> out -> R -> gnd : the classic high-pass. */
function crHighPass(rOhm: number, cFarad: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'c1', 'capacitor', { capacitance: scalar(cFarad, 'farad') }, [
    { net: 'in', terminal: 'terminal_a' },
    { net: 'out', terminal: 'terminal_b' },
  ])
  addPart(w, 'r1', 'resistor', { resistance: scalar(rOhm, 'ohm') }, [
    { net: 'out', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

const R = 1000
const C = 1e-6
const fc = 1 / (2 * Math.PI * R * C) // 159.155 Hz
const opts = { inputSource: 'vin', outputNet: 'out' }

describe('AC analysis — first-order RC filters vs textbook', () => {
  test('RC low-pass: −3 dB and −45° at the corner, flat below, −20 dB/decade above', () => {
    const w = rcLowPass(R, C)

    const atFc = acResponse(w, opts, fc)
    expect(atFc.gain).toBeCloseTo(Math.SQRT1_2, 4) // 1/√2
    expect(atFc.gainDb).toBeCloseTo(-3.0103, 3)
    expect(atFc.phaseDeg).toBeCloseTo(-45, 3)

    const low = acResponse(w, opts, fc / 1000)
    expect(low.gain).toBeCloseTo(1, 3)
    expect(Math.abs(low.phaseDeg)).toBeLessThan(0.1)

    // A decade of frequency costs ~20 dB once well above the corner.
    const d1 = acResponse(w, opts, fc * 100)
    const d2 = acResponse(w, opts, fc * 1000)
    expect(d1.gainDb - d2.gainDb).toBeCloseTo(20, 1)
    expect(d2.phaseDeg).toBeLessThan(-89) // approaching −90°
  })

  test('CR high-pass: −3 dB and +45° at the corner, flat above, +90° far below', () => {
    const w = crHighPass(R, C)

    const atFc = acResponse(w, opts, fc)
    expect(atFc.gain).toBeCloseTo(Math.SQRT1_2, 4)
    expect(atFc.phaseDeg).toBeCloseTo(45, 3)

    const high = acResponse(w, opts, fc * 1000)
    expect(high.gain).toBeCloseTo(1, 3)
    expect(Math.abs(high.phaseDeg)).toBeLessThan(0.1)

    const low = acResponse(w, opts, fc / 1000)
    expect(low.phaseDeg).toBeGreaterThan(89) // approaching +90°
  })

  test('sweep returns a monotone roll-off across the band', () => {
    const points = acSweep(rcLowPass(R, C), {
      ...opts,
      fStartHz: 1,
      fStopHz: 1e5,
      pointsPerDecade: 10,
    })
    expect(points.length).toBeGreaterThan(40)
    for (let i = 1; i < points.length; i++) {
      expect((points[i]?.gain ?? 0) <= (points[i - 1]?.gain ?? 0) + 1e-9).toBe(true)
    }
    expect(points[0]?.gain ?? 0).toBeCloseTo(1, 2) // 1 Hz << f_c
    expect(points[points.length - 1]?.gainDb ?? 0).toBeLessThan(-40) // 100 kHz >> f_c
  })
})

/**
 * Common-emitter amplifier: vcc(9V) -> Rc(4.5k) -> collector, base driven by `vinDc`
 * (also the AC stimulus), emitter to ground. The transistor carries cited device
 * capacitances so the response rolls off. ~0.8 mA bias gives g_m ~ 31 mS and a
 * low-frequency gain of g_m*(Rc||r_o) ~ 130, inverting.
 */
function commonEmitterAmp(vinDc: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vcc', 'power_source', { nominal_voltage: scalar(9, 'volt') }, [
    { net: 'vcc', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(vinDc, 'volt') }, [
    { net: 'base', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'rc', 'resistor', { resistance: scalar(4500, 'ohm') }, [
    { net: 'vcc', terminal: 'terminal_a' },
    { net: 'coll', terminal: 'terminal_b' },
  ])
  addPart(
    w,
    'q1',
    'transistor_bjt_npn',
    {
      saturation_current: scalar(1e-14, 'ampere'),
      forward_current_gain: scalar(150, 'dimensionless'),
      reverse_current_gain: scalar(2, 'dimensionless'),
      forward_early_voltage: scalar(74, 'volt'),
      base_emitter_capacitance: scalar(4.5e-12, 'farad'),
      base_collector_capacitance: scalar(3.6e-12, 'farad'),
      forward_transit_time: scalar(300e-12, 'second'),
    },
    [
      { net: 'coll', terminal: 'collector' },
      { net: 'base', terminal: 'base' },
      { net: 'gnd', terminal: 'emitter' },
    ],
  )
  return w
}

describe('AC analysis — transistor small-signal (common-emitter amp)', () => {
  const ceOpts = { inputSource: 'vin', outputNet: 'coll' }

  test('low-frequency gain equals the DC small-signal slope, and it inverts', () => {
    const vinDc = 0.65
    // The DC small-signal slope dVc/dVin, straight off the nonlinear DC solver.
    const delta = 1e-4
    const vc = (vin: number) => solveDCRobust(commonEmitterAmp(vin)).nodes.get('coll') ?? Number.NaN
    const dcSlope = Math.abs((vc(vinDc + delta) - vc(vinDc - delta)) / (2 * delta))

    // The AC gain at a low frequency (caps negligible) must be the same number —
    // because the AC conductances ARE the DC companion Jacobian.
    const ac = acResponse(commonEmitterAmp(vinDc), ceOpts, 10)
    expect(ac.gain).toBeGreaterThan(80) // a real CE gain (~130), not a divider
    expect(ac.gain).toBeLessThan(220)
    expect(Math.abs(ac.gain / dcSlope - 1)).toBeLessThan(0.02) // within ~1% of the DC slope

    // Common-emitter inverts: the phase is ~180 deg.
    expect(Math.abs(ac.phaseDeg)).toBeGreaterThan(170)
  })

  test('the base-collector capacitance rolls the gain off at high frequency', () => {
    const amp = commonEmitterAmp(0.65)
    const low = acResponse(amp, ceOpts, 1e3).gain
    const high = acResponse(amp, ceOpts, 1e9).gain
    expect(high).toBeLessThan(0.3 * low) // a genuine high-frequency roll-off from C_mu
  })

  test('supplying a part temperature shifts the operating point and the gain', () => {
    const amp = commonEmitterAmp(0.65)
    const cold = acResponse(amp, ceOpts, 10).gain
    const hot = acResponse(amp, { ...ceOpts, temperaturesC: new Map([['q1', 85]]) }, 10).gain
    expect(Number.isFinite(hot)).toBe(true) // the hot operating point still solves
    expect(Math.abs(hot / cold - 1)).toBeGreaterThan(0.05) // temperature is threaded → the gain moves
  })
})

/** vin -> R -> mid -> WIRE -> out -> C -> gnd : the wire must vanish (short mid = out), so this reads
 *  identically to the plain low-pass. */
function rcLowPassThroughWire(rOhm: number, cFarad: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'r1', 'resistor', { resistance: scalar(rOhm, 'ohm') }, [
    { net: 'in', terminal: 'terminal_a' },
    { net: 'mid', terminal: 'terminal_b' },
  ])
  addPart(w, 'w1', 'wire', {}, [
    { net: 'mid', terminal: 'terminal_a' },
    { net: 'out', terminal: 'terminal_b' },
  ])
  addPart(w, 'c1', 'capacitor', { capacitance: scalar(cFarad, 'farad') }, [
    { net: 'out', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

describe('AC analysis — wires stamp as shorts', () => {
  test('a series wire is transparent: the response matches the wireless low-pass', () => {
    const atFc = acResponse(rcLowPassThroughWire(R, C), opts, fc)
    expect(atFc.gain).toBeCloseTo(Math.SQRT1_2, 4) // −3 dB at the corner, exactly as with no wire
    expect(atFc.phaseDeg).toBeCloseTo(-45, 3)
    const low = acResponse(rcLowPassThroughWire(R, C), opts, fc / 1000)
    expect(low.gain).toBeCloseTo(1, 3) // flat well below the corner — the wire adds nothing
  })
})

/** vdd(10V) -> Rd(1k) -> drain; gate driven by `vGateDc` (also the AC stimulus); source to ground.
 *  V_th 2 V, k 0.01 A/V^2: at V_GS = 3 V the NMOS sits in saturation (I_D ~ 5 mA, V_DS ~ 5 V), so
 *  g_m = k*V_OV = 0.01 S and the low-frequency gain g_m*Rd ~ 10, inverting. */
function commonSourceAmp(vGateDc: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vdd', 'power_source', { nominal_voltage: scalar(10, 'volt') }, [
    { net: 'vdd', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(vGateDc, 'volt') }, [
    { net: 'gate', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'rd', 'resistor', { resistance: scalar(1000, 'ohm') }, [
    { net: 'vdd', terminal: 'terminal_a' },
    { net: 'drain', terminal: 'terminal_b' },
  ])
  addPart(
    w,
    'm1',
    'transistor_mosfet_nmos',
    {
      threshold_voltage: scalar(2, 'volt'),
      transconductance_parameter: scalar(0.01, 'ampere_per_volt_squared'),
    },
    [
      { net: 'drain', terminal: 'drain' },
      { net: 'gate', terminal: 'gate' },
      { net: 'gnd', terminal: 'source' },
    ],
  )
  return w
}

describe('AC analysis — MOSFET small-signal (common-source amp)', () => {
  const csOpts = { inputSource: 'vin', outputNet: 'drain' }

  test('low-frequency gain equals the DC small-signal slope, and it inverts', () => {
    const vg = 3
    // The DC small-signal slope dVdrain/dVgate, straight off the nonlinear DC solver.
    const delta = 1e-4
    const vd = (v: number) => solveDCRobust(commonSourceAmp(v)).nodes.get('drain') ?? Number.NaN
    const dcSlope = Math.abs((vd(vg + delta) - vd(vg - delta)) / (2 * delta))

    const ac = acResponse(commonSourceAmp(vg), csOpts, 10)
    expect(ac.gain).toBeGreaterThan(5) // a real CS gain (~g_m*Rd = 10), not zero (the MOSFET dropped)
    expect(Math.abs(ac.gain / dcSlope - 1)).toBeLessThan(0.02) // == the DC companion slope (~1%)
    expect(Math.abs(ac.phaseDeg)).toBeGreaterThan(170) // common-source inverts
  })
})

/** vin(3V bias + AC) -> diode -> mid -> R(1k) -> gnd. A forward diode is a small dynamic resistance
 *  r_d = 1/g_d, so v_mid/v_in is the divider R/(R+r_d) — and that must equal the DC slope dVmid/dVin. */
function diodeDivider(vinDc: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(vinDc, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(
    w,
    'd1',
    'diode_silicon_rectifier',
    {
      forward_voltage: scalar(0.7, 'volt'),
      max_forward_current: scalar(1, 'ampere'),
      ideality_factor: scalar(2, 'dimensionless'),
    },
    [
      { net: 'in', terminal: 'anode' },
      { net: 'mid', terminal: 'cathode' },
    ],
  )
  addPart(w, 'r1', 'resistor', { resistance: scalar(1000, 'ohm') }, [
    { net: 'mid', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

describe('AC analysis — forward-diode small-signal', () => {
  const dOpts = { inputSource: 'vin', outputNet: 'mid' }

  test('a forward diode passes as its dynamic conductance — matching the DC slope', () => {
    const vin = 3
    const delta = 1e-4
    const vmid = (v: number) => solveDCRobust(diodeDivider(v)).nodes.get('mid') ?? Number.NaN
    const dcSlope = Math.abs((vmid(vin + delta) - vmid(vin - delta)) / (2 * delta))

    const ac = acResponse(diodeDivider(vin), dOpts, 10)
    expect(ac.gain).toBeGreaterThan(0.5) // the diode conducts (g_d stamped); dropped would read ~0
    expect(Math.abs(ac.gain / dcSlope - 1)).toBeLessThan(0.02) // == the DC small-signal slope
  })
})

/** vin(5V reverse bias + AC) -> varactor(cathode='in', anode='out') -> out -> R(1M) -> gnd. The
 *  reverse-biased varactor is a near-ideal C_j(V) to the signal: a high-pass that rolls in above
 *  ~1/(2πR·C_j). */
function varactorHighPass(): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(5, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(
    w,
    'cv',
    'diode_varactor',
    {
      junction_capacitance_zero_bias: scalar(100e-12, 'farad'),
      junction_potential: scalar(0.7, 'volt'),
      grading_coefficient: scalar(0.5, 'dimensionless'),
    },
    [
      { net: 'out', terminal: 'anode' },
      { net: 'in', terminal: 'cathode' },
    ],
  )
  addPart(w, 'r1', 'resistor', { resistance: scalar(1e6, 'ohm') }, [
    { net: 'out', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

describe('AC analysis — varactor presents its junction capacitance', () => {
  const vOpts = { inputSource: 'vin', outputNet: 'out' }

  test('the reverse-biased varactor couples high frequencies (a C_j high-pass), blocks low ones', () => {
    const low = acResponse(varactorHighPass(), vOpts, 10).gain
    const high = acResponse(varactorHighPass(), vOpts, 1e7).gain
    expect(low).toBeLessThan(0.1) // C_j blocks well below the corner
    expect(high).toBeGreaterThan(0.7) // and passes well above it — the varactor IS a capacitor here
  })
})

/** vin -> common; the SPDT routes common to throw_a ('a') or throw_b ('b') by its position; each
 *  throw has a resistor to ground so the unselected one is a defined (driven-to-zero) node. */
function spdtRouter(position: string): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'common', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'sw', 'switch_spdt', { position: enumValue(position) }, [
    { net: 'common', terminal: 'common' },
    { net: 'a', terminal: 'throw_a' },
    { net: 'b', terminal: 'throw_b' },
  ])
  addPart(w, 'ra', 'resistor', { resistance: scalar(1000, 'ohm') }, [
    { net: 'a', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  addPart(w, 'rb', 'resistor', { resistance: scalar(1000, 'ohm') }, [
    { net: 'b', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

/** vin -> common; the relay contact ties common to normally_closed (at rest) or normally_open
 *  (energized). The coil sits across coila/gnd (its resistor must keep that net non-floating). */
function relayContact(coilState: string): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'common', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(
    w,
    'k1',
    'relay',
    { coil_state: enumValue(coilState), coil_resistance: scalar(100, 'ohm') },
    [
      { net: 'common', terminal: 'common' },
      { net: 'nc', terminal: 'normally_closed' },
      { net: 'no', terminal: 'normally_open' },
      { net: 'coila', terminal: 'coil_a' },
      { net: 'gnd', terminal: 'coil_b' },
    ],
  )
  addPart(w, 'rnc', 'resistor', { resistance: scalar(1000, 'ohm') }, [
    { net: 'nc', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  addPart(w, 'rno', 'resistor', { resistance: scalar(1000, 'ohm') }, [
    { net: 'no', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

describe('AC analysis — SPDT + relay contacts stamp as shorts', () => {
  test('an SPDT routes the signal to its selected throw, isolating the other', () => {
    const toA = spdtRouter('throw_a')
    expect(acResponse(toA, { inputSource: 'vin', outputNet: 'a' }, 1e3).gain).toBeCloseTo(1, 3)
    expect(acResponse(toA, { inputSource: 'vin', outputNet: 'b' }, 1e3).gain).toBeLessThan(0.01)
    const toB = spdtRouter('throw_b')
    expect(acResponse(toB, { inputSource: 'vin', outputNet: 'b' }, 1e3).gain).toBeCloseTo(1, 3)
    expect(acResponse(toB, { inputSource: 'vin', outputNet: 'a' }, 1e3).gain).toBeLessThan(0.01)
  })

  test('a relay contact ties common to NC at rest, NO when energized (coil stays non-floating)', () => {
    const atRest = relayContact('de_energized')
    expect(acResponse(atRest, { inputSource: 'vin', outputNet: 'nc' }, 1e3).gain).toBeCloseTo(1, 3)
    expect(acResponse(atRest, { inputSource: 'vin', outputNet: 'no' }, 1e3).gain).toBeLessThan(0.01)
    const energized = relayContact('energized')
    expect(acResponse(energized, { inputSource: 'vin', outputNet: 'no' }, 1e3).gain).toBeCloseTo(
      1,
      3,
    )
    expect(acResponse(energized, { inputSource: 'vin', outputNet: 'nc' }, 1e3).gain).toBeLessThan(
      0.01,
    )
  })
})

/** A bare 2-terminal diode instance (anode='a', cathode='k') — for unit-testing the regime-specific
 *  small-signal conductance directly, with a mock node-voltage map. */
function diodeInst(definition: string, parameters: Record<string, { value: unknown }>): Instance {
  return {
    id: 'd',
    kind_ref: 'primitive_device',
    definition,
    parameters,
    connects: [
      { net: 'a', terminal: 'anode', of: 'd' },
      { net: 'k', terminal: 'cathode', of: 'd' },
    ],
  }
}

describe('AC analysis — zener / tunnel / Shockley-latch small-signal', () => {
  test('a zener in reverse breakdown has a positive dynamic conductance (its r_z)', () => {
    const z = diodeInst('diode_zener_silicon', {
      forward_voltage: scalar(0.9, 'volt'),
      max_forward_current: scalar(1, 'ampere'),
      zener_voltage: scalar(5.1, 'volt'),
      knee_current: scalar(0.005, 'ampere'),
    })
    const nodeV = (net: string) => (net === 'k' ? 5.6 : 0) // V = anode−cathode = −5.6, past −V_Z
    expect(diodeSmallSignalModel(z, nodeV)?.g ?? 0).toBeGreaterThan(0) // breakdown slope, r_z = 1/g
  })

  test('a tunnel diode biased in its negative-resistance region has a NEGATIVE conductance', () => {
    const t = diodeInst('diode_tunnel', {
      peak_voltage: scalar(0.065, 'volt'),
      peak_current: scalar(1e-3, 'ampere'),
      valley_voltage: scalar(0.35, 'volt'),
      valley_current: scalar(1e-4, 'ampere'),
    })
    const nodeV = (net: string) => (net === 'a' ? 0.2 : 0) // 0.2 V sits between peak and valley (NDR)
    expect(diodeSmallSignalModel(t, nodeV)?.g ?? 0).toBeLessThan(0) // dI/dV < 0 — the tunnel's signature
  })

  test('a Shockley-latch diode conducts as a forward diode when latched, opens when blocking', () => {
    const on = diodeInst('diode_shockley', { device_state: enumValue('conducting') })
    expect(diodeSmallSignalModel(on, () => 0, 0.01)?.g ?? 0).toBeGreaterThan(0) // 10 mA → forward g
    const off = diodeInst('diode_shockley', { device_state: enumValue('blocking') })
    expect(diodeSmallSignalModel(off, () => 0, 0)).toBeNull() // blocking + no current → nothing to stamp
  })
})

/** vin(0 V DC + AC) -> gate; vdd(10 V) -> Rd(500) -> drain; source to ground. An n-channel JFET at
 *  V_GS = 0 sits at I_DSS in saturation, giving a real common-source gain ~g_m·Rd. */
function jfetCommonSource(): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vdd', 'power_source', { nominal_voltage: scalar(10, 'volt') }, [
    { net: 'vdd', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(0, 'volt') }, [
    { net: 'gate', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'rd', 'resistor', { resistance: scalar(500, 'ohm') }, [
    { net: 'vdd', terminal: 'terminal_a' },
    { net: 'drain', terminal: 'terminal_b' },
  ])
  addPart(
    w,
    'j1',
    'transistor_jfet_n_channel',
    {
      pinch_off_voltage: scalar(-2, 'volt'),
      transconductance: scalar(0.002, 'ampere_per_volt_squared'),
    },
    [
      { net: 'drain', terminal: 'drain' },
      { net: 'gate', terminal: 'gate' },
      { net: 'gnd', terminal: 'source' },
    ],
  )
  return w
}

describe('AC analysis — JFET transconductance scales with temperature', () => {
  const opts = { inputSource: 'vin', outputNet: 'drain' }
  test("a JFET amp's gain falls with temperature (carrier mobility ∝ T^−1.5)", () => {
    const amp = jfetCommonSource()
    const cold = acResponse(amp, opts, 10).gain
    const hot = acResponse(amp, { ...opts, temperaturesC: new Map([['j1', 125]]) }, 10).gain
    expect(cold).toBeGreaterThan(1) // a real common-source gain (~g_m·Rd)
    expect(hot).toBeLessThan(cold) // higher T → lower mobility → lower g_m → lower gain
    expect(Math.abs(hot / cold - 1)).toBeGreaterThan(0.05)
  })
})
