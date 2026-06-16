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
 * Honest model note (measured 2026-06-12, the instrument self-audit):
 * backward-Euler numerically DAMPS reactive elements — an ideal capacitor
 * shows a small false average dissipation ≈ (π·f·Δt) of its reactive power
 * (~2 % at 167 samples/cycle, shrinking linearly with Δt: 232 µW → 57 µW at
 * 3× finer steps, verified live). For precision on reactive circuits, raise
 * the samples-per-cycle (a faster scope timebase = finer Δt); the energy
 * books still balance exactly — the source genuinely supplies the artifact.
 *
 * A power_source is read as a time-varying Thévenin source in series with
 * internal_resistance. Two waveforms (the `waveform` enum, default sine):
 *   sine:   V(t) = nominal_voltage + ac_amplitude·sin(2π·frequency·t)
 *   square: V(t) = nominal_voltage ± ac_amplitude  (sign of the sine; exact
 *           50 % duty — the clock shape for driving logic)
 * A plain DC source is just ac_amplitude = 0.
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

import { bjtCurrents } from './bjt-model.ts'
import type { Instance, World } from './cross-fk-validator.ts'
import { solveDCRobust } from './dc-robust.ts'
import {
  assignNodeIndices,
  type BjtElement,
  fuseIsIntact,
  identifyGround,
  KELVIN_OFFSET,
  LIGHT_CURRENT_DEFINITIONS,
  lightCurrentTerminals,
  type MosfetElement,
  mathInstance as math,
  PHOTON_EV_NM,
  potentiometerSegments,
  relayCoilEnergized,
  resolveBjt,
  resolveCrd,
  resolveJfet,
  resolveMosfet,
  SILICON_BANDGAP_EV,
  SOLVER_GMIN,
  stampBjtCompanion,
  stampLightCurrentSource,
  stampMosfetCompanion,
  stampPotentiometer,
  stampResistor,
} from './dc-solver.ts'
import { type DenseVector, lusolve, zerosMatrix, zerosVector } from './dense-linear.ts'
import {
  companionModel,
  criticalVoltage,
  deriveSaturationCurrent,
  diodeCurrent,
  LED_VARSHNI_ALPHA_EV_PER_K,
  LED_VARSHNI_BETA_K,
  pnjlim,
  ROOM_TEMPERATURE_KELVIN,
  scaleSaturationCurrent,
  thermalVoltage,
  varshniEnergyGap,
  ZENER_BREAKDOWN_IDEALITY,
  zenerCompanionModel,
} from './diode-model.ts'
import { readEnumParam, readScalarParam } from './instance-params.ts'
import { ldrResistance } from './light.ts'
import { limitMosfetStep, mosfetOperatingPoint } from './mosfet-model.ts'

/** Newton-Raphson controls per time step (matches the DC solver's §20.6). */
const NR_MAX_ITERATIONS = 100
const NR_VOLTAGE_TOLERANCE = 1e-6 // volts
const DEFAULT_IDEALITY_FACTOR = 2.0

/** Diode-family definitions the transient loop solves via Shockley. */
const DIODE_DEFINITIONS = new Set([
  'led',
  'led_uv_algan',
  'diode_laser',
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
  /**
   * Instance id → junction temperature (°C), from the electro-thermal loop
   * (S20-v3-5). A listed diode/LED/BJT solves at ITS temperature — V_T = kT/q
   * and the SPICE I_S(T) law, the same per-element treatment the DC solver
   * applies. Resistor R(T) arrives separately via the adjusted world (the
   * shared worldAtTemperatures), exactly like the DC loop. Absent ⇒ 25 °C.
   */
  temperaturesC?: Map<string, number>
  /**
   * Net id → voltage to PIN at t = 0 (initial conditions, SPICE's .ic). Each listed net is
   * hard-forced to its value while the t = 0 operating point solves, then released for t > 0, so
   * the circuit starts from a defined power-up state. This is the only way to start a bistable
   * circuit (a latch or flip-flop): its un-pinned cross-coupled pair has no defined DC point (it
   * sits at the metastable midpoint), so a cold transient cannot converge.
   */
  initialVoltages?: Map<string, number>
}

export type TransientPoint = {
  /** Simulated time, in seconds. */
  time: number
  /** Net id → voltage relative to ground, in volts, at this instant. */
  nodes: Map<string, number>
  /**
   * Amps flowing INTO each device terminal at this instant, keyed
   * `instanceId/terminal` (S20-v3-2). Every value is computed from
   * quantities the solve already produced — MNA auxiliary currents (wires,
   * switches, sources), companion-model state (C, L, transformers), or the
   * shipped device laws at the converged solution (Shockley, Ebers-Moll,
   * Level-1) — never invented. Per-device KCL holds: one device's terminal
   * currents sum to zero. Optional only so display-side test fixtures can
   * fabricate voltage-only points; the solver always records it.
   */
  currents?: Map<string, number>
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
  /** The instance + its two terminal names — current recording's identity.
      The MNA auxiliary variable IS this element's branch current (termP→termN). */
  id: string
  termP: string
  termN: string
  iP: number | undefined // matrix index of the positive net (undefined ⇒ ground)
  iN: number | undefined // matrix index of the negative net
  dcOffset: number // volts (nominal_voltage)
  amplitude: number // volts (ac_amplitude; 0 ⇒ pure DC)
  frequency: number // hertz
  rInternal: number // ohms (series internal resistance)
  /**
   * 'sine' (default) or 'square' — the clock shape. A square source swings
   * offset ± amplitude at exact 50 % duty, the function-generator convention
   * (a 0–5 V logic clock is offset 2.5 V, amplitude 2.5 V). Edges land within
   * one time step — the solver's stated time resolution, same idealization a
   * SPICE pulse source makes when rise/fall default to one print step.
   */
  waveform: 'sine' | 'square'
}

/** A capacitor resolved for the time loop. */
type CapElement = {
  id: string
  termA: string
  termB: string
  netA: string
  netB: string
  iA: number | undefined // matrix index of netA (undefined ⇒ that net is ground)
  iB: number | undefined
  capacitance: number // farads
  vPrev: number // V across (netA − netB) at the previous step
}

/** An inductor resolved for the time loop. */
type InductorElement = {
  id: string
  termA: string
  termB: string
  netA: string
  netB: string
  iA: number | undefined // matrix index of netA (undefined ⇒ that net is ground)
  iB: number | undefined
  inductance: number // henries
  windingOhms: number // series winding resistance (DCR); 0 ⇒ ideal
  iPrev: number // current through (netA → netB) at the previous step
}

/** A transformer (two magnetically-coupled windings) resolved for the time loop. */
type TransformerElement = {
  id: string
  pA: string
  pB: string
  sA: string
  sB: string
  iPA: number | undefined
  iPB: number | undefined
  iSA: number | undefined
  iSB: number | undefined
  l1: number // primary self-inductance (H)
  l2: number // secondary self-inductance (H)
  m: number // mutual inductance k·√(L1·L2)
  r1: number // primary winding resistance (Ω)
  r2: number // secondary winding resistance (Ω)
  rCore: number // core-loss resistance across the primary (Ω); 0 ⇒ lossless
  satFluxVs: number // saturation flux linkage (V·s); Infinity ⇒ not rated
  i1Prev: number // primary current (pA → pB) at the previous step
  i2Prev: number // secondary current (sA → sB) at the previous step
  fluxVs: number // running ∫v_primary·dt (V·s) — the core's real flux linkage
  saturationWarned: boolean
}

/**
 * A center-tapped transformer: THREE coupled windings on one core — two primary
 * halves (primary_a→primary_ct, primary_ct→primary_b) + the secondary. Each half
 * carries a quarter of the end-to-end primary inductance (L ∝ N²).
 */
type CtTransformerElement = {
  id: string
  /** Winding terminal nets, [from, to] × 3: P-half-1, P-half-2, secondary. */
  nets: [[string, string], [string, string], [string, string]]
  idx: [
    [number | undefined, number | undefined],
    [number | undefined, number | undefined],
    [number | undefined, number | undefined],
  ]
  /** 3×3 inductance matrix [[Lh, Mpp, Mps], [Mpp, Lh, Mps], [Mps, Mps, L2]]. */
  lMatrix: number[][]
  /** Per-winding series resistance (each half gets primary_resistance/2). */
  r: [number, number, number]
  rCore: number // core-loss resistance across the full primary (Ω); 0 ⇒ lossless
  satFluxVs: number // saturation flux linkage (V·s); Infinity ⇒ not rated
  iPrev: [number, number, number]
  fluxVs: number // running ∫v_full_primary·dt (V·s)
  saturationWarned: boolean
}

/** A diode-family element resolved for the per-step Newton-Raphson loop. */
type DiodeElement = {
  id: string
  anodeNet: string
  cathodeNet: string
  iA: number | undefined // matrix index of the anode net (undefined ⇒ ground)
  iK: number | undefined // matrix index of the cathode net
  saturationCurrent: number
  idealityFactor: number
  /** kT/q at THIS junction's temperature (298.15 K / 25 °C when no temperature given). */
  thermalV: number
  vGuess: number // linearization point; carries across steps as the warm start
}

/** A Zener resolved for the per-step Newton loop — the diode fields plus its
 *  reverse-breakdown branch (run through zenerCompanionModel). */
type ZenerElement = DiodeElement & {
  zenerVoltage: number
  breakdownCurrent: number
  breakdownIdeality: number
}

function resolveSource(inst: Instance, nodeIndex: Map<string, number>): TimedSource | null {
  const dcOffset = readScalarParam(inst, 'nominal_voltage')
  if (dcOffset === undefined) return null
  const pNet = inst.connects?.find((c) => c.terminal === 'terminal_positive')?.net
  const nNet = inst.connects?.find((c) => c.terminal === 'terminal_negative')?.net
  if (pNet === undefined || nNet === undefined) return null
  return {
    id: inst.id,
    termP: 'terminal_positive',
    termN: 'terminal_negative',
    iP: nodeIndex.get(pNet),
    iN: nodeIndex.get(nNet),
    dcOffset,
    amplitude: readScalarParam(inst, 'ac_amplitude') ?? 0,
    frequency: readScalarParam(inst, 'frequency') ?? 0,
    rInternal: readScalarParam(inst, 'internal_resistance') ?? 0,
    waveform: readEnumParam(inst, 'waveform') === 'square' ? 'square' : 'sine',
  }
}

function sourceVoltageAt(src: TimedSource, t: number): number {
  if (src.amplitude === 0) return src.dcOffset
  const swing = Math.sin(2 * Math.PI * src.frequency * t)
  if (src.waveform === 'square') {
    // sign(sin) gives an exact 50 % duty cycle; the t = 0 edge starts HIGH.
    return src.dcOffset + (swing >= 0 ? src.amplitude : -src.amplitude)
  }
  return src.dcOffset + src.amplitude * swing
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
    id: inst.id,
    termP: terminalA,
    termN: terminalB,
    iP: nodeIndex.get(aNet),
    iN: nodeIndex.get(bNet),
    dcOffset: 0,
    amplitude: 0,
    frequency: 0,
    rInternal: seriesOhms,
    waveform: 'sine', // irrelevant at amplitude 0 — a short has no waveform
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
    id: inst.id,
    termA: c1.terminal,
    termB: c2.terminal,
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
    id: inst.id,
    termA: c1.terminal,
    termB: c2.terminal,
    netA: c1.net,
    netB: c2.net,
    iA: nodeIndex.get(c1.net),
    iB: nodeIndex.get(c2.net),
    inductance,
    windingOhms: readScalarParam(inst, 'winding_resistance') ?? 0,
    iPrev: readScalarParam(inst, 'initial_current') ?? 0,
  }
}

