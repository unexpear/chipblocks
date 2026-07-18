/**
 * The built-in ANALOG blocks (the wired starter circuits, packaged as reusable blocks with ports) — proof
 * that dropping one and wiring its ports gives the same working circuit the templates do. Each block is wired
 * to a minimal harness exactly as a user would, flattened through the real pipeline (flattenBlocks →
 * canvasToWorld) and solved. Mirrors op-amp-block.test.ts.
 */
import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import {
  type BlockData,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  flattenBlocks,
} from '../src/renderer/blocks.ts'
import { BUILTIN_BLOCKS } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { defaultParameters } from '../src/renderer/part-defaults.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

const blk = (id: string, key: string): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'block', block: BUILTIN_BLOCKS[key] as BlockData },
})
const res = (id: string, ohms: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    definition: 'resistor',
    parameters: { ...defaultParameters('resistor'), resistance: scalar(ohms, 'ohm') },
  },
})
const src = (id: string, volts: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(volts) },
})
const gnd = (id: string): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'ground' },
})
const w = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): CanvasEdgeLike => ({ id, source, sourceHandle, target, targetHandle })

/** Flatten a wired canvas + solve; return the status and a node-voltage reader keyed by inner instance id. */
function solveWired(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]) {
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
  const solution = solveDCRobust(world)
  const V = (instId: string, terminal: string): number => {
    const net = world.instances.get(instId)?.connects?.find((c) => c.terminal === terminal)?.net
    return solution.nodes.get(net ?? '') ?? Number.NaN
  }
  return { status: solution.status, V }
}

describe('analog building blocks flatten to real parts and solve', () => {
  test('Divider halves a 10 V rail — the tap sits at 5 V', () => {
    const { status, V } = solveWired(
      [blk('D', 'block_divider'), src('vs', 10), gnd('g')],
      [
        w('a', 'vs', 'terminal_positive', 'D', 'in'),
        w('b', 'vs', 'terminal_negative', 'g', 'reference_terminal'),
        w('c', 'D', 'gnd', 'g', 'reference_terminal'),
      ],
    )
    expect(status).toBe('solved')
    expect(V('D.r1', 'terminal_b')).toBeCloseTo(5, 1)
  })

  test('LED + R conducts — the LED drops ~2 V and a few mA flow', () => {
    const { status, V } = solveWired(
      [blk('L', 'block_led_r'), src('vs', 5), gnd('g')],
      [
        w('a', 'vs', 'terminal_positive', 'L', 'in'),
        w('b', 'vs', 'terminal_negative', 'g', 'reference_terminal'),
        w('c', 'L', 'gnd', 'g', 'reference_terminal'),
      ],
    )
    expect(status).toBe('solved')
    const anode = V('L.d1', 'anode')
    expect(anode).toBeGreaterThan(1.2)
    expect(anode).toBeLessThan(3)
    expect((5 - anode) / 150).toBeGreaterThan(0.005) // conducting current
  })

  test('RC low-pass passes DC — the cap blocks, the resistor drops nothing, out = in', () => {
    const { status, V } = solveWired(
      [blk('F', 'block_rc_lowpass'), src('vs', 2), gnd('g')],
      [
        w('a', 'vs', 'terminal_positive', 'F', 'in'),
        w('b', 'vs', 'terminal_negative', 'g', 'reference_terminal'),
        w('c', 'F', 'gnd', 'g', 'reference_terminal'),
      ],
    )
    expect(status).toBe('solved')
    expect(V('F.r1', 'terminal_b')).toBeCloseTo(2, 2)
  })

  test('CE amp biases into the active region (Vc ≈ mid-supply, Ve ≈ 1.4 V)', () => {
    const { status, V } = solveWired(
      [blk('A', 'block_ce_amp'), src('vcc', 12), gnd('g')],
      [
        w('a', 'vcc', 'terminal_positive', 'A', 'vcc'),
        w('b', 'vcc', 'terminal_negative', 'g', 'reference_terminal'),
        w('c', 'A', 'gnd', 'g', 'reference_terminal'),
        w('d', 'A', 'in', 'g', 'reference_terminal'),
      ],
    )
    expect(status).toBe('solved')
    const vc = V('A.q1', 'collector')
    const ve = V('A.q1', 'emitter')
    expect(vc).toBeGreaterThan(3)
    expect(vc).toBeLessThan(9) // between the rails → active
    expect(vc).toBeGreaterThan(ve + 0.5) // collector above emitter (not saturated)
    expect(ve).toBeGreaterThan(0.8)
    expect(ve).toBeLessThan(2.2)
  })

  test('Bridge rectifies a positive input to a positive rail (one diode drop down)', () => {
    // A rectifier needs a load to draw DC current; without one no diode forward-conducts.
    // A DC source across ac1/ac2 exercises one conduction path (ac1 → D1 → out → load → gnd).
    const { status, V } = solveWired(
      [blk('B', 'block_bridge'), src('vs', 5), res('rload', 1000), gnd('g')],
      [
        w('a', 'vs', 'terminal_positive', 'B', 'ac1'),
        w('b', 'vs', 'terminal_negative', 'g', 'reference_terminal'),
        w('c', 'B', 'ac2', 'g', 'reference_terminal'),
        w('d', 'B', 'gnd', 'g', 'reference_terminal'),
        w('e', 'B', 'out', 'rload', 'terminal_a'),
        w('f', 'rload', 'terminal_b', 'g', 'reference_terminal'),
      ],
    )
    expect(status).toBe('solved')
    const out = V('B.d1', 'cathode')
    expect(out).toBeGreaterThan(3.5) // rectified, ~Vin − diode drop
    expect(out).toBeLessThan(5)
  })

  test('Non-inverting amp block biases + the feedback loop converges on ±15 V', () => {
    const { status, V } = solveWired(
      [blk('N', 'block_noninv_amp'), src('vp', 15), src('vn', 15), gnd('g')],
      [
        w('a', 'vp', 'terminal_positive', 'N', 'v_plus'),
        w('b', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
        w('c', 'vn', 'terminal_positive', 'g', 'reference_terminal'),
        w('d', 'vn', 'terminal_negative', 'N', 'v_minus'),
        w('e', 'N', 'in', 'g', 'reference_terminal'),
        w('f', 'N', 'gnd', 'g', 'reference_terminal'),
      ],
    )
    expect(status).toBe('solved')
    const out = V('N.u1.q5', 'collector') // the nested op-amp's output stage
    expect(Number.isFinite(out)).toBe(true)
    expect(Math.abs(out)).toBeLessThan(3) // ≈ 0 with a grounded input (virtual short holds)
  })
})
