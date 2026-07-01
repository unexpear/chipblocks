/**
 * Sparse direct linear solver — the fast path for the Modified Nodal Analysis systems the DC and
 * transient solvers build. A circuit's MNA matrix is ~99% zeros (each node touches only a handful of
 * others), but dense-linear.ts factors all N² entries at O(N³); a ~650-node digital block hits ~60 s.
 * This factors only the nonzeros — the SAME Gaussian elimination, just skipping the zeros — with a
 * minimum-degree ordering so the fill-in stays small (the high-degree supply rails get eliminated
 * last). For circuit matrices that turns the O(N³) wall into near-linear.
 *
 * SAFETY — it is the fast path, never the only path. `lusolve` runs the sparse factor, then checks the
 * residual ‖A·x − b‖, and falls back to dense-linear's lusolve whenever the sparse result is absent (a
 * zero/tiny pivot it won't pivot through) or not provably accurate. A sparse answer is therefore
 * returned ONLY when it demonstrably solves the system, so a wrong answer cannot escape — even from a
 * bug here — and the dense solver still owns the singular / floating-node / inconsistent cases it
 * already handles specially. Validated against dense-linear across random + structured systems
 * (sparse-linear.test.ts); below SPARSE_THRESHOLD unknowns the dense solve is used directly (the
 * sparse setup isn't worth it for small systems, which is most circuits).
 *
 * No partial pivoting, but the ordering is diagonal-aware: a structurally-zero diagonal (an ideal
 * voltage-source / branch-current row in MNA carries one) cannot lead the factor, so those rows are
 * DEFERRED to the end of the order, by which point eliminating the node rows they couple to has filled
 * their diagonal with a real Schur-complement value. Node (KCL) rows carry a gmin conductance to ground
 * so their diagonal is always nonzero. A pivot that is still tiny/zero after deferral (a genuinely
 * floating or singular system) makes the sparse pass bail to dense rather than risk an inaccurate
 * factor — and the residual check is the backstop if it ever doesn't.
 */

import { type DenseMatrix, DenseVector, lusolve as denseLusolve } from './dense-linear.ts'

/** Pivots at/below this magnitude are treated as zero → bail to dense (it pins a floating variable). */
const PIVOT_FLOOR = 1e-30
/** Relative ‖A·x − b‖ above which a sparse result is rejected (→ dense). Matches dense-linear's check. */
const RESIDUAL_TOLERANCE = 1e-6
/**
 * Below this many unknowns, skip the sparse machinery — a dense solve is already cheap, and the sparse
 * setup (two O(n²) scans + the ordering) is pure overhead there. Measured crossover: the hub/Vdd-rail
 * structure real circuits resemble only starts winning around n≈70-100, so 100 captures the wins without
 * paying the small-n penalty on mesh/banded systems.
 */
const SPARSE_THRESHOLD = 100

/**
 * A fill-reducing elimination order (minimum degree): repeatedly eliminate the lowest-degree node,
 * adding the fill edges its elimination creates among its neighbors. `order[k]` is the original index
 * eliminated k-th. Cheap and order-of-magnitude better than the natural order for circuit graphs (it
 * keeps the dense supply-rail rows out of the way until last). The order only affects SPEED and pivot
 * viability, never correctness — any elimination order is a valid factorization.
 *
 * Diagonal-aware: a node flagged in `zeroDiagonal` (its original diagonal is structurally zero, e.g. an
 * ideal voltage-source row) is penalised by +n so it sorts after every ordinary node — it must not lead
 * the no-pivot factor with a zero pivot; deferring it lets the Schur complement fill its diagonal first.
 */
function minimumDegreeOrder(adjacency: Set<number>[], zeroDiagonal?: boolean[]): number[] {
  const n = adjacency.length
  const graph = adjacency.map((s) => new Set(s)) // working copy; gains fill edges as we eliminate
  const eliminated = new Uint8Array(n)
  const order: number[] = []
  for (let step = 0; step < n; step++) {
    let best = -1
    let bestCost = Number.POSITIVE_INFINITY
    for (let v = 0; v < n; v++) {
      if (eliminated[v]) continue
      const cost = (graph[v] as Set<number>).size + (zeroDiagonal?.[v] ? n : 0)
      if (cost < bestCost) {
        bestCost = cost
        best = v
        if (cost === 0) break
      }
    }
    order.push(best)
    eliminated[best] = 1
    const neighbors = [...(graph[best] as Set<number>)].filter((u) => !eliminated[u])
    for (const a of neighbors) {
      const ga = graph[a] as Set<number>
      ga.delete(best)
      for (const b of neighbors) if (a !== b) ga.add(b)
    }
    ;(graph[best] as Set<number>).clear()
  }
  return order
}

