/**
 * Scope triggering (S19-v3-75) — the instrument's synchronizer. The scope
 * waits for the chosen signal to cross a LEVEL on a chosen EDGE and aligns
 * the displayed sweep to that moment, so a repeating wave stands perfectly
 * still instead of wandering (the Tektronix-primer definition of a trigger).
 *
 * The simulated record is several windows long; the search starts after the
 * first window so power-on transients settle before the trigger arms — the
 * sweep then shows the circuit's steady behavior, the way a bench scope on a
 * running circuit does. t = 0 of the display is the trigger instant, with a
 * slice of PRE-trigger history shown to its left (standard scope behavior).
 *
 * Pure functions over sample arrays — unit-tested; the Scope component owns
 * the knobs.
 */

export type TriggerEdge = 'rising' | 'falling'
export type TriggerMode = 'auto' | 'normal' | 'single'

/** The level a scope's auto-set picks: the midpoint of the trace's swing. */
export function autoLevel(samples: number[]): number {
  if (samples.length === 0) return 0
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const s of samples) {
    if (s < lo) lo = s
    if (s > hi) hi = s
  }
  return (lo + hi) / 2
}

/**
 * The first index at/after `fromIndex` where the trace crosses `level` on the
 * given edge — rising: previous sample below the level, this one at/above it
 * (falling mirrored). Null when it never does (a flat or one-sided trace).
 */
export function findTriggerIndex(
  samples: number[],
  level: number,
  edge: TriggerEdge,
  fromIndex: number,
): number | null {
  for (let i = Math.max(1, fromIndex); i < samples.length; i++) {
    const previous = samples[i - 1]
    const current = samples[i]
    if (previous === undefined || current === undefined) continue
    if (edge === 'rising' && previous < level && current >= level) return i
    if (edge === 'falling' && previous > level && current <= level) return i
  }
  return null
}

/**
 * Align a one-window sweep inside the longer record: find the trigger (the
 * search starts after `searchFrom`, normally one window in, so the power-on
 * transient settles first), back up by the pre-trigger fraction, and clamp so
 * a full window always fits. Returns the slice start and where the trigger
 * sits inside the slice, or null when the trace never triggers.
 */
export function alignSweep(options: {
  samples: number[]
  level: number
  edge: TriggerEdge
  windowPoints: number
  searchFrom: number
  pretriggerFraction?: number
}): { start: number; triggerOffset: number } | null {
  const { samples, level, edge, windowPoints, searchFrom } = options
  const pretrigger = Math.floor(windowPoints * (options.pretriggerFraction ?? 0.1))
  const trigger = findTriggerIndex(samples, level, edge, searchFrom)
  if (trigger === null) return null
  let start = trigger - pretrigger
  if (start < 0) start = 0
  if (start + windowPoints > samples.length) start = Math.max(0, samples.length - windowPoints)
  return { start, triggerOffset: trigger - start }
}
