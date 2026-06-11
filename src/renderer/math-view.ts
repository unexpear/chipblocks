import type { Instance, World } from '../cross-fk-validator.ts'
import type { Solution } from '../dc-solver.ts'
import { deriveSaturationCurrent, thermalVoltage } from '../diode-model.ts'
import { resistanceAtTemperature } from '../electro-thermal.ts'
import { readScalarParam } from '../instance-params.ts'
import { mosfetOperatingPoint } from '../mosfet-model.ts'
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
): MathView {
  if (solution.status !== 'solved') {
    return {
      solver: [
        `No solved circuit to show: the solver reported '${solution.status}'.`,
        ...(solution.warnings.length > 0 ? [`First warning: ${solution.warnings[0]}`] : []),
      ],
      parts: [],
      nets: [],
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
    if (card !== null) parts.push(card)
  }

  // KCL per net: sum every member element's branch current with its sign
  // (+ into the net at the element's B side, − at its A side). Nets touching
  // a 3-terminal device can't be itemized from 2-terminal branch data alone.
  const nets: MathNetRow[] = []
  for (const [netId] of solution.nodes) {
    const terms: string[] = []
    let sum = 0
    let multiTerminal = false
    for (const inst of world.instances.values()) {
      const connectsHere = (inst.connects ?? []).filter((c) => c.net === netId)
      if (connectsHere.length === 0) continue
      if ((inst.connects ?? []).length > 2) {
        multiTerminal = true
        terms.push(`${inst.id} (3-terminal — see its card)`)
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
        ? { note: 'balanced inside the solve — a 3-terminal device meets this net' }
        : {}),
    })
  }

  const unitsKey = unitsKeyFor([
    ...solver,
    ...parts.flatMap((p) => p.lines),
    ...nets.flatMap((n) => n.terms),
  ])
  return { solver, parts, nets, unitsKey }
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
      lines.push(
        `This one also changes over time: V(t) = ${fmtV(emf)} ${inst.parameters?.waveform?.value === 'square' ? `± ${formatEng(amplitude, 'V')} as a square wave (half the time up, half down)` : `+ ${formatEng(amplitude, 'V')}·sin(2π·${formatEng(f, 'Hz')}·t), a smooth sine`}. This page shows the steady part; the Scope shows the wiggle.`,
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
  if (def === 'diode_zener_silicon') {
    return {
      id: inst.id,
      title: 'Zener — not solvable yet',
      lines: [
        'A zener exists to regulate in REVERSE breakdown — and that behavior isn’t modeled yet. Rather than pretend it’s a plain diode, the solver skips it honestly (you’ll see its warning above).',
      ],
    }
  }
  if (def === 'led' || def === 'led_uv_algan' || def.startsWith('diode')) {
    const vF = readScalarParam(inst, 'forward_voltage')
    const iF = readScalarParam(inst, 'max_forward_current')
    const n = readScalarParam(inst, 'ideality_factor') ?? DEFAULT_IDEALITY_FACTOR
    const vT = thermalVoltage()
    lines.push(
      'A diode does NOT follow Ohm’s law — below its turn-on voltage almost nothing flows, then current grows explosively. The curve is the Shockley equation: I = I_S·(e^(V/(n·V_T)) − 1).',
    )
    if (vF !== undefined && iF !== undefined) {
      const iS = deriveSaturationCurrent(vF, iF, n, vT)
      lines.push(
        `I_S = ${formatEng(iS, 'A')} — a tiny “leakage” constant, chosen so the curve passes exactly through this part’s rated point (${fmtV(vF)} at ${fmtA(iF)}).`,
      )
    }
    lines.push(
      `n = ${n} is the ideality factor (how textbook-perfect the junction is); V_T = kT/q = ${formatEng(vT, 'V')} comes from temperature itself (300 K here).`,
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
    if (current !== undefined) lines.push(`I_C = ${fmtA(Math.abs(current))} (collector current).`)
    return { id: inst.id, title: 'Transistor — small current steers big current', lines }
  }
  if (def === 'transistor_mosfet_nmos' || def === 'transistor_mosfet_pmos') {
    const vth = readScalarParam(inst, 'threshold_voltage')
    const k = readScalarParam(inst, 'transconductance_parameter')
    const lambda = readScalarParam(inst, 'channel_length_modulation') ?? 0
    const vGate = solution.nodes.get(netOfTerminal(inst, 'gate') ?? '')
    const vDrain = solution.nodes.get(netOfTerminal(inst, 'drain') ?? '')
    const vSource = solution.nodes.get(netOfTerminal(inst, 'source') ?? '')
    lines.push(
      'A MOSFET is a field-controlled valve: the gate’s VOLTAGE (it draws no current) forms or removes the channel between drain and source.',
    )
    lines.push(
      `Three regions: below the threshold (${vth !== undefined ? fmtV(vth) : 'V_th'}) the channel is gone (cutoff); just above it the channel is a gate-controlled resistor (triode, I = k·[(V_GS−V_th)·V_DS − V_DS²/2]); pushed harder it pinches off and the current depends on the gate alone (saturation, I = (k/2)·(V_GS−V_th)²).`,
    )
    if (
      vth !== undefined &&
      k !== undefined &&
      vGate !== undefined &&
      vDrain !== undefined &&
      vSource !== undefined
    ) {
      const op = mosfetOperatingPoint(vGate - vSource, vDrain - vSource, {
        channel: def === 'transistor_mosfet_pmos' ? 'pmos' : 'nmos',
        thresholdVoltage: vth,
        transconductance: k,
        channelLengthModulation: lambda,
      })
      lines.push(
        `Right now: V_GS = ${fmtV(vGate - vSource)}, V_DS = ${fmtV(vDrain - vSource)} → the ${op.region} region, I_D = ${fmtA(Math.abs(op.iD))} (k = ${formatEng(k, 'A')}/V²).`,
      )
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
