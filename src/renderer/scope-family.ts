/**
 * Family curves (S20-v3-4) — the curve tracer's showpiece. One source in the
 * circuit (the gate drive) is STEPPED across N values; the simulation runs
 * once per step; each run's swept (X, Y) path is overlaid in one plot — the
 * I_D vs V_DS family at several V_GS, the exact picture on every MOSFET
 * datasheet.
 *
 * Honesty rules: every curve is a real solver run of the real circuit with
 * one declared parameter changed — nothing is interpolated between steps. A
 * step that fails to solve is REPORTED and skipped, never faked. The first
 * window of each run is discarded (power-on transients — the same settle
 * rule the FFT and the multimeter use), so the path is the periodic sweep.
 */

import type { TransientPoint } from '../transient-solver.ts'
import { channelValue, type ScopeChannel } from './scope.tsx'

/**
 * N evenly spaced step values, endpoints included. Count clamps to 2..8.
 * Exact duplicates collapse (from = to gives ONE step, not N identical
 * simulations of the same circuit — found by a verification probe: the
 * duplicate labels also collided as render keys).
 */
export function stepValues(from: number, to: number, count: number): number[] {
  const n = Math.max(2, Math.min(8, Math.round(count)))
  const values = Array.from({ length: n }, (_, k) => from + (k * (to - from)) / (n - 1))
  return [...new Set(values)]
}

/**
 * A copy of the canvas nodes with ONE node's nominal_voltage overridden —
 * how each family run steps the chosen source. Pure: the original array and
 * its node data are untouched (the override clones the node, its data, and
 * its parameters).
 */
export function withSourceVoltage<
  N extends { id: string; data?: { parameters?: Record<string, unknown> } },
>(nodes: N[], nodeId: string, volts: number): N[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node
    return {
      ...node,
      data: {
        ...node.data,
        parameters: {
          ...node.data?.parameters,
          nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
        },
      },
    }
  })
}

/** One traced family step: the stepped value, its label, and the (x, y) path. */
export type FamilyStep = {
  /** The exact stepped value — the stable identity (labels can round-collide). */
  value: number
  label: string
  path: { x: number; y: number }[]
}

/**
 * The (X, Y) pairs of one run, read through the SAME channel lookups the
 * live traces use, with the settle window discarded.
 */
export function extractXyPath(
  series: TransientPoint[],
  xChannel: ScopeChannel,
  yChannel: ScopeChannel,
  settleSeconds: number,
): { x: number; y: number }[] {
  const path: { x: number; y: number }[] = []
  for (const point of series) {
    if (point.time < settleSeconds) continue
    path.push({ x: channelValue(xChannel, point), y: channelValue(yChannel, point) })
  }
  return path
}

/** The union extent of every step's path — ONE axis fit for the whole family. */
export function familyExtent(steps: FamilyStep[]): {
  xLo: number
  xHi: number
  yLo: number
  yHi: number
} | null {
  let xLo = Number.POSITIVE_INFINITY
  let xHi = Number.NEGATIVE_INFINITY
  let yLo = Number.POSITIVE_INFINITY
  let yHi = Number.NEGATIVE_INFINITY
  for (const step of steps) {
    for (const p of step.path) {
      if (p.x < xLo) xLo = p.x
      if (p.x > xHi) xHi = p.x
      if (p.y < yLo) yLo = p.y
      if (p.y > yHi) yHi = p.y
    }
  }
  if (!(xHi >= xLo) || !(yHi >= yLo)) return null
  return { xLo, xHi, yLo, yHi }
}
