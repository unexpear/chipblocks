import type { Instance, World } from './cross-fk-validator.ts'
import {
  dcRan,
  dcRefused,
  LIGHT_CURRENT_DEFINITIONS,
  type Solution,
  type SolveOptions,
  solveDC,
} from './dc-solver.ts'
import { readScalarParam } from './instance-params.ts'
import { pastDeadline, solveDeadline } from './solver-budget.ts'
import { SparseSession } from './sparse-linear.ts'

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
 * Chosen 2026-06-14 as the DEFAULT for rail-referenced junction bias over a cold
 * zero-state pseudo-transient coast: that coast slams any junction whose far side is
 * pinned to a rail (a PNP emitter, a current-mirror top) to full forward bias at t=0
 * and the first solve goes singular (verified on a PNP common-emitter). Source stepping
 * ramps that rail up from zero, so the junction turns on gently — still the right first
 * tool for BJT/op-amp bias. Pseudo-transient (`solveDCByPseudoTransient`) is available
 * as a later CMOS continuation after gmin stepping stalls — artificial ground caps with
 * a real final ungapped solve, never a capacitively-held snapshot as the answer.
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
  // ONE deadline for the whole ramp, not one per level: up to 400 levels × 1000 Newton passes each is
  // precisely the shape of work that used to run until someone killed the process.
  const deadline = solveDeadline(options?.deadline)
  const rampOptions: SolveOptions = {
    maxIterations: RAMP_SOLVE_MAX_ITERATIONS,
    ...options,
    deadline,
    // Every level is the same circuit at a different supply — one solver session for the whole ramp.
    sparseSession: options?.sparseSession ?? new SparseSession(),
  }
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
    // Refused, not failed: a smaller supply step cannot make the circuit smaller or the clock slower,
    // so the ramp stops here and hands the refusal straight back.
    if (dcRefused(sol.status)) return sol
    if (dcRan(sol.status)) {
      alpha = next
      seed = sol.nodes
      solution = sol
      step = Math.min(step * 1.5, RAMP_STEP_MAX)
    } else {
      step /= 2
      if (step < RAMP_STEP_MIN) break // can't ramp in any finer — give up honestly
    }
  }

  if (alpha >= 1 && solution && dcRan(solution.status)) return solution
  // The ramp stalled — report the real circuit's own (failed) status, not a partial
  // scaled-down solve dressed up as the answer.
  return solveDC(world, rampOptions)
}

/** Gmin stepping's starting shunt — SPICE's dynamic-gmin start (its 1 pS GMIN × 10¹⁰). At 10 mS to ground
 *  every high-impedance node of a logic netlist is held firmly, so the first level converges in a few
 *  Newton passes from a cold start (8 on the hex → 7-segment decoder). */
const GMIN_STEP_START = 1e-2
/** Below this shunt the next level is the real circuit — at 1 pS it is already the devices' own GMIN. */
const GMIN_STEP_FLOOR = 1e-12
/** Newton budget per gmin level. Each level starts from the previous level's answer, so a level that
 *  needs more than this is a sign the step was too big — it is retried with a smaller step instead. */
const GMIN_LEVEL_MAX_ITERATIONS = 100
/** Step schedule in DECADES of shunt: start at one decade, widen after an easy level, halve on failure. */
const GMIN_STEP_DECADES_INITIAL = 1
const GMIN_STEP_DECADES_MAX = 3
const GMIN_STEP_DECADES_MIN = 1 / 16
/** A level that converged in at most this many passes earns a wider next step. */
const GMIN_EASY_LEVEL_ITERATIONS = 6
const GMIN_MAX_LEVELS = 80

