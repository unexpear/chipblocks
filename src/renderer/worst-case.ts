/**
 * Worst-case tolerance analysis (S21-v3-10) — the move from "is NOMINAL safe?" to
 * "is EVERY corner safe?", which is the question a real design sign-off asks.
 *
 * Every part carries a real, cited tolerance (a resistor is ±5%, etc.) that until
 * now did nothing — every solve ran at the nominal value. This sweeps those
 * tolerances: for each part reading (current / voltage / power / temperature) it
 * finds the MIN and MAX the reading can take when every toleranced part ranges
 * over its band, and crosses the worst case against the part's rating.
 *
 * Method (exact for a monotonic response, which DC analog circuits are over a
 * few-percent band): solve nominal; perturb each toleranced part to its high end
 * one at a time to learn the SIGN of every reading's sensitivity to it; then for
 * each reading assemble and solve its worst corner (every part pushed the
 * direction that drives that reading highest / lowest). No new physics — it just
 * re-runs the existing solver with perturbed values. Honest limitation: if a
 * reading is NON-monotonic in a component value (rare at ±5%), the true extreme
 * could sit between corners and this would under-state it; the bounds are exact
 * for the corners solved.
 */

import type { Instance, World } from '../cross-fk-validator.ts'
import type { Solution } from '../dc-solver.ts'
import { readScalarParam } from '../instance-params.ts'
import { type PartReading, partReadings } from './part-readings.ts'

export type Quantity = 'current' | 'voltage' | 'power' | 'temperature'
const QUANTITIES: Quantity[] = ['current', 'voltage', 'power', 'temperature']

/** Definitions whose declared VALUE carries the ±tolerance the sweep varies. */
const TOLERANCED_VALUE: Record<string, string> = {
  resistor: 'resistance',
  capacitor: 'capacitance',
  inductor: 'inductance',
}

export interface TolerancePart {
  id: string
  param: string
  nominal: number
  /** The value param's unit (ohm / farad / henry), for display. */
  unit: string
  /** The half-band as a fraction, e.g. 0.05 for ±5 %. */
  tolFraction: number
}

/** The toleranced parts in a world: those with both a value param and a tolerance_percent. */
export function toleranceParts(world: World): TolerancePart[] {
  const parts: TolerancePart[] = []
  for (const inst of world.instances.values()) {
    const param = TOLERANCED_VALUE[inst.definition]
    if (param === undefined) continue
    const nominal = readScalarParam(inst, param)
    const tolPct = readScalarParam(inst, 'tolerance_percent')
    if (nominal === undefined || nominal <= 0 || tolPct === undefined || tolPct <= 0) continue
    const unit = (inst.parameters?.[param] as { value?: { unit?: string } } | undefined)?.value
      ?.unit
    parts.push({ id: inst.id, param, nominal, unit: unit ?? '', tolFraction: tolPct / 100 })
  }
  return parts
}

/** The rating (absolute-max limit) for a part's reading, if it declares one. The
 *  worst-case is crossed against this. Temperature uses max_operating_temperature;
 *  power the power_rating; current whichever current limit the part type carries. */
function ratingFor(inst: Instance, quantity: Quantity): number | undefined {
  if (quantity === 'temperature') return readScalarParam(inst, 'max_operating_temperature')
  if (quantity === 'power') return readScalarParam(inst, 'power_rating')
  if (quantity === 'current') {
    for (const key of [
      'max_forward_current',
      'max_drain_current',
      'max_collector_current',
      'max_current',
      'rated_current',
      'current_rating',
    ]) {
      const limit = readScalarParam(inst, key)
      if (limit !== undefined) return limit
    }
  }
  return undefined
}

const readingOf = (reading: PartReading | undefined, q: Quantity): number | undefined =>
  q === 'current'
    ? reading?.current
    : q === 'voltage'
      ? reading?.voltage
      : q === 'power'
        ? reading?.power
        : reading?.temperatureC

/** A world with the listed parts moved to a corner: dir +1 = high end of the
 *  tolerance band, −1 = low end, 0 = nominal. Units/structure preserved. */
function worldAtCorner(world: World, parts: TolerancePart[], dirs: Map<string, number>): World {
  const instances = new Map(world.instances)
  for (const part of parts) {
    const dir = dirs.get(part.id) ?? 0
    if (dir === 0) continue
    const inst = instances.get(part.id)
    const existing = inst?.parameters?.[part.param] as
      | { value?: { kind: string; amount: number; unit: string } }
      | undefined
    if (inst === undefined || existing?.value === undefined) continue
    const amount = part.nominal * (1 + dir * part.tolFraction)
    instances.set(part.id, {
      ...inst,
      parameters: {
        ...inst.parameters,
        [part.param]: { ...existing, value: { ...existing.value, amount } },
      },
    })
  }
  return { ...world, instances }
}

