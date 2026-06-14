/**
 * Diode physics — the Shockley model + Newton-Raphson companion model + pnjlim.
 *
 * Per OBJECT-MODEL.md §20. Pure functions, no circuit/solver coupling — the
 * Newton-Raphson loop in dc-solver.ts (S16-v3-4) composes these.
 *
 * ALL FORMULAS VERIFIED AGAINST CANONICAL SOURCES 2026-06-06 (§20.12):
 *   - Shockley equation + thermal voltage: Wikipedia "Shockley diode equation"
 *   - companion model (g = dI/dV + current source): Wikipedia "Diode modelling"
 *   - pnjlim: ngspice DEVpnjlim, src/spicelib/devices/devsup.c (verbatim)
 *   - V_crit: ngspice diotemp.c (DIOtVcrit = vte*log(vte/(CONSTroot2*satcur)))
 */

// ---------------------------------------------------------------------------
// Physical constants — NIST CODATA, exact (same values as the equation
// evaluator's table; kept here as raw numbers for the solver's hot path).
// ---------------------------------------------------------------------------

/** Boltzmann constant, J/K. NIST CODATA exact. */
const BOLTZMANN_CONSTANT = 1.380649e-23
/** Elementary charge, C. NIST CODATA exact. */
const ELEMENTARY_CHARGE = 1.602176634e-19
/** Default operating + calibration temperature: 298.15 K (25 °C) — the standard
 *  datasheet condition every device parameter (V_F, I_S, β, V_th, k) is specified
 *  at. Using it as the single reference keeps the I_S(T) / mobility scaling laws
 *  self-consistent with the calibration data AND the 25 °C thermal ambient (a part
 *  dissipating ~0 W sits exactly at its own calibration point, no spurious shift).
 *  (Was 300 K, a textbook approximation that put resting parts 1.85 K off-calibration.) */
export const ROOM_TEMPERATURE_KELVIN = 298.15

// ---------------------------------------------------------------------------
// Core physics
// ---------------------------------------------------------------------------

/**
 * Thermal voltage V_T = kT/q. ≈25.693 mV at 298.15 K (25 °C).
 */
export function thermalVoltage(temperatureKelvin: number = ROOM_TEMPERATURE_KELVIN): number {
  return (BOLTZMANN_CONSTANT * temperatureKelvin) / ELEMENTARY_CHARGE
}

/** Boltzmann constant in eV/K (k/q) — for the bandgap term of the I_S(T) law. */
const BOLTZMANN_EV_PER_K = BOLTZMANN_CONSTANT / ELEMENTARY_CHARGE

/** SPICE saturation-current temperature exponent XTI (junction default 3). */
const SATURATION_TEMPERATURE_EXPONENT = 3

/**
 * Saturation current scaled from its calibration temperature to the junction's
 * actual temperature — the standard SPICE diode/BJT temperature law:
 *   I_S(T) = I_S(T₀) · (T/T₀)^(XTI/n) · exp( ( E_g(T₀)/T₀ − E_g(T)/T ) / (n·k/q) )
 * with XTI = 3 and the bandgap E_g in eV. This — together with V_T = kT/q — is
 * what makes a real diode's forward voltage fall ≈2 mV/°C as it warms: I_S grows
 * fast enough with temperature to more than offset the larger V_T.
 *
 * The bandgap is written at BOTH temperatures. With a constant bandgap the two
 * collapse to the familiar E_g·(1/T₀ − 1/T), so silicon junctions are unchanged.
 * When the bandgap NARROWS with heat (Varshni — see varshniEnergyGap), passing
 * the warmer, smaller E_g(T) as `bandgapEvAtTemperature` is what gives an LED its
 * real forward-voltage droop (whose qV_F ≈ E_g would otherwise nearly cancel it).
 * Verified form: ngspice manual (diode temperature model) / Sedra & Smith.
 */
