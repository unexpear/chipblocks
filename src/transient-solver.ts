/**
 * Transient (time-domain) solver — backward-Euler over the circuit, with a
 * Newton-Raphson inner loop per step for nonlinear devices (S19-v3-42/43/44).
 * The DC solver (dc-solver.ts) finds one steady-state snapshot; this marches the
 * circuit through time, so energy-storing elements behave dynamically (a
 * capacitor charges on a real RC exponential), a time-varying source drives real
 * alternating current, and a diode rectifies it.
 *
 * Backward-Euler companion model for a capacitor C across nodes a, b, stepping by
 * Δt from the previous-step voltage V_{n−1} across it:
 *   i_C = C·dV/dt ≈ (C/Δt)·(V_n − V_{n−1})
 *       = G_eq·V_n − I_hist,    G_eq = C/Δt,    I_hist = G_eq·V_{n−1}
 * i.e. a conductance G_eq in parallel with a history current source.
 *
 * The inductor is the dual, from v = L·di/dt + R_w·i (R_w = winding resistance),
 * stepping from the previous-step current i_{n−1} through it:
 *   i_n = G_eq·V_n + I_hist,   G_eq = Δt/(L + R_w·Δt),
 *                              I_hist = L·i_{n−1}/(L + R_w·Δt)
 * Current through an inductor cannot jump: at t = 0 it is held at its initial
 * current (default 0 — an instantaneous open), then ramps on the real L/R curve.
 *
 * A power_source is read as a time-varying Thévenin source:
 *   V(t) = nominal_voltage + ac_amplitude·sin(2π·frequency·t)
 * in series with internal_resistance. A plain DC source is just ac_amplitude = 0.
 *
 * Diode-family devices (silicon/Schottky rectifiers, LEDs) use the same Shockley
 * companion model + pnjlim limiting as the DC solver (diode-model.ts), but
 * re-linearized INSIDE each time step: every step runs a Newton-Raphson loop to
 * convergence before time advances, warm-started from the previous step's
 * operating point (so a settled circuit converges in one iteration). A Zener is
 * deliberately skipped with a warning — its defining reverse-breakdown behavior
 * isn't modeled yet, and faking it as a plain diode would be wrong.
 *
 * NPN BJTs run in the same per-step Newton-Raphson loop via the DC solver's
 * Ebers-Moll companion stamp — two coupled junctions, each pnjlim-limited — so a
 * transistor amplifies (or switches) a moving signal through time.
 *
 * Drawn wires and closed switches stamp as 0 V sources (a wire carries its real
 * series resistance R = ρL/A; an open switch is omitted — a real open circuit),
 * matching the DC solver, so a canvas circuit runs through time unchanged.
 *
 * Scope: resistor, capacitor, inductor, DC/AC power_source, diode/LED, NPN BJT,
 * wire, switch.
 */

import type { Instance, World } from './cross-fk-validator.ts'
import {
  assignNodeIndices,
  type BjtElement,
  identifyGround,
  mathInstance as math,
  resolveBjt,
  stampBjtCompanion,
  stampResistor,
} from './dc-solver.ts'
import {
  companionModel,
  criticalVoltage,
  deriveSaturationCurrent,
  pnjlim,
  thermalVoltage,
} from './diode-model.ts'
import { readEnumParam, readScalarParam } from './instance-params.ts'

/** Newton-Raphson controls per time step (matches the DC solver's §20.6). */
const NR_MAX_ITERATIONS = 100
const NR_VOLTAGE_TOLERANCE = 1e-6 // volts
const DEFAULT_IDEALITY_FACTOR = 2.0

/** Diode-family definitions the transient loop solves via Shockley. */
const DIODE_DEFINITIONS = new Set([
  'led',
  'led_uv_algan',
  'diode_silicon_rectifier',
  'diode_schottky_al_si',
])

export type TransientOptions = {
  /** Explicit ground net id; overrides ground-port / type: ground auto-detection. */
  ground?: string
  /** Time step Δt, in seconds. */
  timeStep: number
  /** Total simulated time, in seconds (the series runs t = 0 .. duration). */
  duration: number
  /** Newton-Raphson iteration cap per time step (default 100). */
  maxIterations?: number
}

export type TransientPoint = {
  /** Simulated time, in seconds. */
  time: number
  /** Net id → voltage relative to ground, in volts, at this instant. */
  nodes: Map<string, number>
}

