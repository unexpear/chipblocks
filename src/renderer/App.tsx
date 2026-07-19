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
import { namedCellDrc, summarizeDrc } from './cell-drc.ts'
import { chipSignature, type Floorplan, placeCells } from './cell-place.ts'
import { mergeOverrides } from './chip-canvas.tsx'
import { type ChipLayout, EMPTY_CHIP_LAYOUT } from './chip-layout.ts'
import { ChipView } from './chip-workspace.tsx'
import { floorplanToDef } from './def.ts'
import { floorplanToGds, writeGds } from './gds.ts'
import { floorplanToLef } from './lef.ts'
import { floorplanToLib } from './liberty.ts'
import { namedCellLvs, summarizeLvs } from './lvs.ts'
import { floorplanToOasis, writeOasis } from './oasis.ts'
import { isLight, loadTheme, THEME, type ThemeName } from './theme.ts'
import { extractTopNetlist, type TopNetlist } from './top-netlist.ts'
import type { WorkspaceMode } from './workspace.ts'
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
import { binaryToBcd8 } from './bin2bcd.ts'
import { type AddableTerminal, BlockInspector, type BlockPortPatch } from './block-inspector.tsx'
import { BlockViewer } from './block-viewer.tsx'
import {
  type BlockData,
  type CanvasEdgeLike as BlockEdgeLike,
  type CanvasNodeLike as BlockNodeLike,
  type BlockPort,
  blockLayout,
  cloneBlockData,
  edgeTouchesPort,
  flattenBlocks,
  groupSelection,
  movePortAlongEdge,
  type PinSide,
  ungroupBlock,
  withoutOffsets,
} from './blocks.ts'
import { boardRmsTerminalCurrents } from './board-ac-current.ts'
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
  type SavedPlacement,
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
import { DistortionPanel } from './distortion-panel.tsx'
import { DockablePanel } from './dockable-panel.tsx'
import { BOM_VALUE_PARAMS, terminalForPad } from './footprint-assignment.ts'
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
import {
  blockIsLogicCompatible,
  type CompiledLogic,
  compileLogic,
  isLogicGate,
  type LogicResult,
  type simulateLogic,
  stepLogic,
} from './logic-sim.ts'
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
  netThroughCurrents,
  offBoardPins,
  type PadBox,
  type PlacementOverride,
  type Recess,
  type Rotation,
} from './pcb-board.ts'
import { runDrc } from './pcb-drc.ts'
import { type BomRow, buildManufacturingZip } from './pcb-fab.ts'
import { type BoardLayerId, boardLayers, copperLayerOf } from './pcb-layers.ts'
import { MEASURE_UNITS, type Measurement, type MeasureUnit } from './pcb-measure.ts'
import {
  type CopperLayer,
  type CopperTrace,
  DEFAULT_ROUTE_CLASS,
  mergeUserCopper,
  routableCopperLayers,
  routeBoard,
  type Via,
} from './pcb-route.ts'
import {
  buildStackup,
  type CopperLayerCount,
  type CopperWeight,
  DEFAULT_STACKUP_OPTIONS,
  STANDARD_BOARD_THICKNESSES_MM,
  type StackupOptions,
  SURFACE_FINISHES,
  type SurfaceFinishId,
  traceImpedance,
  widthForImpedance,
} from './pcb-stackup.ts'
import { BoardView, PcbViewControls } from './pcb-workspace.tsx'
import { canvasWorld, userPartAliases } from './pipeline/canvas-world.ts'
import { isLogicFidelity } from './pipeline/partition.ts'
import {
  lightCastInputs,
  solveCanvasDispatch,
  solveTransientDispatch,
} from './pipeline/solve-canvas.ts'
import { ProjectBrowser, type ProjectChoice } from './project-browser.tsx'
import { projectNameFromPath, recordRecentProject } from './recent-projects.ts'
import { ReflectionPanel } from './reflection-panel.tsx'
import { deriveResistorOhms, resistivityOhmM } from './resistor-derive.ts'
import { runTrace } from './run-trace.ts'
import { scanMatrixFromBuffer } from './scan-display.ts'
import { SchematicHierarchy } from './schematic-hierarchy.tsx'
import { fastestSourceHz, ScopePlot, scopeProbeKey, scopeWindow, TRACE_COLORS } from './scope.tsx'
import { H_DIVISIONS, scopeRecordSteps } from './scope-scales.ts'
import { DEFAULT_SHEET, SheetFrame, type SheetSettings } from './sheet-frame.tsx'
import { SParamPanel } from './sparam-panel.tsx'
import { parseSpiceNetlist, serializeSpiceNetlist } from './spice-netlist.ts'
import { runStressSweep } from './stress-bench.ts'
import { StressBench } from './stress-bench-panel.tsx'
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
import { type TraceBlock, TraceInspector } from './trace-inspector.tsx'
import { CheckpointContext } from './undo-context.ts'
import { checkpoint, emptyHistory, redo, undo } from './undo-history.ts'
import { formatEng } from './units.ts'
import { useBode } from './use-bode.ts'
import { useConnectTool } from './use-connect-tool.ts'
import { useDistortion } from './use-distortion.ts'
import { useMultimeter } from './use-multimeter.ts'
import { useOscilloscope } from './use-oscilloscope.ts'
import { usePanelLayout } from './use-panel-layout.ts'
import { useReflection } from './use-reflection.ts'
import { useSelectionGestures } from './use-selection-gestures.ts'
import { useShortcuts } from './use-shortcuts.tsx'
import { useSParam } from './use-sparam.ts'
import { useTimeline } from './use-timeline.ts'
import { useWireTool } from './use-wire-tool.ts'
import {
  deserializeUserLibrary,
  serializeUserLibrary,
  withInternalParts,
  withPart,
} from './user-library.ts'
import { userPartFromBlock } from './user-part-draft.ts'
import { UserPartEditor } from './user-part-editor.tsx'
import { validateUserPart } from './user-part-validate.ts'
import {
  allUserParts,
  getUserPart,
  mergeUserParts,
  registerUserPart,
  type UserPart,
} from './user-parts.ts'
import { buildDemoCpu, buildDemoCpu8 } from './verilog-cpu-demo.ts'
import { STARTER_VERILOG, VerilogEditor } from './verilog-editor.tsx'
import { isVerilogText, parseVerilogText, serializeVerilog } from './verilog-file.ts'
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
      openCircuitDialog?: () => Promise<{ ok: boolean; path?: string; text?: string }>
      readCircuitFile?: (
        path: string,
      ) => Promise<{ ok: boolean; path?: string; text?: string; reason?: string }>
      scanProjects?: () => Promise<{ path: string; name: string; savedAt: number }[]>
      onNetlistOpened?: (callback: (text: string) => void) => void
      onExportNetlistRequest?: (callback: () => void) => void
      saveNetlistData?: (text: string) => Promise<{ ok: boolean; path?: string }>
      onExportVerilogRequest?: (callback: () => void) => void
      saveVerilogData?: (text: string) => Promise<{ ok: boolean; path?: string }>
      saveFabZip?: (data: Uint8Array) => Promise<{ ok: boolean; path?: string }>
      onExportGdsRequest?: (callback: () => void) => void
      saveGdsData?: (data: Uint8Array) => Promise<{ ok: boolean; path?: string }>
      onExportLefRequest?: (callback: () => void) => void
      saveLefData?: (text: string) => Promise<{ ok: boolean; path?: string }>
      onExportDefRequest?: (callback: () => void) => void
      saveDefData?: (text: string) => Promise<{ ok: boolean; path?: string }>
      onExportLibRequest?: (callback: () => void) => void
      saveLibData?: (text: string) => Promise<{ ok: boolean; path?: string }>
      onExportOasisRequest?: (callback: () => void) => void
      saveOasisData?: (data: Uint8Array) => Promise<{ ok: boolean; path?: string }>
      readUserLibrary?: () => Promise<string | null>
      writeUserLibrary?: (text: string) => Promise<{ ok: boolean; path?: string }>
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

// Read a 4-bit unsigned value off the Verilog-CPU harness node's bit-ports port[0..3] (LSB = port[0]).
const vcpuRead4 = (r: LogicResult, port: string): number => {
  let v = 0
  for (let i = 0; i < 4; i++) if (r.value('vh', `${port}[${i}]`) === true) v |= 1 << i
  return v
}
// Same, but for a named node (the 8-bit demo reads digits off the BCD converter as well as the CPU).
const read4At = (r: LogicResult, node: string, port: string): number => {
  let v = 0
  for (let i = 0; i < 4; i++) if (r.value(node, `${port}[${i}]`) === true) v |= 1 << i
  return v
}

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

const VALID_ROTATIONS: readonly Rotation[] = [0, 90, 180, 270]

/** The hand-placements Map → the file's SavedPlacement[] (id-sorted for a stable, reviewable diff). */
function placementsToSaved(placements: ReadonlyMap<string, PlacementOverride>): SavedPlacement[] {
  return [...placements]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, { x, y, rotation }]) => ({ id, x, y, rotation }))
}

/** A loaded file's SavedPlacement[] → the hand-placements Map, keeping only valid rotations. */
function placementsFromSaved(
  saved: readonly SavedPlacement[] | undefined,
): Map<string, PlacementOverride> {
  const map = new Map<string, PlacementOverride>()
  for (const p of saved ?? []) {
    if (!(VALID_ROTATIONS as readonly number[]).includes(p.rotation)) continue
    map.set(p.id, { x: p.x, y: p.y, rotation: p.rotation as Rotation })
  }
  return map
}

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
      ...(n.footprintId ? { footprintId: n.footprintId } : {}),
      // The explicit Simulate-as choice survives a reload — only the three known tags (a hand-edited
      // junk value degrades to the automatic default, which is honest).
      ...(n.fidelity === 'transistor' || n.fidelity === 'logic' || n.fidelity === 'behaviour'
        ? { fidelity: n.fidelity }
        : {}),
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
type ProjectTab = { id: string; project: ProjectChoice }

/** The window's tab strip: a permanent "My Projects" home tab (the launcher) + one tab per open
 *  project. Clicking a tab makes it the active (live) one; × closes a project tab. */
function ProjectTabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
}: {
  tabs: ProjectTab[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
}) {
  const renderTab = (id: string, label: string, closable: boolean) => {
    const on = activeId === id
    return (
      <div
        key={id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 10px',
          fontSize: 12,
          color: on ? '#e8eef6' : '#8fa0b4',
          background: on ? '#141f33' : 'transparent',
          borderRight: '1px solid #1c2740',
          borderTop: `2px solid ${on ? '#4f9dff' : 'transparent'}`,
          whiteSpace: 'nowrap',
        }}
      >
        <button
          type="button"
          onClick={() => onSelect(id)}
          style={{
            all: 'unset',
            cursor: 'pointer',
            color: 'inherit',
            padding: '5px 2px',
            fontWeight: on ? 600 : 400,
          }}
        >
          {label}
        </button>
        {closable && (
          <button
            type="button"
            title="Close project"
            onClick={(e) => {
              e.stopPropagation()
              onClose(id)
            }}
            style={{
              all: 'unset',
              cursor: 'pointer',
              color: '#6b7c93',
              fontSize: 14,
              lineHeight: 1,
              padding: '0 2px',
            }}
          >
            ×
          </button>
        )}
      </div>
    )
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 30,
        flexShrink: 0,
        background: '#0a0f18',
        borderBottom: '1px solid #1c2740',
        overflowX: 'auto',
      }}
    >
      {renderTab('home', '⌂ My Projects', false)}
      {tabs.map((t) => renderTab(t.id, t.project.name || t.project.templateName, true))}
    </div>
  )
}

/**
 * The level breadcrumb across the top of a project — Circuit ▸ Board ▸ Chip ▸ System. Circuit and
 * Board are the real levels (the schematic and the physical board workspace); Chip + System are
 * "coming soon" stops. This replaces the old schematic↔board toggle: click a level to travel to it.
 */
function LevelBreadcrumb({
  mode,
  onMode,
  light,
}: {
  mode: WorkspaceMode
  onMode: (m: WorkspaceMode) => void
  light: boolean
}) {
  const levels = [
    { id: 'schematic', label: 'Circuit', soon: false },
    { id: 'board', label: 'Board', soon: false },
    { id: 'chip', label: 'Chip', soon: false },
    { id: 'system', label: 'System', soon: true },
  ] as const
  const bright = light ? THEME.borderSubtle : THEME.textBright
  const soft = light ? THEME.borderStrong : THEME.textSoft
  const faint = THEME.textFaint
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        height: 30,
        flexShrink: 0,
        padding: '0 14px',
        background: light ? THEME.white : THEME.surfaceBase,
        borderBottom: `1px solid ${THEME.borderSubtle}`,
        fontSize: 12,
      }}
    >
      {levels.map((lvl, i) => {
        const on = lvl.id === mode
        return (
          <span key={lvl.id} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <span style={{ color: faint, margin: '0 4px' }}>▸</span>}
            <button
              type="button"
              disabled={lvl.soon}
              onClick={() => {
                if (lvl.id !== 'system') onMode(lvl.id)
              }}
              title={lvl.soon ? `${lvl.label} — coming soon` : `Go to the ${lvl.label} level`}
              style={{
                all: 'unset',
                cursor: lvl.soon ? 'default' : 'pointer',
                color: lvl.soon ? faint : on ? bright : soft,
                fontWeight: on ? 700 : 400,
                padding: '4px 7px',
                borderRadius: 4,
              }}
            >
              {lvl.label}
              {lvl.soon && <span style={{ fontSize: 10, color: faint }}> · soon</span>}
            </button>
          </span>
        )
      })}
    </div>
  )
}

