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
 * Diode-family devices (silicon/Schottky rectifiers, LEDs, the laser diode) use the same Shockley
 * companion model + pnjlim limiting as the DC solver (diode-model.ts), but re-linearized INSIDE each
 * time step: every step runs a Newton-Raphson loop to convergence before time advances, warm-started
 * from the previous step's operating point (so a settled circuit converges in one iteration). The
 * zener adds its reverse-breakdown branch; the tunnel diode its negative-resistance region; the
 * varactor its voltage-controlled, charge-conserving junction capacitance. The Shockley 4-layer diode
 * and the gate-triggered SCR march their latch state across steps (a relaxation oscillator / gated
 * rectifier).
 *
 * Transistors run in the same per-step Newton-Raphson loop via the DC solver's companion stamps:
 * NPN + PNP BJTs (Ebers-Moll, two coupled pnjlim-limited junctions), MOSFETs and JFETs (square law),
 * and the JFET-based constant-current diode — so a transistor amplifies or switches a moving signal.
 *
 * Drawn wires and closed switches stamp as 0 V sources (a wire carries its real series resistance
 * R = ρL/A; an open switch is omitted — a real open circuit), matching the DC solver, so a canvas
 * circuit runs through time unchanged. Transformers (incl. center-tapped, with core loss + volt-second
 * saturation), relays, fuses, potentiometers, thermistors, and photoresistors are handled too.
 */

import { ayrtonArcVoltage } from './arc-model.ts'
import { bjtCurrents } from './bjt-model.ts'
import type { Instance, World } from './cross-fk-validator.ts'
import { CRT_DEFLECTION_INPUT_OHMS, crtParamsFromInstance, gridBrightness } from './crt-model.ts'
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
  PHOTON_EV_NM,
  potentiometerSegments,
  relayCoilEnergized,
  resolveBjt,
  resolveCrd,
  resolveJfet,
  resolveMosfet,
  resolveScreenGridTube,
  resolveTriode,
  resolveTunnelDiode,
  type ScreenGridTube,
  SILICON_BANDGAP_EV,
  SOLVER_GMIN,
  stampBjtCompanion,
  stampCccs,
  stampConductance,
  stampLightCurrentSource,
  stampMosfetCompanion,
  stampPotentiometer,
  stampResistor,
  stampScreenGridTubeCompanion,
  stampTriodeCompanion,
  stampVccs,
  type TriodeElement,
  type TunnelDiode,
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
import { coilInductanceFromInstance } from './electromagnet-model.ts'
import { readEnumParam, readScalarParam } from './instance-params.ts'
import { ldrResistance } from './light.ts'
import { mathInstance as math } from './mathjs-instance.ts'
import { limitMosfetStep, mosfetOperatingPoint } from './mosfet-model.ts'
import {
  generatorEmf,
  generatorParamsFromInstance,
  motorBackEmf,
  motorParamsFromInstance,
  motorSpeedStep,
} from './motor-model.ts'
import { type ShockleyDiodeState, scrTarget, shockleyDiodeTarget } from './shockley-diode.ts'
import { NR_MAX_ITERATIONS, NR_VOLTAGE_TOLERANCE } from './solver-constants.ts'
import { propagationDelayS } from './transmission-line-model.ts'
import {
  limitTunnelDiodeStep,
  tunnelDiodeCompanion,
  tunnelDiodeCurrent,
} from './tunnel-diode-model.ts'
import {
  childLangmuirCurrent,
  gridTubeOperatingPoint,
  limitVacuumStep,
  perveanceFromOperatingPoint,
  screenGridTubeOperatingPoint,
  vacuumDiodeCompanion,
} from './vacuum-tube-model.ts'
import { type VaractorParams, varactorCapacitance, varactorCharge } from './varactor-model.ts'

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
   * (S20-v3-5). Each listed nonlinear device solves at ITS temperature, the
   * same per-element treatment the DC solver applies: junctions (diode/LED,
   * BJT, zener, tunnel) scale V_T = kT/q and the SPICE I_S(T) law; the FET
   * family (MOSFET/JFET/constant-current diode) scales mobility and threshold.
   * Resistor R(T) arrives separately via the adjusted world (the shared
   * worldAtTemperatures), exactly like the DC loop. Absent ⇒ 25 °C.
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
  /**
   * Co-simulation pre-hook, fired at the TOP of each march step (after t = k·Δt is known, before the
   * step solves) with the step index, its time, and the PREVIOUS committed step's node voltages. The
   * mixed-signal driver uses it to advance the digital (logic-fidelity) sub-circuit one clock and stash
   * the voltage its outputs should drive onto the analog boundary nets this step. No-op when absent.
   */
  onStepBegin?: (step: number, t: number, prevNodes: Map<string, number>) => void
  /**
   * Co-simulation source override: consulted for each timed source before sourceVoltageAt. Returning a
   * number forces that source to the given voltage this step (the digital→analog video bridge — a
   * char-gen output driving the CRT grid through a real Thévenin source); undefined keeps the source's
   * own waveform. It only READS a value onStepBegin already computed, so it is safe inside the Newton loop.
   */
  externalSourceV?: (sourceId: string) => number | undefined
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
   * 'sine' (default), 'square', or 'sawtooth' — the waveform. A square source swings
   * offset ± amplitude at exact 50 % duty, the function-generator convention
   * (a 0–5 V logic clock is offset 2.5 V, amplitude 2.5 V). Edges land within
   * one time step — the solver's stated time resolution, same idealization a
   * SPICE pulse source makes when rise/fall default to one print step. A sawtooth
   * ramps offset−amplitude → offset+amplitude over each period then snaps back —
   * the deflection sweep of a CRT (the ramp draws a line; the snap is the retrace).
   * A staircase holds `steps` discrete levels across the period (offset−amplitude →
   * offset+amplitude) — a stepped vertical sweep, so a few-line raster sits flat per
   * scanline instead of shearing (a real staircase-generator / stepped-deflection sweep).
   */
  waveform: 'sine' | 'square' | 'sawtooth' | 'staircase'
  /** Staircase only: how many held levels per period (e.g. one per scanline). Default 8. */
  steps?: number
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
  /** Present for a varactor — the engine integrates its charge Q(V) implicitly (see capCompanion). */
  varactor?: VaractorParams
  /** Varactor Newton guess for this step's voltage, and its stored charge at the previous step. */
  vGuess?: number
  qPrev?: number
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

/** A DC motor resolved for the time loop — an inductor (L_a, R_a) carrying a
 *  speed-dependent back-EMF, with the rotor speed ω integrated alongside the circuit so
 *  it physically SPINS UP (the inrush current settling as it comes up to speed). */
type MotorElement = {
  id: string
  termA: string // terminal_positive
  termB: string // terminal_negative
  netA: string
  netB: string
  iA: number | undefined
  iB: number | undefined
  armatureInductance: number // L_a (henries)
  armatureOhms: number // R_a (ohms)
  motorConstant: number // k (V·s/rad = N·m/A)
  viscousFriction: number // B (N·m·s/rad)
  rotorInertia: number // J (kg·m²)
  loadTorque: number // T_load (N·m)
  iPrev: number // armature current at the previous step
  omega: number // rotor speed (rad/s) — the mechanical state
}

/** A DC generator (dynamo) resolved for the time loop. Spun at a fixed speed it is a constant
 *  Thévenin source (EMF E = k·ω behind R_a), so — unlike the motor — it has NO state to
 *  integrate; it stamps the same Norton every step, like a resistor with a current source. */