export type TransientStatus =
  | 'solved'
  | 'no-ground'
  | 'singular-matrix'
  | 'bad-options'
  | 'did-not-converge'

export type TransientResult = {
  status: TransientStatus
  /** One sample per step, t = 0 first through t = duration last. */
  series: TransientPoint[]
  ground: string | undefined
  warnings: string[]
}

/** A power source resolved for the time loop: V(t) = dcOffset + amplitude·sin(2πft). */
type TimedSource = {
  iP: number | undefined // matrix index of the positive net (undefined ⇒ ground)
  iN: number | undefined // matrix index of the negative net
  dcOffset: number // volts (nominal_voltage)
  amplitude: number // volts (ac_amplitude; 0 ⇒ pure DC)
  frequency: number // hertz
  rInternal: number // ohms (series internal resistance)
}

/** A capacitor resolved for the time loop. */
type CapElement = {
  netA: string
  netB: string
  iA: number | undefined // matrix index of netA (undefined ⇒ that net is ground)
  iB: number | undefined
  capacitance: number // farads
  vPrev: number // V across (netA − netB) at the previous step
}

/** An inductor resolved for the time loop. */
type InductorElement = {
  netA: string
  netB: string
  iA: number | undefined // matrix index of netA (undefined ⇒ that net is ground)
  iB: number | undefined
  inductance: number // henries
  windingOhms: number // series winding resistance (DCR); 0 ⇒ ideal
  iPrev: number // current through (netA → netB) at the previous step
}

/** A diode-family element resolved for the per-step Newton-Raphson loop. */
type DiodeElement = {
  anodeNet: string
  cathodeNet: string
  iA: number | undefined // matrix index of the anode net (undefined ⇒ ground)
  iK: number | undefined // matrix index of the cathode net
  saturationCurrent: number
  idealityFactor: number
  vGuess: number // linearization point; carries across steps as the warm start
}

function resolveSource(inst: Instance, nodeIndex: Map<string, number>): TimedSource | null {
  const dcOffset = readScalarParam(inst, 'nominal_voltage')
  if (dcOffset === undefined) return null
  const pNet = inst.connects?.find((c) => c.terminal === 'terminal_positive')?.net
  const nNet = inst.connects?.find((c) => c.terminal === 'terminal_negative')?.net
  if (pNet === undefined || nNet === undefined) return null
  return {
    iP: nodeIndex.get(pNet),
    iN: nodeIndex.get(nNet),
    dcOffset,
    amplitude: readScalarParam(inst, 'ac_amplitude') ?? 0,
    frequency: readScalarParam(inst, 'frequency') ?? 0,
    rInternal: readScalarParam(inst, 'internal_resistance') ?? 0,
  }
}

function sourceVoltageAt(src: TimedSource, t: number): number {
  if (src.amplitude === 0) return src.dcOffset
  return src.dcOffset + src.amplitude * Math.sin(2 * Math.PI * src.frequency * t)
}

/**
 * A wire or closed switch as a 0 V source between its two named terminals —
 * `seriesOhms` carries a wire's real resistance (0 ⇒ an ideal short), matching
 * the DC solver's stampWire / stampClosedSwitch.
 */
function resolveShort(
  inst: Instance,
  nodeIndex: Map<string, number>,
  terminalA: string,
  terminalB: string,
  seriesOhms: number,
): TimedSource | null {
  const aNet = inst.connects?.find((c) => c.terminal === terminalA)?.net
  const bNet = inst.connects?.find((c) => c.terminal === terminalB)?.net
  if (aNet === undefined || bNet === undefined) return null
  return {
    iP: nodeIndex.get(aNet),
    iN: nodeIndex.get(bNet),
    dcOffset: 0,
    amplitude: 0,
    frequency: 0,
    rInternal: seriesOhms,
  }
}

function resolveCapacitor(inst: Instance, nodeIndex: Map<string, number>): CapElement | null {
  const capacitance = readScalarParam(inst, 'capacitance')
  if (capacitance === undefined || capacitance <= 0) return null
  if (inst.connects?.length !== 2) return null
  const c1 = inst.connects[0]
  const c2 = inst.connects[1]
  if (c1 === undefined || c2 === undefined) return null
  return {
    netA: c1.net,
    netB: c2.net,
    iA: nodeIndex.get(c1.net),
    iB: nodeIndex.get(c2.net),
    capacitance,
    vPrev: readScalarParam(inst, 'initial_voltage') ?? 0,
  }
}

