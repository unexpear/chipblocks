import { Fragment, useState } from 'react'
import type { LensMode } from './lens.ts'
import { DeviceGlyph } from './symbols.tsx'
import { THEME } from './theme.ts'
import { WIRE_GAUGES } from './wire-length.ts'
import { CURVE_SIZES } from './wire-path.ts'
import type { WorkspaceMode } from './workspace.ts'

/**
 * Tools toolbar (Sprint 19 S19-v3-10; physics controls S19-v3-14). Tools — as
 * opposed to placeable parts — live here.
 *
 *  - Wire tool: a wire is a connection you draw, not a part you drop, so it
 *    belongs here, not in the parts palette. Selecting it locks the parts
 *    (nodesDraggable off in App) so a drag draws a wire instead of moving a part.
 *  - Solve (▶): run the physics now and refresh every wire's current/length/
 *    resistance.
 *  - Always-on: when checked, the physics re-solves on every change (default);
 *    uncheck it to batch big edits without the PC recomputing every small move,
 *    then hit Solve.
 */

export type Tool = 'select' | 'wire' | 'meter' | 'lasso' | 'connect'
export type ConnectMode = 'single' | 'batch'
export type WireStyle = 'line' | 'curve'

/**
 * Standard operating-environment presets for the board ambient — recognized JEDEC/AEC temperature
 * grades, real and cited: commercial/bench 25 °C; industrial −40…+85 °C; automotive AEC-Q100 Grade 2
 * −40…+105 °C and Grade 1 (underhood) −40…+125 °C; −40 °C is the shared industrial/automotive low end.
 */
const AMBIENT_PRESETS: { label: string; c: number }[] = [
  { label: 'Bench / lab — 25 °C', c: 25 },
  { label: 'Cold outdoor — −40 °C', c: -40 },
  { label: 'Industrial — 85 °C', c: 85 },
  { label: 'Automotive cabin — 105 °C', c: 105 },
  { label: 'Engine bay — 125 °C', c: 125 },
]

/**
 * THE TOOLBAR — edit this one list to reshape it (no logic to untangle):
 *   • Reorder → move a line up or down.
 *   • Rename  → change `label`.
 *   • Restyle → change `icon` (any character or emoji) or `color`.
 *   • Hide    → delete the line (or comment it out).
 *   • Add     → copy a line, give it a fresh `id`, then point that id at a handler
 *               in `actionHandlers` (inside ToolbarItems) and pass it from App.tsx.
 * The lens views work the same way — see LENS_TABS below. Panels, the tool-mode
 * buttons and the colour theme all follow this same edit-one-list pattern.
 */
export type ToolbarActionId =
  | 'addPart'
  | 'newPart'
  | 'newFootprint'
  | 'scope'
  | 'timeline'
  | 'bode'
  | 'reflection'
  | 'distortion'
  | 'sparam'
  | 'pcb'
  | 'plan'
  | 'verilog'
  | 'trace'
  | 'stress'
  | 'workspace'
  | 'group'
  | 'clipboard'
  | 'math'
  | 'margins'

export type ToolbarAction = {
  id: ToolbarActionId
  label: string
  /** Any single character or emoji — the button's glyph. */
  icon: string
  /** Glyph colour (CSS). Omit to inherit the default toolbar text colour. */
  color?: string
  title: string
}