/**
 * Robust DC operating-point finding by GMIN STEPPING — SPICE's other textbook continuation, and the one
 * that suits large transistor (CMOS) netlists. A conductance is added from every node to ground, large
 * enough that the circuit is easy (every floating-ish node — a stack node between off transistors, an
 * unloaded output — is pinned near ground instead of wandering to absurd voltages); the shunt is then
 * stepped down decade by decade, each level seeded from the one before, until the last solve is the
 * REAL circuit with no shunt at all.
 *
 * Why it exists (measured, tests/solver-scale.test.ts): the built-in hex → 7-segment decoder (722
 * MOSFETs, ~4,000 MNA unknowns) never converged from a cold start — the direct Newton ran 831 passes in
 * its 60 s budget without settling, and source stepping did not finish inside the budget either. Its
 * unloaded outputs and series stacks are held only by off transistors' 1 pS, so every early iterate puts
 * them at 10⁴⁰ V and the 1 V-per-pass step limit then has to walk the transistors back. Gmin stepping
 * reaches the converged operating point in ~130 Newton passes in total.
 *
 * Accuracy is preserved the same way source stepping preserves it: the shunt only changes the path; the
 * final level is the real circuit solved by the same MNA + Newton-Raphson. A stalled ramp returns that
 * failed solve's honest status — never a shunted solve dressed up as the answer.
 */
export function solveDCByGminStepping(world: World, options?: SolveOptions): Solution {
  const deadline = solveDeadline(options?.deadline)
  const levelOptions: SolveOptions = {
    maxIterations: GMIN_LEVEL_MAX_ITERATIONS,
    ...options,
    deadline,
    sparseSession: options?.sparseSession ?? new SparseSession(),
  }
  const floorDecade = Math.log10(GMIN_STEP_FLOOR)
  let decade = Math.log10(GMIN_STEP_START) // the shunt of the next level to try, as log10(siemens)
  let lastGood: number | undefined // the shunt decade of the last level that converged
  let step = GMIN_STEP_DECADES_INITIAL
  let seed: Map<string, number> | undefined
  let last: Solution | undefined

  for (let level = 0; level < GMIN_MAX_LEVELS; level++) {
    const real = decade < floorDecade // past the floor: the next level is the real circuit
    const sol = solveDC(world, {
      ...levelOptions,
      gminShunt: real ? 0 : 10 ** decade,
      ...(seed ? { initialNodes: seed } : {}),
    })
    last = sol
    if (dcRefused(sol.status)) {
      if (sol.status !== 'over-budget' || lastGood === undefined) return sol
      // Say how far the continuation got, after the refusal itself (which must stay first): being told
      // what was NOT finished is the difference between a bound and a hang.
      const [refusal, ...rest] = sol.warnings
      const progress =
        `Gmin stepping had converged with a ${(10 ** lastGood).toExponential(0)} S shunt on every node ` +
        '(the real circuit has none) when time ran out — the voltages shown are not an operating point.'
      return { ...sol, warnings: refusal === undefined ? [progress] : [refusal, progress, ...rest] }
    }
    if (dcRan(sol.status)) {
      if (real) return sol
      seed = sol.nodes
      lastGood = decade
      if (sol.iterations <= GMIN_EASY_LEVEL_ITERATIONS)
        step = Math.min(step * 2, GMIN_STEP_DECADES_MAX)
      decade = lastGood - step
      continue
    }
    // A cold start that fails even at the starting shunt has nothing to continue from.
    if (lastGood === undefined) return sol
    step /= 2
    if (step < GMIN_STEP_DECADES_MIN) break // can't step any finer — give up honestly
    decade = lastGood - step
  }
  // Out of levels or step: the last attempt's own (failed) status — never a shunted solve.
  return last ?? solveDC(world, { ...levelOptions })
}

/** First time step — short, so a wild cold start cannot jump far in one Newton. */
const PSEUDO_DT_INITIAL = 1e-9
const PSEUDO_DT_MAX = 1e-3
const PSEUDO_DT_MIN = 1e-12
/** Settled when every node moved less than this (volts) for PSEUDO_SETTLE_STREAK steps. */
const PSEUDO_DV_TOL = 1e-3
const PSEUDO_SETTLE_STREAK = 2
const PSEUDO_MAX_STEPS = 200
const PSEUDO_LEVEL_MAX_ITERATIONS = 100
/** Bounds on adaptive pseudo-C (farads). Floor keeps a tiny circuit from vanishing; ceiling
 *  keeps a near-short from stampeding Newton with a huge companion. */
const PSEUDO_CAP_MIN_F = 1e-15
const PSEUDO_CAP_MAX_F = 1e-6
/** Fallback conductance (siemens) when the netlist has no readable R / MOSFET kp / C scale. */
const PSEUDO_G_FALLBACK = 1e-3

