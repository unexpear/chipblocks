import {
  type StagedDrawProgress,
  stagedDrawFraction,
  stagedDrawLabel,
} from './canvas-draw-staging.ts'
import { THEME } from './theme.ts'

/**
 * The card a user watches while a big design lands on the canvas.
 *
 * It exists because of one sentence from the project lead — "so loading long is fine just make sure its
 * not just stuck" — and everything on it is chosen to answer that one question. It shows what the draw
 * is DOING ("Placing parts"), how much of it is done as real counts ("74 of 360"), and how long it has
 * been going. It never shows a percentage it cannot justify: during the last step, where routing,
 * measuring and solving happen inside one call with no unit to count, the bar goes striped and says in
 * words that this step cannot report how far along it is.
 *
 * The trouble line is the other half. A bar sitting at 40% for ever is the freeze it replaced, so when
 * progress stops for longer than any measured batch, or the whole draw runs past the estimate it was
 * admitted under, the card says so and says what state the canvas is in. Stop is always there.
 */
export function DrawProgressCard({
  progress,
  onStop,
}: {
  progress: StagedDrawProgress
  onStop: () => void
}) {
  const fraction = stagedDrawFraction(progress)
  const seconds = Math.round(progress.elapsedMs / 1000)
  return (
    <div
      data-testid="draw-progress"
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        top: 14,
        zIndex: 1200,
        boxSizing: 'border-box',
        width: 420,
        maxWidth: 'calc(100% - 28px)',
        padding: '12px 14px',
        borderRadius: 8,
        background: THEME.surfacePanel,
        border: `1px solid ${progress.trouble ? THEME.statusWarn : THEME.borderStrong}`,
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)',
        fontSize: 12,
        color: THEME.textPrimary,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Drawing {progress.what}</span>
        <button
          type="button"
          onClick={onStop}
          data-testid="draw-progress-stop"
          style={{
            border: `1px solid ${THEME.borderStrong}`,
            borderRadius: 4,
            background: 'transparent',
            color: THEME.textPrimary,
            cursor: 'pointer',
            padding: '2px 10px',
            fontSize: 12,
          }}
        >
          Stop
        </button>
      </div>
      <div
        style={{
          marginTop: 8,
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          background: THEME.surfaceInput,
        }}
      >
        <div
          data-testid="draw-progress-fill"
          data-fraction={fraction === undefined ? 'indeterminate' : fraction.toFixed(3)}
          style={{
            height: '100%',
            width: fraction === undefined ? '100%' : `${(fraction * 100).toFixed(1)}%`,
            background:
              fraction === undefined
                ? `repeating-linear-gradient(90deg, ${THEME.accentBlue} 0 10px, transparent 10px 20px)`
                : THEME.accentBlue,
          }}
        />
      </div>
      <div data-testid="draw-progress-label" style={{ marginTop: 7, color: THEME.textSoft }}>
        {stagedDrawLabel(progress)} · {seconds}s
      </div>
      {progress.trouble ? (
        <div
          data-testid="draw-progress-trouble"
          style={{ marginTop: 7, color: THEME.statusWarn, lineHeight: 1.5 }}
        >
          ⚠ {progress.trouble.message}
        </div>
      ) : null}
    </div>
  )
}
