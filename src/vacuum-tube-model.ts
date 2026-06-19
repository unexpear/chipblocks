/**
 * Vacuum-tube physics — thermionic emission + the Child-Langmuir space-charge law.
 *
 * Pure functions, no solver coupling — the Newton-Raphson loops in dc-solver.ts and
 * transient-solver.ts compose these, exactly as they compose the Shockley diode
 * (diode-model.ts). A heated cathode boils off electrons (thermionic emission); a
 * positive plate collects them. The current is limited by the space charge of the
 * electron cloud between cathode and plate, giving the Child-Langmuir 3/2-power law
 *   I = perveance · V^1.5            (perveance P is a geometry constant, A/V^1.5)
 * for V > 0, and 0 for V <= 0 (a cold plate cannot pull electrons backward, so the
 * tube blocks reverse — the rectifying property Fleming's valve was built for).
 *
 * For a GRID tube (triode/tetrode/pentode) a control grid sits between cathode and
 * plate. Because it is closer to the cathode it is mu times more effective than the
 * plate at controlling the current, so the accelerating voltage becomes the effective
 * voltage V_eff = V_grid + V_plate/mu, and the plate current is
 *   I = perveance · (V_grid + V_plate/mu)^1.5.
 * The grid (held negative in normal class-A use) draws ~no current — like a FET gate
 * — so the tube is a transconductance device: a small grid swing makes a large plate
 * swing. That is the amplification de Forest's triode added in 1906.
 *
 * VERIFIED against: Child (1911) / Langmuir & Compton space-charge law; the triode
 * 3/2-power equation I_p = P·(V_g + V_p/mu)^1.5 and the relation mu = g_m·r_p
 * (Spangenberg, "Vacuum Tubes", 1948; Reich, "Theory and Applications of Electron
 * Tubes", 1944).
 *
 * Honest scope: assumes a HOT cathode (heater powered) — the current is space-charge
 * limited, not temperature/emission limited; the heater warm-up and the
 * temperature-limited (Richardson-Dushman) regime are a documented future rung.
 * Contact potential, the island effect, grid current at positive grid, and secondary
 * emission are omitted (the suppressor grid of a pentode is modeled by its EFFECT —
 * restoring the plate's near-independence — not the secondary-emission physics).
 */

/** A tiny conductance a cut-off tube (V_eff <= 0) presents instead of a true open,
 *  so an isolated plate node stays solvable (the same role gmin plays for diodes). */
export const TUBE_OFF_CONDUCTANCE = 1e-12

/**
 * Child-Langmuir plate current: I = perveance·V^1.5 for V > 0, else 0. V is the
 * effective accelerating voltage — plate-to-cathode for a diode, V_grid + V_plate/mu
 * for a grid tube.
 */
export function childLangmuirCurrent(effectiveVoltage: number, perveance: number): number {
  if (effectiveVoltage <= 0) return 0
  return perveance * effectiveVoltage ** 1.5
}

/** Small-signal slope dI/dV of the Child-Langmuir law: 1.5·perveance·sqrt(V), V > 0. */
export function childLangmuirSlope(effectiveVoltage: number, perveance: number): number {
  if (effectiveVoltage <= 0) return 0
  return 1.5 * perveance * Math.sqrt(effectiveVoltage)
}

/**
 * Perveance derived from a datasheet operating point — P = I / V_eff^1.5 — so a tube
 * can be specified by a real (current, voltage) point rather than a raw geometry
 * constant. V_eff is the plate-cathode voltage for a diode, or V_g + V_p/mu for a
 * grid tube. Undefined-safe: returns 0 for a non-positive V_eff.
 */
export function perveanceFromOperatingPoint(current: number, effectiveVoltage: number): number {
  if (effectiveVoltage <= 0 || current <= 0) return 0
  return current / effectiveVoltage ** 1.5
}

/**
 * Newton companion for a vacuum DIODE at plate-cathode voltage V: a conductance G_eq
 * in parallel with a current source I_eq, with G_eq·V + I_eq = I(V) at the
 * linearization point — the same {conductance, currentSource} shape the Shockley
 * companionModel returns. Below cut-off (V <= 0) it is a near-open (a tiny floor
 * conductance keeps the node non-singular).
 */
export function vacuumDiodeCompanion(
  voltage: number,
  perveance: number,
): { conductance: number; currentSource: number } {
  if (voltage <= 0) return { conductance: TUBE_OFF_CONDUCTANCE, currentSource: 0 }
  const conductance = childLangmuirSlope(voltage, perveance)
  const current = childLangmuirCurrent(voltage, perveance)
  return { conductance, currentSource: current - conductance * voltage }
}

/**
 * Per-iteration plate-voltage step limit for the Newton-Raphson loop. The
 * Child-Langmuir 3/2 law is gentle (no junction exponential), so — like the MOSFET's
 * square law — a plain step clamp that only catches a wild Newton jump is enough; it
 * caps the move at MAX_STEP volts (generous, since tubes run at tens-to-hundreds of
 * volts) so the solve walks to the operating point without overshooting across the
 * cut-off kink at V = 0. Returns the limited voltage.
 */
