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
 * NOT modeled yet: transient (time-domain) operation — a relaxation oscillator needs it — and the
 * reverse-breakdown branch; the documented successors.
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

/** Each Shockley diode's current state from the world (blocking = off, at rest). */
export function shockleyStatesOf(world: World): Map<string, ShockleyDiodeState> {
  const states = new Map<string, ShockleyDiodeState>()
  for (const inst of world.instances.values()) {
    if (inst.definition !== 'diode_shockley') continue
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
    if (state === undefined || inst.definition !== 'diode_shockley') {
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
    if (inst.definition !== 'diode_shockley') continue
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
    const target = shockleyDiodeTarget(state, vAcross, current, breakover, holding)
    if (target !== state) targets.set(inst.id, target)
  }
  return targets
}
