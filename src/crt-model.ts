/**
 * Cathode-ray tube (CRT) — Karl Ferdinand Braun's tube (1897), the screen behind every oscilloscope,
 * radar, and television set of the 20th century. A heated cathode emits electrons; a high positive
 * ANODE voltage (the EHT, kilovolts) accelerates them into a fine beam; a control GRID, biased
 * negative, throttles the beam current and so the brightness (drive it to cut-off and the spot goes
 * dark — that is how a TV blanks between lines). The beam then passes between two pairs of
 * DEFLECTION plates — X and Y — whose voltages bend it, and lands on a PHOSPHOR screen that glows
 * where it is struck.
 *
 * Electrostatic deflection: the spot's displacement is proportional to the deflection voltage and
 * INVERSELY proportional to the accelerating (anode) voltage —
 *   D = (L·ℓ / 2·s) · V_deflect / V_anode
 * (L = plate length, ℓ = plate-to-screen distance, s = plate spacing). A stiffer (higher-EHT) beam
 * is harder to bend, so the same input deflects the spot less. Here the geometry is folded into a
 * deflection_sensitivity (screen-fraction per volt, at a rated anode voltage), and the 1/V_anode
 * dependence is kept explicit, so raising the EHT really does shrink the trace.
 *
 * Honest scope: the electron gun is a fixed beam-current load on the EHT, with the brightness set by
 * a grid-bias PROPERTY (a wired video grid that modulates the beam over time is a refinement); the
 * spot sweeps a LIVE TRACE over a transient run — the deflection plates solve at every time-step and
 * the spot's locus is read back (part-readings.crtSpotTrace), so an X-ramp + a Y-signal draws the
 * waveform and two sines a Lissajous; electrostatic deflection only (the magnetic deflection of a TV
 * yoke, plus focus, astigmatism, the heater warm-up and the Child-Langmuir anode-current law are
 * further rungs).
 * Sources: Braun (1897); standard cathode-ray-tube / electron-optics texts (Parker, "Electronics";
 * Spangenberg, "Vacuum Tubes", on deflection sensitivity).
 */

import type { Instance } from './cross-fk-validator.ts'
import { readScalarParam } from './instance-params.ts'

/** A CRT deflection plate's input resistance to the cathode — high (like a meter input) so the plates
 *  are solvable and never left floating (a singular node), yet draw essentially no current: they set
 *  up a deflecting field, not a current. Shared by the DC and transient solvers. */
export const CRT_DEFLECTION_INPUT_OHMS = 1e7

export type CrtParams = {
  /** Beam current at full brightness (A) — the load the gun draws from the EHT. */
  beamCurrent: number
  /** Grid-cathode bias (V), negative; 0 = full beam, at/below the cutoff = blanked. */
  gridBias: number
  /** Grid cutoff bias (V), negative — the bias that just blanks the beam. */
  gridCutoffVoltage: number
  /** Deflection sensitivity (screen-fraction per volt) at the rated anode voltage. */
  deflectionSensitivity: number
  /** The anode (EHT) voltage the sensitivity is specified at (V). */
  ratedAnodeVoltage: number
}

/**
 * Brightness 0..1 from the grid-cathode bias: full (1) at 0 V, fading to dark (0) at the (negative)
 * cutoff bias, clamped outside. This is the grid's control over the beam current — a TV blanks by
 * driving the grid past cutoff.
 */
export function gridBrightness(gridBias: number, cutoffVoltage: number): number {
  if (!(cutoffVoltage < 0)) return gridBias >= 0 ? 1 : 0
  return Math.max(0, Math.min(1, (gridBias - cutoffVoltage) / -cutoffVoltage))
}

/**
 * The spot's deflection as a fraction of the screen half-width (clamped to ±1, the screen edge).
 * Proportional to the deflection voltage and inversely to the accelerating anode voltage (the
 * 1/V_anode beam-stiffness term), about a rated-voltage sensitivity. Zero with no accelerating
 * voltage (no beam to deflect).
 */
export function deflectionFraction(
  deflectionVoltage: number,
  sensitivity: number,
  anodeVoltage: number,
  ratedAnodeVoltage: number,
): number {
  if (!(anodeVoltage > 0)) return 0
  const stiffness = ratedAnodeVoltage > 0 ? ratedAnodeVoltage / anodeVoltage : 1
  return Math.max(-1, Math.min(1, sensitivity * deflectionVoltage * stiffness))
}

/** Read a CRT's parameters off an instance. Undefined when an essential one is missing. */
export function crtParamsFromInstance(inst: Instance): CrtParams | undefined {
  const beamCurrent = readScalarParam(inst, 'beam_current')
  const gridBias = readScalarParam(inst, 'grid_bias')
  const gridCutoffVoltage = readScalarParam(inst, 'grid_cutoff_voltage')
  const deflectionSensitivity = readScalarParam(inst, 'deflection_sensitivity')
  const ratedAnodeVoltage = readScalarParam(inst, 'rated_anode_voltage')
  if (
    beamCurrent === undefined ||
    gridBias === undefined ||
    gridCutoffVoltage === undefined ||
    deflectionSensitivity === undefined ||
    ratedAnodeVoltage === undefined
  ) {
    return undefined
  }
  return { beamCurrent, gridBias, gridCutoffVoltage, deflectionSensitivity, ratedAnodeVoltage }
}
