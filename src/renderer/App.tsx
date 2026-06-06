import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { type DragEvent, useCallback, useMemo, useRef } from 'react'
import { solveDC } from '../dc-solver.ts'
import { loadCatalogWorld } from './catalog-loader.ts'
import { edgeFlow } from './edge-currents.ts'
import { edgeTypes } from './net-edge.tsx'
import { DEFINITION_MIME, Palette } from './palette.tsx'
import { nodeTypes } from './symbols.tsx'
import { lengthFromDrawn, wireResistance } from './wire-length.ts'
import { worldToFlow } from './world-to-flow.ts'

const CURRENT = '#7ab8ff' // a live wire carrying current (solved)
const IDLE = '#555' // a tap / no-current wire
const DRAWN = '#8a93a0' // a user-drawn wire, not yet solved

/**
 * The canvas page. Sprint 18 rendered the loaded circuit; Sprint 19 makes it
 * interactive — drag a part from the palette to place it (S19-v3-6), drag to
 * rearrange (S19-v3-3), draw wires between handles, with physics-driven current
 * arrows on the solved circuit (S19-v3-5). useReactFlow needs a provider, so the
 * page splits into App (provider) + Canvas (content).
 */
export function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}

function Canvas() {
  const initial = useMemo(() => {
    const world = loadCatalogWorld()
    const solution = solveDC(world)
    const flow = worldToFlow(world)
    const nodes: Node[] = flow.nodes.map((n) => ({
      id: n.id,
      type: 'device',
      position: n.position,
      data: { definition: n.data.definition, label: n.id },
    }))
    const positions = new Map(flow.nodes.map((n) => [n.id, n.position]))
    const edges: Edge[] = flow.edges.map((e) => {
      // Arrowhead direction + magnitude are the real solver current (S19-v3-5):
      // markerEnd when current runs source→target, markerStart when it reverses.
      const wireCurrent = edgeFlow(world, solution, e.label, e.source, e.target)
      // Wire length from how it's drawn → real length → resistance (S19-v3-7).
      const from = positions.get(e.source)
      const to = positions.get(e.target)
      const drawnPixels = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0
      const lengthM = lengthFromDrawn(drawnPixels)
      const ohms = wireResistance(lengthM)
      const marker = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: CURRENT }
      const arrowAtTarget = wireCurrent.carries && wireCurrent.sourceToTarget
      const arrowAtSource = wireCurrent.carries && !wireCurrent.sourceToTarget
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'net',
        // A wire is a connection, not a deletable block — the user reconnects
        // its endpoints instead (wire-as-connector model).
        deletable: false,
        label: e.showLabel ? e.label : undefined,
        data: { amps: wireCurrent.carries ? wireCurrent.amps : null, lengthM, ohms },
        style: {
          stroke: wireCurrent.carries ? CURRENT : IDLE,
          strokeWidth: wireCurrent.carries ? 1.6 : 1,
        },
        // Omit (not undefined) when absent — exactOptionalPropertyTypes.
        ...(arrowAtTarget ? { markerEnd: marker } : {}),
        ...(arrowAtSource ? { markerStart: marker } : {}),
      }
    })
    return { nodes, edges }
  }, [])

  // Live React Flow state — nodes are draggable (S19-v3-3); setNodes/setEdges
  // also let the palette drop new parts and the user draw new wires.
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const { screenToFlowPosition } = useReactFlow()
  const dropCount = useRef(0)

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  // Drop a part from the palette → a new node at the drop point (S19-v3-6).
  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const definition = event.dataTransfer.getData(DEFINITION_MIME)
      if (!definition) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      dropCount.current += 1
      const id = `${definition}_${dropCount.current}`
      setNodes((current) =>
        current.concat({ id, type: 'device', position, data: { definition, label: id } }),
      )
    },
    [screenToFlowPosition, setNodes],
  )

  // Draw a wire between two handles → a new (not-yet-solved) net edge.
  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((current) =>
        addEdge(
          { ...connection, type: 'net', deletable: false, style: { stroke: DRAWN } },
          current,
        ),
      ),
    [setEdges],
  )

  // Reconnect: drag a wire's endpoint to a different dot (wire-as-connector
  // model — disconnect/reconnect, never delete). Dropping in empty space does
  // nothing, so a wire is never lost.
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) =>
      setEdges((current) => reconnectEdge(oldEdge, newConnection, current)),
    [setEdges],
  )

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
      <Palette />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the canvas is a drag-and-drop drop target for palette parts; keyboard-accessible placement is future work */}
      <div style={{ flex: 1, position: 'relative' }} onDragOver={onDragOver} onDrop={onDrop}>
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 10,
            color: '#ccc',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
            pointerEvents: 'none',
          }}
        >
          ChipBlocks — {nodes.length} components, {edges.length} wires · drag a part from the panel
          · move parts · draw wires between the dots
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#333" gap={16} />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  )
}
