import { createContext } from 'react'
import { METRES_PER_PIXEL } from './wire-length.ts'

/**
 * Visualization lenses (S19-v3-50; field lens S19-v3-57) — the Stage 6
 * overlays from SIMULATION-AND-VISUALIZATION-ARC.md, drawn from REAL solved
 * data:
 *  - voltage lens: every wire colored by its solved potential (blue = the
 *    circuit's lowest, red = highest), so voltage "altitude" reads at a glance;
 *  - power lens: every part halo-colored by its real dissipated watts
 *    (I·V from the solution), so the parts working hardest glow hottest;
 *  - field lens: bands around each wire sized by its real magnetic field,
 *    B = μ₀I/(2πr) from the solved current — each band edge is a true
 *    isofield contour (see fieldHaloRadiusPx);
 *  - flow animation: marching dashes along each wire — direction from the
 *    solved current's sign, speed from its magnitude.
 * Pure color/speed math here (unit-tested); the canvas consumes it via context.
 */

export type LensMode = 'none' | 'voltage' | 'power' | 'temp' | 'field'

export type LensState = {
  lens: LensMode
  flow: boolean
  /** Solved voltage range across all wire endpoints (volts). */
  vMin: number
  vMax: number
  /** Instance id → dissipated power (watts), from the part readings. */
  power: Map<string, number>
  /** The largest dissipated power (watts) — the lens's red end. */
  pMax: number
  /** Instance id → lumped part temperature (°C), from the part readings. */
  temp: Map<string, number>
  /** The hottest part (°C) — the temp lens's red end. */
  tMaxC: number
  /** Field lens contour level (tesla) — the outermost band edge. 0 = no current. */
  fieldTesla: number
}

export const LensContext = createContext<LensState>({
  lens: 'none',
  flow: false,
  vMin: 0,
  vMax: 0,
  power: new Map(),
  pMax: 0,
  temp: new Map(),
  tMaxC: 0,
  fieldTesla: 0,
})

/** 5-stop blue→cyan→green→yellow→red scale (the classic voltage-map ramp). */
const VOLTAGE_STOPS: [number, number, number][] = [
  [58, 96, 212], // blue — lowest potential
  [50, 182, 200], // cyan
  [72, 196, 84], // green
  [214, 196, 64], // yellow
  [214, 70, 52], // red — highest potential
]

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Color for a node potential within the circuit's solved [vMin, vMax] range.
 * A degenerate range (all nets at one potential) reads as the middle green.
 */
export function voltageColor(volts: number, vMin: number, vMax: number): string {
  const span = vMax - vMin
  const t = span > 0 ? Math.min(1, Math.max(0, (volts - vMin) / span)) : 0.5
  const scaled = t * (VOLTAGE_STOPS.length - 1)
  const i = Math.min(VOLTAGE_STOPS.length - 2, Math.floor(scaled))
  const f = scaled - i
  // biome-ignore lint/style/noNonNullAssertion: i is clamped to the stop range
  const lo = VOLTAGE_STOPS[i]!
  // biome-ignore lint/style/noNonNullAssertion: i+1 is clamped to the stop range
  const hi = VOLTAGE_STOPS[i + 1]!
  const c = (k: 0 | 1 | 2) => Math.round(lerp(lo[k], hi[k], f))
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`
}

/**
 * Heat color for a part dissipating `watts` against the circuit's hottest part
 * (pMax): yellow warming to red, alpha rising with the share. Null = no halo
 * (nothing dissipated, or nothing in the circuit dissipates).
 */
export function powerColor(watts: number, pMax: number): string | null {
  if (!(watts > 0) || !(pMax > 0)) return null
  const t = Math.min(1, watts / pMax)
  const r = 224
  const g = Math.round(lerp(196, 70, t))
  const b = Math.round(lerp(64, 50, t))
  const alpha = (0.25 + 0.45 * t).toFixed(2)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Heat color for a part at `tempC` against the circuit's hottest part, both
 * measured above the 25 °C standard ambient — the thermal-hotspot ramp (stage 7
 * lumped model). Null = no halo (at/below ambient, or nothing in the circuit
 * runs warm).
 */
export function temperatureColor(tempC: number, hottestC: number): string | null {
  const AMBIENT_C = 25
  const rise = tempC - AMBIENT_C
  const hottestRise = hottestC - AMBIENT_C
  if (!(rise > 0) || !(hottestRise > 0)) return null
  return powerColor(rise, hottestRise)
}

/**
 * Marching-dash period (seconds) for the flow animation: bigger current →
 * faster march, log-scaled from ~2 s at 1 µA down to 0.3 s at ~100 mA and up.
 * Null when no current flows (no animation on a dead wire).
 */
export function flowDuration(amps: number): number | null {
  const magnitude = Math.abs(amps)
  if (!(magnitude > 0)) return null
  const duration = 2 - 0.42 * Math.log10(magnitude / 1e-6)
  return Math.min(2, Math.max(0.3, duration))
}

/**
 * Vacuum permeability μ₀ (henry per metre). Since the 2019 SI redefinition it
 * is a measured constant, no longer exactly 4π×10⁻⁷ — CODATA gives
 * 1.25663706×10⁻⁶ H/m (the difference from 4π×10⁻⁷ is parts in 10⁹).
 */
export const MU_0 = 1.25663706e-6

/**
 * Magnetic-field lens (S19-v3-57). The math is Ampère's law for a long
 * straight wire — the textbook result B = μ₀·I/(2π·r): field strength falls
 * off as 1/distance, set ONLY by the current. Inverting for r gives the
 * radius of a true isofield contour, r = μ₀·I/(2π·B), converted to canvas
 * pixels through the SAME metres-per-pixel scale the wire-resistance physics
 * uses (1 px = 1 mm).
 *
 * Honest scope: exact for a long straight run; near bends and ends the real
 * field needs Biot–Savart, and fields from neighboring wires are NOT summed —
 * this lens shows each wire's own field. Full interacting-field solving is
 * the arc's future EM stage.
 */
export function fieldHaloRadiusPx(amps: number, contourTesla: number): number {
  const magnitude = Math.abs(amps)
  if (!(magnitude > 0) || !(contourTesla > 0)) return 0
  const radiusMetres = (MU_0 * magnitude) / (2 * Math.PI * contourTesla)
  return radiusMetres / METRES_PER_PIXEL
}

/**
 * Auto-ranged contour level for the lens — the field strength whose contour
 * around the BIGGEST current sits at a readable on-screen radius (like a real
 * instrument picking its range). The legend states the chosen level; Earth's
 * surface field is ~25–65 µT (NOAA NCEI) for comparison. 0 when nothing flows.
 */
export const FIELD_TARGET_PX = 22
export function fieldReferenceTesla(maxAbsAmps: number, targetPx = FIELD_TARGET_PX): number {
  if (!(maxAbsAmps > 0) || !(targetPx > 0)) return 0
  const targetMetres = targetPx * METRES_PER_PIXEL
  return (MU_0 * maxAbsAmps) / (2 * Math.PI * targetMetres)
}

/**
 * The lens draws three nested bands per wire — contours at 1×, 3×, and 10×
 * the reference level. Field falls as 1/r, so each stronger contour sits
 * proportionally closer to the wire.
 */
export const FIELD_CONTOUR_MULTIPLIERS = [1, 3, 10] as const
export const FIELD_COLOR = '#5ad8c8'
