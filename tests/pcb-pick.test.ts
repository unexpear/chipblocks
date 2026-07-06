import { describe, expect, test } from 'vitest'
import type { PadBox } from '../src/renderer/pcb-board.ts'
import { closestOnSegment, hitCopper, hitPad } from '../src/renderer/pcb-pick.ts'
import type { CopperTrace } from '../src/renderer/pcb-route.ts'

/**
 * The board-mm snapping shared by the flat (SVG) and 3-D board views. Once a click is a point in board
 * millimetres — however it got there — the pad/trace snapping is identical geometry. These tests pin
 * that shared behaviour so the two views can never drift.
 */

const pads: PadBox[] = [
  { net: 'N1', pad: 'R1/1', throughHole: false, x: 0, y: 0, w: 2, h: 2 },
  { net: 'N2', pad: 'R1/2', throughHole: false, x: 10, y: 0, w: 2, h: 2 },
]
const traces: CopperTrace[] = [
  {
    net: 'N3',
    widthMm: 0.25,
    layer: 'top',
    points: [
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ],
  },
]

describe('closestOnSegment', () => {
  test('projects onto the segment', () => {
    expect(closestOnSegment({ x: 5, y: 9 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toEqual({
      x: 5,
      y: 5,
    })
  })
  test('clamps to the endpoints past either end', () => {
    expect(closestOnSegment({ x: 20, y: 5 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toEqual({
      x: 10,
      y: 5,
    })
    expect(closestOnSegment({ x: -5, y: 5 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toEqual({
      x: 0,
      y: 5,
    })
  })
  test('a degenerate (zero-length) segment returns its point', () => {
    expect(closestOnSegment({ x: 3, y: 3 }, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({ x: 1, y: 1 })
  })
})

describe('hitPad', () => {
  test('returns the pad whose box contains the point (AABB in mm)', () => {
    expect(hitPad(pads, { x: 1, y: 1 })?.net).toBe('N1')
    expect(hitPad(pads, { x: 11, y: 1 })?.net).toBe('N2')
  })
  test('returns null off every pad', () => {
    expect(hitPad(pads, { x: 5, y: 5 })).toBeNull()
  })
})

describe('hitCopper', () => {
  test('a pad wins first and snaps to its centre + carries its net (not the click point)', () => {
    const hit = hitCopper(traces, pads, { x: 0.2, y: 0.2 })
    expect(hit?.net).toBe('N1')
    expect(hit?.at).toEqual({ x: 1, y: 1 })
  })
  test('off pads, snaps to the nearest trace within tolerance and carries its net', () => {
    const hit = hitCopper(traces, pads, { x: 4, y: 5.3 })
    expect(hit?.net).toBe('N3')
    expect(hit?.at).toEqual({ x: 4, y: 5 })
  })
  test('returns null on bare board (no pad, no trace within the snap radius)', () => {
    expect(hitCopper(traces, pads, { x: 4, y: 7 })).toBeNull()
  })
  test('the default 0.5 mm snap radius is honoured (0.6 mm off → miss)', () => {
    expect(hitCopper(traces, pads, { x: 4, y: 5.6 })).toBeNull()
  })
  test('a wider tolerance snaps the same click', () => {
    expect(hitCopper(traces, pads, { x: 4, y: 5.6 }, 1.0)?.net).toBe('N3')
  })
})