type GeneratorElement = {
  id: string
  termA: string // terminal_positive
  termB: string // terminal_negative
  netA: string
  netB: string
  iA: number | undefined
  iB: number | undefined
  armatureOhms: number // R_a (ohms)
  emf: number // E = k·ω (volts), constant at the fixed drive speed
}

/** One past sample of a transmission line's two ends — read back τ ago (Branin). */
type LineSample = { t: number; vN: number; iN: number; vF: number; iF: number }

/**
 * A transmission line resolved for the time loop (Branin's lossless method). Each end is
 * a resistor Z₀ carrying a source = the wave that left the OTHER end τ ago; `history`
 * holds the past (voltage, current) at both ends so the solve can read it back.
 */
type TransmissionLineElement = {
  id: string
  z0: number // characteristic impedance (Ω)
  tau: number // propagation delay (s)
  na: string // near port + terminal net
  nb: string // near port − terminal net
  fa: string // far port + terminal net
  fb: string // far port − terminal net
  iNa: number | undefined // matrix index of na (undefined ⇒ ground)
  iNb: number | undefined
  iFa: number | undefined
  iFb: number | undefined
  history: LineSample[]
}

/** A transmission line's two ends a time tTarget ago, linearly interpolated from its
 *  history. Before the line was driven (tTarget earlier than any sample) it is at rest. */
function sampleLineHistory(line: TransmissionLineElement, tTarget: number): Omit<LineSample, 't'> {
  const h = line.history
  // biome-ignore lint/style/noNonNullAssertion: indices guarded by length checks
  if (h.length === 0 || tTarget <= h[0]!.t) return { vN: 0, iN: 0, vF: 0, iF: 0 }
  for (let i = 1; i < h.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i in [1, h.length)
    const b = h[i]!
    if (b.t >= tTarget) {
      // biome-ignore lint/style/noNonNullAssertion: i ≥ 1
      const a = h[i - 1]!
      const f = b.t > a.t ? (tTarget - a.t) / (b.t - a.t) : 0
      return {
        vN: a.vN + f * (b.vN - a.vN),
        iN: a.iN + f * (b.iN - a.iN),
        vF: a.vF + f * (b.vF - a.vF),
        iF: a.iF + f * (b.iF - a.iF),
      }
    }
  }
  // biome-ignore lint/style/noNonNullAssertion: h.length ≥ 1 here
  const last = h[h.length - 1]!
  return { vN: last.vN, iN: last.iN, vF: last.vF, iF: last.iF }
}

/**
 * Stamp a transmission line's Branin companion: each end is a conductance 1/Z₀ in
 * parallel with a current source carrying the wave that left the OTHER end τ ago
 * (E_near = v_far(t−τ) + Z₀·i_far(t−τ), and the mirror). Before τ has elapsed the far
 * end has heard nothing, so its source is zero — the load stays dark until the wave lands.
 */
function stampTransmissionLineCompanion(
  line: TransmissionLineElement,
  t: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const past = sampleLineHistory(line, t - line.tau)
  const eNear = past.vF + line.z0 * past.iF
  const eFar = past.vN + line.z0 * past.iN
  const g = 1 / line.z0
  stampLinePort(line.iNa, line.iNb, g, eNear * g, M, b)
  stampLinePort(line.iFa, line.iFb, g, eFar * g, M, b)
}

function stampLinePort(
  iA: number | undefined,
  iB: number | undefined,
  g: number,
  src: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  if (iA !== undefined) {
    M.set([iA, iA], (M.get([iA, iA]) ?? 0) + g)
    b.set([iA, 0], (b.get([iA, 0]) ?? 0) + src)
  }
  if (iB !== undefined) {
    M.set([iB, iB], (M.get([iB, iB]) ?? 0) + g)
    b.set([iB, 0], (b.get([iB, 0]) ?? 0) - src)
  }
  if (iA !== undefined && iB !== undefined) {
    M.set([iA, iB], (M.get([iA, iB]) ?? 0) - g)
    M.set([iB, iA], (M.get([iB, iA]) ?? 0) - g)
  }
}

/** Commit this step's two-end (voltage, current) to a line's history — the wave that
 *  will arrive at the OTHER end τ from now. Old samples (past t−τ) are pruned. */
function recordLineSample(
  line: TransmissionLineElement,
  t: number,
  nodes: Map<string, number>,
): void {
  const vN = (nodes.get(line.na) ?? 0) - (nodes.get(line.nb) ?? 0)
  const vF = (nodes.get(line.fa) ?? 0) - (nodes.get(line.fb) ?? 0)
  const past = sampleLineHistory(line, t - line.tau)
  const iN = (vN - (past.vF + line.z0 * past.iF)) / line.z0
  const iF = (vF - (past.vN + line.z0 * past.iN)) / line.z0
  line.history.push({ t, vN, iN, vF, iF })
  while (line.history.length > 2 && (line.history[1]?.t ?? t) < t - line.tau) line.history.shift()
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

/** A vacuum diode resolved for the per-step Newton loop — the Child-Langmuir
 *  space-charge law I = perveance·V^1.5 (plate − cathode), the same {iP, iK, vGuess}
 *  shape as a junction diode but with no junction temperature (a hot cathode is
 *  assumed). */
type VacuumDiodeElement = {
  id: string
  plateNet: string
  cathodeNet: string
  iP: number | undefined
  iK: number | undefined
  perveance: number
  vGuess: number
}

function resolveSource(inst: Instance, nodeIndex: Map<string, number>): TimedSource | null {
  const dcOffset = readScalarParam(inst, 'nominal_voltage')
  if (dcOffset === undefined) return null
  const pNet = inst.connects?.find((c) => c.terminal === 'terminal_positive')?.net
  const nNet = inst.connects?.find((c) => c.terminal === 'terminal_negative')?.net
  if (pNet === undefined || nNet === undefined) return null
  const steps = readScalarParam(inst, 'staircase_steps')
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
    waveform:
      readEnumParam(inst, 'waveform') === 'square'
        ? 'square'
        : readEnumParam(inst, 'waveform') === 'sawtooth'
          ? 'sawtooth'
          : readEnumParam(inst, 'waveform') === 'staircase'
            ? 'staircase'
            : 'sine',
    ...(steps !== undefined ? { steps } : {}),
  }
}

