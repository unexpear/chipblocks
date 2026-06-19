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

import type { Instance } from './cross-fk-validator.ts'
import { readScalarParam } from './instance-params.ts'

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
 * An incandescent filament runs far hotter than a conduction-cooled part because
 * it sheds its power almost entirely by RADIATION — the Stefan–Boltzmann law
 *   P = k·(T⁴ − T_amb⁴)        [T in kelvin, k = ε·σ·A]
 * (emissivity × the Stefan–Boltzmann constant × the radiating area). Inverted for
 * the steady filament temperature at a dissipated power P:
 *   T = (T_amb⁴ + P/k)^(1/4)
 * so the temperature climbs only as the FOURTH ROOT of power — halve the drive and
 * the filament barely dims, the hallmark of an incandescent lamp, and the opposite
 * of the LINEAR T = ambient + P·θ_JA a conduction-cooled package follows. k is
 * pinned to the rated operating point — at `ratedPowerW` the filament sits at
 * `operatingTempC`, referenced to the 25 °C datasheet ambient — so the rated point
 * is exact and every off-rated point falls out of the T⁴ law. Returns °C.
 *
 * Honest scope: pure radiation balance (the dominant term for a filament in a
 * vacuum/inert-gas envelope), steady-state, no lead/gas conduction and no thermal
 * mass — so the sub-second cold-start inrush surge is a documented future rung,
 * the same thermal-mass increment this model defers for every part.
 */
export function filamentTemperatureC(
  watts: number,
  ratedPowerW: number,
  operatingTempC: number,
  ambientC: number = STANDARD_AMBIENT_C,
): number {
  const operatingK = operatingTempC + 273.15
  const refAmbientK = STANDARD_AMBIENT_C + 273.15
  const ambientK = ambientC + 273.15
  const k = ratedPowerW / (operatingK ** 4 - refAmbientK ** 4)
  return (ambientK ** 4 + Math.max(0, watts) / k) ** 0.25 - 273.15
}

/**
 * The filament temperature for an incandescent_bulb instance dissipating `watts`,
 * reading its rated operating point (rated_power at reference_temperature — the
 * point where its hot `resistance` and that power hold). The ONE place the bulb's
 * T(P) law is read from an instance, so the solve, the readings, the failure check,
 * and the glow all land on the same temperature. Undefined when the rated point is
 * missing or not above the 25 °C reference.
 */
