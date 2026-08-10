import type { Instance, World } from './cross-fk-validator.ts'
import { solveDCRobust } from './dc-robust.ts'
import { fuseIsIntact, relayCoilEnergized, switchIsClosed } from './dc-solver.ts'
import { coilInductanceFromInstance } from './electromagnet-model.ts'
import { readEnumParam, readScalarParam } from './instance-params.ts'
import { mathInstance as math } from './mathjs-instance.ts'
import { dbFromAmplitudeRatio, returnLossDbFromGamma, vswrFromGamma } from './rf-math.ts'
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
 * exactly in the frequency domain (R -> 1/R, C -> 1/(ESR - j/wC), L -> 1/(R_winding + jwL)) via the same
 * mathjs lusolve the DC solver uses — here over a complex MNA matrix. Wires, intact
 * fuses, closed SPST switches, the SPDT's selected throw, and the relay's live contact
 * stamp as 0 V shorts (matching the DC/transient engines); the relay coil stamps as its
 * resistance. BJT, MOSFET/JFET/CRD, and diode small-signal (forward, zener breakdown,
 * tunnel negative-resistance, latched Shockley/SCR), linearized at the DC operating
 * point (the same companion Jacobian the DC solver uses), are included, as are magnetically
 * coupled parts (V_w = R_w·I_w + jω·Σ L[w][j]·I_j over their windings — two for a transformer,
 * three for a center-tapped one). Transmission lines are stamped from the telegrapher's equations
 * (Y = coth/−csch(γℓ)/Zc, reducing EXACTLY to the lossless ∓j·Y0·cot/csc of the electrical length
 * θ = ω·τ = 2π·length/λ when the line declares no loss) — the frequency-domain view where the
 * WAVELENGTH appears explicitly, so a quarter-wave line flips its load (Z_in = Z0²/Z_L) and
 * half-wave resonances stand out. Verified against the textbook RC/CR first-order responses and
 * the quarter-wave impedance transformer.
 *
 * This engine drives the canvas's Bode panel (bode-panel.tsx — pick an input source + output node,
 * see gain/phase vs frequency). It models every element a circuit can contain: R/C/L, sources, all
 * shorts, BJT / MOSFET / JFET / CRD / diode small-signal (all regimes), the 2-winding transformer,
 * the CENTER-TAPPED transformer (three coupled windings — the two primary halves and the secondary,
 * the same structure the transient solver builds), and the transmission line — all at temperature.
 *
 * PASSIVE LOSS: a capacitor stamps ESR − j/(ωC), a coil R_winding + jωL, and a transformer each winding's
 * copper resistance plus the core-loss resistance across the primary. Loss is only ever taken from a value the
 * part declares; a part that declares none is solved as the ideal element it says it is, and
 * `partsSolvedAsPerfectReactance` names it — PER LOSS, so a transformer that declares its core loss and no
 * copper is still named for the copper — so the resulting too-good numbers (an infinite return loss, a
 * bottomless VSWR dip) are not read as physical.
 *
 * WHICH ENGINES READ WHICH LOSS (they do not all read the same set — do not assume they do):
 *   winding_resistance (coil)        DC ✓   transient ✓   AC ✓
 *   transformer winding + core R     DC ✓   transient ✓   AC ✓
 *   transmission-line R / G          DC ✗   transient ✗   AC ✓
 *   capacitor esr / dissipation_factor   DC ✗   transient ✗   AC ✓  ← AC ONLY
 * So a capacitor declaring an ESR is lossy on the Bode / reflection / S-parameter plots and still LOSSLESS in
 * the time domain: its transient ripple and its scope trace show no ESR bump. That is a real gap, not a
 * rounding difference, and it is why the shipped electrolytic's cited tan δ moves the AC curves alone.
 */

export type Complex = { re: number; im: number }

const cAbs = (re: number, im: number): number => Math.hypot(re, im)
const cArgDeg = (re: number, im: number): number => (Math.atan2(im, re) * 180) / Math.PI

