/**
 * Solver scale for large transistor netlists (TOOLCHAIN-ROADMAP.md Track 4).
 *
 * Two measured walls, each pinned here:
 *
 *  1. The LINEAR SOLVE. The sparse factor had no pivoting, so any matrix with a zero diagonal it could
 *     not defer past made it bail — and a transistor netlist is full of them (every ideal wire is an aux
 *     branch row, and a net reached only by wires and MOSFET gates has no conductance of its own). The
 *     whole solve then ran on dense Gaussian elimination. `factorizePivoted` pivots around them.
 *  2. CONVERGENCE. Some inputs of the built-in CMOS blocks never converged from a cold start: the
 *     direct Newton burnt the whole budget and the robust solve answered "over-budget". Gmin stepping
 *     (solveDCByGminStepping) reaches the real operating point, and solveDCRobust now routes a CMOS
 *     netlist there after a bounded direct attempt.
 *
 * Correctness oracle for the transistor-level cases: the logic engine's digital operating point
 * (`digitalSeed`, independently validated in tests/logic-seed.test.ts). A converged solve must agree
 * with it on every gate pin and rail it pins — the decoded outputs included.
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDCByGminStepping, solveDCRobust } from '../src/dc-robust.ts'
import { type Solution, solveDC } from '../src/dc-solver.ts'
import {
  type DenseMatrix,
  type DenseVector,
  lusolve as denseLusolve,
  zerosMatrix,
  zerosVector,
} from '../src/dense-linear.ts'
import {
  type BlockData,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  flattenBlocks,
} from '../src/renderer/blocks.ts'
import { CALCULATOR_4BIT, HEX_DECODER_7SEG } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { digitalSeed } from '../src/renderer/logic-sim.ts'
import {
  computeOrder,
  factorize,
  factorizePivoted,
  SparseSession,
  solvePivoted,
} from '../src/sparse-linear.ts'

// ---------------------------------------------------------------------------
// Linear algebra: the pivoted sparse factor
// ---------------------------------------------------------------------------

/**
 * An MNA system shaped like a transistor netlist's wiring: chains of nets joined by IDEAL wires (each an
 * aux branch row with a structurally zero diagonal), where the middle net of each chain has no
 * conductance of its own — reached only through its two wires, like a gate net reached only by wire.
 * Every chain end also ties to one shared rail by a resistor, as every cell ties to Vdd: eliminating the
 * ends fills the wire rows toward that rail, so a wire-only middle net comes up for elimination while
 * its diagonal is still zero — the shape that made the no-pivot factor bail on the real decoder. The
 * rail is driven by one ideal supply.
 */
function wiredNetlist(chains: number): { A: DenseMatrix; b: DenseVector; n: number } {
  const nodes = chains * 3 + 1 // end – middle – end per chain, plus the rail
  const wires = chains * 2
  const n = nodes + wires + 1 // + the supply's branch row
  const A = zerosMatrix(n)
  const b = zerosVector(n)
  const add = (r: number, c: number, v: number) => A.set([r, c], A.get([r, c]) + v)
  const conductance = (p: number, q: number, g: number) => {
    add(p, p, g)
    add(q, q, g)
    add(p, q, -g)
    add(q, p, -g)
  }
  const rail = chains * 3
  let aux = nodes
  for (let c = 0; c < chains; c++) {
    const left = c * 3
    const mid = left + 1
    const right = left + 2
    for (const [p, q] of [
      [left, mid],
      [mid, right],
    ] as const) {
      add(p, aux, 1)
      add(q, aux, -1)
      add(aux, p, 1)
      add(aux, q, -1) // V(p) − V(q) = 0: an ideal wire
      aux++
    }
    conductance(left, rail, 1 / (100 + c))
    conductance(right, rail, 1 / (220 + c))
  }
  add(rail, rail, 1e-3)
  add(rail, aux, 1) // the supply on the rail
  add(aux, rail, 1)
  b.set([aux, 0], 5)
  return { A, b, n }
}

