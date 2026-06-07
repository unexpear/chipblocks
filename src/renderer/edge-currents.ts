/**
 * Per-edge conventional-current flow, from the DC solver (Sprint 19 S19-v3-4).
 *
 * "Wire in the physics": the canvas arrows are NOT a topological guess at flow
 * direction — they come from the real current `solveDC` computes. This module
 * turns the solver's per-device branch currents into a direction + magnitude for
 * one wire (a net spoke between two instances).
 *
 * Sign convention (from dc-solver.ts, verified against the solved anchor circuit
 * in tests/dc-solver.test.ts): a device's positive branch current flows from its
 * positive-side terminal (terminal_positive / anode / terminal_a / terminal_in)
 * toward its negative side — i.e. current EXITS the device at the negative-side
 * terminal when the branch current is positive. A source delivering power reads
 * negative (it sinks positive→negative internally).
 */

import type { World } from '../cross-fk-validator.ts'
import type { Solution } from '../dc-solver.ts'

const POSITIVE_SIDE = new Set(['terminal_positive', 'anode', 'terminal_a', 'terminal_in'])
const NEGATIVE_SIDE = new Set(['terminal_negative', 'cathode', 'terminal_b', 'terminal_out'])

/** +1 = positive side, -1 = negative side, 0 = neither (a reference tap like ground). */
function terminalSide(terminal: string | undefined): number {
  if (terminal && POSITIVE_SIDE.has(terminal)) return 1
  if (terminal && NEGATIVE_SIDE.has(terminal)) return -1
  return 0
}

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
 * Conventional-current flow for one edge — the net spoke from `source` to
 * `target`. Returns `carries: false` (no arrow) when either end is a reference
 * tap (ground) or no current flows.
 */
export function edgeFlow(
  world: World,
  solution: Solution,
  net: string,
  source: string,
  target: string,
): EdgeFlow {
  const members = world.nets.get(net)?.members ?? []
  const sourceSide = terminalSide(members.find((m) => m.instance === source)?.terminal)
  const targetSide = terminalSide(members.find((m) => m.instance === target)?.terminal)
  if (sourceSide === 0 || targetSide === 0) {
    return { amps: 0, sourceToTarget: true, carries: false }
  }

  const branch = solution.branches.get(source) ?? 0
  // Current leaving `source` into the net: the branch current if `source`
  // connects via its negative side (current exits there when branch > 0),
  // else its negation (a positive-side connection sees current entering).
  const flowFromSource = sourceSide < 0 ? branch : -branch
  return {
    amps: Math.abs(flowFromSource),
    sourceToTarget: flowFromSource >= 0,
    carries: Math.abs(flowFromSource) > FLOOR_AMPS,
  }
}

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

/**
 * Conventional-current flow for a CANVAS edge (S19-v3-23) — read from a solution
 * produced by `canvasToWorld`, where wires are edges (no wire instances) and nets
 * are synthetic. The current is the source part's solved branch current, signed
 * by its terminal's polarity (same convention as `edgeFlow`). Only the SOURCE
 * endpoint carries the reading; `targetHandle` is needed solely to spot a wire
 * into a reference terminal (the target instance itself isn't used).
 *
 * An edge touching a reference terminal (ground's `reference_terminal`) carries no
 * series current — it's a tap, so `carries: false`. This is what makes the live
 * re-solve's per-wire arrows match the loaded circuit's: the ground stem stays
 * grey while the loop wires light up.
 */
export function canvasEdgeFlow(
  solution: Solution,
  source: string,
  sourceHandle: string | undefined,
  targetHandle: string | undefined,
): EdgeFlow {
  const sourceSide = terminalSide(sourceHandle)
  if (sourceSide === 0 || terminalSide(targetHandle) === 0) {
    return { amps: 0, sourceToTarget: true, carries: false }
  }
  const branch = solution.branches.get(source)
  if (branch === undefined) return { amps: 0, sourceToTarget: true, carries: false }

  const flowFromSource = sourceSide < 0 ? branch : -branch
  return {
    amps: Math.abs(flowFromSource),
    sourceToTarget: flowFromSource >= 0,
    carries: Math.abs(flowFromSource) > FLOOR_AMPS,
  }
}

/** Human-readable current, unit-scaled (A / mA / µA / nA). */
export function formatCurrent(amps: number): string {
  const magnitude = Math.abs(amps)
  if (magnitude >= 1) return `${magnitude.toFixed(2)} A`
  if (magnitude >= 1e-3) return `${(magnitude * 1e3).toFixed(1)} mA`
  if (magnitude >= 1e-6) return `${(magnitude * 1e6).toFixed(1)} µA`
  if (magnitude >= 1e-9) return `${(magnitude * 1e9).toFixed(1)} nA`
  return '0 A'
}
