/**
 * Global router (auto-wirer overhaul, piece "the engine"): routeAllWires lays a whole batch of wires on
 * one shared grid with a congestion cost, so competing wires spread onto separate tracks instead of
 * piling into the same channel — while never crossing a part. A* per wire, cell cost rising with use.
 */

import { describe, expect, test } from 'vitest'
import {
  type Box,
  type Pt,
  routeAllWires,
  segmentHitsBox,
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
const get = (m: Map<string, Pt[]>, id: string): Pt[] => {
  const p = m.get(id)
  expect(p).toBeDefined()
  return p ?? []
}

describe('global router — congestion-aware batch routing', () => {
  test('routes a wire around a blocking part without crossing it', () => {
    const box: Box = { x: 80, y: 64, w: 32, h: 64 } // straddles the straight y=96 line
    const paths = routeAllWires([{ id: 'w', from: { x: 0, y: 96 }, to: { x: 192, y: 96 } }], [box])
    const path = get(paths, 'w')
    expect(path[0]).toEqual({ x: 0, y: 96 })
    expect(path[path.length - 1]).toEqual({ x: 192, y: 96 })
    expect(isOrtho(path)).toBe(true)
    expect(hitsBox(path, box)).toBe(false)
  })

  test('two wires competing for the same channel spread onto different tracks', () => {
    const wires = [
      { id: 'a', from: { x: 0, y: 96 }, to: { x: 192, y: 96 } },
      { id: 'b', from: { x: 0, y: 96 }, to: { x: 192, y: 96 } },
    ]
    const paths = routeAllWires(wires, [])
    const a = get(paths, 'a')
    const b = get(paths, 'b')
    expect(a[0]).toEqual({ x: 0, y: 96 })
    expect(b[b.length - 1]).toEqual({ x: 192, y: 96 })
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b)) // congestion pushed one off the shared straight line
    expect(isOrtho(a)).toBe(true)
    expect(isOrtho(b)).toBe(true)
  })

  test('every wire in a batch is routed and connects its endpoints orthogonally', () => {
    const wires = Array.from({ length: 8 }, (_, i) => ({
      id: `w${i}`,
      from: { x: 0, y: 64 + i * 16 },
      to: { x: 256, y: 64 + i * 16 },
    }))
    const paths = routeAllWires(wires, [])
    expect(paths.size).toBe(8)
    for (const w of wires) {
      const p = get(paths, w.id)
      expect(p[0]).toEqual(w.from)
      expect(p[p.length - 1]).toEqual(w.to)
      expect(isOrtho(p)).toBe(true)
    }
  })
})
