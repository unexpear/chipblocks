import type { Instance, World } from '../cross-fk-validator.ts'
import type { Solution } from '../dc-solver.ts'
import { deriveSaturationCurrent, thermalVoltage } from '../diode-model.ts'
import { readScalarParam } from '../instance-params.ts'
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
export type MathView = { solver: string[]; parts: MathPartCard[]; nets: MathNetRow[] }

/** Per the solver's sign convention: positive branch current flows A-side → B-side. */
const A_SIDE = new Set(['terminal_positive', 'anode', 'terminal_a', 'terminal_in'])
const B_SIDE = new Set(['terminal_negative', 'cathode', 'terminal_b', 'terminal_out'])

/** Matches the solvers' default LED/diode ideality when no parameter is set. */
const DEFAULT_IDEALITY_FACTOR = 2.0

const fmtV = (v: number) => formatEng(v, 'V', { signed: true })
const fmtA = (a: number) => formatEng(a, 'A')

export function buildMathView(world: World, solution: Solution): MathView {
  if (solution.status !== 'solved') {
    return {
      solver: [
        `No solved circuit to show: the solver reported '${solution.status}'.`,
        ...(solution.warnings.length > 0 ? [`First warning: ${solution.warnings[0]}`] : []),
      ],
      parts: [],
      nets: [],
    }
  }

  const netCount = solution.nodes.size
  const solver: string[] = [
    'Method: Modified Nodal Analysis — Kirchhoff’s current law written at every net, solved as one linear system; nonlinear parts (diodes, LEDs, transistors) re-linearized by Newton–Raphson until the answer stops moving.',
    `Unknowns: ${Math.max(0, netCount - 1)} node voltages (ground net '${solution.ground}' is the 0 V reference) plus one branch current per source / ideal short.`,
    `Newton–Raphson iterations this solve: ${solution.iterations} (converged: ${solution.converged ? 'yes' : 'NO'}).`,
  ]
  if (solution.warnings.length > 0) {
    solver.push(`Solver warnings (${solution.warnings.length}): ${solution.warnings.join(' · ')}`)
  }

  const volts = (net: string | undefined) =>
    net !== undefined ? solution.nodes.get(net) : undefined
  const netOf = (inst: Instance, terminal: string) =>
    inst.connects?.find((c) => c.terminal === terminal)?.net
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
    const card = partCard(inst, solution, across(inst))
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

  return { solver, parts, nets }
}

