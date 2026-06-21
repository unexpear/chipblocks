import { MONTE_CARLO_DEFAULT_SAMPLES, type MonteCarloResult } from './monte-carlo.ts'
import { THEME } from './theme.ts'
import { formatEng } from './units.ts'
import type {
  DeratingBand,
  DeratingResult,
  Quantity,
  WorstCaseEntry,
  WorstCaseResult,
} from './worst-case.ts'

/**
 * The margins panel (S21-v3-10; Monte-Carlo + derating added later). Three views of the
 * same circuit's headroom, all from the REAL solver:
 *  - Derating: every rated reading as a fraction of its OWN limit right now, banded
 *    green / amber / red -- the "how much margin is left" scorecard;
 *  - Worst-case: each reading's exact min/max corner over the tolerance bands, vs rating;
 *  - Monte-Carlo (on demand): the realistic distribution + the share of sampled boards
 *    that breach a rating (the failure rate = 1 - yield).
 */

const QUANTITY_LABEL: Record<Quantity, string> = {
  current: 'I',
  voltage: 'V',
  power: 'P',
  temperature: 'T',
}

const BAND_COLOR: Record<DeratingBand, string> = {
  safe: THEME.statusOk,
  caution: THEME.statusWarn,
  critical: THEME.statusDanger,
}

const fmt = (q: Quantity, v: number): string =>
  q === 'temperature'
    ? `${v.toFixed(1)} °C`
    : formatEng(v, q === 'current' ? 'A' : q === 'voltage' ? 'V' : 'W')

const unitSymbol = (unit: string): string =>
  unit === 'ohm' ? 'Ω' : unit === 'farad' ? 'F' : unit === 'henry' ? 'H' : unit

