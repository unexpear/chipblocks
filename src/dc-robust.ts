import type { Instance, World } from './cross-fk-validator.ts'
import {
  LIGHT_CURRENT_DEFINITIONS,
  type Solution,
  type SolveOptions,
  solveDC,
} from './dc-solver.ts'

/**
 * Robust DC operating-point finding by SOURCE STEPPING — the textbook fallback for
 * when the direct Newton-Raphson cannot bias a hard circuit (a high-gain transistor
 * amplifier, an op-amp) from a cold start. Physically: turn the supply up slowly from
 * zero and watch where the circuit settles. Each level is solved seeded from the one
 * below — the operating point moves only a little per step — so the Newton always
 * starts near its answer and no junction is ever slammed full-on from a dead start.
 *
 * Accuracy is preserved by construction: the final level IS the real circuit at full
 * supply, solved by the same MNA + Newton-Raphson as everything else — the ramp only
 * supplies a good starting guess, it never changes the equations. And the fast path
 * (the direct solve succeeds) returns that solve untouched, so every circuit that
 * already converges is byte-for-byte unaffected.
 *
 * Chosen 2026-06-14 over cap-based pseudo-transient: a zero-state coast slams any
 * junction whose far side is pinned to a rail (a PNP emitter, a current-mirror top)
 * to full forward bias at t=0 and the first solve goes singular (verified on a PNP
 * common-emitter). Source stepping ramps that rail up from zero, so the junction
 * turns on gently — the right tool for the op-amp's rail-referenced bias. The deep
 * research suggested reusing the transient engine precisely because the solver lacked
 * source stepping; this adds the missing tool rather than the substitute.
 */

/** The DEFAULT Newton budget — "robust" means try hard, so it is generous. Stiff but well-posed
 *  mixed-diode circuits (e.g. a multiplexed LED matrix with a particular set of columns lit) converge
 *  SLOWLY — the pnjlim step-limiting inches the coupled junctions to the operating point over many
 *  iterations (one measured LED-matrix pattern needs ~520) — yet they DO converge. The old budget of 100
 *  cut them off mid-convergence and reported a false did-not-converge with collapsed zero currents. A
 *  converging solve still stops the instant it meets tolerance (the cap is only a ceiling), so this slows
 *  nothing that already worked — it just lets the slow-but-real cases finish. A caller's own
 *  maxIterations still overrides it. */
const RAMP_SOLVE_MAX_ITERATIONS = 1000
/** Ramp schedule: a modest first touch (junctions turn on most sharply near zero),
 *  growing on success and halving on failure, with bounds that keep it terminating. */
const RAMP_STEP_INITIAL = 0.2
const RAMP_STEP_MAX = 0.34
const RAMP_STEP_MIN = 1e-3
const RAMP_MAX_LEVELS = 400

type ScalarParam = { value?: { kind?: string; amount?: number; unit?: string } }

function scaleScalarParam(param: unknown, alpha: number): unknown {
  const p = param as ScalarParam
  if (p?.value?.kind === 'scalar' && typeof p.value.amount === 'number') {
    return { ...p, value: { ...p.value, amount: p.value.amount * alpha } }
  }
  return param
}

/** A copy of `params` with the listed scalar keys scaled by `alpha` (missing keys left alone). */
function scaleParamKeys(
  params: Record<string, unknown>,
  alpha: number,
  keys: readonly string[],
): Record<string, unknown> {
  const scaled = { ...params }
  for (const key of keys) {
    if (key in params) scaled[key] = scaleScalarParam(params[key], alpha)
  }
  return scaled
}

/**
 * A copy of `world` with every independent EXCITATION's drive scaled by `alpha` (0 → dead, 1 → full):
 * a voltage source's nominal_voltage, and a light sensor's illuminance (a photodiode / phototransistor
 * injects a current LINEAR in it, so scaling the illuminance ramps the photocurrent from zero). Other
 * parameters, topology — and a photoresistor's light-set RESISTANCE, a passive value rather than an
 * excitation — are all untouched.
 */
export function scaleSources(world: World, alpha: number): World {
  const instances = new Map(world.instances)
  for (const [id, inst] of world.instances) {
    const params = inst.parameters as Record<string, unknown> | undefined
    if (params === undefined) continue
    if (inst.definition === 'power_source' && 'nominal_voltage' in params) {
      instances.set(id, {
        ...inst,
        parameters: scaleParamKeys(params, alpha, ['nominal_voltage']),
      } as Instance)
    } else if (LIGHT_CURRENT_DEFINITIONS.has(inst.definition)) {
      instances.set(id, {
        ...inst,
        parameters: scaleParamKeys(params, alpha, ['incident_illuminance', 'ambient_illuminance']),
      } as Instance)
    }
  }
  return { ...world, instances }
}

/**
 * Solve the DC operating point by ramping the supplies from zero to full, seeding
 * each level from the one below. Returns a fully-converged solve of the REAL circuit
 * (at full supply) on success, or an honest non-'solved' status if the ramp stalls
 * (no stable operating point can be reached) — never a faked answer.
 */
export function solveDCBySourceStepping(world: World, options?: SolveOptions): Solution {
  const rampOptions: SolveOptions = { maxIterations: RAMP_SOLVE_MAX_ITERATIONS, ...options }
  let alpha = 0
  let step = RAMP_STEP_INITIAL
  let seed: Map<string, number> | undefined
  let solution: Solution | null = null

  for (let level = 0; level < RAMP_MAX_LEVELS && alpha < 1; level++) {
    const next = Math.min(alpha + step, 1)
    const scaled = next >= 1 ? world : scaleSources(world, next)
    const sol = seed
      ? solveDC(scaled, { ...rampOptions, initialNodes: seed })
      : solveDC(scaled, rampOptions)
    if (sol.status === 'solved') {
      alpha = next
      seed = sol.nodes
      solution = sol
      step = Math.min(step * 1.5, RAMP_STEP_MAX)
    } else {
      step /= 2
      if (step < RAMP_STEP_MIN) break // can't ramp in any finer — give up honestly
    }
  }

  if (alpha >= 1 && solution && solution.status === 'solved') return solution
  // The ramp stalled — report the real circuit's own (failed) status, not a partial
  // scaled-down solve dressed up as the answer.
  return solveDC(world, rampOptions)
}

/**
 * The DC operating point, robust to convergence failure. Tries the direct solve with
 * a full Newton budget first (the fast path for every circuit that converges); only
 * on failure does it fall back to source stepping. Returns the direct result
 * unchanged when it succeeds, so existing circuits are untouched. The generous budget
 * is only the DEFAULT — a caller that passes its own maxIterations is honored.
 */
export function solveDCRobust(world: World, options?: SolveOptions): Solution {
  const direct = solveDC(world, { maxIterations: RAMP_SOLVE_MAX_ITERATIONS, ...options })
  if (direct.status === 'solved' || direct.status === 'no-ground') return direct
  return solveDCBySourceStepping(world, options)
}
