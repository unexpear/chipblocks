import { describe, expect, test } from 'vitest'
import { lusolve as denseLusolve, zerosMatrix, zerosVector } from '../src/dense-linear.ts'
import { sparseSolve } from '../src/sparse-linear.ts'

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
