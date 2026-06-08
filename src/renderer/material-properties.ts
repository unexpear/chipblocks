/**
 * Shared extraction of a single representative amount from a catalog property
 * value (Sprint 19 S19-v3-34). Material/device property values come in several
 * kinds — condition_bound / scalar carry an `amount`; range carries `typical`
 * (falling back to the min/max midpoint). This reads the representative number
 * when the unit matches, so the LED's bandgap and the resistor's resistivity
 * (and any future derived value) are read the same way, in one place.
 */

type AmountValue = {
  amount?: unknown
  typical?: unknown
  min?: unknown
  max?: unknown
  unit?: unknown
}

/**
 * The representative number from a property value, or null when it isn't a usable
 * quantity in `expectedUnit` (wrong unit, or a value kind with no amount — e.g. a
 * metal has no bandgap_energy property at all).
 */
export function representativeAmount(value: unknown, expectedUnit: string): number | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as AmountValue
  if (v.unit !== undefined && v.unit !== expectedUnit) return null
  if (typeof v.amount === 'number') return v.amount
  if (typeof v.typical === 'number') return v.typical
  if (typeof v.min === 'number' && typeof v.max === 'number') return (v.min + v.max) / 2
  return null
}
