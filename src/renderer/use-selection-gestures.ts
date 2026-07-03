import type { Edge, Node } from '@xyflow/react'
import {
  type Dispatch,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from 'react'
import type { CanvasEdgeLike as BlockEdgeLike } from './blocks.ts'
import {
  edgeIdsTouchingRegion,
  type LassoPoint,
  MIN_POINT_SPACING_PX,
  nodeCenter,
  nodeIdsInLasso,
  pointInPolygon,
} from './lasso.ts'
import type { Tool } from './toolbar.tsx'
import { samplePathPoints } from './wire-path.ts'

/**
 * The two selection gestures, lifted out of the Canvas component. Lasso (S19-v3-69): freeform
 * selection — the wrapper owns the pointer events; points are kept in BOTH spaces (wrapper-local for
 * the overlay drawing, flow coordinates for the hit test, so zoom/pan can't skew it); the LIVE gesture
 * lives in a ref because pointer events can land faster than renders, and the state mirror exists only
 * so the trail draws. Box-select (S19-v3-70): React Flow's marquee only picks parts, so the box is
 * tracked here too — on release, wires whose drawn path the region touches join the selection (a wire
 * can be selected without its end parts coming along). Everything moved here VERBATIM; the couplings
 * to the canvas (the active tool, the node/edge state, and the coordinate transform) are injected, so
 * behaviour is unchanged.
 */
export function useSelectionGestures(deps: {
  tool: Tool
  nodes: Node[]
  setNodes: Dispatch<SetStateAction<Node[]>>
  setEdges: Dispatch<SetStateAction<Edge[]>>
  edgesRef: MutableRefObject<Edge[]>
  screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number }
}) {
  const { tool, nodes, setNodes, setEdges, edgesRef, screenToFlowPosition } = deps
  const [lassoPoints, setLassoPoints] = useState<{
    screen: LassoPoint[]
    flow: LassoPoint[]
  } | null>(null)
  const lassoLive = useRef<{ rect: DOMRect; screen: LassoPoint[]; flow: LassoPoint[] } | null>(null)
  const onLassoDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (tool !== 'lasso' || event.button !== 0) return
      const rect = event.currentTarget.getBoundingClientRect()
      lassoLive.current = {
        rect,
        screen: [{ x: event.clientX - rect.left, y: event.clientY - rect.top }],
        flow: [screenToFlowPosition({ x: event.clientX, y: event.clientY })],
      }
      setLassoPoints({ screen: [...lassoLive.current.screen], flow: [...lassoLive.current.flow] })
    },
    [tool, screenToFlowPosition],
  )
  const onLassoMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const live = lassoLive.current
      if (tool !== 'lasso' || live === null) return
      const local = { x: event.clientX - live.rect.left, y: event.clientY - live.rect.top }
      const last = live.screen.at(-1)
      if (
        last !== undefined &&
        Math.hypot(local.x - last.x, local.y - last.y) < MIN_POINT_SPACING_PX
      ) {
        return
      }
      live.screen.push(local)
      live.flow.push(screenToFlowPosition({ x: event.clientX, y: event.clientY }))
      setLassoPoints({ screen: [...live.screen], flow: [...live.flow] })
    },
    [tool, screenToFlowPosition],
  )
  // A node's center for the wire touch-test (same fallback the node test uses).
  const centerOf = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId)
      return node === undefined ? undefined : nodeCenter(node)
    },
    [nodes],
  )

  const onLassoUp = useCallback(() => {
    const live = lassoLive.current
    if (tool !== 'lasso' || live === null) return
    const picked = new Set(
      nodeIdsInLasso(nodes as { id: string; position: { x: number; y: number } }[], live.flow),
    )
    // Wires select by TOUCH: any portion of the wire's drawn path inside the
    // lasso grabs it — its end parts do not have to come along, so a wire can
    // be selected without its components.
    const touched = new Set(
      live.flow.length >= 3
        ? edgeIdsTouchingRegion(
            edgesRef.current as BlockEdgeLike[],
            centerOf,
            (p) => pointInPolygon(p, live.flow),
            samplePathPoints,
          )
        : [],
    )
    if (picked.size > 0 || touched.size > 0) {
      setNodes((current) => current.map((n) => ({ ...n, selected: picked.has(n.id) })))
      setEdges((current) => current.map((e) => ({ ...e, selected: touched.has(e.id) })))
    }
    lassoLive.current = null
    setLassoPoints(null)
  }, [tool, nodes, setNodes, setEdges, centerOf, edgesRef])

  // Box-select wires the same way (S19-v3-70): React Flow's marquee only
  // picks parts, so the box is tracked here too — on release, wires whose
  // path the box touches join the selection. Gesture state lives in a ref.
  const boxLive = useRef<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(
    null,
  )
  const onBoxDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (tool !== 'select' || event.button !== 0) return
      const target = event.target as Element
      if (target.closest?.('.react-flow__pane') === null) return
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      boxLive.current = { start: point, end: point }
    },
    [tool, screenToFlowPosition],
  )
  const onBoxMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (boxLive.current === null) return
      boxLive.current.end = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    },
    [screenToFlowPosition],
  )
  const onBoxUp = useCallback(() => {
    const box = boxLive.current
    boxLive.current = null
    if (box === null || tool !== 'select') return
    const minX = Math.min(box.start.x, box.end.x)
    const maxX = Math.max(box.start.x, box.end.x)
    const minY = Math.min(box.start.y, box.end.y)
    const maxY = Math.max(box.start.y, box.end.y)
    if (maxX - minX < 4 && maxY - minY < 4) return // a click, not a box
    const touched = new Set(
      edgeIdsTouchingRegion(
        edgesRef.current as BlockEdgeLike[],
        centerOf,
        (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY,
        samplePathPoints,
      ),
    )
    setEdges((current) => current.map((e) => ({ ...e, selected: touched.has(e.id) })))
  }, [tool, centerOf, setEdges, edgesRef])

  return { lassoPoints, onLassoDown, onLassoMove, onLassoUp, onBoxDown, onBoxMove, onBoxUp }
}
