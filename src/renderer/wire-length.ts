/**
 * Wire length → real length + resistance (Sprint 19 S19-v3-7).
 *
 * Wire-as-connector model + hybrid scaling, decided with the project lead
 * (2026-06-06; scale band set 2026-06-07): a wire is a drawn connection whose
 * LENGTH feeds the physics.
 *  - Real lengths run on a fixed scale band: 0.01 inch to 3 feet. The drawn
 *    on-canvas length SEEDS the real length (pixels → metres), clamped to that
 *    band; editable afterwards. R = ρ·L/A runs on the real length at full
 *    precision.
 *  - The VISUAL length (when we later render by length) is a soft, monotonic
 *    mapping that stays in a reasonable on-screen range — a longer wire still
 *    looks longer, just compressed. Precision is spent on the math, not pixels.
 *
 * This module is the computational core (pure, unit-tested). Displaying it on
 * the canvas and feeding it back into the node-voltage solve come on top.
 */

/**
 * Base seed scale: one canvas pixel ≈ this many metres of real wire. Chosen so
 * a normally-drawn wire (~150–250 px) seeds a sensible bench length (~15–25 cm).
 */
export const METRES_PER_PIXEL = 0.001 // 1 px = 1 mm

const INCH_M = 0.0254
const FOOT_M = 0.3048
/**
 * Scale band (project lead, 2026-06-07): wire lengths run from 0.01 inch to
 * 3 feet. The seeded length is clamped to this band — a tiny connection keeps a
 * real minimum, and an over-long drag tops out at 3 ft.
 */
export const MIN_LENGTH_M = 0.01 * INCH_M // 0.01 in = 0.254 mm
export const MAX_LENGTH_M = 3 * FOOT_M // 3 ft = 0.9144 m

/**
 * Hybrid seed: a drawn on-canvas length (pixels) → a real length (metres),
 * clamped to the [0.01 in, 3 ft] scale band.
 */
export function lengthFromDrawn(pixels: number): number {
  const seeded = Math.max(0, pixels) * METRES_PER_PIXEL
  return Math.min(MAX_LENGTH_M, Math.max(MIN_LENGTH_M, seeded))
}

/**
 * Real length (metres) → a reasonable on-screen length (pixels). Soft and
 * asymptotic (tanh): ~linear for normal bench lengths, compressing toward
 * VISUAL_MAX for very long wires — approached, never clamped, so there is no
 * hard limit. For rendering by length later; the math never uses this.
 */
const VISUAL_MAX_PX = 600
const SOFT_KNEE_M = 0.3
export function visualFromLength(metres: number): number {
  return VISUAL_MAX_PX * Math.tanh(Math.max(0, metres) / SOFT_KNEE_M)
}

/**
 * Real-number resistance of a wire, R = ρ·L/A, in ohms.
 *
 * Defaults are real + cited so a wire is never ideal-by-accident; callers pass
 * catalog-sourced values once a drawn wire carries its own material + gauge.
 *  - resistivity: annealed copper at 20 °C (CRC Handbook of Chemistry & Physics).
 *  - area: 22 AWG (0.6438 mm diameter → 0.3255 mm²), a common hookup-wire gauge.
 */
const COPPER_RESISTIVITY_OHM_M = 1.68e-8
const AWG22_AREA_M2 = 3.255e-7
export function wireResistance(
  metres: number,
  resistivityOhmM = COPPER_RESISTIVITY_OHM_M,
  areaM2 = AWG22_AREA_M2,
): number {
  if (areaM2 <= 0) return 0
  return (resistivityOhmM * Math.max(0, metres)) / areaM2
}

/** Human-readable length in imperial — inches under a foot, feet at/above one. */
export function formatLength(metres: number): string {
  const inches = Math.max(0, metres) / INCH_M
  if (inches >= 12) return `${(inches / 12).toFixed(2)} ft`
  return `${inches.toFixed(2)} in`
}

/** Human-readable resistance, unit-scaled (Ω / mΩ / µΩ). */
export function formatResistance(ohms: number): string {
  const r = Math.abs(ohms)
  if (r >= 1) return `${r.toFixed(2)} Ω`
  if (r >= 1e-3) return `${(r * 1e3).toFixed(1)} mΩ`
  return `${(r * 1e6).toFixed(1)} µΩ`
}

/** Human-readable voltage drop across a wire, unit-scaled (V / mV / µV). */
export function formatVoltageDrop(volts: number): string {
  const v = Math.abs(volts)
  if (v >= 1) return `${v.toFixed(2)} V`
  if (v >= 1e-3) return `${(v * 1e3).toFixed(1)} mV`
  return `${(v * 1e6).toFixed(0)} µV`
}

/**
 * Human-readable absolute potential at a point (keeps sign), unit-scaled. Used by
 * the on-wire probe — 4 dp on volts so a millivolt-scale drop is legible as the
 * cursor rides along; microvolt-scale changes read on the drop line instead.
 */
export function formatPotential(volts: number): string {
  if (volts === 0) return '0 V'
  if (Math.abs(volts) >= 1) return `${volts.toFixed(4)} V`
  if (Math.abs(volts) >= 1e-3) return `${(volts * 1e3).toFixed(2)} mV`
  return `${(volts * 1e6).toFixed(0)} µV`
}
