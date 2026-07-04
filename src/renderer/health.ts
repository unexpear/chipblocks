import { createContext } from 'react'
import type { World } from '../cross-fk-validator.ts'
import type { Solution } from '../dc-solver.ts'
import { detectFailures } from '../failure-detector.ts'
import { readScalarParam } from '../instance-params.ts'
import { acrossVolts, bulbFilamentTemperatureC } from '../thermal-model.ts'
import type { ContentionFinding } from './output-contention.ts'

/**
 * Per-part health for the canvas (Sprint 19) — drives the success / failure
 * feedback. A part that exceeds a rating (per the §19 failure-detector) is
 * `failed` (it bursts on the canvas); an LED carrying current within its rating
 * is `lit` and glows IN ITS REAL EMISSION COLOR (from peak_wavelength) — a 640 nm
 * part glows red, a 470 nm part blue. Both come from the real solved currents +
 * declared ratings + wavelength — never faked, per "real all the way down".
 */
export type NodeHealth = {
  lit?: boolean
  /** A lit LED's emission color (CSS rgb), mapped from its peak_wavelength. */
  glow?: string
  /** A lit LED's brightness 0..1 from its REAL forward current — lets a dot-matrix render grey/shaded
   *  levels (a dimly-driven pixel reads dark). 1.0 at normal operating current. */
  brightness?: number
  failed?: boolean
  /** A non-fatal caution (e.g. a shared-bus output combination that needs care) — amber, no burst. */
  warned?: boolean
  note?: string
}

/** Default LED peak wavelength (nm) when an instance declares none — red AlGaInP. */
const DEFAULT_LED_NM = 640

/**
 * Approximate visible-spectrum color for a wavelength (nm) as a CSS rgb() string
 * (Bruton-style piecewise mapping + edge falloff). Below ~380 nm (UV) and above
 * ~780 nm (IR) the light is invisible — returned as a dim violet / near-black so
 * the glow honestly shows "you can't really see this one."
 */