/**
 * Characteristic conductance of a circuit for sizing the pseudo-transient companion.
 * Geometric mean of positive resistor conductances, MOSFET kp (A/V² ≈ S at ~1 V), and
 * C/τ₀ from existing capacitors — the scale the artificial C should match so early steps
 * are soft relative to THIS circuit, not a fixed 1 nF guess.
 */
export function estimateCircuitConductanceScale(world: World): number {
  const samples: number[] = []
  for (const inst of world.instances.values()) {
    if (inst.kind_ref !== 'primitive_device') continue
    const def = inst.definition
    if (
      def === 'resistor' ||
      def === 'potentiometer' ||
      def === 'thermistor' ||
      def === 'photoresistor'
    ) {
      const R = readScalarParam(inst, 'resistance')
      if (R !== undefined && R > 0 && Number.isFinite(R)) samples.push(1 / R)
    } else if (def === 'capacitor') {
      const C = readScalarParam(inst, 'capacitance')
      if (C !== undefined && C > 0 && Number.isFinite(C)) samples.push(C / PSEUDO_DT_INITIAL)
    } else if (def === 'transistor_mosfet_nmos' || def === 'transistor_mosfet_pmos') {
      const kp = readScalarParam(inst, 'transconductance_parameter')
      if (kp !== undefined && kp > 0 && Number.isFinite(kp)) samples.push(kp)
    } else if (def === 'power_source') {
      const rInt = readScalarParam(inst, 'internal_resistance')
      if (rInt !== undefined && rInt > 0 && Number.isFinite(rInt)) samples.push(1 / rInt)
    } else if (def === 'wire') {
      const R = readScalarParam(inst, 'resistance')
      if (R !== undefined && R > 0 && Number.isFinite(R)) samples.push(1 / R)
    }
  }
  if (samples.length === 0) return PSEUDO_G_FALLBACK
  let logSum = 0
  for (const g of samples) logSum += Math.log(g)
  const geo = Math.exp(logSum / samples.length)
  return Number.isFinite(geo) && geo > 0 ? geo : PSEUDO_G_FALLBACK
}

/**
 * Adaptive artificial ground capacitance for pseudo-transient: size C so the initial
 * companion G = C/Δt₀ matches the circuit's characteristic conductance. Replaces the
 * fixed 1 nF of 1d81a90. Still only used on intermediate coast steps — the final answer
 * is always an ungapped real-circuit solve.
 */
export function adaptivePseudoCapacitance(world: World): number {
  const G = estimateCircuitConductanceScale(world)
  const C = G * PSEUDO_DT_INITIAL
  return Math.min(PSEUDO_CAP_MAX_F, Math.max(PSEUDO_CAP_MIN_F, C))
}

/**
 * Robust DC operating-point finding by PSEUDO-TRANSIENT continuation — artificial capacitors from
 * every node to ground (capacitance sized from the circuit's conductance scale — see
 * `adaptivePseudoCapacitance`), marched with backward-Euler companion stamps (`pseudoCapacitance` /
 * `pseudoDt` / `previousNodes` on `solveDC`) until voltages stop moving, then one REAL solve of
 * the circuit with no artificial C.
 *
 * Why it exists alongside gmin / source stepping: large CMOS netlists whose gmin ramp stalls still
 * sometimes settle when the nodes are held by capacitance and allowed to coast. Accuracy is the
 * same contract as the other continuations — the final level IS the real circuit; a stalled coast
 * returns that failed solve's honest status, never a capacitively-held snapshot as the answer.
 *
 * A caller-supplied `initialNodes` (e.g. a logic-sim seed) is used as the coast's starting state
 * and as the device .nodeset on each step. Early gmin levels deliberately do NOT take that seed
 * (a final-OP start fights a large shunt); the seed belongs here and on the direct attempt.
 */