/**
 * A reusable fill-reducing elimination order — the result of the symbolic analysis (the expensive part).
 * `order[k]` is the original index eliminated k-th; `inverse` is its permutation-inverse. A circuit's
 * nonzero STRUCTURE is fixed across the many solves one simulation runs (every Newton iteration, every
 * time step) while only the VALUES change, so this is computed ONCE per structure and reused — see
 * SparseSession. The order depends only on the pattern, never the values, so reusing it across solves
 * whose values (or even whose pattern, slightly — a transistor switching region) drift is always a valid
 * factorization; a drifted pattern just makes the fixed order marginally sub-optimal, never wrong.
 */
export type SparseOrder = { order: number[]; inverse: number[] }

/**
 * The symbolic analysis: derive a fill-reducing (minimum-degree) elimination order from A's nonzero
 * pattern. This is the majority of a sparse solve's cost (two O(n²) structure scans + the ordering), and
 * it depends only on WHICH entries are nonzero — so a simulation computes it once and reuses it for every
 * subsequent solve of the same circuit (SparseSession), leaving only the cheap numeric factor per solve.
 */
export function computeOrder(A: DenseMatrix): SparseOrder {
  const n = A.size
  // Symmetric nonzero structure (the elimination graph).
  const adjacency: Set<number>[] = Array.from({ length: n }, () => new Set<number>())
  for (let i = 0; i < n; i++) {
    const base = i * n
    for (let j = 0; j < n; j++) {
      if (i !== j && A.data[base + j] !== 0) {
        ;(adjacency[i] as Set<number>).add(j)
        ;(adjacency[j] as Set<number>).add(i)
      }
    }
  }
  // Flag structurally-zero diagonals (ideal voltage-source rows) so the order defers them past the
  // nonzero-diagonal node rows — otherwise the no-pivot factor bails on a zero pivot at the first such row.
  const zeroDiagonal = new Array<boolean>(n)
  for (let i = 0; i < n; i++) zeroDiagonal[i] = Math.abs(A.data[i * n + i] as number) <= PIVOT_FLOOR
  const order = minimumDegreeOrder(adjacency, zeroDiagonal)
  const inverse = new Array<number>(n)
  for (let k = 0; k < n; k++) inverse[order[k] as number] = k
  return { order, inverse }
}

/**
 * A completed sparse LU factorisation, ready to solve for any right-hand side. `rowCol[k]`/`rowVal[k]`
 * hold permuted row k's column indices and values after fill (the L multipliers below the diagonal, the
 * U entries on and above it); `order` is the elimination permutation. Reusable: a linear transient's
 * matrix is identical at every time step, so this is built once and only re-solved (solveFactor) per step.
 */
export type SparseFactor = {
  order: number[]
  rowCol: number[][]
  rowVal: number[][]
}

/**
 * Where each permuted row's ORIGINAL nonzeros live in A — parallel `cols` (permuted column index) and
 * `srcs` (flat index into A.data). Built once per structure (SparseSession) so a residual check can read
 * A·x in O(nonzeros) instead of an O(n²) dense scan. Values are read fresh from A.data through `srcs`, so
 * a value drift is caught; a PATTERN that grew past analysis (a nonlinear device switching on) is only
 * under-checked, which is safe — factorize scans the FULL current A, so its factor is correct at the new
 * positions too, and a genuinely garbage factor is wrong at the checked positions and still caught.
 */
type GatherMap = { cols: number[]; srcs: number[] }[]

/** The gather map for a fixed structure + order — computed once, reused for every solve of that circuit. */
export function computeGather(A: DenseMatrix, ord: SparseOrder): GatherMap {
  const n = A.size
  const { order, inverse } = ord
  const gather: GatherMap = Array.from({ length: n }, () => ({ cols: [], srcs: [] }))
  for (let k = 0; k < n; k++) {
    const oi = order[k] as number
    const base = oi * n
    const gk = gather[k] as { cols: number[]; srcs: number[] }
    for (let oj = 0; oj < n; oj++) {
      if (A.data[base + oj] !== 0) {
        gk.cols.push(inverse[oj] as number)
        gk.srcs.push(base + oj)
      }
    }
  }
  return gather
}

