import type { Instance, World } from './cross-fk-validator.ts'
import { solveDCRobust } from './dc-robust.ts'
import { fuseIsIntact, relayCoilEnergized, switchIsClosed } from './dc-solver.ts'
import { coilInductanceFromInstance } from './electromagnet-model.ts'
import { readEnumParam, readScalarParam } from './instance-params.ts'
import { mathInstance as math } from './mathjs-instance.ts'
import { returnLossDbFromGamma, vswrFromGamma } from './rf-math.ts'
import {
  type BjtSmallSignal,
  bjtSmallSignalModel,
  type DiodeSmallSignal,
  diodeSmallSignalModel,
  type MosfetSmallSignal,
  mosfetSmallSignalModel,
} from './small-signal.ts'
import { propagationDelayS } from './transmission-line-model.ts'

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
 * fuses, closed SPST switches, the SPDT's selected throw, and the relay's live contact
 * stamp as 0 V shorts (matching the DC/transient engines); the relay coil stamps as its
 * resistance. BJT, MOSFET/JFET/CRD, and diode small-signal (forward, zener breakdown,
 * tunnel negative-resistance, latched Shockley/SCR), linearized at the DC operating
 * point (the same companion Jacobian the DC solver uses), are included, as are 2-winding
 * transformers (coupled inductances, V = jωL·I + jωM·I). Transmission lines are stamped as
 * a lossless 2-port (Y = ∓j·Y0·cot/csc of the electrical length θ = ω·τ = 2π·length/λ) —
 * the frequency-domain view where the WAVELENGTH appears explicitly, so a quarter-wave line
 * flips its load (Z_in = Z0²/Z_L) and half-wave resonances stand out. Verified against the
 * textbook RC/CR first-order responses and the quarter-wave impedance transformer.
 *
 * This engine drives the canvas's Bode panel (bode-panel.tsx — pick an input source + output node,
 * see gain/phase vs frequency). It models every element a circuit can contain: R/C/L, sources, all
 * shorts, BJT / MOSFET / JFET / CRD / diode small-signal (all regimes), the 2-winding transformer,
 * and the (lossless) transmission line — all at temperature. KNOWN LIMITATION: the one structure
 * still not handled is the CENTER-TAPPED transformer's tapped winding.
 */

export type Complex = { re: number; im: number }

const cAbs = (re: number, im: number): number => Math.hypot(re, im)
const cArgDeg = (re: number, im: number): number => (Math.atan2(im, re) * 180) / Math.PI

/** A tiny node-to-ground conductance (S) added to every node so a floating subsection (e.g. an
 *  ungrounded transformer secondary) gives a finite result instead of a singular matrix. ~1 GΩ —
 *  negligible beside any real circuit impedance. */
const AC_GMIN = 1e-9

type BjtAcModel = BjtSmallSignal & { bIdx: number; cIdx: number; eIdx: number }
type MosfetAcModel = MosfetSmallSignal & { gIdx: number; dIdx: number; sIdx: number }
type DiodeAcModel = DiodeSmallSignal & { aIdx: number; cIdx: number }
/** A 2-winding transformer's coupled inductances + its four winding-terminal node indices. */
type TransformerAcModel = {
  pPlusIdx: number
  pMinusIdx: number
  sPlusIdx: number
  sMinusIdx: number
  l1: number
  l2: number
  m: number
}

type Topology = {
  ground: string
  nodeIndex: Map<string, number>
  vsources: Instance[]
  /** 2-terminal 0 V shorts (wires, intact fuses, closed SPST switches): a branch unknown each. */
  shorts: { aNet: string; bNet: string }[]
  /** 2-winding transformers: TWO branch unknowns each (the primary + secondary winding currents). */
  transformers: TransformerAcModel[]
  dim: number
  bjts: BjtAcModel[]
  mosfets: MosfetAcModel[]
  diodes: DiodeAcModel[]
  /** Standalone CCCS parts: a 0 V control-current sense (one branch unknown each) + the f·I output. */
  cccs: Instance[]
}