export function solveDCByPseudoTransient(world: World, options?: SolveOptions): Solution {
  const deadline = solveDeadline(options?.deadline)
  const levelOptions: SolveOptions = {
    maxIterations: PSEUDO_LEVEL_MAX_ITERATIONS,
    ...options,
    deadline,
    sparseSession: options?.sparseSession ?? new SparseSession(),
  }
  // Strip companion knobs from the final-options base — only intermediate steps set them.
  const {
    pseudoCapacitance: _c,
    pseudoDt: _dt,
    previousNodes: _prev,
    ...baseOptions
  } = levelOptions

  let nodes: Map<string, number> =
    options?.initialNodes !== undefined ? new Map(options.initialNodes) : new Map()
  let dt = PSEUDO_DT_INITIAL
  let streak = 0
  let lastGood: Map<string, number> | undefined

  const pseudoC = adaptivePseudoCapacitance(world)

  for (let step = 0; step < PSEUDO_MAX_STEPS; step++) {
    if (pastDeadline(deadline)) {
      const progress =
        lastGood !== undefined
          ? 'Pseudo-transient had a settled candidate when time ran out — the voltages shown are not an operating point of the real circuit.'
          : 'Pseudo-transient ran out of time before the artificial capacitors settled.'
      const failed = solveDC(world, {
        ...baseOptions,
        ...(lastGood ? { initialNodes: lastGood } : {}),
      })
      if (dcRefused(failed.status) || failed.status === 'over-budget') {
        const [refusal, ...rest] = failed.warnings
        return {
          ...failed,
          warnings: refusal === undefined ? [progress] : [refusal, progress, ...rest],
        }
      }
      return {
        ...failed,
        status: 'over-budget',
        converged: false,
        warnings: [progress, ...failed.warnings],
      }
    }

    const sol = solveDC(world, {
      ...baseOptions,
      pseudoCapacitance: pseudoC,
      pseudoDt: dt,
      ...(nodes.size > 0 ? { previousNodes: nodes, initialNodes: nodes } : {}),
    })
    if (dcRefused(sol.status)) return sol
    if (!dcRan(sol.status)) {
      dt /= 2
      if (dt < PSEUDO_DT_MIN) break
      continue
    }

    let maxDv = 0
    for (const [net, v] of sol.nodes) {
      maxDv = Math.max(maxDv, Math.abs(v - (nodes.get(net) ?? 0)))
    }
    // Also count nets that appeared
    for (const [net, v] of nodes) {
      if (!sol.nodes.has(net)) maxDv = Math.max(maxDv, Math.abs(v))
    }
    nodes = sol.nodes
    lastGood = nodes

    if (maxDv < PSEUDO_DV_TOL) {
      streak++
      if (streak >= PSEUDO_SETTLE_STREAK) {
        // Real circuit — no artificial C. Seed from the settled coast.
        return solveDC(world, { ...baseOptions, initialNodes: nodes })
      }
      dt = Math.min(dt * 2, PSEUDO_DT_MAX)
    } else {
      streak = 0
      dt = Math.min(dt * 1.5, PSEUDO_DT_MAX)
    }
  }

  // Out of steps or Δt: honest real-circuit attempt from the last coast state.
  return solveDC(world, {
    ...baseOptions,
    ...(lastGood !== undefined ? { initialNodes: lastGood } : {}),
  })
}

/**
 * How much of the budget the DIRECT Newton attempt may spend before solveDCRobust hands the circuit to a
 * continuation. A third: every circuit in this repo whose direct solve converges does so in a small
 * fraction of it (the slowest, a 520-pass LED-matrix pattern, in well under a second), so they are
 * byte-for-byte unaffected; a large netlist that is still iterating after a third of the budget is the
 * signature of one that needs a continuation, and spending the whole budget there (as it used to — the
 * hex decoder burnt all 60 s on 831 direct passes) leaves the continuation nothing to work with.
 * An unbounded caller (deadline Infinity) keeps an unbounded direct attempt.
 */
const DIRECT_BUDGET_SHARE = 1 / 3

/**
 * The direct Newton budget for a CMOS netlist (see isCmosNetlist), in place of the generous 1000 the
 * junction circuits need. Measured: every built-in CMOS block that converges directly does so in at
 * most 125 passes (the 4-bit calculator in 29–72 across its inputs, the hex → 7-segment decoder in
 * 55–125), while the ones that do not converge are still wandering at 1000. Past this count, gmin
 * stepping is the faster road to the same operating point — on the calculator inputs that need it,
 * ~1000 hopeless direct passes cost ~11 s before the continuation could even start. SPICE's own direct
 * limit (ITL1) is 100. A caller's explicit maxIterations still overrides it.
 */
const CMOS_DIRECT_MAX_ITERATIONS = 200

