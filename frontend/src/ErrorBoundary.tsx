import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  // Optional label shown in the fallback so the user knows which
  // surface broke (e.g. "Canvas" vs "Chat").
  surface?: string
}

interface State {
  error: Error | null
}

// Renderer error boundary. A2 from the 2026-05-08 tech-debt audit:
// without this, a render-time exception inside any block component
// (a malformed `data` field, a React Flow update with stale props,
// etc.) propagates up to the React root and unmounts the whole tree
// — the user sees a blank canvas with no recovery path. This bounds
// the blast radius to the wrapped subtree and offers a Reload button.
//
// React's contract: error boundaries must be class components.
// `getDerivedStateFromError` updates state synchronously so the
// fallback renders instead of the broken subtree;
// `componentDidCatch` logs to the console for dev-mode debugging.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    console.error('[ChipBlocks ErrorBoundary]', error, info)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    const { surface } = this.props
    return (
      <div className="error-boundary" role="alert">
        <h2>Something broke{surface ? ` in ${surface}` : ''}.</h2>
        <p>An unexpected error stopped this part of the app. Reload to start fresh — your save file is unaffected.</p>
        <pre className="error-boundary-message">{this.state.error.message}</pre>
        <button onClick={() => window.location.reload()}>Reload ChipBlocks</button>
      </div>
    )
  }
}
