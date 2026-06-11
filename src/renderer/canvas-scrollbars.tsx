import { getNodesBounds, type Node, useReactFlow, useViewport } from '@xyflow/react'
import { useRef, useState } from 'react'

/**
 * Canvas pan bars (S19-v3-72) — side-to-side (and up-down) scrollbars for the
 * canvas, the way a document editor scrolls. The canvas itself is an infinite
 * pan surface, so the bars are drawn from what is REAL: the parts' bounding
 * box (plus breathing room) unioned with wherever the view currently is.
 * Dragging a thumb pans the viewport; the bars fade out when everything
 * already fits on screen. Classic scrollbar math: thumb size = window/extent,
 * travel maps to (extent − window).
 */

const BAR = 10
const INSET = 4
const CORNER = 18 // keep the two bars out of each other's corner
const MIN_THUMB = 24
const MARGIN = 120 // flow-px breathing room around the parts

type Drag = {
  axis: 'x' | 'y'
  startClient: number
  startViewport: { x: number; y: number; zoom: number }
  flowPerPx: number
}

export function CanvasScrollbars({ nodes }: { nodes: Node[] }) {
  const viewport = useViewport()
  const { setViewport } = useReactFlow()
  const hostRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState<'x' | 'y' | null>(null)

  const host = hostRef.current
  const hostW = host?.clientWidth ?? 0
  const hostH = host?.clientHeight ?? 0

  // The window (what the view shows) and the content, both in flow coords.
  const winX = -viewport.x / viewport.zoom
  const winY = -viewport.y / viewport.zoom
  const winW = hostW / viewport.zoom
  const winH = hostH / viewport.zoom
  const bounds = nodes.length > 0 ? getNodesBounds(nodes) : { x: 0, y: 0, width: 0, height: 0 }
  const contentMinX = bounds.x - MARGIN
  const contentMaxX = bounds.x + bounds.width + MARGIN
  const contentMinY = bounds.y - MARGIN
  const contentMaxY = bounds.y + bounds.height + MARGIN

  // The scrollable extent includes wherever the user has panned to — the bars
  // describe reality, they never yank the view back.
  const extMinX = Math.min(contentMinX, winX)
  const extMaxX = Math.max(contentMaxX, winX + winW)
  const extMinY = Math.min(contentMinY, winY)
  const extMaxY = Math.max(contentMaxY, winY + winH)

  const bar = (axis: 'x' | 'y') => {
    const extMin = axis === 'x' ? extMinX : extMinY
    const extLen = (axis === 'x' ? extMaxX - extMinX : extMaxY - extMinY) || 1
    const winStart = axis === 'x' ? winX : winY
    const winLen = axis === 'x' ? winW : winH
    const trackLen = (axis === 'x' ? hostW : hostH) - INSET - CORNER
    if (trackLen <= 0 || winLen >= extLen - 0.5) return null // everything fits

    const thumbLen = Math.max(MIN_THUMB, (winLen / extLen) * trackLen)
    const travel = trackLen - thumbLen
    const thumbStart = travel <= 0 ? 0 : ((winStart - extMin) / (extLen - winLen)) * travel

    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      // The bars live in the canvas wrapper — without this, a thumb press
      // would also start a lasso / box gesture underneath.
      event.stopPropagation()
      event.preventDefault()
      drag.current = {
        axis,
        startClient: axis === 'x' ? event.clientX : event.clientY,
        startViewport: { ...viewport },
        flowPerPx: travel <= 0 ? 0 : (extLen - winLen) / travel,
      }
      setDragging(axis)
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
      const live = drag.current
      if (live === null || live.axis !== axis) return
      const deltaPx = (axis === 'x' ? event.clientX : event.clientY) - live.startClient
      const deltaFlow = deltaPx * live.flowPerPx
      setViewport({
        x: live.startViewport.x - (axis === 'x' ? deltaFlow * live.startViewport.zoom : 0),
        y: live.startViewport.y - (axis === 'y' ? deltaFlow * live.startViewport.zoom : 0),
        zoom: live.startViewport.zoom,
      })
    }
    const onPointerUp = () => {
      drag.current = null
      setDragging(null)
    }

    const track: React.CSSProperties =
      axis === 'x'
        ? { left: INSET, right: CORNER, bottom: INSET, height: BAR }
        : { top: INSET, bottom: CORNER, right: INSET, width: BAR }
    const thumb: React.CSSProperties =
      axis === 'x'
        ? { left: thumbStart, width: thumbLen, top: 0, bottom: 0 }
        : { top: thumbStart, height: thumbLen, left: 0, right: 0 }

    return (
      <div className="cb-scroll-track" style={track}>
        <div
          className={`cb-scroll-thumb${dragging === axis ? ' cb-dragging' : ''}`}
          style={{ ...thumb, cursor: axis === 'x' ? 'ew-resize' : 'ns-resize' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      </div>
    )
  }

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {bar('x')}
      {bar('y')}
    </div>
  )
}
