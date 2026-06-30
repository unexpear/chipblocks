/**
 * Sparse linear-solver tests — it must produce the SAME answers as the dense reference solver
 * (it's the same Gaussian elimination, just skipping the zeros), fall back to dense on the
 * singular / floating-node cases dense handles specially, and be markedly faster on the big sparse
 * systems circuits actually generate.
 */

import { describe, expect, test } from 'vitest'
import {
  type DenseMatrix,
  type DenseVector,
  lusolve as denseLusolve,
  zerosMatrix,
  zerosVector,
} from '../src/dense-linear.ts'
import { lusolve as robustLusolve, sparseSolve } from '../src/sparse-linear.ts'

/** Deterministic PRNG (a linear congruential generator) so the random systems are reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** A random diagonally-dominant sparse system (like an MNA matrix with gmin) + its known solution. */
function randomSystem(
  n: number,
  density: number,
  rng: () => number,
): { A: DenseMatrix; b: DenseVector; xTrue: DenseVector } {
  const A = zerosMatrix(n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && rng() < density) A.set([i, j], rng() * 2 - 1)
    }
  }
  for (let i = 0; i < n; i++) {
    let offDiag = 0
    for (let j = 0; j < n; j++) if (i !== j) offDiag += Math.abs(A.get([i, j]))
    A.set([i, i], offDiag + 1 + rng()) // strictly diagonally dominant → well-conditioned
  }
  const xTrue = zerosVector(n)
  for (let i = 0; i < n; i++) xTrue.set([i, 0], rng() * 10 - 5)
  const b = zerosVector(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) sum += A.get([i, j]) * xTrue.get([j, 0])
    b.set([i, 0], sum)
  }
  return { A, b, xTrue }
}

describe('sparseSolve — same answers as the dense reference', () => {
  test('matches dense (and the planted answer) on every random system it factors', () => {
    const rng = lcg(0x1234)
    let engaged = 0
    for (const n of [3, 8, 25, 60, 120]) {
      for (const density of [0.04, 0.15, 0.5]) {
        const { A, b, xTrue } = randomSystem(n, density, rng)
        const xs = sparseSolve(A, b)
        // A null is a deliberate bail — the fill grew dense (e.g. the 0.5-density systems), so sparse
        // would not beat dense and lusolve covers it with the dense path. The contract under test is:
        // WHENEVER sparseSolve returns a factor, that factor is correct.
        if (!xs) continue
        engaged++
        const xd = denseLusolve(A, b)
        for (let i = 0; i < n; i++) {
          expect(xs.get([i, 0])).toBeCloseTo(xd.get([i, 0]), 8) // same as dense to rounding
          expect(xs.get([i, 0])).toBeCloseTo(xTrue.get([i, 0]), 6) // and to the planted answer
        }
      }
    }
    // It must actually run on the genuinely sparse systems — not bail on everything (a vacuous pass).
    expect(engaged).toBeGreaterThanOrEqual(8)
  })

  test('a banded system (circuit-like locality) solves correctly', () => {
    const n = 50
    const band = 3
    const A = zerosMatrix(n)
    const xTrue = zerosVector(n)
    const rng = lcg(99)
    for (let i = 0; i < n; i++) {
      for (let j = Math.max(0, i - band); j <= Math.min(n - 1, i + band); j++) {
        if (i !== j) A.set([i, j], rng() - 0.5)
      }
      xTrue.set([i, 0], rng() * 6 - 3)
    }
    for (let i = 0; i < n; i++) {
      let off = 0
      for (let j = 0; j < n; j++) if (i !== j) off += Math.abs(A.get([i, j]))
      A.set([i, i], off + 1)
    }
    const b = zerosVector(n)
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let j = 0; j < n; j++) s += A.get([i, j]) * xTrue.get([j, 0])
      b.set([i, 0], s)
    }
    const xs = sparseSolve(A, b)
    expect(xs).not.toBeNull()
    if (xs) for (let i = 0; i < n; i++) expect(xs.get([i, 0])).toBeCloseTo(xTrue.get([i, 0]), 7)
  })

  test('an MNA system WITH ideal voltage-source rows (zero diagonals) — engages, does not bail', () => {
    // A resistor chain (nonzero, gmin-loaded diagonals) plus four ideal voltage sources, whose
    // branch-current rows have a structurally ZERO diagonal — the exact pattern that made the no-pivot
    // factor bail at step 0 on the real decoder. Those rows are degree-1, so a plain minimum-degree order
    // would eliminate them FIRST (zero pivot → bail → whole circuit forfeited to dense). The diagonal-
    // aware order must defer them past the node rows, by which point eliminating the node they pin has
    // filled their diagonal, so the factor engages and matches dense.
    const nNodes = 60
    const sourceNodes = [0, 17, 33, 48]
    const n = nNodes + sourceNodes.length
    const A = zerosMatrix(n)
    const b = zerosVector(n)
    const g = 1
    const gmin = 1e-3
    for (let i = 0; i < nNodes; i++) {
      let diag = gmin
      if (i > 0) {
        A.set([i, i - 1], -g)
        diag += g
      }
      if (i < nNodes - 1) {
        A.set([i, i + 1], -g)
        diag += g
      }
      A.set([i, i], diag)
    }
    sourceNodes.forEach((node, k) => {
      const s = nNodes + k
      A.set([s, node], 1) // V(node) − V(gnd) = Vs ; A[s][s] stays 0 (the zero diagonal)
      A.set([node, s], 1) // the source branch current into the node
      b.set([s, 0], 1 + k)
    })
    const xs = sparseSolve(A, b)
    const xd = denseLusolve(A, b)
    expect(xs).not.toBeNull() // the deferral let it engage — a plain order would have bailed here
    if (xs) for (let i = 0; i < n; i++) expect(xs.get([i, 0])).toBeCloseTo(xd.get([i, 0]), 7)
  })
})

