import { bjtCompanion } from './bjt-model.ts'
import type { Instance } from './cross-fk-validator.ts'
import {
  KELVIN_OFFSET,
  type MosfetElement,
  resolveBjt,
  resolveCrd,
  resolveJfet,
  resolveMosfet,
  resolveTunnelDiode,
} from './dc-solver.ts'
import {
  deriveSaturationCurrent,
  thermalVoltage,
  ZENER_BREAKDOWN_IDEALITY,
  zenerCompanionModel,
} from './diode-model.ts'
import { readEnumParam } from './instance-params.ts'
import { mosfetOperatingPoint } from './mosfet-model.ts'
import { tunnelDiodeOperatingPoint } from './tunnel-diode-model.ts'
import { junctionCapacitance } from './varactor-model.ts'

/**
 * BJT small-signal (hybrid-pi) model for AC analysis, linearized at the DC operating
 * point.
 *
 * The CONDUCTANCES come straight from the DC solver's own companion Jacobian
 * (bjtCompanion), so the AC model is exactly consistent with the DC model by
 * construction -- no second, drifting set of formulas. In hybrid-pi terms:
 *   g_m   = dI_C/dV_BE     (transconductance)
 *   g_o   = -dI_C/dV_BC    (output conductance, the Early-effect slope)
 *   1/r_pi = dI_B/dV_BE
 * We keep the four raw partials and stamp the 2-port directly, which also carries
 * the polarity correctly (the PNP sign cancels: the partials are taken in the
 * forward frame, the node voltages are physical, and sign^2 = 1).
 *
 * The CAPACITANCES are the new piece -- the poles that decide stability live here:
 *   C_pi = C_je + g_m * tau_F          (base-emitter: junction + forward-transit diffusion)
 *   C_mu = C_jc / (1 + V_CB/Vj)^m      (base-collector junction, thinning with reverse bias)
 * Cited from a 2N3904-class small-signal transistor: C_je ~ 4.5 pF, C_jc ~ 3.6 pF,
 * tau_F ~ 300 ps; Vj ~ 0.75 V and m ~ 0.33 are the standard silicon junction-grading
 * constants. Omitted capacitance params default to 0 (an ideal, roll-off-free device),
 * so transistor circuits built before this stage are unaffected until caps are declared.
 */

const BC_JUNCTION_POTENTIAL_V = 0.75
const BC_GRADING_COEFFICIENT = 0.33

function readParam(inst: Instance, name: string): number | undefined {
  const params = inst.parameters as Record<string, { value?: { amount?: number } }> | undefined
  const amount = params?.[name]?.value?.amount
  return typeof amount === 'number' ? amount : undefined
}

export type BjtSmallSignal = {
  baseNet: string
  collectorNet: string
  emitterNet: string
  /** Companion Jacobian conductances (the exact DC linearization), in siemens. */
  gmBE: number // dI_C/dV_BE (transconductance g_m)
  gmBC: number // dI_C/dV_BC (its negative is the output conductance g_o)
  gpiBE: number // dI_B/dV_BE (= 1/r_pi)
  gpiBC: number // dI_B/dV_BC (small)
  /** Junction + diffusion capacitances, in farads. */
  cPi: number
  cMu: number
}

/**
 * Resolve a BJT instance to its hybrid-pi small-signal model at the operating point
 * given by `nodeVoltage` (net id -> volts, ground = 0). Returns null for a
 * non-BJT instance or one missing the DC parameters.
 */
export function bjtSmallSignalModel(
  inst: Instance,
  nodeVoltage: (net: string) => number,
  temperatureC?: number,
): BjtSmallSignal | null {
  const bjt = resolveBjt(inst, temperatureC)
  if (bjt === null) return null

  const sign = bjt.polarity === 'pnp' ? -1 : 1
  const vBE = sign * (nodeVoltage(bjt.baseNet) - nodeVoltage(bjt.emitterNet))
  const vBC = sign * (nodeVoltage(bjt.baseNet) - nodeVoltage(bjt.collectorNet))
  const comp = bjtCompanion(vBE, vBC, bjt.params, bjt.thermalV)

  const cje = readParam(inst, 'base_emitter_capacitance') ?? 0
  const cjc = readParam(inst, 'base_collector_capacitance') ?? 0
  const tauF = readParam(inst, 'forward_transit_time') ?? 0
  const reverseBC = Math.max(0, -vBC) // active-region B-C reverse bias (forward frame)

  return {
    baseNet: bjt.baseNet,
    collectorNet: bjt.collectorNet,
    emitterNet: bjt.emitterNet,
    gmBE: comp.dIC_dVBE,
    gmBC: comp.dIC_dVBC,
    gpiBE: comp.dIB_dVBE,
    gpiBC: comp.dIB_dVBC,
    cPi: cje + comp.dIC_dVBE * tauF,
    cMu: cjc / (1 + reverseBC / BC_JUNCTION_POTENTIAL_V) ** BC_GRADING_COEFFICIENT,
  }
}

export type MosfetSmallSignal = {
  gateNet: string
  drainNet: string
  sourceNet: string
  /** dI_D/dV_GS — the transconductance g_m (siemens), at the DC operating point. */
  gm: number
  /** dI_D/dV_DS — the output conductance g_ds (siemens). */
  gds: number
}

function resolveFetLike(inst: Instance, temperatureC?: number): MosfetElement | null {
  if (
    inst.definition === 'transistor_mosfet_nmos' ||
    inst.definition === 'transistor_mosfet_pmos'
  ) {
    return resolveMosfet(inst, temperatureC)
  }
  if (
    inst.definition === 'transistor_jfet_n_channel' ||
    inst.definition === 'transistor_jfet_p_channel'
  ) {
    return resolveJfet(inst, temperatureC)
  }
  if (inst.definition === 'diode_constant_current') return resolveCrd(inst, temperatureC)
  return null
}

