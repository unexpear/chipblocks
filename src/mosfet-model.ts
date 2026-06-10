/**
 * MOSFET physics — the classic three-region Level-1 model (Shichman–Hodges,
 * 1968; SPICE "LEVEL=1") + its Newton-Raphson companion (operating-point
 * current and the ∂I_D/∂V_GS, ∂I_D/∂V_DS conductances).
 *
 * Pure functions, no circuit/solver coupling — the NR loops in dc-solver.ts /
 * transient-solver.ts compose these exactly the way they compose bjt-model.ts.
 *
 * The three regions (enhancement NMOS, source-referenced, V_OV = V_GS − V_th):
 *   cutoff      V_OV ≤ 0:          I_D = 0  (plus the SPICE GMIN shunt so the
 *                                  matrix never goes singular around an off FET)
 *   triode      0 < V_DS < V_OV:   I_D = k·(V_OV·V_DS − V_DS²/2)·(1 + λ·V_DS)
 *   saturation  V_DS ≥ V_OV:       I_D = (k/2)·V_OV²·(1 + λ·V_DS)
 * k is the full device transconductance parameter (k′·W/L, A/V²); λ is the
 * channel-length-modulation term that gives the slight current rise (finite
 * output resistance) in saturation. The two regions meet smoothly at
 * V_DS = V_OV — current and both derivatives are continuous there.
 *
 * Sources: Shichman & Hodges, IEEE JSSC SC-3 (1968); Sedra & Smith,
 * Microelectronic Circuits (MOSFET large-signal model); ngspice manual,
 * MOS level 1.
 *
 * Conventions and honest scope:
 *  - Three terminals (gate / drain / source), body tied to source — exactly
 *    how discrete packaged MOSFETs (2N7000, BS250) are built, so there is no
 *    body effect to model (V_SB ≡ 0 by construction, not by approximation).
 *  - The channel is symmetric: V_DS < 0 swaps the roles of drain and source
 *    (handled here), which is real device behavior.
 *  - The gate draws no DC current (the insulated gate IS the point of a MOS
 *    transistor). A truly floating gate is genuinely undefined — drive it.
 *  - NOT yet modeled, stated plainly: the body diode every discrete MOSFET
 *    has from source to drain (matters for inductive freewheeling), gate
 *    capacitance (switching speed), and avalanche behavior.
 */

/** The SPICE GMIN scale — keeps an off transistor from making a node float. */
const CUTOFF_GMIN = 1e-12

export type MosfetParams = {
  /** 'nmos' conducts with the gate pulled ABOVE the source; 'pmos' below. */
  channel: 'nmos' | 'pmos'
  /** Threshold V_th in volts — positive for NMOS, negative for PMOS. */
  thresholdVoltage: number
  /** Device transconductance parameter k = k′·W/L (A/V²). */
  transconductance: number
  /** Channel-length modulation λ (1/V, ≥ 0). */
  channelLengthModulation: number
}

export type MosfetOperatingPoint = {
  /** Current INTO the drain terminal (negative for a conducting PMOS). */
  iD: number
  /** ∂I_D/∂V_GS at the point (the transconductance g_m, labeled frame). */
  gm: number
  /** ∂I_D/∂V_DS at the point (the output conductance g_ds, labeled frame). */
  gds: number
  /** Which region the device sits in — for the Math panel's story. */
  region: 'cutoff' | 'triode' | 'saturation'
}

/**
 * NMOS core in its own frame (V_DS ≥ 0, V_th > 0). Returns current into the
 * drain plus the two partial derivatives.
 */
function nmosCore(
  vGS: number,
  vDS: number,
  vth: number,
  k: number,
  lambda: number,
): MosfetOperatingPoint {
  const vOV = vGS - vth
  if (vOV <= 0) {
    return { iD: CUTOFF_GMIN * vDS, gm: 0, gds: CUTOFF_GMIN, region: 'cutoff' }
  }
  const clm = 1 + lambda * vDS
  if (vDS < vOV) {
    // Triode: the channel is a gate-controlled resistor (plus the λ term).
    const shape = vOV * vDS - (vDS * vDS) / 2
    return {
      iD: k * shape * clm,
      gm: k * vDS * clm,
      gds: k * (vOV - vDS) * clm + k * shape * lambda,
      region: 'triode',
    }
  }
  // Saturation: the channel pinches off; current depends on V_GS (squared).
  const iSat = (k / 2) * vOV * vOV
  return {
    iD: iSat * clm,
    gm: k * vOV * clm,
    gds: iSat * lambda,
    region: 'saturation',
  }
}

/**
 * The labeled-frame operating point for either channel type, any bias.
 *
 *  - NMOS with V_DS < 0: the device is symmetric — the lower terminal acts as
 *    the source. Computed by role swap; the returned derivatives are the
 *    labeled-frame partials (chain rule), so the companion stamp is uniform.
 *  - PMOS: the exact mirror of NMOS — computed in the negated frame, current
 *    sign flipped back (a conducting PMOS carries current source → drain, so
 *    I_D into the labeled drain is negative).
 */
export function mosfetOperatingPoint(
  vGS: number,
  vDS: number,
  params: MosfetParams,
): MosfetOperatingPoint {
  const k = params.transconductance
  const lambda = params.channelLengthModulation
  if (params.channel === 'pmos') {
    // Mirror frame: u = −v with the positive threshold magnitude.
    const mirrored = nmosLabeled(-vGS, -vDS, -params.thresholdVoltage, k, lambda)
    // iD = −f(−vGS, −vDS): both partials get TWO sign flips → unchanged.
    return { iD: -mirrored.iD, gm: mirrored.gm, gds: mirrored.gds, region: mirrored.region }
  }
  return nmosLabeled(vGS, vDS, params.thresholdVoltage, k, lambda)
}

/** NMOS in the labeled frame, including the V_DS < 0 drain/source role swap. */
function nmosLabeled(
  vGS: number,
  vDS: number,
  vth: number,
  k: number,
  lambda: number,
): MosfetOperatingPoint {
  if (vDS >= 0) return nmosCore(vGS, vDS, vth, k, lambda)
  // Roles swap: the labeled drain is acting as the source. In the swapped
  // frame the gate-source voltage is measured from the labeled drain:
  //   iD_labeled = −f(vGS − vDS, −vDS)
  // Chain rule for the labeled partials:
  //   ∂iD/∂vGS = −f₁
  //   ∂iD/∂vDS = f₁ + f₂
  const swapped = nmosCore(vGS - vDS, -vDS, vth, k, lambda)
  return {
    iD: -swapped.iD,
    gm: -swapped.gm,
    gds: swapped.gm + swapped.gds,
    region: swapped.region,
  }
}

/**
 * Per-iteration Newton-Raphson voltage-step limit (volts). The square-law is
 * far gentler than a junction exponential, but unbounded NR steps can still
 * overshoot and oscillate around the triode/saturation boundary — SPICE
 * limits FET voltage steps the same way (fetlim). 1 V per iteration converges
 * everything we solve while staying snappy.
 */
export const MOSFET_STEP_LIMIT_V = 1

/** Move `next` toward `previous` by at most MOSFET_STEP_LIMIT_V. */
export function limitMosfetStep(next: number, previous: number): number {
  const delta = next - previous
  if (delta > MOSFET_STEP_LIMIT_V) return previous + MOSFET_STEP_LIMIT_V
  if (delta < -MOSFET_STEP_LIMIT_V) return previous - MOSFET_STEP_LIMIT_V
  return next
}
