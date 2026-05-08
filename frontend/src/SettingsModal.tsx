import { useEffect, useState } from 'react'

interface SettingsModalProps {
  hasApiKey: boolean
  onClose: () => void
  onKeyChanged: () => void
}

export function SettingsModal({ hasApiKey, onClose, onKeyChanged }: SettingsModalProps) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

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
            <span className="chat-spacer" />
            <button onClick={onClose}>Close</button>
          </div>

          {status && (
            <p className={`modal-status-msg modal-status-${status.kind}`}>
              {status.msg}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
