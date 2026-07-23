/**
 * A hand-rolled viewBox pan/zoom model for the board canvas — the same approach the chip canvas uses
 * (drag the empty board to pan, wheel to zoom centred on the cursor), extracted here as pure functions so
 * the coordinate math is unit-tested independently of React. `View` is an SVG viewBox in the canvas's
 * own units (the board canvas draws in content-px = mm × pxPerMm, so a View is in content-px too); a
 * point on screen maps to those units through the SVG's on-screen rectangle.
 */

export type View = { x: number; y: number; w: number; h: number }
export type Rect = { left: number; top: number; width: number; height: number }
export type Bounds = { x: number; y: number; w: number; h: number }

/** Frame content `bounds` into a viewBox matching the pane `aspect` (width/height), padded by `pad`
 *  (a fraction of the content on each side). The content is centred and never distorted — whichever
 *  dimension is too tight for the pane aspect is widened. */
export function fitView(bounds: Bounds, aspect: number, pad = 0.08): View {
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1
  const w0 = Math.max(1e-6, bounds.w) * (1 + pad * 2)
  const h0 = Math.max(1e-6, bounds.h) * (1 + pad * 2)
  const [vw, vh] = w0 / h0 > safeAspect ? [w0, w0 / safeAspect] : [h0 * safeAspect, h0]
  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h / 2
  return { x: cx - vw / 2, y: cy - vh / 2, w: vw, h: vh }
}

/** A client (screen) point → canvas units, given the SVG's on-screen rectangle. */
export function clientToView(
  view: View,
  rect: Rect,
  clientX: number,
  clientY: number,
): {
  x: number
  y: number
} {
  const rw = rect.width > 0 ? rect.width : 1
  const rh = rect.height > 0 ? rect.height : 1
  return {
    x: view.x + ((clientX - rect.left) / rw) * view.w,
    y: view.y + ((clientY - rect.top) / rh) * view.h,
  }
}

/** A screen-px delta → canvas-unit delta (for drags): the same scale clientToView uses, without the offset. */
export function pxDeltaToView(
  view: View,
  rect: Rect,
  dxPx: number,
  dyPx: number,
): { x: number; y: number } {
  const rw = rect.width > 0 ? rect.width : 1
  const rh = rect.height > 0 ? rect.height : 1
  return { x: (dxPx / rw) * view.w, y: (dyPx / rh) * view.h }
}

/** Zoom keeping the canvas point `anchor` fixed under the cursor. `factor` > 1 shows MORE (zooms out),
 *  < 1 shows less (zooms in); the view width is clamped to [minW, maxW]. */
export function zoomAt(
  view: View,
  factor: number,
  anchor: { x: number; y: number },
  minW: number,
  maxW: number,
): View {
  const w = Math.min(maxW, Math.max(minW, view.w * factor))
  const h = w * (view.h / view.w)
  return {
    x: anchor.x - (anchor.x - view.x) * (w / view.w),
    y: anchor.y - (anchor.y - view.y) * (h / view.h),
    w,
    h,
  }
}

/** Pan the view by a screen-px drag delta (drag right → content follows the cursor, so the view moves left). */
export function panByPx(view: View, rect: Rect, dxPx: number, dyPx: number): View {
  const d = pxDeltaToView(view, rect, dxPx, dyPx)
  return { ...view, x: view.x - d.x, y: view.y - d.y }
}
