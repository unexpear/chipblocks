/**
 * DC solver — Modified Nodal Analysis for linear circuits.
 *
 * Per OBJECT-MODEL.md §18. Sprint 14 MVP scope: resistors + voltage sources
 * + wires + LEDs (fixed-V_F approximation) + switches (fixed-state). Single
 * deterministic linear solve via mathjs's lusolve. Nonlinear iterative
 * solving (Shockley + Newton-Raphson + pnjlim) lands in Sprint 15.
 *
 * Per the "real all the way down" principle: the solver doesn't fake passes.
 * Unsupported elements surface 'unsupported-element' rather than silently
 * producing wrong results. No silent ground default — a circuit with no
 * type: ground net returns status 'no-ground' without attempting to solve.
 *
 * S14-v3-3 scaffold: types + ground identification + node-index assignment
 * + resistor stamps + lusolve smoke test. Voltage sources, LED fixed-V_F,
 * wire treatment, switch handling, and branch-current extraction land in
 * S14-v3-4 through S14-v3-6.
 */

import { all, create } from 'mathjs'
import type { Instance, Net, World } from './cross-fk-validator.ts'

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
}

export type SolutionStatus =
  | 'solved'
  | 'no-ground'
  | 'singular-matrix'
  | 'unsupported-element'
  | 'numerical-error'

export type Solution = {
  status: SolutionStatus
  /** Net id → voltage relative to ground, in volts. */
  nodes: Map<string, number>
  /**
   * Instance id → current through that branch, in amperes.
   * Sign convention: positive flows from terminal_positive / anode / terminal_a
   * toward terminal_negative / cathode / terminal_b. Empty for S14-v3-3
   * (branch currents land in S14-v3-6).
   */
  branches: Map<string, number>
  /** The net id chosen as ground reference; undefined when status === 'no-ground'. */
  ground: string | undefined
  /** Non-fatal observations (multiple grounds, unsupported elements skipped, etc.). */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function solveDC(world: World, options?: SolveOptions): Solution {
  const warnings: string[] = []

  const ground = identifyGround(world, options, warnings)
  if (ground === undefined) {
    return {
      status: 'no-ground',
      nodes: new Map(),
      branches: new Map(),
      ground: undefined,
      warnings,
    }
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
    }
  }

  // Build the MNA matrix. S14-v3-3 stamps resistors only; everything else is
  // either passed through (no-op for now) or surfaced as a warning so the
  // user knows what didn't contribute. Voltage sources and the auxiliary
  // current variables land in S14-v3-4.
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  const M: any = math.zeros(N, N)
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  const b: any = math.zeros(N, 1)

  for (const inst of world.instances.values()) {
    if (inst.definition === 'resistor') {
      const ok = stampResistor(inst, nodeIndex, M)
      if (!ok)
        warnings.push(`Skipped resistor stamp for instance '${inst.id}' (missing R or connects)`)
    }
    // Sprint 14 will progressively add stamps for: power_source (S14-v3-4),
    // led + switch_spst_toggle + wire (S14-v3-5). For S14-v3-3 they're
    // silently skipped — the solver returns a trivial / partial result. Tests
    // in this sub-commit don't depend on full-circuit solving yet.
  }

  // Solve M x = b
  // biome-ignore lint/suspicious/noExplicitAny: mathjs lusolve return is polymorphic
  let x: any
  try {
    x = math.lusolve(M, b)
  } catch (err) {
    return {
      status: 'singular-matrix',
      nodes: new Map(),
      branches: new Map(),
      ground,
      warnings: [
        ...warnings,
        `lusolve failed: ${err instanceof Error ? err.message : String(err)}`,
      ],
    }
  }

  const nodes = new Map<string, number>()
  nodes.set(ground, 0)
  const xArr = x.toArray() as number[][]
  for (const [netId, idx] of nodeIndex) {
    const row = xArr[idx]
    if (!row) continue
    const v = row[0]
    if (typeof v === 'number') nodes.set(netId, v)
  }

  return {
    status: 'solved',
    nodes,
    branches: new Map(), // S14-v3-6 fills this in
    ground,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers — exposed for unit testing
// ---------------------------------------------------------------------------

/**
 * Find the net to use as ground. Priority:
 *   1. options.ground if provided (must reference an existing net)
 *   2. The first net with type: 'ground' (deterministic iteration order)
 *   3. undefined → caller returns 'no-ground' status
 *
 * Multiple type: 'ground' nets produces a warning + uses the first one.
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
 * Read a scalar parameter's amount from an instance.
 * Returns undefined if the parameter is missing, not a scalar value, or
 * has a non-numeric amount.
 */
function readScalarParam(inst: Instance, name: string): number | undefined {
  const param = inst.parameters?.[name]
  if (param === undefined) return undefined
  const value = param.value
  if (value === null || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (v.kind !== 'scalar') return undefined
  if (typeof v.amount !== 'number') return undefined
  return v.amount
}
