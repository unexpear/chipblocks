/**
 * DC solver — Modified Nodal Analysis for linear circuits.
 *
 * Per OBJECT-MODEL.md §18. Sprint 14 MVP scope: resistors + voltage sources
 * + wires + LEDs (fixed-V_F approximation) + switches (open/closed state). Single
 * deterministic linear solve via mathjs's lusolve. Nonlinear iterative
 * solving (Shockley + Newton-Raphson + pnjlim) lands in Sprint 15.
 *
 * Per the "real all the way down" principle: the solver doesn't fake passes.
 * Unsupported elements surface 'unsupported-element' rather than silently
 * producing wrong results. No silent ground default — a circuit with no
 * type: ground net returns status 'no-ground' without attempting to solve.
 *
 * S14-v3-3 scaffold: types + ground identification + node-index assignment
 * + resistor stamps + lusolve smoke test.
 * S14-v3-4 voltage source: pre-pass counts voltage sources, matrix grows
 * to (N + S) × (N + S), each source extends the system with one auxiliary
 * current variable per §18.4's modified-nodal stamp pattern.
 * S14-v3-5 adds three more voltage-source-like elements sharing the same
 * MNA stamp pattern:
 *   - LED (fixed-V_F approximation): stamps as voltage source with
 *     V = forward_voltage between anode (+) and cathode (-).
 *   - Switch (SPST): reads its open/closed state (S19). A closed switch stamps
 *     as an ideal 0 V source between terminal_in and terminal_out; an open
 *     switch is omitted entirely, leaving a real open circuit (no current).
 *   - Wire (S19-v3-32): stamps as a 0 V source carrying its real series
 *     resistance (R = ρL/A) between terminal_a and terminal_b, so the wire
 *     drops a real I·R voltage. Absent resistance falls back to an ideal 0 V
 *     short (the fixtures' ideal hookup wires); the canvas supplies each drawn
 *     wire's resistance from its length + conductor, so long/thin/loaded wires
 *     droop measurably.
 * S14-v3-6 extracts branch currents into the Solution.branches map. The
 * sign convention is fixed by the MNA stamp pattern: positive current
 * flows from positive terminal (anode / terminal_positive / terminal_a /
 * terminal_in) toward the negative terminal. For resistors compute
 * I = (V_pos - V_neg) / R; for voltage-source-like elements the
 * auxiliary current variable x[N+s] is already in this convention.
 */

import { all, create } from 'mathjs'
import { type BjtParams, bjtCompanion, bjtCurrents } from './bjt-model.ts'
import type { Instance, Net, World } from './cross-fk-validator.ts'
import {
  companionModel,
  criticalVoltage,
  deriveSaturationCurrent,
  diodeCurrent,
  pnjlim,
  ROOM_TEMPERATURE_KELVIN,
  scaleSaturationCurrent,
  thermalVoltage,
} from './diode-model.ts'
import { readEnumParam, readScalarParam } from './instance-params.ts'
import { limitMosfetStep, type MosfetParams, mosfetOperatingPoint } from './mosfet-model.ts'
import { STANDARD_AMBIENT_C } from './thermal-model.ts'

/**
 * A switch conducts only when closed. State lives on the instance as
 * `state: open|closed` (a runtime/canvas concern per the switches_circuit
 * behavior); absent state defaults to closed, so existing fixtures + the loaded
 * anchor circuit keep conducting. An OPEN switch is simply not stamped — its two
 * terminals stay on separate nets, i.e. a real open circuit.
 */