/**
 * A tiny node-to-ground conductance (S) added to every node so a floating subsection (e.g. an
 * ungrounded transformer secondary) gives a finite result instead of a singular matrix. ~1 GΩ —
 * negligible beside any real circuit impedance.
 *
 * WHERE THIS MODEL STOPS BEING TRUSTWORTHY. gmin sits in PARALLEL with the element, so a series
 * impedance R + jX reads back as Re(Zin) ≈ R + AC_GMIN·X² (exact when |X| ≫ R). The declared
 * resistance is therefore only recovered while
 *
 *     AC_GMIN·X² ≪ R      i.e.   |X| ≪ √(R / AC_GMIN)
 *
 * On the SHIPPED 10 mH / 32 Ω choke that ceiling is |X| ≪ 179 kΩ, so f ≪ 2.8 MHz: the engine reports
 * Re = 32.0000 Ω at 1 kHz and 32.04 Ω at 100 kHz (right), but 426.8 Ω at 10 MHz and 39,509 Ω at
 * 100 MHz (measured) — and those two are the gmin floor being read back, NOT copper. Above the
 * ceiling the REACTANCE is still correct; only the loss (and everything derived from it: Q, return
 * loss, |S21|) is inflated. `acGminFloorOhms` computes the error term so a test can pin it.
 */
const AC_GMIN = 1e-9

/**
 * The apparent series resistance the AC_GMIN floor ADDS to a series impedance whose reactance is `reactanceOhms`
 * — the AC_GMIN·X² term above. Exported so the honesty limit is a computable number, not a claim in a comment.
 */
export const acGminFloorOhms = (reactanceOhms: number): number => AC_GMIN * reactanceOhms ** 2

type BjtAcModel = BjtSmallSignal & { bIdx: number; cIdx: number; eIdx: number }
type MosfetAcModel = MosfetSmallSignal & { gIdx: number; dIdx: number; sIdx: number }
type DiodeAcModel = DiodeSmallSignal & { aIdx: number; cIdx: number }

/** One winding of a magnetically coupled part: the node pair it spans and its own copper resistance (Ω;
 *  0 = not declared, an ideal winding). */
type AcWinding = { plusIdx: number; minusIdx: number; resistance: number }
/**
 * A magnetically coupled part solved through one branch current per winding: the plain 2-winding transformer
 * (primary, secondary) and the center-tapped one (primary half A, primary half B, secondary). `inductance` is
 * the full symmetric matrix — [w][w] is winding w's own L, [w][j] the mutual to winding j — so the branch
 * equation for winding w is V_w = R_w·I_w + jω·Σ_j L[w][j]·I_j, whatever the winding count.
 */
type CoupledAcModel = {
  windings: AcWinding[]
  inductance: number[][]
  /** Core loss as the classic resistance ACROSS the full primary (0 = not declared) — the same node pair the
   *  transient engine puts it across, so it stamps as a plain conductance, not into a branch equation. */
  coreResistance: number
  corePlusIdx: number
  coreMinusIdx: number
  /** Row/column of this part's FIRST winding-current unknown in the MNA system. */
  branchBase: number
}

