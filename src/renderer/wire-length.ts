/**
 * Wire length → real length + resistance (Sprint 19 S19-v3-7).
 *
 * Wire-as-connector model + hybrid scaling, decided with the project lead
 * (2026-06-06): a wire is a drawn connection whose LENGTH feeds the physics.
 *  - The MATH runs on the real length, full precision, no cap — R = ρ·L/A.
 *  - The drawn on-canvas length SEEDS the real length (hybrid): pixels → metres
 *    via a base scale; editable afterwards.
 *  - The VISUAL length (when we later render by length) is a soft, monotonic
 *    mapping that stays in a reasonable on-screen range with NO hard clamp — so
 *    a very long wire still looks longer, just compressed. That keeps rendering
 *    cheap; the precision is spent on the math, not the pixels.
 *
 * This module is the computational core (pure, unit-tested). Displaying it on
 * the canvas and feeding it back into the node-voltage solve come on top.
 */

/**
 * Base seed scale: one canvas pixel ≈ this many metres of real wire. Chosen so
 * a normally-drawn wire (~150–250 px) seeds a sensible bench length (~15–25 cm).
 * Linear and uncapped — drawing longer simply seeds a longer real wire.
 */
export const METRES_PER_PIXEL = 0.001 // 1 px = 1 mm

/** Hybrid seed: a drawn on-canvas length (pixels) → a real length (metres). */
export function lengthFromDrawn(pixels: number): number {
  return Math.max(0, pixels) * METRES_PER_PIXEL
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

/** Human-readable length, unit-scaled (m / cm / mm). */
export function formatLength(metres: number): string {
  const m = Math.max(0, metres)
  if (m >= 1) return `${m.toFixed(2)} m`
  if (m >= 0.01) return `${(m * 100).toFixed(1)} cm`
  return `${(m * 1000).toFixed(1)} mm`
}

/** Human-readable resistance, unit-scaled (Ω / mΩ / µΩ). */
export function formatResistance(ohms: number): string {
  const r = Math.abs(ohms)
  if (r >= 1) return `${r.toFixed(2)} Ω`
  if (r >= 1e-3) return `${(r * 1e3).toFixed(1)} mΩ`
  return `${(r * 1e6).toFixed(1)} µΩ`
}