const BJT_DEFINITIONS = new Set(['transistor_bjt_npn', 'transistor_bjt_pnp'])
const FET_DEFINITIONS = new Set([
  'transistor_mosfet_nmos',
  'transistor_mosfet_pmos',
  'transistor_jfet_n_channel',
  'transistor_jfet_p_channel',
  'diode_constant_current',
])
const DIODE_AC_DEFINITIONS = new Set([
  'led',
  'led_uv_algan',
  'diode_laser',
  'diode_silicon_rectifier',
  'diode_schottky_al_si',
  'diode_varactor',
  'diode_zener_silicon',
  'diode_tunnel',
  'diode_shockley',
  'scr',
])

/**
 * The net pair a 2-port short ties together at AC, or null if it is open / not a short. Wires + intact
 * fuses + closed SPST switches tie their two leads; an SPDT ties common to its selected throw; a relay
 * ties common to the throw its coil selects (normally_open when energized, else normally_closed) —
 * exactly the pairs the DC and transient engines short.
 */
function acShortPair(inst: Instance): { aNet: string; bNet: string } | null {
  const netOf = (t: string) => inst.connects?.find((conn) => conn.terminal === t)?.net
  const pair = (a: string | undefined, b: string | undefined) =>
    a !== undefined && b !== undefined && a !== b ? { aNet: a, bNet: b } : null
  const leads = () => pair(inst.connects?.[0]?.net, inst.connects?.[1]?.net)
  switch (inst.definition) {
    case 'wire':
      return leads()
    case 'fuse':
      return fuseIsIntact(inst) ? leads() : null
    case 'switch_spst_toggle':
    case 'switch_spst_momentary':
      return switchIsClosed(inst) ? leads() : null
    case 'switch_spdt':
      return pair(
        netOf('common'),
        netOf(readEnumParam(inst, 'position') === 'throw_b' ? 'throw_b' : 'throw_a'),
      )
    case 'relay':
      return pair(
        netOf('common'),
        netOf(relayCoilEnergized(inst) ? 'normally_open' : 'normally_closed'),
      )
    default:
      return null
  }
}

