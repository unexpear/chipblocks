/**
 * The electro-thermal DC solve falls back to the robust (source/gmin-stepping) solver when the fast
 * plain-Newton solve fails to converge. A cross-coupled SRAM cell being written is the canonical stiff
 * case: plain `solveDC` gives up (converged = false, a garbage node voltage), but the robust solver walks
 * it in — so the app's solve (which goes through solveElectroThermal) must land on the real answer.
 */
import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { solveElectroThermal } from '../src/electro-thermal.ts'
import { type CanvasEdgeLike, type CanvasNodeLike, flattenBlocks } from '../src/renderer/blocks.ts'
import { SRAM_CELL_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const sc = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: sc(volts, 'volt'),
  internal_resistance: sc(0, 'ohm'),
})

// A 6T SRAM cell mid-write: V+/GND, word line HIGH, BL HIGH and BL̄ tied low → the cell should store 1.
function sramWriteWorld() {
  const nodes: CanvasNodeLike[] = [
    { id: 'cell', position: { x: 0, y: 0 }, data: { definition: 'block', block: SRAM_CELL_BLOCK } },
    {
      id: 'vdd',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
    {
      id: 'wl',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
    {
      id: 'bl',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
  ]
  const e = (
    id: string,
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
  ): CanvasEdgeLike => ({
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
  })
  const edges: CanvasEdgeLike[] = [
    e('v', 'vdd', 'terminal_positive', 'cell', 'v_dd'),
    e('vg', 'vdd', 'terminal_negative', 'g', 'reference_terminal'),
    e('cg', 'cell', 'gnd', 'g', 'reference_terminal'),
    e('w', 'wl', 'terminal_positive', 'cell', 'wl'),
    e('wg', 'wl', 'terminal_negative', 'g', 'reference_terminal'),
    e('b', 'bl', 'terminal_positive', 'cell', 'bl'),
    e('bg', 'bl', 'terminal_negative', 'g', 'reference_terminal'),
    e('bb', 'cell', 'blb', 'g', 'reference_terminal'),
  ]
  const flat = flattenBlocks(nodes, edges)
  return canvasToWorld(
    flat.nodes.map((n) => ({
      id: n.id,
      definition: n.data.definition,
      parameters: n.data.parameters,
    })),
    flat.edges.map((ed) => ({
      id: ed.id,
      source: ed.source,
      target: ed.target,
      sourceHandle: ed.sourceHandle ?? null,
      targetHandle: ed.targetHandle ?? null,
    })),
  )
}

// Q is the first inverter's output node (its PMOS drain).
const qOf = (world: ReturnType<typeof canvasToWorld>, solution: { nodes: Map<string, number> }) => {
  const net = world.instances
    .get('cell.inv1.pmos')
    ?.connects?.find((c) => c.terminal === 'drain')?.net
  return net === undefined ? Number.NaN : (solution.nodes.get(net) ?? Number.NaN)
}

describe('electro-thermal solve converges a stiff cell the plain solver cannot', () => {
  test('plain solveDC does NOT converge the SRAM write', () => {
    const world = sramWriteWorld()
    expect(solveDC(world).converged).toBe(false)
  })

  test('solveElectroThermal falls back to the robust solver and writes Q = 1', () => {
    const world = sramWriteWorld()
    const result = solveElectroThermal(world)
    expect(result.solution.converged).toBe(true)
    expect(qOf(world, result.solution)).toBeGreaterThan(4)
  })
})