/**
 * The DC operating point, robust to convergence failure. Tries the direct solve with
 * a full Newton budget first (the fast path for every circuit that converges) — capped at
 * DIRECT_BUDGET_SHARE of the wall-clock budget, and at CMOS_DIRECT_MAX_ITERATIONS passes for a
 * CMOS netlist — and only on failure falls back to a continuation (solveDCByContinuation: gmin
 * stepping for a CMOS netlist, source stepping for everything else). Returns the direct result
 * unchanged when it succeeds. The generous Newton budget is only the DEFAULT — a caller that
 * passes its own maxIterations is honored.
 */
export function solveDCRobust(world: World, options?: SolveOptions): Solution {
  const deadline = solveDeadline(options?.deadline)
  // One solver session for the direct attempt and every continuation level: same circuit, same structure.
  const sparseSession = options?.sparseSession ?? new SparseSession()
  const direct = solveDC(world, {
    maxIterations: isCmosNetlist(world) ? CMOS_DIRECT_MAX_ITERATIONS : RAMP_SOLVE_MAX_ITERATIONS,
    ...options,
    deadline,
    // The share is taken inside solveDC on the clock read it already makes, so a refused robust solve
    // costs no more clock reads than the plain solve it wraps (the refusal tests count them).
    deadlineShare: DIRECT_BUDGET_SHARE,
    sparseSession,
  })
  if (dcRan(direct.status) || direct.status === 'no-ground') return direct
  // Over its OWN share of the budget is not a refusal — the continuations get the rest. Any other
  // refusal (too large, invalid, or the caller's whole budget gone) is final.
  const directOutOfShare = direct.status === 'over-budget' && !pastDeadline(deadline)
  if (dcRefused(direct.status) && !directOutOfShare) return direct
  // The continuations run to the caller's whole deadline (a share of 1 = the full remaining budget).
  return solveDCByContinuation(world, { ...options, deadline, deadlineShare: 1, sparseSession })
}

/**
 * The continuation fallback once the direct Newton has failed. A transistor-level CMOS netlist — MOSFETs
 * plus wires, supplies, resistors and capacitors, nothing else — takes GMIN stepping first (see
 * solveDCByGminStepping), then pseudo-transient if that stalls, then source stepping. A caller-supplied
 * initialNodes (logic seed) is kept off early gmin levels and offered to pseudo-transient as a warm
 * start. Every other circuit keeps SOURCE stepping, exactly as before: it was chosen for rail-referenced
 * junction bias (a PNP emitter, an op-amp's current-mirror top), and those circuits' paths are unchanged.
 */
function solveDCByContinuation(world: World, options: SolveOptions): Solution {
  if (!isCmosNetlist(world)) return solveDCBySourceStepping(world, options)
  // A logic-seed / .nodeset must not feed early gmin levels: a final-OP start fights the large
  // shunt (measured — slows the soft mid-rail path). Strip it for gmin; keep it for pseudo-transient
  // and for the direct attempt above (solveDCRobust already passed options through).
  const { initialNodes: warmSeed, ...gminOptions } = options
  const gmin = solveDCByGminStepping(world, gminOptions)
  if (dcRan(gmin.status) || dcRefused(gmin.status)) return gmin
  const ptr = solveDCByPseudoTransient(
    world,
    warmSeed !== undefined ? { ...options, initialNodes: warmSeed } : options,
  )
  if (dcRan(ptr.status) || dcRefused(ptr.status)) return ptr
  return solveDCBySourceStepping(world, options)
}

/** The only device kinds a "CMOS netlist" may contain. An allow-list on purpose: anything not named here
 *  (a diode, a BJT, a JFET, a tube, a part added later) keeps the circuit on the unchanged path. */
const CMOS_NETLIST_MOSFETS = new Set(['transistor_mosfet_nmos', 'transistor_mosfet_pmos'])
const CMOS_NETLIST_LINEAR = new Set(['wire', 'power_source', 'ground', 'resistor', 'capacitor'])

/** At least one MOSFET, and every circuit element is a MOSFET or one of the plain linear parts above. */
function isCmosNetlist(world: World): boolean {
  let mosfets = 0
  for (const inst of world.instances.values()) {
    if (inst.kind_ref !== 'primitive_device') continue
    if (CMOS_NETLIST_MOSFETS.has(inst.definition)) mosfets++
    else if (!CMOS_NETLIST_LINEAR.has(inst.definition)) return false
  }
  return mosfets > 0
}