/**
 * MOSFET / JFET / constant-current-diode small-signal model for AC, linearized at the DC operating
 * point. g_m and g_ds come straight from the same operating-point Jacobian the DC companion uses
 * (mosfetOperatingPoint), so AC and DC stay consistent by construction. The gate draws no DC current
 * (an ideal insulated gate), so there is no input conductance; gate capacitance is a future addition,
 * like the BJT's. Returns null for a non-FET instance or one missing parameters.
 */
export function mosfetSmallSignalModel(
  inst: Instance,
  nodeVoltage: (net: string) => number,
  temperatureC?: number,
): MosfetSmallSignal | null {
  const fet = resolveFetLike(inst, temperatureC)
  if (fet === null) return null
  const vGS = nodeVoltage(fet.gateNet) - nodeVoltage(fet.sourceNet)
  const vDS = nodeVoltage(fet.drainNet) - nodeVoltage(fet.sourceNet)
  const op = mosfetOperatingPoint(vGS, vDS, fet.params)
  return {
    gateNet: fet.gateNet,
    drainNet: fet.drainNet,
    sourceNet: fet.sourceNet,
    gm: op.gm,
    gds: op.gds,
  }
}

const DEFAULT_DIODE_IDEALITY = 2.0
const DEFAULT_JUNCTION_POTENTIAL_V = 0.7
const DEFAULT_GRADING_COEFFICIENT = 0.5

export type DiodeSmallSignal = {
  anodeNet: string
  cathodeNet: string
  /** Dynamic conductance g = dI/dV at the operating point (siemens) — the forward-diode slope. */
  g: number
  /** Junction capacitance at the operating point (farads); 0 if the part declares none. */
  c: number
}

/**
 * The diode's dynamic small-signal conductance g = dI/dV at the operating point, dispatched by
 * regime: the forward Shockley family + a latched Shockley/SCR are g = I_op/(n·V_T) from the solved
 * branch current; a zener uses its forward/breakdown companion slope; a tunnel diode its N-shaped
 * slope (NEGATIVE in the valley). A blocking latch or a part carrying no current contributes nothing.
 */
function diodeRegimeConductance(
  inst: Instance,
  v: number,
  vT: number,
  branchCurrent: number | undefined,
  n: number,
): number {
  switch (inst.definition) {
    case 'diode_tunnel': {
      const td = resolveTunnelDiode(inst, vT)
      return td !== null ? tunnelDiodeOperatingPoint(v, td.params).conductance : 0
    }
    case 'diode_zener_silicon': {
      const vF = readParam(inst, 'forward_voltage')
      const iF = readParam(inst, 'max_forward_current')
      const vZ = readParam(inst, 'zener_voltage')
      if (vF === undefined || iF === undefined || vZ === undefined) return 0
      const iS = deriveSaturationCurrent(vF, iF, n, vT)
      const bdCurrent = readParam(inst, 'knee_current') ?? 0.005
      return zenerCompanionModel(v, iS, n, vT, vZ, bdCurrent, ZENER_BREAKDOWN_IDEALITY).conductance
    }
    case 'diode_shockley':
    case 'scr':
      // A latch: a forward diode when conducting, an open when blocking.
      return readEnumParam(inst, 'device_state') === 'conducting' && branchCurrent !== undefined
        ? Math.abs(branchCurrent) / (n * vT)
        : 0
    default:
      // Forward Shockley family: g = I_op / (n·V_T) from the solved current.
      return branchCurrent !== undefined ? Math.abs(branchCurrent) / (n * vT) : 0
  }
}

/**
 * Diode small-signal model for AC: a parallel dynamic conductance + junction capacitance at the DC
 * operating point. g (see diodeRegimeConductance) is consistent with the DC solve by construction; C
 * is the voltage-dependent junction capacitance (the varactor's whole purpose, and a real
 * high-frequency pole for any diode that declares it). Returns null if neither can be formed.
 */
export function diodeSmallSignalModel(
  inst: Instance,
  nodeVoltage: (net: string) => number,
  branchCurrent?: number,
  temperatureC?: number,
): DiodeSmallSignal | null {
  const anodeNet = inst.connects?.find((conn) => conn.terminal === 'anode')?.net
  const cathodeNet = inst.connects?.find((conn) => conn.terminal === 'cathode')?.net
  if (anodeNet === undefined || cathodeNet === undefined) return null
  const vT =
    temperatureC !== undefined ? thermalVoltage(temperatureC + KELVIN_OFFSET) : thermalVoltage()
  const v = nodeVoltage(anodeNet) - nodeVoltage(cathodeNet)

  const n = readParam(inst, 'ideality_factor') ?? DEFAULT_DIODE_IDEALITY
  const g = diodeRegimeConductance(inst, v, vT, branchCurrent, n)

  let c = 0
  const cj0 = readParam(inst, 'junction_capacitance_zero_bias')
  if (cj0 !== undefined) {
    const vj = readParam(inst, 'junction_potential') ?? DEFAULT_JUNCTION_POTENTIAL_V
    const m = readParam(inst, 'grading_coefficient') ?? DEFAULT_GRADING_COEFFICIENT
    c = junctionCapacitance(v, cj0, vj, m)
  }

  if (g === 0 && c === 0) return null
  return { anodeNet, cathodeNet, g, c }
}
