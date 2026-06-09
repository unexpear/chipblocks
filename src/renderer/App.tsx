import {
  addEdge,
  Background,
  BackgroundVariant,
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
import {
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { World } from '../cross-fk-validator.ts'
import { type Solution, solveDC } from '../dc-solver.ts'
import { solveTransient, type TransientResult } from '../transient-solver.ts'
import { type CanvasEdge, type CanvasNode, canvasToWorld } from './canvas-to-world.ts'
import { loadCatalogWorld } from './catalog-loader.ts'
import { DockablePanel, type DockEdge } from './dockable-panel.tsx'
import { wireFlow } from './edge-currents.ts'
import { canvasHealth, HealthContext, type NodeHealth } from './health.ts'
import { LensContext, type LensMode } from './lens.ts'
import { materialCapabilities, validMaterialsByRole } from './material-roles.ts'
import { edgeTypes } from './net-edge.tsx'
import { DEFINITION_MIME, PaletteItems } from './palette.tsx'
import { defaultParameters, toggledSwitch } from './part-defaults.ts'
import { PartInspector, type SelectedPart } from './part-inspector.tsx'
import { type PartReading, partReadings } from './part-readings.ts'
import { deriveResistorOhms, resistivityOhmM } from './resistor-derive.ts'
import { ScopePlot, scopeWindow } from './scope.tsx'
import { type DeviceNodeData, nodeTypes } from './symbols.tsx'
import { type Tool, ToolbarItems } from './toolbar.tsx'
import { lengthFromDrawn, wireResistance } from './wire-length.ts'
import { worldToFlow } from './world-to-flow.ts'

// The preload bridge (electron/preload.ts): the native Settings menu pushes
// appearance changes (theme, grid color) into the renderer over IPC.
declare global {
  interface Window {
    chipblocks?: {
      version: string
      onTheme: (callback: (theme: 'light' | 'dark') => void) => void
      onGridColor: (callback: (color: string) => void) => void
      onGridColorCustom: (callback: () => void) => void
    }
  }
}

const CURRENT = '#7ab8ff' // a live wire carrying current (solved)
const IDLE = '#555' // a tap / no-current wire
const DRAWN = '#8a93a0' // a user-drawn wire, not yet solved

type NodePosition = { x: number; y: number }

/** A React Flow node → the canvas node the World builder reads (id + part + values). */
function toCanvasNode(node: Node): CanvasNode {
  const data = node.data as DeviceNodeData
  return {
    id: node.id,
    definition: data.definition,
    ...(data.parameters ? { parameters: data.parameters } : {}),
  }
}

/** A wire's real length + resistance from how it is drawn (pixels → metres → R = ρL/A). */
function drawnWire(
  edge: { source: string; target: string },
  positions: Map<string, NodePosition>,
): { lengthM: number; ohms: number } {
  const from = positions.get(edge.source)
  const to = positions.get(edge.target)
  const drawnPixels = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0
  const lengthM = lengthFromDrawn(drawnPixels)
  return { lengthM, ohms: wireResistance(lengthM) }
}

/**
 * Physics-derived React Flow edge fields for one wire: the current arrow +
 * magnitude, its length + resistance, and the real I·R voltage drop — all read
 * from the wire's OWN solved branch (each canvas wire is now a real `wire_<edgeId>`
 * element in the solve, not an ideal merge), so a long / thin / loaded wire shows
 * a measurable drop.
 */
function edgePhysics(
  edge: Edge,
  world: ReturnType<typeof canvasToWorld>,
  solution: Solution,
  lengthM: number,
  ohms: number,
) {
  const flow = wireFlow(solution, `wire_${edge.id}`, true)
  // The wire's two end potentials, so the on-wire probe can read the interpolated
  // voltage (and accumulated drop) at any point the cursor rides to.
  const wireInst = world.instances.get(`wire_${edge.id}`)
  const netA = wireInst?.connects?.find((c) => c.terminal === 'terminal_a')?.net
  const netB = wireInst?.connects?.find((c) => c.terminal === 'terminal_b')?.net
  const vSource = netA !== undefined ? (solution.nodes.get(netA) ?? null) : null
  const vTarget = netB !== undefined ? (solution.nodes.get(netB) ?? null) : null
  const marker = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: CURRENT }
  const arrowAtTarget = flow.carries && flow.sourceToTarget
  const arrowAtSource = flow.carries && !flow.sourceToTarget
  return {
    data: {
      amps: flow.carries ? flow.amps : null,
      lengthM,
      ohms,
      // Real solved drop across the wire (I·R); null when no current flows.
      drop: flow.carries ? flow.amps * ohms : null,
      vSource,
      vTarget,
    },
    style: {
      stroke: flow.carries ? CURRENT : IDLE,
      strokeWidth: flow.carries ? 1.6 : 1,
    },
    // Omit (not undefined) when absent — exactOptionalPropertyTypes.
    ...(arrowAtTarget ? { markerEnd: marker } : {}),
    ...(arrowAtSource ? { markerStart: marker } : {}),
  }
}

/**
 * Re-solve the canvas from scratch (S19-v3-23, the live re-solve): rebuild the
 * World from the current nodes + wires via `canvasToWorld`, run the DC solver,
 * and return both the refreshed wire currents/length/resistance AND each part's
 * health (lit / overstressed, from the §19 failure-detector). This is what makes
 * a dropped, wired, reconnected, edited, or toggled part change the currents +
 * the success/failure animations — the canvas, not a fixed loaded circuit, is the
 * source of truth. Manual routing (waypoints) is preserved across the re-solve.
 */
function solveCanvas(
  nodeList: Node[],
  edgeList: Edge[],
): { edges: Edge[]; health: Map<string, NodeHealth>; readings: Map<string, PartReading> } {
  const { world, drawn } = canvasWorld(nodeList, edgeList)
  const solution = solveDC(world)
  const edges = edgeList.map((edge) => {
    const wire = drawn.get(edge.id) ?? { lengthM: 0, ohms: 0 }
    const physics = edgePhysics(edge, world, solution, wire.lengthM, wire.ohms)
    const existing = edge.data?.waypoints
    const waypoints = Array.isArray(existing) ? existing : undefined
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      type: 'net',
      deletable: true,
      label: edge.label,
      ...physics,
      data: { ...physics.data, ...(waypoints ? { waypoints } : {}) },
    }
  })
  return { edges, health: canvasHealth(world, solution), readings: partReadings(world, solution) }
}

