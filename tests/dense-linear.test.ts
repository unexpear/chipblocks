/**
 * Direct tests for the hand-rolled dense linear solver (dense-linear.ts) — the
 * foundation under every voltage and current the DC and transient solvers report.
 * Until now it was only exercised indirectly through whole, well-posed circuits;
 * these cover it head-on, including the two singular cases that matter:
 *   - consistent-but-singular (a floating net) → free variable pinned to 0, no throw
 *   - inconsistent / over-constrained (conflicting ideal sources) → throws, so the
 *     solver reports an unsolvable circuit instead of confident-but-wrong numbers.
 */

import { describe, expect, test } from 'vitest'
import {
  type DenseMatrix,
  type DenseVector,
  lusolve,
  zerosMatrix,
  zerosVector,
} from '../src/dense-linear.ts'

function mat(rows: number[][]): DenseMatrix {
  const m = zerosMatrix(rows.length)
  rows.forEach((row, i) => {
    row.forEach((value, j) => {
      m.set([i, j], value)
    })
  })
  return m
}

function vec(values: number[]): DenseVector {
  const v = zerosVector(values.length)
  values.forEach((value, i) => {
    v.set([i, 0], value)
  })
  return v
}

describe('lusolve — well-posed systems', () => {
  test('solves a 2×2 against the hand-computed answer', () => {
    // 2x + y = 3 ; x + 3y = 5  →  x = 0.8, y = 1.4
    const x = lusolve(
      mat([
        [2, 1],
        [1, 3],
      ]),
      vec([3, 5]),
    )
    expect(x.data[0]).toBeCloseTo(0.8, 9)
    expect(x.data[1]).toBeCloseTo(1.4, 9)
  })

  test('partial pivoting handles a zero on the diagonal', () => {
    // Row 0 has a zero pivot in column 0; the solve must swap rows.
    // [0 1][x] = [2] ; [1 0][x] = [3]  →  x0 = 3, x1 = 2
    const x = lusolve(
      mat([
        [0, 1],
        [1, 0],
      ]),
      vec([2, 3]),
    )
    expect(x.data[0]).toBeCloseTo(3, 9)
    expect(x.data[1]).toBeCloseTo(2, 9)
  })

  test('solves a 3×3 upper-triangular system', () => {
    // x0 + x1 + x2 = 6 ; 2x1 + x2 = 5 ; 4x2 = 8  →  x = [2.5, 1.5, 2]
    const x = lusolve(
      mat([
        [1, 1, 1],
        [0, 2, 1],
        [0, 0, 4],
      ]),
      vec([6, 5, 8]),
    )
    expect(x.data[0]).toBeCloseTo(2.5, 9)
    expect(x.data[1]).toBeCloseTo(1.5, 9)
    expect(x.data[2]).toBeCloseTo(2, 9)
  })
})

describe('lusolve — singular systems', () => {
  test('consistent-but-singular: a free variable is pinned to 0 (no throw)', () => {
    // Row 0 fixes x0 = 5; row 1 is all-zero with a zero RHS (a floating net) — x1 is free.
    const x = lusolve(
      mat([
        [1, 0],
        [0, 0],
      ]),
      vec([5, 0]),
    )
    expect(x.data[0]).toBeCloseTo(5, 9)
    expect(x.data[1]).toBe(0)
  })

  test('redundant (consistent) constraints solve without throwing', () => {
    // Both rows say x0 = 5 — rank-deficient but consistent; x1 free → 0.
    const x = lusolve(
      mat([
        [1, 0],
        [1, 0],
      ]),
      vec([5, 5]),
    )
    expect(x.data[0]).toBeCloseTo(5, 9)
    expect(x.data[1]).toBe(0)
  })

  test('inconsistent / over-constrained system THROWS', () => {
    // Row 0 says x0 = 5, row 1 says x0 = 3 — no x can satisfy both (the classic
    // two-ideal-sources-of-different-value conflict). Must throw, not return junk.
    expect(() =>
      lusolve(
        mat([
          [1, 0],
          [1, 0],
        ]),
        vec([5, 3]),
      ),
    ).toThrow(/inconsistent/)
  })

  test('a tiny conflict still throws (the pinned solution does not satisfy the system)', () => {
    // x0 = 1 vs x0 = 1.5: residual ~0.5, far above the float-noise tolerance.
    expect(() =>
      lusolve(
        mat([
          [1, 0],
          [1, 0],
        ]),
        vec([1, 1.5]),
      ),
    ).toThrow(/inconsistent/)
  })

  test('a near-singular pivot throws instead of returning non-finite voltages', () => {
    // A tiny but NONZERO pivot (5e-324, the smallest subnormal) slips past the exact-zero
    // rank-deficiency test, and 1/5e-324 overflows to Infinity. The solver must refuse — throw,
    // which callers report as unsolvable — not hand back an Infinity solution as if it were real.
    expect(() =>
      lusolve(
        mat([
          [Number.MIN_VALUE, 0],
          [0, 1],
        ]),
        vec([1, 1]),
      ),
    ).toThrow(/non-finite/)
  })
})