function resolveTransformer(
  inst: Instance,
  nodeIndex: Map<string, number>,
  warnings: string[],
): TransformerElement | null {
  const l1 = readScalarParam(inst, 'primary_inductance')
  const l2 = readScalarParam(inst, 'secondary_inductance')
  const k = readScalarParam(inst, 'coupling_coefficient')
  if (l1 === undefined || l2 === undefined || k === undefined || l1 <= 0 || l2 <= 0) {
    warnings.push(`Skipped transformer '${inst.id}' (missing/invalid inductances or coupling)`)
    return null
  }
  if (k <= 0 || k >= 1) {
    // k = 1 (a perfectly ideal transformer) makes the inductance matrix singular —
    // and is unphysical; every real transformer has k < 1. Skip rather than fake.
    warnings.push(`Skipped transformer '${inst.id}' (coupling_coefficient must be 0 < k < 1)`)
    return null
  }
  const net = (terminal: string) => inst.connects?.find((c) => c.terminal === terminal)?.net
  const pA = net('primary_a')
  const pB = net('primary_b')
  const sA = net('secondary_a')
  const sB = net('secondary_b')
  if (pA === undefined || pB === undefined || sA === undefined || sB === undefined) {
    warnings.push(`Skipped transformer '${inst.id}' (missing winding terminal connects)`)
    return null
  }
  return {
    id: inst.id,
    pA,
    pB,
    sA,
    sB,
    iPA: nodeIndex.get(pA),
    iPB: nodeIndex.get(pB),
    iSA: nodeIndex.get(sA),
    iSB: nodeIndex.get(sB),
    l1,
    l2,
    m: k * Math.sqrt(l1 * l2),
    r1: readScalarParam(inst, 'primary_resistance') ?? 0,
    r2: readScalarParam(inst, 'secondary_resistance') ?? 0,
    rCore: readScalarParam(inst, 'core_loss_resistance') ?? 0,
    satFluxVs: readScalarParam(inst, 'saturation_flux_linkage') ?? Number.POSITIVE_INFINITY,
    i1Prev: 0,
    i2Prev: 0,
    fluxVs: 0,
    saturationWarned: false,
  }
}

function resolveCtTransformer(
  inst: Instance,
  nodeIndex: Map<string, number>,
  warnings: string[],
): CtTransformerElement | null {
  const l1 = readScalarParam(inst, 'primary_inductance')
  const l2 = readScalarParam(inst, 'secondary_inductance')
  const k = readScalarParam(inst, 'coupling_coefficient')
  if (l1 === undefined || l2 === undefined || k === undefined || l1 <= 0 || l2 <= 0) {
    warnings.push(`Skipped CT transformer '${inst.id}' (missing/invalid inductances or coupling)`)
    return null
  }
  if (k <= 0 || k >= 1) {
    warnings.push(`Skipped CT transformer '${inst.id}' (coupling_coefficient must be 0 < k < 1)`)
    return null
  }
  const net = (terminal: string) => inst.connects?.find((c) => c.terminal === terminal)?.net
  const pA = net('primary_a')
  const ct = net('primary_ct')
  const pB = net('primary_b')
  const sA = net('secondary_a')
  const sB = net('secondary_b')
  if (
    pA === undefined ||
    ct === undefined ||
    pB === undefined ||
    sA === undefined ||
    sB === undefined
  ) {
    warnings.push(`Skipped CT transformer '${inst.id}' (missing winding terminal connects)`)
    return null
  }
  // Each half has a quarter of the end-to-end inductance (half the turns, L ∝ N²);
  // halves couple to each other (Mpp) and to the secondary (Mps) through the core.
  const lHalf = l1 / 4
  const mPP = k * lHalf
  const mPS = k * Math.sqrt(lHalf * l2)
  const rHalf = (readScalarParam(inst, 'primary_resistance') ?? 0) / 2
  return {
    id: inst.id,
    nets: [
      [pA, ct],
      [ct, pB],
      [sA, sB],
    ],
    idx: [
      [nodeIndex.get(pA), nodeIndex.get(ct)],
      [nodeIndex.get(ct), nodeIndex.get(pB)],
      [nodeIndex.get(sA), nodeIndex.get(sB)],
    ],
    lMatrix: [
      [lHalf, mPP, mPS],
      [mPP, lHalf, mPS],
      [mPS, mPS, l2],
    ],
    r: [rHalf, rHalf, readScalarParam(inst, 'secondary_resistance') ?? 0],
    rCore: readScalarParam(inst, 'core_loss_resistance') ?? 0,
    satFluxVs: readScalarParam(inst, 'saturation_flux_linkage') ?? Number.POSITIVE_INFINITY,
    iPrev: [0, 0, 0],
    fluxVs: 0,
    saturationWarned: false,
  }
}

