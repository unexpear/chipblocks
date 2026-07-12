import type { Instance, World } from '../cross-fk-validator.ts'
import { crtParamsFromInstance, deflectionFraction, gridBrightness } from '../crt-model.ts'
import {
  potentiometerSegments,
  resolveMosfet,
  resolveShockleyLed,
  type Solution,
} from '../dc-solver.ts'
import { deriveSaturationCurrent, thermalVoltage } from '../diode-model.ts'
import { resistanceAtTemperature } from '../electro-thermal.ts'
import {
  magneticPullForceNewtons,
  magnetomotiveForceAmpereTurns,
  solenoidFluxDensityTesla,
} from '../electromagnet-model.ts'
import { electronDriftVelocityMS } from '../field-energy.ts'
import {
  coreLossFromParams,
  doubleCageFromParams,
  inductionMotorOperatingPoint,
  inductionMotorParamsFromInstance,
  statorIsDelta,
} from '../induction-motor-model.ts'
import {
  singlePhaseMotorParamsFromInstance,
  singlePhaseOperatingPoint,
} from '../induction-motor-single-phase.ts'
import { readEnumParam, readScalarParam } from '../instance-params.ts'
import {
  arcLuminousFluxLumens,
  ldrResistance,
  lightSensorCurrent,
  sensorIlluminance,
} from '../light.ts'
import { mosfetOperatingPoint } from '../mosfet-model.ts'
import {
  airGapFluxDensityTesla,
  generatorOperatingPoint,
  generatorParamsFromInstance,
  motorEffectiveResistance,
  motorParamsFromInstance,
  motorSteadyState,
} from '../motor-model.ts'
import { acrossVolts } from '../thermal-model.ts'
import { awgAreaM2 } from '../wire-gauge.ts'
import { formatEng } from './units.ts'

/**
 * The Math view (S19-v3-63) — every equation behind the current circuit's
 * numbers, with the REAL values plugged in. Built from the same solved state
 * the canvas displays (world + solution), using the same model functions the
 * solver itself uses (Shockley calibration, kT/q), so the numbers shown here
 * ARE the numbers the engine used — one source of truth, no parallel math.
 *
 * The KCL section re-sums every net's branch currents from the solution. The
 * checkmark is COMPUTED, never assumed: if a net failed to balance, this view
 * would show it — it doubles as a live self-audit of the solver.
 */

export type MathPartCard = { id: string; title: string; lines: string[] }
export type MathNetRow = {
  id: string
  terms: string[]
  /** Σ of branch currents into the net (amps); null = not summable here. */
  sumAmps: number | null
  note?: string
}
export type MathView = {
  solver: string[]
  parts: MathPartCard[]
  nets: MathNetRow[]
  /** Where the energy actually flows — the field picture (Poynting) behind the numbers,
   *  plus the (very slow) electron drift, reconciled with the lumped solve. */
  fields: string[]
  /** Every unit symbol used above, written out — built from what ACTUALLY appears. */
  unitsKey: string[]
}

/** Per the solver's sign convention: positive branch current flows A-side → B-side. */
const A_SIDE = new Set(['terminal_positive', 'anode', 'terminal_a', 'terminal_in'])
const B_SIDE = new Set(['terminal_negative', 'cathode', 'terminal_b', 'terminal_out'])

/** Matches the solvers' default LED/diode ideality when no parameter is set. */
const DEFAULT_IDEALITY_FACTOR = 2.0

const fmtV = (v: number) => formatEng(v, 'V', { signed: true })
const fmtA = (a: number) => formatEng(a, 'A')

/** The class key: every unit written out, in plain words. */
const UNIT_NAMES: Record<string, { name: string; meaning: string }> = {
  V: { name: 'volt', meaning: 'the electrical push (voltage)' },
  A: { name: 'amp', meaning: 'the flow of charge (current)' },
  Ω: { name: 'ohm', meaning: 'resistance — how hard it is to push current through' },
  W: { name: 'watt', meaning: 'power — energy used per second' },
  F: { name: 'farad', meaning: 'capacitance — how much charge is stored per volt' },
  C: { name: 'coulomb', meaning: 'an amount of electric charge' },
  Hz: { name: 'hertz', meaning: 'frequency — cycles per second' },
  s: { name: 'second', meaning: 'time' },
}
const PREFIX_NAMES: Record<string, { name: string; meaning: string }> = {
  p: { name: 'pico', meaning: 'one trillionth' },
  n: { name: 'nano', meaning: 'one billionth' },
  µ: { name: 'micro', meaning: 'one millionth' },
  m: { name: 'milli', meaning: 'one thousandth' },
  k: { name: 'kilo', meaning: 'a thousand' },
  M: { name: 'mega', meaning: 'a million' },
  G: { name: 'giga', meaning: 'a billion' },
}

/**
 * Scan the finished lines for the unit symbols that ACTUALLY appear (with
 * their engineering prefixes) and write each one out — so the key always
 * matches the board, never lists units nothing above used.
 */
export function unitsKeyFor(lines: string[]): string[] {
  const text = lines.join('  ')
  const baseUnits = new Set<string>()
  const combos = new Set<string>()
  const pattern = /\d(?:\.\d+)?\s?([pnµmkMG]?)(Hz|V|A|Ω|W|F|C|s)(?![a-zA-Z])/g
  for (const match of text.matchAll(pattern)) {
    const prefix = match[1] ?? ''
    const unit = match[2] ?? ''
    if (!(unit in UNIT_NAMES)) continue
    baseUnits.add(unit)
    if (prefix !== '') combos.add(`${prefix}${unit}`)
  }
  const key: string[] = []
  for (const [symbol, { name, meaning }] of Object.entries(UNIT_NAMES)) {
    if (baseUnits.has(symbol)) key.push(`${symbol} — ${name}: ${meaning}.`)
  }
  for (const combo of combos) {
    const prefix = combo.slice(0, combo.length - (combo.endsWith('Hz') ? 2 : 1))
    const unit = combo.slice(prefix.length)
    const p = PREFIX_NAMES[prefix]
    const u = UNIT_NAMES[unit]
    if (p && u) {
      const article = /^[aeiou]/.test(u.name) ? 'an' : 'a'
      key.push(`${combo} — a ${p.name}-${u.name}: ${p.meaning} of ${article} ${u.name}.`)
    }
  }
  return key
}

