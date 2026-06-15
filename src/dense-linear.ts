/**
 * A small dense linear-algebra core for the DC and transient circuit solvers — a drop-in for the
 * exact slice of mathjs the Modified Nodal Analysis assembly used (zeros / get / set / lusolve /
 * toArray), backed by flat Float64Arrays and a hand-rolled Gaussian elimination with partial
 * pivoting.
 *
 * Why this exists: mathjs is a general-purpose library, and its per-element get/set dispatch plus
 * lusolve overhead dominated solve time once a circuit reached a few hundred MNA unknowns (a
 * 2-bit ripple adder is ~150; the solve was ~23 s, roughly 100x the arithmetic's own cost). The
 * numerical method here is IDENTICAL to what lusolve runs — a dense direct solve with partial
 * pivoting — so results match to rounding; only the library tax is gone. The `[row, col]` and
 * `[row, 0]` accessor shapes match the mathjs Matrix API the stamping code was written against,
 * so every stamp helper in dc-solver.ts and transient-solver.ts is untouched.
 *
 * The element reads carry `as number` casts because the project compiles with
 * noUncheckedIndexedAccess; every index here is provably in bounds (0 .. size·size).
 */

/** Dense size×size matrix, row-major in a Float64Array. */
export class DenseMatrix {
  readonly size: number
  readonly data: Float64Array
  constructor(size: number) {
    this.size = size
    this.data = new Float64Array(size * size)
  }
  get([row, col]: [number, number]): number {
    return this.data[row * this.size + col] as number
  }
  set([row, col]: [number, number], value: number): void {
    this.data[row * this.size + col] = value
  }
}

/** Dense column vector (size×1), Float64Array-backed; the `[row, 0]` accessors mirror the matrix
 *  API so the stamps treat the right-hand side the same way they treat the matrix. */
export class DenseVector {
  readonly size: number
  readonly data: Float64Array
  constructor(size: number) {
    this.size = size
    this.data = new Float64Array(size)
  }
  get([row]: [number, number]): number {
    return this.data[row] as number
  }
  set([row]: [number, number], value: number): void {
    this.data[row] = value
  }
  /** Column-of-rows shape (n×1), matching what mathjs lusolve's toArray() returned. */
  toArray(): number[][] {
    const out = new Array<number[]>(this.size)
    for (let i = 0; i < this.size; i++) out[i] = [this.data[i] as number]
    return out
  }
}

/** Drop-in for `math.zeros(n, n)`. */
export function zerosMatrix(size: number): DenseMatrix {
  return new DenseMatrix(size)
}

/** Drop-in for `math.zeros(n, 1)`. */
export function zerosVector(size: number): DenseVector {
  return new DenseVector(size)
}

/**
 * Solve A·x = b for x by Gaussian elimination with partial pivoting — the same dense direct
 * method math.lusolve runs. A zero-pivot column (a floating net with no path to ground — an open
 * switch's dead node, an undriven net) is treated as a free variable pinned to 0, which returns
 * the same particular solution mathjs's lusolve produced for these consistent-but-singular MNA
 * systems rather than failing on them. A and b are not mutated; the elimination runs on copies.
 */
export function lusolve(A: DenseMatrix, b: DenseVector): DenseVector {
  const n = A.size
  const a = Float64Array.from(A.data) // working copy; the elimination mutates it
  const y = Float64Array.from(b.data) // working right-hand side, eliminated alongside A

  for (let col = 0; col < n; col++) {
    // Partial pivot: pick the largest-magnitude entry at or below the diagonal in this column.
    let pivot = col
    let pivotMag = Math.abs(a[col * n + col] as number)
    for (let row = col + 1; row < n; row++) {
      const mag = Math.abs(a[row * n + col] as number)
      if (mag > pivotMag) {
        pivotMag = mag
        pivot = row
      }
    }
    // A zero pivot means column `col` is unconstrained by the remaining rows — a free variable
    // (a floating/undriven net). Skip its elimination; back-substitution pins it to 0, the
    // particular solution mathjs returned for these consistent-but-singular circuit systems.
    if (pivotMag === 0) continue
    if (pivot !== col) {
      for (let j = col; j < n; j++) {
        const swap = a[col * n + j] as number
        a[col * n + j] = a[pivot * n + j] as number
        a[pivot * n + j] = swap
      }
      const swapY = y[col] as number
      y[col] = y[pivot] as number
      y[pivot] = swapY
    }
    const diagonal = a[col * n + col] as number
    for (let row = col + 1; row < n; row++) {
      const factor = (a[row * n + col] as number) / diagonal
      if (factor === 0) continue
      for (let j = col; j < n; j++) {
        a[row * n + j] = (a[row * n + j] as number) - factor * (a[col * n + j] as number)
      }
      y[row] = (y[row] as number) - factor * (y[col] as number)
    }
  }

  // Back-substitution; a zero diagonal is a free variable from a skipped column, pinned to 0.
  const x = new DenseVector(n)
  for (let i = n - 1; i >= 0; i--) {
    const diagonal = a[i * n + i] as number
    if (diagonal === 0) {
      x.data[i] = 0
      continue
    }
    let sum = y[i] as number
    for (let j = i + 1; j < n; j++) {
      sum -= (a[i * n + j] as number) * (x.data[j] as number)
    }
    x.data[i] = sum / diagonal
  }
  return x
}
