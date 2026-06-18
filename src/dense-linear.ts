/**
 * A small dense linear-algebra core for the DC and transient circuit solvers — a drop-in for the
 * exact slice of mathjs the Modified Nodal Analysis assembly used (zeros / get / set / lusolve /
 * toArray), backed by flat Float64Arrays and a hand-rolled Gaussian elimination with partial
 * pivoting.
 *
 * Why this exists: mathjs is a general-purpose library, and its per-element get/set dispatch plus
 * lusolve overhead dominated solve time once a circuit reached a few hundred MNA unknowns (a
 * 2-bit ripple adder is ~150; the solve was ~23 s, roughly 100x the arithmetic's own cost). The
 * numerical method here is the same dense direct solve with partial pivoting lusolve runs, so
 * results match to rounding on the well-posed systems the solvers generate; only the library tax
 * is gone. (Singular systems differ by design: mathjs throws on any singular matrix, while this
 * pins a floating net's free variable to 0 and throws only when the system is genuinely
 * inconsistent — see lusolve below.) The `[row, col]` and
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
 * Relative-residual tolerance for the post-solve consistency check on a rank-deficient
 * system. A genuine floating-net solution leaves residual at float-noise level (~1e-12
 * relative); a conflicting/over-constrained system leaves an O(1) relative residual, so
 * 1e-6 separates them with several orders of margin.
 */
const INCONSISTENT_RESIDUAL_TOLERANCE = 1e-6

/**
 * Solve A·x = b for x by Gaussian elimination with partial pivoting — the same dense direct
 * method math.lusolve runs. A zero-pivot column (a floating net with no path to ground — an open
 * switch's dead node, an undriven net) is treated as a free variable pinned to 0, which returns
 * the same particular solution mathjs's lusolve produced for these consistent-but-singular MNA
 * systems rather than failing on them. A and b are not mutated; the elimination runs on copies.
 *
 * A rank-deficient system that is ALSO inconsistent (over-constrained — e.g. two ideal sources
 * forcing one node to conflicting voltages) is caught by a post-solve residual check and throws,
 * so callers report an unsolvable circuit instead of confident-but-wrong numbers. Full-rank
 * systems are always consistent and skip the check.
 */
export function lusolve(A: DenseMatrix, b: DenseVector): DenseVector {
  const n = A.size
  const a = Float64Array.from(A.data) // working copy; the elimination mutates it
  const y = Float64Array.from(b.data) // working right-hand side, eliminated alongside A
  let rankDeficient = false // a skipped (zero) pivot left a free variable — consistency-check below

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
    if (pivotMag === 0) {
      rankDeficient = true
      continue
    }
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

  // A rank-deficient system has free variables we pinned to 0. That is the right particular
  // solution ONLY when the system is consistent (a floating/undriven net) — the pinned solution
  // still satisfies every original equation. An over-constrained system (rank-deficient AND
  // inconsistent) does NOT, so its residual ‖A·x − b‖ is large relative to the problem scale.
  // Detect that and throw; callers already try/catch lusolve and report an unsolvable circuit.
  // Full-rank systems can't be inconsistent, so they never reach here.
  if (rankDeficient) {
    let maxResidual = 0
    let aNorm = 0
    let xNorm = 0
    let bNorm = 0
    for (let i = 0; i < n; i++) {
      let dot = 0
      let rowAbsSum = 0
      for (let j = 0; j < n; j++) {
        const aij = A.data[i * n + j] as number
        dot += aij * (x.data[j] as number)
        rowAbsSum += Math.abs(aij)
      }
      maxResidual = Math.max(maxResidual, Math.abs(dot - (b.data[i] as number)))
      aNorm = Math.max(aNorm, rowAbsSum)
      xNorm = Math.max(xNorm, Math.abs(x.data[i] as number))
      bNorm = Math.max(bNorm, Math.abs(b.data[i] as number))
    }
    const scale = Math.max(aNorm * xNorm + bNorm, 1)
    if (maxResidual > INCONSISTENT_RESIDUAL_TOLERANCE * scale) {
      throw new Error(
        `inconsistent linear system: residual ${maxResidual.toExponential(2)} exceeds tolerance ` +
          '(over-constrained circuit — e.g. conflicting ideal sources)',
      )
    }
  }
  // A near-singular column (a TINY but nonzero pivot) escapes the exact-zero rank-deficiency test
  // above, so 1/pivot can overflow and drive a non-finite value through back-substitution without
  // tripping the residual check. Catch ANY non-finite result — from that, or from a non-finite
  // stamp that propagated in — and throw, so callers report an unsolvable circuit instead of
  // accepting Infinity/NaN node voltages as a confident answer. Well-posed systems return finite x.
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x.data[i] as number)) {
      throw new Error(
        'non-finite linear solution (near-singular / ill-conditioned system — ' +
          'e.g. a floating node with no usable conductance to ground)',
      )
    }
  }
  return x
}