function partCard(
  inst: Instance,
  solution: Solution,
  acrossV: number | undefined,
): MathPartCard | null {
  const current = solution.branches.get(inst.id)
  const lines: string[] = []
  const def = inst.definition

  if (def === 'ground') {
    return {
      id: inst.id,
      title: 'Ground — the reference',
      lines: ['V ≡ 0 V here by definition; every other voltage is measured against this point.'],
    }
  }
  if (def === 'power_source') {
    const emf = readScalarParam(inst, 'nominal_voltage') ?? 0
    const internal = readScalarParam(inst, 'internal_resistance') ?? 0
    const amplitude = readScalarParam(inst, 'ac_amplitude') ?? 0
    lines.push(
      `Thévenin source: EMF = ${fmtV(emf)} behind r_internal = ${formatEng(internal, 'Ω')}.`,
    )
    if (current !== undefined) {
      const terminal = emf - Math.abs(current) * internal
      lines.push(
        `V_terminal = EMF − I·r = ${fmtV(emf)} − ${fmtA(Math.abs(current))} × ${formatEng(internal, 'Ω')} = ${fmtV(terminal)}.`,
      )
      lines.push(
        `P_internal = I²·r = ${formatEng(current * current * internal, 'W')} (heat inside the source).`,
      )
    }
    if (amplitude > 0) {
      const f = readScalarParam(inst, 'frequency') ?? 0
      lines.push(
        `Time-varying: V(t) = ${fmtV(emf)} ${inst.parameters?.waveform?.value === 'square' ? `± ${formatEng(amplitude, 'V')} (square, 50 % duty)` : `+ ${formatEng(amplitude, 'V')}·sin(2π·${formatEng(f, 'Hz')}·t)`} — the DC view here uses the offset; see the Scope for the waveform.`,
      )
    }
    return { id: inst.id, title: 'Source — Thévenin model', lines }
  }
  if (def === 'resistor' || def === 'wire') {
    const ohms = readScalarParam(inst, 'resistance')
    const title = def === 'wire' ? 'Wire — R = ρ·L/A' : 'Resistor — Ohm’s law'
    if (def === 'wire') {
      lines.push(
        ohms !== undefined
          ? `Real series resistance from its drawn length: R = ρ·L/A = ${formatEng(ohms, 'Ω')} (annealed copper ρ, 22 AWG area).`
          : 'Ideal short (no resistance assigned).',
      )
    } else if (ohms !== undefined) {
      lines.push(`R = ${formatEng(ohms, 'Ω')}.`)
    }
    if (current !== undefined && ohms !== undefined) {
      lines.push(
        `V = I·R = ${fmtA(Math.abs(current))} × ${formatEng(ohms, 'Ω')} = ${formatEng(Math.abs(current) * ohms, 'V')}.`,
      )
      lines.push(
        `P = I²·R = ${formatEng(current * current * ohms, 'W')} dissipated as heat (Joule’s law).`,
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
        ? 'Open: no conducting path — the branch carries no current at all.'
        : 'Closed: an ideal short (0 V across it); the solver carries its current as a branch unknown.',
    )
    if (!open && current !== undefined) lines.push(`Carrying I = ${fmtA(Math.abs(current))}.`)
    return { id: inst.id, title: `Switch — ${open ? 'open' : 'closed'}`, lines }
  }
  if (def === 'led' || def === 'led_uv_algan' || def.startsWith('diode')) {
    const vF = readScalarParam(inst, 'forward_voltage')
    const iF = readScalarParam(inst, 'max_forward_current')
    const n = readScalarParam(inst, 'ideality_factor') ?? DEFAULT_IDEALITY_FACTOR
    const vT = thermalVoltage()
    lines.push(`Shockley diode law: I = I_S·(e^(V/(n·V_T)) − 1).`)
    if (vF !== undefined && iF !== undefined) {
      const iS = deriveSaturationCurrent(vF, iF, n, vT)
      lines.push(
        `I_S = ${formatEng(iS, 'A')} — calibrated so the curve passes through the rated point (${fmtV(vF)} at ${fmtA(iF)}).`,
      )
    }
    lines.push(`n = ${n} (ideality), V_T = kT/q = ${formatEng(vT, 'V')} at 300 K.`)
    if (acrossV !== undefined && current !== undefined) {
      lines.push(`Solved operating point: V = ${fmtV(acrossV)} → I = ${fmtA(Math.abs(current))}.`)
    }
    return { id: inst.id, title: 'Diode / LED — Shockley equation', lines }
  }
  if (def === 'capacitor') {
    const farads = readScalarParam(inst, 'capacitance')
    lines.push('At steady DC: I = C·dV/dt = 0 — a charged capacitor passes no current (open).')
    if (farads !== undefined && acrossV !== undefined) {
      lines.push(
        `C = ${formatEng(farads, 'F')}; holding V = ${fmtV(acrossV)} → stored charge Q = C·V = ${formatEng(farads * Math.abs(acrossV), 'C')}.`,
      )
    }
    return { id: inst.id, title: 'Capacitor — open at steady DC', lines }
  }
  if (def === 'inductor') {
    lines.push(
      'At steady DC: V = L·di/dt = 0 — a settled inductor is a short through its winding resistance. The Scope shows the real current ramp.',
    )
    if (current !== undefined) lines.push(`Carrying I = ${fmtA(Math.abs(current))}.`)
    return { id: inst.id, title: 'Inductor — short at steady DC', lines }
  }
  if (def === 'transistor_bjt_npn' || def === 'transistor_bjt_pnp') {
    const beta = readScalarParam(inst, 'forward_current_gain')
    const vBase = solution.nodes.get(netOfTerminal(inst, 'base') ?? '')
    const vCollector = solution.nodes.get(netOfTerminal(inst, 'collector') ?? '')
    const vEmitter = solution.nodes.get(netOfTerminal(inst, 'emitter') ?? '')
    lines.push(
      `Ebers–Moll model (two coupled junctions), solved by Newton–Raphson${beta !== undefined ? ` with β_F = ${beta}` : ''}.`,
    )
    if (vBase !== undefined && vEmitter !== undefined) {
      lines.push(`V_BE = ${fmtV(vBase - vEmitter)}.`)
    }
    if (vCollector !== undefined && vEmitter !== undefined) {
      lines.push(`V_CE = ${fmtV(vCollector - vEmitter)}.`)
    }
    if (current !== undefined) lines.push(`I_C = ${fmtA(Math.abs(current))} (collector current).`)
    return { id: inst.id, title: 'Transistor — Ebers–Moll', lines }
  }
  if (def === 'transformer' || def === 'transformer_center_tapped') {
    lines.push(
      'At steady DC each winding is only its winding resistance — magnetic coupling needs a CHANGING current (v = M·di/dt). The Scope shows the coupled behavior.',
    )
    return { id: inst.id, title: 'Transformer — coupling lives in the time domain', lines }
  }
  return null
}

function netOfTerminal(inst: Instance, terminal: string): string | undefined {
  return inst.connects?.find((c) => c.terminal === terminal)?.net
}
