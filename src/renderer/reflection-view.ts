/**
 * Reflection PANEL LOGIC, pulled out of reflection-panel.tsx so it is a pure, unit-tested function instead of
 * living only inside a React component: given a reflection sweep it produces the plot-ready return-loss and
 * VSWR series (clamped so an infinite spike at a match doesn't blow up the axis), the two axis ranges, and
 * the best-match point. The panel keeps only the SVG coordinate mapping + the field controls; everything that
 * can be WRONG (the clamps, the axis bounds, the best-match pick, the physical VSWR floor of 1) is here and
 * covered by tests, so the panel isn't trusted on inspection alone.
 */
import type { ReflectionPoint } from '../ac-analysis.ts'

/** A perfect match sends return loss → +∞ (and VSWR → 1); a total reflection sends VSWR → +∞. Clamp both so
 *  an infinite value doesn't blow up the plot axis. */
export const RL_PLOT_MAX = 60
export const VSWR_PLOT_MAX = 20

const niceFloor = (v: number, step: number) => Math.floor(v / step) * step
const niceCeil = (v: number, step: number) => Math.ceil(v / step) * step
/** Pad [min,max] to a minimum span, snapped to a step, centered on the data. */
export function axisRange(
  min: number,
  max: number,
  step: number,
  minSpan: number,
): [number, number] {
  let lo = niceFloor(min, step)
  let hi = niceCeil(max, step)
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2
    lo = niceFloor(mid - minSpan / 2, step)
    hi = niceCeil(mid + minSpan / 2, step)
  }
  return [lo, hi]
}

export type BestMatch = {
  frequencyHz: number
  returnLossDb: number
  vswr: number
  zinRe: number
  zinIm: number
}
export type ReflectionView = {
  /** Return loss (dB) per point, clamped to RL_PLOT_MAX. */
  rlClamped: number[]
  /** VSWR per point, clamped to VSWR_PLOT_MAX. */
  vswrClamped: number[]
  /** [lo, hi] for the return-loss stack (auto-ranged). */
  rlAxis: [number, number]
  /** [lo, hi] for the VSWR stack — the lower bound is ALWAYS 1 (VSWR's physical floor). */
  vswrAxis: [number, number]
  /** The best-matched point (maximum return loss) in the band, or null for an empty sweep. */
  best: BestMatch | null
}

/** Turn a reflection sweep into the panel's plot model — the clamped series, the two axes, the best match. */
export function reflectionView(sweep: ReflectionPoint[]): ReflectionView {
  const rlClamped = sweep.map((p) => Math.min(p.returnLossDb, RL_PLOT_MAX))
  const vswrClamped = sweep.map((p) => Math.min(p.vswr, VSWR_PLOT_MAX))
  const rlAxis: [number, number] = sweep.length
    ? axisRange(Math.min(...rlClamped), Math.max(...rlClamped), 10, 30)
    : [0, 30]
  // VSWR has a hard physical floor of 1 (a perfect match); build its axis UP from 1, never below — the
  // symmetric axisRange would re-center and draw impossible sub-1 gridlines for a well-matched port.
  const vswrAxis: [number, number] = [
    1,
    sweep.length ? Math.max(3, niceCeil(Math.max(...vswrClamped), 1)) : 4,
  ]
  const best = sweep.reduce<BestMatch | null>(
    (b, p) =>
      b === null || p.returnLossDb > b.returnLossDb
        ? {
            frequencyHz: p.frequencyHz,
            returnLossDb: p.returnLossDb,
            vswr: p.vswr,
            zinRe: p.zinRe,
            zinIm: p.zinIm,
          }
        : b,
    null,
  )
  return { rlClamped, vswrClamped, rlAxis, vswrAxis, best }
}
