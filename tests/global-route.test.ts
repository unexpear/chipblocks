/**
 * Global router (auto-wirer overhaul — visibility-graph routing): routeAllWires routes each wire on its
 * own bounded Hanan visibility lattice with a heavy bend penalty (long straight runs, few corners, never
 * crossing a part), then nudgeRoutes spreads the parallel runs. These tests lock in the load-bearing
 * invariants: NO path ever cuts a part (the fallback-diagonal regression guard), endpoints land exactly,
 * every segment is axis-aligned, bends stay low, and a big batch routes well under the time budget.
 */

import { describe, expect, test } from 'vitest'
import {
  type Box,
  type Pt,
  routeAllWires,
  segmentHitsBox,
  type WireReq,
} from '../src/renderer/orthogonal-route.ts'

const isOrtho = (path: Pt[]) =>
  path.every((p, i) => {
    if (i === 0) return true
    const prev = path[i - 1]
    return prev !== undefined && (p.x === prev.x || p.y === prev.y)
  })
const hitsBox = (path: Pt[], box: Box) => {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    if (a && b && segmentHitsBox(a, b, box)) return true
  }
  return false
}
const hitsAny = (path: Pt[], boxes: Box[]) => boxes.some((b) => hitsBox(path, b))
const get = (m: Map<string, Pt[]>, id: string): Pt[] => {
  const p = m.get(id)
  expect(p).toBeDefined()
  return p ?? []
}
const bendCount = (path: Pt[]) => {
  let n = 0
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1]
    const b = path[i]
    const c = path[i + 1]
    if (a && b && c && (a.x === b.x) !== (b.x === c.x)) n++
  }
  return n
}

describe('global router — bounded visibility-graph routing', () => {
  test('routes a wire around a blocking part without crossing it', () => {
    const box: Box = { x: 80, y: 64, w: 32, h: 64 } // straddles the straight y=96 line
    const paths = routeAllWires([{ id: 'w', from: { x: 0, y: 96 }, to: { x: 192, y: 96 } }], [box])
    const path = get(paths, 'w')
    expect(path[0]).toEqual({ x: 0, y: 96 })
    expect(path[path.length - 1]).toEqual({ x: 192, y: 96 })
    expect(isOrtho(path)).toBe(true)
    expect(hitsBox(path, box)).toBe(false)
  })

  test('a dense batch never cuts a part; endpoints exact + every segment orthogonal', () => {
    const boxes: Box[] = []
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) boxes.push({ x: 100 + c * 120, y: 100 + r * 120, w: 60, h: 60 })
    const wires: WireReq[] = Array.from({ length: 40 }, (_, i) => ({
      id: `w${i}`,
      from: { x: 0, y: 80 + i * 12 },
      to: { x: 700, y: 80 + i * 12 },
    }))
    const paths = routeAllWires(wires, boxes)
    expect(paths.size).toBe(40)
    for (const w of wires) {
      const p = get(paths, w.id)
      expect(p.length).toBeGreaterThanOrEqual(2)
      expect(p[0]).toEqual(w.from)
      expect(p[p.length - 1]).toEqual(w.to)
      expect(isOrtho(p)).toBe(true)
      expect(hitsAny(p, boxes)).toBe(false) // the never-cross-a-part invariant + the fallback-diagonal guard
    }
  })

  test('bends stay low — clean L/Z shapes, not uniform-grid stair-steps', () => {
    const boxes: Box[] = [{ x: 80, y: 80, w: 40, h: 40 }]
    const wires: WireReq[] = Array.from({ length: 10 }, (_, i) => ({
      id: `w${i}`,
      from: { x: 0, y: 20 + i * 20 },
      to: { x: 300, y: 20 + i * 20 },
    }))
    const paths = routeAllWires(wires, boxes)
    const avg = wires.reduce((s, w) => s + bendCount(get(paths, w.id)), 0) / wires.length
    expect(avg).toBeLessThanOrEqual(2.5)
  })

  test('perf: ~200 wires on a 25-part board routes well under the time budget', () => {
    const boxes: Box[] = []
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 5; c++) boxes.push({ x: 100 + c * 150, y: 100 + r * 150, w: 80, h: 80 })
    const wires: WireReq[] = Array.from({ length: 200 }, (_, i) => ({
      id: `w${i}`,
      from: { x: 0, y: 50 + i * 4 },
      to: { x: 900, y: 50 + ((i * 7) % 700) },
    }))
    const t = performance.now()
    const paths = routeAllWires(wires, boxes)
    const ms = performance.now() - t
    expect(paths.size).toBe(200)
    expect(ms).toBeLessThan(2000) // generous vs the ~35ms measured — catches a shared-graph perf blowup
  })

  test('dense board past the bounded cap: the fallback still never cuts a part', () => {
    // 64 parts → the full-board Hanan grid (~130x130 ≈ 16900) exceeds the OLD 16384 fallback cap; a wire
    // spanning the field also overflows its bounded lattice, so this drives the fallback's full-board
    // gridRouteAround (cap raised to 1M). Every routed wire must still be part-free — never a cutter.
    const boxes: Box[] = []
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) boxes.push({ x: 80 + c * 80, y: 80 + r * 80, w: 40, h: 40 })
    const wires: WireReq[] = [
      { id: 'd0', from: { x: 0, y: 0 }, to: { x: 740, y: 740 } },
      { id: 'd1', from: { x: 0, y: 740 }, to: { x: 740, y: 0 } },
    ]
    const paths = routeAllWires(wires, boxes)
    for (const w of wires) {
      const p = get(paths, w.id)
      if (p.length >= 2) {
        // routed clean (part-free) — or, if truly boxed in, an empty path deferred to per-edge — never a cutter
        expect(isOrtho(p)).toBe(true)
        expect(hitsAny(p, boxes)).toBe(false)
      }
    }
  })
})
