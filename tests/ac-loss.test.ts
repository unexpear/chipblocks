/**
 * AC LOSS — the small-signal engine reads the loss the parts already carry.
 *
 * The AC engine used to stamp a capacitor and an inductor as PURE reactance while the DC and transient
 * engines read the very same part's declared winding resistance. A 1 µH coil declaring 32 Ω of DCR (the value
 * the shipped inductor default carries — see part-defaults.ts) read Zin = 0.0004 + j628.3 at 100 MHz — the
 * 0.0004 a numerical floor, not copper — so every reflection, S-parameter and Bode number came out too good, and a
 * perfectly-tuned L-match reported a return loss no physical circuit reaches.
 *
 * Everything here is pinned to a CLOSED-FORM impedance, never to the engine's own output:
 *   coil       Z = R_winding + jωL          ⇒ Re = R at every ω, |Z| = √(R² + (ωL)²), ∠Z = atan(ωL/R)
 *   capacitor  Z = ESR − j/(ωC)             ⇒ Re = ESR,        |Z| = √(ESR² + (1/ωC)²)
 *   cap by DF  ESR = tanδ/(ωC)              ⇒ Re/|Im| = tanδ at every ω (the loss ANGLE is what tanδ is)
 *   L-match    Zin = R_coil + Z0            ⇒ Γ = R_coil/(2·Z0 + R_coil) — the series copper is all that is
 *                                             left when the reactances cancel, so RL is a hand-checkable number
 * and the reverse direction is pinned too: a part declaring NO loss must solve EXACTLY as before.
 */
import { describe, expect, test } from 'vitest'
import {
  acGminFloorOhms,
  acLossParameters,
  acResponse,
  capacitorEsrOhms,
  partsDroppedFromAcSolve,
  partsSolvedAsPerfectReactance,
  partsWithNoDeclaredAcLoss,
  portReflection,
  portSParameters,
} from '../src/ac-analysis.ts'
import type { World } from '../src/cross-fk-validator.ts'
import {
  defaultParameters,
  type Parameters as PartParameters,
} from '../src/renderer/part-defaults.ts'
import { returnLossDbFromGamma } from '../src/rf-math.ts'

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
  parameters: PartParameters,
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

/** A 1 V port across one two-terminal part, so the reflection read-out returns that part's own impedance. */
function portAcross(definition: string, parameters: PartParameters): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'dut', definition, parameters, [
    { net: 'in', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}
const zinAt = (world: World, frequencyHz: number) => {
  const p = portReflection(world, { inputSource: 'p1', z0Ohms: 50 }, frequencyHz)
  return { re: p.zinRe, im: p.zinIm, magnitude: Math.hypot(p.zinRe, p.zinIm) }
}
const SWEEP_HZ = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8]

describe('a coil is R_winding + jωL, not jωL alone', () => {
  const inductanceH = 1e-6
  const windingOhms = 32 // the shipped inductor default's DCR class (Bourns RLB1014-103KL, part-defaults.ts)
  const coil = () =>
    portAcross('inductor', {
      inductance: scalar(inductanceH, 'henry'),
      winding_resistance: scalar(windingOhms, 'ohm'),
    })

  test('the real part IS the declared winding resistance, at every frequency', () => {
    for (const f of SWEEP_HZ) {
      // A 1e-9 S gmin sits across every node, so a relative tolerance (not an exact equality) is right here.
      expect(zinAt(coil(), f).re / windingOhms).toBeCloseTo(1, 4)
    }
  })

  test('|Z| follows the closed form √(R² + (ωL)²) across five decades', () => {
    for (const f of SWEEP_HZ) {
      const closedForm = Math.hypot(windingOhms, 2 * Math.PI * f * inductanceH)
      expect(zinAt(coil(), f).magnitude / closedForm).toBeCloseTo(1, 4)
    }
  })

  test('the impedance ANGLE is atan(ωL / R) — the coil is no longer a pure +90°', () => {
    for (const f of SWEEP_HZ) {
      const z = zinAt(coil(), f)
      const closedFormDeg = (Math.atan2(2 * Math.PI * f * inductanceH, windingOhms) * 180) / Math.PI
      expect((Math.atan2(z.im, z.re) * 180) / Math.PI).toBeCloseTo(closedFormDeg, 3)
      expect(closedFormDeg).toBeLessThan(90)
    }
  })

  test('at 100 MHz the coil that used to read 0.0004 Ω of loss now reads its 32 Ω', () => {
    const z = zinAt(coil(), 1e8)
    expect(z.re).toBeGreaterThan(31.99)
    expect(z.re).toBeLessThan(32.01)
    // and it therefore no longer reflects essentially everything
    const gammaMag = portReflection(coil(), { inputSource: 'p1', z0Ohms: 50 }, 1e8).gammaMag
    expect(gammaMag).toBeLessThan(0.995)
  })

  test('doubling the declared resistance doubles the loss the port sees', () => {
    const single = zinAt(coil(), 1e6).re
    const doubled = zinAt(
      portAcross('inductor', {
        inductance: scalar(inductanceH, 'henry'),
        winding_resistance: scalar(2 * windingOhms, 'ohm'),
      }),
      1e6,
    ).re
    expect(doubled / single).toBeCloseTo(2, 4)
  })

  test('an electromagnet reads its winding resistance the same way', () => {
    // Inductance is DERIVED from the coil geometry (L = µ₀µ_rN²A/l), so only the loss is asserted here.
    const w = portAcross('electromagnet', {
      turns: scalar(500, 'dimensionless'),
      relative_permeability: scalar(1000, 'dimensionless'),
      magnetic_path_length: scalar(0.08, 'metre'),
      core_area: scalar(2.5e-5, 'm^2'),
      winding_resistance: scalar(40, 'ohm'),
      winding: { value: 'copper' },
    })
    expect(zinAt(w, 1e3).re / 40).toBeCloseTo(1, 4)
  })
})

