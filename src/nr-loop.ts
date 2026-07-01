/**
 * The Newton-Raphson device-guess update — the shared inner step of both operating-point solvers.
 *
 * The DC solver (dc-solver.ts) and the transient solver (transient-solver.ts) both re-linearize the
 * nonlinear devices around a voltage guess, solve the linear system, then walk each device's guess
 * toward the new node voltages with SPICE-style limiting (pnjlim on junctions, a per-iteration step
 * clamp on the square-law / space-charge devices), repeating until every guess is quiet. That
 * per-device update was written out TWICE — once in each solver's loop, ~110 near-identical lines each.
 * Two copies of the same convergence-critical arithmetic is exactly the kind of duplication that lets
 * the DC operating point and the transient final value silently drift apart (the "transient settles to
 * the DC solution" cross-checks guard the outcome; this guards the code that produces it). SPICE §20.6.
 *
 * Each `update*Guess` reads the device's terminal voltages through a `Volts` accessor, applies the
 * limiting, MUTATES the guess on the element in place, and returns how far the guess moved plus whether
 * limiting kicked in. A `GuessAccumulator` folds those per-device results into the one-shot convergence
 * test the loops share (`maxDelta < tol AND nothing limited`). The element parameters are structural
 * interfaces — the concrete `ShockleyLed` / `DiodeElement` / `BjtElement` / … types satisfy them by
 * shape, so nr-loop.ts stays free of any dependency back on the solvers.
 */

import { criticalVoltage, pnjlim } from './diode-model.ts'
import { limitMosfetStep } from './mosfet-model.ts'
import { NR_VOLTAGE_TOLERANCE } from './solver-constants.ts'
import { limitTunnelDiodeStep } from './tunnel-diode-model.ts'
import { limitVacuumStep } from './vacuum-tube-model.ts'

/** Node voltage relative to ground — ground reads 0, an unsolved net reads 0. */
export type Volts = (net: string) => number

/** Build the `Volts` accessor for one solved instant from its node-voltage map. */
export function nodeVolts(nodes: Map<string, number>, ground: string): Volts {
  return (net) => (net === ground ? 0 : (nodes.get(net) ?? 0))
}

/** How far a device's guess moved this iteration, and whether limiting clamped it. */
export type GuessDelta = { delta: number; limited: boolean }

/**
 * Folds each device's per-iteration result into the shared convergence test: an iteration is converged
 * when the largest guess move is below tolerance AND no device's step was limited (a still-limited
 * junction hasn't reached its operating point yet, however small the reported move). One per iteration.
 */
export class GuessAccumulator {
  maxDelta = 0
  anyLimited = false

  add(result: GuessDelta): void {
    if (result.delta > this.maxDelta) this.maxDelta = result.delta
    if (result.limited) this.anyLimited = true
  }

  get converged(): boolean {
    return this.maxDelta < NR_VOLTAGE_TOLERANCE && !this.anyLimited
  }
}

// ---------------------------------------------------------------------------
// Structural element interfaces — the minimal shape each update reads / mutates.
// ---------------------------------------------------------------------------

/** A forward pn-junction (LED / rectifier / Schottky / conducting Shockley diode). */
export interface JunctionGuess {
  anodeNet: string
  cathodeNet: string
  saturationCurrent: number
  idealityFactor: number
  thermalV: number
  vGuess: number
}

/** A Zener — the junction fields plus its reverse-breakdown branch. */
export interface ZenerGuess extends JunctionGuess {
  zenerVoltage: number
  breakdownCurrent: number
  breakdownIdeality: number
}

/** A tunnel (Esaki) diode — limited by a plain step clamp (its conductance goes negative). */
export interface TunnelGuess {
  anodeNet: string
  cathodeNet: string
  vGuess: number
}

/** A vacuum diode — Child-Langmuir space charge, plate minus cathode. */
export interface VacuumGuess {
  plateNet: string
  cathodeNet: string
  vGuess: number
}

