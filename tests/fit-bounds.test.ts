/**
 * The shared Fit to View math (schematic canvas, board view, Gerber check all use it): empty content
 * resets, one item centres, wide content is width-bound, tall content is height-bound, and the margin
 * leaves the stated room on each side.
 */
import { describe, expect, test } from 'vitest'
import { fitBounds, isFitToViewKey, placedBox, unionBoxes } from '../src/renderer/fit-bounds.ts'

/** Where the content box lands on screen under a fit. */
function onScreen(
  box: { x: number; y: number; w: number; h: number },
  fit: { scale: number; offsetX: number; offsetY: number },
) {
  return {
    left: box.x * fit.scale + fit.offsetX,
    top: box.y * fit.scale + fit.offsetY,
    right: (box.x + box.w) * fit.scale + fit.offsetX,
    bottom: (box.y + box.h) * fit.scale + fit.offsetY,
  }
}

describe('fitBounds', () => {
  test('empty content returns null so the view resets to its default zoom', () => {
    expect(fitBounds(null, 800, 600)).toBeNull()
    expect(fitBounds(undefined, 800, 600)).toBeNull()
    expect(fitBounds({ x: Number.POSITIVE_INFINITY, y: 0, w: 0, h: 0 }, 800, 600)).toBeNull()
    expect(fitBounds({ x: 0, y: 0, w: -1, h: 5 }, 800, 600)).toBeNull()
  })

  test('a single item is centred in the pane', () => {
    const box = { x: 100, y: 50, w: 40, h: 40 }
    const fit = fitBounds(box, 800, 600, { margin: 0.1 })
    expect(fit).not.toBeNull()
    if (fit === null) return
    const s = onScreen(box, fit)
    expect((s.left + s.right) / 2).toBeCloseTo(400, 6)
    expect((s.top + s.bottom) / 2).toBeCloseTo(300, 6)
    // height-bound in a landscape pane: 600 / (40 Ã— 1.2)
    expect(fit.scale).toBeCloseTo(600 / 48, 6)
  })

  test('a single point (zero size) is clamped to maxScale, not divided by zero', () => {
    const fit = fitBounds({ x: 5, y: 5, w: 0, h: 0 }, 800, 600, { maxScale: 2 })
    expect(fit?.scale).toBe(2)
    expect(fit?.offsetX).toBeCloseTo(400 - 10, 6)
    expect(fit?.offsetY).toBeCloseTo(300 - 10, 6)
  })

  test('wide content is bound by the width and fills it edge to edge (no margin)', () => {
    const box = { x: 0, y: 0, w: 1000, h: 10 }
    const fit = fitBounds(box, 800, 600, { margin: 0 })
    if (fit === null) throw new Error('fit')
    expect(fit.scale).toBeCloseTo(0.8, 6)
    const s = onScreen(box, fit)
    expect(s.left).toBeCloseTo(0, 6)
    expect(s.right).toBeCloseTo(800, 6)
    expect(s.top).toBeGreaterThan(0)
    expect(s.bottom).toBeLessThan(600)
  })

  test('tall content is bound by the height and fills it edge to edge (no margin)', () => {
    const box = { x: -20, y: -500, w: 10, h: 1000 }
    const fit = fitBounds(box, 800, 600, { margin: 0 })
    if (fit === null) throw new Error('fit')
    expect(fit.scale).toBeCloseTo(0.6, 6)
    const s = onScreen(box, fit)
    expect(s.top).toBeCloseTo(0, 6)
    expect(s.bottom).toBeCloseTo(600, 6)
    expect(s.left).toBeGreaterThan(0)
    expect(s.right).toBeLessThan(800)
  })

  test('the margin leaves that fraction of the content free on each side of the bound axis', () => {
    const box = { x: 0, y: 0, w: 100, h: 50 }
    const fit = fitBounds(box, 120, 1000, { margin: 0.1 })
    if (fit === null) throw new Error('fit')
    // 100 wide + 10 each side = 120 = the pane width â†’ scale 1, content 10 px in from each edge
    expect(fit.scale).toBeCloseTo(1, 6)
    const s = onScreen(box, fit)
    expect(s.left).toBeCloseTo(10, 6)
    expect(120 - s.right).toBeCloseTo(10, 6)
    // a bigger margin zooms out further
    const wider = fitBounds(box, 120, 1000, { margin: 0.25 })
    expect(wider?.scale).toBeLessThan(fit.scale)
  })

  test('min and max scale clamp the fit', () => {
    expect(fitBounds({ x: 0, y: 0, w: 1e6, h: 1e6 }, 800, 600, { minScale: 2 })?.scale).toBe(2)
    expect(fitBounds({ x: 0, y: 0, w: 1, h: 1 }, 800, 600, { maxScale: 48 })?.scale).toBe(48)
  })
})

