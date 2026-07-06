import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildBoardScene,
  defaultCamera,
  makeProjector,
  type OrbitCamera,
  projectToScreen,
  renderScene,
  type Scene,
  screenToBoardMm,
} from './pcb-3d.ts'
import type { Board, PadBox, Recess } from './pcb-board.ts'
import { hitCopper, hitPad } from './pcb-pick.ts'
import type { BoardRouting, CopperLayer } from './pcb-route.ts'
import type { Stackup } from './pcb-stackup.ts'

/**
 * The route + via tool state threaded from App into the 3-D view — the SAME contract the flat view
 * uses, plus `layer` (the copper layer being routed), which fixes the z-plane a click intersects. The
 * 3-D view's only extra job over the flat view is turning a click into a board-mm point on that layer
 * (a ray → copper-plane cast, instead of the flat view's SVG-rect maths); every downstream step — pad/
 * trace snapping, the pending route, the commit + merge — is the same shared code the flat tool runs.
 */
export type BoardRouteProp = {
  active: boolean
  layer: CopperLayer
  padBoxes: PadBox[]
  pendingPoints?: { x: number; y: number }[]
  cursor?: { x: number; y: number } | null
  color?: string
  onClick: (mm: { x: number; y: number }, pad: PadBox | null) => void
  onMove: (mm: { x: number; y: number }) => void
  viaActive: boolean
  onViaClick: (at: { x: number; y: number }, net: string) => void
}

// A press that moves less than this (summed |dx|+|dy| in px) is a click, not an orbit-drag.
const CLICK_SLOP_PX = 6
const OVERLAY_SELECT = '#8fd0ff'

/** The z of the copper layer a routing click lands on. */
function layerZ(scene: Scene, layer: CopperLayer): number {
  return layer === 'bottom' ? scene.copperZ.bottom : scene.copperZ.top
}

/**
 * Draw the routing overlay ON TOP of the rendered board, in the same camera: the clickable pads as
 * rings, the trace being laid as a solid polyline of committed corners, the dashed H-then-V rubber-band
 * to the cursor, and the snap marker under the cursor — all projected onto the active copper layer's
 * plane so they sit on the surface you are routing. Drawn after renderScene, which leaves the dpr
 * transform in place, so these CSS-px coordinates line up with the board.
 */