export function bulbFilamentTemperatureC(
  inst: Instance,
  watts: number,
  ambientC: number = STANDARD_AMBIENT_C,
): number | undefined {
  const ratedPower = readScalarParam(inst, 'rated_power')
  const operatingTempC = readScalarParam(inst, 'reference_temperature')
  if (ratedPower === undefined || ratedPower <= 0) return undefined
  if (operatingTempC === undefined || operatingTempC <= STANDARD_AMBIENT_C) return undefined
  return filamentTemperatureC(watts, ratedPower, operatingTempC, ambientC)
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
/** Stefan–Boltzmann constant (W/m²·K⁴), NIST CODATA — for radiative cooling. */
const STEFAN_BOLTZMANN = 5.670374e-8
/** Emissivity of a PVC-insulated wire's surface (plastics ~0.9–0.95). A bare
 *  polished-copper wire would be far lower (~0.05), but hookup wire is insulated. */
const WIRE_EMISSIVITY = 0.9
/** Cap on κ·L for the fin profile: cosh/sinh overflow float64 near κL ≈ 710 (and lose precision well
 *  before). By κL = 50 the profile has already reached its asymptote — a flat θ_conv middle with sharp
 *  end transitions — so clamping here leaves the peak and the visible shape unchanged, just bounded. */
const MAX_FIN_KL = 50

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
 * uniformly, then shed three ways: convection AND radiation along its whole
 * surface, plus conduction into its two ends — which the parts it connects to
 * hold at their own solved temperatures (near ambient when those parts run cool).
 * The steady-state result is the textbook fin distribution — hottest in the
 * MIDDLE for equal ends, so a wire has a genuine hot SPOT, not a uniform glow
 * (this is why fuses melt in the middle); an end resting on a hot part lifts the
 * wire near it, shifting the spot. ΔT_conv = I²R / (h·A_surface) is the
 * convective-limit rise; κ = √(h·P/(k_c·A)) is the inverse thermal length (a long
 * wire reaches ΔT_conv in the middle; a short one stays cooler because the ends
 * reach the centre). The total surface coefficient h is itself derived — the
 * Churchill–Chu convection correlation plus the Stefan–Boltzmann radiation term —
 * not a magic number.
 *
 * Honest gaps: one fixed AWG/material per wire; still-air natural convection (no
 * forced airflow or bundling); a dead (no-current) wire reads ambient even if it
 * touches a hot part (passive end-to-end conduction is not drawn yet).
 */
export function wireThermalProfile(
  amps: number,
  resistanceOhm: number,
  lengthM: number,
  areaM2: number,
  ambientC: number = STANDARD_AMBIENT_C,
  endAC: number = ambientC,
  endBC: number = ambientC,
): WireThermalProfile {
  const flat: WireThermalProfile = { peakC: ambientC, tempAtFraction: () => ambientC }
  if (!(Math.abs(amps) > 0) || resistanceOhm <= 0 || lengthM <= 0 || areaM2 <= 0) return flat
  const power = amps * amps * resistanceOhm // I²R, generated uniformly
  const diameterM = 2 * Math.sqrt(areaM2 / Math.PI) // round wire
  const perimeter = Math.PI * diameterM // surface per unit length
  const surfaceArea = perimeter * lengthM
  if (surfaceArea <= 0) return flat
  // The wire sheds heat two ways along its surface — convection AND radiation —
  // and both depend on the temperature rise, which in turn depends on them. So
  // settle the loop together (a few passes converge). Radiation is the
  // Stefan–Boltzmann law εσ(Ts⁴−T₀⁴), folded into an effective coefficient; it
  // is small when the wire is cool and grows steeply once it runs hot.
  const ambientK = ambientC + 273.15
  let totalCoeff = convectionCoefficient(diameterM, 50, ambientC) // seeded guess
  let riseConvective = power / (totalCoeff * surfaceArea)
  for (let i = 0; i < 5; i++) {
    const convection = convectionCoefficient(diameterM, riseConvective, ambientC)
    const surfaceK = ambientK + riseConvective
    const radiation =
      WIRE_EMISSIVITY *
      STEFAN_BOLTZMANN *
      (surfaceK * surfaceK + ambientK * ambientK) *
      (surfaceK + ambientK)
    totalCoeff = convection + radiation
    riseConvective = power / (totalCoeff * surfaceArea)
  }
  const kappa = Math.sqrt((totalCoeff * perimeter) / (COPPER_THERMAL_CONDUCTIVITY * areaM2))
  // The fin profile with the two ends held at the connected parts' temperatures
  // (not ambient): θ(x) = θ_conv + C₁·cosh(κx) + C₂·sinh(κx), solved for the end
  // rises θ_a, θ_b. Both ends at ambient → the symmetric middle-hottest spot; an
  // end sitting on a hot part lifts the wire near it.
  const kL = Math.min(kappa * lengthM, MAX_FIN_KL)
  const thetaA = endAC - ambientC
  const thetaB = endBC - ambientC
  const sinhKL = Math.sinh(kL)
  const c1 = thetaA - riseConvective
  const c2 = sinhKL > 0 ? (thetaB - riseConvective - c1 * Math.cosh(kL)) / sinhKL : 0
  const riseAt = (u: number) => riseConvective + c1 * Math.cosh(kL * u) + c2 * Math.sinh(kL * u)
  // With unequal ends the peak can sit off-centre — sample to find the hottest point.
  let peak = riseAt(0.5)
  for (let i = 0; i <= 20; i++) {
    const r = riseAt(i / 20)
    if (r > peak) peak = r
  }
  return {
    peakC: ambientC + peak,
    tempAtFraction: (u) => ambientC + riseAt(Math.min(1, Math.max(0, u))),
  }
}

/**
 * A wire's real ampacity (A): the steady current at which its hot spot just
 * reaches the insulation limit. The peak temperature climbs monotonically with
 * current (I²R heating against the same cooling), so bisect for the crossing —
 * this is the inverse of wireThermalProfile, the rating a wire table would list,
 * here DERIVED from the same fin model rather than looked up. Still air, ends at
 * ambient (the standard rating condition).
 */
export function wireAmpacity(
  resistanceOhm: number,
  lengthM: number,
  areaM2: number,
  ambientC: number = STANDARD_AMBIENT_C,
  limitC: number = WIRE_INSULATION_MAX_C,
): number {
  if (resistanceOhm <= 0 || lengthM <= 0 || areaM2 <= 0 || !(limitC > ambientC)) return 0
  const peakAt = (amps: number) =>
    wireThermalProfile(amps, resistanceOhm, lengthM, areaM2, ambientC).peakC
  let lo = 0
  let hi = 1
  for (let k = 0; k < 40 && peakAt(hi) < limitC; k++) hi *= 2
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2
    if (peakAt(mid) < limitC) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
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
 * drain–source for a MOSFET, anode–cathode for a 3-terminal SCR — the base/gate
 * term is comparatively tiny). Undefined when the nets can't be resolved.
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
    aNet = byTerminal(['collector', 'drain', 'anode', 'terminal_a'])
    bNet = byTerminal(['emitter', 'source', 'cathode', 'terminal_b'])
  }
  if (aNet === undefined || bNet === undefined) return undefined
  const vA = solution.nodes.get(aNet)
  const vB = solution.nodes.get(bNet)
  if (vA === undefined || vB === undefined) return undefined
  return Math.abs(vA - vB)
}
