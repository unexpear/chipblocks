import { useEffect, useRef } from 'react'

interface AboutModalProps {
  onClose: () => void
}

const VERSION = '0.1.0-alpha'
const REPO_URL = 'https://github.com/unexpear/chipblocks'

export function AboutModal({ onClose }: AboutModalProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  // Close on Escape.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Focus management: on open, capture the trigger element so we can
  // restore focus on close, then move focus inside the dialog. On
  // unmount, return focus to the trigger.
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => {
      headingRef.current?.focus()
    })
    return () => {
      cancelAnimationFrame(raf)
      previouslyFocusedRef.current?.focus?.()
    }
  }, [])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="about-modal-title" ref={headingRef} tabIndex={-1}>About ChipBlocks</h2>
        </div>
        <div className="modal-body">
          <p className="about-tagline">
            Visual chip design for everyone. Drag blocks, wire them together, hear the chip.
          </p>
          <p className="about-version">
            Version <code>{VERSION}</code> · MIT-licensed · Built with Claude Code by a non-technical solo developer.
          </p>

          <hr className="modal-divider" />

          <h3>Where to look</h3>
          <ul className="about-links">
            <li>
              <a href={REPO_URL} target="_blank" rel="noreferrer">{REPO_URL}</a> — repo, releases, docs
            </li>
            <li>
              <a href={`${REPO_URL}/blob/master/CREDITS.md`} target="_blank" rel="noreferrer">CREDITS.md</a> — open-source attributions
            </li>
            <li>
              <a href={`${REPO_URL}/blob/master/ROADMAP.md`} target="_blank" rel="noreferrer">ROADMAP.md</a> — what's coming next
            </li>
            <li>
              <a href={`${REPO_URL}/discussions`} target="_blank" rel="noreferrer">GitHub Discussions</a> — questions and feedback
            </li>
          </ul>

          <hr className="modal-divider" />

          <h3>About the AI consultant</h3>
          <p className="modal-note">
            ChipBlocks ships <strong>BYOK</strong> — bring your own Anthropic API key, configured in Settings (⚙). Your key is encrypted via your OS keychain (Electron <code>safeStorage</code>) and never sent anywhere except Anthropic. ChipBlocks does not pay for AI inference on your behalf.
          </p>

          <div className="modal-actions">
            <button onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}