export const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    id: 'addPart',
    label: 'Add Part',
    icon: '＋',
    color: THEME.accentBlue,
    title:
      'Add Part — open a searchable list of every part (like KiCad’s Choose Symbol); pick one and it drops at the centre of the view, ready to drag into place. The parts palette still works too.',
  },
  {
    id: 'newPart',
    label: 'New Part',
    icon: '✎',
    color: THEME.accentPurple,
    title:
      'New Part — author your own custom part: give it a name, pins (each on a chosen side with an electrical role), and optional default values. It draws itself from those pins and joins the palette, ready to drop and wire like any built-in.',
  },
  {
    id: 'newFootprint',
    label: 'New Footprint',
    icon: '⬛',
    color: THEME.accentPink,
    title:
      'New Footprint — draw the PHYSICAL package a part solders to: the copper pads, the component body and the assembly keep-out. Stamp a whole row of pads from the numbers a datasheet prints (how many, what pitch, how big), drag any of them to fine-tune, and the package joins the footprint list so a part can be given it and land on a real board.',
  },
  {
    id: 'scope',
    label: 'Scope',
    icon: '∿',
    color: THEME.statusOk,
    title: 'Scope — run the circuit through time and plot every node voltage as a waveform',
  },
  {
    id: 'timeline',
    label: 'Timeline',
    icon: '⏱',
    color: THEME.accentTimeline,
    title:
      'Timeline — replay the time simulation across the live circuit: watch the current flow, build, reverse and settle, and the voltages change at each instant. Scrub, step, or play; the physics never re-runs, only the view moves through the same solved result.',
  },
  {
    id: 'bode',
    label: 'Bode',
    icon: '⌁',
    color: THEME.accentBlueBright,
    title:
      "Bode — the frequency response: pick an input source and an output node and see gain (dB) and phase vs frequency. Reads off the RC/filter corner, an amplifier's roll-off and phase margin, or a transmission line's quarter-wave resonances.",
  },
  {
    id: 'reflection',
    label: 'Reflect',
    icon: '⟲',
    color: THEME.accentBlueBright,
    title:
      'Reflection (RF) — how well a port is matched: pick a Port and a reference impedance (50 Ω) and see the return loss (dB) and VSWR vs frequency, plus the complex input impedance Zin. Peaks in return loss are the frequencies where the input is matched and reflects the least.',
  },
  {
    id: 'distortion',
    label: 'Distort',
    icon: '⋀',
    color: THEME.lensTemp,
    title:
      'Distortion (large-signal RF) — how a stage behaves when driven hard: pick a drive source and probe an output, and it drives the circuit through the nonlinear time-domain solver + FFT to show the gain-compression curve (with the 1-dB compression point, P1dB) and the harmonic spectrum (with THD %). These are the large-signal numbers the small-signal Bode/Reflection views cannot give.',
  },
  {
    id: 'sparam',
    label: 'S-params',
    icon: '⧉',
    color: THEME.accentBlueBright,
    title:
      'S-parameters (2-port RF) — pick two Ports and a reference impedance (50 Ω) to see the scattering matrix vs frequency: transmission |S21|/|S12| in dB (the honest gain / insertion loss — a passive part never exceeds 0 dB) and match |S11|/|S22| in dB (how much each port reflects). The 50 Ω language every RF datasheet speaks in.',
  },
  {
    id: 'pcb',
    label: 'PCB',
    icon: '▦',
    color: THEME.statusOk,
    title:
      'PCB — the physical layout in a side panel: every part that has a footprint placed on a board, copper pads and all. The first physical form of the circuit, on the road to the manufacturing files.',
  },
  {
    id: 'plan',
    label: 'Plan',
    icon: '☑',
    color: THEME.accentBlue,
    title:
      'Plan — the board manufacturing-readiness roadmap: the tiered work that makes ChipBlocks’ PCB rules match real fab constraints, each item with its verified cited number. Track what is done, in progress, or to-do so nothing is lost.',
  },
  {
    id: 'verilog',
    label: 'Verilog',
    icon: '⌨',
    color: THEME.accentPurple,
    title:
      'Verilog — write hardware in Verilog and watch it synthesize live: syntax highlighting, a running report of exactly what will and won’t build into real gates, and a one-click Synthesize → canvas that drops the resulting gates and flip-flops onto the sheet.',
  },
  {
    id: 'trace',
    label: 'Trace',
    icon: '⧗',
    color: THEME.accentTimeline,
    title:
      'Run-trace — clock a digital design for many cycles and flag the odd ones: a cycle that never settled, a one-cycle glitch, a cycle that ran a much longer logic path, or outputs that depend on the flip-flops’ power-up state (a missing reset). Answers “is the 5th cycle different, on purpose or not?”.',
  },
  {
    id: 'stress',
    label: 'Stress',
    icon: '🌡',
    color: THEME.statusDanger,
    title:
      'Stress bench — ramp the ambient temperature, the supply voltage, or a component’s value across a range and see, part by part, the safe operating window and exactly where each part gives out (and why). Runs the real electro-thermal solver + failure checks at every point.',
  },
  {
    id: 'group',
    label: 'Group',
    icon: '⧉',
    color: THEME.accentPurple,
    title:
      "Group — turn the selected parts into ONE reusable block with terminals. Wires crossing the selection become the block's ports. The block is pure structure: the solver always computes the real parts inside (double-click the block to see them; Ungroup to edit).",
  },
  {
    id: 'clipboard',
    label: 'Clipboard',
    icon: '📋',
    title:
      'Clipboard — the last 15 copies plus the one cut, like the Windows clipboard history. Click an item in the panel to paste it; Ctrl+V pastes the newest.',
  },
  {
    id: 'math',
    label: 'Math',
    icon: 'Σ',
    color: THEME.statusWarn,
    title:
      "Math — see every equation behind the current circuit: each part's law with the real numbers in it, and Kirchhoff's current law re-summed at every net (the checkmark is computed, not assumed)",
  },
  {
    id: 'margins',
    label: 'Margins',
    icon: '±',
    color: THEME.statusWarn,
    title:
      "Margins — the derating scorecard (how close each part runs to its limit now), the worst-case envelope over every part's ±tolerance, and Monte-Carlo (the realistic spread and what fraction of boards fail).",
  },
]

