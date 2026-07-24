import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { PARTS } from './palette.tsx'
import { categoryLabelOf, categoryOf, keywordsFor, orderedCategories } from './part-categories.ts'
import { type SearchItem, searchParts } from './part-search.ts'
import { DeviceGlyph } from './symbols.tsx'
import { THEME } from './theme.ts'
import { getUserPartsSnapshot, subscribeUserParts } from './user-parts.ts'
import type { WorkspaceMode } from './workspace.ts'

/**
 * Choose-a-Part pop-up (KiCad's "Choose Symbol" dialog, our version). A toolbar tool opens it; type
 * to filter, arrow-key or click through the list, and Place / Enter / double-click drops the part at
 * the centre of the view (then drag it where you like). Esc or the backdrop closes it.
 *
 * What it shows and in what order:
 *  - Every placeable part — the built-in PARTS plus the catalog commercial devices and any user-authored
 *    part, merged from the same live registry the palette reads.
 *  - When you're just browsing (empty box) they're grouped under section headers ("Transistors",
 *    "ICs & modules", …) ordered so the sections you reach for at the CURRENT level float to the top.
 *  - When you type, it switches to a flat, best-first ranked list with the matched letters bolded — a
 *    real fuzzy match (subsequence + scoring), so "hadd" finds "Half Adder" and "mosfet" finds "NMOS".
 */
type Entry = { definition: string; label: string; category: string; keywords: string }

/** A rendered row: a section header (skipped by the arrow keys) or a placeable part (selectable). */
type Row =
  | { kind: 'header'; id: string; label: string }
  | { kind: 'part'; definition: string; label: string; highlight: number[] }

