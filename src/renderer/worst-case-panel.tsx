import { formatEng } from './units.ts'
import type { Quantity, WorstCaseEntry, WorstCaseResult } from './worst-case.ts'

/**
 * The Worst-case panel (S21-v3-10) — renders worstCaseAnalysis: the swept
 * tolerance parts, any reading whose worst corner exceeds (or crowds) its
 * rating, and the full min/max envelope of every reading. The point: "is EVERY
 * corner safe?", not just nominal.
 */

const QUANTITY_LABEL: Record<Quantity, string> = {
  current: 'I',
  voltage: 'V',
  power: 'P',
  temperature: 'T',
}

const fmt = (q: Quantity, v: number): string =>
  q === 'temperature'
    ? `${v.toFixed(1)} °C`
    : formatEng(v, q === 'current' ? 'A' : q === 'voltage' ? 'V' : 'W')

const unitSymbol = (unit: string): string =>
  unit === 'ohm' ? 'Ω' : unit === 'farad' ? 'F' : unit === 'henry' ? 'H' : unit

export function WorstCasePanel({
  result,
  onClose,
  light,
}: {
  result: WorstCaseResult
  onClose: () => void
  light: boolean
}) {
  const border = light ? '1px solid #c4c8ce' : '1px solid #2a2a2f'
  const textColor = light ? '#333' : '#cdd6e0'
  const dimColor = light ? '#667' : '#8a93a0'

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
        background: light ? '#f2f3f5' : '#141417',
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
        <div style={{ fontSize: 14, fontWeight: 700 }}>Worst-case over tolerances</div>
        <button
          type="button"
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            padding: '3px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 11,
            background: light ? '#fff' : '#1b1b1f',
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
          . Each envelope below is the exact worst corner, re-solved — no new physics, just the real
          solver run at the limits.
        </div>
      ) : (
        <div style={{ color: dimColor, fontSize: 11, marginBottom: 8 }}>
          No part in this circuit carries a ±tolerance, so there is nothing to vary — every reading
          below is exact. (Resistors, capacitors and inductors carry tolerances; give one a
          tolerance to sweep it.)
        </div>
      )}

      {exceed.length > 0 ? (
        <>
          <div style={{ fontWeight: 700, color: '#e0594f', margin: '10px 0 4px' }}>
            ⚠ A corner EXCEEDS a rating
          </div>
          {exceed.map((e) => findingLine(e, '#e0594f'))}
        </>
      ) : null}

      {tight.length > 0 ? (
        <>
          <div style={{ fontWeight: 700, color: '#d6a23c', margin: '10px 0 4px' }}>
            Tight margin (worst corner past 80% of rating)
          </div>
          {tight.map((e) => findingLine(e, '#d6a23c'))}
        </>
      ) : null}

      {result.swept && exceed.length === 0 && tight.length === 0 ? (
        <div style={{ color: '#6ec06e', margin: '8px 0' }}>
          ✓ Every rated reading stays within its rating across all tolerance corners.
        </div>
      ) : null}

      <div style={{ fontWeight: 700, color: dimColor, margin: '12px 0 4px' }}>
        Every reading’s envelope (nominal → worst-case min … max)
      </div>
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
              const color = e.exceedsRating ? '#e0594f' : textColor
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
    </div>
  )
}
