import { SPEED_OF_LIGHT_M_S } from './field-energy.ts'

/**
 * Transmission line — a wire PAIR modeled as a real distributed line, not an instant
 * connection. The signal travels at a finite speed (a fraction of c), and the line
 * presents a characteristic impedance Z₀, so closing a switch launches a WAVE down it:
 * the far end sees nothing until the wave arrives (after τ = length / v), the first gulp
 * of current is set by Z₀ (not by the load), and the wave reflects back and forth, ringing
 * until it settles to the plain DC answer. This is the "when does the bulb light?" physics
 * from the Veritasium follow-up; the lumped solver is the settled (long-after-τ) limit.
 *
 * Solved by BRANIN's method (the exact method of characteristics for a lossless line):
 * each end is a resistor Z₀ in series with a source carrying the wave that LEFT THE OTHER
 * END one delay τ ago —
 *   E_near(t) = v_far(t−τ) + Z₀·i_far(t−τ),   E_far(t) = v_near(t−τ) + Z₀·i_near(t−τ)
 *   v(t) = Z₀·i(t) + E(t)  at each end.
 * The transient solver holds the past (v, i) at each end and reads it back τ ago. At DC
 * (constant in time) this collapses to v_near = v_far, i_near = −i_far — a plain
 * pass-through, which is what the DC solver stamps.
 */

/** Free-space impedance η₀ = √(μ₀/ε₀), ohms (CODATA). */
export const FREE_SPACE_IMPEDANCE_OHMS = 376.730313668

/**
 * Propagation delay τ = length / (c · velocity_factor) — how long the wave takes to run
 * the line end to end. The velocity factor is the fraction of light speed the wave
 * travels: ≈0.95–0.99 for open wire in air, ~0.66 for typical coax (the dielectric slows
 * it). This is the time at the heart of the thought experiment.
 */
export function propagationDelayS(lengthM: number, velocityFactor: number): number {
  if (!(velocityFactor > 0)) return 0
  return Math.max(0, lengthM) / (SPEED_OF_LIGHT_M_S * velocityFactor)
}

/**
 * Characteristic impedance of a two-wire (open-pair) line, Z₀ = (η₀/π)·acosh(D/d), with D
 * the centre-to-centre spacing and d the conductor diameter — ~300–600 Ω for open wire.
 * It is what limits the FIRST gulp of current when the switch closes (I₀ = V/(R_src + Z₀)),
 * before any reflection has had time to return. Returns 0 for overlapping conductors.
 */
export function twoWireImpedanceOhms(spacingM: number, diameterM: number): number {
  if (!(diameterM > 0) || !(spacingM >= diameterM)) return 0
  return (FREE_SPACE_IMPEDANCE_OHMS / Math.PI) * Math.acosh(spacingM / diameterM)
}

/** Voltage reflection coefficient at a termination Z_load on a line of impedance Z₀:
 *  Γ = (Z_load − Z₀)/(Z_load + Z₀). 0 = matched (no reflection), +1 = open, −1 = short. */
export function reflectionCoefficient(loadOhms: number, z0Ohms: number): number {
  if (!(loadOhms + z0Ohms > 0)) return 0
  return (loadOhms - z0Ohms) / (loadOhms + z0Ohms)
}
