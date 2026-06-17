import type { Instance, World } from './cross-fk-validator.ts'
import { solveDCRobust } from './dc-robust.ts'
import { fuseIsIntact, mathInstance as math, switchIsClosed } from './dc-solver.ts'
import {
  type BjtSmallSignal,
  bjtSmallSignalModel,
  type MosfetSmallSignal,
  mosfetSmallSignalModel,
} from './small-signal.ts'

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
 * mathjs lusolve the DC solver uses — here over a complex MNA matrix. Wires, intact
 * fuses, and closed SPST switches stamp as 0 V shorts (matching the DC/transient
 * engines). BJT and MOSFET/JFET/CRD small-signal models, linearized at the DC
 * operating point (the same companion Jacobian the DC solver uses), are included.
 * Verified against the textbook RC/CR first-order responses.
 *
 * KNOWN LIMITATIONS — this engine is test-only today, NOT yet wired to the canvas UI:
 *  - SPDT switches and relay contacts are not yet shorted (only wires, intact fuses, and
 *    closed SPST switches are); diode small-signal is not modeled (diodes are dropped).
 *  - The DC operating point is solved at 25 C (the temperaturesC map is not threaded in).
 */

export type Complex = { re: number; im: number }

const cAbs = (re: number, im: number): number => Math.hypot(re, im)
const cArgDeg = (re: number, im: number): number => (Math.atan2(im, re) * 180) / Math.PI

function readParam(inst: Instance, name: string): number | undefined {
  const params = inst.parameters as Record<string, { value?: { amount?: number } }> | undefined
  const amount = params?.[name]?.value?.amount
  return typeof amount === 'number' ? amount : undefined
}

type BjtAcModel = BjtSmallSignal & { bIdx: number; cIdx: number; eIdx: number }
type MosfetAcModel = MosfetSmallSignal & { gIdx: number; dIdx: number; sIdx: number }

type Topology = {
  ground: string
  nodeIndex: Map<string, number>
  vsources: Instance[]
  /** 2-terminal 0 V shorts (wires, intact fuses, closed SPST switches): a branch unknown each. */
  shorts: { aNet: string; bNet: string }[]
  dim: number
  bjts: BjtAcModel[]
  mosfets: MosfetAcModel[]
}

const BJT_DEFINITIONS = new Set(['transistor_bjt_npn', 'transistor_bjt_pnp'])
const FET_DEFINITIONS = new Set([
  'transistor_mosfet_nmos',
  'transistor_mosfet_pmos',
  'transistor_jfet_n_channel',
  'transistor_jfet_p_channel',
  'diode_constant_current',
])
const SHORT_DEFINITIONS = new Set(['wire', 'fuse', 'switch_spst_toggle', 'switch_spst_momentary'])

