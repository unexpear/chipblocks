/**
 * DC solver — Modified Nodal Analysis + Newton-Raphson for the steady-state operating point.
 *
 * Per OBJECT-MODEL.md §18 / §20. A single linear MNA solve (via dense-linear.ts) when the circuit is
 * purely linear; otherwise a Newton-Raphson loop with SPICE-style pnjlim / step limiting around each
 * device's companion model, to convergence. Handles: resistors, voltage sources, wires, switches
 * (SPST + SPDT), fuses, relays (coil + contacts), inductors and transformers (0 V sources at DC — no
 * coupling), potentiometers, light-driven sensors (thermistor / photoresistor / photodiode /
 * phototransistor), and the full nonlinear device set — diodes (LED / rectifier / Schottky / laser /
 * varactor), zeners (forward + reverse breakdown), tunnel diodes (negative resistance), the Shockley
 * latch + SCR, BJTs (Ebers-Moll), and MOSFETs / JFETs / constant-current diodes (square law). With a
 * per-instance junction temperature (the electro-thermal loop) each junction solves at V_T = kT/q and
 * the SPICE I_S(T) / mobility laws.
 *
 * Honesty (the "real all the way down" principle): the solver never fakes a pass. An unmodeled
 * definition surfaces 'unsupported-element' (not a silent wrong 'solved'); a circuit with no ground
 * net returns 'no-ground' without solving; a non-converging nonlinear circuit returns
 * 'did-not-converge'. The Solution carries warnings, branch currents, and the iteration count.
 *
 * Sign convention (§18.6): positive branch current flows from the positive terminal (anode /
 * terminal_positive / terminal_a / terminal_in) toward the negative.
 */

import { type BjtParams, bjtCompanion, bjtCurrents } from './bjt-model.ts'
import type { Instance, Net, World } from './cross-fk-validator.ts'
import { CRT_DEFLECTION_INPUT_OHMS, crtParamsFromInstance, gridBrightness } from './crt-model.ts'
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
import { jfetMosfetParams } from './jfet-model.ts'
import { ldrResistance, lightSensorCurrent } from './light.ts'
import { limitMosfetStep, type MosfetParams, mosfetOperatingPoint } from './mosfet-model.ts'
import {
  generatorEmf,
  generatorOperatingPoint,
  generatorParamsFromInstance,
  motorEffectiveResistance,
  motorLoadCurrentOffset,
  motorParamsFromInstance,
  motorSteadyState,
} from './motor-model.ts'
import { STANDARD_AMBIENT_C } from './thermal-model.ts'
import {
  limitTunnelDiodeStep,
  type TunnelDiodeParams,
  tunnelDiodeCompanion,
  tunnelDiodeCurrent,
  tunnelDiodeSaturationCurrent,
} from './tunnel-diode-model.ts'
import {
  childLangmuirCurrent,
  gridTubeOperatingPoint,
  limitVacuumStep,
  perveanceFromOperatingPoint,
  screenGridTubeOperatingPoint,
  vacuumDiodeCompanion,
} from './vacuum-tube-model.ts'

/**
 * A switch conducts only when closed. State lives on the instance as
 * `state: open|closed` (a runtime/canvas concern per the switches_circuit
 * behavior); absent state defaults to closed, so existing fixtures + the loaded
 * anchor circuit keep conducting. An OPEN switch is simply not stamped — its two
 * terminals stay on separate nets, i.e. a real open circuit.
 */
export function switchIsClosed(inst: Instance): boolean {
  return readEnumParam(inst, 'state') !== 'open'
}

/**
 * A fuse conducts while INTACT and is an open circuit once BLOWN. State lives on
 * the instance as `state: intact|blown`; absent state defaults to intact (a fresh
 * fuse conducts). A blown fuse is simply not stamped — its terminals stay on
 * separate nets, a real open circuit, exactly like an open switch. The blow
 * itself (intact → blown on overcurrent) is a canvas-level state change driven by
 * the solved current, not something the solver does mid-solve.
 */
export function fuseIsIntact(inst: Instance): boolean {
  return readEnumParam(inst, 'state') !== 'blown'
}

/**
 * Is a relay's coil energized? Its `coil_state` (energized|de_energized) is a
 * canvas-level state the relay loop sets from the solved coil voltage; absent
 * defaults to de_energized (a relay at rest). Energized routes the common
 * contact to normally_open, de-energized to normally_closed.
 */
export function relayCoilEnergized(inst: Instance): boolean {
  return readEnumParam(inst, 'coil_state') === 'energized'
}

/** Newton-Raphson controls (§20.6). */
const NR_MAX_ITERATIONS = 100
const NR_VOLTAGE_TOLERANCE = 1e-6 // volts
/** The SPICE GMIN scale (1 pS) — a tiny node-to-ground conductance that keeps the
 *  matrix solvable around hard-off junctions. Same scale as the MOSFET cutoff. */
export const SOLVER_GMIN = 1e-12
const DEFAULT_IDEALITY_FACTOR = 2.0 // LEDs (§20.2); optional per-instance override

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export type SolveOptions = {
  /** Explicit ground net id; overrides type: ground auto-detection. */
  ground?: string
  /** Newton-Raphson iteration cap (default 100). Lower values let tests
   *  exercise the did-not-converge path deterministically. */
  maxIterations?: number
  /**
   * Per-instance junction temperatures (°C) from the electro-thermal loop.
   * A listed LED/BJT solves at its real junction temperature — V_T = kT/q and
   * the SPICE I_S(T) law — which is what makes a warm diode's forward voltage
   * fall ≈2 mV/°C. Absent (the default): 298.15 K (25 °C) behavior, unchanged.
   */
  temperaturesC?: Map<string, number>
  /**
   * A node-voltage starting guess (net id → volts) — SPICE's .nodeset. Seeds the
   * nonlinear devices' junction/terminal voltages so Newton-Raphson starts near
   * the answer. Used by the pseudo-transient fallback (pseudo-transient.ts) to make
   * a hard circuit's final solve converge instantly; harmless on easy circuits.
   */
  initialNodes?: Map<string, number>
}

export type SolutionStatus =
  | 'solved'
  | 'no-ground'
  | 'singular-matrix'
  | 'unsupported-element'
  | 'numerical-error'
  | 'did-not-converge'

