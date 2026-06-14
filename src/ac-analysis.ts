import type { Instance, World } from './cross-fk-validator.ts'
import { mathInstance as math } from './dc-solver.ts'

/**
 * Small-signal AC (frequency-domain) analysis. Where the DC solver finds the
 * operating point and the transient solver steps through time, this solves the
 * circuit at a single sinusoidal frequency using complex (phasor) admittances —
 * the standard way to get a Bode plot (gain and phase vs frequency) and, from it,
 * the phase margin that decides whether a feedback amplifier is stable.
 *
 * Why a separate engine: backward-Euler transient DAMPS oscillations, so it can
 * make an unstable amplifier look stable. The honest stability check is the phase
 * margin from a real frequency response, which is what this computes.
 *
 * This stage covers the LINEAR elements (R, C, L) plus independent sources, solved
 * exactly in the frequency domain (R -> 1/R, C -> jwC, L -> 1/jwL) via the same
 * mathjs lusolve the DC solver uses — here over a complex MNA matrix. Transistor
 * and diode small-signal models, linearized at the DC operating point, are layered
 * on in the next increment. Verified against the textbook RC/CR first-order responses.
 */

export type Complex = { re: number; im: number }

const cAbs = (re: number, im: number): number => Math.hypot(re, im)
const cArgDeg = (re: number, im: number): number => (Math.atan2(im, re) * 180) / Math.PI

function readParam(inst: Instance, name: string): number | undefined {
  const params = inst.parameters as Record<string, { value?: { amount?: number } }> | undefined
  const amount = params?.[name]?.value?.amount
  return typeof amount === 'number' ? amount : undefined
}

type Topology = {
  ground: string
  nodeIndex: Map<string, number>
  vsources: Instance[]
  dim: number
}

function buildTopology(world: World): Topology | null {
  let ground: string | undefined
  for (const net of world.nets.values()) if (net.type === 'ground') ground = net.id
  if (ground === undefined) return null

  const nodeIndex = new Map<string, number>()
  for (const net of world.nets.values()) {
    if (net.id !== ground) nodeIndex.set(net.id, nodeIndex.size)
  }
  const vsources = [...world.instances.values()].filter((i) => i.definition === 'power_source')
  return { ground, nodeIndex, vsources, dim: nodeIndex.size + vsources.length }
}

/** Solve the linear circuit at angular frequency omega; return the complex node
 *  voltage at `outputNet` with a unit phasor on `inputSource` (all other sources
 *  AC-grounded). */
function solveAtOmega(
  world: World,
  topo: Topology,
  inputSource: string,
  outputNet: string,
  omega: number,
): Complex | null {
  const { ground, nodeIndex, vsources, dim } = topo
  if (dim === 0) return { re: 0, im: 0 }
  const idx = (net: string) => (net === ground ? -1 : (nodeIndex.get(net) ?? -1))

  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  const M: any = math.zeros(dim, dim)
  // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
  const rhs: any = math.zeros(dim, 1)
  const accumulate = (i: number, j: number, re: number, im: number) =>
    M.set([i, j], math.add(M.get([i, j]), math.complex(re, im)))
  // Stamp an admittance (re + j*im) between nodes a and c (−1 = ground, skipped).
  const stampY = (a: number, c: number, re: number, im: number) => {
    if (a >= 0) accumulate(a, a, re, im)
    if (c >= 0) accumulate(c, c, re, im)
    if (a >= 0 && c >= 0) {
      accumulate(a, c, -re, -im)
      accumulate(c, a, -re, -im)
    }
  }

  for (const inst of world.instances.values()) {
    const ports = (inst.connects ?? []).map((conn) => idx(conn.net))
    if (ports.length < 2) continue
    const [a, c] = ports as [number, number]
    if (inst.definition === 'resistor') {
      const r = readParam(inst, 'resistance')
      if (r && r > 0) stampY(a, c, 1 / r, 0)
    } else if (inst.definition === 'capacitor') {
      const cap = readParam(inst, 'capacitance')
      if (cap && cap > 0) stampY(a, c, 0, omega * cap)
    } else if (inst.definition === 'inductor') {
      const l = readParam(inst, 'inductance')
      if (l && l > 0) stampY(a, c, 0, -1 / (omega * l))
    }
  }

  // Independent voltage sources: a branch unknown each; the input carries the unit
  // phasor, every other source is an AC short (0 V).
  vsources.forEach((vs, k) => {
    const branch = nodeIndex.size + k
    const pos = vs.connects?.find((conn) => conn.terminal === 'terminal_positive')
    const neg = vs.connects?.find((conn) => conn.terminal === 'terminal_negative')
    const p = pos ? idx(pos.net) : -1
    const n = neg ? idx(neg.net) : -1
    if (p >= 0) {
      accumulate(p, branch, 1, 0)
      accumulate(branch, p, 1, 0)
    }
    if (n >= 0) {
      accumulate(n, branch, -1, 0)
      accumulate(branch, n, -1, 0)
    }
    rhs.set([branch, 0], vs.id === inputSource ? 1 : 0)
  })

  // biome-ignore lint/suspicious/noExplicitAny: mathjs lusolve return is polymorphic
  let solution: any
  try {
    solution = math.lusolve(M, rhs)
  } catch {
    return null // singular matrix
  }
  const outIdx = idx(outputNet)
  if (outIdx < 0) return { re: 0, im: 0 }
  const v = solution.get([outIdx, 0])
  return typeof v === 'number' ? { re: v, im: 0 } : { re: v.re, im: v.im }
}

export type AcPoint = { frequencyHz: number; gain: number; gainDb: number; phaseDeg: number }
export type AcOptions = { inputSource: string; outputNet: string }
export type AcSweepOptions = AcOptions & {
  fStartHz: number
  fStopHz: number
  pointsPerDecade: number
}

const toPoint = (frequencyHz: number, vout: Complex | null): AcPoint => {
  if (vout === null) {
    return { frequencyHz, gain: Number.NaN, gainDb: Number.NaN, phaseDeg: Number.NaN }
  }
  const gain = cAbs(vout.re, vout.im)
  return { frequencyHz, gain, gainDb: 20 * Math.log10(gain), phaseDeg: cArgDeg(vout.re, vout.im) }
}

/** Gain and phase of outputNet / inputSource at a single frequency. */
export function acResponse(world: World, opts: AcOptions, frequencyHz: number): AcPoint {
  const topo = buildTopology(world)
  if (topo === null) return toPoint(frequencyHz, null)
  const vout = solveAtOmega(
    world,
    topo,
    opts.inputSource,
    opts.outputNet,
    2 * Math.PI * frequencyHz,
  )
  return toPoint(frequencyHz, vout)
}

/** A logarithmic frequency sweep (a Bode plot's worth of points). */
export function acSweep(world: World, opts: AcSweepOptions): AcPoint[] {
  const topo = buildTopology(world)
  if (topo === null) return []
  const decades = Math.log10(opts.fStopHz / opts.fStartHz)
  const steps = Math.max(1, Math.round(decades * opts.pointsPerDecade))
  const points: AcPoint[] = []
  for (let s = 0; s <= steps; s++) {
    const f = opts.fStartHz * 10 ** ((s / steps) * decades)
    const vout = solveAtOmega(world, topo, opts.inputSource, opts.outputNet, 2 * Math.PI * f)
    points.push(toPoint(f, vout))
  }
  return points
}