export interface WorstCaseEntry {
  partId: string
  quantity: Quantity
  nominal: number
  min: number
  max: number
  /** The part's rating for this quantity, if any. */
  rating?: number
  /** worst (closest-to-rating) value as a fraction of the rating, if rated. */
  worstFractionOfRating?: number
  /** Does any corner exceed the rating? */
  exceedsRating?: boolean
}

export interface WorstCaseResult {
  entries: WorstCaseEntry[]
  toleranceParts: TolerancePart[]
  /** True once a real sweep ran (≥1 toleranced part); false = nothing to vary. */
  swept: boolean
}

/**
 * Sweep every toleranced part's band and report each reading's min/max envelope,
 * crossed against ratings. `solve` is the project's real solve (heat-aware), passed
 * in so this stays decoupled and testable; it must return the solved `Solution`.
 */
export function worstCaseAnalysis(world: World, solve: (w: World) => Solution): WorstCaseResult {
  const parts = toleranceParts(world)
  const nominalReadings = partReadings(world, solve(world))

  if (parts.length === 0) {
    // Nothing to vary — every envelope collapses to the nominal point.
    return {
      entries: collectEntries(world, nominalReadings, () => undefined),
      toleranceParts: [],
      swept: false,
    }
  }

  // Sensitivity pass: each part to its HIGH end alone, to learn every reading's
  // sign of response to it (and to bank real corner samples for the min/max).
  const perturbed = new Map<string, Map<string, PartReading>>()
  for (const part of parts) {
    const cornered = worldAtCorner(world, parts, new Map([[part.id, 1]]))
    perturbed.set(part.id, partReadings(cornered, solve(cornered)))
  }

  // Cache corner solves by their direction pattern — many readings share a corner.
  const cornerCache = new Map<string, Map<string, PartReading>>()
  const cornerKey = (dirs: Map<string, number>) =>
    parts.map((p) => `${dirs.get(p.id) ?? 0}`).join('')
  const readingsAtCorner = (dirs: Map<string, number>): Map<string, PartReading> => {
    if (parts.every((p) => (dirs.get(p.id) ?? 0) === 0)) return nominalReadings
    const key = cornerKey(dirs)
    const hit = cornerCache.get(key)
    if (hit !== undefined) return hit
    const cornered = worldAtCorner(world, parts, dirs)
    const solved = partReadings(cornered, solve(cornered))
    cornerCache.set(key, solved)
    return solved
  }

  const cornerForReading = (partId: string, q: Quantity, nom: number, sign: 1 | -1): number => {
    const hiDirs = new Map<string, number>()
    for (const part of parts) {
      const sample = readingOf(perturbed.get(part.id)?.get(partId), q)
      const slope = sample === undefined ? 0 : Math.sign(sample - nom)
      hiDirs.set(part.id, sign * slope)
    }
    return readingOf(readingsAtCorner(hiDirs).get(partId), q) ?? nom
  }

  const minMax = (partId: string, q: Quantity, nom: number): { min: number; max: number } => {
    // Candidates: nominal, every single-part high sample, and the two assembled corners.
    const candidates = [
      nom,
      cornerForReading(partId, q, nom, 1),
      cornerForReading(partId, q, nom, -1),
    ]
    for (const part of parts) {
      const sample = readingOf(perturbed.get(part.id)?.get(partId), q)
      if (sample !== undefined) candidates.push(sample)
    }
    return { min: Math.min(...candidates), max: Math.max(...candidates) }
  }

  return {
    entries: collectEntries(world, nominalReadings, minMax),
    toleranceParts: parts,
    swept: true,
  }
}

/** Build one entry per (part, present-quantity), with min/max from `bounds`
 *  (undefined bounds = the no-sweep case where everything collapses to nominal). */
function collectEntries(
  world: World,
  nominalReadings: Map<string, PartReading>,
  bounds: (partId: string, q: Quantity, nom: number) => { min: number; max: number } | undefined,
): WorstCaseEntry[] {
  const entries: WorstCaseEntry[] = []
  for (const [partId, reading] of nominalReadings) {
    const inst = world.instances.get(partId)
    if (inst === undefined) continue
    for (const q of QUANTITIES) {
      const nom = readingOf(reading, q)
      if (nom === undefined) continue
      const { min, max } = bounds(partId, q, nom) ?? { min: nom, max: nom }
      const entry: WorstCaseEntry = { partId, quantity: q, nominal: nom, min, max }
      const rating = ratingFor(inst, q)
      if (rating !== undefined && rating > 0) {
        entry.rating = rating
        entry.worstFractionOfRating = max / rating
        entry.exceedsRating = max > rating
      }
      entries.push(entry)
    }
  }
  return entries
}
