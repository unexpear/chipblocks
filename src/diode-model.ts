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
 *   I_S(T) = I_S(T₀) · (T/T₀)^(XTI/n) · exp( (E_g/(n·k/q)) · (1/T₀ − 1/T) )
 * with XTI = 3 and the bandgap E_g in eV. This — together with V_T = kT/q — is
 * what makes a real diode's forward voltage fall ≈2 mV/°C as it warms: I_S grows
 * fast enough with temperature to more than offset the larger V_T.
 * Verified form: ngspice manual (diode temperature model) / Sedra & Smith.
 */
export function scaleSaturationCurrent(
  saturationCurrent: number,
  temperatureKelvin: number,
  calibrationKelvin: number,
  idealityFactor: number,
  bandgapEv: number,
): number {
  const ratio = temperatureKelvin / calibrationKelvin
  const exponent =
    (bandgapEv / (idealityFactor * BOLTZMANN_EV_PER_K)) *
    (1 / calibrationKelvin - 1 / temperatureKelvin)
  return (
    saturationCurrent *
    ratio ** (SATURATION_TEMPERATURE_EXPONENT / idealityFactor) *
    Math.exp(exponent)
  )
}

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
