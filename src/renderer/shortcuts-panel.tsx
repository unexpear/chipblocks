import { useEffect, useState } from 'react'
import {
  bindingFromEvent,
  bindingProblem,
  DEFAULT_KEYBINDS,
  FIXED_CONTROLS,
  KEYBIND_LABELS,
  type KeybindAction,
  type Keybinds,
} from './keybinds.ts'
import { THEME } from './theme.ts'

/**
 * The Shortcuts panel (S19-v3-62) — EVERY control in the app, in one place:
 * the rebindable keyboard shortcuts (click Change, press the new key), and
 * the complete list of mouse/tool gestures (how each tool is driven). Opened
 * from the Shortcuts menu or its own shortcut.
 */

export function ShortcutsPanel({
  binds,
  onChange,
  onClose,
  light,
}: {
  binds: Keybinds
  onChange: (next: Keybinds) => void
  onClose: () => void
  light: boolean
}) {
  // Which action is waiting for its new key press (null = none).
  const [capturing, setCapturing] = useState<KeybindAction | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (capturing === null) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setCapturing(null)
        setProblem(null)
        return
      }
      const combo = bindingFromEvent(event)
      if (combo === null) return // a bare modifier — keep waiting
      const reason = bindingProblem(binds, capturing, combo)
      if (reason !== null) {
        setProblem(reason)
        return
      }
      onChange({ ...binds, [capturing]: combo })
      setCapturing(null)
      setProblem(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, binds, onChange])

  const border = light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderSubtle}`
  const textColor = light ? THEME.borderSubtle : THEME.textPrimary
  const dimColor = light ? THEME.textFaint : THEME.textMuted
  const groups = [...new Set(FIXED_CONTROLS.map((c) => c.group))]

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        width: 560,
        maxHeight: 'calc(100% - 32px)',
        overflowY: 'auto',
        background: light ? THEME.textBright : THEME.surfaceBase,
        border,
        borderRadius: 8,
        boxShadow: '0 10px 32px rgba(0,0,0,0.5)',
        padding: '12px 16px 16px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        color: textColor,
      }}
      className="nodrag nopan cb-hide-scrollbar"
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Shortcuts & controls</div>
        <button
          type="button"
          onClick={onClose}
          title="Close (changes are already saved)"
          style={{ ...chipButton(light), marginLeft: 'auto' }}
        >
          ✕ Close
        </button>
      </div>

      <div style={{ fontWeight: 700, color: dimColor, margin: '8px 0 4px' }}>
        Keyboard — click Change, then press the new key
      </div>
      {(Object.keys(DEFAULT_KEYBINDS) as KeybindAction[]).map((action) => (
        <div
          key={action}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}
        >
          <span style={{ flex: 1 }}>{KEYBIND_LABELS[action]}</span>
          <span
            style={{
              minWidth: 92,
              textAlign: 'center',
              padding: '2px 8px',
              borderRadius: 4,
              border,
              background: light ? THEME.white : THEME.surfaceRaised,
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11,
            }}
          >
            {capturing === action ? 'press a key…' : binds[action]}
          </span>
          <button
            type="button"
            onClick={() => {
              setCapturing(capturing === action ? null : action)
              setProblem(null)
            }}
            style={chipButton(light, capturing === action)}
          >
            {capturing === action ? 'cancel' : 'Change'}
          </button>
        </div>
      ))}
      {problem !== null ? (
        <div style={{ color: THEME.statusDanger, fontSize: 11, marginTop: 4 }}>{problem}</div>
      ) : null}
      <button
        type="button"
        onClick={() => onChange({ ...DEFAULT_KEYBINDS })}
        style={{ ...chipButton(light), marginTop: 8 }}
      >
        Reset all to defaults
      </button>

      {groups.map((group) => (
        <div key={group}>
          <div style={{ fontWeight: 700, color: dimColor, margin: '12px 0 4px' }}>{group}</div>
          {FIXED_CONTROLS.filter((c) => c.group === group).map((c) => (
            <div key={c.control} style={{ display: 'flex', gap: 10, padding: '2px 0' }}>
              <span style={{ minWidth: 190, color: dimColor }}>{c.control}</span>
              <span style={{ flex: 1 }}>{c.does}</span>
            </div>
          ))}
        </div>
      ))}
      <div style={{ color: dimColor, fontSize: 10, marginTop: 10 }}>
        Mouse and tool controls are how the tools work — they aren't rebindable keys, but they all
        live here so nothing is hidden.
      </div>
    </div>
  )
}

function chipButton(light: boolean, active = false): React.CSSProperties {
  return {
    padding: '3px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'system-ui, sans-serif',
    background: active ? THEME.surfaceActive : light ? THEME.white : THEME.surfaceRaised,
    border: active
      ? `1px solid ${THEME.accentBlue}`
      : light
        ? `1px solid ${THEME.textPrimary}`
        : `1px solid ${THEME.borderSubtle}`,
    color: active ? THEME.textBright : light ? THEME.borderStrong : THEME.textSoft,
  }
}