type Topology = {
  ground: string
  nodeIndex: Map<string, number>
  vsources: Instance[]
  /** 2-terminal 0 V shorts (wires, intact fuses, closed SPST switches): a branch unknown each. */
  shorts: { aNet: string; bNet: string }[]
  /** Magnetically coupled parts (transformers, center-tapped transformers): one branch unknown per winding. */
  coupled: CoupledAcModel[]
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

/** A coupled part described in NETS (not node indices), so the same builder serves the MNA topology and the
 *  "what did the AC solve drop, and why" report. */
type CoupledSpec = {
  windings: { plusNet: string; minusNet: string; resistance: number }[]
  inductance: number[][]
  coreResistance: number
  corePlusNet: string
  coreMinusNet: string
}
/** Definitions this engine solves as magnetically coupled windings. */
const COUPLED_DEFINITIONS = new Set(['transformer', 'transformer_center_tapped'])

/**
 * Turn a transformer / center-tapped transformer instance into its coupled-winding description, or say why it
 * cannot be solved. Returns null for any other part.
 *
 * The center-tapped build matches the transient solver's exactly (transient-solver.ts): each primary HALF has a
 * quarter of the end-to-end inductance (half the turns, L ∝ N²) and half the end-to-end DCR, the halves couple
 * to each other through the core (k·L_half) and to the secondary (k·√(L_half·L2)).
 *
 * k = 1 IS ACCEPTED. It is what a user types for "an ideal transformer", and dropping the part for it used to
 * take its cited winding and core resistances out of the circuit silently. Nothing here inverts the inductance
 * matrix — the windings are solved through branch currents — so a perfectly-coupled part stamps like any other.
 * k > 1 is refused: M > √(L1·L2) means the coupled energy exceeds the stored energy, which no core can do.
 * One k = 1 topology stays genuinely unsolvable — a perfectly-coupled part with NO winding resistance and a
 * SHORTED secondary is a dead short at its primary, so an ideal source across it has no solution and the solve
 * returns NaN. That is the same refusal any singular circuit gets, not a number to be trusted.
 */
function coupledSpec(inst: Instance): { spec: CoupledSpec } | { dropped: string } | null {
  if (!COUPLED_DEFINITIONS.has(inst.definition)) return null
  const centerTapped = inst.definition === 'transformer_center_tapped'
  const l1 = readScalarParam(inst, 'primary_inductance')
  const l2 = readScalarParam(inst, 'secondary_inductance')
  const k = readScalarParam(inst, 'coupling_coefficient')
  if (l1 === undefined || l2 === undefined || k === undefined) {
    return { dropped: 'it declares no primary/secondary inductance or coupling coefficient' }
  }
  if (!(l1 > 0) || !(l2 > 0)) return { dropped: 'its winding inductances must both be above zero' }
  if (!(k > 0)) return { dropped: `its coupling coefficient ${k} must be above zero` }
  if (k > 1) {
    return {
      dropped: `its coupling coefficient ${k} exceeds 1 (no core can couple more than it stores)`,
    }
  }
  const netOf = (terminal: string) => inst.connects?.find((conn) => conn.terminal === terminal)?.net
  const primaryA = netOf('primary_a')
  const primaryB = netOf('primary_b')
  const secondaryA = netOf('secondary_a')
  const secondaryB = netOf('secondary_b')
  // A plain transformer has no center tap, so it stands in as wired — only the center-tapped part is
  // refused for an unwired one, and its two primary halves cannot be told apart without it.
  const centerTap = centerTapped ? netOf('primary_ct') : 'not-needed'
  if (
    primaryA === undefined ||
    primaryB === undefined ||
    secondaryA === undefined ||
    secondaryB === undefined ||
    centerTap === undefined
  ) {
    return { dropped: 'one of its winding terminals is not wired' }
  }
  const primaryResistance = readScalarParam(inst, 'primary_resistance') ?? 0
  const secondaryResistance = readScalarParam(inst, 'secondary_resistance') ?? 0
  const core = {
    coreResistance: readScalarParam(inst, 'core_loss_resistance') ?? 0,
    corePlusNet: primaryA,
    coreMinusNet: primaryB,
  }
  if (!centerTapped) {
    const mutual = k * Math.sqrt(l1 * l2)
    return {
      spec: {
        windings: [
          { plusNet: primaryA, minusNet: primaryB, resistance: primaryResistance },
          { plusNet: secondaryA, minusNet: secondaryB, resistance: secondaryResistance },
        ],
        inductance: [
          [l1, mutual],
          [mutual, l2],
        ],
        ...core,
      },
    }
  }
  const halfInductance = l1 / 4
  const halfResistance = primaryResistance / 2
  const halfToHalf = k * halfInductance
  const halfToSecondary = k * Math.sqrt(halfInductance * l2)
  return {
    spec: {
      windings: [
        { plusNet: primaryA, minusNet: centerTap, resistance: halfResistance },
        { plusNet: centerTap, minusNet: primaryB, resistance: halfResistance },
        { plusNet: secondaryA, minusNet: secondaryB, resistance: secondaryResistance },
      ],
      inductance: [
        [halfInductance, halfToHalf, halfToSecondary],
        [halfToHalf, halfInductance, halfToSecondary],
        [halfToSecondary, halfToSecondary, l2],
      ],
      ...core,
    },
  }
}

export type DroppedAcPart = { id: string; definition: string; reason: string }

/**
 * Every part the AC solve leaves OUT of the circuit, with the reason. A dropped part is not an approximation —
 * it is simply absent, so its impedance and every loss it declares vanish from the answer. The panels say so
 * rather than letting a plausible-looking number stand for a circuit missing one of its parts.
 */
export function partsDroppedFromAcSolve(world: World): DroppedAcPart[] {
  const dropped: DroppedAcPart[] = []
  for (const inst of world.instances.values()) {
    const built = coupledSpec(inst)
    if (built !== null && 'dropped' in built) {
      dropped.push({ id: inst.id, definition: inst.definition, reason: built.dropped })
    }
  }
  return dropped
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

  // Magnetically coupled parts (2-winding + center-tapped transformers): one branch current per winding, so
  // nothing inverts the inductance matrix and any 0 < k ≤ 1 is fine. Their branch rows start after the
  // voltage-source and short rows, one row per winding, in the order the parts are visited.
  const coupled: CoupledAcModel[] = []
  let windingBranch = nodeIndex.size + vsources.length + shorts.length
  for (const inst of world.instances.values()) {
    const built = coupledSpec(inst)
    if (built === null || 'dropped' in built) continue
    const { spec } = built
    coupled.push({
      windings: spec.windings.map((w) => ({
        plusIdx: idx(w.plusNet),
        minusIdx: idx(w.minusNet),
        resistance: w.resistance,
      })),
      inductance: spec.inductance,
      coreResistance: spec.coreResistance,
      corePlusIdx: idx(spec.corePlusNet),
      coreMinusIdx: idx(spec.coreMinusNet),
      branchBase: windingBranch,
    })
    windingBranch += spec.windings.length
  }
  const windingCount = coupled.reduce((total, c) => total + c.windings.length, 0)

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
    coupled,
    dim: nodeIndex.size + vsources.length + shorts.length + windingCount + cccs.length,
    bjts,
    mosfets,
    diodes,
    cccs,
  }
}

