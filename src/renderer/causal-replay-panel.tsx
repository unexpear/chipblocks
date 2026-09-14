import type { CSSProperties, JSX } from 'react'
import type { CausalReplay, CausalReplayEvent } from './causal-replay.ts'
import { formatEng } from './units.ts'

const MAX_VISIBLE_EVENTS = 40

function eventTone(event: CausalReplayEvent): string {
  if (event.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return 'var(--statusDanger)'
  }
  if (event.diagnostics.some((diagnostic) => diagnostic.severity === 'warning')) {
    return 'var(--statusWarn)'
  }
  return event.kind === 'diagnostic' ? 'var(--textSoft)' : 'var(--accentTimeline)'
}

function locationText(event: CausalReplayEvent): string {
  if (event.cycle !== undefined) return `cycle ${event.cycle}`
  if (event.frameIndex !== undefined) {
    const time = event.time === undefined ? '' : ` · t=${formatEng(event.time, 's')}`
    return `frame ${event.frameIndex}${time}`
  }
  return 'run'
}

function eventMeta(event: CausalReplayEvent): string {
  const nets = event.nets.length > 0 ? `nets: ${event.nets.join(', ')}` : ''
  const sources =
    event.sources.length > 0
      ? `parts: ${event.sources.map((source) => source.label).join(', ')}`
      : ''
  return [nets, sources].filter(Boolean).join(' · ')
}

const rowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  width: '100%',
  padding: '5px 6px',
  border: '1px solid var(--borderSubtle)',
  borderRadius: 5,
  background: 'var(--surfaceBase)',
  color: 'var(--textPrimary)',
  textAlign: 'left',
  font: 'inherit',
}

export function CausalReplayPanel({
  replay,
  onJump,
}: {
  replay: CausalReplay
  onJump?: (frameIndex: number) => void
}): JSX.Element {
  const visible = replay.events.slice(0, MAX_VISIBLE_EVENTS)
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        border: '1px solid var(--borderSubtle)',
        borderRadius: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ color: 'var(--textBright)', fontSize: 12 }}>Causal replay</strong>
        <span style={{ color: 'var(--textSoft)', fontSize: 11 }}>
          {replay.transitionCount} transition{replay.transitionCount === 1 ? '' : 's'} ·{' '}
          {replay.diagnosticCount} diagnostic{replay.diagnosticCount === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ color: 'var(--textSoft)', fontSize: 10, lineHeight: 1.4 }}>
        Correlates recorded changes with their nets and connected parts; it is an inspection index,
        not a proof of physical causation.
      </div>
      {visible.length === 0 ? (
        <div style={{ color: 'var(--textSoft)', fontSize: 11 }}>
          No recorded transitions or diagnostics.
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxHeight: 230,
            overflow: 'auto',
          }}
        >
          {visible.map((event) => {
            const content = (
              <div style={rowStyle}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11 }}>
                  <span style={{ color: 'var(--textSoft)', fontVariantNumeric: 'tabular-nums' }}>
                    {locationText(event)}
                  </span>
                  <span style={{ color: eventTone(event), fontWeight: 600 }}>{event.detail}</span>
                </div>
                {eventMeta(event) ? (
                  <div style={{ color: 'var(--textMuted)', fontSize: 10 }}>{eventMeta(event)}</div>
                ) : null}
                <div
                  data-testid="causal-why-path"
                  style={{ color: 'var(--textMuted)', fontSize: 10 }}
                >
                  Why: {event.why.path.map((step) => step.label).join(' → ')}
                </div>
                {event.why.cause ? (
                  <div style={{ color: eventTone(event), fontSize: 10 }}>
                    Cause: {event.why.cause.kind.replaceAll('-', ' ')} — {event.why.cause.message}
                  </div>
                ) : null}
              </div>
            )
            if (event.frameIndex === undefined || onJump === undefined) {
              return <div key={event.id}>{content}</div>
            }
            return (
              <button
                key={event.id}
                type="button"
                className="nodrag"
                onClick={() => onJump(event.frameIndex as number)}
                title="Jump the timeline to this recorded frame"
                style={{ padding: 0, border: 0, background: 'none', cursor: 'pointer' }}
              >
                {content}
              </button>
            )
          })}
          {replay.events.length > MAX_VISIBLE_EVENTS ? (
            <div style={{ color: 'var(--textMuted)', fontSize: 10 }}>
              Showing the first {MAX_VISIBLE_EVENTS} events.
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
