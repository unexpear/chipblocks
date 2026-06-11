/**
 * Scope cursors (S19-v3-79): two draggable time lines, A and B. Each reads
 * the measured channel's voltage where it crosses the trace; the readout
 * gives delta-time, 1/delta-time, and delta-voltage between them — how rise
 * times, periods, and ripple are actually measured off a trace.
 *
 * Honesty rule: the voltage at a cursor is LINEAR interpolation between the
 * two recorded samples around it — exactly the straight segment the plot
 * draws there, never a value the simulation didn't imply. Outside the
 * recorded window the cursor reads nothing (null), not zero.
 */

export type CursorSample = { t: number; v: number }

/**
 * The trace's value at time `t`: the point on the drawn polyline. Null
 * outside the recorded span. The series must be time-ordered (a scope
 * record always is).
 */
export function interpolateSeries(series: CursorSample[], t: number): number | null {
  if (series.length === 0) return null
  const first = series[0]
  const last = series[series.length - 1]
  if (first === undefined || last === undefined) return null
  if (t < first.t || t > last.t) return null
  // Binary search for the sample pair bracketing t.
  let lo = 0
  let hi = series.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((series[mid]?.t ?? 0) <= t) lo = mid
    else hi = mid
  }
  const a = series[lo]
  const b = series[hi]
  if (a === undefined || b === undefined) return null
  if (b.t === a.t) return a.v
  const fraction = (t - a.t) / (b.t - a.t)
  return a.v + fraction * (b.v - a.v)
}

/** What the cursor strip displays. All deltas are SIGNED (B minus A). */
export type CursorReadout = {
  deltaT: number
  /** 1/deltaT — the period-to-frequency shortcut. Null when deltaT is 0. */
  inverseDeltaT: number | null
  /** B's voltage minus A's. Null when either cursor is off the record. */
  deltaV: number | null
}

export function cursorReadout(
  a: { t: number; v: number | null },
  b: { t: number; v: number | null },
): CursorReadout {
  const deltaT = b.t - a.t
  return {
    deltaT,
    inverseDeltaT: deltaT !== 0 ? 1 / deltaT : null,
    deltaV: a.v !== null && b.v !== null ? b.v - a.v : null,
  }
}
