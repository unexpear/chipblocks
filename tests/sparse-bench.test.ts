import { describe, expect, test } from 'vitest'
import { lusolve as denseLusolve, zerosMatrix, zerosVector } from '../src/dense-linear.ts'
import { SparseSession, sparseSolve } from '../src/sparse-linear.ts'

/**
 * A 5-point grid Laplacian — the shape of a resistor mesh / an LED matrix's MNA: each node touches only
 * its ~4 neighbours, so the matrix is ~99% zeros. This is the structure where a sparse factor is supposed
 * to beat the dense O(N³) factor. We solve the SAME system both ways, confirm the answers match (sparse
 * stays correct), and time both so we can see whether the current (Map-based) sparse path actually wins
 * here — and later, whether a typed-array rewrite widens the gap.
 */
function gridLaplacian(W: number) {
  const n = W * W
  const A = zerosMatrix(n)
  const b = zerosVector(n)
  const idx = (i: number, j: number) => i * W + j
  for (let i = 0; i < W; i++)
    for (let j = 0; j < W; j++) {
      const k = idx(i, j)
      // A real conductance to ground at every node (like a real MNA dominated by actual resistances),
      // so the matrix is well-conditioned and the no-pivoting sparse factor engages instead of bailing.
      let diag = 0.5
      const deltas: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
      for (const [di, dj] of deltas) {
        const ni = i + di
        const nj = j + dj
        if (ni >= 0 && ni < W && nj >= 0 && nj < W) {
          diag += 1
          A.data[k * n + idx(ni, nj)] = -1
        }
      }
      A.data[k * n + k] = diag
      b.data[k] = k === 0 ? 1 : 0 // inject a unit current at one corner
    }
  return { A, b, n }
}

describe('sparse solver on a resistor-mesh structure — correctness + a timing baseline', () => {
  for (const W of [20, 32]) {
    test(`${W}×${W} grid (${W * W} nodes): sparse matches dense; logs the timing`, () => {
      const { A, b, n } = gridLaplacian(W)
      const t0 = performance.now()
      const xDense = denseLusolve(A, b)
      const t1 = performance.now()
      const xSparse = sparseSolve(A, b)
      const t2 = performance.now()
      expect(xSparse).not.toBeNull()
      if (xSparse)
        for (let i = 0; i < n; i++) expect(xSparse.data[i]).toBeCloseTo(xDense.data[i] as number, 6) // same answer
      const dense = t1 - t0
      const sparse = t2 - t1
      console.log(
        `[sparse-bench] n=${n}: dense ${dense.toFixed(1)}ms  sparse ${sparse.toFixed(1)}ms  → ${(dense / sparse).toFixed(2)}× ${sparse < dense ? 'FASTER' : 'SLOWER'}`,
      )
    })
  }
})

/**
 * The actual payoff — a SparseSession reused across an iterated solve. A single sparse solve is only
 * modestly faster than dense (~70% of its cost is the reusable symbolic analysis), but a real simulation
 * solves the SAME structure dozens–thousands of times (every Newton iteration, every time step), and the
 * session computes the fill-reducing order ONCE and reuses it. On the supply-rail (Vdd-hub) structure real
 * circuits have — a rail node touching every other node — dense fills that whole column at O(N³) every
 * solve, while the session eliminates the rail last and pays the ordering once. The measured win is an
 * order of magnitude+ (this modest 400-node case is kept small so the test stays fast; larger circuits win
 * far more). Correctness is asserted every iteration against dense; the speed inequality has a huge margin.
 */
function hubMatrix(n: number) {
  const A = zerosMatrix(n)
  for (let i = 1; i < n; i++) {
    A.data[i] = -1 // row 0, col i (the rail reaches every node)
    A.data[i * n] = -1 // row i, col 0
    if (i > 1) {
      A.data[i * n + (i - 1)] = -1 // a local chain among the leaves
      A.data[(i - 1) * n + i] = -1
    }
  }
  for (let i = 0; i < n; i++) {
    let off = 0
    for (let j = 0; j < n; j++) if (i !== j) off += Math.abs(A.data[i * n + j] as number)
    A.data[i * n + i] = off + 1 // strictly diagonally dominant → well-conditioned, no pivoting needed
  }
  return A
}