describe('a capacitor is ESR − j/(ωC) when it declares its loss', () => {
  const capacitanceF = 100e-9
  const esrOhms = 0.35
  const cap = () =>
    portAcross('capacitor', {
      capacitance: scalar(capacitanceF, 'farad'),
      esr: scalar(esrOhms, 'ohm'),
    })

  test('the real part IS the declared ESR', () => {
    for (const f of [1e4, 1e5, 1e6, 1e7]) {
      expect(zinAt(cap(), f).re / esrOhms).toBeCloseTo(1, 3)
    }
  })

  test('|Z| follows the closed form √(ESR² + (1/ωC)²)', () => {
    for (const f of [1e3, 1e4, 1e5, 1e6, 1e7]) {
      const closedForm = Math.hypot(esrOhms, 1 / (2 * Math.PI * f * capacitanceF))
      expect(zinAt(cap(), f).magnitude / closedForm).toBeCloseTo(1, 4)
    }
  })

  test('the reactance stays NEGATIVE — adding loss must not turn a capacitor into a coil', () => {
    for (const f of [1e3, 1e4, 1e5, 1e6, 1e7]) {
      const closedForm = -1 / (2 * Math.PI * f * capacitanceF)
      expect(zinAt(cap(), f).im).toBeLessThan(0)
      expect(zinAt(cap(), f).im / closedForm).toBeCloseTo(1, 4)
    }
  })

  test('a declared dissipation factor is the same loss as an ANGLE: Re/|Im| = tanδ at every ω', () => {
    const tanDelta = 0.02
    const w = portAcross('capacitor', {
      capacitance: scalar(capacitanceF, 'farad'),
      dissipation_factor: scalar(tanDelta, 'dimensionless'),
    })
    for (const f of [1e4, 1e5, 1e6, 1e7]) {
      const z = zinAt(w, f)
      expect(z.re / Math.abs(z.im)).toBeCloseTo(tanDelta, 4)
      // and that IS ESR = tanδ/(ωC) — the resistance falls with frequency
      expect(z.re / (tanDelta / (2 * Math.PI * f * capacitanceF))).toBeCloseTo(1, 3)
    }
  })

  test('a declared esr wins over a declared dissipation factor', () => {
    const w = portAcross('capacitor', {
      capacitance: scalar(capacitanceF, 'farad'),
      esr: scalar(esrOhms, 'ohm'),
      dissipation_factor: scalar(0.5, 'dimensionless'),
    })
    expect(zinAt(w, 1e6).re / esrOhms).toBeCloseTo(1, 3)
  })
})

