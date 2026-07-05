import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { buildBoardScene, defaultCamera, type OrbitCamera, renderScene } from './pcb-3d.ts'
import type { Board } from './pcb-board.ts'
import type { BoardRouting } from './pcb-route.ts'
import type { Stackup } from './pcb-stackup.ts'

/**
 * The real 3-D board — a to-scale, orbitable view built on the from-scratch pcb-3d engine. Drag to
 * orbit the board, scroll to zoom; what you see is the board's true geometry in millimetres, the way
 * a CAD program shows it. View-only (it inspects the same derived board the flat/exploded views show).
 */
export function Pcb3DView({
  board,
  routing,
  stackup,
  height = 460,
  coordinateGrid = false,
}: {
  board: Board
  routing: BoardRouting
  stackup: Stackup
  height?: number
  coordinateGrid?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 640, h: height })

  // exploded lamination: 0 = the assembled board; >0 splits the stack-up layers apart in real space
  // (the stage for seeing — and eventually routing — the connections between layers). The gap is capped
  // modestly so the thin copper/mask layers stay a readable stack rather than scattering far apart.
  const [explode, setExplode] = useState(0)
  const maxExplode = Math.max(3, Math.max(board.outline.w, board.outline.h) * 0.22)
  const scene = useMemo(
    () => buildBoardScene(board, routing, stackup, explode, coordinateGrid),
    [board, routing, stackup, explode, coordinateGrid],
  )

  // orbit state: azimuth / elevation / distance. Target follows the (live) board centre.
  const [orbit, setOrbit] = useState(() => {
    const c = defaultCamera(scene)
    return { az: c.azimuthDeg, el: c.elevationDeg, dist: c.distance }
  })
  const drag = useRef<{ x: number; y: number } | null>(null)

  // keep the canvas sized to its container (device-pixel-ratio aware for crisp lines)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.max(240, Math.floor(r.width)), h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [height])

  // the observer only fires on width changes — keep the height in sync if the prop itself changes
  useEffect(() => {
    setSize((s) => ({ ...s, h: height }))
  }, [height])

  // zoom via a NON-passive wheel listener so it can preventDefault (no page scroll under the cursor);
  // the distance is floored to the board's own size so you can never zoom inside the slab.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const minD = Math.max(scene.diagonal * 0.5, 6)
      const maxD = Math.max(scene.diagonal * 12, 80)
      setOrbit((o) => ({
        ...o,
        dist: Math.max(minD, Math.min(o.dist * (e.deltaY > 0 ? 1.1 : 0.9), maxD)),
      }))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [scene.diagonal])

  // draw whenever the scene, camera or size changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(size.w * dpr)
    canvas.height = Math.floor(size.h * dpr)
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
    const cam: OrbitCamera = {
      azimuthDeg: orbit.az,
      elevationDeg: orbit.el,
      distance: orbit.dist,
      target: scene.center,
      fovDeg: 32,
    }
    renderScene(ctx, scene, cam, size.w, size.h, dpr)
  }, [scene, orbit, size])

  const onPointerDown = (e: ReactPointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY }
    canvasRef.current?.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    drag.current = { x: e.clientX, y: e.clientY }
    setOrbit((o) => ({
      az: o.az - dx * 0.5,
      el: Math.min(89, Math.max(2, o.el + dy * 0.5)),
      dist: o.dist,
    }))
  }
  const endDrag = (e: ReactPointerEvent) => {
    drag.current = null
    if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
      canvasRef.current.releasePointerCapture(e.pointerId)
    }
  }
  const resetView = () => {
    const c = defaultCamera(scene)
    setOrbit({ az: c.azimuthDeg, el: c.elevationDeg, dist: c.distance })
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          display: 'block',
          borderRadius: 6,
          cursor: drag.current ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        aria-label="PCB 3D view"
        data-pcb3d="true"
      />
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
        }}
      >
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#9fb0c3' }}
          title="Explode the layers apart in space — separate the copper planes so you can see the vias bridging between them"
        >
          Explode
          <input
            type="range"
            min={0}
            max={maxExplode}
            step={maxExplode / 100}
            value={explode}
            onChange={(e) => setExplode(Number(e.target.value))}
            style={{ width: 90 }}
          />
        </label>
        <span style={{ fontSize: 10, color: '#9fb0c3' }}>drag to orbit · scroll to zoom</span>
        <button
          type="button"
          onClick={resetView}
          title="Reset the view"
          style={{
            border: '1px solid #33415c',
            background: '#141f33',
            color: '#c4d0de',
            borderRadius: 4,
            fontSize: 11,
            padding: '2px 8px',
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
