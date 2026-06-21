import { useMemo, useState } from 'react'
import { acSweep, phaseMargin } from '../ac-analysis.ts'
import type { World } from '../cross-fk-validator.ts'
import { THEME } from './theme.ts'
import { formatEng } from './units.ts'

/**
 * Bode panel — the canvas front end for the frequency-domain (AC) engine. Pick an input
 * source and an output node, choose a frequency span, and it sweeps `acSweep` and draws the
 * classic two-stack Bode plot: GAIN in dB over log frequency, and PHASE in degrees beneath
 * it on the same axis. This is what makes the AC analyzer clickable instead of test-only —
 * a real RC corner, an amplifier's roll-off, or a transmission line's quarter-wave
 * resonances all read straight off the curve.
 *
 * The selections are stored loosely (by source id / net id) and re-validated against the
 * live world each render, so an edit that renumbers the nets falls back gracefully instead
 * of going blank. NaN points (an undriven output, a singular frequency) are dropped.
 */

const PLOT_W = 470
const GAIN_H = 128
const PHASE_H = 116
const PAD = { left: 52, right: 16, top: 12, bottom: 18 }
const INNER_W = PLOT_W - PAD.left - PAD.right
const GAIN_COLOR = THEME.accentBlueBright
const PHASE_COLOR = THEME.lensTemp

const RANGES: { label: string; lo: number; hi: number }[] = [
  { label: '1 Hz – 1 kHz', lo: 1, hi: 1e3 },
  { label: '1 Hz – 1 MHz', lo: 1, hi: 1e6 },
  { label: '1 Hz – 1 GHz', lo: 1, hi: 1e9 },
  { label: '1 kHz – 1 GHz', lo: 1e3, hi: 1e9 },
  { label: '1 MHz – 10 GHz', lo: 1e6, hi: 1e10 },
]

const niceFloor = (v: number, step: number) => Math.floor(v / step) * step
const niceCeil = (v: number, step: number) => Math.ceil(v / step) * step

/** Pad a [min,max] to a minimum span, snapped to a step, centered on the data. */
function axisRange(min: number, max: number, step: number, minSpan: number): [number, number] {
  let lo = niceFloor(min, step)
  let hi = niceCeil(max, step)
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2
    lo = niceFloor(mid - minSpan / 2, step)
    hi = niceCeil(mid + minSpan / 2, step)
  }
  return [lo, hi]
}