describe('a part declaring NO loss is still solved exactly as it was', () => {
  // A lossless part is not left with a real part of exactly zero: the engine hangs a 1 nS conductance
  // (AC_GMIN) on every node so a floating subsection can't make the matrix singular. In parallel with a pure
  // reactance X that reads back as Re = gmin/(gmin² + 1/X²) — which is where the 0.0004 Ω in the original
  // defect report came from, and it is what these two pin, so the residue is proven to be gmin and NOT copper.
  const AC_GMIN = 1e-9
  const gminResidue = (reactanceOhms: number) => AC_GMIN / (AC_GMIN ** 2 + (1 / reactanceOhms) ** 2)

  test('a lossless capacitor is a pure reactance −1/(ωC), its real part only the gmin residue', () => {
    const capacitanceF = 1e-9
    const w = portAcross('capacitor', { capacitance: scalar(capacitanceF, 'farad') })
    for (const f of [1e3, 1e6, 1e9]) {
      const reactance = -1 / (2 * Math.PI * f * capacitanceF)
      const z = zinAt(w, f)
      expect(z.im / reactance).toBeCloseTo(1, 6)
      expect(z.re / gminResidue(reactance)).toBeCloseTo(1, 3)
    }
  })

  test('a lossless inductor is a pure reactance +ωL, its real part only the gmin residue', () => {
    const inductanceH = 1e-6
    const w = portAcross('inductor', { inductance: scalar(inductanceH, 'henry') })
    for (const f of [1e3, 1e6, 1e9]) {
      const reactance = 2 * Math.PI * f * inductanceH
      const z = zinAt(w, f)
      expect(z.im / reactance).toBeCloseTo(1, 6)
      expect(z.re / gminResidue(reactance)).toBeCloseTo(1, 3)
    }
  })

  test('an explicit zero declares an ideal part and adds no loss', () => {
    const w = portAcross('inductor', {
      inductance: scalar(1e-6, 'henry'),
      winding_resistance: scalar(0, 'ohm'),
    })
    expect(Math.abs(zinAt(w, 1e6).re)).toBeLessThan(1e-3)
  })

  test('the lossless stamp is kept BIT-for-bit, not re-derived through the lossy one', () => {
    // 1/(0 + jX) equals −j/X in exact arithmetic but not in doubles: routing the zero-loss case through the
    // series-impedance stamp moves the last ulps (measured: 2 of 16 swept points shift). The engine therefore
    // keeps the original closed-form stamp for r = 0, so a part that declares no loss returns EXACTLY the
    // numbers it returned before loss existed. This is a REGRESSION PIN of that identity — the physics is
    // pinned by the closed forms above; these literals are the untouched pre-loss stamp's own output at the
    // two frequencies where the alternative differs.
    const w = portAcross('inductor', { inductance: scalar(1e-6, 'henry') })
    const at1kHz = zinAt(w, 1e3)
    expect(at1kHz.re).toBe(3.9478417604357434e-14)
    expect(at1kHz.im).toBe(0.006283185307179587)
    const at33MHz = zinAt(w, 3.3e7)
    expect(at33MHz.re).toBe(0.000042991996771143396)
    expect(at33MHz.im).toBe(207.34511513691743)
  })

  test('an RC low-pass still corners at 1/(2πRC) — the textbook Bode result is untouched', () => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'src', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(w, 'r1', 'resistor', { resistance: scalar(1000, 'ohm') }, [
      { net: 'in', terminal: 'terminal_a' },
      { net: 'out', terminal: 'terminal_b' },
    ])
    addPart(w, 'c1', 'capacitor', { capacitance: scalar(1e-7, 'farad') }, [
      { net: 'out', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    const cornerHz = 1 / (2 * Math.PI * 1000 * 1e-7)
    const p = acResponse(w, { inputSource: 'src', outputNet: 'out' }, cornerHz)
    expect(p.gainDb).toBeCloseTo(-3.0103, 2)
    expect(p.phaseDeg).toBeCloseTo(-45, 2)
  })
})

describe('the L-match: the number the app reports is now one that exists', () => {
  // A textbook L-match, 200 Ω down to 50 Ω at 100 MHz: Q = √(Rp/Rs − 1) = √3, series X_L = Q·Rs,
  // shunt X_C = Rp/Q. With the reactances exactly cancelling, whatever series copper the coil declares is
  // ALL that remains in Zin — so Zin = Z0 + R_coil and Γ = R_coil/(2·Z0 + R_coil) by hand.
  const frequencyHz = 100e6
  const omega = 2 * Math.PI * frequencyHz
  const q = Math.sqrt(200 / 50 - 1)
  const inductanceH = (q * 50) / omega
  const capacitanceF = q / 200 / omega

  const lMatch = (coilOhms: number): World => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(
      w,
      'lser',
      'inductor',
      {
        inductance: scalar(inductanceH, 'henry'),
        ...(coilOhms > 0 ? { winding_resistance: scalar(coilOhms, 'ohm') } : {}),
      },
      [
        { net: 'in', terminal: 'terminal_a' },
        { net: 'mid', terminal: 'terminal_b' },
      ],
    )
    addPart(w, 'cshunt', 'capacitor', { capacitance: scalar(capacitanceF, 'farad') }, [
      { net: 'mid', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    addPart(w, 'rload', 'resistor', { resistance: scalar(200, 'ohm') }, [
      { net: 'mid', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    return w
  }
  const rlOf = (coilOhms: number) =>
    portReflection(lMatch(coilOhms), { inputSource: 'p1', z0Ohms: 50 }, frequencyHz).returnLossDb

  test('a coil declaring nothing still reports the unreachable number — and says so', () => {
    expect(rlOf(0)).toBeGreaterThan(100) // 140.9 dB: the double-precision floor, not a match
    expect(partsWithNoDeclaredAcLoss(lMatch(0)).map((p) => p.id)).toEqual(['lser', 'cshunt'])
  })

  test('a coil declaring a Q of 60 gives the return loss the hand calculation gives', () => {
    const coilOhms = (omega * inductanceH) / 60
    const byHand = returnLossDbFromGamma(coilOhms / (2 * 50 + coilOhms))
    expect(rlOf(coilOhms)).toBeCloseTo(byHand, 2)
    expect(byHand).toBeGreaterThan(30) // still an excellent match…
    expect(byHand).toBeLessThan(45) // …but a reachable one
  })

  test('a coil declaring a Q of 30 gives a hand-checkable return loss too', () => {
    const coilOhms = (omega * inductanceH) / 30
    expect(rlOf(coilOhms)).toBeCloseTo(returnLossDbFromGamma(coilOhms / (2 * 50 + coilOhms)), 2)
  })

  test('more declared loss means a WORSE match, monotonically', () => {
    const losses = [0.4330127, 0.8660254, 1.4433757, 2.8867513].map(rlOf)
    for (let i = 1; i < losses.length; i++) {
      expect(losses[i] as number).toBeLessThan(losses[i - 1] as number)
    }
    expect(losses[0] as number).toBeLessThan(rlOf(0))
  })
})

describe('every AC consumer reads the lossy impedance', () => {
  /** A series element between two ports — the shape an S-parameter measurement wants. */
  function seriesTwoPort(definition: string, parameters: PartParameters): World {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'p1', 'reference_port', { reference_impedance: scalar(50, 'ohm') }, [
      { net: 'a', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(w, 'p2', 'reference_port', { reference_impedance: scalar(50, 'ohm') }, [
      { net: 'b', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(w, 'dut', definition, parameters, [
      { net: 'a', terminal: 'terminal_a' },
      { net: 'b', terminal: 'terminal_b' },
    ])
    return w
  }

  test('S-parameters: a lossy series coil dissipates, so |S11|² + |S21|² < 1', () => {
    const params = { inductance: scalar(1e-6, 'henry') }
    const opts = { port1: 'p1', port2: 'p2', z0Ohms: 50 }
    const frequencyHz = 5e6
    const lossless = portSParameters(seriesTwoPort('inductor', params), opts, frequencyHz)
    const lossy = portSParameters(
      seriesTwoPort('inductor', { ...params, winding_resistance: scalar(32, 'ohm') }),
      opts,
      frequencyHz,
    )
    const power = (s: typeof lossless) =>
      s.s11.re ** 2 + s.s11.im ** 2 + (s.s21.re ** 2 + s.s21.im ** 2)
    // A lossless 2-port is unitary: everything incident is either reflected or transmitted.
    expect(power(lossless)).toBeCloseTo(1, 6)
    expect(power(lossy)).toBeLessThan(0.999)
    expect(lossy.s21Db).toBeLessThan(lossless.s21Db)
  })

  test('Bode: a lossy coil damps a series-resonant peak to a finite, computable height', () => {
    // A series RLC driven through a source; at f0 = 1/(2π√(LC)) the reactances cancel and the output
    // across the capacitor peaks at Q = (1/R)·√(L/C) — infinite only when R is zero.
    const inductanceH = 1e-3
    const capacitanceF = 1e-9
    const windingOhms = 5
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'src', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(
      w,
      'l1',
      'inductor',
      {
        inductance: scalar(inductanceH, 'henry'),
        winding_resistance: scalar(windingOhms, 'ohm'),
      },
      [
        { net: 'in', terminal: 'terminal_a' },
        { net: 'out', terminal: 'terminal_b' },
      ],
    )
    addPart(w, 'c1', 'capacitor', { capacitance: scalar(capacitanceF, 'farad') }, [
      { net: 'out', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    const resonanceHz = 1 / (2 * Math.PI * Math.sqrt(inductanceH * capacitanceF))
    const qFactor = Math.sqrt(inductanceH / capacitanceF) / windingOhms
    const peak = acResponse(w, { inputSource: 'src', outputNet: 'out' }, resonanceHz)
    expect(peak.gain / qFactor).toBeCloseTo(1, 3)
  })

  test('a transformer reads its declared winding + core resistances', () => {
    // Open-secondary primary impedance: Z = R1 + jωL1 in parallel with the core-loss resistance.
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(
      w,
      'tx',
      'transformer',
      {
        primary_inductance: scalar(0.1, 'henry'),
        secondary_inductance: scalar(10, 'henry'),
        coupling_coefficient: scalar(0.98, 'dimensionless'),
        primary_resistance: scalar(0.5, 'ohm'),
        secondary_resistance: scalar(50, 'ohm'),
        core_loss_resistance: scalar(200, 'ohm'),
      },
      [
        { net: 'in', terminal: 'primary_a' },
        { net: 'gnd', terminal: 'primary_b' },
        { net: 'sa', terminal: 'secondary_a' },
        { net: 'sb', terminal: 'secondary_b' },
      ],
    )
    // At 1 Hz the winding reactance ωL1 = 0.628 Ω is small, so the primary reads close to its 0.5 Ω
    // copper (in parallel with the far larger 200 Ω core resistance) — a real part, where it was 0 before.
    const low = zinAt(w, 1)
    expect(low.re).toBeGreaterThan(0.4)
    expect(low.re).toBeLessThan(0.55)
    // At 1 kHz ωL1 dwarfs the copper and the 200 Ω core resistance dominates the real part.
    const high = zinAt(w, 1e3)
    expect(high.re).toBeGreaterThan(150)
    expect(high.re).toBeLessThan(200)
  })

  test('a LOADED transformer matches the exact coupled-coil formula, secondary copper included', () => {
    // With the secondary loaded by Z_L, the coupled-coil equations give the primary impedance in closed
    // form: Z_in = R1 + jωL1 + (ωM)²/(R2 + jωL2 + Z_L). An OPEN secondary carries no current, so R2 is
    // invisible there — this is the case that actually pins the secondary winding resistance.
    const l1 = 1e-3
    const l2 = 1e-3
    const k = 0.98
    const r1 = 1
    const r2 = 5
    const loadOhms = 10
    const frequencyHz = 1e4
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(
      w,
      'tx',
      'transformer',
      {
        primary_inductance: scalar(l1, 'henry'),
        secondary_inductance: scalar(l2, 'henry'),
        coupling_coefficient: scalar(k, 'dimensionless'),
        primary_resistance: scalar(r1, 'ohm'),
        secondary_resistance: scalar(r2, 'ohm'),
      },
      [
        { net: 'in', terminal: 'primary_a' },
        { net: 'gnd', terminal: 'primary_b' },
        { net: 'sa', terminal: 'secondary_a' },
        { net: 'gnd', terminal: 'secondary_b' },
      ],
    )
    addPart(w, 'rload', 'resistor', { resistance: scalar(loadOhms, 'ohm') }, [
      { net: 'sa', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    const omega = 2 * Math.PI * frequencyHz
    const reflected = (omega * k * Math.sqrt(l1 * l2)) ** 2
    const denominatorRe = r2 + loadOhms
    const denominatorIm = omega * l2
    const denominatorSq = denominatorRe ** 2 + denominatorIm ** 2
    const closedForm = {
      re: r1 + (reflected * denominatorRe) / denominatorSq,
      im: omega * l1 - (reflected * denominatorIm) / denominatorSq,
    }
    const z = zinAt(w, frequencyHz)
    expect(z.re / closedForm.re).toBeCloseTo(1, 4)
    expect(z.im / closedForm.im).toBeCloseTo(1, 4)
  })
})

describe('partsWithNoDeclaredAcLoss names what was solved as perfect', () => {
  test('a capacitor declaring neither esr nor a dissipation factor is reported', () => {
    const parts = partsWithNoDeclaredAcLoss(
      portAcross('capacitor', { capacitance: scalar(1e-9, 'farad') }),
    )
    expect(parts).toEqual([
      { id: 'dut', definition: 'capacitor', lossParameters: ['esr', 'dissipation_factor'] },
    ])
  })

  test('a capacitor declaring either one is NOT reported', () => {
    for (const declared of [
      { esr: scalar(0.35, 'ohm') },
      { dissipation_factor: scalar(0.02, '') },
    ]) {
      const w = portAcross('capacitor', { capacitance: scalar(1e-9, 'farad'), ...declared })
      expect(partsWithNoDeclaredAcLoss(w)).toEqual([])
    }
  })

  test('an explicit zero counts as declared — the user meant ideal', () => {
    const w = portAcross('inductor', {
      inductance: scalar(1e-6, 'henry'),
      winding_resistance: scalar(0, 'ohm'),
    })
    expect(partsWithNoDeclaredAcLoss(w)).toEqual([])
  })

  test('resistors and sources are not reactive, so are never reported', () => {
    expect(
      partsWithNoDeclaredAcLoss(portAcross('resistor', { resistance: scalar(50, 'ohm') })),
    ).toEqual([])
  })

  test('the canvas default inductor declares its DCR, so it is not reported', () => {
    const w = portAcross('inductor', {
      inductance: scalar(0.01, 'henry'),
      winding_resistance: scalar(32, 'ohm'),
      current_rating: scalar(0.135, 'ampere'),
    })
    expect(partsWithNoDeclaredAcLoss(w)).toEqual([])
  })
})

/**
 * ONE DECLARED LOSS MUST NOT SILENCE A PART'S OTHER LOSSES. The report used to ask "does this part declare ANY
 * of its loss parameters?", so a transformer declaring only its core loss dropped out of the notice while BOTH
 * its windings were still being solved as zero-resistance copper. Losses in different places are different
 * losses; only alternative spellings of the SAME loss (esr / dissipation_factor) share a slot.
 */
describe('the perfect-reactance report is per LOSS, not per part', () => {
  const transformerDeclaring = (parameters: Record<string, { value: unknown }>): World => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(
      w,
      'tx',
      'transformer',
      {
        primary_inductance: scalar(0.1, 'henry'),
        secondary_inductance: scalar(10, 'henry'),
        coupling_coefficient: scalar(0.98, 'dimensionless'),
        ...parameters,
      },
      [
        { net: 'in', terminal: 'primary_a' },
        { net: 'gnd', terminal: 'primary_b' },
        { net: 'sa', terminal: 'secondary_a' },
        { net: 'gnd', terminal: 'secondary_b' },
      ],
    )
    return w
  }

  test('a transformer declaring ONLY its core loss is still named for both windings', () => {
    const w = transformerDeclaring({ core_loss_resistance: scalar(200, 'ohm') })
    expect(partsWithNoDeclaredAcLoss(w)).toEqual([
      {
        id: 'tx',
        definition: 'transformer',
        lossParameters: ['primary_resistance', 'secondary_resistance'],
      },
    ])
  })

  test('declaring only the primary copper leaves the secondary and the core named', () => {
    const w = transformerDeclaring({ primary_resistance: scalar(0.5, 'ohm') })
    expect(partsWithNoDeclaredAcLoss(w)[0]?.lossParameters).toEqual([
      'secondary_resistance',
      'core_loss_resistance',
    ])
  })

  test('a transformer declaring all three losses is not named at all', () => {
    const w = transformerDeclaring({
      primary_resistance: scalar(0.5, 'ohm'),
      secondary_resistance: scalar(50, 'ohm'),
      core_loss_resistance: scalar(200, 'ohm'),
    })
    expect(partsWithNoDeclaredAcLoss(w)).toEqual([])
    expect(partsSolvedAsPerfectReactance(w)).toEqual([])
  })

  test('a capacitor keeps ONE loss slot — esr and tanδ are the same loss written two ways', () => {
    // Declaring either satisfies it, so a capacitor with a tanδ is never named for a missing esr.
    const w = portAcross('capacitor', {
      capacitance: scalar(1e-9, 'farad'),
      dissipation_factor: scalar(0.02, 'dimensionless'),
    })
    expect(partsSolvedAsPerfectReactance(w)).toEqual([])
  })

  test('a loss declared as an explicit 0 is reported apart from one that is simply absent', () => {
    const zeroed = portAcross('inductor', {
      inductance: scalar(1e-6, 'henry'),
      winding_resistance: scalar(0, 'ohm'),
    })
    expect(partsSolvedAsPerfectReactance(zeroed)).toEqual([
      {
        id: 'dut',
        definition: 'inductor',
        slots: [{ parameters: ['winding_resistance'], declaredZero: ['winding_resistance'] }],
      },
    ])
    // …and only the ABSENT case is a "no loss declared" part.
    expect(partsWithNoDeclaredAcLoss(zeroed)).toEqual([])
    const absent = portAcross('inductor', { inductance: scalar(1e-6, 'henry') })
    expect(partsSolvedAsPerfectReactance(absent)[0]?.slots).toEqual([
      { parameters: ['winding_resistance'], declaredZero: [] },
    ])
  })

  test('the shipped transmission line declares its losses as zeros, and is reported for them', () => {
    // Every loss term the shipped line carries is 0 — a lossless cable, which is why a shorted line
    // reflects essentially everything (|Γ| = 0.9999999 measured) and the engine has to clamp the
    // resulting infinite-Q resonance. That is now on the report instead of being silent.
    const w = portAcross('transmission_line', defaultParameters('transmission_line'))
    expect(partsSolvedAsPerfectReactance(w)).toEqual([
      {
        id: 'dut',
        definition: 'transmission_line',
        slots: [
          { parameters: ['series_resistance'], declaredZero: ['series_resistance'] },
          {
            parameters: ['shunt_conductance', 'loss_tangent'],
            declaredZero: ['shunt_conductance', 'loss_tangent'],
          },
        ],
      },
    ])
  })

  test('skin_effect_onset_hz is not a loss on its own, so it is not one of the slots', () => {
    // It only shapes how a DECLARED series_resistance rises with frequency; alone it carries nothing.
    expect(acLossParameters('transmission_line')).toEqual([
      'series_resistance',
      'shunt_conductance',
      'loss_tangent',
    ])
  })
})

/**
 * THE SHIPPED ELECTROLYTIC'S OWN LOSS. Before this, no shipped part declared `esr` or `dissipation_factor` and
 * the properties panel could not add one, so the capacitor half of the whole loss engine was unreachable from
 * the canvas: "every capacitor in this app is lossless at AC" was true however good the solver was.
 *
 * The value is the datasheet's, not an invention: Nichicon UVR (CAT.8100M) specifies its loss as tan δ, and for
 * a 16 V part that is 0.20 MAX at 120 Hz / 20 ˚C — the condition the number carries and the condition this test
 * checks it at.
 */
describe('the shipped capacitor carries a cited loss', () => {
  const DATASHEET_TAN_DELTA = 0.2
  const DATASHEET_FREQUENCY_HZ = 120

  test('the default is the datasheet tan δ, and it is what makes the part lossy', () => {
    const shipped = defaultParameters('capacitor')
    expect(shipped.dissipation_factor?.value).toEqual({
      kind: 'scalar',
      amount: DATASHEET_TAN_DELTA,
      unit: 'dimensionless',
    })
    expect(partsWithNoDeclaredAcLoss(portAcross('capacitor', shipped))).toEqual([])
  })

  test('at the datasheet 120 Hz the port reads ESR = tanδ/(ωC), by hand', () => {
    const shipped = defaultParameters('capacitor')
    const capacitanceF = 100e-6
    const omega = 2 * Math.PI * DATASHEET_FREQUENCY_HZ
    const closedForm = DATASHEET_TAN_DELTA / (omega * capacitanceF)
    expect(closedForm).toBeCloseTo(2.6526, 4) // 2.65 Ω — the number the datasheet condition implies
    const z = zinAt(portAcross('capacitor', shipped), DATASHEET_FREQUENCY_HZ)
    expect(z.re / closedForm).toBeCloseTo(1, 4)
    // and the loss ANGLE is the declared tanδ, which is what the datasheet actually specifies
    expect(z.re / Math.abs(z.im)).toBeCloseTo(DATASHEET_TAN_DELTA, 4)
  })
})

/**
 * A DECLARED RESISTANCE MUST NOT VANISH WITH THE PART. Three ways the engine used to drop a part on the floor,
 * taking its cited loss with it and reporting nothing: an inductance of 0, a coupling coefficient of exactly 1,
 * and the center-tapped transformer, which the AC engine skipped outright.
 */
describe('a part the engine cannot solve is never silently absent', () => {
  test('a coil with no inductance is still its winding resistance, not an open circuit', () => {
    // The DC solver has always read this 32 Ω; the AC engine stamped nothing at all, so Zin read 1.00e9.
    const w = portAcross('inductor', {
      inductance: scalar(0, 'henry'),
      winding_resistance: scalar(32, 'ohm'),
    })
    const z = zinAt(w, 1e3)
    expect(z.re / 32).toBeCloseTo(1, 5)
    expect(Math.abs(z.im)).toBeLessThan(1e-6)
    // the same with the parameter simply absent from the part
    const noInductance = portAcross('inductor', { winding_resistance: scalar(32, 'ohm') })
    expect(zinAt(noInductance, 1e3).re / 32).toBeCloseTo(1, 5)
  })

  test('a coil with neither inductance nor resistance is still an open, exactly as before', () => {
    const w = portAcross('inductor', { inductance: scalar(0, 'henry') })
    expect(zinAt(w, 1e3).re).toBeGreaterThan(1e8)
  })

  test('a coupling coefficient of exactly 1 solves, and matches the coupled-coil closed form', () => {
    // k = 1 is what a user types for "an ideal transformer". It used to fall through the k >= 1 guard and
    // take the whole part — and its cited winding resistances — out of the circuit, reading Zin = 1.00e9.
    const l1 = 1e-3
    const l2 = 1e-3
    const r1 = 1
    const r2 = 5
    const loadOhms = 10
    const frequencyHz = 1e4
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(
      w,
      'tx',
      'transformer',
      {
        primary_inductance: scalar(l1, 'henry'),
        secondary_inductance: scalar(l2, 'henry'),
        coupling_coefficient: scalar(1, 'dimensionless'),
        primary_resistance: scalar(r1, 'ohm'),
        secondary_resistance: scalar(r2, 'ohm'),
      },
      [
        { net: 'in', terminal: 'primary_a' },
        { net: 'gnd', terminal: 'primary_b' },
        { net: 'sa', terminal: 'secondary_a' },
        { net: 'gnd', terminal: 'secondary_b' },
      ],
    )
    addPart(w, 'rload', 'resistor', { resistance: scalar(loadOhms, 'ohm') }, [
      { net: 'sa', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    // Z_in = R1 + jωL1 + (ωM)²/(R2 + jωL2 + Z_L) with M = √(L1·L2) at k = 1.
    const omega = 2 * Math.PI * frequencyHz
    const reflected = (omega * Math.sqrt(l1 * l2)) ** 2
    const denominatorRe = r2 + loadOhms
    const denominatorIm = omega * l2
    const denominatorSq = denominatorRe ** 2 + denominatorIm ** 2
    const closedForm = {
      re: r1 + (reflected * denominatorRe) / denominatorSq,
      im: omega * l1 - (reflected * denominatorIm) / denominatorSq,
    }
    const z = zinAt(w, frequencyHz)
    expect(z.re / closedForm.re).toBeCloseTo(1, 5)
    expect(z.im / closedForm.im).toBeCloseTo(1, 5)
    expect(partsDroppedFromAcSolve(w)).toEqual([])
  })

  test('a coupling coefficient ABOVE 1 is refused, and says why', () => {
    // M > √(L1·L2) would couple more energy than the windings store — a real refusal, reported as one.
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(
      w,
      'tx',
      'transformer',
      {
        primary_inductance: scalar(1e-3, 'henry'),
        secondary_inductance: scalar(1e-3, 'henry'),
        coupling_coefficient: scalar(2, 'dimensionless'),
      },
      [
        { net: 'in', terminal: 'primary_a' },
        { net: 'gnd', terminal: 'primary_b' },
        { net: 'sa', terminal: 'secondary_a' },
        { net: 'gnd', terminal: 'secondary_b' },
      ],
    )
    const dropped = partsDroppedFromAcSolve(w)
    expect(dropped).toHaveLength(1)
    expect(dropped[0]?.id).toBe('tx')
    expect(dropped[0]?.reason).toContain('exceeds 1')
  })

  test('the refusal threshold is exactly 1 — k just above it is refused, not solved', () => {
    // k = 1 is ACCEPTED (an ideal transformer is what a user types) and everything above it is refused,
    // so 1 is the boundary and it is the boundary that has to be pinned. Testing only a far-away k (2)
    // leaves the whole band just above 1 unguarded: a k of 1.05 couples more energy than the windings
    // store, and solving it would return a confident number for a part that cannot exist.
    const at = (k: number) => {
      const w = makeWorld()
      ensureNet(w, 'gnd', true)
      addPart(
        w,
        'tx',
        'transformer',
        {
          primary_inductance: scalar(1e-3, 'henry'),
          secondary_inductance: scalar(1e-3, 'henry'),
          coupling_coefficient: scalar(k, 'dimensionless'),
        },
        [
          { net: 'in', terminal: 'primary_a' },
          { net: 'gnd', terminal: 'primary_b' },
          { net: 'sa', terminal: 'secondary_a' },
          { net: 'gnd', terminal: 'secondary_b' },
        ],
      )
      return partsDroppedFromAcSolve(w)
    }
    expect(at(1)).toEqual([])
    for (const k of [1.0001, 1.05, 1.2, 1.5]) {
      expect(at(k)).toHaveLength(1)
      expect(at(k)[0]?.reason).toContain('exceeds 1')
    }
  })

  test('a coupling of 0 or below is refused, not quietly solved as two separate coils', () => {
    // With k = 0 the mutual term vanishes and the matrix would solve happily — as two uncoupled inductors
    // that are not a transformer at all. The transient solver refuses the same range, so both engines
    // describe the same part rather than one inventing a plausible answer.
    for (const k of [0, -0.5]) {
      const w = makeWorld()
      ensureNet(w, 'gnd', true)
      addPart(
        w,
        'tx',
        'transformer',
        {
          primary_inductance: scalar(1e-3, 'henry'),
          secondary_inductance: scalar(1e-3, 'henry'),
          coupling_coefficient: scalar(k, 'dimensionless'),
        },
        [
          { net: 'in', terminal: 'primary_a' },
          { net: 'gnd', terminal: 'primary_b' },
          { net: 'sa', terminal: 'secondary_a' },
          { net: 'gnd', terminal: 'secondary_b' },
        ],
      )
      expect(partsDroppedFromAcSolve(w)[0]?.reason).toContain('must be above zero')
    }
  })

  test('a winding inductance of 0 is refused, not solved as a bare resistor pair', () => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(
      w,
      'tx',
      'transformer',
      {
        primary_inductance: scalar(0, 'henry'),
        secondary_inductance: scalar(1e-3, 'henry'),
        coupling_coefficient: scalar(0.98, 'dimensionless'),
      },
      [
        { net: 'in', terminal: 'primary_a' },
        { net: 'gnd', terminal: 'primary_b' },
        { net: 'sa', terminal: 'secondary_a' },
        { net: 'gnd', terminal: 'secondary_b' },
      ],
    )
    expect(partsDroppedFromAcSolve(w)[0]?.reason).toContain('both be above zero')
  })

  test('a transformer with no inductances, or an unwired winding, is refused with its own reason', () => {
    const noInductance = makeWorld()
    ensureNet(noInductance, 'gnd', true)
    addPart(
      noInductance,
      'tx',
      'transformer',
      { coupling_coefficient: scalar(0.98, 'dimensionless') },
      [
        { net: 'in', terminal: 'primary_a' },
        { net: 'gnd', terminal: 'primary_b' },
        { net: 'sa', terminal: 'secondary_a' },
        { net: 'gnd', terminal: 'secondary_b' },
      ],
    )
    expect(partsDroppedFromAcSolve(noInductance)[0]?.reason).toContain('no primary/secondary')

    const unwired = makeWorld()
    ensureNet(unwired, 'gnd', true)
    addPart(
      unwired,
      'ct',
      'transformer_center_tapped',
      {
        primary_inductance: scalar(0.1, 'henry'),
        secondary_inductance: scalar(10, 'henry'),
        coupling_coefficient: scalar(0.98, 'dimensionless'),
      },
      [
        { net: 'in', terminal: 'primary_a' },
        { net: 'gnd', terminal: 'primary_b' },
        { net: 'sa', terminal: 'secondary_a' },
        { net: 'gnd', terminal: 'secondary_b' },
      ],
    )
    // The center tap is the terminal the plain transformer does not have — unwired, it cannot be solved.
    expect(partsDroppedFromAcSolve(unwired)[0]?.reason).toContain('not wired')
  })

  test('a k = 1 transformer with a shorted secondary and no copper refuses rather than inventing', () => {
    // The genuinely degenerate case: a perfectly-coupled, resistance-free transformer with its secondary
    // shorted IS a short at its primary, so driving it from an ideal 1 V source has no solution. The engine
    // returns NaN — a refusal — instead of a plausible number.
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(
      w,
      'tx',
      'transformer',
      {
        primary_inductance: scalar(1e-3, 'henry'),
        secondary_inductance: scalar(1e-3, 'henry'),
        coupling_coefficient: scalar(1, 'dimensionless'),
      },
      [
        { net: 'in', terminal: 'primary_a' },
        { net: 'gnd', terminal: 'primary_b' },
        { net: 'gnd', terminal: 'secondary_a' },
        { net: 'gnd', terminal: 'secondary_b' },
      ],
    )
    expect(Number.isNaN(zinAt(w, 1e4).re)).toBe(true)
  })
})

/**
 * THE CENTER-TAPPED TRANSFORMER, which the AC engine skipped entirely (`if (inst.definition !== 'transformer')
 * continue`) while shipping cited 1 Ω / 50 Ω / 200 Ω losses and being fully modelled by the transient solver.
 * Loaded, it read Zin = 1.00e9 + j0 — simply absent from its own circuit.
 *
 * Both checks are closed-form, neither reads the engine's output back:
 *   half-primary driven, other half open  Z = R1/2 + jω(L1/4) + (ωM')²/(R2 + jωL2 + Z_L), M' = k√(L1/4·L2)
 *   both halves in series (end to end)    Z = R1 + jω·L1·(1 + k)/2   (two halves plus their mutual, twice)
 */
describe('the center-tapped transformer is in the AC circuit', () => {
  const l1 = 0.1
  const l2 = 10
  const k = 0.98
  const primaryOhms = 1 // the shipped cited default (part-defaults.ts)
  const secondaryOhms = 50

  const centerTapped = (
    nets: { primaryA: string; centerTap: string; primaryB: string; secondaryA: string },
    extra: Record<string, { value: unknown }> = {},
  ): World => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(
      w,
      'ct',
      'transformer_center_tapped',
      {
        primary_inductance: scalar(l1, 'henry'),
        secondary_inductance: scalar(l2, 'henry'),
        coupling_coefficient: scalar(k, 'dimensionless'),
        primary_resistance: scalar(primaryOhms, 'ohm'),
        secondary_resistance: scalar(secondaryOhms, 'ohm'),
        ...extra,
      },
      [
        { net: nets.primaryA, terminal: 'primary_a' },
        { net: nets.centerTap, terminal: 'primary_ct' },
        { net: nets.primaryB, terminal: 'primary_b' },
        { net: nets.secondaryA, terminal: 'secondary_a' },
        { net: 'gnd', terminal: 'secondary_b' },
      ],
    )
    return w
  }

  test('one half driven into a loaded secondary matches the coupled-coil closed form', () => {
    const loadOhms = 1000
    const frequencyHz = 1000
    const w = centerTapped({
      primaryA: 'in',
      centerTap: 'gnd',
      primaryB: 'pb',
      secondaryA: 'sa',
    })
    addPart(w, 'rload', 'resistor', { resistance: scalar(loadOhms, 'ohm') }, [
      { net: 'sa', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    // Each half carries a QUARTER of the end-to-end inductance (half the turns, L ∝ N²) and half the DCR —
    // the same halving the transient solver uses, so the two engines describe one transformer.
    const halfInductance = l1 / 4
    const mutual = k * Math.sqrt(halfInductance * l2)
    const omega = 2 * Math.PI * frequencyHz
    const reflected = (omega * mutual) ** 2
    const denominatorRe = secondaryOhms + loadOhms
    const denominatorIm = omega * l2
    const denominatorSq = denominatorRe ** 2 + denominatorIm ** 2
    const closedForm = {
      re: primaryOhms / 2 + (reflected * denominatorRe) / denominatorSq,
      im: omega * halfInductance - (reflected * denominatorIm) / denominatorSq,
    }
    const z = zinAt(w, frequencyHz)
    expect(z.re / closedForm.re).toBeCloseTo(1, 5)
    expect(z.im / closedForm.im).toBeCloseTo(1, 5)
    // …and it is emphatically no longer the 1.00e9 open circuit it used to read
    expect(z.re).toBeLessThan(10)
  })

  test('both halves in series carry their mutual coupling: X = ω·L1·(1 + k)/2', () => {
    const frequencyHz = 1000
    const omega = 2 * Math.PI * frequencyHz
    const w = centerTapped({
      primaryA: 'in',
      centerTap: 'tap',
      primaryB: 'gnd',
      secondaryA: 'sa',
    })
    const z = zinAt(w, frequencyHz)
    // Two halves of L1/4 plus twice their mutual k·L1/4 — the series law for coupled coils.
    expect(z.im / ((omega * l1 * (1 + k)) / 2)).toBeCloseTo(1, 6)
    // The end-to-end copper is the full declared primary resistance (each half carries half of it).
    expect(z.re).toBeGreaterThan(primaryOhms * 0.95)
    expect(z.re).toBeLessThan(primaryOhms * 1.1)
  })

  test('its three declared losses are read, and its undeclared ones are named', () => {
    const w = centerTapped({
      primaryA: 'in',
      centerTap: 'gnd',
      primaryB: 'pb',
      secondaryA: 'sa',
    })
    // core_loss_resistance is not declared above, so that one loss — and only it — is called out.
    expect(partsWithNoDeclaredAcLoss(w)).toEqual([
      {
        id: 'ct',
        definition: 'transformer_center_tapped',
        lossParameters: ['core_loss_resistance'],
      },
    ])
    const withCore = centerTapped(
      { primaryA: 'in', centerTap: 'gnd', primaryB: 'pb', secondaryA: 'sa' },
      { core_loss_resistance: scalar(200, 'ohm') },
    )
    expect(partsWithNoDeclaredAcLoss(withCore)).toEqual([])
  })
})

/**
 * THE TWO GUARDS THAT SURVIVED MUTATION. Both are load-bearing and neither had a test.
 *  • `omega > 0` before reading an ESR — at DC the ESR path would compute a reactance of −1/(0·C) = −∞ and
 *    the whole solve would come back NaN. A capacitor at DC is an open, and that is what these pin.
 *  • `esr > 0` in the esr → dissipation_factor fall-through — a part carrying `esr: 0` alongside a real tanδ
 *    must use the tanδ. Without the `> 0` the zero wins and the declared loss silently disappears.
 */
describe('the capacitor loss guards', () => {
  const capacitanceF = 100e-9
  const tanDelta = 0.02

  test('a declared esr of 0 falls through to the declared dissipation factor', () => {
    const w = portAcross('capacitor', {
      capacitance: scalar(capacitanceF, 'farad'),
      esr: scalar(0, 'ohm'),
      dissipation_factor: scalar(tanDelta, 'dimensionless'),
    })
    const frequencyHz = 1e5
    const closedForm = tanDelta / (2 * Math.PI * frequencyHz * capacitanceF)
    expect(closedForm).toBeCloseTo(0.31831, 5)
    expect(zinAt(w, frequencyHz).re / closedForm).toBeCloseTo(1, 4)
    // and the loss is really there, not a rounding artefact: the loss angle is the declared tanδ
    const z = zinAt(w, frequencyHz)
    expect(z.re / Math.abs(z.im)).toBeCloseTo(tanDelta, 5)
  })

  test('the ESR reader itself refuses a negative loss and does not fall through to the other spelling', () => {
    // The inner guard is unobservable from the port (the stamp refuses a negative resistance too), so it is
    // tested where it lives. A negative tanδ is not "no loss declared, try the other one" — it is nonsense,
    // and the answer is 0, the same ideal capacitor a part declaring nothing gets.
    const capacitorDeclaring = (parameters: Record<string, { value: unknown }>) => {
      const w = makeWorld()
      addPart(w, 'c', 'capacitor', parameters, [{ net: 'in', terminal: 'terminal_a' }])
      return w.instances.get('c') as NonNullable<ReturnType<typeof w.instances.get>>
    }
    const omega = 2 * Math.PI * 1e5
    expect(
      capacitorEsrOhms(
        capacitorDeclaring({ dissipation_factor: scalar(-tanDelta, 'dimensionless') }),
        omega,
        capacitanceF,
      ),
    ).toBe(0)
    expect(
      capacitorEsrOhms(capacitorDeclaring({ esr: scalar(-1, 'ohm') }), omega, capacitanceF),
    ).toBe(0)
    // a negative esr is ignored rather than believed, so a valid tanδ alongside it is still read
    expect(
      capacitorEsrOhms(
        capacitorDeclaring({
          esr: scalar(-1, 'ohm'),
          dissipation_factor: scalar(tanDelta, 'dimensionless'),
        }),
        omega,
        capacitanceF,
      ),
    ).toBeCloseTo(tanDelta / (omega * capacitanceF), 12)
  })

  test('a NEGATIVE declared loss is refused, not turned into a negative resistance', () => {
    // tanδ < 0 is nonsense — as an ESR it would be a resistance that SOURCES power, and a passive part
    // would reflect more than it received. The `> 0` on the tanδ read is what refuses it.
    const w = portAcross('capacitor', {
      capacitance: scalar(capacitanceF, 'farad'),
      dissipation_factor: scalar(-tanDelta, 'dimensionless'),
    })
    const point = portReflection(w, { inputSource: 'p1', z0Ohms: 50 }, 1e5)
    expect(point.zinRe).toBeGreaterThanOrEqual(0)
    expect(point.gammaMag).toBeLessThanOrEqual(1)
  })

  test('at 0 Hz an ESR-declaring capacitor is an open, not a NaN', () => {
    // ESR − j/(ωC) is undefined at ω = 0; the guard makes the DC point the plain open a capacitor is.
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'src', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(w, 'r1', 'resistor', { resistance: scalar(1000, 'ohm') }, [
      { net: 'in', terminal: 'terminal_a' },
      { net: 'out', terminal: 'terminal_b' },
    ])
    addPart(
      w,
      'c1',
      'capacitor',
      { capacitance: scalar(1e-7, 'farad'), esr: scalar(0.35, 'ohm') },
      [
        { net: 'out', terminal: 'terminal_a' },
        { net: 'gnd', terminal: 'terminal_b' },
      ],
    )
    const dc = acResponse(w, { inputSource: 'src', outputNet: 'out' }, 0)
    expect(Number.isNaN(dc.gain)).toBe(false)
    expect(dc.gain).toBeCloseTo(1, 5) // no current flows, so the output sits at the input
    // the same holds for a tanδ-declaring part, whose ESR = tanδ/(ωC) is itself infinite at DC
    const byTanDelta = acResponse(
      (() => {
        const w2 = makeWorld()
        ensureNet(w2, 'gnd', true)
        addPart(w2, 'src', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
          { net: 'in', terminal: 'terminal_positive' },
          { net: 'gnd', terminal: 'terminal_negative' },
        ])
        addPart(w2, 'r1', 'resistor', { resistance: scalar(1000, 'ohm') }, [
          { net: 'in', terminal: 'terminal_a' },
          { net: 'out', terminal: 'terminal_b' },
        ])
        addPart(
          w2,
          'c1',
          'capacitor',
          { capacitance: scalar(1e-7, 'farad'), dissipation_factor: scalar(0.02, 'dimensionless') },
          [
            { net: 'out', terminal: 'terminal_a' },
            { net: 'gnd', terminal: 'terminal_b' },
          ],
        )
        return w2
      })(),
      { inputSource: 'src', outputNet: 'out' },
      0,
    )
    expect(byTanDelta.gain).toBeCloseTo(1, 5)
  })
})

/**
 * WHERE THIS MODEL STOPS BEING TRUSTWORTHY. gmin (a 1 nS conductance on every node, there so a floating
 * subsection cannot make the matrix singular) sits in PARALLEL with the element, so a series R + jX reads back
 * as Re ≈ R + AC_GMIN·X². On the SHIPPED 10 mH / 32 Ω choke that is invisible at audio and dominant in the HF
 * band, and the engine reports 426.8 Ω at 10 MHz and 39,509 Ω at 100 MHz against a declared 32 Ω. Those are the
 * conductance floor being read back, NOT copper, and nothing downstream (Q, return loss, |S21|) can tell.
 */
describe('the gmin floor — the honest ceiling on a recovered loss', () => {
  const inductanceH = 0.01
  const windingOhms = 32
  const coil = () =>
    portAcross('inductor', {
      inductance: scalar(inductanceH, 'henry'),
      winding_resistance: scalar(windingOhms, 'ohm'),
    })

  test('the reported real part is the declared R PLUS the computed gmin floor, at every decade', () => {
    for (const frequencyHz of [1e3, 1e5, 1e6, 1e7, 1e8]) {
      const reactance = 2 * Math.PI * frequencyHz * inductanceH
      const closedForm = windingOhms + acGminFloorOhms(reactance)
      expect(zinAt(coil(), frequencyHz).re / closedForm).toBeCloseTo(1, 3)
    }
  })

  test('below the ceiling the copper is recovered; above it the number is the floor, not the part', () => {
    // The ceiling is AC_GMIN·X² << R, i.e. |X| << √(R/AC_GMIN) = 179 kΩ for this coil → f << 2.8 MHz.
    expect(zinAt(coil(), 1e3).re / windingOhms).toBeCloseTo(1, 5)
    expect(zinAt(coil(), 1e5).re / windingOhms).toBeCloseTo(1, 2)
    // …and past it the "loss" is mostly the floor: 426.8 Ω at 10 MHz for a 32 Ω coil.
    expect(zinAt(coil(), 1e7).re).toBeGreaterThan(400)
    expect(acGminFloorOhms(2 * Math.PI * 1e7 * inductanceH) / windingOhms).toBeGreaterThan(10)
  })
})
