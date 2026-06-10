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
  useInternalNode,
  useNodesState,
  useReactFlow,
  ViewportPortal,
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
import type { Solution } from '../dc-solver.ts'
import { solveElectroThermal } from '../electro-thermal.ts'
import { solveTransient, type TransientResult } from '../transient-solver.ts'
import {
  type CanvasEdge,
  type CanvasNode,
  canvasToWorld,
  groundedComponent,
} from './canvas-to-world.ts'
import { loadCatalogWorld } from './catalog-loader.ts'
import { deserializeCircuit, maxIdSuffix, serializeCircuit } from './circuit-file.ts'
import { DockablePanel, type DockEdge } from './dockable-panel.tsx'
import { wireFlow } from './edge-currents.ts'
import { canvasHealth, HealthContext, type NodeHealth } from './health.ts'
import { DEFAULT_KEYBINDS, eventMatchesBinding, type Keybinds, mergeKeybinds } from './keybinds.ts'
import { FIELD_COLOR, fieldReferenceTesla, LensContext, type LensMode } from './lens.ts'
import { materialCapabilities, validMaterialsByRole } from './material-roles.ts'
import { MathPanel } from './math-panel.tsx'
import { buildMathView } from './math-view.ts'
import {
  acVoltsRms,
  CONTINUITY_OHMS,
  capacitanceTest,
  diodeTest,
  equivalentResistance,
  MeterProbes,
  type ProbeRef,
  terminalNets,
  terminalVoltages,
} from './meter.tsx'
import { edgeTypes } from './net-edge.tsx'
import { DEFINITION_MIME, PaletteItems } from './palette.tsx'
import { defaultParameters, toggledSwitch } from './part-defaults.ts'
import { PartInspector, type SelectedPart } from './part-inspector.tsx'
import { type PartReading, partReadings } from './part-readings.ts'
import { deriveResistorOhms, resistivityOhmM } from './resistor-derive.ts'
import { ScopePlot, scopeWindow } from './scope.tsx'
import { ShortcutsPanel } from './shortcuts-panel.tsx'
import { type DeviceNodeData, nodeTypes } from './symbols.tsx'
import { type Tool, ToolbarItems } from './toolbar.tsx'
import { formatEng } from './units.ts'
import { lengthFromDrawn, wireResistance } from './wire-length.ts'
import { type PathPoint, polylineLength, roundedPathD, roundedPathLength } from './wire-path.ts'
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
      onSaveRequest: (callback: () => void) => void
      saveCircuitData: (text: string) => Promise<{ ok: boolean; path?: string }>
      onCircuitOpened: (callback: (text: string) => void) => void
      getKeybinds?: () => Promise<Record<string, string>>
      setKeybinds?: (binds: Record<string, string>) => Promise<Record<string, string>>
      onShortcutsOpen?: (callback: () => void) => void
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

/**
 * A wire's real length + resistance from how it is drawn (pixels → metres →
 * R = ρL/A). A hand-routed wire is measured along its ACTUAL path — straight
 * segments through the corners, or the rounded route when drawn with the curve
 * subtool (same geometry the renderer draws, from wire-path.ts) — so routing
 * is physically real: a longer route is more ohms, more drop, more heat. An
 * un-routed wire keeps the straight-line seed it always had.
 */
