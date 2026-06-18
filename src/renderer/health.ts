import { createContext } from 'react'
import type { World } from '../cross-fk-validator.ts'
import type { Solution } from '../dc-solver.ts'
import { detectFailures } from '../failure-detector.ts'
import { readScalarParam } from '../instance-params.ts'

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
  failed?: boolean
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

// Light-emitting junctions that glow when conducting — LEDs and the laser diode (which emits like an
// LED below its lasing threshold), each at its own peak wavelength.
const LED_DEFINITIONS = new Set(['led', 'led_uv_algan', 'diode_laser'])
/** 0.1 mA — above this an LED is visibly conducting (so: glowing). */
const LIT_FLOOR_AMPS = 1e-4

/** Map each instance id to its health, from a solved world. Empty if unsolved.
 *  projectAmbientC (the board ambient the world was solved at) flows into the
 *  over-temperature check so its temperature matches the rest of the app. */
export function canvasHealth(
  world: World,
  solution: Solution,
  projectAmbientC?: number,
): Map<string, NodeHealth> {
  const health = new Map<string, NodeHealth>()
  if (solution.status !== 'solved') return health

  const failures = new Map(
    detectFailures(world, solution, projectAmbientC).map((f) => [f.source, f]),
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
        health.set(inst.id, { lit: true, glow: wavelengthToColor(nm) })
      }
    }
  }
  return health
}

/** Health by node id, read by each DeviceNode to render its glow / burst. */
export const HealthContext = createContext<Map<string, NodeHealth>>(new Map())