/** Bold the matched characters of a label (positions come from the same match that ranked it). */
function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (positions.length === 0) return <>{text}</>
  const marked = new Set(positions)
  return (
    <>
      {Array.from(text).map((ch, i) =>
        marked.has(i) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: character index is the stable identity here
          <b key={i} style={{ color: THEME.accentBlue, fontWeight: 700 }}>
            {ch}
          </b>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: character index is the stable identity here
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  )
}

export function PartPicker({
  onPick,
  onClose,
  level,
}: {
  onPick: (definition: string) => void
  onClose: () => void
  level: WorkspaceMode
}) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  // Every placeable part, once: the built-ins plus catalog + user-authored parts from the live registry.
  const userParts = useSyncExternalStore(
    subscribeUserParts,
    getUserPartsSnapshot,
    getUserPartsSnapshot, // server snapshot === client snapshot (the registry is the same in both)
  )
  const entries: Entry[] = useMemo(() => {
    const map = new Map<string, Entry>()
    for (const part of PARTS) {
      map.set(part.definition, {
        definition: part.definition,
        label: part.label,
        category: categoryOf(part.definition),
        keywords: keywordsFor(part.definition),
      })
    }
    for (const part of userParts) {
      if (map.has(part.id)) continue // a built-in of the same id wins
      map.set(part.id, {
        definition: part.id,
        label: part.name,
        category: categoryOf(part.id),
        keywords: keywordsFor(part.id),
      })
    }
    return [...map.values()]
  }, [userParts])

  // Browse (empty query) → grouped, level-ordered. Typed query → flat, best-first ranked with highlights.
  const rows: Row[] = useMemo(() => {
    const q = query.trim()
    if (q) {
      const items: SearchItem[] = entries.map((e) => ({
        definition: e.definition,
        label: e.label,
        haystack: `${e.definition} ${e.keywords} ${categoryLabelOf(e.category)}`,
      }))
      const byId = new Map(entries.map((e) => [e.definition, e]))
      return searchParts(q, items).map((r) => ({
        kind: 'part',
        definition: r.definition,
        label: byId.get(r.definition)?.label ?? r.definition,
        highlight: r.highlight,
      }))
    }
    const byCat = new Map<string, Entry[]>()
    for (const e of entries) {
      const list = byCat.get(e.category)
      if (list) list.push(e)
      else byCat.set(e.category, [e])
    }
    const out: Row[] = []
    for (const cat of orderedCategories(level)) {
      const list = byCat.get(cat.id)
      if (!list || list.length === 0) continue
      out.push({ kind: 'header', id: cat.id, label: cat.label })
      for (const e of list)
        out.push({ kind: 'part', definition: e.definition, label: e.label, highlight: [] })
    }
    return out
  }, [query, entries, level])

  // The row indices the arrows may land on (headers are skipped) — selection is a position within this.
  const selectableRowIndices = useMemo(() => {
    const indices: number[] = []
    rows.forEach((row, i) => {
      if (row.kind === 'part') indices.push(i)
    })
    return indices
  }, [rows])
  const count = selectableRowIndices.length
  const selPos = count === 0 ? 0 : Math.min(sel, count - 1)
  const activeRowIndex = selectableRowIndices[selPos] ?? -1
  const activeRow = rows[activeRowIndex]
  const selectedDefinition = activeRow?.kind === 'part' ? activeRow.definition : undefined
  const selectedLabel = activeRow?.kind === 'part' ? activeRow.label : undefined

  // Keep the highlighted row in view as the selection moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll whenever the active row moves
  useEffect(() => {
    rowsRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeRowIndex])

  const place = (definition?: string) => {
    if (definition === undefined) return
    onPick(definition)
    onClose()
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (count > 0) setSel((selPos + 1) % count) // wrap around, like a launcher
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (count > 0) setSel((selPos - 1 + count) % count)
    } else if (event.key === 'Home' && !query) {
      // browse-mode only; with a query present, leave Home/End to move the text caret
      event.preventDefault()
      setSel(0)
    } else if (event.key === 'End' && !query) {
      event.preventDefault()
      setSel(Math.max(0, count - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      place(selectedDefinition)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (query) {
        setQuery('') // first Esc clears the query, second closes
        setSel(0) // back to the top, like the × clear button and typing do
      } else onClose()
    }
  }

  const listId = 'part-picker-list'

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a modal backdrop click-to-close, standard
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close; Escape handled by the keydown handler
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
          <span
            aria-live="polite"
            style={{ marginLeft: 8, fontSize: 11.5, color: THEME.textMuted }}
          >
            {query ? `${count} of ${entries.length}` : `${entries.length} parts`}
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

        <div style={{ padding: '10px 14px 6px', position: 'relative' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSel(0)
            }}
            placeholder="Search parts… (try “mosfet”, “adder”, “fpga”)"
            aria-label="Search parts"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={
              selectedDefinition ? `part-picker-row-${selectedDefinition}` : undefined
            }
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 30px 8px 11px',
              borderRadius: 7,
              border: `1px solid ${THEME.borderStrong}`,
              background: THEME.surfaceInput,
              color: THEME.textPrimary,
              fontSize: 13,
              outline: 'none',
            }}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('')
                setSel(0)
                inputRef.current?.focus()
              }}
              style={{
                position: 'absolute',
                right: 22,
                top: '50%',
                transform: 'translateY(-50%)',
                border: 'none',
                background: 'transparent',
                color: THEME.textMuted,
                fontSize: 15,
                cursor: 'pointer',
                lineHeight: 1,
                padding: 2,
              }}
            >
              ×
            </button>
          ) : null}
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div
            ref={rowsRef}
            id={listId}
            role="listbox"
            aria-label="Parts"
            style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '4px 8px' }}
          >
            {count === 0 ? (
              <div
                style={{ padding: 24, textAlign: 'center', fontSize: 12.5, color: THEME.textMuted }}
              >
                No part matches “{query}”.
              </div>
            ) : (
              rows.map((row, i) => {
                if (row.kind === 'header') {
                  return (
                    <div
                      key={`header-${row.id}`}
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: 0.5,
                        textTransform: 'uppercase',
                        color: THEME.textMuted,
                        padding: '9px 8px 3px',
                      }}
                    >
                      {row.label}
                    </div>
                  )
                }
                const active = i === activeRowIndex
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: a selectable list row, keyboard handled at the dialog
                  <div
                    key={row.definition}
                    id={`part-picker-row-${row.definition}`}
                    role="option"
                    aria-selected={active}
                    aria-label={row.label}
                    tabIndex={-1}
                    data-active={active}
                    onClick={() => {
                      const pos = selectableRowIndices.indexOf(i)
                      if (pos >= 0) setSel(pos)
                    }}
                    onDoubleClick={() => place(row.definition)}
                    title={`Place ${row.label}`}
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
                        <DeviceGlyph definition={row.definition} />
                      </span>
                    </span>
                    <span style={{ fontSize: 12.5, color: THEME.textPrimary }}>
                      <Highlighted text={row.label} positions={row.highlight} />
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 10.5, color: THEME.textFaint }}>
                      {row.definition}
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
            {selectedDefinition ? (
              <>
                <div style={{ transform: 'scale(1.4)' }}>
                  <DeviceGlyph definition={selectedDefinition} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: THEME.textPrimary }}>
                  {selectedLabel}
                </div>
                <div style={{ fontSize: 11, color: THEME.textMuted }}>{selectedDefinition}</div>
                {activeRow?.kind === 'part' ? (
                  <div style={{ fontSize: 10.5, color: THEME.textFaint }}>
                    {categoryLabelOf(categoryOf(selectedDefinition))}
                  </div>
                ) : null}
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
            ↑↓ move · Home/End jump · Enter or double-click to place · Esc to clear or close
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
            onClick={() => place(selectedDefinition)}
            disabled={selectedDefinition === undefined}
            style={{
              padding: '7px 18px',
              borderRadius: 7,
              border: `1px solid ${THEME.accentBlue}`,
              background: selectedDefinition ? THEME.accentBlueDeep : THEME.surfaceRaised,
              color: selectedDefinition ? THEME.white : THEME.textMuted,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: selectedDefinition ? 'pointer' : 'default',
            }}
          >
            Place
          </button>
        </div>
      </div>
    </div>
  )
}