export function wavelengthToColor(nm: number): string {
  let r = 0
  let g = 0
  let b = 0
  if (nm >= 380 && nm < 440) {
    r = (440 - nm) / 60
    b = 1
  } else if (nm >= 440 && nm < 490) {
    g = (nm - 440) / 50
    b = 1
  } else if (nm >= 490 && nm < 510) {
    g = 1
    b = (510 - nm) / 20
  } else if (nm >= 510 && nm < 580) {
    r = (nm - 510) / 70
    g = 1
  } else if (nm >= 580 && nm < 645) {
    r = 1
    g = (645 - nm) / 65
  } else if (nm >= 645 && nm <= 780) {
    r = 1
  } else if (nm < 380) {
    r = 0.25 // UV — invisible; a faint violet stand-in
    b = 0.4
  } else {
    r = 0.15 // IR — invisible; near-black with a dim red hint
  }
  let factor = 1
  if (nm >= 380 && nm < 420) factor = 0.3 + (0.7 * (nm - 380)) / 40
  else if (nm > 700 && nm <= 780) factor = 0.3 + (0.7 * (780 - nm)) / 80
  const to255 = (c: number) => Math.round(255 * c * factor)
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`
}

/** The Draper point (°C): a solid begins to glow visibly red around here, so a
 *  filament cooler than this isn't lit yet (~798 K). */
const DRAPER_POINT_C = 525

/** Points on the blackbody (Planckian) locus as sRGB — Mitchell Charity's blackbody
 *  color table — so a hot filament glows the REAL color for its temperature: dull
 *  red, through amber, to warm white as it heats. */
const BLACKBODY_LOCUS: { k: number; r: number; g: number; b: number }[] = [
  { k: 1000, r: 255, g: 56, b: 0 },
  { k: 1500, r: 255, g: 109, b: 0 },
  { k: 2000, r: 255, g: 137, b: 18 },
  { k: 2500, r: 255, g: 159, b: 69 },
  { k: 3000, r: 255, g: 180, b: 107 },
  { k: 3500, r: 255, g: 196, b: 137 },
]

/** The incandescent glow color (CSS rgb) for a filament at temperatureC, interpolated
 *  along the blackbody locus — cooler/dimmer is redder, hotter is whiter. */
export function incandescentColor(temperatureC: number): string {
  const k = temperatureC + 273.15
  const lo = BLACKBODY_LOCUS[0]
  const hi = BLACKBODY_LOCUS[BLACKBODY_LOCUS.length - 1]
  if (lo === undefined || hi === undefined) return 'rgb(255, 160, 80)'
  if (k <= lo.k) return `rgb(${lo.r}, ${lo.g}, ${lo.b})`
  if (k >= hi.k) return `rgb(${hi.r}, ${hi.g}, ${hi.b})`
  for (let i = 1; i < BLACKBODY_LOCUS.length; i++) {
    const a = BLACKBODY_LOCUS[i - 1]
    const b = BLACKBODY_LOCUS[i]
    if (a === undefined || b === undefined) continue
    if (k <= b.k) {
      const f = (k - a.k) / (b.k - a.k)
      const mix = (x: number, y: number) => Math.round(x + (y - x) * f)
      return `rgb(${mix(a.r, b.r)}, ${mix(a.g, b.g)}, ${mix(a.b, b.b)})`
    }
  }
  return `rgb(${hi.r}, ${hi.g}, ${hi.b})`
}

// Light-emitting junctions that glow when conducting — LEDs and the laser diode (which emits like an
// LED below its lasing threshold), each at its own peak wavelength.
const LED_DEFINITIONS = new Set(['led', 'led_uv_algan', 'diode_laser'])
/** 0.1 mA — above this an LED is visibly conducting (so: glowing). */
const LIT_FLOOR_AMPS = 1e-4

/** Map each instance id to its health, from a solved world. Empty if unsolved.
 *  projectAmbientC (the board ambient the world was solved at) flows into the
 *  over-temperature check so its temperature matches the rest of the app;
 *  solvedTemperaturesC (the electro-thermal loop's settled map) keeps a part
 *  the loop burned OPEN flagged red — its final solution dissipates nothing. */
export function canvasHealth(
  world: World,
  solution: Solution,
  projectAmbientC?: number,
  solvedTemperaturesC?: ReadonlyMap<string, number>,
): Map<string, NodeHealth> {
  const health = new Map<string, NodeHealth>()
  if (solution.status !== 'solved') return health

  const failures = new Map(
    detectFailures(world, solution, projectAmbientC, solvedTemperaturesC).map((f) => [f.source, f]),
  )
  for (const inst of world.instances.values()) {
    const failure = failures.get(inst.id)
    if (failure) {
      health.set(inst.id, {
        failed: true,
        note: `${failure.ratio.toFixed(1)}× over ${failure.kind.replace(/_/g, ' ')}`,
      })
      continue
    }
    if (LED_DEFINITIONS.has(inst.definition)) {
      const current = Math.abs(solution.branches.get(inst.id) ?? 0)
      if (current > LIT_FLOOR_AMPS) {
        const nm = readScalarParam(inst, 'peak_wavelength') ?? DEFAULT_LED_NM
        // brightness from the REAL forward current: full at ~40% of the max rated current (a normal
        // operating point), with a perceptual gamma so a dimly-driven LED reads right. A solid-on display
        // (5 V through its resistor) lands at ≥ this, so it stays full-bright; only a dimmed pixel greys.
        const iFull = (readScalarParam(inst, 'max_forward_current') ?? 0.02) * 0.4
        const brightness = Math.min(1, (current / iFull) ** 0.6)
        health.set(inst.id, { lit: true, glow: wavelengthToColor(nm), brightness })
      }
    } else if (inst.definition === 'incandescent_bulb') {
      // A bulb glows the color of its self-heated filament — radiation-cooled, so the
      // temperature (and color) come from its real dissipation, then shift along the
      // blackbody locus: dim → dull red, bright → warm white. Cooler than the Draper
      // point it isn't visibly lit.
      const branch = solution.branches.get(inst.id)
      const volts = acrossVolts(inst, solution)
      if (branch !== undefined && volts !== undefined) {
        const ambient = readScalarParam(inst, 'ambient_temperature') ?? projectAmbientC
        const filamentC = bulbFilamentTemperatureC(inst, Math.abs(branch) * volts, ambient)
        if (filamentC !== undefined && filamentC > DRAPER_POINT_C) {
          health.set(inst.id, { lit: true, glow: incandescentColor(filamentC) })
        }
      }
    }
  }
  return health
}

/** Health by node id, read by each DeviceNode to render its glow / burst. */
export const HealthContext = createContext<Map<string, NodeHealth>>(new Map())

/** A CRT's live beam, read by its DeviceNode to draw the screen: the DC landing spot, the brightness
 *  (0..1, from the grid bias) and — after a transient run — the beam's locus over time. All are
 *  screen-fractions (−1..1) straight from the real deflection law (crtSpotTrace), never painted. */
export type CrtScreenData = {
  spot: { x: number; y: number }
  brightness: number
  /** The beam locus over the last transient run; i = per-point intensity 0..1 (the video / Z-axis,
   *  so a raster TV's grid-modulated picture paints, not just a constant-brightness scope trace). */
  trace?: readonly { x: number; y: number; i: number }[]
}
export const CrtScreenContext = createContext<Map<string, CrtScreenData>>(new Map())

/**
 * Map output-contention findings (output-contention.ts) onto per-block health. A push-pull
 * contention is a real fault — a dead short — so it `failed`s (the block bursts); the shared-bus
 * cautions (open-collector / tri-state) `warned` (an amber flag, no burst). Each involved block
 * carries the finding's message as its note.
 */
export function contentionHealth(findings: ContentionFinding[]): Map<string, NodeHealth> {
  const map = new Map<string, NodeHealth>()
  for (const finding of findings) {
    for (const { nodeId } of finding.pins) {
      if (finding.severity === 'error') map.set(nodeId, { failed: true, note: finding.message })
      else if (map.get(nodeId)?.failed !== true)
        map.set(nodeId, { warned: true, note: finding.message })
    }
  }
  return map
}

/** Overlay one health map on another (the structural contention pass on top of the solved health),
 *  combining notes and letting a hard `failed` win over a softer `warned`. */
export function mergeHealth(
  base: Map<string, NodeHealth>,
  overlay: Map<string, NodeHealth>,
): Map<string, NodeHealth> {
  if (overlay.size === 0) return base
  const out = new Map(base)
  for (const [id, oh] of overlay) {
    const bh = out.get(id)
    if (bh === undefined) {
      out.set(id, oh)
      continue
    }
    const failed = bh.failed === true || oh.failed === true
    out.set(id, {
      ...bh,
      ...oh,
      failed,
      warned: (bh.warned === true || oh.warned === true) && !failed,
      note: [bh.note, oh.note].filter(Boolean).join(' · '),
    })
  }
  return out
}