/**
 * THE TOOL MODES — the canvas-tool buttons (Wire / Lasso / Meter), edited the same one-list
 * way as TOOLBAR_ACTIONS: reorder a line, rename `label`, restyle `icon` / `color`, delete to
 * hide, or copy a line with a fresh `tool` to add one. Clicking a button turns that tool on;
 * clicking it again returns to Select. Set `device` to draw a part symbol instead of a plain
 * character (Wire shows the real wire symbol). Wire alone has an options sub-panel — WireOptions.
 */
export type ToolMode = {
  /** The canvas tool this turns on (clicking the button again returns to Select). */
  tool: Exclude<Tool, 'select'>
  label: string
  /** The button glyph — any character or emoji. */
  icon: string
  /** Draw a part symbol (a DeviceGlyph definition) instead of `icon` — Wire uses the wire symbol. */
  device?: string
  /** Glyph colour (CSS) for the `icon` character. */
  color?: string
  title: string
}

export const TOOL_MODES: ToolMode[] = [
  {
    tool: 'wire',
    label: 'Wire',
    icon: '╱',
    device: 'wire',
    title:
      'Wire tool — works like a CAD line tool: click anywhere to start (a terminal dot, or open space — a junction dot is made there), click to drop corners, then click a terminal dot to finish, or double-click in space to end there. No holding (drag between dots also works). Esc or re-clicking the start abandons the wire.',
  },
  {
    tool: 'connect',
    label: 'Connect',
    icon: '🔗',
    color: THEME.accentBlueBright,
    title:
      'Connect tool — the app marks EVERY point you can wire to (part pins, block ports, junction dots). Click a start dot, then an end dot, and the auto-router lays a neat wire between them — you pick the endpoints, it figures out the path. Single mode routes each wire as you go; Batch mode lets you mark many pairs first, then "Route all" routes them together for the cleanest result. Esc cancels a half-made connection.',
  },
  {
    tool: 'lasso',
    label: 'Lasso',
    icon: '⟁',
    color: THEME.accentLasso,
    title:
      "Lasso — freeform selection: draw any shape around parts and everything whose middle is inside gets selected together (move, Group, copy, or cut them as one). Left-drag on empty canvas box-selects without this tool; the lasso is for shapes a box can't make.",
  },
  {
    tool: 'meter',
    label: 'Meter',
    icon: 'Ⓥ',
    color: THEME.statusDanger,
    title:
      "Meter — touch terminal dots like multimeter probes: red then black reads between them (DC volts, AC volts rms, ohms, diode test, or capacitance — set by the dial on the readout); both probes on one part reads its current; touch a wire to clamp onto it and read its amps the clamp-meter way (senses the wire's magnetic field — nothing inserted, zero burden voltage, circuit untouched); HOLD freezes a reading to compare",
  },
]