/**
 * A capacitor's series loss resistance (Ω) at ω, from what the part DECLARES and nothing else — either `esr`
 * (how an electrolytic is specified) or a `dissipation_factor` tanδ (how a ceramic / film part is specified),
 * which is the same loss as a ratio: tanδ = ESR·ωC, so ESR = tanδ/(ωC) and the loss RESISTANCE falls with
 * frequency while the loss ANGLE stays put. `esr` wins if both are declared. A part declaring NEITHER returns
 * 0 — it is solved as the ideal capacitor it was declared to be; no plausible-looking ESR is substituted.
 *
 * A NEGATIVE declared loss returns 0 too, and does not fall through to the other spelling. As a resistance it
 * would SOURCE power, making a passive capacitor reflect more than it received. The stamp refuses a negative
 * as well, so this is the outer of two guards; exported so that outer guard can be tested on its own.
 */
export function capacitorEsrOhms(inst: Instance, omega: number, capacitanceFarads: number): number {
  const esr = readScalarParam(inst, 'esr')
  if (esr !== undefined && esr > 0) return esr
  const dissipationFactor = readScalarParam(inst, 'dissipation_factor')
  if (dissipationFactor !== undefined && dissipationFactor > 0) {
    return dissipationFactor / (omega * capacitanceFarads)
  }
  return 0
}

/** Stamp a series impedance Z = r + jx as its admittance 1/Z. Only for r > 0 — the lossless r = 0 case keeps
 *  its own closed-form stamp so a part with no declared loss solves bit-for-bit as it did before loss existed. */
function stampSeriesImpedance(
  stampY: (a: number, c: number, re: number, im: number) => void,
  a: number,
  c: number,
  r: number,
  x: number,
): void {
  const y = cDiv({ re: 1, im: 0 }, { re: r, im: x })
  stampY(a, c, y.re, y.im)
}

/**
 * The SEPARATE losses each family can declare, and for each the parameter(s) any ONE of which carries it, in
 * the order this engine reads them. A family's losses are independent: a transformer's primary copper, its
 * secondary copper and its iron are three different losses in three different places, so declaring one says
 * nothing about the other two. Only ALTERNATIVE spellings of the SAME loss share a slot — a capacitor's `esr`
 * and its `dissipation_factor` are one loss written two ways (tanδ = ESR·ωC), which is why they sit together.
 *
 * A transmission line's `skin_effect_onset_hz` is deliberately NOT a slot: it only shapes how the declared
 * series_resistance rises with frequency, so on its own it carries no loss at all.
 */
const AC_LOSS_SLOTS: Record<string, string[][]> = {
  capacitor: [['esr', 'dissipation_factor']],
  inductor: [['winding_resistance']],
  electromagnet: [['winding_resistance']],
  transformer: [['primary_resistance'], ['secondary_resistance'], ['core_loss_resistance']],
  transformer_center_tapped: [
    ['primary_resistance'],
    ['secondary_resistance'],
    ['core_loss_resistance'],
  ],
  transmission_line: [['series_resistance'], ['shunt_conductance', 'loss_tangent']],
}

