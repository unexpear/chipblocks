import { Fragment, useEffect, useState } from 'react'
import { THEME } from './theme.ts'

/**
 * A small right-click menu, shared by the Schematic Hierarchy rows and the canvas parts (so the part
 * actions live in one place). The caller owns the position + the item list and closes it; Esc or a
 * click anywhere outside closes it too. A `danger` item is tinted and gets a divider above it.
 */
export type ContextMenuItem = {
  label: string
  shortcut?: string
  action: () => void
  danger?: boolean
  /** Greyed and unclickable (e.g. Paste with an empty clipboard). */
  disabled?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1999,
          background: 'transparent',
          border: 'none',
          cursor: 'default',
        }}
      />
      <div
        style={{
          position: 'fixed',
          left: Math.min(x, window.innerWidth - 170),
          top: Math.min(y, window.innerHeight - (items.length * 30 + 24)),
          zIndex: 2000,
          minWidth: 152,
          padding: 4,
          background: THEME.surfacePanel,
          border: `1px solid ${THEME.borderStrong}`,
          borderRadius: 7,
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        }}
      >
        {items.map((item) => (
          <Fragment key={item.label}>
            {item.danger ? (
              <div style={{ height: 1, background: THEME.borderSubtle, margin: '3px 6px' }} />
            ) : null}
            <button
              type="button"
              disabled={item.disabled === true}
              onClick={() => {
                item.action()
                onClose()
              }}
              onMouseEnter={() => setHovered(item.label)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: '5px 9px',
                border: 'none',
                borderRadius: 5,
                cursor: item.disabled ? 'default' : 'pointer',
                textAlign: 'left',
                fontSize: 12,
                fontFamily: 'system-ui, sans-serif',
                color: item.disabled
                  ? THEME.textFaint
                  : item.danger
                    ? THEME.statusDanger
                    : THEME.textPrimary,
                background:
                  hovered === item.label && item.disabled !== true
                    ? THEME.surfaceActive
                    : 'transparent',
              }}
            >
              <span>{item.label}</span>
              {item.shortcut !== undefined ? (
                <span style={{ marginLeft: 'auto', color: THEME.textFaint, fontSize: 10 }}>
                  {item.shortcut}
                </span>
              ) : null}
            </button>
          </Fragment>
        ))}
      </div>
    </>
  )
}
