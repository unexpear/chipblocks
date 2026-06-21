import type { ClipboardItem, ClipboardState } from './clipboard.ts'
import { THEME } from './theme.ts'

/**
 * Clipboard panel (S19-v3-69) — the Win+V idea for parts: every slot the
 * clipboard holds (the one cut, pinned on top, then up to 15 copies, newest
 * first). Click a slot to paste THAT item; plain Ctrl+V always pastes the
 * newest. Purely a view — the App owns the state and the pasting.
 */
export function ClipboardPanel({
  clipboard,
  onPaste,
  onClose,
  light,
}: {
  clipboard: ClipboardState
  onPaste: (item: ClipboardItem) => void
  onClose: () => void
  light: boolean
}) {
  const empty = clipboard.cut === null && clipboard.copies.length === 0
  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 12,
        zIndex: 40,
        width: 264,
        maxHeight: '70%',
        overflowY: 'auto',
        background: light ? THEME.textBright : THEME.surfaceBase,
        border: `1px solid ${THEME.borderStrong}`,
        borderRadius: 8,
        padding: 10,
        fontFamily: 'system-ui, sans-serif',
        color: light ? THEME.surfaceRaised : THEME.textPrimary,
        boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          📋 Clipboard — click an item to paste it
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{ ...slotButton(light), marginLeft: 'auto', width: 'auto', padding: '2px 8px' }}
        >
          ✕
        </button>
      </div>

      {empty ? (
        <div style={{ fontSize: 11, opacity: 0.7, padding: '6px 2px' }}>
          Nothing here yet — select parts, then Ctrl+C to copy (keeps the last 15) or Ctrl+X to cut
          (one at a time).
        </div>
      ) : null}

      {clipboard.cut !== null ? (
        <button
          type="button"
          onClick={() => onPaste(clipboard.cut as ClipboardItem)}
          title="The one cut at a time — these parts were removed from the canvas and live only here until pasted (cutting again replaces them)"
          style={{ ...slotButton(light), borderColor: THEME.statusWarn }}
        >
          <span style={{ color: THEME.statusWarn, marginRight: 6 }}>✂</span>
          {clipboard.cut.label}
          <span style={{ marginLeft: 'auto', opacity: 0.6, fontSize: 10 }}>cut</span>
        </button>
      ) : null}

      {clipboard.copies.map((item, index) => (
        <button
          key={item.stamp}
          type="button"
          onClick={() => onPaste(item)}
          title="Paste this copy at the canvas center"
          style={slotButton(light)}
        >
          <span style={{ opacity: 0.55, marginRight: 6 }}>{index + 1}.</span>
          {item.label}
          <span style={{ marginLeft: 'auto', opacity: 0.6, fontSize: 10 }}>
            {item.nodes.length} part{item.nodes.length === 1 ? '' : 's'}
          </span>
        </button>
      ))}
    </div>
  )
}

function slotButton(light: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    textAlign: 'left',
    fontSize: 11,
    fontFamily: 'system-ui, sans-serif',
    color: light ? THEME.surfaceRaised : THEME.textPrimary,
    background: light ? THEME.white : THEME.surfaceRaised,
    border: `1px solid ${THEME.borderSubtle}`,
    borderRadius: 6,
    padding: '6px 8px',
    marginBottom: 4,
    cursor: 'pointer',
  }
}