/**
 * The World for the current canvas (nodes + drawn wires carrying their real
 * resistance), plus each wire's drawn length/resistance for the readouts. Shared
 * by the DC re-solve (solveCanvas) and the Scope's transient run — one source of
 * truth for "what circuit is on the canvas."
 */
function canvasWorld(
  nodeList: Node[],
  edgeList: Edge[],
): { world: World; drawn: Map<string, { lengthM: number; ohms: number }> } {
  const positions = new Map<string, NodePosition>(nodeList.map((n) => [n.id, n.position]))
  // Each wire's real resistance feeds BOTH the solve (so it drops real voltage)
  // and the on-wire readout — computed once here from how the wire is drawn.
  const drawn = new Map<string, { lengthM: number; ohms: number }>(
    edgeList.map((e) => [e.id, drawnWire(e, positions)]),
  )
  const canvasEdges: CanvasEdge[] = edgeList.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    resistanceOhms: drawn.get(e.id)?.ohms ?? 0,
  }))
  return { world: canvasToWorld(nodeList.map(toCanvasNode), canvasEdges), drawn }
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
    const flow = worldToFlow(world)
    const nodes: Node[] = flow.nodes.map((n) => ({
      id: n.id,
      type: 'device',
      position: n.position,
      data: { definition: n.data.definition, label: n.id, parameters: n.data.parameters },
    }))
    // Wires start as bare connections (just the terminals they join); the canvas
    // re-solve fills in current + length + resistance — the same path a later
    // drop/edit takes. A wire is a connection, not a deletable block.
    const baseEdges: Edge[] = flow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'net',
      deletable: false,
      label: e.showLabel ? e.label : undefined,
    }))
    // Catalog material ids for the Properties panel's material dropdown.
    const materials = [...world.definitions.values()]
      .filter((d) => (d as { kind?: string }).kind === 'material')
      .map((d) => d.id)
      .sort()
    // Material id → resistivity (Ω·m), so a resistor can derive R = ρL/A from its
    // material + geometry.
    const materialResistivity = new Map<string, number>()
    for (const def of world.definitions.values()) {
      if ((def as { kind?: string }).kind !== 'material') continue
      const props = (def as { properties?: Record<string, { value?: unknown }> }).properties
      const rho = resistivityOhmM(props?.resistivity?.value)
      if (rho !== null) materialResistivity.set(def.id, rho)
    }
    // Per-device valid materials by role (from composition.requires.must_enable),
    // so each material dropdown offers only materials that satisfy that role.
    const caps = materialCapabilities(world.definitions.values())
    const validMaterialsByDef = new Map<string, Record<string, string[]>>()
    for (const def of world.definitions.values()) {
      validMaterialsByDef.set(def.id, validMaterialsByRole(def, caps))
    }
    const solved = solveCanvas(nodes, baseEdges)
    return {
      nodes,
      edges: solved.edges,
      health: solved.health,
      readings: solved.readings,
      materials,
      materialResistivity,
      validMaterialsByDef,
    }
  }, [])

  // Live React Flow state — nodes are draggable (S19-v3-3); setNodes/setEdges
  // also let the palette drop new parts and the user draw new wires.
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  // Per-part health (lit / overstressed) — drives the success/failure animations.
  const [health, setHealth] = useState(initial.health)
  const [readings, setReadings] = useState(initial.readings)
  // Latest edges for the re-solve effect WITHOUT depending on edge data (a re-solve
  // rewrites edge data, which would loop); structural edits trigger it via
  // `topology`, node moves via `nodes`.
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const { screenToFlowPosition } = useReactFlow()
  const dropCount = useRef(0)

  // Movable menus (S19-v3-10): each docks to a window edge; the user drags them.
  const [paletteEdge, setPaletteEdge] = useState<DockEdge>('left')
  const [toolbarEdge, setToolbarEdge] = useState<DockEdge>('top')
  const [propsEdge, setPropsEdge] = useState<DockEdge>('right')
  // Active tool: 'select' (move parts) or 'wire' (parts locked; drag draws wires).
  const [tool, setTool] = useState<Tool>('select')
  // Active physics (S19-v3-14): re-solve + refresh every wire's current/length/
  // resistance from the live canvas. Always-on recomputes on every change (the
  // default); turn it off and hit Solve to batch big edits without the PC
  // recomputing on every small move.
  const [alwaysOn, setAlwaysOn] = useState(true)
  // Appearance (S19-v3-37/38): light/dark theme + grid-line color, driven by the
  // native Settings menu over IPC; the menu's Custom… opens an in-canvas picker.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [gridColor, setGridColor] = useState('#31363f')
  const [showGridColorPicker, setShowGridColorPicker] = useState(false)
  const light = theme === 'light'
  // The native Settings menu (electron/main.ts) pushes appearance over IPC.
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge === undefined) return
    bridge.onTheme((next) => setTheme(next))
    bridge.onGridColor((next) => setGridColor(next))
    bridge.onGridColorCustom(() => setShowGridColorPicker(true))
  }, [])

  // The live re-solve: rebuild + solve the canvas, then push the new wire currents
  // AND the new part health. Stable identity (only setters in deps).
  const reSolve = useCallback(
    (nodeList: Node[], edgeList: Edge[]) => {
      const solved = solveCanvas(nodeList, edgeList)
      setEdges(solved.edges)
      setHealth(solved.health)
      setReadings(solved.readings)
    },
    [setEdges],
  )

  const handleSolve = useCallback(() => reSolve(nodes, edges), [reSolve, nodes, edges])

  // Scope (time-domain view): run the canvas circuit through solveTransient over
  // an auto-picked window and show every node voltage as a waveform.
  const [scopeResult, setScopeResult] = useState<TransientResult | null>(null)
  const [scopeEdge, setScopeEdge] = useState<DockEdge>('bottom')

  // Lenses (S19-v3-50): overlay the solved physics on the schematic. The context
  // carries the solved voltage range (for the wire color ramp) + each part's real
  // dissipated watts (for the heat halos) down to the edges/nodes.
  const [lens, setLens] = useState<LensMode>('none')
  const [flow, setFlow] = useState(false)
  const lensState = useMemo(() => {
    let vMin = Number.POSITIVE_INFINITY
    let vMax = Number.NEGATIVE_INFINITY
    for (const e of edges) {
      for (const v of [e.data?.vSource, e.data?.vTarget]) {
        if (typeof v === 'number') {
          if (v < vMin) vMin = v
          if (v > vMax) vMax = v
        }
      }
    }
    if (!(vMax >= vMin)) {
      vMin = 0
      vMax = 0
    }
    const power = new Map<string, number>()
    let pMax = 0
    for (const [id, r] of readings) {
      if (typeof r.power === 'number' && r.power > 0) {
        power.set(id, r.power)
        if (r.power > pMax) pMax = r.power
      }
    }
    return { lens, flow, vMin, vMax, power, pMax }
  }, [edges, readings, lens, flow])
  const runScope = useCallback(() => {
    const { world } = canvasWorld(nodes, edges)
    setScopeResult(solveTransient(world, scopeWindow(world)))
  }, [nodes, edges])

  // A structural signature of the wiring — changes when a wire is added, removed,
  // or reconnected, but NOT when only its solved data (current/length) updates. So
  // the always-on effect re-solves on real topology edits without looping (a
  // re-solve preserves source/target/handles, so this string stays equal).
  const topology = useMemo(
    () =>
      edges
        .map((e) => `${e.source}:${e.sourceHandle ?? ''}>${e.target}:${e.targetHandle ?? ''}`)
        .sort()
        .join('|'),
    [edges],
  )

  // Always-on: re-solve whenever a part moves/drops/rotates (nodes) or the wiring
  // changes (topology) — including a delete. setEdges(prev) preserves manual
  // routing; keying on structure not data means a re-solve never retriggers itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `topology` is an intentional re-run trigger — re-solve when the wiring changes (add/remove/reconnect); it isn't read in the body
  useEffect(() => {
    if (!alwaysOn) return
    reSolve(nodes, edgesRef.current)
  }, [alwaysOn, nodes, topology, reSolve])

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

  // Draw a wire between two terminals → a new edge. The topology effect re-solves
  // it (current/length/resistance) when physics is on; otherwise it stays grey
  // (DRAWN) until Solve. Deletable: select it + Delete to remove.
  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((current) =>
        addEdge({ ...connection, type: 'net', deletable: true, style: { stroke: DRAWN } }, current),
      ),
    [setEdges],
  )

  // Reconnect: drag a wire's endpoint to a different dot. Dropping in empty space
  // does nothing, so a wire is never lost this way — removal is explicit (select +
  // Delete). The topology effect re-solves once the endpoint lands.
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) =>
      setEdges((current) => reconnectEdge(oldEdge, newConnection, current)),
    [setEdges],
  )

  // Double-click a switch to flip it open/closed — operate it and watch the
  // circuit respond. The state lives in the node's parameters, so this nodes
  // change triggers the always-on re-solve (open switch → broken loop → no
  // current). Other parts ignore the double-click.
  const onNodeDoubleClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => {
      if ((node.data as DeviceNodeData).definition !== 'switch_spst_toggle') return
      setNodes((current) =>
        current.map((n) =>
          n.id === node.id
            ? {
                ...n,
                data: {
                  ...n.data,
                  parameters: toggledSwitch((n.data as DeviceNodeData).parameters),
                },
              }
            : n,
        ),
      )
    },
    [setNodes],
  )

  // Edit a part's scalar value (resistance, voltage, ...) → live re-solve. The
  // value lives in the node's parameters, so updating it triggers the always-on
  // re-solve, exactly like the switch toggle.
  const onEditParam = useCallback(
    (nodeId: string, key: string, amount: number) => {
      setNodes((current) =>
        current.map((n) => {
          if (n.id !== nodeId) return n
          const params = (n.data as DeviceNodeData).parameters ?? {}
          const value = params[key]?.value
          if (
            typeof value !== 'object' ||
            value === null ||
            (value as { kind?: unknown }).kind !== 'scalar'
          ) {
            return n
          }
          const scalar = value as { kind: string; amount: number; unit: string }
          return {
            ...n,
            data: { ...n.data, parameters: { ...params, [key]: { value: { ...scalar, amount } } } },
          }
        }),
      )
    },
    [setNodes],
  )

  // Edit a part's enum value (a switch's open/closed state) → live re-solve.
  const onEditEnum = useCallback(
    (nodeId: string, key: string, value: string) => {
      setNodes((current) =>
        current.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  parameters: { ...(n.data as DeviceNodeData).parameters, [key]: { value } },
                },
              }
            : n,
        ),
      )
    },
    [setNodes],
  )

  // The selected part feeds the Properties inspector (single selection).
  const selectedNode = nodes.find((n) => n.selected)
  const selectedPart: SelectedPart | null = selectedNode
    ? {
        id: selectedNode.id,
        definition: (selectedNode.data as DeviceNodeData).definition,
        parameters: (selectedNode.data as DeviceNodeData).parameters,
      }
    : null

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the dock-grid is the drop target for palette parts; keyboard-accessible placement is future work
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: light ? '#eef0f3' : '#0c0c0e',
        overflow: 'hidden',
        display: 'grid',
        // Dock-grid: top/bottom bars span all columns; left/right panels fill the
        // middle row; the canvas takes the center cell. Empty edges collapse, so
        // docked panels never overlap and everything adjusts around them.
        gridTemplateRows: 'auto minmax(0, 1fr) auto',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
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
        <HealthContext.Provider value={health}>
          <LensContext.Provider value={lensState}>
            <ReactFlow
              colorMode={theme}
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={onReconnect}
              onNodeDoubleClick={onNodeDoubleClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable={tool === 'select'}
              connectionMode={ConnectionMode.Loose}
              deleteKeyCode={['Delete', 'Backspace']}
              zoomOnDoubleClick={false}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              {/* Graph-paper grid: fine minor lines, with a bolder major line every 5th. */}
              <Background
                id="grid-minor"
                variant={BackgroundVariant.Lines}
                gap={4}
                lineWidth={0.5}
                color={`${gridColor}55`}
              />
              <Background
                id="grid-major"
                variant={BackgroundVariant.Lines}
                gap={20}
                lineWidth={1}
                color={gridColor}
              />
              <Controls />
            </ReactFlow>
          </LensContext.Provider>
        </HealthContext.Provider>

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
          ChipBlocks — {nodes.length} components, {edges.length} wires · select a part to edit it, R
          to rotate, Delete to remove, double-click a switch to flip
          {tool === 'wire' ? ' · wire tool: parts locked, drag between dots' : ''}
          {alwaysOn ? '' : ' · physics paused — hit Solve'}
        </div>

        {/* Grid color · Custom… (Settings menu) → an in-canvas full color picker. */}
        {showGridColorPicker ? (
          <div
            className="nodrag"
            style={{
              position: 'absolute',
              top: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 40,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              background: light ? '#e8eaed' : '#141417',
              border: light ? '1px solid #c4c8ce' : '1px solid #2a2a2f',
              borderRadius: 6,
              boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
              fontFamily: 'system-ui, sans-serif',
              fontSize: 11,
              color: light ? '#444' : '#aab',
            }}
          >
            Grid color
            <input
              type="color"
              value={gridColor}
              onChange={(e) => setGridColor(e.target.value)}
              className="nodrag"
              style={{
                width: 28,
                height: 22,
                padding: 0,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
              }}
            />
            <button
              type="button"
              onClick={() => setShowGridColorPicker(false)}
              className="nodrag"
              style={{
                background: 'none',
                border: light ? '1px solid #c4c8ce' : '1px solid #3a3a3f',
                color: light ? '#444' : '#9fb0c0',
                borderRadius: 3,
                padding: '2px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        ) : null}
      </div>

      <DockablePanel edge={paletteEdge} onEdgeChange={setPaletteEdge} light={light} title="Parts">
        <PaletteItems />
      </DockablePanel>
      <DockablePanel edge={toolbarEdge} onEdgeChange={setToolbarEdge} light={light} title="Tools">
        <ToolbarItems
          tool={tool}
          onTool={setTool}
          alwaysOn={alwaysOn}
          onAlwaysOn={setAlwaysOn}
          onSolve={handleSolve}
          onScope={runScope}
          lens={lens}
          onLens={setLens}
          flow={flow}
          onFlow={setFlow}
        />
      </DockablePanel>
      <DockablePanel edge={propsEdge} onEdgeChange={setPropsEdge} light={light} title="Properties">
        <PartInspector
          selected={selectedPart}
          reading={selectedPart ? readings.get(selectedPart.id) : undefined}
          materials={initial.materials}
          validMaterials={
            selectedPart ? (initial.validMaterialsByDef.get(selectedPart.definition) ?? {}) : {}
          }
          onParam={(key, amount) => {
            if (selectedPart) onEditParam(selectedPart.id, key, amount)
          }}
          onEnum={(key, value) => {
            if (selectedPart) onEditEnum(selectedPart.id, key, value)
          }}
          onMaterial={(key, value) => {
            if (selectedPart) onEditEnum(selectedPart.id, key, value)
          }}
          onDeriveResistance={() => {
            if (!selectedPart) return
            if (selectedPart.definition !== 'resistor') return
            const ohms = deriveResistorOhms(selectedPart.parameters, initial.materialResistivity)
            if (ohms !== null) onEditParam(selectedPart.id, 'resistance', ohms)
          }}
        />
      </DockablePanel>
      {scopeResult ? (
        <DockablePanel edge={scopeEdge} onEdgeChange={setScopeEdge} light={light} title="Scope">
          <ScopePlot result={scopeResult} light={light} />
          <button
            type="button"
            onClick={() => setScopeResult(null)}
            className="nodrag"
            style={{
              background: 'none',
              border: light ? '1px solid #c4c8ce' : '1px solid #3a3a3f',
              color: light ? '#444' : '#9fb0c0',
              borderRadius: 3,
              padding: '2px 8px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </DockablePanel>
      ) : null}
    </div>
  )
}