export function buildMathView(
  world: World,
  solution: Solution,
  temperaturesC?: Map<string, number>,
  /**
   * Did the electro-thermal loop settle? False = thermal runaway (a part heats
   * itself faster than it sheds it, with no stable point), so the temperatures
   * and the resistances derived from them are a non-converged snapshot at the
   * iteration cap, NOT a steady-state answer. Defaults true (a plain DC solve
   * with no thermally-rated parts always "settles").
   */
  thermalConverged = true,
  /**
   * Did the relay loop settle? False = a buzzer / oscillator (a coil powered
   * through its own contacts), so the contact states below are a non-converged
   * snapshot, not a steady answer. Defaults true (no relays always "settles").
   */
  relaysSettled = true,
): MathView {
  if (solution.status !== 'solved') {
    return {
      solver: [
        `No solved circuit to show: the solver reported '${solution.status}'.`,
        ...(solution.warnings.length > 0 ? [`First warning: ${solution.warnings[0]}`] : []),
      ],
      parts: [],
      nets: [],
      fields: [],
      unitsKey: [],
    }
  }

  const netCount = solution.nodes.size
  const solver: string[] = [
    'Step 1 — at every junction in the circuit, write down “current in = current out” (Kirchhoff’s current law). Charge can’t pile up at a point, so these must balance.',
    `Step 2 — solve ALL those balance equations at once, as one big system. That technique is called Modified Nodal Analysis. Here it has ${Math.max(0, netCount - 1)} unknown voltages to find (the ground net '${solution.ground}' is pinned at 0 V — the zero mark on the ruler), plus one unknown current per source or ideal short.`,
    `Step 3 — parts whose law is a curve, not a line (diodes, LEDs, transistors), can’t be solved in one shot. So the solver guesses, replaces each curve with the straight line that touches it at the guess, solves, and repeats until the answer stops moving. That loop is Newton–Raphson — this solve took ${solution.iterations} round${solution.iterations === 1 ? '' : 's'} (converged: ${solution.converged ? 'yes' : 'NO'}).`,
  ]
  if (solution.warnings.length > 0) {
    solver.push(`Solver warnings (${solution.warnings.length}): ${solution.warnings.join(' · ')}`)
  }
  if (!thermalConverged) {
    solver.push(
      '⚠ THERMAL RUNAWAY — the electro-thermal loop did NOT settle. The temperatures kept climbing every pass (a part heating itself faster than it can shed the heat, with no stable point — what an NTC thermistor straight across a stiff supply does). Every temperature and temperature-dependent resistance below is a NON-CONVERGED snapshot at the iteration cap, not a real steady state. Treat those numbers as “runaway,” not as an answer.',
    )
  }
  if (!relaysSettled) {
    solver.push(
      '⚠ RELAY CHATTER — a relay could not settle: its coil is powered THROUGH its own contacts, so energizing it cuts its own power and it falls back, over and over (a buzzer / oscillator). A static solve cannot show a continuous oscillation; the contact state below is a frozen snapshot at the iteration cap, not a steady answer.',
    )
  }

  const volts = (net: string | undefined) =>
    net !== undefined ? solution.nodes.get(net) : undefined
  const across = (inst: Instance): number | undefined => {
    const aNet = inst.connects?.find((c) => A_SIDE.has(c.terminal))?.net
    const bNet = inst.connects?.find((c) => B_SIDE.has(c.terminal))?.net
    const va = volts(aNet)
    const vb = volts(bNet)
    return va !== undefined && vb !== undefined ? va - vb : undefined
  }

  const parts: MathPartCard[] = []
  for (const inst of world.instances.values()) {
    if (!inst.connects || inst.connects.length === 0) continue
    const card = partCard(inst, solution, across(inst), temperaturesC?.get(inst.id))
    if (card === null) continue
    // A part that has a temperature in a non-converged (runaway) solve gets the
    // caveat ON its card — so the bogus T and R(T) it narrates are never read as
    // a settled answer, even by someone who skips the solver section.
    if (!thermalConverged && temperaturesC?.has(inst.id)) {
      card.lines.push(
        '⚠ The temperatures did not settle (thermal runaway) — the temperature and resistance above are a non-converged snapshot at the iteration cap, not a steady state.',
      )
    }
    parts.push(card)
  }

  // KCL per net: sum every member element's branch current with its sign
  // (+ into the net at the element's B side, − at its A side). Nets touching
  // a multi-terminal device can't be itemized from 2-terminal branch data
  // alone — including a multi-WINDING machine with only two of its ports
  // wired (a 3-phase motor on a phase→neutral or line-to-line hookup).
  const nets: MathNetRow[] = []
  for (const [netId] of solution.nodes) {
    const terms: string[] = []
    let sum = 0
    let multiTerminal = false
    for (const inst of world.instances.values()) {
      const connectsHere = (inst.connects ?? []).filter((c) => c.net === netId)
      if (connectsHere.length === 0) continue
      if (
        (inst.connects ?? []).length > 2 ||
        inst.definition === 'induction_motor_three_phase' ||
        inst.definition === 'alternator_three_phase'
      ) {
        multiTerminal = true
        terms.push(`${inst.id} (multi-terminal — see its card)`)
        continue
      }
      const current = solution.branches.get(inst.id)
      if (current === undefined) continue
      for (const connect of connectsHere) {
        const sign = B_SIDE.has(connect.terminal) ? 1 : A_SIDE.has(connect.terminal) ? -1 : 0
        if (sign === 0) continue
        sum += sign * current
        terms.push(`${sign * current >= 0 ? '+' : '−'}${fmtA(Math.abs(current))} (${inst.id})`)
      }
    }
    if (terms.length === 0) continue
    nets.push({
      id: netId,
      terms,
      sumAmps: multiTerminal ? null : sum,
      ...(multiTerminal
        ? { note: 'balanced inside the solve — a multi-terminal device meets this net' }
        : {}),
    })
  }

  // Where the energy actually flows — the FIELD picture behind the lumped numbers
  // (Poynting), plus how slowly the electrons really drift. Reconciled with the solve.
  const fields: string[] = []
  let maxAbsAmps = 0
  for (const i of solution.branches.values()) {
    if (Math.abs(i) > maxAbsAmps) maxAbsAmps = Math.abs(i)
  }
  let maxPower = 0
  let maxPowerId = ''
  for (const inst of world.instances.values()) {
    const branch = solution.branches.get(inst.id)
    const volts = acrossVolts(inst, solution)
    if (branch !== undefined && volts !== undefined) {
      const p = Math.abs(branch * volts)
      if (p > maxPower) {
        maxPower = p
        maxPowerId = inst.id
      }
    }
  }
  if (maxAbsAmps > 0) {
    fields.push(
      'Where the energy actually flows: NOT down the inside of the wire with the electrons, but through the electric + magnetic FIELDS in the space around it — the Poynting vector S = E×H. The wire just guides the fields.',
    )
    const driftMS = electronDriftVelocityMS(maxAbsAmps, awgAreaM2(22))
    fields.push(
      `The electrons themselves barely move: at ${fmtA(maxAbsAmps)} through a 22 AWG copper wire they drift at about ${(driftMS * 1000).toPrecision(2)} mm/s — far slower than you would guess, while the ENERGY arrives at nearly the speed of light.`,
    )
    if (maxPower > 0) {
      fields.push(
        `That ${formatEng(maxPower, 'W')} into ${maxPowerId} is energy flowing IN through the fields around it: integrate the Poynting vector over a surface enclosing it and ∮S·dA = V·I = ${formatEng(maxPower, 'W')} — the field picture and the circuit numbers are the SAME thing. Our solve is that picture in the slow, settled (low-frequency) limit.`,
      )
    }
  }

  const unitsKey = unitsKeyFor([
    ...solver,
    ...parts.flatMap((p) => p.lines),
    ...nets.flatMap((n) => n.terms),
    ...fields,
  ])
  return { solver, parts, nets, fields, unitsKey }
}

