import { useState } from 'react'
import type { LensMode } from './lens.ts'
import { DeviceGlyph } from './symbols.tsx'
import { WIRE_GAUGES } from './wire-length.ts'
import { CURVE_SIZES } from './wire-path.ts'

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

export type Tool = 'select' | 'wire' | 'meter' | 'lasso'
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
  | 'scope'
  | 'timeline'
  | 'bode'
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
    id: 'scope',
    label: 'Scope',
    icon: '∿',
    color: '#6ec06e',
    title: 'Scope — run the circuit through time and plot every node voltage as a waveform',
  },
  {
    id: 'timeline',
    label: 'Timeline',
    icon: '⏱',
    color: '#e0b070',
    title:
      'Timeline — replay the time simulation across the live circuit: watch the current flow, build, reverse and settle, and the voltages change at each instant. Scrub, step, or play; the physics never re-runs, only the view moves through the same solved result.',
  },
  {
    id: 'bode',
    label: 'Bode',
    icon: '⌁',
    color: '#6ec0ff',
    title:
      "Bode — the frequency response: pick an input source and an output node and see gain (dB) and phase vs frequency. Reads off the RC/filter corner, an amplifier's roll-off and phase margin, or a transmission line's quarter-wave resonances.",
  },
  {
    id: 'group',
    label: 'Group',
    icon: '⧉',
    color: '#a06ad8',
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
    color: '#d6a23c',
    title:
      "Math — see every equation behind the current circuit: each part's law with the real numbers in it, and Kirchhoff's current law re-summed at every net (the checkmark is computed, not assumed)",
  },
  {
    id: 'margins',
    label: 'Margins',
    icon: '±',
    color: '#d6a23c',
    title:
      "Margins — the derating scorecard (how close each part runs to its limit now), the worst-case envelope over every part's ±tolerance, and Monte-Carlo (the realistic spread and what fraction of boards fail).",
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
  onScope,
  onTimeline,
  onBode,
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
  onScope: () => void
  onTimeline: () => void
  onBode: () => void
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
}) {
  const wireActive = tool === 'wire'
  const meterActive = tool === 'meter'
  const lassoActive = tool === 'lasso'
  // Each toolbar action id (from TOOLBAR_ACTIONS) wired to its handler. Add a button →
  // add an entry here and in TOOLBAR_ACTIONS; rewire one → change it here.
  const actionHandlers: Record<ToolbarActionId, () => void> = {
    scope: onScope,
    timeline: onTimeline,
    bode: onBode,
    group: onGroup,
    clipboard: onClipboard,
    math: onMath,
    margins: onWorstCase,
  }
  return (
    <>
      <button
        type="button"
        onClick={() => onTool(wireActive ? 'select' : 'wire')}
        title="Wire tool — works like a CAD line tool: click anywhere to start (a terminal dot, or open space — a junction dot is made there), click to drop corners, then click a terminal dot to finish, or double-click in space to end there. No holding (drag between dots also works). Esc or re-clicking the start abandons the wire."
        style={toolButton(wireActive)}
      >
        <DeviceGlyph definition="wire" />
        <span style={{ fontSize: 11 }}>Wire</span>
      </button>
      {wireActive ? (
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
              style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: '#778' }}
            >
              Gauge
            </span>
            <select
              className="nodrag"
              value={wireGauge}
              onChange={(event) => onWireGauge(Number(event.target.value))}
              title="The AWG gauge new wires are drawn at -- thinner wire is more resistance and heat. Each wire keeps its own gauge; change one later by selecting it."
              style={{
                background: '#1a1a1e',
                border: '1px solid #3a3a3f',
                color: '#cdd6e0',
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
      ) : null}

      <button
        type="button"
        onClick={() => onTool(lassoActive ? 'select' : 'lasso')}
        title="Lasso — freeform selection: draw any shape around parts and everything whose middle is inside gets selected together (move, Group, copy, or cut them as one). Left-drag on empty canvas box-selects without this tool; the lasso is for shapes a box can't make."
        style={{ ...toolButton(lassoActive), flexDirection: 'row', gap: 6, padding: '8px 10px' }}
      >
        <span aria-hidden style={{ color: '#c08ae0', fontSize: 13 }}>
          ⟁
        </span>
        <span style={{ fontSize: 11 }}>Lasso</span>
      </button>

      <button
        type="button"
        onClick={() => onTool(meterActive ? 'select' : 'meter')}
        title="Meter — touch terminal dots like multimeter probes: red then black reads between them (DC volts, AC volts rms, ohms, diode test, or capacitance — set by the dial on the readout); both probes on one part reads its current; touch a wire to clamp onto it and read its amps the clamp-meter way (senses the wire's magnetic field — nothing inserted, zero burden voltage, circuit untouched); HOLD freezes a reading to compare"
        style={{ ...toolButton(meterActive), flexDirection: 'row', gap: 6, padding: '8px 10px' }}
      >
        <span aria-hidden style={{ color: '#e0594f', fontSize: 13 }}>
          Ⓥ
        </span>
        <span style={{ fontSize: 11 }}>Meter</span>
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <button
          type="button"
          onClick={onSolve}
          title="Run the physics now — recompute every wire's current, length, and resistance"
          style={{ ...toolButton(false), flexDirection: 'row', gap: 6, padding: '8px 12px' }}
        >
          <span aria-hidden style={{ color: '#7ab8ff', fontSize: 13 }}>
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
            color: '#cdd6e0',
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
            style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: '#778' }}
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
              background: '#1a1a1e',
              border: '1px solid #3a3a3f',
              color: '#cdd6e0',
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
            background: '#1a1a1e',
            border: '1px solid #3a3a3f',
            color: '#cdd6e0',
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
              ...toolButton(false),
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
    color: '#d6a23c',
    title: 'Voltage lens — color every wire by its solved potential (blue = lowest, red = highest)',
  },
  {
    mode: 'power',
    label: 'Power',
    icon: '♨',
    color: '#e0594f',
    title: 'Power lens — heat-color every part by its real dissipated watts (the hot spots)',
  },
  {
    mode: 'temp',
    label: 'Temp',
    icon: '℃',
    color: '#e0a050',
    title:
      'Temp lens — heat-color every part by its computed temperature (board ambient + power × thermal resistance): the hotspots',
  },
  {
    mode: 'field',
    label: 'Field',
    icon: '◎',
    color: '#5ad8c8',
    title:
      'Magnetic-field lens — bands around each wire sized by its real field, B = μ₀I/2πr from the solved current. Per-wire fields only (full field solving is a future stage).',
  },
  {
    mode: 'energy',
    label: 'Energy',
    icon: '↯',
    color: '#e8b84b',
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
        <span aria-hidden style={{ color: active?.color ?? '#9fd0ff', fontSize: 13 }}>
          {active?.icon ?? (flow ? '≫' : '◉')}
        </span>
        <span style={{ fontSize: 11 }}>
          {active ? `Lens: ${active.label}` : flow ? 'Lens: Flow' : 'Lens'}
        </span>
        <span aria-hidden style={{ marginLeft: 'auto', fontSize: 9, color: '#778' }}>
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
            <span aria-hidden style={{ color: '#778', fontSize: 13 }}>
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
            <span aria-hidden style={{ color: '#9fd0ff', fontSize: 13 }}>
              ≫
            </span>
            <span style={{ fontSize: 11 }}>Flow{flow ? ' · on' : ''}</span>
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
    background: active ? '#24405f' : '#1b1b1f',
    border: active ? '1px solid #7ab8ff' : '1px solid #2a2a2f',
    color: '#cdd6e0',
    fontFamily: 'system-ui, sans-serif',
  }
}