function drawRouteOverlay(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  cam: OrbitCamera,
  w: number,
  h: number,
  opts: {
    layer: CopperLayer
    padBoxes: PadBox[]
    color: string
    pending?: { x: number; y: number }[]
    cursor?: { x: number; y: number } | null
  },
): void {
  const proj = makeProjector(cam, w, h)
  const z = layerZ(scene, opts.layer)
  const at = (p: { x: number; y: number }) => projectToScreen(proj, { x: p.x, y: p.y, z })
  const stroke = (pts: { x: number; y: number }[]) => {
    ctx.beginPath()
    let started = false
    for (const p of pts) {
      const s = at(p)
      if (s === null) {
        started = false
        continue
      }
      if (started) ctx.lineTo(s.x, s.y)
      else {
        ctx.moveTo(s.x, s.y)
        started = true
      }
    }
    ctx.stroke()
  }

  // the clickable pads
  ctx.lineWidth = 1.2
  ctx.strokeStyle = OVERLAY_SELECT
  ctx.globalAlpha = 0.8
  for (const pb of opts.padBoxes) {
    const s = at({ x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 })
    if (s === null) continue
    ctx.beginPath()
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  const pend = opts.pending
  if (pend !== undefined && pend.length > 0) {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (pend.length > 1) {
      ctx.strokeStyle = opts.color
      ctx.lineWidth = 3
      stroke(pend)
    }
    const last = pend[pend.length - 1]
    if (opts.cursor !== undefined && opts.cursor !== null && last !== undefined) {
      // the same H-then-V (Manhattan) rubber-band the flat tool previews + commits
      ctx.strokeStyle = opts.color
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.8
      ctx.setLineDash([4, 3])
      stroke([last, { x: opts.cursor.x, y: last.y }, opts.cursor])
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }
    ctx.fillStyle = opts.color
    for (const p of pend) {
      const s = at(p)
      if (s === null) continue
      ctx.beginPath()
      ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  if (opts.cursor !== undefined && opts.cursor !== null) {
    const s = at(opts.cursor)
    if (s !== null) {
      ctx.fillStyle = opts.color
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }
}

/**
 * The real 3-D board — a to-scale, orbitable view built on the from-scratch pcb-3d engine. Drag to
 * orbit the board, scroll to zoom; what you see is the board's true geometry in millimetres, the way
 * a CAD program shows it. When the route/via tool is on it becomes editable: a CLICK (not a drag) casts
 * a ray onto the active copper layer and lays copper there — routing directly in the exploded 3-D
 * space — while a drag still orbits. All the routing STATE lives in App (same handlers as the flat
 * view); the 3-D view only supplies the click→board-mm pick and draws the pending trace.
 */
export function Pcb3DView({
  board,
  routing,
  stackup,
  height = 460,
  coordinateGrid = false,
  recesses = [],
  route,
}: {
  board: Board
  routing: BoardRouting
  stackup: Stackup
  height?: number
  coordinateGrid?: boolean
  recesses?: Recess[]
  route?: BoardRouteProp
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 640, h: height })

  // exploded lamination: 0 = the assembled board; >0 splits the stack-up layers apart in real space
  // (the stage for seeing — and routing — the connections between layers). The gap is capped modestly
  // so the thin copper/mask layers stay a readable stack rather than scattering far apart.
  const [explode, setExplode] = useState(0)
  const maxExplode = Math.max(3, Math.max(board.outline.w, board.outline.h) * 0.22)
  const scene = useMemo(
    () => buildBoardScene(board, routing, stackup, explode, coordinateGrid, recesses),
    [board, routing, stackup, explode, coordinateGrid, recesses],
  )

  const routeActive = route?.active ?? false
  const viaActive = route?.viaActive ?? false
  const routeLayer: CopperLayer = route?.layer ?? 'top'
  const routeColor = route?.color ?? '#ffcf6b'
  const pendingPoints = route?.pendingPoints
  const padBoxes = useMemo(() => route?.padBoxes ?? [], [route?.padBoxes])
  // the live snap point under the cursor while routing (drives the rubber-band + hover marker)
  const [hoverCursor, setHoverCursor] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!routeActive && !viaActive) setHoverCursor(null)
  }, [routeActive, viaActive])

  // orbit state: azimuth / elevation / distance. Target follows the (live) board centre.
  const [orbit, setOrbit] = useState(() => {
    const c = defaultCamera(scene)
    return { az: c.azimuthDeg, el: c.elevationDeg, dist: c.distance }
  })
  const cam = useMemo<OrbitCamera>(
    () => ({
      azimuthDeg: orbit.az,
      elevationDeg: orbit.el,
      distance: orbit.dist,
      target: scene.center,
      fovDeg: 32,
    }),
    [orbit, scene.center],
  )
  const press = useRef<{ x: number; y: number; moved: number } | null>(null)

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

  // draw whenever the scene, camera, size, or routing overlay changes
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
    renderScene(ctx, scene, cam, size.w, size.h, dpr)
    if (routeActive || viaActive) {
      drawRouteOverlay(ctx, scene, cam, size.w, size.h, {
        layer: routeLayer,
        padBoxes,
        color: routeColor,
        cursor: hoverCursor,
        ...(pendingPoints ? { pending: pendingPoints } : {}),
      })
    }
  }, [
    scene,
    cam,
    size,
    routeActive,
    viaActive,
    routeLayer,
    padBoxes,
    routeColor,
    pendingPoints,
    hoverCursor,
  ])

  // screen click → board-mm point on the active copper layer (the 3-D analogue of eventToMm)
  const pickMm = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect === undefined) return null
    return screenToBoardMm(
      cam,
      size.w,
      size.h,
      clientX - rect.left,
      clientY - rect.top,
      layerZ(scene, routeLayer),
    )
  }

  // DEV-only probe so the app-driver (CDP) can route in the 3-D canvas, which — unlike the flat SVG —
  // has no per-pad DOM element to click: it exposes the live board-mm → client-px projection on the
  // active layer, the pad centres, and the routing counts, so a test can click real pixels and read
  // back the committed copper. Stripped from production by the DEV guard.
  useEffect(() => {
    // Only the routing instance (the workspace BoardView passes `route`) publishes the probe, so a
    // second, view-only 3-D view mounted at the same time (the dock panel) can't clobber the global.
    if (!import.meta.env.DEV || route === undefined) return
    const canvas = canvasRef.current
    if (!canvas) return
    const probe = {
      projectClient: (mm: { x: number; y: number }): { x: number; y: number } | null => {
        const rect = canvas.getBoundingClientRect()
        const s = projectToScreen(makeProjector(cam, size.w, size.h), {
          x: mm.x,
          y: mm.y,
          z: layerZ(scene, routeLayer),
        })
        return s === null ? null : { x: rect.left + s.x, y: rect.top + s.y }
      },
      pads: padBoxes.map((pb) => ({ net: pb.net, x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 })),
      layer: routeLayer,
      stats: () => ({
        traces: routing.traces.length,
        vias: routing.vias.length,
        unrouted: routing.unrouted.length,
      }),
    }
    const w = window as unknown as { __pcb3d?: typeof probe | undefined }
    w.__pcb3d = probe
    return () => {
      w.__pcb3d = undefined
    }
  }, [cam, size, scene, routeLayer, padBoxes, routing, route])

  const onPointerDown = (e: ReactPointerEvent) => {
    press.current = { x: e.clientX, y: e.clientY, moved: 0 }
    canvasRef.current?.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const p = press.current
    if (p) {
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      p.moved += Math.abs(dx) + Math.abs(dy)
      p.x = e.clientX
      p.y = e.clientY
      // With a routing tool on, a small press is a CLICK, not an orbit: until the motion clearly
      // commits to a drag (crosses the slop) DON'T rotate — otherwise a click's incidental jitter would
      // swing the camera out from under the ray endDrag casts on release, snapping to the wrong copper.
      // Keep the cursor tracking below the threshold so the rubber-band still follows the pointer.
      if ((routeActive || viaActive) && p.moved < CLICK_SLOP_PX) {
        const mm = pickMm(e.clientX, e.clientY)
        if (mm) setHoverCursor(mm)
        return
      }
      setOrbit((o) => ({
        az: o.az - dx * 0.5,
        el: Math.min(89, Math.max(2, o.el + dy * 0.5)),
        dist: o.dist,
      }))
      return
    }
    // free hover while a routing tool is on → update the rubber-band cursor
    if (routeActive || viaActive) {
      const mm = pickMm(e.clientX, e.clientY)
      if (mm) setHoverCursor(mm)
    }
  }
  const endDrag = (e: ReactPointerEvent) => {
    const p = press.current
    press.current = null
    if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
      canvasRef.current.releasePointerCapture(e.pointerId)
    }
    // a press that barely moved is a routing CLICK, not an orbit
    if (p === null || p.moved >= CLICK_SLOP_PX) return
    if (routeActive) {
      const mm = pickMm(e.clientX, e.clientY)
      if (mm !== null) route?.onClick(mm, hitPad(padBoxes, mm))
      return
    }
    if (viaActive) {
      const mm = pickMm(e.clientX, e.clientY)
      if (mm === null) return
      const hit = hitCopper(routing.traces, padBoxes, mm)
      if (hit !== null) route?.onViaClick(hit.at, hit.net)
    }
  }
  const resetView = () => {
    const c = defaultCamera(scene)
    setOrbit({ az: c.azimuthDeg, el: c.elevationDeg, dist: c.distance })
  }

  const routing3d = routeActive || viaActive

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
          cursor: routing3d ? 'crosshair' : 'grab',
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
          title="Explode the layers apart in space — separate the copper planes so you can see the vias bridging between them, and route directly onto the exposed layers"
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
        <span style={{ fontSize: 10, color: '#9fb0c3' }}>
          {routing3d ? 'click to route · drag to orbit' : 'drag to orbit · scroll to zoom'}
        </span>
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