function buildTopology(
  world: World,
  temperaturesC?: Map<string, number>,
  portSourceId?: string,
): Topology | null {
  let ground: string | undefined
  for (const net of world.nets.values()) if (net.type === 'ground') ground = net.id
  if (ground === undefined) return null

  const nodeIndex = new Map<string, number>()
  for (const net of world.nets.values()) {
    if (net.id !== ground) nodeIndex.set(net.id, nodeIndex.size)
  }
  // Ordinary drivers are the power sources. A `reference_port` is an OPEN everywhere (DC, transient, Bode)
  // EXCEPT the one reflection measures — passed as `portSourceId`, it joins the drivers just for that solve,
  // so it is driven with the unit phasor and gets a branch-current row (Zin) without shorting other analyses.
  const vsources = [...world.instances.values()].filter(
    (i) => i.definition === 'power_source' || i.id === portSourceId,
  )
  const idx = (net: string) => (net === ground ? -1 : (nodeIndex.get(net) ?? -1))

  // 0 V shorts the DC/transient engines also stamp — wires (their tiny series R is negligible at
  // signal level), intact fuses, closed SPST switches, the SPDT's selected throw, and the relay's
  // live contact — each becomes a 0 V source (a branch unknown).
  const shorts: { aNet: string; bNet: string }[] = []
  for (const inst of world.instances.values()) {
    const pair = acShortPair(inst)
    if (pair !== null) shorts.push(pair)
  }

  // Standalone CCCS parts: each adds one branch unknown (its 0 V control-current sense).
  const cccs = [...world.instances.values()].filter(
    (i) => i.definition === 'cccs' && i.connects?.length === 4,
  )

  // 2-winding transformers: coupled inductances, stamped via two branch currents (no matrix
  // inversion, so any 0 < k < 1 is fine). M = k·√(L1·L2). The center-tapped variant's tapped
  // winding is a more complex structure, not handled here.
  const transformers: TransformerAcModel[] = []
  for (const inst of world.instances.values()) {
    if (inst.definition !== 'transformer') continue
    const l1 = readScalarParam(inst, 'primary_inductance')
    const l2 = readScalarParam(inst, 'secondary_inductance')
    const k = readScalarParam(inst, 'coupling_coefficient')
    if (l1 === undefined || l2 === undefined || k === undefined) continue
    if (l1 <= 0 || l2 <= 0 || k <= 0 || k >= 1) continue
    const netOf = (t: string) => inst.connects?.find((conn) => conn.terminal === t)?.net
    const pA = netOf('primary_a')
    const pB = netOf('primary_b')
    const sA = netOf('secondary_a')
    const sB = netOf('secondary_b')
    if (pA === undefined || pB === undefined || sA === undefined || sB === undefined) continue
    transformers.push({
      pPlusIdx: idx(pA),
      pMinusIdx: idx(pB),
      sPlusIdx: idx(sA),
      sMinusIdx: idx(sB),
      l1,
      l2,
      m: k * Math.sqrt(l1 * l2),
    })
  }

  // Transistors (BJT + MOSFET/JFET/CRD) are linearized at the DC operating point: solve it once
  // (only when the circuit has any), then build each small-signal model around it.
  const bjts: BjtAcModel[] = []
  const mosfets: MosfetAcModel[] = []
  const diodes: DiodeAcModel[] = []
  const bjtInsts = [...world.instances.values()].filter((i) => BJT_DEFINITIONS.has(i.definition))
  const fetInsts = [...world.instances.values()].filter((i) => FET_DEFINITIONS.has(i.definition))
  const diodeInsts = [...world.instances.values()].filter((i) =>
    DIODE_AC_DEFINITIONS.has(i.definition),
  )
  if (bjtInsts.length > 0 || fetInsts.length > 0 || diodeInsts.length > 0) {
    const dc = solveDCRobust(world, temperaturesC ? { temperaturesC } : undefined)
    if (dc.status === 'solved') {
      const nodeVoltage = (net: string) => (net === ground ? 0 : (dc.nodes.get(net) ?? 0))
      for (const inst of bjtInsts) {
        const ss = bjtSmallSignalModel(inst, nodeVoltage, temperaturesC?.get(inst.id))
        if (ss === null) continue
        bjts.push({
          ...ss,
          bIdx: idx(ss.baseNet),
          cIdx: idx(ss.collectorNet),
          eIdx: idx(ss.emitterNet),
        })
      }
      for (const inst of fetInsts) {
        const ss = mosfetSmallSignalModel(inst, nodeVoltage, temperaturesC?.get(inst.id))
        if (ss === null) continue
        mosfets.push({
          ...ss,
          gIdx: idx(ss.gateNet),
          dIdx: idx(ss.drainNet),
          sIdx: idx(ss.sourceNet),
        })
      }
      for (const inst of diodeInsts) {
        const ss = diodeSmallSignalModel(
          inst,
          nodeVoltage,
          dc.branches.get(inst.id),
          temperaturesC?.get(inst.id),
        )
        if (ss === null) continue
        diodes.push({ ...ss, aIdx: idx(ss.anodeNet), cIdx: idx(ss.cathodeNet) })
      }
    }
  }

  return {
    ground,
    nodeIndex,
    vsources,
    shorts,
    transformers,
    dim: nodeIndex.size + vsources.length + shorts.length + 2 * transformers.length + cccs.length,
    bjts,
    mosfets,
    diodes,
    cccs,
  }
}