function drawnWire(
  edge: { source: string; target: string; data?: { waypoints?: unknown; curved?: unknown } },
  positions: Map<string, NodePosition>,
): { lengthM: number; ohms: number } {
  const from = positions.get(edge.source)
  const to = positions.get(edge.target)
  let drawnPixels = 0
  if (from && to) {
    const waypoints = Array.isArray(edge.data?.waypoints)
      ? (edge.data.waypoints as PathPoint[])
      : []
    if (waypoints.length > 0) {
      const points = [from, ...waypoints, to]
      drawnPixels = edge.data?.curved === true ? roundedPathLength(points) : polylineLength(points)
    } else {
      drawnPixels = Math.hypot(to.x - from.x, to.y - from.y)
    }
  }
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
 * The wire-in-progress (click-by-click drawing): a dashed route from the start
 * anchor (a terminal dot, or a free point in space) through the clicked
 * corners to the cursor — sharp or rounded to match the active subtool. Pinned
 * in flow coordinates so it pans/zooms with the canvas.
 */
function PendingWirePreview({
  pending,
  cursor,
  curved,
}: {
  pending: {
    start: { nodeId: string; handleId: string } | { x: number; y: number }
    corners: { id: string; x: number; y: number }[]
  }
  cursor: { x: number; y: number } | null
  curved: boolean
}) {
  const start = pending.start
  const anchoredToNode = 'nodeId' in start
  const node = useInternalNode(anchoredToNode ? start.nodeId : '__free_point__')
  let origin: { x: number; y: number } | null = null
  if (anchoredToNode) {
    const handle = node?.internals.handleBounds?.source?.find((h) => h.id === start.handleId)
    if (node && handle) {
      origin = {
        x: node.internals.positionAbsolute.x + handle.x + handle.width / 2,
        y: node.internals.positionAbsolute.y + handle.y + handle.height / 2,
      }
    }
  } else {
    origin = start
  }
  if (origin === null) return null
  const points = [origin, ...pending.corners, ...(cursor !== null ? [cursor] : [])]
  const path = curved
    ? roundedPathD(points)
    : points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
  return (
    <ViewportPortal>
      <svg
        width={1}
        height={1}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        <path d={path} fill="none" stroke={DRAWN} strokeWidth={1.6} strokeDasharray="6 4" />
        {pending.corners.map((c) => (
          <circle key={c.id} cx={c.x} cy={c.y} r={3.5} fill="#7ab8ff" stroke="#0c0c0e" />
        ))}
        <circle cx={origin.x} cy={origin.y} r={4} fill="none" stroke="#7ab8ff" strokeWidth={1.5} />
      </svg>
    </ViewportPortal>
  )
}

/** The meter chip's V⎓ / Ω dial buttons — the mode switch on a real meter. */
function meterDialStyle(active: boolean, light: boolean): React.CSSProperties {
  return {
    padding: '2px 7px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'system-ui, sans-serif',
    background: active ? '#24405f' : light ? '#f4f5f7' : '#1b1b1f',
    border: active ? '1px solid #7ab8ff' : light ? '1px solid #c4c8ce' : '1px solid #2a2a2f',
    color: active ? '#dde4ec' : light ? '#555' : '#9aa3ad',
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
): {
  edges: Edge[]
  health: Map<string, NodeHealth>
  readings: Map<string, PartReading>
  terminalVolts: Map<string, number>
  world: World
  solution: Solution
} {
  const { world, drawn } = canvasWorld(nodeList, edgeList)
  // Electro-thermal solve (stage 7): the electrical answer at the settled part
  // temperatures — hot parts drift, warm junctions drop, all fed back until the
  // fixed point. Readings/health recompute temperatures from this solution and
  // land on the same numbers (it IS the fixed point). Only the ground-connected
  // component is solved: a free-floating section's voltages are genuinely
  // undefined (and would be a singular matrix) — it sits idle instead of
  // killing the whole canvas. The meter still gets the FULL world.
  const solution = solveElectroThermal(groundedComponent(world)).solution
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
  return {
    edges,
    health: canvasHealth(world, solution),
    readings: partReadings(world, solution),
    // Every wired terminal's live voltage — what the multimeter probes read.
    terminalVolts: terminalVoltages(world, solution),
    // The solved circuit itself — the meter's Ω mode re-solves it powered-off,
    // and the Math panel shows the equations behind this exact solution.
    world,
    solution,
  }
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
      terminalVolts: solved.terminalVolts,
      world: solved.world,
      solution: solved.solution,
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
  const [terminalVolts, setTerminalVolts] = useState(initial.terminalVolts)
  // The latest solved World — Ω mode re-solves it powered-off between the probes.
  const [solvedWorld, setSolvedWorld] = useState(initial.world)
  // The latest Solution — the Math panel derives its equations from it.
  const [solution, setSolution] = useState(initial.solution)
  // Latest edges for the re-solve effect WITHOUT depending on edge data (a re-solve
  // rewrites edge data, which would loop); structural edits trigger it via
  // `topology`, node moves via `nodes`.
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const { screenToFlowPosition, fitView, deleteElements } = useReactFlow()
  const dropCount = useRef(0)

  // Save / Load (S19-v3-52). Save: the File menu asks, we answer with the
  // serialized circuit (parts + values + wires — never solved data). Re-registers
  // on every change so the answer always reflects the current canvas.
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.onSaveRequest === undefined) return
    bridge.onSaveRequest(() => {
      const file = serializeCircuit(
        nodes.map((n) => ({ id: n.id, position: n.position, data: n.data as DeviceNodeData })),
        edges,
      )
      void bridge.saveCircuitData(JSON.stringify(file, null, 2))
    })
  }, [nodes, edges])

  // Load: the main process already validated the file; rebuild the canvas from
  // it, resume the drop counter above the loaded ids, and re-fit the view. The
  // always-on physics effect re-solves the loaded circuit automatically.
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.onCircuitOpened === undefined) return
    bridge.onCircuitOpened((text) => {
      const result = deserializeCircuit(text)
      if (!result.ok) return // main validates first; this is belt-and-braces
      setNodes(
        result.file.nodes.map((n) => ({
          id: n.id,
          type: n.definition === 'junction' ? 'junction' : 'device',
          position: { x: n.x, y: n.y },
          data: {
            definition: n.definition,
            label: n.id,
            ...(n.rotation ? { rotation: n.rotation } : {}),
            ...(n.parameters ? { parameters: n.parameters } : {}),
          },
        })),
      )
      setEdges(
        result.file.wires.map((w) => ({
          id: w.id,
          source: w.source,
          sourceHandle: w.sourceHandle,
          target: w.target,
          targetHandle: w.targetHandle,
          type: 'net',
          deletable: true,
          style: { stroke: DRAWN },
          ...(w.waypoints || w.curved
            ? {
                data: {
                  ...(w.waypoints ? { waypoints: w.waypoints } : {}),
                  ...(w.curved ? { curved: true } : {}),
                },
              }
            : {}),
        })),
      )
      dropCount.current = maxIdSuffix(result.file.nodes)
      window.setTimeout(() => fitView({ padding: 0.15 }), 80)
    })
  }, [setNodes, setEdges, fitView])

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
      setTerminalVolts(solved.terminalVolts)
      setSolvedWorld(solved.world)
      setSolution(solved.solution)
    },
    [setEdges],
  )

  const handleSolve = useCallback(() => reSolve(nodes, edges), [reSolve, nodes, edges])

  // Scope (time-domain view): run the canvas circuit through solveTransient over
  // an auto-picked window and show every node voltage as a waveform.
  const [scopeResult, setScopeResult] = useState<TransientResult | null>(null)
  const [scopeEdge, setScopeEdge] = useState<DockEdge>('bottom')

  // Math panel (S19-v3-63): the equations behind the current solution, derived
  // live from the same solved state the canvas shows.
  const [showMath, setShowMath] = useState(false)
  const mathView = useMemo(
    () => (showMath ? buildMathView(solvedWorld, solution) : null),
    [showMath, solvedWorld, solution],
  )

  // Lenses (S19-v3-50): overlay the solved physics on the schematic. The context
  // carries the solved voltage range (for the wire color ramp) + each part's real
  // dissipated watts (for the heat halos) down to the edges/nodes.
  const [lens, setLens] = useState<LensMode>('none')
  const [flow, setFlow] = useState(false)
  const lensState = useMemo(() => {
    let vMin = Number.POSITIVE_INFINITY
    let vMax = Number.NEGATIVE_INFINITY
    let maxAbsAmps = 0
    for (const e of edges) {
      for (const v of [e.data?.vSource, e.data?.vTarget]) {
        if (typeof v === 'number') {
          if (v < vMin) vMin = v
          if (v > vMax) vMax = v
        }
      }
      if (typeof e.data?.amps === 'number' && Math.abs(e.data.amps) > maxAbsAmps) {
        maxAbsAmps = Math.abs(e.data.amps)
      }
    }
    if (!(vMax >= vMin)) {
      vMin = 0
      vMax = 0
    }
    const power = new Map<string, number>()
    let pMax = 0
    const temp = new Map<string, number>()
    let tMaxC = 0
    for (const [id, r] of readings) {
      if (typeof r.power === 'number' && r.power > 0) {
        power.set(id, r.power)
        if (r.power > pMax) pMax = r.power
      }
      if (typeof r.temperatureC === 'number') {
        temp.set(id, r.temperatureC)
        if (r.temperatureC > tMaxC) tMaxC = r.temperatureC
      }
    }
    // Field lens contour level, auto-ranged from the circuit's biggest current.
    const fieldTesla = fieldReferenceTesla(maxAbsAmps)
    return { lens, flow, vMin, vMax, power, pMax, temp, tMaxC, fieldTesla }
  }, [edges, readings, lens, flow])
  const runScope = useCallback(() => {
    const world = groundedComponent(canvasWorld(nodes, edges).world)
    setScopeResult(solveTransient(world, scopeWindow(world)))
  }, [nodes, edges])

  // While the Scope is open it follows the circuit live: any edit (drop, wire,
  // value change, switch flip) re-runs the time simulation — same spirit as the
  // always-on DC re-solve. Closed scope costs nothing.
  const scopeOpen = scopeResult !== null
  useEffect(() => {
    if (scopeOpen) runScope()
  }, [scopeOpen, runScope])

  // Multimeter (S19-v3-53/54): in meter mode, touching terminal dots places the
  // red then the black probe — the readout shows the live value between them per
  // the mode dial: V⎓ (voltage; both probes on one part also reads its current)
  // or Ω (resistance, measured powered-off the real way). Touching a WIRE clamps
  // onto it and reads its current without breaking the circuit — the clamp-meter
  // move. Clicking empty canvas lifts everything; leaving the tool clears it.
  // The dial position survives tool switches, like a real meter left on a setting.
  const [redProbe, setRedProbe] = useState<ProbeRef | undefined>(undefined)
  const [blackProbe, setBlackProbe] = useState<ProbeRef | undefined>(undefined)
  const [meterMode, setMeterMode] = useState<'volts' | 'acvolts' | 'ohms' | 'diode' | 'cap'>(
    'volts',
  )
  // HOLD: freeze the current reading on the display (probe elsewhere, compare),
  // exactly the bench move. Measurement continues underneath, like a real meter.
  const [heldReadout, setHeldReadout] = useState<{
    icon: string
    iconColor: string
    text: string
  } | null>(null)
  const [clampWire, setClampWire] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (tool !== 'meter') {
      setRedProbe(undefined)
      setBlackProbe(undefined)
      setClampWire(undefined)
      setHeldReadout(null)
    }
  }, [tool])
  // If the clamped wire is deleted, the clamp comes off with it.
  useEffect(() => {
    if (clampWire !== undefined && !edges.some((e) => e.id === clampWire)) {
      setClampWire(undefined)
    }
  }, [clampWire, edges])
  const onMeterClick = useCallback(
    (event: ReactMouseEvent) => {
      if (tool !== 'meter') return
      const target = event.target as Element
      if (target.closest?.('.cb-meter-chip') !== null) return
      const handleEl = target.closest?.('.react-flow__handle') as HTMLElement | null
      if (handleEl !== null) {
        const nodeId = handleEl.dataset.nodeid
        const handleId = handleEl.dataset.handleid
        if (nodeId === undefined || handleId === undefined) return
        const probe: ProbeRef = { nodeId, handleId }
        setClampWire(undefined)
        if (redProbe === undefined) setRedProbe(probe)
        else if (blackProbe === undefined) setBlackProbe(probe)
        else {
          setRedProbe(probe)
          setBlackProbe(undefined)
        }
        return
      }
      const edgeEl = target.closest?.('.react-flow__edge')
      if (edgeEl !== null && edgeEl !== undefined) {
        const dataId = edgeEl.getAttribute('data-id')
        const testId = edgeEl.getAttribute('data-testid')
        const wireId = dataId ?? (testId?.startsWith('rf__edge-') ? testId.slice(9) : null)
        if (wireId !== null) {
          setClampWire(wireId)
          setRedProbe(undefined)
          setBlackProbe(undefined)
          return
        }
      }
      setRedProbe(undefined)
      setBlackProbe(undefined)
      setClampWire(undefined)
    },
    [tool, redProbe, blackProbe],
  )
  // Each wired terminal's net — what the Ω probes hand to the powered-off solve.
  const probeNets = useMemo(() => terminalNets(solvedWorld), [solvedWorld])
  // The meter's display — live solved values; unwired points say so. The clamp
  // (when set) wins regardless of the dial: it reads amps, not the dial quantity.
  const meterReadout = useMemo(() => {
    if (tool !== 'meter') return null
    if (clampWire !== undefined) {
      const amps = edges.find((e) => e.id === clampWire)?.data?.amps
      return {
        icon: 'Ⓐ',
        iconColor: '#7ab8ff',
        text:
          typeof amps === 'number'
            ? `Clamp on wire: ${formatEng(amps, 'A')}`
            : 'Clamp on wire: no current flowing',
      }
    }
    const voltsAt = (probe: ProbeRef | undefined) =>
      probe ? terminalVolts.get(`${probe.nodeId}/${probe.handleId}`) : undefined
    // V~ / Ω / ⏵ all read strictly between the two leads — the shared preamble.
    const bothProbeNets = (): { netRed: string; netBlack: string } | string => {
      if (redProbe === undefined) return 'Touch a terminal dot to place the red probe'
      if (blackProbe === undefined) {
        return 'This mode needs both probes — touch another dot for the black probe'
      }
      const netRed = probeNets.get(`${redProbe.nodeId}/${redProbe.handleId}`)
      const netBlack = probeNets.get(`${blackProbe.nodeId}/${blackProbe.handleId}`)
      if (netRed === undefined || netBlack === undefined) {
        return 'One probe is on an unwired dot — no reading'
      }
      return { netRed, netBlack }
    }
    if (meterMode === 'ohms') {
      const ohmsChip = (text: string) => ({ icon: 'Ω', iconColor: '#d6a23c', text })
      const nets = bothProbeNets()
      if (typeof nets === 'string') return ohmsChip(nets)
      const ohms = equivalentResistance(solvedWorld, nets.netRed, nets.netBlack)
      if (ohms === null) return ohmsChip('Resistance: OL — no conductive path (open loop)')
      const continuity = ohms < CONTINUITY_OHMS ? ' · ● continuity' : ''
      return ohmsChip(`Resistance: ${formatEng(ohms, 'Ω')}${continuity}`)
    }
    if (meterMode === 'acvolts') {
      const acChip = (text: string) => ({ icon: '∿', iconColor: '#5a86d8', text })
      const nets = bothProbeNets()
      if (typeof nets === 'string') return acChip(nets)
      const ac = acVoltsRms(solvedWorld, nets.netRed, nets.netBlack)
      if (ac === 'span-too-wide') {
        return acChip('V~: source frequencies are too far apart to resolve in one pass')
      }
      if (ac === null) return acChip("V~ can't run a time pass on this circuit — no reading")
      const hzText = ac.hz !== null ? ` · ${formatEng(ac.hz, 'Hz')}` : ''
      // Sub-µV residue is solver float noise, not signal — floor the display
      // like a real meter's resolution floor instead of printing femtovolts.
      const shownRms = ac.rms < 1e-6 ? 0 : ac.rms
      return acChip(`V~ (red − black): ${formatEng(shownRms, 'V')} rms${hzText}`)
    }
    if (meterMode === 'diode') {
      const diodeChip = (text: string) => ({ icon: '⏵', iconColor: '#6ec06e', text })
      const nets = bothProbeNets()
      if (typeof nets === 'string') return diodeChip(nets)
      const result = diodeTest(solvedWorld, nets.netRed, nets.netBlack)
      if (result === null) {
        return diodeChip(
          'Diode test: OL — no conduction (reversed probes, open junction, or forward voltage above the 3 V test)',
        )
      }
      return diodeChip(
        `Diode test: ${formatEng(result.volts, 'V')} forward at ${formatEng(result.amps, 'A')}`,
      )
    }
    if (meterMode === 'cap') {
      const capChip = (text: string) => ({ icon: '⊣⊢', iconColor: '#a06ad8', text })
      const nets = bothProbeNets()
      if (typeof nets === 'string') return capChip(nets)
      const result = capacitanceTest(solvedWorld, nets.netRed, nets.netBlack)
      if (result.status === 'measured') {
        return capChip(`Capacitance: ${formatEng(result.farads, 'F')}`)
      }
      if (result.status === 'parallel-leak') {
        return capChip(
          "Capacitance: can't measure — a resistive path is in parallel (free one leg of the cap, like a real meter)",
        )
      }
      if (result.status === 'over-range') {
        return capChip('Capacitance: over range — still charging past the 100 s test window')
      }
      if (result.status === 'open') {
        return capChip('Capacitance: under 1 pF — nothing measurable between the probes')
      }
      return capChip("Capacitance test can't run on this circuit")
    }
    const voltChip = (text: string) => ({ icon: 'Ⓥ', iconColor: '#e0594f', text })
    if (redProbe === undefined) return voltChip('Touch a terminal dot to place the red probe')
    const vRed = voltsAt(redProbe)
    if (blackProbe === undefined) {
      return voltChip(
        vRed === undefined
          ? 'Red probe: not wired (no circuit at that dot)'
          : `Red vs ground: ${formatEng(vRed, 'V', { signed: true })} — touch another dot for the black probe`,
      )
    }
    const vBlack = voltsAt(blackProbe)
    if (vRed === undefined || vBlack === undefined) {
      return voltChip('One probe is on an unwired dot — no reading')
    }
    let text = `V (red − black): ${formatEng(vRed - vBlack, 'V', { signed: true })}`
    if (redProbe.nodeId === blackProbe.nodeId && redProbe.handleId !== blackProbe.handleId) {
      const through = readings.get(redProbe.nodeId)?.current
      if (through !== undefined) text += ` · through ${redProbe.nodeId}: ${formatEng(through, 'A')}`
    }
    return voltChip(text)
  }, [
    tool,
    meterMode,
    clampWire,
    edges,
    redProbe,
    blackProbe,
    terminalVolts,
    readings,
    probeNets,
    solvedWorld,
  ])

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

  // Keyboard shortcuts (S19-v3-15 rotate; S19-v3-62 all bindings editable):
  // every canvas key runs through the user's keybinds — rotate, delete (we own
  // deletion so combos work; React Flow's deleteKeyCode is off), and opening
  // the Shortcuts panel. Keys are ignored while typing in a field.
  const [keybinds, setKeybinds] = useState<Keybinds>(DEFAULT_KEYBINDS)
  const [showShortcuts, setShowShortcuts] = useState(false)
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.getKeybinds === undefined) return
    void bridge.getKeybinds().then((saved) => setKeybinds(mergeKeybinds(saved)))
    bridge.onShortcutsOpen?.(() => setShowShortcuts(true))
  }, [])
  // Panel edits apply immediately + persist via the main process (which also
  // re-installs the menu so its accelerators show the new keys). Without the
  // bridge (dev preview) they still apply for the session.
  const applyKeybinds = useCallback((next: Keybinds) => {
    setKeybinds(next)
    void window.chipblocks?.setKeybinds?.(next)
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (showShortcuts) return // the panel owns the keyboard while open
      if (eventMatchesBinding(event, keybinds.shortcutsPanel)) {
        setShowShortcuts(true)
        return
      }
      if (eventMatchesBinding(event, keybinds.rotate)) {
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
        return
      }
      if (
        eventMatchesBinding(event, keybinds.delete) ||
        eventMatchesBinding(event, keybinds.deleteAlt)
      ) {
        void deleteElements({
          nodes: nodes.filter((n) => n.selected),
          edges: edges.filter((e) => e.selected),
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setNodes, keybinds, showShortcuts, nodes, edges, deleteElements])

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

  // Click-by-click wire drawing (S19-v3-60; CAD-style free placement + curves
  // S19-v3-61): in wire mode the canvas works like a CAD line tool — click
  // ANYWHERE to start (a terminal dot, or open space), click to drop corners,
  // then click a terminal dot to finish — or double-click in space to end
  // there. A free start/end becomes a JUNCTION (the schematic tie dot): wires
  // meeting at it are connected; a free end is honestly an open circuit until
  // something reaches it. The Line/Curve subtool picks sharp corners or
  // rounded fillets — the wire's physical length follows whichever shape is
  // drawn. Escape (or re-clicking the start) abandons the wire-in-progress.
  const [wireStyle, setWireStyle] = useState<'line' | 'curve'>('line')
  type WireAnchor = { nodeId: string; handleId: string } | { x: number; y: number }
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
      if (eventMatchesBinding(event, keybinds.cancelWire)) setPendingWire(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingWire, keybinds.cancelWire])
  const finishWire = useCallback(
    (end: WireAnchor, corners: { id: string; x: number; y: number }[]) => {
      if (pendingWire === null) return
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
            style: { stroke: DRAWN },
            data: {
              ...(corners.length > 0 ? { waypoints: corners } : {}),
              ...(wireStyle === 'curve' ? { curved: true } : {}),
            },
          },
          current,
        ),
      )
      setPendingWire(null)
    },
    [pendingWire, wireStyle, setEdges, setNodes],
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
  // re-solve, exactly like the switch toggle. A missing parameter is CREATED
  // only when the caller states its unit (the Source presets do — a loaded
  // pre-AC battery instance has no ac_amplitude/frequency entries to update);
  // without a unit an unknown key is ignored, never invented.
  const onEditParam = useCallback(
    (nodeId: string, key: string, amount: number, unit?: string) => {
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
            if (unit === undefined) return n
            return {
              ...n,
              data: {
                ...n.data,
                parameters: { ...params, [key]: { value: { kind: 'scalar', amount, unit } } },
              },
            }
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
        onClickCapture={(event) => {
          onMeterClick(event)
          onWireClick(event)
        }}
        onDoubleClickCapture={onWireDoubleClick}
        onMouseMove={onWireMove}
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
              nodesConnectable={tool !== 'meter'}
              // Click-to-connect is OUR gesture now (onWireClick, wire tool
              // only, with corner routing); React Flow's built-in one would
              // double-create — and it once let meter probes draw real wires.
              connectOnClick={false}
              connectionMode={ConnectionMode.Loose}
              // Deletion is OUR keybind now (editable, supports combos) — see
              // the keyboard-shortcuts effect above.
              deleteKeyCode={null}
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
              <MeterProbes red={redProbe} black={blackProbe} />
              {pendingWire !== null ? (
                <PendingWirePreview
                  pending={pendingWire}
                  cursor={wireCursor}
                  curved={wireStyle === 'curve'}
                />
              ) : null}
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
          {tool === 'wire'
            ? ' · wire tool: click anywhere to start, click corners, click a dot to finish (double-click in space ends there; Esc cancels)'
            : ''}
          {alwaysOn ? '' : ' · physics paused — hit Solve'}
        </div>

        {/* Multimeter readout — mode dial (V⎓ / Ω) + the live reading. */}
        {meterReadout !== null ? (
          <div
            className="cb-meter-chip"
            style={{
              position: 'absolute',
              top: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 35,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 12px 5px 6px',
              background: light ? '#e8eaed' : '#141417',
              border: light ? '1px solid #c4c8ce' : '1px solid #2a2a2f',
              borderRadius: 6,
              fontFamily: 'system-ui, sans-serif',
              fontSize: 12,
              color: light ? '#333' : '#dde4ec',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ display: 'flex', gap: 3 }}>
              <button
                type="button"
                onClick={() => setMeterMode('volts')}
                title="DC volts — the steady voltage between the probes (both probes on one part also reads its current)"
                style={meterDialStyle(meterMode === 'volts', light)}
              >
                V⎓
              </button>
              <button
                type="button"
                onClick={() => setMeterMode('acvolts')}
                title="AC volts — true-RMS of the changing part of the voltage between the probes, from a real time-domain run. AC-coupled like a real V~ range: steady DC reads ~0. Frequency is counted from the waveform's own zero crossings."
                style={meterDialStyle(meterMode === 'acvolts', light)}
              >
                V~
              </button>
              <button
                type="button"
                onClick={() => setMeterMode('ohms')}
                title="Ohms — resistance between the probes, measured the real powered-off way: source EMFs zeroed (internal resistance stays), small test current, R = V/I. In-circuit readings include parallel paths, just like a real meter. Under 20 Ω shows ● continuity."
                style={meterDialStyle(meterMode === 'ohms', light)}
              >
                Ω
              </button>
              <button
                type="button"
                onClick={() => setMeterMode('diode')}
                title="Diode test — pushes a small real test current (3 V behind 2 kΩ, circuit powered off) from red to black and reads the junction's forward voltage drop. OL = no conduction: reversed probes, open junction, or an LED above the 3 V test (blue/UV)."
                style={meterDialStyle(meterMode === 'diode', light)}
              >
                ⏵
              </button>
              <button
                type="button"
                onClick={() => setMeterMode('cap')}
                title="Capacitance — charges the powered-off network between the probes with a small known source (0.5 V behind 10 kΩ, below junction turn-on), starting discharged like the real procedure, and counts the actual charge: C = Q/V. Autoranges its window like a real meter. A resistive parallel path makes the reading impossible — real meters refuse too: free one leg first."
                style={meterDialStyle(meterMode === 'cap', light)}
              >
                ⊣⊢
              </button>
            </span>
            {(() => {
              const shown = heldReadout ?? meterReadout
              return (
                <>
                  <span aria-hidden style={{ color: shown.iconColor, fontWeight: 700 }}>
                    {shown.icon}
                  </span>
                  {shown.text}
                </>
              )
            })()}
            <button
              type="button"
              onClick={() => setHeldReadout(heldReadout === null ? meterReadout : null)}
              title="HOLD — freeze this reading on the display so you can probe somewhere else and compare. The measurement keeps running underneath, like a real meter."
              style={{
                ...meterDialStyle(heldReadout !== null, light),
                marginLeft: 2,
                fontSize: 9,
                letterSpacing: 0.5,
              }}
            >
              HOLD
            </button>
          </div>
        ) : null}

        {/* Math panel — the equations behind the current solution. */}
        {mathView !== null ? (
          <MathPanel view={mathView} onClose={() => setShowMath(false)} light={light} />
        ) : null}

        {/* Shortcuts panel — every key and control, viewable and editable. */}
        {showShortcuts ? (
          <ShortcutsPanel
            binds={keybinds}
            onChange={applyKeybinds}
            onClose={() => setShowShortcuts(false)}
            light={light}
          />
        ) : null}

        {/* Field-lens legend — the true contour levels behind the bands. */}
        {lens === 'field' ? (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 35,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 12px',
              background: light ? '#e8eaed' : '#141417',
              border: light ? '1px solid #c4c8ce' : '1px solid #2a2a2f',
              borderRadius: 6,
              fontFamily: 'system-ui, sans-serif',
              fontSize: 11,
              color: light ? '#333' : '#cdd6e0',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden style={{ color: FIELD_COLOR, fontWeight: 700 }}>
              ◎
            </span>
            {lensState.fieldTesla > 0
              ? `B = μ₀I/2πr · band edges ${formatEng(lensState.fieldTesla, 'T')} / ${formatEng(
                  3 * lensState.fieldTesla,
                  'T',
                )} / ${formatEng(10 * lensState.fieldTesla, 'T')} (innermost) · Earth ≈ 25–65 µT`
              : 'no current flowing — no magnetic field to draw'}
          </div>
        ) : null}

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
          wireStyle={wireStyle}
          onWireStyle={setWireStyle}
          alwaysOn={alwaysOn}
          onAlwaysOn={setAlwaysOn}
          onSolve={handleSolve}
          onScope={runScope}
          onMath={() => setShowMath((open) => !open)}
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
          onParam={(key, amount, unit) => {
            if (selectedPart) onEditParam(selectedPart.id, key, amount, unit)
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