/** Every parameter a definition can carry AC loss through, in reading order — one list, so the properties
 *  panel offers exactly the parameters this engine reads and cannot drift from them. */
export function acLossParameters(definition: string): string[] {
  return (
    (Object.hasOwn(AC_LOSS_SLOTS, definition) ? AC_LOSS_SLOTS[definition] : undefined)?.flat() ?? []
  )
}

export type AcLossSlot = {
  /** Any ONE of these declared above zero carries this loss; the engine reads them in this order. */
  parameters: string[]
  /** Those of them the part DOES carry — all declaring zero (empty when it declares none of them). */
  declaredZero: string[]
}
export type PerfectReactancePart = {
  id: string
  definition: string
  /** Only the losses this part carries NOTHING for; a loss it does declare is not listed. */
  slots: AcLossSlot[]
}
export type UndeclaredAcLossPart = {
  id: string
  definition: string
  /** The parameter(s) that would carry a loss this part declares NONE of. */
  lossParameters: string[]
}

/**
 * Every part with at least one loss the engine will solve as PERFECT — reported per LOSS, not per part. A
 * transformer declaring only its core loss is still listed here for its two windings, which are still being
 * solved as zero-resistance copper; the old per-part test let one declared parameter silence a part's other
 * losses entirely.
 *
 * Two ways a loss comes out perfect, kept apart because they mean different things:
 *   • the parameter is ABSENT — nothing was ever said about this loss (`declaredZero` empty);
 *   • the parameter is present and ZERO — something was said, and it said "ideal". Whether that zero is the
 *     user's choice or just the value the part shipped with is NOT knowable here (an instance carries no record
 *     of who set it), so this engine only reports the fact and the caller, which knows the shipped defaults,
 *     decides how to word it.
 */
export function partsSolvedAsPerfectReactance(world: World): PerfectReactancePart[] {
  const parts: PerfectReactancePart[] = []
  for (const inst of world.instances.values()) {
    const slots = AC_LOSS_SLOTS[inst.definition]
    if (slots === undefined) continue
    const perfect: AcLossSlot[] = []
    for (const parameters of slots) {
      const declared = parameters
        .map((name) => ({ name, amount: readScalarParam(inst, name) }))
        .filter((p) => p.amount !== undefined)
      if (declared.some((p) => (p.amount ?? 0) > 0)) continue
      perfect.push({ parameters, declaredZero: declared.map((p) => p.name) })
    }
    if (perfect.length > 0) parts.push({ id: inst.id, definition: inst.definition, slots: perfect })
  }
  return parts
}

/**
 * The subset of the above whose loss parameters are ABSENT altogether — a part that says nothing at all about
 * one of its losses, so the engine has nothing to read and solves it as the ideal element it was declared to
 * be. A loss declared as an explicit 0 is excluded here; it is reported by partsSolvedAsPerfectReactance,
 * where the caller can weigh the zero against what the part shipped with.
 */