/** Solve the linear circuit at angular frequency omega; return the complex node
 *  voltage at `outputNet` with a unit phasor on `inputSource` (all other sources
 *  AC-grounded). */
/**
 * Build + LU-solve the complex MNA system at ω, driving `inputSource` with a unit phasor and AC-grounding
 * every other source. Returns the raw solution vector — node voltages first, then the branch-current
 * unknowns (voltage sources, shorts, transformers, CCCS) — or null if singular. Assumes dim > 0 (callers
 * guard). Both the gain/phase read and the input-impedance read pull what they need out of this one solve.
 */
// biome-ignore lint/suspicious/noExplicitAny: mathjs lusolve return is polymorphic
function solveSystem(world: World, topo: Topology, inputSource: string, omega: number): any {
  const { ground, nodeIndex, vsources, shorts, dim } = topo
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
  // Couple two differential ports (port 1 = a−b, port 2 = c−d) with a mutual admittance —
  // the off-diagonal block of a 2-port Y-matrix (symmetric, Y12 = Y21). Used by the
  // transmission line: a current at one port driven by the voltage at the other.
  const stampCoupling = (a: number, b: number, c: number, d: number, re: number, im: number) => {
    const acc = (i: number, j: number, sign: number) => {
      if (i >= 0 && j >= 0) accumulate(i, j, sign * re, sign * im)
    }
    acc(a, c, 1)
    acc(a, d, -1)
    acc(b, c, -1)
    acc(b, d, 1)
    acc(c, a, 1)
    acc(c, b, -1)
    acc(d, a, -1)
    acc(d, b, 1)
  }

  for (const inst of world.instances.values()) {
    const ports = (inst.connects ?? []).map((conn) => idx(conn.net))
    if (ports.length < 2) continue
    const [a, c] = ports as [number, number]
    if (inst.definition === 'resistor' || inst.definition === 'incandescent_bulb') {
      // A bulb is linear at its operating point — a small AC signal sees the hot
      // filament resistance (the electro-thermal-adjusted `resistance`); the filament
      // can't thermally track the AC, so it's a plain resistor at that value.
      const r = readScalarParam(inst, 'resistance')
      if (r && r > 0) stampY(a, c, 1 / r, 0)
    } else if (inst.definition === 'capacitor') {
      const cap = readScalarParam(inst, 'capacitance')
      if (cap && cap > 0) stampY(a, c, 0, omega * cap)
    } else if (inst.definition === 'inductor' || inst.definition === 'electromagnet') {
      const l = coilInductanceFromInstance(inst)
      if (l && l > 0) stampY(a, c, 0, -1 / (omega * l))
    } else if (inst.definition === 'relay') {
      // The coil is a resistor across coil_a/coil_b (its contact is shorted separately, above).
      const coilR = readScalarParam(inst, 'coil_resistance')
      const ca = inst.connects?.find((conn) => conn.terminal === 'coil_a')?.net
      const cb = inst.connects?.find((conn) => conn.terminal === 'coil_b')?.net
      if (coilR && coilR > 0 && ca !== undefined && cb !== undefined) {
        stampY(idx(ca), idx(cb), 1 / coilR, 0)
      }
    } else if (inst.definition === 'transmission_line') {
      // A general (possibly LOSSY) line from the telegrapher's equations. Its electrical length θ = ω·τ is
      // where the WAVELENGTH appears. Total series impedance Z = R·ℓ + jωL·ℓ = R·ℓ + j·Z0·θ; total shunt
      // admittance Y = G·ℓ + jωC·ℓ = G·ℓ + j·θ/Z0 (using Z0 = √(L/C) and ωL·ℓ = Z0·θ, ωC·ℓ = θ/Z0). The
      // complex propagation γℓ = √(ZY) and characteristic impedance Zc = √(Z/Y) give the 2-port admittances
      //   Y11 = Y22 = coth(γℓ)/Zc,   Y12 = Y21 = −csch(γℓ)/Zc.
      // With R = G = 0 this reduces EXACTLY to the lossless −j·Y0·cot θ / +j·Y0·csc θ (γℓ → jθ, Zc → Z0);
      // adding R (conductor) / G (dielectric) makes the line ATTENUATE — a shorted line's input picks up a
      // real (loss) part and stops reflecting everything. A near-lossless half-wave (sinh γℓ → 0, an
      // infinite-Q resonance) is clamped off zero to avoid a NaN.
      const z0 = readScalarParam(inst, 'characteristic_impedance')
      const length = readScalarParam(inst, 'length')
      const vf = readScalarParam(inst, 'velocity_factor')
      const rPerMeter = readScalarParam(inst, 'series_resistance') ?? 0
      const gPerMeter = readScalarParam(inst, 'shunt_conductance') ?? 0
      // Frequency-dependent loss (increment 4), both default 0 = the constant-loss telegrapher line above.
      const skinOnsetHz = readScalarParam(inst, 'skin_effect_onset_hz') ?? 0
      const lossTangent = readScalarParam(inst, 'loss_tangent') ?? 0
      const netOf = (t: string) => inst.connects?.find((conn) => conn.terminal === t)?.net
      const na = netOf('near_a')
      const nb = netOf('near_b')
      const fa = netOf('far_a')
      const fb = netOf('far_b')
      if (z0 && z0 > 0 && length !== undefined && vf && vf > 0 && na && nb && fa && fb) {
        const theta = omega * propagationDelayS(length, vf)
        // SKIN EFFECT: below the onset f_s the current fills the conductor (R = R_dc); above it, it crowds to
        // the surface and the AC resistance climbs as √f — R(f) = R_dc·√(1 + f/f_s). f_s = 0 keeps R constant.
        const freqHz = omega / (2 * Math.PI)
        const rEff = skinOnsetHz > 0 ? rPerMeter * Math.sqrt(1 + freqHz / skinOnsetHz) : rPerMeter
        // DIELECTRIC LOSS: G = ωC·tanδ. The shunt susceptance ωC·ℓ is exactly θ/z0 (already computed), so the
        // dielectric conductance over the line is tanδ·(θ/z0) — it rises with frequency. tanδ = 0 = lossless.
        const gDielectric = lossTangent * (theta / z0)
        const zSeries: Complex = { re: rEff * length, im: z0 * theta } // R(f)·ℓ + jωL·ℓ
        const yShunt: Complex = { re: gPerMeter * length + gDielectric, im: theta / z0 } // (G + ωC·tanδ) + jωC·ℓ
        const gammaL = cSqrt(cMul(zSeries, yShunt)) // √(ZY)
        const zc = cSqrt(cDiv(zSeries, yShunt)) // √(Z/Y)
        let sinhG = cSinh(gammaL)
        // A near-lossless half-wave (γℓ → jnπ) has sinh → 0 — an infinite-Q resonance; clamp off zero.
        if (Math.hypot(sinhG.re, sinhG.im) < 1e-12) sinhG = { re: 1e-12, im: 1e-12 }
        const y11 = cDiv(cDiv(cCosh(gammaL), sinhG), zc) // coth(γℓ)/Zc
        const y12 = cDiv({ re: -1, im: 0 }, cMul(zc, sinhG)) // −csch(γℓ)/Zc
        stampY(idx(na), idx(nb), y11.re, y11.im)
        stampY(idx(fa), idx(fb), y11.re, y11.im)
        stampCoupling(idx(na), idx(nb), idx(fa), idx(fb), y12.re, y12.im)
      }
    } else if (inst.definition === 'vccs') {
      // A VCCS: output current g·(v_cP − v_cN) — the same real transconductance stamp the
      // MOSFET uses, on its own control pair. g is frequency-independent (im = 0).
      const g = readScalarParam(inst, 'transconductance')
      const net = (term: string) => inst.connects?.find((conn) => conn.terminal === term)?.net
      const oP = net('output_positive')
      const oN = net('output_negative')
      const cP = net('control_positive')
      const cN = net('control_negative')
      if (g !== undefined && oP && oN && cP && cN) {
        const stamp = (i: number, j: number, v: number) => {
          if (i >= 0 && j >= 0) accumulate(i, j, v, 0)
        }
        stamp(idx(oP), idx(cP), -g)
        stamp(idx(oP), idx(cN), g)
        stamp(idx(oN), idx(cP), g)
        stamp(idx(oN), idx(cN), -g)
      }
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

  // 2-winding transformers: two coupled inductors with two branch currents (I1, I2). The branch
  // equations are the impedance relations V1 = jωL1·I1 + jωM·I2, V2 = jωM·I1 + jωL2·I2.
  topo.transformers.forEach((tf, t) => {
    const branchP = nodeIndex.size + vsources.length + shorts.length + 2 * t
    const branchS = branchP + 1
    const { pPlusIdx: pp, pMinusIdx: pm, sPlusIdx: sp, sMinusIdx: sm, l1, l2, m } = tf
    if (pp >= 0) {
      accumulate(pp, branchP, 1, 0)
      accumulate(branchP, pp, 1, 0)
    }
    if (pm >= 0) {
      accumulate(pm, branchP, -1, 0)
      accumulate(branchP, pm, -1, 0)
    }
    if (sp >= 0) {
      accumulate(sp, branchS, 1, 0)
      accumulate(branchS, sp, 1, 0)
    }
    if (sm >= 0) {
      accumulate(sm, branchS, -1, 0)
      accumulate(branchS, sm, -1, 0)
    }
    accumulate(branchP, branchP, 0, -omega * l1)
    accumulate(branchP, branchS, 0, -omega * m)
    accumulate(branchS, branchP, 0, -omega * m)
    accumulate(branchS, branchS, 0, -omega * l2)
  })

  // Standalone CCCS: a 0 V control-current sense (a branch unknown, like a short) measures
  // I_control, and the output sources f·I_control. f is real (frequency-independent), so this
  // is the same structure as the DC stamp, in the complex matrix.
  topo.cccs.forEach((inst, k) => {
    const branch =
      nodeIndex.size + vsources.length + shorts.length + 2 * topo.transformers.length + k
    const net = (term: string) => inst.connects?.find((conn) => conn.terminal === term)?.net
    const cP = net('control_positive')
    const cN = net('control_negative')
    const oP = net('output_positive')
    const oN = net('output_negative')
    const f = readScalarParam(inst, 'current_gain') ?? 0
    const iCP = cP ? idx(cP) : -1
    const iCN = cN ? idx(cN) : -1
    const iOP = oP ? idx(oP) : -1
    const iON = oN ? idx(oN) : -1
    // The 0 V sense pins v_cP = v_cN; its branch current IS I_control.
    if (iCP >= 0) {
      accumulate(iCP, branch, 1, 0)
      accumulate(branch, iCP, 1, 0)
    }
    if (iCN >= 0) {
      accumulate(iCN, branch, -1, 0)
      accumulate(branch, iCN, -1, 0)
    }
    // Output current source f·I_control out of output_positive.
    if (iOP >= 0) accumulate(iOP, branch, -f, 0)
    if (iON >= 0) accumulate(iON, branch, f, 0)
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

  // Diodes: a small-signal conductance + junction capacitance in parallel (g + jωC) at the op point.
  for (const d of topo.diodes) {
    stampY(d.aIdx, d.cIdx, d.g, omega * d.c)
  }

  // gmin: a tiny conductance from every node to ground (see AC_GMIN) so a floating subsection can't
  // make the matrix singular; negligible for any grounded circuit.
  for (let i = 0; i < nodeIndex.size; i++) accumulate(i, i, AC_GMIN, 0)

  try {
    return math.lusolve(M, rhs)
  } catch {
    return null // singular matrix
  }
}

/** Read the complex phasor at solution-vector row `row` (a node voltage or a branch current). mathjs returns
 *  a plain number for a purely-real entry, else a {re,im} Complex. */
// biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix.get is polymorphic
function readComplex(solution: any, row: number): Complex {
  const v = solution.get([row, 0])
  return typeof v === 'number' ? { re: v, im: 0 } : { re: v.re, im: v.im }
}

/** Complex divide a / b for {re,im}. A zero divisor (never reached with AC_GMIN loading every node) → 0. */
function cDiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im
  if (d === 0) return { re: 0, im: 0 }
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}
// The few complex functions the lossy transmission line needs (mathjs's typed returns don't narrow cleanly
// through sqrt/sinh, so these plain {re,im} versions keep the stamp type-clean and self-contained).
const cMul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})
/** Principal complex square root. */
function cSqrt(z: Complex): Complex {
  const r = Math.hypot(z.re, z.im)
  const re = Math.sqrt((r + z.re) / 2)
  const im = Math.sqrt((r - z.re) / 2)
  return { re, im: z.im < 0 ? -im : im }
}
const cSinh = (z: Complex): Complex => ({
  re: Math.sinh(z.re) * Math.cos(z.im),
  im: Math.cosh(z.re) * Math.sin(z.im),
})
const cCosh = (z: Complex): Complex => ({
  re: Math.cosh(z.re) * Math.cos(z.im),
  im: Math.sinh(z.re) * Math.sin(z.im),
})

/** Gain/phase of `outputNet` driven by `inputSource` at ω — reads the output node voltage from the solve. */
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
  // Unknown input source or output net → NaN, not a misleading 0 (a real ground output stays 0).
  if (!vsources.some((vs) => vs.id === inputSource)) return null
  if (idx(outputNet) < 0 && outputNet !== ground) return null
  const solution = solveSystem(world, topo, inputSource, omega)
  if (solution === null) return null
  const outIdx = idx(outputNet)
  if (outIdx < 0) return { re: 0, im: 0 }
  return readComplex(solution, outIdx)
}

