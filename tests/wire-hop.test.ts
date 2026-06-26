/**
 * hopPath — the schematic hop-over (crossover) for a wire that passes OVER another without connecting.
 * Proves: a plain wire stays a straight polyline; a hop that lands on a horizontal run becomes a small
 * bump that rises UP and over (a cubic curve with control points above the wire), while keeping the
 * wire's endpoints; and a "hop" that isn't actually on the wire is ignored.
 */

import { describe, expect, test } from 'vitest'
import { hopPath } from '../src/renderer/wire-path.ts'

describe('hopPath — schematic hop-over at a non-connecting crossing', () => {
  test('no hops → a plain straight polyline (no curve)', () => {
    const d = hopPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [],
    )
    expect(d).toBe('M 0,0 L 100,0')
    expect(d).not.toContain('C')
  })

  test('a hop on a horizontal run bumps UP and over, keeping the endpoints', () => {
    const d = hopPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [{ x: 50, y: 0 }],
      5,
    )
    expect(d).toContain('C') // a cubic bump
    expect(d.startsWith('M 0,0')).toBe(true)
    expect(d.endsWith('100,0')).toBe(true)
    // the bump's control points rise above the wire (y < 0 = up on screen)
    const ys = [...d.matchAll(/-?\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]))
    expect(Math.min(...ys)).toBeLessThan(0)
  })

  test('a "hop" that is not on the wire is ignored — no bump', () => {
    const d = hopPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [{ x: 50, y: 40 }],
    )
    expect(d).not.toContain('C')
  })
})