function buildTopology(world: World): Topology | null {
  let ground: string | undefined
  for (const net of world.nets.values()) if (net.type === 'ground') ground = net.id
  if (ground === undefined) return null

  const nodeIndex = new Map<string, number>()
  for (const net of world.nets.values()) {
    if (net.id !== ground) nodeIndex.set(net.id, nodeIndex.size)
  }
  const vsources = [...world.instances.values()].filter((i) => i.definition === 'power_source')
  const idx = (net: string) => (net === ground ? -1 : (nodeIndex.get(net) ?? -1))

  // 2-terminal 0 V shorts the DC/transient engines also stamp: a wire (its tiny series R is
  // negligible at signal level), an intact fuse, a closed SPST switch. Each becomes a 0 V source.
  const shorts: { aNet: string; bNet: string }[] = []
  for (const inst of world.instances.values()) {
    if (!SHORT_DEFINITIONS.has(inst.definition)) continue
    if (inst.definition === 'fuse' && !fuseIsIntact(inst)) continue
    if (inst.definition.startsWith('switch_') && !switchIsClosed(inst)) continue
    const aNet = inst.connects?.[0]?.net
    const bNet = inst.connects?.[1]?.net
    if (aNet !== undefined && bNet !== undefined && aNet !== bNet) shorts.push({ aNet, bNet })
  }

  // Transistors (BJT + MOSFET/JFET/CRD) are linearized at the DC operating point: solve it once
  // (only when the circuit has any), then build each small-signal model around it.
  const bjts: BjtAcModel[] = []
  const mosfets: MosfetAcModel[] = []
  const bjtInsts = [...world.instances.values()].filter((i) => BJT_DEFINITIONS.has(i.definition))
  const fetInsts = [...world.instances.values()].filter((i) => FET_DEFINITIONS.has(i.definition))
  if (bjtInsts.length > 0 || fetInsts.length > 0) {
    const dc = solveDCRobust(world)
    if (dc.status === 'solved') {
      const nodeVoltage = (net: string) => (net === ground ? 0 : (dc.nodes.get(net) ?? 0))
      for (const inst of bjtInsts) {
        const ss = bjtSmallSignalModel(inst, nodeVoltage)
        if (ss === null) continue
        bjts.push({
          ...ss,
          bIdx: idx(ss.baseNet),
          cIdx: idx(ss.collectorNet),
          eIdx: idx(ss.emitterNet),
        })
      }
      for (const inst of fetInsts) {
        const ss = mosfetSmallSignalModel(inst, nodeVoltage)
        if (ss === null) continue
        mosfets.push({
          ...ss,
          gIdx: idx(ss.gateNet),
          dIdx: idx(ss.drainNet),
          sIdx: idx(ss.sourceNet),
        })
      }
    }
  }

  return {
    ground,
    nodeIndex,
    vsources,
    shorts,
    dim: nodeIndex.size + vsources.length + shorts.length,
    bjts,
    mosfets,
  }
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
  const { ground, nodeIndex, vsources, shorts, dim } = topo
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

  // 2-terminal shorts: a 0 V source (branch unknown) per short — its equation constrains v_a = v_b.
  shorts.forEach((sh, k) => {
    const branch = nodeIndex.size + vsources.length + k
    const a = idx(sh.aNet)
    const b = idx(sh.bNet)
    if (a >= 0) {
      accumulate(a, branch, 1, 0)
      accumulate(branch, a, 1, 0)
    }
    if (b >= 0) {
      accumulate(b, branch, -1, 0)
      accumulate(branch, b, -1, 0)
    }
    // rhs[branch] stays 0 — a short carries any current at zero volts across.
  })

  // Transistors: the hybrid-pi small-signal model at the operating point — the 2-port
  // conductance block (straight from the DC companion Jacobian) plus the junction
  // capacitances that set the high-frequency poles. v_BE = V_B - V_E, v_BC = V_B - V_C.
  const accumulateGrounded = (i: number, j: number, re: number, im: number) => {
    if (i >= 0 && j >= 0) accumulate(i, j, re, im)
  }
  for (const t of topo.bjts) {
    const { bIdx: b, cIdx: c, eIdx: e, gmBE, gmBC, gpiBE, gpiBC, cPi, cMu } = t
    // i_C = gmBE*v_BE + gmBC*v_BC, flowing into the collector node
    accumulateGrounded(c, b, gmBE + gmBC, 0)
    accumulateGrounded(c, e, -gmBE, 0)
    accumulateGrounded(c, c, -gmBC, 0)
    // i_B = gpiBE*v_BE + gpiBC*v_BC, into the base node
    accumulateGrounded(b, b, gpiBE + gpiBC, 0)
    accumulateGrounded(b, e, -gpiBE, 0)
    accumulateGrounded(b, c, -gpiBC, 0)
    // i_E = -(i_C + i_B), into the emitter node
    accumulateGrounded(e, b, -(gmBE + gpiBE + gmBC + gpiBC), 0)
    accumulateGrounded(e, e, gmBE + gpiBE, 0)
    accumulateGrounded(e, c, gmBC + gpiBC, 0)
    // C_pi across base-emitter, C_mu across base-collector
    stampY(b, e, 0, omega * cPi)
    stampY(b, c, 0, omega * cMu)
  }

  // MOSFETs / JFETs / CRDs: a voltage-controlled current source at the operating point.
  // i_D into the drain = g_m·(v_G − v_S) + g_ds·(v_D − v_S); i_S = −i_D; the gate draws no current.
  for (const m of topo.mosfets) {
    const { gIdx: g, dIdx: d, sIdx: s, gm, gds } = m
    accumulateGrounded(d, g, gm, 0)
    accumulateGrounded(d, d, gds, 0)
    accumulateGrounded(d, s, -(gm + gds), 0)
    accumulateGrounded(s, g, -gm, 0)
    accumulateGrounded(s, d, -gds, 0)
    accumulateGrounded(s, s, gm + gds, 0)
  }

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

export type PhaseMarginResult = {
  /** Frequency where the open-loop gain falls to unity (0 dB). */
  unityGainHz: number
  /** 180° + the open-loop phase at that frequency. >0 is stable; bigger is more so
   *  (45–60° is the usual healthy target). Measured with a non-inverting drive, so
   *  the DC phase starts near 0° and the poles rotate it down. */
  phaseMarginDeg: number
  dcGainDb: number
}

/**
 * Phase margin of an amplifier's open-loop response — the un-foolable stability
 * number. Sweeps the response, unwraps the phase (atan2 wraps at ±180°), finds the
 * unity-gain crossover, and reports 180° + the phase there. Returns null if the gain
 * never crosses unity over the swept band. Drive the NON-inverting input so the DC
 * phase begins near 0° and the convention holds.
 */
export function phaseMargin(world: World, opts: AcSweepOptions): PhaseMarginResult | null {
  const points = acSweep(world, opts)
  if (points.length < 2) return null

  const phase: number[] = []
  for (let i = 0; i < points.length; i++) {
    const raw = points[i]?.phaseDeg ?? 0
    if (i === 0) {
      phase.push(raw)
      continue
    }
    let p = raw
    const prev = phase[i - 1] ?? 0
    while (p - prev > 180) p -= 360
    while (p - prev < -180) p += 360
    phase.push(p)
  }

  const dcGainDb = points[0]?.gainDb ?? Number.NaN
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) continue
    if (a.gainDb >= 0 && b.gainDb < 0) {
      const t = a.gainDb / (a.gainDb - b.gainDb) // fraction to the 0 dB crossing
      const pa = phase[i - 1] ?? 0
      const pb = phase[i] ?? 0
      return {
        unityGainHz: a.frequencyHz * (b.frequencyHz / a.frequencyHz) ** t,
        phaseMarginDeg: 180 + (pa + t * (pb - pa)),
        dcGainDb,
      }
    }
  }
  return null
}
