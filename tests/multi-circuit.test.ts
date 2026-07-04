/**
 * Multi-circuit support: several independent circuits share one canvas, and each is tracked on its
 * own. Jobs: a floating (ungrounded) circuit no longer takes down the healthy one beside it — it is
 * pruned with a note naming its parts, never given made-up voltages; two circuits each carrying a
 * ground still solve together correctly (all grounds are one 0 V reference, the EDA node-0
 * convention — but no current crosses between unconnected loops); and a canvas with no ground at
 * all keeps its honest 'no-ground' refusal.
 */
import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { partReadings } from '../src/renderer/part-readings.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

const source = (id: string, volts: number): CanvasNode => ({
  id,
  definition: 'power_source',
  parameters: {
    nominal_voltage: scalar(volts, 'volt'),
    internal_resistance: scalar(0, 'ohm'),
  },
})
const resistor = (id: string, ohms: number): CanvasNode => ({
  id,
  definition: 'resistor',
  parameters: { resistance: scalar(ohms, 'ohm') },
})

/** Circuit A: 5 V across a 1 kΩ divider pair, grounded. Circuit B: built by the caller. */
function circuitA(): { nodes: CanvasNode[]; edges: ReturnType<typeof g>[] } {
  return {
    nodes: [
      source('va', 5),
      resistor('ra1', 1000),
      resistor('ra2', 1000),
      { id: 'gnda', definition: 'ground' },
    ],
    edges: [
      g('va', 'terminal_positive', 'ra1', 'terminal_a'),
      g('ra1', 'terminal_b', 'ra2', 'terminal_a'),
      g('ra2', 'terminal_b', 'va', 'terminal_negative'),
      g('va', 'terminal_negative', 'gnda', 'reference_terminal'),
    ],
  }
}

/** The divider's midpoint net id, found from the solved world (r1.b's net). */
function midNet(world: ReturnType<typeof canvasToWorld>): string {
  const net = world.instances.get('ra1')?.connects?.find((c) => c.terminal === 'terminal_b')?.net
  if (net === undefined) throw new Error('no divider midpoint net')
  return net
}

describe('a floating circuit no longer kills the healthy one', () => {
  const a = circuitA()
  // Circuit B: a battery and resistor loop with NO ground — mid-edit, unfinished.
  const nodes = [...a.nodes, source('vb', 9), resistor('rb1', 470)]
  const edges = [
    ...a.edges,
    g('vb', 'terminal_positive', 'rb1', 'terminal_a'),
    g('rb1', 'terminal_b', 'vb', 'terminal_negative'),
  ]
  const world = canvasToWorld(nodes, edges)

  test('DC: circuit A solves with the right numbers; B is named in a note, not faked', () => {
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    expect(sol.nodes.get(midNet(world))).toBeCloseTo(2.5, 6) // the divider still divides
    expect(sol.warnings.some((w) => w.includes('vb') && w.includes('no path'))).toBe(true)
    // the floating circuit's nets got no made-up voltages
    const rbNet = world.instances.get('rb1')?.connects?.[0]?.net
    expect(rbNet !== undefined && sol.nodes.has(rbNet)).toBe(false)
  })

  test('transient: same honesty over time', () => {
    const res = solveTransient(world, { timeStep: 1e-5, duration: 1e-3 })
    expect(res.status).toBe('solved')
    const last = res.series[res.series.length - 1]
    expect(last?.nodes.get(midNet(world))).toBeCloseTo(2.5, 6)
    expect(res.warnings.some((w) => w.includes('vb') && w.includes('no path'))).toBe(true)
  })
})

describe('two circuits, each grounded, solve independently side by side', () => {
  const a = circuitA()
  const nodes = [
    ...a.nodes,
    source('vb', 9),
    resistor('rb1', 450),
    { id: 'gndb', definition: 'ground' },
  ]
  const edges = [
    ...a.edges,
    g('vb', 'terminal_positive', 'rb1', 'terminal_a'),
    g('rb1', 'terminal_b', 'vb', 'terminal_negative'),
    g('vb', 'terminal_negative', 'gndb', 'reference_terminal'),
  ]
  const world = canvasToWorld(nodes, edges)

  test('both circuits read their own correct numbers — nothing bleeds across', () => {
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    expect(sol.nodes.get(midNet(world))).toBeCloseTo(2.5, 6) // A's divider unchanged by B
    const rbTop = world.instances
      .get('rb1')
      ?.connects?.find((c) => c.terminal === 'terminal_a')?.net
    if (rbTop === undefined) throw new Error('no rb1 net')
    expect(sol.nodes.get(rbTop)).toBeCloseTo(9, 6) // B's 9 V loop reads 9 V
    expect(sol.branches.get('rb1')).toBeCloseTo(9 / 450, 6) // and its own current
  })
})

describe('the honest refusals stay', () => {
  test('a canvas with no ground anywhere is still no-ground, not half-solved', () => {
    const nodes = [source('v1', 5), resistor('r1', 1000)]
    const edges = [
      g('v1', 'terminal_positive', 'r1', 'terminal_a'),
      g('r1', 'terminal_b', 'v1', 'terminal_negative'),
    ]
    expect(solveDC(canvasToWorld(nodes, edges)).status).toBe('no-ground')
  })

  test('a floating induction motor goes honestly blank — no nameplate numbers as if spinning', () => {
    // The motor's readings come from nameplate parameters, so without the in-the-solution gate a
    // pruned motor would still display full running current/RPM while everything else went blank.
    const a = circuitA()
    const nodes: CanvasNode[] = [
      ...a.nodes,
      source('vm', 230),
      {
        id: 'im1',
        definition: 'induction_motor',
        parameters: {
          supply_voltage: scalar(230, 'volt'),
          line_frequency: scalar(50, 'hertz'),
          pole_count: scalar(4, 'dimensionless'),
          stator_resistance: scalar(2, 'ohm'),
          stator_reactance: scalar(4, 'ohm'),
          rotor_resistance: scalar(2, 'ohm'),
          rotor_reactance: scalar(4, 'ohm'),
          magnetizing_reactance: scalar(80, 'ohm'),
          load_torque: scalar(20, 'N*m'),
          viscous_friction: scalar(0.002, 'N*m*s/rad'),
        },
      },
    ]
    const edges = [
      ...a.edges,
      // the motor loop is wired to its supply but NOT grounded — a floating circuit
      g('vm', 'terminal_positive', 'im1', 'terminal_a'),
      g('im1', 'terminal_b', 'vm', 'terminal_negative'),
    ]
    const world = canvasToWorld(nodes, edges)
    const sol = solveDC(world)
    expect(sol.status).toBe('solved') // circuit A still solves
    const readings = partReadings(world, sol)
    expect(readings.has('im1')).toBe(false) // the unsolved motor shows NOTHING, not 1425 RPM
    expect(readings.get('ra1')?.current).toBeCloseTo(2.5 / 1000, 6) // A's readings intact
  })
})
