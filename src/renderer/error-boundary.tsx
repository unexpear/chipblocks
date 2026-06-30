import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

// Self-contained inline styles on purpose: the fallback must render even if the theme / CSS is what broke.
const panel: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  padding: 32,
  background: '#1a1a1e',
  color: '#e6e6ea',
  fontFamily: 'system-ui, sans-serif',
  zIndex: 99999,
}
const trace: CSSProperties = {
  maxWidth: 760,
  maxHeight: 260,
  overflow: 'auto',
  margin: 0,
  padding: 12,
  background: '#0e0e11',
  color: '#ff9b9b',
  borderRadius: 6,
  fontFamily: 'monospace',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
}
const button: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: '1px solid #444',
  background: '#2a2a30',
  color: '#e6e6ea',
  cursor: 'pointer',
  fontSize: 13,
}

/**
 * Catches a render-time crash anywhere below it so a single bad component (a malformed edge, a NaN in a
 * layout calc, a stale node reference) shows a RECOVERABLE panel instead of white-screening the whole
 * editor. React requires a class component here — getDerivedStateFromError / componentDidCatch have no
 * hook equivalent. "Try again" re-renders the subtree (recovers a transient error); "Reload" reloads the
 * renderer from scratch.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer crashed:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    return (
      <div style={panel} role="alert">
        <h2 style={{ margin: 0 }}>Something went wrong rendering the editor</h2>
        <pre style={trace}>{error.stack ?? error.message}</pre>
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" style={button} onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button type="button" style={button} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}