export type Solution = {
  status: SolutionStatus
  /** Net id → voltage relative to ground, in volts. */
  nodes: Map<string, number>
  /**
   * Instance id → current through that branch, in amperes.
   * Sign convention: positive flows from terminal_positive / anode / terminal_a
   * toward terminal_negative / cathode / terminal_b.
   */
  branches: Map<string, number>
  /** The net id chosen as ground reference; undefined when status === 'no-ground'. */
  ground: string | undefined
  /** Non-fatal observations (multiple grounds, unsupported elements skipped, etc.). */
  warnings: string[]
  /** Newton-Raphson iteration count (§20.6). 1 for the linear fast-path. */
  iterations: number
  /** Whether the nonlinear solve converged. Always true for linear circuits. */
  converged: boolean
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * An LED resolved to the Shockley nonlinear model (§20). Only LEDs with both
 * forward_voltage and max_forward_current (the I_s calibration point) qualify;
 * LEDs with forward_voltage only fall back to the fixed-V_F linear stamp.
 */
export type ShockleyLed = {
  inst: Instance
  anodeNet: string
  cathodeNet: string
  saturationCurrent: number
  idealityFactor: number
  /** kT/q at this junction's temperature (the global 298.15 K / 25 °C value by default). */
  thermalV: number
  /** Current Newton-Raphson voltage guess (anode − cathode). */
  vGuess: number
}

/**
 * A vacuum diode (Fleming valve) resolved for the Newton-Raphson solve. It conducts by
 * the Child-Langmuir space-charge law I = perveance·V^1.5 (V = plate − cathode > 0; ~0
 * in reverse, so it rectifies). Perveance is derived from a rated operating point; the
 * cathode is assumed hot (space-charge limited, not emission limited).
 */
export type VacuumDiode = {
  inst: Instance
  plateNet: string
  cathodeNet: string
  perveance: number
  /** Current Newton-Raphson voltage guess (plate − cathode). */
  vGuess: number
}

/**
 * A triode resolved for the Newton-Raphson solve. A 3-terminal grid tube: the grid
 * (drawing ~no current, like a FET gate) modulates the plate current through the
 * effective voltage V_g + V_p/μ, giving the Child-Langmuir plate current and the
 * transconductance companion (g_m grid→plate, g_p plate→cathode) — the same shape as
 * a MOSFET's, with grid/plate/cathode in place of gate/drain/source.
 */
export type TriodeElement = {
  inst: Instance
  plateNet: string
  gridNet: string
  cathodeNet: string
  perveance: number
  /** Amplification factor μ — the grid is μ× more effective than the plate. */
  mu: number
  /** Current NR bias guesses (volts): grid−cathode and plate−cathode. */
  vGK: number
  vPK: number
}

/**
 * A screen-grid tube (tetrode or pentode) resolved for the Newton-Raphson solve. A
 * second grid (the screen, held positive) shields the control grid from the plate, so
 * the plate current is set by the control grid + screen and is nearly independent of
 * the plate voltage — the flat characteristic. Solved as a transconductance device
 * with THREE control voltages (g_m control-grid, g_screen screen-grid, g_p plate). A
 * pentode reuses this (its suppressor grid is inert in the idealized model).
 */
export type ScreenGridTube = {
  inst: Instance
  plateNet: string
  gridNet: string
  screenNet: string
  cathodeNet: string
  perveance: number
  /** Control-grid-to-screen μ (the main control) and control-grid-to-plate μ (large). */
  screenMu: number
  plateMu: number
  /** Current NR bias guesses (volts): g1−cathode, g2−cathode, plate−cathode. */
  vG1K: number
  vG2K: number
  vPK: number
}

/**
 * A tunnel (Esaki) diode resolved for the Newton-Raphson solve. Its companion conductance goes
 * NEGATIVE in the V_P..V_V region, so it is solved with a tight per-iteration voltage-step clamp.
 */
export type TunnelDiode = {
  inst: Instance
  anodeNet: string
  cathodeNet: string
  params: TunnelDiodeParams
  vGuess: number
}

/**
 * A Zener resolved for the Newton-Raphson solve — the Shockley forward
 * parameters plus the reverse-breakdown branch (V_Z + the breakdown reference
 * current + its ideality). Run through zenerCompanionModel each iteration.
 */
type ZenerElement = {
  inst: Instance
  anodeNet: string
  cathodeNet: string
  saturationCurrent: number
  idealityFactor: number
  thermalV: number
  zenerVoltage: number
  breakdownCurrent: number
  breakdownIdeality: number
  vGuess: number
}

/** The pn-junction family the DC solver runs through the Shockley + NR path. */
const SHOCKLEY_DIODE_DEFINITIONS = new Set([
  'led',
  'led_uv_algan',
  'diode_laser',
  'diode_silicon_rectifier',
  'diode_schottky_al_si',
  'diode_varactor',
])

/**
 * Every device definition the DC solver knows how to handle — either it stamps the device, or the
 * device is legitimately inert at DC (a capacitor is an open circuit; ground is just a net marker).
 * An instance whose definition is NOT in this set is unmodeled: solveDC reports 'unsupported-element'
 * with a warning naming it, rather than silently treating it as an open circuit and reporting a
 * maybe-wrong 'solved'. Keep in sync with the dispatch below; the test suite (which solves real
 * circuits and expects 'solved') guards against this set drifting out of date.
 */
/** A transmission line's near-short at DC (a lossless line is a pass-through: v_near =
 *  v_far). Small enough to be a short, large enough to stay well-conditioned. */
const TLINE_DC_OHMS = 1e-4
const DC_SUPPORTED_DEFINITIONS: ReadonlySet<string> = new Set([
  ...SHOCKLEY_DIODE_DEFINITIONS,
  // Light-current sensors (LIGHT_CURRENT_DEFINITIONS, defined later in this file).
  'photodiode',
  'phototransistor',
  // Transistors.
  'transistor_bjt_npn',
  'transistor_bjt_pnp',
  'transistor_mosfet_nmos',
  'transistor_mosfet_pmos',
  'transistor_jfet_n_channel',
  'transistor_jfet_p_channel',
  // Other nonlinear / latching devices.
  'diode_constant_current',
  'diode_tunnel',
  'diode_shockley',
  'scr',
  'arc_lamp',
  'neon_lamp',
  'diode_zener_silicon',
  // Vacuum tubes (thermionic).
  'vacuum_diode',
  'triode',
  'tetrode',
  'pentode',
  // Magnetics, switches, protection.
  'transformer',
  'transformer_center_tapped',
  'switch_spdt',
  'switch_spst_toggle',
  'switch_spst_momentary',
  'relay',
  'fuse',
  // Linear / passive.
  'power_source',
  'wire',
  'inductor',
  'electromagnet',
  'dc_motor',
  'generator',
  'induction_motor',
  'crt',
  'transmission_line',
  'resistor',
  'thermistor',
  'incandescent_bulb',
  'photoresistor',
  'potentiometer',
  // Legitimately produce no DC stamp (not unsupported):
  'capacitor', // an open circuit at DC
  'ground', // the reference-node marker — defines a net, no device to stamp
  'light_source', // environmental (no electrical terminals)
])

export function solveDC(world: World, options?: SolveOptions): Solution {
  const warnings: string[] = []

  const ground = identifyGround(world, options, warnings)
  if (ground === undefined) {
    return emptyResult('no-ground', undefined, warnings)
  }

  // Honesty check: surface any instance whose definition the solver doesn't model, instead of
  // silently dropping it as an open circuit and reporting a maybe-wrong 'solved'. The supported part
  // of the circuit is still solved; the status flags that an element was skipped.
  let hasUnsupported = false
  for (const inst of world.instances.values()) {
    // Only primitive devices are circuit elements the solver stamps; interface / material instances
    // (a solder joint, a material sample) are catalog metadata, legitimately not stamped.
    if (inst.kind_ref !== 'primitive_device') continue
    if (!DC_SUPPORTED_DEFINITIONS.has(inst.definition)) {
      warnings.push(
        `Unsupported element '${inst.id}' (${inst.definition}) — not modeled; treated as an open circuit`,
      )
      hasUnsupported = true
    }
  }

  const nodeIndex = assignNodeIndices(world.nets, ground)
  const N = nodeIndex.size

  // A circuit with only the ground net has no unknowns — return trivially.
  if (N === 0) {
    return {
      status: hasUnsupported ? 'unsupported-element' : 'solved',
      nodes: new Map([[ground, 0]]),
      branches: new Map(),
      ground,
      warnings,
      iterations: 1,
      converged: true,
    }
  }

  const thermalV = thermalVoltage()

  // Pre-pass: classify instances.
  //  - linearVoltageSources get an auxiliary current variable (power source,
  //    switch, wire, and fixed-V_F LEDs that lack calibration data).
  //  - shockleyLeds are nonlinear companion-model elements (no aux variable);
  //    they need the Newton-Raphson loop.
  type VsLikeKind =
    | 'power_source'
    | 'led'
    | 'switch'
    | 'switch_spdt'
    | 'relay_coil'
    | 'relay_contact'
    | 'fuse'
    | 'wire'
    | 'inductor'
    | 'transformer_primary'
    | 'transformer_secondary'
    | 'transformer_ct_half_a'
    | 'transformer_ct_half_b'
    | 'arc'
  const linearVoltageSources: Array<{ inst: Instance; kind: VsLikeKind }> = []
  const shockleyLeds: ShockleyLed[] = []
  const tunnelDiodes: TunnelDiode[] = []
  const bjts: BjtElement[] = []
  const mosfets: MosfetElement[] = []
  const zeners: ZenerElement[] = []
  const vacuumDiodes: VacuumDiode[] = []
  const triodes: TriodeElement[] = []
  const screenTubes: ScreenGridTube[] = []

  for (const inst of world.instances.values()) {
    if (inst.definition === 'transistor_bjt_npn' || inst.definition === 'transistor_bjt_pnp') {
      const bjt = resolveBjt(inst, options?.temperaturesC?.get(inst.id))
      if (bjt !== null) bjts.push(bjt)
      continue
    }
    if (
      inst.definition === 'transistor_mosfet_nmos' ||
      inst.definition === 'transistor_mosfet_pmos'
    ) {
      const fet = resolveMosfet(inst, options?.temperaturesC?.get(inst.id))
      if (fet !== null) mosfets.push(fet)
      continue
    }
    if (
      inst.definition === 'transistor_jfet_n_channel' ||
      inst.definition === 'transistor_jfet_p_channel'
    ) {
      const fet = resolveJfet(inst, options?.temperaturesC?.get(inst.id))
      if (fet !== null) mosfets.push(fet)
      continue
    }
    if (inst.definition === 'diode_constant_current') {
      const fet = resolveCrd(inst, options?.temperaturesC?.get(inst.id))
      if (fet !== null) mosfets.push(fet)
      continue
    }
    if (inst.definition === 'triode') {
      // A 3-terminal grid tube — the grid controls the plate current (transconductance),
      // the same companion shape as a MOSFET (gridTubeOperatingPoint).
      const tri = resolveTriode(inst)
      if (tri !== null) triodes.push(tri)
      else warnings.push(`Skipped triode '${inst.id}' (missing μ / operating point / terminals)`)
      continue
    }
    if (inst.definition === 'tetrode' || inst.definition === 'pentode') {
      // A screen-grid tube — the screen shields the plate (flat characteristic). A
      // pentode adds a suppressor grid that removes the tetrode kink; in the idealized
      // (kink-free) model the two share one resolver (the suppressor is inert).
      const tube = resolveScreenGridTube(inst)
      if (tube !== null) screenTubes.push(tube)
      else
        warnings.push(
          `Skipped ${inst.definition} '${inst.id}' (missing μ / operating point / terminals)`,
        )
      continue
    }
    if (inst.definition === 'transformer') {
      // At steady DC nothing couples (di/dt = 0) — each winding is a 0 V source
      // through its winding resistance. Secondary pushed first so the primary's
      // aux current is the one reported as the instance's branch current.
      if (inst.connects?.length === 4) {
        linearVoltageSources.push({ inst, kind: 'transformer_secondary' })
        linearVoltageSources.push({ inst, kind: 'transformer_primary' })
      }
      continue
    }
    if (inst.definition === 'transformer_center_tapped') {
      // Three windings (two primary halves + secondary), each a 0 V source
      // through its share of winding resistance. Half-a pushed last → reported.
      if (inst.connects?.length === 5) {
        linearVoltageSources.push({ inst, kind: 'transformer_secondary' })
        linearVoltageSources.push({ inst, kind: 'transformer_ct_half_b' })
        linearVoltageSources.push({ inst, kind: 'transformer_ct_half_a' })
      }
      continue
    }
    if (inst.definition === 'switch_spdt') {
      // Selector (common + two throws): the selected common→throw pair stamps as
      // a closed switch (below). Stamp whenever common AND the SELECTED throw are
      // wired — NOT only when all three terminals are, because an SPDT is often
      // used as a plain on/off (common + one throw, the other left open), exactly
      // the way a relay leaves an unused contact open.
      const throwTerminal = readEnumParam(inst, 'position') === 'throw_b' ? 'throw_b' : 'throw_a'
      const wired = (t: string) => inst.connects?.some((c) => c.terminal === t) ?? false
      if (wired('common') && wired(throwTerminal)) {
        linearVoltageSources.push({ inst, kind: 'switch_spdt' })
      }
      continue
    }
    if (inst.definition === 'relay') {
      // Coil + SPDT contacts, stamped INDEPENDENTLY of each other: the coil (a
      // resistor across coil_a/coil_b) whenever both coil leads are wired, and
      // the contact (a short from common to the live throw) whenever common AND
      // that throw are wired — a real relay often leaves the unused throw open.
      // Contact pushed FIRST so the coil's aux current is the reported branch
      // (the coil current decides energization).
      const wired = (t: string) => inst.connects?.some((c) => c.terminal === t) ?? false
      const liveThrow = relayCoilEnergized(inst) ? 'normally_open' : 'normally_closed'
      if (wired('common') && wired(liveThrow)) {
        linearVoltageSources.push({ inst, kind: 'relay_contact' })
      }
      if (wired('coil_a') && wired('coil_b')) {
        linearVoltageSources.push({ inst, kind: 'relay_coil' })
      }
      continue
    }
    // The SCR is the one 3-terminal device dispatched in this section (its anode-cathode latch plus
    // a gate); every other branch below is 2-terminal. Let it through the 2-terminal guard.
    if (inst.connects?.length !== 2 && inst.definition !== 'scr') continue

    if (inst.definition === 'power_source') {
      linearVoltageSources.push({ inst, kind: 'power_source' })
    } else if (SHOCKLEY_DIODE_DEFINITIONS.has(inst.definition)) {
      // The whole pn-junction family (LEDs incl. the laser diode, the silicon rectifier, Schottky,
      // and the varactor) shares the Shockley law — only the calibration point differs.
      const led = resolveShockleyLed(inst, thermalV, options?.temperaturesC?.get(inst.id))
      if (led !== null) shockleyLeds.push(led)
      else linearVoltageSources.push({ inst, kind: 'led' }) // fixed-V_F fallback
    } else if (inst.definition === 'diode_tunnel') {
      // Only the injection (diffusion) term scales with V_T at the junction temperature; the
      // peak/valley tunneling currents stay at the declared 25 °C values (no cited temp law).
      const tunnelTemp = options?.temperaturesC?.get(inst.id)
      const tunnelThermalV =
        tunnelTemp !== undefined ? thermalVoltage(tunnelTemp + KELVIN_OFFSET) : thermalV
      const td = resolveTunnelDiode(inst, tunnelThermalV)
      if (td !== null) tunnelDiodes.push(td)
    } else if (inst.definition === 'diode_shockley' || inst.definition === 'scr') {
      // A latching thyristor — the Shockley diode and the SCR's anode-cathode path. Conducting → an
      // ordinary forward diode; blocking → open. The breakover / gate-trigger / holding-current
      // transitions are the discrete-state fixed point settled in solveWithRelays (the SCR's gate
      // adds the trigger); an SCR also stamps its gate-cathode resistance in the linear pass below.
      if (readEnumParam(inst, 'device_state') === 'conducting') {
        const led = resolveShockleyLed(inst, thermalV, options?.temperaturesC?.get(inst.id))
        if (led !== null) shockleyLeds.push(led)
        else linearVoltageSources.push({ inst, kind: 'led' })
      }
    } else if (inst.definition === 'arc_lamp' || inst.definition === 'neon_lamp') {
      // A gas discharge (carbon arc / neon) — a latching discharge (struck/extinguished is the Shockley latch, settled in
      // solveWithRelays: it strikes at the breakover/ignition voltage, holds until the current drops
      // below the holding current). Once STRUCK it burns at a near-constant arc voltage (a fixed-drop
      // voltage source, kind 'arc'); EXTINGUISHED it is an open. The external ballast sets the current
      // (a negative-resistance fall V = V_min + b/I is the documented next rung).
      if (readEnumParam(inst, 'device_state') === 'conducting')
        linearVoltageSources.push({ inst, kind: 'arc' })
    } else if (inst.definition === 'diode_zener_silicon') {
      // Forward Shockley conduction PLUS reverse-breakdown regulation, solved
      // through the same Newton loop as the LEDs (zenerCompanionModel clamps the
      // reverse voltage at V_Z).
      const zener = resolveZener(inst, thermalV, options?.temperaturesC?.get(inst.id))
      if (zener !== null) zeners.push(zener)
      else warnings.push(`Skipped zener '${inst.id}' (missing zener_voltage or forward_voltage)`)
    } else if (inst.definition === 'vacuum_diode') {
      // Fleming valve — the Child-Langmuir space-charge law I = perveance·V^1.5,
      // solved through the same Newton loop as the diodes (vacuumDiodeCompanion).
      const vd = resolveVacuumDiode(inst)
      if (vd !== null) vacuumDiodes.push(vd)
      else warnings.push(`Skipped vacuum diode '${inst.id}' (missing rated operating point)`)
    } else if (
      inst.definition === 'switch_spst_toggle' ||
      inst.definition === 'switch_spst_momentary'
    ) {
      // Closed → stamps as a short (below). Open → omitted entirely, leaving its
      // terminals on separate nets: a real open circuit, not a hardcoded short.
      // The momentary push button is electrically identical (default open).
      if (switchIsClosed(inst)) linearVoltageSources.push({ inst, kind: 'switch' })
    } else if (inst.definition === 'fuse') {
      // Intact → conducts like a wire carrying its element resistance (below).
      // Blown → omitted entirely, leaving its terminals on separate nets: a real
      // open circuit. The intact→blown transition is a canvas-level state change
      // driven by the solved current, not done here mid-solve.
      if (fuseIsIntact(inst)) linearVoltageSources.push({ inst, kind: 'fuse' })
    } else if (inst.definition === 'wire') {
      linearVoltageSources.push({ inst, kind: 'wire' })
    } else if (inst.definition === 'inductor' || inst.definition === 'electromagnet') {
      // DC steady state of v = L·di/dt is 0 V across the ideal inductance — an inductor
      // (and an electromagnet, which is electrically a coil) conducts DC, dropping only
      // its winding resistance. The electromagnet's magnetic field comes from this
      // steady current; the inductance only matters in transient/AC.
      linearVoltageSources.push({ inst, kind: 'inductor' })
    }
  }
  const S = linearVoltageSources.length

  // buildAndSolve stamps resistors + linear voltage sources + (optionally) the
  // Shockley companion models at their current guesses, then solves. Returns
  // the node-voltage map + the raw solution array (for aux currents), or null
  // on a singular matrix.
  const buildAndSolve = (): { nodes: Map<string, number>; xArr: number[][] } | null => {
    const M = zerosMatrix(N + S)
    const b = zerosVector(N + S)

    for (const inst of world.instances.values()) {
      // A thermistor stamps exactly like a resistor — its `resistance` is the
      // Beta-law value the electro-thermal loop already wrote for this temperature.
      // A photoresistor too — stampResistor reads its resistance from the light on it.
      // An incandescent bulb the same — its `resistance` is the tungsten-law value
      // the electro-thermal loop wrote for its self-heated filament temperature.
      if (
        inst.definition === 'resistor' ||
        inst.definition === 'thermistor' ||
        inst.definition === 'incandescent_bulb' ||
        inst.definition === 'photoresistor'
      ) {
        const ok = stampResistor(inst, nodeIndex, M)
        if (!ok)
          warnings.push(`Skipped resistor stamp for instance '${inst.id}' (missing R or connects)`)
      } else if (inst.definition === 'potentiometer') {
        const ok = stampPotentiometer(inst, nodeIndex, M)
        if (!ok)
          warnings.push(`Skipped potentiometer '${inst.id}' (missing resistance or connects)`)
      } else if (LIGHT_CURRENT_DEFINITIONS.has(inst.definition)) {
        // A photodiode / phototransistor injects a light-driven current (+ shunt).
        const [from, to] = lightCurrentTerminals(inst.definition)
        stampLightCurrentSource(inst, nodeIndex, M, b, from, to)
      } else if (inst.definition === 'scr') {
        // The SCR's gate-cathode resistance — the current path that lets the gate trigger fire it.
        const gate = inst.connects?.find((c) => c.terminal === 'gate')?.net
        const cathode = inst.connects?.find((c) => c.terminal === 'cathode')?.net
        const rGate = readScalarParam(inst, 'gate_cathode_resistance')
        if (gate !== undefined && cathode !== undefined && rGate !== undefined && rGate > 0)
          stampConductance(nodeIndex, M, gate, cathode, rGate)
      } else if (inst.definition === 'dc_motor') {
        // A DC motor is, at steady state, the linear resistor R_eff = R_a + k²/B (the
        // back-EMF raises the effective resistance), plus a constant load-current source.
        if (!stampMotor(inst, nodeIndex, M, b))
          warnings.push(`Skipped DC motor '${inst.id}' (missing R_a / k / friction or connects)`)
      } else if (inst.definition === 'generator') {
        // A generator spun at a fixed speed is a Thévenin source — EMF E = k·ω behind R_a —
        // stamped as its Norton equivalent (1/R_a + a current source E/R_a out of the +).
        if (!stampGenerator(inst, nodeIndex, M, b))
          warnings.push(
            `Skipped generator '${inst.id}' (missing k / R_a / drive speed or connects)`,
          )
      } else if (inst.definition === 'induction_motor') {
        // On DC an induction motor makes no torque — it is just its stator winding resistance R1.
        // The AC operating point (slip, torque, running + locked-rotor current, efficiency, power
        // factor) is the per-phase steady-state analysis surfaced in the readings + Math card.
        const r1 = readScalarParam(inst, 'stator_resistance')
        const aNet = inst.connects?.find((c) => c.terminal === 'terminal_a')?.net
        const bNet = inst.connects?.find((c) => c.terminal === 'terminal_b')?.net
        if (r1 !== undefined && r1 > 0 && aNet !== undefined && bNet !== undefined)
          stampConductance(nodeIndex, M, aNet, bNet, r1)
      } else if (inst.definition === 'crt') {
        // A CRT's electron gun is a fixed beam-current load on the anode (EHT); the X/Y deflection
        // plates are high-impedance inputs. The spot position + brightness are read post-solve.
        if (!stampCrt(inst, nodeIndex, M, b))
          warnings.push(`Skipped CRT '${inst.id}' (missing beam/deflection params or connects)`)
      } else if (inst.definition === 'transmission_line') {
        // At DC a lossless line is a pass-through (v_near = v_far): a near-short between
        // each end's conductors. The transient solver carries the propagation delay + Z₀.
        const find = (terminal: string) => inst.connects?.find((c) => c.terminal === terminal)?.net
        const na = find('near_a')
        const fa = find('far_a')
        const nb = find('near_b')
        const fb = find('far_b')
        if (na !== undefined && fa !== undefined)
          stampConductance(nodeIndex, M, na, fa, TLINE_DC_OHMS)
        if (nb !== undefined && fb !== undefined)
          stampConductance(nodeIndex, M, nb, fb, TLINE_DC_OHMS)
      }
    }
    for (let s = 0; s < linearVoltageSources.length; s++) {
      // biome-ignore lint/style/noNonNullAssertion: s is bound by the array length
      const { inst, kind } = linearVoltageSources[s]!
      const auxIdx = N + s
      let ok = false
      if (kind === 'power_source') ok = stampVoltageSource(inst, nodeIndex, auxIdx, M, b)
      else if (kind === 'led') ok = stampLED(inst, nodeIndex, auxIdx, M, b)
      else if (kind === 'switch') ok = stampClosedSwitch(inst, nodeIndex, auxIdx, M, b)
      else if (kind === 'switch_spdt') ok = stampSpdt(inst, nodeIndex, auxIdx, M, b)
      else if (kind === 'relay_coil') ok = stampRelayCoil(inst, nodeIndex, auxIdx, M, b)
      else if (kind === 'relay_contact') ok = stampRelayContact(inst, nodeIndex, auxIdx, M, b)
      else if (kind === 'fuse') ok = stampFuse(inst, nodeIndex, auxIdx, M, b)
      else if (kind === 'wire') ok = stampWire(inst, nodeIndex, auxIdx, M, b)
      else if (kind === 'inductor') ok = stampInductorDC(inst, nodeIndex, auxIdx, M, b)
      else if (kind === 'transformer_primary')
        ok = stampTransformerWindingDC(inst, nodeIndex, auxIdx, 'primary', M, b)
      else if (kind === 'transformer_secondary')
        ok = stampTransformerWindingDC(inst, nodeIndex, auxIdx, 'secondary', M, b)
      else if (kind === 'transformer_ct_half_a')
        ok = stampCtHalfDC(inst, nodeIndex, auxIdx, 'a', M, b)
      else if (kind === 'transformer_ct_half_b')
        ok = stampCtHalfDC(inst, nodeIndex, auxIdx, 'b', M, b)
      else if (kind === 'arc') ok = stampArc(inst, nodeIndex, auxIdx, M, b)
      if (!ok)
        warnings.push(
          `Skipped ${kind} stamp for instance '${inst.id}' (missing V or terminal connects)`,
        )
    }
    for (const led of shockleyLeds) {
      stampLedCompanion(led, nodeIndex, led.thermalV, M, b)
    }
    for (const td of tunnelDiodes) {
      stampTunnelDiodeCompanion(td, nodeIndex, M, b)
    }
    for (const z of zeners) {
      stampZenerCompanion(z, nodeIndex, z.thermalV, M, b)
    }
    for (const bjt of bjts) {
      stampBjtCompanion(bjt, nodeIndex, bjt.thermalV, M, b)
    }
    for (const fet of mosfets) {
      stampMosfetCompanion(fet, nodeIndex, M, b)
    }
    for (const vd of vacuumDiodes) {
      stampVacuumDiodeCompanion(vd, nodeIndex, M, b)
    }
    for (const tri of triodes) {
      stampTriodeCompanion(tri, nodeIndex, M, b)
    }
    for (const tube of screenTubes) {
      stampScreenGridTubeCompanion(tube, nodeIndex, M, b)
    }

    let x: DenseVector
    try {
      x = lusolve(M, b)
    } catch {
      return null
    }
    const xArr = x.toArray()
    const nodes = new Map<string, number>()
    nodes.set(ground, 0)
    for (const [netId, idx] of nodeIndex) {
      const v = xArr[idx]?.[0]
      if (typeof v === 'number') nodes.set(netId, v)
    }
    return { nodes, xArr }
  }

  // Optional .nodeset seed: set every nonlinear device's junction/terminal
  // voltages directly from a node-voltage hint, so the Newton starts at (or near)
  // the operating point. The seed IS an operating point — no per-iteration
  // limiting, just place the guesses, exactly mirroring the loop's update below.
  if (options?.initialNodes) {
    const seed = options.initialNodes
    const sv = (net: string) => (net === ground ? 0 : (seed.get(net) ?? 0))
    for (const led of shockleyLeds) led.vGuess = sv(led.anodeNet) - sv(led.cathodeNet)
    for (const td of tunnelDiodes) td.vGuess = sv(td.anodeNet) - sv(td.cathodeNet)
    for (const z of zeners) z.vGuess = sv(z.anodeNet) - sv(z.cathodeNet)
    for (const bjt of bjts) {
      const sign = bjt.polarity === 'pnp' ? -1 : 1
      bjt.vBE = sign * (sv(bjt.baseNet) - sv(bjt.emitterNet))
      bjt.vBC = sign * (sv(bjt.baseNet) - sv(bjt.collectorNet))
    }
    for (const fet of mosfets) {
      fet.vGS = sv(fet.gateNet) - sv(fet.sourceNet)
      fet.vDS = sv(fet.drainNet) - sv(fet.sourceNet)
    }
    for (const vd of vacuumDiodes) vd.vGuess = sv(vd.plateNet) - sv(vd.cathodeNet)
    for (const tri of triodes) {
      tri.vGK = sv(tri.gridNet) - sv(tri.cathodeNet)
      tri.vPK = sv(tri.plateNet) - sv(tri.cathodeNet)
    }
    for (const tube of screenTubes) {
      tube.vG1K = sv(tube.gridNet) - sv(tube.cathodeNet)
      tube.vG2K = sv(tube.screenNet) - sv(tube.cathodeNet)
      tube.vPK = sv(tube.plateNet) - sv(tube.cathodeNet)
    }
  }

  // Linear fast-path: no Shockley LEDs → a single solve (Sprint 14 behavior).
  // Newton-Raphson path: iterate the companion-model linearization to convergence.
  let solved: { nodes: Map<string, number>; xArr: number[][] } | null
  let iterations = 1
  let converged = true

  if (
    shockleyLeds.length === 0 &&
    tunnelDiodes.length === 0 &&
    zeners.length === 0 &&
    bjts.length === 0 &&
    mosfets.length === 0 &&
    vacuumDiodes.length === 0 &&
    triodes.length === 0 &&
    screenTubes.length === 0
  ) {
    solved = buildAndSolve()
    if (solved === null) return emptyResult('singular-matrix', ground, warnings)
  } else {
    converged = false
    const maxIter = options?.maxIterations ?? NR_MAX_ITERATIONS
    let last: { nodes: Map<string, number>; xArr: number[][] } | null = null
    for (iterations = 1; iterations <= maxIter; iterations++) {
      last = buildAndSolve()
      if (last === null) return emptyResult('singular-matrix', ground, warnings)

      let maxDelta = 0
      let anyLimited = false
      for (const led of shockleyLeds) {
        const vAnode = led.anodeNet === ground ? 0 : (last.nodes.get(led.anodeNet) ?? 0)
        const vCathode = led.cathodeNet === ground ? 0 : (last.nodes.get(led.cathodeNet) ?? 0)
        const vRaw = vAnode - vCathode
        const nVT = led.idealityFactor * led.thermalV
        const vcrit = criticalVoltage(led.saturationCurrent, led.idealityFactor, led.thermalV)
        const limit = pnjlim(vRaw, led.vGuess, nVT, vcrit)
        maxDelta = Math.max(maxDelta, Math.abs(limit.voltage - led.vGuess))
        if (limit.limited) anyLimited = true
        led.vGuess = limit.voltage
      }
      for (const z of zeners) {
        const vAnode = z.anodeNet === ground ? 0 : (last.nodes.get(z.anodeNet) ?? 0)
        const vCathode = z.cathodeNet === ground ? 0 : (last.nodes.get(z.cathodeNet) ?? 0)
        const next = limitZenerStep(vAnode - vCathode, z)
        maxDelta = Math.max(maxDelta, Math.abs(next.voltage - z.vGuess))
        if (next.limited) anyLimited = true
        z.vGuess = next.voltage
      }
      for (const bjt of bjts) {
        const vB = bjt.baseNet === ground ? 0 : (last.nodes.get(bjt.baseNet) ?? 0)
        const vC = bjt.collectorNet === ground ? 0 : (last.nodes.get(bjt.collectorNet) ?? 0)
        const vE = bjt.emitterNet === ground ? 0 : (last.nodes.get(bjt.emitterNet) ?? 0)
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
        const vG = fet.gateNet === ground ? 0 : (last.nodes.get(fet.gateNet) ?? 0)
        const vD = fet.drainNet === ground ? 0 : (last.nodes.get(fet.drainNet) ?? 0)
        const vS = fet.sourceNet === ground ? 0 : (last.nodes.get(fet.sourceNet) ?? 0)
        // The square-law is gentler than a junction exponential — a plain
        // per-iteration voltage-step clamp (SPICE's fetlim idea) is enough.
        const nextVGS = limitMosfetStep(vG - vS, fet.vGS)
        const nextVDS = limitMosfetStep(vD - vS, fet.vDS)
        maxDelta = Math.max(maxDelta, Math.abs(nextVGS - fet.vGS), Math.abs(nextVDS - fet.vDS))
        if (nextVGS !== vG - vS || nextVDS !== vD - vS) anyLimited = true
        fet.vGS = nextVGS
        fet.vDS = nextVDS
      }
      for (const td of tunnelDiodes) {
        const vA = td.anodeNet === ground ? 0 : (last.nodes.get(td.anodeNet) ?? 0)
        const vC = td.cathodeNet === ground ? 0 : (last.nodes.get(td.cathodeNet) ?? 0)
        const next = limitTunnelDiodeStep(vA - vC, td.vGuess)
        maxDelta = Math.max(maxDelta, Math.abs(next - td.vGuess))
        if (next !== vA - vC) anyLimited = true
        td.vGuess = next
      }
      for (const vd of vacuumDiodes) {
        const vP = vd.plateNet === ground ? 0 : (last.nodes.get(vd.plateNet) ?? 0)
        const vK = vd.cathodeNet === ground ? 0 : (last.nodes.get(vd.cathodeNet) ?? 0)
        // The Child-Langmuir 3/2 law is gentle — a plain voltage-step clamp is enough.
        const next = limitVacuumStep(vP - vK, vd.vGuess)
        maxDelta = Math.max(maxDelta, Math.abs(next - vd.vGuess))
        if (next !== vP - vK) anyLimited = true
        vd.vGuess = next
      }
      for (const tri of triodes) {
        const vP = tri.plateNet === ground ? 0 : (last.nodes.get(tri.plateNet) ?? 0)
        const vG = tri.gridNet === ground ? 0 : (last.nodes.get(tri.gridNet) ?? 0)
        const vK = tri.cathodeNet === ground ? 0 : (last.nodes.get(tri.cathodeNet) ?? 0)
        const nextVGK = limitVacuumStep(vG - vK, tri.vGK)
        const nextVPK = limitVacuumStep(vP - vK, tri.vPK)
        maxDelta = Math.max(maxDelta, Math.abs(nextVGK - tri.vGK), Math.abs(nextVPK - tri.vPK))
        if (nextVGK !== vG - vK || nextVPK !== vP - vK) anyLimited = true
        tri.vGK = nextVGK
        tri.vPK = nextVPK
      }
      for (const tube of screenTubes) {
        const vP = tube.plateNet === ground ? 0 : (last.nodes.get(tube.plateNet) ?? 0)
        const vG1 = tube.gridNet === ground ? 0 : (last.nodes.get(tube.gridNet) ?? 0)
        const vG2 = tube.screenNet === ground ? 0 : (last.nodes.get(tube.screenNet) ?? 0)
        const vK = tube.cathodeNet === ground ? 0 : (last.nodes.get(tube.cathodeNet) ?? 0)
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
      if (maxDelta < NR_VOLTAGE_TOLERANCE && !anyLimited) {
        converged = true
        break
      }
    }
    solved = last
    if (solved === null) return emptyResult('singular-matrix', ground, warnings)
    if (!converged) {
      return {
        status: 'did-not-converge',
        nodes: solved.nodes,
        branches: new Map(),
        ground,
        warnings,
        iterations: iterations - 1,
        converged: false,
      }
    }
  }

  const { nodes, xArr } = solved

  // Branch currents (§18.6 sign convention).
  const branches = new Map<string, number>()
  for (const inst of world.instances.values()) {
    if (
      inst.definition === 'resistor' ||
      inst.definition === 'thermistor' ||
      inst.definition === 'incandescent_bulb' ||
      inst.definition === 'photoresistor'
    ) {
      const I = computeResistorCurrent(inst, nodes)
      if (I !== undefined) branches.set(inst.id, I)
    } else if (inst.definition === 'potentiometer') {
      // The pot's reported current is the input-end current: into terminal_a
      // (top segment) for a divider/rheostat fed from a; if a is the floating
      // end, the wired end b carries it instead (the other rheostat orientation).
      const seg = potentiometerSegments(inst)
      const a = inst.connects?.find((c) => c.terminal === 'terminal_a')?.net
      const w = inst.connects?.find((c) => c.terminal === 'wiper')?.net
      const b = inst.connects?.find((c) => c.terminal === 'terminal_b')?.net
      if (seg !== null && w !== undefined && a !== undefined) {
        branches.set(inst.id, ((nodes.get(a) ?? 0) - (nodes.get(w) ?? 0)) / seg.top)
      } else if (seg !== null && w !== undefined && b !== undefined) {
        branches.set(inst.id, ((nodes.get(b) ?? 0) - (nodes.get(w) ?? 0)) / seg.bottom)
      }
    } else if (LIGHT_CURRENT_DEFINITIONS.has(inst.definition)) {
      // The device current IS the light-driven photocurrent it injects (the tiny
      // shunt current is negligible beside it).
      branches.set(inst.id, lightSensorCurrent(inst))
    } else if (inst.definition === 'dc_motor') {
      const p = motorParamsFromInstance(inst)
      const posNet = inst.connects?.find((c) => c.terminal === 'terminal_positive')?.net
      const negNet = inst.connects?.find((c) => c.terminal === 'terminal_negative')?.net
      if (p !== undefined && posNet !== undefined && negNet !== undefined) {
        const vAcross = (nodes.get(posNet) ?? 0) - (nodes.get(negNet) ?? 0)
        branches.set(inst.id, motorSteadyState(vAcross, p).current)
      }
    } else if (inst.definition === 'generator') {
      const p = generatorParamsFromInstance(inst)
      const posNet = inst.connects?.find((c) => c.terminal === 'terminal_positive')?.net
      const negNet = inst.connects?.find((c) => c.terminal === 'terminal_negative')?.net
      if (p !== undefined && posNet !== undefined && negNet !== undefined) {
        const vAcross = (nodes.get(posNet) ?? 0) - (nodes.get(negNet) ?? 0)
        branches.set(inst.id, generatorOperatingPoint(vAcross, p).current)
      }
    }
  }
  for (let s = 0; s < linearVoltageSources.length; s++) {
    // biome-ignore lint/style/noNonNullAssertion: s is bound by the array length
    const { inst } = linearVoltageSources[s]!
    const I_aux = xArr[N + s]?.[0]
    if (typeof I_aux === 'number') branches.set(inst.id, I_aux)
  }
  // Shockley LED current from the diode equation at the converged voltage.
  for (const led of shockleyLeds) {
    branches.set(
      led.inst.id,
      diodeCurrent(led.vGuess, led.saturationCurrent, led.idealityFactor, led.thermalV),
    )
  }
  for (const td of tunnelDiodes) {
    branches.set(td.inst.id, tunnelDiodeCurrent(td.vGuess, td.params))
  }
  // Vacuum diode: the Child-Langmuir plate current at the converged plate-cathode voltage.
  for (const vd of vacuumDiodes) {
    branches.set(vd.inst.id, childLangmuirCurrent(vd.vGuess, vd.perveance))
  }
  // Triode: the plate current at the converged grid + plate bias.
  for (const tri of triodes) {
    branches.set(
      tri.inst.id,
      gridTubeOperatingPoint(tri.vPK, tri.vGK, tri.perveance, tri.mu).plateCurrent,
    )
  }
  // Screen-grid tube (tetrode/pentode): the plate current at the converged biases.
  for (const tube of screenTubes) {
    branches.set(
      tube.inst.id,
      screenGridTubeOperatingPoint(
        tube.vPK,
        tube.vG1K,
        tube.vG2K,
        tube.perveance,
        tube.screenMu,
        tube.plateMu,
      ).plateCurrent,
    )
  }
  // Zener: the device current from its two-branch companion at the converged
  // voltage (forward conduction, or the reverse breakdown current when clamping).
  for (const z of zeners) {
    const { conductance, currentSource } = zenerCompanionModel(
      z.vGuess,
      z.saturationCurrent,
      z.idealityFactor,
      z.thermalV,
      z.zenerVoltage,
      z.breakdownCurrent,
      z.breakdownIdeality,
    )
    branches.set(z.inst.id, conductance * z.vGuess + currentSource)
  }
  // BJT: the collector current is the branch current we report (physical sign —
  // a PNP's conventional collector current flows out of the collector).
  for (const bjt of bjts) {
    const sign = bjt.polarity === 'pnp' ? -1 : 1
    branches.set(bjt.inst.id, sign * bjtCurrents(bjt.vBE, bjt.vBC, bjt.params, bjt.thermalV).iC)
  }
  // MOSFET: the drain current at the converged bias (signed into the drain —
  // negative for a conducting PMOS, whose current flows source → drain).
  for (const fet of mosfets) {
    branches.set(fet.inst.id, mosfetOperatingPoint(fet.vGS, fet.vDS, fet.params).iD)
  }

  return {
    status: hasUnsupported ? 'unsupported-element' : 'solved',
    nodes,
    branches,
    ground,
    warnings,
    iterations,
    converged,
  }
}

/** Shorthand for the no-result early returns. */
function emptyResult(
  status: SolutionStatus,
  ground: string | undefined,
  warnings: string[],
): Solution {
  return {
    status,
    nodes: new Map(),
    branches: new Map(),
    ground,
    warnings,
    iterations: 0,
    converged: false,
  }
}

/** h·c in eV·nm (NIST CODATA) — an LED's bandgap from its emission wavelength. */
export const PHOTON_EV_NM = 1239.841984
/** 0 °C in kelvin. */
export const KELVIN_OFFSET = 273.15
/** Bandgap of silicon (eV) for the I_S(T) law — the 1.11 eV SPICE EG default (ngspice's silicon
 *  junction model), a different convention from the 1.12 eV physical 300 K value in
 *  material-silicon.yaml; both are correct in their place. */
export const SILICON_BANDGAP_EV = 1.11

/**
 * Resolve an LED to the Shockley model, or null if it lacks calibration data
 * (forward_voltage + max_forward_current) and should fall back to fixed-V_F.
 *
 * With a junction temperature (the electro-thermal loop), the element solves at
 * that temperature: V_T = kT/q and I_S scaled by the SPICE temperature law, with
 * the bandgap taken from the LED's own emission wavelength (E_g = h·c/λ).
 * Honest model note: for an LED, qV_F ≈ E_g, so the constant-bandgap law's two
 * temperature effects nearly cancel — the computed V_F drift is much smaller
 * than the ≈ −2 mV/K real LEDs show (which mostly comes from the bandgap itself
 * shrinking with temperature, the Varshni effect — a future refinement). Silicon
 * junctions (V_F ≪ E_g) get the full, real ≈ −2 mV/K behavior from this law.
 */
export function resolveShockleyLed(
  inst: Instance,
  thermalV: number,
  temperatureC?: number,
): ShockleyLed | null {
  const forwardVoltage = readScalarParam(inst, 'forward_voltage')
  const forwardCurrent = readScalarParam(inst, 'max_forward_current')
  if (forwardVoltage === undefined || forwardCurrent === undefined) return null
  if (forwardVoltage <= 0 || forwardCurrent <= 0) return null

  const anodeConnect = inst.connects?.find((c) => c.terminal === 'anode')
  const cathodeConnect = inst.connects?.find((c) => c.terminal === 'cathode')
  if (anodeConnect === undefined || cathodeConnect === undefined) return null

  const idealityFactor = readScalarParam(inst, 'ideality_factor') ?? DEFAULT_IDEALITY_FACTOR
  if (idealityFactor <= 0) return null // n > 0; a non-positive ideality zeros n·V_T → NaN
  // The V_F @ I_F calibration point is a 25 °C (298.15 K) datasheet figure.
  let saturationCurrent = deriveSaturationCurrent(
    forwardVoltage,
    forwardCurrent,
    idealityFactor,
    thermalV,
  )
  let elementThermalV = thermalV
  if (temperatureC !== undefined) {
    const junctionKelvin = temperatureC + KELVIN_OFFSET
    const wavelengthNm = readScalarParam(inst, 'peak_wavelength')
    const isLed = wavelengthNm !== undefined && wavelengthNm > 0
    const bandgapEv = isLed ? PHOTON_EV_NM / (wavelengthNm as number) : SILICON_BANDGAP_EV
    // An LED's bandgap narrows with heat (Varshni) — the dominant reason its
    // forward voltage droops, since qV_F ≈ E_g makes the constant-bandgap law's
    // two effects nearly cancel. A silicon junction (qV_F ≪ E_g) keeps a constant
    // bandgap; its droop already falls out of the I_S(T) law.
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
    inst,
    anodeNet: anodeConnect.net,
    cathodeNet: cathodeConnect.net,
    saturationCurrent,
    idealityFactor,
    thermalV: elementThermalV,
    vGuess: forwardVoltage, // warm start at the rated forward voltage
  }
}

/**
 * Resolve a vacuum diode to its Child-Langmuir element, or null without its rated
 * operating point. The perveance P = I_ref / V_ref^1.5 is derived from the rated plate
 * current at the rated plate voltage — a datasheet point, the way resolveShockleyLed
 * derives I_S from V_F @ I_F. No temperature law: the cathode is assumed hot, so the
 * current is space-charge limited, not emission limited (a documented first rung).
 */
export function resolveVacuumDiode(inst: Instance): VacuumDiode | null {
  const refVoltage = readScalarParam(inst, 'reference_plate_voltage')
  const refCurrent = readScalarParam(inst, 'plate_current_at_reference')
  if (refVoltage === undefined || refCurrent === undefined) return null
  if (refVoltage <= 0 || refCurrent <= 0) return null
  const plate = inst.connects?.find((c) => c.terminal === 'plate')
  const cathode = inst.connects?.find((c) => c.terminal === 'cathode')
  if (plate === undefined || cathode === undefined) return null
  return {
    inst,
    plateNet: plate.net,
    cathodeNet: cathode.net,
    perveance: perveanceFromOperatingPoint(refCurrent, refVoltage),
    vGuess: refVoltage, // warm start at the rated plate voltage
  }
}

/**
 * Resolve a Zener to the two-branch model, or null without forward_voltage +
 * zener_voltage. Forward I_S is calibrated like any silicon diode (V_F at a
 * reference current); the breakdown reference current is the datasheet knee
 * current. With a junction temperature the forward I_S scales by the SPICE law
 * (silicon, constant bandgap); V_Z itself is held constant for now (its
 * temperature coefficient is a future refinement).
 */
function resolveZener(
  inst: Instance,
  thermalV: number,
  temperatureC?: number,
): ZenerElement | null {
  const forwardVoltage = readScalarParam(inst, 'forward_voltage')
  const zenerVoltage = readScalarParam(inst, 'zener_voltage')
  if (forwardVoltage === undefined || zenerVoltage === undefined) return null
  if (forwardVoltage <= 0 || zenerVoltage <= 0) return null

  const anodeConnect = inst.connects?.find((c) => c.terminal === 'anode')
  const cathodeConnect = inst.connects?.find((c) => c.terminal === 'cathode')
  if (anodeConnect === undefined || cathodeConnect === undefined) return null

  const idealityFactor = readScalarParam(inst, 'ideality_factor') ?? DEFAULT_IDEALITY_FACTOR
  if (idealityFactor <= 0) return null // n > 0; a non-positive ideality zeros n·V_T → NaN
  const forwardCurrent = readScalarParam(inst, 'max_forward_current') ?? 0.01 // 10 mA reference
  let saturationCurrent = deriveSaturationCurrent(
    forwardVoltage,
    forwardCurrent,
    idealityFactor,
    thermalV,
  )
  const breakdownCurrent = readScalarParam(inst, 'knee_current') ?? 0.005 // 5 mA reference
  let elementThermalV = thermalV
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
    inst,
    anodeNet: anodeConnect.net,
    cathodeNet: cathodeConnect.net,
    saturationCurrent,
    idealityFactor,
    thermalV: elementThermalV,
    zenerVoltage,
    breakdownCurrent,
    breakdownIdeality: ZENER_BREAKDOWN_IDEALITY,
    vGuess: 0, // warm start in the blocking region
  }
}

/**
 * Per-iteration voltage limiting for a Zener — pnjlim on whichever branch is
 * being driven. The forward branch is limited around its critical voltage; the
 * breakdown branch is limited the same way in u = −(V + V_Z) space, so a Newton
 * step can't overshoot the steep breakdown knee and diverge.
 */
function limitZenerStep(vRaw: number, z: ZenerElement): { voltage: number; limited: boolean } {
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

/**
 * Stamp a 2-terminal junction companion (the shared core of the LED / tunnel / zener stamps): a
 * Norton conductance G between anode and cathode plus a current source I_eq, with the SPICE GMIN
 * floor — a 1 pS resistor in parallel with the junction that keeps a node behind a hard-off junction
 * from floating, without moving the operating point (its current is sub-pA). Ground rows/cols omitted.
 */
function stampJunctionCompanion(
  anodeNet: string,
  cathodeNet: string,
  conductance: number,
  currentSource: number,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const a = nodeIndex.get(anodeNet)
  const c = nodeIndex.get(cathodeNet)
  const Gd = conductance + SOLVER_GMIN
  if (a !== undefined) {
    M.set([a, a], (M.get([a, a]) ?? 0) + Gd)
    b.set([a, 0], (b.get([a, 0]) ?? 0) - currentSource)
  }
  if (c !== undefined) {
    M.set([c, c], (M.get([c, c]) ?? 0) + Gd)
    b.set([c, 0], (b.get([c, 0]) ?? 0) + currentSource)
  }
  if (a !== undefined && c !== undefined) {
    M.set([a, c], (M.get([a, c]) ?? 0) - Gd)
    M.set([c, a], (M.get([c, a]) ?? 0) - Gd)
  }
}

/** Stamp an LED / forward-diode Shockley companion at its voltage guess (§20.4 / §20.7). */
function stampLedCompanion(
  led: ShockleyLed,
  nodeIndex: Map<string, number>,
  thermalV: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { conductance, currentSource } = companionModel(
    led.vGuess,
    led.saturationCurrent,
    led.idealityFactor,
    thermalV,
  )
  stampJunctionCompanion(led.anodeNet, led.cathodeNet, conductance, currentSource, nodeIndex, M, b)
}

/** Stamp a vacuum-diode Child-Langmuir companion at its plate-cathode voltage guess. */
function stampVacuumDiodeCompanion(
  vd: VacuumDiode,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { conductance, currentSource } = vacuumDiodeCompanion(vd.vGuess, vd.perveance)
  stampJunctionCompanion(vd.plateNet, vd.cathodeNet, conductance, currentSource, nodeIndex, M, b)
}

/**
 * Resolve a triode to its grid-tube element, or null without μ + a rated operating
 * point + its three terminals. The perveance is derived from the reference point
 * (plate current at a plate/grid bias) via the effective voltage V_g + V_p/μ, so the
 * tube is specified by a datasheet bias point + μ. The reference point must be in
 * conduction (V_eff > 0); a cut-off reference can't calibrate the perveance.
 */
export function resolveTriode(inst: Instance): TriodeElement | null {
  const mu = readScalarParam(inst, 'amplification_factor')
  const refVp = readScalarParam(inst, 'reference_plate_voltage')
  const refVg = readScalarParam(inst, 'reference_grid_voltage')
  const refIp = readScalarParam(inst, 'plate_current_at_reference')
  if (mu === undefined || refVp === undefined || refVg === undefined || refIp === undefined)
    return null
  if (mu <= 0 || refIp <= 0) return null
  const plate = inst.connects?.find((c) => c.terminal === 'plate')
  const grid = inst.connects?.find((c) => c.terminal === 'grid')
  const cathode = inst.connects?.find((c) => c.terminal === 'cathode')
  if (plate === undefined || grid === undefined || cathode === undefined) return null
  const perveance = perveanceFromOperatingPoint(refIp, refVg + refVp / mu)
  if (perveance <= 0) return null // the reference bias must conduct (V_eff > 0)
  return {
    inst,
    plateNet: plate.net,
    gridNet: grid.net,
    cathodeNet: cathode.net,
    perveance,
    mu,
    vGK: refVg, // warm start at the rated bias
    vPK: refVp,
  }
}

/** Stamp a triode's transconductance companion at its bias guess — the same shape as
 *  stampMosfetCompanion (grid→plate g_m, plate→cathode g_p), the grid drawing no current. */
export function stampTriodeCompanion(
  tri: TriodeElement,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const op = gridTubeOperatingPoint(tri.vPK, tri.vGK, tri.perveance, tri.mu)
  const ieq = op.plateCurrent - op.gm * tri.vGK - op.gp * tri.vPK
  const iGr = nodeIndex.get(tri.gridNet)
  const iP = nodeIndex.get(tri.plateNet)
  const iK = nodeIndex.get(tri.cathodeNet)
  const add = (row: number | undefined, col: number | undefined, value: number) => {
    if (row === undefined || col === undefined) return
    M.set([row, col], (M.get([row, col]) ?? 0) + value)
  }
  add(iP, iGr, op.gm)
  add(iP, iP, op.gp)
  add(iP, iK, -(op.gm + op.gp))
  add(iK, iGr, -op.gm)
  add(iK, iP, -op.gp)
  add(iK, iK, op.gm + op.gp)
  if (iP !== undefined) b.set([iP, 0], (b.get([iP, 0]) ?? 0) - ieq)
  if (iK !== undefined) b.set([iK, 0], (b.get([iK, 0]) ?? 0) + ieq)
}

/**
 * Resolve a screen-grid tube (tetrode/pentode) to its element, or null without the two
 * μ's + a rated operating point + its four terminals. The perveance is derived from the
 * reference point via the effective voltage V_g1 + V_g2/μ_screen + V_plate/μ_plate; that
 * reference point must be in conduction (V_eff > 0).
 */
export function resolveScreenGridTube(inst: Instance): ScreenGridTube | null {
  const screenMu = readScalarParam(inst, 'screen_amplification_factor')
  const plateMu = readScalarParam(inst, 'plate_amplification_factor')
  const refVp = readScalarParam(inst, 'reference_plate_voltage')
  const refVg = readScalarParam(inst, 'reference_grid_voltage')
  const refVs = readScalarParam(inst, 'reference_screen_voltage')
  const refIp = readScalarParam(inst, 'plate_current_at_reference')
  if (
    screenMu === undefined ||
    plateMu === undefined ||
    refVp === undefined ||
    refVg === undefined ||
    refVs === undefined ||
    refIp === undefined
  )
    return null
  if (screenMu <= 0 || plateMu <= 0 || refIp <= 0) return null
  const plate = inst.connects?.find((c) => c.terminal === 'plate')
  const grid = inst.connects?.find((c) => c.terminal === 'grid')
  const screen = inst.connects?.find((c) => c.terminal === 'screen_grid')
  const cathode = inst.connects?.find((c) => c.terminal === 'cathode')
  if (plate === undefined || grid === undefined || screen === undefined || cathode === undefined)
    return null
  const perveance = perveanceFromOperatingPoint(refIp, refVg + refVs / screenMu + refVp / plateMu)
  if (perveance <= 0) return null // the reference bias must conduct (V_eff > 0)
  return {
    inst,
    plateNet: plate.net,
    gridNet: grid.net,
    screenNet: screen.net,
    cathodeNet: cathode.net,
    perveance,
    screenMu,
    plateMu,
    vG1K: refVg,
    vG2K: refVs,
    vPK: refVp,
  }
}

/** Stamp a screen-grid tube's companion at its bias — like the triode, with the screen
 *  grid (g2) as a third control term; both grids draw no current. */
export function stampScreenGridTubeCompanion(
  tube: ScreenGridTube,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const op = screenGridTubeOperatingPoint(
    tube.vPK,
    tube.vG1K,
    tube.vG2K,
    tube.perveance,
    tube.screenMu,
    tube.plateMu,
  )
  const ieq = op.plateCurrent - op.gm * tube.vG1K - op.gScreen * tube.vG2K - op.gp * tube.vPK
  const iG1 = nodeIndex.get(tube.gridNet)
  const iG2 = nodeIndex.get(tube.screenNet)
  const iP = nodeIndex.get(tube.plateNet)
  const iK = nodeIndex.get(tube.cathodeNet)
  const add = (row: number | undefined, col: number | undefined, value: number) => {
    if (row === undefined || col === undefined) return
    M.set([row, col], (M.get([row, col]) ?? 0) + value)
  }
  const gSum = op.gm + op.gScreen + op.gp
  add(iP, iG1, op.gm)
  add(iP, iG2, op.gScreen)
  add(iP, iP, op.gp)
  add(iP, iK, -gSum)
  add(iK, iG1, -op.gm)
  add(iK, iG2, -op.gScreen)
  add(iK, iP, -op.gp)
  add(iK, iK, gSum)
  if (iP !== undefined) b.set([iP, 0], (b.get([iP, 0]) ?? 0) - ieq)
  if (iK !== undefined) b.set([iK, 0], (b.get([iK, 0]) ?? 0) + ieq)
}

/**
 * Resolve a tunnel diode from its four datasheet headline numbers (peak + valley current/voltage).
 * The diffusion saturation current is calibrated so the curve passes ~through the valley point.
 */
export function resolveTunnelDiode(inst: Instance, thermalV: number): TunnelDiode | null {
  const peakCurrent = readScalarParam(inst, 'peak_current')
  const peakVoltage = readScalarParam(inst, 'peak_voltage')
  const valleyCurrent = readScalarParam(inst, 'valley_current')
  const valleyVoltage = readScalarParam(inst, 'valley_voltage')
  if (
    peakCurrent === undefined ||
    peakVoltage === undefined ||
    valleyCurrent === undefined ||
    valleyVoltage === undefined
  ) {
    return null
  }
  if (peakVoltage <= 0 || valleyVoltage <= peakVoltage || peakCurrent <= 0) return null
  const idealityFactor = readScalarParam(inst, 'ideality_factor') ?? 1
  if (idealityFactor <= 0) return null // n > 0; a non-positive ideality zeros n·V_T → NaN
  const anode = inst.connects?.find((c) => c.terminal === 'anode')
  const cathode = inst.connects?.find((c) => c.terminal === 'cathode')
  if (anode === undefined || cathode === undefined) return null

  const saturationCurrent = tunnelDiodeSaturationCurrent(
    peakCurrent,
    peakVoltage,
    valleyCurrent,
    valleyVoltage,
    idealityFactor,
    thermalV,
  )
  return {
    inst,
    anodeNet: anode.net,
    cathodeNet: cathode.net,
    params: { peakCurrent, peakVoltage, saturationCurrent, idealityFactor, thermalV },
    vGuess: 0,
  }
}

/**
 * Stamp a tunnel diode's Newton companion — the same junction-companion shape, but the conductance
 * may be NEGATIVE (the negative-resistance region).
 */
function stampTunnelDiodeCompanion(
  td: TunnelDiode,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { conductance, currentSource } = tunnelDiodeCompanion(td.vGuess, td.params)
  stampJunctionCompanion(td.anodeNet, td.cathodeNet, conductance, currentSource, nodeIndex, M, b)
}

/**
 * Stamp a Zener's companion model at its voltage guess — identical shape to
 * stampLedCompanion, but the conductance + current carry the reverse-breakdown
 * branch, so a reverse-biased Zener clamps at V_Z instead of blocking.
 */
function stampZenerCompanion(
  z: ZenerElement,
  nodeIndex: Map<string, number>,
  thermalV: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { conductance, currentSource } = zenerCompanionModel(
    z.vGuess,
    z.saturationCurrent,
    z.idealityFactor,
    thermalV,
    z.zenerVoltage,
    z.breakdownCurrent,
    z.breakdownIdeality,
  )
  stampJunctionCompanion(z.anodeNet, z.cathodeNet, conductance, currentSource, nodeIndex, M, b)
}

/**
 * A BJT resolved for the Newton-Raphson solve (S19-v3-36): its three terminal
 * nets + Ebers-Moll parameters + the current junction-voltage guesses.
 * Exported for the transient solver, which runs the same companion model
 * inside its per-time-step Newton-Raphson loop.
 */
export type BjtElement = {
  inst: Instance
  collectorNet: string
  baseNet: string
  emitterNet: string
  params: BjtParams
  /** kT/q at this junction's temperature (the global 298.15 K / 25 °C value by default). */
  thermalV: number
  /** 'pnp' is the same Ebers-Moll model with both junctions reversed. */
  polarity: 'npn' | 'pnp'
  /**
   * Current NR guesses in the FORWARD frame: for NPN these are the physical
   * V_BE / V_BC; for PNP they are the negated physical values (so the conducting
   * junction is positive either way and pnjlim's limiting applies unchanged).
   */
  vBE: number
  vBC: number
}

/**
 * Resolve an NPN BJT to the Ebers-Moll model, or null if it lacks the parameters
 * (saturation_current + forward_current_gain) or the collector/base/emitter
 * connects. Warm-started in the forward-active region.
 */
export function resolveBjt(inst: Instance, temperatureC?: number): BjtElement | null {
  let saturationCurrent = readScalarParam(inst, 'saturation_current')
  const betaForward = readScalarParam(inst, 'forward_current_gain')
  if (saturationCurrent === undefined || betaForward === undefined) return null
  if (saturationCurrent <= 0 || betaForward <= 0) return null
  const betaReverse = readScalarParam(inst, 'reverse_current_gain') ?? 1
  // Forward Early voltage V_AF (volts) — optional; a nonsense value (≤ 0)
  // disqualifies the part the same way a nonsense I_S or β does.
  const earlyVoltageForward = readScalarParam(inst, 'forward_early_voltage')
  if (earlyVoltageForward !== undefined && earlyVoltageForward <= 0) return null
  // Rest of the Gummel-Poon base charge — all optional, all disqualify on ≤ 0:
  // reverse Early V_AR plus the forward/reverse high-injection knee currents.
  const earlyVoltageReverse = readScalarParam(inst, 'reverse_early_voltage')
  if (earlyVoltageReverse !== undefined && earlyVoltageReverse <= 0) return null
  const kneeCurrentForward = readScalarParam(inst, 'forward_knee_current')
  if (kneeCurrentForward !== undefined && kneeCurrentForward <= 0) return null
  const kneeCurrentReverse = readScalarParam(inst, 'reverse_knee_current')
  if (kneeCurrentReverse !== undefined && kneeCurrentReverse <= 0) return null

  const collector = inst.connects?.find((c) => c.terminal === 'collector')
  const base = inst.connects?.find((c) => c.terminal === 'base')
  const emitter = inst.connects?.find((c) => c.terminal === 'emitter')
  if (collector === undefined || base === undefined || emitter === undefined) return null

  // With a junction temperature (the electro-thermal loop): V_T = kT/q and the
  // SPICE I_S(T) law at silicon's bandgap — the declared I_S is a 25 °C figure.
  let elementThermalV = thermalVoltage()
  if (temperatureC !== undefined) {
    const junctionKelvin = temperatureC + KELVIN_OFFSET
    saturationCurrent = scaleSaturationCurrent(
      saturationCurrent,
      junctionKelvin,
      ROOM_TEMPERATURE_KELVIN,
      1,
      SILICON_BANDGAP_EV,
    )
    elementThermalV = thermalVoltage(junctionKelvin)
  }

  return {
    inst,
    collectorNet: collector.net,
    baseNet: base.net,
    emitterNet: emitter.net,
    params: {
      saturationCurrent,
      betaForward,
      betaReverse,
      ...(earlyVoltageForward === undefined ? {} : { earlyVoltageForward }),
      ...(earlyVoltageReverse === undefined ? {} : { earlyVoltageReverse }),
      ...(kneeCurrentForward === undefined ? {} : { kneeCurrentForward }),
      ...(kneeCurrentReverse === undefined ? {} : { kneeCurrentReverse }),
    },
    thermalV: elementThermalV,
    polarity: inst.definition === 'transistor_bjt_pnp' ? 'pnp' : 'npn',
    vBE: 0.65,
    vBC: -0.65,
  }
}

/**
 * Stamp a BJT's Newton-Raphson companion (3-terminal): the 3×3 conductance block
 * ∂(I_C,I_B,I_E)/∂(V_C,V_B,V_E) plus equivalent current sources, across the
 * collector/base/emitter nodes (ground rows/cols omitted).
 *
 * Node-voltage partials come from the junction partials via V_BE = V_B−V_E and
 * V_BC = V_B−V_C; the per-terminal current source reduces to
 * I_X − (∂I_X/∂V_BE·V_BE + ∂I_X/∂V_BC·V_BC), depending only on the junction
 * voltages — the same Norton form the diode companion uses.
 */
export function stampBjtCompanion(
  bjt: BjtElement,
  nodeIndex: Map<string, number>,
  thermalV: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { vBE, vBC, params } = bjt
  const j = bjtCompanion(vBE, vBC, params, thermalV)
  // PNP: junction voltages are stored in the forward frame (negated physical),
  // which leaves every conductance entry identical to the NPN case — only the
  // physical currents (and so the equivalent current sources) flip sign.
  const sign = bjt.polarity === 'pnp' ? -1 : 1

  const g = {
    C: { C: -j.dIC_dVBC, B: j.dIC_dVBE + j.dIC_dVBC, E: -j.dIC_dVBE },
    B: { C: -j.dIB_dVBC, B: j.dIB_dVBE + j.dIB_dVBC, E: -j.dIB_dVBE },
    E: { C: 0, B: 0, E: 0 },
  }
  g.E.C = -(g.C.C + g.B.C)
  g.E.B = -(g.C.B + g.B.B)
  g.E.E = -(g.C.E + g.B.E)

  // SPICE GMIN floor: a 1 pS resistor across each junction (B-E and B-C), so the
  // base / collector can't float when the transistor is hard-off. Each conductance
  // is symmetric and row-sum-zero, so KCL is preserved; sub-pA, no bias shift.
  g.B.B += 2 * SOLVER_GMIN
  g.E.E += SOLVER_GMIN
  g.C.C += SOLVER_GMIN
  g.B.E -= SOLVER_GMIN
  g.E.B -= SOLVER_GMIN
  g.B.C -= SOLVER_GMIN
  g.C.B -= SOLVER_GMIN

  const ieqC = sign * (j.iC - (j.dIC_dVBE * vBE + j.dIC_dVBC * vBC))
  const ieqB = sign * (j.iB - (j.dIB_dVBE * vBE + j.dIB_dVBC * vBC))
  const ieq = { C: ieqC, B: ieqB, E: -(ieqC + ieqB) }

  const idx = {
    C: nodeIndex.get(bjt.collectorNet),
    B: nodeIndex.get(bjt.baseNet),
    E: nodeIndex.get(bjt.emitterNet),
  }
  const terminals = ['C', 'B', 'E'] as const
  for (const x of terminals) {
    const ix = idx[x]
    if (ix === undefined) continue
    b.set([ix, 0], (b.get([ix, 0]) ?? 0) - ieq[x])
    for (const y of terminals) {
      const iy = idx[y]
      if (iy === undefined) continue
      M.set([ix, iy], (M.get([ix, iy]) ?? 0) + g[x][y])
    }
  }
}

/**
 * A MOSFET resolved for the Newton-Raphson solve (S19-v3-66): its three
 * terminal nets + Level-1 parameters + the current bias guesses. Exported for
 * the transient solver, which runs the same companion inside its per-step
 * Newton-Raphson loop.
 *
 * Temperature laws (S20-v3-8): with a junction temperature from the
 * electro-thermal loop, k falls as (T/T₀)^−1.5 — carrier mobility limited by
 * phonon (lattice) scattering, the SPICE law M₀(T) = M₀(T₀)/(T/T₀)^1.5
 * (ngspice manual §1.4 "Analysis at different temperatures"; Sze, Physics of
 * Semiconductor Devices) — and V_th drifts by the part's declared
 * threshold_temperature_coefficient (datasheet-derived V/K). The two oppose:
 * just above threshold the V_th drop WINS (a hot MOSFET conducts more);
 * at strong gate drive the mobility fall WINS (it conducts less) — the
 * crossover is the zero-temperature-coefficient (ZTC) bias real datasheets
 * plot. No clamping on the V_th shift: crossing 0 V would take ~600 °C at the
 * cited −3.4 mV/°C, far past the over-temperature failure check.
 */
export type MosfetElement = {
  inst: Instance
  gateNet: string
  drainNet: string
  sourceNet: string
  params: MosfetParams
  /** Current NR bias guesses in the labeled frame (volts). */
  vGS: number
  vDS: number
}

/** Carrier mobility falls as T^−1.5 (phonon scattering) — the SPICE exponent. */
export const MOBILITY_TEMPERATURE_EXPONENT = -1.5

/**
 * Resolve a MOSFET to the Level-1 model, or null if it lacks the parameters
 * (threshold_voltage + transconductance_parameter) or its three connects.
 * Warm-started at 0 V bias (cutoff) — the step-limited NR walks it up.
 */
export function resolveMosfet(inst: Instance, temperatureC?: number): MosfetElement | null {
  let thresholdVoltage = readScalarParam(inst, 'threshold_voltage')
  let transconductance = readScalarParam(inst, 'transconductance_parameter')
  if (thresholdVoltage === undefined || transconductance === undefined) return null
  if (transconductance <= 0) return null
  const channelLengthModulation = readScalarParam(inst, 'channel_length_modulation') ?? 0
  if (channelLengthModulation < 0) return null // λ ≥ 0; a negative value flips the output conductance
  const velocitySaturationTheta = readScalarParam(inst, 'velocity_saturation_theta') ?? 0
  if (velocitySaturationTheta < 0) return null // θ ≥ 0; a negative value zeros the (1 + θ·V_OV) divisor → NaN

  // With a junction temperature (the electro-thermal loop): the declared k and
  // V_th are 25 °C figures; k scales by the mobility law, V_th drifts by the
  // part's declared coefficient (absent → no drift modeled, stated in the
  // fixture). See the MosfetElement doc for the laws and sources.
  if (temperatureC !== undefined) {
    const junctionKelvin = temperatureC + KELVIN_OFFSET
    transconductance *= (junctionKelvin / ROOM_TEMPERATURE_KELVIN) ** MOBILITY_TEMPERATURE_EXPONENT
    const thresholdTc = readScalarParam(inst, 'threshold_temperature_coefficient')
    if (thresholdTc !== undefined) {
      thresholdVoltage += thresholdTc * (temperatureC - STANDARD_AMBIENT_C)
    }
  }

  const gate = inst.connects?.find((c) => c.terminal === 'gate')
  const drain = inst.connects?.find((c) => c.terminal === 'drain')
  const source = inst.connects?.find((c) => c.terminal === 'source')
  if (gate === undefined || drain === undefined || source === undefined) return null

  return {
    inst,
    gateNet: gate.net,
    drainNet: drain.net,
    sourceNet: source.net,
    params: {
      channel: inst.definition === 'transistor_mosfet_pmos' ? 'pmos' : 'nmos',
      thresholdVoltage,
      transconductance,
      channelLengthModulation,
      velocitySaturationTheta,
    },
    vGS: 0,
    vDS: 0,
  }
}

/**
 * Resolve a JFET to the Level-1 depletion-mode model, or null if it lacks the parameters
 * (pinch_off_voltage + transconductance) or its three connects. A JFET shares the MOSFET square
 * law (jfet-model.ts), so it resolves to a MosfetElement and the same companion stamps + solves
 * it. Warm-started at 0 V bias — which for a depletion device is already conducting (~I_DSS).
 */
export function resolveJfet(inst: Instance, temperatureC?: number): MosfetElement | null {
  const pinchOffVoltage = readScalarParam(inst, 'pinch_off_voltage')
  let transconductance = readScalarParam(inst, 'transconductance')
  if (pinchOffVoltage === undefined || transconductance === undefined) return null
  if (transconductance <= 0) return null
  const channelLengthModulation = readScalarParam(inst, 'channel_length_modulation') ?? 0
  if (channelLengthModulation < 0) return null // λ ≥ 0; a negative value flips the output conductance
  // Carrier mobility falls as T^−1.5 (the same law as the MOSFET's k); the pinch-off tempco is left
  // to the fixture, not modeled here.
  if (temperatureC !== undefined) {
    transconductance *=
      ((temperatureC + KELVIN_OFFSET) / ROOM_TEMPERATURE_KELVIN) ** MOBILITY_TEMPERATURE_EXPONENT
  }

  const gate = inst.connects?.find((c) => c.terminal === 'gate')
  const drain = inst.connects?.find((c) => c.terminal === 'drain')
  const source = inst.connects?.find((c) => c.terminal === 'source')
  if (gate === undefined || drain === undefined || source === undefined) return null

  return {
    inst,
    gateNet: gate.net,
    drainNet: drain.net,
    sourceNet: source.net,
    params: jfetMosfetParams({
      channel: inst.definition === 'transistor_jfet_p_channel' ? 'p_channel' : 'n_channel',
      pinchOffVoltage,
      transconductance,
      channelLengthModulation,
    }),
    vGS: 0,
    vDS: 0,
  }
}

/**
 * A constant-current diode (current-limiting diode, e.g. the 1N5305) is not a PN diode at all — it
 * is an N-channel JFET with its gate tied to its source. V_GS is therefore pinned at 0, so the part
 * regulates to I_DSS = beta·V_P² (= the limiting current I_P) once the voltage across it exceeds the
 * knee. We model exactly that: an N-JFET MosfetElement whose gate AND source share the cathode net
 * (so the companion's g_m terms cancel, leaving a current source with the small output slope λ),
 * with the anode as drain. beta is recovered from the datasheet I_P and knee voltage: beta = I_P/V_K².
 */
export function resolveCrd(inst: Instance, temperatureC?: number): MosfetElement | null {
  const limitingCurrent = readScalarParam(inst, 'limiting_current')
  const kneeVoltage = readScalarParam(inst, 'knee_voltage')
  if (limitingCurrent === undefined || kneeVoltage === undefined) return null
  if (limitingCurrent <= 0 || kneeVoltage <= 0) return null
  const channelLengthModulation = readScalarParam(inst, 'channel_length_modulation') ?? 0
  if (channelLengthModulation < 0) return null // λ ≥ 0; a negative value flips the output conductance
  let transconductance = limitingCurrent / (kneeVoltage * kneeVoltage)
  // Carrier mobility falls as T^−1.5 (the same law as the MOSFET's k).
  if (temperatureC !== undefined) {
    transconductance *=
      ((temperatureC + KELVIN_OFFSET) / ROOM_TEMPERATURE_KELVIN) ** MOBILITY_TEMPERATURE_EXPONENT
  }

  const anode = inst.connects?.find((c) => c.terminal === 'anode')
  const cathode = inst.connects?.find((c) => c.terminal === 'cathode')
  if (anode === undefined || cathode === undefined) return null

  return {
    inst,
    gateNet: cathode.net,
    drainNet: anode.net,
    sourceNet: cathode.net,
    params: jfetMosfetParams({
      channel: 'n_channel',
      pinchOffVoltage: -kneeVoltage,
      transconductance,
      channelLengthModulation,
    }),
    vGS: 0,
    vDS: 0,
  }
}

/**
 * Stamp a MOSFET's Newton-Raphson companion: the linearized drain current
 *   I_D ≈ I_D₀ + g_m·(v_G − v_S) + g_ds·(v_D − v_S)
 * enters the drain node and leaves the source node; the insulated gate
 * carries no DC current (its column appears only through g_m). Ground
 * rows/cols are omitted, the same Norton form every companion here uses.
 */
export function stampMosfetCompanion(
  fet: MosfetElement,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const op = mosfetOperatingPoint(fet.vGS, fet.vDS, fet.params)
  const ieq = op.iD - op.gm * fet.vGS - op.gds * fet.vDS
  const iG = nodeIndex.get(fet.gateNet)
  const iD = nodeIndex.get(fet.drainNet)
  const iS = nodeIndex.get(fet.sourceNet)

  const add = (row: number | undefined, col: number | undefined, value: number) => {
    if (row === undefined || col === undefined) return
    M.set([row, col], (M.get([row, col]) ?? 0) + value)
  }
  add(iD, iG, op.gm)
  add(iD, iD, op.gds)
  add(iD, iS, -(op.gm + op.gds))
  add(iS, iG, -op.gm)
  add(iS, iD, -op.gds)
  add(iS, iS, op.gm + op.gds)
  if (iD !== undefined) b.set([iD, 0], (b.get([iD, 0]) ?? 0) - ieq)
  if (iS !== undefined) b.set([iS, 0], (b.get([iS, 0]) ?? 0) + ieq)
}

// ---------------------------------------------------------------------------
// Internal helpers — exposed for unit testing
// ---------------------------------------------------------------------------

/**
 * Find the net to use as ground (§18.2 precedence, Sprint 16):
 *   1. options.ground if provided (must reference an existing net)
 *   2. The net connected to a ground port (definition: 'ground') — the
 *      explicit, EDA-authentic designation
 *   3. The first net with type: 'ground' (backward-compat fallback)
 *   4. undefined → caller returns 'no-ground' status
 *
 * Multiple ground ports / multiple type: ground nets each produce a warning
 * and use the first one deterministically.
 */
export function identifyGround(
  world: World,
  options: SolveOptions | undefined,
  warnings: string[],
): string | undefined {
  if (options?.ground !== undefined) {
    if (!world.nets.has(options.ground)) {
      warnings.push(`SolveOptions.ground references unknown net '${options.ground}'`)
      return undefined
    }
    return options.ground
  }

  // (2) Ground ports — the net a ground reference marker attaches to. Several
  // ground SYMBOLS that resolve to the same net are one ground node (the canvas
  // collapses every ground symbol onto a single net), so dedupe to distinct nets
  // before deciding whether there are genuinely multiple, separate references.
  const portNets = new Set<string>()
  for (const inst of world.instances.values()) {
    if (inst.definition !== 'ground') continue
    const net = inst.connects?.[0]?.net
    if (net !== undefined && world.nets.has(net)) portNets.add(net)
  }
  if (portNets.size > 0) {
    const distinct = [...portNets]
    if (distinct.length > 1) {
      warnings.push(
        `Multiple ground ports found (nets ${distinct.join(', ')}); using '${distinct[0]}' (deterministic first).`,
      )
    }
    // biome-ignore lint/style/noNonNullAssertion: size checked above
    return distinct[0]!
  }

  // (3) type: ground net property — backward-compatible fallback.
  const groundNets: string[] = []
  for (const net of world.nets.values()) {
    if (net.type === 'ground') groundNets.push(net.id)
  }
  if (groundNets.length === 0) return undefined
  if (groundNets.length > 1) {
    warnings.push(
      `Multiple type: ground nets found (${groundNets.join(', ')}); using '${groundNets[0]}' (deterministic first).`,
    )
  }
  // biome-ignore lint/style/noNonNullAssertion: length checked above
  return groundNets[0]!
}

/** Build the netId → node-index map, excluding the ground net. */
export function assignNodeIndices(nets: Map<string, Net>, ground: string): Map<string, number> {
  const map = new Map<string, number>()
  let i = 0
  for (const netId of nets.keys()) {
    if (netId === ground) continue
    map.set(netId, i++)
  }
  return map
}

/**
 * Apply a resistor's contribution to the MNA matrix M.
 * Per §18.4: stamp +1/R at [A][A] and [B][B], -1/R at [A][B] and [B][A].
 * Rows/columns for the ground net are omitted (the node index map excludes ground).
 *
 * Returns true if the stamp was applied; false if the resistor's R value or
 * connects are missing or malformed.
 */
/**
 * The bare conductance stamp (§18.4): +1/R on the two diagonals, −1/R on the
 * off-diagonals, ground rows/columns omitted. The shared core of every linear
 * resistive element (a plain resistor, each segment of a potentiometer).
 */
export function stampConductance(
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  netA: string,
  netB: string,
  ohms: number,
): void {
  if (!(ohms > 0)) return // a non-positive resistance would stamp an infinite conductance
  const G = 1 / ohms
  const i_a = nodeIndex.get(netA) // undefined when net is ground (excluded)
  const i_b = nodeIndex.get(netB)
  if (i_a !== undefined) M.set([i_a, i_a], (M.get([i_a, i_a]) ?? 0) + G)
  if (i_b !== undefined) M.set([i_b, i_b], (M.get([i_b, i_b]) ?? 0) + G)
  if (i_a !== undefined && i_b !== undefined) {
    M.set([i_a, i_b], (M.get([i_a, i_b]) ?? 0) - G)
    M.set([i_b, i_a], (M.get([i_b, i_a]) ?? 0) - G)
  }
}

/** Definitions modeled as a light-driven current source (photoconductive mode). */
export const LIGHT_CURRENT_DEFINITIONS: ReadonlySet<string> = new Set([
  'photodiode',
  'phototransistor',
])

/** The from→to terminal pair a light current source drives between — the
 *  direction the photocurrent flows inside the device (a photodiode sinks
 *  cathode→anode, a phototransistor collector→emitter). */
export function lightCurrentTerminals(definition: string): [string, string] {
  return definition === 'phototransistor' ? ['collector', 'emitter'] : ['cathode', 'anode']
}

/**
 * A photodiode / phototransistor: a current `lightSensorCurrent(inst)` driven from
 * `fromTerminal` to `toTerminal` by the light on it (a Norton current injection
 * into b), in parallel with the part's shunt resistance (its real off-state path,
 * and numerical safety so an isolated sensor's node can't float). The current
 * LEAVES `from` and ENTERS `to` — so a node fed through a load resistor drops as
 * the light rises, the photoconductive response.
 */
export function stampLightCurrentSource(
  inst: Instance,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
  fromTerminal: string,
  toTerminal: string,
): boolean {
  const fromNet = inst.connects?.find((c) => c.terminal === fromTerminal)?.net
  const toNet = inst.connects?.find((c) => c.terminal === toTerminal)?.net
  if (fromNet === undefined || toNet === undefined) return false
  const shunt = readScalarParam(inst, 'shunt_resistance')
  if (shunt !== undefined && shunt > 0) stampConductance(nodeIndex, M, fromNet, toNet, shunt)
  const amps = lightSensorCurrent(inst)
  const iFrom = nodeIndex.get(fromNet)
  const iTo = nodeIndex.get(toNet)
  if (iFrom !== undefined) b.set([iFrom, 0], (b.get([iFrom, 0]) ?? 0) - amps)
  if (iTo !== undefined) b.set([iTo, 0], (b.get([iTo, 0]) ?? 0) + amps)
  return true
}

export function stampResistor(
  inst: Instance,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
): boolean {
  // A photoresistor is a resistor whose resistance comes from the light on it
  // (the LDR power law), not a declared `resistance` — everything else is identical.
  const R =
    inst.definition === 'photoresistor' ? ldrResistance(inst) : readScalarParam(inst, 'resistance')
  if (R === undefined || R <= 0) return false

  if (inst.connects?.length !== 2) return false
  const c1 = inst.connects[0]
  const c2 = inst.connects[1]
  if (c1 === undefined || c2 === undefined) return false

  stampConductance(nodeIndex, M, c1.net, c2.net, R)
  return true
}

/**
 * A DC motor at steady state. The coupled electromechanical equations collapse to a
 * single linear element: the conductance of R_eff = R_a + k²/B between its terminals
 * (the back-EMF raises the effective resistance above the bare winding R_a), plus a
 * constant current source for any mechanical load (which draws extra current, + to −).
 */
export function stampMotor(
  inst: Instance,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const p = motorParamsFromInstance(inst)
  if (p === undefined) return false
  const posNet = inst.connects?.find((c) => c.terminal === 'terminal_positive')?.net
  const negNet = inst.connects?.find((c) => c.terminal === 'terminal_negative')?.net
  if (posNet === undefined || negNet === undefined) return false
  stampConductance(nodeIndex, M, posNet, negNet, motorEffectiveResistance(p))
  const offset = motorLoadCurrentOffset(p)
  if (offset !== 0) {
    const iPos = nodeIndex.get(posNet)
    const iNeg = nodeIndex.get(negNet)
    if (iPos !== undefined) b.set([iPos, 0], (b.get([iPos, 0]) ?? 0) - offset)
    if (iNeg !== undefined) b.set([iNeg, 0], (b.get([iNeg, 0]) ?? 0) + offset)
  }
  return true
}

/**
 * A DC generator (dynamo) spun at a fixed speed: a Thévenin source — the EMF E = k·ω behind
 * the armature resistance R_a — stamped as its Norton equivalent (conductance 1/R_a between
 * the terminals + a current source E/R_a pushing current OUT of the + terminal, into the
 * external circuit). The same {conductance, current-source} shape as the motor's load offset,
 * but here the current is the GENERATED one, not a draw.
 */
export function stampGenerator(
  inst: Instance,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const p = generatorParamsFromInstance(inst)
  if (p === undefined) return false
  const posNet = inst.connects?.find((c) => c.terminal === 'terminal_positive')?.net
  const negNet = inst.connects?.find((c) => c.terminal === 'terminal_negative')?.net
  if (posNet === undefined || negNet === undefined) return false
  stampConductance(nodeIndex, M, posNet, negNet, p.armatureResistance)
  const nortonCurrent = generatorEmf(p) / p.armatureResistance
  if (nortonCurrent !== 0) {
    const iPos = nodeIndex.get(posNet)
    const iNeg = nodeIndex.get(negNet)
    if (iPos !== undefined) b.set([iPos, 0], (b.get([iPos, 0]) ?? 0) + nortonCurrent)
    if (iNeg !== undefined) b.set([iNeg, 0], (b.get([iNeg, 0]) ?? 0) - nortonCurrent)
  }
  return true
}

/**
 * A real pot's wiper end resistance (Ω): the track never reaches exactly 0 Ω
 * at the travel limits, so each segment is floored here and is never an ideal
 * short. Small enough to be invisible mid-travel.
 */
export const POT_END_OHMS = 0.5

/**
 * A potentiometer's two segment resistances from its total + wiper position:
 * R_top = R·p (terminal_a→wiper), R_bottom = R·(1−p) (wiper→terminal_b), each
 * floored at POT_END_OHMS. Null when the total resistance is missing/invalid.
 */
export function potentiometerSegments(inst: Instance): { top: number; bottom: number } | null {
  const total = readScalarParam(inst, 'resistance')
  if (total === undefined || total <= 0) return null
  const p = Math.min(1, Math.max(0, readScalarParam(inst, 'wiper_position') ?? 0.5))
  return {
    top: Math.max(total * p, POT_END_OHMS),
    bottom: Math.max(total * (1 - p), POT_END_OHMS),
  }
}

/**
 * Stamp a potentiometer as two series conductances sharing the wiper net —
 * the real linear-taper track. No new physics, no aux variable. The wiper must
 * be wired; each end segment is stamped only when its end is wired too, so a
 * two-terminal rheostat (wiper + one end, the other end left floating) is the
 * single wired segment. Returns false if nothing could be stamped.
 */
export function stampPotentiometer(
  inst: Instance,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
): boolean {
  const seg = potentiometerSegments(inst)
  if (seg === null) return false
  const connects = inst.connects ?? []
  const a = connects.find((c) => c.terminal === 'terminal_a')?.net
  const w = connects.find((c) => c.terminal === 'wiper')?.net
  const b = connects.find((c) => c.terminal === 'terminal_b')?.net
  if (w === undefined) return false
  let stamped = false
  if (a !== undefined) {
    stampConductance(nodeIndex, M, a, w, seg.top)
    stamped = true
  }
  if (b !== undefined) {
    stampConductance(nodeIndex, M, w, b, seg.bottom)
    stamped = true
  }
  return stamped
}

/**
 * Apply a voltage source's contribution to the MNA matrix M + source vector b,
 * using an auxiliary current variable at index `auxIdx` (where auxIdx ≥ N,
 * positioned after all node indices).
 *
 * Per §18.4, the stamp pattern is:
 *   M[A][aux] = +1, M[B][aux] = -1   (current contribution to KCL rows)
 *   M[aux][A] = +1, M[aux][B] = -1   (constraint: V_A - V_B = V_src)
 *   b[aux]    = V_src
 * where A is the positive terminal's net and B is the negative terminal's.
 * Rows/columns for the ground net are omitted (the node index map excludes ground).
 *
 * Sprint 14's terminal-polarity convention for power_source: the connects
 * entry with `terminal === 'terminal_positive'` is the positive terminal;
 * `terminal === 'terminal_negative'` is the negative. (Terminal-name
 * validation as a §15 row will eventually generalize this; for now the
 * convention is hard-coded per device kind.)
 *
 * Returns true if the stamp was applied; false if the source's voltage,
 * connects, or terminal-polarity convention can't be resolved.
 */
export function stampVoltageSource(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const V = readScalarParam(inst, 'nominal_voltage')
  if (V === undefined) return false
  // A real source has series internal resistance: the terminal voltage droops
  // under load and a short is current-limited (V / r_internal, not infinite).
  // Absent / 0 → an ideal source.
  const internalResistance = readScalarParam(inst, 'internal_resistance') ?? 0
  return findAndStampVoltageSource(
    inst,
    nodeIndex,
    auxIdx,
    V,
    'terminal_positive',
    'terminal_negative',
    M,
    b,
    internalResistance,
  )
}

/**
 * Apply an LED's contribution using the fixed-V_F approximation (§18.4 / §18.7).
 * Stamps identically to a voltage source with V_src = forward_voltage, between
 * the LED's anode (positive) and cathode (negative) terminals.
 *
 * Returns true if the stamp landed; false if forward_voltage is missing or the
 * connects don't follow the anode/cathode convention.
 */
export function stampLED(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const V_F = readScalarParam(inst, 'forward_voltage')
  if (V_F === undefined) return false
  return findAndStampVoltageSource(inst, nodeIndex, auxIdx, V_F, 'anode', 'cathode', M, b)
}

/**
 * A struck carbon arc's contribution: it burns at a near-constant arc voltage, so it stamps as a
 * fixed voltage DROP (arc_voltage) from anode to cathode — exactly the LED's fixed-V_F stamp, but
 * the drop is the arc's burning voltage, not a junction forward voltage. The external ballast sets
 * the current; an extinguished arc is never stamped (it is omitted, an open circuit). The
 * current-dependent fall V = V_min + b/I (negative resistance) is a documented next rung.
 */
export function stampArc(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const V_arc = readScalarParam(inst, 'arc_voltage') ?? readScalarParam(inst, 'maintaining_voltage')
  if (V_arc === undefined) return false
  return findAndStampVoltageSource(inst, nodeIndex, auxIdx, V_arc, 'anode', 'cathode', M, b)
}

/**
 * A CRT's electrical load: the electron gun draws a beam current from the anode (EHT) to the cathode
 * — the beam-current rating times the grid-bias brightness — and the X/Y deflection plates are
 * high-impedance inputs (a large resistance to the cathode). Linear, no Newton; the spot position and
 * brightness are derived post-solve from the deflection + anode voltages (crt-model.ts).
 */
export function stampCrt(
  inst: Instance,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const p = crtParamsFromInstance(inst)
  if (p === undefined) return false
  const net = (t: string) => inst.connects?.find((c) => c.terminal === t)?.net
  const cathode = net('cathode')
  const anode = net('anode')
  if (cathode === undefined || anode === undefined) return false
  const xDef = net('x_deflect')
  const yDef = net('y_deflect')
  if (xDef !== undefined) stampConductance(nodeIndex, M, xDef, cathode, CRT_DEFLECTION_INPUT_OHMS)
  if (yDef !== undefined) stampConductance(nodeIndex, M, yDef, cathode, CRT_DEFLECTION_INPUT_OHMS)
  const beamCurrent = p.beamCurrent * gridBrightness(p.gridBias, p.gridCutoffVoltage)
  if (beamCurrent !== 0) {
    const iAnode = nodeIndex.get(anode)
    const iCathode = nodeIndex.get(cathode)
    if (iAnode !== undefined) b.set([iAnode, 0], (b.get([iAnode, 0]) ?? 0) - beamCurrent)
    if (iCathode !== undefined) b.set([iCathode, 0], (b.get([iCathode, 0]) ?? 0) + beamCurrent)
  }
  return true
}

/**
 * Apply a closed switch's contribution. Only closed switches reach here (the
 * pre-pass omits open ones, leaving an open circuit). Stamps identically to
 * an ideal 0 V voltage source between terminal_in (treated as positive) and
 * terminal_out (treated as negative), enforcing V_in = V_out — the
 * short-circuit / net-merge equivalent via the MNA mechanism.
 *
 * Returns true if the stamp landed; false if connects don't follow the
 * terminal_in / terminal_out convention.
 */
export function stampClosedSwitch(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  return findAndStampVoltageSource(inst, nodeIndex, auxIdx, 0, 'terminal_in', 'terminal_out', M, b)
}

/**
 * Stamp an SPDT selector: a 0 V short from the common pole to the SELECTED
 * throw (position 'throw_b' → throw_b, anything else → throw_a). The
 * unselected throw is never stamped, so it stays an open contact on its own
 * net. Break-before-make — exactly one throw is ever connected.
 */
export function stampSpdt(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const throwTerminal = readEnumParam(inst, 'position') === 'throw_b' ? 'throw_b' : 'throw_a'
  return findAndStampVoltageSource(inst, nodeIndex, auxIdx, 0, 'common', throwTerminal, M, b)
}

/**
 * Stamp a relay's COIL: a 0 V source carrying its coil_resistance between coil_a
 * and coil_b — the winding is just a resistor to the steady solve, and its aux
 * current (= the coil current) is what the relay loop checks against the pull-in
 * threshold. Absent coil_resistance falls back to an ideal short (degenerate).
 */
export function stampRelayCoil(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const coilResistance = readScalarParam(inst, 'coil_resistance') ?? 0
  return findAndStampVoltageSource(
    inst,
    nodeIndex,
    auxIdx,
    0,
    'coil_a',
    'coil_b',
    M,
    b,
    coilResistance,
  )
}

/**
 * Stamp a relay's CONTACTS: a 0 V short (carrying contact_resistance) from the
 * common pole to whichever throw the coil state selects — normally_open when
 * energized, normally_closed at rest. The other throw is never stamped, so it
 * stays an open contact: break-before-make, exactly like the SPDT.
 */
export function stampRelayContact(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const liveThrow = relayCoilEnergized(inst) ? 'normally_open' : 'normally_closed'
  const contactResistance = readScalarParam(inst, 'contact_resistance') ?? 0
  return findAndStampVoltageSource(
    inst,
    nodeIndex,
    auxIdx,
    0,
    'common',
    liveThrow,
    M,
    b,
    contactResistance,
  )
}

/**
 * Apply a wire's contribution: a 0 V source carrying its real series resistance
 * between terminal_a and terminal_b, so the wire drops a real I·R voltage like
 * any conductor (R = ρL/A, supplied per-instance from how the wire is drawn).
 * A long, thin, or heavily-loaded wire droops measurably; a short one drops
 * microvolts. Absent resistance ⇒ an ideal 0 Ω short (V_a = V_b) — the same
 * stamp the fixtures' ideal hookup wires use.
 *
 * Modeling the wire as a 0 V source + series R (rather than a bare conductance)
 * keeps the matrix well-conditioned even for sub-milliohm wires and surfaces the
 * wire's own branch current as the auxiliary variable.
 *
 * Returns true if the stamp landed; false if connects don't follow the
 * terminal_a / terminal_b convention.
 */
export function stampWire(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const seriesResistance = readScalarParam(inst, 'resistance') ?? 0
  return findAndStampVoltageSource(
    inst,
    nodeIndex,
    auxIdx,
    0,
    'terminal_a',
    'terminal_b',
    M,
    b,
    seriesResistance,
  )
}

/**
 * Apply an INTACT fuse's contribution: a 0 V source carrying its small cold
 * element_resistance between terminal_a and terminal_b — exactly the wire stamp,
 * so the fuse's branch current is the auxiliary variable and it drops a real
 * I·R. Absent element_resistance ⇒ an ideal 0 Ω link. A BLOWN fuse is never
 * stamped (it is omitted from linearVoltageSources, an open circuit).
 */
export function stampFuse(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const elementResistance = readScalarParam(inst, 'element_resistance') ?? 0
  return findAndStampVoltageSource(
    inst,
    nodeIndex,
    auxIdx,
    0,
    'terminal_a',
    'terminal_b',
    M,
    b,
    elementResistance,
  )
}

/**
 * Apply an inductor's DC steady-state contribution. At DC, di/dt = 0 so the
 * ideal inductance drops nothing (v = L·di/dt = 0) — what remains is the
 * winding's real series resistance (the coiled wire's R = ρL/A). Stamps as a
 * 0 V source carrying winding_resistance between terminal_a and terminal_b,
 * the same pattern as a wire. Time-varying behavior lives in the transient
 * solver's backward-Euler companion.
 *
 * Returns true if the stamp landed; false if connects don't follow the
 * terminal_a / terminal_b convention.
 */
export function stampInductorDC(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const windingResistance = readScalarParam(inst, 'winding_resistance') ?? 0
  return findAndStampVoltageSource(
    inst,
    nodeIndex,
    auxIdx,
    0,
    'terminal_a',
    'terminal_b',
    M,
    b,
    windingResistance,
  )
}

/**
 * Apply one transformer winding's DC steady-state contribution: at steady DC
 * nothing couples (di/dt = 0), so each winding is independently a 0 V source in
 * series with its own winding resistance. The transient solver carries the
 * mutual-inductance coupling.
 */
export function stampTransformerWindingDC(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  winding: 'primary' | 'secondary',
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const resistance = readScalarParam(inst, `${winding}_resistance`) ?? 0
  return findAndStampVoltageSource(
    inst,
    nodeIndex,
    auxIdx,
    0,
    `${winding}_a`,
    `${winding}_b`,
    M,
    b,
    resistance,
  )
}

/**
 * Apply one half of a center-tapped primary at DC: a 0 V source through HALF the
 * end-to-end primary resistance (each half is half the winding). Half 'a' spans
 * primary_a → primary_ct; half 'b' spans primary_ct → primary_b.
 */
export function stampCtHalfDC(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  half: 'a' | 'b',
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  const halfResistance = (readScalarParam(inst, 'primary_resistance') ?? 0) / 2
  const [from, to] = half === 'a' ? ['primary_a', 'primary_ct'] : ['primary_ct', 'primary_b']
  return findAndStampVoltageSource(
    inst,
    nodeIndex,
    auxIdx,
    0,
    from as string,
    to as string,
    M,
    b,
    halfResistance,
  )
}

/**
 * Shared MNA-stamp helper for all voltage-source-like elements. Finds the
 * positive and negative connects by terminal-name convention and stamps
 * §18.4's pattern. Terminal lookup is by name, so multi-winding devices
 * (a transformer's 4 connects) stamp one named pair at a time.
 */
function findAndStampVoltageSource(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  voltageValue: number,
  positiveTerminal: string,
  negativeTerminal: string,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
  seriesResistance = 0,
): boolean {
  if (inst.connects === undefined) return false

  const posConnect = inst.connects.find((c) => c.terminal === positiveTerminal)
  const negConnect = inst.connects.find((c) => c.terminal === negativeTerminal)
  if (posConnect === undefined || negConnect === undefined) return false

  // i_pos / i_neg are undefined when the corresponding net is ground
  // (excluded from the node index per the MNA convention).
  const i_pos = nodeIndex.get(posConnect.net)
  const i_neg = nodeIndex.get(negConnect.net)

  if (i_pos !== undefined) {
    M.set([i_pos, auxIdx], (M.get([i_pos, auxIdx]) ?? 0) + 1)
    M.set([auxIdx, i_pos], (M.get([auxIdx, i_pos]) ?? 0) + 1)
  }
  if (i_neg !== undefined) {
    M.set([i_neg, auxIdx], (M.get([i_neg, auxIdx]) ?? 0) - 1)
    M.set([auxIdx, i_neg], (M.get([auxIdx, i_neg]) ?? 0) - 1)
  }

  // Constraint: V_pos - V_neg = V_src - I·R_series. With no series resistance
  // this is the ideal source V_pos - V_neg = V_src. The branch current I (the aux
  // variable) reads negative when the source delivers, so a series internal
  // resistance droops the terminal under load via a -R_series term on the aux
  // diagonal (sign verified against the solved anchor circuit).
  if (seriesResistance !== 0) {
    M.set([auxIdx, auxIdx], (M.get([auxIdx, auxIdx]) ?? 0) - seriesResistance)
  }
  b.set([auxIdx, 0], voltageValue)

  return true
}

/**
 * Compute a resistor's branch current from solved node voltages.
 * Per §18.6: positive = current from terminal_a toward terminal_b.
 * I = (V_a - V_b) / R.
 *
 * Returns undefined if R is missing/non-positive, connects are malformed,
 * or either terminal's net voltage isn't resolved (shouldn't happen after
 * a successful solve, but defensive).
 */
export function computeResistorCurrent(
  inst: Instance,
  nodes: Map<string, number>,
): number | undefined {
  const R =
    inst.definition === 'photoresistor' ? ldrResistance(inst) : readScalarParam(inst, 'resistance')
  if (R === undefined || R <= 0) return undefined

  if (inst.connects?.length !== 2) return undefined
  const aConnect = inst.connects.find((c) => c.terminal === 'terminal_a')
  const bConnect = inst.connects.find((c) => c.terminal === 'terminal_b')
  if (aConnect === undefined || bConnect === undefined) return undefined

  const V_a = nodes.get(aConnect.net)
  const V_b = nodes.get(bConnect.net)
  if (V_a === undefined || V_b === undefined) return undefined

  return (V_a - V_b) / R
}