export function App() {
  // The window is TABBED: a permanent "My Projects" home tab (the launcher) plus one tab per open
  // project. Only the ACTIVE tab is live — every project tab stays MOUNTED (so switching back is
  // instant and keeps its state), but its Canvas is gated on `active`, so a background tab never grabs
  // the keyboard or the single window.__chip CDP slot (and idle, does not solve). Creating a project
  // from the launcher opens a new tab and switches to it.
  const [tabs, setTabs] = useState<ProjectTab[]>([])
  const [activeId, setActiveId] = useState('home')
  const nextId = useRef(1)

  const openProject = useCallback((choice: ProjectChoice) => {
    const id = `proj_${nextId.current++}`
    setTabs((ts) => [...ts, { id, project: choice }])
    setActiveId(id)
  }, [])
  const closeTab = useCallback(
    (id: string) => {
      const idx = tabs.findIndex((t) => t.id === id)
      const rest = tabs.filter((t) => t.id !== id)
      setTabs(rest)
      setActiveId((cur) =>
        cur === id ? (rest[Math.min(idx, rest.length - 1)]?.id ?? 'home') : cur,
      )
    },
    [tabs],
  )

  // Load the personal parts library (~/.chipblocks/user-parts.json) ONCE at app start, before any
  // project opens, so your authored parts are in every tab's palette + draw on any project that uses
  // them. A merge (existing wins), so it can't clobber a part a project later brings in.
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.readUserLibrary === undefined) return
    void bridge.readUserLibrary().then((text) => {
      if (text === null) return
      const result = deserializeUserLibrary(text)
      if (result.ok) mergeUserParts(result.parts)
    })
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        background: '#0a0f18',
      }}
    >
      <ProjectTabBar tabs={tabs} activeId={activeId} onSelect={setActiveId} onClose={closeTab} />
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: activeId === 'home' ? 'block' : 'none',
          }}
        >
          <ProjectBrowser onCreate={openProject} />
        </div>
        {tabs.map((t) => (
          <div
            key={t.id}
            style={{
              position: 'absolute',
              inset: 0,
              display: activeId === t.id ? 'block' : 'none',
            }}
          >
            <ReactFlowProvider>
              <Canvas project={t.project} active={activeId === t.id} />
            </ReactFlowProvider>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The parts a template drops onto a fresh canvas (placed, not yet wired). A template
 *  not listed here opens a blank canvas — the relevant parts are in the palette. */
const tplScalar = (amount: number, unit: string) => ({
  value: { kind: 'scalar' as const, amount, unit },
})
type TemplatePart = {
  id: string
  def: string
  x: number
  y: number
  /** Scalar params (resistance, voltage) or enum params (a switch's `state`: 'closed' | 'open'). */
  params?: Record<
    string,
    { value: { kind: 'scalar'; amount: number; unit: string } } | { value: string }
  >
  /** A composite BUILTIN_BLOCK (e.g. the op-amp) rather than a device primitive. */
  block?: boolean
}
/**
 * Real, WIRED starter circuits for the Circuit level — each opens a working, immediately-simulatable schematic
 * (not just loose parts). `wires` are [sourceId, sourceHandle, targetId, targetHandle]; a `block: true` part is
 * placed as a composite block, the rest as device primitives. Keyed by the browser's template id.
 */
const TEMPLATE_FLOWS: Record<
  string,
  { parts: TemplatePart[]; wires: [string, string, string, string][] }
> = {
  // The hello-world: a 5 V source drives an LED through a 150 Ω current-limiting resistor.
  'led-resistor': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 80,
        y: 220,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'R1', def: 'resistor', x: 340, y: 140, params: { resistance: tplScalar(150, 'ohm') } },
      { id: 'D1', def: 'led', x: 560, y: 220 },
      { id: 'G', def: 'ground', x: 80, y: 420 },
    ],
    wires: [
      ['V1', 'terminal_positive', 'R1', 'terminal_a'],
      ['R1', 'terminal_b', 'D1', 'anode'],
      ['D1', 'cathode', 'G', 'reference_terminal'],
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
    ],
  },
  // Two equal 10 kΩ resistors halve a 10 V rail — the tap between them sits at 5 V.
  'voltage-divider': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 80,
        y: 220,
        params: { nominal_voltage: tplScalar(10, 'volt') },
      },
      {
        id: 'R1',
        def: 'resistor',
        x: 360,
        y: 140,
        params: { resistance: tplScalar(10000, 'ohm') },
      },
      {
        id: 'R2',
        def: 'resistor',
        x: 360,
        y: 320,
        params: { resistance: tplScalar(10000, 'ohm') },
      },
      { id: 'G', def: 'ground', x: 80, y: 440 },
    ],
    wires: [
      ['V1', 'terminal_positive', 'R1', 'terminal_a'],
      ['R1', 'terminal_b', 'R2', 'terminal_a'],
      ['R2', 'terminal_b', 'G', 'reference_terminal'],
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
    ],
  },
  // A 1.6 kΩ / 100 nF RC low-pass — the corner sits at 1/(2πRC) ≈ 1 kHz (open the Bode panel).
  'rc-lowpass': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 80,
        y: 220,
        params: {
          nominal_voltage: tplScalar(0, 'volt'),
          ac_amplitude: tplScalar(1, 'volt'),
          frequency: tplScalar(1000, 'hertz'),
        },
      },
      { id: 'R1', def: 'resistor', x: 360, y: 140, params: { resistance: tplScalar(1600, 'ohm') } },
      {
        id: 'C1',
        def: 'capacitor',
        x: 560,
        y: 320,
        params: { capacitance: tplScalar(1e-7, 'farad') },
      },
      { id: 'G', def: 'ground', x: 80, y: 440 },
    ],
    wires: [
      ['V1', 'terminal_positive', 'R1', 'terminal_a'],
      ['R1', 'terminal_b', 'C1', 'terminal_a'],
      ['C1', 'terminal_b', 'G', 'reference_terminal'],
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
    ],
  },
  // A non-inverting op-amp gain stage: gain = 1 + Rf/Rg = 2, on ±15 V rails, driven by a small 1 kHz tone.
  'noninv-opamp': {
    parts: [
      { id: 'U1', def: 'op_amp', x: 420, y: 220, block: true },
      {
        id: 'Vin',
        def: 'power_source',
        x: 80,
        y: 180,
        params: {
          nominal_voltage: tplScalar(0, 'volt'),
          ac_amplitude: tplScalar(0.1, 'volt'),
          frequency: tplScalar(1000, 'hertz'),
        },
      },
      {
        id: 'Vpos',
        def: 'power_source',
        x: 420,
        y: 40,
        params: { nominal_voltage: tplScalar(15, 'volt') },
      },
      {
        id: 'Vneg',
        def: 'power_source',
        x: 420,
        y: 470,
        params: { nominal_voltage: tplScalar(-15, 'volt') },
      },
      {
        id: 'Rf',
        def: 'resistor',
        x: 700,
        y: 320,
        params: { resistance: tplScalar(10000, 'ohm') },
      },
      {
        id: 'Rg',
        def: 'resistor',
        x: 420,
        y: 360,
        params: { resistance: tplScalar(10000, 'ohm') },
      },
      { id: 'G', def: 'ground', x: 80, y: 400 },
    ],
    wires: [
      ['Vin', 'terminal_positive', 'U1', 'in_plus'],
      ['Vin', 'terminal_negative', 'G', 'reference_terminal'],
      ['U1', 'out', 'Rf', 'terminal_a'],
      ['Rf', 'terminal_b', 'U1', 'in_minus'],
      ['U1', 'in_minus', 'Rg', 'terminal_a'],
      ['Rg', 'terminal_b', 'G', 'reference_terminal'],
      ['Vpos', 'terminal_positive', 'U1', 'v_plus'],
      ['Vpos', 'terminal_negative', 'G', 'reference_terminal'],
      ['Vneg', 'terminal_positive', 'U1', 'v_minus'],
      ['Vneg', 'terminal_negative', 'G', 'reference_terminal'],
    ],
  },
  // The classic common-emitter gain stage: R1/R2 divider bias, Rc load, Re degeneration with a bypass cap,
  // input coupled in through Cin. Biased in the active region (Vc ≈ 5.4 V) so it amplifies cleanly, then
  // clips when driven hard (open the Distortion panel).
  'ce-amp': {
    parts: [
      {
        id: 'Vcc',
        def: 'power_source',
        x: 120,
        y: 60,
        params: { nominal_voltage: tplScalar(12, 'volt') },
      },
      {
        id: 'Vin',
        def: 'power_source',
        x: 60,
        y: 320,
        params: {
          nominal_voltage: tplScalar(0, 'volt'),
          ac_amplitude: tplScalar(0.01, 'volt'),
          frequency: tplScalar(1000, 'hertz'),
        },
      },
      {
        id: 'R1',
        def: 'resistor',
        x: 300,
        y: 120,
        params: { resistance: tplScalar(47000, 'ohm') },
      },
      {
        id: 'R2',
        def: 'resistor',
        x: 300,
        y: 440,
        params: { resistance: tplScalar(10000, 'ohm') },
      },
      { id: 'Rc', def: 'resistor', x: 520, y: 120, params: { resistance: tplScalar(4700, 'ohm') } },
      { id: 'Re', def: 'resistor', x: 460, y: 500, params: { resistance: tplScalar(1000, 'ohm') } },
      {
        id: 'Ce',
        def: 'capacitor',
        x: 620,
        y: 500,
        params: { capacitance: tplScalar(1e-4, 'farad') },
      },
      {
        id: 'Cin',
        def: 'capacitor',
        x: 200,
        y: 300,
        params: { capacitance: tplScalar(1e-6, 'farad') },
      },
      { id: 'Q1', def: 'transistor_bjt_npn', x: 460, y: 300 },
      { id: 'G', def: 'ground', x: 120, y: 560 },
    ],
    wires: [
      ['Vcc', 'terminal_positive', 'R1', 'terminal_a'],
      ['R1', 'terminal_b', 'Q1', 'base'],
      ['R2', 'terminal_a', 'Q1', 'base'],
      ['R2', 'terminal_b', 'G', 'reference_terminal'],
      ['Vcc', 'terminal_positive', 'Rc', 'terminal_a'],
      ['Rc', 'terminal_b', 'Q1', 'collector'],
      ['Q1', 'emitter', 'Re', 'terminal_a'],
      ['Re', 'terminal_b', 'G', 'reference_terminal'],
      ['Q1', 'emitter', 'Ce', 'terminal_a'],
      ['Ce', 'terminal_b', 'G', 'reference_terminal'],
      ['Vin', 'terminal_positive', 'Cin', 'terminal_a'],
      ['Cin', 'terminal_b', 'Q1', 'base'],
      ['Vin', 'terminal_negative', 'G', 'reference_terminal'],
      ['Vcc', 'terminal_negative', 'G', 'reference_terminal'],
    ],
  },
  // A full-wave bridge rectifier: four diodes turn the AC both-halves positive, a 470 µF cap smooths it, a
  // 1 kΩ load draws the rail. Run the scope — the AC becomes a ≈ 10.6 V DC rail (12 V peak − two diode drops).
  'bridge-rectifier': {
    parts: [
      {
        id: 'Vac',
        def: 'power_source',
        x: 80,
        y: 260,
        params: {
          nominal_voltage: tplScalar(0, 'volt'),
          ac_amplitude: tplScalar(12, 'volt'),
          frequency: tplScalar(60, 'hertz'),
        },
      },
      { id: 'D1', def: 'diode_silicon_rectifier', x: 320, y: 120 },
      { id: 'D2', def: 'diode_silicon_rectifier', x: 320, y: 300 },
      { id: 'D3', def: 'diode_silicon_rectifier', x: 320, y: 420 },
      { id: 'D4', def: 'diode_silicon_rectifier', x: 320, y: 540 },
      {
        id: 'Cf',
        def: 'capacitor',
        x: 600,
        y: 260,
        params: { capacitance: tplScalar(4.7e-4, 'farad') },
      },
      {
        id: 'Rload',
        def: 'resistor',
        x: 760,
        y: 260,
        params: { resistance: tplScalar(1000, 'ohm') },
      },
      { id: 'G', def: 'ground', x: 600, y: 520 },
    ],
    wires: [
      ['Vac', 'terminal_positive', 'D1', 'anode'],
      ['Vac', 'terminal_negative', 'D2', 'anode'],
      ['D1', 'cathode', 'D2', 'cathode'],
      ['D2', 'cathode', 'Cf', 'terminal_a'],
      ['Cf', 'terminal_a', 'Rload', 'terminal_a'],
      ['D3', 'cathode', 'D1', 'anode'],
      ['D4', 'cathode', 'D2', 'anode'],
      ['D3', 'anode', 'G', 'reference_terminal'],
      ['D4', 'anode', 'G', 'reference_terminal'],
      ['Cf', 'terminal_b', 'G', 'reference_terminal'],
      ['Rload', 'terminal_b', 'G', 'reference_terminal'],
    ],
  },
  // ─── Digital starter circuits ─── every logic block below is real transistor gates inside (descend to
  // see them). Inputs are SPDT switches selecting the 5 V rail (1) or ground (0) — flip one to pick the level;
  // outputs light LEDs or a 7-segment digit. The result changes live.
  // Logic gates — AND, OR and XOR of the same two switches. AND lights only with both on, OR with either, XOR
  // when they differ. Flip A and B (both start 1) and watch which LEDs follow. Every gate is real transistors.
  'logic-gates': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 620 },
      { id: 'AND', def: 'logic_and', x: 470, y: 60, block: true },
      { id: 'OR', def: 'logic_or', x: 470, y: 260, block: true },
      { id: 'XOR', def: 'logic_xor', x: 470, y: 460, block: true },
      { id: 'swA', def: 'switch_spdt', x: 220, y: 160, params: { position: { value: 'throw_a' } } },
      { id: 'swB', def: 'switch_spdt', x: 220, y: 380, params: { position: { value: 'throw_a' } } },
      { id: 'rA', def: 'resistor', x: 730, y: 60, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dA', def: 'led', x: 880, y: 60 },
      { id: 'rO', def: 'resistor', x: 730, y: 260, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dO', def: 'led', x: 880, y: 260 },
      { id: 'rX', def: 'resistor', x: 730, y: 460, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dX', def: 'led', x: 880, y: 460 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swA', 'common', 'AND', 'a'],
      ['swA', 'throw_a', 'V1', 'terminal_positive'],
      ['swA', 'throw_b', 'G', 'reference_terminal'],
      ['swB', 'common', 'AND', 'b'],
      ['swB', 'throw_a', 'V1', 'terminal_positive'],
      ['swB', 'throw_b', 'G', 'reference_terminal'],
      ['swA', 'common', 'OR', 'a'],
      ['swA', 'common', 'XOR', 'a'],
      ['swB', 'common', 'OR', 'b'],
      ['swB', 'common', 'XOR', 'b'],
      ['V1', 'terminal_positive', 'AND', 'v_dd'],
      ['AND', 'gnd', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'OR', 'v_dd'],
      ['OR', 'gnd', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'XOR', 'v_dd'],
      ['XOR', 'gnd', 'G', 'reference_terminal'],
      ['AND', 'out', 'rA', 'terminal_a'],
      ['rA', 'terminal_b', 'dA', 'anode'],
      ['dA', 'cathode', 'G', 'reference_terminal'],
      ['OR', 'out', 'rO', 'terminal_a'],
      ['rO', 'terminal_b', 'dO', 'anode'],
      ['dO', 'cathode', 'G', 'reference_terminal'],
      ['XOR', 'out', 'rX', 'terminal_a'],
      ['rX', 'terminal_b', 'dX', 'anode'],
      ['dX', 'cathode', 'G', 'reference_terminal'],
    ],
  },
  // Full adder — Sum and Carry of A + B + Cin, from two half-adders. 1 + 1 + 0 = binary 10 → Sum 0, Carry 1
  // (the Carry LED lit). Flip the three switches to walk the whole 8-row carry table.
  'full-adder': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 620 },
      { id: 'FA', def: 'logic_full_adder', x: 490, y: 220, block: true },
      { id: 'swA', def: 'switch_spdt', x: 220, y: 120, params: { position: { value: 'throw_a' } } },
      { id: 'swB', def: 'switch_spdt', x: 220, y: 280, params: { position: { value: 'throw_a' } } },
      { id: 'swC', def: 'switch_spdt', x: 220, y: 440, params: { position: { value: 'throw_b' } } },
      { id: 'rS', def: 'resistor', x: 770, y: 160, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dS', def: 'led', x: 920, y: 160 },
      { id: 'rC', def: 'resistor', x: 770, y: 360, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dC', def: 'led', x: 920, y: 360 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swA', 'common', 'FA', 'a'],
      ['swA', 'throw_a', 'V1', 'terminal_positive'],
      ['swA', 'throw_b', 'G', 'reference_terminal'],
      ['swB', 'common', 'FA', 'b'],
      ['swB', 'throw_a', 'V1', 'terminal_positive'],
      ['swB', 'throw_b', 'G', 'reference_terminal'],
      ['swC', 'common', 'FA', 'cin'],
      ['swC', 'throw_a', 'V1', 'terminal_positive'],
      ['swC', 'throw_b', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'FA', 'v_dd'],
      ['FA', 'gnd', 'G', 'reference_terminal'],
      ['FA', 'sum', 'rS', 'terminal_a'],
      ['rS', 'terminal_b', 'dS', 'anode'],
      ['dS', 'cathode', 'G', 'reference_terminal'],
      ['FA', 'cout', 'rC', 'terminal_a'],
      ['rC', 'terminal_b', 'dC', 'anode'],
      ['dC', 'cathode', 'G', 'reference_terminal'],
    ],
  },
  // 4-bit adder — dial two 4-bit numbers on the switches (A left column, B right); the sum shows as a hex digit
  // on the 7-segment display and the Carry LED lights past 15. Starts 3 + 5 = 8. Cin is tied low.
  'adder-4bit': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 760 },
      { id: 'a0', def: 'switch_spdt', x: 200, y: 120, params: { position: { value: 'throw_a' } } },
      { id: 'a1', def: 'switch_spdt', x: 200, y: 240, params: { position: { value: 'throw_a' } } },
      { id: 'a2', def: 'switch_spdt', x: 200, y: 360, params: { position: { value: 'throw_b' } } },
      { id: 'a3', def: 'switch_spdt', x: 200, y: 480, params: { position: { value: 'throw_b' } } },
      { id: 'b0', def: 'switch_spdt', x: 380, y: 120, params: { position: { value: 'throw_a' } } },
      { id: 'b1', def: 'switch_spdt', x: 380, y: 240, params: { position: { value: 'throw_b' } } },
      { id: 'b2', def: 'switch_spdt', x: 380, y: 360, params: { position: { value: 'throw_a' } } },
      { id: 'b3', def: 'switch_spdt', x: 380, y: 480, params: { position: { value: 'throw_b' } } },
      { id: 'AD', def: 'logic_adder_4bit', x: 620, y: 280, block: true },
      { id: 'DE', def: 'logic_decoder_7seg', x: 900, y: 300, block: true },
      { id: 'DP', def: 'display_seven_segment', x: 1160, y: 240, block: true },
      { id: 'rC', def: 'resistor', x: 900, y: 60, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dC', def: 'led', x: 1050, y: 60 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['a0', 'common', 'AD', 'a0'],
      ['a0', 'throw_a', 'V1', 'terminal_positive'],
      ['a0', 'throw_b', 'G', 'reference_terminal'],
      ['a1', 'common', 'AD', 'a1'],
      ['a1', 'throw_a', 'V1', 'terminal_positive'],
      ['a1', 'throw_b', 'G', 'reference_terminal'],
      ['a2', 'common', 'AD', 'a2'],
      ['a2', 'throw_a', 'V1', 'terminal_positive'],
      ['a2', 'throw_b', 'G', 'reference_terminal'],
      ['a3', 'common', 'AD', 'a3'],
      ['a3', 'throw_a', 'V1', 'terminal_positive'],
      ['a3', 'throw_b', 'G', 'reference_terminal'],
      ['b0', 'common', 'AD', 'b0'],
      ['b0', 'throw_a', 'V1', 'terminal_positive'],
      ['b0', 'throw_b', 'G', 'reference_terminal'],
      ['b1', 'common', 'AD', 'b1'],
      ['b1', 'throw_a', 'V1', 'terminal_positive'],
      ['b1', 'throw_b', 'G', 'reference_terminal'],
      ['b2', 'common', 'AD', 'b2'],
      ['b2', 'throw_a', 'V1', 'terminal_positive'],
      ['b2', 'throw_b', 'G', 'reference_terminal'],
      ['b3', 'common', 'AD', 'b3'],
      ['b3', 'throw_a', 'V1', 'terminal_positive'],
      ['b3', 'throw_b', 'G', 'reference_terminal'],
      ['AD', 'cin', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'AD', 'v_dd'],
      ['V1', 'terminal_positive', 'DE', 'v_dd'],
      ['AD', 'gnd', 'G', 'reference_terminal'],
      ['DE', 'gnd', 'G', 'reference_terminal'],
      ['DP', 'common', 'G', 'reference_terminal'],
      ['AD', 's0', 'DE', 'd0'],
      ['AD', 's1', 'DE', 'd1'],
      ['AD', 's2', 'DE', 'd2'],
      ['AD', 's3', 'DE', 'd3'],
      ['DE', 'seg_a', 'DP', 'seg_a'],
      ['DE', 'seg_b', 'DP', 'seg_b'],
      ['DE', 'seg_c', 'DP', 'seg_c'],
      ['DE', 'seg_d', 'DP', 'seg_d'],
      ['DE', 'seg_e', 'DP', 'seg_e'],
      ['DE', 'seg_f', 'DP', 'seg_f'],
      ['DE', 'seg_g', 'DP', 'seg_g'],
      ['AD', 'cout', 'rC', 'terminal_a'],
      ['rC', 'terminal_b', 'dC', 'anode'],
      ['dC', 'cathode', 'G', 'reference_terminal'],
    ],
  },
  // SR latch — the first memory, no clock. Two cross-coupled NORs: flip SET and Q latches HIGH and STAYS high
  // when you release; flip RESET to clear. Both low = hold. Powers up cleared (Q low).
  'sr-latch': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 520 },
      { id: 'SR', def: 'logic_sr_latch', x: 470, y: 200, block: true },
      { id: 'swS', def: 'switch_spdt', x: 220, y: 140, params: { position: { value: 'throw_b' } } },
      { id: 'swR', def: 'switch_spdt', x: 220, y: 340, params: { position: { value: 'throw_b' } } },
      { id: 'rQ', def: 'resistor', x: 730, y: 140, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dQ', def: 'led', x: 880, y: 140 },
      { id: 'rQb', def: 'resistor', x: 730, y: 340, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dQb', def: 'led', x: 880, y: 340 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swS', 'common', 'SR', 's'],
      ['swS', 'throw_a', 'V1', 'terminal_positive'],
      ['swS', 'throw_b', 'G', 'reference_terminal'],
      ['swR', 'common', 'SR', 'r'],
      ['swR', 'throw_a', 'V1', 'terminal_positive'],
      ['swR', 'throw_b', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'SR', 'v_dd'],
      ['SR', 'gnd', 'G', 'reference_terminal'],
      ['SR', 'q', 'rQ', 'terminal_a'],
      ['rQ', 'terminal_b', 'dQ', 'anode'],
      ['dQ', 'cathode', 'G', 'reference_terminal'],
      ['SR', 'qbar', 'rQb', 'terminal_a'],
      ['rQb', 'terminal_b', 'dQb', 'anode'],
      ['dQb', 'cathode', 'G', 'reference_terminal'],
    ],
  },
  // D flip-flop — edge-triggered memory. Q copies D only on the clock's rising edge, then holds while D changes.
  // Set D, flip CLK from 0 to 1 to capture. D starts 1, CLK starts 0.
  'd-flipflop': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 520 },
      { id: 'FF', def: 'logic_d_flipflop', x: 470, y: 200, block: true },
      { id: 'swD', def: 'switch_spdt', x: 220, y: 140, params: { position: { value: 'throw_a' } } },
      { id: 'swK', def: 'switch_spdt', x: 220, y: 340, params: { position: { value: 'throw_b' } } },
      { id: 'rQ', def: 'resistor', x: 730, y: 140, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dQ', def: 'led', x: 880, y: 140 },
      { id: 'rQb', def: 'resistor', x: 730, y: 340, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dQb', def: 'led', x: 880, y: 340 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swD', 'common', 'FF', 'd'],
      ['swD', 'throw_a', 'V1', 'terminal_positive'],
      ['swD', 'throw_b', 'G', 'reference_terminal'],
      ['swK', 'common', 'FF', 'clk'],
      ['swK', 'throw_a', 'V1', 'terminal_positive'],
      ['swK', 'throw_b', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'FF', 'v_dd'],
      ['FF', 'gnd', 'G', 'reference_terminal'],
      ['FF', 'q', 'rQ', 'terminal_a'],
      ['rQ', 'terminal_b', 'dQ', 'anode'],
      ['dQ', 'cathode', 'G', 'reference_terminal'],
      ['FF', 'qbar', 'rQb', 'terminal_a'],
      ['rQb', 'terminal_b', 'dQb', 'anode'],
      ['dQb', 'cathode', 'G', 'reference_terminal'],
    ],
  },
  // 4-bit register — four flip-flops on one clock. Set a nibble on the D switches, flip CLK 0→1 and the whole
  // word latches at once as a hex digit; change D afterward and it holds until the next edge. D starts 0101 = 5.
  'register-4bit': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 720 },
      { id: 'd0', def: 'switch_spdt', x: 220, y: 120, params: { position: { value: 'throw_a' } } },
      { id: 'd1', def: 'switch_spdt', x: 220, y: 240, params: { position: { value: 'throw_b' } } },
      { id: 'd2', def: 'switch_spdt', x: 220, y: 360, params: { position: { value: 'throw_a' } } },
      { id: 'd3', def: 'switch_spdt', x: 220, y: 480, params: { position: { value: 'throw_b' } } },
      { id: 'swK', def: 'switch_spdt', x: 220, y: 620, params: { position: { value: 'throw_b' } } },
      { id: 'RG', def: 'logic_register_4bit', x: 500, y: 300, block: true },
      { id: 'DE', def: 'logic_decoder_7seg', x: 840, y: 320, block: true },
      { id: 'DP', def: 'display_seven_segment', x: 1100, y: 260, block: true },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['d0', 'common', 'RG', 'd0'],
      ['d0', 'throw_a', 'V1', 'terminal_positive'],
      ['d0', 'throw_b', 'G', 'reference_terminal'],
      ['d1', 'common', 'RG', 'd1'],
      ['d1', 'throw_a', 'V1', 'terminal_positive'],
      ['d1', 'throw_b', 'G', 'reference_terminal'],
      ['d2', 'common', 'RG', 'd2'],
      ['d2', 'throw_a', 'V1', 'terminal_positive'],
      ['d2', 'throw_b', 'G', 'reference_terminal'],
      ['d3', 'common', 'RG', 'd3'],
      ['d3', 'throw_a', 'V1', 'terminal_positive'],
      ['d3', 'throw_b', 'G', 'reference_terminal'],
      ['swK', 'common', 'RG', 'clk'],
      ['swK', 'throw_a', 'V1', 'terminal_positive'],
      ['swK', 'throw_b', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'RG', 'v_dd'],
      ['V1', 'terminal_positive', 'DE', 'v_dd'],
      ['RG', 'gnd', 'G', 'reference_terminal'],
      ['DE', 'gnd', 'G', 'reference_terminal'],
      ['DP', 'common', 'G', 'reference_terminal'],
      ['RG', 'q0', 'DE', 'd0'],
      ['RG', 'q1', 'DE', 'd1'],
      ['RG', 'q2', 'DE', 'd2'],
      ['RG', 'q3', 'DE', 'd3'],
      ['DE', 'seg_a', 'DP', 'seg_a'],
      ['DE', 'seg_b', 'DP', 'seg_b'],
      ['DE', 'seg_c', 'DP', 'seg_c'],
      ['DE', 'seg_d', 'DP', 'seg_d'],
      ['DE', 'seg_e', 'DP', 'seg_e'],
      ['DE', 'seg_f', 'DP', 'seg_f'],
      ['DE', 'seg_g', 'DP', 'seg_g'],
    ],
  },
  // 2-to-4 decoder — two address switches light exactly ONE of four outputs (one-hot): 00→Y0, 01→Y1, 10→Y2,
  // 11→Y3. The front-end of memory, multiplexers and instruction decode. Starts at address 00 (Y0 lit).
  'decoder-2-4': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 740 },
      { id: 'DC', def: 'logic_decoder_2_4', x: 470, y: 260, block: true },
      {
        id: 'swA0',
        def: 'switch_spdt',
        x: 220,
        y: 200,
        params: { position: { value: 'throw_b' } },
      },
      {
        id: 'swA1',
        def: 'switch_spdt',
        x: 220,
        y: 400,
        params: { position: { value: 'throw_b' } },
      },
      { id: 'rY0', def: 'resistor', x: 730, y: 80, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dY0', def: 'led', x: 880, y: 80 },
      { id: 'rY1', def: 'resistor', x: 730, y: 240, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dY1', def: 'led', x: 880, y: 240 },
      { id: 'rY2', def: 'resistor', x: 730, y: 400, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dY2', def: 'led', x: 880, y: 400 },
      { id: 'rY3', def: 'resistor', x: 730, y: 560, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dY3', def: 'led', x: 880, y: 560 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swA0', 'common', 'DC', 'a0'],
      ['swA0', 'throw_a', 'V1', 'terminal_positive'],
      ['swA0', 'throw_b', 'G', 'reference_terminal'],
      ['swA1', 'common', 'DC', 'a1'],
      ['swA1', 'throw_a', 'V1', 'terminal_positive'],
      ['swA1', 'throw_b', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'DC', 'v_dd'],
      ['DC', 'gnd', 'G', 'reference_terminal'],
      ['DC', 'y0', 'rY0', 'terminal_a'],
      ['rY0', 'terminal_b', 'dY0', 'anode'],
      ['dY0', 'cathode', 'G', 'reference_terminal'],
      ['DC', 'y1', 'rY1', 'terminal_a'],
      ['rY1', 'terminal_b', 'dY1', 'anode'],
      ['dY1', 'cathode', 'G', 'reference_terminal'],
      ['DC', 'y2', 'rY2', 'terminal_a'],
      ['rY2', 'terminal_b', 'dY2', 'anode'],
      ['dY2', 'cathode', 'G', 'reference_terminal'],
      ['DC', 'y3', 'rY3', 'terminal_a'],
      ['rY3', 'terminal_b', 'dY3', 'anode'],
      ['dY3', 'cathode', 'G', 'reference_terminal'],
    ],
  },
  // 2:1 multiplexer from gates — SEL routes input A or B to the output: out = (A AND not SEL) OR (B AND SEL).
  // One NOT, two ANDs and an OR. A starts 1, B starts 0; SEL=0 passes A (LED on), flip SEL to pass B.
  'mux-2-1': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 620 },
      { id: 'NOT', def: 'logic_not', x: 470, y: 60, block: true },
      { id: 'AND1', def: 'logic_and', x: 470, y: 220, block: true },
      { id: 'AND2', def: 'logic_and', x: 470, y: 400, block: true },
      { id: 'OR', def: 'logic_or', x: 730, y: 300, block: true },
      { id: 'swA', def: 'switch_spdt', x: 220, y: 120, params: { position: { value: 'throw_a' } } },
      { id: 'swB', def: 'switch_spdt', x: 220, y: 300, params: { position: { value: 'throw_b' } } },
      {
        id: 'swSel',
        def: 'switch_spdt',
        x: 220,
        y: 480,
        params: { position: { value: 'throw_b' } },
      },
      { id: 'rO', def: 'resistor', x: 920, y: 300, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dO', def: 'led', x: 1070, y: 300 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swA', 'common', 'AND1', 'a'],
      ['swA', 'throw_a', 'V1', 'terminal_positive'],
      ['swA', 'throw_b', 'G', 'reference_terminal'],
      ['swB', 'common', 'AND2', 'a'],
      ['swB', 'throw_a', 'V1', 'terminal_positive'],
      ['swB', 'throw_b', 'G', 'reference_terminal'],
      ['swSel', 'common', 'NOT', 'in'],
      ['swSel', 'throw_a', 'V1', 'terminal_positive'],
      ['swSel', 'throw_b', 'G', 'reference_terminal'],
      ['swSel', 'common', 'AND2', 'b'],
      ['NOT', 'out', 'AND1', 'b'],
      ['AND1', 'out', 'OR', 'a'],
      ['AND2', 'out', 'OR', 'b'],
      ['V1', 'terminal_positive', 'NOT', 'v_dd'],
      ['NOT', 'gnd', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'AND1', 'v_dd'],
      ['AND1', 'gnd', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'AND2', 'v_dd'],
      ['AND2', 'gnd', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'OR', 'v_dd'],
      ['OR', 'gnd', 'G', 'reference_terminal'],
      ['OR', 'out', 'rO', 'terminal_a'],
      ['rO', 'terminal_b', 'dO', 'anode'],
      ['dO', 'cathode', 'G', 'reference_terminal'],
    ],
  },
  // Gated D latch — level-sensitive memory, the rung between the SR latch and the flip-flop. While ENABLE is
  // high Q follows D; drop ENABLE and Q freezes at its last value. D and ENABLE both start 1 (Q tracks D).
  'd-latch': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 520 },
      { id: 'DL', def: 'logic_d_latch', x: 470, y: 200, block: true },
      { id: 'swD', def: 'switch_spdt', x: 220, y: 140, params: { position: { value: 'throw_a' } } },
      { id: 'swE', def: 'switch_spdt', x: 220, y: 340, params: { position: { value: 'throw_a' } } },
      { id: 'rQ', def: 'resistor', x: 730, y: 140, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dQ', def: 'led', x: 880, y: 140 },
      { id: 'rQb', def: 'resistor', x: 730, y: 340, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dQb', def: 'led', x: 880, y: 340 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swD', 'common', 'DL', 'd'],
      ['swD', 'throw_a', 'V1', 'terminal_positive'],
      ['swD', 'throw_b', 'G', 'reference_terminal'],
      ['swE', 'common', 'DL', 'e'],
      ['swE', 'throw_a', 'V1', 'terminal_positive'],
      ['swE', 'throw_b', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'DL', 'v_dd'],
      ['DL', 'gnd', 'G', 'reference_terminal'],
      ['DL', 'q', 'rQ', 'terminal_a'],
      ['rQ', 'terminal_b', 'dQ', 'anode'],
      ['dQ', 'cathode', 'G', 'reference_terminal'],
      ['DL', 'qbar', 'rQb', 'terminal_a'],
      ['rQb', 'terminal_b', 'dQb', 'anode'],
      ['dQb', 'cathode', 'G', 'reference_terminal'],
    ],
  },
  // 4-bit up-counter — a register feeds a +1 adder whose sum loops back to the register input, so every clock
  // it stores the next number and the 7-segment display counts 0,1,2,…,F. Flip the CLK switch 0→1 to step it.
  'up-counter': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 720 },
      { id: 'swK', def: 'switch_spdt', x: 220, y: 300, params: { position: { value: 'throw_b' } } },
      { id: 'RG', def: 'logic_register_4bit', x: 470, y: 260, block: true },
      { id: 'AD', def: 'logic_adder_4bit', x: 470, y: 540, block: true },
      { id: 'DE', def: 'logic_decoder_7seg', x: 780, y: 260, block: true },
      { id: 'DP', def: 'display_seven_segment', x: 1040, y: 200, block: true },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swK', 'common', 'RG', 'clk'],
      ['swK', 'throw_a', 'V1', 'terminal_positive'],
      ['swK', 'throw_b', 'G', 'reference_terminal'],
      ['RG', 'q0', 'AD', 'a0'],
      ['AD', 's0', 'RG', 'd0'],
      ['RG', 'q0', 'DE', 'd0'],
      ['RG', 'q1', 'AD', 'a1'],
      ['AD', 's1', 'RG', 'd1'],
      ['RG', 'q1', 'DE', 'd1'],
      ['RG', 'q2', 'AD', 'a2'],
      ['AD', 's2', 'RG', 'd2'],
      ['RG', 'q2', 'DE', 'd2'],
      ['RG', 'q3', 'AD', 'a3'],
      ['AD', 's3', 'RG', 'd3'],
      ['RG', 'q3', 'DE', 'd3'],
      ['V1', 'terminal_positive', 'AD', 'b0'],
      ['AD', 'b1', 'G', 'reference_terminal'],
      ['AD', 'b2', 'G', 'reference_terminal'],
      ['AD', 'b3', 'G', 'reference_terminal'],
      ['AD', 'cin', 'G', 'reference_terminal'],
      ['DE', 'seg_a', 'DP', 'seg_a'],
      ['DE', 'seg_b', 'DP', 'seg_b'],
      ['DE', 'seg_c', 'DP', 'seg_c'],
      ['DE', 'seg_d', 'DP', 'seg_d'],
      ['DE', 'seg_e', 'DP', 'seg_e'],
      ['DE', 'seg_f', 'DP', 'seg_f'],
      ['DE', 'seg_g', 'DP', 'seg_g'],
      ['V1', 'terminal_positive', 'RG', 'v_dd'],
      ['V1', 'terminal_positive', 'AD', 'v_dd'],
      ['V1', 'terminal_positive', 'DE', 'v_dd'],
      ['RG', 'gnd', 'G', 'reference_terminal'],
      ['AD', 'gnd', 'G', 'reference_terminal'],
      ['DE', 'gnd', 'G', 'reference_terminal'],
      ['DP', 'common', 'G', 'reference_terminal'],
    ],
  },
  // 4-bit ripple counter — four toggle flip-flops chained. Each flip-flop feeds its OWN inverted output back
  // to its input (so it flips every clock) and clocks the next stage — bit 0 toggles every clock, bit 1 every
  // two, bit 2 every four: a binary count that ripples up the chain. Flip CLK and watch the LEDs.
  'ripple-counter': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 620 },
      { id: 'swK', def: 'switch_spdt', x: 220, y: 300, params: { position: { value: 'throw_b' } } },
      { id: 'FF0', def: 'logic_d_flipflop', x: 470, y: 40, block: true },
      { id: 'rq0', def: 'resistor', x: 740, y: 60, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dq0', def: 'led', x: 890, y: 60 },
      { id: 'FF1', def: 'logic_d_flipflop', x: 470, y: 190, block: true },
      { id: 'rq1', def: 'resistor', x: 740, y: 210, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dq1', def: 'led', x: 890, y: 210 },
      { id: 'FF2', def: 'logic_d_flipflop', x: 470, y: 340, block: true },
      { id: 'rq2', def: 'resistor', x: 740, y: 360, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dq2', def: 'led', x: 890, y: 360 },
      { id: 'FF3', def: 'logic_d_flipflop', x: 470, y: 490, block: true },
      { id: 'rq3', def: 'resistor', x: 740, y: 510, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dq3', def: 'led', x: 890, y: 510 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swK', 'common', 'FF0', 'clk'],
      ['swK', 'throw_a', 'V1', 'terminal_positive'],
      ['swK', 'throw_b', 'G', 'reference_terminal'],
      ['FF0', 'qbar', 'FF0', 'd'],
      ['V1', 'terminal_positive', 'FF0', 'v_dd'],
      ['FF0', 'gnd', 'G', 'reference_terminal'],
      ['FF0', 'q', 'rq0', 'terminal_a'],
      ['rq0', 'terminal_b', 'dq0', 'anode'],
      ['dq0', 'cathode', 'G', 'reference_terminal'],
      ['FF1', 'qbar', 'FF1', 'd'],
      ['V1', 'terminal_positive', 'FF1', 'v_dd'],
      ['FF1', 'gnd', 'G', 'reference_terminal'],
      ['FF1', 'q', 'rq1', 'terminal_a'],
      ['rq1', 'terminal_b', 'dq1', 'anode'],
      ['dq1', 'cathode', 'G', 'reference_terminal'],
      ['FF2', 'qbar', 'FF2', 'd'],
      ['V1', 'terminal_positive', 'FF2', 'v_dd'],
      ['FF2', 'gnd', 'G', 'reference_terminal'],
      ['FF2', 'q', 'rq2', 'terminal_a'],
      ['rq2', 'terminal_b', 'dq2', 'anode'],
      ['dq2', 'cathode', 'G', 'reference_terminal'],
      ['FF3', 'qbar', 'FF3', 'd'],
      ['V1', 'terminal_positive', 'FF3', 'v_dd'],
      ['FF3', 'gnd', 'G', 'reference_terminal'],
      ['FF3', 'q', 'rq3', 'terminal_a'],
      ['rq3', 'terminal_b', 'dq3', 'anode'],
      ['dq3', 'cathode', 'G', 'reference_terminal'],
      ['FF0', 'qbar', 'FF1', 'clk'],
      ['FF1', 'qbar', 'FF2', 'clk'],
      ['FF2', 'qbar', 'FF3', 'clk'],
    ],
  },
  // 3-to-8 decoder — three address switches light exactly ONE of eight outputs. One more address line than
  // the 2-to-4 decoder: 000→Y0, 001→Y1, … 111→Y7. Starts at address 000 (Y0 lit).
  'decoder-3-8': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 900 },
      { id: 'DC', def: 'logic_decoder_3_8', x: 470, y: 340, block: true },
      {
        id: 'swA0',
        def: 'switch_spdt',
        x: 220,
        y: 260,
        params: { position: { value: 'throw_b' } },
      },
      {
        id: 'swA1',
        def: 'switch_spdt',
        x: 220,
        y: 420,
        params: { position: { value: 'throw_b' } },
      },
      {
        id: 'swA2',
        def: 'switch_spdt',
        x: 220,
        y: 580,
        params: { position: { value: 'throw_b' } },
      },
      { id: 'rY0', def: 'resistor', x: 740, y: 40, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dY0', def: 'led', x: 890, y: 40 },
      { id: 'rY1', def: 'resistor', x: 740, y: 140, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dY1', def: 'led', x: 890, y: 140 },
      { id: 'rY2', def: 'resistor', x: 740, y: 240, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dY2', def: 'led', x: 890, y: 240 },
      { id: 'rY3', def: 'resistor', x: 740, y: 340, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dY3', def: 'led', x: 890, y: 340 },
      { id: 'rY4', def: 'resistor', x: 740, y: 440, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dY4', def: 'led', x: 890, y: 440 },
      { id: 'rY5', def: 'resistor', x: 740, y: 540, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dY5', def: 'led', x: 890, y: 540 },
      { id: 'rY6', def: 'resistor', x: 740, y: 640, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dY6', def: 'led', x: 890, y: 640 },
      { id: 'rY7', def: 'resistor', x: 740, y: 740, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dY7', def: 'led', x: 890, y: 740 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swA0', 'common', 'DC', 'a0'],
      ['swA0', 'throw_a', 'V1', 'terminal_positive'],
      ['swA0', 'throw_b', 'G', 'reference_terminal'],
      ['swA1', 'common', 'DC', 'a1'],
      ['swA1', 'throw_a', 'V1', 'terminal_positive'],
      ['swA1', 'throw_b', 'G', 'reference_terminal'],
      ['swA2', 'common', 'DC', 'a2'],
      ['swA2', 'throw_a', 'V1', 'terminal_positive'],
      ['swA2', 'throw_b', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'DC', 'v_dd'],
      ['DC', 'gnd', 'G', 'reference_terminal'],
      ['DC', 'y0', 'rY0', 'terminal_a'],
      ['rY0', 'terminal_b', 'dY0', 'anode'],
      ['dY0', 'cathode', 'G', 'reference_terminal'],
      ['DC', 'y1', 'rY1', 'terminal_a'],
      ['rY1', 'terminal_b', 'dY1', 'anode'],
      ['dY1', 'cathode', 'G', 'reference_terminal'],
      ['DC', 'y2', 'rY2', 'terminal_a'],
      ['rY2', 'terminal_b', 'dY2', 'anode'],
      ['dY2', 'cathode', 'G', 'reference_terminal'],
      ['DC', 'y3', 'rY3', 'terminal_a'],
      ['rY3', 'terminal_b', 'dY3', 'anode'],
      ['dY3', 'cathode', 'G', 'reference_terminal'],
      ['DC', 'y4', 'rY4', 'terminal_a'],
      ['rY4', 'terminal_b', 'dY4', 'anode'],
      ['dY4', 'cathode', 'G', 'reference_terminal'],
      ['DC', 'y5', 'rY5', 'terminal_a'],
      ['rY5', 'terminal_b', 'dY5', 'anode'],
      ['dY5', 'cathode', 'G', 'reference_terminal'],
      ['DC', 'y6', 'rY6', 'terminal_a'],
      ['rY6', 'terminal_b', 'dY6', 'anode'],
      ['dY6', 'cathode', 'G', 'reference_terminal'],
      ['DC', 'y7', 'rY7', 'terminal_a'],
      ['rY7', 'terminal_b', 'dY7', 'anode'],
      ['dY7', 'cathode', 'G', 'reference_terminal'],
    ],
  },
  // 4-to-2 priority encoder — the reverse of a decoder. Raise one of four input switches and it outputs that
  // input's 2-bit number; the GS ("valid") LED lights when any input is active. If several are on, the
  // highest wins. Starts with I2 raised → binary 10.
  'encoder-4-2': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 640 },
      { id: 'EN', def: 'logic_encoder_4_2', x: 470, y: 260, block: true },
      {
        id: 'swI0',
        def: 'switch_spdt',
        x: 220,
        y: 120,
        params: { position: { value: 'throw_b' } },
      },
      {
        id: 'swI1',
        def: 'switch_spdt',
        x: 220,
        y: 250,
        params: { position: { value: 'throw_b' } },
      },
      {
        id: 'swI2',
        def: 'switch_spdt',
        x: 220,
        y: 380,
        params: { position: { value: 'throw_a' } },
      },
      {
        id: 'swI3',
        def: 'switch_spdt',
        x: 220,
        y: 510,
        params: { position: { value: 'throw_b' } },
      },
      { id: 'rA0', def: 'resistor', x: 740, y: 160, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dA0', def: 'led', x: 890, y: 160 },
      { id: 'rA1', def: 'resistor', x: 740, y: 300, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dA1', def: 'led', x: 890, y: 300 },
      { id: 'rGS', def: 'resistor', x: 740, y: 440, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dGS', def: 'led', x: 890, y: 440 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swI0', 'common', 'EN', 'i0'],
      ['swI0', 'throw_a', 'V1', 'terminal_positive'],
      ['swI0', 'throw_b', 'G', 'reference_terminal'],
      ['swI1', 'common', 'EN', 'i1'],
      ['swI1', 'throw_a', 'V1', 'terminal_positive'],
      ['swI1', 'throw_b', 'G', 'reference_terminal'],
      ['swI2', 'common', 'EN', 'i2'],
      ['swI2', 'throw_a', 'V1', 'terminal_positive'],
      ['swI2', 'throw_b', 'G', 'reference_terminal'],
      ['swI3', 'common', 'EN', 'i3'],
      ['swI3', 'throw_a', 'V1', 'terminal_positive'],
      ['swI3', 'throw_b', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'EN', 'v_dd'],
      ['EN', 'gnd', 'G', 'reference_terminal'],
      ['EN', 'a0', 'rA0', 'terminal_a'],
      ['rA0', 'terminal_b', 'dA0', 'anode'],
      ['dA0', 'cathode', 'G', 'reference_terminal'],
      ['EN', 'a1', 'rA1', 'terminal_a'],
      ['rA1', 'terminal_b', 'dA1', 'anode'],
      ['dA1', 'cathode', 'G', 'reference_terminal'],
      ['EN', 'gs', 'rGS', 'terminal_a'],
      ['rGS', 'terminal_b', 'dGS', 'anode'],
      ['dGS', 'cathode', 'G', 'reference_terminal'],
    ],
  },
  // 8-to-3 priority encoder — the inverse of the 3-to-8 decoder. Raise one of eight input switches and read
  // its 3-bit number on the output LEDs; GS lights when any input is active, and the highest raised input
  // wins. Starts with I5 raised → binary 101.
  'encoder-8-3': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 940 },
      { id: 'EN', def: 'logic_encoder_8_3', x: 470, y: 400, block: true },
      { id: 'swI0', def: 'switch_spdt', x: 220, y: 60, params: { position: { value: 'throw_b' } } },
      {
        id: 'swI1',
        def: 'switch_spdt',
        x: 220,
        y: 160,
        params: { position: { value: 'throw_b' } },
      },
      {
        id: 'swI2',
        def: 'switch_spdt',
        x: 220,
        y: 260,
        params: { position: { value: 'throw_b' } },
      },
      {
        id: 'swI3',
        def: 'switch_spdt',
        x: 220,
        y: 360,
        params: { position: { value: 'throw_b' } },
      },
      {
        id: 'swI4',
        def: 'switch_spdt',
        x: 220,
        y: 460,
        params: { position: { value: 'throw_b' } },
      },
      {
        id: 'swI5',
        def: 'switch_spdt',
        x: 220,
        y: 560,
        params: { position: { value: 'throw_a' } },
      },
      {
        id: 'swI6',
        def: 'switch_spdt',
        x: 220,
        y: 660,
        params: { position: { value: 'throw_b' } },
      },
      {
        id: 'swI7',
        def: 'switch_spdt',
        x: 220,
        y: 760,
        params: { position: { value: 'throw_b' } },
      },
      { id: 'rA0', def: 'resistor', x: 740, y: 260, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dA0', def: 'led', x: 890, y: 260 },
      { id: 'rA1', def: 'resistor', x: 740, y: 400, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dA1', def: 'led', x: 890, y: 400 },
      { id: 'rA2', def: 'resistor', x: 740, y: 540, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dA2', def: 'led', x: 890, y: 540 },
      { id: 'rGS', def: 'resistor', x: 740, y: 680, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dGS', def: 'led', x: 890, y: 680 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swI0', 'common', 'EN', 'i0'],
      ['swI0', 'throw_a', 'V1', 'terminal_positive'],
      ['swI0', 'throw_b', 'G', 'reference_terminal'],
      ['swI1', 'common', 'EN', 'i1'],
      ['swI1', 'throw_a', 'V1', 'terminal_positive'],
      ['swI1', 'throw_b', 'G', 'reference_terminal'],
      ['swI2', 'common', 'EN', 'i2'],
      ['swI2', 'throw_a', 'V1', 'terminal_positive'],
      ['swI2', 'throw_b', 'G', 'reference_terminal'],
      ['swI3', 'common', 'EN', 'i3'],
      ['swI3', 'throw_a', 'V1', 'terminal_positive'],
      ['swI3', 'throw_b', 'G', 'reference_terminal'],
      ['swI4', 'common', 'EN', 'i4'],
      ['swI4', 'throw_a', 'V1', 'terminal_positive'],
      ['swI4', 'throw_b', 'G', 'reference_terminal'],
      ['swI5', 'common', 'EN', 'i5'],
      ['swI5', 'throw_a', 'V1', 'terminal_positive'],
      ['swI5', 'throw_b', 'G', 'reference_terminal'],
      ['swI6', 'common', 'EN', 'i6'],
      ['swI6', 'throw_a', 'V1', 'terminal_positive'],
      ['swI6', 'throw_b', 'G', 'reference_terminal'],
      ['swI7', 'common', 'EN', 'i7'],
      ['swI7', 'throw_a', 'V1', 'terminal_positive'],
      ['swI7', 'throw_b', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'EN', 'v_dd'],
      ['EN', 'gnd', 'G', 'reference_terminal'],
      ['EN', 'a0', 'rA0', 'terminal_a'],
      ['rA0', 'terminal_b', 'dA0', 'anode'],
      ['dA0', 'cathode', 'G', 'reference_terminal'],
      ['EN', 'a1', 'rA1', 'terminal_a'],
      ['rA1', 'terminal_b', 'dA1', 'anode'],
      ['dA1', 'cathode', 'G', 'reference_terminal'],
      ['EN', 'a2', 'rA2', 'terminal_a'],
      ['rA2', 'terminal_b', 'dA2', 'anode'],
      ['dA2', 'cathode', 'G', 'reference_terminal'],
      ['EN', 'gs', 'rGS', 'terminal_a'],
      ['rGS', 'terminal_b', 'dGS', 'anode'],
      ['dGS', 'cathode', 'G', 'reference_terminal'],
    ],
  },
  // 6-transistor SRAM cell — the static memory bit. Two cross-coupled inverters hold the value; two access
  // transistors gated by the WORD LINE connect the two complementary BIT LINES. Raise the word line and set
  // the bit lines opposite (BL = 1, BL̄ = 0 to write a 1): the cell latches it and the inverters snap Q and Q̄
  // to solid rails. (Descend to see the six real transistors.)
  'sram-cell': {
    parts: [
      {
        id: 'V1',
        def: 'power_source',
        x: 40,
        y: 40,
        params: { nominal_voltage: tplScalar(5, 'volt') },
      },
      { id: 'G', def: 'ground', x: 40, y: 560 },
      { id: 'SR', def: 'memory_sram_cell', x: 560, y: 220, block: true },
      {
        id: 'swWL',
        def: 'switch_spdt',
        x: 220,
        y: 120,
        params: { position: { value: 'throw_a' } },
      },
      {
        id: 'swBL',
        def: 'switch_spdt',
        x: 220,
        y: 280,
        params: { position: { value: 'throw_a' } },
      },
      {
        id: 'swBLB',
        def: 'switch_spdt',
        x: 220,
        y: 440,
        params: { position: { value: 'throw_b' } },
      },
      { id: 'rQ', def: 'resistor', x: 900, y: 160, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dQ', def: 'led', x: 1050, y: 160 },
      { id: 'rQb', def: 'resistor', x: 900, y: 340, params: { resistance: tplScalar(330, 'ohm') } },
      { id: 'dQb', def: 'led', x: 1050, y: 340 },
    ],
    wires: [
      ['V1', 'terminal_negative', 'G', 'reference_terminal'],
      ['swWL', 'common', 'SR', 'wl'],
      ['swWL', 'throw_a', 'V1', 'terminal_positive'],
      ['swWL', 'throw_b', 'G', 'reference_terminal'],
      ['swBL', 'common', 'SR', 'bl'],
      ['swBL', 'throw_a', 'V1', 'terminal_positive'],
      ['swBL', 'throw_b', 'G', 'reference_terminal'],
      ['swBLB', 'common', 'SR', 'blb'],
      ['swBLB', 'throw_a', 'V1', 'terminal_positive'],
      ['swBLB', 'throw_b', 'G', 'reference_terminal'],
      ['V1', 'terminal_positive', 'SR', 'v_dd'],
      ['SR', 'gnd', 'G', 'reference_terminal'],
      ['SR', 'q', 'rQ', 'terminal_a'],
      ['rQ', 'terminal_b', 'dQ', 'anode'],
      ['dQ', 'cathode', 'G', 'reference_terminal'],
      ['SR', 'qbar', 'rQb', 'terminal_a'],
      ['rQb', 'terminal_b', 'dQb', 'anode'],
      ['dQb', 'cathode', 'G', 'reference_terminal'],
    ],
  },
}

/** Turn a template id into a wired starting flow — device + block nodes and the net edges between them. */
function templateFlow(template: string): { nodes: Node[]; edges: Edge[] } {
  const spec = TEMPLATE_FLOWS[template]
  if (spec === undefined) return { nodes: [], edges: [] }
  const nodes: Node[] = spec.parts.map((p) => {
    if (p.block) {
      const block = BUILTIN_BLOCKS[p.def]
      return {
        id: p.id,
        type: 'block',
        position: { x: p.x, y: p.y },
        data: {
          definition: 'block',
          label: block?.name ?? p.def,
          block: block ? cloneBlockData(block, `tpl_${p.id}`) : undefined,
        },
      } as Node
    }
    return {
      id: p.id,
      type: 'device',
      position: { x: p.x, y: p.y },
      data: {
        definition: p.def,
        label: p.id,
        parameters: { ...defaultParameters(p.def), ...(p.params ?? {}) },
      },
    } as Node
  })
  const edges: Edge[] = spec.wires.map(([source, sourceHandle, target, targetHandle], i) => ({
    id: `tpl_w${i}`,
    type: 'net',
    source,
    sourceHandle,
    target,
    targetHandle,
  })) as Edge[]
  return { nodes, edges }
}

/** Snap-to-grid step (px) — parts align to the 20 px major grid (the bold lines) when snap is on. */
const SNAP_GRID: [number, number] = [20, 20]

/**
 * Persist a freshly-authored part into the personal library (~/.chipblocks/user-parts.json) so it
 * follows you across projects. Read-modify-write, deduped by id — the library grows ONLY by authoring,
 * so a part that merely passed through the session from opening someone else's project is never added.
 *
 * The read-modify-write isn't internally serialized; it's safe because it's fired only from the New-Part
 * dialog's Save, which is a single modal (no two open at once). If a second author path is ever added
 * (import, batch), serialize the writes — otherwise a later read could lose the earlier part.
 */
async function persistAuthoredPart(part: UserPart): Promise<void> {
  const bridge = window.chipblocks
  if (bridge?.readUserLibrary === undefined || bridge.writeUserLibrary === undefined) return
  // A module built around OTHER custom parts needs those sub-parts wherever it goes — persist the
  // whole transitive set, not just the authored part (else the module is silently dead elsewhere).
  const closure = withInternalParts(part, allUserParts())
  const text = await bridge.readUserLibrary()
  if (text === null) {
    // No library yet → create it with this part (+ its custom sub-parts).
    await bridge.writeUserLibrary(serializeUserLibrary(closure))
    return
  }
  const parsed = deserializeUserLibrary(text)
  if (!parsed.ok) {
    // The existing library is there but unreadable (corrupt, or a newer format from a future build). Do
    // NOT overwrite it — that would clobber it — just skip persisting; the part still works this session
    // and can be re-authored once the library is sorted out.
    console.warn(
      `[user-library] not persisting "${part.id}": library unreadable (${parsed.reason})`,
    )
    return
  }
  let parts = parsed.parts
  for (const p of closure) parts = withPart(parts, p)
  await bridge.writeUserLibrary(serializeUserLibrary(parts))
}

function Canvas({ project, active = true }: { project: ProjectChoice; active?: boolean }) {
  // Only the active tab is "live" — a background tab keeps its state mounted but must NOT grab global
  // keystrokes (delete/copy/paste) or the single window.__chip CDP slot. activeRef lets the
  // always-attached global handlers no-op while this tab is in the background.
  const activeRef = useRef(active)
  activeRef.current = active
  const initial = useMemo(() => {
    // The catalog world supplies the part + material DEFINITIONS (for the material
    // dropdowns); the canvas itself starts from the chosen template's parts, not the
    // catalog demo layout.
    const world = loadCatalogWorld()
    // A SAVED project opens from its stored circuit; a fresh one from the chosen template — a Blank start is
    // an empty canvas, a wired template (led-resistor, rc-lowpass, …) is a working schematic. The re-solve
    // fills current/length/resistance either way.
    const flow = project.loaded ? circuitFileToFlow(project.loaded) : templateFlow(project.template)
    const nodes: Node[] = flow.nodes
    const baseEdges: Edge[] = flow.edges
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
  }, [project.template, project.loaded])

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
  // A loaded project resumes its id counter ABOVE the saved ids (so new drops never collide); a fresh
  // template project just counts its seeded parts.
  const dropCount = useRef(
    project.loaded ? maxIdSuffix(project.loaded.nodes) : initial.nodes.length,
  )
  // The Add-Part pop-up (the KiCad-style Choose-a-part dialog) — open state lives here.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [newPartOpen, setNewPartOpen] = useState(false)
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
  const undoHistory = useRef(
    emptyHistory<{
      nodes: Node[]
      edges: Edge[]
      placements: SavedPlacement[]
      chipLayout: ChipLayout
    }>(),
  )
  const snapshotCanvas = useCallback((): {
    nodes: Node[]
    edges: Edge[]
    placements: SavedPlacement[]
    chipLayout: ChipLayout
  } => {
    const canvas = JSON.parse(
      JSON.stringify({ nodes: nodesRef.current, edges: edgesRef.current }),
    ) as { nodes: Node[]; edges: Edge[] }
    // Board hand-placements AND the chip layout (cell overrides + lens) ride the SAME undo snapshot as
    // the canvas, so a board drag/rotate or a chip cell move undoes together with the parts + wires
    // (they're one document). The chip layout is copied (fresh overrides array) so history can't be mutated.
    return {
      ...canvas,
      placements: placementsToSaved(pcbPlacementsRef.current),
      chipLayout: {
        ...chipLayoutRef.current,
        overrides: [...chipLayoutRef.current.overrides],
      },
    }
  }, [])
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
        placementsToSaved(pcbPlacementsRef.current),
        allUserParts(),
        chipLayoutRef.current,
        userTracesRef.current,
        userViasRef.current,
        pcbStackupOptionsRef.current,
      )
      void bridge.saveCircuitData(JSON.stringify(file, null, 2)).then((r) => {
        // A successful save lands the project in the "My Projects" list (by its file path).
        if (r.ok && r.path !== undefined) {
          recordRecentProject({
            name: project.name || projectNameFromPath(r.path),
            path: r.path,
            savedAt: Date.now(),
          })
        }
      })
    })
  }, [nodes, edges, project.name])

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

  // Export Verilog: serialize the canvas to a CircuitFile, then to a structural Verilog module (Net Labels
  // become the module ports). Same flow as the SPICE export — hand the text to main, show the report.
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.onExportVerilogRequest === undefined) return
    bridge.onExportVerilogRequest(() => {
      const file = serializeCircuit(
        nodes.map((n) => ({ id: n.id, position: n.position, data: n.data as DeviceNodeData })),
        edges,
        projectAmbientRef.current,
      )
      const { verilog, unsupported, warnings } = serializeVerilog(file)
      const gateCount = (verilog.match(/^\s*(and|or|not|nand|nor|xor|xnor|buf) g\d+\(/gm) ?? [])
        .length
      void bridge.saveVerilogData?.(verilog)
      setNetlistReport({
        kind: 'export',
        count: gateCount,
        unsupported,
        warnings,
        format: 'verilog',
      })
    })
  }, [nodes, edges])

  // Hand-placed spots on the PCB (drag / R on the board) — the auto row only seeds where a part
  // starts. Declared up here because the file Open/Import handlers below must clear it: node ids
  // repeat across files (every canvas mints resistor_1 …), so a loaded circuit would otherwise
  // inherit the previous file's hand placements on any id collision.
  const [pcbPlacements, setPcbPlacements] = useState<ReadonlyMap<string, PlacementOverride>>(
    new Map(),
  )
  // A live handle to the current placements so the Save handler (registered above, before this
  // declaration) and the undo snapshot can read them without re-registering on every board drag.
  const pcbPlacementsRef = useRef(pcbPlacements)
  pcbPlacementsRef.current = pcbPlacements

  // The chip floorplan's own persisted layer (cell overrides + lens + schematic fingerprint) — the twin
  // of pcbPlacements one level down. Starts empty (the floorplan auto-generates); saved + loaded so a
  // laid-out chip survives a reload. A live ref for the Save handler + undo snapshot, same as the board.
  const [chipLayout, setChipLayout] = useState<ChipLayout>(EMPTY_CHIP_LAYOUT)
  const chipLayoutRef = useRef(chipLayout)
  chipLayoutRef.current = chipLayout

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
      // Register the project's custom parts (already validated by deserializeCircuit) so its nodes draw
      // + wire as their real symbols. A non-clobbering merge: if an id is already in the library (e.g. a
      // part another open tab authored), the EXISTING one is kept — loading a project never silently
      // rewrites a part in use elsewhere. (Built-in-id clashes are skipped too.)
      mergeUserParts(result.file.userParts ?? [])
      const flow = circuitFileToFlow(result.file)
      setNodes(flow.nodes)
      setEdges(flow.edges)
      // Restore THIS file's hand placements (replacing the previous canvas's — ids repeat across files,
      // so we never inherit the old ones); older files with none load onto their auto board.
      setPcbPlacements(placementsFromSaved(result.file.placements))
      // Restore THIS file's chip floorplan layer (replacing the previous canvas's); older files with none
      // load with an empty layout, so the chip level re-generates its floorplan fresh from the design.
      setChipLayout(result.file.chipLayout ?? EMPTY_CHIP_LAYOUT)
      // Restore THIS file's board stack-up (copper-layer count, thickness, weight, finish) — older files
      // with none load on the 2-layer default. Set BEFORE the copper below so the restored inner-layer
      // hand copper lands on a board that actually has those layers (the review-caught orphaning).
      setPcbStackupOptions(result.file.stackup ?? DEFAULT_STACKUP_OPTIONS)
      // Restore THIS file's hand-laid copper (replacing the previous canvas's — sanitized already by
      // deserializeCircuit); older files with none load with only auto-routed copper.
      setUserTraces(result.file.traces ?? [])
      setUserVias(result.file.vias ?? [])
      setChipFloorplan(null) // re-generate the floorplan for the loaded design on next chip entry
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
      // SPICE, KiCad, and Verilog all arrive on this channel; tell them apart by the file's own shape.
      const isKicad = text.trimStart().startsWith('(kicad_sch')
      const isVerilog = !isKicad && isVerilogText(text)
      const { circuit, unsupported, warnings } = isVerilog
        ? parseVerilogText(text)
        : isKicad
          ? parseKicadSchematic(text)
          : parseSpiceNetlist(text)
      checkpointAction('import netlist')
      projectAmbientRef.current = STANDARD_AMBIENT_C
      setProjectAmbientC(STANDARD_AMBIENT_C)
      const flow = circuitFileToFlow(circuit)
      setNodes(flow.nodes)
      setEdges(flow.edges)
      setPcbPlacements(new Map()) // imported netlists start from their own auto board
      setChipLayout(EMPTY_CHIP_LAYOUT) // …and a fresh chip floorplan
      setUserTraces([]) // …and no hand-laid copper (only what the auto-router lays)
      setUserVias([])
      setPcbStackupOptions(DEFAULT_STACKUP_OPTIONS) // …on the default 2-layer stack-up
      setChipFloorplan(null)
      dropCount.current = maxIdSuffix(circuit.nodes)
      window.setTimeout(() => fitView({ padding: 0.15 }), 80)
      // A Verilog import arrives as one circuit block; report its gate count, not the node count (1).
      const count = isVerilog ? (circuit.nodes[0]?.block?.nodes.length ?? 0) : circuit.nodes.length
      setNetlistReport({
        kind: 'import',
        count,
        unsupported,
        warnings,
        ...(isVerilog ? { format: 'verilog' as const } : {}),
      })
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
    setPcbPlacements(placementsFromSaved(result.restored.placements))
    setChipLayout(result.restored.chipLayout ?? EMPTY_CHIP_LAYOUT)
    reSolve(result.restored.nodes, result.restored.edges)
  }, [snapshotCanvas, setNodes, setEdges, reSolve])
  const doRedo = useCallback(() => {
    const result = redo(undoHistory.current, snapshotCanvas(), Date.now())
    if (result === null) return
    undoHistory.current = result.history
    setNodes(result.restored.nodes)
    setEdges(result.restored.edges)
    setPcbPlacements(placementsFromSaved(result.restored.placements))
    setChipLayout(result.restored.chipLayout ?? EMPTY_CHIP_LAYOUT)
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
  // Verilog IDE: write hardware in Verilog, watch it synthesize live, drop the resulting gates on the sheet.
  const [verilogOpen, setVerilogOpen] = useState(false)
  // The editor's text, kept here so it survives closing + reopening the panel (the editor unmounts on close).
  const [verilogText, setVerilogText] = useState(STARTER_VERILOG)
  // Run-trace inspector: clock a digital design N cycles and flag per-cycle anomalies.
  const [traceOpen, setTraceOpen] = useState(false)
  // Stress bench: ramp ambient / supply / a component's value and map each part's safe operating window.
  const [stressOpen, setStressOpen] = useState(false)
  // The digital blocks on the canvas the trace inspector can clock (gates-all-the-way-down, with I/O).
  // Only computed while the panel is open — the logic-compatibility check walks each block's internals.
  const traceBlocks = useMemo<TraceBlock[]>(() => {
    if (!traceOpen) return []
    const out: TraceBlock[] = []
    for (const n of nodes) {
      const data = n.data as { block?: BlockData; label?: string }
      if (n.type === 'block' && data.block && blockIsLogicCompatible(data.block)) {
        out.push({ id: n.id, label: data.label ?? data.block.name, block: data.block })
      }
    }
    return out
  }, [traceOpen, nodes])
  // Which surface the MAIN building area shows: the schematic canvas (default) or the full-size board /
  // chip workspace — a first-class editing surface, not just the dock panel. Opening a Board/Chip project
  // from the launcher lands the editor directly on that level (else Circuit); the breadcrumb travels.
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(
    project.initialWorkspace ?? 'schematic',
  )
  const onWorkspace = useCallback(
    () => setWorkspaceMode((m) => (m === 'schematic' ? 'board' : 'schematic')),
    [],
  )
  // Chip-level timing sign-off: the same static-timing analysis, but on the design FLATTENED to gates + flip-
  // flops first — so a hierarchical block's INTERNAL registers become the register nodes. The schematic-level
  // `timing` sees a CPU as a single block and finds no register-to-register paths; flattening exposes them
  // (thousands, on a CPU). Only computed at the Chip level (the flatten is heavy), reusing `timing` elsewhere.
  const chipTiming = useMemo(() => {
    if (workspaceMode !== 'chip') return timing
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
    // Descend through composite blocks + multi-bit registers, stopping at logic gates and the atomic D
    // flip-flop (the register the synthesizer and register blocks are built from) so the flops read as
    // registers and the gates between them as combinational paths.
    const flat = flattenBlocks(
      nodes as unknown as BlockNodeLike[],
      edges as unknown as BlockEdgeLike[],
      (b) => isLogicGate(b) || b.name === 'D Flip-Flop',
    )
    const timingOpts = { wireCapacitance: 5e-12, defaultInputCapacitance: 120e-12 }
    const paths = traceTimingPaths(flat.nodes, flat.edges, {
      supplyVoltage,
      ...timingOpts,
    })
    const report = analyzeTiming(paths, flipFlopTiming(supplyVoltage, timingOpts), clockPeriod, 0)
    const hasRegisters = flat.nodes.some((n) => {
      const b = (n.data as { block?: BlockData })?.block
      return b ? isClockedBlock(b) : false
    })
    return { report, hasRegisters, clockDetected: Number.isFinite(clockPeriod) }
  }, [workspaceMode, nodes, edges, live, timing])

  // The chip floorplan is GENERATED (placeCells) lazily when you ENTER the Chip level and then LIVES in
  // app state, so leaving + re-entering the level doesn't re-derive it — the "stop re-deriving" fix. It
  // regenerates only when you press Re-place; a cheap schematic fingerprint flags when it's gone stale.
  const [chipFloorplan, setChipFloorplan] = useState<{
    plan: Floorplan
    signature: string
    netlist: TopNetlist
  } | null>(null)
  const chipLiveSignature = useMemo(
    () => chipSignature(nodes as unknown as BlockNodeLike[], edges as unknown as BlockEdgeLike[]),
    [nodes, edges],
  )
  const regenerateChipFloorplan = useCallback(() => {
    // Capture the connectivity from the SAME schematic snapshot as the placement, so the DEF's COMPONENTS
    // and its NETS/PINS can never describe different design states (they'd otherwise diverge under drift).
    setChipFloorplan({
      plan: placeCells(nodes as unknown as BlockNodeLike[], edges as unknown as BlockEdgeLike[]),
      signature: chipLiveSignature,
      netlist: extractTopNetlist(
        nodes as unknown as BlockNodeLike[],
        edges as unknown as BlockEdgeLike[],
      ),
    })
  }, [nodes, edges, chipLiveSignature])
  // Generate on entering the Chip level if there's none yet; never auto-regenerate afterwards — an edit
  // raises the drift banner instead (the real-EDA "the layout is a separate artifact" model).
  useEffect(() => {
    if (workspaceMode === 'chip' && chipFloorplan === null) regenerateChipFloorplan()
  }, [workspaceMode, chipFloorplan, regenerateChipFloorplan])
  const chipDrift = chipFloorplan !== null && chipFloorplan.signature !== chipLiveSignature
  // Re-place: regenerate from the current schematic, drop manual cell moves, and re-baseline the drift.
  const onChipReplace = useCallback(() => {
    regenerateChipFloorplan()
    setChipLayout((current) => ({ ...current, overrides: [], sourceSignature: chipLiveSignature }))
  }, [regenerateChipFloorplan, chipLiveSignature])

  // Export GDS: turn the placed chip floorplan into a real GDSII byte stream (gds.ts) and hand the bytes
  // to main to write — the chip-side twin of the manufacturing-ZIP export, and the "exportable" payoff of
  // the chip-physical chapter (the .gds opens in Magic / KLayout / OpenROAD). We export exactly what the
  // Chip canvas shows: the live floorplan (generated fresh from the schematic if the level was never
  // entered) with the user's hand-placement overrides applied.
  // What every chip-layout export writes: the live floorplan (generated fresh from the schematic if the
  // Chip level was never entered) with the user's hand-placement overrides applied — exactly what the Chip
  // canvas shows. Shared by the GDS / LEF / DEF export effects.
  const buildChipPlan = useCallback((): Floorplan => {
    const base =
      chipFloorplan?.plan ??
      placeCells(nodes as unknown as BlockNodeLike[], edges as unknown as BlockEdgeLike[])
    return { ...base, cells: mergeOverrides(base.cells, chipLayout.overrides) }
  }, [chipFloorplan, chipLayout, nodes, edges])

  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.onExportGdsRequest === undefined) return
    bridge.onExportGdsRequest(() => {
      const plan = buildChipPlan()
      void bridge.saveGdsData?.(writeGds(floorplanToGds(plan), new Date()))
      const warnings =
        plan.cells.length === 0
          ? ['The chip floorplan is empty — nothing to place.']
          : [
              'Cells carry real per-layer polygons (poly/diff/nwell/li1/met1) on SKY130 layer numbers with C5N λ-scaled teaching geometry — opens in KLayout/Magic, but is not a foundry-DRC-clean cell (no well/substrate taps; relaxed contacts at stage boundaries). Unknown cell types fall back to a prBoundary outline.',
            ]
      if (plan.anyUnreliable)
        warnings.push('Some cells are flagged unreliable in the floorplan (reported, not omitted).')
      const drc = namedCellDrc(plan.cells.map((c) => c.name))
      if (drc.length > 0) warnings.push(summarizeDrc(drc))
      const lvs = namedCellLvs(plan.cells.map((c) => c.name))
      if (lvs.length > 0) warnings.push(summarizeLvs(lvs))
      setNetlistReport({
        kind: 'export',
        count: plan.cells.length,
        unsupported: [],
        warnings,
        format: 'gds',
      })
    })
  }, [buildChipPlan])

  // Export LEF: the standard-cell library abstract (lef.ts) for the cells this design uses — for OpenROAD.
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.onExportLefRequest === undefined) return
    bridge.onExportLefRequest(() => {
      const plan = buildChipPlan()
      const { text, macros, fallbacks } = floorplanToLef(plan)
      void bridge.saveLefData?.(text)
      setNetlistReport({
        kind: 'export',
        count: macros,
        unsupported: fallbacks,
        warnings: [
          'Standard-cell library (LEF) for OpenROAD: C5N λ-scaled teaching geometry on SKY130 layer names; the tech-LEF rules are the λ×0.3 µm cell rules (met1 0.9 / li1 0.6 / pitch 1.5), NOT SKY130 silicon rules. For placement inspection/re-placement — a full flow also needs a Liberty timing library. Unknown cell types fall back to a black-box macro.',
        ],
        format: 'lef',
      })
    })
  }, [buildChipPlan])

  // Export Liberty: the .lib timing library (liberty.ts) for the cells this design uses — the last piece of
  // the OpenROAD signoff round-trip (LEF geometry + DEF placement/connectivity + Liberty timing).
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.onExportLibRequest === undefined) return
    bridge.onExportLibRequest(() => {
      const plan = buildChipPlan()
      const { text, cells, fallbacks } = floorplanToLib(plan)
      void bridge.saveLibData?.(text)
      setNetlistReport({
        kind: 'export',
        count: cells,
        unsupported: fallbacks,
        warnings: [
          'Timing library (Liberty) for OpenROAD STA: real single-stage RC delays (t = ln2·R·C) from the app’s own timing engine, but at the DISCRETE 2N7000/BS250 constants (k, C_iss 60 pF) the app is built on — real physics at the ns scale of 5 V discrete logic, NOT on-chip C5N per-area silicon. Rise/fall share the worst-case drive R; input-slew dependence is not modelled; a composite cell (AND/OR/XOR) is timed at its output stage. Unknown cell types are omitted (an untimed cell would mislead the STA).',
        ],
        format: 'lib',
      })
    })
  }, [buildChipPlan])

  // Export DEF: the placed design (def.ts) — the floorplan's rows + component placements, for OpenROAD.
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.onExportDefRequest === undefined) return
    bridge.onExportDefRequest(() => {
      const plan = buildChipPlan()
      // Use the netlist captured WITH the snapshot so it matches the placed cells' ids; only the
      // never-entered path (no snapshot) falls back to a fresh extract, where buildChipPlan also placed fresh.
      const netlist =
        chipFloorplan?.netlist ??
        extractTopNetlist(nodes as unknown as BlockNodeLike[], edges as unknown as BlockEdgeLike[])
      const { text, components, nets, pins } = floorplanToDef(plan, { netlist })
      void bridge.saveDefData?.(text)
      const warnings =
        plan.cells.length === 0
          ? ['The chip floorplan is empty — nothing to place.']
          : [
              `Placed + connected design (DEF) for OpenROAD: rows alternate N/FS so power rails abut same-net (legal grid); ${nets} signal net(s) + ${pins} top-level pin(s) + the VDD/VSS power rails are emitted, so a router/timer can consume it (with the Liberty library). Top-level pins are inferred from named net-labels; power uses the * VDD / * VSS wildcard.`,
            ]
      const drc = namedCellDrc(plan.cells.map((c) => c.name))
      if (drc.length > 0) warnings.push(summarizeDrc(drc))
      const lvs = namedCellLvs(plan.cells.map((c) => c.name))
      if (lvs.length > 0) warnings.push(summarizeLvs(lvs))
      setNetlistReport({
        kind: 'export',
        count: components,
        unsupported: [],
        warnings,
        format: 'def',
      })
    })
  }, [buildChipPlan, chipFloorplan, nodes, edges])

  // Export OASIS: the compact-binary layout (oasis.ts) — the same geometry as the .gds, smaller file.
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.onExportOasisRequest === undefined) return
    bridge.onExportOasisRequest(() => {
      const plan = buildChipPlan()
      void bridge.saveOasisData?.(writeOasis(floorplanToOasis(plan)))
      const warnings =
        plan.cells.length === 0
          ? ['The chip floorplan is empty — nothing to place.']
          : [
              'Cells carry real per-layer polygons (poly/diff/nwell/li1/met1) on SKY130 layer numbers with C5N λ-scaled teaching geometry — opens in KLayout (OASIS is a KLayout/OpenROAD format; Magic reads GDSII), but is not a foundry-DRC-clean cell. Hierarchical (one cell per gate type, placed by reference); unknown cell types fall back to a prBoundary outline.',
            ]
      if (plan.anyUnreliable)
        warnings.push('Some cells are flagged unreliable in the floorplan (reported, not omitted).')
      const drc = namedCellDrc(plan.cells.map((c) => c.name))
      if (drc.length > 0) warnings.push(summarizeDrc(drc))
      const lvs = namedCellLvs(plan.cells.map((c) => c.name))
      if (lvs.length > 0) warnings.push(summarizeLvs(lvs))
      setNetlistReport({
        kind: 'export',
        count: plan.cells.length,
        unsupported: [],
        warnings,
        format: 'oas',
      })
    })
  }, [buildChipPlan])
  // Drag a cell to a new spot → record a placement override (checkpointed for undo, like a board move).
  const onChipCellMove = useCallback(
    (cellId: string, x: number, y: number) => {
      checkpointAction('chip cell move')
      setChipLayout((current) => ({
        ...current,
        overrides: [...current.overrides.filter((o) => o.id !== cellId), { id: cellId, x, y }],
      }))
    },
    [checkpointAction],
  )
  // The PCB derivation (board → router → DRC) runs when EITHER the dock panel is open OR the board
  // workspace is showing — so the full-size workspace derives real copper without forcing the dock open.
  const pcbActive = pcbOpen || workspaceMode === 'board'
  // The user's HAND-DRAWN copper (the route/via tools) — kept separate from the auto-router's output so
  // a part drag (which re-runs the router) never wipes it; merged back in via pcbMergedRouting below.
  const [userTraces, setUserTraces] = useState<CopperTrace[]>([])
  const [userVias, setUserVias] = useState<Via[]>([])
  // Live handles so the Save handler (registered above, before this declaration) reads the current
  // hand-laid copper without re-registering on every trace/via — same pattern as pcbPlacementsRef.
  const userTracesRef = useRef(userTraces)
  userTracesRef.current = userTraces
  const userViasRef = useRef(userVias)
  userViasRef.current = userVias
  // The board-editing tool + the route being laid (click a pad → corners → a pad, like the wire tool).
  const [boardTool, setBoardTool] = useState<'select' | 'route' | 'via' | 'measure'>('select')
  const [pendingRoute, setPendingRoute] = useState<{
    net: string
    layer: CopperLayer
    points: { x: number; y: number }[]
  } | null>(null)
  const [routeCursor, setRouteCursor] = useState<{ x: number; y: number } | null>(null)
  // The measure/ruler tool: placed measurements (mm), the point being dropped, the live cursor, + unit.
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [pendingMeasureA, setPendingMeasureA] = useState<{ x: number; y: number } | null>(null)
  const [measureCursor, setMeasureCursor] = useState<{ x: number; y: number } | null>(null)
  const [measureUnit, setMeasureUnit] = useState<MeasureUnit>('mm')
  const pcbBoard = useMemo(
    () =>
      deriveBoard(
        nodes.map((n) => {
          const data = n.data as DeviceNodeData
          return {
            id: n.id,
            definition: data.definition,
            ...(data.footprintId ? { footprintId: data.footprintId } : {}),
          }
        }),
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
  const onPcbRotate = useCallback(
    (partId: string, rotation: Rotation) => {
      if (!nodesRef.current.some((n) => n.id === partId)) return
      checkpointAction('board-rotate') // capture the pre-rotate board so a turn undoes
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
    },
    [checkpointAction],
  )
  // A board drag has STARTED to actually move a part (fired on the first move, not on a plain click) —
  // checkpoint the pre-drag board once so the whole drag is a single undo (later moves don't checkpoint).
  const onPcbMoveStart = useCallback(() => {
    checkpointAction('board-move')
  }, [checkpointAction])
  // The board's physical stack-up — the fab-order spec that goes in the manufacturing ZIP. The user
  // edits the knobs (finished thickness, copper weight, surface finish, layer count) in the PCB
  // panel; the cross-section (the FR4 core filling to the chosen thickness) is rebuilt from them.
  // Declared here (ahead of routing) because the router needs the copper-layer count.
  const [pcbStackupOptions, setPcbStackupOptions] =
    useState<StackupOptions>(DEFAULT_STACKUP_OPTIONS)
  // A live handle for the Save handler (registered earlier) so a saved file carries the board's real
  // stack-up — the copper-layer count in particular, so hand-laid inner-layer copper keeps a layer to
  // live on across a reload (else it would be orphaned onto a reverted 2-layer board).
  const pcbStackupOptionsRef = useRef(pcbStackupOptions)
  pcbStackupOptionsRef.current = pcbStackupOptions
  const pcbStackup = useMemo(() => buildStackup(pcbStackupOptions), [pcbStackupOptions])
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
  // The copper: every airwire the router could turn into a real trace, across all the board's copper
  // layers; what it couldn't stays an airwire, honestly counted. Re-routes live as parts move.
  const pcbRouting = useMemo(
    () =>
      pcbActive
        ? routeBoard(pcbRatsnest, DEFAULT_ROUTE_CLASS, pcbStackup.copperLayers)
        : { traces: [], vias: [], unrouted: [] },
    [pcbActive, pcbRatsnest, pcbStackup.copperLayers],
  )
  // The auto-router's copper unioned with the user's hand-drawn traces/vias — the SINGLE routing every
  // downstream reader uses (views, DRC, export). Merging also recomputes the owed list, so hand-routing
  // a connection the auto-router couldn't take marks it done and lets the board export. The board's
  // actual copper layers gate the hand copper: a trace on a layer the stack-up no longer has (an inner
  // trace after reducing the layer count) ships in no Gerber, so it must NOT count as routed here.
  const pcbMergedRouting = useMemo(
    () =>
      mergeUserCopper(
        pcbRouting,
        userTraces,
        userVias,
        new Set(routableCopperLayers(pcbStackup.copperLayers)),
      ),
    [pcbRouting, userTraces, userVias, pcbStackup.copperLayers],
  )
  // Controlled impedance of a default-width outer trace on this stack-up (IPC-2141A microstrip), plus
  // the width that would hit 50 Ω — a live readout as the stack-up knobs change.
  const pcbImpedance = useMemo(() => {
    const z = traceImpedance(pcbStackup, DEFAULT_ROUTE_CLASS.traceWidthMm, 'top')
    return { z, widthFor50: widthForImpedance(pcbStackup, 50) }
  }, [pcbStackup])
  // The RMS current at every device terminal when the board has a live AC source — the heating
  // (RMS) current an AC trace really carries, which the DC operating point (~0 A for a pure AC
  // source) can't see. undefined for a DC circuit; then the DC per-terminal currents are used.
  const pcbAcRms = useMemo(
    () => (pcbActive ? boardRmsTerminalCurrents(solvedWorld, solvedTemperatures) : undefined),
    [pcbActive, solvedWorld, solvedTemperatures],
  )
  // The current on each net — what the over-current DRC checks each trace's IPC-2221 ampacity
  // against. Each pad reports its OWN terminal's current: for an AC circuit the RMS current through
  // that terminal; otherwise the DC solve's per-terminal current — a two-terminal part's
  // through-current, or a transistor pin's own (base pin = the tiny base current, emitter pin =
  // iC + iB, collector pin = iC; a MOSFET gate = ~0). So a transistor's collector current is never
  // charged to its base/gate trace, and an AC-driven trace is checked against its real RMS current.
  const pcbPadCurrentOf = useCallback(
    (partId: string, padId: string): number | undefined => {
      const definition = solvedWorld.instances.get(partId)?.definition
      // The pad→terminal mapping is package-specific (a TO-92's pins order differently from a SOT-23's),
      // so resolve it against the part's chosen footprint — else a transistor's per-pin current is
      // mis-attributed on a non-default package.
      const footprintId = pcbBoard.placements.find((p) => p.partId === partId)?.footprintId
      const terminal =
        definition !== undefined ? terminalForPad(definition, padId, footprintId) : undefined
      if (pcbAcRms !== undefined) {
        return terminal !== undefined ? pcbAcRms.get(`${partId}/${terminal}`) : undefined
      }
      const perTerminal = solution.terminalCurrents?.get(partId)
      if (perTerminal !== undefined) {
        return terminal !== undefined ? perTerminal.get(terminal) : undefined
      }
      return readings.get(partId)?.current
    },
    [solvedWorld, solution, readings, pcbAcRms, pcbBoard],
  )
  const pcbNetCurrents = useMemo(
    () =>
      pcbActive
        ? netThroughCurrents(pcbRatsnest.padBoxes, pcbPadCurrentOf)
        : new Map<string, number>(),
    [pcbActive, pcbRatsnest, pcbPadCurrentOf],
  )
  // Per-pad current, keyed `partId/padId` — feeds the over-current DRC's per-segment (multi-drop)
  // check so a thin branch trace is checked against ITS load, not the whole net's trunk current.
  const pcbPadCurrents = useMemo(() => {
    const m = new Map<string, number>()
    if (!pcbActive) return m
    for (const pb of pcbRatsnest.padBoxes) {
      const slash = pb.pad.indexOf('/')
      const partId = slash >= 0 ? pb.pad.slice(0, slash) : pb.pad
      const padId = slash >= 0 ? pb.pad.slice(slash + 1) : ''
      const current = pcbPadCurrentOf(partId, padId)
      if (current !== undefined) m.set(pb.pad, Math.abs(current))
    }
    return m
  }, [pcbActive, pcbRatsnest, pcbPadCurrentOf])
  // Design-rule check — the board's failure-mode pass (cited limits), re-run live like the routing.
  // The solved net currents + copper weight enable the over-current check (trace vs IPC-2221 ampacity).
  const pcbDrc = useMemo(
    () =>
      pcbActive
        ? runDrc(pcbBoard, pcbRatsnest, pcbMergedRouting, DEFAULT_ROUTE_CLASS, {
            netCurrents: pcbNetCurrents,
            copperWeight: pcbStackup.copperWeight,
            padCurrents: pcbPadCurrents,
          })
        : [],
    [
      pcbActive,
      pcbBoard,
      pcbRatsnest,
      pcbMergedRouting,
      pcbNetCurrents,
      pcbStackup.copperWeight,
      pcbPadCurrents,
    ],
  )
  // The over-current check needs solved currents. A purely-digital (logic-fidelity) board is resolved
  // as 0/1 with NO currents (empty branches), and an unsolved board has none either — so the check
  // silently contributes nothing. Rather than let such a board read "over-current clean" for a test
  // that never ran (faking a pass), we detect it: routed copper exists, but no current was solved.
  const pcbOverCurrentUnevaluated = useMemo(
    () =>
      pcbActive &&
      pcbMergedRouting.traces.length > 0 &&
      solution.branches.size === 0 &&
      pcbAcRms === undefined,
    [pcbActive, pcbMergedRouting, solution, pcbAcRms],
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
  // Controlled-depth recesses (cavity / stepped boards) — rectangular pockets milled into the board.
  // Design + 3-D visualisation for now; export is gated until the depth-mill output exists.
  const [boardRecesses, setBoardRecesses] = useState<Recess[]>([])
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
  // The copper layer new traces land on — the active drawable sheet's copper layer (F.Cu → top,
  // In1.Cu → inner1, B.Cu → bottom…). A non-copper sheet (silk/core) falls back to the top.
  // In Layers mode the ▲/▼ pager picks it; the layer buttons set it directly in any mode.
  const activeCopperLayer: CopperLayer = copperLayerOf(pcbActiveLayerId) ?? 'top'
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
  // The MEASURE / ruler tool: click a first board point, then a second — that places a measurement
  // (real millimetres). The first click drops point A; the next completes an A→B measurement.
  const onBoardMeasureClick = useCallback(
    (mm: { x: number; y: number }) => {
      if (boardTool !== 'measure') return
      // No nested setState: the first click drops point A; the next reads it and commits the A→B
      // measurement (a side-effect inside a setState updater would double-fire under StrictMode).
      if (pendingMeasureA === null) {
        setPendingMeasureA(mm)
      } else {
        setMeasurements((cur) => [...cur, { a: pendingMeasureA, b: mm }])
        setPendingMeasureA(null)
      }
    },
    [boardTool, pendingMeasureA],
  )
  const onBoardMeasureMove = useCallback(
    (mm: { x: number; y: number }) => {
      if (boardTool === 'measure') setMeasureCursor(mm)
    },
    [boardTool],
  )
  // Leaving the board workspace or switching tools abandons a half-drawn route / measurement.
  useEffect(() => {
    if (workspaceMode !== 'board' || boardTool !== 'route') setPendingRoute(null)
    if (workspaceMode !== 'board' || boardTool !== 'measure') setPendingMeasureA(null)
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
      recesses: boardRecesses,
      overCurrentEvaluated: !pcbOverCurrentUnevaluated,
      when: new Date(),
    })
    if (fab.validation.status !== 'pass') {
      setPcbExportNote(`not exported — ${fab.validation.problems.join(' ')}`)
      return
    }
    void window.chipblocks?.saveFabZip?.(fab.bytes).then((r) => {
      setPcbExportNote(r.ok && r.path !== undefined ? `manufacturing ZIP saved — ${r.path}` : null)
    })
  }, [
    nodes,
    edges,
    pcbBoard,
    pcbRatsnest,
    pcbMergedRouting,
    pcbDrc,
    pcbOffBoard,
    pcbStackup,
    boardRecesses,
    pcbOverCurrentUnevaluated,
  ])
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
  // The 1-port Reflection tool (RF) — the frequency-domain sibling of Bode, same shape.
  const {
    reflectionOpen,
    setReflectionOpen,
    reflectionPort,
    setReflectionPort,
    reflectionPicking,
    setReflectionPicking,
    reflectionWorld,
    onReflectionProbeClick,
  } = useReflection({ solvedWorld, tool })
  // The large-signal Distortion tool (RF) — drives hard through the transient+FFT engine, same probe shape.
  const {
    distortionOpen,
    setDistortionOpen,
    distortionSource,
    setDistortionSource,
    distortionOutputNet,
    distortionPicking,
    setDistortionPicking,
    distortionWorld,
    onDistortionProbeClick,
  } = useDistortion({ solvedWorld, tool })
  // The 2-port S-parameter tool (RF) — two named ports (dropdowns, no probe), same grounded AC solve.
  const {
    sparamOpen,
    setSparamOpen,
    sparamPort1,
    setSparamPort1,
    sparamPort2,
    setSparamPort2,
    sparamWorld,
  } = useSParam({ solvedWorld })
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
  // solve. Block PORTS, multi-lead source LEADS, and user-part PINS (a module's
  // pin, a behaves-as pin) all alias to the real terminal they stand for
  // (lead aliases first — a port can point at a lead).
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
    for (const alias of userPartAliases(nodes)) {
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
      if (!activeRef.current) return // a background tab must not act on global keystrokes
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (shortcutsOpen) return // the panel owns the keyboard while open
      if (eventMatchesBinding(event, keybinds.shortcutsPanel)) {
        window.dispatchEvent(new Event('chipblocks:shortcuts'))
        return
      }
      if (workspaceMode === 'schematic' && eventMatchesBinding(event, keybinds.selectAll)) {
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
      // A non-schematic level (Board or Chip) owns the main area — schematic copy/cut/paste/rotate/
      // delete are inert here (rotating a board part is R on the focused board, handled inside PcbView).
      // Esc abandons a half-drawn board route (and drops the route tool back to Select).
      if (workspaceMode !== 'schematic') {
        if (workspaceMode === 'board' && event.key === 'Escape') {
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

  // ── The Verilog-CPU demo: watch a CPU authored in Verilog run on real gates ──────────────────────────
  // The processor from verilog-cpu-demo.ts is SYNTHESIZED from Verilog (importVerilog → real gate + flip-flop
  // cells) and clocked in an off-canvas logic harness (compiled ONCE, like the calculator's brain — fast, and
  // its outputs are easy to read). Each rising edge advances it one microstep; the pc / accumulator / result
  // are painted onto three on-canvas seven-segment readouts (their input sources rewritten, exactly the
  // pressCalcKey protocol), so the display re-solves and lights. No code sequences it — the gate T-state
  // counter + gate-decoded control do, on the persistent flip-flop memory (logicStateRef).
  const READOUTS = useMemo(
    () => [
      { key: 'res', port: 'out', label: 'RESULT' },
      { key: 'acc', port: 'accv', label: 'ACC' },
      { key: 'pc', port: 'pcv', label: 'PC' },
    ],
    [],
  )
  const vcpuCompiledRef = useRef<CompiledLogic | null>(null)
  const vcpuRunRef = useRef<number | null>(null)
  const vcpuSolve = useCallback((clk: boolean, rst: boolean): LogicResult | null => {
    if (vcpuCompiledRef.current === null) {
      const block = buildDemoCpu('vh')
      if (block === null) return null
      const e = (id: string, s: string, sh: string, t: string, th: string) => ({
        id,
        source: s,
        sourceHandle: sh,
        target: t,
        targetHandle: th,
      })
      const hn = [
        { id: 'vh', data: { definition: 'block', block } },
        { id: 'h_vp', data: { definition: 'power_source', parameters: dcSource(5) } },
        { id: 'h_g', data: { definition: 'ground' } },
        { id: 'h_clk', data: { definition: 'power_source', parameters: dcSource(0) } },
        { id: 'h_rst', data: { definition: 'power_source', parameters: dcSource(0) } },
      ]
      const he = [
        e('e_vp', 'h_vp', 'terminal_positive', 'vh', 'v_dd'),
        e('e_g', 'vh', 'gnd', 'h_g', 'reference_terminal'),
        e('e_clk', 'h_clk', 'terminal_positive', 'vh', 'clk'),
        e('e_rst', 'h_rst', 'terminal_positive', 'vh', 'rst'),
        e('e_vpn', 'h_vp', 'terminal_negative', 'h_g', 'reference_terminal'),
        e('e_clkn', 'h_clk', 'terminal_negative', 'h_g', 'reference_terminal'),
        e('e_rstn', 'h_rst', 'terminal_negative', 'h_g', 'reference_terminal'),
      ]
      vcpuCompiledRef.current = compileLogic(
        hn as unknown as BlockNodeLike[],
        he as unknown as BlockEdgeLike[],
      )
    }
    const overrides = new Map<string, boolean>([
      ['h_clk', clk],
      ['h_rst', rst],
    ])
    return stepLogic(vcpuCompiledRef.current, overrides, logicStateRef.current)
  }, [])
  // Paint the three readout digits from a {res, acc, pc} snapshot: rewrite each decoder's four input sources,
  // and the always-on solver re-lights the seven-segment faces (the readout circuits have no flip-flops, so a
  // single re-solve suffices — no low/high edge needed on the display side).
  const paintVcpu = useCallback(
    (vals: { res: number; acc: number; pc: number }) => {
      setNodes((cur) =>
        cur.map((n) => {
          const m = /^vc_src_(res|acc|pc)_(\d)$/.exec(n.id)
          if (m === null) return n
          const val = m[1] === 'res' ? vals.res : m[1] === 'acc' ? vals.acc : vals.pc
          const hi = ((val >> Number(m[2])) & 1) === 1
          return { ...n, data: { ...n.data, parameters: dcSource(hi ? 5 : 0) } }
        }),
      )
    },
    [setNodes],
  )
  // One microstep: a rising clock edge (clk low so the master latches, then clk high so the slave commits),
  // then paint the new pc / acc / result. Returns the snapshot (halted tells the run loop when to stop).
  const stepVcpu = useCallback(() => {
    vcpuSolve(false, false)
    const r = vcpuSolve(true, false)
    if (r === null) return null
    const snap = {
      res: vcpuRead4(r, 'out'),
      acc: vcpuRead4(r, 'accv'),
      pc: vcpuRead4(r, 'pcv'),
      halted: r.value('vh', 'halted') === true,
    }
    paintVcpu(snap)
    return snap
  }, [vcpuSolve, paintVcpu])
  const stopVcpu = useCallback(() => {
    if (vcpuRunRef.current !== null) {
      window.clearInterval(vcpuRunRef.current)
      vcpuRunRef.current = null
    }
  }, [])
  const runVcpu = useCallback(() => {
    stopVcpu()
    vcpuRunRef.current = window.setInterval(() => {
      const snap = stepVcpu()
      if (snap === null || snap.halted) stopVcpu()
    }, 220)
  }, [stepVcpu, stopVcpu])
  // Reset = power-on: clear the flip-flop memory (all registers → 0, exactly the machine's reset state) and
  // blank the readouts, ready to run the program again from the top.
  const resetVcpu = useCallback(() => {
    stopVcpu()
    logicStateRef.current = new Map<string, boolean>()
    vcpuCompiledRef.current = null
    paintVcpu({ res: 0, acc: 0, pc: 0 })
  }, [stopVcpu, paintVcpu])

  // The Verilog IDE's "Synthesize → canvas": drop the freshly-synthesized module onto the sheet as ONE
  // descend-able circuit block (its real gates + flip-flops inside), the same shape a .v file import lands as.
  // Placed at the middle of the current view, appended (not replacing) so it joins whatever is already drawn.
  const synthesizeVerilogToCanvas = useCallback(
    (block: BlockData, moduleName: string) => {
      checkpointAction('synthesize verilog')
      dropCount.current += 1
      const safe = moduleName.replace(/[^A-Za-z0-9_]/g, '_') || 'verilog'
      const clone = cloneBlockData(block, String(dropCount.current))
      const position = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })
      setNodes((current) =>
        current.concat({
          id: `${safe}_${dropCount.current}`,
          type: 'block',
          position,
          data: { definition: 'block', label: clone.name, block: clone },
        }),
      )
    },
    [checkpointAction, screenToFlowPosition, setNodes],
  )

  const placeVerilogCpuDemo = useCallback(() => {
    const decoder = BUILTIN_BLOCKS.logic_decoder_7seg
    const display = BUILTIN_BLOCKS.display_seven_segment
    if (!decoder || !display) return
    checkpointAction('verilog cpu')
    logicStateRef.current = new Map<string, boolean>() // power-on
    vcpuCompiledRef.current = null // fresh harness for this placement
    const nodes: Record<string, unknown>[] = [
      {
        id: 'vc_vp',
        type: 'device',
        position: { x: -360, y: 1240 },
        data: { definition: 'power_source', label: 'V+', parameters: dcSource(5) },
      },
      {
        id: 'vc_g',
        type: 'device',
        position: { x: -240, y: 1240 },
        data: { definition: 'ground', label: 'GND' },
      },
    ]
    const edges: Record<string, unknown>[] = [
      {
        id: 'vc_vpn',
        type: 'net',
        source: 'vc_vp',
        sourceHandle: 'terminal_negative',
        target: 'vc_g',
        targetHandle: 'reference_terminal',
      },
    ]
    READOUTS.forEach((ro, idx) => {
      const cx = idx * 360
      nodes.push({
        id: `vc_disp_${ro.key}`,
        type: 'block',
        position: { x: cx, y: 60 },
        data: { definition: 'display_seven_segment', label: ro.label, block: display },
      })
      nodes.push({
        id: `vc_dec_${ro.key}`,
        type: 'block',
        position: { x: cx, y: 560 },
        data: { definition: 'block', label: ro.label, block: decoder, fidelity: 'logic' },
      })
      for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
        edges.push({
          id: `vc_sg_${ro.key}_${s}`,
          type: 'net',
          source: `vc_dec_${ro.key}`,
          sourceHandle: `seg_${s}`,
          target: `vc_disp_${ro.key}`,
          targetHandle: `seg_${s}`,
        })
      }
      edges.push({
        id: `vc_decvp_${ro.key}`,
        type: 'net',
        source: 'vc_vp',
        sourceHandle: 'terminal_positive',
        target: `vc_dec_${ro.key}`,
        targetHandle: 'v_dd',
      })
      edges.push({
        id: `vc_decg_${ro.key}`,
        type: 'net',
        source: `vc_dec_${ro.key}`,
        sourceHandle: 'gnd',
        target: 'vc_g',
        targetHandle: 'reference_terminal',
      })
      edges.push({
        id: `vc_dispc_${ro.key}`,
        type: 'net',
        source: `vc_disp_${ro.key}`,
        sourceHandle: 'common',
        target: 'vc_g',
        targetHandle: 'reference_terminal',
      })
      for (let i = 0; i < 4; i++) {
        nodes.push({
          id: `vc_src_${ro.key}_${i}`,
          type: 'device',
          position: { x: cx, y: 1080 + i * 90 },
          data: { definition: 'power_source', label: '', parameters: dcSource(0) },
        })
        edges.push({
          id: `vc_srce_${ro.key}_${i}`,
          type: 'net',
          source: `vc_src_${ro.key}_${i}`,
          sourceHandle: 'terminal_positive',
          target: `vc_dec_${ro.key}`,
          targetHandle: `d${i}`,
        })
        edges.push({
          id: `vc_srcg_${ro.key}_${i}`,
          type: 'net',
          source: `vc_src_${ro.key}_${i}`,
          sourceHandle: 'terminal_negative',
          target: 'vc_g',
          targetHandle: 'reference_terminal',
        })
      }
    })
    const controls: { action: string; label: string }[] = [
      { action: 'run', label: '▶ Run' },
      { action: 'step', label: '⏭ Step' },
      { action: 'reset', label: '⟲ Reset' },
    ]
    controls.forEach((c, i) => {
      nodes.push({
        id: `vc_ctrl_${c.action}`,
        type: 'keycap',
        draggable: false,
        position: { x: i * 150, y: -180 },
        data: { definition: 'keycap', label: c.label, demoAction: c.action },
      })
    })
    setNodes(() => nodes as unknown as Node[])
    setEdges(() => edges as unknown as Edge[])
    setAutoRouteWires(true)
    reSolve(nodes as unknown as Node[], edges as unknown as Edge[])
    paintVcpu({ res: 0, acc: 0, pc: 0 })
  }, [setNodes, setEdges, checkpointAction, reSolve, READOUTS, paintVcpu])

  // ── The 8-bit Verilog-CPU demo — bigger datapath, a hardware MULTIPLY, and a DECIMAL result readout ────
  // The 8-bit CPU (verilog-cpu-demo.ts) uses the increment-6 operators as real hardware (× in one instruction).
  // Its 8-bit output can't show on one hex digit, so the harness also holds the binary→BCD converter
  // (bin2bcd.ts, real gates): the CPU's out feeds it, and its three decimal digits drive three seven-segment
  // readouts as "120". This CPU is ~12k gates, so each solve is heavier than the 4-bit one — the run interval
  // is slower to match.
  const vcpu8CompiledRef = useRef<CompiledLogic | null>(null)
  const vcpu8Solve = useCallback((clk: boolean, rst: boolean): LogicResult | null => {
    if (vcpu8CompiledRef.current === null) {
      const cpu = buildDemoCpu8('vh8')
      const bcd = binaryToBcd8('b2b')
      if (cpu === null || bcd === null) return null
      const e = (id: string, s: string, sh: string, t: string, th: string) => ({
        id,
        source: s,
        sourceHandle: sh,
        target: t,
        targetHandle: th,
      })
      const hn = [
        { id: 'vh8', data: { definition: 'block', block: cpu } },
        { id: 'b2b', data: { definition: 'block', block: bcd } },
        { id: 'h8_vp', data: { definition: 'power_source', parameters: dcSource(5) } },
        { id: 'h8_g', data: { definition: 'ground' } },
        { id: 'h8_clk', data: { definition: 'power_source', parameters: dcSource(0) } },
        { id: 'h8_rst', data: { definition: 'power_source', parameters: dcSource(0) } },
      ]
      const he = [
        e('e8_vp', 'h8_vp', 'terminal_positive', 'vh8', 'v_dd'),
        e('e8_g', 'vh8', 'gnd', 'h8_g', 'reference_terminal'),
        e('e8_clk', 'h8_clk', 'terminal_positive', 'vh8', 'clk'),
        e('e8_rst', 'h8_rst', 'terminal_positive', 'vh8', 'rst'),
        e('e8_bvp', 'h8_vp', 'terminal_positive', 'b2b', 'v_dd'),
        e('e8_bg', 'b2b', 'gnd', 'h8_g', 'reference_terminal'),
        e('e8_vpn', 'h8_vp', 'terminal_negative', 'h8_g', 'reference_terminal'),
        e('e8_clkn', 'h8_clk', 'terminal_negative', 'h8_g', 'reference_terminal'),
        e('e8_rstn', 'h8_rst', 'terminal_negative', 'h8_g', 'reference_terminal'),
      ]
      for (let i = 0; i < 8; i++) he.push(e(`e8_ob${i}`, 'vh8', `out[${i}]`, 'b2b', `b[${i}]`))
      vcpu8CompiledRef.current = compileLogic(
        hn as unknown as BlockNodeLike[],
        he as unknown as BlockEdgeLike[],
      )
    }
    const overrides = new Map<string, boolean>([
      ['h8_clk', clk],
      ['h8_rst', rst],
    ])
    return stepLogic(vcpu8CompiledRef.current, overrides, logicStateRef.current)
  }, [])
  const paintVcpu8 = useCallback(
    (vals: { h: number; t: number; o: number; pc: number }) => {
      setNodes((cur) =>
        cur.map((n) => {
          const m = /^vc8_src_(h|t|o|pc)_(\d)$/.exec(n.id)
          if (m === null) return n
          const val =
            m[1] === 'h' ? vals.h : m[1] === 't' ? vals.t : m[1] === 'o' ? vals.o : vals.pc
          const hi = ((val >> Number(m[2])) & 1) === 1
          return { ...n, data: { ...n.data, parameters: dcSource(hi ? 5 : 0) } }
        }),
      )
    },
    [setNodes],
  )
  const stepVcpu8 = useCallback(() => {
    vcpu8Solve(false, false)
    const r = vcpu8Solve(true, false)
    if (r === null) return null
    const snap = {
      h: read4At(r, 'b2b', 'hundreds'),
      t: read4At(r, 'b2b', 'tens'),
      o: read4At(r, 'b2b', 'ones'),
      pc: read4At(r, 'vh8', 'pcv'),
      halted: r.value('vh8', 'halted') === true,
    }
    paintVcpu8({ h: snap.h, t: snap.t, o: snap.o, pc: snap.pc })
    return { ...snap, out: snap.h * 100 + snap.t * 10 + snap.o }
  }, [vcpu8Solve, paintVcpu8])
  const runVcpu8 = useCallback(() => {
    stopVcpu()
    vcpuRunRef.current = window.setInterval(() => {
      const snap = stepVcpu8()
      if (snap === null || snap.halted) stopVcpu()
    }, 450) // slower interval — the 8-bit CPU's solve is ~6× heavier than the 4-bit's
  }, [stepVcpu8, stopVcpu])
  const resetVcpu8 = useCallback(() => {
    stopVcpu()
    logicStateRef.current = new Map<string, boolean>()
    vcpu8CompiledRef.current = null
    paintVcpu8({ h: 0, t: 0, o: 0, pc: 0 })
  }, [stopVcpu, paintVcpu8])

  const placeVerilogCpu8Demo = useCallback(() => {
    const decoder = BUILTIN_BLOCKS.logic_decoder_7seg
    const display = BUILTIN_BLOCKS.display_seven_segment
    if (!decoder || !display) return
    checkpointAction('verilog cpu (8-bit)')
    logicStateRef.current = new Map<string, boolean>()
    vcpu8CompiledRef.current = null
    const nodes: Record<string, unknown>[] = [
      {
        id: 'vc8_vp',
        type: 'device',
        position: { x: -360, y: 1240 },
        data: { definition: 'power_source', label: 'V+', parameters: dcSource(5) },
      },
      {
        id: 'vc8_g',
        type: 'device',
        position: { x: -240, y: 1240 },
        data: { definition: 'ground', label: 'GND' },
      },
    ]
    const edges: Record<string, unknown>[] = [
      {
        id: 'vc8_vpn',
        type: 'net',
        source: 'vc8_vp',
        sourceHandle: 'terminal_negative',
        target: 'vc8_g',
        targetHandle: 'reference_terminal',
      },
    ]
    // three decimal digits (hundreds/tens/ones) for the RESULT, then the program counter in hex
    const readouts: { key: string; label: string }[] = [
      { key: 'h', label: '100s' },
      { key: 't', label: '10s' },
      { key: 'o', label: '1s' },
      { key: 'pc', label: 'PC' },
    ]
    readouts.forEach((ro, idx) => {
      const cx = idx * 360
      nodes.push({
        id: `vc8_disp_${ro.key}`,
        type: 'block',
        position: { x: cx, y: 60 },
        data: { definition: 'display_seven_segment', label: ro.label, block: display },
      })
      nodes.push({
        id: `vc8_dec_${ro.key}`,
        type: 'block',
        position: { x: cx, y: 560 },
        data: { definition: 'block', label: ro.label, block: decoder, fidelity: 'logic' },
      })
      for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
        edges.push({
          id: `vc8_sg_${ro.key}_${s}`,
          type: 'net',
          source: `vc8_dec_${ro.key}`,
          sourceHandle: `seg_${s}`,
          target: `vc8_disp_${ro.key}`,
          targetHandle: `seg_${s}`,
        })
      }
      edges.push({
        id: `vc8_decvp_${ro.key}`,
        type: 'net',
        source: 'vc8_vp',
        sourceHandle: 'terminal_positive',
        target: `vc8_dec_${ro.key}`,
        targetHandle: 'v_dd',
      })
      edges.push({
        id: `vc8_decg_${ro.key}`,
        type: 'net',
        source: `vc8_dec_${ro.key}`,
        sourceHandle: 'gnd',
        target: 'vc8_g',
        targetHandle: 'reference_terminal',
      })
      edges.push({
        id: `vc8_dispc_${ro.key}`,
        type: 'net',
        source: `vc8_disp_${ro.key}`,
        sourceHandle: 'common',
        target: 'vc8_g',
        targetHandle: 'reference_terminal',
      })
      for (let i = 0; i < 4; i++) {
        nodes.push({
          id: `vc8_src_${ro.key}_${i}`,
          type: 'device',
          position: { x: cx, y: 1080 + i * 90 },
          data: { definition: 'power_source', label: '', parameters: dcSource(0) },
        })
        edges.push({
          id: `vc8_srce_${ro.key}_${i}`,
          type: 'net',
          source: `vc8_src_${ro.key}_${i}`,
          sourceHandle: 'terminal_positive',
          target: `vc8_dec_${ro.key}`,
          targetHandle: `d${i}`,
        })
        edges.push({
          id: `vc8_srcg_${ro.key}_${i}`,
          type: 'net',
          source: `vc8_src_${ro.key}_${i}`,
          sourceHandle: 'terminal_negative',
          target: 'vc8_g',
          targetHandle: 'reference_terminal',
        })
      }
    })
    const controls: { action: string; label: string }[] = [
      { action: 'run8', label: '▶ Run' },
      { action: 'step8', label: '⏭ Step' },
      { action: 'reset8', label: '⟲ Reset' },
    ]
    controls.forEach((c, i) => {
      nodes.push({
        id: `vc8_ctrl_${c.action}`,
        type: 'keycap',
        draggable: false,
        position: { x: i * 150, y: -180 },
        data: { definition: 'keycap', label: c.label, demoAction: c.action },
      })
    })
    setNodes(() => nodes as unknown as Node[])
    setEdges(() => edges as unknown as Edge[])
    setAutoRouteWires(true)
    reSolve(nodes as unknown as Node[], edges as unknown as Edge[])
    paintVcpu8({ h: 0, t: 0, o: 0, pc: 0 })
  }, [setNodes, setEdges, checkpointAction, reSolve, paintVcpu8])

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
      // The Verilog CPU demo lays out the readouts + Run/Step/Reset controls for a Verilog-synthesized CPU.
      if (definition === 'verilog_cpu') {
        placeVerilogCpuDemo()
        return
      }
      if (definition === 'verilog_cpu8') {
        placeVerilogCpu8Demo()
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
    [
      screenToFlowPosition,
      setNodes,
      nodes,
      checkpointAction,
      snapToGrid,
      placeCalculator,
      placeVerilogCpuDemo,
      placeVerilogCpu8Demo,
    ],
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
  // DEV guard; nodesRef/handlers are stable, so the surface is attached once and reads live state — the
  // pcbAddTrace/pcbAddVia count returns (userTraces/userVias.length) are a DEV convenience, not relied on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attaches once by design; see comment above.
  useEffect(() => {
    if (!import.meta.env.DEV || !active) return // only the active tab owns the single window.__chip slot
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
      // DEV: place the Verilog-CPU demo and run it to completion on the real gate harness, returning the final
      // pc / accumulator / result the on-canvas readouts show. Proves the whole path in the real app — a CPU
      // synthesized from Verilog, clocked on real flip-flops, computing its answer.
      verilogCpu(maxTicks = 250) {
        placeVerilogCpuDemo()
        let snap: { res: number; acc: number; pc: number; halted: boolean } | null = null
        let ticks = 0
        for (let i = 0; i < maxTicks; i++) {
          snap = stepVcpu()
          ticks = i + 1
          if (snap === null || snap.halted) break
        }
        return { ...snap, ticks }
      },
      // DEV: the 8-bit CPU demo — hardware multiply, run to halt, decimal result read off the BCD converter.
      verilogCpu8(maxTicks = 60) {
        placeVerilogCpu8Demo()
        let snap: {
          h: number
          t: number
          o: number
          pc: number
          halted: boolean
          out: number
        } | null = null
        let ticks = 0
        for (let i = 0; i < maxTicks; i++) {
          snap = stepVcpu8()
          ticks = i + 1
          if (snap === null || snap.halted) break
        }
        return { ...snap, ticks }
      },
      // DEV: place the Verilog-synthesized CPU as a BLOCK on the canvas (not the harness demo) and switch to
      // the Chip level, so the standard-cell area + timing sign-off flatten the real gates — the RTL→silicon
      // translation. Returns nothing readable synchronously; read the Chip panel DOM after.
      chipCpu() {
        checkpointAction('dev: chip cpu')
        const cpu = buildDemoCpu('chipcpu')
        if (cpu === null) return 'build failed'
        const e = (id: string, s: string, sh: string, t: string, th: string) => ({
          id,
          type: 'net',
          source: s,
          sourceHandle: sh,
          target: t,
          targetHandle: th,
        })
        const nodes = [
          {
            id: 'cc_cpu',
            type: 'block',
            position: { x: 0, y: 0 },
            data: { definition: 'block', label: 'CPU (Verilog)', block: cpu, fidelity: 'logic' },
          },
          {
            id: 'cc_vp',
            type: 'device',
            position: { x: -520, y: 0 },
            data: { definition: 'power_source', label: 'V+', parameters: dcSource(5) },
          },
          {
            id: 'cc_g',
            type: 'device',
            position: { x: -520, y: 200 },
            data: { definition: 'ground', label: 'GND' },
          },
          {
            id: 'cc_clk',
            type: 'device',
            position: { x: -520, y: 400 },
            data: { definition: 'power_source', label: 'CLK', parameters: dcSource(0) },
          },
        ]
        const edges = [
          e('cc_e1', 'cc_vp', 'terminal_positive', 'cc_cpu', 'v_dd'),
          e('cc_e2', 'cc_cpu', 'gnd', 'cc_g', 'reference_terminal'),
          e('cc_e3', 'cc_clk', 'terminal_positive', 'cc_cpu', 'clk'),
          e('cc_e4', 'cc_cpu', 'rst', 'cc_g', 'reference_terminal'),
          e('cc_e5', 'cc_vp', 'terminal_negative', 'cc_g', 'reference_terminal'),
          e('cc_e6', 'cc_clk', 'terminal_negative', 'cc_g', 'reference_terminal'),
        ]
        setNodes(() => nodes as unknown as Node[])
        setEdges(() => edges as unknown as Edge[])
        reSolve(nodes as unknown as Node[], edges as unknown as Edge[])
        setWorkspaceMode('chip')
        return 'placed the Verilog CPU at the Chip level'
      },
      // DEV: open the Verilog IDE, and (if given text) exercise its Synthesize→canvas path headlessly —
      // returns the live synthesis diagnostics (cells built + what won't build) the editor would show.
      verilogIde(text?: string) {
        setVerilogOpen(true)
        if (typeof text !== 'string') return { opened: true }
        const { circuit, warnings } = parseVerilogText(text)
        const block = circuit.nodes[0]?.block ?? null
        if (block) synthesizeVerilogToCanvas(block, block.name)
        return {
          opened: true,
          synthesized: block !== null,
          gateCount: block?.nodes.length ?? 0,
          warnings,
        }
      },
      // DEV: run the run-trace engine on a Verilog module and return the anomalies + per-cycle output values,
      // so the whole trace path can be verified headlessly in the real app.
      traceVerilog(text: string, cycles = 8, inputs?: Record<string, number>) {
        const block = parseVerilogText(text).circuit.nodes[0]?.block ?? null
        if (!block) return { ok: false as const, error: 'did not synthesize' }
        const r = runTrace(block, cycles, new Map(Object.entries(inputs ?? {})))
        if (!r) return { ok: false as const, error: 'no drivable I/O' }
        return {
          ok: true as const,
          clocked: r.clocked,
          registerCount: r.registerCount,
          outputs: r.outputs.map((o) => o.name),
          anomalies: r.anomalies.map((a) => ({ kind: a.kind, cycle: a.cycle, signal: a.signal })),
          cycles: r.cycles.map((c) => ({
            cycle: c.cycle,
            settled: c.settled,
            sweeps: c.sweeps,
            values: Object.fromEntries(c.values),
          })),
        }
      },
      // DEV: place a battery + 100Ω/0.25W resistor + ground, open the stress bench, and sweep the supply —
      // proves the whole stress path in the real app (the resistor overpowers above ~5 V).
      stressDemo() {
        const sc = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
        const nn = [
          {
            id: 'sd_bat',
            type: 'device',
            position: { x: -220, y: 0 },
            data: {
              definition: 'power_source',
              label: 'V+',
              parameters: { nominal_voltage: sc(1, 'volt'), internal_resistance: sc(1, 'ohm') },
            },
          },
          {
            id: 'sd_r',
            type: 'device',
            position: { x: 40, y: 0 },
            data: {
              definition: 'resistor',
              label: 'R1',
              parameters: { resistance: sc(100, 'ohm'), power_rating: sc(0.25, 'watt') },
            },
          },
          {
            id: 'sd_g',
            type: 'device',
            position: { x: -220, y: 180 },
            data: { definition: 'ground', label: 'GND' },
          },
        ] as unknown as Node[]
        const ee = [
          {
            id: 'sd_e1',
            source: 'sd_bat',
            sourceHandle: 'terminal_positive',
            target: 'sd_r',
            targetHandle: 'terminal_a',
          },
          {
            id: 'sd_e2',
            source: 'sd_r',
            sourceHandle: 'terminal_b',
            target: 'sd_bat',
            targetHandle: 'terminal_negative',
          },
          {
            id: 'sd_e3',
            source: 'sd_g',
            sourceHandle: 'reference_terminal',
            target: 'sd_bat',
            targetHandle: 'terminal_negative',
          },
        ] as unknown as Edge[]
        setNodes(() => nn)
        setEdges(() => ee)
        setStressOpen(true)
        const r = runStressSweep(
          nn,
          ee,
          { kind: 'param', targets: [{ nodeId: 'sd_bat', param: 'nominal_voltage' }] },
          1,
          20,
          20,
          25,
        )
        return {
          totalParts: r.totalParts,
          noFailure: r.noFailure,
          safeWindow: r.safeWindow,
          failingParts: r.failingParts.map((p) => ({
            partId: p.partId,
            firstFailValue: p.firstFailValue,
            worstCode: p.worstCode,
            safeFrom: p.safeFrom,
            safeTo: p.safeTo,
          })),
        }
      },
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
          parts.map((p) => {
            // A definition that names a built-in block stages as a real block node (flattens to its
            // inner parts through the same path a palette drop takes); otherwise a plain device.
            const builtin = BUILTIN_BLOCKS[p.definition]
            if (builtin) {
              return {
                id: p.id,
                type: 'block',
                position: { x: p.x, y: p.y },
                data: {
                  definition: 'block',
                  label: builtin.name,
                  block: cloneBlockData(builtin, p.id),
                },
              } as Node
            }
            return {
              id: p.id,
              type: 'device',
              position: { x: p.x, y: p.y },
              data: {
                definition: p.definition,
                label: p.id,
                parameters: { ...defaultParameters(p.definition), ...(p.parameters ?? {}) },
              },
            } as Node
          }),
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
      pcbAddTrace(net: string, layer: CopperLayer, points: { x: number; y: number }[]) {
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
    active,
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

  // Pick a part's board PACKAGE (footprint) → stored on the node so it saves + undoes with the part;
  // the board re-derives (new placement/pads) but the schematic solve is unaffected (same electrical part).
  const onEditFootprint = useCallback(
    (nodeId: string, footprintId: string) => {
      checkpointAction(`footprint:${nodeId}`)
      setNodes((current) =>
        current.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, footprintId } } : n)),
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
        ...((selectedNode.data as DeviceNodeData).footprintId
          ? { footprintId: (selectedNode.data as DeviceNodeData).footprintId }
          : {}),
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
        width: '100%',
        height: '100%',
        background: light ? THEME.textBright : THEME.surfaceDeep,
        overflow: 'hidden',
        display: 'grid',
        // Dock-grid: top/bottom bars span all columns; left/right panels fill the
        // middle row; the canvas takes the center cell. Empty edges collapse, so
        // docked panels never overlap and everything adjusts around them.
        gridTemplateRows: 'auto auto minmax(0, 1fr) auto',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gridTemplateAreas:
          '"crumb crumb crumb" "top top top" "left center right" "bottom bottom bottom"',
      }}
      onDragOver={(event) => {
        // Dropping a palette part only makes sense on the schematic — gate it off under the Board /
        // Chip overlay so a drop there can't silently add a part to the hidden circuit underneath.
        if (workspaceMode !== 'schematic') return
        onDragOver(event)
      }}
      onDrop={(event) => {
        if (workspaceMode !== 'schematic') return
        onDrop(event)
      }}
    >
      <div style={{ gridArea: 'crumb' }}>
        <LevelBreadcrumb mode={workspaceMode} onMode={setWorkspaceMode} light={light} />
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: this wrapper only ROUTES capture-phase clicks to the active tool (lasso guard, scope probes, meter probes, wire clicks); the real interactive targets are the terminal handles and buttons inside */}
      <div
        data-workspace-mode={workspaceMode}
        onClickCapture={(event) => {
          // The board workspace owns the main area — schematic tool dispatch is inert under it.
          if (workspaceMode !== 'schematic') return
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
          if (onReflectionProbeClick(event)) return
          if (onDistortionProbeClick(event)) return
          if (onScopeProbeClick(event)) return
          onMeterClick(event)
          wire.onWireClick(event)
          connect.onConnectClick(event)
        }}
        onDoubleClickCapture={(event) => {
          if (workspaceMode !== 'schematic') return
          wire.onWireDoubleClick(event)
        }}
        onMouseMove={(event) => {
          if (workspaceMode !== 'schematic') return
          lastCursorFlow.current = screenToFlowPosition({ x: event.clientX, y: event.clientY })
          wire.onWireMove(event)
        }}
        onPointerDown={(event) => {
          if (workspaceMode !== 'schematic') return
          onLassoDown(event)
          onBoxDown(event)
        }}
        onPointerMove={(event) => {
          if (workspaceMode !== 'schematic') return
          onLassoMove(event)
          onBoxMove(event)
        }}
        onPointerUp={() => {
          if (workspaceMode !== 'schematic') return
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
        {/* The CHIP WORKSPACE — the design projected one layer further down, into silicon. Same overlay
            pattern as the board: an opaque surface over the still-mounted schematic, whose pointer
            handlers are gated off (workspaceMode !== 'schematic') so they don't fire underneath. */}
        {workspaceMode === 'chip' && (
          <ChipView
            nodes={nodes as unknown as BlockNodeLike[]}
            edges={edges as unknown as BlockEdgeLike[]}
            timing={chipTiming}
            floorplan={chipFloorplan?.plan ?? null}
            overrides={chipLayout.overrides}
            lens={chipLayout.lens ?? 'module'}
            onLens={(mode) => setChipLayout((current) => ({ ...current, lens: mode }))}
            drift={chipDrift}
            onReplace={onChipReplace}
            onMoveCell={onChipCellMove}
            light={light}
          />
        )}
        {/* The BOARD WORKSPACE — the physical board as a full-size editing surface filling the main
            area, layered opaquely over the schematic (which stays mounted, its state intact). It stays
            MOUNTED and is shown/hidden via `display`, so switching levels never unmounts + re-derives +
            re-fits it (the 3D camera + view mode persist; the board views have no animation loop, so a
            hidden board costs nothing). The ancestor's schematic pointer handlers are gated on schematic
            mode so they don't fire under the board. The dock PCB panel still works independently. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 40,
            background: THEME.surfaceBase,
            display: workspaceMode === 'board' ? 'flex' : 'none',
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
              {pcbOverCurrentUnevaluated && (
                <span
                  style={{ color: THEME.statusWarn }}
                  title="This board's currents weren't solved (a digital / logic board), so trace over-current couldn't be checked."
                >
                  {' '}
                  · over-current not checked
                </span>
              )}
            </span>
            <PcbViewControls
              mode={pcbViewMode}
              onMode={setPcbViewMode}
              layers={pcbLayers}
              activeLayerIndex={pcbActiveLayerIndex}
              onStep={stepPcbLayer}
            />
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={() => setBoardTool((t) => (t === 'route' ? 'select' : 'route'))}
                title="Route tool — click a pad to start, click to drop corners, click a same-net pad to finish. Draws real copper on the active layer that ships in the Gerbers. Works on the flat board AND directly in the 3-D view (click to route, drag to orbit)."
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
              <button
                type="button"
                onClick={() => setBoardTool((t) => (t === 'measure' ? 'select' : 'measure'))}
                title="Measure tool — a dimensional ruler. Click two points on the board to measure the distance between them (mm / cm / in / mil / µm); clicks snap to pad centres. Distinct from the multimeter, which measures electrical quantities."
                style={{
                  border: `1px solid ${THEME.borderStrong}`,
                  background: boardTool === 'measure' ? THEME.accentBlue : THEME.surfaceInput,
                  color: boardTool === 'measure' ? '#0b1220' : THEME.textSoft,
                  borderRadius: 4,
                  fontSize: 11,
                  padding: '2px 10px',
                  cursor: 'pointer',
                }}
              >
                📏 Measure
              </button>
              {boardTool === 'measure' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <select
                    value={measureUnit}
                    onChange={(e) => setMeasureUnit(e.target.value as MeasureUnit)}
                    title="Measurement unit"
                    style={{
                      background: THEME.surfaceInput,
                      color: THEME.textSoft,
                      border: `1px solid ${THEME.borderStrong}`,
                      borderRadius: 4,
                      fontSize: 11,
                      padding: '1px 4px',
                    }}
                  >
                    {MEASURE_UNITS.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                  {measurements.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setMeasurements([])
                        setPendingMeasureA(null)
                      }}
                      title="Clear all measurements"
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
                      Clear ({measurements.length})
                    </button>
                  )}
                </span>
              )}
              {boardTool === 'route' &&
                (() => {
                  const copperSheets = pcbLayers.filter((l) => l.kind === 'copper')
                  return (
                    <span style={{ display: 'flex', gap: 0 }}>
                      {copperSheets.map((l, i) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => setPcbActiveLayerId(l.id)}
                          title={`Route on ${l.name}${l.id === 'f_cu' || l.id === 'b_cu' ? '' : ' (buried inner layer)'}`}
                          style={{
                            border: `1px solid ${THEME.borderStrong}`,
                            background: pcbActiveLayerId === l.id ? l.color : THEME.surfaceInput,
                            color: pcbActiveLayerId === l.id ? '#0b1220' : THEME.textSoft,
                            borderRadius:
                              i === 0
                                ? '4px 0 0 4px'
                                : i === copperSheets.length - 1
                                  ? '0 4px 4px 0'
                                  : '0',
                            borderLeft: i === 0 ? undefined : 'none',
                            fontSize: 11,
                            padding: '2px 8px',
                            cursor: 'pointer',
                          }}
                        >
                          {l.id === 'f_cu'
                            ? 'Top'
                            : l.id === 'b_cu'
                              ? 'Bottom'
                              : l.name.replace('.Cu', '')}
                        </button>
                      ))}
                    </span>
                  )
                })()}
            </span>
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
                coordinateGrid
                recesses={boardRecesses}
                onMove={onPcbMove}
                onMoveStart={onPcbMoveStart}
                onRotate={onPcbRotate}
                route={{
                  active: boardTool === 'route',
                  layer: activeCopperLayer,
                  padBoxes: pcbRatsnest.padBoxes,
                  onClick: onBoardRouteClick,
                  onMove: onBoardRouteMove,
                  viaActive: boardTool === 'via',
                  onViaClick: onBoardViaClick,
                  cursor: routeCursor,
                  color: pcbLayers.find((l) => l.id === pcbActiveLayerId)?.color ?? '#ffcf6b',
                  ...(pendingRoute ? { pendingPoints: pendingRoute.points } : {}),
                }}
                measure={{
                  active: boardTool === 'measure',
                  unit: measureUnit,
                  measurements,
                  pendingA: pendingMeasureA,
                  cursor: measureCursor,
                  onClick: onBoardMeasureClick,
                  onMove: onBoardMeasureMove,
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
                                  // A Verilog-CPU demo control (Run / Step / Reset) — a clickable button node.
                                  const demoAction = (node.data as { demoAction?: string })
                                    .demoAction
                                  if (demoAction === 'run') {
                                    runVcpu()
                                    return
                                  }
                                  if (demoAction === 'step') {
                                    stepVcpu()
                                    return
                                  }
                                  if (demoAction === 'reset') {
                                    resetVcpu()
                                    return
                                  }
                                  if (demoAction === 'run8') {
                                    runVcpu8()
                                    return
                                  }
                                  if (demoAction === 'step8') {
                                    stepVcpu8()
                                    return
                                  }
                                  if (demoAction === 'reset8') {
                                    resetVcpu8()
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
        {verilogOpen ? (
          <VerilogEditor
            initialText={verilogText}
            onTextChange={setVerilogText}
            onSynthesize={synthesizeVerilogToCanvas}
            onClose={() => setVerilogOpen(false)}
          />
        ) : null}
        {traceOpen ? (
          <TraceInspector blocks={traceBlocks} onClose={() => setTraceOpen(false)} />
        ) : null}
        {stressOpen ? (
          <StressBench
            nodes={nodes}
            edges={edges}
            baseAmbientC={projectAmbientC}
            onClose={() => setStressOpen(false)}
          />
        ) : null}
        {newPartOpen ? (
          <UserPartEditor
            onClose={() => setNewPartOpen(false)}
            onCreated={(part) => void persistAuthoredPart(part)}
          />
        ) : null}
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
            // Key on the viewed block's node id so switching to a DIFFERENT block remounts a fresh drill
            // trail, while an unrelated re-render (a solve, an undo that deep-clones nodes) keeps the trail.
            key={viewBlockId}
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
                onNewPart={() => setNewPartOpen(true)}
                onScope={runScope}
                onTimeline={() => setTimelineOpen((open) => !open)}
                onMath={() => setShowMath((open) => !open)}
                onBode={() => setBodeOpen((open) => !open)}
                onReflection={() => setReflectionOpen((open) => !open)}
                onDistortion={() => setDistortionOpen((open) => !open)}
                onSParam={() => setSparamOpen((open) => !open)}
                onPcb={() => setPcbOpen((open) => !open)}
                onVerilog={() => setVerilogOpen((open) => !open)}
                onTrace={() => setTraceOpen((open) => !open)}
                onStress={() => setStressOpen((open) => !open)}
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
                onSaveAsPart={(partName) => {
                  // Turn this block's REAL circuit into a reusable custom part (pins = the block's
                  // pins; simulates as the circuit inside), register it, and persist it to the
                  // personal library so it follows the user across projects.
                  const result = userPartFromBlock(partName, 'U', selectedBlock)
                  if (!result.ok) return result.error
                  // Refuse at SAVE time anything the load-time validator would drop (e.g. a block that
                  // arrived malformed from a hand-edited file) — otherwise the part works all session,
                  // persists, then silently vanishes on the next launch.
                  if (validateUserPart(result.part) === null) {
                    return 'This block can’t be saved as a part — its internal circuit didn’t pass validation.'
                  }
                  if (!registerUserPart(result.part)) {
                    return 'That name is a built-in part’s id — pick another.'
                  }
                  void persistAuthoredPart(result.part)
                  return null
                }}
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
                onFootprint={(footprintId) => {
                  if (selectedPart) onEditFootprint(selectedPart.id, footprintId)
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
                // An internal-circuit custom part gets the block's Simulate-as choice: show the
                // module's EFFECTIVE engine (its tag, else the gates-only default) + let the user
                // switch — the same data.fidelity seam blocks use.
                {...(selectedPart &&
                selectedNode &&
                getUserPart(selectedPart.definition)?.internal !== undefined
                  ? {
                      moduleFidelity: (isLogicFidelity(selectedNode) ? 'logic' : 'transistor') as
                        | 'logic'
                        | 'transistor',
                      onModuleFidelity: (f: 'transistor' | 'logic') =>
                        onSetFidelity(selectedPart.id, f),
                    }
                  : {})}
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
                onPickToggle={() => {
                  // Arm Bode's picker and disarm the other canvas pickers — only one at a time, so the
                  // shared click chain can't let one tool steal the other's terminal click.
                  setBodePicking((p) => !p)
                  setReflectionPicking(false)
                  setDistortionPicking(false)
                }}
              />
            ),
          },
          reflection: {
            title: 'Reflection',
            visible: reflectionOpen,
            content: (
              <ReflectionPanel
                world={reflectionWorld}
                temperaturesC={solvedTemperatures}
                light={light}
                onClose={() => {
                  setReflectionOpen(false)
                  setReflectionPicking(false)
                }}
                port={reflectionPort}
                onPort={setReflectionPort}
                picking={reflectionPicking}
                onPickToggle={() => {
                  // Arm Reflection's picker and disarm the others (see the Bode toggle) — mutually exclusive.
                  setReflectionPicking((p) => !p)
                  setBodePicking(false)
                  setDistortionPicking(false)
                }}
              />
            ),
          },
          distortion: {
            title: 'Distortion',
            visible: distortionOpen,
            content: (
              <DistortionPanel
                world={distortionWorld}
                temperaturesC={solvedTemperatures}
                light={light}
                onClose={() => {
                  setDistortionOpen(false)
                  setDistortionPicking(false)
                }}
                source={distortionSource}
                onSource={setDistortionSource}
                outputNet={distortionOutputNet}
                picking={distortionPicking}
                onPickToggle={() => {
                  // Arm Distortion's picker and disarm the others — mutually exclusive across all pickers.
                  setDistortionPicking((p) => !p)
                  setBodePicking(false)
                  setReflectionPicking(false)
                }}
              />
            ),
          },
          sparam: {
            title: 'S-parameters',
            visible: sparamOpen,
            content: (
              <SParamPanel
                world={sparamWorld}
                temperaturesC={solvedTemperatures}
                light={light}
                onClose={() => setSparamOpen(false)}
                port1={sparamPort1}
                onPort1={setSparamPort1}
                port2={sparamPort2}
                onPort2={setSparamPort2}
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
                    {pcbOverCurrentUnevaluated && (
                      <span
                        style={{ color: THEME.statusWarn }}
                        title="This board's currents weren't solved (a digital / logic board, or an unsolved circuit), so trace over-current couldn't be checked. It is NOT reported as clean."
                      >
                        {' '}
                        · over-current not checked (no solved currents)
                      </span>
                    )}
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
                      coordinateGrid
                      recesses={boardRecesses}
                      onMove={onPcbMove}
                      onMoveStart={onPcbMoveStart}
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
                      stack-up:
                      <select
                        value={pcbStackup.copperLayers}
                        onChange={(e) =>
                          setPcbStackupOptions((o) => ({
                            ...o,
                            copperLayers: Number(e.target.value) as CopperLayerCount,
                          }))
                        }
                        title="Copper layer count. 2 = standard board. 4 / 6 = multilevel: inner copper planes buried in the FR4 — pull the layers apart in the 3-D view to see them. (Multilevel is for design + visualisation; export stays 2-layer for now.)"
                        style={{
                          background: THEME.surfaceInput,
                          color: THEME.textSoft,
                          border: `1px solid ${THEME.borderStrong}`,
                          borderRadius: 4,
                          fontSize: 11,
                          padding: '1px 4px',
                        }}
                      >
                        <option value={2}>2-layer</option>
                        <option value={4}>4-layer</option>
                        <option value={6}>6-layer</option>
                      </select>
                      FR4 ·
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
                    {pcbImpedance.z !== undefined && (
                      <span
                        style={{ fontSize: 11, color: THEME.textFaint }}
                        title={`IPC-2141A single-line microstrip: a ${DEFAULT_ROUTE_CLASS.traceWidthMm} mm trace over the ${pcbImpedance.z.referenceLayer} plane, ${pcbImpedance.z.dielectricHeightMm.toFixed(3)} mm of FR4 (Dk ${pcbImpedance.z.dielectricConstant.toFixed(1)}) between them.${pcbImpedance.z.withinValidity ? '' : ' Outside the formula range (w/h) — treat as an estimate.'} A closed-form approximation (~±5%); a fab's field-solver stack-up is authoritative for a manufactured board.`}
                      >
                        impedance:{' '}
                        <span style={{ color: THEME.textSoft }}>
                          {DEFAULT_ROUTE_CLASS.traceWidthMm} mm ≈ {Math.round(pcbImpedance.z.ohms)}{' '}
                          Ω{pcbImpedance.z.withinValidity ? '' : ' (est.)'}
                        </span>{' '}
                        · 50 Ω needs{' '}
                        <span style={{ color: THEME.textSoft }}>
                          {pcbImpedance.widthFor50 !== undefined
                            ? `${pcbImpedance.widthFor50} mm`
                            : 'a thinner dielectric'}
                        </span>
                      </span>
                    )}
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
                      cavity / step:
                      <button
                        type="button"
                        title="Add a recessed cavity — a controlled-depth pocket milled into the board centre. Open the 3-D view to see it."
                        onClick={() => {
                          const o = pcbBoard.outline
                          setBoardRecesses((rs) => [
                            ...rs,
                            {
                              x: o.x + o.w * 0.3,
                              y: o.y + o.h * 0.3,
                              w: o.w * 0.4,
                              h: o.h * 0.4,
                              depthMm: Math.min(
                                pcbStackup.thicknessMm * 0.5,
                                pcbStackup.thicknessMm - 0.1,
                              ),
                              side: 'top',
                            },
                          ])
                        }}
                        style={{
                          border: `1px solid ${THEME.borderStrong}`,
                          background: THEME.surfaceInput,
                          color: THEME.textSoft,
                          borderRadius: 4,
                          fontSize: 11,
                          padding: '1px 6px',
                          cursor: 'pointer',
                        }}
                      >
                        + Cavity
                      </button>
                      <button
                        type="button"
                        title="Add a stepped edge — a recess running to the board edge (a thinner card edge / step)."
                        onClick={() => {
                          const o = pcbBoard.outline
                          setBoardRecesses((rs) => [
                            ...rs,
                            {
                              x: o.x,
                              y: o.y,
                              w: o.w,
                              h: o.h * 0.28,
                              depthMm: Math.min(
                                pcbStackup.thicknessMm * 0.4,
                                pcbStackup.thicknessMm - 0.1,
                              ),
                              side: 'top',
                            },
                          ])
                        }}
                        style={{
                          border: `1px solid ${THEME.borderStrong}`,
                          background: THEME.surfaceInput,
                          color: THEME.textSoft,
                          borderRadius: 4,
                          fontSize: 11,
                          padding: '1px 6px',
                          cursor: 'pointer',
                        }}
                      >
                        + Step
                      </button>
                      {boardRecesses.map((r, i) => {
                        const o = pcbBoard.outline
                        const isStep =
                          r.x <= o.x + 0.01 ||
                          r.y <= o.y + 0.01 ||
                          r.x + r.w >= o.x + o.w - 0.01 ||
                          r.y + r.h >= o.y + o.h - 0.01
                        return (
                          <span
                            key={`recess-${r.side}-${r.x}-${r.y}-${r.w}-${r.h}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                              border: `1px solid ${THEME.borderStrong}`,
                              borderRadius: 4,
                              padding: '1px 4px',
                            }}
                          >
                            {isStep ? 'step' : 'cavity'}
                            <input
                              type="number"
                              value={r.depthMm}
                              min={0.05}
                              max={pcbStackup.thicknessMm - 0.05}
                              step={0.05}
                              title="Milled depth (mm)"
                              onChange={(e) => {
                                const d = Number(e.target.value)
                                setBoardRecesses((rs) =>
                                  rs.map((rr, j) =>
                                    j === i
                                      ? {
                                          ...rr,
                                          depthMm: Math.max(
                                            0.05,
                                            Math.min(d, pcbStackup.thicknessMm - 0.05),
                                          ),
                                        }
                                      : rr,
                                  ),
                                )
                              }}
                              style={{
                                width: 44,
                                background: THEME.surfaceInput,
                                color: THEME.textSoft,
                                border: `1px solid ${THEME.borderStrong}`,
                                borderRadius: 3,
                                fontSize: 11,
                                padding: '1px 2px',
                              }}
                            />
                            mm
                            <select
                              value={r.side}
                              title="Which face is milled"
                              onChange={(e) =>
                                setBoardRecesses((rs) =>
                                  rs.map((rr, j) =>
                                    j === i
                                      ? { ...rr, side: e.target.value as 'top' | 'bottom' }
                                      : rr,
                                  ),
                                )
                              }
                              style={{
                                background: THEME.surfaceInput,
                                color: THEME.textSoft,
                                border: `1px solid ${THEME.borderStrong}`,
                                borderRadius: 3,
                                fontSize: 11,
                                padding: '1px 2px',
                              }}
                            >
                              <option value="top">top</option>
                              <option value="bottom">bottom</option>
                            </select>
                            <button
                              type="button"
                              title="Remove this recess"
                              onClick={() => setBoardRecesses((rs) => rs.filter((_, j) => j !== i))}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: THEME.statusDanger,
                                cursor: 'pointer',
                                fontSize: 13,
                                lineHeight: 1,
                                padding: '0 2px',
                              }}
                            >
                              ×
                            </button>
                          </span>
                        )
                      })}
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
            'reflection',
            'distortion',
            'sparam',
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
