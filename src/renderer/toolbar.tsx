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

export function ToolbarItems({
  tool,
  onTool,
  alwaysOn,
  onAlwaysOn,
  onSolve,
  onScope,
  lens,
  onLens,
  flow,
  onFlow,
}: {
  tool: Tool
  onTool: (tool: Tool) => void
  alwaysOn: boolean
  onAlwaysOn: (on: boolean) => void
  onSolve: () => void
  onScope: () => void
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
        title="Wire tool — draw a connection between two parts' dots"
        style={toolButton(wireActive)}
      >
        <DeviceGlyph definition="wire" />
        <span style={{ fontSize: 11 }}>Wire</span>
      </button>

      <button
        type="button"
        onClick={() => onTool(meterActive ? 'select' : 'meter')}
        title="Meter — touch terminal dots like multimeter probes: red then black reads between them (DC volts, AC volts rms, ohms, diode test, or capacitance — set by the dial on the readout); both probes on one part reads its current; touch a wire to clamp onto it and read its amps without breaking the circuit; HOLD freezes a reading to compare"
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
