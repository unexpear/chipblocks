/**
 * Junction FET (JFET) physics — a DEPLETION-mode field-effect transistor.
 *
 * Its Level-1 drain-current law is the SAME square law as the MOSFET (Shichman-Hodges), so this
 * model MAPS a JFET onto the proven, finite-difference-verified MOSFET core rather than
 * re-deriving (and risking a divergent reimplementation of) the same equations:
 *
 *   cutoff      V_OV = V_GS − V_P ≤ 0:   I_D = 0
 *   triode      0 < V_DS < V_OV:         I_D = β·(2·V_OV·V_DS − V_DS²)·(1 + λ·V_DS)
 *   saturation  V_DS ≥ V_OV:             I_D = β·V_OV²·(1 + λ·V_DS),   I_DSS = β·V_P²
 *
 * The MOSFET core uses k where the JFET uses β; they are the same equation with k = 2·β, so the
 * mapping is (V_P, β) → (V_th = V_P, k = 2·β). The defining JFET difference is DEPLETION mode:
 * the pinch-off V_P is NEGATIVE for an N-channel JFET, so V_OV = V_GS − V_P > 0 at V_GS = 0 — it
 * conducts at I_DSS with zero gate bias and pinches OFF as V_GS falls to V_P. (An enhancement
 * MOSFET, by contrast, is off at V_GS = 0.) The P-channel mirror has V_P positive.
 *
 * NOT modeled (first-order, stated plainly): the gate-channel PN junction. In normal operation
 * it is reverse-biased and draws ~0 current — exactly the insulated-gate assumption the MOSFET
 * core already makes — so a normally-biased JFET is faithful. The gate-junction conduction when
 * the gate is forward-biased (and the input clamp it forms) is the documented successor — the
 * JFET analogue of the MOSFET's unmodeled body diode.
 *
 * Sources: Shichman & Hodges, IEEE JSSC SC-3 (1968); Sedra & Smith, Microelectronic Circuits
 * (JFET large-signal model); ngspice manual, JFET level 1.
 */

import {
  type MosfetOperatingPoint,
  type MosfetParams,
  mosfetOperatingPoint,
} from './mosfet-model.ts'

export type JfetParams = {
  /**
   * 'n_channel' conducts at V_GS = 0 and pinches off as V_GS → V_P (V_P < 0); 'p_channel' is the
   * mirror (V_P > 0).
   */
  channel: 'n_channel' | 'p_channel'
  /** Pinch-off (gate cutoff) voltage V_P — negative for N-channel, positive for P-channel. */
  pinchOffVoltage: number
  /** Transconductance parameter β (A/V²); the zero-bias drain current is I_DSS = β·V_P². */
  transconductance: number
  /** Channel-length modulation λ (1/V, ≥ 0) — the slight saturation-current rise with V_DS. */
  channelLengthModulation: number
}

/**
 * Map a JFET to the equivalent MOSFET square-law parameters (the shared physics): the JFET
 * pinch-off IS the FET threshold, and k = 2·β. An N-channel JFET maps to the nmos frame (with a
 * negative threshold = depletion mode), a P-channel JFET to the pmos frame.
 */
export function jfetMosfetParams(params: JfetParams): MosfetParams {
  return {
    channel: params.channel === 'p_channel' ? 'pmos' : 'nmos',
    thresholdVoltage: params.pinchOffVoltage,
    transconductance: 2 * params.transconductance,
    channelLengthModulation: params.channelLengthModulation,
  }
}

/** The JFET operating point (I_D plus ∂I_D/∂V_GS, ∂I_D/∂V_DS), via the shared MOSFET core. */
export function jfetOperatingPoint(
  vGS: number,
  vDS: number,
  params: JfetParams,
): MosfetOperatingPoint {
  return mosfetOperatingPoint(vGS, vDS, jfetMosfetParams(params))
}
