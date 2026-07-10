import type { World } from '../cross-fk-validator.ts'
import { solveTransient, transientRan } from '../transient-solver.ts'
import { fastestSourceHz, scopeWindow } from './scope.tsx'

/**
 * The RMS current at every device terminal, for the board over-current DRC on an AC circuit.
 *
 * A trace's IPC-2221 ampacity is a HEATING limit — it's set by the RMS current, since heating goes as
 * I². The DC operating point can't see that: an AC source with no DC offset solves to ~0 A, so a trace
 * genuinely carrying amps of AC would read as carrying nothing. So when the circuit has a live AC
 * source, run a short time-domain (transient) analysis over a few periods and take the true RMS of the
 * per-terminal current waveform the transient solver already records (keyed `id/terminal`, per-device
 * KCL holding). The board over-current check then compares each trace against the RMS current it
 * really carries.
 *
 * Returns undefined for a DC circuit (no AC source) — the caller uses the DC solve's currents there —
 * and for a transient that can't run or would be too heavy (an honest skip, never a faked zero).
 *
 * RMS is averaged over the LAST third of the window. scopeWindow sizes the run to three periods of the
 * slowest AC source, so the last third is one full slowest-source period — an exact RMS for a settled
 * sinusoid, after two periods for reactive (RC/RL) circuits to approach steady state. It is the same
 * window the scope displays, so the number matches what the user sees.
 */
export function boardRmsTerminalCurrents(
  world: World,
  temperaturesC?: Map<string, number>,
): Map<string, number> | undefined {
  const acHz = fastestSourceHz(world)
  if (acHz <= 0) return undefined // a DC circuit — the DC solve's currents already cover it

  const { timeStep, duration } = scopeWindow(world)
  if (!(timeStep > 0) || !(duration > 0)) return undefined
  const steps = Math.round(duration / timeStep)
  // Too coarse to trust an RMS, or too heavy to run live on every board edit — skip honestly.
  if (steps < 12 || steps > 8000) return undefined

  const result = solveTransient(world, {
    timeStep,
    duration,
    ...(temperaturesC ? { temperaturesC } : {}),
  })
  if (!transientRan(result.status) || result.series.length < 4) return undefined

  const tEnd = result.series[result.series.length - 1]?.time ?? 0
  const windowStart = tEnd - duration / 3 // the last slowest-source period (duration = 3 periods)
  const sumSquares = new Map<string, number>()
  const samples = new Map<string, number>()
  for (const point of result.series) {
    if (point.time < windowStart || point.currents === undefined) continue
    for (const [key, amps] of point.currents) {
      sumSquares.set(key, (sumSquares.get(key) ?? 0) + amps * amps)
      samples.set(key, (samples.get(key) ?? 0) + 1)
    }
  }

  const rms = new Map<string, number>()
  for (const [key, total] of sumSquares) {
    const n = samples.get(key) ?? 0
    if (n > 0) rms.set(key, Math.sqrt(total / n))
  }
  return rms.size > 0 ? rms : undefined
}
