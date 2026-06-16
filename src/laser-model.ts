/**
 * Laser-diode optical output — the L-I (light-vs-current) characteristic.
 *
 * A laser diode is electrically an ordinary forward-biased light-emitting PN junction: it resolves
 * through the same Shockley + Newton-Raphson path as an LED (see SHOCKLEY_DIODE_DEFINITIONS in
 * dc-solver.ts). Its DEFINING difference is optical. Below a threshold current I_th the junction
 * only emits weak, incoherent spontaneous light (like a dim LED); above I_th stimulated emission
 * takes over and the optical output rises steeply and ~linearly with current. We model that
 * threshold-and-slope L-I curve:
 *
 *   P_optical = η_d · E_photon · (I_f − I_th)    for I_f > I_th,    else 0
 *
 * η_d is the differential ("slope") quantum efficiency — the fraction of each ABOVE-threshold
 * electron that becomes an emitted photon — and E_photon = h·c/λ is the photon energy. Expressed in
 * volts (E_photon / q = 1239.84 eV·nm / λ_nm), the product η_d · (E_photon/q) · (I_f − I_th) lands
 * in watts directly, so no fabricated "W/A" unit is needed: the efficiency is dimensionless and the
 * energy comes from the wavelength the device already carries. This is the standard two-segment L-I
 * model; the small spontaneous-emission shoulder below threshold is neglected as negligible.
 *
 * NOT modeled (stated plainly): the temperature drift of I_th (real thresholds rise ~exponentially
 * with heat), the gentle sub-threshold spontaneous light, and roll-over / thermal saturation at
 * high current — the higher-fidelity successors.
 *
 * Sources: Coldren, Corzine & Mašanović, Diode Lasers and Photonic Integrated Circuits, 2nd ed., §2
 * (the L-I curve, threshold current, slope/differential efficiency); Sze & Ng, Physics of
 * Semiconductor Devices, 3rd ed., chapter on semiconductor lasers.
 */

import { PHOTON_EV_NM } from './dc-solver.ts'

/**
 * Optical output power (W) of a laser diode at a given forward current. Zero at or below the
 * threshold current; above it, η_d · (photon volts) · (I_f − I_th). Returns 0 for a non-positive
 * wavelength or efficiency (an ill-specified device emits nothing rather than a bogus number).
 */
export function laserOpticalPowerW(
  forwardCurrentA: number,
  thresholdCurrentA: number,
  differentialQuantumEfficiency: number,
  wavelengthNm: number,
): number {
  if (wavelengthNm <= 0 || differentialQuantumEfficiency <= 0) return 0
  const aboveThreshold = forwardCurrentA - thresholdCurrentA
  if (aboveThreshold <= 0) return 0
  const photonVolts = PHOTON_EV_NM / wavelengthNm
  return differentialQuantumEfficiency * photonVolts * aboveThreshold
}