/**
 * Factor A into L·U by sparse Gaussian elimination (Doolittle) under a fill-reducing order — the SAME
 * elimination as before on TYPED-ARRAY rows with a dense accumulator, split out from the solve so the
 * factor can be REUSED across right-hand sides (a linear transient re-solves it every step). Reads the
 * current A by a full scan, so it is always robust to a nonlinear device's nonzero pattern shifting.
 * Returns null — fall back to dense — on a zero/tiny pivot or fill growing dense. A is not mutated.
 */
export function factorize(A: DenseMatrix, ord: SparseOrder): SparseFactor | null {
  const n = A.size
  const { order, inverse } = ord

  // Permuted rows P·A·Pᵀ (parallel col/val arrays) + per-column occupancy (rows holding a nonzero per col).
  const rowCol: number[][] = Array.from({ length: n }, () => [])
  const rowVal: number[][] = Array.from({ length: n }, () => [])
  let nnz = 0
  for (let k = 0; k < n; k++) {
    const oi = order[k] as number
    const base = oi * n
    const rc = rowCol[k] as number[]
    const rv = rowVal[k] as number[]
    for (let oj = 0; oj < n; oj++) {
      const v = A.data[base + oj] as number
      if (v !== 0) {
        rc.push(inverse[oj] as number)
        rv.push(v)
      }
    }
  }
  const colRows: number[][] = Array.from({ length: n }, () => [])
  for (let k = 0; k < n; k++) {
    const rc = rowCol[k] as number[]
    nnz += rc.length
    for (let t = 0; t < rc.length; t++) (colRows[rc[t] as number] as number[]).push(k)
  }
  // If the factor fills past this many nonzeros it is effectively dense — bail to dense, which is faster.
  const fillCap = Math.max(n * 16, Math.floor((n * n) / 2))

  // Sparse LU with a DENSE ACCUMULATOR. mark[c] === k tags work[c] as live for step k.
  const work = new Float64Array(n)
  const mark = new Int32Array(n).fill(-1)
  for (let k = 0; k < n; k++) {
    const ck = rowCol[k] as number[]
    const vk = rowVal[k] as number[]
    let pivot = 0
    for (let t = 0; t < ck.length; t++)
      if (ck[t] === k) {
        pivot = vk[t] as number
        break
      }
    if (Math.abs(pivot) <= PIVOT_FLOOR) return null
    const colK = colRows[k] as number[]
    for (let p = 0; p < colK.length; p++) {
      const i = colK[p] as number
      if (i <= k) continue
      const ci = rowCol[i] as number[]
      const vi = rowVal[i] as number[]
      // scatter row i into work
      for (let t = 0; t < ci.length; t++) {
        const c = ci[t] as number
        work[c] = vi[t] as number
        mark[c] = k
      }
      const factor = (work[k] as number) / pivot
      // eliminate against the pivot row's U part (j > k), tracking fill-in
      for (let t = 0; t < ck.length; t++) {
        const j = ck[t] as number
        if (j <= k) continue
        if (mark[j] !== k) {
          work[j] = 0
          mark[j] = k
          ci.push(j)
          ;(colRows[j] as number[]).push(i)
          if (++nnz > fillCap) return null
        }
        work[j] = (work[j] as number) - factor * (vk[t] as number)
      }
      work[k] = factor // L below the diagonal
      // gather work[] back into row i (pattern = ci, possibly grown) and clear the markers
      for (let t = 0; t < ci.length; t++) {
        const c = ci[t] as number
        vi[t] = work[c] as number
        mark[c] = -1
      }
      vi.length = ci.length
    }
  }
  return { order, rowCol, rowVal }
}

/**
 * Solve L·U·x = b for a completed factor and a right-hand side: a forward solve (unit-L) then a back solve
 * (U) over the sparse rows, then un-permuted. O(nonzeros) — this is the cheap per-step operation a reused
 * factor makes possible. Returns null (→ dense) on a zero U diagonal or a non-finite result.
 */
