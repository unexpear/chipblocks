import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useState,
} from 'react'
import './canvas-animations.css'

/**
 * Dockable panel (Sprint 19 S19-v3-10; dock-grid S19-v3-12; tab stacks Sprint 21).
 * A panel the user grabs by its grip/tab and drags. On release it either SNAPS to
 * the nearest window edge (left / right / top / bottom) — a cell of App's dock-grid,
 * so panels never overlap — OR, if dropped onto another panel, STACKS into a tabbed
 * group with it. A group of one renders as a plain panel (grip + content); a group
 * of two-plus renders a tab bar, one tab's content visible at a time. Dragging a tab
 * out onto an edge pops it back into its own panel.
 *
 * App owns the grouping (panel-groups.ts) and the content; this renders one group.
 */

export type DockEdge = 'left' | 'right' | 'top' | 'bottom'

/** Where a dragged tab was dropped: onto another panel (stack) or onto an edge (dock). */
export type TabDropTarget = { kind: 'panel'; targetId: string } | { kind: 'edge'; edge: DockEdge }

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
  tabs,
  activeId,
  onActivate,
  onTabDrop,
  children,
  light = false,
}: {
  edge: DockEdge
  tabs: { id: string; title: string }[]
  activeId: string
  onActivate: (id: string) => void
  onTabDrop: (tabId: string, target: TabDropTarget) => void
  children: ReactNode
  light?: boolean
}) {
  const panelBorder = light ? '1px solid #c4c8ce' : '1px solid #2a2a2f'
  const [floatAt, setFloatAt] = useState<{ x: number; y: number } | null>(null)

  // A tab is both a click target (activate) and a drag handle (stack / pop / move).
  const startTabDrag = (tabId: string) => (down: ReactPointerEvent) => {
    down.preventDefault()
    down.stopPropagation()
    let moved = false
    const move = (ev: PointerEvent) => {
      moved = true
      setFloatAt({ x: ev.clientX, y: ev.clientY })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setFloatAt(null)
      if (!moved) {
        onActivate(tabId)
        return
      }
      // The floating panel is pointer-transparent while dragging, so this reads the
      // panel BENEATH the cursor — another group's frame, or nothing (an edge).
      const frame = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-panel-dock]')
      const targetId = frame?.getAttribute('data-panel-dock') ?? null
      if (targetId && tabs.some((t) => t.id === targetId)) return // dropped on our own frame
      if (targetId) onTabDrop(tabId, { kind: 'panel', targetId })
      else onTabDrop(tabId, { kind: 'edge', edge: nearestEdge(ev.clientX, ev.clientY) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const grouped = tabs.length > 1
  const horizontal = edge === 'top' || edge === 'bottom'
  // Docked = a cell of App's dock-grid (gridArea) so panels never overlap and the
  // layout auto-adjusts; while dragging, the panel floats free at the cursor and is
  // pointer-transparent so drop-detection can see the panel underneath it.
  const placement: CSSProperties = floatAt
    ? {
        position: 'fixed',
        left: floatAt.x - 24,
        top: floatAt.y - 12,
        zIndex: 30,
        pointerEvents: 'none',
      }
    : { gridArea: edge, position: 'relative', zIndex: 20 }
  // A single panel keeps its original toolbar shape (grip on the edge); a stack always
  // reads top-down: tab bar, then the active tab's content.
  const column = grouped || !horizontal

  const gripBase: CSSProperties = {
    color: light ? '#555' : '#8a93a0',
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'system-ui, sans-serif',
    userSelect: 'none',
    flexShrink: 0,
  }
  const tabStyle = (active: boolean): CSSProperties => ({
    ...gripBase,
    cursor: 'grab',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 10px',
    color: active ? (light ? '#111' : '#e6ebf2') : light ? '#888' : '#697079',
    background: active ? (light ? '#dde0e4' : '#1c1c21') : 'transparent',
    borderBottom: `2px solid ${active ? (light ? '#3577c8' : '#5b8cff') : 'transparent'}`,
  })

  return (
    <div
      data-panel-dock={activeId}
      style={{
        display: 'flex',
        flexDirection: column ? 'column' : 'row',
        alignItems: 'stretch',
        minHeight: 0,
        minWidth: 0,
        background: light ? '#e8eaed' : '#141417',
        border: panelBorder,
        boxShadow: floatAt ? '0 6px 20px rgba(0,0,0,0.5)' : 'none',
        opacity: floatAt ? 0.9 : 1,
        ...placement,
      }}
    >
      {grouped ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            flexShrink: 0,
            borderBottom: panelBorder,
          }}
        >
          {tabs.map((t) => (
            <div
              key={t.id}
              onPointerDown={startTabDrag(t.id)}
              title="Drag a tab out to an edge to pop it back into its own panel"
              style={tabStyle(t.id === activeId)}
            >
              {t.title}
            </div>
          ))}
        </div>
      ) : (
        <div
          onPointerDown={startTabDrag(activeId)}
          title="Drag to move — snaps to an edge, or drop onto a panel to stack"
          style={{
            ...gripBase,
            cursor: 'grab',
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
          {tabs[0]?.title}
        </div>
      )}
      <div
        className="cb-scroll-hidden"
        style={{
          display: 'flex',
          flexDirection: column ? 'column' : 'row',
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
