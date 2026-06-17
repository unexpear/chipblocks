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
  SelectionMode,
  useEdgesState,
  useInternalNode,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  ViewportPortal,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './interactions.css'
import {
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Instance, World } from '../cross-fk-validator.ts'
import type { Solution } from '../dc-solver.ts'
import { solveTransientThermal } from '../electro-thermal.ts'
import { overcurrentFuseIds } from '../failure-detector.ts'
import { readScalarParam } from '../instance-params.ts'
import { LIGHT_SENSOR_DEFINITIONS, type LightSource, worldWithCastLight } from '../light.ts'
import { type RelayState, solveWithRelays } from '../relay.ts'
import type { ShockleyDiodeState } from '../shockley-diode.ts'
import { STANDARD_AMBIENT_C } from '../thermal-model.ts'
import type { TransientResult } from '../transient-solver.ts'
import { BlockViewer } from './block-viewer.tsx'
import {
  type BlockData,
  type CanvasEdgeLike as BlockEdgeLike,
  type CanvasNodeLike as BlockNodeLike,
  blockPortAliases,
  bubbleBlockHealth,
  cloneBlockData,
  flattenBlocks,
  groupSelection,
  ungroupBlock,
} from './blocks.ts'
import { BUILTIN_BLOCKS } from './builtin-blocks.ts'
import { CanvasScrollbars } from './canvas-scrollbars.tsx'
import {
  type CanvasEdge,
  type CanvasNode,
  canvasToWorld,
  groundedComponent,
} from './canvas-to-world.ts'
import { loadCatalogWorld } from './catalog-loader.ts'
import { deserializeCircuit, maxIdSuffix, serializeCircuit } from './circuit-file.ts'
import {
  type ClipboardItem,
  emptyClipboard,
  latestItem,
  materializeItem,
  snapshotSelection,
  withCopy,
  withCut,
} from './clipboard.ts'
import { ClipboardPanel } from './clipboard-panel.tsx'
import { CoordinateAxes } from './coordinate-axes.tsx'
import { DockablePanel, type TabDropTarget } from './dockable-panel.tsx'
import { wireFlow } from './edge-currents.ts'
import { canvasHealth, HealthContext, type NodeHealth } from './health.ts'
import { DEFAULT_KEYBINDS, eventMatchesBinding, type Keybinds, mergeKeybinds } from './keybinds.ts'
import {
  edgeIdsTouchingRegion,
  type LassoPoint,
  lassoPathD,
  MIN_POINT_SPACING_PX,
  nodeCenter,
  nodeIdsInLasso,
  pointInPolygon,
} from './lasso.ts'
import { FIELD_COLOR, fieldReferenceTesla, LensContext, type LensMode } from './lens.ts'
import { materialCapabilities, validMaterialsByRole } from './material-roles.ts'
import { MathPanel } from './math-panel.tsx'
import { buildMathView } from './math-view.ts'
import {
  AMMETER_JACKS,
  type AmmeterJack,
  acVoltsRms,
  CONTINUITY_OHMS,
  capacitanceTest,
  dcExtremes,
  diodeTest,
  displayCounts,
  equivalentResistance,
  groundNetOf,
  MeterProbes,
  ProbeMarker,
  type ProbeRef,
  seriesAmmeter,
  terminalNets,
  terminalVoltages,
  voltmeterSolve,
} from './meter.tsx'
import { type MonteCarloResult, monteCarloAnalysis } from './monte-carlo.ts'
import { expandMultiLeadSources, multiLeadAliases } from './multi-tap-source.ts'
import { edgeTypes } from './net-edge.tsx'
import { BLOCK_MIME, DEFINITION_MIME, Palette } from './palette.tsx'
import { moveToEdge, type PanelLayout, panelGroups, stackOnto } from './panel-groups.ts'
import {
  blownFuse,
  defaultParameters,
  fuseIntact,
  relayWithCoilState,
  replacedFuse,
  shockleyDiodeWithState,
  sourceTerminalIds,
  toggledSpdt,
  toggledSwitch,
} from './part-defaults.ts'
import { PartInspector, type SelectedPart } from './part-inspector.tsx'
import { type PartReading, partReadings } from './part-readings.ts'
import { deriveResistorOhms, resistivityOhmM } from './resistor-derive.ts'
import {
  channelsForProbes,
  fastestSourceHz,
  type ScopeChannel,
  ScopePlot,
  type ScopeProbe,
  scopeProbeKey,
  scopeWindow,
  TRACE_COLORS,
} from './scope.tsx'
import { extractXyPath, type FamilyStep, stepValues, withSourceVoltage } from './scope-family.ts'
import { H_DIVISIONS, scopeRecordSteps, slowestHonestTimebase } from './scope-scales.ts'
import { ShortcutsPanel } from './shortcuts-panel.tsx'
import { type DeviceNodeData, nodeTypes } from './symbols.tsx'
import { type Tool, ToolbarItems } from './toolbar.tsx'
import { CheckpointContext } from './undo-context.ts'
import { checkpoint, emptyHistory, redo, undo } from './undo-history.ts'
import { formatEng } from './units.ts'
import { type SelectedWire, WireInspector } from './wire-inspector.tsx'
import {
  DEFAULT_WIRE_GAUGE_AWG,
  DEFAULT_WIRE_MATERIAL,
  gaugeAreaM2,
  lengthFromDrawn,
  materialResistivity,
  wireResistance,
} from './wire-length.ts'
import {
  CURVE_RADIUS_PX,
  type PathPoint,
  polylineLength,
  roundedPathD,
  roundedPathLength,
  samplePathPoints,
} from './wire-path.ts'
import { worldToFlow } from './world-to-flow.ts'
import {
  type DeratingResult,
  deratingDashboard,
  type WorstCaseResult,
  worstCaseAnalysis,
} from './worst-case.ts'
import { WorstCasePanel } from './worst-case-panel.tsx'

