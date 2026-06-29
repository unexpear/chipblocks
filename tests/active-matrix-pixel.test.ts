/**
 * The active-matrix pixel is a REAL AMOLED/TFT 2T1C cell: a select NMOS, a storage capacitor, a drive
 * PMOS, and an LED. It does the thing a passive matrix can't — the stored voltage on the cap sets the
 * drive transistor's gate, so the LED glows at a brightness SET BY the data (real per-pixel ANALOG grey),
 * and it does so from a held charge, not a duty cycle. Verified: it flattens to exactly those four real
 * parts, and the LED's current rises smoothly as the data voltage drives the pixel brighter.
 */

import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import { type CanvasEdgeLike, type CanvasNodeLike, flattenBlocks } from '../src/renderer/blocks.ts'
import { ACTIVE_MATRIX_PIXEL } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (v: number) => ({
  nominal_voltage: scalar(v, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

function build(scanV: number, dataV: number) {
  const psrc = (id: string, v: number): CanvasNodeLike => ({
    id,
    position: { x: 0, y: 0 },
    data: { definition: 'power_source', parameters: supply(v) },
  })
  const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
    id,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const nodes: CanvasNodeLike[] = [
    {
      id: 'px',
      position: { x: 0, y: 0 },
      data: { definition: 'block', block: ACTIVE_MATRIX_PIXEL },
    },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    psrc('vp', 5),
    psrc('sc', scanV),
    psrc('da', dataV),
  ]
  const edges: CanvasEdgeLike[] = [
    w('e_vp', 'vp', 'terminal_positive', 'px', 'vdd'),
    w('e_vpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_sc', 'sc', 'terminal_positive', 'px', 'scan'),
    w('e_scn', 'sc', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_da', 'da', 'terminal_positive', 'px', 'data'),
    w('e_dan', 'da', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_g', 'px', 'gnd', 'g', 'reference_terminal'),
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
  const sol = solveDCRobust(world)
  const led = flat.nodes.find((n) => n.data.definition === 'led')
  const ledCurrent = led ? Math.abs(sol.branches.get(led.id) ?? 0) : -1
  return { flat, ledCurrent }
}

describe('active-matrix pixel (2T1C) — real AMOLED cell: a stored voltage sets analog brightness', () => {
  test('flattens to exactly a select NMOS + drive PMOS + storage capacitor + LED', () => {
    const { flat } = build(5, 0)
    const def = (d: string) => flat.nodes.filter((n) => n.data.definition === d).length
    expect(def('transistor_mosfet_nmos')).toBe(1) // the SELECT transistor
    expect(def('transistor_mosfet_pmos')).toBe(1) // the DRIVE transistor
    expect(def('capacitor')).toBe(1) // the STORAGE cap — the thing a passive pixel lacks
    expect(def('led')).toBe(1)
    const parts = flat.nodes.filter(
      (n) =>
        n.data.definition !== 'ground' &&
        !n.id.startsWith('vp') &&
        !n.id.startsWith('sc') &&
        !n.id.startsWith('da'),
    )
    expect(parts.length).toBe(4) // nothing else inside the pixel
  })

  test('the data voltage sets the LED brightness — real per-pixel analog grey (low data = bright)', () => {
    const bright = build(5, 0).ledCurrent // pixel selected, data low → drive PMOS full on
    const mid = build(5, 2.5).ledCurrent
    const dim = build(5, 5).ledCurrent // data high → drive nearly off
    expect(bright).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThanOrEqual(dim) // monotonic: brighter as the stored voltage drives harder
    expect(bright).toBeGreaterThan(1e-4) // a driven pixel genuinely lights
    expect(bright).toBeGreaterThan(dim * 2) // and a bright pixel is clearly brighter than a dim one
  })
})
