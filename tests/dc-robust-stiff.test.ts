/**
 * Stiff but well-posed mixed-diode circuits converge through solveDCRobust. A multiplexed LED matrix with
 * a particular set of columns lit converges SLOWLY — pnjlim step-limiting inches the coupled junctions to
 * the operating point over hundreds of Newton iterations (one pattern needs ~520) — yet it DOES converge.
 * The old 100-iteration budget cut it off and returned a FALSE `did-not-converge` with collapsed zero
 * currents, silently dropping results. This guards the generous budget that lets the slow-but-real cases
 * finish. (The display scan path also has an exact per-column fallback, but this is the general fix.)
 */

import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import { type CanvasEdgeLike, type CanvasNodeLike, flattenBlocks } from '../src/renderer/blocks.ts'
import { DOT_MATRIX_MUX_8X8 } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
  internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
})

/** Drive `row` of the 8×8 matrix high and pull `cols` to ground — the scan path's per-row circuit. */
function rowWorld(row: number, cols: number[]) {
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
  for (const c of cols)
    edges.push({
      id: `e_col_${c}`,
      source: 'd',
      sourceHandle: `col_${c}`,
      target: 'g',
      targetHandle: 'reference_terminal',
    })
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

describe('solveDCRobust converges stiff mixed-diode circuits (slow but well-posed)', () => {
  // Both patterns used to FAIL at the old 100-iteration cap: cols 2,3,6,7 needs ~182 iters, cols 1,2,5,6 ~522.
  for (const cols of [
    [2, 3, 6, 7],
    [1, 2, 5, 6],
  ]) {
    test(`8×8 matrix, row 2, cols ${cols.join(',')} — converges, every lit LED ~9.2 mA (not collapsed to 0)`, () => {
      const sol = solveDCRobust(rowWorld(2, cols))
      expect(sol.converged).toBe(true)
      expect(sol.status).toBe('solved')
      for (const c of cols) {
        const i = Math.abs(sol.branches.get(`d.led_2_${c}`) ?? 0)
        expect(i).toBeGreaterThan(8e-3) // a real ~9.2 mA
        expect(i).toBeLessThan(11e-3)
      }
    })
  }
})
