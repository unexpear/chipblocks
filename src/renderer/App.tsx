import {
  addEdge,
  Background,
  type Connection,
  ConnectionMode,
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
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { World } from '../cross-fk-validator.ts'
import { type Solution, solveDC } from '../dc-solver.ts'
import { loadCatalogWorld } from './catalog-loader.ts'
import { DockablePanel, type DockEdge } from './dockable-panel.tsx'
import { edgeFlow, wireFlow } from './edge-currents.ts'
import { edgeTypes } from './net-edge.tsx'
import { DEFINITION_MIME, PaletteItems } from './palette.tsx'
import { defaultParameters } from './part-defaults.ts'
import { nodeTypes } from './symbols.tsx'
import { type Tool, ToolbarItems } from './toolbar.tsx'
import { lengthFromDrawn, wireResistance } from './wire-length.ts'
import { worldToFlow } from './world-to-flow.ts'

const CURRENT = '#7ab8ff' // a live wire carrying current (solved)
const IDLE = '#555' // a tap / no-current wire
const DRAWN = '#8a93a0' // a user-drawn wire, not yet solved

type NodePosition = { x: number; y: number }
type EdgeDescriptor = {
  kind: 'wire' | 'net'
  ref: string
  sourceOnPositiveSide: boolean
  source: string
  target: string
}

/**
 * Physics-derived React Flow edge fields for one wire: the current arrow +
 * magnitude (from the solver) and the length + resistance (from how it is drawn).
 * Shared by the first build and every re-solve, so a drag refreshes the wire's
 * numbers. kind/ref/sourceOnPositiveSide ride in `data` so a re-solve can
 * recompute a wire without the original World→Flow edge.
 */
function edgePhysics(
  edge: EdgeDescriptor,
  world: World,
  solution: Solution,
  positions: Map<string, NodePosition>,
) {
  const wireCurrent =
    edge.kind === 'wire'
      ? wireFlow(solution, edge.ref, edge.sourceOnPositiveSide)
      : edgeFlow(world, solution, edge.ref, edge.source, edge.target)
  const from = positions.get(edge.source)
  const to = positions.get(edge.target)
  const drawnPixels = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0
  const lengthM = lengthFromDrawn(drawnPixels)
  const ohms = wireResistance(lengthM)
  const marker = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: CURRENT }
  const arrowAtTarget = wireCurrent.carries && wireCurrent.sourceToTarget
  const arrowAtSource = wireCurrent.carries && !wireCurrent.sourceToTarget
  return {
    data: {
      amps: wireCurrent.carries ? wireCurrent.amps : null,
      lengthM,
      ohms,
      kind: edge.kind,
      ref: edge.ref,
      sourceOnPositiveSide: edge.sourceOnPositiveSide,
    },
    style: {
      stroke: wireCurrent.carries ? CURRENT : IDLE,
      strokeWidth: wireCurrent.carries ? 1.6 : 1,
    },
    // Omit (not undefined) when absent — exactOptionalPropertyTypes.
    ...(arrowAtTarget ? { markerEnd: marker } : {}),
    ...(arrowAtSource ? { markerStart: marker } : {}),
  }
}

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
      data: { definition: n.data.definition, label: n.id, parameters: n.data.parameters },
    }))
    const positions = new Map(flow.nodes.map((n) => [n.id, n.position]))
    const edges: Edge[] = flow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'net',
      // A wire is a connection, not a deletable block — the user reconnects its
      // endpoints instead (wire-as-connector model).
      deletable: false,
      label: e.showLabel ? e.label : undefined,
      ...edgePhysics(
        {
          kind: e.kind,
          ref: e.ref,
          sourceOnPositiveSide: e.sourceOnPositiveSide,
          source: e.source,
          target: e.target,
        },
        world,
        solution,
        positions,
      ),
    }))
    return { world, nodes, edges }
  }, [])

  // Live React Flow state — nodes are draggable (S19-v3-3); setNodes/setEdges
  // also let the palette drop new parts and the user draw new wires.
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const { screenToFlowPosition } = useReactFlow()
  const dropCount = useRef(0)

  // Movable menus (S19-v3-10): each docks to a window edge; the user drags them.
  const [paletteEdge, setPaletteEdge] = useState<DockEdge>('left')
  const [toolbarEdge, setToolbarEdge] = useState<DockEdge>('top')
  // Active tool: 'select' (move parts) or 'wire' (parts locked; drag draws wires).
  const [tool, setTool] = useState<Tool>('select')
  // Active physics (S19-v3-14): re-solve + refresh every wire's current/length/
  // resistance from the live canvas. Always-on recomputes on every change (the
  // default); turn it off and hit Solve to batch big edits without the PC
  // recomputing on every small move.
  const [alwaysOn, setAlwaysOn] = useState(true)
  const world = initial.world

  const resolve = useCallback(
    (nodeList: Node[], edgeList: Edge[]): Edge[] => {
      const solution = solveDC(world)
      const positions = new Map<string, NodePosition>(nodeList.map((n) => [n.id, n.position]))
      return edgeList.map((edge) => {
        const d = edge.data
        if (!d || typeof d.kind !== 'string') return edge // user-drawn wire — no physics yet
        const physics = edgePhysics(
          {
            kind: d.kind === 'wire' ? 'wire' : 'net',
            ref: String(d.ref),
            sourceOnPositiveSide: Boolean(d.sourceOnPositiveSide),
            source: edge.source,
            target: edge.target,
          },
          world,
          solution,
          positions,
        )
        // Preserve any manual routing (waypoints) across a re-solve.
        const waypoints = Array.isArray(d.waypoints) ? d.waypoints : undefined
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null,
          type: 'net',
          deletable: false,
          label: edge.label,
          ...physics,
          data: { ...physics.data, ...(waypoints ? { waypoints } : {}) },
        }
      })
    },
    [world],
  )

  const handleSolve = useCallback(() => {
    setEdges((current) => resolve(nodes, current))
  }, [resolve, nodes, setEdges])

  // Always-on: recompute whenever the nodes change (drag / place). setEdges(prev)
  // preserves user-drawn wires; deps exclude `edges` so this never loops.
  useEffect(() => {
    if (!alwaysOn) return
    setEdges((current) => resolve(nodes, current))
  }, [alwaysOn, nodes, resolve, setEdges])

  // Press R to rotate the selected component(s) by 90° (S19-v3-15). DeviceNode
  // re-measures its handles so wires follow the rotated terminals.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'r' && event.key !== 'R') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      setNodes((current) =>
        current.map((node) =>
          node.selected
            ? {
                ...node,
                data: {
                  ...node.data,
                  rotation: (((node.data?.rotation as number) ?? 0) + 90) % 360,
                },
              }
            : node,
        ),
      )
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setNodes])

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
      // A dropped part gets real, cited default values (S19-v3-20) so it is a
      // real part, not an empty symbol — editable, and read by the solver.
      setNodes((current) =>
        current.concat({
          id,
          type: 'device',
          position,
          data: { definition, label: id, parameters: defaultParameters(definition) },
        }),
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
    // biome-ignore lint/a11y/noStaticElementInteractions: the dock-grid is the drop target for palette parts; keyboard-accessible placement is future work
    <div
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        display: 'grid',
        // Dock-grid: top/bottom bars span all columns; left/right panels fill the
        // middle row; the canvas takes the center cell. Empty edges collapse, so
        // docked panels never overlap and everything adjusts around them.
        gridTemplateRows: 'auto 1fr auto',
        gridTemplateColumns: 'auto 1fr auto',
        gridTemplateAreas: '"top top top" "left center right" "bottom bottom bottom"',
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        style={{
          gridArea: 'center',
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={tool === 'select'}
          connectionMode={ConnectionMode.Loose}
          zoomOnDoubleClick={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#333" gap={16} />
          <Controls />
        </ReactFlow>

        <div
          style={{
            position: 'absolute',
            bottom: 8,
            right: 12,
            zIndex: 10,
            color: '#667',
            fontSize: 11,
            fontFamily: 'system-ui, sans-serif',
            pointerEvents: 'none',
          }}
        >
          ChipBlocks — {nodes.length} components, {edges.length} wires · select a part, R to rotate
          {tool === 'wire' ? ' · wire tool: parts locked, drag between dots' : ''}
          {alwaysOn ? '' : ' · physics paused — hit Solve'}
        </div>
      </div>

      <DockablePanel edge={paletteEdge} onEdgeChange={setPaletteEdge} title="Parts">
        <PaletteItems />
      </DockablePanel>
      <DockablePanel edge={toolbarEdge} onEdgeChange={setToolbarEdge} title="Tools">
        <ToolbarItems
          tool={tool}
          onTool={setTool}
          alwaysOn={alwaysOn}
          onAlwaysOn={setAlwaysOn}
          onSolve={handleSolve}
        />
      </DockablePanel>
    </div>
  )
}