export function ToolbarItems({
  tool,
  onTool,
  wireStyle,
  onWireStyle,
  curveRadius,
  onCurveRadius,
  wireGauge,
  onWireGauge,
  alwaysOn,
  onAlwaysOn,
  projectAmbientC,
  onProjectAmbient,
  onSolve,
  onAddPart,
  onNewPart,
  onNewFootprint,
  onScope,
  onTimeline,
  onBode,
  onReflection,
  onDistortion,
  onSParam,
  onPcb,
  onPlan,
  onVerilog,
  onTrace,
  onStress,
  workspace,
  onWorkspace,
  onMath,
  onWorstCase,
  onGroup,
  canGroup,
  onClipboard,
  clipboardCount,
  lens,
  onLens,
  flow,
  onFlow,
  connectMode,
  onConnectMode,
  connectQueueCount,
  onRouteConnectQueue,
  onClearConnectQueue,
}: {
  tool: Tool
  onTool: (tool: Tool) => void
  wireStyle: WireStyle
  onWireStyle: (style: WireStyle) => void
  curveRadius: number
  onCurveRadius: (radiusPx: number) => void
  wireGauge: number
  onWireGauge: (gaugeAwg: number) => void
  alwaysOn: boolean
  onAlwaysOn: (on: boolean) => void
  projectAmbientC: number
  onProjectAmbient: (c: number) => void
  onSolve: () => void
  onAddPart: () => void
  onNewPart: () => void
  onNewFootprint: () => void
  onScope: () => void
  onTimeline: () => void
  onBode: () => void
  onReflection: () => void
  onDistortion: () => void
  onSParam: () => void
  onPcb: () => void
  onPlan: () => void
  onVerilog: () => void
  onTrace: () => void
  onStress: () => void
  workspace: WorkspaceMode
  onWorkspace: () => void
  onMath: () => void
  onWorstCase: () => void
  onGroup: () => void
  canGroup: boolean
  onClipboard: () => void
  clipboardCount: number
  lens: LensMode
  onLens: (lens: LensMode) => void
  flow: boolean
  onFlow: (flow: boolean) => void
  connectMode: ConnectMode
  onConnectMode: (mode: ConnectMode) => void
  connectQueueCount: number
  onRouteConnectQueue: () => void
  onClearConnectQueue: () => void
}) {
  // Each toolbar action id (from TOOLBAR_ACTIONS) wired to its handler. Add a button →
  // add an entry here and in TOOLBAR_ACTIONS; rewire one → change it here.
  const actionHandlers: Record<ToolbarActionId, () => void> = {
    addPart: onAddPart,
    newPart: onNewPart,
    newFootprint: onNewFootprint,
    scope: onScope,
    timeline: onTimeline,
    bode: onBode,
    reflection: onReflection,
    distortion: onDistortion,
    sparam: onSParam,
    pcb: onPcb,
    plan: onPlan,
    verilog: onVerilog,
    trace: onTrace,
    stress: onStress,
    workspace: onWorkspace,
    group: onGroup,
    clipboard: onClipboard,
    math: onMath,
    margins: onWorstCase,
  }
  return (
    <>
      {TOOL_MODES.map((mode) => {
        const active = tool === mode.tool
        return (
          <Fragment key={mode.tool}>
            <button
              type="button"
              onClick={() => onTool(active ? 'select' : mode.tool)}
              title={mode.title}
              style={{ ...toolButton(active), flexDirection: 'row', gap: 6, padding: '8px 10px' }}
            >
              {mode.device ? (
                <DeviceGlyph definition={mode.device} />
              ) : (
                <span aria-hidden style={{ color: mode.color, fontSize: 13 }}>
                  {mode.icon}
                </span>
              )}
              <span style={{ fontSize: 11 }}>{mode.label}</span>
            </button>
            {/* Wire is the one tool with its own options (style + gauge), shown right under it while
                it is on — the per-tool extra, like Group/Clipboard's extras in TOOLBAR_ACTIONS. */}
            {mode.tool === 'wire' && active ? (
              <WireOptions
                wireStyle={wireStyle}
                onWireStyle={onWireStyle}
                curveRadius={curveRadius}
                onCurveRadius={onCurveRadius}
                wireGauge={wireGauge}
                onWireGauge={onWireGauge}
              />
            ) : null}
            {mode.tool === 'connect' && active ? (
              <ConnectOptions
                connectMode={connectMode}
                onConnectMode={onConnectMode}
                queueCount={connectQueueCount}
                onRouteQueue={onRouteConnectQueue}
                onClearQueue={onClearConnectQueue}
              />
            ) : null}
          </Fragment>
        )
      })}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <button
          type="button"
          onClick={onSolve}
          title="Run the physics now — recompute every wire's current, length, and resistance"
          style={{ ...toolButton(false), flexDirection: 'row', gap: 6, padding: '8px 12px' }}
        >
          <span aria-hidden style={{ color: THEME.accentBlue, fontSize: 13 }}>
            ▶
          </span>
          <span style={{ fontSize: 11 }}>Solve</span>
        </button>
        <label
          title="Re-solve the physics on every change. Turn off to save CPU on big circuits, then hit Solve."
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            color: THEME.textPrimary,
            fontSize: 11,
            fontFamily: 'system-ui, sans-serif',
            cursor: 'pointer',
            userSelect: 'none',
            padding: '0 2px',
          }}
        >
          <input
            type="checkbox"
            checked={alwaysOn}
            onChange={(event) => onAlwaysOn(event.target.checked)}
          />
          Always on
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '0 2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              fontSize: 9,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              color: THEME.textMuted,
            }}
          >
            Ambient °C
          </span>
          <input
            type="number"
            className="nodrag"
            value={projectAmbientC}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) onProjectAmbient(next)
            }}
            title="The whole board's ambient temperature (°C) — the environment every part sits in (a bench is 25 °C, a car's engine bay ~105 °C). Each part falls back to this unless you give it its own ambient_temperature. Drives R(T), junction-voltage drift, and the Temp lens."
            style={{
              width: 46,
              background: THEME.surfaceInput,
              border: `1px solid ${THEME.borderStrong}`,
              color: THEME.textPrimary,
              borderRadius: 3,
              fontSize: 10,
              padding: '2px 3px',
            }}
          />
        </div>
        <select
          className="nodrag"
          value={AMBIENT_PRESETS.find((p) => p.c === projectAmbientC)?.c ?? ''}
          onChange={(event) => {
            if (event.target.value !== '') onProjectAmbient(Number(event.target.value))
          }}
          title="Jump to a standard operating environment — the recognized JEDEC/AEC temperature grades (commercial, industrial, automotive). A value off the list reads ‘Custom’."
          style={{
            background: THEME.surfaceInput,
            border: `1px solid ${THEME.borderStrong}`,
            color: THEME.textPrimary,
            borderRadius: 3,
            fontSize: 10,
            padding: '2px 3px',
          }}
        >
          <option value="">Custom…</option>
          {AMBIENT_PRESETS.map((p) => (
            <option key={p.c} value={p.c}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* The panel/tool buttons — rendered from TOOLBAR_ACTIONS (edit that list to
          reorder, rename, restyle, hide, or add). Group is disabled until 2+ parts
          are selected; Clipboard shows its count — the only two per-button extras. */}
      {TOOLBAR_ACTIONS.map((action) => {
        const disabled = action.id === 'group' && !canGroup
        // The board-workspace button is a toggle: it lights up while the main area shows the board.
        const active = action.id === 'workspace' && workspace === 'board'
        const label =
          action.id === 'clipboard' && clipboardCount > 0
            ? `${action.label} (${clipboardCount})`
            : action.label
        return (
          <button
            key={action.id}
            type="button"
            onClick={actionHandlers[action.id]}
            disabled={disabled}
            title={action.title}
            style={{
              ...toolButton(active),
              flexDirection: 'row',
              gap: 6,
              padding: '8px 12px',
              ...(disabled ? { opacity: 0.45, cursor: 'default' } : {}),
            }}
          >
            <span
              aria-hidden
              style={{ fontSize: 13, ...(action.color ? { color: action.color } : {}) }}
            >
              {action.icon}
            </span>
            <span style={{ fontSize: 11 }}>{label}</span>
          </button>
        )
      })}

      {/* Lenses (S19-v3-50; consolidated into one tabbed tool): overlay the solved physics
          on the schematic. One color view at a time (Voltage / Power / Temp / Field / Energy),
          plus the independent Flow current-animation toggle. */}
      <LensTool lens={lens} onLens={onLens} flow={flow} onFlow={onFlow} />
    </>
  )
}

