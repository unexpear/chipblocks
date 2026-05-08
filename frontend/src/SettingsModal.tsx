import { useEffect, useState } from 'react'

interface SettingsModalProps {
  hasApiKey: boolean
  onClose: () => void
  onKeyChanged: () => void
}

// Available Claude model IDs and human-readable labels.
// `claude-sonnet-4-6` is the default per the Sprint 3 research:
// best speed/quality balance for chat.
export const MODEL_OPTIONS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fastest, cheapest' },
  { id: 'claude-sonnet-4-6',          label: 'Sonnet 4.6 — recommended' },
  { id: 'claude-opus-4-7',            label: 'Opus 4.7 — smartest, slowest' },
] as const

export const DEFAULT_MODEL = 'claude-sonnet-4-6'
const MODEL_STORAGE_KEY = 'chipblocks:model'

export function getStoredModel(): string {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY)
    if (stored && MODEL_OPTIONS.some((m) => m.id === stored)) return stored
  } catch {
    // localStorage might be unavailable; fall through.
  }
  return DEFAULT_MODEL
}

function setStoredModel(id: string) {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, id)
  } catch {
    // Best-effort; ignore.
  }
}

export function SettingsModal({ hasApiKey, onClose, onKeyChanged }: SettingsModalProps) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [model, setModel] = useState<string>(getStoredModel())

  // Close on Escape.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const save = async () => {
    if (!key.trim()) return
    setBusy(true)
    setStatus(null)
    try {
      await window.ai.saveKey(key.trim())
      setKey('')
      setStatus({ kind: 'ok', msg: 'Key saved.' })
      onKeyChanged()
    } catch (err) {
      setStatus({ kind: 'err', msg: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    setStatus(null)
    try {
      await window.ai.clearKey()
      setStatus({ kind: 'ok', msg: 'Key cleared.' })
      onKeyChanged()
    } catch (err) {
      setStatus({ kind: 'err', msg: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const onModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value
    setModel(id)
    setStoredModel(id)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="chat-icon-btn" onClick={onClose} title="Close">×</button>
        </div>

        <div className="modal-body">
          <h3>Anthropic API key</h3>
          <p className="modal-note">
            ChipBlocks uses your own key to talk to Claude (BYOK). Your key is encrypted by your OS keychain (Electron <code>safeStorage</code> — Keychain on macOS, DPAPI on Windows, libsecret on Linux) and never leaves the main process except to call <code>api.anthropic.com</code>. Get a key at{' '}
            <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>.
          </p>

          <p className="modal-status">
            Current status:{' '}
            {hasApiKey ? (
              <span className="modal-status-ok">✓ Key configured</span>
            ) : (
              <span className="modal-status-missing">No key configured</span>
            )}
          </p>

          <label className="modal-label">
            New API key
            <input
              type="password"
              className="modal-input"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <div className="modal-actions">
            <button onClick={save} disabled={busy || !key.trim()}>Save key</button>
            {hasApiKey && (
              <button onClick={clear} disabled={busy} className="modal-danger">Clear stored key</button>
            )}
          </div>

          {status && (
            <p className={`modal-status-msg modal-status-${status.kind}`}>
              {status.msg}
            </p>
          )}

          <hr className="modal-divider" />

          <h3>Model</h3>
          <p className="modal-note">
            Which Claude model the consultant uses. Sonnet 4.6 is the recommended default. Haiku is faster and cheaper; Opus is smarter but slower and pricier. Your choice persists in <code>localStorage</code>.
          </p>
          <label className="modal-label">
            Selected model
            <select className="modal-input" value={model} onChange={onModelChange}>
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>

          <div className="modal-actions">
            <span className="chat-spacer" />
            <button onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}