export function solveFactor(f: SparseFactor, b: DenseVector): DenseVector | null {
  const { order, rowCol, rowVal } = f
  const n = order.length
  const rhs = new Float64Array(n)
  for (let k = 0; k < n; k++) rhs[k] = b.data[order[k] as number] as number

  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const ci = rowCol[i] as number[]
    const vi = rowVal[i] as number[]
    let sum = rhs[i] as number
    for (let t = 0; t < ci.length; t++) {
      const j = ci[t] as number
      if (j < i) sum -= (vi[t] as number) * (y[j] as number)
    }
    y[i] = sum
  }
  const xPermuted = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    const ci = rowCol[i] as number[]
    const vi = rowVal[i] as number[]
    let sum = y[i] as number
    let diagonal = 0
    for (let t = 0; t < ci.length; t++) {
      const j = ci[t] as number
      if (j > i) sum -= (vi[t] as number) * (xPermuted[j] as number)
      else if (j === i) diagonal = vi[t] as number
    }
    if (diagonal === 0) return null
    xPermuted[i] = sum / diagonal
  }

  const x = new DenseVector(n)
  for (let k = 0; k < n; k++) {
    const xk = xPermuted[k] as number
    if (!Number.isFinite(xk)) return null
    x.data[order[k] as number] = xk
  }
  return x
}

/**
 * Solve A·x = b via a one-shot sparse factor + solve. `precomputed` reuses a SparseSession's order to skip
 * the O(n²) symbolic analysis. Returns null (→ dense) whenever the sparse factor bails. A and b unchanged.
 */
export function sparseSolve(
  A: DenseMatrix,
  b: DenseVector,
  precomputed?: SparseOrder,
): DenseVector | null {
  const n = A.size
  if (n === 0) return new DenseVector(0)
  const f = factorize(A, precomputed ?? computeOrder(A))
  if (f === null) return null
  return solveFactor(f, b)
}

/** Relative residual ‖A·x − b‖∞, scaled the same way dense-linear scales its consistency check. */
function residualWithinTolerance(A: DenseMatrix, b: DenseVector, x: DenseVector): boolean {
  const n = A.size
  let maxResidual = 0
  let aNorm = 0
  let xNorm = 0
  let bNorm = 0
  for (let i = 0; i < n; i++) {
    const base = i * n
    let dot = 0
    let rowAbsSum = 0
    for (let j = 0; j < n; j++) {
      const aij = A.data[base + j] as number
      dot += aij * (x.data[j] as number)
      rowAbsSum += Math.abs(aij)
    }
    maxResidual = Math.max(maxResidual, Math.abs(dot - (b.data[i] as number)))
    aNorm = Math.max(aNorm, rowAbsSum)
    xNorm = Math.max(xNorm, Math.abs(x.data[i] as number))
    bNorm = Math.max(bNorm, Math.abs(b.data[i] as number))
  }
  const scale = Math.max(aNorm * xNorm + bNorm, 1)
  return maxResidual <= RESIDUAL_TOLERANCE * scale
}

/**
 * The same relative-residual check, but O(nonzeros) — it visits only the analysed nonzero positions
 * (via the gather map) instead of scanning the full n² dense matrix. This is what keeps a reused-factor
 * solve (a linear transient step) O(nonzeros) end to end; the dense check would put an O(n²) tax back on
 * every step. Safe as a verifier: it reads A's CURRENT values through `gather.srcs`, so a value change is
 * caught; a garbage factor is wrong at these positions too, so it is caught; only nonzeros that appeared
 * AFTER analysis go unchecked, and those are already handled correctly by factorize's full-A scan.
 */
function sparseResidualWithinTolerance(
  A: DenseMatrix,
  b: DenseVector,
  x: DenseVector,
  order: number[],
  gather: GatherMap,
): boolean {
  const n = order.length
  let maxResidual = 0
  let aNorm = 0
  let xNorm = 0
  let bNorm = 0
  for (let k = 0; k < n; k++) {
    const gk = gather[k] as { cols: number[]; srcs: number[] }
    let dot = 0
    let rowAbsSum = 0
    for (let t = 0; t < gk.cols.length; t++) {
      const aij = A.data[gk.srcs[t] as number] as number
      const originalCol = order[gk.cols[t] as number] as number
      dot += aij * (x.data[originalCol] as number)
      rowAbsSum += Math.abs(aij)
    }
    maxResidual = Math.max(maxResidual, Math.abs(dot - (b.data[order[k] as number] as number)))
    aNorm = Math.max(aNorm, rowAbsSum)
  }
  for (let i = 0; i < n; i++) {
    xNorm = Math.max(xNorm, Math.abs(x.data[i] as number))
    bNorm = Math.max(bNorm, Math.abs(b.data[i] as number))
  }
  const scale = Math.max(aNorm * xNorm + bNorm, 1)
  return maxResidual <= RESIDUAL_TOLERANCE * scale
}