function expectSameAsDense(x: DenseVector | null, A: DenseMatrix, b: DenseVector): void {
  expect(x).not.toBeNull()
  const xd = denseLusolve(A, b)
  for (let i = 0; i < A.size; i++) expect(x?.data[i]).toBeCloseTo(xd.data[i] as number, 9)
}

/** The same structure with one net cut loose (its row, column and source zeroed) — singular but
 *  consistent: dense's floating-node case, which it answers by pinning the free net to 0. */
function withFloatingNet(
  A: DenseMatrix,
  b: DenseVector,
  net: number,
): { F: DenseMatrix; bF: DenseVector } {
  const F = zerosMatrix(A.size)
  F.data.set(A.data)
  const bF = zerosVector(A.size)
  bF.data.set(b.data)
  for (let i = 0; i < A.size; i++) {
    F.set([i, net], 0)
    F.set([net, i], 0)
  }
  bF.set([net, 0], 0)
  return { F, bF }
}

/** Big enough (752 unknowns) that the session's one-time sparse-vs-dense race is not close: these tests
 *  pin which path the session settles on, so dense must be clearly the slower one. */
const SESSION_CHAINS = 150

describe('pivoted sparse factor — a transistor netlist stays on the sparse path', () => {
  test('the no-pivot factor bails on wire-only nets; the pivoted one factors and matches dense', () => {
    const { A, b } = wiredNetlist(60) // 302 unknowns, 120 ideal wires
    // The forfeiture this fixes: with no pivoting there is no usable pivot for a wire-only net.
    expect(factorize(A, computeOrder(A))).toBeNull()
    const f = factorizePivoted(A, computeOrder(A, false).order)
    expect(f).not.toBeNull()
    if (f) expectSameAsDense(solvePivoted(f, b), A, b)
  })

  test('a SparseSession settles on the pivoted path and keeps answering like dense', () => {
    const { A, b } = wiredNetlist(SESSION_CHAINS)
    const session = new SparseSession()
    for (let k = 0; k < 5; k++) {
      // Newton-like drift: the values change, the structure does not.
      A.set([2, 2], A.get([2, 2]) * (1 + 0.01 * k))
      b.set([0, 0], 1e-3 * k)
      expectSameAsDense(session.solve(A, b), A, b)
    }
    expect(session.path).toBe('pivoted')
  })

  test('a floating net bails to dense instead of guessing a pivot', () => {
    const { A, b } = wiredNetlist(SESSION_CHAINS)
    const { F, bF } = withFloatingNet(A, b, 4) // a chain's middle net, now touching nothing
    expect(factorizePivoted(F, computeOrder(A, false).order)).toBeNull()
    // The session answers it exactly as dense does (dense pins the free variable to 0).
    const session = new SparseSession()
    session.solve(A, b)
    const x = session.solve(F, bF)
    const xd = denseLusolve(F, bF)
    for (let i = 0; i < F.size; i++) expect(x.data[i]).toBe(xd.data[i])
  })

  test('one near-singular Newton iterate does not forfeit the rest of the solve; a run of them does', () => {
    const { A, b } = wiredNetlist(SESSION_CHAINS)
    const { F, bF } = withFloatingNet(A, b, 4)
    const session = new SparseSession()
    session.solve(A, b)
    expect(session.path).toBe('pivoted')
    session.solve(F, bF) // one miss — answered by dense, verdict kept
    expect(session.path).toBe('pivoted')
    expectSameAsDense(session.solve(A, b), A, b)
    expect(session.path).toBe('pivoted')
    for (let k = 0; k < 3; k++) session.solve(F, bF) // a run of misses — the structure stopped factoring
    expect(session.path).toBe('dense')
  })

  test('constant-matrix reuse works with the pivoted factor (a linear transient step)', () => {
    const { A, b, n } = wiredNetlist(SESSION_CHAINS)
    const session = new SparseSession()
    for (let k = 0; k < 20; k++) {
      const rhs = zerosVector(n)
      rhs.data.set(b.data)
      rhs.set([0, 0], Math.sin(k)) // only the right-hand side changes step to step
      expectSameAsDense(session.solve(A, rhs, true), A, rhs)
    }
    expect(session.path).toBe('pivoted')
  })
})