function sourceVoltageAt(src: TimedSource, t: number): number {
  if (src.amplitude === 0) return src.dcOffset
  if (src.waveform === 'sawtooth') {
    // A rising ramp from −amplitude to +amplitude over each period, snapping back at the
    // period boundary — a CRT deflection sweep (the ramp draws the line; the snap is the retrace).
    const phase = src.frequency * t
    const frac = phase - Math.floor(phase)
    return src.dcOffset + src.amplitude * (2 * frac - 1)
  }
  if (src.waveform === 'staircase') {
    // `steps` discrete levels held across the period (−amplitude → +amplitude), centered per band —
    // a stepped vertical sweep that holds each scanline flat (no shear on a coarse raster).
    const n = Math.max(2, Math.round(src.steps ?? 8))
    const phase = src.frequency * t
    const frac = phase - Math.floor(phase)
    const level = Math.min(n - 1, Math.floor(frac * n))
    return src.dcOffset + src.amplitude * ((2 * (level + 0.5)) / n - 1)
  }
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

/**
 * A Shockley 4-layer diode in the time loop: a latching switch. When conducting it is an ordinary
 * forward diode; when blocking it is open. The latch flips BETWEEN steps off the solved voltage and
 * current (breakover turns it on, a current below the holding current turns it off) — with an RC
 * that switching is a relaxation oscillator.
 */
type ShockleyTransient = {
  inst: Instance
  diode: DiodeElement
  breakoverVoltage: number
  holdingCurrent: number
  state: ShockleyDiodeState
  // SCR only: the gate trigger (a gate current ≥ I_GT fires it, while forward-biased).
  gateNet?: string
  gateResistance?: number
  gateTriggerCurrent?: number
}

function resolveShockleyTransient(
  inst: Instance,
  nodeIndex: Map<string, number>,
  thermalV: number,
): ShockleyTransient | null {
  const diode = resolveDiode(inst, nodeIndex, thermalV)
  if (diode === null) return null
  const breakoverVoltage = readScalarParam(inst, 'breakover_voltage')
  const holdingCurrent = readScalarParam(inst, 'holding_current')
  if (breakoverVoltage === undefined || holdingCurrent === undefined) return null
  const state: ShockleyDiodeState =
    readEnumParam(inst, 'device_state') === 'conducting' ? 'conducting' : 'blocking'
  if (inst.definition !== 'scr') {
    return { inst, diode, breakoverVoltage, holdingCurrent, state }
  }
  const gateNet = inst.connects?.find((c) => c.terminal === 'gate')?.net
  const gateResistance = readScalarParam(inst, 'gate_cathode_resistance')
  const gateTriggerCurrent = readScalarParam(inst, 'gate_trigger_current')
  if (gateNet === undefined || gateResistance === undefined || gateTriggerCurrent === undefined) {
    return null
  }
  return {
    inst,
    diode,
    breakoverVoltage,
    holdingCurrent,
    state,
    gateNet,
    gateResistance,
    gateTriggerCurrent,
  }
}

/** The current through a Shockley diode this step — the forward-diode law when conducting, else 0. */
function shockleyTransientCurrent(sh: ShockleyTransient, vAcross: number): number {
  return sh.state === 'conducting'
    ? diodeCurrent(vAcross, sh.diode.saturationCurrent, sh.diode.idealityFactor, sh.diode.thermalV)
    : 0
}

/** A struck gas-discharge lamp's stiffness (S): a large conductance + a matched current source make a
 *  near-fixed maintaining-voltage drop (~0.5 Ω series) — the same fixed-drop model the DC solver uses
 *  for the arc / neon, but stampable each step without an auxiliary current. */
const GAS_DISCHARGE_CONDUCTANCE = 2

/** A gas-discharge lamp (carbon arc / neon) in the time loop: a latching discharge. Struck, it holds
 *  at its maintaining (arc) voltage; the latch flips off the solved voltage + current between steps
 *  (strike at breakover, extinguish below the holding current), so a neon across an RC becomes a
 *  relaxation oscillator and an arc on AC re-strikes each half-cycle. */
type GasDischargeTransient = {
  inst: Instance
  anodeNet: string
  cathodeNet: string
  iA: number | undefined
  iB: number | undefined
  maintainingVoltage: number
  baseVoltage: number
  ayrtonCoefficient: number
  breakoverVoltage: number
  holdingCurrent: number
  state: ShockleyDiodeState
}

function resolveGasDischargeTransient(
  inst: Instance,
  nodeIndex: Map<string, number>,
): GasDischargeTransient | null {
  const maintainingVoltage =
    readScalarParam(inst, 'arc_voltage') ?? readScalarParam(inst, 'maintaining_voltage')
  const breakoverVoltage = readScalarParam(inst, 'breakover_voltage')
  const holdingCurrent = readScalarParam(inst, 'holding_current')
  if (
    maintainingVoltage === undefined ||
    breakoverVoltage === undefined ||
    holdingCurrent === undefined
  ) {
    return null
  }
  const anodeNet = inst.connects?.find((c) => c.terminal === 'anode')?.net
  const cathodeNet = inst.connects?.find((c) => c.terminal === 'cathode')?.net
  if (anodeNet === undefined || cathodeNet === undefined) return null
  const state: ShockleyDiodeState =
    readEnumParam(inst, 'device_state') === 'conducting' ? 'conducting' : 'blocking'
  const ayrtonCoefficient = readScalarParam(inst, 'ayrton_coefficient') ?? 0
  return {
    inst,
    anodeNet,
    cathodeNet,
    iA: nodeIndex.get(anodeNet),
    iB: nodeIndex.get(cathodeNet),
    maintainingVoltage,
    baseVoltage: maintainingVoltage,
    ayrtonCoefficient,
    breakoverVoltage,
    holdingCurrent,
    state,
  }
}

/** A CRT in the time loop: the electron gun is a beam-current load anode→cathode (here a constant set
 *  by the grid-bias property), and the X/Y plates are high-impedance leak inputs. Linear — no Newton,
 *  no latch. The spot sweeps because the deflection NODE voltages move over time; the trace is read
 *  back from the series afterwards (part-readings.crtSpotTrace), as the DC spot is read post-solve. */
type CrtTransient = {
  inst: Instance
  anodeNet: string
  cathodeNet: string
  xNet: string | undefined
  yNet: string | undefined
  iAnode: number | undefined
  iCathode: number | undefined
  iX: number | undefined
  iY: number | undefined
  beamCurrent: number
}

function resolveCrtTransient(inst: Instance, nodeIndex: Map<string, number>): CrtTransient | null {
  const p = crtParamsFromInstance(inst)
  if (p === undefined) return null
  const net = (t: string) => inst.connects?.find((c) => c.terminal === t)?.net
  const anodeNet = net('anode')
  const cathodeNet = net('cathode')
  if (anodeNet === undefined || cathodeNet === undefined) return null
  const xNet = net('x_deflect')
  const yNet = net('y_deflect')
  return {
    inst,
    anodeNet,
    cathodeNet,
    xNet,
    yNet,
    iAnode: nodeIndex.get(anodeNet),
    iCathode: nodeIndex.get(cathodeNet),
    iX: xNet !== undefined ? nodeIndex.get(xNet) : undefined,
    iY: yNet !== undefined ? nodeIndex.get(yNet) : undefined,
    beamCurrent: p.beamCurrent * gridBrightness(p.gridBias, p.gridCutoffVoltage),
  }
}

/**
 * Resolve a varactor — a capacitor whose stored charge Q(V) the engine integrates implicitly
 * (capCompanion, charge-conserving) rather than freezing C at the step-start voltage. In DC it is a
 * reverse-biased diode (it blocks); the time loop is where its voltage-controlled capacitance matters.
 */
function resolveVaractor(inst: Instance, nodeIndex: Map<string, number>): CapElement | null {
  const cj0 = readScalarParam(inst, 'junction_capacitance_zero_bias')
  const vj = readScalarParam(inst, 'junction_potential')
  const m = readScalarParam(inst, 'grading_coefficient')
  if (cj0 === undefined || vj === undefined || m === undefined) return null
  if (cj0 <= 0 || vj <= 0 || m <= 0) return null
  const anode = inst.connects?.find((c) => c.terminal === 'anode')
  const cathode = inst.connects?.find((c) => c.terminal === 'cathode')
  if (anode === undefined || cathode === undefined) return null
  const vPrev = readScalarParam(inst, 'initial_voltage') ?? 0
  // Forward diffusion charge (τ_T · I_S) — negligible in reverse, the varactor's regime; transit_time
  // 0 (the default) disables it. I_S is calibrated from the forward operating point.
  // kT/q at 298.15 K — deliberately NOT threaded to the part temperature (unlike the junction
  // devices): the varactor runs reverse-biased, so V_T touches only the gated-off diffusion charge
  // above, and the junction potential's weak temperature drift has no cited law to scale by. Room-
  // temperature V_T is the honest choice here.
  const thermalV = thermalVoltage()
  const ideality = readScalarParam(inst, 'ideality_factor') ?? 1
  if (ideality <= 0) return null // n > 0; a non-positive ideality zeros n·V_T → NaN
  const transitTime = readScalarParam(inst, 'transit_time') ?? 0
  const forwardVoltage = readScalarParam(inst, 'forward_voltage')
  const maxForwardCurrent = readScalarParam(inst, 'max_forward_current')
  const saturationCurrent =
    transitTime > 0 &&
    forwardVoltage !== undefined &&
    maxForwardCurrent !== undefined &&
    forwardVoltage > 0
      ? maxForwardCurrent / (Math.exp(forwardVoltage / (ideality * thermalV)) - 1)
      : 0
  const params: VaractorParams = {
    zeroBiasCapacitance: cj0,
    junctionPotential: vj,
    gradingCoefficient: m,
    transitTime,
    saturationCurrent,
    ideality,
    thermalV,
  }
  return {
    id: inst.id,
    termA: anode.terminal,
    termB: cathode.terminal,
    netA: anode.net,
    netB: cathode.net,
    iA: nodeIndex.get(anode.net),
    iB: nodeIndex.get(cathode.net),
    capacitance: varactorCapacitance(vPrev, params),
    vPrev,
    varactor: params,
    vGuess: vPrev,
    qPrev: varactorCharge(vPrev, params),
  }
}

/**
 * Stamp a tunnel diode's companion in the time loop — its negative-resistance I-V as a conductance
 * (which may be NEGATIVE between the peak and valley) plus a current source; the same shape as the
 * DC stamp. With an LC tank this negative resistance sustains a tunnel-diode oscillator.
 */
function stampTransientTunnel(
  td: TunnelDiode,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { conductance: G, currentSource: Ieq } = tunnelDiodeCompanion(td.vGuess, td.params)
  const a = nodeIndex.get(td.anodeNet)
  const c = nodeIndex.get(td.cathodeNet)
  const Gd = G + SOLVER_GMIN
  if (a !== undefined) {
    M.set([a, a], (M.get([a, a]) ?? 0) + Gd)
    b.set([a, 0], (b.get([a, 0]) ?? 0) - Ieq)
  }
  if (c !== undefined) {
    M.set([c, c], (M.get([c, c]) ?? 0) + Gd)
    b.set([c, 0], (b.get([c, 0]) ?? 0) + Ieq)
  }
  if (a !== undefined && c !== undefined) {
    M.set([a, c], (M.get([a, c]) ?? 0) - Gd)
    M.set([c, a], (M.get([c, a]) ?? 0) - Gd)
  }
}

function resolveInductor(inst: Instance, nodeIndex: Map<string, number>): InductorElement | null {
  // An electromagnet derives L from its geometry (μ₀·μ_r·N²·A/l — one source of truth
  // with its field); a plain inductor uses its declared inductance.
  const inductance = coilInductanceFromInstance(inst)
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

function resolveMotor(inst: Instance, nodeIndex: Map<string, number>): MotorElement | null {
  // motorParamsFromInstance is mode-aware: in "design" mode L_a comes through and J is
  // derived from the rotor geometry, the same as k and R_a.
  const p = motorParamsFromInstance(inst)
  if (p === undefined) return null
  const armatureInductance = p.armatureInductance
  const rotorInertia = p.rotorInertia
  if (armatureInductance === undefined || !(armatureInductance > 0)) return null
  if (rotorInertia === undefined || !(rotorInertia > 0)) return null
  const pos = inst.connects?.find((c) => c.terminal === 'terminal_positive')
  const neg = inst.connects?.find((c) => c.terminal === 'terminal_negative')
  if (pos === undefined || neg === undefined) return null
  return {
    id: inst.id,
    termA: pos.terminal,
    termB: neg.terminal,
    netA: pos.net,
    netB: neg.net,
    iA: nodeIndex.get(pos.net),
    iB: nodeIndex.get(neg.net),
    armatureInductance,
    armatureOhms: p.armatureResistance,
    motorConstant: p.motorConstant,
    viscousFriction: p.viscousFriction,
    rotorInertia,
    loadTorque: p.loadTorque,
    iPrev: 0,
    omega: 0,
  }
}

function resolveGenerator(inst: Instance, nodeIndex: Map<string, number>): GeneratorElement | null {
  const p = generatorParamsFromInstance(inst)
  if (p === undefined) return null
  const pos = inst.connects?.find((c) => c.terminal === 'terminal_positive')
  const neg = inst.connects?.find((c) => c.terminal === 'terminal_negative')
  if (pos === undefined || neg === undefined) return null
  return {
    id: inst.id,
    termA: pos.terminal,
    termB: neg.terminal,
    netA: pos.net,
    netB: neg.net,
    iA: nodeIndex.get(pos.net),
    iB: nodeIndex.get(neg.net),
    armatureOhms: p.armatureResistance,
    emf: generatorEmf(p),
  }
}

function resolveTransmissionLine(
  inst: Instance,
  nodeIndex: Map<string, number>,
): TransmissionLineElement | null {
  const z0 = readScalarParam(inst, 'characteristic_impedance')
  const length = readScalarParam(inst, 'length')
  const velocityFactor = readScalarParam(inst, 'velocity_factor')
  if (z0 === undefined || !(z0 > 0)) return null
  if (length === undefined || velocityFactor === undefined || !(velocityFactor > 0)) return null
  const net = (terminal: string) => inst.connects?.find((c) => c.terminal === terminal)?.net
  const na = net('near_a')
  const nb = net('near_b')
  const fa = net('far_a')
  const fb = net('far_b')
  if (na === undefined || nb === undefined || fa === undefined || fb === undefined) return null
  return {
    id: inst.id,
    z0,
    tau: propagationDelayS(length, velocityFactor),
    na,
    nb,
    fa,
    fb,
    iNa: nodeIndex.get(na),
    iNb: nodeIndex.get(nb),
    iFa: nodeIndex.get(fa),
    iFb: nodeIndex.get(fb),
    history: [],
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
  if (idealityFactor <= 0) return null // n > 0; a non-positive ideality zeros n·V_T → NaN
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
  if (idealityFactor <= 0) return null // n > 0; a non-positive ideality zeros n·V_T → NaN
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

/**
 * A capacitor's backward-Euler companion {conductance, history source}. A linear cap freezes C at
 * the step-start voltage; a varactor integrates its charge Q(V) implicitly — evaluated at the
 * Newton guess vGuess, with qPrev the charge carried from the previous step (charge-conserving:
 * i = (Q(vGuess) − qPrev)/dt linearized as gEq·V − iHist).
 */
function capCompanion(cap: CapElement, dt: number): { gEq: number; iHist: number } {
  if (cap.varactor === undefined) {
    const gEq = cap.capacitance / dt
    return { gEq, iHist: gEq * cap.vPrev }
  }
  const v = cap.vGuess ?? cap.vPrev
  const gEq = varactorCapacitance(v, cap.varactor) / dt
  const iHist = gEq * v - (varactorCharge(v, cap.varactor) - (cap.qPrev ?? 0)) / dt
  return { gEq, iHist }
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
  const { gEq, iHist } = capCompanion(cap, dt)
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

/** The armature current a motor would carry this step, given the terminal voltage. The
 *  motor is an inductor (L_a) + winding resistance (R_a) driven by (V − back-EMF). */
function motorStepCurrent(motor: MotorElement, voltsAtoB: number, dt: number): number {
  const denominator = motor.armatureInductance + motor.armatureOhms * dt
  const emf = motorBackEmf(motor.motorConstant, motor.omega)
  return (dt * (voltsAtoB - emf) + motor.armatureInductance * motor.iPrev) / denominator
}

/**
 * Stamp a DC motor's backward-Euler companion. Electrically it is an inductor (L_a) in
 * series with the winding resistance R_a and the speed-dependent back-EMF E = k·ω, so it
 * is the inductor companion (conductance Δt/(L_a + R_a·Δt) + history current) with the
 * back-EMF folded into the source current as an extra −gEq·E term.
 */
function stampMotorCompanion(
  motor: MotorElement,
  dt: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const denominator = motor.armatureInductance + motor.armatureOhms * dt
  const gEq = dt / denominator
  const iHist = (motor.armatureInductance * motor.iPrev) / denominator
  const emf = motorBackEmf(motor.motorConstant, motor.omega)
  const source = iHist - gEq * emf // current source flowing netA → netB
  const { iA, iB } = motor
  if (iA !== undefined) {
    M.set([iA, iA], (M.get([iA, iA]) ?? 0) + gEq)
    b.set([iA, 0], (b.get([iA, 0]) ?? 0) - source)
  }
  if (iB !== undefined) {
    M.set([iB, iB], (M.get([iB, iB]) ?? 0) + gEq)
    b.set([iB, 0], (b.get([iB, 0]) ?? 0) + source)
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

/** Resolve a vacuum diode for the time loop — perveance from its rated operating
 *  point, plus the plate/cathode nets and their matrix indices. No temperature law:
 *  the cathode is assumed hot (space-charge limited). */
function resolveVacuumDiode(
  inst: Instance,
  nodeIndex: Map<string, number>,
): VacuumDiodeElement | null {
  const plateNet = inst.connects?.find((c) => c.terminal === 'plate')?.net
  const cathodeNet = inst.connects?.find((c) => c.terminal === 'cathode')?.net
  if (plateNet === undefined || cathodeNet === undefined) return null
  const refVoltage = readScalarParam(inst, 'reference_plate_voltage')
  const refCurrent = readScalarParam(inst, 'plate_current_at_reference')
  if (refVoltage === undefined || refCurrent === undefined) return null
  if (refVoltage <= 0 || refCurrent <= 0) return null
  return {
    id: inst.id,
    plateNet,
    cathodeNet,
    iP: nodeIndex.get(plateNet),
    iK: nodeIndex.get(cathodeNet),
    perveance: perveanceFromOperatingPoint(refCurrent, refVoltage),
    vGuess: refVoltage,
  }
}

/** Stamp a vacuum-diode Child-Langmuir companion at its plate-cathode voltage guess —
 *  the same conductance + current-source stamp shape as a junction diode. */
function stampVacuumDiodeCompanion(
  vd: VacuumDiodeElement,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { conductance: G, currentSource: iEq } = vacuumDiodeCompanion(vd.vGuess, vd.perveance)
  const { iP, iK } = vd
  const Gd = G + SOLVER_GMIN
  if (iP !== undefined) {
    M.set([iP, iP], (M.get([iP, iP]) ?? 0) + Gd)
    b.set([iP, 0], (b.get([iP, 0]) ?? 0) - iEq)
  }
  if (iK !== undefined) {
    M.set([iK, iK], (M.get([iK, iK]) ?? 0) + Gd)
    b.set([iK, 0], (b.get([iK, 0]) ?? 0) + iEq)
  }
  if (iP !== undefined && iK !== undefined) {
    M.set([iP, iK], (M.get([iP, iK]) ?? 0) - Gd)
    M.set([iK, iP], (M.get([iK, iP]) ?? 0) - Gd)
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
  const motors: MotorElement[] = []
  const generators: GeneratorElement[] = []
  const lines: TransmissionLineElement[] = []
  const transformers: TransformerElement[] = []
  const ctTransformers: CtTransformerElement[] = []
  const diodes: DiodeElement[] = []
  const tunnelDiodes: TunnelDiode[] = []
  const shockleyDiodes: ShockleyTransient[] = []
  const gasLamps: GasDischargeTransient[] = []
  const crts: CrtTransient[] = []
  const zeners: ZenerElement[] = []
  const vacuumDiodes: VacuumDiodeElement[] = []
  const triodes: TriodeElement[] = []
  const screenTubes: ScreenGridTube[] = []
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
      inst.definition === 'incandescent_bulb' ||
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
    } else if (inst.definition === 'diode_varactor') {
      const v = resolveVaractor(inst, nodeIndex)
      if (v !== null) caps.push(v)
      else warnings.push(`Skipped varactor '${inst.id}' (missing capacitance params or connects)`)
    } else if (inst.definition === 'inductor' || inst.definition === 'electromagnet') {
      const ind = resolveInductor(inst, nodeIndex)
      if (ind !== null) inductors.push(ind)
      else warnings.push(`Skipped ${inst.definition} '${inst.id}' (missing inductance or connects)`)
    } else if (inst.definition === 'dc_motor') {
      const motor = resolveMotor(inst, nodeIndex)
      if (motor !== null) motors.push(motor)
      else warnings.push(`Skipped DC motor '${inst.id}' (missing R_a / k / friction / L_a / J)`)
    } else if (inst.definition === 'generator') {
      const gen = resolveGenerator(inst, nodeIndex)
      if (gen !== null) generators.push(gen)
      else
        warnings.push(`Skipped generator '${inst.id}' (missing k / R_a / drive speed / connects)`)
    } else if (inst.definition === 'transmission_line') {
      const line = resolveTransmissionLine(inst, nodeIndex)
      if (line !== null) lines.push(line)
      else warnings.push(`Skipped transmission line '${inst.id}' (missing Z₀ / length / connects)`)
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
      const fet = resolveJfet(inst, options.temperaturesC?.get(inst.id))
      if (fet !== null) mosfets.push(fet)
      else warnings.push(`Skipped JFET '${inst.id}' (missing parameters or terminals)`)
    } else if (inst.definition === 'diode_constant_current') {
      const fet = resolveCrd(inst, options.temperaturesC?.get(inst.id))
      if (fet !== null) mosfets.push(fet)
      else
        warnings.push(
          `Skipped constant-current diode '${inst.id}' (missing parameters or terminals)`,
        )
    } else if (inst.definition === 'diode_tunnel') {
      // The injection term scales with the junction temperature (a per-part V_T); the peak/valley
      // tunneling currents keep their declared 25 °C datasheet values — no cited temp law to scale.
      const tunnelTemp = options.temperaturesC?.get(inst.id)
      const tunnelThermalV =
        tunnelTemp !== undefined ? thermalVoltage(tunnelTemp + KELVIN_OFFSET) : vT
      const td = resolveTunnelDiode(inst, tunnelThermalV)
      if (td !== null) tunnelDiodes.push(td)
      else warnings.push(`Skipped tunnel diode '${inst.id}' (missing parameters or anode/cathode)`)
    } else if (inst.definition === 'vacuum_diode') {
      const vd = resolveVacuumDiode(inst, nodeIndex)
      if (vd !== null) vacuumDiodes.push(vd)
      else warnings.push(`Skipped vacuum diode '${inst.id}' (missing rated operating point)`)
    } else if (inst.definition === 'triode') {
      const tri = resolveTriode(inst)
      if (tri !== null) triodes.push(tri)
      else warnings.push(`Skipped triode '${inst.id}' (missing μ / operating point / terminals)`)
    } else if (inst.definition === 'tetrode' || inst.definition === 'pentode') {
      const tube = resolveScreenGridTube(inst)
      if (tube !== null) screenTubes.push(tube)
      else
        warnings.push(
          `Skipped ${inst.definition} '${inst.id}' (missing μ / operating point / terminals)`,
        )
    } else if (inst.definition === 'diode_shockley') {
      const sh = resolveShockleyTransient(inst, nodeIndex, vT)
      if (sh !== null) shockleyDiodes.push(sh)
      else
        warnings.push(`Skipped Shockley diode '${inst.id}' (missing parameters or anode/cathode)`)
    } else if (inst.definition === 'scr') {
      const sh = resolveShockleyTransient(inst, nodeIndex, vT)
      if (sh !== null) shockleyDiodes.push(sh)
      else warnings.push(`Skipped SCR '${inst.id}' (missing parameters or terminals)`)
    } else if (inst.definition === 'arc_lamp' || inst.definition === 'neon_lamp') {
      const lamp = resolveGasDischargeTransient(inst, nodeIndex)
      if (lamp !== null) gasLamps.push(lamp)
      else
        warnings.push(
          `Skipped gas-discharge lamp '${inst.id}' (missing parameters or anode/cathode)`,
        )
    } else if (inst.definition === 'crt') {
      const crt = resolveCrtTransient(inst, nodeIndex)
      if (crt !== null) crts.push(crt)
      else
        warnings.push(`Skipped CRT '${inst.id}' (missing beam/deflection params or anode/cathode)`)
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
  // Standalone CCCS parts each need one aux branch (the 0 V control-current sense). They
  // sit right after the sources, so the capacitor / IC aux block shifts past them by C.
  const cccsList = [...world.instances.values()].filter(
    (inst) => inst.definition === 'cccs' && inst.connects?.length === 4,
  )
  const C = cccsList.length

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
    const size = N + S + C + extraAux
    const M = zerosMatrix(size)
    const b = zerosVector(size)

    for (const inst of world.instances.values()) {
      // A thermistor stamps as a resistor at its Beta-law resistance (written by
      // the electro-thermal loop for this temperature). A photoresistor stamps as
      // a resistor at its light-law resistance (stampResistor reads ldrResistance).
      if (
        inst.definition === 'resistor' ||
        inst.definition === 'thermistor' ||
        inst.definition === 'incandescent_bulb' ||
        inst.definition === 'photoresistor'
      )
        stampResistor(inst, nodeIndex, M)
      else if (inst.definition === 'potentiometer') stampPotentiometer(inst, nodeIndex, M)
      else if (inst.definition === 'vccs') stampVccs(inst, nodeIndex, M)
      else if (LIGHT_CURRENT_DEFINITIONS.has(inst.definition)) {
        // A photodiode / phototransistor injects its constant light-driven current.
        const [from, to] = lightCurrentTerminals(inst.definition)
        stampLightCurrentSource(inst, nodeIndex, M, b, from, to)
      }
    }
    for (let s = 0; s < S; s++) {
      // biome-ignore lint/style/noNonNullAssertion: s is bound by S
      const src = sources[s]!
      const overrideV = options.externalSourceV?.(src.id)
      stampTimedSource(src, overrideV ?? sourceVoltageAt(src, t), N + s, M, b)
    }
    // Each CCCS: its 0 V control-current sense (an aux branch at N+S+i) plus the f·I_c
    // output coupling — time-independent, so the same DC stamp serves at every step.
    for (let i = 0; i < C; i++) {
      // biome-ignore lint/style/noNonNullAssertion: i is bound by C
      stampCccs(cccsList[i]!, nodeIndex, N + S + i, M, b)
    }
    if (mode === 'initial') {
      for (let j = 0; j < caps.length; j++) {
        // biome-ignore lint/style/noNonNullAssertion: j is bound by caps.length
        const cap = caps[j]!
        stampFixedVoltage(cap.iA, cap.iB, cap.vPrev, N + S + C + j, M, b)
      }
      for (let k = 0; k < icList.length; k++) {
        // biome-ignore lint/style/noNonNullAssertion: k is bound by icList.length
        const ic = icList[k]!
        // hard-pin this net to its t = 0 initial-condition value (released for t > 0)
        stampFixedVoltage(ic.idx, undefined, ic.voltage, N + S + C + caps.length + k, M, b)
      }
      for (const ind of inductors) stampFixedCurrent(ind.iA, ind.iB, ind.iPrev, b)
      for (const motor of motors) stampFixedCurrent(motor.iA, motor.iB, motor.iPrev, b)
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
      for (const motor of motors) stampMotorCompanion(motor, dt, M, b)
      for (const tr of transformers) stampTransformerCompanion(tr, dt, M, b)
      for (const tr of ctTransformers) stampCtTransformerCompanion(tr, dt, M, b)
    }
    // Transmission lines present Z₀ at each end in BOTH modes (at t = 0 their wave-sources
    // are zero — the far end has heard nothing yet), so they stamp outside the if/else.
    for (const line of lines) stampTransmissionLineCompanion(line, t, M, b)
    // A generator spun at a fixed speed is a constant Thévenin (EMF E behind R_a): stamp its
    // Norton (g = 1/R_a, current source E/R_a out of +) every step — the same port stamp the
    // line uses — since it has no state and is identical at t = 0 and after.
    for (const gen of generators)
      stampLinePort(gen.iA, gen.iB, 1 / gen.armatureOhms, gen.emf / gen.armatureOhms, M, b)
    for (const d of diodes) stampDiodeCompanion(d, d.thermalV, M, b)
    for (const vd of vacuumDiodes) stampVacuumDiodeCompanion(vd, M, b)
    for (const tri of triodes) stampTriodeCompanion(tri, nodeIndex, M, b)
    for (const tube of screenTubes) stampScreenGridTubeCompanion(tube, nodeIndex, M, b)
    for (const td of tunnelDiodes) stampTransientTunnel(td, nodeIndex, M, b)
    for (const lamp of gasLamps)
      if (lamp.state === 'conducting')
        stampLinePort(
          lamp.iA,
          lamp.iB,
          GAS_DISCHARGE_CONDUCTANCE,
          GAS_DISCHARGE_CONDUCTANCE * lamp.maintainingVoltage,
          M,
          b,
        )
    for (const crt of crts) {
      const gLeak = 1 / CRT_DEFLECTION_INPUT_OHMS
      if (crt.iX !== undefined) stampLinePort(crt.iX, crt.iCathode, gLeak, 0, M, b)
      if (crt.iY !== undefined) stampLinePort(crt.iY, crt.iCathode, gLeak, 0, M, b)
      stampFixedCurrent(crt.iAnode, crt.iCathode, crt.beamCurrent, b)
    }
    for (const sh of shockleyDiodes) {
      if (sh.state === 'conducting') stampDiodeCompanion(sh.diode, sh.diode.thermalV, M, b)
      // An SCR's gate-cathode resistance is always present (the gate current path).
      if (sh.gateResistance !== undefined && sh.gateResistance > 0 && sh.gateNet !== undefined)
        stampConductance(nodeIndex, M, sh.gateNet, sh.diode.cathodeNet, sh.gateResistance)
    }
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
      for (const td of tunnelDiodes) {
        const vA = td.anodeNet === ground ? 0 : (nodes.get(td.anodeNet) ?? 0)
        const vC = td.cathodeNet === ground ? 0 : (nodes.get(td.cathodeNet) ?? 0)
        const next = limitTunnelDiodeStep(vA - vC, td.vGuess)
        maxDelta = Math.max(maxDelta, Math.abs(next - td.vGuess))
        if (next !== vA - vC) anyLimited = true
        td.vGuess = next
      }
      for (const vd of vacuumDiodes) {
        const vP = vd.plateNet === ground ? 0 : (nodes.get(vd.plateNet) ?? 0)
        const vK = vd.cathodeNet === ground ? 0 : (nodes.get(vd.cathodeNet) ?? 0)
        const next = limitVacuumStep(vP - vK, vd.vGuess)
        maxDelta = Math.max(maxDelta, Math.abs(next - vd.vGuess))
        if (next !== vP - vK) anyLimited = true
        vd.vGuess = next
      }
      for (const tri of triodes) {
        const vP = tri.plateNet === ground ? 0 : (nodes.get(tri.plateNet) ?? 0)
        const vG = tri.gridNet === ground ? 0 : (nodes.get(tri.gridNet) ?? 0)
        const vK = tri.cathodeNet === ground ? 0 : (nodes.get(tri.cathodeNet) ?? 0)
        const nextVGK = limitVacuumStep(vG - vK, tri.vGK)
        const nextVPK = limitVacuumStep(vP - vK, tri.vPK)
        maxDelta = Math.max(maxDelta, Math.abs(nextVGK - tri.vGK), Math.abs(nextVPK - tri.vPK))
        if (nextVGK !== vG - vK || nextVPK !== vP - vK) anyLimited = true
        tri.vGK = nextVGK
        tri.vPK = nextVPK
      }
      for (const tube of screenTubes) {
        const vP = tube.plateNet === ground ? 0 : (nodes.get(tube.plateNet) ?? 0)
        const vG1 = tube.gridNet === ground ? 0 : (nodes.get(tube.gridNet) ?? 0)
        const vG2 = tube.screenNet === ground ? 0 : (nodes.get(tube.screenNet) ?? 0)
        const vK = tube.cathodeNet === ground ? 0 : (nodes.get(tube.cathodeNet) ?? 0)
        const nG1 = limitVacuumStep(vG1 - vK, tube.vG1K)
        const nG2 = limitVacuumStep(vG2 - vK, tube.vG2K)
        const nP = limitVacuumStep(vP - vK, tube.vPK)
        maxDelta = Math.max(
          maxDelta,
          Math.abs(nG1 - tube.vG1K),
          Math.abs(nG2 - tube.vG2K),
          Math.abs(nP - tube.vPK),
        )
        if (nG1 !== vG1 - vK || nG2 !== vG2 - vK || nP !== vP - vK) anyLimited = true
        tube.vG1K = nG1
        tube.vG2K = nG2
        tube.vPK = nP
      }
      for (const sh of shockleyDiodes) {
        if (sh.state !== 'conducting') continue
        const d = sh.diode
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
      for (const cap of caps) {
        if (cap.varactor === undefined) continue
        const vA = cap.netA === ground ? 0 : (nodes.get(cap.netA) ?? 0)
        const vC = cap.netB === ground ? 0 : (nodes.get(cap.netB) ?? 0)
        const next = vA - vC
        maxDelta = Math.max(maxDelta, Math.abs(next - (cap.vGuess ?? cap.vPrev)))
        cap.vGuess = next
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

    // Dependent sources: a VCCS sources g·V_control out of output_positive; a CCCS sources
    // f·I_c, where I_c is its sense aux current at N+S+i.
    for (const inst of world.instances.values()) {
      if (inst.definition !== 'vccs') continue
      const g = readScalarParam(inst, 'transconductance')
      const cp = inst.connects?.find((c) => c.terminal === 'control_positive')?.net
      const cn = inst.connects?.find((c) => c.terminal === 'control_negative')?.net
      if (g !== undefined && cp !== undefined && cn !== undefined)
        through(inst.id, 'output_positive', 'output_negative', g * (volts(cp) - volts(cn)))
    }
    for (let i = 0; i < C; i++) {
      // biome-ignore lint/style/noNonNullAssertion: i is bound by C
      const cccs = cccsList[i]!
      const iAux = x[N + S + i]?.[0] ?? 0
      through(cccs.id, 'control_positive', 'control_negative', iAux)
      through(
        cccs.id,
        'output_positive',
        'output_negative',
        (readScalarParam(cccs, 'current_gain') ?? 0) * iAux,
      )
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
        through(cap.id, cap.termA, cap.termB, x[N + S + C + j]?.[0] ?? 0)
      } else {
        // The backward-Euler companion's current at this step, from the OLD
        // history (vPrev is updated only after recording).
        const { gEq, iHist } = capCompanion(cap, dt)
        const v = volts(cap.netA) - volts(cap.netB)
        through(cap.id, cap.termA, cap.termB, gEq * v - iHist)
      }
    }

    for (const ind of inductors) {
      const amps =
        mode === 'initial'
          ? ind.iPrev // held: current through an inductor cannot jump
          : inductorStepCurrent(ind, volts(ind.netA) - volts(ind.netB), dt)
      through(ind.id, ind.termA, ind.termB, amps)
    }

    for (const motor of motors) {
      const amps =
        mode === 'initial'
          ? motor.iPrev // the armature inductance holds the current — no jump at switch-on
          : motorStepCurrent(motor, volts(motor.netA) - volts(motor.netB), dt)
      through(motor.id, motor.termA, motor.termB, amps)
    }

    for (const gen of generators) {
      // Delivered current I = (E − V_terminal)/R_a — the same in both modes (no state).
      const v = volts(gen.netA) - volts(gen.netB)
      through(gen.id, gen.termA, gen.termB, (gen.emf - v) / gen.armatureOhms)
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
    for (const td of tunnelDiodes) {
      const v = volts(td.anodeNet) - volts(td.cathodeNet)
      through(td.inst.id, 'anode', 'cathode', tunnelDiodeCurrent(v, td.params))
    }
    for (const vd of vacuumDiodes) {
      const v = volts(vd.plateNet) - volts(vd.cathodeNet)
      through(vd.id, 'plate', 'cathode', childLangmuirCurrent(v, vd.perveance))
    }
    for (const tri of triodes) {
      const vPK = volts(tri.plateNet) - volts(tri.cathodeNet)
      const vGK = volts(tri.gridNet) - volts(tri.cathodeNet)
      const { plateCurrent } = gridTubeOperatingPoint(vPK, vGK, tri.perveance, tri.mu)
      into.set(`${tri.inst.id}/plate`, plateCurrent)
      into.set(`${tri.inst.id}/cathode`, -plateCurrent)
      into.set(`${tri.inst.id}/grid`, 0) // the grid draws no current in normal operation
    }
    for (const tube of screenTubes) {
      const vPK = volts(tube.plateNet) - volts(tube.cathodeNet)
      const vG1K = volts(tube.gridNet) - volts(tube.cathodeNet)
      const vG2K = volts(tube.screenNet) - volts(tube.cathodeNet)
      const { plateCurrent } = screenGridTubeOperatingPoint(
        vPK,
        vG1K,
        vG2K,
        tube.perveance,
        tube.screenMu,
        tube.plateMu,
      )
      into.set(`${tube.inst.id}/plate`, plateCurrent)
      into.set(`${tube.inst.id}/cathode`, -plateCurrent)
      into.set(`${tube.inst.id}/grid`, 0) // both grids draw no current in this first rung
      into.set(`${tube.inst.id}/screen_grid`, 0)
    }
    for (const sh of shockleyDiodes) {
      const v = volts(sh.diode.anodeNet) - volts(sh.diode.cathodeNet)
      through(sh.inst.id, 'anode', 'cathode', shockleyTransientCurrent(sh, v))
    }
    for (const lamp of gasLamps) {
      const v = volts(lamp.anodeNet) - volts(lamp.cathodeNet)
      const current =
        lamp.state === 'conducting' ? GAS_DISCHARGE_CONDUCTANCE * (v - lamp.maintainingVoltage) : 0
      through(lamp.inst.id, 'anode', 'cathode', current)
    }
    for (const crt of crts) {
      // Beam current anode→cathode + the tiny X/Y leak currents; the four sum to zero (device KCL).
      const vX = (crt.xNet !== undefined ? volts(crt.xNet) : 0) - volts(crt.cathodeNet)
      const vY = (crt.yNet !== undefined ? volts(crt.yNet) : 0) - volts(crt.cathodeNet)
      const iX = crt.xNet !== undefined ? vX / CRT_DEFLECTION_INPUT_OHMS : 0
      const iY = crt.yNet !== undefined ? vY / CRT_DEFLECTION_INPUT_OHMS : 0
      into.set(`${crt.inst.id}/anode`, crt.beamCurrent)
      if (crt.xNet !== undefined) into.set(`${crt.inst.id}/x_deflect`, iX)
      if (crt.yNet !== undefined) into.set(`${crt.inst.id}/y_deflect`, iY)
      into.set(`${crt.inst.id}/cathode`, -(crt.beamCurrent + iX + iY))
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
      into.set(`${fet.inst.id}/gate`, 0) // no gate current in Level-1: a MOSFET's insulated gate, a JFET/CRD's reverse-biased junction
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
    for (const td of tunnelDiodes) td.vGuess = at(td.anodeNet) - at(td.cathodeNet)
    for (const vd of vacuumDiodes) vd.vGuess = at(vd.plateNet) - at(vd.cathodeNet)
    for (const tri of triodes) {
      tri.vGK = at(tri.gridNet) - at(tri.cathodeNet)
      tri.vPK = at(tri.plateNet) - at(tri.cathodeNet)
    }
    for (const tube of screenTubes) {
      tube.vG1K = at(tube.gridNet) - at(tube.cathodeNet)
      tube.vG2K = at(tube.screenNet) - at(tube.cathodeNet)
      tube.vPK = at(tube.plateNet) - at(tube.cathodeNet)
    }
    // Only seed a CONDUCTING latch from the DC point; a blocking one keeps its safe off-guess (0),
    // so when it breaks over the Newton walk starts low and pnjlim climbs without overflowing.
    for (const sh of shockleyDiodes)
      if (sh.state === 'conducting')
        sh.diode.vGuess = at(sh.diode.anodeNet) - at(sh.diode.cathodeNet)
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
    for (const cap of caps) {
      if (cap.varactor !== undefined) cap.vGuess = at(cap.netA) - at(cap.netB)
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
  for (const line of lines) recordLineSample(line, 0, initial.nodes)

  // March forward with backward-Euler. Each step: converge the nonlinear solve
  // (warm-started from the previous operating point), record the sample WITH
  // its per-terminal currents (computed from the still-old histories), then
  // refresh the companion histories.
  const steps = Math.round(duration / dt)
  for (let k = 1; k <= steps; k++) {
    const t = k * dt
    options.onStepBegin?.(k, t, series[series.length - 1]?.nodes ?? new Map<string, number>())
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
      if (cap.varactor !== undefined) {
        cap.qPrev = varactorCharge(cap.vPrev, cap.varactor)
        cap.vGuess = cap.vPrev
      }
    }
    for (const sh of shockleyDiodes) {
      // The latch flips off this step's solved voltage / current, taking effect next step: breakover
      // (or, for an SCR, a forward gate trigger) turns it on; a current below the holding current
      // turns it off. With an RC that switching is a relaxation oscillator; an SCR fires from its gate.
      const v = (nodes.get(sh.diode.anodeNet) ?? 0) - (nodes.get(sh.diode.cathodeNet) ?? 0)
      const i = shockleyTransientCurrent(sh, v)
      if (
        sh.gateResistance !== undefined &&
        sh.gateNet !== undefined &&
        sh.gateTriggerCurrent !== undefined
      ) {
        const gateCurrent =
          sh.gateResistance > 0
            ? ((nodes.get(sh.gateNet) ?? 0) - (nodes.get(sh.diode.cathodeNet) ?? 0)) /
              sh.gateResistance
            : 0
        sh.state = scrTarget(
          sh.state,
          v,
          i,
          gateCurrent,
          sh.breakoverVoltage,
          sh.holdingCurrent,
          sh.gateTriggerCurrent,
        )
      } else {
        sh.state = shockleyDiodeTarget(sh.state, v, i, sh.breakoverVoltage, sh.holdingCurrent)
      }
    }
    for (const lamp of gasLamps) {
      // The discharge latch flips off this step's voltage + current: strike at breakover, extinguish
      // below the holding current. With an RC (neon) that switching is a relaxation oscillator; on AC
      // (arc) it re-strikes each half-cycle.
      const v = (nodes.get(lamp.anodeNet) ?? 0) - (nodes.get(lamp.cathodeNet) ?? 0)
      const i =
        lamp.state === 'conducting' ? GAS_DISCHARGE_CONDUCTANCE * (v - lamp.maintainingVoltage) : 0
      lamp.state = shockleyDiodeTarget(lamp.state, v, i, lamp.breakoverVoltage, lamp.holdingCurrent)
      // A carbon arc (a positive ayrton_coefficient) FALLS as it burns harder: relax its maintaining
      // voltage to V_min + B/I off this step's current for the next step (the time step damps it).
      if (lamp.ayrtonCoefficient > 0 && lamp.state === 'conducting') {
        lamp.maintainingVoltage = ayrtonArcVoltage(
          lamp.baseVoltage,
          lamp.ayrtonCoefficient,
          i,
          lamp.holdingCurrent,
        )
      }
    }
    for (const ind of inductors) {
      // The converged step's current through the inductor — the value just
      // recorded (computed from the OLD iPrev), now becoming the history.
      ind.iPrev = currents.get(`${ind.id}/${ind.termA}`) ?? ind.iPrev
    }
    for (const motor of motors) {
      // Commit this step's armature current, then advance the rotor: the current makes a
      // torque k·I that, against inertia J and friction B, ramps the speed ω. The rising
      // ω raises the back-EMF next step, which is what tapers the inrush current.
      const amps = currents.get(`${motor.id}/${motor.termA}`) ?? motor.iPrev
      motor.omega = motorSpeedStep(
        motor.omega,
        amps,
        motor.motorConstant,
        motor.viscousFriction,
        motor.rotorInertia,
        motor.loadTorque,
        dt,
      )
      motor.iPrev = amps
    }
    for (const line of lines) recordLineSample(line, t, nodes)
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