const LENS_TABS: {
  mode: Exclude<LensMode, 'none'>
  label: string
  icon: string
  color: string
  title: string
}[] = [
  {
    mode: 'voltage',
    label: 'Voltage',
    icon: '◧',
    color: THEME.statusWarn,
    title: 'Voltage lens — color every wire by its solved potential (blue = lowest, red = highest)',
  },
  {
    mode: 'power',
    label: 'Power',
    icon: '♨',
    color: THEME.statusDanger,
    title: 'Power lens — heat-color every part by its real dissipated watts (the hot spots)',
  },
  {
    mode: 'temp',
    label: 'Temp',
    icon: '℃',
    color: THEME.lensTemp,
    title:
      'Temp lens — heat-color every part by its computed temperature (board ambient + power × thermal resistance): the hotspots',
  },
  {
    mode: 'field',
    label: 'Field',
    icon: '◎',
    color: THEME.lensField,
    title:
      'Magnetic-field lens — bands around each wire sized by its real field, B = μ₀I/2πr from the solved current. Per-wire fields only (full field solving is a future stage).',
  },
  {
    mode: 'energy',
    label: 'Energy',
    icon: '↯',
    color: THEME.lensEnergy,
    title:
      'Energy-flow lens — gold arrows of energy streaming from the surrounding FIELDS into each load (and out of each source): the Poynting picture. Arrow size = the part’s power.',
  },
]