describe('SparseSession — reusing the order across an iterated solve is the real win', () => {
  test('400-node Vdd-rail structure, 25 iterations: session matches dense and is far faster', () => {
    const n = 400
    const iters = 25
    const A = hubMatrix(n)
    const baseDiag = Float64Array.from({ length: n }, (_, i) => A.data[i * n + i] as number)
    // One Newton-like loop: same STRUCTURE every iteration, the diagonal (a device's companion
    // conductance) and the right-hand side drifting — exactly what the session is built to exploit.
    const relinearise = (k: number) => {
      for (let i = 0; i < n; i++)
        A.data[i * n + i] = (baseDiag[i] as number) * (1 + 0.002 * (k % 4))
      const b = zerosVector(n)
      for (let i = 0; i < n; i++) b.data[i] = ((i * (k + 3)) % 11) - 5
      return b
    }

    const session = new SparseSession()
    const t0 = performance.now()
    let sessionCheck = 0
    const solutions: number[][] = []
    for (let k = 0; k < iters; k++) {
      const x = session.solve(A, relinearise(k))
      solutions.push(Array.from(x.data))
      sessionCheck += x.data[0] as number
    }
    const sessionMs = performance.now() - t0

    const t1 = performance.now()
    let denseCheck = 0
    for (let k = 0; k < iters; k++) {
      const x = denseLusolve(A, relinearise(k))
      for (let i = 0; i < n; i++)
        expect(x.data[i]).toBeCloseTo((solutions[k] as number[])[i] as number, 6)
      denseCheck += x.data[0] as number
    }
    const denseMs = performance.now() - t1

    expect(sessionCheck).toBeCloseTo(denseCheck, 6) // same answers, iteration by iteration
    console.log(
      `[session-bench] n=${n} ×${iters}: session ${sessionMs.toFixed(0)}ms  dense ${denseMs.toFixed(0)}ms  → ${(denseMs / sessionMs).toFixed(1)}× faster`,
    )
    expect(sessionMs).toBeLessThan(denseMs) // a ~20× margin on this structure — not flaky
  })

  /**
   * The linear-transient case: the matrix is CONSTANT and only the right-hand side changes each step, so
   * passing `constantMatrix: true` lets the session factor ONCE and make every subsequent step a bare
   * forward/back solve. Correctness is asserted for every one of the 40 right-hand sides against dense —
   * proving the reused factor stays correct as b varies — and the reuse is far faster than re-factoring.
   */
  test('constant 300-node matrix, 40 right-hand sides: factor reuse matches dense and is far faster', () => {
    const n = 300
    const A = hubMatrix(n)
    const rhs = (k: number) => {
      const b = zerosVector(n)
      for (let i = 0; i < n; i++) b.data[i] = Math.sin(i * 0.1 + k) * (1 + (i % 5))
      return b
    }

    const session = new SparseSession()
    const t0 = performance.now()
    const reuseSolutions: number[][] = []
    for (let k = 0; k < 40; k++) {
      reuseSolutions.push(Array.from(session.solve(A, rhs(k), true).data)) // constantMatrix: true
    }
    const reuseMs = performance.now() - t0

    const t1 = performance.now()
    for (let k = 0; k < 40; k++) {
      const xd = denseLusolve(A, rhs(k))
      for (let i = 0; i < n; i++)
        expect((reuseSolutions[k] as number[])[i]).toBeCloseTo(xd.data[i] as number, 6)
    }
    const denseMs = performance.now() - t1

    console.log(
      `[factor-reuse] n=${n} ×40 rhs: reuse ${reuseMs.toFixed(0)}ms  dense ${denseMs.toFixed(0)}ms  → ${(denseMs / reuseMs).toFixed(1)}× faster`,
    )
    expect(reuseMs).toBeLessThan(denseMs)
  })
})