export function scaleSaturationCurrent(
  saturationCurrent: number,
  temperatureKelvin: number,
  calibrationKelvin: number,
  idealityFactor: number,
  bandgapEv: number,
  bandgapEvAtTemperature: number = bandgapEv,
): number {
  const ratio = temperatureKelvin / calibrationKelvin
  const exponent =
    (bandgapEv / calibrationKelvin - bandgapEvAtTemperature / temperatureKelvin) /
    (idealityFactor * BOLTZMANN_EV_PER_K)
  return (
    saturationCurrent *
    ratio ** (SATURATION_TEMPERATURE_EXPONENT / idealityFactor) *
    Math.exp(exponent)
  )
}

/**
 * The bandgap energy (eV) at a temperature, by the Varshni law referenced to a
 * known value at refKelvin:
 *   E_g(T) = E_g(ref) − α·( T²/(T+β) − ref²/(ref+β) )
 * The gap narrows as the lattice expands with heat; α (eV/K) and β (K) are the
 * material's Varshni coefficients. Referenced to E_g(ref) so it returns exactly
 * that at T = ref. Verified form: Varshni 1967 / Sze, Physics of Semiconductor
 * Devices.
 */
export function varshniEnergyGap(
  bandgapAtRefEv: number,
  alphaEvPerK: number,
  betaKelvin: number,
  temperatureKelvin: number,
  refKelvin: number = ROOM_TEMPERATURE_KELVIN,
): number {
  const gapShift = (t: number) => (t * t) / (t + betaKelvin)
  return bandgapAtRefEv - alphaEvPerK * (gapShift(temperatureKelvin) - gapShift(refKelvin))
}

/**
 * Representative Varshni coefficients for an LED's III-V bandgap. The default red
 * LED is AlGaInP (α ≈ 4.5×10⁻⁴ eV/K, β ≈ 235 K); blue/green InGaN and UV AlGaN
 * narrow a little differently. A representative value — per-colour coefficients
 * are a future refinement, like the bandgap itself coming from peak_wavelength.
 */
export const LED_VARSHNI_ALPHA_EV_PER_K = 4.5e-4
export const LED_VARSHNI_BETA_K = 235

/**
 * Derive the reverse saturation current I_s from a calibration point
 * (forward voltage V_F at forward current I_F) plus the ideality factor (§20.3):
 *   I_s = I_F / (exp(V_F / (n·V_T)) − 1)
 */
export function deriveSaturationCurrent(
  forwardVoltage: number,
  forwardCurrent: number,
  idealityFactor: number,
  thermalV: number,
): number {
  const nVT = idealityFactor * thermalV
  return forwardCurrent / (Math.exp(forwardVoltage / nVT) - 1)
}

/**
 * Shockley diode current at voltage V (§20.2):
 *   I = I_s × (exp(V / (n·V_T)) − 1)
 */
export function diodeCurrent(
  voltage: number,
  saturationCurrent: number,
  idealityFactor: number,
  thermalV: number,
): number {
  const nVT = idealityFactor * thermalV
  return saturationCurrent * (Math.exp(voltage / nVT) - 1)
}

/**
 * Diode small-signal conductance g = dI/dV at voltage V (§20.4):
 *   g = (I_s / (n·V_T)) × exp(V / (n·V_T))
 */
export function diodeConductance(
  voltage: number,
  saturationCurrent: number,
  idealityFactor: number,
  thermalV: number,
): number {
  const nVT = idealityFactor * thermalV
  return (saturationCurrent / nVT) * Math.exp(voltage / nVT)
}

/**
 * Newton-Raphson companion model at voltage V (§20.4): the linearized
 * equivalent of the diode — a conductance G_eq in parallel with a current
 * source I_eq, such that G_eq·V + I_eq = I(V) at the linearization point.
 *   G_eq = g(V)
 *   I_eq = I(V) − G_eq·V
 */
export function companionModel(
  voltage: number,
  saturationCurrent: number,
  idealityFactor: number,
  thermalV: number,
): { conductance: number; currentSource: number } {
  const conductance = diodeConductance(voltage, saturationCurrent, idealityFactor, thermalV)
  const current = diodeCurrent(voltage, saturationCurrent, idealityFactor, thermalV)
  return { conductance, currentSource: current - conductance * voltage }
}

