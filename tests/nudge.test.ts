/**
 * Nudging pass (auto-wirer overhaul — the neatness step, see AUTO-ROUTER-RESEARCH.md): parallel runs that
 * share a channel are spread onto evenly-spaced tracks centered on the bundle, so wires stop stacking on
 * top of each other. Pin endpoints never move; paths stay orthogonal.
 */

import { describe, expect, test } from 'vitest'
import { nudgeRoutes, type Pt } from '../src/renderer/orthogonal-route.ts'

const at = (p: Pt[], i: number): Pt => p[i] as Pt

describe('nudging — parallel runs spread onto evenly-spaced tracks', () => {
  test('three wires sharing a channel get three distinct tracks, endpoints fixed', () => {
    const path = (): Pt[] => [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 0 },
    ]
    const nudged = nudgeRoutes([path(), path(), path()], { gap: 8 })
    // the middle horizontal run of each (originally y=100) now sits on three distinct, evenly-spaced tracks
    const tracks = nudged.map((p) => at(p, 1).y)
    expect(new Set(tracks).size).toBe(3)
    expect([...tracks].sort((a, b) => a - b)).toEqual([92, 100, 108])
    // the real pin endpoints must not have moved
    for (const p of nudged) {
      expect(at(p, 0)).toEqual({ x: 0, y: 0 })
      expect(at(p, p.length - 1)).toEqual({ x: 300, y: 0 })
    }
  })

  test('a lone wire is left exactly as it was', () => {
    const p: Pt[] = [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 0 },
    ]
    expect(nudgeRoutes([p], { gap: 8 })[0]).toEqual(p)
  })

  test('non-overlapping parallel runs are left where they are', () => {
    const a: Pt[] = [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 0 },
    ]
    const b: Pt[] = [
      { x: 200, y: 0 },
      { x: 200, y: 40 },
      { x: 300, y: 40 },
      { x: 300, y: 0 },
    ]
    const nudged = nudgeRoutes([a, b], { gap: 8 })
    expect(at(nudged[0] as Pt[], 1).y).toBe(40) // same row but x-ranges don't overlap → no conflict
    expect(at(nudged[1] as Pt[], 1).y).toBe(40)
  })
})
