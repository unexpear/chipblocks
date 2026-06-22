/**
 * Shockley 4-layer (PNPN) diode — a latching, bistable switch (a thyristor without a gate).
 *
 * Forward bias: it BLOCKS until the breakover voltage V_BO, then snaps ON (regenerative turn-on) to
 * a low-voltage conducting state and LATCHES — it keeps conducting until the current falls below the
 * holding current I_H, then switches off. Because the on/off choice depends on HISTORY (a true
 * bistable latch), it is modeled as device STATE, exactly like the fuse's blown state and the
 * relay's contact state: the DC solver treats a 'conducting' diode as an ordinary forward diode and
 * a 'blocking' one as an open circuit, and the discrete-state fixed point (solveWithRelays) flips
 * the state at breakover / holding-current dropout off the solved voltage and current, settling to a
 * self-consistent latch. App persists the settled state onto the node — the latch's memory.
 *
 * Transient (time-domain) operation IS modeled (transient-solver.ts): the latch state marches across
 * time steps, so an RC around the diode becomes a relaxation oscillator and the SCR a gated rectifier.
 * Reverse breakdown (avalanche in the blocking state) is not modeled — an unusual region for a latch.
 *
 * Sources: Sze & Ng, Physics of Semiconductor Devices, 3rd ed., §11 (thyristors / the PNPN diode,
 * breakover and holding current); Horowitz & Hill, The Art of Electronics, 3rd ed. (latching).
 */

import type { Instance, World } from './cross-fk-validator.ts'
import type { Solution } from './dc-solver.ts'
import { readEnumParam, readScalarParam } from './instance-params.ts'

export type ShockleyDiodeState = 'blocking' | 'conducting'

/**
 * The latch's next state given the solved voltage across (anode − cathode) and current through: a
 * blocking diode turns ON at/above breakover; a conducting diode turns OFF below the holding
 * current. Otherwise it stays put — the bistable memory.
 */
export function shockleyDiodeTarget(
  state: ShockleyDiodeState,
  voltageAcross: number,
  current: number,
  breakoverVoltage: number,
  holdingCurrent: number,
): ShockleyDiodeState {
  if (state === 'conducting') return Math.abs(current) < holdingCurrent ? 'blocking' : 'conducting'
  return voltageAcross >= breakoverVoltage ? 'conducting' : 'blocking'
}

/**
 * The SCR's next latch state — the Shockley latch PLUS a gate trigger: a blocking SCR also fires when
 * the gate current reaches the gate trigger current I_GT (the point of the gate), not only at
 * breakover. Turn-OFF is unchanged: only the anode current falling below the holding current switches
 * it off — an SCR's gate cannot turn it off.
 */
export function scrTarget(
  state: ShockleyDiodeState,
  voltageAcross: number,
  anodeCurrent: number,
  gateCurrent: number,
  breakoverVoltage: number,
  holdingCurrent: number,
  gateTriggerCurrent: number,
): ShockleyDiodeState {
  if (state === 'conducting') {
    return Math.abs(anodeCurrent) < holdingCurrent ? 'blocking' : 'conducting'
  }
  if (voltageAcross >= breakoverVoltage) return 'conducting'
  // The gate fires it only while FORWARD-biased — the gate cannot trigger reverse conduction.
  return gateCurrent >= gateTriggerCurrent && voltageAcross > 0 ? 'conducting' : 'blocking'
}

/**
 * The latching family the discrete-state loop settles by a breakover/strike voltage + holding-current
 * dropout: the gateless Shockley diode, the gated SCR (whose anode-cathode path is the same bistable
 * latch), and the carbon arc lamp (strikes at its ignition/breakover voltage, holds until the current
 * falls below the holding current — the same shockleyDiodeTarget logic). All store the latch as
 * device_state and flip it off the solved circuit; how a CONDUCTING one stamps differs by device (a
 * Shockley/SCR conducts as a forward diode, the arc as a fixed burning-voltage drop).
 */
const LATCHING_THYRISTORS = new Set(['diode_shockley', 'scr', 'arc_lamp'])

/** Each Shockley diode's current state from the world (blocking = off, at rest). */
export function shockleyStatesOf(world: World): Map<string, ShockleyDiodeState> {
  const states = new Map<string, ShockleyDiodeState>()
  for (const inst of world.instances.values()) {
    if (!LATCHING_THYRISTORS.has(inst.definition)) continue
    states.set(
      inst.id,
      readEnumParam(inst, 'device_state') === 'conducting' ? 'conducting' : 'blocking',
    )
  }
  return states
}

/** A world with each Shockley diode's device_state set to the given iteration's value. */
export function worldWithShockleyStates(
  world: World,
  states: Map<string, ShockleyDiodeState>,
): World {
  if (states.size === 0) return world
  const instances = new Map<string, Instance>()
  for (const [id, inst] of world.instances) {
    const state = states.get(id)
    if (state === undefined || !LATCHING_THYRISTORS.has(inst.definition)) {
      instances.set(id, inst)
      continue
    }
    instances.set(id, {
      ...inst,
      parameters: { ...inst.parameters, device_state: { value: state } },
    })
  }
  return { ...world, instances }
}

/**
 * Each Shockley diode whose latch state should FLIP given the solved circuit (breakover or holding
 * dropout). Diodes already in the right state are omitted, so the fixed-point loop settles.
 */
export function shockleyDiodeTargets(
  world: World,
  solution: Solution,
): Map<string, ShockleyDiodeState> {
  const targets = new Map<string, ShockleyDiodeState>()
  if (solution.status !== 'solved') return targets
  for (const inst of world.instances.values()) {
    if (!LATCHING_THYRISTORS.has(inst.definition)) continue
    const breakover = readScalarParam(inst, 'breakover_voltage')
    const holding = readScalarParam(inst, 'holding_current')
    if (breakover === undefined || holding === undefined) continue
    const anode = inst.connects?.find((c) => c.terminal === 'anode')?.net
    const cathode = inst.connects?.find((c) => c.terminal === 'cathode')?.net
    if (anode === undefined || cathode === undefined) continue
    const state: ShockleyDiodeState =
      readEnumParam(inst, 'device_state') === 'conducting' ? 'conducting' : 'blocking'
    const vAcross = (solution.nodes.get(anode) ?? 0) - (solution.nodes.get(cathode) ?? 0)
    const current = Math.abs(solution.branches.get(inst.id) ?? 0)
    let target: ShockleyDiodeState
    if (inst.definition === 'scr') {
      const gate = inst.connects?.find((c) => c.terminal === 'gate')?.net
      const gateResistance = readScalarParam(inst, 'gate_cathode_resistance')
      const gateTrigger = readScalarParam(inst, 'gate_trigger_current')
      if (gate === undefined || gateResistance === undefined || gateTrigger === undefined) continue
      const gateCurrent =
        gateResistance > 0
          ? ((solution.nodes.get(gate) ?? 0) - (solution.nodes.get(cathode) ?? 0)) / gateResistance
          : 0
      target = scrTarget(state, vAcross, current, gateCurrent, breakover, holding, gateTrigger)
    } else {
      target = shockleyDiodeTarget(state, vAcross, current, breakover, holding)
    }
    if (target !== state) targets.set(inst.id, target)
  }
  return targets
}