export function partsWithNoDeclaredAcLoss(world: World): UndeclaredAcLossPart[] {
  const parts: UndeclaredAcLossPart[] = []
  for (const part of partsSolvedAsPerfectReactance(world)) {
    const lossParameters = part.slots
      .filter((slot) => slot.declaredZero.length === 0)
      .flatMap((slot) => slot.parameters)
    if (lossParameters.length === 0) continue
    parts.push({ id: part.id, definition: part.definition, lossParameters })
  }
  return parts
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
      // A real capacitor is its reactance IN SERIES with its loss: Z = ESR − j/(ωC). The loss comes only
      // from what the part declares (esr, or a dissipation_factor); a part declaring neither stays exactly
      // lossless — no ESR is invented for it (partsWithNoDeclaredAcLoss names those parts to the user).
      const cap = readScalarParam(inst, 'capacitance')
      if (cap && cap > 0) {
        const esr = omega > 0 ? capacitorEsrOhms(inst, omega, cap) : 0
        if (esr > 0) stampSeriesImpedance(stampY, a, c, esr, -1 / (omega * cap))
        else stampY(a, c, 0, omega * cap)
      }
    } else if (inst.definition === 'inductor' || inst.definition === 'electromagnet') {
      // A real coil is a length of wire: Z = R_winding + jωL. The DC and transient engines have always read
      // winding_resistance; so does this one now. Absent / zero winding_resistance = an ideal lossless coil.
      const l = coilInductanceFromInstance(inst)
      const windingResistance = readScalarParam(inst, 'winding_resistance') ?? 0
      if (l && l > 0) {
        if (windingResistance > 0) stampSeriesImpedance(stampY, a, c, windingResistance, omega * l)
        else stampY(a, c, 0, -1 / (omega * l))
      } else if (windingResistance > 0) {
        // No inductance (0, or a geometry that derives none) but real copper declared. The DC solver already
        // reads that resistance; leaving it unstamped here made the part an OPEN at AC, so a declared loss
        // disappeared along with the whole part. A coil with no inductance IS its winding resistance.
        stampY(a, c, 1 / windingResistance, 0)
      }
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
      // infinite-Q resonance) is clamped off zero to avoid a NaN — and that clamp is a NUMERICAL rescue, not
      // a physical loss: the resonance height it produces is set by the 1e-12 floor, not by the cable. The
      // shipped line declares R = G = tanδ = 0, so it is exactly that lossless case, and
      // partsSolvedAsPerfectReactance names it for the panels.
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

  // Magnetically coupled parts: one branch current per winding, each row the impedance relation
  //   V_w = R_w·I_w + jω·Σ_j L[w][j]·I_j
  // — the winding copper resistances the DC and transient engines read, in the same place. A 2-winding
  // transformer is the familiar pair (V1 = (R1+jωL1)I1 + jωM·I2, V2 = jωM·I1 + (R2+jωL2)I2); a center-tapped
  // one is the same relation over three windings. Core loss is the classic resistance ACROSS the full primary
  // (the node pair the transient engine puts it across), so it stamps as a plain conductance, not a branch row.
  for (const part of topo.coupled) {
    part.windings.forEach((winding, w) => {
      const branch = part.branchBase + w
      if (winding.plusIdx >= 0) {
        accumulate(winding.plusIdx, branch, 1, 0)
        accumulate(branch, winding.plusIdx, 1, 0)
      }
      if (winding.minusIdx >= 0) {
        accumulate(winding.minusIdx, branch, -1, 0)
        accumulate(branch, winding.minusIdx, -1, 0)
      }
      accumulate(branch, branch, -winding.resistance, 0)
      part.windings.forEach((_, j) => {
        accumulate(branch, part.branchBase + j, 0, -omega * (part.inductance[w]?.[j] ?? 0))
      })
    })
    if (part.coreResistance > 0) {
      stampY(part.corePlusIdx, part.coreMinusIdx, 1 / part.coreResistance, 0)
    }
  }

  // Standalone CCCS: a 0 V control-current sense (a branch unknown, like a short) measures
  // I_control, and the output sources f·I_control. f is real (frequency-independent), so this
  // is the same structure as the DC stamp, in the complex matrix.
  const windingRows = topo.coupled.reduce((total, part) => total + part.windings.length, 0)
  topo.cccs.forEach((inst, k) => {
    const branch = nodeIndex.size + vsources.length + shorts.length + windingRows + k
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

// ---- 2-port S-parameters (RF): the scattering matrix S11/S21/S12/S22 against Z0 ----

export type SParamPoint = {
  frequencyHz: number
  /** The complex scattering parameters (linear). S11/S22 = input/output reflection with the far port matched;
   *  S21/S12 = forward/reverse transmission — S21 IS the honest small-signal "gain" (a ratio of Z0-referenced
   *  travelling waves), which for a passive network is ≤ 1. */
  s11: Complex
  s21: Complex
  s12: Complex
  s22: Complex
  /** Magnitudes in dB (20·log10|S|): |S21| in dB is insertion gain/loss, |S11| in dB is −return loss. */
  s11Db: number
  s21Db: number
  s12Db: number
  s22Db: number
  /** Phases (degrees). |S21|'s phase slope vs frequency is the group delay. */
  s11Deg: number
  s21Deg: number
  s12Deg: number
  s22Deg: number
}
export type SParamOptions = {
  /** The two measurement ports (reference_port / source instance ids). */
  port1: string
  port2: string
  /** Reference impedance Z0 (Ω) the waves are defined against; default 50. */
  z0Ohms?: number
  temperaturesC?: Map<string, number>
}
export type SParamSweepOptions = SParamOptions & {
  fStartHz: number
  fStopHz: number
  pointsPerDecade: number
}

const scalarParam = (amount: number, unit: string) => ({
  value: { kind: 'scalar' as const, amount, unit },
})
/** The two nets a 2-terminal port instance touches (+ / −), or null if it isn't wired on both. */
function portNets(inst: Instance | undefined): { pNet: string; nNet: string } | null {
  if (inst === undefined) return null
  const p = inst.connects?.find((c) => c.terminal === 'terminal_positive')?.net
  const n = inst.connects?.find((c) => c.terminal === 'terminal_negative')?.net
  return p !== undefined && n !== undefined ? { pNet: p, nNet: n } : null
}

/** A prebuilt S-parameter column: the modified circuit (its ports replaced by a Z0 generator + termination)
 *  and its MNA topology, plus the nets to read. Frequency-INDEPENDENT, so a sweep builds it once and solves it
 *  at each ω — the same shape as portReflectionSweep. */
type SParamColumn = {
  modWorld: World
  topo: Topology
  genId: string
  drive: { pNet: string; nNet: string }
  term: { pNet: string; nNet: string }
}

/**
 * Build one column of the scattering measurement: DRIVE `driveId` with a Z0-referenced generator (a unit-phasor
 * source in series with Z0) and TERMINATE `termId` in Z0, replacing both ports with collision-free synthetic
 * parts so a reference_port (open) or a source used as a port never fights the measurement. Returns the modified
 * world + its topology (built ONCE), to be solved per-ω by readSParamColumn. Null if the ports aren't a valid
 * 2-terminal pair (same port both ends, or unwired) or the modified circuit has no ground.
 */
function buildSParamColumn(
  world: World,
  driveId: string,
  termId: string,
  z0: number,
  temperaturesC?: Map<string, number>,
): SParamColumn | null {
  const drive = portNets(world.instances.get(driveId))
  const term = portNets(world.instances.get(termId))
  if (drive === null || term === null || driveId === termId) return null

  const instances = new Map(world.instances)
  instances.delete(driveId)
  instances.delete(termId)
  const nets = new Map(world.nets)
  // Collision-free synthetic names: a hand-crafted or imported DUT could (however unlikely) already carry a
  // `__sparam_*` id/net, and Map.set would silently overwrite the real part — a wrong answer, not an error.
  const freeInstId = (base: string) => {
    if (!instances.has(base)) return base
    let n = 1
    while (instances.has(`${base}_${n}`)) n++
    return `${base}_${n}`
  }
  let genHot = `__sparam_gen_hot__${driveId}`
  for (let n = 1; nets.has(genHot); n++) genHot = `__sparam_gen_hot__${driveId}_${n}`
  const genId = freeInstId('__sparam_gen__')
  const rgenId = freeInstId('__sparam_rgen__')
  const rtermId = freeInstId('__sparam_rterm__')
  const conn = (net: string, terminal: string, of: string) => ({ net, terminal, of })
  instances.set(genId, {
    id: genId,
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalarParam(0, 'volt') },
    connects: [
      conn(genHot, 'terminal_positive', genId),
      conn(drive.nNet, 'terminal_negative', genId),
    ],
  })
  instances.set(rgenId, {
    id: rgenId,
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalarParam(z0, 'ohm') },
    connects: [conn(genHot, 'terminal_a', rgenId), conn(drive.pNet, 'terminal_b', rgenId)],
  })
  instances.set(rtermId, {
    id: rtermId,
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalarParam(z0, 'ohm') },
    connects: [conn(term.pNet, 'terminal_a', rtermId), conn(term.nNet, 'terminal_b', rtermId)],
  })
  nets.set(genHot, { id: genHot, kind: 'net', members: [] })
  const modWorld: World = { ...world, instances, nets }

  const topo = buildTopology(modWorld, temperaturesC)
  if (topo === null) return null
  return { modWorld, topo, genId, drive, term }
}

