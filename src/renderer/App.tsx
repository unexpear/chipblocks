import {
  addEdge,
  Background,
  BackgroundVariant,
  type Connection,
  ConnectionMode,
  ControlButton,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  SelectionMode,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
} from '@xyflow/react'
import { isLight, loadTheme, THEME, type ThemeName } from './theme.ts'
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
import type { Instance } from '../cross-fk-validator.ts'
import { solveTransientThermal } from '../electro-thermal.ts'
import { overcurrentFuseIds } from '../failure-detector.ts'
import { readScalarParam } from '../instance-params.ts'
import { LIGHT_SENSOR_DEFINITIONS, worldWithCastLight } from '../light.ts'
import { solveWithRelays } from '../relay.ts'
import { analyzeTiming } from '../static-timing.ts'
import { STANDARD_AMBIENT_C } from '../thermal-model.ts'
import { type AddableTerminal, BlockInspector, type BlockPortPatch } from './block-inspector.tsx'
import { BlockViewer } from './block-viewer.tsx'
import {
  type BlockData,
  type CanvasEdgeLike as BlockEdgeLike,
  type CanvasNodeLike as BlockNodeLike,
  type BlockPort,
  blockLayout,
  blockPortAliases,
  cloneBlockData,
  edgeTouchesPort,
  flattenBlocks,
  groupSelection,
  movePortAlongEdge,
  type PinSide,
  ungroupBlock,
  withoutOffsets,
} from './blocks.ts'
import { BodePanel } from './bode-panel.tsx'
import { BUILTIN_BLOCKS, buildFrameBuffer, CALCULATOR, CHAR_GEN } from './builtin-blocks.ts'
import { ConnectPointsOverlay, PendingWirePreview } from './canvas-overlays.tsx'
import { CanvasScrollbars } from './canvas-scrollbars.tsx'
import { groundedComponent } from './canvas-to-world.ts'
import { loadCatalogWorld } from './catalog-loader.ts'
import {
  type CircuitFile,
  deserializeCircuit,
  maxIdSuffix,
  serializeCircuit,
} from './circuit-file.ts'
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
import { ContextMenu } from './context-menu.tsx'
import { CoordinateAxes } from './coordinate-axes.tsx'
import { DockablePanel } from './dockable-panel.tsx'
import { BOM_VALUE_PARAMS } from './footprint-assignment.ts'
import {
  CrtScreenContext,
  type CrtScreenData,
  contentionHealth,
  HealthContext,
  mergeHealth,
} from './health.ts'
import { type NetlistReport, NetlistReportCard } from './import-report.tsx'
import { eventMatchesBinding } from './keybinds.ts'
import { parseKicadSchematic } from './kicad-schematic.ts'
import { lassoPathD } from './lasso.ts'
import {
  ENERGY_COLOR,
  FIELD_COLOR,
  fieldReferenceTesla,
  LensContext,
  type LensMode,
} from './lens.ts'
import { type CompiledLogic, compileLogic, type simulateLogic, stepLogic } from './logic-sim.ts'
import { materialCapabilities, validMaterialsByRole } from './material-roles.ts'
import { MathPanel } from './math-panel.tsx'
import { buildMathView } from './math-view.ts'
import { AMMETER_JACKS, MeterProbes, ProbeMarker, terminalNets } from './meter.tsx'
import { type MonteCarloResult, monteCarloAnalysis } from './monte-carlo.ts'
import { multiLeadAliases } from './multi-tap-source.ts'
import {
  AutoRouteContext,
  edgeTypes,
  FrameEdgeContext,
  FrontContext,
  GlobalRoutesContext,
  PartBoxesContext,
  type Point,
  WireColorContext,
  WireGeomContext,
} from './net-edge.tsx'
import { routeAllWires, type WireReq } from './orthogonal-route.ts'
import { detectOutputContention } from './output-contention.ts'
import { PageSettings } from './page-settings.tsx'
import { BLOCK_MIME, DEFINITION_MIME, Palette } from './palette.tsx'
import { panelGroups } from './panel-groups.ts'
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
import { PartPicker } from './part-picker.tsx'
import { buildCrtTraces, type CrtSpot } from './part-readings.ts'
import {
  computeRatsnest,
  deriveBoard,
  offBoardPins,
  type PadBox,
  type PlacementOverride,
  type Rotation,
} from './pcb-board.ts'
import { runDrc } from './pcb-drc.ts'
import { type BomRow, buildManufacturingZip } from './pcb-fab.ts'
import { type BoardLayerId, boardLayers } from './pcb-layers.ts'
import {
  type CopperTrace,
  DEFAULT_ROUTE_CLASS,
  mergeUserCopper,
  routeBoard,
  type Via,
} from './pcb-route.ts'
import {
  buildStackup,
  type CopperWeight,
  DEFAULT_STACKUP_OPTIONS,
  STANDARD_BOARD_THICKNESSES_MM,
  type StackupOptions,
  SURFACE_FINISHES,
  type SurfaceFinishId,
} from './pcb-stackup.ts'
import { BoardView, PcbViewControls } from './pcb-workspace.tsx'
import { canvasWorld } from './pipeline/canvas-world.ts'
import {
  lightCastInputs,
  solveCanvasDispatch,
  solveTransientDispatch,
} from './pipeline/solve-canvas.ts'
import { ProjectBrowser, type ProjectChoice } from './project-browser.tsx'
import { ProjectHub } from './project-hub.tsx'
import { deriveResistorOhms, resistivityOhmM } from './resistor-derive.ts'
import { scanMatrixFromBuffer } from './scan-display.ts'
import { SchematicHierarchy } from './schematic-hierarchy.tsx'
import { fastestSourceHz, ScopePlot, scopeProbeKey, scopeWindow, TRACE_COLORS } from './scope.tsx'
import { H_DIVISIONS, scopeRecordSteps } from './scope-scales.ts'
import { DEFAULT_SHEET, SheetFrame, type SheetSettings } from './sheet-frame.tsx'
import { parseSpiceNetlist, serializeSpiceNetlist } from './spice-netlist.ts'
import { type DeviceNodeData, type Fidelity, nodeTypes, terminalsOf } from './symbols.tsx'
import { tileRow } from './tiling.ts'
import { frameLensRange } from './timeline.ts'
import { TimelinePanel } from './timeline-panel.tsx'
import {
  flipFlopTiming,
  isClockedBlock,
  isSequentialBlock,
  traceTimingPaths,
} from './timing-graph.ts'
import { TimingPanel } from './timing-panel.tsx'
import { type Tool, ToolbarItems } from './toolbar.tsx'
import { CheckpointContext } from './undo-context.ts'
import { checkpoint, emptyHistory, redo, undo } from './undo-history.ts'
import { formatEng } from './units.ts'
import { useBode } from './use-bode.ts'
import { useConnectTool } from './use-connect-tool.ts'
import { useMultimeter } from './use-multimeter.ts'
import { useOscilloscope } from './use-oscilloscope.ts'
import { usePanelLayout } from './use-panel-layout.ts'
import { useSelectionGestures } from './use-selection-gestures.ts'
import { useShortcuts } from './use-shortcuts.tsx'
import { useTimeline } from './use-timeline.ts'
import { useWireTool } from './use-wire-tool.ts'
import {
  findWireCrossings,
  netColor,
  type WireCrossing,
  WireCrossingsOverlay,
} from './wire-crossings.tsx'
import { type SelectedWire, WireInspector } from './wire-inspector.tsx'
import { DEFAULT_WIRE_GAUGE_AWG, DEFAULT_WIRE_MATERIAL } from './wire-length.ts'
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
      onTheme: (callback: (theme: string) => void) => void
      onGridColor: (callback: (color: string) => void) => void
      onGridColorCustom: (callback: () => void) => void
      registerThemes?: (themes: { id: string; label: string }[], active: string) => void
      onSaveRequest: (callback: () => void) => void
      saveCircuitData: (text: string) => Promise<{ ok: boolean; path?: string }>
      onCircuitOpened: (callback: (text: string) => void) => void
      onNetlistOpened?: (callback: (text: string) => void) => void
      onExportNetlistRequest?: (callback: () => void) => void
      saveNetlistData?: (text: string) => Promise<{ ok: boolean; path?: string }>
      saveFabZip?: (data: Uint8Array) => Promise<{ ok: boolean; path?: string }>
      getKeybinds?: () => Promise<Record<string, string>>
      setKeybinds?: (binds: Record<string, string>) => Promise<Record<string, string>>
      onShortcutsOpen?: (callback: () => void) => void
      onSymbolStyle?: (callback: (style: 'ieee' | 'iec') => void) => void
      onEditCopy?: (callback: () => void) => void
      onEditCut?: (callback: () => void) => void
      onEditPaste?: (callback: () => void) => void
      onEditUndo?: (callback: () => void) => void
      onEditRedo?: (callback: () => void) => void
      onEditSelectAll?: (callback: () => void) => void
    }
  }
}

const DRAWN = THEME.wire // a user-drawn wire, not yet solved

// A 0-internal-resistance DC source at v volts — for driving a logic input / rail to a fixed level from
// code (the calculator feeds its result bits into the decoder this way).
const dcSource = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
  internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
})

// The calculator keypad → the real CALCULATOR block's one-hot key inputs (the inverse of the test
// oracle's lineFor). The brain is the gate FSM; a press just asserts one key line for one clock edge.
const CALC_KEYS = [
  'k0',
  'k1',
  'k2',
  'k3',
  'k4',
  'k5',
  'k6',
  'k7',
  'k8',
  'k9',
  'kadd',
  'ksub',
  'kmul',
  'kdiv',
  'keq',
  'kclr',
  'kpm',
  'kdot',
] as const
const KEY_PORT: Record<string, string> = {
  '0': 'k0',
  '1': 'k1',
  '2': 'k2',
  '3': 'k3',
  '4': 'k4',
  '5': 'k5',
  '6': 'k6',
  '7': 'k7',
  '8': 'k8',
  '9': 'k9',
  '+': 'kadd',
  '-': 'ksub',
  '*': 'kmul',
  '/': 'kdiv',
  '=': 'keq',
  C: 'kclr',
  CE: 'kclr',
  '±': 'kpm',
  '.': 'kdot',
}

/** Decode the real CALCULATOR block's outputs (read from a logic solve) into the shown value — the
 *  signed BCD magnitude on display0..39 scaled by the f_ent decimal-point position. Mirrors the test
 *  oracle's readback so the on-screen number matches the gate result exactly. */
function decodeCalc(r: ReturnType<typeof simulateLogic>): {
  value: number
  sig: number
  fent: number
  negative: boolean
  error: boolean
} {
  let sig = 0
  for (let d = 0; d < 10; d++) {
    let dig = 0
    for (let b = 0; b < 4; b++) if (r.value('calc', `display${d * 4 + b}`) === true) dig |= 1 << b
    sig += dig * 10 ** d
  }
  let fent = 0
  for (let b = 0; b < 4; b++) if (r.value('calc', `f_ent${b}`) === true) fent |= 1 << b
  const negative = r.value('calc', 'neg') === true
  const error = r.value('calc', 'error') === true
  return { sig, fent, negative, error, value: (negative ? -sig : sig) / 10 ** fent }
}

