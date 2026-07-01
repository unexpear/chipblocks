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
 * Solve A·x = b by sparse Gaussian elimination (Doolittle LU) under a minimum-degree ordering — the
 * SAME elimination as before, but on TYPED-ARRAY rows with a dense accumulator instead of per-element
 * Maps/Sets, so the hot loop has no hashing. Each row is parallel `cols`/`vals` arrays; eliminating a
 * row scatters it into a reused `work` Float64Array (O(1) accesses), applies the pivot row, and gathers
 * the grown pattern back. Returns null — a signal to fall back to dense — on a zero/tiny pivot, on
 * fill-in growing dense (sparse wouldn't beat dense then), or any non-finite result. A and b not mutated.
 *
 * `precomputed` supplies a reusable order (SparseSession) so the O(n²) symbolic analysis is skipped —
 * the whole point of the session. Omitted, the order is computed here (a self-contained one-shot solve).
 */
export function sparseSolve(
  A: DenseMatrix,
  b: DenseVector,
  precomputed?: SparseOrder,
): DenseVector | null {
  const n = A.size
  if (n === 0) return new DenseVector(0)

  // 1. Fill-reducing order — reused from the session, or computed for this one-shot solve.
  const { order, inverse } = precomputed ?? computeOrder(A)

  // 2. Permuted system P·A·Pᵀ as per-row TYPED sparse rows (parallel col/val arrays) + per-column
  //    occupancy (which rows hold a nonzero in each column, kept current as fill appears).
  const rowCol: number[][] = Array.from({ length: n }, () => [])
  const rowVal: number[][] = Array.from({ length: n }, () => [])
  const rhs = new Float64Array(n)
  let nnz = 0
  for (let k = 0; k < n; k++) {
    const oi = order[k] as number
    rhs[k] = b.data[oi] as number
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

  // 3. Sparse LU with a DENSE ACCUMULATOR. mark[c] === k tags work[c] as live for step k.
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

  // 4. Forward solve (L·y = rhs, unit L diagonal) then back solve (U·x' = y) over the sparse rows.
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

  // 5. Un-permute (x[order[k]] = x'[k]) with a finite-result guard.
  const x = new DenseVector(n)
  for (let k = 0; k < n; k++) {
    const xk = xPermuted[k] as number
    if (!Number.isFinite(xk)) return null
    x.data[order[k] as number] = xk
  }
  return x
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
 * only the numeric factor — already several times faster than the dense factor — to pay per iteration.
 * Deciding the dispatch once also removes the per-solve thrash that made the stateless drop-in REGRESS
 * large nonlinear digital circuits: their nonzero pattern shifts as transistors switch region, so a
 * per-call structure memo never caches and re-times sparse+dense every iteration.
 *
 * Correctness is unconditional and identical to the dense solver: every sparse result is residual-checked,
 * and anything short of a provable win (a tiny pivot, a drifted pattern the reused order no longer factors,
 * a non-finite value, or simply "dense measured faster") falls back to `denseLusolve` — which still owns
 * the singular / floating-node / inconsistent cases and its throw-on-inconsistent contract. Use ONE
 * session per solveDC / solveTransient: the matrix STRUCTURE (and thus size) is constant within each.
 */
export class SparseSession {
  private order: SparseOrder | null = null
  private verdict: 'sparse' | 'dense' | undefined
  private orderSize = -1

  /**
   * Solve A·x = b, reusing this session's order + dispatch verdict. Delegates to the dense solver (which
   * may throw on an inconsistent system, exactly like a direct dense call) whenever sparse can't provably
   * win — so a caller can swap `lusolve(M, b)` for `session.solve(M, b)` with no change in behaviour.
   */
  solve(A: DenseMatrix, b: DenseVector): DenseVector {
    const n = A.size
    if (n < SPARSE_THRESHOLD) return denseLusolve(A, b)

    // The order is tied to the structure; recompute it if this is the first solve or the size ever changes
    // (it shouldn't within one simulation). A size change invalidates the remembered verdict too.
    if (this.order === null || this.orderSize !== n) {
      this.order = computeOrder(A)
      this.orderSize = n
      this.verdict = undefined
    }

    if (this.verdict === 'dense') return denseLusolve(A, b)

    if (this.verdict === 'sparse') {
      const x = sparseSolve(A, b, this.order)
      if (x !== null && residualWithinTolerance(A, b, x)) return x
      this.verdict = 'dense' // the reused order stopped factoring this structure — stop paying for it
      return denseLusolve(A, b)
    }

    // First solve of this structure: race the numeric sparse factor (reusing the just-computed order — so
    // this compares the per-ITERATION costs, not the one-time symbolic setup) against dense; keep the winner.
    const sparseStart = performance.now()
    const xSparse = sparseSolve(A, b, this.order)
    const sparseOk = xSparse !== null && residualWithinTolerance(A, b, xSparse)
    const sparseMs = performance.now() - sparseStart
    const denseStart = performance.now()
    const xDense = denseLusolve(A, b)
    const denseMs = performance.now() - denseStart
    if (sparseOk && sparseMs < denseMs) {
      this.verdict = 'sparse'
      return xSparse as DenseVector
    }
    this.verdict = 'dense'
    return xDense
  }
}