/**
 * Core saturation: past the rated flux linkage the iron's permeability collapses,
 * so the core-coupled (magnetizing) inductance rolls off toward the small leakage
 * value. A soft B-H knee centred on the rating — ≈1 well below it, half at the
 * rating, collapsed to TRANSFORMER_SATURATED_FRACTION beyond. The exact floor
 * depends on the core material's B-H curve (not modelled here); 0.04 is a
 * representative ≈25× collapse, matching the default k = 0.98 leakage.
 */
const TRANSFORMER_SATURATED_FRACTION = 0.04
const TRANSFORMER_SATURATION_SHARPNESS = 8
export function transformerSaturationFactor(fluxVs: number, satFluxVs: number): number {
  if (!(satFluxVs > 0) || !Number.isFinite(satFluxVs)) return 1
  const overdrive = Math.abs(fluxVs) / satFluxVs
  return (
    TRANSFORMER_SATURATED_FRACTION +
    (1 - TRANSFORMER_SATURATED_FRACTION) / (1 + overdrive ** TRANSFORMER_SATURATION_SHARPNESS)
  )
}

/**
 * The CT transformer's backward-Euler companion for one step: with three coupled
 * windings, invert A = diag(r) + L/Δt so the winding currents are i = G·v + I_h
 * (G = A⁻¹, history from the previous currents). Positive-definite for k < 1.
 */
function ctTransformerStep(tr: CtTransformerElement, dt: number): { G: number[][]; ih: number[] } {
  const s = transformerSaturationFactor(tr.fluxVs, tr.satFluxVs)
  const A = tr.lMatrix.map((row, w) =>
    row.map((l, v) => (s * l) / dt + (w === v ? (tr.r[w as 0 | 1 | 2] ?? 0) : 0)),
  )
  const G = math.inv(A) as number[][]
  const h = tr.lMatrix.map((row) =>
    row.reduce((acc, l, v) => acc + ((s * l) / dt) * (tr.iPrev[v as 0 | 1 | 2] ?? 0), 0),
  )
  const ih = G.map((row) => row.reduce((acc, g, v) => acc + g * (h[v] ?? 0), 0))
  return { G, ih }
}

/**
 * The transformer's backward-Euler companion coefficients for one step: invert
 * the 2×2 [[r1 + L1/Δt, M/Δt], [M/Δt, r2 + L2/Δt]] so each winding current is
 *   i1 = g11·v1 + g12·v2 + ih1,   i2 = g12·v1 + g22·v2 + ih2
 * (v = the winding's terminal voltage; history from the previous currents).
 * The determinant is positive exactly when k < 1 (M² < L1·L2).
 *
 * Past core saturation L1/L2/M are all scaled by the same flux-dependent factor,
 * so k (= M/√(L1·L2)) is preserved and the matrix stays positive-definite, but the
 * magnetizing inductance collapses — the primary draws a large magnetizing current,
 * the real saturation inrush.
 */
function transformerStep(tr: TransformerElement, dt: number) {
  const s = transformerSaturationFactor(tr.fluxVs, tr.satFluxVs)
  const l1 = s * tr.l1
  const l2 = s * tr.l2
  const m = s * tr.m
  const a11 = tr.r1 + l1 / dt
  const a22 = tr.r2 + l2 / dt
  const a12 = m / dt
  const det = a11 * a22 - a12 * a12
  const g11 = a22 / det
  const g22 = a11 / det
  const g12 = -a12 / det
  const h1 = (l1 * tr.i1Prev + m * tr.i2Prev) / dt
  const h2 = (m * tr.i1Prev + l2 * tr.i2Prev) / dt
  return { g11, g12, g22, ih1: g11 * h1 + g12 * h2, ih2: g12 * h1 + g22 * h2 }
}

/**
 * Resolve a diode/LED to the Shockley model. I_S comes from a declared
 * forward_saturation_current when present, else is derived from the
 * forward_voltage @ max_forward_current calibration point (same as the DC
 * solver's LED path). Starts OFF (vGuess 0) — the natural t = 0 state.
 *
 * With a junction temperature (the electro-thermal loop, S20-v3-5), the
 * element solves at that temperature exactly like the DC path: V_T = kT/q
 * and I_S scaled by the SPICE law, the bandgap taken from an LED's own
 * emission wavelength (E_g = h·c/λ) or silicon's 1.11 eV otherwise. The
 * 25 °C calibration figures are scaled FROM room temperature.
 */
function resolveDiode(
  inst: Instance,
  nodeIndex: Map<string, number>,
  vT: number,
  temperatureC?: number,
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

  let elementThermalV = vT
  if (temperatureC !== undefined) {
    const junctionKelvin = temperatureC + KELVIN_OFFSET
    const wavelengthNm = readScalarParam(inst, 'peak_wavelength')
    const isLed = wavelengthNm !== undefined && wavelengthNm > 0
    const bandgapEv = isLed ? PHOTON_EV_NM / (wavelengthNm as number) : SILICON_BANDGAP_EV
    // An LED's bandgap narrows with heat (Varshni) — the dominant reason its
    // forward voltage droops. A silicon junction keeps a constant bandgap.
    const bandgapAtJunction = isLed
      ? varshniEnergyGap(bandgapEv, LED_VARSHNI_ALPHA_EV_PER_K, LED_VARSHNI_BETA_K, junctionKelvin)
      : bandgapEv
    saturationCurrent = scaleSaturationCurrent(
      saturationCurrent,
      junctionKelvin,
      ROOM_TEMPERATURE_KELVIN,
      idealityFactor,
      bandgapEv,
      bandgapAtJunction,
    )
    elementThermalV = thermalVoltage(junctionKelvin)
  }

  return {
    id: inst.id,
    anodeNet,
    cathodeNet,
    iA: nodeIndex.get(anodeNet),
    iK: nodeIndex.get(cathodeNet),
    saturationCurrent,
    idealityFactor,
    thermalV: elementThermalV,
    vGuess: 0,
  }
}

/**
 * Resolve a Zener for the per-step Newton loop — the diode's forward parameters
 * plus the reverse-breakdown branch (V_Z + the knee current as the breakdown
 * reference). Mirrors resolveDiode; forward I_S scales with temperature as
 * silicon (constant bandgap), V_Z held constant. null without V_Z / V_F.
 */
