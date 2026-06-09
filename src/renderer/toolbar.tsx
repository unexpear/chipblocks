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

export type Tool = 'select' | 'wire'

export function ToolbarItems({
  tool,
  onTool,
  alwaysOn,
  onAlwaysOn,
  onSolve,
  onScope,
}: {
  tool: Tool
  onTool: (tool: Tool) => void
  alwaysOn: boolean
  onAlwaysOn: (on: boolean) => void
  onSolve: () => void
  onScope: () => void
}) {
  const wireActive = tool === 'wire'
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