// ---------------------------------------------------------------------------
// Transistor-level DC: the built-in CMOS blocks
// ---------------------------------------------------------------------------

const VDD = 5
const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})
const wire = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): CanvasEdgeLike => ({ id, source, sourceHandle, target, targetHandle })

/** A block on a canvas with its rails wired and each named input port driven by a source. */
function blockCircuit(
  block: BlockData,
  inputs: Record<string, number>,
): { world: World; nodes: CanvasNodeLike[]; edges: CanvasEdgeLike[] } {
  const nodes: CanvasNodeLike[] = [
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    {
      id: 'vdd',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(VDD) },
    },
    { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    ...Object.entries(inputs).map(([portId, volts]) => ({
      id: `in_${portId}`,
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(volts) },
    })),
  ]
  const edges: CanvasEdgeLike[] = [
    wire('w_vdd_p', 'vdd', 'terminal_positive', 'g', 'v_dd'),
    wire('w_vdd_n', 'vdd', 'terminal_negative', 'gnd', 'reference_terminal'),
    wire('w_gnd', 'g', 'gnd', 'gnd', 'reference_terminal'),
    ...Object.keys(inputs).flatMap((portId) => [
      wire(`w_${portId}_p`, `in_${portId}`, 'terminal_positive', 'g', portId),
      wire(`w_${portId}_n`, `in_${portId}`, 'terminal_negative', 'gnd', 'reference_terminal'),
    ]),
  ]
  const flat = flattenBlocks(nodes, edges)
  const world = canvasToWorld(
    flat.nodes.map((n) => ({
      id: n.id,
      definition: n.data.definition,
      parameters: n.data.parameters,
    })),
    flat.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  )
  return { world, nodes, edges }
}

/** Nets where the solve disagrees with the logic engine's digital operating point by ≥ 1 V. */
function logicDisagreements(
  circuit: ReturnType<typeof blockCircuit>,
  solution: Solution,
): { pinned: number; disagree: number } {
  const seed = digitalSeed(circuit.nodes, circuit.edges, circuit.world)
  expect(seed).toBeDefined()
  let disagree = 0
  for (const [net, v] of seed ?? []) {
    const solved = solution.nodes.get(net)
    if (solved === undefined || Math.abs(solved - v) >= 1) disagree++
  }
  return { pinned: seed?.size ?? 0, disagree }
}

/** 4-bit calculator inputs from a pattern number (the same mapping the measurements used). */
function calculatorInputs(v: number): Record<string, number> {
  const bit = (k: number) => ((v >> k) & 1 ? VDD : 0)
  return {
    a0: bit(0),
    a1: bit(1),
    a2: bit(2),
    a3: bit(3),
    b0: bit(4),
    b1: bit(5),
    b2: 0,
    b3: VDD,
    sub: v % 2 ? VDD : 0,
  }
}

/** A generous wall clock for the heavy cases: these tests pin CONVERGENCE, not machine speed, and the
 *  suite runs them under full parallel load. Still finite — a hang fails instead of spinning. */
const generousDeadline = () => performance.now() + 170_000

afterEach(() => {
  vi.restoreAllMocks()
})