/**
 * Per-structure dispatch memo. A circuit's nonzero STRUCTURE is fixed across the many solves one
 * simulation runs (Newton iterations, time steps) — only the values change — so we measure sparse vs
 * dense ONCE per distinct structure and reuse the faster verdict. This is what lets sparse be turned on
 * for ALL circuits safely: it engages only where it actually wins (analog meshes/rails) and stays out of
 * the way where it doesn't (large digital, which the no-pivot factor can't beat). Affects SPEED only —
 * every sparse result is still residual-checked, so a wrong factor can never escape regardless of verdict.
 */
const dispatchVerdict = new Map<string, 'sparse' | 'dense'>()
const DISPATCH_CACHE_CAP = 512

/** Test-only: forget all measured verdicts so a test can observe a fresh calibration. */
export function resetDispatchMemo(): void {
  dispatchVerdict.clear()
}

/**
 * A signature of the nonzero PATTERN (size + count + an FNV-1a hash of the nonzero positions). The values
 * change between solves; the pattern does not, so the same circuit keys consistently. O(n²) — negligible
 * beside the O(n³)/fill factor it gates, and only computed for n ≥ SPARSE_THRESHOLD. Distinct structures
 * get distinct keys; if a pattern shifts (a switch opens), it simply re-calibrates.
 */
function structureKey(A: DenseMatrix): string {
  const n = A.size
  let h = 0x811c9dc5 | 0
  let nnz = 0
  for (let i = 0; i < n; i++) {
    const base = i * n
    for (let j = 0; j < n; j++) {
      if (A.data[base + j] !== 0) {
        nnz++
        h = Math.imul(h ^ (i & 0xffff), 0x01000193)
        h = Math.imul(h ^ (j & 0xffff), 0x01000193)
      }
    }
  }
  return `${n}:${nnz}:${h >>> 0}`
}

/**
 * Solve A·x = b — the sparse fast path with a dense correctness backstop AND a speed backstop. Drop-in
 * for dense-linear's lusolve (same DenseMatrix/DenseVector API), so swapping the solvers' import is a
 * one-line change. Small systems go straight to dense. For larger ones, the first time a structure is
 * seen both paths are timed and the faster is remembered; thereafter that structure takes the winning
 * path directly. A sparse verdict that later stops factoring (values drifted) downgrades itself to dense.
 */
export function lusolve(A: DenseMatrix, b: DenseVector): DenseVector {
  if (A.size < SPARSE_THRESHOLD) return denseLusolve(A, b)

  const key = structureKey(A)
  const verdict = dispatchVerdict.get(key)

  if (verdict === 'dense') return denseLusolve(A, b)

  if (verdict === 'sparse') {
    const x = sparseSolve(A, b)
    if (x !== null && residualWithinTolerance(A, b, x)) return x
    dispatchVerdict.set(key, 'dense') // sparse no longer factors this structure — stop paying for it
    return denseLusolve(A, b)
  }

  // First sighting of this structure: measure both, keep the faster, remember the verdict.
  const sparseStart = performance.now()
  const xSparse = sparseSolve(A, b)
  const sparseOk = xSparse !== null && residualWithinTolerance(A, b, xSparse)
  const sparseMs = performance.now() - sparseStart
  const denseStart = performance.now()
  const xDense = denseLusolve(A, b)
  const denseMs = performance.now() - denseStart

  if (dispatchVerdict.size >= DISPATCH_CACHE_CAP) dispatchVerdict.clear()
  if (sparseOk && sparseMs < denseMs) {
    dispatchVerdict.set(key, 'sparse')
    return xSparse as DenseVector
  }
  dispatchVerdict.set(key, 'dense')
  return xDense
}

/**
 * A per-simulation sparse solver: reuses the fill-reducing ORDER across the many solves one circuit runs
 * (every Newton iteration, every time step) and decides sparse-vs-dense ONCE, so the O(n²) symbolic
 * analysis and the sparse/dense race are each paid a single time instead of on every solve. This is what
 * makes sparse a net win in the ITERATED context a single-solve benchmark hides: measured on a 1024-node
 * mesh, the reusable symbolic analysis is ~70% of a sparse solve, so hoisting it out of the loop leaves
 * only the numeric factor to pay per iteration, and its residual is checked in O(nonzeros), not O(n²).
 * Deciding the dispatch once also removes the per-solve thrash that made the stateless drop-in REGRESS
 * large nonlinear digital circuits: their nonzero pattern shifts as transistors switch region, so a
 * per-call structure memo never caches and re-times sparse+dense every iteration.
 *
 * Two reuse levels: the ORDER (always, across every solve of the structure), and — when the caller passes
 * `constantMatrix` — the whole numeric FACTOR. A LINEAR transient's matrix is IDENTICAL at every time step
 * (backward-Euler puts the capacitor/inductor history and the source waveform in the right-hand side, not
 * the matrix), so it is factored ONCE and every step is a bare O(nonzeros) forward/back solve. The reused
 * factor is still residual-checked each step, so a wrong "constant" hint is caught and re-factored, never
 * wrong.
 *
 * Correctness is unconditional and identical to the dense solver: every sparse result is residual-checked,
 * and anything short of a provable win (a tiny pivot, a drifted pattern the reused order no longer factors,
 * a non-finite value, or simply "dense measured faster") falls back to `denseLusolve` — which still owns
 * the singular / floating-node / inconsistent cases and its throw-on-inconsistent contract. Use ONE
 * session per solveDC / solveTransient: the matrix STRUCTURE (and thus size) is constant within each.
 */
