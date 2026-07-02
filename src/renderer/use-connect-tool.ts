import { addEdge, type Edge } from '@xyflow/react'
import {
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from 'react'
import type { ConnectAnchor } from './canvas-overlays.tsx'
import { eventMatchesBinding } from './keybinds.ts'
import { THEME } from './theme.ts'
import type { ConnectMode, Tool } from './toolbar.tsx'

/**
 * The Connect tool's state machine, lifted out of the Canvas component. Pick a start dot, pick an end dot
 * → the same global auto-router the Wire tool relies on lays the wire; Single mode routes each pair at
 * once, Batch queues pairs (`connectQueue`) and routes them all on "Route all". Re-picking the start, Esc,
 * or a click on empty canvas cancels a half-made connection. Its three states + handlers + the Esc-cancel
 * effect moved here VERBATIM; its six couplings to the canvas (the edge/undo/routing state, the active
 * tool, the wire gauge, and the cancel keybind) are injected, so behaviour is unchanged.
 */
export function useConnectTool(deps: {
  tool: Tool
  wireGauge: number
  cancelWire: Parameters<typeof eventMatchesBinding>[1]
  setEdges: Dispatch<SetStateAction<Edge[]>>
  setAutoRouteWires: Dispatch<SetStateAction<boolean>>
  checkpointAction: (tag: string) => void
}) {
  const { tool, wireGauge, cancelWire, setEdges, setAutoRouteWires, checkpointAction } = deps
  const [connectMode, setConnectMode] = useState<ConnectMode>('single')
  const [connectStart, setConnectStart] = useState<{ nodeId: string; handleId: string } | null>(
    null,
  )
  const [connectQueue, setConnectQueue] = useState<
    { from: { nodeId: string; handleId: string }; to: { nodeId: string; handleId: string } }[]
  >([])

  useEffect(() => {
    if (connectStart === null) return
    const onKey = (event: KeyboardEvent) => {
      if (eventMatchesBinding(event, cancelWire)) setConnectStart(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connectStart, cancelWire])
  // Leaving the Connect tool drops a half-made connection (the queue is kept — re-enter to finish it).
  useEffect(() => {
    if (tool !== 'connect') setConnectStart(null)
  }, [tool])

  const connectEdgeParams = useCallback(
    (from: ConnectAnchor, to: ConnectAnchor) => ({
      source: from.nodeId,
      sourceHandle: from.handleId,
      target: to.nodeId,
      targetHandle: to.handleId,
      type: 'net',
      deletable: true,
      style: { stroke: THEME.wire },
      data: { gaugeAwg: wireGauge },
    }),
    [wireGauge],
  )
  const routeConnectQueue = useCallback(() => {
    if (connectQueue.length === 0) return
    checkpointAction('wire')
    setEdges((current) =>
      connectQueue.reduce(
        (acc, pair) => addEdge(connectEdgeParams(pair.from, pair.to), acc),
        current,
      ),
    )
    setConnectQueue([])
    setConnectStart(null)
    setAutoRouteWires(true)
  }, [connectQueue, connectEdgeParams, setEdges, checkpointAction, setAutoRouteWires])
  const clearConnectQueue = useCallback(() => {
    setConnectQueue([])
    setConnectStart(null)
  }, [])
  const onPickConnectPoint = useCallback(
    (nodeId: string, handleId: string) => {
      if (connectStart === null) {
        setConnectStart({ nodeId, handleId })
        return
      }
      if (connectStart.nodeId === nodeId && connectStart.handleId === handleId) {
        setConnectStart(null)
        return
      }
      const from = connectStart
      const to = { nodeId, handleId }
      if (connectMode === 'batch') {
        setConnectQueue((q) => [...q, { from, to }])
        setConnectStart(null)
        return
      }
      checkpointAction('wire')
      setEdges((current) => addEdge(connectEdgeParams(from, to), current))
      setAutoRouteWires(true)
      setConnectStart(null)
    },
    [connectStart, connectMode, connectEdgeParams, setEdges, checkpointAction, setAutoRouteWires],
  )
  const onConnectClick = useCallback(
    (event: ReactMouseEvent) => {
      if (tool !== 'connect') return
      const target = event.target as Element
      const handleEl = target.closest?.('.react-flow__handle') as HTMLElement | null
      if (handleEl !== null) {
        const nodeId = handleEl.dataset.nodeid
        const handleId = handleEl.dataset.handleid
        if (nodeId !== undefined && handleId !== undefined) onPickConnectPoint(nodeId, handleId)
        return
      }
      if (target.closest?.('.react-flow__pane') !== null && connectStart !== null) {
        setConnectStart(null)
      }
    },
    [tool, connectStart, onPickConnectPoint],
  )

  return {
    connectMode,
    setConnectMode,
    connectStart,
    connectQueue,
    routeConnectQueue,
    clearConnectQueue,
    onPickConnectPoint,
    onConnectClick,
  }
}
