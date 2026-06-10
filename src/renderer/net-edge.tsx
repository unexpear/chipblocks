import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  useNodes,
  useReactFlow,
} from '@xyflow/react'
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useContext,
  useRef,
  useState,
} from 'react'
import {
  FIELD_COLOR,
  FIELD_CONTOUR_MULTIPLIERS,
  fieldHaloRadiusPx,
  flowDuration,
  LensContext,
  MU_0,
  voltageColor,
} from './lens.ts'
import { formatEng } from './units.ts'
import { formatLength } from './wire-length.ts'

/**
 * Net edge — a wire. Two routing modes (Sprint 19):
 *  - Auto (no waypoints): orthogonal smooth-step, straight runs + right-angle
 *    corners (S19-v3-11).
 *  - Manual (S19-v3-17): the user routes it point by point. Double-click the wire
 *    to drop a corner at the nearest segment; drag a corner dot to move it. The
 *    wire then runs straight through source → corners → target. This is the
 *    "easy scaling" escape hatch — any wire can be hand-routed around anything,
 *    so the auto-router never has to be perfect.
 *
 * The chip (net id + current + length·resistance) is rendered via
 * EdgeLabelRenderer, lifted above the wire so it never covers a symbol.
 */

const LABEL_LIFT = 26

type Point = { x: number; y: number }
type Waypoint = Point & { id: string }

const readWaypoints = (data: EdgeProps['data']): Waypoint[] =>
  Array.isArray(data?.waypoints) ? (data.waypoints as Waypoint[]) : []

const pathThrough = (points: Point[]): string =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

type Box = { x: number; y: number; w: number; h: number }

/** Does the straight segment a→b pass through the box? (sampled — endpoints excluded). */
function crossesBox(ax: number, ay: number, bx: number, by: number, box: Box): boolean {
  const steps = 24
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const x = ax + (bx - ax) * t
    const y = ay + (by - ay) * t
    if (x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h) return true
  }
  return false
}