/**
 * The Lens tool — one button that expands to the lens tabs, so the six separate lens buttons
 * become a single tidy control. One color view at a time (click again to turn off), plus the
 * additive Flow current-animation toggle. The button shows whichever lens is active.
 */
function LensTool({
  lens,
  onLens,
  flow,
  onFlow,
}: {
  lens: LensMode
  onLens: (lens: LensMode) => void
  flow: boolean
  onFlow: (flow: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const active = LENS_TABS.find((t) => t.mode === lens)
  const anyOn = lens !== 'none' || flow
  const tab = (on: boolean): React.CSSProperties => ({
    ...toolButton(on),
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 6,
    padding: '5px 9px',
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Lenses — overlay the solved physics on the schematic: voltage, power, temperature, magnetic field, energy flow, and the current-flow animation. Pick one view at a time."
        style={{ ...toolButton(anyOn), flexDirection: 'row', gap: 6, padding: '8px 10px' }}
      >
        <span aria-hidden style={{ color: active?.color ?? THEME.accentBlueSoft, fontSize: 13 }}>
          {active?.icon ?? (flow ? '≫' : '◉')}
        </span>
        <span style={{ fontSize: 11 }}>
          {active ? `Lens: ${active.label}` : flow ? 'Lens: Flow' : 'Lens'}
        </span>
        <span aria-hidden style={{ marginLeft: 'auto', fontSize: 9, color: THEME.textMuted }}>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 6 }}>
          <button
            type="button"
            onClick={() => onLens('none')}
            title="Turn the color lens off"
            style={tab(lens === 'none')}
          >
            <span aria-hidden style={{ color: THEME.textMuted, fontSize: 13 }}>
              ○
            </span>
            <span style={{ fontSize: 11 }}>Off</span>
          </button>
          {LENS_TABS.map((t) => (
            <button
              key={t.mode}
              type="button"
              onClick={() => onLens(lens === t.mode ? 'none' : t.mode)}
              title={t.title}
              style={tab(lens === t.mode)}
            >
              <span aria-hidden style={{ color: t.color, fontSize: 13 }}>
                {t.icon}
              </span>
              <span style={{ fontSize: 11 }}>{t.label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onFlow(!flow)}
            title="Flow animation — march dashes along each wire in the solved current's direction, speed from its size. Overlays on top of any color lens."
            style={tab(flow)}
          >
            <span aria-hidden style={{ color: THEME.accentBlueSoft, fontSize: 13 }}>
              ≫
            </span>
            <span style={{ fontSize: 11 }}>Flow{flow ? ' · on' : ''}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Wire's options sub-panel (line vs curve, the curve radius, and the gauge new wires draw at).
 * Only the Wire tool has its own options, so it lives in its own component to keep the
 * tool-mode list (TOOL_MODES) shallow — the toolbar renders it right under the Wire button.
 */
function WireOptions({
  wireStyle,
  onWireStyle,
  curveRadius,
  onCurveRadius,
  wireGauge,
  onWireGauge,
}: {
  wireStyle: WireStyle
  onWireStyle: (style: WireStyle) => void
  curveRadius: number
  onCurveRadius: (radiusPx: number) => void
  wireGauge: number
  onWireGauge: (gaugeAwg: number) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        onClick={() => onWireStyle('line')}
        title="Straight segments with sharp corners. Honest physics: at DC a corner itself doesn't change a wire's resistance — the route's LENGTH sets R = ρL/A, and the length follows exactly what you draw."
        style={{
          ...toolButton(wireStyle === 'line'),
          flexDirection: 'row',
          gap: 6,
          padding: '4px 10px',
        }}
      >
        <span aria-hidden style={{ fontSize: 12 }}>
          ⌐
        </span>
        <span style={{ fontSize: 11 }}>Line</span>
      </button>
      <button
        type="button"
        onClick={() => onWireStyle('curve')}
        title="The same route with rounded corners (fillets). Slightly shorter than sharp corners — it cuts the corner — so slightly less resistance, measured for real. Sharp-corner effects BEYOND length (radio-frequency reflections, high-voltage field crowding at points) are real but live at future solver stages; they are documented, not faked."
        style={{
          ...toolButton(wireStyle === 'curve'),
          flexDirection: 'row',
          gap: 6,
          padding: '4px 10px',
        }}
      >
        <span aria-hidden style={{ fontSize: 12 }}>
          ◠
        </span>
        <span style={{ fontSize: 11 }}>Curve</span>
      </button>
      {wireStyle === 'curve' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 6 }}>
          {CURVE_SIZES.map((size) => (
            <button
              key={size.label}
              type="button"
              onClick={() => onCurveRadius(size.radiusPx)}
              title={`${size.hint} — the wire starts bending ${size.radiusPx} mm before each corner (clamped on short hops). A bigger sweep cuts more of the corner, so the wire is really shorter: less resistance, measured for real. Applies to wires drawn from now on; every wire keeps its own size.`}
              style={{
                ...toolButton(curveRadius === size.radiusPx),
                flexDirection: 'row',
                gap: 6,
                padding: '3px 8px',
              }}
            >
              {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative curve-size icon; the button's title carries the text */}
              <svg aria-hidden width={22} height={14} viewBox="0 0 22 14">
                <path
                  d={`M 1 13 L ${11 - size.radiusPx / 7} 13 Q 11 13 11 ${13 - size.radiusPx / 7} L 11 1`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                />
              </svg>
              <span style={{ fontSize: 10 }}>{size.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingTop: 2 }}>
        <span
          style={{
            fontSize: 9,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: THEME.textMuted,
          }}
        >
          Gauge
        </span>
        <select
          className="nodrag"
          value={wireGauge}
          onChange={(event) => onWireGauge(Number(event.target.value))}
          title="The AWG gauge new wires are drawn at -- thinner wire is more resistance and heat. Each wire keeps its own gauge; change one later by selecting it."
          style={{
            background: THEME.surfaceInput,
            border: `1px solid ${THEME.borderStrong}`,
            color: THEME.textPrimary,
            borderRadius: 3,
            fontSize: 10,
            padding: '2px 3px',
          }}
        >
          {WIRE_GAUGES.map((g) => (
            <option key={g.awg} value={g.awg}>
              {g.awg} AWG
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

/**
 * Connect's options sub-panel — the Single / Batch switch and (in Batch) the Route-all + Clear
 * buttons for the queued pairs. Mirrors WireOptions: only the Connect tool has its own options, so
 * they live here and the toolbar renders them right under the Connect button.
 */
function ConnectOptions({
  connectMode,
  onConnectMode,
  queueCount,
  onRouteQueue,
  onClearQueue,
}: {
  connectMode: ConnectMode
  onConnectMode: (mode: ConnectMode) => void
  queueCount: number
  onRouteQueue: () => void
  onClearQueue: () => void
}) {
  const queueButton = (enabled: boolean): React.CSSProperties => ({
    ...toolButton(false),
    flexDirection: 'row',
    gap: 6,
    padding: '4px 10px',
    ...(enabled ? {} : { opacity: 0.45, cursor: 'default' }),
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        onClick={() => onConnectMode('single')}
        title="Single — each wire routes the moment you pick its two endpoints. Best for one or a few connections."
        style={{
          ...toolButton(connectMode === 'single'),
          flexDirection: 'row',
          gap: 6,
          padding: '4px 10px',
        }}
      >
        <span aria-hidden style={{ fontSize: 12 }}>
          •→•
        </span>
        <span style={{ fontSize: 11 }}>Single</span>
      </button>
      <button
        type="button"
        onClick={() => onConnectMode('batch')}
        title="Batch — mark several start→end pairs first; nothing routes until you press Route all, so the auto-router can lay them all together for the cleanest, least-crossing result."
        style={{
          ...toolButton(connectMode === 'batch'),
          flexDirection: 'row',
          gap: 6,
          padding: '4px 10px',
        }}
      >
        <span aria-hidden style={{ fontSize: 12 }}>
          ≣
        </span>
        <span style={{ fontSize: 11 }}>Batch</span>
      </button>
      {connectMode === 'batch' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 6 }}>
          <button
            type="button"
            onClick={onRouteQueue}
            disabled={queueCount === 0}
            title="Route every queued pair now — the auto-router lays them all in one pass."
            style={queueButton(queueCount > 0)}
          >
            <span aria-hidden style={{ color: THEME.accentBlue, fontSize: 12 }}>
              ▶
            </span>
            <span style={{ fontSize: 11 }}>Route all ({queueCount})</span>
          </button>
          <button
            type="button"
            onClick={onClearQueue}
            disabled={queueCount === 0}
            title="Forget the queued pairs without routing them."
            style={queueButton(queueCount > 0)}
          >
            <span aria-hidden style={{ color: THEME.textMuted, fontSize: 12 }}>
              ✕
            </span>
            <span style={{ fontSize: 11 }}>Clear</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

function toolButton(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: '6px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    background: active ? THEME.surfaceActive : THEME.surfaceRaised,
    border: active ? `1px solid ${THEME.accentBlue}` : `1px solid ${THEME.borderSubtle}`,
    color: THEME.textPrimary,
    fontFamily: 'system-ui, sans-serif',
  }
}
