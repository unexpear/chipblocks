import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useState,
} from 'react'

/**
 * Dockable panel (Sprint 19 S19-v3-10; dock-grid in S19-v3-12). A menu the user
 * grabs by its grip and drags; on release it snaps to the nearest window edge
 * (left / right / top / bottom). Docked, the panel is a cell of App's dock-grid,
 * so panels never overlap — the canvas and the other panels auto-adjust around
 * it. Left/right docks lay their contents in a column, top/bottom in a row, so
 * the same panel reads naturally on any edge.
 *
 * Used for both the parts palette and the tools toolbar.
 */

export type DockEdge = 'left' | 'right' | 'top' | 'bottom'

/** Nearest window edge to a point — the snap target on release. */
function nearestEdge(x: number, y: number): DockEdge {
  const candidates: Array<[DockEdge, number]> = [
    ['left', x],
    ['right', window.innerWidth - x],
    ['top', y],
    ['bottom', window.innerHeight - y],
  ]
  candidates.sort((a, b) => a[1] - b[1])
  return candidates[0]?.[0] ?? 'left'
}

export function DockablePanel({
  edge,
  onEdgeChange,
  title,
  children,
  light = false,
}: {
  edge: DockEdge
  onEdgeChange: (edge: DockEdge) => void
  title: string
  children: ReactNode
  light?: boolean
}) {
  const panelBorder = light ? '1px solid #c4c8ce' : '1px solid #2a2a2f'
  const [floatAt, setFloatAt] = useState<{ x: number; y: number } | null>(null)

  const startDrag = (down: ReactPointerEvent) => {
    down.preventDefault()
    down.stopPropagation()
    const move = (ev: PointerEvent) => setFloatAt({ x: ev.clientX, y: ev.clientY })
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setFloatAt(null)
      onEdgeChange(nearestEdge(ev.clientX, ev.clientY))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const horizontal = edge === 'top' || edge === 'bottom'
  // Docked = a cell of App's dock-grid (gridArea) so panels never overlap and the
  // layout auto-adjusts; while dragging, the panel floats free at the cursor.
  const placement: CSSProperties = floatAt
    ? { position: 'fixed', left: floatAt.x - 24, top: floatAt.y - 12, zIndex: 30 }
    : { gridArea: edge, position: 'relative', zIndex: 20 }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: horizontal ? 'row' : 'column',
        alignItems: 'stretch',
        // Bound to the dock cell (min-height/width: 0 lets the grid track shrink)
        // so an overflowing panel scrolls its content instead of spilling.
        minHeight: 0,
        minWidth: 0,
        background: light ? '#e8eaed' : '#141417',
        border: panelBorder,
        boxShadow: floatAt ? '0 6px 20px rgba(0,0,0,0.5)' : 'none',
        opacity: floatAt ? 0.9 : 1,
        ...placement,
      }}
    >
      <div
        onPointerDown={startDrag}
        title="Drag to move — snaps to a window edge"
        style={{
          cursor: 'grab',
          color: light ? '#555' : '#8a93a0',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'system-ui, sans-serif',
          userSelect: 'none',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: horizontal ? '0 10px' : '8px 6px',
          borderRight: horizontal ? panelBorder : undefined,
          borderBottom: horizontal ? undefined : panelBorder,
        }}
      >
        <span aria-hidden style={{ letterSpacing: -1 }}>
          ⠿
        </span>
        {title}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: horizontal ? 'row' : 'column',
          // Fill the space left by the grip and scroll when content overflows the
          // dock cell (min-0 lets this flex child shrink below its content size).
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          gap: 8,
          padding: 8,
          alignItems: 'center',
          overflow: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  )
}
