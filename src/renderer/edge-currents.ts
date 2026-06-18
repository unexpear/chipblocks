/**
 * Per-wire conventional-current flow, from the DC solver (Sprint 19 S19-v3-9).
 *
 * "Wire in the physics": the canvas arrows are NOT a topological guess at flow
 * direction — they come from the real current `solveDC` computes. Each wire is a
 * real 2-terminal element with its own branch current; this turns that current
 * into a direction + magnitude for the wire's arrow.
 *
 * Sign convention (from dc-solver.ts, verified against the solved anchor circuit
 * in tests/dc-solver.test.ts): a wire's positive branch current flows from
 * terminal_a (the edge's source side) toward terminal_b — so when the source sits
 * on the positive side, current runs source→target while the branch is positive.
 */

import type { Solution } from '../dc-solver.ts'

export type EdgeFlow = {
  /** Current magnitude in amperes (always ≥ 0). */
  amps: number
  /** Does conventional current flow from the edge's source toward its target? */
  sourceToTarget: boolean
  /** True when this spoke is a live series-current path (both ends carry current). */
  carries: boolean
}

const FLOOR_AMPS = 1e-12

/**
 * Conventional-current flow for a wire-EDGE (a collapsed `wire` instance),
 * read from that instance's own branch current (S19-v3-9). Positive branch
 * flows from the wire's terminal_a (positive) side toward terminal_b; if the
 * edge's source sits on the positive side, current runs source→target when the
 * branch is positive.
 */
export function wireFlow(
  solution: Solution,
  wireInstance: string,
  sourceOnPositiveSide: boolean,
): EdgeFlow {
  const branch = solution.branches.get(wireInstance) ?? 0
  const sourceToTarget = sourceOnPositiveSide ? branch >= 0 : branch < 0
  return {
    amps: Math.abs(branch),
    sourceToTarget,
    carries: Math.abs(branch) > FLOOR_AMPS,
  }
}
