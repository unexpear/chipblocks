/**
 * Waveform measurements (S19-v3-80) — the numbers an instrument reads off a
 * sampled trace. ONE implementation shared by the multimeter's V~ mode and
 * the scope's auto-measurement strip; the math moved here verbatim from
 * meter.tsx (where it was verified against Fluke behavior) so the two
 * instruments can never disagree.
 *
 * Every value is computed from the recorded samples and nothing else. A
 * measurement that can't be made from the data (no full cycle on screen, no
 * edge present, a flat line) is null — the display shows a dash, the way a
 * bench scope shows "----", never a guess.
 */

export type WaveSample = { t: number; v: number }

export type WaveMeasurements = {
  vmax: number
  vmin: number
  /** Peak-to-peak. */
  vpp: number
  /** The DC level (plain average). */
  mean: number
  /** True RMS of the AC part (mean removed) — the multimeter's V~ number. */
  rmsAc: number
  /** From the Schmitt-hysteresis transition counter. Null when uncountable. */
  hz: number | null
  /** 1/hz. */
  periodS: number | null
  /** Fraction of time spent above the 50 % level (exact segment integration). */
  dutyHigh: number | null
  /** 10 % → 90 % of the swing along one rising edge (interpolated crossings). */
  riseS: number | null
  /** 90 % → 10 % along one falling edge. */
  fallS: number | null
}

/** Linear-interpolated time where the segment s0→s1 crosses `level`. */
function crossingTime(s0: WaveSample, s1: WaveSample, level: number): number {
  if (s1.v === s0.v) return s0.t
  return s0.t + ((level - s0.v) / (s1.v - s0.v)) * (s1.t - s0.t)
}

/**
 * Frequency from band-transitions with hysteresis — the Schmitt-trigger
 * technique real counters use so ripple riding on the waveform can't
 * double-count a crossing: the band is ±10 % of the peak deviation, and an
 * excursion only counts after traversing the FULL band. The period comes
 * from SAME-direction events only (rising→rising or falling→falling),
 * which are spaced exactly one period apart for ANY periodic shape — a
 * half-wave-rectified hump included — so n of them span n−1 whole periods.
 * Both directions are tracked because a short analysis slice can clip one
 * direction's events at its edges. Ripple LARGER than the band still fools
 * the count — true of real handheld counters on strongly distorted signals
 * as well. Gated on real amplitude: a flat (or microvolt) line has no
 * frequency a counter would lock onto.
 */
function countHz(samples: WaveSample[], mean: number, rmsAc: number): number | null {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(s.v - mean))
  const band = 0.1 * peak
  let state: 'high' | 'low' | 'between' = 'between'
  const rising = { count: 0, first: -1, last: -1 }
  const falling = { count: 0, first: -1, last: -1 }
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i]?.v ?? 0) - mean
    const next: 'high' | 'low' | 'between' = v > band ? 'high' : v < -band ? 'low' : state
    const edge = state === 'low' && next === 'high' ? rising : null
    const fallEdge = state === 'high' && next === 'low' ? falling : null
    const hit = edge ?? fallEdge
    if (hit !== null) {
      hit.count += 1
      if (hit.first < 0) hit.first = i
      hit.last = i
    }
    state = next
  }
  const events = rising.count >= 2 ? rising : falling
  if (rmsAc < 1e-3 || events.count < 2 || events.last <= events.first) return null
  const firstTime = samples[events.first]?.t
  const lastTime = samples[events.last]?.t
  if (firstTime === undefined || lastTime === undefined || lastTime <= firstTime) return null
  return (events.count - 1) / (lastTime - firstTime)
}

/** Time spent at-or-above `level`, exact for the drawn polyline. */
function timeAbove(samples: WaveSample[], level: number): number {
  let above = 0
  for (let i = 1; i < samples.length; i++) {
    const s0 = samples[i - 1]
    const s1 = samples[i]
    if (s0 === undefined || s1 === undefined) continue
    const dt = s1.t - s0.t
    const a0 = s0.v >= level
    const a1 = s1.v >= level
    if (a0 && a1) above += dt
    else if (a0 !== a1) {
      const tc = crossingTime(s0, s1, level)
      above += a0 ? tc - s0.t : s1.t - tc
    }
  }
  return above
}

/**
 * 10 % → 90 % rise time on the first rising edge that completes. A new
 * crossing up through 10 % restarts the measurement, so ringing measures
 * from the crossing nearest the edge — the way bench scopes report it.
 */
function riseTime(samples: WaveSample[], v10: number, v90: number): number | null {
  let t10: number | null = null
  for (let i = 1; i < samples.length; i++) {
    const s0 = samples[i - 1]
    const s1 = samples[i]
    if (s0 === undefined || s1 === undefined) continue
    if (s0.v < v10 && s1.v >= v10) t10 = crossingTime(s0, s1, v10)
    if (t10 !== null && s0.v < v90 && s1.v >= v90) return crossingTime(s0, s1, v90) - t10
  }
  return null
}

function fallTime(samples: WaveSample[], v10: number, v90: number): number | null {
  let t90: number | null = null
  for (let i = 1; i < samples.length; i++) {
    const s0 = samples[i - 1]
    const s1 = samples[i]
    if (s0 === undefined || s1 === undefined) continue
    if (s0.v > v90 && s1.v <= v90) t90 = crossingTime(s0, s1, v90)
    if (t90 !== null && s0.v > v10 && s1.v <= v10) return crossingTime(s0, s1, v10) - t90
  }
  return null
}

export function measureSeries(samples: WaveSample[]): WaveMeasurements {
  if (samples.length < 2) {
    const only = samples[0]?.v ?? 0
    return {
      vmax: only,
      vmin: only,
      vpp: 0,
      mean: only,
      rmsAc: 0,
      hz: null,
      periodS: null,
      dutyHigh: null,
      riseS: null,
      fallS: null,
    }
  }
  let vmax = Number.NEGATIVE_INFINITY
  let vmin = Number.POSITIVE_INFINITY
  let sum = 0
  for (const s of samples) {
    if (s.v > vmax) vmax = s.v
    if (s.v < vmin) vmin = s.v
    sum += s.v
  }
  const mean = sum / samples.length
  let sumSq = 0
  for (const s of samples) sumSq += (s.v - mean) ** 2
  const rmsAc = Math.sqrt(sumSq / samples.length)
  const vpp = vmax - vmin

  // A flat trace has levels, not timing — everything time-shaped is null.
  if (!(vpp > 1e-12)) {
    return {
      vmax,
      vmin,
      vpp,
      mean,
      rmsAc,
      hz: null,
      periodS: null,
      dutyHigh: null,
      riseS: null,
      fallS: null,
    }
  }

  const hz = countHz(samples, mean, rmsAc)
  const first = samples[0]
  const last = samples[samples.length - 1]
  const span = first !== undefined && last !== undefined ? last.t - first.t : 0
  const mid = (vmax + vmin) / 2
  const dutyHigh = span > 0 ? timeAbove(samples, mid) / span : null
  const v10 = vmin + 0.1 * vpp
  const v90 = vmin + 0.9 * vpp
  return {
    vmax,
    vmin,
    vpp,
    mean,
    rmsAc,
    hz,
    periodS: hz !== null ? 1 / hz : null,
    dutyHigh,
    riseS: riseTime(samples, v10, v90),
    fallS: fallTime(samples, v10, v90),
  }
}