export class SparseSession {
  private order: SparseOrder | null = null
  private gather: GatherMap | null = null
  private factor: SparseFactor | null = null
  private verdict: 'sparse' | 'dense' | undefined
  private orderSize = -1

  /**
   * Solve A·x = b, reusing this session's order (and, when `constantMatrix` is true, its numeric factor).
   * Delegates to the dense solver (which may throw on an inconsistent system, exactly like a direct dense
   * call) whenever sparse can't provably win — so `session.solve(M, b)` behaves like `lusolve(M, b)`.
   *
   * Pass `constantMatrix: true` only when A is guaranteed identical to the previous solve's (a linear
   * transient step). It is a HINT, not a promise — the reused factor's residual is verified, and a miss
   * simply re-factors — so an over-eager hint costs one wasted solve, never correctness.
   */
  solve(A: DenseMatrix, b: DenseVector, constantMatrix = false): DenseVector {
    const n = A.size
    if (n < SPARSE_THRESHOLD) return denseLusolve(A, b)

    // The order + gather are tied to the structure; recompute them on the first solve or if the size ever
    // changes (it shouldn't within one simulation). A size change invalidates the verdict + stored factor.
    if (this.order === null || this.orderSize !== n) {
      this.order = computeOrder(A)
      this.gather = computeGather(A, this.order)
      this.orderSize = n
      this.verdict = undefined
      this.factor = null
    }

    if (this.verdict === 'dense') return denseLusolve(A, b)

    if (this.verdict === 'sparse') {
      const x = this.attemptSparse(A, b, constantMatrix)
      if (x !== null) return x
      this.verdict = 'dense' // the reused order stopped factoring this structure — stop paying for it
      this.factor = null
      return denseLusolve(A, b)
    }

    // First solve of this structure: race the numeric sparse path (reusing the just-computed order — so
    // this compares the per-ITERATION costs, not the one-time symbolic setup) against dense; keep the winner.
    const sparseStart = performance.now()
    const xSparse = this.attemptSparse(A, b, constantMatrix)
    const sparseMs = performance.now() - sparseStart
    const denseStart = performance.now()
    const xDense = denseLusolve(A, b)
    const denseMs = performance.now() - denseStart
    if (xSparse !== null && sparseMs < denseMs) {
      this.verdict = 'sparse'
      return xSparse
    }
    this.verdict = 'dense'
    this.factor = null
    return xDense
  }

  /**
   * A residual-verified sparse solution, or null → fall back to dense. Reuses the stored factor when the
   * caller guarantees the matrix is unchanged (a linear transient step); otherwise factors afresh from a
   * full scan of the current A (robust to a nonlinear device's pattern shifting). The residual is the
   * O(nonzeros) gather-based check either way.
   */
  private attemptSparse(
    A: DenseMatrix,
    b: DenseVector,
    constantMatrix: boolean,
  ): DenseVector | null {
    const order = this.order as SparseOrder
    const gather = this.gather as GatherMap
    if (constantMatrix && this.factor !== null) {
      const reused = solveFactor(this.factor, b)
      if (reused !== null && sparseResidualWithinTolerance(A, b, reused, order.order, gather))
        return reused
      this.factor = null // the stored factor no longer solves this matrix (A changed) — refactor below
    }
    const f = factorize(A, order)
    if (f === null) return null
    const x = solveFactor(f, b)
    if (x === null || !sparseResidualWithinTolerance(A, b, x, order.order, gather)) return null
    if (constantMatrix) this.factor = f // keep it for the next unchanged-matrix step
    return x
  }
}