/** A triode — grid + plate biases referenced to the cathode. */
export interface TriodeGuess {
  plateNet: string
  gridNet: string
  cathodeNet: string
  vGK: number
  vPK: number
}

/** A screen-grid tube (tetrode / pentode) — control-grid, screen, and plate biases. */
export interface ScreenTubeGuess {
  plateNet: string
  gridNet: string
  screenNet: string
  cathodeNet: string
  vG1K: number
  vG2K: number
  vPK: number
}

/** A BJT — two coupled junctions; guesses live in the forward frame (PNP negated). */
export interface BjtGuess {
  baseNet: string
  collectorNet: string
  emitterNet: string
  params: { saturationCurrent: number }
  thermalV: number
  polarity: 'npn' | 'pnp'
  vBE: number
  vBC: number
}

/** A MOSFET / JFET / constant-current diode — square-law, gate + drain referenced to the source. */
export interface MosfetGuess {
  gateNet: string
  drainNet: string
  sourceNet: string
  vGS: number
  vDS: number
}

// ---------------------------------------------------------------------------
// Per-device-family guess updates.
// ---------------------------------------------------------------------------

/**
 * Per-iteration Zener voltage limiting — pnjlim on the forward branch, else on the breakdown branch in
 * u = −(V + V_Z) space so the reverse knee is limited exactly like a forward junction. Shared verbatim
 * by both solvers (was `limitZenerStep` in the DC solver and `limitTransientZener` in the transient one).
 */
export function limitZener(vRaw: number, z: ZenerGuess): { voltage: number; limited: boolean } {
  const vcritFwd = criticalVoltage(z.saturationCurrent, z.idealityFactor, z.thermalV)
  const fwd = pnjlim(vRaw, z.vGuess, z.idealityFactor * z.thermalV, vcritFwd)
  if (fwd.limited) return fwd
  const vcritBd = criticalVoltage(z.breakdownCurrent, z.breakdownIdeality, z.thermalV)
  const bd = pnjlim(
    -(vRaw + z.zenerVoltage),
    -(z.vGuess + z.zenerVoltage),
    z.breakdownIdeality * z.thermalV,
    vcritBd,
  )
  if (bd.limited) return { voltage: -(bd.voltage + z.zenerVoltage), limited: true }
  return { voltage: vRaw, limited: false }
}

/** Walk a forward-junction guess with pnjlim (§20.4 / §20.7). */
export function updateJunctionGuess(d: JunctionGuess, volts: Volts): GuessDelta {
  const vRaw = volts(d.anodeNet) - volts(d.cathodeNet)
  const nVT = d.idealityFactor * d.thermalV
  const vcrit = criticalVoltage(d.saturationCurrent, d.idealityFactor, d.thermalV)
  const limit = pnjlim(vRaw, d.vGuess, nVT, vcrit)
  const delta = Math.abs(limit.voltage - d.vGuess)
  d.vGuess = limit.voltage
  return { delta, limited: limit.limited }
}

/** Walk a Zener guess with the two-branch limiter. */
export function updateZenerGuess(z: ZenerGuess, volts: Volts): GuessDelta {
  const next = limitZener(volts(z.anodeNet) - volts(z.cathodeNet), z)
  const delta = Math.abs(next.voltage - z.vGuess)
  z.vGuess = next.voltage
  return { delta, limited: next.limited }
}

/** Walk a tunnel-diode guess with the negative-resistance step clamp. */
export function updateTunnelGuess(td: TunnelGuess, volts: Volts): GuessDelta {
  const vRaw = volts(td.anodeNet) - volts(td.cathodeNet)
  const next = limitTunnelDiodeStep(vRaw, td.vGuess)
  const delta = Math.abs(next - td.vGuess)
  const limited = next !== vRaw
  td.vGuess = next
  return { delta, limited }
}

