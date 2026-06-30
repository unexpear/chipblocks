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
 * No pivoting: the ordering's diagonal is used as the pivot sequence. MNA matrices carry a gmin
 * conductance to ground on every node, so they are well-conditioned and diagonally strong; a tiny or
 * zero pivot (a genuinely ill-conditioned or floating system) makes the sparse pass bail to dense
 * rather than risk an inaccurate factor — and the residual check is the backstop if it ever doesn't.
 */

import { type DenseMatrix, DenseVector, lusolve as denseLusolve } from './dense-linear.ts'

/** Pivots at/below this magnitude are treated as zero → bail to dense (it pins a floating variable). */
const PIVOT_FLOOR = 1e-30
/** Relative ‖A·x − b‖ above which a sparse result is rejected (→ dense). Matches dense-linear's check. */
const RESIDUAL_TOLERANCE = 1e-6
/** Below this many unknowns, skip the sparse machinery — a dense solve is already cheap. */
const SPARSE_THRESHOLD = 32

/**
 * A fill-reducing elimination order (minimum degree): repeatedly eliminate the lowest-degree node,
 * adding the fill edges its elimination creates among its neighbors. `order[k]` is the original index
 * eliminated k-th. Cheap and order-of-magnitude better than the natural order for circuit graphs (it
 * keeps the dense supply-rail rows out of the way until last). The order only affects SPEED, never
 * correctness — any elimination order is a valid factorization.
 */
function minimumDegreeOrder(adjacency: Set<number>[]): number[] {
  const n = adjacency.length
  const graph = adjacency.map((s) => new Set(s)) // working copy; gains fill edges as we eliminate
  const eliminated = new Uint8Array(n)
  const order: number[] = []
  for (let step = 0; step < n; step++) {
    let best = -1
    let bestDegree = Number.POSITIVE_INFINITY
    for (let v = 0; v < n; v++) {
      if (eliminated[v]) continue
      const degree = (graph[v] as Set<number>).size
      if (degree < bestDegree) {
        bestDegree = degree
        best = v
        if (degree === 0) break
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
 * Solve A·x = b by sparse Gaussian elimination (Doolittle LU) under a minimum-degree ordering — the
 * SAME elimination as before, but on TYPED-ARRAY rows with a dense accumulator instead of per-element
 * Maps/Sets, so the hot loop has no hashing. Each row is parallel `cols`/`vals` arrays; eliminating a
 * row scatters it into a reused `work` Float64Array (O(1) accesses), applies the pivot row, and gathers
 * the grown pattern back. Returns null — a signal to fall back to dense — on a zero/tiny pivot, on
 * fill-in growing dense (sparse wouldn't beat dense then), or any non-finite result. A and b not mutated.
 */
export function sparseSolve(A: DenseMatrix, b: DenseVector): DenseVector | null {
  const n = A.size
  if (n === 0) return new DenseVector(0)

  // 1. Symmetric nonzero structure (the elimination graph) → fill-reducing (minimum-degree) order.
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
  const order = minimumDegreeOrder(adjacency)
  const inverse = new Array<number>(n)
  for (let k = 0; k < n; k++) inverse[order[k] as number] = k

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
 * Solve A·x = b — the sparse fast path with a dense correctness backstop. Drop-in for dense-linear's
 * lusolve (same DenseMatrix/DenseVector API), so swapping the solvers' import is a one-line change.
 * Small systems and any case the sparse pass can't prove go straight to the dense solver.
 */
export function lusolve(A: DenseMatrix, b: DenseVector): DenseVector {
  if (A.size >= SPARSE_THRESHOLD) {
    const x = sparseSolve(A, b)
    if (x !== null && residualWithinTolerance(A, b, x)) return x
  }
  return denseLusolve(A, b)
}
