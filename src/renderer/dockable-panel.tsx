import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useState,
} from 'react'

/**
 * Dockable panel (Sprint 19 S19-v3-10). A floating menu the user grabs by its
 * grip and drags; on release it snaps to the nearest window edge (left / right /
 * top / bottom). Left/right docks lay their contents in a column, top/bottom in
 * a row, so the same panel reads naturally on any edge.
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

function edgePosition(edge: DockEdge): CSSProperties {
  switch (edge) {
    case 'left':
      return { left: 0, top: 0, bottom: 0 }
    case 'right':
      return { right: 0, top: 0, bottom: 0 }
    case 'top':
      return { top: 0, left: 0, right: 0 }
    case 'bottom':
      return { bottom: 0, left: 0, right: 0 }
  }
}

export function DockablePanel({
  edge,
  onEdgeChange,
  title,
  children,
}: {
  edge: DockEdge
  onEdgeChange: (edge: DockEdge) => void
  title: string
  children: ReactNode
}) {
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
  const position: CSSProperties = floatAt
    ? { left: floatAt.x - 24, top: floatAt.y - 12 }
    : edgePosition(edge)

  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 20,
        display: 'flex',
        flexDirection: horizontal ? 'row' : 'column',
        alignItems: 'stretch',
        background: '#141417',
        border: '1px solid #2a2a2f',
        boxShadow: floatAt ? '0 6px 20px rgba(0,0,0,0.5)' : 'none',
        opacity: floatAt ? 0.9 : 1,
        ...position,
      }}
    >
      <div
        onPointerDown={startDrag}
        title="Drag to move — snaps to a window edge"
        style={{
          cursor: 'grab',
          color: '#8a93a0',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'system-ui, sans-serif',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: horizontal ? '0 10px' : '8px 6px',
          borderRight: horizontal ? '1px solid #2a2a2f' : undefined,
          borderBottom: horizontal ? undefined : '1px solid #2a2a2f',
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
