import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  useReactFlow,
} from '@xyflow/react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { formatCurrent } from './edge-currents.ts'
import { formatLength, formatResistance } from './wire-length.ts'

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
  const waypoints = readWaypoints(data)

  let path: string
  let labelX: number
  let labelY: number
  if (waypoints.length > 0) {
    const points: Point[] = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }]
    path = pathThrough(points)
    const mid = points[Math.floor(points.length / 2)] ?? points[0]
    labelX = mid?.x ?? sourceX
    labelY = mid?.y ?? sourceY
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

  const amps = typeof data?.amps === 'number' ? data.amps : null
  const lengthM = typeof data?.lengthM === 'number' ? data.lengthM : null
  const ohms = typeof data?.ohms === 'number' ? data.ohms : null

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

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={style}
        {...(markerStart ? { markerStart } : {})}
        {...(markerEnd ? { markerEnd } : {})}
      />
      {/* Invisible wide hit area: double-click adds a corner where you clicked. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the wire is a pointer routing surface (double-click adds a corner); keyboard routing is future work */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        style={{ pointerEvents: 'stroke', cursor: 'copy' }}
        onDoubleClick={addWaypoint}
      />
      <EdgeLabelRenderer>
        {label ? (
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
                {formatCurrent(amps)}
              </div>
            ) : null}
            {lengthM !== null && ohms !== null ? (
              <div style={{ color: '#8a93a0', fontSize: 8, marginTop: 1 }}>
                {formatLength(lengthM)} · {formatResistance(ohms)}
              </div>
            ) : null}
          </div>
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
