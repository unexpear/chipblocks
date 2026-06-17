/**
 * Tunnel-diode (Esaki diode) physics — the N-shaped I-V curve with a NEGATIVE-RESISTANCE region.
 *
 * A very heavily doped junction whose forward characteristic has three parts:
 *   1. tunneling      0 < V < V_P:   band-to-band tunneling current rises to a PEAK (V_P, I_P).
 *   2. negative R     V_P < V < V_V: tunneling collapses as the bands misalign — current FALLS to a
 *                                    VALLEY (V_V, I_V); here dI/dV < 0, the property that makes the
 *                                    device useful (oscillators, fast switches, amplifiers).
 *   3. injection      V > V_V:       the ordinary forward-diffusion current takes over and rises.
 *
 * Model (the standard two-term compact form): a band-to-band tunneling term that peaks at (V_P, I_P)
 * plus a normal diode diffusion term:
 *
 *   I(V) = I_P·(V/V_P)·exp(1 − V/V_P)  +  I_S·(exp(V/(n·V_T)) − 1)            (V ≥ 0)
 *
 * The first term is exactly I_P at V = V_P and decays for V > V_P (the negative-resistance slope);
 * the second is negligible until V nears the valley, then climbs (region 3). I_S is CALIBRATED so
 * the curve passes ~through the datasheet valley point (V_V, I_V) — see
 * tunnelDiodeSaturationCurrent — so all four headline numbers (I_P, V_P, I_V, V_V) shape the curve.
 *
 * Reverse bias (V < 0): a tunnel diode conducts immediately (the "backward-diode" property). We
 * model that as a linear continuation at the origin conductance — C1-continuous at V = 0 and
 * bounded (the full reverse-tunneling magnitude is the documented successor).
 *
 * Sources: Esaki, "New Phenomenon in Narrow Germanium p−n Junctions", Phys. Rev. 109, 603 (1958);
 * Sze & Ng, Physics of Semiconductor Devices, 3rd ed., §8 (tunnel diodes: the I-V and its three
 * regions). The compact (V/V_P)·exp(1 − V/V_P) tunneling form is the widely-used circuit model.
 */

// Overflow guard on an exp argument — 80 (exp(80) is finite). Matches the EXP_ARG_CAP the diode and
// BJT models use, so the junction-exp cap is one magnitude across the codebase. Real tunnel-diode
// voltages (< ~0.6 V) never approach it; it only catches a wild Newton guess far outside the device.
const EXP_CLAMP = 80

function safeExp(x: number): number {
  return Math.exp(x > EXP_CLAMP ? EXP_CLAMP : x < -EXP_CLAMP ? -EXP_CLAMP : x)
}

/** The diffusion saturation current I_S that places the injection term through the valley (V_V, I_V). */
export function tunnelDiodeSaturationCurrent(
  peakCurrent: number,
  peakVoltage: number,
  valleyCurrent: number,
  valleyVoltage: number,
  idealityFactor: number,
  thermalV: number,
): number {
  const xv = valleyVoltage / peakVoltage
  const tunnelAtValley = peakCurrent * xv * safeExp(1 - xv)
  const denom = safeExp(valleyVoltage / (idealityFactor * thermalV)) - 1
  if (denom <= 0) return 0
  return Math.max(0, (valleyCurrent - tunnelAtValley) / denom)
}

export type TunnelDiodeParams = {
  peakCurrent: number
  peakVoltage: number
  /** Calibrated diffusion saturation current (from tunnelDiodeSaturationCurrent). */
  saturationCurrent: number
  idealityFactor: number
  thermalV: number
}

export type TunnelDiodeOperatingPoint = {
  current: number
  /** dI/dV — NEGATIVE in the V_P..V_V region (the negative-resistance slope). */
  conductance: number
}

export function tunnelDiodeOperatingPoint(
  v: number,
  params: TunnelDiodeParams,
): TunnelDiodeOperatingPoint {
  const { peakCurrent, peakVoltage, saturationCurrent, idealityFactor, thermalV } = params
  const nVt = idealityFactor * thermalV
  if (v >= 0) {
    const x = v / peakVoltage
    const e = safeExp(1 - x)
    const tunnel = peakCurrent * x * e
    const dTunnel = (peakCurrent / peakVoltage) * e * (1 - x)
    const ed = safeExp(v / nVt)
    const diffusion = saturationCurrent * (ed - 1)
    const dDiffusion = (saturationCurrent / nVt) * ed
    return { current: tunnel + diffusion, conductance: dTunnel + dDiffusion }
  }
  // Reverse: the backward-diode conduction, linearized at the origin conductance (C1-continuous).
  const g0 = (peakCurrent * Math.E) / peakVoltage + saturationCurrent / nVt
  return { current: g0 * v, conductance: g0 }
}

export function tunnelDiodeCurrent(v: number, params: TunnelDiodeParams): number {
  return tunnelDiodeOperatingPoint(v, params).current
}

/** Newton companion: the conductance g and the equivalent current source (I − g·V) at the guess. */
export function tunnelDiodeCompanion(
  v: number,
  params: TunnelDiodeParams,
): { conductance: number; currentSource: number } {
  const { current, conductance } = tunnelDiodeOperatingPoint(v, params)
  return { conductance, currentSource: current - conductance * v }
}

const TUNNEL_STEP_LIMIT_V = 0.1

/**
 * Per-iteration voltage-step clamp. The tunnel diode's features sit at the tens-of-mV scale, so a
 * tight clamp keeps Newton from leaping across the peak/valley and oscillating in the
 * negative-resistance region (the same fetlim idea the MOSFET uses, but tighter).
 */
export function limitTunnelDiodeStep(next: number, previous: number): number {
  const delta = next - previous
  if (delta > TUNNEL_STEP_LIMIT_V) return previous + TUNNEL_STEP_LIMIT_V
  if (delta < -TUNNEL_STEP_LIMIT_V) return previous - TUNNEL_STEP_LIMIT_V
  return next
}
