/**
 * Viewport math for the board canvas — pure pan/zoom over a viewBox. These prove the coordinate
 * transforms independently of React: fit frames + centres content, a screen point maps to the right
 * canvas point, and a wheel-zoom keeps the point under the cursor pinned (the property that makes
 * zoom feel right).
 */

import { describe, expect, test } from 'vitest'
import {
  clientToView,
  fitView,
  panByPx,
  pxDeltaToView,
  type Rect,
  type View,
  zoomAt,
} from '../src/renderer/pcb-viewport.ts'

const rect: Rect = { left: 0, top: 0, width: 800, height: 600 }

describe('fitView', () => {
  test('centres the content and contains it', () => {
    const v = fitView({ x: 10, y: 20, w: 100, h: 60 }, 800 / 600)
    // the content centre (60, 50) sits at the view centre
    expect(v.x + v.w / 2).toBeCloseTo(60, 6)
    expect(v.y + v.h / 2).toBeCloseTo(50, 6)
    // the padded content fits inside the view on both axes
    expect(v.w).toBeGreaterThanOrEqual(100)
    expect(v.h).toBeGreaterThanOrEqual(60)
  })

  test('matches the pane aspect so content is never distorted', () => {
    const aspect = 800 / 600
    const v = fitView({ x: 0, y: 0, w: 40, h: 40 }, aspect)
    expect(v.w / v.h).toBeCloseTo(aspect, 6)
  })

  test('a degenerate (zero-size) bound does not divide by zero', () => {
    const v = fitView({ x: 5, y: 5, w: 0, h: 0 }, 1)
    expect(Number.isFinite(v.w)).toBe(true)
    expect(Number.isFinite(v.h)).toBe(true)
    expect(v.w).toBeGreaterThan(0)
  })
})

describe('clientToView', () => {
  const view: View = { x: 0, y: 0, w: 800, h: 600 }
  test('the rect centre maps to the view centre', () => {
    const p = clientToView(view, rect, 400, 300)
    expect(p.x).toBeCloseTo(400, 6)
    expect(p.y).toBeCloseTo(300, 6)
  })
  test('the top-left maps to the view origin, the bottom-right to the far corner', () => {
    expect(clientToView(view, rect, 0, 0)).toEqual({ x: 0, y: 0 })
    const br = clientToView(view, rect, 800, 600)
    expect(br.x).toBeCloseTo(800, 6)
    expect(br.y).toBeCloseTo(600, 6)
  })
  test('a panned + zoomed view offsets and scales correctly', () => {
    const v2: View = { x: 100, y: 50, w: 400, h: 300 }
    const p = clientToView(v2, rect, 400, 300) // rect centre
    expect(p.x).toBeCloseTo(100 + 200, 6)
    expect(p.y).toBeCloseTo(50 + 150, 6)
  })
})

describe('zoomAt keeps the cursor point pinned', () => {
  const view: View = { x: 0, y: 0, w: 800, h: 600 }
  test('the canvas point under the cursor is unchanged after a zoom-in', () => {
    const cursor = { cx: 600, cy: 200 }
    const before = clientToView(view, rect, cursor.cx, cursor.cy)
    const zoomed = zoomAt(view, 1 / 1.12, before, 20, 8000) // zoom in
    const after = clientToView(zoomed, rect, cursor.cx, cursor.cy)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    expect(zoomed.w).toBeLessThan(view.w) // zoomed in ⇒ less shown
  })
  test('the same holds for a zoom-out', () => {
    const cursor = { cx: 120, cy: 540 }
    const before = clientToView(view, rect, cursor.cx, cursor.cy)
    const zoomed = zoomAt(view, 1.12, before, 20, 8000) // zoom out
    const after = clientToView(zoomed, rect, cursor.cx, cursor.cy)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    expect(zoomed.w).toBeGreaterThan(view.w)
  })
  test('the aspect ratio is preserved through a zoom', () => {
    const z = zoomAt(view, 1.5, { x: 400, y: 300 }, 20, 8000)
    expect(z.w / z.h).toBeCloseTo(view.w / view.h, 6)
  })
  test('view width is clamped to [minW, maxW]', () => {
    const inTight = zoomAt(view, 0.0001, { x: 400, y: 300 }, 50, 8000)
    expect(inTight.w).toBeCloseTo(50, 6)
    const outWide = zoomAt(view, 10000, { x: 400, y: 300 }, 50, 8000)
    expect(outWide.w).toBeCloseTo(8000, 6)
  })
})

describe('pan', () => {
  const view: View = { x: 0, y: 0, w: 800, h: 600 }
  test('pxDeltaToView scales a screen delta into canvas units', () => {
    const v2: View = { x: 0, y: 0, w: 400, h: 300 } // 2× zoomed in
    const d = pxDeltaToView(v2, rect, 80, 60)
    expect(d.x).toBeCloseTo(40, 6) // 80/800 * 400
    expect(d.y).toBeCloseTo(30, 6)
  })
  test('dragging right moves the view left (content follows the cursor)', () => {
    const v = panByPx(view, rect, 100, 0) // drag 100px right
    expect(v.x).toBeCloseTo(-100, 6)
    expect(v.y).toBeCloseTo(0, 6)
  })
})