/**
 * The complex input impedance looking INTO the port `inputSource` at ω. It is driven with a unit phasor
 * (V = 1∠0); the source's branch-current unknown is the current flowing from its + node INTO the source, so
 * the current into the external network is its negative — hence Zin = V / I_network = 1 / (−I_branch) =
 * −1 / I_branch. (The sign is pinned by the single-resistor test: a port across R gives Zin ≈ R.) Returns
 * null if singular or the source isn't in the circuit. AC_GMIN keeps I_branch off exact zero, so an open
 * port reads a large finite Zin (Γ → +1) rather than dividing by zero.
 */
function portZinAtOmega(
  world: World,
  topo: Topology,
  inputSource: string,
  omega: number,
): Complex | null {
  const { nodeIndex, vsources, dim } = topo
  if (dim === 0) return null
  const k = vsources.findIndex((vs) => vs.id === inputSource)
  if (k < 0) return null
  const solution = solveSystem(world, topo, inputSource, omega)
  if (solution === null) return null
  return cDiv({ re: -1, im: 0 }, readComplex(solution, nodeIndex.size + k))
}

export type AcPoint = { frequencyHz: number; gain: number; gainDb: number; phaseDeg: number }
export type AcOptions = {
  inputSource: string
  outputNet: string
  /** Per-instance junction temperatures (°C) — the op-point + BJT/MOSFET/diode small-signal honor
   *  them; absent → every part at the standard 25 °C. */
  temperaturesC?: Map<string, number>
}
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
  const topo = buildTopology(world, opts.temperaturesC)
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
  const topo = buildTopology(world, opts.temperaturesC)
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