function resolveInductor(inst: Instance, nodeIndex: Map<string, number>): InductorElement | null {
  const inductance = readScalarParam(inst, 'inductance')
  if (inductance === undefined || inductance <= 0) return null
  if (inst.connects?.length !== 2) return null
  const c1 = inst.connects[0]
  const c2 = inst.connects[1]
  if (c1 === undefined || c2 === undefined) return null
  return {
    netA: c1.net,
    netB: c2.net,
    iA: nodeIndex.get(c1.net),
    iB: nodeIndex.get(c2.net),
    inductance,
    windingOhms: readScalarParam(inst, 'winding_resistance') ?? 0,
    iPrev: readScalarParam(inst, 'initial_current') ?? 0,
  }
}

/**
 * Resolve a diode/LED to the Shockley model. I_S comes from a declared
 * forward_saturation_current when present, else is derived from the
 * forward_voltage @ max_forward_current calibration point (same as the DC
 * solver's LED path). Starts OFF (vGuess 0) — the natural t = 0 state.
 */
function resolveDiode(
  inst: Instance,
  nodeIndex: Map<string, number>,
  vT: number,
): DiodeElement | null {
  const anodeNet = inst.connects?.find((c) => c.terminal === 'anode')?.net
  const cathodeNet = inst.connects?.find((c) => c.terminal === 'cathode')?.net
  if (anodeNet === undefined || cathodeNet === undefined) return null

  const idealityFactor = readScalarParam(inst, 'ideality_factor') ?? DEFAULT_IDEALITY_FACTOR
  let saturationCurrent = readScalarParam(inst, 'forward_saturation_current')
  if (saturationCurrent === undefined) {
    const forwardVoltage = readScalarParam(inst, 'forward_voltage')
    const forwardCurrent = readScalarParam(inst, 'max_forward_current')
    if (forwardVoltage === undefined || forwardCurrent === undefined) return null
    if (forwardVoltage <= 0 || forwardCurrent <= 0) return null
    saturationCurrent = deriveSaturationCurrent(forwardVoltage, forwardCurrent, idealityFactor, vT)
  }
  if (saturationCurrent <= 0) return null

  return {
    anodeNet,
    cathodeNet,
    iA: nodeIndex.get(anodeNet),
    iK: nodeIndex.get(cathodeNet),
    saturationCurrent,
    idealityFactor,
    vGuess: 0,
  }
}

/**
 * Stamp a (Thévenin) voltage source: V_P − V_N = V − I·rInternal, via an auxiliary
 * current variable at auxIdx. The −rInternal on the aux diagonal makes the terminal
 * voltage droop under load; rInternal = 0 is an ideal source.
 */
function stampTimedSource(
  src: TimedSource,
  V: number,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { iP, iN } = src
  if (iP !== undefined) {
    M.set([iP, auxIdx], (M.get([iP, auxIdx]) ?? 0) + 1)
    M.set([auxIdx, iP], (M.get([auxIdx, iP]) ?? 0) + 1)
  }
  if (iN !== undefined) {
    M.set([iN, auxIdx], (M.get([iN, auxIdx]) ?? 0) - 1)
    M.set([auxIdx, iN], (M.get([auxIdx, iN]) ?? 0) - 1)
  }
  M.set([auxIdx, auxIdx], (M.get([auxIdx, auxIdx]) ?? 0) - src.rInternal)
  b.set([auxIdx, 0], V)
}

/** Constrain V_A − V_B = V via an auxiliary current variable (an ideal fixed source). */
function stampFixedVoltage(
  iA: number | undefined,
  iB: number | undefined,
  V: number,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  if (iA !== undefined) {
    M.set([iA, auxIdx], (M.get([iA, auxIdx]) ?? 0) + 1)
    M.set([auxIdx, iA], (M.get([auxIdx, iA]) ?? 0) + 1)
  }
  if (iB !== undefined) {
    M.set([iB, auxIdx], (M.get([iB, auxIdx]) ?? 0) - 1)
    M.set([auxIdx, iB], (M.get([auxIdx, iB]) ?? 0) - 1)
  }
  b.set([auxIdx, 0], V)
}

