/**
 * S-PARAMETER PANEL LOGIC, pulled out of sparam-panel.tsx so the parts that can be WRONG (the dB clamps, the
 * two axis ranges, the peak-transmission / best-match picks) are pure and unit-tested rather than trusted
 * inside a React component. The panel keeps only the SVG coordinate mapping + the controls.
 *
 * A 2-port's scattering matrix is drawn as two stacks: TRANSMISSION (|S21|, |S12| in dB — the honest gain /
 * insertion loss) and MATCH (|S11|, |S22| in dB — how much each port reflects; deeper is better matched).
 */
import type { SParamPoint } from '../ac-analysis.ts'
import { axisRange } from './plot-axis.ts'

/** |S| in dB is floored (a deep null shouldn't blow the axis to −∞) and lightly capped (a passive part sits at
 *  ≤ 0 dB; a little headroom shows active gain without runaway). */
export const S_FLOOR_DB = -60
export const S_CEIL_DB = 20

const clampDb = (db: number) =>
  Number.isFinite(db) ? Math.min(S_CEIL_DB, Math.max(S_FLOOR_DB, db)) : S_FLOOR_DB
/** The shared axis auto-range, then clamped to the plot's dB limits (a match/gain axis never runs past the
 *  |S| floor/ceiling the series themselves are clamped to). */
const clampedAxis = (min: number, max: number): [number, number] => {
  const [lo, hi] = axisRange(min, max, 10, 20)
  return [Math.max(S_FLOOR_DB, lo), Math.min(S_CEIL_DB, hi)]
}

export type SParamExtreme = { frequencyHz: number; db: number }
export type SParamView = {
  /** Clamped dB series, one per parameter, aligned with the sweep. */
  s11Db: number[]
  s21Db: number[]
  s12Db: number[]
  s22Db: number[]
  /** Axis [lo, hi] for the transmission stack (|S21|, |S12|). */
  transAxis: [number, number]
  /** Axis [lo, hi] for the match stack (|S11|, |S22|). */
  matchAxis: [number, number]
  /** Peak forward transmission |S21| (max dB) in the band, or null for an empty sweep. */
  peakS21: SParamExtreme | null
  /** Best input match — the deepest |S11| (min dB) — where the input reflects the least. */
  bestMatch: SParamExtreme | null
}

const extremeBy = (
  sweep: SParamPoint[],
  db: (p: SParamPoint) => number,
  better: (candidate: number, best: number) => boolean,
): SParamExtreme | null =>
  sweep.reduce<SParamExtreme | null>((best, p) => {
    const v = db(p)
    if (!Number.isFinite(v)) return best
    return best === null || better(v, best.db) ? { frequencyHz: p.frequencyHz, db: v } : best
  }, null)

/** Turn an S-parameter sweep into the panel's plot model — clamped dB series, two axes, the two extremes. */
export function sparamView(sweep: SParamPoint[]): SParamView {
  const s11Db = sweep.map((p) => clampDb(p.s11Db))
  const s21Db = sweep.map((p) => clampDb(p.s21Db))
  const s12Db = sweep.map((p) => clampDb(p.s12Db))
  const s22Db = sweep.map((p) => clampDb(p.s22Db))
  const transAxis: [number, number] = sweep.length
    ? clampedAxis(Math.min(...s21Db, ...s12Db), Math.max(...s21Db, ...s12Db))
    : [-40, 0]
  const matchAxis: [number, number] = sweep.length
    ? clampedAxis(Math.min(...s11Db, ...s22Db), Math.max(...s11Db, ...s22Db))
    : [-40, 0]
  return {
    s11Db,
    s21Db,
    s12Db,
    s22Db,
    transAxis,
    matchAxis,
    peakS21: extremeBy(
      sweep,
      (p) => p.s21Db,
      (c, b) => c > b,
    ),
    bestMatch: extremeBy(
      sweep,
      (p) => p.s11Db,
      (c, b) => c < b,
    ),
  }
}
