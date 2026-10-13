/**
 * Fit to View — the one bounds-fit used by every zoomable view (schematic canvas, board view, Gerber
 * check). Given the content's bounding box and the pane size, it returns the uniform scale and offset
 * that show all of the content, centred, with a margin. Screen = content × scale + offset.
 *
 * `margin` is a fraction of the content's size added on EACH side (0.08 = 8% of the width left and
 * right, 8% of the height above and below). A zero-size box (one point) is scaled by `maxScale`. Empty
 * content (`null`, or a box with a non-finite edge) returns `null`: the caller resets to its default zoom.
 */

export type FitBox = { x: number; y: number; w: number; h: number }
export type Fit = { scale: number; offsetX: number; offsetY: number }
export type FitOptions = { margin?: number; minScale?: number; maxScale?: number }

/** The smallest box holding every given box (empty / non-finite ones skipped); null when none remain. */
export function unionBoxes(boxes: readonly (FitBox | null | undefined)[]): FitBox | null {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (const b of boxes) {
    if (isEmptyBox(b)) continue
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

/** A local box (e.g. a footprint courtyard) rotated by `rotationDeg` about the origin then moved to
 *  (x, y) — the axis-aligned box it then covers. Any angle, not just quarter turns. */
export function placedBox(local: FitBox, x: number, y: number, rotationDeg: number): FitBox {
  const t = ((Number.isFinite(rotationDeg) ? rotationDeg : 0) * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  const local4: [number, number][] = [
    [local.x, local.y],
    [local.x + local.w, local.y],
    [local.x, local.y + local.h],
    [local.x + local.w, local.y + local.h],
  ]
  const xs = local4.map(([px, py]) => x + px * c - py * s)
  const ys = local4.map(([px, py]) => y + px * s + py * c)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
}

/** True when there is nothing to fit (the caller resets to its default zoom instead). */
export function isEmptyBox(box: FitBox | null | undefined): box is null | undefined {
  if (box === null || box === undefined) return true
  return ![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w < 0 || box.h < 0
}

export function fitBounds(
  box: FitBox | null | undefined,
  paneW: number,
  paneH: number,
  { margin = 0.08, minScale = 0, maxScale = Number.POSITIVE_INFINITY }: FitOptions = {},
): Fit | null {
  if (isEmptyBox(box)) return null
  const pw = paneW > 0 && Number.isFinite(paneW) ? paneW : 1
  const ph = paneH > 0 && Number.isFinite(paneH) ? paneH : 1
  const pad = Math.max(0, margin)
  const w = Math.max(1e-9, box.w) * (1 + pad * 2)
  const h = Math.max(1e-9, box.h) * (1 + pad * 2)
  const raw = Math.min(pw / w, ph / h)
  const scale = Math.min(maxScale, Math.max(minScale, raw))
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  return { scale, offsetX: pw / 2 - cx * scale, offsetY: ph / 2 - cy * scale }
}
type FitKeyEvent = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  target: EventTarget | null
}

/** The Fit to View shortcut: a bare F, while the view itself (not a text field inside it) has focus. */
export function isFitToViewKey(e: FitKeyEvent): boolean {
  if (e.key !== 'f' && e.key !== 'F') return false
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  const el = e.target as { tagName?: string; isContentEditable?: boolean } | null
  const tag = el?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false
  return el?.isContentEditable !== true
}