describe('transistor-level DC at block scale', () => {
  test('the 4-bit calculator (264 MOSFETs) solves on the pivoted sparse path, not dense', () => {
    const circuit = blockCircuit(CALCULATOR_4BIT, calculatorInputs(0))
    const session = new SparseSession()
    const t0 = performance.now()
    const sol = solveDC(circuit.world, { maxIterations: 1000, sparseSession: session })
    console.log(
      `[solver-scale] calculator direct: ${sol.status} in ${sol.iterations} passes, ${(performance.now() - t0).toFixed(0)} ms`,
    )
    expect(sol.status).toBe('solved')
    expect(session.path).toBe('pivoted') // it used to forfeit the whole solve to dense here
    const check = logicDisagreements(circuit, sol)
    expect(check.pinned).toBeGreaterThan(100)
    expect(check.disagree).toBe(0)
  })

  test('gmin stepping lands on the same operating point the direct solve finds', () => {
    const circuit = blockCircuit(CALCULATOR_4BIT, calculatorInputs(0))
    const direct = solveDC(circuit.world, { maxIterations: 1000 })
    const stepped = solveDCByGminStepping(circuit.world, { deadline: generousDeadline() })
    expect(direct.status).toBe('solved')
    expect(stepped.status).toBe('solved')
    let worst = 0
    for (const [net, v] of direct.nodes)
      worst = Math.max(worst, Math.abs(v - (stepped.nodes.get(net) ?? Number.NaN)))
    expect(worst).toBeLessThan(1e-6) // measured 1.4e-9 V: the final level IS the real circuit
  })

  test('calculator inputs whose direct Newton never converges now solve (they were over-budget)', () => {
    // Pattern 12: the direct Newton is still wandering after hundreds of passes (it used to run the
    // whole 60 s budget and answer "over-budget"). The robust solve caps the direct attempt and
    // finishes through gmin stepping — on the real circuit, agreeing with the logic engine everywhere.
    const circuit = blockCircuit(CALCULATOR_4BIT, calculatorInputs(12))
    expect(solveDC(circuit.world, { maxIterations: 200 }).status).toBe('did-not-converge')
    const t0 = performance.now()
    const sol = solveDCRobust(circuit.world, { deadline: generousDeadline() })
    console.log(
      `[solver-scale] calculator pattern 12 robust: ${sol.status} in ${(performance.now() - t0).toFixed(0)} ms`,
    )
    expect(sol.status).toBe('solved')
    expect(logicDisagreements(circuit, sol).disagree).toBe(0)
  })

  test('the hex → 7-segment decoder (722 MOSFETs, ~4,000 unknowns) converges through gmin stepping', () => {
    // Input 0: the direct Newton did not converge in 831 passes / 60 s before this work.
    const circuit = blockCircuit(HEX_DECODER_7SEG, { d0: 0, d1: 0, d2: 0, d3: 0 })
    const t0 = performance.now()
    const sol = solveDCByGminStepping(circuit.world, { deadline: generousDeadline() })
    console.log(
      `[solver-scale] hex decoder (0) gmin stepping: ${sol.status} in ${(performance.now() - t0).toFixed(0)} ms`,
    )
    expect(sol.status).toBe('solved')
    const check = logicDisagreements(circuit, sol)
    expect(check.pinned).toBeGreaterThan(500) // every gate pin + the seven segment outputs
    expect(check.disagree).toBe(0)
  })

  test('gmin stepping that runs out of time says so, and says how far it got', () => {
    const circuit = blockCircuit(CALCULATOR_4BIT, calculatorInputs(0))
    // Count the clock reads of the FIRST level alone, then script a clock that expires right after it:
    // the second level is refused at its first read. Deterministic on any machine.
    let reads = 0
    const counter = vi.spyOn(performance, 'now').mockImplementation(() => ++reads)
    solveDC(circuit.world, {
      gminShunt: 1e-2,
      maxIterations: 100,
      deadline: Number.POSITIVE_INFINITY,
      sparseSession: new SparseSession(),
    })
    const firstLevelReads = reads
    counter.mockRestore()

    let scripted = 0
    vi.spyOn(performance, 'now').mockImplementation(() =>
      ++scripted <= firstLevelReads ? 0 : 1e12,
    )
    const sol = solveDCByGminStepping(circuit.world, { deadline: 1e9 })
    expect(sol.status).toBe('over-budget')
    expect(sol.warnings[0]).toContain('ran out of time') // the refusal stays first
    expect(sol.warnings[1]).toContain('Gmin stepping had converged with a 1e-2 S shunt')
  })
})