// ---- 1-port reflection (RF): Zin → Γ, return loss, VSWR against a reference impedance Z0 ----

export type ReflectionPoint = {
  frequencyHz: number
  /** Complex input impedance Zin looking into the port (Ω). */
  zinRe: number
  zinIm: number
  /** Complex reflection coefficient Γ = (Zin − Z0)/(Zin + Z0). */
  gammaRe: number
  gammaIm: number
  /** |Γ| — 0 matched, 1 fully reflecting; can exceed 1 for an active (negative-resistance) port. */
  gammaMag: number
  /** Return loss −20·log10|Γ| (dB): +∞ matched, 0 at |Γ|=1, negative for an active port. */
  returnLossDb: number
  /** Voltage standing-wave ratio (1+|Γ|)/(1−|Γ|): 1 matched, +∞ at/above |Γ|=1. */
  vswr: number
}
export type ReflectionOptions = {
  /** The port's driving source (a power_source id) — a unit phasor is applied here to read Zin. */
  inputSource: string
  /** Reference impedance Z0 (Ω) the reflection is measured against; default 50. */
  z0Ohms?: number
  temperaturesC?: Map<string, number>
}
export type ReflectionSweepOptions = ReflectionOptions & {
  fStartHz: number
  fStopHz: number
  pointsPerDecade: number
}