describe('isFitToViewKey', () => {
  const base = { ctrlKey: false, metaKey: false, altKey: false, target: null }
  test('a bare F (either case) fits', () => {
    expect(isFitToViewKey({ ...base, key: 'f' })).toBe(true)
    expect(isFitToViewKey({ ...base, key: 'F' })).toBe(true)
  })
  test('modifiers, other keys, and typing in a field do not', () => {
    expect(isFitToViewKey({ ...base, key: 'f', ctrlKey: true })).toBe(false)
    expect(isFitToViewKey({ ...base, key: 'f', metaKey: true })).toBe(false)
    expect(isFitToViewKey({ ...base, key: 'g' })).toBe(false)
    const input = { tagName: 'INPUT' } as unknown as EventTarget
    expect(isFitToViewKey({ ...base, key: 'f', target: input })).toBe(false)
  })
})

describe('board fit bounds (regression: a part past the board edge was left out of the fit)', () => {
  test('unionBoxes spans every box and skips empty ones', () => {
    expect(unionBoxes([])).toBeNull()
    expect(unionBoxes([null, undefined])).toBeNull()
    expect(
      unionBoxes([
        { x: 0, y: 0, w: 160, h: 120 },
        null,
        { x: 230, y: -10, w: 5, h: 5 },
        { x: Number.NaN, y: 0, w: 1, h: 1 },
      ]),
    ).toEqual({ x: 0, y: -10, w: 235, h: 130 })
  })

  test('placedBox covers a rotated courtyard (quarter turn and 45Â°)', () => {
    const court = { x: -4, y: -1, w: 8, h: 2 }
    const q = placedBox(court, 10, 20, 90)
    expect(q.x).toBeCloseTo(9, 6)
    expect(q.y).toBeCloseTo(16, 6)
    expect(q.w).toBeCloseTo(2, 6)
    expect(q.h).toBeCloseTo(8, 6)
    const d = placedBox(court, 0, 0, 45)
    expect(d.w).toBeCloseTo((8 + 2) / Math.SQRT2, 6)
    expect(d.h).toBeCloseTo((8 + 2) / Math.SQRT2, 6)
  })

  test('fitting the union keeps an off-board part inside the frame with a margin', () => {
    const outline = { x: 0, y: 0, w: 160, h: 120 }
    const offBoard = placedBox({ x: -3, y: -3, w: 6, h: 6 }, 0, 300, 45)
    const all = unionBoxes([outline, offBoard])
    const fit = fitBounds(all, 1000, 400, { margin: 0.08 })
    if (fit === null || all === null) throw new Error('fit')
    const bottom = (offBoard.y + offBoard.h) * fit.scale + fit.offsetY
    expect(bottom).toBeLessThan(400)
    expect(400 - bottom).toBeGreaterThan(0.08 * all.h * fit.scale * 0.99)
    // the outline-only fit (the old behaviour) put that part off the bottom of the pane
    const old = fitBounds(outline, 1000, 400, { margin: 0.08 })
    if (old === null) throw new Error('fit')
    expect((offBoard.y + offBoard.h) * old.scale + old.offsetY).toBeGreaterThan(400)
  })
})