// The logic-only harness that runs the real CALCULATOR gate circuit (no analog LEDs). CONSTANT
// topology — built once with every source at its default level (clock LOW, all keys LOW, V+ HIGH);
// pressCalcKey compileLogic's it ONCE (cached) and stepLogic overrides the clock + the pressed key
// each cycle, so the ×/÷ busy loop re-uses the one flatten instead of re-expanding ~9000 gates a cycle.
const CALC_HARNESS_NODES: Record<string, unknown>[] = [
  { id: 'calc', position: { x: 0, y: 0 }, data: { definition: 'block', block: CALCULATOR } },
  {
    id: 'h_vp',
    position: { x: 0, y: 0 },
    data: { definition: 'power_source', parameters: dcSource(5) },
  },
  { id: 'h_g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
  {
    id: 'h_clk',
    position: { x: 0, y: 0 },
    data: { definition: 'power_source', parameters: dcSource(0) },
  },
  ...CALC_KEYS.map((k) => ({
    id: `h_${k}`,
    position: { x: 0, y: 0 },
    data: { definition: 'power_source', parameters: dcSource(0) },
  })),
]
const CALC_HARNESS_EDGES: Record<string, unknown>[] = [
  {
    id: 'h_eclk',
    source: 'h_clk',
    sourceHandle: 'terminal_positive',
    target: 'calc',
    targetHandle: 'clk',
  },
  {
    id: 'h_eclkn',
    source: 'h_clk',
    sourceHandle: 'terminal_negative',
    target: 'h_g',
    targetHandle: 'reference_terminal',
  },
  {
    id: 'h_ep',
    source: 'h_vp',
    sourceHandle: 'terminal_positive',
    target: 'calc',
    targetHandle: 'v_dd',
  },
  {
    id: 'h_epn',
    source: 'h_vp',
    sourceHandle: 'terminal_negative',
    target: 'h_g',
    targetHandle: 'reference_terminal',
  },
  {
    id: 'h_eg',
    source: 'calc',
    sourceHandle: 'gnd',
    target: 'h_g',
    targetHandle: 'reference_terminal',
  },
  ...CALC_KEYS.flatMap((k) => [
    {
      id: `h_e_${k}`,
      source: `h_${k}`,
      sourceHandle: 'terminal_positive',
      target: 'calc',
      targetHandle: k,
    },
    {
      id: `h_en_${k}`,
      source: `h_${k}`,
      sourceHandle: 'terminal_negative',
      target: 'h_g',
      targetHandle: 'reference_terminal',
    },
  ]),
]

/**
 * Map a loaded / imported CircuitFile to the canvas's React Flow nodes + edges. Shared by Open (a
 * .chipblocks file) and Import (a parsed netlist) so the two paths build the canvas identically.
 */
function circuitFileToFlow(file: CircuitFile) {
  const nodes = file.nodes.map((n) => ({
    id: n.id,
    type: (n.definition === 'block'
      ? 'block'
      : n.definition === 'junction'
        ? 'junction'
        : 'device') as 'block' | 'junction' | 'device',
    position: { x: n.x, y: n.y },
    data: {
      definition: n.definition,
      label: n.block?.name ?? n.id,
      ...(n.rotation ? { rotation: n.rotation } : {}),
      ...(n.parameters ? { parameters: n.parameters } : {}),
      ...(n.block ? { block: n.block } : {}),
    },
  }))
  const edges = file.wires.map((w) => ({
    id: w.id,
    source: w.source,
    sourceHandle: w.sourceHandle,
    target: w.target,
    targetHandle: w.targetHandle,
    type: 'net',
    deletable: true,
    style: { stroke: DRAWN },
    ...(w.waypoints || w.curved || typeof w.gaugeAwg === 'number' || typeof w.material === 'string'
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
  }))
  return { nodes, edges }
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
    background: active ? THEME.surfaceActive : light ? THEME.textBright : THEME.surfaceRaised,
    border: active
      ? `1px solid ${THEME.accentBlue}`
      : light
        ? `1px solid ${THEME.textPrimary}`
        : `1px solid ${THEME.borderSubtle}`,
    color: active ? THEME.textBright : light ? THEME.textFaint : THEME.textSoft,
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
  // Two gates before the editor: the project browser (pick a purpose + template, Unreal-style),
  // then the project hub (KiCad-style — the project's files + the tools that work on it). Null
  // project = on the browser; project set but not yet in the editor = on the hub.
  const [project, setProject] = useState<ProjectChoice | null>(null)
  const [inEditor, setInEditor] = useState(false)
  if (project === null) {
    return (
      <ProjectBrowser
        onCreate={(choice) => {
          setProject(choice)
          setInEditor(false)
        }}
      />
    )
  }
  if (!inEditor) {
    return (
      <ProjectHub
        project={project}
        onOpenEditor={() => setInEditor(true)}
        onBack={() => setProject(null)}
      />
    )
  }
  return (
    <ReactFlowProvider>
      <Canvas project={project} />
    </ReactFlowProvider>
  )
}

/** The parts a template drops onto a fresh canvas (placed, not yet wired). A template
 *  not listed here opens a blank canvas — the relevant parts are in the palette. */
const TEMPLATE_PARTS: Record<string, { def: string; x: number; y: number }[]> = {
  'dc-motor': [
    { def: 'power_source', x: 80, y: 180 },
    { def: 'dc_motor', x: 380, y: 180 },
    { def: 'ground', x: 80, y: 380 },
  ],
  electromagnet: [
    { def: 'power_source', x: 80, y: 180 },
    { def: 'electromagnet', x: 380, y: 180 },
    { def: 'ground', x: 80, y: 380 },
  ],
  transformer: [{ def: 'transformer', x: 260, y: 220 }],
  relay: [{ def: 'relay', x: 260, y: 220 }],
  psu: [
    { def: 'power_source', x: 80, y: 220 },
    { def: 'transformer', x: 340, y: 220 },
  ],
  amp: [{ def: 'op_amp', x: 260, y: 220 }],
  register: [{ def: 'logic_register_4bit', x: 240, y: 220 }],
}

function templateNodes(template: string, depth: 'block' | 'design'): Node[] {
  const parts = TEMPLATE_PARTS[template] ?? []
  return parts.map((p, i) => {
    const parameters = { ...defaultParameters(p.def) }
    // The browser's "design it" choice opens a designable part (the motor) straight into
    // its design mode, so its behaviour comes from the iron / magnets / winding.
    if (depth === 'design' && parameters.design_mode !== undefined) {
      parameters.design_mode = { value: 'design' }
    }
    return {
      id: `${p.def}_${i + 1}`,
      type: 'device',
      position: { x: p.x, y: p.y },
      data: { definition: p.def, label: `${p.def}_${i + 1}`, parameters },
    }
  })
}

/** Snap-to-grid step (px) — parts align to the 20 px major grid (the bold lines) when snap is on. */
const SNAP_GRID: [number, number] = [20, 20]

function Canvas({ project }: { project: ProjectChoice }) {
  const initial = useMemo(() => {
    // The catalog world supplies the part + material DEFINITIONS (for the material
    // dropdowns); the canvas itself starts from the chosen template's parts, not the
    // catalog demo layout.
    const world = loadCatalogWorld()
    const nodes: Node[] = templateNodes(project.template, project.depth)
    // A fresh project starts unwired — the user draws the connections (or a richer
    // wired starter lands later). The re-solve fills current/length/resistance.
    const baseEdges: Edge[] = []
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
    const solved = solveCanvasDispatch(nodes, baseEdges)
    return {
      nodes,
      edges: solved.edges,
      health: solved.health,
      readings: solved.readings,
      terminalVolts: solved.terminalVolts,
      live: solved.live,
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
  }, [project.template, project.depth])

  // Live React Flow state — nodes are draggable (S19-v3-3); setNodes/setEdges
  // also let the palette drop new parts and the user draw new wires.
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  // Part collision: where each dragged part started, so a drop that lands on another part
  // snaps back — parts are solid and can't occupy the same space.
  const dragStartPos = useRef(new Map<string, { x: number; y: number }>())
  // Live part boxes (flow coords) so each wire can tell whether it runs through a part.
  const partBoxes = useMemo(
    () =>
      nodes
        .filter((n) => n.type === 'device' || n.type === 'block')
        .map((n) => {
          // React Flow hasn't measured a freshly-dropped node yet, so n.measured is undefined. Fall
          // back to the block's OWN layout size (a 7x7 matrix is ~200px wide, NOT the old 88x56 default)
          // so the router treats the real footprint as an obstacle and routes AROUND it, not through it.
          const block = (n.data as { block?: BlockData }).block
          const laid = block ? blockLayout(block.ports, block.size) : undefined
          return {
            id: n.id,
            x: n.position.x,
            y: n.position.y,
            w: n.measured?.width ?? laid?.width ?? 88,
            h: n.measured?.height ?? laid?.height ?? 56,
          }
        }),
    [nodes],
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  // Per-part health (lit / overstressed) — drives the success/failure animations.
  const [health, setHealth] = useState(initial.health)
  const [live, setLive] = useState(initial.live)
  // Output / driver-contention runs off the live nodes+edges (so it updates the instant you wire or
  // retype a pin); the tri-state rule also reads each enable's level from the latest solve (`live`).
  const contentionFindings = useMemo(
    () => detectOutputContention(nodes, edges, live),
    [nodes, edges, live],
  )
  const shownHealth = useMemo(
    () => mergeHealth(health, contentionHealth(contentionFindings)),
    [health, contentionFindings],
  )
  // Static timing (rung 3): the design's max clock frequency + critical register-to-register path,
  // from the REAL gate delays (timing-graph traces the paths and sums each gate's delay from its
  // transistors). The flip-flop's own t_cq / setup / hold are traced from its master-slave latches.
  const timing = useMemo(() => {
    const supplyVoltage = live ? live.threshold * 2 : 5
    let clockPeriod = Number.POSITIVE_INFINITY
    for (const n of nodes) {
      if ((n.data as { definition?: string })?.definition !== 'power_source') continue
      const f = readScalarParam(
        { parameters: (n.data as DeviceNodeData).parameters } as Instance,
        'frequency',
      )
      if (f !== undefined && f > 0) clockPeriod = Math.min(clockPeriod, 1 / f)
    }
    const timingOpts = { wireCapacitance: 5e-12, defaultInputCapacitance: 120e-12 }
    const registerTiming = flipFlopTiming(supplyVoltage, timingOpts)
    const paths = traceTimingPaths(nodes, edges, { supplyVoltage, ...timingOpts })
    const report = analyzeTiming(paths, registerTiming, clockPeriod, 0)
    const hasRegisters = nodes.some((n) => {
      const data = n.data as { definition?: string; block?: BlockData }
      return (
        isSequentialBlock(data?.definition ?? '') ||
        (data?.block ? isClockedBlock(data.block) : false)
      )
    })
    return { report, hasRegisters, clockDetected: Number.isFinite(clockPeriod) }
  }, [nodes, edges, live])
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
  // Live handles to the Connect/Wire tool state machines, so the DEV CDP surface (__chip.connectProbe,
  // __chip.wireSetup) can exercise their real handlers. Assigned once each hook runs, below.
  const connectRef = useRef<ReturnType<typeof useConnectTool> | null>(null)
  const wireRef = useRef<ReturnType<typeof useWireTool> | null>(null)
  const scopeRef = useRef<{
    probes: unknown[]
    channels: string[]
    open: boolean
    status: string | null
    windowSec: number
    refusal: string | null
  } | null>(null)
  const timelineRef = useRef<{
    open: boolean
    index: number
    frontMode: boolean
    status: string | null
    frames: number
    frameEdges: number | null
    frontActive: boolean
  } | null>(null)
  const meterRef = useRef<{
    redProbe: { nodeId: string; handleId: string } | undefined
    blackProbe: { nodeId: string; handleId: string } | undefined
    readout: string | null
  } | null>(null)
  const { screenToFlowPosition, fitView, deleteElements } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const dropCount = useRef(initial.nodes.length)
  // The Add-Part pop-up (the KiCad-style Choose-a-part dialog) — open state lives here.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sheetSettings, setSheetSettings] = useState<SheetSettings>(DEFAULT_SHEET)
  const [showSheet, setShowSheet] = useState(true)
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false)
  // The save handler (registered with [nodes, edges] deps) reads the latest sheet via this ref.
  const sheetSettingsRef = useRef(sheetSettings)
  sheetSettingsRef.current = sheetSettings
  // The canvas part's right-click menu — its screen position, or null when closed.
  const [canvasMenu, setCanvasMenu] = useState<{
    x: number
    y: number
    kind: 'part' | 'pane'
    flow?: { x: number; y: number }
  } | null>(null)

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

  // Wire-to-wire crossings: each wire reports its drawn path here; the overlay finds where two
  // wires cross (an open dot), and a click JOINS them at a junction (a filled dot = one net).
  const [wireGeoms, setWireGeoms] = useState(new Map<string, Point[]>())
  const reportWireGeom = useCallback((wireId: string, points: Point[]) => {
    setWireGeoms((prev) => {
      const next = new Map(prev)
      next.set(wireId, points)
      return next
    })
  }, [])
  const wireCrossings = useMemo(
    () =>
      findWireCrossings(
        wireGeoms,
        edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
        })),
      ),
    [wireGeoms, edges],
  )
  // Optional, visual-only: give each WIRE its own dull shade so one wire can be traced end to end.
  const [colorWires, setColorWires] = useState(false)
  // A dull colour per WIRE (cycled by index, empty when the toggle is off) — each wire its own shade so
  // you can pick one and follow it through a tangle. Purely visual; never touches the solve.
  const netColorByEdge = useMemo(() => {
    const map = new Map<string, string>()
    if (!colorWires) return map
    edges.forEach((e, i) => {
      map.set(e.id, netColor(i))
    })
    return map
  }, [colorWires, edges])
  const joinCrossing = useCallback(
    (c: WireCrossing) => {
      checkpointAction('join-wires')
      const jid = `j_${crypto.randomUUID().slice(0, 8)}`
      setNodes((ns) => [
        ...ns,
        {
          id: jid,
          type: 'junction',
          position: { x: c.x - 7, y: c.y - 7 },
          data: { fromCrossing: true },
        },
      ])
      setEdges((es) => {
        const ea = es.find((e) => e.id === c.edgeA)
        const eb = es.find((e) => e.id === c.edgeB)
        if (!ea || !eb) return es
        const split = (e: Edge): Edge[] => [
          {
            ...e,
            id: `${e.id}~a`,
            target: jid,
            targetHandle: 'tie',
            data: { ...e.data, waypoints: [] },
          },
          {
            ...e,
            id: `${e.id}~b`,
            source: jid,
            sourceHandle: 'tie',
            data: { ...e.data, waypoints: [] },
          },
        ]
        return [
          ...es.filter((e) => e.id !== c.edgeA && e.id !== c.edgeB),
          ...split(ea),
          ...split(eb),
        ]
      })
    },
    [checkpointAction, setNodes, setEdges],
  )

  // Un-join: clicking a crossing junction splits the wires back apart. The join encoded each
  // original wire id as `<id>~a` / `<id>~b`, so pair the four segments by that prefix, merge each
  // pair back into its original wire, and remove the junction — the open crossing returns.
  const unjoinCrossing = useCallback(
    (jid: string) => {
      checkpointAction('split-wires')
      setEdges((es) => {
        const groups = new Map<string, Edge[]>()
        for (const e of es) {
          if (e.source !== jid && e.target !== jid) continue
          const orig = e.id.replace(/~[ab]$/, '')
          groups.set(orig, [...(groups.get(orig) ?? []), e])
        }
        const merged: Edge[] = []
        for (const halves of groups.values()) {
          if (halves.length !== 2) continue
          const aHalf = halves.find((e) => e.target === jid)
          const bHalf = halves.find((e) => e.source === jid)
          if (!aHalf || !bHalf) continue
          merged.push({
            ...aHalf,
            id: aHalf.id.replace(/~[ab]$/, ''),
            target: bHalf.target,
            targetHandle: bHalf.targetHandle ?? null,
            data: { ...aHalf.data, waypoints: [] },
          })
        }
        return [...es.filter((e) => e.source !== jid && e.target !== jid), ...merged]
      })
      setNodes((ns) => ns.filter((n) => n.id !== jid))
    },
    [checkpointAction, setEdges, setNodes],
  )

  // The import-netlist report (rung 1b): what converted, what did not — shown until dismissed.
  const [netlistReport, setNetlistReport] = useState<NetlistReport | null>(null)

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
        sheetSettingsRef.current,
      )
      void bridge.saveCircuitData(JSON.stringify(file, null, 2))
    })
  }, [nodes, edges])

  // Export (rung 2): serialize the canvas to a CircuitFile, then to a SPICE netlist; hand the text to
  // the main process to write, and show the report — what exported, what has no SPICE equivalent.
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.onExportNetlistRequest === undefined) return
    bridge.onExportNetlistRequest(() => {
      const file = serializeCircuit(
        nodes.map((n) => ({ id: n.id, position: n.position, data: n.data as DeviceNodeData })),
        edges,
        projectAmbientRef.current,
      )
      const { netlist, unsupported, warnings } = serializeSpiceNetlist(file)
      const count =
        file.nodes.filter((n) => n.definition !== 'ground' && n.definition !== 'junction').length -
        unsupported.length
      void bridge.saveNetlistData?.(netlist)
      setNetlistReport({ kind: 'export', count, unsupported, warnings })
    })
  }, [nodes, edges])

  // Hand-placed spots on the PCB (drag / R on the board) — the auto row only seeds where a part
  // starts. Declared up here because the file Open/Import handlers below must clear it: node ids
  // repeat across files (every canvas mints resistor_1 …), so a loaded circuit would otherwise
  // inherit the previous file's hand placements on any id collision.
  const [pcbPlacements, setPcbPlacements] = useState<ReadonlyMap<string, PlacementOverride>>(
    new Map(),
  )

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
      // Restore the saved drawing sheet (page size + title block); an older file has none → keep the
      // current sheet. Merge over the default so a partial/old sheet still fills every field.
      if (result.file.sheet) setSheetSettings({ ...DEFAULT_SHEET, ...result.file.sheet })
      const flow = circuitFileToFlow(result.file)
      setNodes(flow.nodes)
      setEdges(flow.edges)
      setPcbPlacements(new Map()) // the loaded circuit starts from its own auto board
      dropCount.current = maxIdSuffix(result.file.nodes)
      window.setTimeout(() => fitView({ padding: 0.15 }), 80)
    })
  }, [setNodes, setEdges, fitView, checkpointAction])

  // Import (rung 1b): a SPICE netlist arrives as raw text; parse it to a CircuitFile, drop it on the
  // canvas exactly the way Open does, and surface the report — what converted, what didn't, what we
  // assumed. A netlist carries no board ambient, so it loads at the standard 25 °C.
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.onNetlistOpened === undefined) return
    bridge.onNetlistOpened((text) => {
      // SPICE and KiCad both arrive on this channel; tell them apart by the file's own header.
      const isKicad = text.trimStart().startsWith('(kicad_sch')
      const { circuit, unsupported, warnings } = isKicad
        ? parseKicadSchematic(text)
        : parseSpiceNetlist(text)
      checkpointAction('import netlist')
      projectAmbientRef.current = STANDARD_AMBIENT_C
      setProjectAmbientC(STANDARD_AMBIENT_C)
      const flow = circuitFileToFlow(circuit)
      setNodes(flow.nodes)
      setEdges(flow.edges)
      setPcbPlacements(new Map()) // imported netlists start from their own auto board
      dropCount.current = maxIdSuffix(circuit.nodes)
      window.setTimeout(() => fitView({ padding: 0.15 }), 80)
      setNetlistReport({ kind: 'import', count: circuit.nodes.length, unsupported, warnings })
    })
  }, [setNodes, setEdges, fitView, checkpointAction])

  // The dockable-panel layout (S19-v3-10 / Sprint 21) — where each panel docks, which tab is active in
  // each stacked group, and the drag-to-dock / drag-to-stack handler — lives in usePanelLayout now
  // (pure UI state, no circuit coupling). Destructured to the same names the panel groups + drop use.
  const { panelLayout, activeTab, setActiveTab, onTabDrop } = usePanelLayout()
  // Active tool: 'select' (move parts) or 'wire' (parts locked; drag draws wires).
  const [tool, setTool] = useState<Tool>('select')
  // Snap-to-grid (optional): OFF by default — placement stays free, the way it has always worked —
  // and toggled from the canvas controls. When on, dragged AND dropped parts align to SNAP_GRID.
  const [snapToGrid, setSnapToGrid] = useState(false)
  // Opt-in canvas auto-router (default OFF — routing belongs to the user). ON: plain wires (no
  // hand-dropped corners) route themselves as straight H/V lines around the parts, and carry the
  // resistance of that ACTUAL routed length (fed back in via the reported wire geometry below).
  // Default ON: wires route themselves as clean orthogonal (right-angle) lanes around the parts — never a
  // diagonal tangle. The toolbar toggle can turn it off for hand-drawn paths.
  const [autoRouteWires, setAutoRouteWires] = useState(true)
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
  const [theme, setTheme] = useState<ThemeName>(loadTheme)
  const [gridColor, setGridColor] = useState('#3a3a3f')
  const [showGridColorPicker, setShowGridColorPicker] = useState(false)
  const light = isLight(theme)
  // The native Settings menu (electron/main.ts) pushes appearance over IPC.
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge === undefined) return
    bridge.onGridColor((next) => setGridColor(next))
    bridge.onGridColorCustom(() => setShowGridColorPicker(true))
  }, [])

  // The theme switcher is wired at the app entry (main.tsx) so it works on every screen; the
  // editor only needs to flip its light/dark styling when the chosen theme changes.
  useEffect(() => {
    const onThemeChange = (event: Event) => setTheme((event as CustomEvent<ThemeName>).detail)
    window.addEventListener('chipblocks:theme', onThemeChange)
    return () => window.removeEventListener('chipblocks:theme', onThemeChange)
  }, [])

  // Stable refs so the live re-solve can read the auto-route toggle + the wires' CURRENT routed
  // geometry without being re-created every time that geometry changes.
  const wireGeomsRef = useRef(wireGeoms)
  wireGeomsRef.current = wireGeoms
  const autoRouteWiresRef = useRef(autoRouteWires)
  autoRouteWiresRef.current = autoRouteWires
  const partBoxesRef = useRef(partBoxes)
  partBoxesRef.current = partBoxes
  // Sequential logic: the held bit of every latch / flip-flop, persisted across re-solves so state stays
  // put — toggling a clock source + re-solving advances it. Keyed by net, so a different circuit's nets
  // simply don't match (no stale seeding).
  const logicStateRef = useRef(new Map<string, boolean>())
  const terminalVoltsRef = useRef(terminalVolts)
  terminalVoltsRef.current = terminalVolts

  // GLOBAL auto-router (the congestion-aware engine): when auto-route is on, route ALL wires TOGETHER on
  // one shared grid so they spread into clean lanes instead of each self-routing into the same channel.
  // Keyed on the wires' ENDPOINTS + the part boxes (NOT their full paths) and debounced — so it recomputes
  // when a pin moves but NOT when a path changes. That's the convergence guard: a wire reports back the
  // same endpoints whatever its routed middle, so the render→route→render settles in one pass.
  const [globalRoutes, setGlobalRoutes] = useState<Map<string, Point[]> | null>(null)
  const routeEndpointKey = useMemo(() => {
    const parts: string[] = []
    for (const [wid, pts] of wireGeoms) {
      const a = pts[0]
      const b = pts[pts.length - 1]
      if (a && b)
        parts.push(
          `${wid}:${Math.round(a.x)},${Math.round(a.y)}>${Math.round(b.x)},${Math.round(b.y)}`,
        )
    }
    return parts.sort().join('|')
  }, [wireGeoms])
  const partBoxKey = useMemo(
    () =>
      partBoxes
        .map(
          (b) =>
            `${b.id}:${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`,
        )
        .join('|'),
    [partBoxes],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on endpoints + boxes (read live via refs in the timeout), NOT the path geoms — that IS the convergence guard; depending on wireGeoms directly would loop.
  useEffect(() => {
    if (!autoRouteWires) {
      setGlobalRoutes(null)
      return
    }
    const t = setTimeout(() => {
      const reqs: WireReq[] = []
      for (const [wid, pts] of wireGeomsRef.current) {
        const a = pts[0]
        const b = pts[pts.length - 1]
        if (a && b) reqs.push({ id: wid, from: a, to: b })
      }
      const routed =
        reqs.length > 0 ? routeAllWires(reqs, partBoxesRef.current) : new Map<string, Point[]>()
      setGlobalRoutes(routed.size > 0 ? routed : null)
    }, 60)
    return () => clearTimeout(t)
  }, [autoRouteWires, routeEndpointKey, partBoxKey])

  // The live re-solve: rebuild + solve the canvas, then push the new wire currents
  // AND the new part health. Stable identity (only setters in deps).
  const reSolve = useCallback(
    (nodeList: Node[], edgeList: Edge[]) => {
      // When auto-routing is on, hand the solve each wire's actual routed path so its resistance is
      // the routed length, not the straight-line distance (closes the draw-but-don't-measure gap).
      const routed = autoRouteWiresRef.current ? wireGeomsRef.current : undefined
      const solveStart = performance.now()
      const solved = solveCanvasDispatch(
        nodeList,
        edgeList,
        projectAmbientRef.current,
        routed,
        logicStateRef.current,
      )
      ;(window as unknown as { __solveMs?: number }).__solveMs = Math.round(
        performance.now() - solveStart,
      )
      setEdges(solved.edges)
      setHealth(solved.health)
      setReadings(solved.readings)
      setLive(solved.live)
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
  const [crtTraces, setCrtTraces] = useState<
    Map<string, { points: CrtSpot[]; brightness: number }>
  >(new Map())
  // The per-CRT beam data the canvas reads (CrtScreenContext) so a CRT draws its REAL screen on the
  // canvas: the beam locus + brightness from the last transient run (crtSpotTrace), with the latest
  // point as the live spot. Empty until a scope/timeline run fills crtTraces.
  const crtScreens = useMemo(() => {
    const m = new Map<string, CrtScreenData>()
    for (const [id, t] of crtTraces) {
      const last = t.points.at(-1)
      m.set(id, { spot: last ?? { x: 0, y: 0 }, brightness: t.brightness, trace: t.points })
    }
    return m
  }, [crtTraces])
  // Timeline playback + the travelling-charge front (Sprint 22) live in useTimeline now: the panel
  // state, the played-back frame → per-wire values, the spatial turn-on wave, and the live-re-run
  // effect. Its couplings — the nodes/wires, the warm solved world, and the project ambient — are
  // injected; destructured to the same names the wires' contexts, the lens range, the toolbar, and
  // the panel already use. crtTraces + lensState stay in App (shared with the scope / broader canvas).
  const {
    timelineOpen,
    setTimelineOpen,
    timelineIndex,
    setTimelineIndex,
    frontMode,
    setFrontMode,
    frameEdges,
    frontState,
    displayResult,
  } = useTimeline({ nodes, edges, solvedWorld, projectAmbientRef })
  timelineRef.current = {
    open: timelineOpen,
    index: timelineIndex,
    frontMode,
    status: displayResult?.status ?? null,
    frames: displayResult?.series.length ?? 0,
    frameEdges: frameEdges?.size ?? null,
    frontActive: frontState !== null,
  }

  // Math panel (S19-v3-63): the equations behind the current solution, derived
  // live from the same solved state the canvas shows.
  const [showMath, setShowMath] = useState(false)
  // PCB view: the physical layout — the footprinted parts placed on a board. Derived from the
  // schematic parts (each part → its footprint → a spot on the board); re-derives as parts change.
  const [pcbOpen, setPcbOpen] = useState(false)
  // Which surface the MAIN building area shows: the schematic canvas (default) or the full-size board
  // workspace — the board as a first-class editing surface, not just the dock panel. The panel stays.
  const [workspaceMode, setWorkspaceMode] = useState<'schematic' | 'board'>('schematic')
  const onWorkspace = useCallback(
    () => setWorkspaceMode((m) => (m === 'board' ? 'schematic' : 'board')),
    [],
  )
  // The PCB derivation (board → router → DRC) runs when EITHER the dock panel is open OR the board
  // workspace is showing — so the full-size workspace derives real copper without forcing the dock open.
  const pcbActive = pcbOpen || workspaceMode === 'board'
  // The user's HAND-DRAWN copper (the route/via tools) — kept separate from the auto-router's output so
  // a part drag (which re-runs the router) never wipes it; merged back in via pcbMergedRouting below.
  const [userTraces, setUserTraces] = useState<CopperTrace[]>([])
  const [userVias, setUserVias] = useState<Via[]>([])
  // The board-editing tool + the route being laid (click a pad → corners → a pad, like the wire tool).
  const [boardTool, setBoardTool] = useState<'select' | 'route' | 'via'>('select')
  const [pendingRoute, setPendingRoute] = useState<{
    net: string
    layer: 'top' | 'bottom'
    points: { x: number; y: number }[]
  } | null>(null)
  const [routeCursor, setRouteCursor] = useState<{ x: number; y: number } | null>(null)
  const pcbBoard = useMemo(
    () =>
      deriveBoard(
        nodes.map((n) => ({ id: n.id, definition: (n.data as DeviceNodeData).definition })),
        pcbPlacements,
      ),
    [nodes, pcbPlacements],
  )
  const pcbBoardRef = useRef(pcbBoard)
  pcbBoardRef.current = pcbBoard
  // Hand-placed spots for parts that leave the schematic are dropped. (File Open/Import clear the
  // whole map separately — id collisions across files are the norm, and this prune can't see them.)
  useEffect(() => {
    setPcbPlacements((cur) => {
      if (cur.size === 0) return cur
      const ids = new Set(nodes.map((n) => n.id))
      if ([...cur.keys()].every((id) => ids.has(id))) return cur
      return new Map([...cur].filter(([id]) => ids.has(id)))
    })
  }, [nodes])
  const onPcbMove = useCallback((partId: string, x: number, y: number) => {
    // A drag can outlive its part (deleted mid-drag) — never re-insert an override for a ghost.
    if (!nodesRef.current.some((n) => n.id === partId)) return
    setPcbPlacements((cur) => {
      const next = new Map(cur)
      const prev = cur.get(partId)
      next.set(partId, { x, y, rotation: prev?.rotation ?? 0 })
      return next
    })
  }, [])
  const onPcbRotate = useCallback((partId: string, rotation: Rotation) => {
    if (!nodesRef.current.some((n) => n.id === partId)) return
    setPcbPlacements((cur) => {
      const next = new Map(cur)
      const prev = cur.get(partId)
      if (prev === undefined) {
        // Rotating a part still on its auto spot: pin its current derived position first, so the
        // turn happens in place instead of snapping the part back to a fresh auto seed.
        const pl = pcbBoardRef.current.placements.find((p) => p.partId === partId)
        if (pl === undefined) return cur
        next.set(partId, { x: pl.x, y: pl.y, rotation })
      } else {
        next.set(partId, { ...prev, rotation })
      }
      return next
    })
  }, [])
  // The ratsnest: the unrouted pad-to-pad connections the board owes, read from the SAME
  // canvas→world nets the solver uses (grounds + named rails merge exactly like they solve).
  // Only derived while the panel is open — the world walk isn't free on big canvases.
  const pcbRatsnest = useMemo(
    () =>
      pcbActive
        ? computeRatsnest(canvasWorld(nodes, edges).world, pcbBoard)
        : { airwires: [], padBoxes: [] },
    [pcbActive, nodes, edges, pcbBoard],
  )
  // The copper: every airwire the single-layer router could turn into a real trace; what it couldn't
  // stays an airwire, honestly counted. Re-routes live as parts move.
  const pcbRouting = useMemo(
    () => (pcbActive ? routeBoard(pcbRatsnest) : { traces: [], vias: [], unrouted: [] }),
    [pcbActive, pcbRatsnest],
  )
  // The auto-router's copper unioned with the user's hand-drawn traces/vias — the SINGLE routing every
  // downstream reader uses (views, DRC, export). Merging also recomputes the owed list, so hand-routing
  // a connection the auto-router couldn't take marks it done and lets the board export.
  const pcbMergedRouting = useMemo(
    () => mergeUserCopper(pcbRouting, userTraces, userVias),
    [pcbRouting, userTraces, userVias],
  )
  // Design-rule check — the board's failure-mode pass (cited limits), re-run live like the routing.
  const pcbDrc = useMemo(
    () => (pcbActive ? runDrc(pcbBoard, pcbRatsnest, pcbMergedRouting) : []),
    [pcbActive, pcbBoard, pcbRatsnest, pcbMergedRouting],
  )
  // The header's "wired pins not on the board" count reads the UN-flattened schematic — the pins the
  // user actually drew — never the expanded world (whose pack/block internals a user can't point at).
  const pcbOffBoard = useMemo(
    () =>
      pcbActive
        ? offBoardPins(
            nodes.map((n) => ({ id: n.id, definition: (n.data as DeviceNodeData).definition })),
            edges,
            pcbBoard,
          )
        : 0,
    [pcbActive, nodes, edges, pcbBoard],
  )
  // Why the manufacturing ZIP can't be exported yet — empty exactly when the board is complete
  // (parts placed, everything routed, DRC clean, no wired pin missing its footprint). The export
  // button reads this: the ZIP is never offered for a board a fab would manufacture into garbage.
  const pcbFabProblems = useMemo(() => {
    const problems: string[] = []
    if (pcbBoard.placements.length === 0) problems.push('no parts on the board')
    if (pcbOffBoard > 0) {
      problems.push(`${pcbOffBoard} wired pin${pcbOffBoard === 1 ? '' : 's'} not on the board`)
    }
    if (pcbMergedRouting.unrouted.length > 0) {
      problems.push(
        `${pcbMergedRouting.unrouted.length} unrouted connection${pcbMergedRouting.unrouted.length === 1 ? '' : 's'}`,
      )
    }
    if (pcbDrc.length > 0) {
      problems.push(`${pcbDrc.length} DRC violation${pcbDrc.length === 1 ? '' : 's'}`)
    }
    return problems
  }, [pcbBoard, pcbOffBoard, pcbMergedRouting, pcbDrc])
  // The board's physical stack-up — the fab-order spec that goes in the manufacturing ZIP. The user
  // edits the knobs (finished thickness, copper weight, surface finish) in the PCB panel; the
  // cross-section (the FR4 core filling to the chosen thickness) is rebuilt from them.
  const [pcbStackupOptions, setPcbStackupOptions] =
    useState<StackupOptions>(DEFAULT_STACKUP_OPTIONS)
  const pcbStackup = useMemo(() => buildStackup(pcbStackupOptions), [pcbStackupOptions])
  // The PCB view mode: the full flat layout; the LAMINATION as a stack of paper (one sheet at a
  // time, paged up/down); or the 3-D exploded view (the sheets pulled apart in space, vias bridging
  // the copper planes). The drawable layers come from the stack-up.
  const [pcbViewMode, setPcbViewMode] = useState<'flat' | 'layers' | 'exploded'>('flat')
  const [pcbActiveLayerId, setPcbActiveLayerId] = useState<BoardLayerId>('f_cu')
  const pcbLayers = useMemo(() => boardLayers(pcbStackup), [pcbStackup])
  const pcbActiveLayerIndex = pcbLayers.findIndex((l) => l.id === pcbActiveLayerId)
  const stepPcbLayer = useCallback(
    (delta: number) => {
      setPcbActiveLayerId((cur) => {
        const idx = pcbLayers.findIndex((l) => l.id === cur)
        const next = Math.min(Math.max(idx + delta, 0), pcbLayers.length - 1)
        return pcbLayers[next]?.id ?? cur
      })
    },
    [pcbLayers],
  )
  // The copper layer new traces land on — the bottom sheet routes bottom copper, everything else top.
  // In Layers mode the ▲/▼ pager picks it; a Top/Bottom control sets it directly in any mode.
  const activeCopperLayer: 'top' | 'bottom' = pcbActiveLayerId === 'b_cu' ? 'bottom' : 'top'
  // The ROUTE tool state machine (click-based, like the wire tool): start on a pad (net inferred),
  // click open board to drop orthogonal (H-then-V) corners, click a same-net pad to finish → a real
  // CopperTrace on the active layer. It joins pcbMergedRouting, so it draws, DRCs, and ships in the ZIP.
  const onBoardRouteClick = useCallback(
    (mm: { x: number; y: number }, pad: PadBox | null) => {
      if (boardTool !== 'route') return
      const center = (pb: PadBox) => ({ x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 })
      const appendOrtho = (
        pts: { x: number; y: number }[],
        to: { x: number; y: number },
      ): { x: number; y: number }[] => {
        const last = pts[pts.length - 1]
        if (last === undefined) return [to]
        const corner = { x: to.x, y: last.y } // H then V
        const out = [...pts]
        const same = (a: { x: number; y: number }, b: { x: number; y: number }) =>
          Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
        if (!same(corner, last) && !same(corner, to)) out.push(corner)
        out.push(to)
        return out
      }
      if (pendingRoute === null) {
        if (pad === null) return // a trace must start on a pad
        setPendingRoute({ net: pad.net, layer: activeCopperLayer, points: [center(pad)] })
        return
      }
      if (pad !== null) {
        if (pad.net !== pendingRoute.net) return // can't join a different net
        const points = appendOrtho(pendingRoute.points, center(pad))
        setUserTraces((cur) => [
          ...cur,
          {
            net: pendingRoute.net,
            widthMm: DEFAULT_ROUTE_CLASS.traceWidthMm,
            layer: pendingRoute.layer,
            points,
          },
        ])
        setPendingRoute(null)
        return
      }
      setPendingRoute({ ...pendingRoute, points: appendOrtho(pendingRoute.points, mm) })
    },
    [boardTool, pendingRoute, activeCopperLayer],
  )
  const onBoardRouteMove = useCallback(
    (mm: { x: number; y: number }) => {
      if (boardTool === 'route') setRouteCursor(mm)
    },
    [boardTool],
  )
  // The VIA tool (click-based like the wire tool): click on copper (a pad or a trace) and it drops a
  // plated via there — a real layer-bridging barrel carrying that copper's net, the vertical jump
  // between the two copper layers. Merges into userVias → renders (3-D barrel / 2-D ring), DRCs, ships.
  const onBoardViaClick = useCallback(
    (at: { x: number; y: number }, net: string) => {
      if (boardTool !== 'via') return
      setUserVias((cur) => [
        ...cur,
        {
          net,
          at,
          diameterMm: DEFAULT_ROUTE_CLASS.viaDiameterMm,
          drillMm: DEFAULT_ROUTE_CLASS.viaDrillMm,
        },
      ])
    },
    [boardTool],
  )
  // Leaving the board workspace or switching tools abandons a half-drawn route.
  useEffect(() => {
    if (workspaceMode !== 'board' || boardTool !== 'route') setPendingRoute(null)
  }, [workspaceMode, boardTool])
  const [pcbExportNote, setPcbExportNote] = useState<string | null>(null)
  // A "manufacturing ZIP saved" note is only true for the board it was exported from — any edit
  // to the parts, wires or placements (or loading another file, which replaces all three) makes
  // it stale, and a stale success note is exactly the trust failure the export gating prevents.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps ARE the trigger — any board-defining change invalidates the note
  useEffect(() => {
    setPcbExportNote(null)
  }, [nodes, edges, pcbPlacements, userTraces, userVias])
  const onExportFabZip = useCallback(() => {
    // The archive is assembled by the deterministic engine (Gerbers, drill, BOM, placement,
    // validation report) from the same derived board state the panel shows.
    const file = serializeCircuit(
      nodes.map((n) => ({ id: n.id, position: n.position, data: n.data as DeviceNodeData })),
      edges,
      projectAmbientRef.current,
    )
    const { netlist, unsupported } = serializeSpiceNetlist(file)
    // BOM rows come FROM the board's placements, so the reference is the same deduped short
    // designator (R1, C2) the silkscreen prints and placement.csv keys on — one naming, three files.
    const dataById = new Map(nodes.map((n) => [n.id, n.data as DeviceNodeData]))
    const bomRows: BomRow[] = pcbBoard.placements.flatMap((pl) => {
      const data = dataById.get(pl.partId)
      if (data === undefined) return []
      const valueSpec = BOM_VALUE_PARAMS[data.definition]
      const raw = valueSpec === undefined ? undefined : data.parameters?.[valueSpec.param]?.value
      const v =
        raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
      const amount = v?.kind === 'scalar' && typeof v.amount === 'number' ? v.amount : undefined
      return [
        {
          reference: pl.designator ?? pl.partId,
          definition: data.definition,
          value:
            amount !== undefined && valueSpec !== undefined
              ? formatEng(amount, valueSpec.unit)
              : data.definition,
          footprintId: pl.footprintId,
        },
      ]
    })
    const fab = buildManufacturingZip({
      board: pcbBoard,
      ratsnest: pcbRatsnest,
      routing: pcbMergedRouting,
      drc: pcbDrc,
      offBoardPins: pcbOffBoard,
      bomRows,
      netlistText: netlist,
      netlistUnsupported: unsupported,
      stackup: pcbStackup,
      when: new Date(),
    })
    if (fab.validation.status !== 'pass') {
      setPcbExportNote(`not exported — ${fab.validation.problems.join(' ')}`)
      return
    }
    void window.chipblocks?.saveFabZip?.(fab.bytes).then((r) => {
      setPcbExportNote(r.ok && r.path !== undefined ? `manufacturing ZIP saved — ${r.path}` : null)
    })
  }, [nodes, edges, pcbBoard, pcbRatsnest, pcbMergedRouting, pcbDrc, pcbOffBoard, pcbStackup])
  // The Bode (frequency-response) tool — its panel state, the grounded world the AC sweep runs on,
  // and the output-picking click handler live in useBode now; its couplings (the warm solved world,
  // the active tool) are injected. Destructured to the same names the toolbar, panel and canvas
  // click chain already use.
  const {
    bodeOpen,
    setBodeOpen,
    bodeOutputNet,
    setBodeOutputNet,
    bodePicking,
    setBodePicking,
    bodeWorld,
    onBodeProbeClick,
  } = useBode({ solvedWorld, tool })
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
    const ambientOpts = { projectAmbientC: projectAmbientRef.current }
    setWorstCase(
      worstCaseAnalysis(
        grounded,
        (w) => solveWithRelays(w, ambientOpts).solution,
        ambientOpts.projectAmbientC,
      ),
    )
    setDerating(
      deratingDashboard(
        grounded,
        solveWithRelays(grounded, ambientOpts).solution,
        ambientOpts.projectAmbientC,
      ),
    )
    setMonteCarlo(null)
  }, [solvedWorld])
  const runMonteCarlo = useCallback(() => {
    setMonteCarloRunning(true)
    // Defer the heavy sweep a tick so the "Running…" label paints first.
    window.setTimeout(() => {
      const grounded = groundedComponent(solvedWorld)
      const ambientOpts = { projectAmbientC: projectAmbientRef.current }
      setMonteCarlo(
        monteCarloAnalysis(
          grounded,
          (w) => solveWithRelays(w, ambientOpts).solution,
          undefined,
          ambientOpts.projectAmbientC,
        ),
      )
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
  // One lens at a time: picking a color lens turns Flow off, and turning Flow on clears the
  // color lens — so turning one on always turns off whatever was showing.
  const selectLens = useCallback((next: LensMode) => {
    setLens(next)
    if (next !== 'none') setFlow(false)
  }, [])
  const selectFlow = useCallback((next: boolean) => {
    setFlow(next)
    if (next) setLens('none')
  }, [])
  const lensState = useMemo(() => {
    let vMin = Number.POSITIVE_INFINITY
    let vMax = Number.NEGATIVE_INFINITY
    let maxAbsAmps = 0
    if (frameEdges) {
      // Timeline playback: voltage range + biggest current come from the played-back frame.
      const range = frameLensRange(frameEdges)
      vMin = range.vMin
      vMax = range.vMax
      maxAbsAmps = range.maxAbsAmps
    } else {
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
    }
    const power = new Map<string, number>()
    let pMax = 0
    const temp = new Map<string, number>()
    let tMaxC = 0
    // An electromagnet's concentrated CORE field (a coil's halo comes from this, not
    // from the per-wire current the way a straight wire's does).
    const coilFieldTesla = new Map<string, number>()
    for (const [id, r] of readings) {
      if (typeof r.power === 'number' && r.power > 0) {
        power.set(id, r.power)
        if (r.power > pMax) pMax = r.power
      }
      if (typeof r.temperatureC === 'number') {
        temp.set(id, r.temperatureC)
        if (r.temperatureC > tMaxC) tMaxC = r.temperatureC
      }
      if (typeof r.magneticFluxDensityT === 'number' && r.magneticFluxDensityT > 0) {
        coilFieldTesla.set(id, r.magneticFluxDensityT)
      }
    }
    // Field lens contour level, auto-ranged from the circuit's biggest current.
    const fieldTesla = fieldReferenceTesla(maxAbsAmps)
    // The temp lens measures warmth-rise FROM the board ambient, so a cool board in a
    // warm room reads calm (rise above the room, not above a fixed 25 °C).
    const ambientC = projectAmbientRef.current
    return {
      lens,
      flow,
      vMin,
      vMax,
      power,
      pMax,
      temp,
      tMaxC,
      ambientC,
      fieldTesla,
      coilFieldTesla,
    }
  }, [edges, readings, lens, flow, frameEdges])

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
  // The oscilloscope + curve tracer lives in useOscilloscope now (probes/timebase/refusal/family
  // state, the electro-thermal runScope/runFamily, the live re-run while open, the probe-click
  // handler, and the channel resolution); its couplings — the active tool, the nodes/wires, the warm
  // solved world, the shared terminal→net lookup, the project ambient, and the CRT-trace sink — are
  // injected. Destructured to the same names the panel, the toolbar, the probe badges, and the
  // canvas click chain already use.
  const {
    scopeResult,
    setScopeResult,
    scopeWindowSec,
    scopeSecPerDiv,
    setScopeSecPerDiv,
    scopeAutoWindowSec,
    scopeRefusal,
    setScopeRefusal,
    scopeFamily,
    setScopeFamily,
    scopeFamilyNote,
    setScopeFamilyNote,
    scopeProbes,
    setScopeProbes,
    scopeOpen,
    runScope,
    runFamily,
    onScopeProbeClick,
    scopeChannels,
  } = useOscilloscope({
    tool,
    nodes,
    edges,
    solvedWorld,
    probeNets,
    projectAmbientRef,
    setCrtTraces,
  })
  scopeRef.current = {
    probes: scopeProbes,
    channels: scopeChannels.map((c) => c.label),
    open: scopeOpen,
    status: scopeResult?.status ?? null,
    windowSec: scopeWindowSec,
    refusal: scopeRefusal,
  }
  // The multimeter — its probes/dial/jack/fuse/REL/MINMAX/HOLD state machine, its measurements
  // (Ω, A⎓ + fuse blowing) and its readout all live in useMultimeter now; its couplings to the
  // canvas — the active tool, the wires, the terminal→net lookup, the warm solved world, the live
  // readings, and the project ambient — are injected. Destructured to the same names its many
  // consumers (the panel dial/buttons, the probe markers, the canvas click) already use.
  const {
    redProbe,
    blackProbe,
    meterMode,
    setMeterMode,
    meterJack,
    setMeterJack,
    blownFuses,
    setBlownFuses,
    relOhms,
    setRelOhms,
    minMaxOn,
    setMinMaxOn,
    heldReadout,
    setHeldReadout,
    ohmsReading,
    meterReadout,
    onMeterClick,
  } = useMultimeter({
    tool,
    edges,
    probeNets,
    solvedWorld,
    terminalVolts,
    readings,
    projectAmbientRef,
  })
  meterRef.current = { redProbe, blackProbe, readout: meterReadout?.text ?? null }

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

  // Auto-router physics: when a wire's routed geometry changes (a part moved → it re-routed) or the
  // auto-route toggle flips, re-solve so each wire's resistance tracks its ACTUAL routed length. Live
  // solve only; the routed geometry is reported deduped, so this settles in one extra solve — no loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `wireGeoms` is the re-run trigger (read via the ref inside reSolve, not in the body)
  useEffect(() => {
    if (!alwaysOn || !autoRouteWires) return
    reSolve(nodesRef.current, edgesRef.current)
  }, [alwaysOn, autoRouteWires, wireGeoms, reSolve])

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
  // Keybinds + the Shortcuts panel in one hook so the editor (keydown matching) and the project
  // browser both open it from Settings ▸ Shortcuts; the open request is broadcast (main.tsx).
  const { keybinds, isOpen: shortcutsOpen, panel: shortcutsPanel } = useShortcuts(light)

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
    (
      item?: ClipboardItem,
      placement: 'cursor' | 'center' = 'cursor',
      at?: { x: number; y: number },
    ) => {
      const chosen = item ?? latestItem(clipboard)
      if (chosen === null || chosen.nodes.length === 0) return
      checkpointAction('paste')
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })
      const target = at ?? (placement === 'cursor' ? (lastCursorFlow.current ?? center) : center)
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

  // Rotate / delete / duplicate the current selection — shared by the keyboard shortcuts and the
  // Schematic Hierarchy's right-click menu, so there is one implementation of each.
  const doRotate = useCallback(() => {
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
  }, [nodes, setNodes, checkpointAction])
  const doDelete = useCallback(() => {
    const doomedNodes = nodes.filter((n) => n.selected)
    const doomedEdges = edges.filter((e) => e.selected)
    if (doomedNodes.length === 0 && doomedEdges.length === 0) return
    checkpointAction('delete')
    void deleteElements({ nodes: doomedNodes, edges: doomedEdges })
  }, [nodes, edges, deleteElements, checkpointAction])
  // Centre + zoom the view on a part — the Hierarchy's "Locate" navigates to it.
  const doLocate = useCallback(
    (id: string) => {
      void fitView({ nodes: [{ id }], duration: 400, maxZoom: 1.2 })
    },
    [fitView],
  )
  // The Edit menu's items arrive over IPC. Subscribe once; the ref always
  // points at the latest handlers (which close over live state).
  const doSelectAll = () => {
    setNodes((current) => current.map((n) => ({ ...n, selected: true })))
    setEdges((current) => current.map((e) => ({ ...e, selected: true })))
  }
  const editActions = useRef({
    copy: doCopy,
    cut: doCut,
    paste: () => doPaste(),
    undo: doUndo,
    redo: doRedo,
    selectAll: doSelectAll,
  })
  editActions.current = {
    copy: doCopy,
    cut: doCut,
    paste: () => doPaste(),
    undo: doUndo,
    redo: doRedo,
    selectAll: doSelectAll,
  }
  useEffect(() => {
    const bridge = window.chipblocks
    bridge?.onEditCopy?.(() => editActions.current.copy())
    bridge?.onEditCut?.(() => editActions.current.cut())
    bridge?.onEditPaste?.(() => editActions.current.paste())
    bridge?.onEditUndo?.(() => editActions.current.undo())
    bridge?.onEditRedo?.(() => editActions.current.redo())
    bridge?.onEditSelectAll?.(() => editActions.current.selectAll())
  }, [])

  // The lasso + box-select gestures live in useSelectionGestures now (freeform trail in both
  // coordinate spaces; wires join by TOUCH on release); the couplings — the active tool, the
  // node/edge state, and the coordinate transform — are injected. Destructured to the same names
  // the wrapper's pointer handlers and the trail overlay already use.
  const { lassoPoints, onLassoDown, onLassoMove, onLassoUp, onBoxDown, onBoxMove, onBoxUp } =
    useSelectionGestures({
      tool,
      nodes,
      setNodes,
      setEdges,
      edgesRef,
      screenToFlowPosition,
    })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (shortcutsOpen) return // the panel owns the keyboard while open
      if (eventMatchesBinding(event, keybinds.shortcutsPanel)) {
        window.dispatchEvent(new Event('chipblocks:shortcuts'))
        return
      }
      if (workspaceMode !== 'board' && eventMatchesBinding(event, keybinds.selectAll)) {
        event.preventDefault()
        editActions.current.selectAll()
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
      // The board workspace owns the main area — schematic copy/cut/paste/rotate/delete are inert here
      // (rotating a board part is R on the focused board, handled inside PcbView). Esc abandons a
      // half-drawn route (and drops the route tool back to Select).
      if (workspaceMode === 'board') {
        if (event.key === 'Escape') {
          setPendingRoute(null)
          setBoardTool('select')
        }
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
        doRotate()
        return
      }
      if (
        eventMatchesBinding(event, keybinds.delete) ||
        eventMatchesBinding(event, keybinds.deleteAlt)
      ) {
        doDelete()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    keybinds,
    shortcutsOpen,
    workspaceMode,
    doRotate,
    doDelete,
    doCopy,
    doCut,
    doPaste,
    doUndo,
    doRedo,
  ])

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  // Drop a part from the palette → a new node at the drop point (S19-v3-6).
  // Dropping a BLOCK places an independent copy: internals cloned with fresh
  // ids, parameters deep-copied so each copy is editable on its own.
  // The calculator's BRAIN is the REAL gate circuit (the CALCULATOR block — keypad encoder + control
  // FSM + entry/acc registers + BCD ALU + ×/÷ sequencers, builtin-blocks.ts). calcSolve clocks it on a
  // standalone logic-only harness (no analog LEDs — fast). The harness topology is CONSTANT, so it is
  // compileLogic'd ONCE (cached) and each cycle stepLogic only re-seeds the clock + the pressed key and
  // re-sweeps over logicStateRef.current (the persistent flip-flop memory the canvas re-solve also
  // threads) — the proven runCalc protocol, fast even for the multi-cycle ×/÷ busy loop.
  const calcCompiledRef = useRef<CompiledLogic | null>(null)
  const calcSolve = useCallback((active: string, clk: boolean) => {
    if (calcCompiledRef.current === null) {
      calcCompiledRef.current = compileLogic(
        CALC_HARNESS_NODES as unknown as BlockNodeLike[],
        CALC_HARNESS_EDGES as unknown as BlockEdgeLike[],
      )
    }
    const overrides = new Map<string, boolean>([['h_clk', clk]])
    if (active !== 'none') overrides.set(`h_${active}`, true)
    return stepLogic(calcCompiledRef.current, overrides, logicStateRef.current)
  }, [])
  // Press a key: clock the real FSM once (CLK-low then CLK-high), then free-run the clock while a ×/÷
  // sequencer is BUSY (read busy from the SYNCHRONOUS solve return), release the key, and re-solve the
  // canvas so the real decoder + seven-segment LEDs show the result.
  const pressCalcKey = useCallback(
    (key: string) => {
      const port = KEY_PORT[key]
      if (port === undefined) return
      checkpointAction('calc key')
      calcSolve(port, false) // CLK low: Mealy control settles, the master latches grab D
      let r = calcSolve(port, true) // CLK high: the FSM + registers commit (one press = one rising edge)
      let guard = 0
      while (r.value('calc', 'busy') === true && guard++ < 300) {
        calcSolve('none', false)
        r = calcSolve('none', true) // free-run the clock while the ×/÷ sequencer works
      }
      r = calcSolve('none', false) // release: the gate result is now stable on the display ports
      // Drive the on-canvas display from the REAL gate result. calcin_{bit} = the magnitude BCD bit;
      // calcblk_{d} blanks a leading-zero digit (the decoder's BI line); calcdp_{d} lights the decimal
      // point at the radix (digit F); calccomma_{d} lights a thousands comma. F and the digit values come
      // straight off the gates; the comma grouping + blanking is display formatting (like a real chip's
      // display driver). The ~9000-gate calculator runs ONLY here (the harness), never on the canvas.
      let F = 0
      for (let b = 0; b < 4; b++) if (r.value('calc', `f_ent${b}`) === true) F |= 1 << b
      const digOf = (d: number) => {
        let v = 0
        for (let b = 0; b < 4; b++) if (r.value('calc', `display${d * 4 + b}`) === true) v |= 1 << b
        return v
      }
      let hiNonzero = -1
      for (let d = 0; d < 10; d++) if (digOf(d) !== 0) hiNonzero = d
      const msdInt = Math.max(F, hiNonzero) // highest shown integer digit (keep the ones place even if 0)
      const lvl = (nid: string): number | null => {
        let m = /^calcin_(\d+)$/.exec(nid)
        if (m?.[1] !== undefined) return r.value('calc', `display${m[1]}`) === true ? 5 : 0
        m = /^calcblk_(\d+)$/.exec(nid)
        if (m?.[1] !== undefined) return Number(m[1]) > msdInt ? 5 : 0 // blank leading zeros
        m = /^calcdp_(\d+)$/.exec(nid)
        if (m?.[1] !== undefined) return F >= 1 && Number(m[1]) === F ? 5 : 0 // point right of digit F
        m = /^calccomma_(\d+)$/.exec(nid)
        if (m?.[1] !== undefined) {
          const d = Number(m[1])
          return d > F && (d - F) % 3 === 0 && d <= msdInt ? 5 : 0 // thousands grouping
        }
        return null
      }
      setNodes((cur) =>
        cur.map((n) => {
          const v = lvl(n.id)
          return v === null ? n : { ...n, data: { ...n.data, parameters: dcSource(v) } }
        }),
      )
    },
    [calcSolve, setNodes, checkpointAction],
  )
  // Drop the whole calculator: a real momentary-switch keypad + ten per-digit BCD decoders + seven-
  // segment displays. The BRAIN is the real CALCULATOR gate circuit — pressCalcKey clocks it in a
  // logic harness (off-canvas, so its ~9000 gates never transistor-flatten on every render) and drives
  // these decoders from its gate output, so the decimal result lights the LEDs. No code in the loop.
  const placeCalculator = useCallback(() => {
    const decoder = BUILTIN_BLOCKS.logic_decoder_7seg
    const display = BUILTIN_BLOCKS.display_seven_segment
    const separator = BUILTIN_BLOCKS.display_separator
    if (!decoder || !display || !separator) return
    checkpointAction('calculator')
    logicStateRef.current = new Map<string, boolean>() // power-on: clear the flip-flop memory
    const COL = 280 // column pitch: one decoder + display per decimal digit, fed by the CALC block
    const nodes: Record<string, unknown>[] = [
      {
        id: 'calc_vp',
        type: 'device',
        position: { x: -440, y: 1120 },
        data: { definition: 'power_source', label: 'V+', parameters: dcSource(5) },
      },
      {
        id: 'calc_g',
        type: 'device',
        position: { x: -320, y: 1120 },
        data: { definition: 'ground', label: 'GND' },
      },
    ]
    const edges: Record<string, unknown>[] = [
      {
        id: 'calc_vpn',
        type: 'net',
        source: 'calc_vp',
        sourceHandle: 'terminal_negative',
        target: 'calc_g',
        targetHandle: 'reference_terminal',
      },
    ]
    // One tidy COLUMN per decimal digit — the display on top, its own hex decoder right below it, the
    // digit's four input sources at the bottom — so every wire stays inside its column (no fan-out bus).
    // Digit 9 (most significant) is leftmost, so the row reads left-to-right as a normal number.
    for (let d = 0; d < 10; d++) {
      const cx = (9 - d) * COL
      nodes.push({
        id: `calc_disp${d}`,
        type: 'block',
        position: { x: cx, y: 60 },
        data: { definition: 'display_seven_segment', label: `${d}`, block: display },
      })
      nodes.push({
        id: `calc_dec${d}`,
        type: 'block',
        position: { x: cx, y: 540 },
        data: { definition: 'block', label: `dec${d}`, block: decoder, fidelity: 'logic' },
      })
      for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
        edges.push({
          id: `calc_sg_${s}_${d}`,
          type: 'net',
          source: `calc_dec${d}`,
          sourceHandle: `seg_${s}`,
          target: `calc_disp${d}`,
          targetHandle: `seg_${s}`,
        })
      }
      // (the display common is driven by the per-digit blank source below — 0 V shows, 5 V blanks the
      // whole digit by reverse-biasing every segment — so it is NOT tied straight to ground here.)
      edges.push({
        id: `calc_decvp${d}`,
        type: 'net',
        source: 'calc_vp',
        sourceHandle: 'terminal_positive',
        target: `calc_dec${d}`,
        targetHandle: 'v_dd',
      })
      edges.push({
        id: `calc_decg${d}`,
        type: 'net',
        source: `calc_dec${d}`,
        sourceHandle: 'gnd',
        target: 'calc_g',
        targetHandle: 'reference_terminal',
      })
      // Each digit's four decoder inputs are driven by a source that pressCalcKey sets from the REAL
      // calculator's gate output (display{d*4+i}, the signed-magnitude BCD bit). Power-up = 0.
      for (let i = 0; i < 4; i++) {
        const bit = d * 4 + i
        nodes.push({
          id: `calcin_${bit}`,
          type: 'device',
          position: { x: cx, y: 1040 + i * 90 },
          data: { definition: 'power_source', label: '', parameters: dcSource(0) },
        })
        edges.push({
          id: `calcin_e${bit}`,
          type: 'net',
          source: `calcin_${bit}`,
          sourceHandle: 'terminal_positive',
          target: `calc_dec${d}`,
          targetHandle: `d${i}`,
        })
        edges.push({
          id: `calcin_g${bit}`,
          type: 'net',
          source: `calcin_${bit}`,
          sourceHandle: 'terminal_negative',
          target: 'calc_g',
          targetHandle: 'reference_terminal',
        })
      }
      // Blanking + decimal-point + comma sources for this digit (driven by pressCalcKey from F): the
      // decoder's BI line blanks a leading zero; the display's dp / comma LEDs light the point + grouping.
      const sep = (sfx: string, port: string, target: string, dx: number) => {
        nodes.push({
          id: `calc${sfx}_${d}`,
          type: 'device',
          position: { x: cx + dx, y: 470 },
          data: { definition: 'power_source', label: '', parameters: dcSource(0) },
        })
        edges.push({
          id: `calc${sfx}_e${d}`,
          type: 'net',
          source: `calc${sfx}_${d}`,
          sourceHandle: 'terminal_positive',
          target,
          targetHandle: port,
        })
        edges.push({
          id: `calc${sfx}_g${d}`,
          type: 'net',
          source: `calc${sfx}_${d}`,
          sourceHandle: 'terminal_negative',
          target: 'calc_g',
          targetHandle: 'reference_terminal',
        })
      }
      sep('blk', 'common', `calc_disp${d}`, -150)
      // the decimal point + comma sit in their OWN small block, to the right of this digit
      nodes.push({
        id: `calc_sep${d}`,
        type: 'block',
        position: { x: cx + 140, y: 100 },
        data: { definition: 'display_separator', label: '', block: separator },
      })
      edges.push({
        id: `calc_sepc${d}`,
        type: 'net',
        source: `calc_sep${d}`,
        sourceHandle: 'common',
        target: 'calc_g',
        targetHandle: 'reference_terminal',
      })
      sep('dp', 'seg_dp', `calc_sep${d}`, 150)
      sep('comma', 'seg_comma', `calc_sep${d}`, 150)
    }
    // The real keypad — momentary-switch parts, each tagged with the key it types.
    const layout: string[][] = [
      ['7', '8', '9', '/'],
      ['4', '5', '6', '*'],
      ['1', '2', '3', '-'],
      ['0', 'C', '=', '+'],
    ]
    const idMap: Record<string, string> = {
      '/': 'div',
      '*': 'mul',
      '-': 'sub',
      '+': 'add',
      '=': 'eq',
    }
    const labelOf = (k: string) => (k === '/' ? '÷' : k === '*' ? '×' : k === '-' ? '−' : k)
    layout.forEach((row, r) => {
      row.forEach((k, c) => {
        nodes.push({
          id: `calckey_${idMap[k] ?? k}`,
          type: 'keycap',
          draggable: false, // a key is pressed (clicked), never dragged
          // Keypad to the RIGHT of the digit columns, clear of the per-column wiring on the left.
          position: { x: 2800 + c * 90, y: 80 + r * 90 },
          data: { definition: 'keycap', label: labelOf(k), calcKey: k },
        })
      })
    })
    nodes.push({
      id: 'calckey_pm',
      type: 'keycap',
      draggable: false,
      position: { x: 2800, y: 80 + 4 * 90 },
      data: { definition: 'keycap', label: '±', calcKey: '±' },
    })
    setNodes(() => nodes as unknown as Node[])
    setEdges(() => edges as unknown as Edge[])
    setAutoRouteWires(true) // route the many decoder/display wires into clean lanes, not a tangle
    reSolve(nodes as unknown as Node[], edges as unknown as Edge[])
  }, [setNodes, setEdges, checkpointAction, reSolve])

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const snap = (p: { x: number; y: number }) =>
        snapToGrid
          ? {
              x: Math.round(p.x / SNAP_GRID[0]) * SNAP_GRID[0],
              y: Math.round(p.y / SNAP_GRID[1]) * SNAP_GRID[1],
            }
          : p
      const blockSourceId = event.dataTransfer.getData(BLOCK_MIME)
      if (blockSourceId) {
        const source = nodes.find((n) => n.id === blockSourceId)
        const block = (source?.data as { block?: BlockData } | undefined)?.block
        if (!block) return
        checkpointAction('drop')
        const position = snap(screenToFlowPosition({ x: event.clientX, y: event.clientY }))
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
      // The calculator isn't a single part — it lays out the whole appliance (keypad + decoder + displays).
      if (definition === 'calculator') {
        placeCalculator()
        return
      }
      // A built-in (e.g. the op-amp) drops as a block node — a fresh deep copy that
      // descends + flattens to its real transistors like any user-grouped block.
      const builtinBlock = BUILTIN_BLOCKS[definition]
      if (builtinBlock) {
        checkpointAction('drop')
        const blockPos = snap(screenToFlowPosition({ x: event.clientX, y: event.clientY }))
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
      const position = snap(screenToFlowPosition({ x: event.clientX, y: event.clientY }))
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
    [screenToFlowPosition, setNodes, nodes, checkpointAction, snapToGrid, placeCalculator],
  )

  // Place a part from the Add-Part pop-up — the same node-creation as a drop, but centred in the
  // current view (there is no drag) and selected, so it is ready to move.
  const placePart = useCallback(
    (definition: string) => {
      checkpointAction('add part')
      const raw = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      const position = snapToGrid
        ? {
            x: Math.round(raw.x / SNAP_GRID[0]) * SNAP_GRID[0],
            y: Math.round(raw.y / SNAP_GRID[1]) * SNAP_GRID[1],
          }
        : raw
      dropCount.current += 1
      const id = `${definition}_${dropCount.current}`
      const builtin = BUILTIN_BLOCKS[definition]
      if (builtin) {
        const block = structuredClone(builtin)
        setNodes((current) =>
          current
            .map((n) => ({ ...n, selected: false }))
            .concat({
              id,
              type: 'block',
              position,
              data: { definition: 'block', label: block.name, block },
              selected: true,
            }),
        )
        return
      }
      setNodes((current) =>
        current
          .map((n) => ({ ...n, selected: false }))
          .concat({
            id,
            type: 'device',
            position,
            data: { definition, label: id, parameters: defaultParameters(definition) },
            selected: true,
          }),
      )
    },
    [screenToFlowPosition, setNodes, checkpointAction, snapToGrid],
  )

  // Select a part by id from the Schematic Hierarchy outline — sets it selected (which fills the
  // Properties panel) and deselects the rest.
  const selectNodeById = useCallback(
    (id: string) => {
      setNodes((current) => current.map((n) => ({ ...n, selected: n.id === id })))
    },
    [setNodes],
  )

  // Edit a block's pin (name / power-type / which edge). Changing the SIDE drops any legacy hand-laid
  // offsets so the pin re-distributes onto its new edge (a built-in block then auto-lays-out too).
  const onEditBlockPort = useCallback(
    (blockId: string, portId: string, patch: BlockPortPatch) => {
      checkpointAction('edit-pins')
      setNodes((cur) =>
        cur.map((n) => {
          if (n.id !== blockId) return n
          const block = (n.data as { block?: BlockData }).block
          if (!block) return n
          const edited = block.ports.map((p) => {
            if (p.id !== portId) return p
            const next = { ...p, ...patch }
            // An enable with an empty pin id is the "(no enable)" choice — drop the field entirely.
            if (next.enable?.pin === '') {
              const { enable: _enable, ...rest } = next
              return rest
            }
            return next
          })
          // Changing a side needs the auto-distribute layout, so drop the legacy offsets; name/kind
          // keep them (a built-in block's hand-laid look survives a rename).
          const ports = patch.side !== undefined ? withoutOffsets(edited) : edited
          return { ...n, data: { ...n.data, block: { ...block, ports } } }
        }),
      )
      // Moving a pin to a new edge relocates its handle. Any corners the user dropped on the wires
      // into it were laid out for the OLD spot, so they would now cross back over the block. Reset
      // those wires to the straight run to the pin's new side — we never invent a routed path (that
      // stays the user's to draw); updateNodeInternals (the effect below) then walks the wire's end
      // onto the new handle, so the wire follows the pin instead of tangling.
      if (patch.side !== undefined) {
        setEdges((cur) =>
          cur.map((e) =>
            edgeTouchesPort(e, blockId, portId) ? { ...e, data: { ...e.data, waypoints: [] } } : e,
          ),
        )
      }
    },
    [setNodes, setEdges, checkpointAction],
  )

  // Set a block's simulation fidelity (complexity-layer #1): logic = the fast 0/1 engine, transistor =
  // the full analog solve. A data-only change; the live re-solve effect picks it up like any pin edit.
  const onSetFidelity = useCallback(
    (id: string, fidelity: Fidelity) => {
      checkpointAction('set-fidelity')
      setNodes((cur) => cur.map((n) => (n.id === id ? { ...n, data: { ...n.data, fidelity } } : n)))
    },
    [setNodes, checkpointAction],
  )

  // Declare a pin by exposing an internal terminal — even before it's wired. A new pin has no offset,
  // so the block auto-distributes (withoutOffsets clears any legacy ones too).
  const onAddBlockPort = useCallback(
    (blockId: string, nodeId: string, handleId: string) => {
      checkpointAction('add-pin')
      setNodes((cur) =>
        cur.map((n) => {
          if (n.id !== blockId) return n
          const block = (n.data as { block?: BlockData }).block
          if (!block) return n
          const newPort: BlockPort = {
            id: `port_${crypto.randomUUID().slice(0, 8)}`,
            label: `${nodeId} · ${handleId.replace(/_/g, ' ')}`,
            side: 'left',
            inner: { nodeId, handleId },
          }
          const ports = withoutOffsets([...block.ports, newPort])
          return { ...n, data: { ...n.data, block: { ...block, ports } } }
        }),
      )
    },
    [setNodes, checkpointAction],
  )

  // Reorder a pin up/down within its edge.
  const onReorderBlockPort = useCallback(
    (blockId: string, portId: string, dir: -1 | 1) => {
      checkpointAction('reorder-pins')
      setNodes((cur) =>
        cur.map((n) => {
          if (n.id !== blockId) return n
          const block = (n.data as { block?: BlockData }).block
          if (!block) return n
          const ports = withoutOffsets(movePortAlongEdge(block.ports, portId, dir))
          return { ...n, data: { ...n.data, block: { ...block, ports } } }
        }),
      )
    },
    [setNodes, checkpointAction],
  )

  // Remove a pin — and drop any external wire attached to it (it would otherwise dangle on a handle
  // that no longer exists). Undoable, so a mis-click is one Undo away.
  const onRemoveBlockPort = useCallback(
    (blockId: string, portId: string) => {
      checkpointAction('remove-pin')
      setNodes((cur) =>
        cur.map((n) => {
          if (n.id !== blockId) return n
          const block = (n.data as { block?: BlockData }).block
          if (!block) return n
          const ports = block.ports.filter((p) => p.id !== portId)
          return { ...n, data: { ...n.data, block: { ...block, ports } } }
        }),
      )
      setEdges((cur) => cur.filter((e) => !edgeTouchesPort(e, blockId, portId)))
    },
    [setNodes, setEdges, checkpointAction],
  )

  // React Flow caches each handle's measured position; when a block's pins move to new edges (or get
  // reordered / added / removed, or an undo restores a different layout) it won't re-read them on its
  // own, so wires would keep pointing at the pins' old spots. Re-measure whenever any block's pin
  // layout changes — keyed on a signature of every block's pin sides + order, so a plain drag doesn't.
  const blockPinSignature = nodes
    .map((n) => {
      if (n.type !== 'block') return ''
      const block = (n.data as { block?: BlockData }).block
      return block ? `${n.id}#${block.ports.map((p) => `${p.id}.${p.side}`).join(',')}` : n.id
    })
    .join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure exactly when a pin layout changes
  useEffect(() => {
    for (const n of nodes) {
      if (n.type === 'block') updateNodeInternals(n.id)
    }
  }, [blockPinSignature, updateNodeInternals])

  // DEV-only control surface for the AI to drive the app over CDP. There is no UI — the AI can't see
  // the Electron window, so these hidden hooks on window.__chip expose the React-internal handlers it
  // needs (raw CDP can click the DOM but can't reach onEditBlockPort). Stripped from production by the
  // DEV guard; nodesRef/handlers are stable, so the surface is attached once and reads live state.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const mkBlock = (id: string, x: number, portId: string, side: PinSide): Node => {
      const block: BlockData = {
        name: id,
        origin: { x, y: 260 },
        nodes: [
          {
            id: 'r',
            definition: 'resistor',
            x: 0,
            y: 0,
            parameters: defaultParameters('resistor'),
          },
        ],
        edges: [],
        ports: [{ id: portId, label: `${id} pin`, side, inner: { nodeId: 'r', handleId: 'a' } }],
      }
      return {
        id,
        type: 'block',
        position: { x, y: 260 },
        data: { definition: 'block', label: id, block },
      } as Node
    }
    const api = {
      // Audit the REAL drawn wire geometry against the REAL part boxes (ground truth — no DOM/timing/regex):
      // how many drawn wire segments run diagonally, and how many cut through a part's interior (a >10px
      // margin ignores the legitimate landing on a pin sitting on a part edge).
      wireAudit() {
        const M = 10
        const boxes = partBoxesRef.current
        let segments = 0
        let diagonal = 0
        let through = 0
        for (const pts of wireGeomsRef.current.values()) {
          for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i]
            const b = pts[i + 1]
            if (!a || !b) continue
            segments++
            if (Math.abs(b.x - a.x) > 2 && Math.abs(b.y - a.y) > 2) diagonal++
            const x0 = Math.min(a.x, b.x)
            const x1 = Math.max(a.x, b.x)
            const y0 = Math.min(a.y, b.y)
            const y1 = Math.max(a.y, b.y)
            for (const bx of boxes) {
              if (x1 > bx.x + M && x0 < bx.x + bx.w - M && y1 > bx.y + M && y0 < bx.y + bx.h - M) {
                through++
                break
              }
            }
          }
        }
        return {
          wires: wireGeomsRef.current.size,
          parts: boxes.length,
          segments,
          diagonal,
          through,
        }
      },
      // Scanned multiplexed display: clock the REAL row scanner over the REAL multiplexed LED matrix
      // (scanMatrixImage), accumulate the persistence-of-vision picture, and show it on a matrix placed
      // on the canvas. 8 row + 8 column lines drive 64 pixels — a real LED panel painting a picture.
      scanShow() {
        checkpointAction('dev: scanned display')
        const matrix = BUILTIN_BLOCKS.dot_matrix_mux_8x8
        const scanner = BUILTIN_BLOCKS.row_scanner_8
        if (!matrix || !scanner) return 'no blocks'
        const HEART = [
          '.##..##.',
          '########',
          '########',
          '########',
          '.######.',
          '..####..',
          '...##...',
          '........',
        ].map((row) => [...row].map((ch) => ch === '#'))
        // The picture lives in a real frame buffer (flip-flop memory); the scanner reads it out row by
        // row and the matrix lights it — real all the way down, no bitmap driving the panel.
        const frameBuffer = buildFrameBuffer(HEART)
        const pov = scanMatrixFromBuffer(scanner, frameBuffer, matrix, 8, 8)
        // The scanned picture rides on the node data; the matrix face draws it directly. (A static solve
        // would only light the single row a real panel shows at one instant, so we hand the face the whole
        // persistence-of-vision image the scan paints.)
        setNodes(
          () =>
            [
              {
                id: 'sd',
                type: 'block',
                position: { x: 0, y: 0 },
                data: {
                  definition: 'block',
                  label: 'Scanned Display',
                  block: matrix,
                  povImage: pov,
                },
              },
            ] as unknown as Node[],
        )
        setEdges(() => [])
        return 'scanned display'
      },
      // Inject a wired CRT — an EHT anode source + two AC deflection sources (X, Y at a 3:2 frequency
      // ratio → a Lissajous) — and run the REAL transient so the tube draws its real trace on its
      // on-canvas screen. For the CDP screenshot of the CRT screen; the trace is solved, not painted.
      showCrt() {
        checkpointAction('dev: show crt')
        const sv = (amount: number) => ({
          value: { kind: 'scalar' as const, amount, unit: 'volt' },
        })
        const r0 = { value: { kind: 'scalar' as const, amount: 0, unit: 'ohm' } }
        const ac = (amp: number, freq: number) => ({
          nominal_voltage: sv(0),
          ac_amplitude: sv(amp),
          frequency: { value: { kind: 'scalar' as const, amount: freq, unit: 'hertz' } },
          internal_resistance: r0,
        })
        const crtNodes = [
          {
            id: 'CRT',
            type: 'device',
            position: { x: 560, y: 280 },
            data: { definition: 'crt', label: 'CRT', parameters: defaultParameters('crt') },
          },
          {
            id: 'VANODE',
            type: 'device',
            position: { x: 220, y: 120 },
            data: {
              definition: 'power_source',
              label: 'EHT',
              parameters: { nominal_voltage: sv(2000), internal_resistance: r0 },
            },
          },
          {
            id: 'VX',
            type: 'device',
            position: { x: 220, y: 320 },
            data: { definition: 'power_source', label: 'X', parameters: ac(40, 300) },
          },
          {
            id: 'VY',
            type: 'device',
            position: { x: 220, y: 500 },
            data: { definition: 'power_source', label: 'Y', parameters: ac(40, 200) },
          },
          {
            id: 'CGND',
            type: 'device',
            position: { x: 220, y: 660 },
            data: { definition: 'ground', label: 'gnd' },
          },
        ] as Node[]
        const w2 = (id: string, s: string, sh: string, t: string, th: string): Edge => ({
          id,
          type: 'net',
          source: s,
          sourceHandle: sh,
          target: t,
          targetHandle: th,
        })
        const crtEdges: Edge[] = [
          w2('ec_an', 'VANODE', 'terminal_positive', 'CRT', 'anode'),
          w2('ec_ang', 'VANODE', 'terminal_negative', 'CGND', 'reference_terminal'),
          w2('ec_ca', 'CRT', 'cathode', 'CGND', 'reference_terminal'),
          w2('ec_x', 'VX', 'terminal_positive', 'CRT', 'x_deflect'),
          w2('ec_xg', 'VX', 'terminal_negative', 'CGND', 'reference_terminal'),
          w2('ec_y', 'VY', 'terminal_positive', 'CRT', 'y_deflect'),
          w2('ec_yg', 'VY', 'terminal_negative', 'CGND', 'reference_terminal'),
        ]
        setNodes(crtNodes)
        setEdges(crtEdges)
        const { sources, positions } = lightCastInputs(crtNodes)
        const world = groundedComponent(
          worldWithCastLight(canvasWorld(crtNodes, crtEdges).world, positions, sources),
        )
        const windowSec = scopeWindow(world).duration
        const steps = scopeRecordSteps(windowSec * 3, fastestSourceHz(world))
        if (steps === 'span-too-wide') return
        const thermal = solveTransientThermal(world, {
          timeStep: (windowSec * 3) / steps,
          duration: windowSec * 3,
          projectAmbientC: projectAmbientRef.current,
        })
        setCrtTraces(buildCrtTraces(world, thermal.result.series))
      },
      // Inject a CRT driven as a TELEVISION: real sweep generators raster-scan the beam (X = a fast
      // sawtooth = the line sweep, Y = a slow sawtooth = the field sweep) while a real VIDEO signal on
      // the grid modulates the beam brightness — here a square wave that paints horizontal bars (a test
      // pattern). Proves the raster + grid-intensity mechanism; the character generator (text) is next.
      showCrtTv() {
        checkpointAction('dev: crt tv raster')
        const sv = (amount: number) => ({
          value: { kind: 'scalar' as const, amount, unit: 'volt' },
        })
        const hz = (n: number) => ({ value: { kind: 'scalar' as const, amount: n, unit: 'hertz' } })
        const r0 = { value: { kind: 'scalar' as const, amount: 0, unit: 'ohm' } }
        const fV = 60
        const lines = 24
        const fX = lines * fV
        const wave = (wf: string, amp: number, freq: number, off = 0) => ({
          nominal_voltage: sv(off),
          ac_amplitude: sv(amp),
          frequency: hz(freq),
          waveform: { value: wf },
          internal_resistance: r0,
        })
        const dev = (id: string, x: number, y: number, def: string, parameters?: unknown) =>
          ({
            id,
            type: 'device',
            position: { x, y },
            data: parameters
              ? { definition: def, label: id, parameters }
              : { definition: def, label: id },
          }) as Node
        const crtNodes = [
          dev('CRT', 600, 280, 'crt', defaultParameters('crt')),
          dev('VANODE', 220, 100, 'power_source', {
            nominal_voltage: sv(2000),
            internal_resistance: r0,
          }),
          dev('VX', 220, 240, 'power_source', wave('sawtooth', 50, fX)),
          dev('VY', 220, 380, 'power_source', wave('sawtooth', 50, fV)),
          dev('VGRID', 220, 520, 'power_source', wave('square', 25, fV * 6, -25)),
          dev('CGND', 220, 660, 'ground'),
        ]
        const w2 = (id: string, s: string, sh: string, t: string, th: string): Edge => ({
          id,
          type: 'net',
          source: s,
          sourceHandle: sh,
          target: t,
          targetHandle: th,
        })
        const crtEdges: Edge[] = [
          w2('r_an', 'VANODE', 'terminal_positive', 'CRT', 'anode'),
          w2('r_ang', 'VANODE', 'terminal_negative', 'CGND', 'reference_terminal'),
          w2('r_ca', 'CRT', 'cathode', 'CGND', 'reference_terminal'),
          w2('r_x', 'VX', 'terminal_positive', 'CRT', 'x_deflect'),
          w2('r_xg', 'VX', 'terminal_negative', 'CGND', 'reference_terminal'),
          w2('r_y', 'VY', 'terminal_positive', 'CRT', 'y_deflect'),
          w2('r_yg', 'VY', 'terminal_negative', 'CGND', 'reference_terminal'),
          w2('r_g', 'VGRID', 'terminal_positive', 'CRT', 'grid'),
          w2('r_gg', 'VGRID', 'terminal_negative', 'CGND', 'reference_terminal'),
        ]
        setNodes(crtNodes)
        setEdges(crtEdges)
        const { sources, positions } = lightCastInputs(crtNodes)
        const world = groundedComponent(
          worldWithCastLight(canvasWorld(crtNodes, crtEdges).world, positions, sources),
        )
        const duration = 1 / fV
        const steps = lines * 80
        const thermal = solveTransientThermal(world, {
          timeStep: duration / steps,
          duration,
          projectAmbientC: projectAmbientRef.current,
        })
        setCrtTraces(buildCrtTraces(world, thermal.result.series))
      },
      // MIXED-SIGNAL CO-SIM: a real digital character generator (logic fidelity) wired to the analog
      // CRT, co-simulated so its video paints HELLO WORLD on the tube. The char-gen's video pin drives
      // the CRT grid; the dispatch detects the mixed canvas and runs the interleaved co-sim.
      showCharGen() {
        checkpointAction('dev: char-gen co-sim (HELLO WORLD)')
        const sv = (amount: number) => ({
          value: { kind: 'scalar' as const, amount, unit: 'volt' },
        })
        const hz = (n: number) => ({ value: { kind: 'scalar' as const, amount: n, unit: 'hertz' } })
        const r0 = { value: { kind: 'scalar' as const, amount: 0, unit: 'ohm' } }
        const fV = 60
        const fX = 8 * fV // 8 scanlines per field
        const saw = (amp: number, freq: number) => ({
          nominal_voltage: sv(0),
          ac_amplitude: sv(amp),
          frequency: hz(freq),
          waveform: { value: 'sawtooth' },
          internal_resistance: r0,
        })
        const dev = (id: string, x: number, y: number, def: string, parameters?: unknown) =>
          ({
            id,
            type: 'device',
            position: { x, y },
            data: parameters
              ? { definition: def, label: id, parameters }
              : { definition: def, label: id },
          }) as Node
        const charGen = {
          id: 'CHARGEN',
          type: 'device',
          position: { x: 120, y: 160 },
          data: { definition: 'block', label: 'CHARGEN', block: CHAR_GEN, fidelity: 'logic' },
        } as Node
        const nodes: Node[] = [
          charGen,
          dev('CRT', 760, 360, 'crt', defaultParameters('crt')),
          dev('VANODE', 380, 140, 'power_source', {
            nominal_voltage: sv(2000),
            internal_resistance: r0,
          }),
          dev('VX', 380, 280, 'power_source', saw(50, fX)),
          dev('VY', 380, 420, 'power_source', {
            // A stepped vertical sweep — one held level per scanline (no shear). The small amplitude
            // packs the 8 lines into a banner whose dot pitch matches the horizontal, so the glyphs
            // read at a normal 5:7 aspect instead of stretched tall. NEGATIVE = a descending scan
            // (line 0 at the TOP), the real top-to-bottom raster order, so glyphs aren't upside down.
            nominal_voltage: sv(0),
            ac_amplitude: sv(-8.5),
            frequency: hz(fV),
            waveform: { value: 'staircase' },
            staircase_steps: { value: { kind: 'scalar' as const, amount: 8, unit: 'count' } },
            internal_resistance: r0,
          }),
          dev('CGND', 380, 560, 'ground'),
          dev('PIXCLK', 120, 380, 'power_source', {
            nominal_voltage: sv(0),
            internal_resistance: r0,
          }),
          dev('CLR', 120, 500, 'power_source', { nominal_voltage: sv(0), internal_resistance: r0 }),
          dev('VDD', 120, 620, 'power_source', { nominal_voltage: sv(5), internal_resistance: r0 }),
          dev('DGND', 120, 740, 'ground'),
        ]
        const w2 = (id: string, s: string, sh: string, t: string, th: string): Edge => ({
          id,
          type: 'net',
          source: s,
          sourceHandle: sh,
          target: t,
          targetHandle: th,
        })
        const edges: Edge[] = [
          w2('br_video', 'CHARGEN', 'video', 'CRT', 'grid'), // the digital→analog video bridge
          w2('a_an', 'VANODE', 'terminal_positive', 'CRT', 'anode'),
          w2('a_ang', 'VANODE', 'terminal_negative', 'CGND', 'reference_terminal'),
          w2('a_ca', 'CRT', 'cathode', 'CGND', 'reference_terminal'),
          w2('a_x', 'VX', 'terminal_positive', 'CRT', 'x_deflect'),
          w2('a_xg', 'VX', 'terminal_negative', 'CGND', 'reference_terminal'),
          w2('a_y', 'VY', 'terminal_positive', 'CRT', 'y_deflect'),
          w2('a_yg', 'VY', 'terminal_negative', 'CGND', 'reference_terminal'),
          w2('d_clk', 'PIXCLK', 'terminal_positive', 'CHARGEN', 'clk'),
          w2('d_clkn', 'PIXCLK', 'terminal_negative', 'DGND', 'reference_terminal'),
          w2('d_clr', 'CLR', 'terminal_positive', 'CHARGEN', 'clr'),
          w2('d_clrn', 'CLR', 'terminal_negative', 'DGND', 'reference_terminal'),
          w2('d_vdd', 'VDD', 'terminal_positive', 'CHARGEN', 'v_dd'),
          w2('d_vddn', 'VDD', 'terminal_negative', 'DGND', 'reference_terminal'),
          w2('d_gnd', 'CHARGEN', 'gnd', 'DGND', 'reference_terminal'),
        ]
        setNodes(nodes)
        setEdges(edges)
        const dt = 1 / fV / 1024 // 1024 pixels (16 char slots × 8 dots) × 8 lines per field
        const { traces } = solveTransientDispatch(nodes, edges, {
          timeStep: dt,
          duration: dt * 1024,
          projectAmbientC: projectAmbientRef.current,
        })
        setCrtTraces(traces)
      },
      // Inject two blocks joined by a hand-cornered wire — the pin-move re-route scenario.
      setupReroute() {
        checkpointAction('dev: wired blocks')
        setNodes((cur) => [
          ...cur.filter((n) => n.id !== 'BLKA' && n.id !== 'BLKB'),
          mkBlock('BLKA', 200, 'pa', 'right'),
          mkBlock('BLKB', 540, 'pb', 'left'),
        ])
        const wire: Edge = {
          id: 'we',
          type: 'net',
          source: 'BLKA',
          sourceHandle: 'pa',
          target: 'BLKB',
          targetHandle: 'pb',
          data: { waypoints: [{ id: 'wp', x: 370, y: 420 }] },
        }
        setEdges((cur) => [...cur.filter((e) => e.id !== 'we'), wire])
      },
      // Move a block's pin to its next edge via the REAL handler (defaults to the BLKB test block).
      flipPin(blockId = 'BLKB') {
        const target = nodesRef.current.find((n) => n.id === blockId)
        const port = (target?.data as { block?: BlockData }).block?.ports[0]
        if (!port) return
        const order: PinSide[] = ['left', 'top', 'right', 'bottom']
        const next = order[(order.indexOf(port.side) + 1) % order.length] ?? 'left'
        onEditBlockPort(blockId, port.id, { side: next })
      },
      // Force React Flow to re-measure every block's handles — needed after bulk-injecting blocks so
      // their wires actually render (the handle measurement that edges depend on).
      remeasure() {
        for (const n of nodesRef.current) updateNodeInternals(n.id)
      },
      // Light a seven-segment digit in the real app: drop the display + a 5 V source + ground, wiring
      // the listed segments HIGH (default = the segments of a "7"). Proves the figure-8 lights up.
      showDigit(litSegs = ['a', 'b', 'c']) {
        checkpointAction('dev: show digit')
        const supplyParams = {
          nominal_voltage: { value: { kind: 'scalar', amount: 5, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        }
        setNodes((cur) => [
          ...cur.filter((n) => n.id !== 'DISP' && n.id !== 'V5' && n.id !== 'DGND'),
          {
            id: 'DISP',
            type: 'block',
            position: { x: 440, y: 200 },
            data: {
              // a generic 'block' node (like a palette drop) so double-click descends into it
              definition: 'block',
              label: 'DISP',
              block: BUILTIN_BLOCKS.display_seven_segment,
            },
          } as Node,
          {
            id: 'V5',
            type: 'device',
            position: { x: 160, y: 200 },
            data: { definition: 'power_source', label: 'V5', parameters: supplyParams },
          } as Node,
          {
            id: 'DGND',
            type: 'device',
            position: { x: 160, y: 380 },
            data: { definition: 'ground', label: 'DGND' },
          } as Node,
        ])
        setEdges((cur) => [
          ...cur.filter((e) => !e.id.startsWith('wd_')),
          {
            id: 'wd_common',
            type: 'net',
            source: 'DISP',
            sourceHandle: 'common',
            target: 'DGND',
            targetHandle: 'reference_terminal',
          } as Edge,
          {
            id: 'wd_vn',
            type: 'net',
            source: 'V5',
            sourceHandle: 'terminal_negative',
            target: 'DGND',
            targetHandle: 'reference_terminal',
          } as Edge,
          ...litSegs.map(
            (seg) =>
              ({
                id: `wd_${seg}`,
                type: 'net',
                source: 'V5',
                sourceHandle: 'terminal_positive',
                target: 'DISP',
                targetHandle: `seg_${seg}`,
              }) as Edge,
          ),
        ])
      },
      // Light a multi-digit display of ANY shipped size in the real app: drop it + a 5 V source +
      // ground, spelling a "7" on the first digit, a "0" on the last, and a decimal point + comma in the
      // first gap. Proves any size's figure-8s, point, and comma light from real per-leg current.
      show3Digit(digits = 3) {
        checkpointAction('dev: show display')
        const def = `display_seven_segment_${digits}`
        const block = BUILTIN_BLOCKS[def]
        if (!block) return
        const last = digits - 1
        const litPins = [
          'seg_d0_a',
          'seg_d0_b',
          'seg_d0_c',
          `seg_d${last}_a`,
          `seg_d${last}_b`,
          `seg_d${last}_c`,
          `seg_d${last}_d`,
          `seg_d${last}_e`,
          `seg_d${last}_f`,
          'dp_0',
          'comma_0',
        ]
        const supplyParams = {
          nominal_voltage: { value: { kind: 'scalar', amount: 5, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        }
        setNodes((cur) => [
          ...cur.filter((n) => n.id !== 'DISP3' && n.id !== 'V53' && n.id !== 'DGND3'),
          {
            id: 'DISP3',
            type: 'block',
            position: { x: 440, y: 200 },
            data: {
              definition: def,
              label: 'DISP3',
              block,
            },
          } as Node,
          {
            id: 'V53',
            type: 'device',
            position: { x: 120, y: 200 },
            data: { definition: 'power_source', label: 'V53', parameters: supplyParams },
          } as Node,
          {
            id: 'DGND3',
            type: 'device',
            position: { x: 120, y: 380 },
            data: { definition: 'ground', label: 'DGND3' },
          } as Node,
        ])
        setEdges((cur) => [
          ...cur.filter((e) => !e.id.startsWith('w3_')),
          {
            id: 'w3_common',
            type: 'net',
            source: 'DISP3',
            sourceHandle: 'common',
            target: 'DGND3',
            targetHandle: 'reference_terminal',
          } as Edge,
          {
            id: 'w3_vn',
            type: 'net',
            source: 'V53',
            sourceHandle: 'terminal_negative',
            target: 'DGND3',
            targetHandle: 'reference_terminal',
          } as Edge,
          ...litPins.map(
            (pin) =>
              ({
                id: `w3_${pin}`,
                type: 'net',
                source: 'V53',
                sourceHandle: 'terminal_positive',
                target: 'DISP3',
                targetHandle: pin,
              }) as Edge,
          ),
        ])
      },
      // Drop a powered SRAM word in the real app and WRITE all four bits to 1 (every BL high via one
      // supply, every BL̄ low to ground, the word line HIGH). Proves the live solver converges on the
      // 24-transistor cross-coupled memory and the chip drops + renders.
      fidelityProbe() {
        // DEV (verify complexity-layer #1): solve a wired AND at both fidelities + both input combos and
        // report each output — logic should match transistor, computed by the fast engine.
        const supply = (v: number) => ({
          nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        })
        const baseNodes = [
          {
            id: 'FA',
            type: 'block',
            position: { x: 300, y: 180 },
            data: { definition: 'block', label: 'NAND', block: BUILTIN_BLOCKS.logic_nand },
          },
          {
            id: 'va',
            type: 'device',
            position: { x: 80, y: 120 },
            data: { definition: 'power_source', label: 'a', parameters: supply(5) },
          },
          {
            id: 'vb',
            type: 'device',
            position: { x: 80, y: 240 },
            data: { definition: 'power_source', label: 'b', parameters: supply(5) },
          },
          {
            id: 'vdd',
            type: 'device',
            position: { x: 80, y: 40 },
            data: { definition: 'power_source', label: 'V+', parameters: supply(5) },
          },
          {
            id: 'gnd',
            type: 'device',
            position: { x: 80, y: 360 },
            data: { definition: 'ground', label: 'GND' },
          },
        ]
        const edges = [
          {
            id: 'wa',
            type: 'net',
            source: 'va',
            sourceHandle: 'terminal_positive',
            target: 'FA',
            targetHandle: 'a',
          },
          {
            id: 'wb',
            type: 'net',
            source: 'vb',
            sourceHandle: 'terminal_positive',
            target: 'FA',
            targetHandle: 'b',
          },
          {
            id: 'wd',
            type: 'net',
            source: 'vdd',
            sourceHandle: 'terminal_positive',
            target: 'FA',
            targetHandle: 'v_dd',
          },
          {
            id: 'wg',
            type: 'net',
            source: 'FA',
            sourceHandle: 'gnd',
            target: 'gnd',
            targetHandle: 'reference_terminal',
          },
          {
            id: 'wan',
            type: 'net',
            source: 'va',
            sourceHandle: 'terminal_negative',
            target: 'gnd',
            targetHandle: 'reference_terminal',
          },
          {
            id: 'wbn',
            type: 'net',
            source: 'vb',
            sourceHandle: 'terminal_negative',
            target: 'gnd',
            targetHandle: 'reference_terminal',
          },
          {
            id: 'wdn',
            type: 'net',
            source: 'vdd',
            sourceHandle: 'terminal_negative',
            target: 'gnd',
            targetHandle: 'reference_terminal',
          },
        ]
        const run = (bVolts: number, logic: boolean) => {
          const ns = baseNodes.map((n) => {
            if (n.id === 'vb') return { ...n, data: { ...n.data, parameters: supply(bVolts) } }
            if (logic && n.id === 'FA')
              return { ...n, data: { ...n.data, fidelity: 'logic' as const } }
            return n
          })
          const t0 = performance.now()
          const solved = solveCanvasDispatch(ns as unknown as Node[], edges as unknown as Edge[])
          const out = solved.terminalVolts.get('FA/out')
          return {
            out: out === undefined ? null : Math.round(out * 100) / 100,
            status: solved.solution.status,
            ms: Math.round(performance.now() - t0),
          }
        }
        return JSON.stringify({
          logic_1_1: run(5, true),
          logic_1_0: run(0, true),
          transistor_1_1: run(5, false),
          transistor_1_0: run(0, false),
        })
      },
      sequentialProbe() {
        // DEV (verify sequential): an SR latch tagged logic, driven set/hold/reset/hold through a
        // persistent state map (like reSolve's). Q must HOLD between sets — stored state across solves.
        const supply = (v: number) => ({
          nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        })
        const state = new Map<string, boolean>()
        const step = (sHigh: boolean, rHigh: boolean) => {
          const nodes = [
            {
              id: 'L',
              type: 'block',
              position: { x: 300, y: 180 },
              data: {
                definition: 'block',
                label: 'SR',
                block: BUILTIN_BLOCKS.logic_sr_latch,
                fidelity: 'logic',
              },
            },
            {
              id: 'g',
              type: 'device',
              position: { x: 80, y: 340 },
              data: { definition: 'ground', label: 'GND' },
            },
            {
              id: 'vs',
              type: 'device',
              position: { x: 80, y: 220 },
              data: { definition: 'power_source', label: 'S', parameters: supply(sHigh ? 5 : 0) },
            },
            {
              id: 'vr',
              type: 'device',
              position: { x: 80, y: 120 },
              data: { definition: 'power_source', label: 'R', parameters: supply(rHigh ? 5 : 0) },
            },
            {
              id: 'vp',
              type: 'device',
              position: { x: 80, y: 40 },
              data: { definition: 'power_source', label: 'V+', parameters: supply(5) },
            },
          ]
          const edges = [
            {
              id: 'es',
              source: 'vs',
              sourceHandle: 'terminal_positive',
              target: 'L',
              targetHandle: 's',
            },
            {
              id: 'er',
              source: 'vr',
              sourceHandle: 'terminal_positive',
              target: 'L',
              targetHandle: 'r',
            },
            {
              id: 'ep',
              source: 'vp',
              sourceHandle: 'terminal_positive',
              target: 'L',
              targetHandle: 'v_dd',
            },
            {
              id: 'eg',
              source: 'L',
              sourceHandle: 'gnd',
              target: 'g',
              targetHandle: 'reference_terminal',
            },
            {
              id: 'esn',
              source: 'vs',
              sourceHandle: 'terminal_negative',
              target: 'g',
              targetHandle: 'reference_terminal',
            },
            {
              id: 'ern',
              source: 'vr',
              sourceHandle: 'terminal_negative',
              target: 'g',
              targetHandle: 'reference_terminal',
            },
            {
              id: 'epn',
              source: 'vp',
              sourceHandle: 'terminal_negative',
              target: 'g',
              targetHandle: 'reference_terminal',
            },
          ]
          const solved = solveCanvasDispatch(
            nodes as unknown as Node[],
            edges as unknown as Edge[],
            undefined,
            undefined,
            state,
          )
          const q = solved.terminalVolts.get('L/q')
          return q === undefined ? null : Math.round(q)
        }
        return JSON.stringify({
          set: step(true, false),
          hold1: step(false, false),
          reset: step(false, true),
          hold0: step(false, false),
        })
      },
      handoffReverseProbe() {
        // DEV (verify reverse hand-off): a TRANSISTOR inverter (analog) drives a LOGIC NOT gate's input.
        // The logic gate must read the analog level as 0/1 → logicOut = NOT(NOT(in)) = in.
        const supply = (v: number) => ({
          nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        })
        const build = (srcV: number) => {
          const nodes = [
            {
              id: 'T',
              type: 'block',
              position: { x: 280, y: 180 },
              data: { definition: 'block', label: 'INVt', block: BUILTIN_BLOCKS.logic_not },
            },
            {
              id: 'N',
              type: 'block',
              position: { x: 480, y: 180 },
              data: {
                definition: 'block',
                label: 'NOTl',
                block: BUILTIN_BLOCKS.logic_not,
                fidelity: 'logic',
              },
            },
            {
              id: 'vin',
              type: 'device',
              position: { x: 80, y: 180 },
              data: { definition: 'power_source', label: 'in', parameters: supply(srcV) },
            },
            {
              id: 'vp',
              type: 'device',
              position: { x: 80, y: 60 },
              data: { definition: 'power_source', label: 'V+', parameters: supply(5) },
            },
            {
              id: 'g',
              type: 'device',
              position: { x: 80, y: 340 },
              data: { definition: 'ground', label: 'GND' },
            },
          ]
          const edges = [
            {
              id: 'win',
              source: 'vin',
              sourceHandle: 'terminal_positive',
              target: 'T',
              targetHandle: 'in',
            },
            {
              id: 'wpT',
              source: 'vp',
              sourceHandle: 'terminal_positive',
              target: 'T',
              targetHandle: 'v_dd',
            },
            {
              id: 'wgT',
              source: 'T',
              sourceHandle: 'gnd',
              target: 'g',
              targetHandle: 'reference_terminal',
            },
            { id: 'chain', source: 'T', sourceHandle: 'out', target: 'N', targetHandle: 'in' },
            {
              id: 'wpN',
              source: 'vp',
              sourceHandle: 'terminal_positive',
              target: 'N',
              targetHandle: 'v_dd',
            },
            {
              id: 'wgN',
              source: 'N',
              sourceHandle: 'gnd',
              target: 'g',
              targetHandle: 'reference_terminal',
            },
            {
              id: 'winn',
              source: 'vin',
              sourceHandle: 'terminal_negative',
              target: 'g',
              targetHandle: 'reference_terminal',
            },
            {
              id: 'wpn',
              source: 'vp',
              sourceHandle: 'terminal_negative',
              target: 'g',
              targetHandle: 'reference_terminal',
            },
          ]
          const solved = solveCanvasDispatch(nodes as unknown as Node[], edges as unknown as Edge[])
          const r = (k: string) => {
            const v = solved.terminalVolts.get(k)
            return v === undefined ? null : Math.round(v)
          }
          return { transistorOut: r('T/out'), logicOut: r('N/out') }
        }
        return JSON.stringify({ in_5: build(5), in_0: build(0) })
      },
      handoffProbe() {
        // DEV (verify hand-off #3): a LOGIC and-gate drives a TRANSISTOR inverter across one wire; read
        // the inverter's analog output — should be NOT(AND(a,b)) for every input (the boundary works).
        const supply = (v: number) => ({
          nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        })
        const base = [
          {
            id: 'A',
            type: 'block',
            position: { x: 280, y: 180 },
            data: {
              definition: 'block',
              label: 'AND',
              block: BUILTIN_BLOCKS.logic_and,
              fidelity: 'logic',
            },
          },
          {
            id: 'I',
            type: 'block',
            position: { x: 480, y: 180 },
            data: { definition: 'block', label: 'NOT', block: BUILTIN_BLOCKS.logic_not },
          },
          {
            id: 'va',
            type: 'device',
            position: { x: 80, y: 120 },
            data: { definition: 'power_source', label: 'a', parameters: supply(5) },
          },
          {
            id: 'vb',
            type: 'device',
            position: { x: 80, y: 220 },
            data: { definition: 'power_source', label: 'b', parameters: supply(5) },
          },
          {
            id: 'vp',
            type: 'device',
            position: { x: 80, y: 40 },
            data: { definition: 'power_source', label: 'V+', parameters: supply(5) },
          },
          {
            id: 'gnd',
            type: 'device',
            position: { x: 80, y: 340 },
            data: { definition: 'ground', label: 'GND' },
          },
        ]
        const edges = [
          {
            id: 'wa',
            source: 'va',
            sourceHandle: 'terminal_positive',
            target: 'A',
            targetHandle: 'a',
          },
          {
            id: 'wb',
            source: 'vb',
            sourceHandle: 'terminal_positive',
            target: 'A',
            targetHandle: 'b',
          },
          {
            id: 'wpA',
            source: 'vp',
            sourceHandle: 'terminal_positive',
            target: 'A',
            targetHandle: 'v_dd',
          },
          {
            id: 'wgA',
            source: 'A',
            sourceHandle: 'gnd',
            target: 'gnd',
            targetHandle: 'reference_terminal',
          },
          { id: 'chain', source: 'A', sourceHandle: 'out', target: 'I', targetHandle: 'in' },
          {
            id: 'wpI',
            source: 'vp',
            sourceHandle: 'terminal_positive',
            target: 'I',
            targetHandle: 'v_dd',
          },
          {
            id: 'wgI',
            source: 'I',
            sourceHandle: 'gnd',
            target: 'gnd',
            targetHandle: 'reference_terminal',
          },
          {
            id: 'wan',
            source: 'va',
            sourceHandle: 'terminal_negative',
            target: 'gnd',
            targetHandle: 'reference_terminal',
          },
          {
            id: 'wbn',
            source: 'vb',
            sourceHandle: 'terminal_negative',
            target: 'gnd',
            targetHandle: 'reference_terminal',
          },
          {
            id: 'wpn',
            source: 'vp',
            sourceHandle: 'terminal_negative',
            target: 'gnd',
            targetHandle: 'reference_terminal',
          },
        ]
        const run = (bVolts: number) => {
          const ns = base.map((n) =>
            n.id === 'vb' ? { ...n, data: { ...n.data, parameters: supply(bVolts) } } : n,
          )
          const solved = solveCanvasDispatch(ns as unknown as Node[], edges as unknown as Edge[])
          const invOut = solved.terminalVolts.get('I/out')
          const andOut = solved.terminalVolts.get('A/out')
          return {
            and: andOut === undefined ? null : Math.round(andOut * 100) / 100,
            invOut: invOut === undefined ? null : Math.round(invOut * 100) / 100,
          }
        }
        return JSON.stringify({ a1_b1: run(5), a1_b0: run(0) })
      },
      select(id: string) {
        setNodes((cur) => cur.map((n) => ({ ...n, selected: n.id === id })))
      },
      dropBlock(key: string, id: string) {
        const block = BUILTIN_BLOCKS[key]
        if (!block) return
        setNodes((cur) =>
          [
            ...cur.filter((n) => n.id !== id),
            {
              id,
              type: 'block',
              position: { x: 420, y: 240 },
              data: { definition: 'block', label: block.name, block },
            } as Node,
          ].map((n) => ({ ...n, selected: n.id === id })),
        )
      },
      readTerminal(key: string) {
        const v = terminalVoltsRef.current.get(key)
        return v === undefined ? null : Math.round(v * 100) / 100
      },
      // Stage the canvas for a REAL-events wire-tool test (use-wire-tool.ts): two blocks with facing
      // pins + the Wire tool armed. The clicks themselves come from outside as genuine mouse/key input
      // (CDP Input.dispatch*), so the whole chain — canvas onClick → wire.onWireClick → finishWire —
      // runs exactly as a user's would; state()/wireState() read the result back.
      wireSetup() {
        checkpointAction('dev: wire setup')
        setEdges([])
        // Fresh ids every call: re-staging with the SAME ids leaves React Flow's internals unmeasured
        // (no remount → no ResizeObserver tick) and the nodes stay visibility:hidden — unclickable.
        dropCount.current += 1
        const a = `WPA_${dropCount.current}`
        const b = `WPB_${dropCount.current}`
        setNodes([mkBlock(a, 220, 'pa', 'right'), mkBlock(b, 640, 'pb', 'left')])
        setTool('wire')
        return { a, b }
      },
      wireState() {
        const w = wireRef.current
        return {
          pending: w?.pendingWire
            ? { start: w.pendingWire.start, corners: w.pendingWire.corners.length }
            : null,
          edges: edgesRef.current.map((e) => ({
            source: e.source,
            target: e.target,
            corners: Array.isArray((e.data as { waypoints?: unknown[] } | undefined)?.waypoints)
              ? ((e.data as { waypoints: unknown[] }).waypoints as unknown[]).length
              : 0,
          })),
          junctions: nodesRef.current.filter((n) => n.type === 'junction').map((n) => n.id),
        }
      },
      // Stage an ARBITRARY spread, wired circuit through the real setNodes/setEdges — the general
      // form of wireSetup/meterSetup, so a verification doesn't have to choreograph drop-drag-wire
      // mouse gestures just to arrange parts (drops stack at one point; drags fight the zoom).
      // Parts get the shipped defaults merged under any explicit parameters. DEV-only, like every
      // hook here; the staged state is indistinguishable from hand-built (same solve, same undo).
      stage(
        parts: { id: string; definition: string; x: number; y: number; parameters?: object }[],
        wires: [string, string, string, string][],
      ) {
        checkpointAction('dev: stage')
        setNodes(
          parts.map(
            (p) =>
              ({
                id: p.id,
                type: 'device',
                position: { x: p.x, y: p.y },
                data: {
                  definition: p.definition,
                  label: p.id,
                  parameters: { ...defaultParameters(p.definition), ...(p.parameters ?? {}) },
                },
              }) as Node,
          ),
        )
        setEdges(
          wires.map(
            ([source, sourceHandle, target, targetHandle], i) =>
              ({
                id: `stage_w${i}`,
                type: 'net',
                source,
                sourceHandle,
                target,
                targetHandle,
              }) as Edge,
          ),
        )
      },
      // Hand-drawn copper (the route/via tools' backing state), driven directly for tests: a real
      // CopperTrace on a layer / a real Via — merged into the routing exactly like the tools will do,
      // so this exercises the whole reaches-DRC-and-Gerber path.
      pcbAddTrace(net: string, layer: 'top' | 'bottom', points: { x: number; y: number }[]) {
        setUserTraces((cur) => [...cur, { net, widthMm: 0.25, layer, points }])
        return userTraces.length + 1
      },
      pcbAddVia(net: string, at: { x: number; y: number }) {
        setUserVias((cur) => [...cur, { net, at, diameterMm: 0.6, drillMm: 0.4 }])
        return userVias.length + 1
      },
      pcbClearUserCopper() {
        setUserTraces([])
        setUserVias([])
      },
      // Stage a REAL powered loop for a real-events multimeter test (use-multimeter.ts): 5 V source →
      // resistor → back, grounded, meter tool armed. The probing itself comes from outside as genuine
      // mouse input on the terminal dots / the wire / the panel's dial buttons; meterState() reads back
      // the probes + the RENDERED readout chip. Fresh ids per call (see wireSetup).
      meterSetup() {
        checkpointAction('dev: meter setup')
        dropCount.current += 1
        const n = dropCount.current
        const v = `MV_${n}`
        const r = `MR_${n}`
        const g = `MG_${n}`
        const supplyParams = {
          nominal_voltage: { value: { kind: 'scalar', amount: 5, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        }
        setNodes([
          {
            id: v,
            type: 'device',
            position: { x: 220, y: 260 },
            data: { definition: 'power_source', label: v, parameters: supplyParams },
          } as Node,
          {
            id: r,
            type: 'device',
            position: { x: 520, y: 260 },
            data: { definition: 'resistor', label: r, parameters: defaultParameters('resistor') },
          } as Node,
          {
            id: g,
            type: 'device',
            position: { x: 220, y: 430 },
            data: { definition: 'ground', label: g },
          } as Node,
        ])
        setEdges([
          {
            id: `wm_plus_${n}`,
            type: 'net',
            source: v,
            sourceHandle: 'terminal_positive',
            target: r,
            targetHandle: 'terminal_a',
          },
          {
            id: `wm_return_${n}`,
            type: 'net',
            source: r,
            sourceHandle: 'terminal_b',
            target: v,
            targetHandle: 'terminal_negative',
          },
          {
            id: `wm_gnd_${n}`,
            type: 'net',
            source: v,
            sourceHandle: 'terminal_negative',
            target: g,
            targetHandle: 'reference_terminal',
          },
        ] as Edge[])
        setTool('meter')
        return { v, r, g, wire: `wm_plus_${n}` }
      },
      scopeState() {
        return scopeRef.current
      },
      timelineState() {
        return timelineRef.current
      },
      meterState() {
        const m = meterRef.current
        return {
          redProbe: m?.redProbe ?? null,
          blackProbe: m?.blackProbe ?? null,
          readout: m?.readout ?? null,
          chip: document.querySelector('.cb-meter-chip')?.textContent ?? null,
        }
      },
      // Exercise the extracted Connect-tool state machine (use-connect-tool.ts) end-to-end against the
      // REAL React state: single-mode two-pick builds a wire; re-picking the start cancels; batch mode
      // queues then routes. Reads back edges/connectStart/queue after each React flush (tick between picks
      // — the machine relies on a re-render between clicks; connectRef.current is re-read each time).
      async connectProbe() {
        const tick = () => new Promise((r) => setTimeout(r, 80))
        const c = () => connectRef.current
        const edgeCount = () => edgesRef.current.length
        checkpointAction('dev: connect probe')
        setEdges([])
        setNodes([mkBlock('CPA', 220, 'pa', 'right'), mkBlock('CPB', 640, 'pb', 'left')])
        await tick()
        // 1) single-mode two-pick → one wire from CPA/pa to CPB/pb
        const before = edgeCount()
        c()?.onPickConnectPoint('CPA', 'pa')
        await tick()
        const startAfterFirst = c()?.connectStart ?? null
        c()?.onPickConnectPoint('CPB', 'pb')
        await tick()
        const wire = edgesRef.current.find((e) => e.source === 'CPA' && e.target === 'CPB')
        const single = {
          startAfterFirst,
          startCleared: c()?.connectStart === null,
          added: edgeCount() - before,
          wire: wire
            ? {
                source: wire.source,
                target: wire.target,
                sh: wire.sourceHandle,
                th: wire.targetHandle,
              }
            : null,
        }
        // 2) re-pick the SAME point cancels (no wire)
        setEdges([])
        await tick()
        const beforeRe = edgeCount()
        c()?.onPickConnectPoint('CPA', 'pa')
        await tick()
        c()?.onPickConnectPoint('CPA', 'pa')
        await tick()
        const repick = { startCleared: c()?.connectStart === null, added: edgeCount() - beforeRe }
        // 3) batch mode queues, then routes on demand
        setEdges([])
        c()?.setConnectMode('batch')
        await tick()
        c()?.onPickConnectPoint('CPA', 'pa')
        await tick()
        c()?.onPickConnectPoint('CPB', 'pb')
        await tick()
        const queuedLen = c()?.connectQueue.length ?? -1
        const addedWhileQueued = edgeCount()
        c()?.routeConnectQueue()
        await tick()
        const batch = {
          queuedLen,
          addedWhileQueued,
          addedAfterRoute: edgeCount(),
          queueClearedAfter: (c()?.connectQueue.length ?? -1) === 0,
        }
        c()?.setConnectMode('single')
        return { single, repick, batch }
      },
      charScreen(text: string) {
        // DEV: a real dot-matrix character SCREEN — per letter, one glyph ROM (logic) + one 5×7 LED
        // matrix (analog), the ROM's 35 pixels wired to the matrix, driven by a 3-bit code. The logic
        // core hands off to the analog LED grid (exactly like a real text display drives its panel).
        const supply = (v: number) => ({
          nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        })
        const CODE: Record<string, number> = { H: 1, E: 2, L: 3, O: 4, W: 5, R: 6, D: 7, ' ': 0 }
        const codes = [...text.toUpperCase()].map((ch) => CODE[ch] ?? 0)
        const rom = BUILTIN_BLOCKS.glyph_rom_5x7
        const mat = BUILTIN_BLOCKS.dot_matrix_5x7
        if (!rom || !mat) return 'no blocks'
        setAutoRouteWires(true) // clean orthogonal lanes, not a diagonal tangle
        const nodes: Record<string, unknown>[] = [
          {
            id: 'scr_vp',
            type: 'device',
            position: { x: -220, y: 0 },
            data: { definition: 'power_source', label: 'V+', parameters: supply(5) },
          },
          {
            id: 'scr_g',
            type: 'device',
            position: { x: -220, y: 140 },
            data: { definition: 'ground', label: 'GND' },
          },
        ]
        const edges: Record<string, unknown>[] = [
          {
            id: 'scr_vpn',
            type: 'net',
            source: 'scr_vp',
            sourceHandle: 'terminal_negative',
            target: 'scr_g',
            targetHandle: 'reference_terminal',
          },
        ]
        codes.forEach((code, i) => {
          const x = i * 210
          nodes.push({
            id: `mat${i}`,
            type: 'block',
            position: { x, y: 0 },
            data: { definition: 'block', label: 'Matrix', block: mat },
          })
          nodes.push({
            id: `rom${i}`,
            type: 'block',
            position: { x, y: 380 },
            data: { definition: 'block', label: 'ROM', block: rom, fidelity: 'logic' },
          })
          for (let r = 0; r < 7; r++)
            for (let c = 0; c < 5; c++)
              edges.push({
                id: `epx${i}_${r}_${c}`,
                type: 'net',
                source: `rom${i}`,
                sourceHandle: `px_${r}_${c}`,
                target: `mat${i}`,
                targetHandle: `px_${r}_${c}`,
              })
          edges.push({
            id: `emc${i}`,
            type: 'net',
            source: `mat${i}`,
            sourceHandle: 'common',
            target: 'scr_g',
            targetHandle: 'reference_terminal',
          })
          edges.push({
            id: `erv${i}`,
            type: 'net',
            source: 'scr_vp',
            sourceHandle: 'terminal_positive',
            target: `rom${i}`,
            targetHandle: 'v_dd',
          })
          edges.push({
            id: `erg${i}`,
            type: 'net',
            source: `rom${i}`,
            sourceHandle: 'gnd',
            target: 'scr_g',
            targetHandle: 'reference_terminal',
          })
          for (let b = 0; b < 3; b++) {
            const hi = ((code >> b) & 1) === 1
            nodes.push({
              id: `cs${i}_${b}`,
              type: 'device',
              position: { x: x - 90, y: 380 + b * 70 },
              data: { definition: 'power_source', label: '', parameters: supply(hi ? 5 : 0) },
            })
            edges.push({
              id: `ecs${i}_${b}`,
              type: 'net',
              source: `cs${i}_${b}`,
              sourceHandle: 'terminal_positive',
              target: `rom${i}`,
              targetHandle: `code${b}`,
            })
            edges.push({
              id: `ecsn${i}_${b}`,
              type: 'net',
              source: `cs${i}_${b}`,
              sourceHandle: 'terminal_negative',
              target: 'scr_g',
              targetHandle: 'reference_terminal',
            })
          }
        })
        setNodes(() => nodes as unknown as Node[])
        setEdges(() => edges as unknown as Edge[])
        reSolve(nodes as unknown as Node[], edges as unknown as Edge[])
        return JSON.stringify({ chars: codes.length })
      },
      colorBars() {
        // DEV: SMPTE-style colour bars on the full-COLOUR RGB matrix — each column a colour, driven from
        // three real colour rails (R/G/B at 5 V). The subpixels add: red+green = yellow, all three = white.
        const supply = (v: number) => ({
          nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        })
        const mat = BUILTIN_BLOCKS.dot_matrix_rgb_7x7
        if (!mat) return 'no block'
        setAutoRouteWires(true) // clean orthogonal lanes, not a diagonal tangle
        const BARS = ['rgb', 'rg', 'gb', 'g', 'rb', 'r', 'b'] // White Yellow Cyan Green Magenta Red Blue
        const nodes: Record<string, unknown>[] = [
          {
            id: 'cb_mat',
            type: 'block',
            position: { x: 0, y: 0 },
            data: { definition: 'block', label: 'RGB Screen', block: mat },
          },
          {
            id: 'cb_g',
            type: 'device',
            position: { x: -260, y: 300 },
            data: { definition: 'ground', label: 'GND' },
          },
          {
            id: 'cb_r',
            type: 'device',
            position: { x: -260, y: 0 },
            data: { definition: 'power_source', label: 'R', parameters: supply(5) },
          },
          {
            id: 'cb_gr',
            type: 'device',
            position: { x: -260, y: 100 },
            data: { definition: 'power_source', label: 'G', parameters: supply(5) },
          },
          {
            id: 'cb_b',
            type: 'device',
            position: { x: -260, y: 200 },
            data: { definition: 'power_source', label: 'B', parameters: supply(5) },
          },
        ]
        const railNode: Record<string, string> = { r: 'cb_r', g: 'cb_gr', b: 'cb_b' }
        const edges: Record<string, unknown>[] = [
          {
            id: 'cb_mg',
            type: 'net',
            source: 'cb_mat',
            sourceHandle: 'common',
            target: 'cb_g',
            targetHandle: 'reference_terminal',
          },
        ]
        for (const ch of ['r', 'g', 'b'])
          edges.push({
            id: `cb_${ch}n`,
            type: 'net',
            source: railNode[ch],
            sourceHandle: 'terminal_negative',
            target: 'cb_g',
            targetHandle: 'reference_terminal',
          })
        for (let r = 0; r < 7; r++)
          for (let c = 0; c < 7; c++)
            for (const ch of BARS[c] ?? '')
              edges.push({
                id: `cbp_${r}_${c}_${ch}`,
                type: 'net',
                source: railNode[ch],
                sourceHandle: 'terminal_positive',
                target: 'cb_mat',
                targetHandle: `px_${r}_${c}_${ch}`,
              })
        setNodes(() => nodes as unknown as Node[])
        setEdges(() => edges as unknown as Edge[])
        reSolve(nodes as unknown as Node[], edges as unknown as Edge[])
        return 'colour bars'
      },
      colorGrid() {
        // DEV: GREY LEVELS — a 7×7 grid, each column a colour, each row a brightness. Each row is driven
        // at a different VOLTAGE (2.3 V → 5 V), so its LEDs draw a different current and glow at a
        // different brightness — a real shaded ramp, not just on/off. Full colour, dark to bright.
        const supply = (v: number) => ({
          nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        })
        const mat = BUILTIN_BLOCKS.dot_matrix_rgb_7x7
        if (!mat) return 'no block'
        setAutoRouteWires(true) // route the wires into clean orthogonal lanes, not a diagonal tangle
        const BARS = ['rgb', 'rg', 'gb', 'g', 'rb', 'r', 'b'] // W Y C G M R B per column
        const VROW = [2.3, 2.6, 2.9, 3.3, 3.8, 4.3, 5.0] // dim → bright per row
        const nodes: Record<string, unknown>[] = [
          {
            id: 'cg_mat',
            type: 'block',
            position: { x: 0, y: 0 },
            data: { definition: 'block', label: 'RGB Screen', block: mat },
          },
          {
            id: 'cg_g',
            type: 'device',
            position: { x: -260, y: 500 },
            data: { definition: 'ground', label: 'GND' },
          },
        ]
        const edges: Record<string, unknown>[] = [
          {
            id: 'cg_mg',
            type: 'net',
            source: 'cg_mat',
            sourceHandle: 'common',
            target: 'cg_g',
            targetHandle: 'reference_terminal',
          },
        ]
        for (let row = 0; row < 7; row++) {
          nodes.push({
            id: `cg_r${row}`,
            type: 'device',
            position: { x: -260, y: row * 70 },
            data: {
              definition: 'power_source',
              label: `${VROW[row]}V`,
              parameters: supply(VROW[row] ?? 5),
            },
          })
          edges.push({
            id: `cg_rn${row}`,
            type: 'net',
            source: `cg_r${row}`,
            sourceHandle: 'terminal_negative',
            target: 'cg_g',
            targetHandle: 'reference_terminal',
          })
          for (let col = 0; col < 7; col++)
            for (const ch of BARS[col] ?? '')
              edges.push({
                id: `cgp_${row}_${col}_${ch}`,
                type: 'net',
                source: `cg_r${row}`,
                sourceHandle: 'terminal_positive',
                target: 'cg_mat',
                targetHandle: `px_${row}_${col}_${ch}`,
              })
        }
        setNodes(() => nodes as unknown as Node[])
        setEdges(() => edges as unknown as Edge[])
        reSolve(nodes as unknown as Node[], edges as unknown as Edge[])
        return 'colour grid'
      },
      calcShow(a: number, b: number, sub: boolean) {
        // DEV (brick 8 visible): wire the BCD ALU -> decoder bank -> ten seven-segment displays and run
        // the REAL solve, so the digits light with a +/- b. Logic core hands off to the analog displays.
        const supply = (v: number) => ({
          nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        })
        const digitBit = (n: number, d: number, i: number) =>
          ((Math.floor(n / 10 ** d) % 10) >> i) & 1
        const nodes: Record<string, unknown>[] = [
          {
            id: 'U',
            type: 'block',
            position: { x: 80, y: 60 },
            data: {
              definition: 'block',
              label: 'ALU',
              block: BUILTIN_BLOCKS.logic_bcd_alu_10,
              fidelity: 'logic',
            },
          },
          {
            id: 'BANK',
            type: 'block',
            position: { x: 360, y: 60 },
            data: {
              definition: 'block',
              label: 'DEC',
              block: BUILTIN_BLOCKS.logic_bcd_decoder_10,
              fidelity: 'logic',
            },
          },
          {
            id: 'vp',
            type: 'device',
            position: { x: 80, y: 700 },
            data: { definition: 'power_source', label: 'V+', parameters: supply(5) },
          },
          {
            id: 'g',
            type: 'device',
            position: { x: 200, y: 700 },
            data: { definition: 'ground', label: 'GND' },
          },
        ]
        for (let d = 0; d < 10; d++) {
          nodes.push({
            id: `disp${d}`,
            type: 'block',
            position: { x: 120 + (9 - d) * 132, y: 2700 },
            data: {
              definition: 'display_seven_segment',
              label: `${d}`,
              block: BUILTIN_BLOCKS.display_seven_segment,
            },
          })
        }
        const rail = (hi: boolean) =>
          hi ? { t: 'vp', th: 'terminal_positive' } : { t: 'g', th: 'reference_terminal' }
        const edges: Record<string, unknown>[] = [
          {
            id: 'uvp',
            type: 'net',
            source: 'vp',
            sourceHandle: 'terminal_positive',
            target: 'U',
            targetHandle: 'v_dd',
          },
          {
            id: 'ug',
            type: 'net',
            source: 'U',
            sourceHandle: 'gnd',
            target: 'g',
            targetHandle: 'reference_terminal',
          },
          {
            id: 'bvp',
            type: 'net',
            source: 'vp',
            sourceHandle: 'terminal_positive',
            target: 'BANK',
            targetHandle: 'v_dd',
          },
          {
            id: 'bg',
            type: 'net',
            source: 'BANK',
            sourceHandle: 'gnd',
            target: 'g',
            targetHandle: 'reference_terminal',
          },
          {
            id: 'vpn',
            type: 'net',
            source: 'vp',
            sourceHandle: 'terminal_negative',
            target: 'g',
            targetHandle: 'reference_terminal',
          },
        ]
        const subT = rail(sub)
        edges.push({
          id: 'usub',
          type: 'net',
          source: 'U',
          sourceHandle: 'sub',
          target: subT.t,
          targetHandle: subT.th,
        })
        for (let k = 0; k < 40; k++) {
          const at = rail(digitBit(a, Math.floor(k / 4), k % 4) === 1)
          const bt = rail(digitBit(b, Math.floor(k / 4), k % 4) === 1)
          edges.push({
            id: `ua${k}`,
            type: 'net',
            source: 'U',
            sourceHandle: `a${k}`,
            target: at.t,
            targetHandle: at.th,
          })
          edges.push({
            id: `ub${k}`,
            type: 'net',
            source: 'U',
            sourceHandle: `b${k}`,
            target: bt.t,
            targetHandle: bt.th,
          })
          edges.push({
            id: `sb${k}`,
            type: 'net',
            source: 'U',
            sourceHandle: `s${k}`,
            target: 'BANK',
            targetHandle: `d${k}`,
          })
        }
        for (let d = 0; d < 10; d++) {
          for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
            edges.push({
              id: `sg_${s}_${d}`,
              type: 'net',
              source: 'BANK',
              sourceHandle: `seg_${s}_${d}`,
              target: `disp${d}`,
              targetHandle: `seg_${s}`,
            })
          }
          edges.push({
            id: `dc${d}`,
            type: 'net',
            source: `disp${d}`,
            sourceHandle: 'common',
            target: 'g',
            targetHandle: 'reference_terminal',
          })
        }
        setNodes(() => nodes as unknown as Node[])
        setEdges(() => edges as unknown as Edge[])
        setAutoRouteWires(true) // turn on the global congestion router for the demo
        reSolve(nodes as unknown as Node[], edges as unknown as Edge[])
        return JSON.stringify({ expected: sub ? (((a - b) % 1e10) + 1e10) % 1e10 : (a + b) % 1e10 })
      },
      placeCalc() {
        placeCalculator()
        return 'placed'
      },
      pressKey(key: string) {
        pressCalcKey(key)
        return api.calcRead()
      },
      calcRead() {
        // Read the live result straight off the REAL CALCULATOR gates (no reducer): one settle at CLK
        // low, then decode display/neg/error/f_ent the way the test oracle does.
        const { value, error } = decodeCalc(calcSolve('none', false))
        return JSON.stringify({ value, error })
      },
      calcTiled(a: number, b: number, sub: boolean) {
        // DEV (overhaul payoff): the calculator as TEN tiled ALU cells (no 120-pin mega-block) + a per-
        // digit decoder + display, then flip the global router on — the wiring should be clean lanes, not a
        // tangle. Cells are LSD-LEFT so the carry chain is short neighbour hops (the row reads ones-first).
        const supply = (v: number) => ({
          nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        })
        const digitBit = (n: number, d: number, i: number) =>
          ((Math.floor(n / 10 ** d) % 10) >> i) & 1
        const COLW = 240
        const aluCell = BUILTIN_BLOCKS.logic_bcd_alu_cell
        if (!aluCell) return '{}'
        const tiled = tileRow({
          cell: aluCell,
          count: 10,
          prefix: 'cell',
          x0: 120,
          y0: 80,
          pitch: COLW,
          chain: [{ from: 'cout', to: 'cin' }],
          bus: ['sub', 'v_dd', 'gnd'],
        })
        const idAt = tiled.idAt
        const nodes: Record<string, unknown>[] = [
          ...tiled.nodes.map(
            (n) =>
              ({
                ...n,
                data: { ...(n.data as Record<string, unknown>), fidelity: 'logic' },
              }) as Record<string, unknown>,
          ),
          {
            id: 'vp',
            type: 'device',
            position: { x: 120, y: 1320 },
            data: { definition: 'power_source', label: 'V+', parameters: supply(5) },
          },
          {
            id: 'g',
            type: 'device',
            position: { x: 320, y: 1320 },
            data: { definition: 'ground', label: 'GND' },
          },
        ]
        for (let d = 0; d < 10; d++) {
          nodes.push({
            id: `dec${d}`,
            type: 'block',
            position: { x: 120 + d * COLW, y: 460 },
            data: {
              definition: 'block',
              label: `7s${d}`,
              block: BUILTIN_BLOCKS.logic_decoder_7seg,
              fidelity: 'logic',
            },
          })
          nodes.push({
            id: `disp${d}`,
            type: 'block',
            position: { x: 120 + d * COLW, y: 880 },
            data: {
              definition: 'display_seven_segment',
              label: `${d}`,
              block: BUILTIN_BLOCKS.display_seven_segment,
            },
          })
        }
        const rail = (hi: boolean) =>
          hi ? { t: 'vp', th: 'terminal_positive' } : { t: 'g', th: 'reference_terminal' }
        const cinT = rail(sub) // ten's-complement +1 when subtracting, 0 when adding
        const edges: Record<string, unknown>[] = [...(tiled.edges as Record<string, unknown>[])]
        edges.push({
          id: 'subsrc',
          type: 'net',
          source: idAt(0),
          sourceHandle: 'sub',
          target: cinT.t,
          targetHandle: cinT.th,
        })
        edges.push({
          id: 'vddsrc',
          type: 'net',
          source: 'vp',
          sourceHandle: 'terminal_positive',
          target: idAt(0),
          targetHandle: 'v_dd',
        })
        edges.push({
          id: 'gndsrc',
          type: 'net',
          source: idAt(0),
          sourceHandle: 'gnd',
          target: 'g',
          targetHandle: 'reference_terminal',
        })
        edges.push({
          id: 'cin0',
          type: 'net',
          source: idAt(0),
          sourceHandle: 'cin',
          target: cinT.t,
          targetHandle: cinT.th,
        })
        edges.push({
          id: 'vpn',
          type: 'net',
          source: 'vp',
          sourceHandle: 'terminal_negative',
          target: 'g',
          targetHandle: 'reference_terminal',
        })
        for (let d = 0; d < 10; d++) {
          for (let i = 0; i < 4; i++) {
            const at = rail(digitBit(a, d, i) === 1)
            const bt = rail(digitBit(b, d, i) === 1)
            edges.push({
              id: `a${d}_${i}`,
              type: 'net',
              source: idAt(d),
              sourceHandle: `a${i}`,
              target: at.t,
              targetHandle: at.th,
            })
            edges.push({
              id: `b${d}_${i}`,
              type: 'net',
              source: idAt(d),
              sourceHandle: `b${i}`,
              target: bt.t,
              targetHandle: bt.th,
            })
            edges.push({
              id: `sd${d}_${i}`,
              type: 'net',
              source: idAt(d),
              sourceHandle: `s${i}`,
              target: `dec${d}`,
              targetHandle: `d${i}`,
            })
          }
          edges.push({
            id: `decv${d}`,
            type: 'net',
            source: 'vp',
            sourceHandle: 'terminal_positive',
            target: `dec${d}`,
            targetHandle: 'v_dd',
          })
          edges.push({
            id: `decg${d}`,
            type: 'net',
            source: `dec${d}`,
            sourceHandle: 'gnd',
            target: 'g',
            targetHandle: 'reference_terminal',
          })
          for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
            edges.push({
              id: `seg${s}${d}`,
              type: 'net',
              source: `dec${d}`,
              sourceHandle: `seg_${s}`,
              target: `disp${d}`,
              targetHandle: `seg_${s}`,
            })
          }
          edges.push({
            id: `dispc${d}`,
            type: 'net',
            source: `disp${d}`,
            sourceHandle: 'common',
            target: 'g',
            targetHandle: 'reference_terminal',
          })
        }
        setNodes(() => nodes as unknown as Node[])
        setEdges(() => edges as unknown as Edge[])
        setAutoRouteWires(true)
        reSolve(nodes as unknown as Node[], edges as unknown as Edge[])
        return JSON.stringify({
          expected: sub ? (((a - b) % 1e10) + 1e10) % 1e10 : (a + b) % 1e10,
          cells: 10,
        })
      },
      latchStep(sHigh: boolean, rHigh: boolean) {
        // DEV (verify sequential on the REAL canvas): inject a wired SR latch + sources, then run the
        // actual reSolve (which threads logicStateRef). Step the sources and read Q from the app's own
        // solved terminalVolts — Q must hold between sets, proving state persists across real re-solves.
        const supply = (v: number) => ({
          nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        })
        const nodes = [
          {
            id: 'L',
            type: 'block',
            position: { x: 440, y: 240 },
            data: {
              definition: 'block',
              label: 'SR',
              block: BUILTIN_BLOCKS.logic_sr_latch,
              fidelity: 'logic',
            },
          },
          {
            id: 'g',
            type: 'device',
            position: { x: 160, y: 440 },
            data: { definition: 'ground', label: 'GND' },
          },
          {
            id: 'vs',
            type: 'device',
            position: { x: 160, y: 300 },
            data: { definition: 'power_source', label: 'S', parameters: supply(sHigh ? 5 : 0) },
          },
          {
            id: 'vr',
            type: 'device',
            position: { x: 160, y: 200 },
            data: { definition: 'power_source', label: 'R', parameters: supply(rHigh ? 5 : 0) },
          },
          {
            id: 'vp',
            type: 'device',
            position: { x: 160, y: 100 },
            data: { definition: 'power_source', label: 'V+', parameters: supply(5) },
          },
        ] as unknown as Node[]
        const edges = [
          {
            id: 'es',
            type: 'net',
            source: 'vs',
            sourceHandle: 'terminal_positive',
            target: 'L',
            targetHandle: 's',
          },
          {
            id: 'er',
            type: 'net',
            source: 'vr',
            sourceHandle: 'terminal_positive',
            target: 'L',
            targetHandle: 'r',
          },
          {
            id: 'ep',
            type: 'net',
            source: 'vp',
            sourceHandle: 'terminal_positive',
            target: 'L',
            targetHandle: 'v_dd',
          },
          {
            id: 'eg',
            type: 'net',
            source: 'L',
            sourceHandle: 'gnd',
            target: 'g',
            targetHandle: 'reference_terminal',
          },
          {
            id: 'esn',
            type: 'net',
            source: 'vs',
            sourceHandle: 'terminal_negative',
            target: 'g',
            targetHandle: 'reference_terminal',
          },
          {
            id: 'ern',
            type: 'net',
            source: 'vr',
            sourceHandle: 'terminal_negative',
            target: 'g',
            targetHandle: 'reference_terminal',
          },
          {
            id: 'epn',
            type: 'net',
            source: 'vp',
            sourceHandle: 'terminal_negative',
            target: 'g',
            targetHandle: 'reference_terminal',
          },
        ] as unknown as Edge[]
        setNodes(() => nodes)
        setEdges(() => edges)
        reSolve(nodes, edges)
      },
      showSram() {
        checkpointAction('dev: show sram')
        const supplyParams = {
          nominal_voltage: { value: { kind: 'scalar', amount: 5, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
        }
        setNodes((cur) => [
          ...cur.filter((n) => !['SRAMW', 'SV', 'SWL', 'SBL', 'SG'].includes(n.id)),
          {
            id: 'SRAMW',
            type: 'block',
            position: { x: 520, y: 240 },
            data: {
              // generic 'block' literal (like a palette drop) so double-click descends in to inspect the cells
              definition: 'block',
              label: 'SRAMW',
              block: BUILTIN_BLOCKS.memory_sram_word_4bit,
            },
          } as Node,
          {
            id: 'SV',
            type: 'device',
            position: { x: 140, y: 150 },
            data: { definition: 'power_source', label: 'V+', parameters: supplyParams },
          } as Node,
          {
            id: 'SWL',
            type: 'device',
            position: { x: 140, y: 280 },
            data: { definition: 'power_source', label: 'WL', parameters: supplyParams },
          } as Node,
          {
            id: 'SBL',
            type: 'device',
            position: { x: 140, y: 410 },
            data: { definition: 'power_source', label: 'BL', parameters: supplyParams },
          } as Node,
          {
            id: 'SG',
            type: 'device',
            position: { x: 140, y: 540 },
            data: { definition: 'ground', label: 'GND' },
          } as Node,
        ])
        setEdges((cur) => [
          ...cur.filter((e) => !e.id.startsWith('sw_')),
          {
            id: 'sw_vp',
            type: 'net',
            source: 'SV',
            sourceHandle: 'terminal_positive',
            target: 'SRAMW',
            targetHandle: 'v_dd',
          } as Edge,
          {
            id: 'sw_vn',
            type: 'net',
            source: 'SV',
            sourceHandle: 'terminal_negative',
            target: 'SG',
            targetHandle: 'reference_terminal',
          } as Edge,
          {
            id: 'sw_g',
            type: 'net',
            source: 'SRAMW',
            sourceHandle: 'gnd',
            target: 'SG',
            targetHandle: 'reference_terminal',
          } as Edge,
          {
            id: 'sw_wlp',
            type: 'net',
            source: 'SWL',
            sourceHandle: 'terminal_positive',
            target: 'SRAMW',
            targetHandle: 'wl',
          } as Edge,
          {
            id: 'sw_wln',
            type: 'net',
            source: 'SWL',
            sourceHandle: 'terminal_negative',
            target: 'SG',
            targetHandle: 'reference_terminal',
          } as Edge,
          {
            id: 'sw_bln',
            type: 'net',
            source: 'SBL',
            sourceHandle: 'terminal_negative',
            target: 'SG',
            targetHandle: 'reference_terminal',
          } as Edge,
          ...[0, 1, 2, 3].flatMap((i) => [
            {
              id: `sw_blp${i}`,
              type: 'net',
              source: 'SBL',
              sourceHandle: 'terminal_positive',
              target: 'SRAMW',
              targetHandle: `bl${i}`,
            } as Edge,
            {
              id: `sw_blb${i}`,
              type: 'net',
              source: 'SRAMW',
              sourceHandle: `blb${i}`,
              target: 'SG',
              targetHandle: 'reference_terminal',
            } as Edge,
          ]),
        ])
      },
      // Show the BARE display's honest behaviour side by side: the LEFT one is driven straight off 5 V
      // with NO resistor (its LEDs over-current and BURST); the RIGHT one is driven through real 330 Ω
      // resistors (it lights a safe "7"). Proves the bare part needs external current limiting, like the
      // real component, and that the resistors are what make the shipped module safe.
      showBare() {
        checkpointAction('dev: show bare display')
        const src = (rInternal: number) => ({
          nominal_voltage: { value: { kind: 'scalar', amount: 5, unit: 'volt' } },
          internal_resistance: { value: { kind: 'scalar', amount: rInternal, unit: 'ohm' } },
        })
        const res330 = { resistance: { value: { kind: 'scalar', amount: 330, unit: 'ohm' } } }
        const segs = ['a', 'b', 'c'] // a "7"
        const bare = BUILTIN_BLOCKS.display_seven_segment_bare
        setNodes((cur) => [
          ...cur.filter((n) => !n.id.startsWith('BARE')),
          {
            id: 'BARE_RAW',
            type: 'block',
            position: { x: 360, y: 180 },
            data: {
              definition: 'display_seven_segment_bare',
              label: 'raw — no resistors',
              block: bare,
            },
          } as Node,
          {
            id: 'BARE_VRAW',
            type: 'device',
            position: { x: 140, y: 200 },
            data: { definition: 'power_source', label: '5V', parameters: src(1) },
          } as Node,
          {
            id: 'BARE_OK',
            type: 'block',
            position: { x: 820, y: 180 },
            data: { definition: 'display_seven_segment_bare', label: 'with 330Ω', block: bare },
          } as Node,
          {
            id: 'BARE_VOK',
            type: 'device',
            position: { x: 1100, y: 200 },
            data: { definition: 'power_source', label: '5V', parameters: src(0) },
          } as Node,
          ...segs.map(
            (s, i) =>
              ({
                id: `BARE_R${s}`,
                type: 'device',
                position: { x: 1000, y: 120 + i * 70 },
                data: { definition: 'resistor', label: '330Ω', parameters: res330 },
              }) as Node,
          ),
          {
            id: 'BARE_GND',
            type: 'device',
            position: { x: 140, y: 420 },
            data: { definition: 'ground', label: 'GND' },
          } as Node,
        ])
        setEdges((cur) => [
          ...cur.filter((e) => !e.id.startsWith('wb_')),
          {
            id: 'wb_raw_common',
            type: 'net',
            source: 'BARE_RAW',
            sourceHandle: 'common',
            target: 'BARE_GND',
            targetHandle: 'reference_terminal',
          } as Edge,
          {
            id: 'wb_vraw_n',
            type: 'net',
            source: 'BARE_VRAW',
            sourceHandle: 'terminal_negative',
            target: 'BARE_GND',
            targetHandle: 'reference_terminal',
          } as Edge,
          ...segs.map(
            (s) =>
              ({
                id: `wb_raw_${s}`,
                type: 'net',
                source: 'BARE_VRAW',
                sourceHandle: 'terminal_positive',
                target: 'BARE_RAW',
                targetHandle: `seg_${s}`,
              }) as Edge,
          ),
          {
            id: 'wb_ok_common',
            type: 'net',
            source: 'BARE_OK',
            sourceHandle: 'common',
            target: 'BARE_GND',
            targetHandle: 'reference_terminal',
          } as Edge,
          {
            id: 'wb_vok_n',
            type: 'net',
            source: 'BARE_VOK',
            sourceHandle: 'terminal_negative',
            target: 'BARE_GND',
            targetHandle: 'reference_terminal',
          } as Edge,
          ...segs.flatMap((s) => [
            {
              id: `wb_okv_${s}`,
              type: 'net',
              source: 'BARE_VOK',
              sourceHandle: 'terminal_positive',
              target: `BARE_R${s}`,
              targetHandle: 'terminal_a',
            } as Edge,
            {
              id: `wb_okr_${s}`,
              type: 'net',
              source: `BARE_R${s}`,
              sourceHandle: 'terminal_b',
              target: 'BARE_OK',
              targetHandle: `seg_${s}`,
            } as Edge,
          ]),
        ])
      },
      // Read the canvas as DATA so the AI can ASSERT behaviour over CDP without a screenshot: nodes
      // (with each block's pin sides + position) and edges (endpoints + how many hand-laid corners).
      state() {
        return {
          nodes: nodesRef.current.map((n) => {
            const block = (n.data as { block?: BlockData }).block
            return {
              id: n.id,
              type: n.type,
              x: Math.round(n.position.x),
              y: Math.round(n.position.y),
              ...(block
                ? { ports: block.ports.map((p) => ({ id: p.id, side: p.side, name: p.name })) }
                : {}),
            }
          }),
          edges: edgesRef.current.map((e) => {
            const wp = (e.data as { waypoints?: unknown[] } | undefined)?.waypoints
            return {
              id: e.id,
              source: e.source,
              sourceHandle: e.sourceHandle,
              target: e.target,
              targetHandle: e.targetHandle,
              corners: Array.isArray(wp) ? wp.length : 0,
            }
          }),
        }
      },
      // Read the RENDER itself (DOM, not a screenshot): each handle's measured side + screen centre,
      // and each wire's drawn end-point — so the AI can assert e.g. a wire's end sits ON its pin.
      dom() {
        const handles = [...document.querySelectorAll('.react-flow__handle')].map((h) => {
          const r = h.getBoundingClientRect()
          return {
            node: h.closest('.react-flow__node')?.getAttribute('data-id') ?? null,
            id: h.getAttribute('data-handleid'),
            side: h.getAttribute('data-handlepos'),
            x: Math.round(r.x + r.width / 2),
            y: Math.round(r.y + r.height / 2),
          }
        })
        const edges = [...document.querySelectorAll('.react-flow__edge')].map((e) => {
          const p = e.querySelector('path.react-flow__edge-path') as SVGPathElement | null
          let end: { x: number; y: number } | null = null
          if (p) {
            const m = p.getScreenCTM()
            const pt = p.getPointAtLength(p.getTotalLength())
            if (m) {
              const s = pt.matrixTransform(m)
              end = { x: Math.round(s.x), y: Math.round(s.y) }
            }
          }
          return { id: e.getAttribute('data-id'), end }
        })
        return { handles, edges }
      },
    }
    const w = window as unknown as { __chip?: typeof api | undefined }
    w.__chip = api
    return () => {
      w.__chip = undefined
    }
  }, [
    setNodes,
    setEdges,
    onEditBlockPort,
    checkpointAction,
    updateNodeInternals,
    reSolve,
    placeCalculator,
    pressCalcKey,
    calcSolve,
  ])

  // Zoom to the SELECTED parts (or fit all if none) — precise framing, easier than the wheel.
  const zoomToSelection = useCallback(() => {
    const sel = nodes.filter((n) => n.selected).map((n) => ({ id: n.id }))
    fitView(
      sel.length > 0
        ? { nodes: sel, duration: 300, padding: 0.6, maxZoom: 8 }
        : { duration: 300, maxZoom: 2 },
    )
  }, [nodes, fitView])

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

  // Click-by-click CAD-style wire drawing (start anywhere, drop corners, finish on a dot or
  // double-click in space → junction) lives in its own hook now (use-wire-tool.ts); its couplings to
  // the canvas — the node/edge/undo state, the active tool, the wire gauge, the cancel keybind, the
  // coordinate transform, and the shared id counter — are injected.
  const wire = useWireTool({
    tool,
    wireGauge,
    cancelWire: keybinds.cancelWire,
    setEdges,
    setNodes,
    checkpointAction,
    screenToFlowPosition,
    dropCount,
  })
  wireRef.current = wire
  // The Connect tool's state machine (pick a start dot → pick an end dot → auto-route; Batch queues +
  // "Route all") lives in its own hook now; its couplings to the canvas — the edge/undo/routing state,
  // the active tool, the wire gauge, and the cancel keybind — are injected.
  const connect = useConnectTool({
    tool,
    wireGauge,
    cancelWire: keybinds.cancelWire,
    setEdges,
    setAutoRouteWires,
    checkpointAction,
  })
  connectRef.current = connect

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
  // A selected circuit BLOCK → the pinout editor (instead of the part properties).
  const selectedBlock =
    selectedNode?.type === 'block' ? (selectedNode.data as { block?: BlockData }).block : undefined
  // The block's internal terminals NOT yet exposed as pins — offered in the "add pin" picker so a
  // pinout can be pre-defined before anything is wired out.
  const availableTerminals: AddableTerminal[] = !selectedBlock
    ? []
    : selectedBlock.nodes
        .flatMap((inner) =>
          (inner.block
            ? inner.block.ports.map((p) => p.id)
            : terminalsOf(inner.definition, inner.parameters).map((t) => t.id)
          ).map((handleId) => ({ nodeId: inner.id, handleId })),
        )
        .filter(
          (t) =>
            !selectedBlock.ports.some(
              (p) => p.inner.nodeId === t.nodeId && p.inner.handleId === t.handleId,
            ),
        )
        .map((t) => ({ ...t, label: `${t.nodeId} · ${t.handleId.replace(/_/g, ' ')}` }))
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

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the dock-grid is the drop target for palette parts; keyboard-accessible placement is future work
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: light ? THEME.textBright : THEME.surfaceDeep,
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
        data-workspace-mode={workspaceMode}
        onClickCapture={(event) => {
          // The board workspace owns the main area — schematic tool dispatch is inert under it.
          if (workspaceMode === 'board') return
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
          if (onBodeProbeClick(event)) return
          if (onScopeProbeClick(event)) return
          onMeterClick(event)
          wire.onWireClick(event)
          connect.onConnectClick(event)
        }}
        onDoubleClickCapture={(event) => {
          if (workspaceMode === 'board') return
          wire.onWireDoubleClick(event)
        }}
        onMouseMove={(event) => {
          if (workspaceMode === 'board') return
          lastCursorFlow.current = screenToFlowPosition({ x: event.clientX, y: event.clientY })
          wire.onWireMove(event)
        }}
        onPointerDown={(event) => {
          if (workspaceMode === 'board') return
          onLassoDown(event)
          onBoxDown(event)
        }}
        onPointerMove={(event) => {
          if (workspaceMode === 'board') return
          onLassoMove(event)
          onBoxMove(event)
        }}
        onPointerUp={() => {
          if (workspaceMode === 'board') return
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
        {/* The BOARD WORKSPACE — the physical board as a full-size editing surface filling the main
            area, layered opaquely over the schematic (which stays mounted, its state intact). The
            ancestor's schematic pointer handlers are gated on schematic mode so they don't fire under
            the board. The dock PCB panel still works independently. */}
        {workspaceMode === 'board' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 40,
              background: THEME.surfaceBase,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 12px',
                borderBottom: `1px solid ${THEME.borderSubtle}`,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 12, color: THEME.textSoft, fontWeight: 600 }}>Board</span>
              <span style={{ fontSize: 11, color: THEME.textFaint }}>
                {pcbBoard.placements.length} part{pcbBoard.placements.length === 1 ? '' : 's'} ·{' '}
                {pcbBoard.outline.w.toFixed(1)} × {pcbBoard.outline.h.toFixed(1)} mm
                {pcbRatsnest.airwires.length > 0 &&
                  ` · ${pcbRatsnest.airwires.length - pcbMergedRouting.unrouted.length}/${pcbRatsnest.airwires.length} routed`}
                {pcbDrc.length > 0 && (
                  <span style={{ color: THEME.statusDanger }}> · DRC: {pcbDrc.length}</span>
                )}
              </span>
              <PcbViewControls
                mode={pcbViewMode}
                onMode={setPcbViewMode}
                layers={pcbLayers}
                activeLayerIndex={pcbActiveLayerIndex}
                onStep={stepPcbLayer}
              />
              {pcbViewMode !== 'exploded' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setBoardTool((t) => (t === 'route' ? 'select' : 'route'))}
                    title="Route tool — click a pad to start, click to drop corners, click a same-net pad to finish (Esc cancels). Draws real copper on the active layer that ships in the Gerbers."
                    style={{
                      border: `1px solid ${THEME.borderStrong}`,
                      background: boardTool === 'route' ? THEME.accentBlue : THEME.surfaceInput,
                      color: boardTool === 'route' ? '#0b1220' : THEME.textSoft,
                      borderRadius: 4,
                      fontSize: 11,
                      padding: '2px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    ▬ Route
                  </button>
                  <button
                    type="button"
                    onClick={() => setBoardTool((t) => (t === 'via' ? 'select' : 'via'))}
                    title="Via tool — click on copper (a pad or a trace) to drop a plated via there: the vertical jump that carries the net between the two copper layers. Shows as a real barrel in the 3-D view."
                    style={{
                      border: `1px solid ${THEME.borderStrong}`,
                      background: boardTool === 'via' ? THEME.accentBlue : THEME.surfaceInput,
                      color: boardTool === 'via' ? '#0b1220' : THEME.textSoft,
                      borderRadius: 4,
                      fontSize: 11,
                      padding: '2px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    ⊙ Via
                  </button>
                  {boardTool === 'route' && (
                    <span style={{ display: 'flex', gap: 0 }}>
                      {(['f_cu', 'b_cu'] as const).map((id, i) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setPcbActiveLayerId(id)}
                          title={
                            id === 'f_cu' ? 'Route on the top copper' : 'Route on the bottom copper'
                          }
                          style={{
                            border: `1px solid ${THEME.borderStrong}`,
                            background:
                              pcbActiveLayerId === id
                                ? id === 'f_cu'
                                  ? '#ffcf6b'
                                  : '#6b9bff'
                                : THEME.surfaceInput,
                            color: pcbActiveLayerId === id ? '#0b1220' : THEME.textSoft,
                            borderRadius: i === 0 ? '4px 0 0 4px' : '0 4px 4px 0',
                            borderLeft: i === 0 ? undefined : 'none',
                            fontSize: 11,
                            padding: '2px 8px',
                            cursor: 'pointer',
                          }}
                        >
                          {id === 'f_cu' ? 'Top' : 'Bottom'}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              )}
              <button
                type="button"
                onClick={onWorkspace}
                title="Return to the schematic canvas"
                style={{
                  marginLeft: 'auto',
                  border: `1px solid ${THEME.borderStrong}`,
                  background: THEME.surfaceInput,
                  color: THEME.textSoft,
                  borderRadius: 4,
                  fontSize: 11,
                  padding: '3px 10px',
                  cursor: 'pointer',
                }}
              >
                ← Schematic
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {pcbBoard.placements.length > 0 ? (
                <BoardView
                  board={pcbBoard}
                  stackup={pcbStackup}
                  routing={pcbMergedRouting}
                  drcMarkers={pcbDrc.map((v) => v.at)}
                  mode={pcbViewMode}
                  activeLayer={pcbActiveLayerId}
                  pxPerMm={16}
                  viewHeight={560}
                  onMove={onPcbMove}
                  onRotate={onPcbRotate}
                  route={{
                    active: boardTool === 'route' && pcbViewMode !== 'exploded',
                    padBoxes: pcbRatsnest.padBoxes,
                    onClick: onBoardRouteClick,
                    onMove: onBoardRouteMove,
                    viaActive: boardTool === 'via' && pcbViewMode !== 'exploded',
                    onViaClick: onBoardViaClick,
                    cursor: routeCursor,
                    color: activeCopperLayer === 'bottom' ? '#6b9bff' : '#ffcf6b',
                    ...(pendingRoute ? { pendingPoints: pendingRoute.points } : {}),
                  }}
                />
              ) : (
                <span style={{ fontSize: 12, color: THEME.textFaint }}>
                  No parts with footprints on the board yet — add parts in the schematic (resistors,
                  capacitors, ICs…) and they appear here as real footprints to place.
                </span>
              )}
            </div>
          </div>
        )}
        <HealthContext.Provider value={shownHealth}>
          <CrtScreenContext.Provider value={crtScreens}>
            <LensContext.Provider value={lensState}>
              <FrameEdgeContext.Provider value={frameEdges}>
                <FrontContext.Provider value={frontState}>
                  <AutoRouteContext.Provider value={autoRouteWires}>
                    <GlobalRoutesContext.Provider value={globalRoutes}>
                      <PartBoxesContext.Provider value={partBoxes}>
                        <WireGeomContext.Provider value={reportWireGeom}>
                          <WireColorContext.Provider value={netColorByEdge}>
                            <CheckpointContext.Provider value={checkpointAction}>
                              <ReactFlow
                                colorMode={light ? 'light' : 'dark'}
                                nodes={nodes}
                                edges={edges}
                                onNodesChange={onNodesChange}
                                onEdgesChange={onEdgesChange}
                                onConnect={onConnect}
                                onReconnect={onReconnect}
                                onNodeDoubleClick={onNodeDoubleClick}
                                onNodeClick={(_event, node) => {
                                  // A calculator keypad button (a real momentary switch tagged with its key):
                                  // clicking it types that key into the control unit and re-solves the display.
                                  const calcKey = (node.data as DeviceNodeData).calcKey
                                  if (typeof calcKey === 'string') {
                                    pressCalcKey(calcKey)
                                    return
                                  }
                                  if (
                                    node.type === 'junction' &&
                                    (node.data as { fromCrossing?: boolean } | undefined)
                                      ?.fromCrossing === true
                                  ) {
                                    unjoinCrossing(node.id)
                                  }
                                }}
                                onNodeContextMenu={(event, node) => {
                                  if (node.type !== 'device' && node.type !== 'block') return
                                  event.preventDefault()
                                  selectNodeById(node.id)
                                  setCanvasMenu({
                                    x: event.clientX,
                                    y: event.clientY,
                                    kind: 'part',
                                  })
                                }}
                                onPaneContextMenu={(event) => {
                                  event.preventDefault()
                                  setCanvasMenu({
                                    x: event.clientX,
                                    y: event.clientY,
                                    kind: 'pane',
                                    flow: screenToFlowPosition({
                                      x: event.clientX,
                                      y: event.clientY,
                                    }),
                                  })
                                }}
                                onNodeDragStart={(_event, node) => {
                                  checkpointAction('move')
                                  dragStartPos.current = new Map(
                                    nodes
                                      .filter((n) => n.id === node.id || n.selected)
                                      .map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
                                  )
                                }}
                                onNodeDragStop={(_event, node) => {
                                  if (node.type !== 'device' && node.type !== 'block') return
                                  setNodes((cur) => {
                                    const dragged = dragStartPos.current
                                    const box = (n: (typeof cur)[number]) => ({
                                      x: n.position.x,
                                      y: n.position.y,
                                      w: n.measured?.width ?? 88,
                                      h: n.measured?.height ?? 56,
                                    })
                                    const hit = (
                                      a: (typeof cur)[number],
                                      b: (typeof cur)[number],
                                    ) => {
                                      const A = box(a)
                                      const B = box(b)
                                      const m = 6 // a little breathing room so parts never touch
                                      return (
                                        A.x < B.x + B.w + m &&
                                        A.x + A.w + m > B.x &&
                                        A.y < B.y + B.h + m &&
                                        A.y + A.h + m > B.y
                                      )
                                    }
                                    const isPart = (n: (typeof cur)[number]) =>
                                      n.type === 'device' || n.type === 'block'
                                    const collides = cur.some(
                                      (moved) =>
                                        dragged.has(moved.id) &&
                                        cur.some(
                                          (o) => isPart(o) && !dragged.has(o.id) && hit(moved, o),
                                        ),
                                    )
                                    if (!collides) return cur
                                    // overlap — snap every dragged part back to where it started
                                    return cur.map((n) => {
                                      const start = dragged.get(n.id)
                                      return start ? { ...n, position: start } : n
                                    })
                                  })
                                }}
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
                                panOnDrag={tool === 'lasso' ? false : [1]}
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
                                snapToGrid={snapToGrid}
                                snapGrid={SNAP_GRID}
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
                                {/* The drawing sheet (page frame + ISO zone grid + title block), behind parts. */}
                                {showSheet ? (
                                  <SheetFrame
                                    settings={sheetSettings}
                                    projectName={project.name}
                                    light={light}
                                    onEdit={(patch) =>
                                      setSheetSettings((current) => ({ ...current, ...patch }))
                                    }
                                  />
                                ) : null}
                                {/* Coordinate-graph axes through the origin + the four quadrants. */}
                                <CoordinateAxes light={light} />
                                <Controls>
                                  <ControlButton
                                    onClick={() => setSnapToGrid((s) => !s)}
                                    title={
                                      snapToGrid
                                        ? 'Snap to grid: ON — parts align to the grid (click for free placement)'
                                        : 'Snap to grid: OFF — free placement (click to snap parts to the grid)'
                                    }
                                    style={
                                      snapToGrid
                                        ? { background: THEME.accentBlue, color: THEME.textBright }
                                        : undefined
                                    }
                                  >
                                    #
                                  </ControlButton>
                                  <ControlButton
                                    onClick={() => setAutoRouteWires((v) => !v)}
                                    title={
                                      autoRouteWires
                                        ? 'Auto-route wires: ON — plain wires route as straight lines around the parts (click for straight point-to-point wires)'
                                        : 'Auto-route wires: OFF — wires run straight, you route them by hand (click to auto-route them around the parts)'
                                    }
                                    style={
                                      autoRouteWires
                                        ? { background: THEME.accentBlue, color: THEME.textBright }
                                        : undefined
                                    }
                                  >
                                    ∟
                                  </ControlButton>
                                  <ControlButton
                                    onClick={() => setColorWires((v) => !v)}
                                    title={
                                      colorWires
                                        ? 'Colour wires for tracing: ON — each wire has its own dull shade so you can follow it end to end (visual only; click for plain wires)'
                                        : 'Colour wires for tracing: OFF — plain wires (click to give each wire its own dull shade so you can trace it, visual only)'
                                    }
                                    style={
                                      colorWires
                                        ? { background: THEME.accentBlue, color: THEME.textBright }
                                        : undefined
                                    }
                                  >
                                    🎨
                                  </ControlButton>
                                  <ControlButton
                                    onClick={zoomToSelection}
                                    title="Zoom to selection — frames the selected parts (fits all if none selected)"
                                  >
                                    ⊙
                                  </ControlButton>
                                </Controls>
                                <MeterProbes red={redProbe} black={blackProbe} />
                                {/* Scope channel probes (S19-v3-77): one colored clip per
                    voltage channel. Wire clamps show in the channel chips. */}
                                {scopeOpen
                                  ? scopeProbes.map((p) => {
                                      if (p.kind !== 'terminal') return null
                                      // Color + CH number come from the probe's slot in the RESOLVED channel
                                      // list (what the traces and chips index), NOT its raw scopeProbes index —
                                      // an unresolved probe earlier in the list would otherwise shift this off,
                                      // so the on-canvas marker disagreed with the plotted trace. No channel
                                      // (the probe didn't resolve → no trace) ⇒ no marker.
                                      const ch = scopeChannels.findIndex(
                                        (c) => c.key === scopeProbeKey(p),
                                      )
                                      if (ch < 0) return null
                                      return (
                                        <ProbeMarker
                                          key={scopeProbeKey(p)}
                                          probe={{ nodeId: p.nodeId, handleId: p.handleId }}
                                          color={
                                            TRACE_COLORS[ch % TRACE_COLORS.length] ??
                                            THEME.textMuted
                                          }
                                          label={`CH${ch + 1}`}
                                        />
                                      )
                                    })
                                  : null}
                                {wire.pendingWire !== null ? (
                                  <PendingWirePreview
                                    pending={wire.pendingWire}
                                    cursor={wire.wireCursor}
                                    curved={wire.wireStyle === 'curve'}
                                    curveRadius={wire.wireCurveRadius}
                                  />
                                ) : null}
                                {tool === 'connect' ? (
                                  <ConnectPointsOverlay
                                    nodes={nodes}
                                    start={connect.connectStart}
                                    queue={connect.connectQueue}
                                    onPick={connect.onPickConnectPoint}
                                  />
                                ) : null}
                                <WireCrossingsOverlay
                                  crossings={wireCrossings}
                                  onJoin={joinCrossing}
                                  light={light}
                                />
                              </ReactFlow>
                            </CheckpointContext.Provider>
                          </WireColorContext.Provider>
                        </WireGeomContext.Provider>
                      </PartBoxesContext.Provider>
                    </GlobalRoutesContext.Provider>
                  </AutoRouteContext.Provider>
                </FrontContext.Provider>
              </FrameEdgeContext.Provider>
            </LensContext.Provider>
          </CrtScreenContext.Provider>
        </HealthContext.Provider>

        <div
          style={{
            position: 'absolute',
            bottom: 8,
            right: 12,
            zIndex: 10,
            color: THEME.textFaint,
            fontSize: 11,
            fontFamily: 'system-ui, sans-serif',
            pointerEvents: 'none',
          }}
        >
          {/* The solve's own notes — a floating circuit set aside, an unsupported element —
              were invisible before: the engine explained itself only to the test suite. */}
          {(solution?.warnings.length ?? 0) > 0 ? (
            <div
              style={{
                color: THEME.statusWarn,
                marginBottom: 3,
                maxWidth: 560,
                whiteSpace: 'normal',
                textAlign: 'right',
              }}
            >
              {[...new Set(solution.warnings)].slice(0, 2).map((w) => (
                <div key={w}>⚠ {w}</div>
              ))}
              {new Set(solution.warnings).size > 2 ? (
                <div>… and {new Set(solution.warnings).size - 2} more</div>
              ) : null}
            </div>
          ) : null}
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

        {netlistReport !== null ? (
          <NetlistReportCard report={netlistReport} onDismiss={() => setNetlistReport(null)} />
        ) : null}
        {pickerOpen ? <PartPicker onPick={placePart} onClose={() => setPickerOpen(false)} /> : null}
        {pageSettingsOpen ? (
          <PageSettings
            settings={sheetSettings}
            showSheet={showSheet}
            onChange={setSheetSettings}
            onToggleSheet={setShowSheet}
            onClose={() => setPageSettingsOpen(false)}
          />
        ) : null}
        {canvasMenu !== null ? (
          <ContextMenu
            x={canvasMenu.x}
            y={canvasMenu.y}
            onClose={() => setCanvasMenu(null)}
            items={
              canvasMenu.kind === 'part'
                ? [
                    { label: 'Copy', shortcut: 'Ctrl+C', action: doCopy },
                    { label: 'Rotate', shortcut: 'R', action: doRotate },
                    { label: 'Delete', shortcut: 'Del', action: doDelete, danger: true },
                  ]
                : [
                    {
                      label: 'Paste',
                      shortcut: 'Ctrl+V',
                      action: () => doPaste(undefined, 'cursor', canvasMenu.flow),
                      disabled: latestItem(clipboard) === null,
                    },
                    { label: 'Add Part', action: () => setPickerOpen(true) },
                    { label: 'Select All', shortcut: 'Ctrl+A', action: doSelectAll },
                    { label: 'Open Clipboard', action: () => setShowClipboard(true) },
                    {
                      label: showSheet ? 'Hide Drawing Sheet' : 'Show Drawing Sheet',
                      action: () => setShowSheet((s) => !s),
                    },
                    { label: 'Page Settings…', action: () => setPageSettingsOpen(true) },
                  ]
            }
          />
        ) : null}

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
              stroke={THEME.accentPurple}
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
              background: light ? THEME.textBright : THEME.surfaceBase,
              border: light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderSubtle}`,
              borderRadius: 6,
              fontFamily: 'system-ui, sans-serif',
              fontSize: 12,
              color: light ? THEME.borderSubtle : THEME.textBright,
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
                      ...(blownFuses[jack] !== null ? { color: THEME.statusDanger } : {}),
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
              background: light ? THEME.textBright : THEME.surfaceBase,
              border: light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderSubtle}`,
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              fontFamily: 'system-ui, sans-serif',
              fontSize: 12,
              color: light ? THEME.borderSubtle : THEME.textPrimary,
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
                border: light
                  ? `1px solid ${THEME.textPrimary}`
                  : `1px solid ${THEME.borderSubtle}`,
                background: light ? THEME.white : THEME.surfaceRaised,
                color: light ? THEME.borderSubtle : THEME.textBright,
                fontSize: 12,
              }}
            />
            {groupPrompt.error !== null ? (
              <div style={{ color: THEME.statusDanger, fontSize: 11 }}>{groupPrompt.error}</div>
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
            colorWires={colorWires}
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
        {shortcutsPanel}

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
              background: light ? THEME.textBright : THEME.surfaceBase,
              border: light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderSubtle}`,
              borderRadius: 6,
              fontFamily: 'system-ui, sans-serif',
              fontSize: 11,
              color: light ? THEME.borderSubtle : THEME.textPrimary,
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
                )} / ${formatEng(10 * lensState.fieldTesla, 'T')} (innermost) · Earth ≈ 25–65 µT · ⊙ field out of the screen, ⊗ into it (right-hand rule — they swap when the current reverses)`
              : 'no current flowing — no magnetic field to draw'}
          </div>
        ) : null}
        {lens === 'energy' ? (
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
              maxWidth: 560,
              background: light ? THEME.textBright : THEME.surfaceBase,
              border: light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderSubtle}`,
              borderRadius: 6,
              fontFamily: 'system-ui, sans-serif',
              fontSize: 11,
              color: light ? THEME.borderSubtle : THEME.textPrimary,
              pointerEvents: 'none',
            }}
          >
            <span aria-hidden style={{ color: ENERGY_COLOR, fontWeight: 700 }}>
              ↯
            </span>
            Energy flows IN to each load (and OUT of each source) through the FIELDS in the space
            around it — the Poynting vector S = E×H. The power arrives from the surrounding space
            (∮S·dA = V·I), not down the inside of the wire. Arrow size = the part’s power.
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
              background: light ? THEME.textBright : THEME.surfaceBase,
              border: light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderSubtle}`,
              borderRadius: 6,
              boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
              fontFamily: 'system-ui, sans-serif',
              fontSize: 11,
              color: light ? THEME.borderStrong : THEME.textSoft,
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
                border: light
                  ? `1px solid ${THEME.textPrimary}`
                  : `1px solid ${THEME.borderStrong}`,
                color: light ? THEME.borderStrong : THEME.textSoft,
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
        // ── THE PANELS — edit this to add / reorder / rename a dockable panel ──
        // Each entry is one panel: `title` (its tab name), `content` (its live UI), `visible`
        // (whether it shows now). ADD a panel → add an entry here + its id to the `order` list
        // passed to panelGroups below; that's all — it auto-docks at the bottom (an optional
        // panelLayout entry above only sets a different default dock + tab-group). REORDER →
        // reorder that list. RENAME → change `title`. Grouping (panel-groups.ts) tabs them up.
        const registry: Record<string, { title: string; content: ReactNode; visible: boolean }> = {
          hierarchy: {
            title: 'Hierarchy',
            visible: true,
            content: (
              <SchematicHierarchy
                nodes={nodes
                  .filter((n) => (n.data as { definition?: string }).definition !== 'junction')
                  .map((n) => ({
                    id: n.id,
                    definition: (n.data as { definition?: string }).definition ?? '',
                    blockName: (n.data as { block?: { name?: string } }).block?.name,
                    selected: n.selected === true,
                  }))}
                onSelect={selectNodeById}
                onCopy={doCopy}
                onDelete={doDelete}
                onLocate={doLocate}
              />
            ),
          },
          parts: {
            title: 'Parts',
            visible: false,
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
                wireStyle={wire.wireStyle}
                onWireStyle={wire.setWireStyle}
                curveRadius={wire.wireCurveRadius}
                onCurveRadius={wire.setWireCurveRadius}
                wireGauge={wireGauge}
                onWireGauge={setWireGauge}
                alwaysOn={alwaysOn}
                onAlwaysOn={setAlwaysOn}
                projectAmbientC={projectAmbientC}
                onProjectAmbient={onProjectAmbient}
                onSolve={handleSolve}
                onAddPart={() => setPickerOpen(true)}
                onScope={runScope}
                onTimeline={() => setTimelineOpen((open) => !open)}
                onMath={() => setShowMath((open) => !open)}
                onBode={() => setBodeOpen((open) => !open)}
                onPcb={() => setPcbOpen((open) => !open)}
                workspace={workspaceMode}
                onWorkspace={onWorkspace}
                onWorstCase={runWorstCase}
                onGroup={() => setGroupPrompt({ name: '', error: null })}
                canGroup={selectedCount >= 2}
                onClipboard={() => setShowClipboard((open) => !open)}
                clipboardCount={clipboard.copies.length + (clipboard.cut !== null ? 1 : 0)}
                lens={lens}
                onLens={selectLens}
                flow={flow}
                onFlow={selectFlow}
                connectMode={connect.connectMode}
                onConnectMode={connect.setConnectMode}
                connectQueueCount={connect.connectQueue.length}
                onRouteConnectQueue={connect.routeConnectQueue}
                onClearConnectQueue={connect.clearConnectQueue}
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
            ) : selectedBlock && selectedNode ? (
              <BlockInspector
                ports={selectedBlock.ports}
                block={selectedBlock}
                available={availableTerminals}
                fidelity={(selectedNode.data as DeviceNodeData).fidelity ?? 'transistor'}
                onFidelity={(f) => onSetFidelity(selectedNode.id, f)}
                onEditPort={(portId, patch) => onEditBlockPort(selectedNode.id, portId, patch)}
                onAddPort={(nodeId, handleId) => onAddBlockPort(selectedNode.id, nodeId, handleId)}
                onReorderPort={(portId, dir) => onReorderBlockPort(selectedNode.id, portId, dir)}
                onRemovePort={(portId) => onRemoveBlockPort(selectedNode.id, portId)}
              />
            ) : (
              <PartInspector
                selected={selectedPart}
                reading={selectedPart ? readings.get(selectedPart.id) : undefined}
                spotTrace={selectedPart ? crtTraces.get(selectedPart.id) : undefined}
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
                    setCrtTraces(new Map())
                  }}
                  className="nodrag"
                  style={{
                    background: 'none',
                    border: light
                      ? `1px solid ${THEME.textPrimary}`
                      : `1px solid ${THEME.borderStrong}`,
                    color: light ? THEME.borderStrong : THEME.textSoft,
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
          timeline: {
            title: 'Timeline',
            visible: timelineOpen,
            content: (
              <>
                <TimelinePanel
                  result={displayResult}
                  index={timelineIndex}
                  onIndex={setTimelineIndex}
                  light={light}
                />
                <button
                  type="button"
                  onClick={() => {
                    setFrontMode((m) => !m)
                    setTimelineIndex(0)
                  }}
                  className="nodrag"
                  title="Front mode — watch the charge propagate: it leaves the source and sweeps down the wires at finite speed (~2/3 c), reaching each part in the order the wire lengths set, slowed so you can see it. Play / scrub as usual; toggle off for the normal transient playback."
                  style={{
                    background: frontMode ? THEME.surfaceActive : 'none',
                    border: frontMode
                      ? `1px solid ${THEME.accentBlue}`
                      : light
                        ? `1px solid ${THEME.textPrimary}`
                        : `1px solid ${THEME.borderStrong}`,
                    color: frontMode
                      ? THEME.accentBlueSoft
                      : light
                        ? THEME.borderStrong
                        : THEME.textSoft,
                    borderRadius: 3,
                    padding: '2px 8px',
                    fontSize: 11,
                    cursor: 'pointer',
                    marginTop: 6,
                    marginRight: 6,
                  }}
                >
                  ⚡ Front{frontMode ? ' · on' : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setTimelineOpen(false)}
                  className="nodrag"
                  style={{
                    background: 'none',
                    border: light
                      ? `1px solid ${THEME.textPrimary}`
                      : `1px solid ${THEME.borderStrong}`,
                    color: light ? THEME.borderStrong : THEME.textSoft,
                    borderRadius: 3,
                    padding: '2px 8px',
                    fontSize: 11,
                    cursor: 'pointer',
                    marginTop: 6,
                  }}
                >
                  Close
                </button>
              </>
            ),
          },
          bode: {
            title: 'Bode',
            visible: bodeOpen,
            content: (
              <BodePanel
                world={bodeWorld}
                temperaturesC={solvedTemperatures}
                light={light}
                onClose={() => {
                  setBodeOpen(false)
                  setBodePicking(false)
                }}
                outputNet={bodeOutputNet}
                onOutputNet={setBodeOutputNet}
                picking={bodePicking}
                onPickToggle={() => setBodePicking((p) => !p)}
              />
            ),
          },
          timing: {
            title: 'Timing',
            visible: timing.hasRegisters,
            content: (
              <TimingPanel
                report={timing.report}
                clockDetected={timing.clockDetected}
                light={light}
              />
            ),
          },
          pcb: {
            title: 'PCB',
            visible: pcbOpen,
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span style={{ fontSize: 12, color: THEME.textSoft }}>
                    {pcbBoard.placements.length} part
                    {pcbBoard.placements.length === 1 ? '' : 's'} placed ·{' '}
                    {pcbBoard.outline.w.toFixed(1)} × {pcbBoard.outline.h.toFixed(1)} mm board
                    {/* routed CONNECTIONS, not trace count — one via'd connection is three traces */}
                    {pcbRatsnest.airwires.length > 0 &&
                      ` · ${pcbRatsnest.airwires.length - pcbMergedRouting.unrouted.length} of ${pcbRatsnest.airwires.length} connection${
                        pcbRatsnest.airwires.length === 1 ? '' : 's'
                      } routed`}
                    {pcbMergedRouting.vias.length > 0 &&
                      ` · ${pcbMergedRouting.vias.length} via${pcbMergedRouting.vias.length === 1 ? '' : 's'}`}
                    {pcbOffBoard > 0 && (
                      <span style={{ color: THEME.textFaint }}>
                        {' '}
                        · {pcbOffBoard} wired pin{pcbOffBoard === 1 ? '' : 's'} not on the board yet
                        (no footprint)
                      </span>
                    )}
                    {pcbBoard.placements.length > 0 &&
                      (pcbDrc.length > 0 ? (
                        <span style={{ color: THEME.statusDanger }}>
                          {' '}
                          · DRC: {pcbDrc.length} violation{pcbDrc.length === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span style={{ color: THEME.statusOk }}> · DRC clean</span>
                      ))}
                  </span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={onExportFabZip}
                      disabled={pcbFabProblems.length > 0}
                      title={
                        pcbFabProblems.length > 0
                          ? `The board isn't manufacturable yet: ${pcbFabProblems.join(', ')}`
                          : 'Export the manufacturing ZIP — Gerbers, drill, BOM, placement, validation report'
                      }
                      style={{
                        border: `1px solid ${THEME.borderStrong}`,
                        background: THEME.surfaceInput,
                        color: pcbFabProblems.length > 0 ? THEME.textFaint : THEME.textSoft,
                        borderRadius: 4,
                        fontSize: 11,
                        padding: '2px 8px',
                        cursor: pcbFabProblems.length > 0 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Export ZIP
                    </button>
                    <button
                      type="button"
                      onClick={() => setPcbOpen(false)}
                      style={{
                        border: `1px solid ${THEME.borderStrong}`,
                        background: THEME.surfaceInput,
                        color: THEME.textSoft,
                        borderRadius: 4,
                        fontSize: 11,
                        padding: '2px 8px',
                        cursor: 'pointer',
                      }}
                    >
                      Close
                    </button>
                  </span>
                </div>
                {pcbExportNote !== null && (
                  <span style={{ fontSize: 11, color: THEME.textFaint }}>{pcbExportNote}</span>
                )}
                {pcbBoard.placements.length > 0 ? (
                  <>
                    <PcbViewControls
                      mode={pcbViewMode}
                      onMode={setPcbViewMode}
                      layers={pcbLayers}
                      activeLayerIndex={pcbActiveLayerIndex}
                      onStep={stepPcbLayer}
                    />
                    <BoardView
                      board={pcbBoard}
                      stackup={pcbStackup}
                      routing={pcbMergedRouting}
                      drcMarkers={pcbDrc.map((v) => v.at)}
                      mode={pcbViewMode}
                      activeLayer={pcbActiveLayerId}
                      pxPerMm={12}
                      viewHeight={380}
                      onMove={onPcbMove}
                      onRotate={onPcbRotate}
                    />
                    {pcbDrc.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {pcbDrc.slice(0, 8).map((v) => (
                          <span
                            key={`${v.code}:${v.at.x},${v.at.y}:${v.message}`}
                            style={{ fontSize: 11, color: THEME.statusDanger }}
                          >
                            ⚠ {v.code}: {v.message} — at ({v.at.x.toFixed(1)}, {v.at.y.toFixed(1)})
                            mm
                          </span>
                        ))}
                        {pcbDrc.length > 8 && (
                          <span style={{ fontSize: 11, color: THEME.textFaint }}>
                            … and {pcbDrc.length - 8} more
                          </span>
                        )}
                      </div>
                    )}
                    <span style={{ fontSize: 11, color: THEME.textFaint }}>
                      drag a part to move it · click to select, R to rotate
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: THEME.textFaint,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        flexWrap: 'wrap',
                      }}
                    >
                      stack-up: {pcbStackup.copperLayers}-layer FR4 ·
                      <select
                        value={pcbStackup.thicknessMm}
                        onChange={(e) =>
                          setPcbStackupOptions((o) => ({
                            ...o,
                            thicknessMm: Number(e.target.value),
                          }))
                        }
                        title="Finished board thickness"
                        style={{
                          background: THEME.surfaceInput,
                          color: THEME.textSoft,
                          border: `1px solid ${THEME.borderStrong}`,
                          borderRadius: 4,
                          fontSize: 11,
                          padding: '1px 4px',
                        }}
                      >
                        {STANDARD_BOARD_THICKNESSES_MM.map((t) => (
                          <option key={t} value={t}>
                            {t.toFixed(1)} mm
                          </option>
                        ))}
                      </select>
                      ·
                      <select
                        value={pcbStackup.copperWeight}
                        onChange={(e) =>
                          setPcbStackupOptions((o) => ({
                            ...o,
                            copperWeight: e.target.value as CopperWeight,
                          }))
                        }
                        title="Outer copper weight"
                        style={{
                          background: THEME.surfaceInput,
                          color: THEME.textSoft,
                          border: `1px solid ${THEME.borderStrong}`,
                          borderRadius: 4,
                          fontSize: 11,
                          padding: '1px 4px',
                        }}
                      >
                        <option value="half_oz">0.5 oz copper</option>
                        <option value="one_oz">1 oz copper</option>
                        <option value="two_oz">2 oz copper</option>
                      </select>
                      ·
                      <select
                        value={pcbStackup.surfaceFinish}
                        onChange={(e) =>
                          setPcbStackupOptions((o) => ({
                            ...o,
                            surfaceFinish: e.target.value as SurfaceFinishId,
                          }))
                        }
                        title="Surface finish"
                        style={{
                          background: THEME.surfaceInput,
                          color: THEME.textSoft,
                          border: `1px solid ${THEME.borderStrong}`,
                          borderRadius: 4,
                          fontSize: 11,
                          padding: '1px 4px',
                        }}
                      >
                        {(Object.keys(SURFACE_FINISHES) as (keyof typeof SURFACE_FINISHES)[]).map(
                          (id) => (
                            <option key={id} value={id}>
                              {SURFACE_FINISHES[id].name}
                            </option>
                          ),
                        )}
                      </select>
                    </span>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: THEME.textFaint, maxWidth: 320 }}>
                    No parts have a footprint yet — drop a resistor, capacitor, thermistor or
                    inductor and it lands on the board here.
                  </div>
                )}
              </div>
            ),
          },
        }
        const groups = panelGroups(
          panelLayout,
          [
            'hierarchy',
            'parts',
            'tools',
            'properties',
            'scope',
            'timeline',
            'bode',
            'pcb',
            'timing',
          ],
          (id) => Boolean(registry[id]?.visible),
        )
        const renderGroup = (g: (typeof groups)[number]) => {
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
        }
        // One stack per edge fills its dock-grid cell as before; two or more on the same edge share
        // the cell, laid down the edge (left/right → a column, top/bottom → a row) — so the new left
        // dock reads Hierarchy then Properties, KiCad-style.
        const dockEdges = ['left', 'right', 'top', 'bottom'] as const
        return dockEdges.flatMap((edge) => {
          const here = groups.filter((g) => g.edge === edge)
          if (here.length === 0) return []
          if (here.length === 1) {
            const only = renderGroup(here[0] as (typeof groups)[number])
            return only ? [only] : []
          }
          return [
            <div
              key={edge}
              style={{
                gridArea: edge,
                display: 'flex',
                flexDirection: edge === 'top' || edge === 'bottom' ? 'row' : 'column',
                minHeight: 0,
                minWidth: 0,
                gap: 6,
              }}
            >
              {here.map((g) => renderGroup(g))}
            </div>,
          ]
        })
      })()}
    </div>
  )
}
