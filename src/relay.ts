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

import type { Instance, World } from './cross-fk-validator.ts'
import type { SolveOptions } from './dc-solver.ts'
import { type ElectroThermalResult, solveElectroThermal } from './electro-thermal.ts'
import { relayCoilTargets } from './failure-detector.ts'
import { readEnumParam } from './instance-params.ts'

const MAX_RELAY_ITERATIONS = 20

export type RelayState = 'energized' | 'de_energized'

export type RelaySolveResult = ElectroThermalResult & {
  /** Each relay's resolved contact state (energized → common on normally_open). */
  relayStates: Map<string, RelayState>
  /** False when a relay could not settle — a buzzer / oscillator. */
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
 * Solve with relays resolved to a self-consistent contact state. Wraps the
 * electro-thermal solve (which ignores the relay — its coil carries no thermal
 * rating): the OUTER loop here flips contacts, the INNER loop there settles
 * temperatures. With no relays this is a single electro-thermal solve.
 */
export function solveWithRelays(world: World, options?: SolveOptions): RelaySolveResult {
  let states = relayStatesOf(world)
  let result = solveElectroThermal(worldWithRelayStates(world, states), options)
  if (states.size === 0) return { ...result, relayStates: states, relaysSettled: true }

  let relaysSettled = false
  for (let i = 0; i < MAX_RELAY_ITERATIONS; i++) {
    const targets = relayCoilTargets(worldWithRelayStates(world, states), result.solution)
    if (targets.size === 0) {
      relaysSettled = true
      break
    }
    states = new Map(states)
    for (const [id, target] of targets) states.set(id, target)
    result = solveElectroThermal(worldWithRelayStates(world, states), options)
  }
  return { ...result, relayStates: states, relaysSettled }
}
