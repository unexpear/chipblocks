import { DeviceGlyph } from './symbols.tsx'

/**
 * Tools toolbar (Sprint 19 S19-v3-10). Tools — as opposed to placeable parts —
 * live here. For now it holds the Wire tool: a wire is a connection you draw,
 * not a part you drop, so it belongs on the tool bar, not in the parts palette.
 *
 * Selecting the Wire tool locks the parts in place (nodesDraggable off in App)
 * so a drag draws a wire instead of moving a part; Select is the default.
 */

export type Tool = 'select' | 'wire'

export function ToolbarItems({ tool, onTool }: { tool: Tool; onTool: (tool: Tool) => void }) {
  const wireActive = tool === 'wire'
  return (
    <button
      type="button"
      onClick={() => onTool(wireActive ? 'select' : 'wire')}
      title="Wire tool — draw a connection between two parts' dots"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        padding: '6px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        background: wireActive ? '#24405f' : '#1b1b1f',
        border: wireActive ? '1px solid #7ab8ff' : '1px solid #2a2a2f',
        color: '#cdd6e0',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <DeviceGlyph definition="wire" />
      <span style={{ fontSize: 11 }}>Wire</span>
    </button>
  )
}
