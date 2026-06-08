/**
 * Resistor resistance derived from its material + geometry (Sprint 19 S19-v3-34).
 *
 * A resistor can carry a DECLARED resistance (a spec part — trusted) or a DERIVED
 * one: R = ρ·L/A from the resistive_material's resistivity and the geometry's
 * length + cross-section area (device-resistor.yaml declares both paths). The
 * Properties panel's "Derive R = ρL/A" action computes the derived value on
 * demand, so a custom / heating-element resistor's material is real, not a label.
 *
 * Pure + unit-tested; the App wires it to the button.
 */

import { representativeAmount } from './material-properties.ts'

type Param = { value?: unknown } | undefined

/** A material's resistivity in Ω·m, from its `resistivity` property value. */
export function resistivityOhmM(value: unknown): number | null {
  return representativeAmount(value, 'ohm_meter')
}

/** R = ρ·L/A in ohms; null on non-positive resistivity, length, or area. */
export function deriveResistance(
  rhoOhmM: number,
  lengthMetres: number,
  areaSquareMetres: number,
): number | null {
  if (!(rhoOhmM > 0) || !(lengthMetres > 0) || !(areaSquareMetres > 0)) return null
  return (rhoOhmM * lengthMetres) / areaSquareMetres
}

const scalarAmount = (param: Param): number | null => {
  const v = param?.value as { kind?: unknown; amount?: unknown } | undefined
  return v && v.kind === 'scalar' && typeof v.amount === 'number' ? v.amount : null
}
const bareString = (param: Param): string | null =>
  typeof param?.value === 'string' ? param.value : null

/**
 * Derive a resistor's resistance (Ω) from its parameters — resistive_material +
 * geometry length + cross_section_area — and a material→resistivity map. Returns
 * null when any input is missing (so the caller leaves the declared value alone).
 * Rounded to 3 decimals for a clean stored value.
 */
export function deriveResistorOhms(
  parameters: Record<string, Param> | undefined,
  resistivityByMaterial: Map<string, number>,
): number | null {
  const material = bareString(parameters?.resistive_material)
  const length = scalarAmount(parameters?.length)
  const area = scalarAmount(parameters?.cross_section_area)
  if (material === null || length === null || area === null) return null

  const rho = resistivityByMaterial.get(material)
  if (rho === undefined) return null

  const ohms = deriveResistance(rho, length, area)
  return ohms === null ? null : Math.round(ohms * 1000) / 1000
}