const DEFAULT_Z0_OHMS = 50
const z0Of = (opts: ReflectionOptions): number =>
  opts.z0Ohms && opts.z0Ohms > 0 ? opts.z0Ohms : DEFAULT_Z0_OHMS

/** Turn a complex Zin into Γ / return loss / VSWR against a real Z0. A null Zin (no solve) → all NaN. */
const reflectionPoint = (frequencyHz: number, zin: Complex | null, z0: number): ReflectionPoint => {
  if (zin === null) {
    const nan = Number.NaN
    return {
      frequencyHz,
      zinRe: nan,
      zinIm: nan,
      gammaRe: nan,
      gammaIm: nan,
      gammaMag: nan,
      returnLossDb: nan,
      vswr: nan,
    }
  }
  const gamma = cDiv({ re: zin.re - z0, im: zin.im }, { re: zin.re + z0, im: zin.im })
  const mag = cAbs(gamma.re, gamma.im)
  return {
    frequencyHz,
    zinRe: zin.re,
    zinIm: zin.im,
    gammaRe: gamma.re,
    gammaIm: gamma.im,
    gammaMag: mag,
    returnLossDb: returnLossDbFromGamma(mag),
    vswr: vswrFromGamma(mag),
  }
}

/** The 1-port reflection (Zin, Γ, return loss, VSWR) looking into the port at a single frequency. */
export function portReflection(
  world: World,
  opts: ReflectionOptions,
  frequencyHz: number,
): ReflectionPoint {
  const z0 = z0Of(opts)
  const topo = buildTopology(world, opts.temperaturesC, opts.inputSource)
  if (topo === null) return reflectionPoint(frequencyHz, null, z0)
  const zin = portZinAtOmega(world, topo, opts.inputSource, 2 * Math.PI * frequencyHz)
  return reflectionPoint(frequencyHz, zin, z0)
}

/** A logarithmic reflection sweep — the 1-port RF answer a Bode-style Reflection panel plots. */
export function portReflectionSweep(world: World, opts: ReflectionSweepOptions): ReflectionPoint[] {
  const z0 = z0Of(opts)
  const topo = buildTopology(world, opts.temperaturesC, opts.inputSource)
  if (topo === null) return []
  const decades = Math.log10(opts.fStopHz / opts.fStartHz)
  const steps = Math.max(1, Math.round(decades * opts.pointsPerDecade))
  const points: ReflectionPoint[] = []
  for (let s = 0; s <= steps; s++) {
    const f = opts.fStartHz * 10 ** ((s / steps) * decades)
    const zin = portZinAtOmega(world, topo, opts.inputSource, 2 * Math.PI * f)
    points.push(reflectionPoint(f, zin, z0))
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
