/**
 * The MULTIPLEXED LED matrix is REAL hardware wired the way an actual LED panel is: R row lines + C
 * column lines (R+C pins), not one wire per pixel (R×C pins). It flattens to nothing but genuine LEDs +
 * one current-limiting resistor per column. And the physics is real: driving a row HIGH + a column LOW
 * lights exactly that pixel through its column resistor; pixels whose column is undriven stay dark, and
 * pixels in an undriven row stay dark (the diode blocks reverse current) — which is why a passive matrix
 * has no sneak-path ghosting as long as only one row is driven at a time.
 */

import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import { type CanvasEdgeLike, type CanvasNodeLike, flattenBlocks } from '../src/renderer/blocks.ts'
import { DOT_MATRIX_MUX_8X8, DOT_MATRIX_MUX_16X16 } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})
/** 0.1 mA — at/above this an LED is conducting (glowing), matching health.ts's LIT_FLOOR_AMPS. */
const LIT = 1e-4

function solveMux(matrix: typeof DOT_MATRIX_MUX_8X8, highPorts: string[], lowPorts: string[]) {
  const nodes: CanvasNodeLike[] = [
    { id: 'd', position: { x: 0, y: 0 }, data: { definition: 'block', block: matrix } },
    { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    ...highPorts.map((p) => ({
      id: `src_${p}`,
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    })),
  ]
  const edges: CanvasEdgeLike[] = [
    ...highPorts.flatMap((p) => [
      {
        id: `w_${p}_p`,
        source: `src_${p}`,
        sourceHandle: 'terminal_positive',
        target: 'd',
        targetHandle: p,
      },
      {
        id: `w_${p}_n`,
        source: `src_${p}`,
        sourceHandle: 'terminal_negative',
        target: 'gnd',
        targetHandle: 'reference_terminal',
      },
    ]),
    ...lowPorts.map((p) => ({
      id: `w_${p}_lo`,
      source: 'd',
      sourceHandle: p,
      target: 'gnd',
      targetHandle: 'reference_terminal',
    })),
  ]
  const flat = flattenBlocks(nodes, edges)
  const world = canvasToWorld(
    flat.nodes.map((nd) => ({
      id: nd.id,
      definition: nd.data.definition,
      parameters: nd.data.parameters,
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
  // flattenBlocks namespaces inner ids as `blockId.innerId`, so find the real LED node by its suffix.
  const px = (r: number, c: number) => {
    const node = flat.nodes.find(
      (n) => n.data.definition === 'led' && n.id.endsWith(`led_${r}_${c}`),
    )
    return node ? Math.abs(solution.branches.get(node.id) ?? 0) : -1
  }
  return { flat, solution, px }
}

describe('multiplexed LED matrix — real hardware, row+column wiring (not one pin per pixel)', () => {
  test('8×8 flattens to 64 real LEDs + 8 column resistors and nothing else; 16 pins not 64', () => {
    const { flat } = solveMux(DOT_MATRIX_MUX_8X8, [], [])
    const parts = flat.nodes.filter((nd) => nd.data.definition !== 'ground')
    const leds = parts.filter((nd) => nd.data.definition === 'led')
    const resistors = parts.filter((nd) => nd.data.definition === 'resistor')
    expect(leds.length).toBe(64)
    expect(resistors.length).toBe(8) // ONE per column, not one per pixel
    expect(
      parts.every((nd) => nd.data.definition === 'led' || nd.data.definition === 'resistor'),
    ).toBe(true)
    const ports = DOT_MATRIX_MUX_8X8.ports
    expect(ports.filter((p) => p.id.startsWith('row_')).length).toBe(8)
    expect(ports.filter((p) => p.id.startsWith('col_')).length).toBe(8)
    expect(ports.length).toBe(16) // 8 + 8 — the multiplexing win (un-muxed 8×8 would need 64+ pins)
  })

  test('16×16 drives 256 pixels with 32 pins (vs 256 un-muxed) — the wire-explosion fix', () => {
    expect(DOT_MATRIX_MUX_16X16.ports.length).toBe(32)
    const leds = DOT_MATRIX_MUX_16X16.nodes.filter((n) => n.definition === 'led')
    expect(leds.length).toBe(256)
  })

  test('row HIGH + column LOW lights exactly that one pixel', () => {
    const { px } = solveMux(DOT_MATRIX_MUX_8X8, ['row_2'], ['col_3'])
    expect(px(2, 3)).toBeGreaterThan(LIT) // the addressed pixel glows
    expect(px(2, 4)).toBeLessThan(LIT) // same row, column undriven → dark
    expect(px(3, 3)).toBeLessThan(LIT) // same column, row undriven → dark (diode blocks reverse)
    expect(px(0, 0)).toBeLessThan(LIT) // unrelated pixel → dark
  })

  test('one driven row lights its chosen columns and nothing in other rows (the scan principle)', () => {
    const { px } = solveMux(DOT_MATRIX_MUX_8X8, ['row_5'], ['col_1', 'col_4', 'col_6'])
    for (const c of [1, 4, 6]) expect(px(5, c)).toBeGreaterThan(LIT)
    for (const c of [0, 2, 3, 5, 7]) expect(px(5, c)).toBeLessThan(LIT)
    for (const c of [1, 4, 6]) expect(px(3, c)).toBeLessThan(LIT) // other row stays dark
  })
})