function partCard(
  inst: Instance,
  solution: Solution,
  acrossV: number | undefined,
  temperatureC: number | undefined,
): MathPartCard | null {
  const current = solution.branches.get(inst.id)
  const lines: string[] = []
  const def = inst.definition

  if (def === 'ground') {
    return {
      id: inst.id,
      title: 'Ground — the reference',
      lines: [
        'This is the zero mark on the ruler: V ≡ 0 V here by definition. Every other voltage in the circuit is measured FROM this point.',
      ],
    }
  }
  if (def === 'power_source') {
    const emf = readScalarParam(inst, 'nominal_voltage') ?? 0
    const internal = readScalarParam(inst, 'internal_resistance') ?? 0
    const amplitude = readScalarParam(inst, 'ac_amplitude') ?? 0
    lines.push(
      `A real source is a perfect pusher (the EMF, ${fmtV(emf)}) with a little resistance of its own inside (${formatEng(internal, 'Ω')}). That inner resistance is why batteries sag under load.`,
    )
    if (current !== undefined) {
      const terminal = emf - Math.abs(current) * internal
      lines.push(
        `So the terminals show a bit less than the EMF: V_terminal = EMF − I·r = ${fmtV(emf)} − ${fmtA(Math.abs(current))} × ${formatEng(internal, 'Ω')} = ${fmtV(terminal)}.`,
      )
      lines.push(
        `The lost part becomes heat inside the source: P = I²·r = ${formatEng(current * current * internal, 'W')}.`,
      )
    }
    if (amplitude > 0) {
      const f = readScalarParam(inst, 'frequency') ?? 0
      const shape = inst.parameters?.waveform?.value
      const wave =
        shape === 'square'
          ? `± ${formatEng(amplitude, 'V')} as a square wave (half the time up, half down)`
          : shape === 'triangle'
            ? `± ${formatEng(amplitude, 'V')} as a triangle wave — straight ramps up and down at ${formatEng(f, 'Hz')}`
            : shape === 'sawtooth'
              ? `± ${formatEng(amplitude, 'V')} as a sawtooth — a steady ramp up at ${formatEng(f, 'Hz')}, then an instant snap back (the sweep shape)`
              : shape === 'staircase'
                ? `± ${formatEng(amplitude, 'V')} as a staircase — held steps rising through each ${formatEng(f, 'Hz')} period`
                : `+ ${formatEng(amplitude, 'V')}·sin(2π·${formatEng(f, 'Hz')}·t), a smooth sine`
      lines.push(
        `This one also changes over time: V(t) = ${fmtV(emf)} ${wave}. This page shows the steady part; the Scope shows the wiggle.`,
      )
    }
    return { id: inst.id, title: 'Source — a pusher with internal resistance', lines }
  }
  if (def === 'resistor' || def === 'wire') {
    const nominalOhms = readScalarParam(inst, 'resistance')
    const title = def === 'wire' ? 'Wire — even wire resists a little' : 'Resistor — Ohm’s law'
    if (def === 'wire') {
      lines.push(
        nominalOhms !== undefined
          ? `R = ρ·L/A: resistance grows with length (L) and shrinks with thickness (A); ρ is the material’s own resistivity (copper here). This wire, at its drawn length: ${formatEng(nominalOhms, 'Ω')}.`
          : 'Treated as an ideal short (no resistance assigned).',
      )
    } else if (nominalOhms !== undefined) {
      lines.push(
        `Ohm’s law: the voltage used up equals the current times the resistance. This one is R = ${formatEng(nominalOhms, 'Ω')}.`,
      )
    }
    // A tempco part runs at its SOLVED temperature, not the 25 °C on the label —
    // the solver used the hot resistance, so this page must too (same formula,
    // same function, one source of truth). Only narrate the drift when it is
    // big enough to see in the printed numbers.
    const hotOhms = resistanceAtTemperature(inst, temperatureC)
    const ohms = hotOhms !== undefined && nominalOhms !== undefined ? hotOhms : nominalOhms
    if (
      hotOhms !== undefined &&
      nominalOhms !== undefined &&
      temperatureC !== undefined &&
      Math.abs(hotOhms - nominalOhms) / nominalOhms > 0.001
    ) {
      const alpha = readScalarParam(inst, 'temperature_coefficient') ?? 0
      const alphaPpm = `${alpha < 0 ? '−' : ''}${Math.abs(alpha * 1e6).toFixed(0)}`
      lines.push(
        `But this part is not at the 25 °C it was labeled at — it runs at ${temperatureC.toFixed(0)} °C from its own heat. Its resistance drifts with temperature (α = ${alphaPpm} ppm per °C): R(T) = R₀·(1 + α·ΔT) = ${formatEng(hotOhms, 'Ω')}. Everything below uses that real, hot value — the same one the solver used.`,
      )
    }
    if (current !== undefined && ohms !== undefined) {
      lines.push(
        `Plug in the solved current: V = I·R = ${fmtA(Math.abs(current))} × ${formatEng(ohms, 'Ω')} = ${formatEng(Math.abs(current) * ohms, 'V')}.`,
      )
      lines.push(
        `That energy has to go somewhere — it leaves as heat: P = I²·R = ${formatEng(current * current * ohms, 'W')} (Joule’s law).`,
      )
    } else if (current !== undefined) {
      lines.push(`Carrying I = ${fmtA(Math.abs(current))}.`)
    }
    return { id: inst.id, title, lines }
  }
  if (def === 'thermistor') {
    const r0 = readScalarParam(inst, 'resistance')
    const beta = readScalarParam(inst, 'beta_coefficient')
    const t0 = readScalarParam(inst, 'reference_temperature') ?? 25
    lines.push(
      'An NTC thermistor’s resistance is a steep, nonlinear function of its OWN temperature: the Beta equation R(T) = R₀·e^(B·(1/T − 1/T₀)), with the temperatures in kelvin. As it warms, the resistance FALLS.',
    )
    if (r0 !== undefined && beta !== undefined) {
      lines.push(
        `Calibrated to R₀ = ${formatEng(r0, 'Ω')} at T₀ = ${t0.toFixed(0)} °C, with B = ${formatEng(beta, 'K')}.`,
      )
    }
    const hot = resistanceAtTemperature(inst, temperatureC)
    if (hot !== undefined && temperatureC !== undefined) {
      lines.push(
        `It is sitting at ${temperatureC.toFixed(1)} °C right now (its surroundings plus its own self-heating), so the Beta law puts its resistance at R = ${formatEng(hot, 'Ω')} — the value the solver used.`,
      )
    }
    if (current !== undefined) lines.push(`Carrying I = ${fmtA(Math.abs(current))}.`)
    return { id: inst.id, title: 'Thermistor — the Beta law', lines }
  }
  if (def === 'incandescent_bulb') {
    const rOp = readScalarParam(inst, 'resistance')
    const tOp = readScalarParam(inst, 'reference_temperature')
    const ratedW = readScalarParam(inst, 'rated_power')
    lines.push(
      'An incandescent bulb is a tungsten filament — a resistor that gets hot enough to glow. Its resistance RISES with temperature by the tungsten power law R(T) = R_op·(T/T₀)^1.2 (T in kelvin), the opposite of an NTC thermistor, so a COLD filament is ~14× lower-resistance — the big inrush the instant you switch it on.',
    )
    if (rOp !== undefined && tOp !== undefined) {
      const cold = resistanceAtTemperature(inst, 25)
      lines.push(
        `Hot resistance R_op = ${formatEng(rOp, 'Ω')} at the ${tOp.toFixed(0)} °C operating temperature; cold (powered off) it reads ~${cold !== undefined ? formatEng(cold, 'Ω') : '—'}.`,
      )
    }
    lines.push(
      `The filament is radiation-cooled, not conduction-cooled: it sheds its power by the Stefan–Boltzmann law P = k·(T⁴ − T_amb⁴)${ratedW !== undefined ? ` (k pinned so it dissipates ${formatEng(ratedW, 'W')} at its operating temperature)` : ''}, so its temperature climbs only as the FOURTH ROOT of power — halve the drive and it barely dims, it just glows redder.`,
    )
    const hot = resistanceAtTemperature(inst, temperatureC)
    if (hot !== undefined && temperatureC !== undefined) {
      lines.push(
        `Right now the filament sits at ${temperatureC.toFixed(0)} °C (its self-heated operating point), so R = ${formatEng(hot, 'Ω')} — the value the solver used.`,
      )
    }
    if (current !== undefined) lines.push(`Carrying I = ${fmtA(Math.abs(current))}.`)
    return { id: inst.id, title: 'Incandescent bulb — tungsten filament', lines }
  }
  if (def === 'vacuum_diode') {
    const refV = readScalarParam(inst, 'reference_plate_voltage')
    const refI = readScalarParam(inst, 'plate_current_at_reference')
    lines.push(
      'A vacuum diode (Fleming valve) conducts by THERMIONIC EMISSION: a hot cathode boils off electrons that a positive plate collects. The space charge of that electron cloud limits the current to the Child-Langmuir law I = perveance·V^1.5 (V = plate − cathode); a negative plate collects nothing, so it rectifies — one-way conduction, the first electronic component.',
    )
    if (refV !== undefined && refI !== undefined) {
      const perveance = refI / refV ** 1.5
      lines.push(
        `Calibrated to ${formatEng(refI, 'A')} at ${formatEng(refV, 'V')} → perveance P = ${perveance.toExponential(2)} A/V^1.5.`,
      )
    }
    if (current !== undefined)
      lines.push(`Carrying I = ${fmtA(Math.abs(current))} (plate → cathode).`)
    return { id: inst.id, title: 'Vacuum diode — Child-Langmuir space charge', lines }
  }
  if (def === 'triode') {
    const mu = readScalarParam(inst, 'amplification_factor')
    lines.push(
      'A triode (the de Forest Audion, 1906) is the first AMPLIFIER: a control grid between cathode and plate, drawing ~no current, sets the plate current through the effective voltage V_g + V_p/μ. The grid is μ times more effective than the plate, so a small grid swing makes a large plate swing — gain. I_p = perveance·(V_g + V_p/μ)^1.5 (Child-Langmuir).',
    )
    if (mu !== undefined) {
      lines.push(
        `Amplification factor μ = ${mu.toFixed(0)} (the grid is ${mu.toFixed(0)}× as effective as the plate at controlling the current); its transconductance g_m and plate resistance r_p obey μ = g_m·r_p.`,
      )
    }
    if (current !== undefined) lines.push(`Plate current I_p = ${fmtA(Math.abs(current))}.`)
    return { id: inst.id, title: 'Triode — grid-controlled plate current', lines }
  }
  if (def === 'tetrode') {
    const screenMu = readScalarParam(inst, 'screen_amplification_factor')
    lines.push(
      'A tetrode adds a SCREEN grid (a second grid, held positive) between the control grid and the plate. The screen does the accelerating and SHIELDS the control grid from the plate, so the plate current is set by the control grid + screen and is nearly independent of the plate voltage — a FLAT plate characteristic (very high plate resistance r_p), which gives more voltage gain than a triode (A ≈ g_m·R_load). I_p = perveance·(V_g1 + V_g2/μ_screen + V_plate/μ_plate)^1.5.',
    )
    if (screenMu !== undefined) {
      lines.push(
        `The screen is ${screenMu.toFixed(0)}× less effective than the control grid at setting the current (μ_screen), and the plate far less still — the flat curve.`,
      )
    }
    if (current !== undefined) lines.push(`Plate current I_p = ${fmtA(Math.abs(current))}.`)
    return { id: inst.id, title: 'Tetrode — screen-grid (flat) characteristic', lines }
  }
  if (def === 'pentode') {
    const screenMu = readScalarParam(inst, 'screen_amplification_factor')
    lines.push(
      'A pentode adds a THIRD grid — the suppressor (g3, usually tied to the cathode) — between the screen and the plate. It returns secondary electrons to the plate, removing the tetrode "kink," so the plate current stays flat and high-gain even when the plate voltage drops below the screen. Electrically it is the screen-grid tube without the kink: I_p = perveance·(V_g1 + V_g2/μ_screen + V_plate/μ_plate)^1.5, with a very high plate resistance r_p.',
    )
    if (screenMu !== undefined) {
      lines.push(
        `The screen is ${screenMu.toFixed(0)}× less effective than the control grid at setting the current (μ_screen); the plate far less still — the flat, kink-free curve.`,
      )
    }
    if (current !== undefined) lines.push(`Plate current I_p = ${fmtA(Math.abs(current))}.`)
    return { id: inst.id, title: 'Pentode — suppressor grid removes the kink', lines }
  }
  if (def === 'photoresistor') {
    const r0 = readScalarParam(inst, 'reference_resistance')
    const e0 = readScalarParam(inst, 'reference_illuminance') ?? 10
    const gamma = readScalarParam(inst, 'gamma')
    const ambient = readScalarParam(inst, 'ambient_illuminance') ?? 0
    const e = sensorIlluminance(inst)
    const cast = e - ambient
    lines.push(
      'A photoresistor (LDR) is a resistor whose resistance is set by the LIGHT on it: the power law R(E) = R₀·(E/E₀)^(−γ), with E the illuminance in lux. As the light rises, the resistance FALLS.',
    )
    if (r0 !== undefined && gamma !== undefined) {
      lines.push(
        `Calibrated to R₀ = ${formatEng(r0, 'Ω')} at E₀ = ${formatEng(e0, 'lx')}, with γ = ${gamma}.`,
      )
    }
    if (cast > 0.5) {
      lines.push(
        `Its ambient light is ${formatEng(ambient, 'lx')}; a light source casts ${formatEng(cast, 'lx')} more on it (E = I/d², falling off with distance), so ${formatEng(e, 'lx')} actually lands on it. Move it nearer the lamp and that rises.`,
      )
    }
    const r = ldrResistance(inst)
    if (r !== undefined) {
      lines.push(
        e <= 0
          ? `Right now it is dark (0 lx), so its resistance sits at its dark value R = ${formatEng(r, 'Ω')} — the value the solver used (the law is capped here as the light goes to zero).`
          : `Right now ${formatEng(e, 'lx')} is falling on it, so the power law puts its resistance at R = ${formatEng(r, 'Ω')} — the value the solver used.`,
      )
    }
    if (current !== undefined) lines.push(`Carrying I = ${fmtA(Math.abs(current))}.`)
    return { id: inst.id, title: 'Photoresistor — the LDR light law', lines }
  }
  if (def === 'photodiode') {
    const perLux = readScalarParam(inst, 'photocurrent_per_lux')
    const e = sensorIlluminance(inst)
    lines.push(
      'A photodiode turns light into CURRENT (not resistance, like the LDR): reverse-biased, it sources a photocurrent very nearly proportional to the light, I = responsivity · E.',
    )
    if (perLux !== undefined) {
      lines.push(
        `Its responsivity is ${formatEng(perLux, 'A/lx')}, and ${formatEng(e, 'lx')} is falling on it, so I = ${formatEng(perLux, 'A/lx')} × ${formatEng(e, 'lx')} = ${formatEng(lightSensorCurrent(inst), 'A')} — the value the solver used. Drive it through a load resistor for a light-proportional voltage.`,
      )
    }
    return { id: inst.id, title: 'Photodiode — light into current', lines }
  }
  if (def === 'phototransistor') {
    const perLux = readScalarParam(inst, 'photocurrent_per_lux')
    const beta = readScalarParam(inst, 'current_gain') ?? 1
    const e = sensorIlluminance(inst)
    lines.push(
      'A phototransistor is a photodiode with built-in gain: light makes a base photocurrent, and the transistor multiplies it by β — so I_C = β · responsivity · E, hundreds of times a bare photodiode for the same light.',
    )
    if (perLux !== undefined) {
      lines.push(
        `Base photocurrent = ${formatEng(perLux, 'A/lx')} × ${formatEng(e, 'lx')} = ${formatEng(perLux * e, 'A')}; × β = ${beta} gives the collector current I_C = ${formatEng(lightSensorCurrent(inst), 'A')} — the value the solver used.`,
      )
    }
    return { id: inst.id, title: 'Phototransistor — light into current, amplified', lines }
  }
  if (def === 'potentiometer') {
    const total = readScalarParam(inst, 'resistance')
    const seg = potentiometerSegments(inst)
    const p = Math.min(1, Math.max(0, readScalarParam(inst, 'wiper_position') ?? 0.5))
    lines.push(
      `A potentiometer is one resistor track with a sliding tap (the wiper). The wiper splits the track into two series pieces set by how far it has turned — here ${(p * 100).toFixed(0)} % of the way from end A to end B.`,
    )
    if (total !== undefined && seg !== null) {
      lines.push(
        `Total track R = ${formatEng(total, 'Ω')}. The split: R(A→wiper) = R·p = ${formatEng(seg.top, 'Ω')}, R(wiper→B) = R·(1−p) = ${formatEng(seg.bottom, 'Ω')} — the two pieces always add back to the whole.`,
      )
    }
    const netVolts = (terminal: string) => {
      const net = inst.connects?.find((c) => c.terminal === terminal)?.net
      return net === undefined ? undefined : solution.nodes.get(net)
    }
    const vA = netVolts('terminal_a')
    const vW = netVolts('wiper')
    const vB = netVolts('terminal_b')
    if (vA !== undefined && vW !== undefined && vB !== undefined) {
      lines.push(
        `Wired across both ends it is a voltage divider: the wiper reads V_wiper = ${fmtV(vW)}, sitting between end A (${fmtV(vA)}) and end B (${fmtV(vB)}). Turn the wiper and that output slides between the two ends.`,
      )
    }
    if (current !== undefined) {
      lines.push(`Track current (into the wired end): I = ${fmtA(Math.abs(current))}.`)
    }
    return { id: inst.id, title: 'Potentiometer — a divider you can turn', lines }
  }
  if (def === 'switch_spst_toggle') {
    const open = inst.parameters?.state?.value === 'open'
    lines.push(
      open
        ? 'Open: the metal path is broken, so NO current can flow through this branch — and that stops the whole loop it belongs to.'
        : 'Closed: a continuous metal path — current passes through and essentially no voltage is lost across it.',
    )
    if (!open && current !== undefined) lines.push(`Carrying I = ${fmtA(Math.abs(current))}.`)
    return { id: inst.id, title: `Switch — ${open ? 'open' : 'closed'}`, lines }
  }
  if (def === 'fuse') {
    const blown = inst.parameters?.state?.value === 'blown'
    const rated = readScalarParam(inst, 'rated_current')
    const ratedText = rated !== undefined ? fmtA(rated) : 'its rating'
    if (blown) {
      lines.push(
        `BLOWN. Its element melted when the current passed ${ratedText} and the circuit is now OPEN here — no current flows. That is the fuse doing its job: sacrificing itself to protect everything downstream. Double-click it to fit a fresh one.`,
      )
      return { id: inst.id, title: 'Fuse — blown', lines }
    }
    lines.push(
      `A fuse is a deliberate weak link: a thin element sized to MELT and break the circuit the instant too much current flows. This one is rated ${ratedText}.`,
    )
    if (current !== undefined) {
      const elementOhms = readScalarParam(inst, 'element_resistance')
      lines.push(
        rated !== undefined
          ? `Right now it carries I = ${fmtA(Math.abs(current))} — ${Math.abs(current) <= rated ? 'under the rating, so it holds.' : 'over the rating, so it is about to blow.'}`
          : `Carrying I = ${fmtA(Math.abs(current))}.`,
      )
      if (elementOhms !== undefined && elementOhms > 0) {
        lines.push(
          `Its element is not a perfect short — a small cold resistance of ${formatEng(elementOhms, 'Ω')} drops V = I·R = ${formatEng(Math.abs(current) * elementOhms, 'V')}.`,
        )
      }
    }
    return { id: inst.id, title: 'Fuse — intact', lines }
  }
  if (def === 'relay') {
    const energized = inst.parameters?.coil_state?.value === 'energized'
    const pullIn = readScalarParam(inst, 'pull_in_voltage')
    const coilA = inst.connects?.find((c) => c.terminal === 'coil_a')?.net
    const coilB = inst.connects?.find((c) => c.terminal === 'coil_b')?.net
    const vA = coilA !== undefined ? solution.nodes.get(coilA) : undefined
    const vB = coilB !== undefined ? solution.nodes.get(coilB) : undefined
    const coilVolts = vA !== undefined && vB !== undefined ? Math.abs(vA - vB) : undefined
    lines.push(
      'A relay is a coil that throws a switch: energize the coil and its magnetic field pulls the common contact from normally-closed over to normally-open, isolating the little control side from the switched load.',
    )
    if (coilVolts !== undefined && pullIn !== undefined) {
      const dropOut = readScalarParam(inst, 'drop_out_voltage') ?? pullIn / 2
      const draw = current !== undefined ? ` (drawing ${fmtA(Math.abs(current))})` : ''
      let why: string
      if (energized && coilVolts < pullIn) {
        // Held by hysteresis: below pull-in but still above the release threshold.
        why = `below its ${fmtV(pullIn)} pull-in but still above the ${fmtV(dropOut)} release — so it STAYS energized (the hysteresis that keeps it from chattering at the edge)`
      } else if (energized) {
        why = `at or above its ${fmtV(pullIn)} pull-in — so it is ENERGIZED`
      } else {
        why = `below its ${fmtV(pullIn)} pull-in — so it is at REST`
      }
      lines.push(`The coil sees ${fmtV(coilVolts)}${draw}, ${why}.`)
    }
    lines.push(
      energized
        ? 'Energized: the common contact is on normally_open (normally_closed is now an open contact).'
        : 'At rest: the common contact is on normally_closed (normally_open is an open contact).',
    )
    return { id: inst.id, title: `Relay — ${energized ? 'energized' : 'at rest'}`, lines }
  }
  if (def === 'diode_zener_silicon') {
    const vZ = readScalarParam(inst, 'zener_voltage')
    lines.push(
      'A zener conducts forward like an ordinary diode, but its JOB is the reverse direction: past its zener voltage V_Z it breaks down and CLAMPS — the voltage across it barely moves while the current climbs, which is how it regulates.',
    )
    if (vZ !== undefined) {
      lines.push(
        `V_Z = ${fmtV(vZ)} — the reverse breakdown / regulation voltage this part is rated at.`,
      )
    }
    if (acrossV !== undefined && current !== undefined) {
      lines.push(`Operating point: V = ${fmtV(acrossV)}, I = ${fmtA(Math.abs(current))}.`)
    }
    return { id: inst.id, title: 'Zener — forward diode + reverse regulation', lines }
  }
  if (def === 'diode_tunnel') {
    lines.push(
      'A tunnel diode has a NEGATIVE-resistance region: as forward voltage rises past its peak the current FALLS (quantum tunneling), then rises again — an N-shaped curve, the basis of tunnel-diode oscillators.',
    )
    if (acrossV !== undefined && current !== undefined) {
      lines.push(`Operating point: V = ${fmtV(acrossV)}, I = ${fmtA(Math.abs(current))}.`)
    }
    return { id: inst.id, title: 'Tunnel diode — negative resistance', lines }
  }
  if (def === 'diode_shockley') {
    lines.push(
      'A Shockley 4-layer diode is a LATCH: it blocks until the breakover voltage, then snaps on and STAYS on until the current falls below its holding current — bistable, a thyristor without a gate.',
    )
    if (acrossV !== undefined && current !== undefined) {
      lines.push(
        `Operating point: V = ${fmtV(acrossV)}, I = ${fmtA(Math.abs(current))} (high = latched on; near zero = blocking).`,
      )
    }
    return { id: inst.id, title: 'Shockley diode — a latch', lines }
  }
  if (def === 'diode_varactor') {
    lines.push(
      'A varactor is used as a voltage-controlled CAPACITOR: reverse-biased, its junction capacitance C(V) shrinks as the reverse voltage grows (for tuning). It blocks DC, so the steady current is near zero.',
    )
    if (acrossV !== undefined && current !== undefined) {
      lines.push(`Operating point: V = ${fmtV(acrossV)}, I = ${fmtA(Math.abs(current))}.`)
    }
    return { id: inst.id, title: 'Varactor — a voltage-controlled capacitor', lines }
  }
  if (def === 'diode_constant_current') {
    lines.push(
      'A constant-current diode is a JFET wired gate-to-source: it REGULATES current to a near-fixed value almost regardless of the voltage across it — a 2-terminal current source.',
    )
    if (acrossV !== undefined && current !== undefined) {
      lines.push(`Operating point: V = ${fmtV(acrossV)}, I = ${fmtA(Math.abs(current))}.`)
    }
    return { id: inst.id, title: 'Constant-current diode — a current regulator', lines }
  }
  if (def === 'led' || def === 'led_uv_algan' || def.startsWith('diode')) {
    const vF = readScalarParam(inst, 'forward_voltage')
    const iF = readScalarParam(inst, 'max_forward_current')
    const n = readScalarParam(inst, 'ideality_factor') ?? DEFAULT_IDEALITY_FACTOR
    // The SAME resolve the solver ran (one source of truth): with a junction
    // temperature it carries the SPICE I_S(T) and V_T(T) the solver used, NOT the
    // 25 °C calibration values. Null (uncalibrated / unwired) → the 25 °C fallback.
    const resolved = resolveShockleyLed(inst, thermalVoltage(), temperatureC)
    const atTemp = resolved !== null && temperatureC !== undefined
    const vT = resolved?.thermalV ?? thermalVoltage()
    const shownC = atTemp ? (temperatureC as number) : 25
    lines.push(
      'A diode does NOT follow Ohm’s law — below its turn-on voltage almost nothing flows, then current grows explosively. The curve is the Shockley equation: I = I_S·(e^(V/(n·V_T)) − 1).',
    )
    if (vF !== undefined && iF !== undefined) {
      const iS = resolved?.saturationCurrent ?? deriveSaturationCurrent(vF, iF, n, thermalVoltage())
      lines.push(
        `I_S = ${formatEng(iS, 'A')} — a tiny “leakage” constant, chosen so the curve passes exactly through this part’s rated point (${fmtV(vF)} at ${fmtA(iF)})${atTemp ? `, then scaled to ${shownC.toFixed(0)} °C by the SPICE I_S(T) law` : ''}.`,
      )
    }
    lines.push(
      `n = ${n} is the ideality factor (how textbook-perfect the junction is); V_T = kT/q = ${formatEng(vT, 'V')} comes from temperature itself (${(shownC + 273.15).toFixed(2)} K / ${shownC.toFixed(0)} °C here).`,
    )
    if (acrossV !== undefined && current !== undefined) {
      lines.push(
        `Where the circuit and the curve agree — the operating point: V = ${fmtV(acrossV)}, I = ${fmtA(Math.abs(current))}.`,
      )
    }
    return { id: inst.id, title: 'Diode / LED — the Shockley curve', lines }
  }
  if (def === 'capacitor') {
    const farads = readScalarParam(inst, 'capacitance')
    lines.push(
      'Once fully charged, a capacitor passes no steady current — I = C·dV/dt, and dV/dt (the rate the voltage changes) is zero when nothing changes. At steady DC it acts like a gap in the wire.',
    )
    if (farads !== undefined && acrossV !== undefined) {
      lines.push(
        `It still holds charge: Q = C·V = ${formatEng(farads, 'F')} × ${formatEng(Math.abs(acrossV), 'V')} = ${formatEng(farads * Math.abs(acrossV), 'C')}.`,
      )
    }
    return { id: inst.id, title: 'Capacitor — full, so no current', lines }
  }
  if (def === 'inductor') {
    lines.push(
      'An inductor only pushes back when the current CHANGES (V = L·di/dt). Once everything settles, di/dt = 0, so it behaves like plain wire. The Scope shows the ramp while it settles.',
    )
    if (current !== undefined) lines.push(`Carrying I = ${fmtA(Math.abs(current))}.`)
    return { id: inst.id, title: 'Inductor — settled, so plain wire', lines }
  }
  if (def === 'electromagnet') {
    const turns = readScalarParam(inst, 'turns')
    const relativePermeability = readScalarParam(inst, 'relative_permeability')
    const pathLength = readScalarParam(inst, 'magnetic_path_length')
    const saturation = readScalarParam(inst, 'saturation_flux_density')
    const coreArea = readScalarParam(inst, 'core_area')
    lines.push(
      "An electromagnet is a coil: winding the wire into N turns multiplies its magnetic pull to N×I “ampere-turns” (Ampère's law). Electrically it is just an inductor — it conducts DC through its winding resistance and only pushes back when the current changes.",
    )
    if (turns !== undefined && current !== undefined) {
      const mmf = magnetomotiveForceAmpereTurns(turns, current)
      lines.push(
        `Magnetomotive force = N·I = ${turns.toFixed(0)} turns × ${fmtA(Math.abs(current))} = ${mmf.toFixed(1)} ampere-turns.`,
      )
      if (relativePermeability !== undefined && pathLength !== undefined) {
        const b = solenoidFluxDensityTesla(
          turns,
          current,
          relativePermeability,
          pathLength,
          saturation,
        )
        const saturationNote =
          saturation !== undefined
            ? ` — rolled off toward the core's ${formatEng(saturation, 'T')} saturation`
            : ''
        lines.push(
          `Core field B = μ₀·μ_r·N·I / length = ${formatEng(b, 'T')} (μ_r = ${relativePermeability.toFixed(0)}${saturationNote}).`,
        )
        if (coreArea !== undefined) {
          const force = magneticPullForceNewtons(b, coreArea)
          lines.push(
            `Pull on an armature = B²·A / 2μ₀ = ${formatEng(force, 'N')} (the holding force across a ${formatEng(coreArea, 'm²')} pole).`,
          )
        }
      }
    }
    return { id: inst.id, title: 'Electromagnet — a coil makes a field (N·I)', lines }
  }
  if (def === 'dc_motor') {
    const motorParams = motorParamsFromInstance(inst)
    const posNet = netOfTerminal(inst, 'terminal_positive')
    const negNet = netOfTerminal(inst, 'terminal_negative')
    lines.push(
      'A DC motor spins because its current makes a torque (T = k·I). As it speeds up it generates a BACK-EMF (E = k·ω) that opposes the supply — so the faster it spins, the LESS current it draws. At steady state it behaves like a resistor R_eff = R_a + k²/B (much bigger than the bare winding R_a).',
    )
    if (readEnumParam(inst, 'design_mode') === 'design' && motorParams !== undefined) {
      const turns = readScalarParam(inst, 'winding_turns')
      const gauge = readScalarParam(inst, 'wire_gauge')
      const remanence = readScalarParam(inst, 'magnet_remanence')
      const coreMu = readScalarParam(inst, 'core_relative_permeability')
      const magnetLength = readScalarParam(inst, 'magnet_length')
      const airGap = readScalarParam(inst, 'air_gap')
      if (
        remanence !== undefined &&
        coreMu !== undefined &&
        magnetLength !== undefined &&
        airGap !== undefined
      ) {
        const bGap = airGapFluxDensityTesla(remanence, magnetLength, airGap, coreMu)
        lines.push(
          `Design it: the ${remanence.toFixed(2)} T magnets across the ${formatEng(airGap, 'm')} air gap make an air-gap field B_gap = ${bGap.toFixed(3)} T (a better core or a smaller gap makes more).`,
        )
        lines.push(
          `From that, k = factor·N·B_gap·D·L = ${formatEng(motorParams.motorConstant, 'V·s/rad')}${turns !== undefined ? ` (${turns.toFixed(0)} turns)` : ''}, and the winding${gauge !== undefined ? ` (${gauge.toFixed(0)} AWG)` : ''} gives R_a = ${formatEng(motorParams.armatureResistance, 'Ω')} from R = ρ·length/area.`,
        )
      }
    }
    if (motorParams !== undefined && posNet !== undefined && negNet !== undefined) {
      const v = (solution.nodes.get(posNet) ?? 0) - (solution.nodes.get(negNet) ?? 0)
      const op = motorSteadyState(v, motorParams)
      lines.push(`R_eff = R_a + k²/B = ${formatEng(motorEffectiveResistance(motorParams), 'Ω')}.`)
      lines.push(
        `At ${fmtV(v)} across it: I = ${fmtA(op.current)}, spinning ${((op.speed * 60) / (2 * Math.PI)).toFixed(0)} RPM, making ${formatEng(op.torque, 'N·m')} of torque (back-EMF ${fmtV(op.backEmf)}).`,
      )
    }
    return { id: inst.id, title: 'DC motor — back-EMF and torque', lines }
  }
  if (def === 'generator') {
    const genParams = generatorParamsFromInstance(inst)
    const posNet = netOfTerminal(inst, 'terminal_positive')
    const negNet = netOfTerminal(inst, 'terminal_negative')
    lines.push(
      'A generator is a motor run backwards: a prime mover SPINS it at a speed ω, and it generates an EMF E = k·ω (the same machine constant k). Electrically it is a voltage source E behind the winding resistance R_a, so the terminal voltage droops as it delivers current: V = E − I·R_a.',
    )
    if (genParams !== undefined && posNet !== undefined && negNet !== undefined) {
      const v = (solution.nodes.get(posNet) ?? 0) - (solution.nodes.get(negNet) ?? 0)
      const op = generatorOperatingPoint(v, genParams)
      lines.push(
        `Spun at ${((genParams.driveSpeed * 60) / (2 * Math.PI)).toFixed(0)} RPM: E = k·ω = ${fmtV(op.emf)} (open-circuit). Delivering ${fmtA(op.current)}, the terminal sits at ${fmtV(v)} — the other ${fmtV(op.emf - v)} drops across R_a = ${formatEng(genParams.armatureResistance, 'Ω')}.`,
      )
      lines.push(
        `The prime mover supplies T = k·I + B·ω = ${formatEng(op.driveTorque, 'N·m')}, so ${formatEng(op.mechanicalPowerW, 'W')} of mechanical power goes in and ${formatEng(op.electricalPowerW, 'W')} comes out electrically (${(op.efficiency * 100).toFixed(0)}% efficient).`,
      )
    }
    return { id: inst.id, title: 'Generator — spin it, make EMF (E = k·ω)', lines }
  }
  if (def === 'alternator' || def === 'alternator_three_phase') {
    const k = readScalarParam(inst, 'flux_linkage')
    const polePairs = readScalarParam(inst, 'pole_pairs')
    const rpm = readScalarParam(inst, 'drive_speed')
    const three = def === 'alternator_three_phase'
    lines.push(
      three
        ? 'The power-station machine: one magnet spins inside THREE coils sitting a third of a turn apart, so each sees the field a third of a period after the last — three identical sine waves, 120° apart. Their summed power is constant, and a balanced load returns zero current on the shared neutral.'
        : 'A magnet spinning past a coil makes a SINE: the field sweeps by once per pole pair per turn, pushing the electrons forward then pulling them back. Faster spin sweeps the field faster — so the frequency AND the voltage both rise with the shaft speed.',
    )
    if (k !== undefined && polePairs !== undefined && rpm !== undefined) {
      const omegaE = polePairs * ((rpm * 2 * Math.PI) / 60)
      const f = Math.abs(omegaE) / (2 * Math.PI)
      const peak = k * Math.abs(omegaE)
      lines.push(
        `f = poles·RPM/120 = ${(2 * polePairs).toFixed(0)}·${Math.abs(rpm).toFixed(0)}/120 = ${formatEng(f, 'Hz')}${Math.abs(f - 60) < 0.5 ? ' — the North American grid frequency' : ''}. EMF amplitude = k·ω_e = ${formatEng(k, 'V·s/rad')} × ${formatEng(Math.abs(omegaE), 'rad/s')} = ${fmtV(peak)} peak (${fmtV(peak / Math.SQRT2)} rms — what a multimeter reads).`,
      )
      if (three)
        lines.push(
          rpm >= 0
            ? 'Phase order: A, then B a third of a period later, then C — the abc sequence. Spin the shaft the other way and B and C swap order (that is how you reverse a three-phase motor: swap any two leads).'
            : 'The shaft is running REVERSED, so the sequence is acb — B now leads instead of lags. Swapping any two phase leads has the same effect.',
        )
    }
    lines.push(
      'This page shows the steady picture (a sine averages to zero at DC); the Scope shows the waves — and its φ measurement reads the 120° between phases directly.',
    )
    return {
      id: inst.id,
      title: three
        ? 'Three-phase alternator — three coils, 120° apart'
        : 'Alternator — spin speed sets frequency AND voltage',
      lines,
    }
  }
  if (def === 'arc_lamp') {
    const struck = readEnumParam(inst, 'device_state') === 'conducting'
    const arcV = readScalarParam(inst, 'arc_voltage')
    const strike = readScalarParam(inst, 'breakover_voltage')
    const efficacy = readScalarParam(inst, 'luminous_efficacy')
    const tempK = readScalarParam(inst, 'arc_temperature')
    lines.push(
      'A carbon arc is a gas discharge: the cold gap is an insulator, so it must STRIKE — once the voltage across it reaches the ignition (breakover) voltage it breaks down into a conducting plasma, then burns at a low, near-constant arc voltage and stays lit until the current falls below its holding current. Because that burning voltage barely changes with current, the arc cannot limit itself — it needs a series ballast, or the current runs away.',
    )
    const anode = netOfTerminal(inst, 'anode')
    const cathode = netOfTerminal(inst, 'cathode')
    if (struck && arcV !== undefined && anode !== undefined && cathode !== undefined) {
      const current = Math.abs(solution.branches.get(inst.id) ?? 0)
      const power = arcV * current
      lines.push(
        `Struck: it burns at ${fmtV(arcV)}, drawing ${fmtA(current)} (the ballast sets this) — ${formatEng(power, 'W')} of arc power${efficacy !== undefined ? `, about ${formatEng(arcLuminousFluxLumens(power, efficacy), 'lm')} of light` : ''}${tempK !== undefined ? ` from a ~${tempK.toFixed(0)} K crater` : ''}.`,
      )
    } else if (strike !== undefined) {
      lines.push(
        `Not struck — it stays dark until at least ${fmtV(strike)} appears across the gap to ignite it.`,
      )
    }
    return { id: inst.id, title: 'Arc lamp — strike it, then it needs a ballast', lines }
  }
  if (def === 'neon_lamp') {
    const struck = readEnumParam(inst, 'device_state') === 'conducting'
    const strike = readScalarParam(inst, 'breakover_voltage')
    const maintain = readScalarParam(inst, 'maintaining_voltage')
    const efficacy = readScalarParam(inst, 'luminous_efficacy')
    lines.push(
      'A neon lamp is a gas discharge: the cold gas is an insulator, so it must STRIKE — at the striking voltage it ionizes into a glowing plasma, then holds at a lower maintaining voltage until the current drops too low. That strike-above-maintain gap is a hysteresis: with a resistor + capacitor it becomes a relaxation oscillator (charge up to the strike voltage, flash, fall to the maintaining voltage, repeat). Like the arc, the discharge cannot limit its own current — it needs a series ballast. A fluorescent tube is the same glow discharge in mercury vapour, whose ultraviolet light excites a phosphor coating to make efficient white light.',
    )
    const anode = netOfTerminal(inst, 'anode')
    const cathode = netOfTerminal(inst, 'cathode')
    if (struck && maintain !== undefined && anode !== undefined && cathode !== undefined) {
      const current = Math.abs(solution.branches.get(inst.id) ?? 0)
      const power = maintain * current
      lines.push(
        `Struck: it glows at ${fmtV(maintain)}, drawing ${fmtA(current)} (the ballast sets this) — ${formatEng(power, 'W')}${efficacy !== undefined ? `, about ${formatEng(arcLuminousFluxLumens(power, efficacy), 'lm')} of light` : ''}.`,
      )
    } else if (strike !== undefined) {
      lines.push(
        `Dark — it stays an open circuit until at least ${fmtV(strike)} appears across it to strike the discharge.`,
      )
    }
    return { id: inst.id, title: 'Neon lamp — strike, glow, and the relaxation oscillator', lines }
  }
  if (def === 'induction_motor' || def === 'induction_motor_three_phase') {
    const imParams = inductionMotorParamsFromInstance(inst)
    lines.push(
      'An induction motor has no electrical connection to its rotor. The 3-phase stator winding makes a magnetic field that ROTATES at the synchronous speed; the rotor is dragged along but always lags by the slip s — and that lag is exactly what induces the rotor currents that make the torque. At synchronous speed there is no lag, no induced current and no torque, so it must run a little slow, and slips more the harder it is loaded.',
    )
    if (def === 'induction_motor_three_phase') {
      lines.push(
        statorIsDelta(inst)
          ? 'This one takes its three phases on real wires, DELTA-connected — each winding sits across a line pair (no star point), seeing the full line-to-line voltage: ~3× the starting torque and line current of the same coils in wye, the physics behind wye-delta starters. Swap any two leads and the rotation reverses; lose a phase and a loaded machine cannot start (single-phasing).'
          : 'This one takes its three phases on real wires (plus the wye star point): swap any two leads and the field sequence — and the rotation — reverses; lose a phase and the field stops rotating at standstill, so a loaded machine cannot start (single-phasing).',
      )
    }
    if (imParams !== undefined) {
      if (doubleCageFromParams(imParams) !== null) {
        lines.push(
          'Its rotor is a DOUBLE CAGE (the deep-bar rotor): at standstill the rotor currents are at line frequency, so the inner cage’s high leakage chokes it and the current takes the high-resistance outer cage — strong starting torque; at running slip the two cages share the current as parallel resistances — efficient. The rotor branch is (R2/s + jX2) ∥ (R2b/s + jX2b).',
        )
      }
      if (coreLossFromParams(imParams) !== null) {
        lines.push(
          'It carries CORE LOSS: a resistance R_c in parallel with the magnetizing branch dissipates the hysteresis + eddy-current loss of the changing iron flux — real no-load current and a lower efficiency, but nothing at DC (constant flux, no loss).',
        )
      }
      const op = inductionMotorOperatingPoint(imParams)
      lines.push(
        `Synchronous speed = 120·f/poles = ${op.synchronousRpm.toFixed(0)} RPM. Under its load it settles at ${(op.slip * 100).toFixed(1)}% slip → ${op.rotorRpm.toFixed(0)} RPM, developing ${formatEng(op.torque, 'N·m')} of torque.`,
      )
      lines.push(
        `It draws ${fmtA(op.statorCurrentRms)} running at ${op.powerFactor.toFixed(2)} power factor, but ${fmtA(op.startupCurrentRms)} at standstill (the locked-rotor inrush, ~${(op.startupCurrentRms / Math.max(op.statorCurrentRms, 1e-9)).toFixed(1)}× the running current). ${formatEng(op.mechanicalPowerW, 'W')} of mechanical output, ${(op.efficiency * 100).toFixed(0)}% efficient.${op.stalled ? ' (The load exceeds the breakdown torque — it would stall.)' : ''}${op.crawlBetterSlip !== undefined ? ' (CRAWLING: the torque dip between the two cages’ peaks sits below the load — a from-rest start hangs here instead of reaching the better running point.)' : ''}`,
      )
    }
    return {
      id: inst.id,
      title: 'Induction motor — a rotating field drags the rotor (slip)',
      lines,
    }
  }
  if (def === 'induction_motor_single_phase') {
    const spParams = singlePhaseMotorParamsFromInstance(inst)
    lines.push(
      'A single winding on single-phase AC makes a PULSATING field — exactly two counter-rotating half-strength fields, which cancel at standstill: zero starting torque, the single-phase curse. The auxiliary start winding (a quarter-turn around the stator, its current pushed out of step by thin high-resistance wire or a start capacitor) is what makes the field rotate and the rotor start; a centrifugal switch drops it out at ~75% speed, and the machine runs on the main winding by the double-revolving-field principle — the rotor strengthens the field turning with it (slip s) and weakens the one against it (slip 2 − s). The torque genuinely pulsates at twice the line frequency.',
    )
    if (spParams !== undefined) {
      const op = singlePhaseOperatingPoint(spParams)
      lines.push(
        `Synchronous speed = 120·f/poles = ${op.synchronousRpm.toFixed(0)} RPM. Running (main winding only) it settles at ${(op.slip * 100).toFixed(1)}% slip → ${op.rotorRpm.toFixed(0)} RPM, developing ${formatEng(op.torque, 'N·m')} average torque.`,
      )
      lines.push(
        `It draws ${fmtA(op.currentRms)} running at ${op.powerFactor.toFixed(2)} power factor (${fmtA(op.startupCurrentRms)} locked on the main winding alone — the start winding adds to the real starting draw). ${formatEng(op.mechanicalPowerW, 'W')} of mechanical output, ${(op.efficiency * 100).toFixed(0)}% efficient.${op.stalled ? ' (The load exceeds what the running machine can carry.)' : ''}`,
      )
    }
    return {
      id: inst.id,
      title: 'Single-phase induction motor — two revolving fields and a start winding',
      lines,
    }
  }
  if (def === 'crt') {
    const crtParams = crtParamsFromInstance(inst)
    lines.push(
      'A cathode-ray tube paints with electrons: a hot cathode emits them, a high anode voltage (the EHT, kilovolts) accelerates them into a beam, the grid bias throttles the beam current (brightness), and two pairs of deflection plates bend the beam onto a phosphor screen that glows where it lands. Electrostatic deflection is proportional to the deflection voltage and INVERSELY to the anode voltage — D = (geometry)·V_deflect/V_anode — so a stiffer (higher-EHT) beam deflects less.',
    )
    const cathode = netOfTerminal(inst, 'cathode')
    const anode = netOfTerminal(inst, 'anode')
    if (crtParams !== undefined && cathode !== undefined && anode !== undefined) {
      const vC = solution.nodes.get(cathode) ?? 0
      const eht = (solution.nodes.get(anode) ?? 0) - vC
      const brightness = gridBrightness(crtParams.gridBias, crtParams.gridCutoffVoltage)
      const xNet = netOfTerminal(inst, 'x_deflect')
      const yNet = netOfTerminal(inst, 'y_deflect')
      const vX = xNet !== undefined ? (solution.nodes.get(xNet) ?? 0) - vC : 0
      const vY = yNet !== undefined ? (solution.nodes.get(yNet) ?? 0) - vC : 0
      const sens = crtParams.deflectionSensitivity
      const sx = deflectionFraction(vX, sens, eht, crtParams.ratedAnodeVoltage) * 100
      const sy = deflectionFraction(vY, sens, eht, crtParams.ratedAnodeVoltage) * 100
      lines.push(
        `EHT = ${fmtV(eht)} accelerating the beam; the grid bias gives ${(brightness * 100).toFixed(0)}% brightness, drawing ${fmtA(crtParams.beamCurrent * brightness)}.`,
      )
      lines.push(
        `Deflection: ${fmtV(vX)} on X → ${sx.toFixed(0)}% across, ${fmtV(vY)} on Y → ${sy.toFixed(0)}% up (of the screen half-width; clamped at the edge).`,
      )
    }
    return { id: inst.id, title: 'CRT — accelerate a beam, bend it, light a phosphor', lines }
  }
  if (def === 'transistor_bjt_npn' || def === 'transistor_bjt_pnp') {
    const beta = readScalarParam(inst, 'forward_current_gain')
    const vBase = solution.nodes.get(netOfTerminal(inst, 'base') ?? '')
    const vCollector = solution.nodes.get(netOfTerminal(inst, 'collector') ?? '')
    const vEmitter = solution.nodes.get(netOfTerminal(inst, 'emitter') ?? '')
    lines.push(
      `A transistor lets a SMALL base current control a BIG collector current${beta !== undefined ? ` — here up to β = ${beta} times bigger` : ''}. The solver models it as two diode junctions back-to-back (the Ebers–Moll equations), solved by the same Newton–Raphson loop.`,
    )
    if (vBase !== undefined && vEmitter !== undefined) {
      lines.push(`V_BE (base to emitter, the “control knob”): ${fmtV(vBase - vEmitter)}.`)
    }
    if (vCollector !== undefined && vEmitter !== undefined) {
      lines.push(
        `V_CE (collector to emitter, the “controlled path”): ${fmtV(vCollector - vEmitter)}.`,
      )
    }
    const earlyVoltage = readScalarParam(inst, 'forward_early_voltage')
    if (earlyVoltage !== undefined && vBase !== undefined && vCollector !== undefined) {
      // The forward-frame V_BC (negated for PNP) — the same value the solver
      // feeds the (1 − V_BC/V_A) base-charge factor.
      const vBcForward = def === 'transistor_bjt_pnp' ? vCollector - vBase : vBase - vCollector
      const factor = 1 - vBcForward / earlyVoltage
      lines.push(
        `Early effect: the collector voltage widens the collector–base depletion region and thins the base, scaling I_C by (1 − V_BC/V_A) = ${factor.toFixed(3)} here (V_A = ${earlyVoltage} V) — why the I_C–V_CE plateau tilts instead of lying flat.`,
      )
    }
    if (current !== undefined) lines.push(`I_C = ${fmtA(Math.abs(current))} (collector current).`)
    return { id: inst.id, title: 'Transistor — small current steers big current', lines }
  }
  if (def === 'transistor_mosfet_nmos' || def === 'transistor_mosfet_pmos') {
    const vth = readScalarParam(inst, 'threshold_voltage')
    const vGate = solution.nodes.get(netOfTerminal(inst, 'gate') ?? '')
    const vDrain = solution.nodes.get(netOfTerminal(inst, 'drain') ?? '')
    const vSource = solution.nodes.get(netOfTerminal(inst, 'source') ?? '')
    lines.push(
      'A MOSFET is a field-controlled valve: the gate’s VOLTAGE (it draws no current) forms or removes the channel between drain and source.',
    )
    lines.push(
      `Three regions: below the threshold (${vth !== undefined ? fmtV(vth) : 'V_th'}) the channel is gone (cutoff); just above it the channel is a gate-controlled resistor (triode, I = k·[(V_GS−V_th)·V_DS − V_DS²/2]); pushed harder it pinches off and the current depends on the gate alone (saturation, I = (k/2)·(V_GS−V_th)²).`,
    )
    // The SAME resolve the solver ran (one source of truth): with a junction
    // temperature this carries the mobility-scaled k and the drifted V_th —
    // what the user reads is what the solver used.
    const resolved = resolveMosfet(inst, temperatureC)
    if (resolved !== null && vGate !== undefined && vDrain !== undefined && vSource !== undefined) {
      const op = mosfetOperatingPoint(vGate - vSource, vDrain - vSource, resolved.params)
      lines.push(
        `Right now: V_GS = ${fmtV(vGate - vSource)}, V_DS = ${fmtV(vDrain - vSource)} → the ${op.region} region, I_D = ${fmtA(Math.abs(op.iD))} (k = ${formatEng(resolved.params.transconductance, 'A')}/V²).`,
      )
      if (
        temperatureC !== undefined &&
        vth !== undefined &&
        Math.abs(resolved.params.thresholdVoltage - vth) > 5e-4
      ) {
        lines.push(
          `Running at ${temperatureC.toFixed(1)} °C: heat thins the channel mobility (k falls by (T/T₀)^1.5) and the threshold drifts to ${fmtV(resolved.params.thresholdVoltage)} — these adjusted values ARE the ones in the numbers above.`,
        )
      }
    }
    return {
      id: inst.id,
      title: `MOSFET (${def === 'transistor_mosfet_pmos' ? 'P' : 'N'}-channel) — the three-region law`,
      lines,
    }
  }
  if (def === 'transformer' || def === 'transformer_center_tapped') {
    lines.push(
      'A transformer couples its windings through a shared magnetic field — but the field only transfers energy when the current CHANGES (v = M·di/dt). At steady DC each winding is just its own wire resistance. Drive it with AC and watch the Scope.',
    )
    return { id: inst.id, title: 'Transformer — needs changing current to couple', lines }
  }
  return null
}

function netOfTerminal(inst: Instance, terminal: string): string | undefined {
  return inst.connects?.find((c) => c.terminal === terminal)?.net
}
