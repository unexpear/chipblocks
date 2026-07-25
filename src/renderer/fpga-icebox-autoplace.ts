/**
 * FPGA fabric — Stage 2 (real iCE40), increment 6: auto-placement onto real cells.
 * The full staging is FPGA-FABRIC-RESEARCH.md §5. Increment 5 (fpga-icebox-synth.ts) synthesized a bitstream
 * from a PLACEMENT the caller supplied. This closes the last hand-step: it CHOOSES which real iCE40 cell each
 * LUT lands on, so the flow is netlist → bitstream with nothing hand-placed. It searches assignments of the
 * mapped LUTs onto a pool of available device cells and returns the first that fully binds and routes
 * (routing + assembling each candidate through `synthesizeBitstream`, so a returned placement's bitstream is
 * real). On the tiny real slices this project vendors only one assignment routes, so the placer genuinely has
 * to discover it — not a placement handed in.
 *
 * Honest scope: this is a ROUTABILITY-driven search over the injective LUT→cell assignments, bounded to
 * `maxCandidates`. It is genuinely EXHAUSTIVE only when the number of those assignments — the falling factorial
 * P(m,n) = m·(m−1)···(m−n+1) — is ≤ `maxCandidates`; that holds for small (netlist, pool) pairs but is exceeded
 * even within one 8-cell tile once n ≥ 6 (P(8,6)=20160 > the 20000 default). A failure therefore comes in TWO
 * honestly-distinguished flavours: when the search was exhaustive, `placed:false` means no routable placement
 * exists in the pool (proven absent); when it hit the budget first, the result is flagged `exhaustive:false`
 * with a "search truncated" reason — a routable placement MAY exist among the untried assignments, so the
 * negative is not proven. Either way it never fabricates a placement. It accepts the FIRST placement that
 * routes; it does NOT minimize wirelength — a simulated-annealing placer scoring HPWL over cell coordinates,
 * wrapped in a negotiated-congestion place↔route loop like Stage 1's `placeAndRoute`, is the quality
 * refinement. The cell POOL is supplied by the caller; flip-flops default off; IO / clock / carry unmodeled.
 */

import type { KLut } from './fpga-fabric.ts'
import type { IceboxDevice } from './fpga-icebox.ts'
import type { LogicTileBits } from './fpga-icebox-logic.ts'
import { type Placement, type SynthResult, synthesizeBitstream } from './fpga-icebox-synth.ts'

/** An available placement slot: a logic tile (x, y) and a cell index within it. */
export type Cell = { x: number; y: number; cell: number }

export type AutoPlaceResult = {
  /** true iff a placement that fully binds and routes was found within the candidate budget. */
  placed: boolean
  /** the chosen placement (routable when `placed`), or the last one tried (for diagnostics) when not. */
  placement: Placement
  /** the synthesized bitstream for `placement` (real when `placed`). */
  result: SynthResult
  /** how many candidate placements were routed before returning. */
  attempts: number
  /** true iff the search was conclusive: it either found a placement, or covered the ENTIRE assignment space
   *  (P(m,n) ≤ maxCandidates) and none routed. False ⇒ the budget truncated the search, so a `placed:false`
   *  is NOT proof no routable placement exists. */
  exhaustive: boolean
  /** why placement failed (more LUTs than cells / none exists / search truncated), or null on success. */
  reason: string | null
}

/** Whether the number of injective assignments of n LUTs onto m cells, P(m,n), exceeds `cap`. */
function injectiveCountExceeds(m: number, n: number, cap: number): boolean {
  let total = 1
  for (let i = 0; i < n; i++) {
    total *= m - i
    if (total > cap) return true
  }
  return false
}

/**
 * Yield injective assignments `assign` (LUT i → cell pool index `assign[i]`, all distinct) for `n` LUTs over
 * `m` cells, in a deterministic order, up to `cap` of them. This is the candidate space the placer searches.
 */
function* injectiveAssignments(n: number, m: number, cap: number): Generator<number[]> {
  const used = new Array(m).fill(false)
  const current: number[] = []
  let count = 0
  function* recurse(): Generator<number[]> {
    if (count >= cap) return
    if (current.length === n) {
      count++
      yield [...current]
      return
    }
    for (let c = 0; c < m && count < cap; c++) {
      if (used[c]) continue
      used[c] = true
      current.push(c)
      yield* recurse()
      current.pop()
      used[c] = false
    }
  }
  yield* recurse()
}

/**
 * Automatically place a mapped LUT netlist onto real iCE40 cells: search assignments of the LUTs onto the
 * available `cellPool` and return the first that fully binds and routes (each candidate routed + assembled via
 * `synthesizeBitstream`). Returns the routable placement and its real bitstream, or an honest failure with a
 * reason (more LUTs than cells, or no routable placement within `maxCandidates`).
 */
export function autoPlace(
  device: IceboxDevice,
  layout: LogicTileBits,
  luts: readonly KLut[],
  cellPool: readonly Cell[],
  options: { maxCandidates?: number } = {},
): AutoPlaceResult {
  const maxCandidates = options.maxCandidates ?? 20000
  const n = luts.length
  const m = cellPool.length
  const build = (assign: readonly number[]): Placement =>
    new Map(luts.map((lut, i) => [lut.id, cellPool[assign[i] as number] as Cell]))

  // Empty netlist: trivially placed (nothing to place), independent of the budget. Its bitstream is legal iff
  // the synthesizer says so (it does — no cells, no nets, nothing unbound), so `placed` tracks that, never
  // contradicting `result.routed`.
  if (n === 0) {
    const placement = build([])
    const result = synthesizeBitstream(device, layout, luts, placement)
    return {
      placed: result.routed,
      placement,
      result,
      attempts: 0,
      exhaustive: true,
      reason: result.routed ? null : 'empty netlist did not synthesize a legal bitstream',
    }
  }
  if (n > m) {
    const partial = build(luts.map((_, i) => Math.min(i, Math.max(0, m - 1))))
    return {
      placed: false,
      placement: partial,
      result: synthesizeBitstream(device, layout, luts, partial),
      attempts: 0,
      exhaustive: true, // n distinct LUTs cannot fit into m < n cells — conclusively no placement
      reason: `${n} LUTs but only ${m} cells available`,
    }
  }

  const canBeExhaustive = !injectiveCountExceeds(m, n, maxCandidates)
  let attempts = 0
  let last: { placement: Placement; result: SynthResult } | null = null
  for (const assign of injectiveAssignments(n, m, maxCandidates)) {
    attempts++
    const placement = build(assign)
    const result = synthesizeBitstream(device, layout, luts, placement)
    last = { placement, result }
    if (result.routed)
      return { placed: true, placement, result, attempts, exhaustive: true, reason: null }
  }

  const placement = last?.placement ?? new Map<string, Cell>()
  return {
    placed: false,
    placement,
    result: last?.result ?? synthesizeBitstream(device, layout, luts, placement),
    attempts,
    exhaustive: canBeExhaustive,
    // Distinguish a proven-absent result (searched the whole space) from a budget-truncated one (a routable
    // placement may still exist among the untried assignments) — never present the latter as the former.
    reason: canBeExhaustive
      ? `no routable placement exists for ${n} LUTs in this ${m}-cell pool (searched all ${attempts})`
      : `search truncated at the ${maxCandidates}-candidate budget (${attempts} tried) — a routable placement may exist among the untried assignments`,
  }
}