export function limitVacuumStep(vNew: number, vOld: number): number {
  const MAX_STEP = 20
  const delta = vNew - vOld
  if (Math.abs(delta) > MAX_STEP) return vOld + Math.sign(delta) * MAX_STEP
  return vNew
}

export type GridTubeOperatingPoint = {
  /** Plate current I_p (A). */
  plateCurrent: number
  /** Transconductance g_m = dI_p/dV_g (A/V) — the grid's control over the plate. */
  gm: number
  /** Plate conductance g_p = dI_p/dV_p = 1/r_p (A/V); r_p = mu/g_m, so mu = g_m·r_p. */
  gp: number
}

/**
 * A grid tube's operating point at plate and grid voltages (both relative to the
 * cathode). The grid modulates the plate current through the effective voltage
 * V_eff = V_grid + V_plate/mu:
 *   I_p = perveance · V_eff^1.5        (V_eff > 0, else the tube is cut off)
 * and the small-signal Jacobian falls straight out of the chain rule:
 *   g_m = dI_p/dV_g = 1.5·P·sqrt(V_eff)            (dV_eff/dV_g = 1)
 *   g_p = dI_p/dV_p = g_m / mu                      (dV_eff/dV_p = 1/mu)
 * so r_p = 1/g_p = mu/g_m and mu = g_m·r_p — the textbook tube relation, exact here
 * by construction. For a tetrode/pentode the plate's grip is broken by the screen
 * grid; pass a large effective mu (the screen makes the plate nearly irrelevant) so
 * g_p -> ~0 and the plate current is set by the control grid + screen, the pentode's
 * flat plate characteristic.
 */
export function gridTubeOperatingPoint(
  plateVoltage: number,
  gridVoltage: number,
  perveance: number,
  amplificationFactor: number,
): GridTubeOperatingPoint {
  const mu = amplificationFactor > 0 ? amplificationFactor : 1
  const vEff = gridVoltage + plateVoltage / mu
  if (vEff <= 0) {
    return { plateCurrent: 0, gm: TUBE_OFF_CONDUCTANCE, gp: TUBE_OFF_CONDUCTANCE / mu }
  }
  const plateCurrent = childLangmuirCurrent(vEff, perveance)
  const gm = childLangmuirSlope(vEff, perveance)
  return { plateCurrent, gm, gp: gm / mu }
}

export type ScreenTubeOperatingPoint = {
  /** Plate current I_p (A). */
  plateCurrent: number
  /** Control-grid (g1) transconductance dI_p/dV_g1 (A/V) — the main control. */
  gm: number
  /** Screen-grid (g2) control dI_p/dV_g2 (A/V) — smaller than g_m by μ_screen. */
  gScreen: number
  /** Plate conductance dI_p/dV_p (A/V) — TINY (the flat characteristic, high r_p). */
  gp: number
}

/**
 * A screen-grid tube's operating point — a TETRODE or PENTODE. A second grid (the
 * screen, g2) held at a fixed positive voltage does the accelerating and SHIELDS the
 * control grid (g1) from the plate, so the plate current is set by the control grid +
 * screen and becomes nearly INDEPENDENT of the plate voltage — the flat plate
 * characteristic that gives a screen-grid tube its very high plate resistance r_p and,
 * with it, much higher voltage gain than a triode (A ≈ g_m·R_load, since r_p ≫ R_load).
 * The effective accelerating voltage gains a screen term and a much-weakened plate term:
 *   V_eff = V_g1 + V_g2/μ_screen + V_plate/μ_plate
 * with μ_screen the control-grid-to-SCREEN factor (the dominant control) and μ_plate the
 * control-grid-to-PLATE factor, which is VERY large (the screen shields the plate), so
 * dI_p/dV_plate = g_m/μ_plate is tiny — the flat characteristic. I_p = P·V_eff^1.5.
 *
 * Honest scope: the idealized flat characteristic only. A real TETRODE has the "kink" —
 * a secondary-emission dip when V_plate falls below V_screen — which this does NOT
 * model; that kink is exactly what the PENTODE's suppressor grid removes, so this one
 * function serves both (the tetrode's clean region = the pentode's whole curve). Screen
 * current is taken as zero (a real screen intercepts ~10-20% of the cathode current — a
 * documented gap), so g2 is treated as a no-current control electrode like g1.
 */
export function screenGridTubeOperatingPoint(
  plateVoltage: number,
  controlGridVoltage: number,
  screenVoltage: number,
  perveance: number,
  screenMu: number,
  plateMu: number,
): ScreenTubeOperatingPoint {
  const mS = screenMu > 0 ? screenMu : 1
  const mP = plateMu > 0 ? plateMu : 1
  const vEff = controlGridVoltage + screenVoltage / mS + plateVoltage / mP
  if (vEff <= 0) {
    return {
      plateCurrent: 0,
      gm: TUBE_OFF_CONDUCTANCE,
      gScreen: TUBE_OFF_CONDUCTANCE / mS,
      gp: TUBE_OFF_CONDUCTANCE / mP,
    }
  }
  const plateCurrent = childLangmuirCurrent(vEff, perveance)
  const slope = childLangmuirSlope(vEff, perveance)
  return { plateCurrent, gm: slope, gScreen: slope / mS, gp: slope / mP }
}