/** Stamp a capacitor's backward-Euler companion: conductance C/Δt + history source. */
function stampCapacitorCompanion(
  cap: CapElement,
  dt: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const gEq = cap.capacitance / dt
  const iHist = gEq * cap.vPrev
  const { iA, iB } = cap
  if (iA !== undefined) {
    M.set([iA, iA], (M.get([iA, iA]) ?? 0) + gEq)
    b.set([iA, 0], (b.get([iA, 0]) ?? 0) + iHist)
  }
  if (iB !== undefined) {
    M.set([iB, iB], (M.get([iB, iB]) ?? 0) + gEq)
    b.set([iB, 0], (b.get([iB, 0]) ?? 0) - iHist)
  }
  if (iA !== undefined && iB !== undefined) {
    M.set([iA, iB], (M.get([iA, iB]) ?? 0) - gEq)
    M.set([iB, iA], (M.get([iB, iA]) ?? 0) - gEq)
  }
}

/**
 * Stamp an inductor's backward-Euler companion: conductance Δt/(L + R_w·Δt) in
 * parallel with the history current source I_hist flowing netA → netB.
 */
function stampInductorCompanion(
  ind: InductorElement,
  dt: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const denominator = ind.inductance + ind.windingOhms * dt
  const gEq = dt / denominator
  const iHist = (ind.inductance * ind.iPrev) / denominator
  const { iA, iB } = ind
  if (iA !== undefined) {
    M.set([iA, iA], (M.get([iA, iA]) ?? 0) + gEq)
    b.set([iA, 0], (b.get([iA, 0]) ?? 0) - iHist)
  }
  if (iB !== undefined) {
    M.set([iB, iB], (M.get([iB, iB]) ?? 0) + gEq)
    b.set([iB, 0], (b.get([iB, 0]) ?? 0) + iHist)
  }
  if (iA !== undefined && iB !== undefined) {
    M.set([iA, iB], (M.get([iA, iB]) ?? 0) - gEq)
    M.set([iB, iA], (M.get([iB, iA]) ?? 0) - gEq)
  }
}

/**
 * Stamp a fixed current source of `amps` flowing netA → netB — the t = 0 hold for
 * an inductor (current through it cannot jump; 0 A is an instantaneous open).
 */
function stampFixedCurrent(
  iA: number | undefined,
  iB: number | undefined,
  amps: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  if (iA !== undefined) b.set([iA, 0], (b.get([iA, 0]) ?? 0) - amps)
  if (iB !== undefined) b.set([iB, 0], (b.get([iB, 0]) ?? 0) + amps)
}

/**
 * Stamp a diode's Newton-Raphson companion at its current voltage guess: a
 * conductance G_eq anode↔cathode plus the linearization current source I_eq
 * (drawn out of the anode, into the cathode).
 */
function stampDiodeCompanion(
  d: DiodeElement,
  vT: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { conductance: G, currentSource: iEq } = companionModel(
    d.vGuess,
    d.saturationCurrent,
    d.idealityFactor,
    vT,
  )
  const { iA, iK } = d
  if (iA !== undefined) {
    M.set([iA, iA], (M.get([iA, iA]) ?? 0) + G)
    b.set([iA, 0], (b.get([iA, 0]) ?? 0) - iEq)
  }
  if (iK !== undefined) {
    M.set([iK, iK], (M.get([iK, iK]) ?? 0) + G)
    b.set([iK, 0], (b.get([iK, 0]) ?? 0) + iEq)
  }
  if (iA !== undefined && iK !== undefined) {
    M.set([iA, iK], (M.get([iA, iK]) ?? 0) - G)
    M.set([iK, iA], (M.get([iK, iA]) ?? 0) - G)
  }
}

