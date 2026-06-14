import { bjtCompanion } from './bjt-model.ts'
import type { Instance } from './cross-fk-validator.ts'
import { resolveBjt } from './dc-solver.ts'

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
): BjtSmallSignal | null {
  const bjt = resolveBjt(inst)
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
