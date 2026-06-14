/**
 * Light (S21-v3-7/8) — the illumination axis, the optical cousin of temperature.
 *
 * Two quantities, mirroring the thermal axis exactly:
 *   - AMBIENT illuminance (`ambient_illuminance`, lux) — what you SET on a sensor,
 *     the baseline light it sits in (the optical `ambient_temperature`).
 *   - INCIDENT illuminance (`incident_illuminance`, lux) — what actually FALLS on
 *     it: the ambient PLUS every light source casting onto it (the optical
 *     "junction temperature = ambient + self-heating"). Computed, not set.
 *
 * A light SOURCE casts by distance: a lamp at a canvas position throws light that
 * falls off as the inverse square, E = I / d² (I in candela, d in metres). Each
 * sensor's incident illuminance is its ambient plus the sum over all sources —
 * so dragging a sensor toward a lamp really does brighten it. This is the one
 * place in ChipBlocks where canvas POSITION carries physics; everywhere else the
 * schematic is a position-free wiring graph. The px→metre scale is shared with
 * the wire-length / magnetic-field physics (1 px = 1 mm).
 *
 * Honest scope: point sources only (omnidirectional), no occlusion (a part
 * between lamp and sensor casts no shadow), no beam angle. Those are refinements.
 */

import type { Instance, World } from './cross-fk-validator.ts'
import { readScalarParam } from './instance-params.ts'

/** The standard photoresistor reference illuminance, lux (datasheets spec R at 10 lux). */
const DEFAULT_REFERENCE_LUX = 10

/** Canvas scale: 1 px = 1 mm, shared with the wire-length + magnetic-field physics. */
export const LIGHT_PX_PER_METRE = 1000

/** A sensor that sits in the light and is set by it (reads incident illuminance). */
export const LIGHT_SENSOR_DEFINITIONS: ReadonlySet<string> = new Set([
  'photoresistor',
  'photodiode',
  'phototransistor',
])

/** A sensor's effective illuminance (lux): the computed incident value if a cast
 *  has been folded in, else the ambient baseline it was set to. Zero if neither. */
export function sensorIlluminance(inst: Instance): number {
  return (
    readScalarParam(inst, 'incident_illuminance') ??
    readScalarParam(inst, 'ambient_illuminance') ??
    0
  )
}

/**
 * A photoresistor's (LDR's) resistance at the light on it, the standard datasheet
 * power law:
 *   R(E) = R₀·(E/E₀)^(−γ)
 * R₀ is `reference_resistance` (the resistance at the reference illuminance E₀,
 * `reference_illuminance`, default 10 lux), γ is `gamma` (the log-log slope,
 * ~0.5–0.9 for a CdS cell). Resistance FALLS as light rises. In the dark (E ≤ 0)
 * and as E → 0 the law diverges, so it is capped at `dark_resistance` (the cell's
 * unlit resistance). Undefined when R₀ or γ is missing.
 */
export function ldrResistance(inst: Instance): number | undefined {
  const r0 = readScalarParam(inst, 'reference_resistance')
  const gamma = readScalarParam(inst, 'gamma')
  if (r0 === undefined || gamma === undefined || r0 <= 0) return undefined
  const e0 = readScalarParam(inst, 'reference_illuminance') ?? DEFAULT_REFERENCE_LUX
  const dark = readScalarParam(inst, 'dark_resistance') ?? r0 * 100
  const e = sensorIlluminance(inst)
  if (e <= 0 || e0 <= 0) return dark
  const r = r0 * (e / e0) ** -gamma
  // Never below a 1 Ω floor (numerical safety) nor above the unlit dark resistance.
  return Math.min(Math.max(r, 1), dark)
}

/**
 * The current (A) a light sensor SOURCES from the light on it — for the parts
 * that turn light into current rather than resistance:
 *   - a photodiode's reverse photocurrent  I = responsivity · E   (∝ E)
 *   - a phototransistor's collector current I_C = β · I_photo      (that × its gain)
 * `photocurrent_per_lux` is the responsivity in A/lux; a phototransistor also
 * reads `current_gain` (β). E is the incident illuminance (ambient + cast). Zero
 * without a responsivity. The honest first-rung model: a light-controlled current
 * source, ignoring the dark current and the diode's own I-V (valid in the
 * photoconductive region the part is used in).
 */
export function lightSensorCurrent(inst: Instance): number {
  const perLux = readScalarParam(inst, 'photocurrent_per_lux')
  if (perLux === undefined) return 0
  const photocurrent = perLux * sensorIlluminance(inst)
  if (inst.definition === 'phototransistor') {
    return (readScalarParam(inst, 'current_gain') ?? 1) * photocurrent
  }
  return photocurrent
}

/** A point light source placed on the canvas: a position (px) and a luminous
 *  intensity (candela). */
export interface LightSource {
  x: number
  y: number
  intensityCandela: number
}

/** A 2 mm floor on source→sensor distance — a sensor sitting on top of a lamp
 *  gets a large-but-finite illuminance, never an inverse-square singularity. */
const MIN_DISTANCE_M = 0.002

/**
 * The illuminance (lux) cast onto a point by point sources — the inverse-square
 * law summed over every source (light adds linearly):
 *   E = Σ  I_source / d²        (I in candela, d in metres)
 * Distances come from canvas pixels via LIGHT_PX_PER_METRE. Zero when there are
 * no sources.
 */
export function castIlluminance(
  at: { x: number; y: number },
  sources: readonly LightSource[],
): number {
  let lux = 0
  for (const source of sources) {
    const dx = (source.x - at.x) / LIGHT_PX_PER_METRE
    const dy = (source.y - at.y) / LIGHT_PX_PER_METRE
    const d2 = Math.max(dx * dx + dy * dy, MIN_DISTANCE_M * MIN_DISTANCE_M)
    lux += source.intensityCandela / d2
  }
  return lux
}

/**
 * The world with each light sensor's `incident_illuminance` set to what actually
 * falls on it — its `ambient_illuminance` baseline plus the cast from every
 * source at that sensor's canvas position. The solver then reads one number
 * (incident) and the sensor responds to the real, position-dependent light.
 * With no sources, incident = ambient (a copy), so a lamp-free scene behaves
 * exactly as the per-part dial alone. Sensors without a known position are left
 * at their ambient (a sensor inside a block has no top-level canvas position yet).
 */
export function worldWithCastLight(
  world: World,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  sources: readonly LightSource[],
): World {
  const instances = new Map(world.instances)
  let changed = false
  for (const [id, inst] of world.instances) {
    if (!LIGHT_SENSOR_DEFINITIONS.has(inst.definition)) continue
    const ambient = readScalarParam(inst, 'ambient_illuminance') ?? 0
    const at = positions.get(id)
    const incident = ambient + (at ? castIlluminance(at, sources) : 0)
    instances.set(id, {
      ...inst,
      parameters: {
        ...inst.parameters,
        incident_illuminance: { value: { kind: 'scalar', amount: incident, unit: 'lux' } },
      },
    })
    changed = true
  }
  return changed ? { ...world, instances } : world
}