/**
 * Solve a prebuilt column at ω and read the two port voltages back. Because the generator's open-circuit voltage
 * is 1, the reflected wave at the driven port is Sdd = 2·Vd − 1 and the transmitted wave at the far port is
 * Sod = 2·Vo (standard travelling-wave algebra: a_drive = Vs/(2√Z0) = 1/(2√Z0), and with the far port matched
 * b_term = Vo/√Z0, b_drive = (Vd − Z0·I)/(2√Z0) = Vd/√Z0 − a_drive; the √Z0 normalization cancels). Null if
 * singular.
 */
function readSParamColumn(
  col: SParamColumn,
  omega: number,
): { reflect: Complex; thru: Complex } | null {
  const solution = solveSystem(col.modWorld, col.topo, col.genId, omega)
  if (solution === null) return null
  const vAt = (net: string): Complex => {
    const i = net === col.topo.ground ? -1 : (col.topo.nodeIndex.get(net) ?? -1)
    return i < 0 ? { re: 0, im: 0 } : readComplex(solution, i)
  }
  const across = (pNet: string, nNet: string): Complex => {
    const p = vAt(pNet)
    const n = vAt(nNet)
    return { re: p.re - n.re, im: p.im - n.im }
  }
  const vd = across(col.drive.pNet, col.drive.nNet)
  const vo = across(col.term.pNet, col.term.nNet)
  return { reflect: { re: 2 * vd.re - 1, im: 2 * vd.im }, thru: { re: 2 * vo.re, im: 2 * vo.im } }
}