/** Walk a vacuum-diode guess with the Child-Langmuir step clamp. */
export function updateVacuumDiodeGuess(vd: VacuumGuess, volts: Volts): GuessDelta {
  const vRaw = volts(vd.plateNet) - volts(vd.cathodeNet)
  const next = limitVacuumStep(vRaw, vd.vGuess)
  const delta = Math.abs(next - vd.vGuess)
  const limited = next !== vRaw
  vd.vGuess = next
  return { delta, limited }
}

/** Walk a triode's grid + plate guesses with the space-charge step clamp. */
export function updateTriodeGuess(tri: TriodeGuess, volts: Volts): GuessDelta {
  const vGKraw = volts(tri.gridNet) - volts(tri.cathodeNet)
  const vPKraw = volts(tri.plateNet) - volts(tri.cathodeNet)
  const nextVGK = limitVacuumStep(vGKraw, tri.vGK)
  const nextVPK = limitVacuumStep(vPKraw, tri.vPK)
  const delta = Math.max(Math.abs(nextVGK - tri.vGK), Math.abs(nextVPK - tri.vPK))
  const limited = nextVGK !== vGKraw || nextVPK !== vPKraw
  tri.vGK = nextVGK
  tri.vPK = nextVPK
  return { delta, limited }
}

/** Walk a screen-grid tube's control-grid, screen, and plate guesses. */
export function updateScreenTubeGuess(tube: ScreenTubeGuess, volts: Volts): GuessDelta {
  const vG1raw = volts(tube.gridNet) - volts(tube.cathodeNet)
  const vG2raw = volts(tube.screenNet) - volts(tube.cathodeNet)
  const vPraw = volts(tube.plateNet) - volts(tube.cathodeNet)
  const nG1 = limitVacuumStep(vG1raw, tube.vG1K)
  const nG2 = limitVacuumStep(vG2raw, tube.vG2K)
  const nP = limitVacuumStep(vPraw, tube.vPK)
  const delta = Math.max(
    Math.abs(nG1 - tube.vG1K),
    Math.abs(nG2 - tube.vG2K),
    Math.abs(nP - tube.vPK),
  )
  const limited = nG1 !== vG1raw || nG2 !== vG2raw || nP !== vPraw
  tube.vG1K = nG1
  tube.vG2K = nG2
  tube.vPK = nP
  return { delta, limited }
}

/** Walk a BJT's two junction guesses (forward frame, PNP negated) with pnjlim. */
export function updateBjtGuess(bjt: BjtGuess, volts: Volts): GuessDelta {
  const vB = volts(bjt.baseNet)
  const vC = volts(bjt.collectorNet)
  const vE = volts(bjt.emitterNet)
  const sign = bjt.polarity === 'pnp' ? -1 : 1
  const vcrit = criticalVoltage(bjt.params.saturationCurrent, 1, bjt.thermalV)
  const limBE = pnjlim(sign * (vB - vE), bjt.vBE, bjt.thermalV, vcrit)
  const limBC = pnjlim(sign * (vB - vC), bjt.vBC, bjt.thermalV, vcrit)
  const delta = Math.max(Math.abs(limBE.voltage - bjt.vBE), Math.abs(limBC.voltage - bjt.vBC))
  bjt.vBE = limBE.voltage
  bjt.vBC = limBC.voltage
  return { delta, limited: limBE.limited || limBC.limited }
}

/** Walk a MOSFET's gate + drain guesses with the square-law step clamp (SPICE's fetlim idea). */
export function updateMosfetGuess(fet: MosfetGuess, volts: Volts): GuessDelta {
  const vGSraw = volts(fet.gateNet) - volts(fet.sourceNet)
  const vDSraw = volts(fet.drainNet) - volts(fet.sourceNet)
  const nextVGS = limitMosfetStep(vGSraw, fet.vGS)
  const nextVDS = limitMosfetStep(vDSraw, fet.vDS)
  const delta = Math.max(Math.abs(nextVGS - fet.vGS), Math.abs(nextVDS - fet.vDS))
  const limited = nextVGS !== vGSraw || nextVDS !== vDSraw
  fet.vGS = nextVGS
  fet.vDS = nextVDS
  return { delta, limited }
}