export function WorstCasePanel({
  result,
  derating,
  monteCarlo,
  monteCarloRunning,
  onRunMonteCarlo,
  onClose,
  light,
}: {
  result: WorstCaseResult
  derating: DeratingResult | null
  monteCarlo: MonteCarloResult | null
  monteCarloRunning: boolean
  onRunMonteCarlo: () => void
  onClose: () => void
  light: boolean
}) {
  const border = light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderSubtle}`
  const textColor = light ? THEME.borderSubtle : THEME.textPrimary
  const dimColor = light ? THEME.textFaint : THEME.textMuted
  const sectionTitleStyle: React.CSSProperties = {
    fontWeight: 700,
    color: dimColor,
    margin: '14px 0 4px',
  }

  const exceed = result.entries.filter((e) => e.exceedsRating)
  // "Tight margin": a rated reading whose worst corner sits above 80 % of the
  // rating but does not exceed it — the conventional derating line.
  const tight = result.entries.filter(
    (e) => !e.exceedsRating && (e.worstFractionOfRating ?? 0) >= 0.8,
  )
  const partIds = [...new Set(result.entries.map((e) => e.partId))]

  const findingLine = (e: WorstCaseEntry, color: string) => (
    <div key={`${e.partId}:${e.quantity}`} style={{ padding: '2px 0', color }}>
      <strong>{e.partId}</strong> · {QUANTITY_LABEL[e.quantity]}: worst {fmt(e.quantity, e.max)} is{' '}
      {Math.round((e.worstFractionOfRating ?? 0) * 100)}% of its {fmt(e.quantity, e.rating ?? 0)}{' '}
      rating <span style={{ color: dimColor }}>(nominal {fmt(e.quantity, e.nominal)})</span>
    </div>
  )

  return (
    <div
      className="nodrag nopan cb-hide-scrollbar"
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 55,
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
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Margins over tolerances</div>
        <button
          type="button"
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            padding: '3px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 11,
            background: light ? THEME.white : THEME.surfaceRaised,
            border,
            color: textColor,
          }}
        >
          ✕ Close
        </button>
      </div>

      {result.swept ? (
        <div style={{ color: dimColor, fontSize: 11, marginBottom: 8 }}>
          Swept {result.toleranceParts.length} toleranced part
          {result.toleranceParts.length === 1 ? '' : 's'} over{' '}
          {result.toleranceParts
            .map(
              (p) =>
                `${p.id} ${formatEng(p.nominal, unitSymbol(p.unit))} ±${Math.round(p.tolFraction * 100)}%`,
            )
            .join(', ')}
          . Every envelope below is the exact worst corner, re-solved — no new physics, just the
          real solver run at the limits.
        </div>
      ) : (
        <div style={{ color: dimColor, fontSize: 11, marginBottom: 8 }}>
          No part in this circuit carries a ±tolerance, so there is nothing to vary — the worst-case
          and Monte-Carlo views need one. (Resistors, capacitors and inductors carry tolerances.)
          The derating scorecard below still reads every part's margin at the nominal operating
          point.
        </div>
      )}

      {derating !== null && derating.entries.length > 0 ? (
        <>
          <div style={sectionTitleStyle}>Derating — how close each part runs to its limit now</div>
          {derating.entries.map((e) => {
            const pct = Math.round(e.fraction * 100)
            const color = BAND_COLOR[e.band]
            return (
              <div
                key={`${e.partId}:${e.quantity}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}
              >
                <span style={{ width: 96, flexShrink: 0 }}>
                  <strong>{e.partId}</strong>
                  <span style={{ color: dimColor }}> · {QUANTITY_LABEL[e.quantity]}</span>
                </span>
                <span
                  style={{
                    flex: 1,
                    height: 9,
                    background: light ? THEME.textBright : THEME.surfaceRaised,
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${Math.min(100, pct)}%`,
                      background: color,
                    }}
                  />
                </span>
                <span style={{ width: 78, flexShrink: 0, textAlign: 'right', color }}>
                  {pct}% of {fmt(e.quantity, e.rating)}
                </span>
              </div>
            )
          })}
        </>
      ) : null}

      {exceed.length > 0 ? (
        <>
          <div style={{ fontWeight: 700, color: THEME.statusDanger, margin: '12px 0 4px' }}>
            ⚠ A corner EXCEEDS a rating
          </div>
          {exceed.map((e) => findingLine(e, THEME.statusDanger))}
        </>
      ) : null}

      {tight.length > 0 ? (
        <>
          <div style={{ fontWeight: 700, color: THEME.statusWarn, margin: '12px 0 4px' }}>
            Tight margin (worst corner past 80% of rating)
          </div>
          {tight.map((e) => findingLine(e, THEME.statusWarn))}
        </>
      ) : null}

      {result.swept && exceed.length === 0 && tight.length === 0 ? (
        <div style={{ color: THEME.statusOk, margin: '8px 0' }}>
          ✓ Every rated reading stays within its rating across all tolerance corners.
        </div>
      ) : null}

      <div style={sectionTitleStyle}>Every reading’s envelope (nominal → worst-case min … max)</div>
      {partIds.map((partId) => {
        const entries = result.entries.filter((e) => e.partId === partId)
        return (
          <div
            key={partId}
            style={{ margin: '5px 0', padding: '5px 8px', border, borderRadius: 5 }}
          >
            <div style={{ fontWeight: 700 }}>{partId}</div>
            {entries.map((e) => {
              const spread = e.max - e.min
              const color = e.exceedsRating ? THEME.statusDanger : textColor
              return (
                <div key={e.quantity} style={{ padding: '1px 0', color }}>
                  {QUANTITY_LABEL[e.quantity]}: {fmt(e.quantity, e.nominal)}{' '}
                  {spread > Math.abs(e.nominal) * 1e-6 ? (
                    <span style={{ color: dimColor }}>
                      → [{fmt(e.quantity, e.min)} … {fmt(e.quantity, e.max)}]
                    </span>
                  ) : (
                    <span style={{ color: dimColor }}>(fixed)</span>
                  )}
                  {e.rating !== undefined ? (
                    <span style={{ color: dimColor }}>
                      {' '}
                      · {Math.round((e.worstFractionOfRating ?? 0) * 100)}% of{' '}
                      {fmt(e.quantity, e.rating)}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        )
      })}

      <div style={{ ...sectionTitleStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
        Monte-Carlo — the realistic spread + yield
        <button
          type="button"
          onClick={onRunMonteCarlo}
          disabled={monteCarloRunning || !result.swept}
          style={{
            marginLeft: 'auto',
            padding: '3px 10px',
            borderRadius: 4,
            cursor: monteCarloRunning || !result.swept ? 'default' : 'pointer',
            fontSize: 11,
            opacity: !result.swept ? 0.5 : 1,
            background: light ? THEME.white : THEME.surfaceRaised,
            border,
            color: textColor,
          }}
        >
          {monteCarloRunning
            ? 'Running…'
            : monteCarlo
              ? 'Re-run'
              : `Run ${MONTE_CARLO_DEFAULT_SAMPLES} samples`}
        </button>
      </div>
      {!result.swept ? (
        <div style={{ color: dimColor }}>Needs a toleranced part to sample.</div>
      ) : monteCarlo === null ? (
        <div style={{ color: dimColor }}>
          Each toleranced part is drawn from a Gaussian over its band (±tol = 3σ) and the circuit
          re-solved — then click to see where boards actually land, and what fraction fail.
        </div>
      ) : (
        <>
          {monteCarlo.worstExceedFraction > 0 ? (
            <div style={{ color: THEME.statusDanger, margin: '2px 0 6px' }}>
              Up to {(monteCarlo.worstExceedFraction * 100).toFixed(1)}% of {monteCarlo.samples}{' '}
              sampled boards breach a rating.
            </div>
          ) : (
            <div style={{ color: THEME.statusOk, margin: '2px 0 6px' }}>
              ✓ 0 of {monteCarlo.samples} sampled boards breached a rating.
            </div>
          )}
          {monteCarlo.stats
            .filter((s) => s.stdDev > 0)
            .map((s) => (
              <div key={`${s.partId}:${s.quantity}`} style={{ padding: '1px 0' }}>
                <strong>{s.partId}</strong> · {QUANTITY_LABEL[s.quantity]}:{' '}
                {fmt(s.quantity, s.mean)} ± {fmt(s.quantity, s.stdDev)}{' '}
                <span style={{ color: dimColor }}>
                  (99%: [{fmt(s.quantity, s.p1)} … {fmt(s.quantity, s.p99)}])
                </span>
                {s.exceedFraction !== undefined && s.exceedFraction > 0 ? (
                  <span style={{ color: THEME.statusDanger }}>
                    {' '}
                    · {(s.exceedFraction * 100).toFixed(1)}% over
                  </span>
                ) : null}
              </div>
            ))}
        </>
      )}
    </div>
  )
}
