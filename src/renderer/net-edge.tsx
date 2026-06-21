import { BaseEdge, EdgeLabelRenderer, type EdgeProps, useReactFlow } from '@xyflow/react'
import {
  createContext,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  STANDARD_AMBIENT_C,
  thermalSeverity,
  WIRE_INSULATION_MAX_C,
  wireThermalProfile,
} from '../thermal-model.ts'
import { frontFraction, type WireFront } from './front-propagation.ts'
import {
  FIELD_COLOR,
  FIELD_CONTOUR_MULTIPLIERS,
  fieldHaloRadiusPx,
  flowDuration,
  LensContext,
  MU_0,
  THERMAL_WARNING_FRACTION,
  thermalHotspotColor,
  thermalWarmthTint,
  voltageColor,
} from './lens.ts'
import type { FrameEdge } from './timeline.ts'
import { CheckpointContext } from './undo-context.ts'
import { formatEng } from './units.ts'
import { formatLength, gaugeAreaM2 } from './wire-length.ts'
import { roundedPathD, samplePathPoints } from './wire-path.ts'

/**
 * Net edge — a wire. Two routing modes (Sprint 19):
 *  - Plain (no waypoints): the straight segment between the two terminals —
 *    exactly the length the physics measures, so the picture and the
 *    resistance can never disagree. The old auto component-avoidance hop
 *    (S19-v3-18) was REMOVED in S19-v3-70 by request: routing belongs to the
 *    user — the canvas never invents a path that wasn't drawn (and the auto
 *    detour was drawn but never measured, an honesty gap).
 *  - Manual (S19-v3-17): the user routes it point by point. Double-click the wire
 *    to drop a corner at the nearest segment; drag a corner dot to move it. The
 *    wire runs straight through source → corners → target, or sweeps each
 *    corner when drawn with the curve subtool (each wire keeps its own sweep
 *    size).
 *
 * The chip (net id + current + length·resistance) is rendered via
 * EdgeLabelRenderer, lifted above the wire so it never covers a symbol.
 */

const LABEL_LIFT = 26

export type Point = { x: number; y: number }
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

/** Part bounding boxes (flow coords), so each wire can tell whether it runs through a part
 *  that isn't one of its own endpoints — App fills this from the live node positions. */
export type PartBox = { id: string; x: number; y: number; w: number; h: number }
export const PartBoxesContext = createContext<PartBox[]>([])

/** Each wire reports its drawn path (flow coords) here so the crossings overlay can find where
 *  wires cross — the wire knows its own rendered geometry; App collects them all. */
export const WireGeomContext = createContext<(id: string, points: Point[]) => void>(() => {})

/** Timeline playback (Sprint 22): when a frame is active, each wire reads its flow +
 *  voltage from that played-back instant instead of the steady solve. null = steady. */
export const FrameEdgeContext = createContext<Map<string, FrameEdge> | null>(null)

/** Travelling-charge front (Sprint 22): in front mode each wire reads how far the
 *  propagation wave has swept it; partArrival dims the parts not yet reached. */
export type FrontState = {
  time: number
  wires: Map<string, WireFront>
  partArrival: Map<string, number>
}
export const FrontContext = createContext<FrontState | null>(null)

const crossZ = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** Do segments p1p2 and p3p4 properly cross? */
function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = crossZ(p3, p4, p1)
  const d2 = crossZ(p3, p4, p2)
  const d3 = crossZ(p1, p2, p3)
  const d4 = crossZ(p1, p2, p4)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Does the segment a→b touch the axis-aligned box (an endpoint inside, or it crosses an edge)? */
function segmentHitsBox(a: Point, b: Point, box: PartBox): boolean {
  const inside = (p: Point) =>
    p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h
  if (inside(a) || inside(b)) return true
  const tl = { x: box.x, y: box.y }
  const tr = { x: box.x + box.w, y: box.y }
  const br = { x: box.x + box.w, y: box.y + box.h }
  const bl = { x: box.x, y: box.y + box.h }
  return (
    segmentsCross(a, b, tl, tr) ||
    segmentsCross(a, b, tr, br) ||
    segmentsCross(a, b, br, bl) ||
    segmentsCross(a, b, bl, tl)
  )
}

