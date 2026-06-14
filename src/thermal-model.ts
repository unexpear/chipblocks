/**
 * Thermal model — stage 7's first rung (S19-v3-48): the lumped
 * thermal-resistance network, per SIMULATION-AND-VISUALIZATION-ARC.md ("from-
 * scratch … lumped thermal-resistance networks for PCB-scale modeling").
 *
 * The datasheet-grade steady-state model every manufacturer specifies:
 *   T_junction = T_ambient + P · θ_JA
 * where θ_JA (kelvin per watt) is the package's junction-to-ambient thermal
 * resistance — a real, cited datasheet number (TO-92 ≈ 200 K/W, 5 mm epoxy LED
 * ≈ 300 K/W). P is the part's REAL dissipated power from the solved circuit.
 *
 * Honest scope: steady-state and per-part (each part to ambient independently).
 * Part-to-part conduction across a shared board (the 2-D finite-difference
 * spatial solver over FR4, ~0.3 W/m·K) needs board geometry, which doesn't
 * exist yet — that lands with the PCB layer, not before.
 */

/** Standard datasheet ambient, °C (the 25 °C every θ_JA rating assumes). */
export const STANDARD_AMBIENT_C = 25

/**
 * Steady-state junction/part temperature (°C): ambient plus the real dissipated
 * power times the package's junction-to-ambient thermal resistance.
 */
export function junctionTemperature(
  watts: number,
  thetaJaKelvinPerWatt: number,
  ambientC: number = STANDARD_AMBIENT_C,
): number {
  return ambientC + watts * thetaJaKelvinPerWatt
}

/**
 * A hookup wire's real "over the line" — the PVC insulation limit. UL1015-class
 * PVC-insulated hookup wire is rated ~105 °C; past it the insulation softens and
 * degrades (the conductor itself survives far more, but the insulation fails
 * first). The real failure point, not a number picked to look good.
 */
export const WIRE_INSULATION_MAX_C = 105

/**
 * Air's properties near room temperature, for natural-convection cooling, from
 * standard tables (CRC Handbook of Chemistry & Physics): thermal conductivity,
 * kinematic viscosity, thermal diffusivity, Prandtl number.
 */
const AIR_CONDUCTIVITY = 0.026 // W/m·K
const AIR_KINEMATIC_VISCOSITY = 1.56e-5 // m²/s
const AIR_THERMAL_DIFFUSIVITY = 2.2e-5 // m²/s
const AIR_PRANDTL = 0.71
const GRAVITY = 9.81 // m/s²
/** Copper thermal conductivity (W/m·K) — for the fin equation's thermal length. */
const COPPER_THERMAL_CONDUCTIVITY = 400

/**
 * Natural-convection heat-transfer coefficient (W/m²·K) for a horizontal wire of
 * diameter `diameterM` shedding a temperature rise `riseK` into still air — the
 * Churchill–Chu correlation for a horizontal cylinder (the standard one), driven
 * by the Rayleigh number from the CRC air properties above. Real, not a guess: a
 * thinner wire (higher surface curvature) sheds heat more efficiently and a
 * hotter wire convects a little harder, both of which fall straight out of the
 * correlation. Still air only — no forced airflow or bundling; that's a stated
 * condition, not an estimate.
 */
function convectionCoefficient(diameterM: number, riseK: number, ambientC: number): number {
  if (diameterM <= 0) return 0
  const rise = Math.max(1, riseK)
  const filmKelvin = ambientC + 273.15 + rise / 2 // mean of wire surface + air
  const rayleigh =
    (GRAVITY * (1 / filmKelvin) * rise * diameterM ** 3) /
    (AIR_KINEMATIC_VISCOSITY * AIR_THERMAL_DIFFUSIVITY)
  const nusselt =
    (0.6 + (0.387 * rayleigh ** (1 / 6)) / (1 + (0.559 / AIR_PRANDTL) ** (9 / 16)) ** (8 / 27)) ** 2
  return (nusselt * AIR_CONDUCTIVITY) / diameterM
}

export interface WireThermalProfile {
  /** Peak temperature (°C) — the middle of the wire, its hot spot. */
  peakC: number
  /** Temperature (°C) at fraction u ∈ [0,1] of the way along the wire (0 and 1
   *  are the cooled ends). */
  tempAtFraction(u: number): number
}

