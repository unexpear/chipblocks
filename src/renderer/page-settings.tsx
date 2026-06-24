import { type CSSProperties, useEffect } from 'react'
import type { SheetOrientation, SheetSettings, SheetSize } from './sheet-frame.tsx'
import { THEME } from './theme.ts'

/**
 * Page Settings — the KiCad-style dialog for the drawing sheet: pick the paper size + orientation,
 * toggle the sheet on/off, and fill the ISO 7200 title-block fields (title, company, revision, date,
 * comment). The sheet itself (sheet-frame.tsx) renders from this; App owns the state + persistence.
 */

const SIZES: SheetSize[] = ['A4', 'A3', 'A2', 'Letter']

const field: CSSProperties = {
  background: THEME.surfaceInput,
  border: `1px solid ${THEME.borderStrong}`,
  color: THEME.textPrimary,
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: 12,
  width: '100%',
}
const labelStyle: CSSProperties = {
  fontSize: 10,
  color: THEME.textFaint,
  marginBottom: 2,
  display: 'block',
}

export function PageSettings({
  settings,
  showSheet,
  onChange,
  onToggleSheet,
  onClose,
}: {
  settings: SheetSettings
  showSheet: boolean
  onChange: (next: SheetSettings) => void
  onToggleSheet: (show: boolean) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (patch: Partial<SheetSettings>) => onChange({ ...settings, ...patch })
  const labelled = (label: string, control: React.JSX.Element) => (
    <div style={{ display: 'block' }}>
      <span style={labelStyle}>{label}</span>
      {control}
    </div>
  )

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2099,
          background: 'rgba(0,0,0,0.45)',
          border: 'none',
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 2100,
          width: 360,
          padding: 16,
          background: THEME.surfacePanel,
          border: `1px solid ${THEME.borderStrong}`,
          borderRadius: 9,
          boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: THEME.textBright }}>
            Page Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              color: THEME.textMuted,
              fontSize: 17,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: THEME.textPrimary,
          }}
        >
          <input
            type="checkbox"
            checked={showSheet}
            onChange={(e) => onToggleSheet(e.target.checked)}
          />
          Show the drawing sheet
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          {labelled(
            'Paper size',
            <select
              value={settings.size}
              onChange={(e) => set({ size: e.target.value as SheetSize })}
              style={field}
            >
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>,
          )}
          {labelled(
            'Orientation',
            <select
              value={settings.orientation}
              onChange={(e) => set({ orientation: e.target.value as SheetOrientation })}
              style={field}
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>,
          )}
        </div>

        {labelled(
          'Title',
          <input
            value={settings.title}
            placeholder="(drawing title)"
            onChange={(e) => set({ title: e.target.value })}
            style={field}
          />,
        )}
        {labelled(
          'Company',
          <input
            value={settings.company}
            onChange={(e) => set({ company: e.target.value })}
            style={field}
          />,
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {labelled(
            'Revision',
            <input
              value={settings.rev}
              onChange={(e) => set({ rev: e.target.value })}
              style={field}
            />,
          )}
          {labelled(
            'Date',
            <input
              value={settings.date}
              placeholder="YYYY-MM-DD"
              onChange={(e) => set({ date: e.target.value })}
              style={field}
            />,
          )}
        </div>
        {labelled(
          'Comment',
          <input
            value={settings.comment}
            onChange={(e) => set({ comment: e.target.value })}
            style={field}
          />,
        )}

        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 4,
            alignSelf: 'flex-end',
            padding: '5px 14px',
            background: THEME.accentBlue,
            color: THEME.textBright,
            border: 'none',
            borderRadius: 5,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>
    </>
  )
}