export function NetEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  label,
  style,
  markerStart,
  markerEnd,
  data,
}: EdgeProps) {
  const { setEdges, screenToFlowPosition } = useReactFlow()
  const lensState = useContext(LensContext)
  const partBoxes = useContext(PartBoxesContext)
  const reportGeom = useContext(WireGeomContext)
  const checkpointAction = useContext(CheckpointContext)
  // Timeline playback: this wire's values at the played-back instant (null = steady).
  const fe = useContext(FrameEdgeContext)?.get(id) ?? null
  // Travelling-charge front: when set, the wire shows the wave sweeping it (its own view).
  const front = useContext(FrontContext)
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

  // The routed points (terminals + any hand-dropped corners) — the ONE geometry
  // the picture, the length math, and the hot-spot sampling all share. Manual:
  // straight segments, or quadratic fillets when drawn with the curve subtool
  // (the same per-wire sweep size wire-path.ts measures). Plain: the straight
  // segment the physics measures — nothing invented.
  const routePoints: Point[] =
    waypoints.length > 0
      ? [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }]
      : [
          { x: sourceX, y: sourceY },
          { x: targetX, y: targetY },
        ]
  const sweep = typeof data?.curveRadius === 'number' ? data.curveRadius : undefined
  const curved = data?.curved === true && waypoints.length > 0
  const path = curved ? roundedPathD(routePoints, sweep) : pathThrough(routePoints)
  let labelX: number
  let labelY: number
  if (waypoints.length > 0) {
    const mid = routePoints[Math.floor(routePoints.length / 2)] ?? routePoints[0]
    labelX = mid?.x ?? sourceX
    labelY = mid?.y ?? sourceY
  } else {
    labelX = (sourceX + targetX) / 2
    labelY = (sourceY + targetY) / 2
  }

  // Report this wire's drawn path so the crossings overlay can find where wires cross.
  const geomKey = routePoints.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(';')
  // biome-ignore lint/correctness/useExhaustiveDependencies: geomKey already captures routePoints
  useEffect(() => {
    reportGeom(id, routePoints)
  }, [reportGeom, id, geomKey])

  // Travelling-charge front (Sprint 22): in front mode the wire shows only the portion the
  // wave has swept — bright, growing from the end the front entered — over a dim base, so you
  // watch the charge crawl down it. Its own view: no flow / voltage / lens readouts here.
  if (front !== null) {
    const fr = front.wires.get(id)
    const f = fr?.reached ? frontFraction(fr, front.time) : 0
    const energizedPoints = fr?.entryFromA === false ? [...routePoints].reverse() : routePoints
    const energizedPath = curved
      ? roundedPathD(energizedPoints, sweep)
      : pathThrough(energizedPoints)
    return (
      <>
        <path
          d={path}
          fill="none"
          stroke="rgba(130,142,160,0.30)"
          strokeWidth={1.6}
          style={{ pointerEvents: 'none' }}
        />
        {f > 0 ? (
          <path
            d={energizedPath}
            pathLength={1}
            fill="none"
            stroke="#7ab8ff"
            strokeWidth={2.8}
            strokeDasharray={`${f} 1`}
            strokeLinecap="round"
            style={{ pointerEvents: 'none' }}
          />
        ) : null}
      </>
    )
  }

  // Wire-through-part collision: does a segment of the routed path cut through a part that
  // is NOT one of this wire's two endpoints? (it touches those at the terminals by design.)
  let collidesPart = false
  for (let i = 0; i < routePoints.length - 1 && !collidesPart; i++) {
    const a = routePoints[i]
    const b = routePoints[i + 1]
    if (!a || !b) continue
    for (const box of partBoxes) {
      if (box.id === source || box.id === target) continue
      if (segmentHitsBox(a, b, box)) {
        collidesPart = true
        break
      }
    }
  }

  // Timeline playback overrides the electrical reads with the played-back frame's values;
  // geometry (length, resistance) is the same at any instant, so it stays from the edge data.
  const amps = fe
    ? fe.carries
      ? fe.amps
      : null
    : typeof data?.amps === 'number'
      ? data.amps
      : null
  const lengthM = typeof data?.lengthM === 'number' ? data.lengthM : null
  const ohms = typeof data?.ohms === 'number' ? data.ohms : null
  // Real solved I·R drop across this wire (it's a real element in the solve now).
  const drop = fe ? fe.drop : typeof data?.drop === 'number' ? data.drop : null
  // The wire's two end potentials (volts) — for the point-by-point probe below.
  const vSource = fe ? fe.vSource : typeof data?.vSource === 'number' ? data.vSource : null
  const vTarget = fe ? fe.vTarget : typeof data?.vTarget === 'number' ? data.vTarget : null

  // Thermal hot spot: a current-carrying wire's I²R heat peaks in its MIDDLE —
  // its ends are heat-sunk by the parts they connect to — so when a wire runs
  // hot we color the ACTUAL hot section (yellow warning → red over the
  // insulation limit), not the whole wire. The temperature and the 105 °C limit
  // are both real (thermal-model.ts). The overheat coloring is always on, in any
  // view (a safety reading); the temp lens additionally fills the whole wire with a
  // faint warmth tint, so the heat conducting out of the parts reads as a spread.
  const hotSegments: {
    key: string
    x1: number
    y1: number
    x2: number
    y2: number
    color: string
  }[] = []
  // The wire's peak (middle) temperature — null when it carries no current. Over
  // the insulation limit it counts as a real failure (a burst badge + a note),
  // the same always-on feedback an over-rated part gets.
  let wirePeakC: number | null = null
  if (amps !== null && ohms !== null && lengthM !== null) {
    // The wire's two ends sit on the parts they connect to, at those parts' solved
    // temperatures (the fin boundary) — so a wire off a hot part runs hotter.
    const endA = typeof data?.endTempA === 'number' ? data.endTempA : STANDARD_AMBIENT_C
    const endB = typeof data?.endTempB === 'number' ? data.endTempB : STANDARD_AMBIENT_C
    const profile = wireThermalProfile(
      amps,
      ohms,
      lengthM,
      gaugeAreaM2(data?.gaugeAwg),
      STANDARD_AMBIENT_C,
      endA,
      endB,
    )
    wirePeakC = profile.peakC
    const tempLens = lensState.lens === 'temp'
    if (
      tempLens ||
      thermalSeverity(profile.peakC, WIRE_INSULATION_MAX_C) >= THERMAL_WARNING_FRACTION
    ) {
      const samples = samplePathPoints(routePoints, {
        curved,
        stepPx: 12,
        ...(sweep !== undefined ? { radius: sweep } : {}),
      })
      const segments = Math.max(1, samples.length - 1)
      for (let i = 0; i < segments; i++) {
        const a = samples[i]
        const b = samples[i + 1]
        if (!a || !b) continue
        const u = (i + 0.5) / segments // fraction of the way along the wire
        const sectionC = profile.tempAtFraction(u)
        // Overheat danger color (vs the insulation limit) takes precedence; below it the
        // temp lens fills in the faint warmth tint (section temp vs the board's hottest).
        const color =
          thermalHotspotColor(thermalSeverity(sectionC, WIRE_INSULATION_MAX_C)) ??
          (tempLens ? thermalWarmthTint(sectionC, lensState.tMaxC, lensState.ambientC) : null)
        if (color)
          hotSegments.push({ key: `${a.x},${a.y}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, color })
      }
    }
  }

  const wireOverheating = wirePeakC !== null && wirePeakC > WIRE_INSULATION_MAX_C

  const addWaypoint = (event: ReactMouseEvent) => {
    event.stopPropagation()
    checkpointAction('wire-corner')
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
    checkpointAction('wire-corner')
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
  const edgeStyle = collidesPart
    ? { ...style, stroke: '#e0654a', strokeWidth: 2.8, strokeDasharray: '6 4' }
    : voltageStroke
      ? { ...style, stroke: voltageStroke, strokeWidth: 2.4 }
      : style
  // During playback the flow dashes always show (the timeline IS a flow view); otherwise
  // they follow the flow lens. Direction is the frame's sign when playing, else the steady arrow.
  const showFlow = lensState.flow || fe !== null
  const flowSeconds = showFlow && amps !== null ? flowDuration(amps) : null
  const flowReverse = fe ? !fe.sourceToTarget : Boolean(markerStart)
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

  // Lens readout: the REAL number the active lens represents, shown right on the wire while
  // the lens is on (not only on hover) — so a lens is the legible math, not just a wash of
  // color. Voltage → the wire's solved potential (what its color encodes); Field → the real
  // B at 1 cm; Flow → the solved current. Combine when several apply.
  const lensReadouts: { text: string; color: string }[] = []
  if (lensState.lens === 'voltage' && vSource !== null && vTarget !== null) {
    lensReadouts.push({
      text: formatEng((vSource + vTarget) / 2, 'V'),
      color: voltageStroke ?? '#d6a23c',
    })
  }
  if (lensState.lens === 'field' && amps !== null && lensState.fieldTesla > 0) {
    lensReadouts.push({
      text: formatEng((MU_0 * Math.abs(amps)) / (2 * Math.PI * 0.01), 'T'),
      color: FIELD_COLOR,
    })
  }
  if (lensState.flow && amps !== null && Math.abs(amps) > 1e-12) {
    lensReadouts.push({ text: formatEng(Math.abs(amps), 'A'), color: '#9fd0ff' })
  }

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
        {...(!fe && markerStart ? { markerStart } : {})}
        {...(!fe && markerEnd ? { markerEnd } : {})}
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
            // Dashes march toward the path's end; when the current flows the other
            // way (steady: arrow at source; playback: negative frame branch), reverse.
            ...(flowReverse ? { animationDirection: 'reverse' } : {}),
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {hotSegments.length > 0 ? (
        <g className="cb-wire-hotspot" style={{ pointerEvents: 'none' }}>
          {hotSegments.map((s) => (
            <g key={s.key}>
              {/* soft outer glow, then the solid hot core */}
              <line
                x1={s.x1}
                y1={s.y1}
                x2={s.x2}
                y2={s.y2}
                stroke={s.color}
                strokeWidth={7}
                strokeOpacity={0.28}
                strokeLinecap="round"
              />
              <line
                x1={s.x1}
                y1={s.y1}
                x2={s.x2}
                y2={s.y2}
                stroke={s.color}
                strokeWidth={3.6}
                strokeLinecap="round"
              />
            </g>
          ))}
        </g>
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
        {lensReadouts.length > 0 && !hovered ? (
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 13}px)`,
              background: 'rgba(10,10,12,0.8)',
              borderRadius: 3,
              padding: '1px 5px',
              fontSize: 9,
              fontWeight: 600,
              fontFamily: 'system-ui, sans-serif',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              display: 'flex',
              gap: 5,
            }}
          >
            {lensReadouts.map((r) => (
              <span key={r.text} style={{ color: r.color }}>
                {r.text}
              </span>
            ))}
          </div>
        ) : null}
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
            {wireOverheating && wirePeakC !== null ? (
              <div style={{ color: '#e0654a', fontSize: 8, marginTop: 1, fontWeight: 600 }}>
                💥 overheating {wirePeakC.toFixed(0)} °C (over {WIRE_INSULATION_MAX_C} °C)
              </div>
            ) : null}
          </div>
        ) : null}
        {collidesPart ? (
          <div
            className="nodrag nopan"
            title="This wire runs through a part — parts are solid. Double-click the wire to drop a corner and route it around."
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 13}px)`,
              fontSize: 12,
              pointerEvents: 'none',
              filter: 'drop-shadow(0 0 2px #000)',
            }}
          >
            ⛔
          </div>
        ) : null}
        {wireOverheating ? (
          <div
            className="nodrag nopan"
            title={`Wire overheating — ${wirePeakC?.toFixed(0)} °C, over the ${WIRE_INSULATION_MAX_C} °C insulation limit`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              fontSize: 13,
              pointerEvents: 'none',
              filter: 'drop-shadow(0 0 2px #000)',
            }}
          >
            💥
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