/**
 * A current-carrying wire's REAL temperature profile. Its I²R heat is generated
 * uniformly, then shed two ways: convection along its whole surface, AND
 * conduction into its ends, which the parts/pads it connects to hold near ambient
 * (heat-sinks). The steady-state result is the textbook fin distribution —
 * hottest in the MIDDLE, tapering to ambient at the ends, so a wire has a genuine
 * hot SPOT, not a uniform glow (this is why fuses melt in the middle):
 *   T(x) = T₀ + ΔT_conv · [ 1 − cosh(κ(x − L/2)) / cosh(κL/2) ]
 * ΔT_conv = I²R / (h·A_surface) is the convective-limit rise; κ = √(h·P/(k_c·A))
 * is the inverse thermal length (a long wire reaches ΔT_conv in the middle; a
 * short one stays cooler because the cooled ends reach the centre). The
 * convection coefficient h is itself derived (Churchill–Chu, see
 * convectionCoefficient) — not a magic number.
 *
 * Honest gaps: the ends are taken at ambient (not the connected parts' own solved
 * temperature); no radiation; one fixed AWG/material per wire; still-air
 * convection (no forced airflow or bundling).
 */
export function wireThermalProfile(
  amps: number,
  resistanceOhm: number,
  lengthM: number,
  areaM2: number,
  ambientC: number = STANDARD_AMBIENT_C,
): WireThermalProfile {
  const flat: WireThermalProfile = { peakC: ambientC, tempAtFraction: () => ambientC }
  if (!(Math.abs(amps) > 0) || resistanceOhm <= 0 || lengthM <= 0 || areaM2 <= 0) return flat
  const power = amps * amps * resistanceOhm // I²R, generated uniformly
  const diameterM = 2 * Math.sqrt(areaM2 / Math.PI) // round wire
  const perimeter = Math.PI * diameterM // surface per unit length
  const surfaceArea = perimeter * lengthM
  if (surfaceArea <= 0) return flat
  // The convection coefficient depends on the temperature rise and the rise
  // depends on the coefficient, so settle the two together — a few passes
  // converge (the dependence is weak, ∝ ΔT^(1/6)).
  let convection = convectionCoefficient(diameterM, 50, ambientC) // seeded guess
  let riseConvective = power / (convection * surfaceArea)
  for (let i = 0; i < 3; i++) {
    convection = convectionCoefficient(diameterM, riseConvective, ambientC)
    riseConvective = power / (convection * surfaceArea)
  }
  const kappa = Math.sqrt((convection * perimeter) / (COPPER_THERMAL_CONDUCTIVITY * areaM2))
  const coshHalf = Math.cosh((kappa * lengthM) / 2)
  const riseAt = (u: number) =>
    riseConvective * (1 - Math.cosh(kappa * lengthM * (u - 0.5)) / coshHalf)
  return {
    peakC: ambientC + riseAt(0.5),
    tempAtFraction: (u) => ambientC + riseAt(Math.min(1, Math.max(0, u))),
  }
}

/**
 * How close a real temperature is to a real rated maximum, as a fraction of the
 * rise from ambient to that rating: 0 = ambient, 1 = exactly at the rating (the
 * "line"), >1 = over it. Drives the warning (yellow, approaching) → over (red)
 * coloring. Both the temperature and the rating are REAL — nothing scaled.
 */
export function thermalSeverity(
  tempC: number,
  maxRatedC: number,
  ambientC: number = STANDARD_AMBIENT_C,
): number {
  const headroom = maxRatedC - ambientC
  if (!(headroom > 0)) return 0
  return (tempC - ambientC) / headroom
}

type ConnectsLike = { connects?: { net: string; terminal: string }[] }
type NodeVoltages = { nodes: Map<string, number> }

/**
 * The voltage ACROSS a part from solved node voltages — the V in its dissipated
 * power P = |I|·V. Two-terminal parts read their terminal pair; a transistor
 * dissipates across its conducting pair (collector–emitter for a BJT,
 * drain–source for a MOSFET — the base/gate term is comparatively tiny).
 * Undefined when the nets can't be resolved.
 */
export function acrossVolts(inst: ConnectsLike, solution: NodeVoltages): number | undefined {
  const connects = inst.connects ?? []
  let aNet: string | undefined
  let bNet: string | undefined
  if (connects.length === 2) {
    aNet = connects[0]?.net
    bNet = connects[1]?.net
  } else {
    const byTerminal = (names: string[]) => connects.find((c) => names.includes(c.terminal))?.net
    // A potentiometer's "across" is its full track (end to end); a transistor's
    // is its conducting pair.
    aNet = byTerminal(['collector', 'drain', 'terminal_a'])
    bNet = byTerminal(['emitter', 'source', 'terminal_b'])
  }
  if (aNet === undefined || bNet === undefined) return undefined
  const vA = solution.nodes.get(aNet)
  const vB = solution.nodes.get(bNet)
  if (vA === undefined || vB === undefined) return undefined
  return Math.abs(vA - vB)
}
