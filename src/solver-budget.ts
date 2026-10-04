/**
 * The circuit solvers' two hard limits — a size ceiling and a wall-clock budget. Together they are the
 * promise that a solve ALWAYS ends: the analog engines run on the same thread that draws the window and
 * on the vitest worker, and neither can be interrupted from outside (a synchronous Newton loop ignores
 * vitest's testTimeout — that is why a stray worker was found still spinning after 2935 CPU-seconds).
 * A solve that cannot finish must therefore stop ITSELF and say so, in plain English.
 *
 * WHY BOTH, and why a size ceiling is not enough on its own (measured, not assumed):
 *   • Size does not predict time. A 2,564-unknown MOSFET ladder solves in 355 ms; the ~650-MOSFET
 *     7-segment decoder is far smaller and takes ~60 s, because cost is (iterations × matrix solve) and
 *     a hard circuit needs a hundred iterations where an easy one needs one.
 *   • Time alone cannot be enforced either. ONE Newton iteration is atomic — the deadline is only read
 *     between iterations, so a matrix big enough makes a single uninterruptible step outlast any budget.
 *     Measured on a chain of real CMOS inverters (one build + one iteration each):
 *         2,564 unknowns → 0.36 s      5,124 → 1.2 s      10,244 → 5.0 s      20,484 → 21.6 s
 * So the ceiling keeps one iteration to about a second, and the budget then bounds their number.
 */

/**
 * The largest Modified-Nodal-Analysis system the analog solvers will attempt (matrix order = unknown
 * node voltages + auxiliary branch currents). Above this the circuit is refused BEFORE the matrix is
 * built, so the refusal is instant rather than a stall.
 *
 * Chosen from the measurements above: at 6,000 unknowns one iteration is ≈1.7 s, so a budget below can
 * still be observed to within a couple of seconds. It is ~7× the largest system this project's own test
 * suite solves (measured across a full `vitest run`: 945 instances / 813 nets). A recovered FPGA design
 * is far past it — the splitout fixture lowers to 25,397 instances — which is exactly the case that hung
 * the window; digital designs belong on the fast logic engine, and this says so instead of hanging.
 */
export const MAX_MNA_UNKNOWNS = 6000

/**
 * The default wall-clock budget for one whole solve, including every inner loop it drives (Newton,
 * electro-thermal, relay/latch settling, source-stepping, transient march). A runaway stop, not a
 * performance policy: the slowest legitimate solve anywhere in this repo is 6.4 s (the ~250-MOSFET
 * calculator through the robust continuation, tests/logic-seed.test.ts, timed under full parallel suite
 * load) and the slowest transient is 5.3 s (tests/dc-robust-stiff.test.ts), so 60 s clears real work by
 * ~9× and only ever catches something that was never going to finish.
 */
export const SOLVE_BUDGET_MS = 60_000

/**
 * The budget for a solve driven by the CANVAS — the one that runs on every edit and on every file open,
 * on the thread that draws the window. Much tighter than the library default because the window's
 * responsiveness is the thing being protected: measured across a full suite run, the slowest canvas
 * solve in the repo is 255 ms, so 5 s is ~20× real work. A single Newton iteration is atomic, so the
 * true worst case is this plus one iteration at the size ceiling (≈1.7 s).
 */
export const CANVAS_SOLVE_BUDGET_MS = 5_000

/**
 * The absolute time (on the `performance.now` clock) a solve must stop by. Passing an existing deadline
 * through is what makes NESTED solves honest: the electro-thermal loop, the relay/latch fixed point and
 * the source-stepping continuation each run many solves, and every one of them shares the caller's one
 * deadline instead of starting a fresh budget of its own.
 */
export function solveDeadline(existing: number | undefined, budgetMs = SOLVE_BUDGET_MS): number {
  return existing ?? performance.now() + budgetMs
}

/** Has this solve run out of time? A missing deadline means unbounded and is never past. */
export function pastDeadline(deadline: number | undefined): boolean {
  return deadline !== undefined && performance.now() >= deadline
}

/** What the user is told when a circuit is refused for being larger than the solvers will attempt. */
export function tooLargeMessage(unknowns: number, limit = MAX_MNA_UNKNOWNS): string {
  return (
    `This circuit is too big to simulate at the component level: it needs ${unknowns.toLocaleString()} ` +
    `unknowns and the limit is ${limit.toLocaleString()}. Nothing was simulated — no answer ` +
    'here would be worth the wait. Purely digital designs simulate as logic instead (fast, and exact ' +
    'for gates); to see real transistor physics, descend into one block and simulate that.'
  )
}

/**
 * The one-line headline for a solve that produced no answer, or undefined for every status that did.
 * The canvas shows it so a circuit sitting there with no currents and no readings is never mistaken for
 * a solved one — the full explanation is the first entry in the solution's warnings.
 *
 * Takes a plain string rather than a status union because BOTH solvers' status types carry these two
 * literals and neither may import the other (dc-solver and transient-solver would form a cycle).
 */
export function refusalHeadline(status: string): string | undefined {
  if (status === 'invalid-circuit')
    return 'Not simulated — correct the invalid circuit contracts or connections.'
  if (status === 'too-large') return 'Not simulated — this circuit is too big to solve.'
  if (status === 'over-budget') return 'Simulation stopped early — it ran out of time.'
  return undefined
}

/**
 * What the user is told when a solve was stopped by the clock rather than by finishing. `progress` says
 * how far it got, in the units that solve counts in ("37 solver passes", "3,000 of 20,000 time steps")
 * — being told what was NOT finished is the difference between a bound and a hang.
 *
 * It used to end "…so the window stays responsive", and that was a promise this file cannot keep. The
 * budget is checked BETWEEN iterations and one iteration is atomic, so the author's own worst case is
 * this budget plus one iteration at the size ceiling — about 6.7 seconds of a window answering nothing,
 * which nobody would call responsive. What is actually true is that the solve stops itself, which is the
 * whole point of the budget, so that is what it now says.
 */
export function overBudgetMessage(progress: string): string {
  return (
    `Simulation ran out of time and was stopped after ${progress} — it stops itself rather than run ` +
    'on without end. What you see is unfinished, not an answer. Simplify the circuit, shorten the run, ' +
    'or simulate a purely-digital block as logic.'
  )
}
