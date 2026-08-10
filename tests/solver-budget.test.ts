/**
 * The solvers' hard limits — the guarantee that a circuit solve always ends.
 *
 * The defect these guard: opening a recovered FPGA design froze the whole window with no progress, no
 * cancel and no message, and the same path left a vitest worker spinning for 2935 CPU-seconds. A
 * synchronous Newton loop cannot be interrupted from outside — vitest's testTimeout cannot stop it and
 * neither can the UI — so the solve has to stop ITSELF. Two limits do that (solver-budget.ts): a SIZE
 * ceiling refused before any matrix is built, and a wall-clock BUDGET shared by every nested loop.
 *
 * These tests pin both boundaries exactly, on tiny circuits, through the `maxUnknowns` / `deadline`
 * overrides — the same trick `maxIterations` already uses — plus one full-size circuit that proves the
 * SHIPPED ceiling refuses instantly rather than stalling. And the property that matters most: a circuit
 * that solved before must still solve, to the same volts.
 */

import type { Edge, Node } from '@xyflow/react'
import { describe, expect, test, vi } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDCBySourceStepping, solveDCRobust } from '../src/dc-robust.ts'
import { dcRefused, type Solution, solveDC } from '../src/dc-solver.ts'
import { solveElectroThermal } from '../src/electro-thermal.ts'
import { solveWithRelays } from '../src/relay.ts'
import { type CanvasEdgeLike, type CanvasNodeLike, flattenBlocks } from '../src/renderer/blocks.ts'
import { DOT_MATRIX_MUX_8X8 } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'
import {
  CANVAS_SOLVE_BUDGET_MS,
  MAX_MNA_UNKNOWNS,
  refusalHeadline,
  SOLVE_BUDGET_MS,
  solveDeadline,
} from '../src/solver-budget.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})
const resistor = (ohms: number) => ({ resistance: scalar(ohms, 'ohm') })

type CanvasNode = {
  id: string
  definition: string
  parameters?: Record<string, { value?: unknown; ref?: string }>
}
type CanvasEdge = {
  id: string
  source: string
  target: string
  sourceHandle: string | null
  targetHandle: string | null
}

/**
 * A source driving `rungs` resistors in parallel to ground. Every rung adds its own nets and its own
 * wire branch currents, so the MNA system grows steadily with `rungs` — the knob these tests turn.
 */
