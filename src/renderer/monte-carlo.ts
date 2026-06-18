/**
 * Monte-Carlo tolerance analysis -- the realistic DISTRIBUTION on top of the worst-case
 * corners. Worst-case asks "is the single worst combination safe?"; that corner can be
 * astronomically unlikely (every part at its extreme, all the wrong way at once). This
 * asks the production question instead: "across the boards I will actually build, what is
 * the spread, and what fraction fail?" -- it draws each toleranced part from its band many
 * times, solves each draw, and reports each reading's mean / spread / 1st-99th percentile
 * plus the share of samples that breach a rating (the failure rate = 1 - yield).
 *
 * Distribution: manufactured values are modeled as Gaussian centered on nominal with the
 * tolerance as the 3-sigma bound (~99.7 % land in band), truncated to the band since a
 * part is guaranteed within its tolerance. A real population can differ -- bimodal if the
 * tight parts are sorted out -- so this is the standard "typical spread" assumption, not a
 * measured one. No new physics: it re-runs the existing solver with sampled values, the
 * same plumbing the worst-case sweep uses.
 */

import type { World } from '../cross-fk-validator.ts'
import type { Solution } from '../dc-solver.ts'
import { type PartReading, partReadings } from './part-readings.ts'
import {
  QUANTITIES,
  type Quantity,
  ratingFor,
  readingOf,
  type TolerancePart,
  toleranceParts,
  worldWithPartValues,
} from './worst-case.ts'

export interface MonteCarloStat {
  partId: string
  quantity: Quantity
  mean: number
  stdDev: number
  min: number
  max: number
  /** 1st and 99th percentile -- where all but the tails of boards land. */
  p1: number
  p99: number
  rating?: number
  /** Share of samples whose |reading| breached the rating (0..1) -- the failure rate. */
  exceedFraction?: number
}

export interface MonteCarloResult {
  stats: MonteCarloStat[]
  samples: number
  toleranceParts: TolerancePart[]
  /** True once a real run sampled tolerances (>= 1 toleranced part); false = nothing to vary. */
  swept: boolean
  /** The worst (highest) per-reading failure rate across all rated readings. */
  worstExceedFraction: number
}

export const MONTE_CARLO_DEFAULT_SAMPLES = 500

/** One standard-normal draw (Box-Muller) from a uniform [0,1) source. */
function gaussian(random: () => number): number {
  const u1 = Math.max(1e-12, random()) // avoid log(0)
  const u2 = random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** Value at percentile p (0..1) of an already-ascending-sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[idx] as number
}

/** Summarize the recorded samples for one (part, quantity) against its rating. */
function summarize(
  partId: string,
  quantity: Quantity,
  values: number[],
  rating: number | undefined,
): MonteCarloStat {
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n
  const sorted = [...values].sort((a, b) => a - b)
  const stat: MonteCarloStat = {
    partId,
    quantity,
    mean,
    stdDev: Math.sqrt(variance),
    min: sorted[0] as number,
    max: sorted[n - 1] as number,
    p1: percentile(sorted, 0.01),
    p99: percentile(sorted, 0.99),
  }
  if (rating !== undefined && rating > 0) {
    stat.rating = rating
    stat.exceedFraction = values.filter((v) => Math.abs(v) > rating).length / n
  }
  return stat
}

/**
 * Run the Monte-Carlo sweep. `solve` is the project's real heat-aware solve, injected so
 * this stays decoupled and testable; `random` is injectable too so a seeded source makes a
 * run reproducible (defaults to Math.random). projectAmbientC is the board ambient solve was
 * bound to, so each sample's temperature reading lands at that ambient, not the 25 °C fallback.
 */
export function monteCarloAnalysis(
  world: World,
  solve: (w: World) => Solution,
  options?: { samples?: number; random?: () => number },
  projectAmbientC?: number,
): MonteCarloResult {
  const parts = toleranceParts(world)
  const samples = Math.max(1, Math.floor(options?.samples ?? MONTE_CARLO_DEFAULT_SAMPLES))
  const random = options?.random ?? Math.random

  // Accumulate every reading across the runs, keyed by part + quantity.
  const series = new Map<string, { partId: string; quantity: Quantity; values: number[] }>()
  const record = (readings: Map<string, PartReading>) => {
    for (const [partId, reading] of readings) {
      for (const q of QUANTITIES) {
        const v = readingOf(reading, q)
        if (v === undefined) continue
        const key = `${partId}|${q}`
        const bucket = series.get(key)
        if (bucket === undefined) series.set(key, { partId, quantity: q, values: [v] })
        else bucket.values.push(v)
      }
    }
  }

  if (parts.length === 0) {
    // Nothing to vary -- one nominal solve; every distribution is a spike.
    record(partReadings(world, solve(world), undefined, projectAmbientC))
  } else {
    for (let s = 0; s < samples; s++) {
      const sampled = worldWithPartValues(world, parts, (part) => {
        const sigma = (part.tolFraction / 3) * part.nominal
        const bound = part.tolFraction * part.nominal
        const offset = Math.max(-bound, Math.min(bound, gaussian(random) * sigma))
        return part.nominal + offset
      })
      record(partReadings(sampled, solve(sampled), undefined, projectAmbientC))
    }
  }

  const stats: MonteCarloStat[] = []
  let worstExceedFraction = 0
  for (const { partId, quantity, values } of series.values()) {
    const inst = world.instances.get(partId)
    if (inst === undefined) continue
    const stat = summarize(partId, quantity, values, ratingFor(inst, quantity))
    if (stat.exceedFraction !== undefined && stat.exceedFraction > worstExceedFraction) {
      worstExceedFraction = stat.exceedFraction
    }
    stats.push(stat)
  }

  return {
    stats,
    samples: parts.length === 0 ? 1 : samples,
    toleranceParts: parts,
    swept: parts.length > 0,
    worstExceedFraction,
  }
}
