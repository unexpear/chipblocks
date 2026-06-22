/**
 * Relay resolution (S21-v3-6) — the discrete-state fixed point that sits OUTSIDE
 * the electro-thermal loop: a relay's contacts depend on its coil voltage, and
 * the coil voltage comes from the solve, so we iterate solve → re-check each
 * relay's pull-in/release → re-solve until no contact needs to move.
 *
 * The reversible cousin of the fuse blow, contained in ONE call (no React
 * re-render loop): for an ordinary relay (its coil on a separate control circuit)
 * it settles in one or two passes; a relay whose coil is powered THROUGH its own
 * contacts (a buzzer / oscillator) never settles — the iteration is capped and
 * `relaysSettled: false` is reported, the same honest "could not settle" the
 * thermal runaway uses, rather than picking an arbitrary state.
 */

import { arcVoltageTargets, ayrtonArcBaseVoltages, worldWithArcVoltages } from './arc-model.ts'
import type { Instance, World } from './cross-fk-validator.ts'
import {
  type ElectroThermalOptions,
  type ElectroThermalResult,
  solveElectroThermal,
} from './electro-thermal.ts'
import { relayCoilTargets } from './failure-detector.ts'
import { readEnumParam } from './instance-params.ts'
import {
  type ShockleyDiodeState,
  shockleyDiodeTargets,
  shockleyStatesOf,
  worldWithShockleyStates,
} from './shockley-diode.ts'

const MAX_RELAY_ITERATIONS = 20

export type RelayState = 'energized' | 'de_energized'

export type RelaySolveResult = ElectroThermalResult & {
  /** Each relay's resolved contact state (energized → common on normally_open). */
  relayStates: Map<string, RelayState>
  /** Each Shockley 4-layer diode's settled latch state (blocking / conducting). */
  shockleyStates: Map<string, ShockleyDiodeState>
  /** False when a discrete-state device (relay or Shockley diode) could not settle — an oscillator. */
  relaysSettled: boolean
}

/** Each relay's current coil_state from the world (de_energized = at rest). */
function relayStatesOf(world: World): Map<string, RelayState> {
  const states = new Map<string, RelayState>()
  for (const inst of world.instances.values()) {
    if (inst.definition !== 'relay') continue
    states.set(
      inst.id,
      readEnumParam(inst, 'coil_state') === 'energized' ? 'energized' : 'de_energized',
    )
  }
  return states
}

/** A world with each relay's coil_state set to the given iteration's value. */
function worldWithRelayStates(world: World, states: Map<string, RelayState>): World {
  const instances = new Map<string, Instance>()
  for (const [id, inst] of world.instances) {
    const state = states.get(id)
    if (state === undefined || inst.definition !== 'relay') {
      instances.set(id, inst)
      continue
    }
    instances.set(id, {
      ...inst,
      parameters: { ...inst.parameters, coil_state: { value: state } },
    })
  }
  return { ...world, instances }
}

/**
 * Solve with all discrete-state devices resolved to a self-consistent state — relays (contact
 * position) AND Shockley 4-layer diodes (latch blocking/conducting). Wraps the electro-thermal
 * solve: the OUTER loop here flips relay contacts + diode latches off the solved voltages/currents,
 * the INNER loop there settles temperatures. With none of these it is a single solve. An oscillator
 * (a buzzer, or a Shockley relaxation oscillator) never settles — the loop is capped and
 * relaysSettled is reported false, the same honest "could not settle" the thermal runaway uses.
 */
export function solveWithRelays(world: World, options?: ElectroThermalOptions): RelaySolveResult {
  let relayStates = relayStatesOf(world)
  let shockleyStates = shockleyStatesOf(world)
  // The carbon arc's burning voltage is a CONTINUOUS state settled in the same fixed point: it relaxes
  // to V_min + B/I off the solved current (arc-model.ts). Starts at V_min; only falling arcs (a
  // positive ayrton_coefficient) appear here, so a flat constant-drop arc adds nothing.
  const arcBaseVoltages = ayrtonArcBaseVoltages(world)
  let arcVoltages = new Map(arcBaseVoltages)
  const composed = () =>
    worldWithArcVoltages(
      worldWithRelayStates(worldWithShockleyStates(world, shockleyStates), relayStates),
      arcVoltages,
    )
  let result = solveElectroThermal(composed(), options)
  if (relayStates.size === 0 && shockleyStates.size === 0) {
    return { ...result, relayStates, shockleyStates, relaysSettled: true }
  }

  let relaysSettled = false
  for (let i = 0; i < MAX_RELAY_ITERATIONS; i++) {
    const relayTargets = relayCoilTargets(composed(), result.solution)
    const shockleyTargets = shockleyDiodeTargets(composed(), result.solution)
    const arcTargets = arcVoltageTargets(composed(), result.solution, arcBaseVoltages, arcVoltages)
    if (relayTargets.size === 0 && shockleyTargets.size === 0 && arcTargets.size === 0) {
      relaysSettled = true
      break
    }
    if (relayTargets.size > 0) {
      relayStates = new Map(relayStates)
      for (const [id, target] of relayTargets) relayStates.set(id, target)
    }
    if (shockleyTargets.size > 0) {
      shockleyStates = new Map(shockleyStates)
      for (const [id, target] of shockleyTargets) shockleyStates.set(id, target)
    }
    if (arcTargets.size > 0) {
      arcVoltages = new Map(arcVoltages)
      for (const [id, v] of arcTargets) arcVoltages.set(id, v)
    }
    result = solveElectroThermal(composed(), options)
  }
  return { ...result, relayStates, shockleyStates, relaysSettled }
}
