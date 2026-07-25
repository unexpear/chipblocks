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
 * Honest scope: this is a ROUTABILITY-driven search, bounded to `maxCandidates` (exhaustive for a small cell
 * pool, so it finds the routable placement if one exists there; on a large device the space exceeds the bound
 * and it fails HONESTLY — `placed: false` with a reason — rather than fabricating a placement). It accepts the
 * FIRST placement that routes; it does NOT yet minimize wirelength — a real simulated-annealing placer scoring
 * HPWL over cell coordinates, wrapped in a negotiated-congestion place↔route loop like Stage 1's
 * `placeAndRoute`, is the quality refinement on top of this. The available-cell POOL is supplied by the caller
 * (a device region); flip-flops default off, and IO / clock / carry are still unmodeled (see increments 3–5).
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
  /** why placement failed (more LUTs than cells / no routable placement in budget), or null on success. */
  reason: string | null
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

  if (n > m) {
    const partial = build(luts.map((_, i) => Math.min(i, Math.max(0, m - 1))))
    return {
      placed: false,
      placement: partial,
      result: synthesizeBitstream(device, layout, luts, partial),
      attempts: 0,
      reason: `${n} LUTs but only ${m} cells available`,
    }
  }

  let attempts = 0
  let last: { placement: Placement; result: SynthResult } | null = null
  for (const assign of injectiveAssignments(n, m, maxCandidates)) {
    attempts++
    const placement = build(assign)
    const result = synthesizeBitstream(device, layout, luts, placement)
    last = { placement, result }
    if (result.routed) return { placed: true, placement, result, attempts, reason: null }
  }

  const placement = last?.placement ?? new Map<string, Cell>()
  return {
    placed: false,
    placement,
    result: last?.result ?? synthesizeBitstream(device, layout, luts, placement),
    attempts,
    reason: `no routable placement found in ${attempts} candidate placement(s)`,
  }
}
