import { addEdge, type Edge, type Node } from '@xyflow/react'
import {
  type Dispatch,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { eventMatchesBinding } from './keybinds.ts'
import { THEME } from './theme.ts'
import type { Tool } from './toolbar.tsx'
import { CURVE_RADIUS_PX } from './wire-path.ts'

type WireAnchor = { nodeId: string; handleId: string } | { x: number; y: number }

/**
 * The Wire tool's state machine, lifted out of the Canvas component. Click-by-click CAD-style wire
 * drawing (S19-v3-60/61/70): click ANYWHERE to start (a terminal dot, or open space), click to drop
 * corners, then click a terminal dot to finish — or double-click in space to end there. A free
 * start/end becomes a JUNCTION (the schematic tie dot). The Line/Curve subtool picks sharp corners or
 * rounded fillets; the curve radius applies to wires drawn from now on. Escape (or re-clicking the
 * start) abandons the wire-in-progress; leaving the tool drops it. Everything moved here VERBATIM;
 * its couplings to the canvas (the node/edge/undo state, the active tool, the wire gauge, the cancel
 * keybind, the coordinate transform, and the shared id counter) are injected, so behaviour is
 * unchanged.
 */
export function useWireTool(deps: {
  tool: Tool
  wireGauge: number
  cancelWire: Parameters<typeof eventMatchesBinding>[1]
  setEdges: Dispatch<SetStateAction<Edge[]>>
  setNodes: Dispatch<SetStateAction<Node[]>>
  checkpointAction: (tag: string) => void
  screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number }
  dropCount: MutableRefObject<number>
}) {
  const {
    tool,
    wireGauge,
    cancelWire,
    setEdges,
    setNodes,
    checkpointAction,
    screenToFlowPosition,
    dropCount,
  } = deps
  const [wireStyle, setWireStyle] = useState<'line' | 'curve'>('line')
  const [wireCurveRadius, setWireCurveRadius] = useState(CURVE_RADIUS_PX)
  const [pendingWire, setPendingWire] = useState<{
    start: WireAnchor
    corners: { id: string; x: number; y: number }[]
  } | null>(null)
  const [wireCursor, setWireCursor] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (tool !== 'wire') {
      setPendingWire(null)
      setWireCursor(null)
    }
  }, [tool])
  useEffect(() => {
    if (pendingWire === null) return
    const onKey = (event: KeyboardEvent) => {
      if (eventMatchesBinding(event, cancelWire)) setPendingWire(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingWire, cancelWire])
  const finishWire = useCallback(
    (end: WireAnchor, corners: { id: string; x: number; y: number }[]) => {
      if (pendingWire === null) return
      checkpointAction('wire')
      // A free anchor materializes as a junction node centered on the point
      // (the node box is 14×14 with its tie handle in the middle).
      const materialize = (anchor: WireAnchor): { nodeId: string; handleId: string } => {
        if ('nodeId' in anchor) return anchor
        dropCount.current += 1
        const id = `junction_${dropCount.current}`
        setNodes((current) =>
          current.concat({
            id,
            type: 'junction',
            position: { x: anchor.x - 7, y: anchor.y - 7 },
            data: { definition: 'junction', label: id },
          }),
        )
        return { nodeId: id, handleId: 'tie' }
      }
      const from = materialize(pendingWire.start)
      const to = materialize(end)
      setEdges((current) =>
        addEdge(
          {
            source: from.nodeId,
            sourceHandle: from.handleId,
            target: to.nodeId,
            targetHandle: to.handleId,
            type: 'net',
            deletable: true,
            style: { stroke: THEME.wire },
            data: {
              gaugeAwg: wireGauge,
              ...(corners.length > 0 ? { waypoints: corners } : {}),
              ...(wireStyle === 'curve' ? { curved: true, curveRadius: wireCurveRadius } : {}),
            },
          },
          current,
        ),
      )
      setPendingWire(null)
    },
    [
      pendingWire,
      wireStyle,
      wireCurveRadius,
      wireGauge,
      setEdges,
      setNodes,
      checkpointAction,
      dropCount,
    ],
  )
  const onWireClick = useCallback(
    (event: ReactMouseEvent) => {
      if (tool !== 'wire') return
      const target = event.target as Element
      const handleEl = target.closest?.('.react-flow__handle') as HTMLElement | null
      if (handleEl !== null) {
        const nodeId = handleEl.dataset.nodeid
        const handleId = handleEl.dataset.handleid
        if (nodeId === undefined || handleId === undefined) return
        if (pendingWire === null) {
          setPendingWire({ start: { nodeId, handleId }, corners: [] })
          return
        }
        const start = pendingWire.start
        if ('nodeId' in start && start.nodeId === nodeId && start.handleId === handleId) {
          setPendingWire(null)
          return
        }
        finishWire({ nodeId, handleId }, pendingWire.corners)
        return
      }
      if (target.closest?.('.react-flow__pane') === null) return
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      if (pendingWire === null) {
        // CAD-style: a wire can START in open space (a junction is made there).
        setPendingWire({ start: point, corners: [] })
        return
      }
      setPendingWire({
        ...pendingWire,
        corners: [...pendingWire.corners, { id: crypto.randomUUID(), ...point }],
      })
    },
    [tool, pendingWire, finishWire, screenToFlowPosition],
  )
  // Double-click in open space ENDS the wire there (the CAD convention). The
  // double-click's own two single clicks each dropped a corner — remove them.
  const onWireDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (tool !== 'wire' || pendingWire === null) return
      const target = event.target as Element
      if (target.closest?.('.react-flow__handle') !== null) return
      if (target.closest?.('.react-flow__pane') === null) return
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      finishWire(point, pendingWire.corners.slice(0, -2))
    },
    [tool, pendingWire, finishWire, screenToFlowPosition],
  )
  // The rubber band follows the cursor between clicks (flow coordinates).
  const onWireMove = useCallback(
    (event: ReactMouseEvent) => {
      if (tool !== 'wire' || pendingWire === null) return
      setWireCursor(screenToFlowPosition({ x: event.clientX, y: event.clientY }))
    },
    [tool, pendingWire, screenToFlowPosition],
  )

  return {
    wireStyle,
    setWireStyle,
    wireCurveRadius,
    setWireCurveRadius,
    pendingWire,
    wireCursor,
    onWireClick,
    onWireDoubleClick,
    onWireMove,
  }
}