function ladderWorld(rungs: number) {
  const nodes: CanvasNode[] = [
    { id: 'vp', definition: 'power_source', parameters: supply(5) },
    { id: 'g', definition: 'ground' },
  ]
  const edges: CanvasEdge[] = [
    {
      id: 'e_gnd',
      source: 'vp',
      sourceHandle: 'terminal_negative',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
  ]
  for (let i = 0; i < rungs; i++) {
    nodes.push({ id: `r${i}`, definition: 'resistor', parameters: resistor(1000) })
    edges.push({
      id: `e_top${i}`,
      source: 'vp',
      sourceHandle: 'terminal_positive',
      target: `r${i}`,
      targetHandle: 'terminal_a',
    })
    edges.push({
      id: `e_bot${i}`,
      source: `r${i}`,
      sourceHandle: 'terminal_b',
      target: 'g',
      targetHandle: 'reference_terminal',
    })
  }
  return canvasToWorld(nodes, edges)
}

/**
 * A 5 V source across one carbon-film resistor that heats ITSELF: −500 ppm/K on a 340 K/W package, so
 * the electro-thermal loop needs several passes to settle (each pass a whole DC solve). The rig
 * tests/electro-thermal.test.ts measures to R ≈ 95.5 Ω / 114 °C / 52.3 mA, built here through the canvas
 * so these tests keep one way of describing a circuit.
 */
function selfHeatingRungWorld() {
  const nodes: CanvasNode[] = [
    { id: 'vp', definition: 'power_source', parameters: supply(5) },
    { id: 'g', definition: 'ground' },
    {
      id: 'r0',
      definition: 'resistor',
      parameters: {
        resistance: scalar(100, 'ohm'),
        temperature_coefficient: scalar(-5e-4, 'per_kelvin'),
        thermal_resistance_junction_ambient: scalar(340, 'kelvin_per_watt'),
      },
    },
  ]
  const edges: CanvasEdge[] = [
    {
      id: 'e_top',
      source: 'vp',
      sourceHandle: 'terminal_positive',
      target: 'r0',
      targetHandle: 'terminal_a',
    },
    {
      id: 'e_bot',
      source: 'r0',
      sourceHandle: 'terminal_b',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
    {
      id: 'e_gnd',
      source: 'vp',
      sourceHandle: 'terminal_negative',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
  ]
  return canvasToWorld(nodes, edges)
}

/** A 5 V rail across a relay COIL (contacts left unwired): at rest it sees its full 5 V, so the
 *  discrete-state fixed point must take a SECOND pass to re-solve with the contacts pulled in. */
function coilOnlyRelayWorld() {
  const nodes: CanvasNode[] = [
    { id: 'vp', definition: 'power_source', parameters: supply(5) },
    { id: 'g', definition: 'ground' },
    {
      id: 'k1',
      definition: 'relay',
      parameters: {
        coil_resistance: scalar(100, 'ohm'),
        pull_in_voltage: scalar(3.75, 'volt'),
        drop_out_voltage: scalar(0.5, 'volt'),
        coil_state: { value: 'de_energized' },
      },
    },
  ]
  const edges: CanvasEdge[] = [
    {
      id: 'e_coil_a',
      source: 'vp',
      sourceHandle: 'terminal_positive',
      target: 'k1',
      targetHandle: 'coil_a',
    },
    {
      id: 'e_coil_b',
      source: 'k1',
      sourceHandle: 'coil_b',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
    {
      id: 'e_gnd',
      source: 'vp',
      sourceHandle: 'terminal_negative',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
  ]
  return canvasToWorld(nodes, edges)
}

/** A diode + resistor from a source — nonlinear, so the solve runs the Newton loop the budget guards. */
function diodeWorld() {
  const nodes: CanvasNode[] = [
    { id: 'vp', definition: 'power_source', parameters: supply(5) },
    { id: 'g', definition: 'ground' },
    { id: 'r', definition: 'resistor', parameters: resistor(220) },
    {
      id: 'd',
      definition: 'led',
      parameters: {
        forward_voltage: scalar(2.0, 'volt'),
        max_forward_current: scalar(0.02, 'ampere'),
      },
    },
  ]
  const edges: CanvasEdge[] = [
    {
      id: 'e1',
      source: 'vp',
      sourceHandle: 'terminal_positive',
      target: 'r',
      targetHandle: 'terminal_a',
    },
    { id: 'e2', source: 'r', sourceHandle: 'terminal_b', target: 'd', targetHandle: 'anode' },
    {
      id: 'e3',
      source: 'd',
      sourceHandle: 'cathode',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
    {
      id: 'e4',
      source: 'vp',
      sourceHandle: 'terminal_negative',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
  ]
  return canvasToWorld(nodes, edges)
}

/**
 * One row of the 8×8 multiplexed LED matrix, driven high with `cols` pulled to ground — the stiff
 * mixed-diode circuit tests/dc-robust-stiff.test.ts measured: pnjlim inches its coupled junctions to the
 * operating point over ~522 Newton passes, so the plain solve gives up at its 100-pass cap and reports
 * did-not-converge while the robust solve reaches the real answer. Well-posed, and the two solves
 * DISAGREE about it — which is what makes it the world the seam below can be seen through.
 */
function stiffMatrixRowWorld(row: number, cols: readonly number[]) {
  const nodes: CanvasNodeLike[] = [
    { id: 'd', position: { x: 0, y: 0 }, data: { definition: 'block', block: DOT_MATRIX_MUX_8X8 } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    {
      id: 'vp',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
  ]
  const edges: CanvasEdgeLike[] = [
    {
      id: 'e_rp',
      source: 'vp',
      sourceHandle: 'terminal_positive',
      target: 'd',
      targetHandle: `row_${row}`,
    },
    {
      id: 'e_rn',
      source: 'vp',
      sourceHandle: 'terminal_negative',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
  ]
  for (const c of cols) {
    edges.push({
      id: `e_col_${c}`,
      source: 'd',
      sourceHandle: `col_${c}`,
      target: 'g',
      targetHandle: 'reference_terminal',
    })
  }
  const flat = flattenBlocks(nodes, edges)
  return canvasToWorld(
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
}

/** The unknown-count the refusal reports, read back out of its own message. */
function reportedUnknowns(solution: Solution): number {
  const match = /needs ([\d,]+) unknowns/.exec(solution.warnings[0] ?? '')
  return match?.[1] === undefined ? -1 : Number(match[1].replace(/,/g, ''))
}

/** Replace `performance.now` with a counter that ticks `msPerRead` per read — a clock the test owns, so
 *  "the deadline passed mid-solve" is a fact rather than a race. Returns the read count. */
function fakeClock(msPerRead: number): { reads: () => number; restore: () => void } {
  let reads = 0
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
    reads += 1
    return reads * msPerRead
  })
  return { reads: () => reads, restore: () => spy.mockRestore() }
}

/** The clock reads one whole plain solve of `world` costs — MEASURED, so a deadline can be placed
 *  exactly between that solve and whatever the seam does next, on any machine at any speed. (The clock
 *  is the test's own counter, so this is a fact, not a race.) */
function clockReadsForOneSolve(world: World): number {
  const clock = fakeClock(1)
  try {
    solveDC(world, { deadline: Number.POSITIVE_INFINITY })
    return clock.reads()
  } finally {
    clock.restore()
  }
}

/** A clock that reads `values` in order and then holds the last one — so a test can put the deadline
 *  between two known instants and pin WHICH budget was taken, independent of how fast the machine is. */
function scriptedClock(values: number[]): { restore: () => void } {
  let read = 0
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
    const v = values[Math.min(read, values.length - 1)] as number
    read += 1
    return v
  })
  return { restore: () => spy.mockRestore() }
}

describe('the size ceiling — refused before any matrix is built', () => {
  test('a circuit past the ceiling is refused, and the message names both numbers', () => {
    const world = ladderWorld(20)
    const refused = solveDC(world, { maxUnknowns: 10 })
    expect(refused.status).toBe('too-large')
    expect(dcRefused(refused.status)).toBe(true)
    expect(reportedUnknowns(refused)).toBeGreaterThan(10)
    expect(refused.warnings[0]).toContain('the limit is 10')
    expect(refused.warnings[0]).toContain('too big')
    // Nothing was simulated — no voltages that could be mistaken for an answer.
    expect(refused.nodes.size).toBe(0)
  })

  test('the boundary is exact: AT the ceiling solves, one unknown past it refuses', () => {
    const world = ladderWorld(3)
    const size = reportedUnknowns(solveDC(world, { maxUnknowns: 1 }))
    expect(size).toBeGreaterThan(1)
    expect(solveDC(world, { maxUnknowns: size }).status).toBe('solved')
    expect(solveDC(world, { maxUnknowns: size - 1 }).status).toBe('too-large')
  })

  test('the SHIPPED ceiling refuses a real over-size circuit, and does it fast', () => {
    // ~7,000 rungs is well past MAX_MNA_UNKNOWNS and is the shape that used to hang the window.
    const world = ladderWorld(7000)
    const started = performance.now()
    const refused = solveDC(world)
    const elapsed = performance.now() - started
    expect(refused.status).toBe('too-large')
    expect(reportedUnknowns(refused)).toBeGreaterThan(MAX_MNA_UNKNOWNS)
    // A refusal is a check, not a solve: it must not cost anything like the matrix it declined to build.
    expect(elapsed).toBeLessThan(5000)
  })

  test('the refusal is the FIRST warning, ahead of the solve’s other notes', () => {
    // The canvas footer shows only the first two warnings; the one note the user cannot afford to miss
    // is the one saying nothing was simulated. This circuit also has a floating section, which warns.
    const world = ladderWorld(20)
    world.instances.set('floater', {
      id: 'floater',
      definition: 'resistor',
      kind_ref: 'primitive_device',
      parameters: resistor(1000),
      connects: [
        { terminal: 'terminal_a', net: 'island_a' },
        { terminal: 'terminal_b', net: 'island_b' },
      ],
    } as never)
    world.nets.set('island_a', { id: 'island_a' } as never)
    world.nets.set('island_b', { id: 'island_b' } as never)
    const refused = solveDC(world, { maxUnknowns: 10 })
    expect(refused.status).toBe('too-large')
    expect(refused.warnings.length).toBeGreaterThan(1)
    expect(refused.warnings[0]).toContain('too big')
  })

  test('the transient refuses the same circuit rather than marching it', () => {
    const result = solveTransient(ladderWorld(20), {
      timeStep: 1e-4,
      duration: 1e-3,
      maxUnknowns: 10,
    })
    expect(result.status).toBe('too-large')
    expect(result.series).toEqual([])
    expect(result.warnings[0]).toContain('too big')
  })
})

describe('the time budget — a solve that runs out of time stops and says so', () => {
  test('a deadline already past returns immediately, before any per-instance work', () => {
    const stopped = solveDC(diodeWorld(), { deadline: performance.now() - 1 })
    expect(stopped.status).toBe('over-budget')
    expect(dcRefused(stopped.status)).toBe(true)
    expect(stopped.warnings[0]).toContain('0 solver passes')
  })

  test('the deadline is read BETWEEN Newton passes, and the note says how many ran', () => {
    const clock = fakeClock(1000) // every clock read advances a second
    try {
      // Newton would run to the iteration cap; the deadline lands a few passes in.
      const stopped = solveDC(diodeWorld(), { deadline: 3500, maxIterations: 100 })
      expect(stopped.status).toBe('over-budget')
      expect(stopped.iterations).toBeGreaterThan(0)
      expect(stopped.warnings[0]).toMatch(/stopped after \d+ solver passes/)
      // The unfinished iterate is carried out so the user can see how far it got.
      expect(stopped.nodes.size).toBeGreaterThan(0)
    } finally {
      clock.restore()
    }
  })

  test('the transient stops mid-march, keeps the steps that solved, and names what it did not finish', () => {
    const clock = fakeClock(1000)
    try {
      const result = solveTransient(ladderWorld(2), {
        timeStep: 1e-5,
        duration: 1e-1, // 10,000 steps — far more than the clock allows
        deadline: 20_000,
      })
      expect(result.status).toBe('over-budget')
      expect(result.series.length).toBeGreaterThan(0)
      expect(result.series.length).toBeLessThan(10_000)
      expect(result.warnings[0]).toMatch(/of 10,000 time steps/)
    } finally {
      clock.restore()
    }
  })
})

describe('the retry paths stop at a refusal instead of walking into it again', () => {
  // Reading the clock is the tell: a refusal costs exactly two reads (one to set the deadline, one
  // inside the single solve that refuses). Anything that RETRIES reads it again per attempt — the ramp
  // walks up to 400 supply levels — so a read count of two is proof that no retry happened. These two
  // guards would mask each other if only the outer one were exercised, so each is tested at its own
  // entry point.
  test('solveDCRobust does not fall through to source stepping on a refusal', () => {
    const clock = fakeClock(0)
    try {
      const refused = solveDCRobust(ladderWorld(20), { maxUnknowns: 10 })
      expect(refused.status).toBe('too-large')
      expect(clock.reads()).toBeLessThanOrEqual(2)
    } finally {
      clock.restore()
    }
  })

  test('the source-stepping ramp itself stops at the first refusal', () => {
    const clock = fakeClock(0)
    try {
      const refused = solveDCBySourceStepping(ladderWorld(20), { maxUnknowns: 10 })
      expect(refused.status).toBe('too-large')
      expect(clock.reads()).toBeLessThanOrEqual(2)
    } finally {
      clock.restore()
    }
  })

  test('the electro-thermal loop reports the refusal instead of settling around it', () => {
    const thermal = solveElectroThermal(ladderWorld(20), { maxUnknowns: 10 })
    expect(thermal.solution.status).toBe('too-large')
    // Nothing was solved, so nothing settled. Reading temperatures off a refusal finds none to differ
    // from the last pass, which looks exactly like a settled fixed point — and would report one.
    expect(thermal.thermalConverged).toBe(false)
    expect(thermal.thermalIterations).toBe(1)
    expect(thermal.temperaturesC.size).toBe(0)
  })

  test('the relay/latch fixed point stops instead of re-solving twenty times', () => {
    // With a relay present the fixed point WOULD iterate; a refusal gives it no coil voltages to
    // decide anything from, so it must stop. Clock reads count the solves it did not repeat.
    const world = ladderWorld(20)
    world.instances.set('k1', {
      id: 'k1',
      definition: 'relay',
      kind_ref: 'primitive_device',
      parameters: { coil_state: { value: 'de_energized' } },
      connects: [],
    } as never)
    const clock = fakeClock(0)
    try {
      const relays = solveWithRelays(world, { maxUnknowns: 10 })
      expect(relays.solution.status).toBe('too-large')
      // …and it must not call the contacts settled either: a refusal leaves no coil voltage to have
      // settled them from, so "no contact wanted to move" is an answer it never earned.
      expect(relays.relaysSettled).toBe(false)
      expect(clock.reads()).toBeLessThanOrEqual(3)
    } finally {
      clock.restore()
    }
  })
})

describe('a refusal outranks a plain-solve failure at the seam the canvas solves through', () => {
  // The defect: a 262-part transistor canvas that really solves in 33.5 s came back `singular-matrix`
  // with no voltages, no warnings and no refusal banner once a budget was applied — a false claim about
  // the physics, because the plain solve reports singular when it runs out of room while the robust
  // solve reports the truth, that it ran out of budget. Seeing this needs the two solves to DISAGREE:
  // the earlier budget tests reach the refusal through `maxUnknowns`, which makes the FIRST solve refuse
  // so both branches carry the same status and the seam is invisible.
  const STIFF_ROW = 2
  const STIFF_COLS = [1, 2, 5, 6] as const

  test('the plain solve fails WITHOUT refusing, and the robust solve refuses', () => {
    const world = stiffMatrixRowWorld(STIFF_ROW, STIFF_COLS)
    // Not a broken circuit: given the passes it needs, it has a real operating point. So the plain
    // solve's verdict below is a failure to find the answer, not the answer.
    expect(solveDCRobust(world).status).toBe('solved')

    const deadline = clockReadsForOneSolve(world) + 0.5
    const clock = fakeClock(1)
    try {
      const plain = solveDC(world, { deadline })
      expect(plain.status).toBe('did-not-converge')
      expect(dcRefused(plain.status)).toBe(false)
      // The next solve starts past the deadline — exactly where the robust fallback runs.
      const robust = solveDCRobust(world, { deadline })
      expect(robust.status).toBe('over-budget')
      expect(dcRefused(robust.status)).toBe(true)
    } finally {
      clock.restore()
    }
  })

  test('solveElectroThermal returns the refusal, not the plain solve’s did-not-converge', () => {
    const world = stiffMatrixRowWorld(STIFF_ROW, STIFF_COLS)
    const deadline = clockReadsForOneSolve(world) + 0.5
    const clock = fakeClock(1)
    try {
      const thermal = solveElectroThermal(world, { deadline })
      expect(thermal.solution.status).toBe('over-budget')
      // What the user gets out of it: the banner and the explanation. A did-not-converge carries
      // neither, which is how the canvas came back empty and silent.
      expect(refusalHeadline(thermal.solution.status)).toContain('ran out of time')
      expect(thermal.solution.warnings[0]).toContain('ran out of time')
      // WHICH solve refused, not merely that one did. The deadline is calibrated against `solveDC`, so if
      // anything upstream ever takes a clock read of its own the offset shifts by one and the PLAIN solve is
      // the one cut instead — which also reports `over-budget` and would satisfy every assertion above while
      // no longer testing this seam at all. The robust solve refuses before its first pass; the plain one
      // refuses after ninety. Pinning zero is what keeps the test aimed where it was pointed.
      expect(thermal.solution.warnings[0]).toContain('0 solver passes')
    } finally {
      clock.restore()
    }
  })

  test('a plain solve that CONVERGED is kept — no fallback runs to overrule it with a refusal', () => {
    // The mirror of the defect, and the worse one: a refusal that outranks a real answer would cost a
    // working circuit its volts. This budget holds room for exactly the one solve this ladder needs, so
    // a fallback that ran anyway would start past the deadline and hand back `over-budget` instead.
    const world = ladderWorld(3)
    const deadline = clockReadsForOneSolve(world) + 0.5
    const clock = fakeClock(1)
    try {
      const thermal = solveElectroThermal(world, { deadline })
      expect(thermal.solution.status).toBe('solved')
      expect(thermal.solution.branches.get('r0')).toBeCloseTo(0.005, 12) // 5 V across 1 kΩ
    } finally {
      clock.restore()
    }
  })

  test('given the room it needs, that SAME stiff circuit still returns its real answer', () => {
    // The fix may only ever replace one failure with a truer one. Hand the circuit its full budget and
    // the fallback must still walk it in: 9.264 mA through every lit LED at the settled junction
    // temperatures (measured; the isothermal solve in tests/dc-robust-stiff.test.ts reads ~9.2 mA).
    const world = stiffMatrixRowWorld(STIFF_ROW, STIFF_COLS)
    const thermal = solveElectroThermal(world)
    expect(thermal.solution.status).toBe('solved')
    expect(thermal.thermalConverged).toBe(true)
    for (const c of STIFF_COLS) {
      const amps = Math.abs(thermal.solution.branches.get(`d.led_${STIFF_ROW}_${c}`) ?? 0)
      expect(amps).toBeCloseTo(0.009264, 5)
    }
    // And the same through the discrete-state seam the canvas actually calls.
    const relays = solveWithRelays(world)
    expect(relays.solution.status).toBe('solved')
    for (const c of STIFF_COLS) {
      const amps = Math.abs(relays.solution.branches.get(`d.led_${STIFF_ROW}_${c}`) ?? 0)
      expect(amps).toBeCloseTo(0.009264, 5)
    }
  })
})

describe('ONE budget covers a whole settling loop, not a fresh one per pass', () => {
  // Each pass of these fixed points is a WHOLE solve, so a loop that re-based its budget every pass
  // would be bounded by 25 × (or 20 ×) the budget — minutes of frozen window, which is the hang the
  // budget exists to prevent. The clock ticks a measured share of the budget per read: enough for the
  // first pass and no more, so a second pass that started its own budget sails past the deadline and
  // reports a settled answer where the shared one stops and says it ran out of time.
  test('the electro-thermal loop budgets the settling, not one solve of it', () => {
    const world = selfHeatingRungWorld()
    const settled = solveElectroThermal(world)
    expect(settled.solution.status).toBe('solved')
    expect(settled.thermalIterations).toBe(4) // it really does re-solve, four passes to the fixed point
    expect(Math.abs(settled.solution.branches.get('r0') ?? 0)).toBeCloseTo(0.0523, 4)

    const clock = fakeClock(SOLVE_BUDGET_MS / (clockReadsForOneSolve(world) + 1))
    try {
      const budgeted = solveElectroThermal(world)
      expect(budgeted.solution.status).toBe('over-budget')
      expect(budgeted.thermalIterations).toBe(2)
    } finally {
      clock.restore()
    }
  })

  test('the relay fixed point budgets the whole settling too', () => {
    const world = coilOnlyRelayWorld()
    const settled = solveWithRelays(world)
    expect(settled.solution.status).toBe('solved')
    expect(settled.relayStates.get('k1')).toBe('energized') // pass two: it pulled in and re-solved
    expect(Math.abs(settled.solution.branches.get('k1') ?? 0)).toBeCloseTo(0.05, 12) // 5 V / 100 Ω

    const clock = fakeClock(SOLVE_BUDGET_MS / (clockReadsForOneSolve(world) + 1))
    try {
      const budgeted = solveWithRelays(world)
      expect(budgeted.solution.status).toBe('over-budget')
      expect(budgeted.relaysSettled).toBe(false)
    } finally {
      clock.restore()
    }
  })
})

describe('the canvas — the path that froze the window', () => {
  /** The same ladder as canvas nodes + wires, the shape solveCanvasDispatch is handed on file open. */
  const ladderCanvas = (rungs: number) => {
    const nodes: Node[] = [
      {
        id: 'vp',
        type: 'device',
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', label: 'V+', parameters: supply(5) },
      },
      {
        id: 'g',
        type: 'device',
        position: { x: 0, y: 80 },
        data: { definition: 'ground', label: 'GND' },
      },
    ]
    const edges: Edge[] = [
      {
        id: 'e_gnd',
        source: 'vp',
        sourceHandle: 'terminal_negative',
        target: 'g',
        targetHandle: 'reference_terminal',
        type: 'net',
      },
    ]
    for (let i = 0; i < rungs; i++) {
      nodes.push({
        id: `r${i}`,
        type: 'device',
        position: { x: i * 40, y: 40 },
        data: { definition: 'resistor', label: 'R', parameters: resistor(1000) },
      })
      edges.push({
        id: `e_top${i}`,
        source: 'vp',
        sourceHandle: 'terminal_positive',
        target: `r${i}`,
        targetHandle: 'terminal_a',
        type: 'net',
      })
      edges.push({
        id: `e_bot${i}`,
        source: `r${i}`,
        sourceHandle: 'terminal_b',
        target: 'g',
        targetHandle: 'reference_terminal',
        type: 'net',
      })
    }
    return { nodes, edges }
  }

  test('an over-size canvas is refused with an explanation, not attempted', () => {
    const { nodes, edges } = ladderCanvas(7000)
    const started = performance.now()
    const solved = solveCanvasDispatch(nodes, edges)
    const elapsed = performance.now() - started
    expect(solved.solution.status).toBe('too-large')
    expect(refusalHeadline(solved.solution.status)).toBeDefined()
    expect(solved.solution.warnings[0]).toContain('too big')
    // No readings and no health: nothing was simulated, so nothing may look simulated.
    expect(solved.readings.size).toBe(0)
    expect(solved.health.size).toBe(0)
    // Every wire still renders (the drawing is not the physics) but carries no current.
    expect(solved.edges.length).toBe(edges.length)
    expect(elapsed).toBeLessThan(15_000)
  })

  test('the canvas takes the TIGHT canvas budget, not the library runaway stop', () => {
    // The clock reads 0 once (when the deadline is set) and 10 s from then on. 10 s is past the canvas
    // budget and nowhere near the library one, so the status alone says which budget the canvas took.
    expect(CANVAS_SOLVE_BUDGET_MS).toBeLessThan(10_000)
    expect(SOLVE_BUDGET_MS).toBeGreaterThan(10_000)
    const clock = scriptedClock([0, 10_000])
    try {
      const { nodes, edges } = ladderCanvas(1)
      expect(solveCanvasDispatch(nodes, edges).solution.status).toBe('over-budget')
    } finally {
      clock.restore()
    }
  })

  test('a canvas that fits still solves, and its wires carry the real current', () => {
    const { nodes, edges } = ladderCanvas(2)
    const solved = solveCanvasDispatch(nodes, edges)
    expect(solved.solution.status).toBe('solved')
    expect(refusalHeadline(solved.solution.status)).toBeUndefined()
    const amps = solved.edges.map((e) => (e.data as { amps?: number | null } | undefined)?.amps)
    expect(amps.some((a) => typeof a === 'number' && Math.abs(a) > 1e-6)).toBe(true)
  })
})

describe('the answer does not change', () => {
  test('an ordinary circuit solves identically with the budget on and with no budget at all', () => {
    const world = diodeWorld()
    const budgeted = solveDC(world)
    const unbounded = solveDC(world, {
      deadline: Number.POSITIVE_INFINITY,
      maxUnknowns: Number.POSITIVE_INFINITY,
    })
    expect(budgeted.status).toBe('solved')
    expect(unbounded.status).toBe('solved')
    expect(budgeted.iterations).toBe(unbounded.iterations)
    expect([...budgeted.nodes].sort()).toEqual([...unbounded.nodes].sort())
    expect([...budgeted.branches].sort()).toEqual([...unbounded.branches].sort())
  })

  test('a transient run is identical with and without a budget', () => {
    const options = { timeStep: 1e-4, duration: 2e-3 }
    const budgeted = solveTransient(ladderWorld(2), options)
    const unbounded = solveTransient(ladderWorld(2), {
      ...options,
      deadline: Number.POSITIVE_INFINITY,
      maxUnknowns: Number.POSITIVE_INFINITY,
    })
    expect(budgeted.status).toBe('solved')
    expect(budgeted.series.length).toBe(unbounded.series.length)
    const lastBudgeted = budgeted.series[budgeted.series.length - 1]?.nodes ?? new Map()
    const lastUnbounded = unbounded.series[unbounded.series.length - 1]?.nodes ?? new Map()
    expect([...lastBudgeted].sort()).toEqual([...lastUnbounded].sort())
  })
})

// The canvas capacity — the OTHER half of a window that keeps answering — has its own file now
// (tests/canvas-capacity.test.ts), because it is measured from the DRAWING and has its own set of doors.

describe('the budget constants and what the user is told', () => {
  test('the canvas budget is tighter than the library runaway stop', () => {
    expect(CANVAS_SOLVE_BUDGET_MS).toBeLessThan(SOLVE_BUDGET_MS)
  })

  test('an existing deadline is passed through, never restarted', () => {
    expect(solveDeadline(1234)).toBe(1234)
    const fresh = solveDeadline(undefined, 1000)
    expect(fresh).toBeGreaterThan(performance.now())
    expect(fresh).toBeLessThanOrEqual(performance.now() + 1000)
  })

  test('only the two no-answer statuses get a headline on the canvas', () => {
    expect(refusalHeadline('too-large')).toContain('too big')
    expect(refusalHeadline('over-budget')).toContain('ran out of time')
    expect(refusalHeadline('solved')).toBeUndefined()
    expect(refusalHeadline('did-not-converge')).toBeUndefined()
  })
})