const NAN_C: Complex = { re: Number.NaN, im: Number.NaN }
const sParamPoint = (
  frequencyHz: number,
  s: { s11: Complex; s21: Complex; s12: Complex; s22: Complex } | null,
): SParamPoint => {
  const p = s ?? { s11: NAN_C, s21: NAN_C, s12: NAN_C, s22: NAN_C }
  const db = (c: Complex) => dbFromAmplitudeRatio(cAbs(c.re, c.im))
  const deg = (c: Complex) => cArgDeg(c.re, c.im)
  return {
    frequencyHz,
    s11: p.s11,
    s21: p.s21,
    s12: p.s12,
    s22: p.s22,
    s11Db: db(p.s11),
    s21Db: db(p.s21),
    s12Db: db(p.s12),
    s22Db: db(p.s22),
    s11Deg: deg(p.s11),
    s21Deg: deg(p.s21),
    s12Deg: deg(p.s12),
    s22Deg: deg(p.s22),
  }
}

/** Read the forward + reverse columns at ω and assemble the full scattering matrix (null if either is
 *  unbuildable or singular). The columns are prebuilt once by the callers, so a sweep reuses them. */
const combineColumns = (
  fwd: SParamColumn | null,
  rev: SParamColumn | null,
  omega: number,
): { s11: Complex; s21: Complex; s12: Complex; s22: Complex } | null => {
  if (fwd === null || rev === null) return null
  const f = readSParamColumn(fwd, omega)
  const r = readSParamColumn(rev, omega)
  if (f === null || r === null) return null
  return { s11: f.reflect, s21: f.thru, s22: r.reflect, s12: r.thru }
}

const sParamZ0 = (opts: SParamOptions) =>
  opts.z0Ohms && opts.z0Ohms > 0 ? opts.z0Ohms : DEFAULT_Z0_OHMS

/** The full 2-port scattering matrix (S11/S21/S12/S22) at a single frequency. */
export function portSParameters(
  world: World,
  opts: SParamOptions,
  frequencyHz: number,
): SParamPoint {
  const z0 = sParamZ0(opts)
  const fwd = buildSParamColumn(world, opts.port1, opts.port2, z0, opts.temperaturesC)
  const rev = buildSParamColumn(world, opts.port2, opts.port1, z0, opts.temperaturesC)
  return sParamPoint(frequencyHz, combineColumns(fwd, rev, 2 * Math.PI * frequencyHz))
}

/** A logarithmic S-parameter sweep — an S21/S11 vs frequency plot's worth of points. The two columns' modified
 *  worlds + topologies are built ONCE, then only the linear solve re-runs per frequency. */
export function portSParameterSweep(world: World, opts: SParamSweepOptions): SParamPoint[] {
  const z0 = sParamZ0(opts)
  const fwd = buildSParamColumn(world, opts.port1, opts.port2, z0, opts.temperaturesC)
  const rev = buildSParamColumn(world, opts.port2, opts.port1, z0, opts.temperaturesC)
  const decades = Math.log10(opts.fStopHz / opts.fStartHz)
  const steps = Math.max(1, Math.round(decades * opts.pointsPerDecade))
  const points: SParamPoint[] = []
  for (let s = 0; s <= steps; s++) {
    const f = opts.fStartHz * 10 ** ((s / steps) * decades)
    points.push(sParamPoint(f, combineColumns(fwd, rev, 2 * Math.PI * f)))
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
