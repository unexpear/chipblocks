import { useEffect, useMemo, useRef, useState } from 'react'
import { PARTS } from './palette.tsx'
import { DeviceGlyph } from './symbols.tsx'
import { THEME } from './theme.ts'

/**
 * Choose-a-Part pop-up (KiCad's "Choose Symbol" dialog, our version). A toolbar tool opens it; type
 * to filter, arrow-key or click through the list, and Place / Enter / double-click drops the part at
 * the centre of the view (then drag it where you like). It reuses the same PARTS list the palette
 * does, so there is one place to add a part. Esc or the backdrop closes it.
 */
export function PartPicker({
  onPick,
  onClose,
}: {
  onPick: (definition: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? PARTS.filter(
          (p) => p.label.toLowerCase().includes(q) || p.definition.toLowerCase().includes(q),
        )
      : PARTS
  }, [query])
  const selectedIndex = Math.min(index, Math.max(0, shown.length - 1))
  const selected = shown[selectedIndex]

  // Keep the highlighted row in view as the arrows move it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll whenever the selection moves
  useEffect(() => {
    rowsRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const place = (definition?: string) => {
    if (definition !== undefined) {
      onPick(definition)
      onClose()
    }
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex(Math.min(selectedIndex + 1, shown.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex(Math.max(selectedIndex - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      place(selected?.definition)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a modal backdrop click-to-close, standard
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the dialog stops backdrop clicks + carries the key handler */}
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width: 620,
          maxWidth: '92vw',
          height: 460,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          background: THEME.surfacePanel,
          border: `1px solid ${THEME.borderStrong}`,
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '11px 14px',
            borderBottom: `1px solid ${THEME.borderSubtle}`,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: THEME.textPrimary }}>
            Choose a part
          </span>
          <span style={{ marginLeft: 8, fontSize: 11.5, color: THEME.textMuted }}>
            {shown.length} of {PARTS.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              color: THEME.textMuted,
              fontSize: 18,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '10px 14px 6px' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            placeholder="Search parts… (try “mos”, “diode”, “logic”)"
            aria-label="Search parts"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 11px',
              borderRadius: 7,
              border: `1px solid ${THEME.borderStrong}`,
              background: THEME.surfaceInput,
              color: THEME.textPrimary,
              fontSize: 13,
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div
            ref={rowsRef}
            style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '4px 8px' }}
          >
            {shown.length === 0 ? (
              <div
                style={{ padding: 24, textAlign: 'center', fontSize: 12.5, color: THEME.textMuted }}
              >
                No part matches “{query}”.
              </div>
            ) : (
              shown.map((part, i) => {
                const active = i === selectedIndex
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: a selectable list row, keyboard handled at the dialog
                  <div
                    key={part.definition}
                    data-active={active}
                    onClick={() => setIndex(i)}
                    onDoubleClick={() => place(part.definition)}
                    title={`Place ${part.label}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 8px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: active ? THEME.surfaceActive : 'transparent',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 40,
                        height: 26,
                        flex: 'none',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span style={{ transform: 'scale(0.5)' }}>
                        <DeviceGlyph definition={part.definition} />
                      </span>
                    </span>
                    <span style={{ fontSize: 12.5, color: THEME.textPrimary }}>{part.label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10.5, color: THEME.textFaint }}>
                      {part.definition}
                    </span>
                  </div>
                )
              })
            )}
          </div>

          <div
            style={{
              width: 210,
              flex: 'none',
              borderLeft: `1px solid ${THEME.borderSubtle}`,
              background: THEME.surfaceBase,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: 16,
              textAlign: 'center',
            }}
          >
            {selected ? (
              <>
                <div style={{ transform: 'scale(1.4)' }}>
                  <DeviceGlyph definition={selected.definition} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: THEME.textPrimary }}>
                  {selected.label}
                </div>
                <div style={{ fontSize: 11, color: THEME.textMuted }}>{selected.definition}</div>
              </>
            ) : (
              <span style={{ fontSize: 12, color: THEME.textFaint }}>No part selected</span>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderTop: `1px solid ${THEME.borderSubtle}`,
          }}
        >
          <span style={{ fontSize: 11, color: THEME.textFaint }}>
            ↑↓ to move · Enter or double-click to place · Esc to close
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              padding: '7px 16px',
              borderRadius: 7,
              border: `1px solid ${THEME.borderStrong}`,
              background: 'transparent',
              color: THEME.textPrimary,
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => place(selected?.definition)}
            disabled={selected === undefined}
            style={{
              padding: '7px 18px',
              borderRadius: 7,
              border: `1px solid ${THEME.accentBlue}`,
              background: selected ? THEME.accentBlueDeep : THEME.surfaceRaised,
              color: selected ? THEME.white : THEME.textMuted,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: selected ? 'pointer' : 'default',
            }}
          >
            Place
          </button>
        </div>
      </div>
    </div>
  )
}