// The preload bridge (electron/preload.ts): the native Settings menu pushes
// appearance changes (theme, grid color) into the renderer over IPC.
declare global {
  interface Window {
    chipblocks?: {
      onTheme: (callback: (theme: 'light' | 'dark') => void) => void
      onGridColor: (callback: (color: string) => void) => void
      onGridColorCustom: (callback: () => void) => void
      onSaveRequest: (callback: () => void) => void
      saveCircuitData: (text: string) => Promise<{ ok: boolean; path?: string }>
      onCircuitOpened: (callback: (text: string) => void) => void
      getKeybinds?: () => Promise<Record<string, string>>
      setKeybinds?: (binds: Record<string, string>) => Promise<Record<string, string>>
      onShortcutsOpen?: (callback: () => void) => void
      onEditCopy?: (callback: () => void) => void
      onEditCut?: (callback: () => void) => void
      onEditPaste?: (callback: () => void) => void
      onEditUndo?: (callback: () => void) => void
      onEditRedo?: (callback: () => void) => void
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
  edge: {
    source: string
    target: string
    data?: {
      waypoints?: unknown
      curved?: unknown
      curveRadius?: unknown
      gaugeAwg?: unknown
      material?: unknown
    }
  },
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
      const sweep = typeof edge.data?.curveRadius === 'number' ? edge.data.curveRadius : undefined
      drawnPixels =
        edge.data?.curved === true ? roundedPathLength(points, sweep) : polylineLength(points)
    } else {
      drawnPixels = Math.hypot(to.x - from.x, to.y - from.y)
    }
  }
  const lengthM = lengthFromDrawn(drawnPixels)
  return {
    lengthM,
    ohms: wireResistance(
      lengthM,
      materialResistivity(edge.data?.material),
      gaugeAreaM2(edge.data?.gaugeAwg),
    ),
  }
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
  temperatures: Map<string, number>,
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
      // The two ends sit on the parts they connect to, at those parts' solved
      // temperatures (ambient when a part runs cool / has no thermal model) — the
      // boundary conditions for the wire's hot-spot fin model.
      endTempA: temperatures.get(edge.source) ?? STANDARD_AMBIENT_C,
      endTempB: temperatures.get(edge.target) ?? STANDARD_AMBIENT_C,
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
  curveRadius,
}: {
  pending: {
    start: { nodeId: string; handleId: string } | { x: number; y: number }
    corners: { id: string; x: number; y: number }[]
  }
  cursor: { x: number; y: number } | null
  curved: boolean
  curveRadius: number
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
    ? roundedPathD(points, curveRadius)
    : points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
  return (
    <ViewportPortal>
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative rubber-band preview, hidden from the accessibility tree */}
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
/** The light sources (positions + intensity) and every node's position, read off
 *  the canvas nodes — the inputs the casting pre-pass needs (light.ts). */
function lightCastInputs(nodeList: Node[]): {
  sources: LightSource[]
  positions: Map<string, { x: number; y: number }>
} {
  const sources: LightSource[] = nodeList
    .filter((node) => (node.data as DeviceNodeData).definition === 'light_source')
    .map((node) => ({
      x: node.position.x,
      y: node.position.y,
      intensityCandela:
        readScalarParam(
          { parameters: (node.data as DeviceNodeData).parameters } as Instance,
          'luminous_intensity',
        ) ?? 0,
    }))
  const positions = new Map(nodeList.map((node) => [node.id, node.position]))
  return { sources, positions }
}

function solveCanvas(
  nodeList: Node[],
  edgeList: Edge[],
  projectAmbientC?: number,
): {
  edges: Edge[]
  health: Map<string, NodeHealth>
  readings: Map<string, PartReading>
  terminalVolts: Map<string, number>
  world: World
  solution: Solution
  temperaturesC: Map<string, number>
  thermalConverged: boolean
  relayStates: Map<string, RelayState>
  shockleyStates: Map<string, ShockleyDiodeState>
  relaysSettled: boolean
} {
  const { world: rawWorld, drawn, leadAliases } = canvasWorld(nodeList, edgeList)
  // Light casting (S21-v3-8): a light_source part throws light onto the sensors
  // around it, falling off with distance (E = I/d²). Fold each sensor's incident
  // illuminance — its own ambient plus the cast from every source at its canvas
  // position — into the world before solving, so the sensor responds to the real,
  // position-dependent light. This is the ONE place canvas position carries physics.
  const { sources, positions } = lightCastInputs(nodeList)
  const world = worldWithCastLight(rawWorld, positions, sources)
  // Electro-thermal solve (stage 7): the electrical answer at the settled part
  // temperatures — hot parts drift, warm junctions drop, all fed back until the
  // fixed point. Readings/health recompute temperatures from this solution and
  // land on the same numbers (it IS the fixed point). Only the ground-connected
  // component is solved: a free-floating section's voltages are genuinely
  // undefined (and would be a singular matrix) — it sits idle instead of
  // killing the whole canvas. The meter still gets the FULL world.
  const thermal = solveWithRelays(
    groundedComponent(world),
    projectAmbientC === undefined ? undefined : { projectAmbientC },
  )
  const solution = thermal.solution
  const edges = edgeList.map((edge) => {
    const wire = drawn.get(edge.id) ?? { lengthM: 0, ohms: 0 }
    const physics = edgePhysics(
      edge,
      world,
      solution,
      wire.lengthM,
      wire.ohms,
      thermal.temperaturesC,
    )
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
      // Re-solving recomputes PHYSICS — it must not touch what the user did.
      // Selection and the drawn shape (corners, curve flag, sweep size) are
      // user state and survive the rebuild verbatim.
      ...(edge.selected !== undefined ? { selected: edge.selected } : {}),
      ...physics,
      data: {
        ...physics.data,
        ...(waypoints ? { waypoints } : {}),
        ...(edge.data?.curved === true ? { curved: true } : {}),
        ...(typeof edge.data?.curveRadius === 'number'
          ? { curveRadius: edge.data.curveRadius }
          : {}),
        ...(typeof edge.data?.gaugeAwg === 'number' ? { gaugeAwg: edge.data.gaugeAwg } : {}),
        ...(typeof edge.data?.material === 'string' ? { material: edge.data.material } : {}),
      },
    }
  })
  // An internal part's failure also marks its block node (validation bubbles
  // up the hierarchy, per the object model — a failing source SECTION marks
  // its source the same way).
  const health = bubbleBlockHealth(canvasHealth(world, solution))
  // Probing a block's PORT or a multi-lead source's lead reads the real
  // terminal it stands for. Lead aliases land first: a block port may itself
  // point at a lead that the expansion re-homed.
  const terminalVolts = terminalVoltages(world, solution)
  for (const alias of leadAliases) {
    const inner = terminalVolts.get(alias.inner)
    if (inner !== undefined) terminalVolts.set(alias.outer, inner)
  }
  for (const alias of blockPortAliases(nodeList as unknown as BlockNodeLike[])) {
    const inner = terminalVolts.get(alias.inner)
    if (inner !== undefined) terminalVolts.set(alias.outer, inner)
  }
  return {
    edges,
    health,
    readings: partReadings(world, solution, thermal.temperaturesC),
    // Every wired terminal's live voltage — what the multimeter probes read.
    terminalVolts,
    // The solved circuit itself — the meter's Ω mode re-solves it powered-off,
    // and the Math panel shows the equations behind this exact solution.
    world,
    solution,
    // The settled part temperatures — the Math panel narrates a hot resistor's
    // tempco drift with the SAME numbers the solve used.
    temperaturesC: thermal.temperaturesC,
    // Did the thermal loop settle? False = runaway — the Math panel flags the
    // temperatures below as a non-converged snapshot instead of an answer.
    thermalConverged: thermal.thermalConverged,
    // Each relay's resolved contact state (for the symbol) + whether the relay
    // loop settled (false = a buzzer/oscillator the Math panel flags).
    relayStates: thermal.relayStates,
    shockleyStates: thermal.shockleyStates,
    relaysSettled: thermal.relaysSettled,
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
): {
  world: World
  drawn: Map<string, { lengthM: number; ohms: number }>
  leadAliases: { outer: string; inner: string }[]
} {
  // Blocks are pure structure: expand every block back into its REAL parts
  // (namespaced ids, ports routed to the real internal terminals) before
  // anything physical is computed. The solver never sees a block. The same
  // rule expands a multi-lead source into its real two-lead sections.
  const flat = flattenBlocks(
    nodeList as unknown as BlockNodeLike[],
    edgeList as unknown as BlockEdgeLike[],
  )
  const expanded = expandMultiLeadSources(flat.nodes, flat.edges)
  const flatNodes = expanded.nodes as unknown as Node[]
  const flatEdges = expanded.edges as unknown as Edge[]
  const positions = new Map<string, NodePosition>(flatNodes.map((n) => [n.id, n.position]))
  // Each wire's real resistance feeds BOTH the solve (so it drops real voltage)
  // and the on-wire readout — computed once here from how the wire is drawn.
  // A multi-lead source's internal seams are INSIDE the pack: zero length,
  // zero resistance — they are not drawn wires.
  const drawn = new Map<string, { lengthM: number; ohms: number }>(
    flatEdges.map((e) => [
      e.id,
      e.data?.internalBond === true ? { lengthM: 0, ohms: 0 } : drawnWire(e, positions),
    ]),
  )
  const canvasEdges: CanvasEdge[] = flatEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    resistanceOhms: drawn.get(e.id)?.ohms ?? 0,
  }))
  return {
    world: canvasToWorld(flatNodes.map(toCanvasNode), canvasEdges),
    drawn,
    leadAliases: expanded.aliases,
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
    const flow = worldToFlow(world)
    const nodes: Node[] = flow.nodes.map((n) => ({
      id: n.id,
      type: 'device',
      position: n.position,
      data: {
        definition: n.data.definition,
        label: n.id,
        parameters: n.data.parameters,
        ...(n.data.rotation ? { rotation: n.data.rotation } : {}),
      },
    }))
    // Wires start as bare connections (just the terminals they join); the canvas
    // re-solve fills in current + length + resistance — the same path a later
    // drop/edit takes. A wire is a connection, not a deletable block. The
    // series-loop layout's hand-quality routing arrives as waypoints.
    const baseEdges: Edge[] = flow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'net',
      deletable: false,
      label: e.showLabel ? e.label : undefined,
      ...(e.waypoints ? { data: { waypoints: e.waypoints } } : {}),
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
      temperaturesC: solved.temperaturesC,
      thermalConverged: solved.thermalConverged,
      relayStates: solved.relayStates,
      shockleyStates: solved.shockleyStates,
      relaysSettled: solved.relaysSettled,
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
  // The settled electro-thermal temperatures behind that solution.
  const [solvedTemperatures, setSolvedTemperatures] = useState(initial.temperaturesC)
  // Did the thermal loop settle? False = runaway — the Math panel flags it.
  const [thermalConverged, setThermalConverged] = useState(initial.thermalConverged)
  // Each relay's resolved contact state (drives the symbol) + whether the relay
  // loop settled (false = a buzzer — flagged like the runaway).
  const [relayStates, setRelayStates] = useState(initial.relayStates)
  const [shockleyStates, setShockleyStates] = useState(initial.shockleyStates)
  const [relaysSettled, setRelaysSettled] = useState(initial.relaysSettled)
  // Latest edges for the re-solve effect WITHOUT depending on edge data (a re-solve
  // rewrites edge data, which would loop); structural edits trigger it via
  // `topology`, node moves via `nodes`.
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const { screenToFlowPosition, fitView, deleteElements } = useReactFlow()
  const dropCount = useRef(0)

  // Frame the whole circuit on startup — but only AFTER the nodes have measured. React
  // Flow's `fitView` prop fires on mount before measurement, which lands the view zoomed
  // onto a single node (the ground, near the origin); re-fitting the moment the nodes
  // report initialized frames the real circuit. One-shot — the user pans/zooms freely after.
  const nodesInitialized = useNodesInitialized()
  const didStartupFit = useRef(false)
  useEffect(() => {
    if (nodesInitialized && !didStartupFit.current && nodesRef.current.length > 0) {
      didStartupFit.current = true
      fitView({ padding: 0.15 })
    }
  }, [nodesInitialized, fitView])

  // Undo / redo (S19-v3-73): every mutating action calls checkpointAction
  // FIRST — the canvas as it is right before the change goes onto the undo
  // stack. Snapshots are deep copies (later edits can't reach back into
  // history); restoring re-solves, so the physics always matches the canvas.
  const undoHistory = useRef(emptyHistory<{ nodes: Node[]; edges: Edge[] }>())
  const snapshotCanvas = useCallback(
    (): { nodes: Node[]; edges: Edge[] } =>
      JSON.parse(JSON.stringify({ nodes: nodesRef.current, edges: edgesRef.current })) as {
        nodes: Node[]
        edges: Edge[]
      },
    [],
  )
  const checkpointAction = useCallback(
    (tag: string) => {
      undoHistory.current = checkpoint(undoHistory.current, snapshotCanvas(), tag, Date.now())
    },
    [snapshotCanvas],
  )

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
        projectAmbientRef.current,
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
      checkpointAction('load')
      // Restore the saved board ambient (older files have none → the 25 °C default). Set the ref
      // synchronously so the auto-resolve that setNodes triggers below solves at the loaded ambient.
      const loadedAmbient =
        typeof result.file.projectAmbientC === 'number' &&
        Number.isFinite(result.file.projectAmbientC)
          ? result.file.projectAmbientC
          : STANDARD_AMBIENT_C
      projectAmbientRef.current = loadedAmbient
      setProjectAmbientC(loadedAmbient)
      setNodes(
        result.file.nodes.map((n) => ({
          id: n.id,
          type:
            n.definition === 'block'
              ? 'block'
              : n.definition === 'junction'
                ? 'junction'
                : 'device',
          position: { x: n.x, y: n.y },
          data: {
            definition: n.definition,
            label: n.block?.name ?? n.id,
            ...(n.rotation ? { rotation: n.rotation } : {}),
            ...(n.parameters ? { parameters: n.parameters } : {}),
            ...(n.block ? { block: n.block } : {}),
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
          ...(w.waypoints ||
          w.curved ||
          typeof w.gaugeAwg === 'number' ||
          typeof w.material === 'string'
            ? {
                data: {
                  ...(w.waypoints ? { waypoints: w.waypoints } : {}),
                  ...(w.curved ? { curved: true } : {}),
                  ...(typeof w.curveRadius === 'number' ? { curveRadius: w.curveRadius } : {}),
                  ...(typeof w.gaugeAwg === 'number' ? { gaugeAwg: w.gaugeAwg } : {}),
                  ...(typeof w.material === 'string' ? { material: w.material } : {}),
                },
              }
            : {}),
        })),
      )
      dropCount.current = maxIdSuffix(result.file.nodes)
      window.setTimeout(() => fitView({ padding: 0.15 }), 80)
    })
  }, [setNodes, setEdges, fitView, checkpointAction])

  // Movable menus (S19-v3-10): each docks to a window edge; the user drags them.
  // Dock panels + their tab-stack grouping (Sprint 21). Each panel starts on its own
  // edge; dragging one onto another stacks them into a tabbed group (panel-groups.ts).
  const [panelLayout, setPanelLayout] = useState<PanelLayout>({
    parts: { edge: 'left', group: 0 },
    tools: { edge: 'top', group: 1 },
    properties: { edge: 'right', group: 2 },
    scope: { edge: 'bottom', group: 3 },
  })
  const [activeTab, setActiveTab] = useState<Record<number, string>>({})
  // Active tool: 'select' (move parts) or 'wire' (parts locked; drag draws wires).
  const [tool, setTool] = useState<Tool>('select')
  // Active physics (S19-v3-14): re-solve + refresh every wire's current/length/
  // resistance from the live canvas. Always-on recomputes on every change (the
  // default); turn it off and hit Solve to batch big edits without the PC
  // recomputing on every small move.
  const [alwaysOn, setAlwaysOn] = useState(true)
  // Project-wide ambient (°C): the environment the whole board sits in. Each part falls back to it
  // unless it sets its own ambient_temperature (electro-thermal.ts). A ref lets the stable-identity
  // reSolve read the current value without being re-created; onProjectAmbient re-solves on change.
  const [projectAmbientC, setProjectAmbientC] = useState(STANDARD_AMBIENT_C)
  const projectAmbientRef = useRef(projectAmbientC)
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
      const solved = solveCanvas(nodeList, edgeList, projectAmbientRef.current)
      setEdges(solved.edges)
      setHealth(solved.health)
      setReadings(solved.readings)
      setTerminalVolts(solved.terminalVolts)
      setSolvedWorld(solved.world)
      setSolution(solved.solution)
      setSolvedTemperatures(solved.temperaturesC)
      setThermalConverged(solved.thermalConverged)
      setRelayStates(solved.relayStates)
      setShockleyStates(solved.shockleyStates)
      setRelaysSettled(solved.relaysSettled)
    },
    [setEdges],
  )

  const handleSolve = useCallback(() => reSolve(nodes, edges), [reSolve, nodes, edges])

  // Changing the board ambient updates the ref synchronously (so the stable-identity reSolve picks it
  // up) and re-solves immediately, like hitting Solve.
  const onProjectAmbient = useCallback(
    (c: number) => {
      projectAmbientRef.current = c
      setProjectAmbientC(c)
      reSolve(nodes, edges)
    },
    [reSolve, nodes, edges],
  )

  // Walk the undo timeline. The restored canvas re-solves immediately so the
  // currents, health, and Math panel always describe what is on screen.
  const doUndo = useCallback(() => {
    const result = undo(undoHistory.current, snapshotCanvas())
    if (result === null) return
    undoHistory.current = result.history
    setNodes(result.restored.nodes)
    setEdges(result.restored.edges)
    reSolve(result.restored.nodes, result.restored.edges)
  }, [snapshotCanvas, setNodes, setEdges, reSolve])
  const doRedo = useCallback(() => {
    const result = redo(undoHistory.current, snapshotCanvas(), Date.now())
    if (result === null) return
    undoHistory.current = result.history
    setNodes(result.restored.nodes)
    setEdges(result.restored.edges)
    reSolve(result.restored.nodes, result.restored.edges)
  }, [snapshotCanvas, setNodes, setEdges, reSolve])

  // Scope (time-domain view): run the canvas circuit through solveTransient over
  // an auto-picked window and show every node voltage as a waveform.
  const [scopeResult, setScopeResult] = useState<TransientResult | null>(null)
  // One display-window's duration — the trigger aligns sweeps inside the
  // 3-window record (set alongside each scope run).
  const [scopeWindowSec, setScopeWindowSec] = useState(1e-3)
  // Timebase knob (S19-v3-78): seconds per grid square, or 'auto' (the window
  // heuristic). Manual settings re-run the sim at the new window; a setting
  // too slow to sample the fastest source honestly is REFUSED, never aliased.
  const [scopeSecPerDiv, setScopeSecPerDiv] = useState<number | 'auto'>('auto')
  const [scopeAutoWindowSec, setScopeAutoWindowSec] = useState(1e-3)
  const [scopeRefusal, setScopeRefusal] = useState<string | null>(null)
  // Family curves (S20-v3-4): a FROZEN set of stepped-parameter runs — the
  // I-V family. Each trace is a real solver run with one source's voltage
  // overridden; the dataset stays until cleared or re-traced (re-running N
  // simulations on every edit would not be a live view, it would be a lag).
  const [scopeFamily, setScopeFamily] = useState<{
    steps: FamilyStep[]
    xChannel: ScopeChannel
    yChannel: ScopeChannel
    sourceId: string
    skipped: string[]
  } | null>(null)
  const [scopeFamilyNote, setScopeFamilyNote] = useState<string | null>(null)
  // Scope probes (S19-v3-77): the terminals the user clipped channels onto.
  // Only these plot — clipping where you care, like real scope leads.
  const [scopeProbes, setScopeProbes] = useState<ScopeProbe[]>([])

  // Math panel (S19-v3-63): the equations behind the current solution, derived
  // live from the same solved state the canvas shows.
  const [showMath, setShowMath] = useState(false)
  const mathView = useMemo(
    () =>
      showMath
        ? buildMathView(solvedWorld, solution, solvedTemperatures, thermalConverged, relaysSettled)
        : null,
    [showMath, solvedWorld, solution, solvedTemperatures, thermalConverged, relaysSettled],
  )
  // Worst-case tolerance analysis (S21-v3-10) — on demand (it re-solves the
  // circuit many times), it sweeps every toleranced part's band and reports each
  // reading's worst corner crossed against its rating. Runs the SAME heat-aware
  // solve the canvas uses, on the grounded circuit.
  const [worstCase, setWorstCase] = useState<WorstCaseResult | null>(null)
  const [derating, setDerating] = useState<DeratingResult | null>(null)
  const [monteCarlo, setMonteCarlo] = useState<MonteCarloResult | null>(null)
  const [monteCarloRunning, setMonteCarloRunning] = useState(false)
  const runWorstCase = useCallback(() => {
    const grounded = groundedComponent(solvedWorld)
    setWorstCase(worstCaseAnalysis(grounded, (w) => solveWithRelays(w).solution))
    setDerating(deratingDashboard(grounded, solveWithRelays(grounded).solution))
    setMonteCarlo(null)
  }, [solvedWorld])
  const runMonteCarlo = useCallback(() => {
    setMonteCarloRunning(true)
    // Defer the heavy sweep a tick so the "Running…" label paints first.
    window.setTimeout(() => {
      const grounded = groundedComponent(solvedWorld)
      setMonteCarlo(monteCarloAnalysis(grounded, (w) => solveWithRelays(w).solution))
      setMonteCarloRunning(false)
    }, 0)
  }, [solvedWorld])
  const closeMargins = useCallback(() => {
    setWorstCase(null)
    setDerating(null)
    setMonteCarlo(null)
    setMonteCarloRunning(false)
  }, [])

  // Circuit blocks (S19-v3-67): group the selection into ONE reusable block.
  // The prompt collects the block's name; the viewer (double-click a block)
  // shows the real parts inside; Ungroup explodes it back for editing.
  const [groupPrompt, setGroupPrompt] = useState<{ name: string; error: string | null } | null>(
    null,
  )
  const [viewBlockId, setViewBlockId] = useState<string | null>(null)
  const selectedCount = nodes.filter((n) => n.selected).length
  const confirmGroup = useCallback(() => {
    if (groupPrompt === null) return
    const name = groupPrompt.name.trim() || 'block'
    const selectedIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
    dropCount.current += 1
    const result = groupSelection(
      nodes as unknown as BlockNodeLike[],
      edges as unknown as BlockEdgeLike[],
      selectedIds,
      `block_${dropCount.current}`,
      name,
    )
    if ('reason' in result) {
      setGroupPrompt({ name, error: result.reason })
      return
    }
    checkpointAction('group')
    setNodes(result.nodes as unknown as Node[])
    setEdges(result.edges as unknown as Edge[])
    setGroupPrompt(null)
  }, [groupPrompt, nodes, edges, setNodes, setEdges, checkpointAction])
  const handleUngroup = useCallback(
    (blockNodeId: string) => {
      const result = ungroupBlock(
        nodes as unknown as BlockNodeLike[],
        edges as unknown as BlockEdgeLike[],
        blockNodeId,
      )
      if ('reason' in result) return
      checkpointAction('ungroup')
      setNodes(result.nodes as unknown as Node[])
      setEdges(result.edges as unknown as Edge[])
      setViewBlockId(null)
    },
    [nodes, edges, setNodes, setEdges, checkpointAction],
  )
  const viewedBlock: BlockData | null =
    viewBlockId !== null
      ? ((nodes.find((n) => n.id === viewBlockId)?.data as { block?: BlockData } | undefined)
          ?.block ?? null)
      : null

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
    const { sources, positions } = lightCastInputs(nodes)
    const world = groundedComponent(
      worldWithCastLight(canvasWorld(nodes, edges).world, positions, sources),
    )
    const auto = scopeWindow(world)
    setScopeAutoWindowSec(auto.duration)
    const windowSec = scopeSecPerDiv === 'auto' ? auto.duration : scopeSecPerDiv * H_DIVISIONS
    setScopeWindowSec(windowSec)
    // The RECORD is three display-windows long (S19-v3-75): the trigger search
    // starts after the first (power-on transients settle), and a full window
    // always fits after the trigger point. Step spacing follows the FASTEST
    // source (≥32 samples/cycle, ≤20 000 steps — the multimeter's V~ honesty
    // rule); a timebase too slow to keep that is refused, never aliased.
    const fastestHz = fastestSourceHz(world)
    const steps = scopeRecordSteps(windowSec * 3, fastestHz)
    if (steps === 'span-too-wide') {
      const slowest = slowestHonestTimebase(fastestHz)
      setScopeRefusal(
        `${formatEng(windowSec / H_DIVISIONS, 's')}/div spans too much time to sample the ` +
          `${formatEng(fastestHz, 'Hz')} source honestly (the scope keeps at least 32 points ` +
          `per cycle, at most 20 000 steps — past that the trace would alias into a shape ` +
          `that was never there). Slowest honest setting for this circuit: ` +
          `${formatEng(slowest, 's')}/div.`,
      )
      return
    }
    setScopeRefusal(null)
    // Electro-thermal (S20-v3-5): the scope's simulation heats the parts by
    // the same lumped law the DC solve uses — the meter clamp and the scope
    // clamp now agree on the same wire. The thermal loop's own warnings
    // (runaway, out-of-range tempco) surface with the solver's.
    const thermal = solveTransientThermal(world, {
      timeStep: (windowSec * 3) / steps,
      duration: windowSec * 3,
    })
    setScopeResult({
      ...thermal.result,
      warnings: [...thermal.result.warnings, ...thermal.warnings],
    })
  }, [nodes, edges, scopeSecPerDiv])

  // Trace a family (S20-v3-4): one solver run per stepped value of the chosen
  // source's voltage, each run's settled (X, Y) path kept. The window and the
  // honest-sampling guard are computed ONCE from the base circuit — stepping
  // a DC value changes no frequency, so every run shares them. Failed steps
  // are reported by name, never faked.
  const runFamily = useCallback(
    (
      xChannel: ScopeChannel,
      yChannel: ScopeChannel,
      sourceId: string,
      from: number,
      to: number,
      count: number,
    ) => {
      const { sources, positions } = lightCastInputs(nodes)
      const baseWorld = groundedComponent(
        worldWithCastLight(canvasWorld(nodes, edges).world, positions, sources),
      )
      const auto = scopeWindow(baseWorld)
      const windowSec = scopeSecPerDiv === 'auto' ? auto.duration : scopeSecPerDiv * H_DIVISIONS
      const fastestHz = fastestSourceHz(baseWorld)
      const honestSteps = scopeRecordSteps(windowSec * 3, fastestHz)
      if (honestSteps === 'span-too-wide') {
        setScopeFamily(null)
        setScopeFamilyNote(
          `the timebase is too slow to sample the ${formatEng(fastestHz, 'Hz')} source honestly — ` +
            `pick a faster Horiz setting, then trace`,
        )
        return
      }
      const dt = (windowSec * 3) / honestSteps
      const traced: FamilyStep[] = []
      const skipped: string[] = []
      for (const value of stepValues(from, to, count)) {
        const stepped = withSourceVoltage(
          nodes as unknown as { id: string; data?: { parameters?: Record<string, unknown> } }[],
          sourceId,
          value,
        ) as unknown as Node[]
        // The light is unchanged across voltage steps — reuse the base sources.
        const world = groundedComponent(
          worldWithCastLight(canvasWorld(stepped, edges).world, positions, sources),
        )
        // Each family run heats its parts too — a high-gate step's curve is
        // traced at the temperature that step actually sustains.
        const result = solveTransientThermal(world, {
          timeStep: dt,
          duration: windowSec * 3,
        }).result
        const label = `${sourceId} = ${formatEng(value, 'V')}`
        if (result.status !== 'solved') {
          skipped.push(`${formatEng(value, 'V')}: ${result.status}`)
          continue
        }
        traced.push({
          value,
          label,
          path: extractXyPath(result.series, xChannel, yChannel, windowSec),
        })
      }
      setScopeFamily({ steps: traced, xChannel, yChannel, sourceId, skipped })
      setScopeFamilyNote(skipped.length > 0 ? `skipped — ${skipped.join(' · ')}` : null)
    },
    [nodes, edges, scopeSecPerDiv],
  )

  // While the Scope is open it follows the circuit live: any edit (drop, wire,
  // value change, switch flip) re-runs the time simulation — same spirit as the
  // always-on DC re-solve. Closed scope costs nothing.
  const scopeOpen = scopeResult !== null || scopeRefusal !== null
  useEffect(() => {
    if (scopeOpen) runScope()
  }, [scopeOpen, runScope])

  // Clip / unclip a scope probe (S19-v3-77; clamps S19-v3-83; part currents
  // S20-v3-3): with the Scope open and the plain select tool, clicking a
  // terminal dot toggles a VOLTAGE channel there; clicking a WIRE clamps a
  // CURRENT channel around it; ALT+clicking a part's BODY clamps the part's
  // own recorded current (the curve tracer's Y axis). Plain body clicks stay
  // selection. Returns whether the click was consumed.
  const onScopeProbeClick = useCallback(
    (event: ReactMouseEvent): boolean => {
      if (!scopeOpen || tool !== 'select') return false
      const target = event.target as Element
      const toggle = (probe: ScopeProbe) => {
        const key = scopeProbeKey(probe)
        setScopeProbes((current) =>
          current.some((p) => scopeProbeKey(p) === key)
            ? current.filter((p) => scopeProbeKey(p) !== key)
            : [...current, probe],
        )
        event.stopPropagation()
      }
      if (event.altKey) {
        const nodeEl = target.closest?.('.react-flow__node') as HTMLElement | null
        const nodeId = nodeEl?.getAttribute('data-id')
        if (nodeId === null || nodeId === undefined) return false
        toggle({ kind: 'part', nodeId })
        return true
      }
      const handleEl = target.closest?.('.react-flow__handle') as HTMLElement | null
      if (handleEl !== null) {
        const nodeId = handleEl.dataset.nodeid
        const handleId = handleEl.dataset.handleid
        if (nodeId === undefined || handleId === undefined) return false
        toggle({ kind: 'terminal', nodeId, handleId })
        return true
      }
      const edgeEl = target.closest?.('.react-flow__edge')
      if (edgeEl !== null && edgeEl !== undefined) {
        const dataId = edgeEl.getAttribute('data-id')
        const testId = edgeEl.getAttribute('data-testid')
        const edgeId = dataId ?? (testId?.startsWith('rf__edge-') ? testId.slice(9) : null)
        if (edgeId === null) return false
        toggle({ kind: 'wire', edgeId })
        return true
      }
      return false
    },
    [scopeOpen, tool],
  )

  // Each probeable PART's recorded-current key (S20-v3-3): which terminal's
  // current the solver records as "the" device current, per definition —
  // fixed names where the device has them (anode, collector, drain, +), the
  // instance's own first connect for symmetric two-leads (so the label can
  // state the direction honestly). Parts with no recorded element current
  // (ground, junctions, expanded multi-lead sources, blocks) resolve to
  // nothing and the probe is dropped, never invented.
  const scopePartInfo = useMemo(() => {
    // Parts whose recorded current is anode→cathode (the transient solver records them at /anode):
    // the LED/diode family, the zener, and the latching thyristors (Shockley + the SCR's A-K path).
    const DIODES = new Set([
      'led',
      'led_uv_algan',
      'diode_silicon_rectifier',
      'diode_schottky_al_si',
      'diode_zener_silicon',
      'diode_laser',
      'diode_tunnel',
      'diode_shockley',
      'diode_varactor',
      'scr',
    ])
    const info = new Map<string, { currentKey: string; label: string }>()
    for (const inst of solvedWorld.instances.values()) {
      const id = inst.id
      if (DIODES.has(inst.definition)) {
        info.set(id, { currentKey: `${id}/anode`, label: `${id} · I(anode→cathode)` })
      } else if (inst.definition === 'power_source') {
        info.set(id, { currentKey: `${id}/terminal_positive`, label: `${id} · I(+→−)` })
      } else if (
        inst.definition === 'transistor_bjt_npn' ||
        inst.definition === 'transistor_bjt_pnp'
      ) {
        info.set(id, { currentKey: `${id}/collector`, label: `${id} · I(collector)` })
      } else if (
        inst.definition === 'transistor_mosfet_nmos' ||
        inst.definition === 'transistor_mosfet_pmos' ||
        inst.definition === 'transistor_jfet_n_channel' ||
        inst.definition === 'transistor_jfet_p_channel'
      ) {
        info.set(id, { currentKey: `${id}/drain`, label: `${id} · I(drain)` })
      } else if (inst.definition === 'diode_constant_current') {
        // A CRD is internally a JFET, so the solver records its current at the synthetic drain.
        info.set(id, { currentKey: `${id}/drain`, label: `${id} · I(anode→cathode)` })
      } else if (
        inst.definition === 'switch_spst_toggle' ||
        inst.definition === 'switch_spst_momentary'
      ) {
        info.set(id, { currentKey: `${id}/terminal_in`, label: `${id} · I(in→out)` })
      } else if (inst.definition === 'switch_spdt') {
        info.set(id, { currentKey: `${id}/common`, label: `${id} · I(common)` })
      } else if (inst.definition === 'potentiometer') {
        // The wiper current is the pot-specific quantity: ~0 in an unloaded
        // divider, nonzero as a rheostat or when the tap drives a load.
        info.set(id, { currentKey: `${id}/wiper`, label: `${id} · I(wiper)` })
      } else if (inst.definition === 'fuse') {
        info.set(id, { currentKey: `${id}/terminal_a`, label: `${id} · I(a→b)` })
      } else if (inst.definition === 'relay') {
        info.set(id, { currentKey: `${id}/coil_a`, label: `${id} · I(coil)` })
      } else if (
        inst.definition === 'transformer' ||
        inst.definition === 'transformer_center_tapped'
      ) {
        info.set(id, { currentKey: `${id}/primary_a`, label: `${id} · I(primary)` })
      } else if (
        inst.definition === 'resistor' ||
        inst.definition === 'thermistor' ||
        inst.definition === 'photoresistor' ||
        inst.definition === 'capacitor' ||
        inst.definition === 'inductor'
      ) {
        const c1 = inst.connects?.[0]
        const c2 = inst.connects?.[1]
        if (c1 === undefined || c2 === undefined) continue
        const short = (t: string) => t.replace(/^terminal_/, '')
        info.set(id, {
          currentKey: `${id}/${c1.terminal}`,
          label: `${id} · I(${short(c1.terminal)}→${short(c2.terminal)})`,
        })
      }
    }
    return info
  }, [solvedWorld])

  // Each drawn wire's two nets + real resistance, for the scope's clamps —
  // from the SAME world the solves use (wire instance ids are wire_<edgeId>).
  const scopeWireInfo = useMemo(() => {
    const info = new Map<string, { netA: string; netB: string; ohms: number; label: string }>()
    for (const edge of edges) {
      const inst = solvedWorld.instances.get(`wire_${edge.id}`)
      if (inst === undefined) continue
      const netA = inst.connects?.find((c) => c.terminal === 'terminal_a')?.net
      const netB = inst.connects?.find((c) => c.terminal === 'terminal_b')?.net
      const ohms = readScalarParam(inst, 'resistance') ?? 0
      if (netA === undefined || netB === undefined) continue
      info.set(edge.id, {
        netA,
        netB,
        ohms,
        label: `clamp · ${edge.source} → ${edge.target}`,
      })
    }
    return info
  }, [edges, solvedWorld])

  // Multimeter (S19-v3-53/54): in meter mode, touching terminal dots places the
  // red then the black probe — the readout shows the live value between them per
  // the mode dial: V⎓ (voltage; both probes on one part also reads its current)
  // or Ω (resistance, measured powered-off the real way). Touching a WIRE clamps
  // onto it and reads its current without breaking the circuit — the clamp-meter
  // move. Clicking empty canvas lifts everything; leaving the tool clears it.
  // The dial position survives tool switches, like a real meter left on a setting.
  const [redProbe, setRedProbe] = useState<ProbeRef | undefined>(undefined)
  const [blackProbe, setBlackProbe] = useState<ProbeRef | undefined>(undefined)
  const [meterMode, setMeterMode] = useState<
    'volts' | 'acvolts' | 'ohms' | 'diode' | 'cap' | 'amps' | 'tempc'
  >('volts')
  // A⎓ jack selection + per-jack fuse state (S20-v3-11). A blown fuse stores
  // the current that killed it — the display keeps telling the story until
  // the fuse is replaced, and the meter is an OPEN circuit meanwhile.
  const [meterJack, setMeterJack] = useState<AmmeterJack>('milliamp')
  const [blownFuses, setBlownFuses] = useState<{ milliamp: number | null; amp: number | null }>({
    milliamp: null,
    amp: null,
  })
  // REL/zero (S20-v3-13): the stored Ω offset the display subtracts — short
  // the probes (they read the leads' 0.2 Ω), press REL, measure relative.
  // MIN/MAX (S20-v3-14): V⎓ shows the record's extremes instead of one value.
  // Both drop on a dial change, like the real buttons.
  const [relOhms, setRelOhms] = useState<number | null>(null)
  const [minMaxOn, setMinMaxOn] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: meterMode is the intentional trigger — turning the dial drops REL and MIN/MAX like a real meter
  useEffect(() => {
    setRelOhms(null)
    setMinMaxOn(false)
  }, [meterMode])
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
  // Each wired terminal's net — what the Ω probes hand to the powered-off
  // solve. Block PORTS and multi-lead source LEADS alias to the real terminal
  // they stand for (lead aliases first — a port can point at a lead).
  const probeNets = useMemo(() => {
    const nets = terminalNets(solvedWorld)
    const flat = flattenBlocks(
      nodes as unknown as BlockNodeLike[],
      edgesRef.current as unknown as BlockEdgeLike[],
    )
    for (const alias of multiLeadAliases(flat.nodes)) {
      const inner = nets.get(alias.inner)
      if (inner !== undefined) nets.set(alias.outer, inner)
    }
    for (const alias of blockPortAliases(nodes as unknown as BlockNodeLike[])) {
      const inner = nets.get(alias.inner)
      if (inner !== undefined) nets.set(alias.outer, inner)
    }
    return nets
  }, [solvedWorld, nodes])
  // The probed channels the Scope plots — terminals resolved through the same
  // terminal→net lookup the multimeter uses (block ports + lead taps
  // included); wire clamps through the wire-instance lookup.
  const scopeChannels = useMemo(
    () =>
      channelsForProbes(
        scopeProbes,
        (key) => probeNets.get(key),
        (edgeId) => scopeWireInfo.get(edgeId),
        (nodeId) => scopePartInfo.get(nodeId),
      ),
    [scopeProbes, probeNets, scopeWireInfo, scopePartInfo],
  )
  // Ω measurement — its own memo because TWO consumers need the raw number:
  // the readout and the REL button (which stores it as the zero offset).
  const ohmsReading = useMemo(() => {
    if (tool !== 'meter' || meterMode !== 'ohms' || clampWire !== undefined) return null
    if (redProbe === undefined || blackProbe === undefined) return null
    const netRed = probeNets.get(`${redProbe.nodeId}/${redProbe.handleId}`)
    const netBlack = probeNets.get(`${blackProbe.nodeId}/${blackProbe.handleId}`)
    if (netRed === undefined || netBlack === undefined) return null
    return equivalentResistance(solvedWorld, netRed, netBlack)
  }, [tool, meterMode, clampWire, redProbe, blackProbe, probeNets, solvedWorld])

  // A⎓ measurement (S20-v3-11) — its own memo so the fuse-blow EFFECT below
  // can watch it (a memo must not set state). Runs only with the dial on A,
  // both probes on wired dots, and the selected jack's fuse intact.
  const ammeterReading = useMemo(() => {
    if (tool !== 'meter' || meterMode !== 'amps' || clampWire !== undefined) return null
    if (redProbe === undefined || blackProbe === undefined) return null
    if (blownFuses[meterJack] !== null) return null
    const netRed = probeNets.get(`${redProbe.nodeId}/${redProbe.handleId}`)
    const netBlack = probeNets.get(`${blackProbe.nodeId}/${blackProbe.handleId}`)
    if (netRed === undefined || netBlack === undefined) return null
    return seriesAmmeter(solvedWorld, netRed, netBlack, meterJack)
  }, [
    tool,
    meterMode,
    clampWire,
    redProbe,
    blackProbe,
    blownFuses,
    meterJack,
    probeNets,
    solvedWorld,
  ])

  // The pop: a blow result marks the jack's fuse dead, storing the killing
  // current so the display keeps telling the story until 'replace fuse'.
  useEffect(() => {
    if (ammeterReading?.status === 'blew') {
      setBlownFuses((fuses) => ({ ...fuses, [meterJack]: Math.abs(ammeterReading.amps) }))
    }
  }, [ammeterReading, meterJack])

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
      if (ohmsReading === null) return ohmsChip('Resistance: OL — no conductive path (open loop)')
      const continuity = ohmsReading < CONTINUITY_OHMS ? ' · ● continuity' : ''
      if (relOhms !== null) {
        return ohmsChip(
          `Δ ${displayCounts(ohmsReading - relOhms, 'Ω')} (REL zeroed at ${displayCounts(relOhms, 'Ω')})${continuity}`,
        )
      }
      return ohmsChip(`Resistance: ${displayCounts(ohmsReading, 'Ω')}${continuity}`)
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
      // Duty (S20-v3-16) rides the counted frequency — the fraction of each
      // cycle the waveform spends above its midline, from the shared module.
      const dutyText =
        ac.hz !== null && ac.duty !== null ? ` · duty ${(ac.duty * 100).toFixed(1)} %` : ''
      // Sub-µV residue is solver float noise, not signal — floor the display
      // like a real meter's resolution floor instead of printing femtovolts.
      const shownRms = ac.rms < 1e-6 ? 0 : ac.rms
      return acChip(`V~ (red − black): ${displayCounts(shownRms, 'V')} rms${hzText}${dutyText}`)
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
    if (meterMode === 'amps') {
      const spec = AMMETER_JACKS[meterJack]
      const ampChip = (text: string) => ({ icon: 'A⎓', iconColor: '#7ab8ff', text })
      const blownAt = blownFuses[meterJack]
      if (blownAt !== null) {
        return ampChip(
          `${spec.label} jack FUSE BLOWN — ${formatEng(blownAt, 'A')} through the ${formatEng(spec.fuseAmps, 'A')} fuse. The meter reads nothing until you replace it.`,
        )
      }
      const nets = bothProbeNets()
      if (typeof nets === 'string') return ampChip(nets)
      if (ammeterReading === null || ammeterReading.status === 'failed') {
        return ampChip("A⎓ can't solve this circuit — no reading")
      }
      if (ammeterReading.status === 'blew') {
        return ampChip(
          `POP — ${formatEng(Math.abs(ammeterReading.amps), 'A')} through the ${formatEng(spec.fuseAmps, 'A')} fuse`,
        )
      }
      return ampChip(
        `A⎓ (red → black): ${displayCounts(ammeterReading.amps, 'A')} · burden ${displayCounts(Math.abs(ammeterReading.burdenVolts), 'V')}`,
      )
    }
    if (meterMode === 'tempc') {
      const tempChip = (text: string) => ({ icon: '°C', iconColor: '#e09f3e', text })
      if (redProbe === undefined) {
        return tempChip('Touch any terminal of a part with the red probe — it is the thermocouple')
      }
      const reading = readings.get(redProbe.nodeId)
      if (reading?.temperatureC !== undefined) {
        const max =
          reading.maxTemperatureC !== undefined ? ` · max ${reading.maxTemperatureC} °C` : ''
        return tempChip(
          `${redProbe.nodeId}: ${reading.temperatureC.toFixed(1)} °C — its real junction temperature, from its own dissipation${max}`,
        )
      }
      return tempChip(
        `${redProbe.nodeId}: 25.0 °C — ambient (no thermal rating declared on this part, so the model holds it at room temperature)`,
      )
    }
    const voltChip = (text: string) => ({ icon: 'Ⓥ', iconColor: '#e0594f', text })
    if (redProbe === undefined) return voltChip('Touch a terminal dot to place the red probe')
    const vRed = voltsAt(redProbe)
    const netRed = probeNets.get(`${redProbe.nodeId}/${redProbe.handleId}`)
    // The loading note (S20-v3-12): when the meter's own 10 MΩ visibly bends
    // the point it measures, say so and show what the point sits at unprobed.
    const loadNote = (shown: number, unloaded: number) =>
      Math.abs(shown - unloaded) > Math.max(1e-3, 0.005 * Math.abs(unloaded))
        ? ` · your meter's 10 MΩ input is loading this point (it sits at ${displayCounts(unloaded, 'V')} unprobed)`
        : ''
    if (blackProbe === undefined) {
      if (vRed === undefined || netRed === undefined) {
        return voltChip('Red probe: not wired (no circuit at that dot)')
      }
      const groundNet = groundNetOf(solvedWorld)
      const loaded =
        groundNet !== undefined && groundNet !== netRed
          ? voltmeterSolve(solvedWorld, netRed, groundNet)
          : null
      const shown = loaded !== null ? (loaded.nodes.get(netRed) ?? vRed) : vRed
      return voltChip(
        `Red vs ground: ${displayCounts(shown, 'V')}${loadNote(shown, vRed)} — touch another dot for the black probe`,
      )
    }
    const vBlack = voltsAt(blackProbe)
    const netBlack = probeNets.get(`${blackProbe.nodeId}/${blackProbe.handleId}`)
    if (
      vRed === undefined ||
      vBlack === undefined ||
      netRed === undefined ||
      netBlack === undefined
    ) {
      return voltChip('One probe is on an unwired dot — no reading')
    }
    // MIN/MAX/AVG (S20-v3-14): the settled record's extremes instead of the
    // single operating-point number — what the real button records.
    if (minMaxOn) {
      const extremes = dcExtremes(solvedWorld, netRed, netBlack)
      if (extremes === 'span-too-wide') {
        return voltChip('MIN/MAX: source frequencies are too far apart to resolve in one pass')
      }
      if (extremes === null) {
        return voltChip("MIN/MAX can't run a time pass on this circuit — no reading")
      }
      return voltChip(
        `MIN ${displayCounts(extremes.min, 'V')} · MAX ${displayCounts(extremes.max, 'V')} · AVG ${displayCounts(extremes.avg, 'V')}`,
      )
    }
    const loaded = netRed === netBlack ? null : voltmeterSolve(solvedWorld, netRed, netBlack)
    const unloadedDiff = vRed - vBlack
    const shown =
      loaded !== null
        ? (loaded.nodes.get(netRed) ?? 0) - (loaded.nodes.get(netBlack) ?? 0)
        : unloadedDiff
    let text = `V (red − black): ${displayCounts(shown, 'V')}${loadNote(shown, unloadedDiff)}`
    if (redProbe.nodeId === blackProbe.nodeId && redProbe.handleId !== blackProbe.handleId) {
      const through =
        loaded !== null
          ? Math.abs(loaded.branches.get(redProbe.nodeId) ?? Number.NaN)
          : readings.get(redProbe.nodeId)?.current
      if (through !== undefined && Number.isFinite(through)) {
        text += ` · through ${redProbe.nodeId}: ${displayCounts(through, 'A')}`
      }
    }
    return voltChip(text)
  }, [
    tool,
    meterMode,
    meterJack,
    blownFuses,
    ammeterReading,
    ohmsReading,
    relOhms,
    minMaxOn,
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

  // A fuse blows when its solved current exceeds its rating: flip the offending
  // fuses to 'blown' (a persistent state on the node), which re-solves them OPEN
  // — the circuit goes dark. The LED-overcurrent check, but the response is a
  // real state change, not just a flag. overcurrentFuseIds lists only INTACT
  // fuses over their rating, so a blown fuse (carrying nothing) is never relisted
  // and this settles in one extra solve — no loop. A blown fuse stays blown until
  // the user double-clicks to replace it (and re-blows at once if the fault
  // remains). Not checkpointed: it is automatic physics off the user's edit,
  // which is already on the undo stack — undoing that edit un-blows the fuse.
  useEffect(() => {
    const toBlow = overcurrentFuseIds(solvedWorld, solution)
    if (toBlow.length === 0) return
    const blow = new Set(toBlow)
    setNodes((current) =>
      current.map((n) =>
        blow.has(n.id)
          ? {
              ...n,
              data: { ...n.data, parameters: blownFuse((n.data as DeviceNodeData).parameters) },
            }
          : n,
      ),
    )
  }, [solvedWorld, solution, setNodes])

  // Persist each relay's resolved contact state onto its node, so the symbol
  // shows energized vs at-rest. solveWithRelays already settled the states (the
  // solution + currents are correct now); this just makes the node param catch
  // up. Setting coil_state to the resolved value re-solves to the SAME value, so
  // it converges in one render. Only writes when a value actually changes (else
  // a fresh node array would loop). Not checkpointed — automatic physics.
  useEffect(() => {
    if (relayStates.size === 0) return
    setNodes((current) => {
      let changed = false
      const next = current.map((n) => {
        const target = relayStates.get(n.id)
        if (target === undefined) return n
        const params = (n.data as DeviceNodeData).parameters
        if (params?.coil_state?.value === target) return n
        changed = true
        return { ...n, data: { ...n.data, parameters: relayWithCoilState(params, target) } }
      })
      return changed ? next : current
    })
  }, [relayStates, setNodes])

  // Persist each Shockley diode's settled latch state onto its node — the latch's MEMORY. Without
  // this it would re-settle from 'blocking' every solve and never stay latched after the trigger
  // is removed. Mirrors the relay sync above (writes only on a real change, so it converges in one
  // render). Not checkpointed — automatic physics off the user's edit.
  useEffect(() => {
    if (shockleyStates.size === 0) return
    setNodes((current) => {
      let changed = false
      const next = current.map((n) => {
        const target = shockleyStates.get(n.id)
        if (target === undefined) return n
        const params = (n.data as DeviceNodeData).parameters
        if (params?.device_state?.value === target) return n
        changed = true
        return { ...n, data: { ...n.data, parameters: shockleyDiodeWithState(params, target) } }
      })
      return changed ? next : current
    })
  }, [shockleyStates, setNodes])

  // Persist each light sensor's computed incident illuminance (its ambient plus
  // what every light_source casts on it) onto its node, so the headline reads the
  // REAL light on it, not just the ambient the user set. The casting pre-pass put
  // it in the solved world; this catches the node param up. The casting always
  // recomputes from ambient (never from this synced value), so positions unchanged
  // → same incident → it converges; only writes on a real change. Not checkpointed.
  useEffect(() => {
    setNodes((current) => {
      let changed = false
      const next = current.map((node) => {
        const data = node.data as DeviceNodeData
        if (!LIGHT_SENSOR_DEFINITIONS.has(data.definition)) return node
        const inst = solvedWorld.instances.get(node.id)
        if (inst === undefined) return node
        const incident = readScalarParam(inst, 'incident_illuminance')
        if (incident === undefined) return node
        const shown = readScalarParam(
          { parameters: data.parameters } as Instance,
          'incident_illuminance',
        )
        if (shown !== undefined && Math.abs(shown - incident) < 1e-6) return node
        changed = true
        return {
          ...node,
          data: {
            ...node.data,
            parameters: {
              ...data.parameters,
              incident_illuminance: { value: { kind: 'scalar', amount: incident, unit: 'lux' } },
            },
          },
        }
      })
      return changed ? next : current
    })
  }, [solvedWorld, setNodes])

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

  // Clipboard (S19-v3-69): desktop-style copy/cut/paste with a Win+V-style
  // history — 15 copies, one cut at a time. Ctrl+V pastes the newest at the
  // cursor; the panel pastes any slot at the view center.
  const [clipboard, setClipboard] = useState(emptyClipboard())
  const [showClipboard, setShowClipboard] = useState(false)
  const lastCursorFlow = useRef<{ x: number; y: number } | null>(null)

  const doCopy = useCallback(() => {
    const selected = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
    const item = snapshotSelection(
      nodes as unknown as BlockNodeLike[],
      edges as unknown as BlockEdgeLike[],
      selected,
    )
    if (item === null) return
    setClipboard((current) => withCopy(current, item))
  }, [nodes, edges])

  const doCut = useCallback(() => {
    const selected = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
    const item = snapshotSelection(
      nodes as unknown as BlockNodeLike[],
      edges as unknown as BlockEdgeLike[],
      selected,
    )
    if (item === null) return
    checkpointAction('cut')
    setClipboard((current) => withCut(current, item))
    void deleteElements({
      nodes: nodes.filter((n) => n.selected),
      edges: edges.filter((e) => e.selected),
    })
  }, [nodes, edges, deleteElements, checkpointAction])

  const doPaste = useCallback(
    (item?: ClipboardItem, placement: 'cursor' | 'center' = 'cursor') => {
      const chosen = item ?? latestItem(clipboard)
      if (chosen === null || chosen.nodes.length === 0) return
      checkpointAction('paste')
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })
      const target = placement === 'cursor' ? (lastCursorFlow.current ?? center) : center
      dropCount.current += 1
      const pasted = materializeItem(chosen, `p${dropCount.current}`, target)
      setNodes((current) => [
        ...current.map((n) => ({ ...n, selected: false })),
        ...(pasted.nodes as unknown as Node[]),
      ])
      setEdges((current) => [...current, ...(pasted.edges as unknown as Edge[])])
    },
    [clipboard, screenToFlowPosition, setNodes, setEdges, checkpointAction],
  )

  // The Edit menu's items arrive over IPC. Subscribe once; the ref always
  // points at the latest handlers (which close over live state).
  const editActions = useRef({
    copy: doCopy,
    cut: doCut,
    paste: () => doPaste(),
    undo: doUndo,
    redo: doRedo,
  })
  editActions.current = {
    copy: doCopy,
    cut: doCut,
    paste: () => doPaste(),
    undo: doUndo,
    redo: doRedo,
  }
  useEffect(() => {
    const bridge = window.chipblocks
    bridge?.onEditCopy?.(() => editActions.current.copy())
    bridge?.onEditCut?.(() => editActions.current.cut())
    bridge?.onEditPaste?.(() => editActions.current.paste())
    bridge?.onEditUndo?.(() => editActions.current.undo())
    bridge?.onEditRedo?.(() => editActions.current.redo())
  }, [])

  // Lasso (S19-v3-69): freeform selection. The wrapper owns the pointer
  // events; points are kept in BOTH spaces — wrapper-local for the overlay
  // drawing, flow coordinates for the hit test (so zoom/pan can't skew it).
  // The LIVE gesture lives in a ref — pointer events can land faster than
  // renders, and reading render state mid-gesture would drop points; the
  // state mirror exists only so the trail draws.
  const [lassoPoints, setLassoPoints] = useState<{
    screen: LassoPoint[]
    flow: LassoPoint[]
  } | null>(null)
  const lassoLive = useRef<{ rect: DOMRect; screen: LassoPoint[]; flow: LassoPoint[] } | null>(null)
  const onLassoDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
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
    (event: React.PointerEvent<HTMLDivElement>) => {
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
  }, [tool, nodes, setNodes, setEdges, centerOf])

  // Box-select wires the same way (S19-v3-70): React Flow's marquee only
  // picks parts, so the box is tracked here too — on release, wires whose
  // path the box touches join the selection. Gesture state lives in a ref.
  const boxLive = useRef<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(
    null,
  )
  const onBoxDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (tool !== 'select' || event.button !== 0) return
      const target = event.target as Element
      if (target.closest?.('.react-flow__pane') === null) return
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      boxLive.current = { start: point, end: point }
    },
    [tool, screenToFlowPosition],
  )
  const onBoxMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
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
  }, [tool, centerOf, setEdges])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (showShortcuts) return // the panel owns the keyboard while open
      if (eventMatchesBinding(event, keybinds.shortcutsPanel)) {
        setShowShortcuts(true)
        return
      }
      if (eventMatchesBinding(event, keybinds.selectAll)) {
        event.preventDefault()
        setNodes((current) => current.map((n) => ({ ...n, selected: true })))
        setEdges((current) => current.map((e) => ({ ...e, selected: true })))
        return
      }
      if (eventMatchesBinding(event, keybinds.undo)) {
        event.preventDefault()
        doUndo()
        return
      }
      if (eventMatchesBinding(event, keybinds.redo)) {
        event.preventDefault()
        doRedo()
        return
      }
      if (eventMatchesBinding(event, keybinds.copy)) {
        event.preventDefault()
        doCopy()
        return
      }
      if (eventMatchesBinding(event, keybinds.cut)) {
        event.preventDefault()
        doCut()
        return
      }
      if (eventMatchesBinding(event, keybinds.paste)) {
        event.preventDefault()
        doPaste()
        return
      }
      if (eventMatchesBinding(event, keybinds.rotate)) {
        if (!nodes.some((n) => n.selected)) return
        checkpointAction('rotate')
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
        const doomedNodes = nodes.filter((n) => n.selected)
        const doomedEdges = edges.filter((e) => e.selected)
        if (doomedNodes.length === 0 && doomedEdges.length === 0) return
        checkpointAction('delete')
        void deleteElements({ nodes: doomedNodes, edges: doomedEdges })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    setNodes,
    setEdges,
    keybinds,
    showShortcuts,
    nodes,
    edges,
    deleteElements,
    doCopy,
    doCut,
    doPaste,
    doUndo,
    doRedo,
    checkpointAction,
  ])

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  // Drop a part from the palette → a new node at the drop point (S19-v3-6).
  // Dropping a BLOCK places an independent copy: internals cloned with fresh
  // ids, parameters deep-copied so each copy is editable on its own.
  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const blockSourceId = event.dataTransfer.getData(BLOCK_MIME)
      if (blockSourceId) {
        const source = nodes.find((n) => n.id === blockSourceId)
        const block = (source?.data as { block?: BlockData } | undefined)?.block
        if (!block) return
        checkpointAction('drop')
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        dropCount.current += 1
        const id = `block_${dropCount.current}`
        const clone = cloneBlockData(block, String(dropCount.current))
        setNodes((current) =>
          current.concat({
            id,
            type: 'block',
            position,
            data: { definition: 'block', label: clone.name, block: clone },
          }),
        )
        return
      }
      const definition = event.dataTransfer.getData(DEFINITION_MIME)
      if (!definition) return
      // A built-in (e.g. the op-amp) drops as a block node — a fresh deep copy that
      // descends + flattens to its real transistors like any user-grouped block.
      const builtinBlock = BUILTIN_BLOCKS[definition]
      if (builtinBlock) {
        checkpointAction('drop')
        const blockPos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        dropCount.current += 1
        const block = structuredClone(builtinBlock)
        setNodes((current) =>
          current.concat({
            id: `${definition}_${dropCount.current}`,
            type: 'block',
            position: blockPos,
            data: { definition: 'block', label: block.name, block },
          }),
        )
        return
      }
      checkpointAction('drop')
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
    [screenToFlowPosition, setNodes, nodes, checkpointAction],
  )

  // The AWG gauge new wires take (the toolbar picker sets it); each wire keeps its
  // own, editable later by selecting it. Declared above both wire-creation paths.
  const [wireGauge, setWireGauge] = useState<number>(DEFAULT_WIRE_GAUGE_AWG)

  // Draw a wire between two terminals → a new edge. The topology effect re-solves
  // it (current/length/resistance) when physics is on; otherwise it stays grey
  // (DRAWN) until Solve. Deletable: select it + Delete to remove.
  const onConnect = useCallback(
    (connection: Connection) => {
      checkpointAction('wire')
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            type: 'net',
            deletable: true,
            style: { stroke: DRAWN },
            data: { gaugeAwg: wireGauge },
          },
          current,
        ),
      )
    },
    [setEdges, checkpointAction, wireGauge],
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
  // Curve sweep size (S19-v3-70): how far before each corner the wire bends.
  // The setting applies to wires drawn from now on; every wire keeps its own.
  const [wireCurveRadius, setWireCurveRadius] = useState(CURVE_RADIUS_PX)
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
            style: { stroke: DRAWN },
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
    [pendingWire, wireStyle, wireCurveRadius, wireGauge, setEdges, setNodes, checkpointAction],
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
    (oldEdge: Edge, newConnection: Connection) => {
      checkpointAction('reconnect')
      setEdges((current) => reconnectEdge(oldEdge, newConnection, current))
    },
    [setEdges, checkpointAction],
  )

  // Double-click a switch to flip it open/closed — operate it and watch the
  // circuit respond. The state lives in the node's parameters, so this nodes
  // change triggers the always-on re-solve (open switch → broken loop → no
  // current). Other parts ignore the double-click.
  const onNodeDoubleClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => {
      // Double-click a block → descend into it (see the real circuit inside).
      if ((node.data as DeviceNodeData).definition === 'block') {
        setViewBlockId(node.id)
        return
      }
      // Double-click toggles a switch: state for the SPST toggle + momentary
      // push button (open↔closed), the throw for the SPDT (A↔B). A BLOWN fuse is
      // replaced (→ intact); an intact fuse does nothing (a fuse isn't a toggle —
      // it's consumed when it blows, and re-blows at once if the fault remains).
      const def = (node.data as DeviceNodeData).definition
      const params = (node.data as DeviceNodeData).parameters
      const flip =
        def === 'switch_spst_toggle' || def === 'switch_spst_momentary'
          ? toggledSwitch
          : def === 'switch_spdt'
            ? toggledSpdt
            : def === 'fuse' && !fuseIntact(params)
              ? replacedFuse
              : null
      if (flip === null) return
      checkpointAction(def === 'fuse' ? 'replace fuse' : 'toggle')
      setNodes((current) =>
        current.map((n) =>
          n.id === node.id
            ? {
                ...n,
                data: {
                  ...n.data,
                  parameters: flip((n.data as DeviceNodeData).parameters),
                },
              }
            : n,
        ),
      )
    },
    [setNodes, checkpointAction],
  )

  // Edit a part's scalar value (resistance, voltage, ...) → live re-solve. The
  // value lives in the node's parameters, so updating it triggers the always-on
  // re-solve, exactly like the switch toggle. A missing parameter is CREATED
  // only when the caller states its unit (the Source presets do — a loaded
  // pre-AC battery instance has no ac_amplitude/frequency entries to update);
  // without a unit an unknown key is ignored, never invented.
  const onEditParam = useCallback(
    (nodeId: string, key: string, amount: number, unit?: string) => {
      checkpointAction(`param:${nodeId}:${key}`)
      // Shrinking a source's lead count removes leads — wires attached to a
      // lead that no longer exists go with it (one undo step brings both back).
      if (key === 'terminal_count') {
        const keep = new Set(sourceTerminalIds(Math.min(6, Math.max(1, Math.round(amount)))))
        setEdges((current) =>
          current.filter(
            (e) =>
              !(e.source === nodeId && !keep.has(e.sourceHandle ?? '')) &&
              !(e.target === nodeId && !keep.has(e.targetHandle ?? '')),
          ),
        )
      }
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
    [setNodes, setEdges, checkpointAction],
  )

  // Edit a part's enum value (a switch's open/closed state) → live re-solve.
  const onEditEnum = useCallback(
    (nodeId: string, key: string, value: string) => {
      checkpointAction(`param:${nodeId}:${key}`)
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
    [setNodes, checkpointAction],
  )

  // Pick a wire's gauge → its R = ρ·L/A changes; re-solve so the resistance,
  // current and hot spot all update live (a data edit, like a part's params,
  // so it must drive the re-solve itself rather than wait on a topology change).
  const onEditWireGauge = useCallback(
    (edgeId: string, gaugeAwg: number) => {
      checkpointAction(`gauge:${edgeId}`)
      const next = edges.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data, gaugeAwg } } : e))
      if (alwaysOn) reSolve(nodes, next)
      else setEdges(next)
    },
    [edges, nodes, alwaysOn, setEdges, reSolve, checkpointAction],
  )
  // Pick a wire's material → its resistivity ρ changes, so R = ρ·L/A re-solves live too.
  const onEditWireMaterial = useCallback(
    (edgeId: string, material: string) => {
      checkpointAction(`material:${edgeId}`)
      const next = edges.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data, material } } : e))
      if (alwaysOn) reSolve(nodes, next)
      else setEdges(next)
    },
    [edges, nodes, alwaysOn, setEdges, reSolve, checkpointAction],
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
  // A selected wire (and no part) feeds the wire-gauge inspector instead.
  const selectedEdge = edges.find((e) => e.selected)
  const selectedWire: SelectedWire | null =
    selectedEdge && !selectedPart
      ? {
          id: selectedEdge.id,
          gaugeAwg:
            typeof selectedEdge.data?.gaugeAwg === 'number'
              ? selectedEdge.data.gaugeAwg
              : DEFAULT_WIRE_GAUGE_AWG,
          material:
            typeof selectedEdge.data?.material === 'string'
              ? selectedEdge.data.material
              : DEFAULT_WIRE_MATERIAL,
          lengthM:
            typeof selectedEdge.data?.lengthM === 'number' ? selectedEdge.data.lengthM : null,
          ohms: typeof selectedEdge.data?.ohms === 'number' ? selectedEdge.data.ohms : null,
          amps: typeof selectedEdge.data?.amps === 'number' ? selectedEdge.data.amps : null,
        }
      : null

  // Drag a panel's grip/tab onto another panel to stack them into a tab group; drop
  // onto an edge to dock it (or pop a stacked tab back out). The reducer is pure.
  const onTabDrop = (tabId: string, target: TabDropTarget) => {
    if (target.kind === 'edge') {
      setPanelLayout((layout) => moveToEdge(layout, tabId, target.edge))
      return
    }
    const group = panelLayout[target.targetId]?.group
    if (group !== undefined) setActiveTab((cur) => ({ ...cur, [group]: tabId }))
    setPanelLayout((layout) => stackOnto(layout, tabId, target.targetId))
  }

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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: this wrapper only ROUTES capture-phase clicks to the active tool (lasso guard, scope probes, meter probes, wire clicks); the real interactive targets are the terminal handles and buttons inside */}
      <div
        onClickCapture={(event) => {
          // While the lasso is the active tool, clicks aimed at the CANVAS
          // must not reach React Flow — its pane click would clear the
          // selection the lasso just made. Clicks on overlay UI in this same
          // wrapper (the clipboard panel, the meter chip) still work.
          if (tool === 'lasso') {
            if ((event.target as Element).closest?.('.react-flow') !== null) {
              event.stopPropagation()
            }
            return
          }
          if (onScopeProbeClick(event)) return
          onMeterClick(event)
          onWireClick(event)
        }}
        onDoubleClickCapture={onWireDoubleClick}
        onMouseMove={(event) => {
          lastCursorFlow.current = screenToFlowPosition({ x: event.clientX, y: event.clientY })
          onWireMove(event)
        }}
        onPointerDown={(event) => {
          onLassoDown(event)
          onBoxDown(event)
        }}
        onPointerMove={(event) => {
          onLassoMove(event)
          onBoxMove(event)
        }}
        onPointerUp={() => {
          onLassoUp()
          onBoxUp()
        }}
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
            <CheckpointContext.Provider value={checkpointAction}>
              <ReactFlow
                colorMode={theme}
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onReconnect={onReconnect}
                onNodeDoubleClick={onNodeDoubleClick}
                onNodeDragStart={() => checkpointAction('move')}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={tool === 'select'}
                nodesConnectable={tool !== 'meter'}
                // Click-to-connect is OUR gesture now (onWireClick, wire tool
                // only, with corner routing); React Flow's built-in one would
                // double-create — and it once let meter probes draw real wires.
                connectOnClick={false}
                connectionMode={ConnectionMode.Loose}
                // Desktop-style selection (S19-v3-69): LEFT-drag on empty canvas
                // draws a selection box (like desktop icons), so panning moves to
                // the middle/right mouse buttons. Touching the box counts —
                // SelectionMode.Partial — exactly how a desktop marquee behaves.
                // In lasso mode the wrapper owns the pointer, so both are off.
                selectionOnDrag={tool === 'select'}
                panOnDrag={tool === 'lasso' ? false : [1, 2]}
                selectionMode={SelectionMode.Partial}
                // Windows-friendly multi-select: Ctrl+click (React Flow's default
                // is the Meta key); Shift+drag box-select is the built-in default.
                multiSelectionKeyCode={['Meta', 'Control']}
                // Deletion is OUR keybind now (editable, supports combos) — see
                // the keyboard-shortcuts effect above.
                deleteKeyCode={null}
                zoomOnDoubleClick={false}
                // Effectively unbounded zoom (React Flow defaults stop at 0.5×–2×):
                // the project's horizon runs from a full PC down to a transistor,
                // so the canvas must zoom six orders of magnitude either way.
                minZoom={0.001}
                maxZoom={1000}
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
                {/* Coordinate-graph axes through the origin + the four quadrants. */}
                <CoordinateAxes light={light} />
                <Controls />
                <MeterProbes red={redProbe} black={blackProbe} />
                {/* Scope channel probes (S19-v3-77): one colored clip per
                    voltage channel. Wire clamps show in the channel chips. */}
                {scopeOpen
                  ? scopeProbes.map((p, i) =>
                      p.kind === 'terminal' ? (
                        <ProbeMarker
                          key={scopeProbeKey(p)}
                          probe={{ nodeId: p.nodeId, handleId: p.handleId }}
                          color={TRACE_COLORS[i % TRACE_COLORS.length] ?? '#888'}
                          label={`CH${i + 1}`}
                        />
                      ) : null,
                    )
                  : null}
                {pendingWire !== null ? (
                  <PendingWirePreview
                    pending={pendingWire}
                    cursor={wireCursor}
                    curved={wireStyle === 'curve'}
                    curveRadius={wireCurveRadius}
                  />
                ) : null}
              </ReactFlow>
            </CheckpointContext.Provider>
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
          {tool === 'lasso'
            ? ' · lasso: press and draw any shape around parts; release to select them'
            : ''}
          {alwaysOn ? '' : ' · physics paused — hit Solve'}
        </div>

        {/* The lasso trail — drawn in wrapper coordinates while dragging. */}
        {lassoPoints !== null ? (
          // biome-ignore lint/a11y/noSvgWithoutTitle: decorative selection trail, hidden from the accessibility tree
          <svg
            aria-hidden
            style={{ position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'none' }}
            width="100%"
            height="100%"
          >
            <path
              d={lassoPathD(lassoPoints.screen)}
              fill="rgba(160, 106, 216, 0.12)"
              stroke="#a06ad8"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
          </svg>
        ) : null}

        {showClipboard ? (
          <ClipboardPanel
            clipboard={clipboard}
            onPaste={(item) => doPaste(item, 'center')}
            onClose={() => setShowClipboard(false)}
            light={light}
          />
        ) : null}

        {/* Side-to-side / up-down pan bars over the canvas (S19-v3-72). */}
        <CanvasScrollbars nodes={nodes} />

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
              <button
                type="button"
                onClick={() => setMeterMode('amps')}
                title="DC amps, the SERIES way — the meter inserts itself between the probes as a real shunt resistance behind a fuse, and current flows THROUGH it. Correct use: open the circuit (flip a switch off) and bridge the gap with the probes. The shunt drops a real burden voltage — the price the clamp (touch a wire) doesn't pay. Probes across a live source = the classic mistake: the near-short blows the fuse."
                style={meterDialStyle(meterMode === 'amps', light)}
              >
                A⎓
              </button>
              <button
                type="button"
                onClick={() => setMeterMode('tempc')}
                title="Temperature — the red probe becomes a thermocouple: touch any terminal of a part and read its real junction temperature, the same number the electro-thermal loop solved (25 °C ambient + its actual dissipation × its θ rating). Parts with no thermal rating honestly read ambient."
                style={meterDialStyle(meterMode === 'tempc', light)}
              >
                °C
              </button>
            </span>
            {meterMode === 'ohms' ? (
              <button
                type="button"
                onClick={() => setRelOhms(relOhms !== null ? null : ohmsReading)}
                disabled={relOhms === null && ohmsReading === null}
                title="REL / zero — the real lead-zeroing workflow: touch the probes together (they read the leads' own 0.2 Ω), press REL to store that as zero, then measure relative to it. Press again to clear."
                style={{
                  ...meterDialStyle(relOhms !== null, light),
                  fontSize: 9,
                  letterSpacing: 0.5,
                }}
              >
                REL
              </button>
            ) : null}
            {meterMode === 'volts' ? (
              <button
                type="button"
                onClick={() => setMinMaxOn((on) => !on)}
                title="MIN MAX — record the lowest, highest, and average instantaneous voltage over the settled record instead of one number: ripple floor and ceiling, swing extremes. On steady DC all three agree."
                style={{
                  ...meterDialStyle(minMaxOn, light),
                  fontSize: 9,
                  letterSpacing: 0.5,
                }}
              >
                MIN/MAX
              </button>
            ) : null}
            {meterMode === 'amps' ? (
              <span style={{ display: 'flex', gap: 3 }}>
                {(['milliamp', 'amp'] as const).map((jack) => (
                  <button
                    key={jack}
                    type="button"
                    onClick={() => setMeterJack(jack)}
                    title={
                      jack === 'milliamp'
                        ? 'mA jack — 1.8 Ω shunt (the Fluke 87V’s published 1.8 mV/mA burden), fused at 440 mA. The electronics jack: fine readings, easy to blow.'
                        : '10 A jack — 0.03 Ω shunt, fused at 11 A (the Fluke 11 A/1000 V fuse). The high-current jack: tiny burden, survives what kills the mA fuse.'
                    }
                    style={{
                      ...meterDialStyle(meterJack === jack, light),
                      fontSize: 9,
                      ...(blownFuses[jack] !== null ? { color: '#e0594f' } : {}),
                    }}
                  >
                    {AMMETER_JACKS[jack].label}
                    {blownFuses[jack] !== null ? ' ✕' : ''}
                  </button>
                ))}
                {blownFuses[meterJack] !== null ? (
                  <button
                    type="button"
                    onClick={() => setBlownFuses((fuses) => ({ ...fuses, [meterJack]: null }))}
                    title="Fit a fresh fuse in this jack — the real meters keep a spare in the battery compartment for exactly this moment."
                    style={{ ...meterDialStyle(false, light), fontSize: 9 }}
                  >
                    replace fuse
                  </button>
                ) : null}
              </span>
            ) : null}
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

        {/* Group-into-block naming prompt. */}
        {groupPrompt !== null ? (
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              top: 60,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 62,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '10px 14px',
              background: light ? '#f2f3f5' : '#141417',
              border: light ? '1px solid #c4c8ce' : '1px solid #2a2a2f',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              fontFamily: 'system-ui, sans-serif',
              fontSize: 12,
              color: light ? '#333' : '#cdd6e0',
            }}
          >
            <div style={{ fontWeight: 700 }}>
              Group {selectedCount} parts into a block — name it:
            </div>
            <input
              // biome-ignore lint/a11y/noAutofocus: the dialog exists to type a name
              autoFocus
              value={groupPrompt.name}
              onChange={(e) => setGroupPrompt({ name: e.target.value, error: null })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmGroup()
                if (e.key === 'Escape') setGroupPrompt(null)
              }}
              placeholder="e.g. NOT gate"
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: light ? '1px solid #c4c8ce' : '1px solid #2a2a2f',
                background: light ? '#fff' : '#1b1b1f',
                color: light ? '#333' : '#dde4ec',
                fontSize: 12,
              }}
            />
            {groupPrompt.error !== null ? (
              <div style={{ color: '#e0594f', fontSize: 11 }}>{groupPrompt.error}</div>
            ) : null}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setGroupPrompt(null)}
                style={meterDialStyle(false, light)}
              >
                Cancel
              </button>
              <button type="button" onClick={confirmGroup} style={meterDialStyle(true, light)}>
                Group
              </button>
            </div>
          </div>
        ) : null}

        {/* Descend view — the real circuit inside a block. */}
        {viewedBlock !== null && viewBlockId !== null ? (
          <BlockViewer
            block={viewedBlock}
            onUngroup={() => handleUngroup(viewBlockId)}
            onClose={() => setViewBlockId(null)}
            light={light}
          />
        ) : null}

        {/* Math panel — the equations behind the current solution. */}
        {mathView !== null ? (
          <MathPanel view={mathView} onClose={() => setShowMath(false)} light={light} />
        ) : null}
        {/* Worst-case panel — each reading's envelope over tolerances vs its rating. */}
        {worstCase !== null ? (
          <WorstCasePanel
            result={worstCase}
            derating={derating}
            monteCarlo={monteCarlo}
            monteCarloRunning={monteCarloRunning}
            onRunMonteCarlo={runMonteCarlo}
            onClose={closeMargins}
            light={light}
          />
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

      {(() => {
        // The dock panels — each with its title, its live content, and whether it is
        // shown now. Grouping (panel-groups.ts) collapses them into tabbed stacks.
        const registry: Record<string, { title: string; content: ReactNode; visible: boolean }> = {
          parts: {
            title: 'Parts',
            visible: true,
            content: (
              <Palette
                blocks={nodes
                  .filter((n) => (n.data as { definition?: string }).definition === 'block')
                  .map((n) => ({
                    id: n.id,
                    name: ((n.data as { block?: BlockData }).block?.name ?? n.id) as string,
                  }))}
              />
            ),
          },
          tools: {
            title: 'Tools',
            visible: true,
            content: (
              <ToolbarItems
                tool={tool}
                onTool={setTool}
                wireStyle={wireStyle}
                onWireStyle={setWireStyle}
                curveRadius={wireCurveRadius}
                onCurveRadius={setWireCurveRadius}
                wireGauge={wireGauge}
                onWireGauge={setWireGauge}
                alwaysOn={alwaysOn}
                onAlwaysOn={setAlwaysOn}
                projectAmbientC={projectAmbientC}
                onProjectAmbient={onProjectAmbient}
                onSolve={handleSolve}
                onScope={runScope}
                onMath={() => setShowMath((open) => !open)}
                onWorstCase={runWorstCase}
                onGroup={() => setGroupPrompt({ name: '', error: null })}
                canGroup={selectedCount >= 2}
                onClipboard={() => setShowClipboard((open) => !open)}
                clipboardCount={clipboard.copies.length + (clipboard.cut !== null ? 1 : 0)}
                lens={lens}
                onLens={setLens}
                flow={flow}
                onFlow={setFlow}
              />
            ),
          },
          properties: {
            title: 'Properties',
            visible: true,
            content: selectedWire ? (
              <WireInspector
                wire={selectedWire}
                onGauge={(gaugeAwg) => onEditWireGauge(selectedWire.id, gaugeAwg)}
                onMaterial={(material) => onEditWireMaterial(selectedWire.id, material)}
              />
            ) : (
              <PartInspector
                selected={selectedPart}
                reading={selectedPart ? readings.get(selectedPart.id) : undefined}
                materials={initial.materials}
                projectAmbientC={projectAmbientC}
                validMaterials={
                  selectedPart
                    ? (initial.validMaterialsByDef.get(selectedPart.definition) ?? {})
                    : {}
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
                  const ohms = deriveResistorOhms(
                    selectedPart.parameters,
                    initial.materialResistivity,
                  )
                  if (ohms !== null) onEditParam(selectedPart.id, 'resistance', ohms)
                }}
              />
            ),
          },
          scope: {
            title: 'Scope',
            visible: scopeOpen,
            content: (
              <>
                <ScopePlot
                  result={scopeResult}
                  light={light}
                  windowDuration={scopeWindowSec}
                  channels={scopeChannels}
                  onRemoveChannel={(key) =>
                    setScopeProbes((current) => current.filter((p) => scopeProbeKey(p) !== key))
                  }
                  secPerDiv={scopeSecPerDiv}
                  onSecPerDiv={setScopeSecPerDiv}
                  autoSecPerDiv={scopeAutoWindowSec / H_DIVISIONS}
                  refusal={scopeRefusal}
                  family={scopeFamily}
                  familyNote={scopeFamilyNote}
                  familySources={nodes
                    .filter(
                      (n) => (n.data as { definition?: string }).definition === 'power_source',
                    )
                    .map((n) => n.id)}
                  onTraceFamily={runFamily}
                  onClearFamily={() => {
                    setScopeFamily(null)
                    setScopeFamilyNote(null)
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setScopeResult(null)
                    setScopeRefusal(null)
                  }}
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
              </>
            ),
          },
        }
        return panelGroups(panelLayout, ['parts', 'tools', 'properties', 'scope'], (id) =>
          Boolean(registry[id]?.visible),
        ).map((g) => {
          const stored = activeTab[g.group]
          const active = stored && g.ids.includes(stored) ? stored : g.ids[0]
          const def = active ? registry[active] : undefined
          if (!active || !def) return null
          return (
            <DockablePanel
              key={g.group}
              edge={g.edge}
              tabs={g.ids.flatMap((id) => {
                const entry = registry[id]
                return entry ? [{ id, title: entry.title }] : []
              })}
              activeId={active}
              light={light}
              onActivate={(id) => setActiveTab((cur) => ({ ...cur, [g.group]: id }))}
              onTabDrop={onTabDrop}
            >
              {def.content}
            </DockablePanel>
          )
        })
      })()}
    </div>
  )
}