describe('robust lusolve — sparse fast path with a dense backstop', () => {
  test('falls back to dense on a singular (floating-node) system, matching dense exactly', () => {
    // A 40-node well-posed system, then node 39 made floating (its row/col/rhs zeroed). The sparse
    // pass hits a zero pivot and bails; dense pins the free variable to 0. The combined result must
    // equal the pure dense result everywhere.
    const rng = lcg(7)
    const { A, b } = randomSystem(40, 0.1, rng)
    const floating = 39
    for (let j = 0; j < 40; j++) {
      A.set([floating, j], 0)
      A.set([j, floating], 0)
    }
    b.set([floating, 0], 0)
    const combined = robustLusolve(A, b)
    const dense = denseLusolve(A, b)
    for (let i = 0; i < 40; i++) expect(combined.get([i, 0])).toBeCloseTo(dense.get([i, 0]), 9)
  })
})

describe('sparse is faster on the big sparse systems that matter', () => {
  test('a 400-node hub system (a Vdd-rail pattern): sparse beats dense and agrees', () => {
    // Node 0 connects to EVERY other node (a supply rail); the rest form a local chain. Eliminating
    // the rail column fills the whole matrix, so dense goes O(N³); minimum-degree eliminates the rail
    // LAST, so sparse stays near-linear — the win the real Vdd-rail pattern gets (a plain band does
    // not show it, since the dense solver already skips a band's zero multipliers).
    const n = 400
    const A = zerosMatrix(n)
    const xTrue = zerosVector(n)
    const rng = lcg(2026)
    xTrue.set([0, 0], rng() * 4 - 2)
    for (let i = 1; i < n; i++) {
      A.set([0, i], rng() - 0.5)
      A.set([i, 0], rng() - 0.5)
      if (i > 1) {
        A.set([i, i - 1], rng() - 0.5)
        A.set([i - 1, i], rng() - 0.5)
      }
      xTrue.set([i, 0], rng() * 4 - 2)
    }
    for (let i = 0; i < n; i++) {
      let off = 0
      for (let j = 0; j < n; j++) if (i !== j) off += Math.abs(A.get([i, j]))
      A.set([i, i], off + 1)
    }
    const b = zerosVector(n)
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let j = 0; j < n; j++) s += A.get([i, j]) * xTrue.get([j, 0])
      b.set([i, 0], s)
    }

    const t0 = performance.now()
    const xs = sparseSolve(A, b)
    const sparseMs = performance.now() - t0
    const t1 = performance.now()
    const xd = denseLusolve(A, b)
    const denseMs = performance.now() - t1

    expect(xs).not.toBeNull()
    if (xs) for (let i = 0; i < n; i++) expect(xs.get([i, 0])).toBeCloseTo(xd.get([i, 0]), 6)
    console.log(
      `n=${n} hub: sparse ${sparseMs.toFixed(1)} ms vs dense ${denseMs.toFixed(1)} ms ` +
        `(${(denseMs / sparseMs).toFixed(1)}× faster)`,
    )
    expect(sparseMs).toBeLessThan(denseMs)
  })
})
