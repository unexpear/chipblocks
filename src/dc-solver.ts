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
 *   - Wire: stamps as ideal 0 V source between terminal_a and terminal_b
 *     (the IR drop on hookup wire at 70 mA is ~350 μV — negligible for
 *     Sprint 14's purposes). Material+geometry-based resistance modeling
 *     is straightforward via the §16 evaluator but deferred until a
 *     fixture genuinely needs it.
 * S14-v3-6 extracts branch currents into the Solution.branches map. The
 * sign convention is fixed by the MNA stamp pattern: positive current
 * flows from positive terminal (anode / terminal_positive / terminal_a /
 * terminal_in) toward the negative terminal. For resistors compute
 * I = (V_pos - V_neg) / R; for voltage-source-like elements the
 * auxiliary current variable x[N+s] is already in this convention.
 */

import { all, create } from 'mathjs'
import type { Instance, Net, World } from './cross-fk-validator.ts'
import {
  companionModel,
  criticalVoltage,
  deriveSaturationCurrent,
  diodeCurrent,
  pnjlim,
  thermalVoltage,
} from './diode-model.ts'
import { readEnumParam, readScalarParam } from './instance-params.ts'

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
  /** Current Newton-Raphson voltage guess (anode − cathode). */
  vGuess: number
}

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
  type VsLikeKind = 'power_source' | 'led' | 'switch' | 'wire'
  const linearVoltageSources: Array<{ inst: Instance; kind: VsLikeKind }> = []
  const shockleyLeds: ShockleyLed[] = []

  for (const inst of world.instances.values()) {
    if (inst.connects?.length !== 2) continue

    if (inst.definition === 'power_source') {
      linearVoltageSources.push({ inst, kind: 'power_source' })
    } else if (inst.definition === 'led' || inst.definition === 'led_uv_algan') {
      const led = resolveShockleyLed(inst, thermalV)
      if (led !== null) shockleyLeds.push(led)
      else linearVoltageSources.push({ inst, kind: 'led' }) // fixed-V_F fallback
    } else if (inst.definition === 'switch_spst_toggle') {
      // Closed → stamps as a short (below). Open → omitted entirely, leaving its
      // terminals on separate nets: a real open circuit, not a hardcoded short.
      if (switchIsClosed(inst)) linearVoltageSources.push({ inst, kind: 'switch' })
    } else if (inst.definition === 'wire') {
      linearVoltageSources.push({ inst, kind: 'wire' })
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
      if (inst.definition === 'resistor') {
        const ok = stampResistor(inst, nodeIndex, M)
        if (!ok)
          warnings.push(`Skipped resistor stamp for instance '${inst.id}' (missing R or connects)`)
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
      else if (kind === 'wire') ok = stampWireAsShort(inst, nodeIndex, auxIdx, M, b)
      if (!ok)
        warnings.push(
          `Skipped ${kind} stamp for instance '${inst.id}' (missing V or terminal connects)`,
        )
    }
    for (const led of shockleyLeds) {
      stampLedCompanion(led, nodeIndex, thermalV, M, b)
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

  if (shockleyLeds.length === 0) {
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
        const nVT = led.idealityFactor * thermalV
        const vcrit = criticalVoltage(led.saturationCurrent, led.idealityFactor, thermalV)
        const limit = pnjlim(vRaw, led.vGuess, nVT, vcrit)
        maxDelta = Math.max(maxDelta, Math.abs(limit.voltage - led.vGuess))
        if (limit.limited) anyLimited = true
        led.vGuess = limit.voltage
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
    if (inst.definition === 'resistor') {
      const I = computeResistorCurrent(inst, nodes)
      if (I !== undefined) branches.set(inst.id, I)
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
      diodeCurrent(led.vGuess, led.saturationCurrent, led.idealityFactor, thermalV),
    )
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

/**
 * Resolve an LED to the Shockley model, or null if it lacks calibration data
 * (forward_voltage + max_forward_current) and should fall back to fixed-V_F.
 */
function resolveShockleyLed(inst: Instance, thermalV: number): ShockleyLed | null {
  const forwardVoltage = readScalarParam(inst, 'forward_voltage')
  const forwardCurrent = readScalarParam(inst, 'max_forward_current')
  if (forwardVoltage === undefined || forwardCurrent === undefined) return null
  if (forwardVoltage <= 0 || forwardCurrent <= 0) return null

  const anodeConnect = inst.connects?.find((c) => c.terminal === 'anode')
  const cathodeConnect = inst.connects?.find((c) => c.terminal === 'cathode')
  if (anodeConnect === undefined || cathodeConnect === undefined) return null

  const idealityFactor = readScalarParam(inst, 'ideality_factor') ?? DEFAULT_IDEALITY_FACTOR
  const saturationCurrent = deriveSaturationCurrent(
    forwardVoltage,
    forwardCurrent,
    idealityFactor,
    thermalV,
  )

  return {
    inst,
    anodeNet: anodeConnect.net,
    cathodeNet: cathodeConnect.net,
    saturationCurrent,
    idealityFactor,
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

  // (2) Ground ports — the net a ground reference marker attaches to.
  const portNets: string[] = []
  for (const inst of world.instances.values()) {
    if (inst.definition !== 'ground') continue
    const net = inst.connects?.[0]?.net
    if (net !== undefined && world.nets.has(net)) portNets.push(net)
  }
  if (portNets.length > 0) {
    if (portNets.length > 1) {
      warnings.push(
        `Multiple ground ports found (nets ${portNets.join(', ')}); using '${portNets[0]}' (deterministic first).`,
      )
    }
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    return portNets[0]!
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

  const i_a = nodeIndex.get(c1.net) // undefined when net is ground (excluded)
  const i_b = nodeIndex.get(c2.net)

  const G = 1 / R

  if (i_a !== undefined) {
    M.set([i_a, i_a], (M.get([i_a, i_a]) ?? 0) + G)
  }
  if (i_b !== undefined) {
    M.set([i_b, i_b], (M.get([i_b, i_b]) ?? 0) + G)
  }
  if (i_a !== undefined && i_b !== undefined) {
    M.set([i_a, i_b], (M.get([i_a, i_b]) ?? 0) - G)
    M.set([i_b, i_a], (M.get([i_b, i_a]) ?? 0) - G)
  }

  return true
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
 * Apply a wire's contribution as an ideal short (0 V voltage source). The IR
 * drop on hookup wire at typical hobby currents (≤100 mA) is sub-mV —
 * negligible for Sprint 14's DC operating point. Material+geometry-based
 * resistance modeling via the §16 evaluator is straightforward but deferred
 * until a fixture demands it (high-current PCB traces, long inductive runs,
 * etc.).
 *
 * Returns true if the stamp landed; false if connects don't follow the
 * terminal_a / terminal_b convention.
 */
export function stampWireAsShort(
  inst: Instance,
  nodeIndex: Map<string, number>,
  auxIdx: number,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  M: any,
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  b: any,
): boolean {
  return findAndStampVoltageSource(inst, nodeIndex, auxIdx, 0, 'terminal_a', 'terminal_b', M, b)
}

/**
 * Shared MNA-stamp helper for all voltage-source-like elements. Finds the
 * positive and negative connects by terminal-name convention and stamps
 * §18.4's pattern.
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
  if (inst.connects?.length !== 2) return false

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
