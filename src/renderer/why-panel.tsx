import type { CSSProperties, JSX } from 'react'
import type { RuntimeWhySystem } from '../runtime-contracts.ts'

const stateColor: Record<RuntimeWhySystem['state'], string> = {
  ready: 'var(--textSoft)',
  active: 'var(--accentBlue)',
  waiting: 'var(--statusWarn)',
  blocked: 'var(--statusWarn)',
  failed: 'var(--statusDanger)',
  complete: 'var(--statusOk)',
}

const box: CSSProperties = {
  marginTop: 7,
  padding: '6px 7px',
  border: '1px solid var(--borderSubtle)',
  borderRadius: 5,
  background: 'var(--surfaceBase)',
}

export function WhyPanel({
  system,
  title = 'Why',
}: {
  system: RuntimeWhySystem
  title?: string
}): JSX.Element {
  const explanation = system.explanations[0]
  const path = explanation?.path ?? []
  const cause = explanation?.cause
  return (
    <section data-testid="why-panel" style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 11 }}>{title}</strong>
        <span style={{ color: stateColor[system.state], fontWeight: 600, fontSize: 10 }}>
          {system.state.toUpperCase()}
        </span>
      </div>
      {explanation ? (
        <>
          <div style={{ marginTop: 4, fontSize: 10, lineHeight: 1.35 }}>{explanation.summary}</div>
          {path.length > 0 ? (
            <div
              data-testid="why-path"
              style={{ marginTop: 5, color: 'var(--textMuted)', fontSize: 10, lineHeight: 1.35 }}
            >
              {path.map((step) => step.label).join(' → ')}
            </div>
          ) : null}
          {system.firstBlockedHop ? (
            <div style={{ marginTop: 4, color: 'var(--statusWarn)', fontSize: 10 }}>
              First blocked hop: {system.firstBlockedHop.label}
            </div>
          ) : null}
          {cause ? (
            <div style={{ marginTop: 4, fontSize: 10 }}>
              Cause: <strong>{cause.kind.replaceAll('-', ' ')}</strong> — {cause.message}
            </div>
          ) : null}
          {cause?.repair ? (
            <div style={{ marginTop: 4, color: 'var(--accentBlueSoft)', fontSize: 10 }}>
              Repair: {cause.repair.message}
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ marginTop: 4, color: 'var(--textSoft)', fontSize: 10 }}>
          No causal evidence recorded yet.
        </div>
      )}
    </section>
  )
}