export function solveTransient(world: World, options: TransientOptions): TransientResult {
  const warnings: string[] = []
  const dt = options.timeStep
  const duration = options.duration
  if (!(dt > 0) || !(duration > 0) || dt > duration) {
    return { status: 'bad-options', series: [], ground: undefined, warnings }
  }

  const ground = identifyGround(world, options, warnings)
  if (ground === undefined) {
    return { status: 'no-ground', series: [], ground: undefined, warnings }
  }

  const nodeIndex = assignNodeIndices(world.nets, ground)
  const N = nodeIndex.size
  const vT = thermalVoltage()
  const maxIter = options.maxIterations ?? NR_MAX_ITERATIONS

  const sources: TimedSource[] = []
  const caps: CapElement[] = []
  const inductors: InductorElement[] = []
  const diodes: DiodeElement[] = []
  const bjts: BjtElement[] = []
  for (const inst of world.instances.values()) {
    if (inst.definition === 'power_source' && inst.connects?.length === 2) {
      const src = resolveSource(inst, nodeIndex)
      if (src !== null) sources.push(src)
      else warnings.push(`Skipped source '${inst.id}' (missing voltage or terminal connects)`)
    } else if (inst.definition === 'capacitor') {
      const cap = resolveCapacitor(inst, nodeIndex)
      if (cap !== null) caps.push(cap)
      else warnings.push(`Skipped capacitor '${inst.id}' (missing capacitance or connects)`)
    } else if (inst.definition === 'inductor') {
      const ind = resolveInductor(inst, nodeIndex)
      if (ind !== null) inductors.push(ind)
      else warnings.push(`Skipped inductor '${inst.id}' (missing inductance or connects)`)
    } else if (DIODE_DEFINITIONS.has(inst.definition)) {
      const d = resolveDiode(inst, nodeIndex, vT)
      if (d !== null) diodes.push(d)
      else warnings.push(`Skipped diode '${inst.id}' (missing calibration or anode/cathode)`)
    } else if (inst.definition === 'transistor_bjt_npn') {
      const bjt = resolveBjt(inst)
      if (bjt !== null) bjts.push(bjt)
      else warnings.push(`Skipped transistor '${inst.id}' (missing parameters or terminals)`)
    } else if (inst.definition === 'wire') {
      const short = resolveShort(
        inst,
        nodeIndex,
        'terminal_a',
        'terminal_b',
        readScalarParam(inst, 'resistance') ?? 0,
      )
      if (short !== null) sources.push(short)
      else warnings.push(`Skipped wire '${inst.id}' (missing terminal connects)`)
    } else if (inst.definition === 'switch_spst_toggle') {
      // Closed → an ideal 0 V short; open → omitted entirely, a real open circuit.
      if (readEnumParam(inst, 'state') !== 'open') {
        const short = resolveShort(inst, nodeIndex, 'terminal_in', 'terminal_out', 0)
        if (short !== null) sources.push(short)
        else warnings.push(`Skipped switch '${inst.id}' (missing terminal connects)`)
      }
    } else if (inst.definition === 'diode_zener_silicon') {
      // A Zener's defining behavior is reverse breakdown, which isn't modeled
      // yet — skipping it (visible warning) beats faking it as a plain diode.
      warnings.push(`Skipped zener '${inst.id}' (reverse breakdown not modeled in transient yet)`)
    }
  }
  const S = sources.length

  // Solve one instant at time t with the diodes linearized at their current
  // guesses. 'initial' holds each capacitor at its initial condition (a
  // fixed-voltage stamp, one aux each); 'step' uses the backward-Euler companion.
  // Returns the net-voltage map, or null on a singular matrix.
  const solveInstant = (mode: 'initial' | 'step', t: number): Map<string, number> | null => {
    const extraAux = mode === 'initial' ? caps.length : 0
    const size = N + S + extraAux
    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
    const M: any = math.zeros(size, size)
    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
    const b: any = math.zeros(size, 1)

    for (const inst of world.instances.values()) {
      if (inst.definition === 'resistor') stampResistor(inst, nodeIndex, M)
    }
    for (let s = 0; s < S; s++) {
      // biome-ignore lint/style/noNonNullAssertion: s is bound by S
      const src = sources[s]!
      stampTimedSource(src, sourceVoltageAt(src, t), N + s, M, b)
    }
    if (mode === 'initial') {
      for (let j = 0; j < caps.length; j++) {
        // biome-ignore lint/style/noNonNullAssertion: j is bound by caps.length
        const cap = caps[j]!
        stampFixedVoltage(cap.iA, cap.iB, cap.vPrev, N + S + j, M, b)
      }
      for (const ind of inductors) stampFixedCurrent(ind.iA, ind.iB, ind.iPrev, b)
    } else {
      for (const cap of caps) stampCapacitorCompanion(cap, dt, M, b)
      for (const ind of inductors) stampInductorCompanion(ind, dt, M, b)
    }
    for (const d of diodes) stampDiodeCompanion(d, vT, M, b)
    for (const bjt of bjts) stampBjtCompanion(bjt, nodeIndex, vT, M, b)

    // biome-ignore lint/suspicious/noExplicitAny: mathjs lusolve return is polymorphic
    let x: any
    try {
      x = math.lusolve(M, b)
    } catch {
      return null
    }
    const xArr = x.toArray() as number[][]
    const nodes = new Map<string, number>([[ground, 0]])
    for (const [netId, idx] of nodeIndex) {
      const v = xArr[idx]?.[0]
      if (typeof v === 'number') nodes.set(netId, v)
    }
    return nodes
  }

  // One converged instant: Newton-Raphson over the diode linearizations (§20.6 —
  // re-solve, pnjlim-limit each diode's update, repeat until quiet). With no
  // diodes this converges on the first pass (maxDelta 0), i.e. a plain solve.
  const solveConverged = (
    mode: 'initial' | 'step',
    t: number,
  ): Map<string, number> | 'singular' | 'no-convergence' => {
    let nodes: Map<string, number> | null = null
    for (let iter = 1; iter <= maxIter; iter++) {
      nodes = solveInstant(mode, t)
      if (nodes === null) return 'singular'
      let maxDelta = 0
      let anyLimited = false
      for (const d of diodes) {
        const vAnode = d.anodeNet === ground ? 0 : (nodes.get(d.anodeNet) ?? 0)
        const vCathode = d.cathodeNet === ground ? 0 : (nodes.get(d.cathodeNet) ?? 0)
        const nVT = d.idealityFactor * vT
        const vcrit = criticalVoltage(d.saturationCurrent, d.idealityFactor, vT)
        const limit = pnjlim(vAnode - vCathode, d.vGuess, nVT, vcrit)
        maxDelta = Math.max(maxDelta, Math.abs(limit.voltage - d.vGuess))
        if (limit.limited) anyLimited = true
        d.vGuess = limit.voltage
      }
      for (const bjt of bjts) {
        const vB = bjt.baseNet === ground ? 0 : (nodes.get(bjt.baseNet) ?? 0)
        const vC = bjt.collectorNet === ground ? 0 : (nodes.get(bjt.collectorNet) ?? 0)
        const vE = bjt.emitterNet === ground ? 0 : (nodes.get(bjt.emitterNet) ?? 0)
        const vcrit = criticalVoltage(bjt.params.saturationCurrent, 1, vT)
        const limBE = pnjlim(vB - vE, bjt.vBE, vT, vcrit)
        const limBC = pnjlim(vB - vC, bjt.vBC, vT, vcrit)
        maxDelta = Math.max(
          maxDelta,
          Math.abs(limBE.voltage - bjt.vBE),
          Math.abs(limBC.voltage - bjt.vBC),
        )
        if (limBE.limited || limBC.limited) anyLimited = true
        bjt.vBE = limBE.voltage
        bjt.vBC = limBC.voltage
      }
      if (maxDelta < NR_VOLTAGE_TOLERANCE && !anyLimited) return nodes
    }
    return 'no-convergence'
  }

  const series: TransientPoint[] = []

  // t = 0 — the initial condition (capacitors held at their initial voltage).
  const initial = solveConverged('initial', 0)
  if (initial === 'singular') return { status: 'singular-matrix', series: [], ground, warnings }
  if (initial === 'no-convergence') {
    warnings.push('Newton-Raphson did not converge at t = 0')
    return { status: 'did-not-converge', series: [], ground, warnings }
  }
  series.push({ time: 0, nodes: initial })

  // March forward with backward-Euler. Each step: converge the nonlinear solve
  // (warm-started from the previous operating point), refresh the capacitor
  // history, record the sample.
  const steps = Math.round(duration / dt)
  for (let k = 1; k <= steps; k++) {
    const t = k * dt
    const nodes = solveConverged('step', t)
    if (nodes === 'singular') return { status: 'singular-matrix', series, ground, warnings }
    if (nodes === 'no-convergence') {
      warnings.push(`Newton-Raphson did not converge at t = ${t}`)
      return { status: 'did-not-converge', series, ground, warnings }
    }
    for (const cap of caps) {
      cap.vPrev = (nodes.get(cap.netA) ?? 0) - (nodes.get(cap.netB) ?? 0)
    }
    for (const ind of inductors) {
      // The converged step's current through the inductor (from its companion),
      // computed from the OLD iPrev before overwriting it.
      const v = (nodes.get(ind.netA) ?? 0) - (nodes.get(ind.netB) ?? 0)
      const denominator = ind.inductance + ind.windingOhms * dt
      ind.iPrev = (dt * v + ind.inductance * ind.iPrev) / denominator
    }
    series.push({ time: t, nodes })
  }

  return { status: 'solved', series, ground, warnings }
}