/** Index in the waypoint list to insert a new point so it lands on the nearest segment. */
function nearestSegment(points: Point[], p: Point): number {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (!a || !b) continue
    const distance = distanceToSegment(p, a, b)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

export function NetEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerStart,
  markerEnd,
  data,
}: EdgeProps) {
  const { setEdges, screenToFlowPosition } = useReactFlow()
  const nodes = useNodes()
  const lensState = useContext(LensContext)
  const waypoints = readWaypoints(data)
  // The detail chip (net id · current · length · resistance) only pops up while
  // the wire is hovered — keeps the schematic clean; the current arrows on the
  // wire itself stay visible always.
  const [hovered, setHovered] = useState(false)
  // Live voltage probe: as the cursor rides along the wire, read the real
  // potential at that point + how much has dropped from the wire's entry end.
  const hitPathRef = useRef<SVGPathElement>(null)
  const [probe, setProbe] = useState<{
    x: number
    y: number
    vHere: number
    delta: number
  } | null>(null)

  let path: string
  let labelX: number
  let labelY: number
  if (waypoints.length > 0) {
    // Manual: the user's hand-routed path through the corner points.
    const points: Point[] = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }]
    path = pathThrough(points)
    const mid = points[Math.floor(points.length / 2)] ?? points[0]
    labelX = mid?.x ?? sourceX
    labelY = mid?.y ?? sourceY
  } else {
    // Auto component-avoidance (S19-v3-18): if the straight route crosses any
    // part's box, hop over the top / under the bottom (whichever detour is
    // shorter); otherwise the plain orthogonal route. The user can switch to
    // hand-routing by double-clicking to drop corners.
    //
    // Endpoints are INCLUDED (S19-v3-19): when a wire connects terminals that
    // face away (e.g. switch's right terminal to a resistor sitting to its left),
    // the straight route cuts back through both bodies — including them makes the
    // wire route around its own parts instead of through them.
    const obstacles: Box[] = nodes.map((n) => ({
      x: n.position.x,
      y: n.position.y,
      w: n.measured?.width ?? 80,
      h: n.measured?.height ?? 44,
    }))
    const crossed = obstacles.filter((b) => crossesBox(sourceX, sourceY, targetX, targetY, b))
    if (crossed.length > 0) {
      const midY = (sourceY + targetY) / 2
      const overY = Math.min(...crossed.map((b) => b.y)) - 22
      const underY = Math.max(...crossed.map((b) => b.y + b.h)) + 22
      const clearY = Math.abs(overY - midY) <= Math.abs(underY - midY) ? overY : underY
      path = pathThrough([
        { x: sourceX, y: sourceY },
        { x: sourceX, y: clearY },
        { x: targetX, y: clearY },
        { x: targetX, y: targetY },
      ])
      labelX = (sourceX + targetX) / 2
      labelY = clearY
    } else {
      const [autoPath, autoX, autoY] = getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: 0,
      })
      path = autoPath
      labelX = autoX
      labelY = autoY
    }
  }

  const amps = typeof data?.amps === 'number' ? data.amps : null
  const lengthM = typeof data?.lengthM === 'number' ? data.lengthM : null
  const ohms = typeof data?.ohms === 'number' ? data.ohms : null
  // Real solved I·R drop across this wire (it's a real element in the solve now).
  const drop = typeof data?.drop === 'number' ? data.drop : null
  // The wire's two end potentials (volts) — for the point-by-point probe below.
  const vSource = typeof data?.vSource === 'number' ? data.vSource : null
  const vTarget = typeof data?.vTarget === 'number' ? data.vTarget : null

  const addWaypoint = (event: ReactMouseEvent) => {
    event.stopPropagation()
    const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    setEdges((edges) =>
      edges.map((edge) => {
        if (edge.id !== id) return edge
        const current = readWaypoints(edge.data)
        const points = [{ x: sourceX, y: sourceY }, ...current, { x: targetX, y: targetY }]
        const at = nearestSegment(points, pos)
        const next = [...current]
        next.splice(at, 0, { id: crypto.randomUUID(), x: pos.x, y: pos.y })
        return { ...edge, data: { ...edge.data, waypoints: next } }
      }),
    )
  }

  const dragWaypoint = (index: number) => (down: ReactPointerEvent) => {
    down.preventDefault()
    down.stopPropagation()
    const move = (event: PointerEvent) => {
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setEdges((edges) =>
        edges.map((edge) => {
          if (edge.id !== id) return edge
          const current = readWaypoints(edge.data)
          return {
            ...edge,
            data: {
              ...edge.data,
              waypoints: current.map((w, i) => (i === index ? { ...w, x: pos.x, y: pos.y } : w)),
            },
          }
        }),
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Project the cursor onto the wire and read the interpolated potential there.
  // Voltage varies linearly along a uniform wire, so V(t) = vSource + t·(vTarget −
  // vSource) for the fractional arc-length t nearest the cursor; the readout snaps
  // to the wire at that point and rides along with the mouse.
  const moveProbe = (event: ReactMouseEvent) => {
    const pathEl = hitPathRef.current
    if (pathEl === null || vSource === null || vTarget === null) return
    const total = pathEl.getTotalLength()
    if (total === 0) return
    const cursor = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    let bestT = 0
    let bestDistance = Number.POSITIVE_INFINITY
    let bestX = sourceX
    let bestY = sourceY
    const STEPS = 64
    for (let i = 0; i <= STEPS; i++) {
      const point = pathEl.getPointAtLength((i / STEPS) * total)
      const distance = Math.hypot(point.x - cursor.x, point.y - cursor.y)
      if (distance < bestDistance) {
        bestDistance = distance
        bestT = i / STEPS
        bestX = point.x
        bestY = point.y
      }
    }
    const vHere = vSource + bestT * (vTarget - vSource)
    setProbe({ x: bestX, y: bestY, vHere, delta: vHere - vSource })
  }

  // Voltage lens: recolor the wire by its solved potential (the average of its
  // two end potentials — a wire's drop is tiny on this scale) within the
  // circuit's [vMin, vMax]. Flow lens: marching dashes, direction from the
  // solved current's sign (the same sign that places the arrowheads), speed
  // from its magnitude.
  const voltageStroke =
    lensState.lens === 'voltage' && vSource !== null && vTarget !== null
      ? voltageColor((vSource + vTarget) / 2, lensState.vMin, lensState.vMax)
      : null
  const edgeStyle = voltageStroke ? { ...style, stroke: voltageStroke, strokeWidth: 2.4 } : style
  const flowSeconds = lensState.flow && amps !== null ? flowDuration(amps) : null
  // Field lens: nested isofield bands — each band edge is the real distance at
  // which this wire's field equals that contour level (B = μ₀I/2πr inverted).
  const fieldBands =
    lensState.lens === 'field' && amps !== null && lensState.fieldTesla > 0
      ? FIELD_CONTOUR_MULTIPLIERS.map((multiplier, i) => ({
          key: multiplier,
          radiusPx: fieldHaloRadiusPx(amps, multiplier * lensState.fieldTesla),
          opacity: 0.09 + 0.07 * i,
        })).filter((band) => band.radiusPx >= 0.75)
      : []

  return (
    <>
      {fieldBands.map((band) => (
        <path
          key={band.key}
          d={path}
          fill="none"
          stroke={FIELD_COLOR}
          strokeOpacity={band.opacity}
          strokeWidth={2 * band.radiusPx}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none' }}
        />
      ))}
      <BaseEdge
        id={id}
        path={path}
        style={edgeStyle}
        {...(markerStart ? { markerStart } : {})}
        {...(markerEnd ? { markerEnd } : {})}
      />
      {flowSeconds !== null ? (
        <path
          d={path}
          fill="none"
          className="cb-flow-dash"
          stroke={voltageStroke ?? '#9fd0ff'}
          strokeWidth={voltageStroke ? 2.4 : 1.8}
          strokeDasharray="7 5"
          strokeLinecap="round"
          style={{
            animationDuration: `${flowSeconds}s`,
            // Dashes march toward the path's end; when the solved current flows
            // the other way (the arrow sits at the source), march in reverse.
            ...(markerStart ? { animationDirection: 'reverse' } : {}),
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {/* Invisible wide hit area: hover shows the chip; double-click adds a corner. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the wire is a pointer routing surface (hover reveals detail, double-click adds a corner); keyboard routing is future work */}
      <path
        ref={hitPathRef}
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        style={{ pointerEvents: 'stroke', cursor: 'copy' }}
        onDoubleClick={addWaypoint}
        onMouseEnter={() => setHovered(true)}
        onMouseMove={moveProbe}
        onMouseLeave={() => {
          setHovered(false)
          setProbe(null)
        }}
      />
      <EdgeLabelRenderer>
        {hovered && label ? (
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - LABEL_LIFT}px)`,
              background: '#0c0c0e',
              border: '1px solid #3a3a3f',
              borderRadius: 3,
              padding: '3px 5px',
              fontSize: 9,
              fontFamily: 'system-ui, sans-serif',
              color: '#cdd6e0',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              textAlign: 'center',
            }}
          >
            <div>{label}</div>
            {amps !== null ? (
              <div style={{ color: '#7ab8ff', fontSize: 8, marginTop: 1 }}>
                {formatEng(amps, 'A')}
              </div>
            ) : null}
            {lengthM !== null && ohms !== null ? (
              <div style={{ color: '#8a93a0', fontSize: 8, marginTop: 1 }}>
                {formatLength(lengthM)} · {formatEng(ohms, 'Ω')}
              </div>
            ) : null}
            {drop !== null ? (
              <div style={{ color: '#e0b070', fontSize: 8, marginTop: 1 }}>
                drop {formatEng(drop, 'V')}
              </div>
            ) : null}
            {lensState.lens === 'field' && amps !== null ? (
              <div style={{ color: FIELD_COLOR, fontSize: 8, marginTop: 1 }}>
                B at 1 cm: {formatEng((MU_0 * Math.abs(amps)) / (2 * Math.PI * 0.01), 'T')}
              </div>
            ) : null}
          </div>
        ) : null}
        {probe ? (
          <>
            <div
              className="nodrag nopan"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${probe.x}px, ${probe.y}px)`,
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#e0b070',
                border: '1px solid #0c0c0e',
                pointerEvents: 'none',
              }}
            />
            <div
              className="nodrag nopan"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${probe.x}px, ${probe.y - 18}px)`,
                background: '#0c0c0e',
                border: '1px solid #e0b070',
                borderRadius: 3,
                padding: '2px 5px',
                fontSize: 9,
                fontFamily: 'system-ui, sans-serif',
                color: '#e7c890',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                textAlign: 'center',
              }}
            >
              <div>{`${probe.delta <= 0 ? 'drop' : 'rise'} ${formatEng(Math.abs(probe.delta), 'V')}`}</div>
              <div style={{ fontSize: 8, color: '#b58a4a', marginTop: 1 }}>
                {formatEng(probe.vHere, 'V', { signed: true })} here
              </div>
            </div>
          </>
        ) : null}
        {waypoints.map((w, i) => (
          <div
            key={w.id}
            className="nodrag nopan"
            onPointerDown={dragWaypoint(i)}
            title="Drag to route — the wire bends through here"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${w.x}px, ${w.y}px)`,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: '#7ab8ff',
              border: '1px solid #0c0c0e',
              cursor: 'grab',
              pointerEvents: 'all',
            }}
          />
        ))}
      </EdgeLabelRenderer>
    </>
  )
}

export const edgeTypes = { net: NetEdge }
