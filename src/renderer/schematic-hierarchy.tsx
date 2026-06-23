import { useState } from 'react'
import { ContextMenu } from './context-menu.tsx'
import { DeviceGlyph } from './symbols.tsx'
import { THEME } from './theme.ts'

/**
 * Schematic Hierarchy panel (KiCad's, our version) — an outline of the circuit: a Root with every
 * part and block on the sheet beneath it. Left-click a row to select that part (which fills the
 * Properties panel below); right-click for the part actions (locate / copy / delete). Rotate is left
 * to the canvas part's own right-click menu, where you can see what you're turning. This pair replaces
 * the old Parts palette, now that parts are added from the toolbar's Add-Part pop-up.
 */
export type HierarchyNode = {
  id: string
  definition: string
  blockName: string | undefined
  selected: boolean
}

export function SchematicHierarchy({
  nodes,
  onSelect,
  onCopy,
  onDelete,
  onLocate,
}: {
  nodes: HierarchyNode[]
  onSelect: (id: string) => void
  onCopy: () => void
  onDelete: () => void
  /** Centre the canvas on the part — navigate to it from the outline. */
  onLocate: (id: string) => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)

  return (
    <div
      style={{ fontFamily: 'system-ui, sans-serif', fontSize: 12, padding: 4, userSelect: 'none' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 6px',
          color: THEME.textPrimary,
        }}
      >
        <span aria-hidden style={{ color: THEME.accentBlueSoft, fontSize: 10 }}>
          ▾
        </span>
        <span style={{ fontWeight: 600 }}>Schematic</span>
        <span style={{ color: THEME.textFaint, fontSize: 10 }}>· {nodes.length}</span>
      </div>
      {nodes.length === 0 ? (
        <div style={{ padding: '6px 20px', color: THEME.textMuted, fontSize: 11 }}>
          Empty — add parts and they appear here.
        </div>
      ) : (
        nodes.map((node) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: a selectable outline row
          // biome-ignore lint/a11y/useKeyWithClickEvents: mouse-driven outline row; keyboard nav is future work
          <div
            key={node.id}
            onClick={() => onSelect(node.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              onSelect(node.id)
              setMenu({ x: e.clientX, y: e.clientY, id: node.id })
            }}
            title={`${node.id} — click to select, right-click for actions`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '3px 6px 3px 18px',
              cursor: 'pointer',
              borderRadius: 4,
              background: node.selected ? THEME.surfaceActive : 'transparent',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 22,
                height: 13,
                flex: 'none',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {node.blockName !== undefined ? (
                <span style={{ color: THEME.accentPurple, fontSize: 12 }}>⧉</span>
              ) : (
                <span style={{ transform: 'scale(0.3)' }}>
                  <DeviceGlyph definition={node.definition} />
                </span>
              )}
            </span>
            <span style={{ color: THEME.textPrimary }}>{node.id}</span>
            <span style={{ marginLeft: 'auto', color: THEME.textFaint, fontSize: 10 }}>
              {node.blockName ?? node.definition}
            </span>
          </div>
        ))
      )}

      {menu !== null ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Locate', action: () => onLocate(menu.id) },
            { label: 'Copy', shortcut: 'Ctrl+C', action: onCopy },
            { label: 'Delete', shortcut: 'Del', action: onDelete, danger: true },
          ]}
        />
      ) : null}
    </div>
  )
}
