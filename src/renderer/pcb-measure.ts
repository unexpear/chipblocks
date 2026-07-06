/**
 * The dimensional MEASURE / ruler tool for the board — real physical distances on the flat board
 * (which is drawn in true millimetres), in whatever unit the user wants. This is the geometry + unit
 * maths, kept pure and testable; the flat view draws the ruler and App owns the tool state. Distinct
 * from the multimeter, which measures ELECTRICAL quantities.
 */

export type MeasureUnit = 'mm' | 'cm' | 'in' | 'mil' | 'um'

/** One placed measurement — two points in board millimetres. */
export type Measurement = { a: { x: number; y: number }; b: { x: number; y: number } }

// mm → unit factor + display label + decimals. cm = mm/10, in = mm/25.4, mil = mm/0.0254 (1 in = 1000
// mil), µm = mm×1000. All exact conversions (the inch is defined as exactly 25.4 mm).
const UNITS: Record<MeasureUnit, { factor: number; label: string; digits: number }> = {
  mm: { factor: 1, label: 'mm', digits: 2 },
  cm: { factor: 0.1, label: 'cm', digits: 3 },
  in: { factor: 1 / 25.4, label: 'in', digits: 3 },
  mil: { factor: 1 / 0.0254, label: 'mil', digits: 1 },
  um: { factor: 1000, label: 'µm', digits: 0 },
}

/** The unit choices offered by the measure tool's selector (order = display order). */
export const MEASURE_UNITS: { id: MeasureUnit; label: string }[] = [
  { id: 'mm', label: 'mm' },
  { id: 'cm', label: 'cm' },
  { id: 'in', label: 'in' },
  { id: 'mil', label: 'mil' },
  { id: 'um', label: 'µm' },
]

/** A length given in mm, formatted in the chosen unit (with that unit's sensible precision). */
export function formatMeasure(mm: number, unit: MeasureUnit): string {
  const u = UNITS[unit]
  return `${(mm * u.factor).toFixed(u.digits)} ${u.label}`
}

/** The straight-line distance between two board points, in mm. */
export function measureDistanceMm(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** The signed run (Δx) and rise (Δy) between two points, in mm — for the "Δx / Δy" read-out. */
export function measureDelta(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { dx: number; dy: number } {
  return { dx: b.x - a.x, dy: b.y - a.y }
}