function switchIsClosed(inst: Instance): boolean {
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
const DEFAULT_IDEALITY_FACTOR = 2.0 // LEDs (§20.2); optional per-instance override

// biome-ignore lint/style/noNonNullAssertion: mathjs `all` is always defined at runtime
const math = create(all!)

/** Exposed for tests so they can drive mathjs's linear algebra directly. */
export const mathInstance = math

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
   * fall ≈2 mV/°C. Absent (the default): 300 K behavior, unchanged.
   */
  temperaturesC?: Map<string, number>
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
type ShockleyLed = {
  inst: Instance
  anodeNet: string
  cathodeNet: string
  saturationCurrent: number
  idealityFactor: number
  /** kT/q at this junction's temperature (the global 300 K value by default). */
  thermalV: number
  /** Current Newton-Raphson voltage guess (anode − cathode). */
  vGuess: number
}

/** The pn-junction family the DC solver runs through the Shockley + NR path. */
const SHOCKLEY_DIODE_DEFINITIONS = new Set([
  'led',
  'led_uv_algan',
  'diode_silicon_rectifier',
  'diode_schottky_al_si',
])

export function solveDC(world: World, options?: SolveOptions): Solution {
  const warnings: string[] = []

  const ground = identifyGround(world, options, warnings)
  if (ground === undefined) {
    return emptyResult('no-ground', undefined, warnings)
  }

  const nodeIndex = assignNodeIndices(world.nets, ground)
  const N = nodeIndex.size

  // A circuit with only the ground net has no unknowns — return trivially.
  if (N === 0) {
    return {
      status: 'solved',
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
  const linearVoltageSources: Array<{ inst: Instance; kind: VsLikeKind }> = []
  const shockleyLeds: ShockleyLed[] = []
  const bjts: BjtElement[] = []
  const mosfets: MosfetElement[] = []

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
      // Three-terminal selector (common + two throws): the selected
      // common→throw pair stamps as a closed switch (below); the other throw
      // is left unstamped — a real open contact on its own net.
      if (inst.connects?.length === 3) linearVoltageSources.push({ inst, kind: 'switch_spdt' })
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
    if (inst.connects?.length !== 2) continue

    if (inst.definition === 'power_source') {
      linearVoltageSources.push({ inst, kind: 'power_source' })
    } else if (SHOCKLEY_DIODE_DEFINITIONS.has(inst.definition)) {
      // The whole pn-junction family (LEDs, the silicon rectifier, Schottky)
      // shares the Shockley law — only the calibration point differs.
      const led = resolveShockleyLed(inst, thermalV, options?.temperaturesC?.get(inst.id))
      if (led !== null) shockleyLeds.push(led)
      else linearVoltageSources.push({ inst, kind: 'led' }) // fixed-V_F fallback
    } else if (inst.definition === 'diode_zener_silicon') {
      // A zener EXISTS to regulate in reverse breakdown — which isn't modeled
      // yet. Solving it as a plain forward diode would misrepresent the part,
      // so it is skipped honestly (matching the transient solver's posture).
      warnings.push(`Skipped zener '${inst.id}' — reverse-breakdown regulation is not solvable yet`)
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
    } else if (inst.definition === 'inductor') {
      // DC steady state of v = L·di/dt is 0 V across the ideal inductance —
      // an inductor conducts DC, dropping only its winding resistance.
      linearVoltageSources.push({ inst, kind: 'inductor' })
    }
  }
  const S = linearVoltageSources.length

  // buildAndSolve stamps resistors + linear voltage sources + (optionally) the
  // Shockley companion models at their current guesses, then solves. Returns
  // the node-voltage map + the raw solution array (for aux currents), or null
  // on a singular matrix.
  const buildAndSolve = (): { nodes: Map<string, number>; xArr: number[][] } | null => {
    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
    const M: any = math.zeros(N + S, N + S)
    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
    const b: any = math.zeros(N + S, 1)

    for (const inst of world.instances.values()) {
      // A thermistor stamps exactly like a resistor — its `resistance` is the
      // Beta-law value the electro-thermal loop already wrote for this temperature.
      if (inst.definition === 'resistor' || inst.definition === 'thermistor') {
        const ok = stampResistor(inst, nodeIndex, M)
        if (!ok)
          warnings.push(`Skipped resistor stamp for instance '${inst.id}' (missing R or connects)`)
      } else if (inst.definition === 'potentiometer') {
        const ok = stampPotentiometer(inst, nodeIndex, M)
        if (!ok)
          warnings.push(`Skipped potentiometer '${inst.id}' (missing resistance or connects)`)
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
      if (!ok)
        warnings.push(
          `Skipped ${kind} stamp for instance '${inst.id}' (missing V or terminal connects)`,
        )
    }
    for (const led of shockleyLeds) {
      stampLedCompanion(led, nodeIndex, led.thermalV, M, b)
    }
    for (const bjt of bjts) {
      stampBjtCompanion(bjt, nodeIndex, bjt.thermalV, M, b)
    }
    for (const fet of mosfets) {
      stampMosfetCompanion(fet, nodeIndex, M, b)
    }

    // biome-ignore lint/suspicious/noExplicitAny: mathjs lusolve return is polymorphic
    let x: any
    try {
      x = math.lusolve(M, b)
    } catch {
      return null
    }
    const xArr = x.toArray() as number[][]
    const nodes = new Map<string, number>()
    nodes.set(ground, 0)
    for (const [netId, idx] of nodeIndex) {
      const v = xArr[idx]?.[0]
      if (typeof v === 'number') nodes.set(netId, v)
    }
    return { nodes, xArr }
  }

  // Linear fast-path: no Shockley LEDs → a single solve (Sprint 14 behavior).
  // Newton-Raphson path: iterate the companion-model linearization to convergence.
  let solved: { nodes: Map<string, number>; xArr: number[][] } | null
  let iterations = 1
  let converged = true

  if (shockleyLeds.length === 0 && bjts.length === 0 && mosfets.length === 0) {
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
    if (inst.definition === 'resistor' || inst.definition === 'thermistor') {
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

  return { status: 'solved', nodes, branches, ground, warnings, iterations, converged }
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
/** Bandgap of silicon (eV) — the I_S(T) law's default for silicon junctions. */
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
function resolveShockleyLed(
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
  // The V_F @ I_F calibration point is a 25 °C/300 K datasheet figure.
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
    const bandgapEv =
      wavelengthNm !== undefined && wavelengthNm > 0
        ? PHOTON_EV_NM / wavelengthNm
        : SILICON_BANDGAP_EV
    saturationCurrent = scaleSaturationCurrent(
      saturationCurrent,
      junctionKelvin,
      ROOM_TEMPERATURE_KELVIN,
      idealityFactor,
      bandgapEv,
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
 * Stamp an LED's Newton-Raphson companion model (§20.4 / §20.7) at its current
 * voltage guess: a conductance G_eq between anode and cathode plus a current
 * source I_eq. Ground-side rows/cols are omitted.
 */
function stampLedCompanion(
  led: ShockleyLed,
  nodeIndex: Map<string, number>,
  thermalV: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): void {
  const { conductance: G, currentSource: Ieq } = companionModel(
    led.vGuess,
    led.saturationCurrent,
    led.idealityFactor,
    thermalV,
  )
  const a = nodeIndex.get(led.anodeNet)
  const c = nodeIndex.get(led.cathodeNet)

  if (a !== undefined) {
    M.set([a, a], (M.get([a, a]) ?? 0) + G)
    b.set([a, 0], (b.get([a, 0]) ?? 0) - Ieq)
  }
  if (c !== undefined) {
    M.set([c, c], (M.get([c, c]) ?? 0) + G)
    b.set([c, 0], (b.get([c, 0]) ?? 0) + Ieq)
  }
  if (a !== undefined && c !== undefined) {
    M.set([a, c], (M.get([a, c]) ?? 0) - G)
    M.set([c, a], (M.get([c, a]) ?? 0) - G)
  }
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
  /** kT/q at this junction's temperature (the global 300 K value by default). */
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
    },
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

export function stampResistor(
  inst: Instance,
  nodeIndex: Map<string, number>,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
): boolean {
  const R = readScalarParam(inst, 'resistance')
  if (R === undefined || R <= 0) return false

  if (inst.connects?.length !== 2) return false
  const c1 = inst.connects[0]
  const c2 = inst.connects[1]
  if (c1 === undefined || c2 === undefined) return false

  stampConductance(nodeIndex, M, c1.net, c2.net, R)
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
  const R = readScalarParam(inst, 'resistance')
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
