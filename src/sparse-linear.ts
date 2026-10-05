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
 * How many CONSECUTIVE sparse misses (no usable pivot, or a residual the check rejects) a session absorbs
 * — answering each from dense — before it decides the structure no longer factors and goes dense for
 * good. Large enough that an isolated near-singular Newton iterate does not forfeit the rest of the solve,
 * small enough that a structure which never factors stops paying for the attempt almost at once.
 */
const SPARSE_MISS_LIMIT = 3

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
 * pattern. `deferZeroDiagonal` (the default) pushes structurally-zero-diagonal rows to the end — what the
 * no-pivot factor needs and nothing else does: the pivoted factor takes the PLAIN order, because deferring
 * every wire row and wire-only net past the rest is exactly what fills a rail-heavy netlist in (measured on
 * a 4,002-unknown rail-and-wire netlist: 2.5 M factor entries deferred vs 9,600 plain). This is the majority of a sparse solve's cost (two O(n²) structure scans + the ordering), and
 * it depends only on WHICH entries are nonzero — so a simulation computes it once and reuses it for every
 * subsequent solve of the same circuit (SparseSession), leaving only the cheap numeric factor per solve.
 */
export function computeOrder(A: DenseMatrix, deferZeroDiagonal = true): SparseOrder {
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
  const order = minimumDegreeOrder(adjacency, deferZeroDiagonal ? zeroDiagonal : undefined)
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
 * Threshold for partial pivoting in the pivoted factor: a candidate pivot is acceptable when its
 * magnitude is at least this fraction of the largest entry in its column. 0.1 is the conventional
 * sparse-LU compromise (UMFPACK's default) — it keeps element growth bounded like full partial pivoting
 * while leaving room to prefer the diagonal / the sparsest row, which keeps the fill small.
 */
const PIVOT_THRESHOLD = 0.1

/**
 * A sparse LU factorisation WITH row pivoting — the factor the no-pivot `factorize` cannot produce for a
 * real transistor netlist. Measured on the built-in hex → 7-segment decoder (722 MOSFETs, 4,026 MNA
 * unknowns): 2,582 rows have a structurally ZERO diagonal (every ideal wire, switch and supply is an
 * aux branch row, and a net reached only by wires and MOSFET gates has no conductance of its own). The
 * diagonal-deferral order cannot fill all of them, so the no-pivot factor bailed at the first one and the
 * WHOLE solve fell back to dense Gaussian elimination: ~90% of the decoder's wall time was that dense
 * factor, every Newton iteration.
 *
 * This eliminates columns in a plain minimum-degree order (computeOrder with no zero-diagonal deferral)
 * and picks each pivot ROW at factor time (threshold partial pivoting, preferring the diagonal and then
 * the sparsest acceptable row), so a zero diagonal is simply pivoted around instead of forfeiting the
 * circuit to dense. Every index stored here is an
 * ORIGINAL row / column number:
 *   - step k eliminates column `colOrder[k]` using original row `pivotRow[k]`;
 *   - its L multipliers are rows `lRow[lPtr[k] .. lPtr[k+1])` (each subtracts `lVal ×` the pivot row);
 *   - its U row is the pivot row's entries in LATER columns, `uCol/uVal[uPtr[k] .. uPtr[k+1])`, plus the
 *     pivot value `uDiag[k]`;
 *   - `aPtr/aCol` is the CSR pattern of the A that was factored, so the residual check can read A·x in
 *     O(nonzeros) from A's CURRENT values (a reused factor is therefore still verified exactly).
 */
export type PivotedFactor = {
  colOrder: number[]
  pivotRow: Int32Array
  lPtr: Int32Array
  lRow: Int32Array
  lVal: Float64Array
  uPtr: Int32Array
  uCol: Int32Array
  uVal: Float64Array
  uDiag: Float64Array
  aPtr: Int32Array
  aCol: Int32Array
}

/**
 * Right-looking sparse Gaussian elimination under a fixed column order with threshold partial pivoting.
 * Returns null — fall back to dense, which owns the singular / floating-node cases — when a column has no
 * usable pivot (all candidates ≤ PIVOT_FLOOR: a floating net or a genuinely singular system) or the fill
 * grows dense. A is not mutated.
 */
export function factorizePivoted(
  A: DenseMatrix,
  colOrder: readonly number[],
): PivotedFactor | null {
  const n = A.size
  const rowCol: number[][] = new Array<number[]>(n)
  const rowVal: number[][] = new Array<number[]>(n)
  const colRows: number[][] = Array.from({ length: n }, () => [])
  const aPtr = new Int32Array(n + 1)
  const aColList: number[] = []
  for (let i = 0; i < n; i++) {
    const base = i * n
    const rc: number[] = []
    const rv: number[] = []
    for (let j = 0; j < n; j++) {
      const v = A.data[base + j] as number
      if (v !== 0) {
        rc.push(j)
        rv.push(v)
        aColList.push(j)
        ;(colRows[j] as number[]).push(i)
      }
    }
    rowCol[i] = rc
    rowVal[i] = rv
    aPtr[i + 1] = aColList.length
  }
  let nnz = aColList.length
  // Past this many stored entries the factor is effectively dense — bail, dense is faster there.
  const fillCap = Math.max(n * 16, Math.floor((n * n) / 2))

  const active = new Uint8Array(n).fill(1)
  const seen = new Int32Array(n).fill(-1)
  const work = new Float64Array(n)
  const mark = new Int32Array(n).fill(-1)
  let stamp = -1
  const pivotRow = new Int32Array(n)
  const uDiag = new Float64Array(n)
  const lPtr = new Int32Array(n + 1)
  const uPtr = new Int32Array(n + 1)
  const lRowList: number[] = []
  const lValList: number[] = []
  const uColList: number[] = []
  const uValList: number[] = []
  const candRow: number[] = []
  const candVal: number[] = []

  for (let k = 0; k < n; k++) {
    const c = colOrder[k] as number
    // Candidates: every still-active row holding an entry in column c.
    candRow.length = 0
    candVal.length = 0
    let maxAbs = 0
    const rowsOfC = colRows[c] as number[]
    for (let t = 0; t < rowsOfC.length; t++) {
      const i = rowsOfC[t] as number
      if (active[i] === 0 || seen[i] === k) continue
      seen[i] = k
      const ci = rowCol[i] as number[]
      let v = 0
      for (let s = 0; s < ci.length; s++) {
        if (ci[s] === c) {
          v = (rowVal[i] as number[])[s] as number
          break
        }
      }
      candRow.push(i)
      candVal.push(v)
      const mag = Math.abs(v)
      if (mag > maxAbs) maxAbs = mag
    }
    // No usable pivot (also catches NaN): a floating / singular column — dense handles it specially.
    if (!(maxAbs > PIVOT_FLOOR)) return null

    // Pivot choice: the diagonal row when it is acceptable (keeps the symmetric order's fill estimate
    // honest), else the sparsest acceptable row, ties to the larger magnitude.
    const threshold = PIVOT_THRESHOLD * maxAbs
    let pick = -1
    for (let t = 0; t < candRow.length; t++) {
      if (candRow[t] === c && Math.abs(candVal[t] as number) >= threshold) {
        pick = t
        break
      }
    }
    if (pick < 0) {
      let bestLen = Number.POSITIVE_INFINITY
      let bestMag = 0
      for (let t = 0; t < candRow.length; t++) {
        const mag = Math.abs(candVal[t] as number)
        if (mag < threshold) continue
        const len = (rowCol[candRow[t] as number] as number[]).length
        if (len < bestLen || (len === bestLen && mag > bestMag)) {
          bestLen = len
          bestMag = mag
          pick = t
        }
      }
    }
    const p = candRow[pick] as number
    const pivot = candVal[pick] as number
    active[p] = 0
    pivotRow[k] = p
    uDiag[k] = pivot
    const cp = rowCol[p] as number[]
    const vp = rowVal[p] as number[]
    for (let s = 0; s < cp.length; s++) {
      if (cp[s] === c) continue
      uColList.push(cp[s] as number)
      uValList.push(vp[s] as number)
    }
    uPtr[k + 1] = uColList.length

    // Eliminate column c from every other candidate row, dropping c from its pattern.
    for (let t = 0; t < candRow.length; t++) {
      if (t === pick) continue
      const i = candRow[t] as number
      const vic = candVal[t] as number
      const ci = rowCol[i] as number[]
      const vi = rowVal[i] as number[]
      if (vic !== 0) {
        const factor = vic / pivot
        lRowList.push(i)
        lValList.push(factor)
        stamp++
        for (let s = 0; s < ci.length; s++) {
          const j = ci[s] as number
          work[j] = vi[s] as number
          mark[j] = stamp
        }
        for (let s = 0; s < cp.length; s++) {
          const j = cp[s] as number
          if (j === c) continue
          if (mark[j] !== stamp) {
            work[j] = 0
            mark[j] = stamp
            ci.push(j)
            ;(colRows[j] as number[]).push(i)
            if (++nnz > fillCap) return null
          }
          work[j] = (work[j] as number) - factor * (vp[s] as number)
        }
        let w = 0
        for (let s = 0; s < ci.length; s++) {
          const j = ci[s] as number
          if (j === c) continue
          ci[w] = j
          vi[w] = work[j] as number
          w++
        }
        ci.length = w
        vi.length = w
      } else {
        // An exact-zero entry left in the pattern by cancellation: drop it so an eliminated column
        // never reappears in a later U row.
        let w = 0
        for (let s = 0; s < ci.length; s++) {
          if (ci[s] === c) continue
          ci[w] = ci[s] as number
          vi[w] = vi[s] as number
          w++
        }
        ci.length = w
        vi.length = w
      }
    }
    lPtr[k + 1] = lRowList.length
  }
  return {
    colOrder: [...colOrder],
    pivotRow,
    lPtr,
    lRow: Int32Array.from(lRowList),
    lVal: Float64Array.from(lValList),
    uPtr,
    uCol: Int32Array.from(uColList),
    uVal: Float64Array.from(uValList),
    uDiag,
    aPtr,
    aCol: Int32Array.from(aColList),
  }
}

/**
 * Solve with a pivoted factor: replay the row eliminations on b (forward), then back-substitute the U
 * rows in reverse elimination order. O(nonzeros of L + U). Null (→ dense) on a non-finite result.
 */
export function solvePivoted(f: PivotedFactor, b: DenseVector): DenseVector | null {
  const n = f.colOrder.length
  const y = Float64Array.from(b.data)
  for (let k = 0; k < n; k++) {
    const yp = y[f.pivotRow[k] as number] as number
    if (yp === 0) continue
    const end = f.lPtr[k + 1] as number
    for (let t = f.lPtr[k] as number; t < end; t++) {
      const i = f.lRow[t] as number
      y[i] = (y[i] as number) - (f.lVal[t] as number) * yp
    }
  }
  const x = new DenseVector(n)
  for (let k = n - 1; k >= 0; k--) {
    let sum = y[f.pivotRow[k] as number] as number
    const end = f.uPtr[k + 1] as number
    for (let t = f.uPtr[k] as number; t < end; t++) {
      sum -= (f.uVal[t] as number) * (x.data[f.uCol[t] as number] as number)
    }
    const xk = sum / (f.uDiag[k] as number)
    if (!Number.isFinite(xk)) return null
    x.data[f.colOrder[k] as number] = xk
  }
  return x
}

/**
 * One step of iterative refinement on a pivoted solve. Threshold partial pivoting (PIVOT_THRESHOLD)
 * keeps fill small but lets element growth on an ill-conditioned Newton linearisation put the first
 * solve several ulps (measured: ~1e-4 V) away from the dense answer — still a tiny residual, so the
 * residual check accepts it, but stiff diode Newton then wanders for a thousand passes. One
 * correction (r = b − A·x, solve A·d = r with the same factor, x += d) recovers the dense-quality
 * answer; measured on the multiplexed LED-matrix row that used to forfeit to dense: with refinement
 * the pivoted path converges in 31 Newton passes to the same 9.2 mA operating point. O(nonzeros).
 */
function refinePivoted(
  A: DenseMatrix,
  b: DenseVector,
  f: PivotedFactor,
  x: DenseVector,
): DenseVector | null {
  const n = A.size
  const r = new DenseVector(n)
  for (let i = 0; i < n; i++) {
    const base = i * n
    let dot = 0
    const end = f.aPtr[i + 1] as number
    for (let t = f.aPtr[i] as number; t < end; t++) {
      const j = f.aCol[t] as number
      dot += (A.data[base + j] as number) * (x.data[j] as number)
    }
    r.data[i] = (b.data[i] as number) - dot
  }
  const d = solvePivoted(f, r)
  if (d === null) return null
  for (let i = 0; i < n; i++) x.data[i] = (x.data[i] as number) + (d.data[i] as number)
  return x
}

/**
 * The relative residual ‖A·x − b‖∞ check (same scale as dense-linear's), over the CSR pattern a pivoted
 * factor recorded — O(nonzeros), reading A's CURRENT values, so a reused factor whose matrix changed is
 * caught. Entries that appeared in A after the factor was built are not visited; a reused factor is only
 * ever offered under the caller's constant-matrix hint, and a fresh factor's pattern is A's exact pattern.
 */
function pivotedResidualWithinTolerance(
  A: DenseMatrix,
  b: DenseVector,
  x: DenseVector,
  f: PivotedFactor,
): boolean {
  const n = A.size
  let maxResidual = 0
  let aNorm = 0
  let xNorm = 0
  let bNorm = 0
  for (let i = 0; i < n; i++) {
    const base = i * n
    let dot = 0
    let rowAbsSum = 0
    const end = f.aPtr[i + 1] as number
    for (let t = f.aPtr[i] as number; t < end; t++) {
      const j = f.aCol[t] as number
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
/**
 * How far a sparse answer may sit from the dense race partner and still be remembered as this
 * structure's fast path. Absolute units on an MNA unknown (volts / amps); 1e-9 is well below any
 * device tolerance the Newton loop cares about, and well above float noise on a well-conditioned solve.
 */
const SPARSE_DENSE_AGREE = 1e-9

function sparseAgreesWithDense(xSparse: DenseVector, xDense: DenseVector): boolean {
  const n = xSparse.data.length
  for (let i = 0; i < n; i++) {
    if (Math.abs((xSparse.data[i] as number) - (xDense.data[i] as number)) > SPARSE_DENSE_AGREE)
      return false
  }
  return true
}

export class SparseSession {
  private order: SparseOrder | null = null
  private gather: GatherMap | null = null
  private factor: SparseFactor | null = null
  private pivotedFactor: PivotedFactor | null = null
  /**
   * Which sparse factor this structure takes. 'no-pivot' first — the original factor, so every circuit
   * it already handled keeps byte-identical arithmetic — and 'pivoted' once the no-pivot factor has bailed
   * on this structure (a zero diagonal it could not defer past: real transistor netlists, wire-heavy
   * blocks). Once pivoted, the session stays pivoted rather than re-paying a no-pivot attempt that is
   * known to fail.
   */
  private factorKind: 'no-pivot' | 'pivoted' = 'no-pivot'
  /** The plain minimum-degree order the pivoted factor uses — computed once, the first time it is needed. */
  private pivotOrder: number[] | null = null
  private verdict: 'sparse' | 'dense' | undefined
  private orderSize = -1
  private consecutiveMisses = 0

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
      this.pivotedFactor = null
      this.factorKind = 'no-pivot'
      this.pivotOrder = null
      this.consecutiveMisses = 0
    }

    if (this.verdict === 'dense') return denseLusolve(A, b)

    if (this.verdict === 'sparse') {
      const x = this.attemptSparse(A, b, constantMatrix)
      if (x !== null) {
        this.consecutiveMisses = 0
        return x
      }
      // One miss is not a verdict. A Newton iterate that wanders through a near-singular linearisation
      // (a saturated transistor's drain held only by an off device's 1 pS) can leave a column with no
      // usable pivot for that ONE solve; dense — which owns floating / singular systems — answers it, and
      // the next iterate usually factors again. Measured on the hex → 7-segment decoder: the old
      // first-miss downgrade sent 37 of 40 Newton passes to dense at ~4× the per-pass cost. Only a run of
      // misses means the structure genuinely stopped factoring, and then it stops paying for sparse.
      this.consecutiveMisses++
      if (this.consecutiveMisses >= SPARSE_MISS_LIMIT) {
        this.verdict = 'dense'
        this.factor = null
        this.pivotedFactor = null
      }
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
    // Prefer sparse only when it is faster AND agrees with the dense answer already computed for
    // the race. An ill-conditioned MNA system can have many x with a tiny residual; if refinement
    // still leaves sparse a few ulps from dense on the first linearisation, remembering sparse as
    // the structure's verdict would force every later Newton pass onto a wandering path.
    if (xSparse !== null && sparseMs < denseMs && sparseAgreesWithDense(xSparse, xDense)) {
      this.verdict = 'sparse'
      return xSparse
    }
    this.verdict = 'dense'
    this.factor = null
    this.pivotedFactor = null
    return xDense
  }

  /** Test / diagnostics: which path this session settled on ('dense', 'no-pivot' or 'pivoted'). */
  get path(): 'dense' | 'no-pivot' | 'pivoted' | undefined {
    if (this.verdict === undefined) return undefined
    return this.verdict === 'dense' ? 'dense' : this.factorKind
  }

  /**
   * A residual-verified sparse solution, or null → fall back to dense. Reuses the stored factor when the
   * caller guarantees the matrix is unchanged (a linear transient step); otherwise factors afresh from a
   * full scan of the current A (robust to a nonlinear device's pattern shifting). Tries the no-pivot
   * factor while it keeps working for this structure, then the pivoted one. The residual is an
   * O(nonzeros) check either way.
   */
  private attemptSparse(
    A: DenseMatrix,
    b: DenseVector,
    constantMatrix: boolean,
  ): DenseVector | null {
    if (this.factorKind === 'no-pivot') {
      const x = this.attemptNoPivot(A, b, constantMatrix)
      if (x !== null) return x
      this.factorKind = 'pivoted'
      this.factor = null
    }
    return this.attemptPivoted(A, b, constantMatrix)
  }

  /**
   * The pivoted factor (fresh, or reused under the constant-matrix hint), residual-verified.
   * Every solve gets one iterative-refinement step (see refinePivoted) so an ill-conditioned
   * Newton linearisation does not hand NR a residual-small but wrong answer.
   */
  private attemptPivoted(
    A: DenseMatrix,
    b: DenseVector,
    constantMatrix: boolean,
  ): DenseVector | null {
    if (constantMatrix && this.pivotedFactor !== null) {
      const reused = solvePivoted(this.pivotedFactor, b)
      const refined = reused === null ? null : refinePivoted(A, b, this.pivotedFactor, reused)
      if (refined !== null && pivotedResidualWithinTolerance(A, b, refined, this.pivotedFactor))
        return refined
      this.pivotedFactor = null // the stored factor no longer solves this matrix (A changed) — refactor
    }
    if (this.pivotOrder === null) this.pivotOrder = computeOrder(A, false).order
    const f = factorizePivoted(A, this.pivotOrder)
    if (f === null) return null
    const raw = solvePivoted(f, b)
    const x = raw === null ? null : refinePivoted(A, b, f, raw)
    if (x === null || !pivotedResidualWithinTolerance(A, b, x, f)) return null
    this.pivotedFactor = constantMatrix ? f : null
    return x
  }

  /** The original no-pivot factor (fresh, or reused under the constant-matrix hint), residual-verified. */
  private attemptNoPivot(
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