/** Representative breakdown ideality for a Zener's reverse knee — it sets how
 *  sharp the regulation is (the zener impedance Z_Z ≈ n_bd·V_T / I at the
 *  operating current; ~2 gives ohms-to-tens-of-ohms at a few mA, the real
 *  ballpark). A datasheet zener_impedance could replace it later. */
export const ZENER_BREAKDOWN_IDEALITY = 2

/**
 * Newton companion model for a Zener diode — forward Shockley conduction PLUS a
 * reverse breakdown branch that switches on once the reverse voltage reaches V_Z
 * and clamps it there. The breakdown is its own exponential in u = −(V + V_Z):
 * ≈0 while blocking, equal to the breakdown reference current at exactly −V_Z,
 * and climbing steeply beyond, holding the reverse voltage at V_Z. Since
 * du/dV = −1, the breakdown current SUBTRACTS from the forward total while its
 * conductance ADDS — both terms stay ≥ 0, so the stamp never goes singular.
 * Returns G_eq + I_eq for the MNA stamp, exactly like companionModel.
 */
export function zenerCompanionModel(
  voltage: number,
  saturationCurrent: number,
  idealityFactor: number,
  thermalV: number,
  zenerVoltage: number,
  breakdownCurrent: number,
  breakdownIdeality: number,
): { conductance: number; currentSource: number } {
  const forwardG = diodeConductance(voltage, saturationCurrent, idealityFactor, thermalV)
  const forwardI = diodeCurrent(voltage, saturationCurrent, idealityFactor, thermalV)
  const nVtBreakdown = breakdownIdeality * thermalV
  // The breakdown exponential, capped so a wild Newton guess can't overflow it
  // (pnjlim keeps real iterations far below the cap).
  const breakdownExp = Math.exp(Math.min(-(voltage + zenerVoltage) / nVtBreakdown, 80))
  const breakdownI = breakdownCurrent * breakdownExp
  const breakdownG = (breakdownCurrent / nVtBreakdown) * breakdownExp
  const conductance = forwardG + breakdownG
  const current = forwardI - breakdownI
  return { conductance, currentSource: current - conductance * voltage }
}

/**
 * Critical voltage — the onset of the exponential's steep region, used by
 * pnjlim (§20.5). Verified from ngspice diotemp.c:
 *   V_crit = (n·V_T) × ln( (n·V_T) / (√2 · I_s) )
 */
export function criticalVoltage(
  saturationCurrent: number,
  idealityFactor: number,
  thermalV: number,
): number {
  const nVT = idealityFactor * thermalV
  return nVT * Math.log(nVT / (Math.SQRT2 * saturationCurrent))
}

/**
 * pnjlim — the SPICE diode-voltage limiting algorithm (§20.5). Caps the
 * per-iteration voltage change in the diode's steep region so exp() can't
 * overflow. Reproduced verbatim from ngspice DEVpnjlim (devsup.c), verified
 * 2026-06-06.
 *
 * `vt` here is the SCALED thermal voltage n·V_T (matching how vcrit is
 * computed). Returns the limited voltage + whether limiting fired (the
 * ngspice `icheck` flag — the Newton loop must not declare convergence on
 * an iteration where limiting was active).
 */
export function pnjlim(
  vnew: number,
  vold: number,
  vt: number,
  vcrit: number,
): { voltage: number; limited: boolean } {
  if (vnew > vcrit && Math.abs(vnew - vold) > vt + vt) {
    if (vold > 0) {
      const arg = (vnew - vold) / vt
      if (arg > 0) {
        return { voltage: vold + vt * (2 + Math.log(arg - 2)), limited: true }
      }
      return { voltage: vold - vt * (2 + Math.log(2 - arg)), limited: true }
    }
    return { voltage: vt * Math.log(vnew / vt), limited: true }
  }

  // Reverse-bias branch — limit large negative swings (ngspice devsup.c).
  if (vnew < 0) {
    const arg = vold > 0 ? -vold - 1 : 2 * vold - 1
    if (vnew < arg) {
      return { voltage: arg, limited: true }
    }
  }
  return { voltage: vnew, limited: false }
}