export function BodePanel({
  world,
  temperaturesC,
  light,
  onClose,
  outputNet,
  onOutputNet,
  picking,
  onPickToggle,
}: {
  world: World
  temperaturesC: Map<string, number>
  light: boolean
  onClose: () => void
  /** The output node, lifted to App so a canvas terminal-click can set it. */
  outputNet: string
  onOutputNet: (net: string) => void
  /** True while waiting for a canvas terminal-click to choose the output. */
  picking: boolean
  onPickToggle: () => void
}) {
  const text = light ? THEME.borderSubtle : THEME.textPrimary
  const gridCol = light ? THEME.textPrimary : THEME.surfaceRaised
  const sub = light ? THEME.textFaint : THEME.textMuted
  const fieldStyle: React.CSSProperties = {
    background: light ? THEME.white : THEME.surfaceInput,
    border: `1px solid ${light ? THEME.textPrimary : THEME.borderStrong}`,
    color: text,
    borderRadius: 3,
    fontSize: 11,
    padding: '2px 4px',
    maxWidth: 150,
  }

  const sources = useMemo(
    () =>
      [...world.instances.values()].filter((i) => i.definition === 'power_source').map((i) => i.id),
    [world],
  )
  const nets = useMemo(() => {
    let groundId: string | undefined
    for (const n of world.nets.values()) if (n.type === 'ground') groundId = n.id
    return [...world.nets.values()]
      .filter((n) => n.id !== groundId)
      .map((n) => ({ id: n.id, label: n.members.map((m) => m.instance).join(' · ') || n.id }))
  }, [world])

  const [inputSource, setInputSource] = useState(() => sources[0] ?? '')
  const [rangeIdx, setRangeIdx] = useState(1)

  // Re-validate the stored picks against the live world (edits can renumber nets).
  const inSrc = sources.includes(inputSource) ? inputSource : (sources[0] ?? '')
  const outNet = nets.some((n) => n.id === outputNet) ? outputNet : (nets[0]?.id ?? '')
  const range = RANGES[rangeIdx] ?? RANGES[1]
  // biome-ignore lint/style/noNonNullAssertion: RANGES[1] is a literal fallback
  const { lo: fLo, hi: fHi } = range!

  const sweep = useMemo(() => {
    if (inSrc === '' || outNet === '') return []
    return acSweep(world, {
      inputSource: inSrc,
      outputNet: outNet,
      fStartHz: fLo,
      fStopHz: fHi,
      pointsPerDecade: 20,
      temperaturesC,
    }).filter((p) => Number.isFinite(p.gainDb) && Number.isFinite(p.phaseDeg))
  }, [world, inSrc, outNet, fLo, fHi, temperaturesC])

  // The stability number — 180° + the phase where the gain crosses unity (0 dB). Null when
  // the gain never reaches unity in this band (a passive divider that only ever attenuates).
  const pm = useMemo(() => {
    if (inSrc === '' || outNet === '') return null
    return phaseMargin(world, {
      inputSource: inSrc,
      outputNet: outNet,
      fStartHz: fLo,
      fStopHz: fHi,
      pointsPerDecade: 20,
      temperaturesC,
    })
  }, [world, inSrc, outNet, fLo, fHi, temperaturesC])

  const logLo = Math.log10(fLo)
  const logHi = Math.log10(fHi)
  const xOf = (f: number) => PAD.left + ((Math.log10(f) - logLo) / (logHi - logLo)) * INNER_W
  // Decade gridline frequencies inside the span.
  const decades: number[] = []
  for (let d = Math.ceil(logLo); d <= Math.floor(logHi); d++) decades.push(10 ** d)

  const gainDbs = sweep.map((p) => Math.max(p.gainDb, -160))
  const phaseDegs = sweep.map((p) => p.phaseDeg)
  const [gLo, gHi] = sweep.length
    ? axisRange(Math.min(...gainDbs), Math.max(...gainDbs), 20, 40)
    : [-40, 20]
  const [pLo, pHi] = sweep.length
    ? axisRange(Math.min(...phaseDegs), Math.max(...phaseDegs), 45, 180)
    : [-180, 180]

  const gainTop = PAD.top
  const gainBot = GAIN_H - PAD.bottom
  const yGain = (db: number) => gainTop + ((gHi - db) / (gHi - gLo)) * (gainBot - gainTop)
  const phaseTop = GAIN_H + PAD.top
  const phaseBot = GAIN_H + PHASE_H - PAD.bottom
  const yPhase = (deg: number) => phaseTop + ((pHi - deg) / (pHi - pLo)) * (phaseBot - phaseTop)

  const gainPts = sweep
    .map((p) => `${xOf(p.frequencyHz)},${yGain(Math.max(p.gainDb, -160))}`)
    .join(' ')
  const phasePts = sweep.map((p) => `${xOf(p.frequencyHz)},${yPhase(p.phaseDeg)}`).join(' ')

  // The −3 dB corner: where the gain first falls 3 dB below its peak.
  const peak = sweep.length ? Math.max(...gainDbs) : Number.NaN
  const corner = sweep.find((p) => p.gainDb <= peak - 3)?.frequencyHz

  const gainGridDb: number[] = []
  for (let db = gLo; db <= gHi + 0.001; db += 20) gainGridDb.push(db)
  const phaseGridDeg: number[] = []
  for (let d = pLo; d <= pHi + 0.001; d += 45) phaseGridDeg.push(d)

  const labelStyle: React.CSSProperties = {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: sub,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 6, minWidth: PLOT_W }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={labelStyle}>Input source</span>
          <select
            className="nodrag"
            value={inSrc}
            onChange={(e) => setInputSource(e.target.value)}
            style={fieldStyle}
          >
            {sources.length === 0 ? <option value="">(no source)</option> : null}
            {sources.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={labelStyle}>Output node</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <select
              className="nodrag"
              value={outNet}
              onChange={(e) => onOutputNet(e.target.value)}
              style={fieldStyle}
            >
              {nets.length === 0 ? <option value="">(no node)</option> : null}
              {nets.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="nodrag"
              onClick={onPickToggle}
              title={
                picking
                  ? 'Click a terminal on the canvas to set the output (Esc / this button cancels)'
                  : 'Pick the output by clicking a terminal on the canvas, like a scope probe'
              }
              style={{
                background: picking
                  ? THEME.surfaceActive
                  : light
                    ? THEME.white
                    : THEME.surfaceInput,
                border: `1px solid ${picking ? THEME.accentBlue : light ? THEME.textPrimary : THEME.borderStrong}`,
                color: text,
                borderRadius: 3,
                fontSize: 12,
                padding: '0 7px',
                cursor: 'pointer',
              }}
            >
              ⌖
            </button>
          </div>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={labelStyle}>Frequency</span>
          <select
            className="nodrag"
            value={rangeIdx}
            onChange={(e) => setRangeIdx(Number(e.target.value))}
            style={fieldStyle}
          >
            {RANGES.map((r, i) => (
              <option key={r.label} value={i}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            background: light ? THEME.textBright : THEME.surfaceRaised,
            border: `1px solid ${light ? THEME.textPrimary : THEME.borderStrong}`,
            color: text,
            borderRadius: 4,
            fontSize: 11,
            padding: '3px 10px',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>

      {sweep.length === 0 ? (
        <div style={{ color: sub, fontSize: 11, padding: '24px 8px' }}>
          {sources.length === 0
            ? 'Add a power source — it carries the AC stimulus.'
            : nets.length === 0
              ? 'Add a ground and at least one node to measure.'
              : 'No frequency response — check that the output node is driven from the input source.'}
        </div>
      ) : (
        <svg
          width={PLOT_W}
          height={GAIN_H + PHASE_H}
          style={{ background: light ? THEME.textBright : THEME.surfaceDeep, borderRadius: 4 }}
        >
          <title>Bode plot — gain and phase versus frequency</title>
          {/* decade gridlines, both stacks */}
          {decades.map((f) => (
            <g key={`dec${f}`}>
              <line
                x1={xOf(f)}
                y1={gainTop}
                x2={xOf(f)}
                y2={gainBot}
                stroke={gridCol}
                strokeWidth={1}
              />
              <line
                x1={xOf(f)}
                y1={phaseTop}
                x2={xOf(f)}
                y2={phaseBot}
                stroke={gridCol}
                strokeWidth={1}
              />
              <text x={xOf(f)} y={GAIN_H + PHASE_H - 5} fontSize={9} fill={sub} textAnchor="middle">
                {formatEng(f, 'Hz')}
              </text>
            </g>
          ))}
          {/* gain horizontal grid + dB labels */}
          {gainGridDb.map((db) => (
            <g key={`g${db}`}>
              <line
                x1={PAD.left}
                y1={yGain(db)}
                x2={PLOT_W - PAD.right}
                y2={yGain(db)}
                stroke={gridCol}
                strokeWidth={1}
                opacity={db === 0 ? 1 : 0.5}
              />
              <text x={PAD.left - 5} y={yGain(db) + 3} fontSize={9} fill={sub} textAnchor="end">
                {db}
              </text>
            </g>
          ))}
          {/* phase horizontal grid + degree labels */}
          {phaseGridDeg.map((d) => (
            <g key={`p${d}`}>
              <line
                x1={PAD.left}
                y1={yPhase(d)}
                x2={PLOT_W - PAD.right}
                y2={yPhase(d)}
                stroke={gridCol}
                strokeWidth={1}
                opacity={d === 0 ? 1 : 0.5}
              />
              <text x={PAD.left - 5} y={yPhase(d) + 3} fontSize={9} fill={sub} textAnchor="end">
                {d}
              </text>
            </g>
          ))}
          {/* −3 dB corner marker */}
          {corner !== undefined ? (
            <line
              x1={xOf(corner)}
              y1={gainTop}
              x2={xOf(corner)}
              y2={gainBot}
              stroke={GAIN_COLOR}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.7}
            />
          ) : null}
          <polyline fill="none" stroke={GAIN_COLOR} strokeWidth={1.7} points={gainPts} />
          <polyline fill="none" stroke={PHASE_COLOR} strokeWidth={1.7} points={phasePts} />
          {/* axis titles */}
          <text x={PAD.left} y={9} fontSize={9} fill={GAIN_COLOR}>
            gain (dB)
          </text>
          <text x={PAD.left} y={GAIN_H + 9} fontSize={9} fill={PHASE_COLOR}>
            phase (°)
          </text>
        </svg>
      )}

      {picking ? (
        <div style={{ color: THEME.accentBlue, fontSize: 11, fontWeight: 600 }}>
          Click a terminal on the canvas to set the output node…
        </div>
      ) : null}
      {sweep.length > 0 ? (
        <div style={{ color: sub, fontSize: 10, lineHeight: 1.6 }}>
          {pm !== null ? (
            <div>
              Phase margin{' '}
              <span
                style={{
                  color:
                    pm.phaseMarginDeg > 45
                      ? THEME.statusOk
                      : pm.phaseMarginDeg > 0
                        ? THEME.lensTemp
                        : THEME.statusDanger,
                  fontWeight: 700,
                }}
              >
                {pm.phaseMarginDeg.toFixed(0)}°
              </span>{' '}
              at the {formatEng(pm.unityGainHz, 'Hz')} unity-gain crossover (DC gain{' '}
              {pm.dcGainDb.toFixed(1)} dB) —{' '}
              {pm.phaseMarginDeg > 45
                ? 'stable'
                : pm.phaseMarginDeg > 0
                  ? 'marginally stable'
                  : 'UNSTABLE'}
              .{' '}
            </div>
          ) : (
            <div>No unity-gain (0 dB) crossover in this band. </div>
          )}
          {corner !== undefined
            ? `−3 dB corner ≈ ${formatEng(corner, 'Hz')}. `
            : 'Flat across this span. '}
          Small-signal response, {formatEng(fLo, 'Hz')} to {formatEng(fHi, 'Hz')}.
        </div>
      ) : null}
    </div>
  )
}
