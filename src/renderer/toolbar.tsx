import type { LensMode } from './lens.ts'
import { DeviceGlyph } from './symbols.tsx'

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

export type Tool = 'select' | 'wire' | 'meter'
export type WireStyle = 'line' | 'curve'

export function ToolbarItems({
  tool,
  onTool,
  wireStyle,
  onWireStyle,
  alwaysOn,
  onAlwaysOn,
  onSolve,
  onScope,
  onMath,
  lens,
  onLens,
  flow,
  onFlow,
}: {
  tool: Tool
  onTool: (tool: Tool) => void
  wireStyle: WireStyle
  onWireStyle: (style: WireStyle) => void
  alwaysOn: boolean
  onAlwaysOn: (on: boolean) => void
  onSolve: () => void
  onScope: () => void
  onMath: () => void
  lens: LensMode
  onLens: (lens: LensMode) => void
  flow: boolean
  onFlow: (flow: boolean) => void
}) {
  const wireActive = tool === 'wire'
  const meterActive = tool === 'meter'
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
        </div>
      ) : null}

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

      <button
        type="button"
        onClick={onScope}
        title="Scope — run the circuit through time and plot every node voltage as a waveform"
        style={{ ...toolButton(false), flexDirection: 'row', gap: 6, padding: '8px 12px' }}
      >
        <span aria-hidden style={{ color: '#6ec06e', fontSize: 13 }}>
          ∿
        </span>
        <span style={{ fontSize: 11 }}>Scope</span>
      </button>

      <button
        type="button"
        onClick={onMath}
        title="Math — see every equation behind the current circuit: each part's law with the real numbers in it, and Kirchhoff's current law re-summed at every net (the checkmark is computed, not assumed)"
        style={{ ...toolButton(false), flexDirection: 'row', gap: 6, padding: '8px 12px' }}
      >
        <span aria-hidden style={{ color: '#d6a23c', fontSize: 13 }}>
          Σ
        </span>
        <span style={{ fontSize: 11 }}>Math</span>
      </button>

      {/* Lenses (S19-v3-50): overlay the solved physics on the schematic. Voltage
          and Power are exclusive color lenses (click again to turn off); Flow is
          an independent current-animation toggle. */}
      <button
        type="button"
        onClick={() => onLens(lens === 'voltage' ? 'none' : 'voltage')}
        title="Voltage lens — color every wire by its solved potential (blue = lowest, red = highest)"
        style={{
          ...toolButton(lens === 'voltage'),
          flexDirection: 'row',
          gap: 6,
          padding: '8px 10px',
        }}
      >
        <span aria-hidden style={{ color: '#d6a23c', fontSize: 13 }}>
          ◧
        </span>
        <span style={{ fontSize: 11 }}>Voltage</span>
      </button>
      <button
        type="button"
        onClick={() => onLens(lens === 'power' ? 'none' : 'power')}
        title="Power lens — heat-color every part by its real dissipated watts (the hot spots)"
        style={{
          ...toolButton(lens === 'power'),
          flexDirection: 'row',
          gap: 6,
          padding: '8px 10px',
        }}
      >
        <span aria-hidden style={{ color: '#e0594f', fontSize: 13 }}>
          ♨
        </span>
        <span style={{ fontSize: 11 }}>Power</span>
      </button>
      <button
        type="button"
        onClick={() => onLens(lens === 'temp' ? 'none' : 'temp')}
        title="Temp lens — heat-color every part by its computed temperature (25 °C ambient + power × thermal resistance): the hotspots"
        style={{
          ...toolButton(lens === 'temp'),
          flexDirection: 'row',
          gap: 6,
          padding: '8px 10px',
        }}
      >
        <span aria-hidden style={{ color: '#e0a050', fontSize: 13 }}>
          ℃
        </span>
        <span style={{ fontSize: 11 }}>Temp</span>
      </button>
      <button
        type="button"
        onClick={() => onLens(lens === 'field' ? 'none' : 'field')}
        title="Magnetic-field lens — bands around each wire sized by its real field, B = μ₀I/2πr from the solved current (the straight-wire law). Each band edge is a true field level; the legend states them, with Earth's ~25–65 µT for comparison. Per-wire fields only — neighboring wires' fields are not summed (full field solving is a future stage)."
        style={{
          ...toolButton(lens === 'field'),
          flexDirection: 'row',
          gap: 6,
          padding: '8px 10px',
        }}
      >
        <span aria-hidden style={{ color: '#5ad8c8', fontSize: 13 }}>
          ◎
        </span>
        <span style={{ fontSize: 11 }}>Field</span>
      </button>
      <button
        type="button"
        onClick={() => onFlow(!flow)}
        title="Flow animation — march dashes along each wire in the solved current's direction, speed from its size"
        style={{ ...toolButton(flow), flexDirection: 'row', gap: 6, padding: '8px 10px' }}
      >
        <span aria-hidden style={{ color: '#9fd0ff', fontSize: 13 }}>
          ≫
        </span>
        <span style={{ fontSize: 11 }}>Flow</span>
      </button>
    </>
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