function resolveTransientZener(
  inst: Instance,
  nodeIndex: Map<string, number>,
  vT: number,
  temperatureC?: number,
): ZenerElement | null {
  const anodeNet = inst.connects?.find((c) => c.terminal === 'anode')?.net
  const cathodeNet = inst.connects?.find((c) => c.terminal === 'cathode')?.net
  if (anodeNet === undefined || cathodeNet === undefined) return null
  const forwardVoltage = readScalarParam(inst, 'forward_voltage')
  const zenerVoltage = readScalarParam(inst, 'zener_voltage')
  if (forwardVoltage === undefined || zenerVoltage === undefined) return null
  if (forwardVoltage <= 0 || zenerVoltage <= 0) return null

  const idealityFactor = readScalarParam(inst, 'ideality_factor') ?? DEFAULT_IDEALITY_FACTOR
  const forwardCurrent = readScalarParam(inst, 'max_forward_current') ?? 0.01
  let saturationCurrent = deriveSaturationCurrent(
    forwardVoltage,
    forwardCurrent,
    idealityFactor,
    vT,
  )
  const breakdownCurrent = readScalarParam(inst, 'knee_current') ?? 0.005
  let elementThermalV = vT
  if (temperatureC !== undefined) {
    const junctionKelvin = temperatureC + KELVIN_OFFSET
    saturationCurrent = scaleSaturationCurrent(
      saturationCurrent,
      junctionKelvin,
      ROOM_TEMPERATURE_KELVIN,
      idealityFactor,
      SILICON_BANDGAP_EV,
    )
    elementThermalV = thermalVoltage(junctionKelvin)
  }

  return {
    id: inst.id,
    anodeNet,
    cathodeNet,
    iA: nodeIndex.get(anodeNet),
    iK: nodeIndex.get(cathodeNet),
    saturationCurrent,
    idealityFactor,
    thermalV: elementThermalV,
    zenerVoltage,
    breakdownCurrent,
    breakdownIdeality: ZENER_BREAKDOWN_IDEALITY,
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
 * The inductor's backward-Euler step current i_n (netA → netB), given this
 * step's converged voltage across it — the exact current the companion stamp
 * implies. ONE expression shared by the history update and the current
 * recording, so the two can never disagree.
 */
function inductorStepCurrent(ind: InductorElement, voltsAtoB: number, dt: number): number {
  const denominator = ind.inductance + ind.windingOhms * dt
  return (dt * voltsAtoB + ind.inductance * ind.iPrev) / denominator
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
 * Stamp a transformer's coupled backward-Euler companion: a 2×2 conductance block
 * across (primary, secondary) winding voltages plus per-winding history sources.
 */
function stampTransformerCompanion(
  tr: TransformerElement,
  dt: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { g11, g12, g22, ih1, ih2 } = transformerStep(tr, dt)
  const add = (i: number | undefined, j: number | undefined, val: number) => {
    if (i !== undefined && j !== undefined) M.set([i, j], (M.get([i, j]) ?? 0) + val)
  }
  const addB = (i: number | undefined, val: number) => {
    if (i !== undefined) b.set([i, 0], (b.get([i, 0]) ?? 0) + val)
  }
  // Each winding current contributes to its own two nodes' KCL rows, with
  // conductance terms on BOTH windings' voltages (the magnetic coupling).
  const ports: Array<{
    a: number | undefined
    b: number | undefined
    gSelf: number
    gOther: number
    oA: number | undefined
    oB: number | undefined
    ih: number
  }> = [
    { a: tr.iPA, b: tr.iPB, gSelf: g11, gOther: g12, oA: tr.iSA, oB: tr.iSB, ih: ih1 },
    { a: tr.iSA, b: tr.iSB, gSelf: g22, gOther: g12, oA: tr.iPA, oB: tr.iPB, ih: ih2 },
  ]
  for (const p of ports) {
    add(p.a, p.a, p.gSelf)
    add(p.a, p.b, -p.gSelf)
    add(p.b, p.b, p.gSelf)
    add(p.b, p.a, -p.gSelf)
    add(p.a, p.oA, p.gOther)
    add(p.a, p.oB, -p.gOther)
    add(p.b, p.oA, -p.gOther)
    add(p.b, p.oB, p.gOther)
    addB(p.a, -p.ih)
    addB(p.b, p.ih)
  }
  // Core (iron) loss: the equivalent-circuit parallel resistance across the
  // primary — draws real loss current in proportion to the flux swing, and
  // nothing at DC (no changing flux), exactly like a real core.
  if (tr.rCore > 0) {
    const gCore = 1 / tr.rCore
    add(tr.iPA, tr.iPA, gCore)
    add(tr.iPB, tr.iPB, gCore)
    add(tr.iPA, tr.iPB, -gCore)
    add(tr.iPB, tr.iPA, -gCore)
  }
}

/**
 * Stamp a CT transformer's coupled companion: a 3×3 conductance block across the
 * three winding voltages plus per-winding history sources.
 */
function stampCtTransformerCompanion(
  tr: CtTransformerElement,
  dt: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { G, ih } = ctTransformerStep(tr, dt)
  const add = (i: number | undefined, j: number | undefined, val: number) => {
    if (i !== undefined && j !== undefined) M.set([i, j], (M.get([i, j]) ?? 0) + val)
  }
  const addB = (i: number | undefined, val: number) => {
    if (i !== undefined) b.set([i, 0], (b.get([i, 0]) ?? 0) + val)
  }
  for (let w = 0; w < 3; w++) {
    const [aW, bW] = tr.idx[w as 0 | 1 | 2]
    for (let v = 0; v < 3; v++) {
      const g = G[w]?.[v] ?? 0
      const [aV, bV] = tr.idx[v as 0 | 1 | 2]
      add(aW, aV, g)
      add(aW, bV, -g)
      add(bW, aV, -g)
      add(bW, bV, g)
    }
    addB(aW, -(ih[w] ?? 0))
    addB(bW, ih[w] ?? 0)
  }
  // Core loss across the FULL primary (primary_a ↔ primary_b) — one shared core.
  if (tr.rCore > 0) {
    const gCore = 1 / tr.rCore
    const [pA] = tr.idx[0]
    const [, pB] = tr.idx[1]
    add(pA, pA, gCore)
    add(pB, pB, gCore)
    add(pA, pB, -gCore)
    add(pB, pA, -gCore)
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
  // Diode conductance + the SPICE GMIN floor (a 1 pS parallel resistor — the b
  // current source uses G alone), anchoring a node behind a hard-off junction.
  const Gd = G + SOLVER_GMIN
  if (iA !== undefined) {
    M.set([iA, iA], (M.get([iA, iA]) ?? 0) + Gd)
    b.set([iA, 0], (b.get([iA, 0]) ?? 0) - iEq)
  }
  if (iK !== undefined) {
    M.set([iK, iK], (M.get([iK, iK]) ?? 0) + Gd)
    b.set([iK, 0], (b.get([iK, 0]) ?? 0) + iEq)
  }
  if (iA !== undefined && iK !== undefined) {
    M.set([iA, iK], (M.get([iA, iK]) ?? 0) - Gd)
    M.set([iK, iA], (M.get([iK, iA]) ?? 0) - Gd)
  }
}

/** Stamp a Zener's companion model — identical shape to stampDiodeCompanion, but
 *  zenerCompanionModel adds the reverse-breakdown branch so it clamps at V_Z. */
function stampTransientZener(
  z: ZenerElement,
  vT: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { conductance: G, currentSource: iEq } = zenerCompanionModel(
    z.vGuess,
    z.saturationCurrent,
    z.idealityFactor,
    vT,
    z.zenerVoltage,
    z.breakdownCurrent,
    z.breakdownIdeality,
  )
  const { iA, iK } = z
  const Gd = G + SOLVER_GMIN
  if (iA !== undefined) {
    M.set([iA, iA], (M.get([iA, iA]) ?? 0) + Gd)
    b.set([iA, 0], (b.get([iA, 0]) ?? 0) - iEq)
  }
  if (iK !== undefined) {
    M.set([iK, iK], (M.get([iK, iK]) ?? 0) + Gd)
    b.set([iK, 0], (b.get([iK, 0]) ?? 0) + iEq)
  }
  if (iA !== undefined && iK !== undefined) {
    M.set([iA, iK], (M.get([iA, iK]) ?? 0) - Gd)
    M.set([iK, iA], (M.get([iK, iA]) ?? 0) - Gd)
  }
}

/** Per-iteration Zener voltage limiting — pnjlim on the forward branch, else on
 *  the breakdown branch in u = −(V + V_Z) space (same as the DC solver). */
function limitTransientZener(vRaw: number, z: ZenerElement): { voltage: number; limited: boolean } {
  const vcritFwd = criticalVoltage(z.saturationCurrent, z.idealityFactor, z.thermalV)
  const fwd = pnjlim(vRaw, z.vGuess, z.idealityFactor * z.thermalV, vcritFwd)
  if (fwd.limited) return fwd
  const vcritBd = criticalVoltage(z.breakdownCurrent, z.breakdownIdeality, z.thermalV)
  const bd = pnjlim(
    -(vRaw + z.zenerVoltage),
    -(z.vGuess + z.zenerVoltage),
    z.breakdownIdeality * z.thermalV,
    vcritBd,
  )
  if (bd.limited) return { voltage: -(bd.voltage + z.zenerVoltage), limited: true }
  return { voltage: vRaw, limited: false }
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

  // Initial conditions (.ic): nets the caller pins at t = 0, resolved to matrix indices. Each is
  // hard-forced to its value while the t = 0 operating point solves (breaking the metastability of
  // a bistable power-up), then released for t > 0. Ground / unknown nets are skipped.
  const icList: { idx: number; voltage: number }[] = []
  if (options.initialVoltages) {
    for (const [netId, voltage] of options.initialVoltages) {
      const idx = nodeIndex.get(netId)
      if (idx !== undefined) icList.push({ idx, voltage })
    }
  }
  const maxIter = options.maxIterations ?? NR_MAX_ITERATIONS

  const sources: TimedSource[] = []
  const caps: CapElement[] = []
  const inductors: InductorElement[] = []
  const transformers: TransformerElement[] = []
  const ctTransformers: CtTransformerElement[] = []
  const diodes: DiodeElement[] = []
  const zeners: ZenerElement[] = []
  const bjts: BjtElement[] = []
  const mosfets: MosfetElement[] = []
  // Resistors are stamped straight from the world each instant; for current
  // recording we mirror stampResistor's exact reads (connects[0]/[1], the
  // `resistance` param) so the recorded ΔV/R is what the matrix saw.
  const resistors: {
    id: string
    termA: string
    termB: string
    netA: string
    netB: string
    ohms: number
  }[] = []
  // Potentiometers, kept for the per-terminal current recording: the wiper net
  // plus whichever ends are wired (a rheostat leaves one end floating) and the
  // two segment resistances at the current wiper position.
  const pots: {
    id: string
    netA?: string
    netW: string
    netB?: string
    rTop: number
    rBottom: number
  }[] = []
  for (const inst of world.instances.values()) {
    if (
      inst.definition === 'resistor' ||
      inst.definition === 'thermistor' ||
      inst.definition === 'photoresistor'
    ) {
      const ohms =
        inst.definition === 'photoresistor'
          ? ldrResistance(inst)
          : readScalarParam(inst, 'resistance')
      const c1 = inst.connects?.[0]
      const c2 = inst.connects?.[1]
      if (ohms !== undefined && ohms > 0 && c1 !== undefined && c2 !== undefined) {
        resistors.push({
          id: inst.id,
          termA: c1.terminal,
          termB: c2.terminal,
          netA: c1.net,
          netB: c2.net,
          ohms,
        })
      }
    }
    if (inst.definition === 'potentiometer') {
      const seg = potentiometerSegments(inst)
      const a = inst.connects?.find((c) => c.terminal === 'terminal_a')?.net
      const w = inst.connects?.find((c) => c.terminal === 'wiper')?.net
      const b = inst.connects?.find((c) => c.terminal === 'terminal_b')?.net
      if (seg !== null && w !== undefined && (a !== undefined || b !== undefined)) {
        pots.push({
          id: inst.id,
          ...(a === undefined ? {} : { netA: a }),
          netW: w,
          ...(b === undefined ? {} : { netB: b }),
          rTop: seg.top,
          rBottom: seg.bottom,
        })
      }
    }
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
    } else if (inst.definition === 'transformer') {
      const tr = resolveTransformer(inst, nodeIndex, warnings)
      if (tr !== null) transformers.push(tr)
    } else if (inst.definition === 'transformer_center_tapped') {
      const tr = resolveCtTransformer(inst, nodeIndex, warnings)
      if (tr !== null) ctTransformers.push(tr)
    } else if (DIODE_DEFINITIONS.has(inst.definition)) {
      const d = resolveDiode(inst, nodeIndex, vT, options.temperaturesC?.get(inst.id))
      if (d !== null) diodes.push(d)
      else warnings.push(`Skipped diode '${inst.id}' (missing calibration or anode/cathode)`)
    } else if (
      inst.definition === 'transistor_bjt_npn' ||
      inst.definition === 'transistor_bjt_pnp'
    ) {
      const bjt = resolveBjt(inst, options.temperaturesC?.get(inst.id))
      if (bjt !== null) bjts.push(bjt)
      else warnings.push(`Skipped transistor '${inst.id}' (missing parameters or terminals)`)
    } else if (
      inst.definition === 'transistor_mosfet_nmos' ||
      inst.definition === 'transistor_mosfet_pmos'
    ) {
      const fet = resolveMosfet(inst, options.temperaturesC?.get(inst.id))
      if (fet !== null) mosfets.push(fet)
      else warnings.push(`Skipped MOSFET '${inst.id}' (missing parameters or terminals)`)
    } else if (
      inst.definition === 'transistor_jfet_n_channel' ||
      inst.definition === 'transistor_jfet_p_channel'
    ) {
      const fet = resolveJfet(inst)
      if (fet !== null) mosfets.push(fet)
      else warnings.push(`Skipped JFET '${inst.id}' (missing parameters or terminals)`)
    } else if (inst.definition === 'diode_constant_current') {
      const fet = resolveCrd(inst)
      if (fet !== null) mosfets.push(fet)
      else
        warnings.push(
          `Skipped constant-current diode '${inst.id}' (missing parameters or terminals)`,
        )
    } else if (inst.definition === 'diode_tunnel') {
      // The tunnel diode's negative-resistance I-V is DC-only so far (a tunnel-diode oscillator
      // needs the transient path — the documented successor). Warn rather than silently open it.
      warnings.push(`Tunnel diode '${inst.id}' is not modeled in transient yet (DC only)`)
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
    } else if (inst.definition === 'fuse') {
      // Intact → a 0 V link carrying its small cold element resistance, like a
      // wire; blown → omitted entirely, a real open circuit. The blow itself is
      // a canvas-level state change off the solved current, not done here.
      if (fuseIsIntact(inst)) {
        const short = resolveShort(
          inst,
          nodeIndex,
          'terminal_a',
          'terminal_b',
          readScalarParam(inst, 'element_resistance') ?? 0,
        )
        if (short !== null) sources.push(short)
        else warnings.push(`Skipped fuse '${inst.id}' (missing terminal connects)`)
      }
    } else if (inst.definition === 'relay') {
      // Coil (a resistor across coil_a/coil_b) + contacts (common shorted to the
      // live throw at the coil_state the relay loop resolved). Quasi-static: the
      // contacts hold their settled position through the record; mid-record
      // switching (the pull-in delay) is a documented refinement.
      const coil = resolveShort(
        inst,
        nodeIndex,
        'coil_a',
        'coil_b',
        readScalarParam(inst, 'coil_resistance') ?? 0,
      )
      if (coil !== null) sources.push(coil)
      const liveThrow = relayCoilEnergized(inst) ? 'normally_open' : 'normally_closed'
      const contact = resolveShort(
        inst,
        nodeIndex,
        'common',
        liveThrow,
        readScalarParam(inst, 'contact_resistance') ?? 0,
      )
      if (contact !== null) sources.push(contact)
    } else if (
      inst.definition === 'switch_spst_toggle' ||
      inst.definition === 'switch_spst_momentary'
    ) {
      // Closed → an ideal 0 V short; open → omitted entirely, a real open
      // circuit. The momentary push button is the same (default open).
      if (readEnumParam(inst, 'state') !== 'open') {
        const short = resolveShort(inst, nodeIndex, 'terminal_in', 'terminal_out', 0)
        if (short !== null) sources.push(short)
        else warnings.push(`Skipped switch '${inst.id}' (missing terminal connects)`)
      }
    } else if (inst.definition === 'switch_spdt') {
      // The selected common→throw pair shorts; the other throw stays open.
      const throwTerminal = readEnumParam(inst, 'position') === 'throw_b' ? 'throw_b' : 'throw_a'
      const short = resolveShort(inst, nodeIndex, 'common', throwTerminal, 0)
      if (short !== null) sources.push(short)
      else warnings.push(`Skipped SPDT '${inst.id}' (missing common/throw connects)`)
    } else if (inst.definition === 'diode_zener_silicon') {
      // Forward conduction PLUS reverse-breakdown regulation (clamps at V_Z),
      // solved in the same per-step Newton loop as the diodes.
      const z = resolveTransientZener(inst, nodeIndex, vT, options.temperaturesC?.get(inst.id))
      if (z !== null) zeners.push(z)
      else warnings.push(`Skipped zener '${inst.id}' (missing zener_voltage or forward_voltage)`)
    }
  }
  const S = sources.length

  // Solve one instant at time t with the diodes linearized at their current
  // guesses. 'initial' holds each capacitor at its initial condition (a
  // fixed-voltage stamp, one aux each); 'step' uses the backward-Euler companion.
  // Returns the net-voltage map PLUS the raw solution vector (the auxiliary
  // entries are the sources'/wires'/switches' exact branch currents — current
  // recording reads them instead of re-deriving), or null on a singular matrix.
  const solveInstant = (
    mode: 'initial' | 'step',
    t: number,
  ): { nodes: Map<string, number>; x: number[][] } | null => {
    const extraAux = mode === 'initial' ? caps.length + icList.length : 0
    const size = N + S + extraAux
    const M = zerosMatrix(size)
    const b = zerosVector(size)

    for (const inst of world.instances.values()) {
      // A thermistor stamps as a resistor at its Beta-law resistance (written by
      // the electro-thermal loop for this temperature). A photoresistor stamps as
      // a resistor at its light-law resistance (stampResistor reads ldrResistance).
      if (
        inst.definition === 'resistor' ||
        inst.definition === 'thermistor' ||
        inst.definition === 'photoresistor'
      )
        stampResistor(inst, nodeIndex, M)
      else if (inst.definition === 'potentiometer') stampPotentiometer(inst, nodeIndex, M)
      else if (LIGHT_CURRENT_DEFINITIONS.has(inst.definition)) {
        // A photodiode / phototransistor injects its constant light-driven current.
        const [from, to] = lightCurrentTerminals(inst.definition)
        stampLightCurrentSource(inst, nodeIndex, M, b, from, to)
      }
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
      for (let k = 0; k < icList.length; k++) {
        // biome-ignore lint/style/noNonNullAssertion: k is bound by icList.length
        const ic = icList[k]!
        // hard-pin this net to its t = 0 initial-condition value (released for t > 0)
        stampFixedVoltage(ic.idx, undefined, ic.voltage, N + S + caps.length + k, M, b)
      }
      for (const ind of inductors) stampFixedCurrent(ind.iA, ind.iB, ind.iPrev, b)
      for (const tr of transformers) {
        stampFixedCurrent(tr.iPA, tr.iPB, tr.i1Prev, b)
        stampFixedCurrent(tr.iSA, tr.iSB, tr.i2Prev, b)
      }
      for (const tr of ctTransformers) {
        for (let w = 0; w < 3; w++) {
          const [a, b2] = tr.idx[w as 0 | 1 | 2]
          stampFixedCurrent(a, b2, tr.iPrev[w as 0 | 1 | 2] ?? 0, b)
        }
      }
    } else {
      for (const cap of caps) stampCapacitorCompanion(cap, dt, M, b)
      for (const ind of inductors) stampInductorCompanion(ind, dt, M, b)
      for (const tr of transformers) stampTransformerCompanion(tr, dt, M, b)
      for (const tr of ctTransformers) stampCtTransformerCompanion(tr, dt, M, b)
    }
    for (const d of diodes) stampDiodeCompanion(d, d.thermalV, M, b)
    for (const z of zeners) stampTransientZener(z, z.thermalV, M, b)
    for (const bjt of bjts) stampBjtCompanion(bjt, nodeIndex, bjt.thermalV, M, b)
    for (const fet of mosfets) stampMosfetCompanion(fet, nodeIndex, M, b)

    let x: DenseVector
    try {
      x = lusolve(M, b)
    } catch {
      return null
    }
    const xArr = x.toArray()
    const nodes = new Map<string, number>([[ground, 0]])
    for (const [netId, idx] of nodeIndex) {
      const v = xArr[idx]?.[0]
      if (typeof v === 'number') nodes.set(netId, v)
    }
    return { nodes, x: xArr }
  }

  // One converged instant: Newton-Raphson over the diode linearizations (§20.6 —
  // re-solve, pnjlim-limit each diode's update, repeat until quiet). With no
  // diodes this converges on the first pass (maxDelta 0), i.e. a plain solve.
  const solveConverged = (
    mode: 'initial' | 'step',
    t: number,
  ): { nodes: Map<string, number>; x: number[][] } | 'singular' | 'no-convergence' => {
    for (let iter = 1; iter <= maxIter; iter++) {
      const solved = solveInstant(mode, t)
      if (solved === null) return 'singular'
      const nodes = solved.nodes
      let maxDelta = 0
      let anyLimited = false
      for (const d of diodes) {
        const vAnode = d.anodeNet === ground ? 0 : (nodes.get(d.anodeNet) ?? 0)
        const vCathode = d.cathodeNet === ground ? 0 : (nodes.get(d.cathodeNet) ?? 0)
        const nVT = d.idealityFactor * d.thermalV
        const vcrit = criticalVoltage(d.saturationCurrent, d.idealityFactor, d.thermalV)
        const limit = pnjlim(vAnode - vCathode, d.vGuess, nVT, vcrit)
        maxDelta = Math.max(maxDelta, Math.abs(limit.voltage - d.vGuess))
        if (limit.limited) anyLimited = true
        d.vGuess = limit.voltage
      }
      for (const z of zeners) {
        const vAnode = z.anodeNet === ground ? 0 : (nodes.get(z.anodeNet) ?? 0)
        const vCathode = z.cathodeNet === ground ? 0 : (nodes.get(z.cathodeNet) ?? 0)
        const next = limitTransientZener(vAnode - vCathode, z)
        maxDelta = Math.max(maxDelta, Math.abs(next.voltage - z.vGuess))
        if (next.limited) anyLimited = true
        z.vGuess = next.voltage
      }
      for (const bjt of bjts) {
        const vB = bjt.baseNet === ground ? 0 : (nodes.get(bjt.baseNet) ?? 0)
        const vC = bjt.collectorNet === ground ? 0 : (nodes.get(bjt.collectorNet) ?? 0)
        const vE = bjt.emitterNet === ground ? 0 : (nodes.get(bjt.emitterNet) ?? 0)
        // PNP junction guesses live in the forward frame (negated physical).
        const sign = bjt.polarity === 'pnp' ? -1 : 1
        const vcrit = criticalVoltage(bjt.params.saturationCurrent, 1, bjt.thermalV)
        const limBE = pnjlim(sign * (vB - vE), bjt.vBE, bjt.thermalV, vcrit)
        const limBC = pnjlim(sign * (vB - vC), bjt.vBC, bjt.thermalV, vcrit)
        maxDelta = Math.max(
          maxDelta,
          Math.abs(limBE.voltage - bjt.vBE),
          Math.abs(limBC.voltage - bjt.vBC),
        )
        if (limBE.limited || limBC.limited) anyLimited = true
        bjt.vBE = limBE.voltage
        bjt.vBC = limBC.voltage
      }
      for (const fet of mosfets) {
        const vG = fet.gateNet === ground ? 0 : (nodes.get(fet.gateNet) ?? 0)
        const vD = fet.drainNet === ground ? 0 : (nodes.get(fet.drainNet) ?? 0)
        const vS = fet.sourceNet === ground ? 0 : (nodes.get(fet.sourceNet) ?? 0)
        const nextVGS = limitMosfetStep(vG - vS, fet.vGS)
        const nextVDS = limitMosfetStep(vD - vS, fet.vDS)
        maxDelta = Math.max(maxDelta, Math.abs(nextVGS - fet.vGS), Math.abs(nextVDS - fet.vDS))
        if (nextVGS !== vG - vS || nextVDS !== vD - vS) anyLimited = true
        fet.vGS = nextVGS
        fet.vDS = nextVDS
      }
      if (maxDelta < NR_VOLTAGE_TOLERANCE && !anyLimited) return solved
    }
    return 'no-convergence'
  }

  // Per-terminal currents at one converged instant (S20-v3-2): amps flowing
  // INTO each terminal, keyed `instanceId/terminal`. Every value comes from
  // what the solve already computed — the MNA auxiliary variables, the
  // companion state, or the shipped device laws at the converged voltages —
  // so per-device KCL closes by construction.
  const recordCurrents = (
    nodes: Map<string, number>,
    x: number[][],
    mode: 'initial' | 'step',
  ): Map<string, number> => {
    const into = new Map<string, number>()
    const volts = (net: string): number => (net === ground ? 0 : (nodes.get(net) ?? 0))
    // A two-terminal element with through-current I (termA → termB inside it).
    const through = (id: string, termA: string, termB: string, amps: number) => {
      into.set(`${id}/${termA}`, amps)
      into.set(`${id}/${termB}`, -amps)
    }

    // Sources, wires, closed switches: the auxiliary variable at N+s IS the
    // branch current termP → termN (the stamp's equation is
    // v_P − v_N − I·r = V, the same a→b convention the wire clamp uses).
    for (let s = 0; s < S; s++) {
      // biome-ignore lint/style/noNonNullAssertion: s is bound by S
      const src = sources[s]!
      through(src.id, src.termP, src.termN, x[N + s]?.[0] ?? 0)
    }

    for (const r of resistors) {
      through(r.id, r.termA, r.termB, (volts(r.netA) - volts(r.netB)) / r.ohms)
    }

    // A pot is two segments sharing the wiper, so its terminal currents are set
    // directly (the 2-terminal `through` helper can't express the wiper carrying
    // the difference of the two segment currents). An unwired end contributes no
    // current (rheostat use).
    for (const pot of pots) {
      const iTop = pot.netA === undefined ? 0 : (volts(pot.netA) - volts(pot.netW)) / pot.rTop
      const iBottom = pot.netB === undefined ? 0 : (volts(pot.netB) - volts(pot.netW)) / pot.rBottom
      if (pot.netA !== undefined) into.set(`${pot.id}/terminal_a`, iTop)
      if (pot.netB !== undefined) into.set(`${pot.id}/terminal_b`, iBottom)
      into.set(`${pot.id}/wiper`, -(iTop + iBottom)) // KCL: the wiper carries the rest
    }

    for (let j = 0; j < caps.length; j++) {
      // biome-ignore lint/style/noNonNullAssertion: j is bound by caps.length
      const cap = caps[j]!
      if (mode === 'initial') {
        // At t = 0 the capacitor is held by a fixed-voltage stamp; its
        // auxiliary variable is the exact current the hold supplies.
        through(cap.id, cap.termA, cap.termB, x[N + S + j]?.[0] ?? 0)
      } else {
        // The backward-Euler companion's current at this step, from the OLD
        // history (vPrev is updated only after recording).
        const gEq = cap.capacitance / dt
        const v = volts(cap.netA) - volts(cap.netB)
        through(cap.id, cap.termA, cap.termB, gEq * v - gEq * cap.vPrev)
      }
    }

    for (const ind of inductors) {
      const amps =
        mode === 'initial'
          ? ind.iPrev // held: current through an inductor cannot jump
          : inductorStepCurrent(ind, volts(ind.netA) - volts(ind.netB), dt)
      through(ind.id, ind.termA, ind.termB, amps)
    }

    for (const tr of transformers) {
      let i1: number
      let i2: number
      if (mode === 'initial') {
        i1 = tr.i1Prev
        i2 = tr.i2Prev
      } else {
        const { g11, g12, g22, ih1, ih2 } = transformerStep(tr, dt)
        const v1 = volts(tr.pA) - volts(tr.pB)
        const v2 = volts(tr.sA) - volts(tr.sB)
        i1 = g11 * v1 + g12 * v2 + ih1
        i2 = g12 * v1 + g22 * v2 + ih2
      }
      // Core loss rides the primary terminals alongside the winding current.
      const iCore = tr.rCore > 0 ? (volts(tr.pA) - volts(tr.pB)) / tr.rCore : 0
      into.set(`${tr.id}/primary_a`, i1 + iCore)
      into.set(`${tr.id}/primary_b`, -i1 - iCore)
      through(tr.id, 'secondary_a', 'secondary_b', i2)
    }

    for (const tr of ctTransformers) {
      let i: [number, number, number]
      if (mode === 'initial') {
        i = tr.iPrev
      } else {
        const { G, ih } = ctTransformerStep(tr, dt)
        const v = tr.nets.map(([from, to]) => volts(from) - volts(to))
        i = [0, 1, 2].map(
          (w) => (G[w] ?? []).reduce((acc, g, j) => acc + g * (v[j] ?? 0), 0) + (ih[w] ?? 0),
        ) as [number, number, number]
      }
      const vFullPrimary = volts(tr.nets[0][0]) - volts(tr.nets[1][1])
      const iCore = tr.rCore > 0 ? vFullPrimary / tr.rCore : 0
      // Windings: pA→ct, ct→pB, sA→sB; the center tap carries both halves.
      into.set(`${tr.id}/primary_a`, (i[0] ?? 0) + iCore)
      into.set(`${tr.id}/primary_ct`, -(i[0] ?? 0) + (i[1] ?? 0))
      into.set(`${tr.id}/primary_b`, -(i[1] ?? 0) - iCore)
      through(tr.id, 'secondary_a', 'secondary_b', i[2] ?? 0)
    }

    for (const d of diodes) {
      // Shockley at the converged junction voltage — the device law itself,
      // at THIS junction's own temperature.
      const v = volts(d.anodeNet) - volts(d.cathodeNet)
      through(
        d.id,
        'anode',
        'cathode',
        diodeCurrent(v, d.saturationCurrent, d.idealityFactor, d.thermalV),
      )
    }

    for (const z of zeners) {
      // The two-branch device current at the converged voltage — forward, or the
      // reverse breakdown current when clamping (I = G·V + I_eq recovers it).
      const v = volts(z.anodeNet) - volts(z.cathodeNet)
      const { conductance, currentSource } = zenerCompanionModel(
        v,
        z.saturationCurrent,
        z.idealityFactor,
        z.thermalV,
        z.zenerVoltage,
        z.breakdownCurrent,
        z.breakdownIdeality,
      )
      through(z.id, 'anode', 'cathode', conductance * v + currentSource)
    }

    for (const bjt of bjts) {
      // Ebers-Moll at the converged node voltages. PNP evaluates in the
      // forward frame (negated junction voltages) and flips the currents —
      // the same convention stampBjtCompanion uses.
      const sign = bjt.polarity === 'pnp' ? -1 : 1
      const vBE = sign * (volts(bjt.baseNet) - volts(bjt.emitterNet))
      const vBC = sign * (volts(bjt.baseNet) - volts(bjt.collectorNet))
      const i = bjtCurrents(vBE, vBC, bjt.params, bjt.thermalV)
      into.set(`${bjt.inst.id}/collector`, sign * i.iC)
      into.set(`${bjt.inst.id}/base`, sign * i.iB)
      into.set(`${bjt.inst.id}/emitter`, sign * i.iE)
    }

    for (const fet of mosfets) {
      // Level-1 at the converged labeled voltages (PMOS handled inside).
      const vGS = volts(fet.gateNet) - volts(fet.sourceNet)
      const vDS = volts(fet.drainNet) - volts(fet.sourceNet)
      const { iD } = mosfetOperatingPoint(vGS, vDS, fet.params)
      into.set(`${fet.inst.id}/drain`, iD)
      into.set(`${fet.inst.id}/source`, -iD)
      into.set(`${fet.inst.id}/gate`, 0) // insulated gate: no DC current in Level-1
    }

    return into
  }

  const series: TransientPoint[] = []

  // Seed the t = 0 device guesses from a robust DC operating point at the initial source values.
  // The per-step Newton-Raphson below warm-starts from the previous step, but the first solve has
  // no history; on stiff feedback circuits (cross-coupled logic — latches, flip-flops) a cold
  // start can fail to converge. The DC solver's source-stepping fallback finds the t = 0 operating
  // point reliably, so seeding the device guesses from it starts the first transient step near the
  // answer. A failed seed solve is harmless — the cold start still runs.
  const sourceT0 = new Map(sources.map((s) => [s.id, sourceVoltageAt(s, 0)]))
  const seedInstances = new Map<string, Instance>()
  for (const [id, inst] of world.instances) {
    const v0 = sourceT0.get(id)
    seedInstances.set(
      id,
      inst.definition === 'power_source' && v0 !== undefined
        ? {
            ...inst,
            parameters: {
              ...inst.parameters,
              nominal_voltage: { value: { kind: 'scalar', amount: v0, unit: 'volt' } },
              ac_amplitude: { value: { kind: 'scalar', amount: 0, unit: 'volt' } },
            },
          }
        : inst,
    )
  }
  const seed = solveDCRobust({ ...world, instances: seedInstances })
  if (seed.status === 'solved') {
    const at = (net: string) => (net === ground ? 0 : (seed.nodes.get(net) ?? 0))
    for (const d of diodes) d.vGuess = at(d.anodeNet) - at(d.cathodeNet)
    for (const z of zeners) z.vGuess = at(z.anodeNet) - at(z.cathodeNet)
    for (const bjt of bjts) {
      const sign = bjt.polarity === 'pnp' ? -1 : 1
      bjt.vBE = sign * (at(bjt.baseNet) - at(bjt.emitterNet))
      bjt.vBC = sign * (at(bjt.baseNet) - at(bjt.collectorNet))
    }
    for (const fet of mosfets) {
      fet.vGS = at(fet.gateNet) - at(fet.sourceNet)
      fet.vDS = at(fet.drainNet) - at(fet.sourceNet)
    }
  }

  // t = 0 — the initial condition (capacitors held at their initial voltage).
  const initial = solveConverged('initial', 0)
  if (initial === 'singular') return { status: 'singular-matrix', series: [], ground, warnings }
  if (initial === 'no-convergence') {
    warnings.push('Newton-Raphson did not converge at t = 0')
    return { status: 'did-not-converge', series: [], ground, warnings }
  }
  series.push({
    time: 0,
    nodes: initial.nodes,
    currents: recordCurrents(initial.nodes, initial.x, 'initial'),
  })

  // March forward with backward-Euler. Each step: converge the nonlinear solve
  // (warm-started from the previous operating point), record the sample WITH
  // its per-terminal currents (computed from the still-old histories), then
  // refresh the companion histories.
  const steps = Math.round(duration / dt)
  for (let k = 1; k <= steps; k++) {
    const t = k * dt
    const solved = solveConverged('step', t)
    if (solved === 'singular') return { status: 'singular-matrix', series, ground, warnings }
    if (solved === 'no-convergence') {
      warnings.push(`Newton-Raphson did not converge at t = ${t}`)
      return { status: 'did-not-converge', series, ground, warnings }
    }
    const nodes = solved.nodes
    const currents = recordCurrents(nodes, solved.x, 'step')
    series.push({ time: t, nodes, currents })

    for (const cap of caps) {
      cap.vPrev = (nodes.get(cap.netA) ?? 0) - (nodes.get(cap.netB) ?? 0)
    }
    for (const ind of inductors) {
      // The converged step's current through the inductor — the value just
      // recorded (computed from the OLD iPrev), now becoming the history.
      ind.iPrev = currents.get(`${ind.id}/${ind.termA}`) ?? ind.iPrev
    }
    for (const tr of transformers) {
      // Same: this step's winding currents from the companion at the OLD history.
      const { g11, g12, g22, ih1, ih2 } = transformerStep(tr, dt)
      const v1 = (nodes.get(tr.pA) ?? 0) - (nodes.get(tr.pB) ?? 0)
      const v2 = (nodes.get(tr.sA) ?? 0) - (nodes.get(tr.sB) ?? 0)
      tr.i1Prev = g11 * v1 + g12 * v2 + ih1
      tr.i2Prev = g12 * v1 + g22 * v2 + ih2
      // The core's real flux linkage IS the primary's volt-second integral —
      // exceeding the rated capacity is genuine core saturation (too-low
      // frequency, overvoltage, DC bias, or switch-on inrush all get here).
      tr.fluxVs += v1 * dt
      if (!tr.saturationWarned && Math.abs(tr.fluxVs) > tr.satFluxVs) {
        tr.saturationWarned = true
        warnings.push(
          `Transformer core saturated at t = ${t.toPrecision(3)} s: |∫v·dt| exceeded ` +
            `${tr.satFluxVs} V·s — the magnetizing inductance collapses past here and the ` +
            'magnetizing current spikes (real core saturation).',
        )
      }
    }
    for (const tr of ctTransformers) {
      const { G, ih } = ctTransformerStep(tr, dt) // OLD history
      const v = tr.nets.map(([from, to]) => (nodes.get(from) ?? 0) - (nodes.get(to) ?? 0))
      tr.iPrev = [0, 1, 2].map(
        (w) => (G[w] ?? []).reduce((acc, g, j) => acc + g * (v[j] ?? 0), 0) + (ih[w] ?? 0),
      ) as [number, number, number]
      // Shared core: flux from the FULL primary's volt-seconds (both halves).
      tr.fluxVs += ((nodes.get(tr.nets[0][0]) ?? 0) - (nodes.get(tr.nets[1][1]) ?? 0)) * dt
      if (!tr.saturationWarned && Math.abs(tr.fluxVs) > tr.satFluxVs) {
        tr.saturationWarned = true
        warnings.push(
          `Transformer core saturated at t = ${t.toPrecision(3)} s: |∫v·dt| exceeded ` +
            `${tr.satFluxVs} V·s — the magnetizing inductance collapses past here and the ` +
            'magnetizing current spikes (real core saturation).',
        )
      }
    }
  }

  return { status: 'solved', series, ground, warnings }
}
