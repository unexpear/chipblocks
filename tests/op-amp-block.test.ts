/**
 * The built-in op-amp block (Sprint 22) — proof that packaging the op-amp as a
 * circuit block changes nothing physically. We wire the block on a canvas exactly as
 * a user would (drop it, connect ±9 V rails and the two inputs), flatten it through
 * the real pipeline (flattenBlocks → canvasToWorld), and solve. The block must bias
 * into the active region and amplify like the flat five-transistor op-amp it is.
 */

import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import { type CanvasEdgeLike, type CanvasNodeLike, flattenBlocks } from '../src/renderer/blocks.ts'
import { OPAMP_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

/** Drop the op-amp block, wire it to ±9 V and the two inputs, flatten + solve; return
 *  the solve status and the output-node voltage. */
function wiredOpAmp(inPlus: number, inMinus: number): { status: string; vout: number } {
  const nodes: CanvasNodeLike[] = [
    { id: 'opamp', position: { x: 0, y: 0 }, data: { definition: 'block', block: OPAMP_BLOCK } },
    {
      id: 'vpos',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(9) },
    },
    {
      id: 'vneg',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(9) },
    },
    {
      id: 'vip',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(inPlus) },
    },
    {
      id: 'vim',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(inMinus) },
    },
    { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
  ]
  const wire = (
    id: string,
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
  ): CanvasEdgeLike => ({ id, source, sourceHandle, target, targetHandle })
  const edges: CanvasEdgeLike[] = [
    wire('a', 'vpos', 'terminal_positive', 'opamp', 'v_plus'),
    wire('b', 'vpos', 'terminal_negative', 'gnd', 'reference_terminal'),
    wire('c', 'vneg', 'terminal_positive', 'gnd', 'reference_terminal'),
    wire('d', 'vneg', 'terminal_negative', 'opamp', 'v_minus'),
    wire('e', 'vip', 'terminal_positive', 'opamp', 'in_plus'),
    wire('f', 'vip', 'terminal_negative', 'gnd', 'reference_terminal'),
    wire('g', 'vim', 'terminal_positive', 'opamp', 'in_minus'),
    wire('h', 'vim', 'terminal_negative', 'gnd', 'reference_terminal'),
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
  const solution = solveDCRobust(world)
  const outNet = world.instances
    .get('opamp.q5')
    ?.connects?.find((c) => c.terminal === 'collector')?.net
  return { status: solution.status, vout: solution.nodes.get(outNet ?? '') ?? Number.NaN }
}

describe('built-in op-amp block', () => {
  test('flattens to the real transistors and biases into the active region', () => {
    const { status, vout } = wiredOpAmp(0, 0)
    expect(status).toBe('solved')
    // Between the rails (active), biased high like the flat op-amp (~8 V on ±9 V).
    expect(vout).toBeGreaterThan(1)
    expect(vout).toBeLessThan(8.8)
  })

  test('it amplifies: a few mV of input swings the output rail to rail', () => {
    expect(wiredOpAmp(5e-3, 0).vout).toBeGreaterThan(7) // in+ up -> output to the high rail
    expect(wiredOpAmp(-5e-3, 0).vout).toBeLessThan(-7) // in+ down -> output to the low rail
  })
})
