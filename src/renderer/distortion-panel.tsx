import { useMemo, useState } from 'react'
import type { World } from '../cross-fk-validator.ts'
import { compressionCurveView, SPECTRUM_FLOOR_DBC, spectrumView } from './distortion-view.ts'
import { gainCompression, largeSignalSpectrum } from './large-signal.ts'
import { THEME } from './theme.ts'
import { formatEng } from './units.ts'

/**
 * Distortion panel — the canvas front end for the large-signal engine (large-signal.ts). Pick a drive SOURCE
 * and probe an OUTPUT net, set the tone frequency and the largest drive to reach, and it drives the circuit
 * hard through the nonlinear transient solver + FFT to draw two things the small-signal AC engine cannot give:
 *   • GAIN COMPRESSION (top) — the output fundamental vs drive on dB axes, the ideal small-signal line it
 *     would follow with no compression, and the marked 1-dB compression point (P1dB); and
 *   • the HARMONIC SPECTRUM (bottom) at the largest drive — each harmonic in dBc, with the THD percentage.
 * A purely linear stage draws a straight line onto its own ideal (no compression) and empty harmonics; a real
 * transistor amplifier bends away and grows harmonics as it clips. The plot maths lives in distortion-view.ts.
 *
 * This is compute-heavy (one nonlinear transient per swept drive), so the sweep is deliberately coarse and the
 * capture window short; it is memoized so it only re-runs when a control or the circuit changes.
 */

const PLOT_W = 470
const COMP_H = 150
const SPEC_H = 120
const PAD = { left: 44, right: 16, top: 14, bottom: 20 }
const INNER_W = PLOT_W - PAD.left - PAD.right
const ACTUAL_COLOR = THEME.accentBlueBright
const IDEAL_COLOR = THEME.textMuted
const BAR_COLOR = THEME.lensTemp
const SWEEP_POINTS = 8
// Short, power-of-two capture keeps the many nonlinear transients responsive while staying bin-aligned.
const ENGINE_WINDOW = { samplesPerCycle: 32, settleCycles: 6, captureCycles: 16 }

const FREQS: { label: string; hz: number }[] = [
  { label: '1 kHz', hz: 1e3 },
  { label: '100 kHz', hz: 1e5 },
  { label: '1 MHz', hz: 1e6 },
  { label: '10 MHz', hz: 1e7 },
  { label: '100 MHz', hz: 1e8 },
]

export function DistortionPanel({
  world,
  temperaturesC,
  light,
  onClose,
  source,
  onSource,
  outputNet,
  picking,
  onPickToggle,
}: {
  world: World
  temperaturesC: Map<string, number>
  light: boolean
  onClose: () => void
  /** The drive source instance id (a power_source), chosen in the dropdown. */
  source: string
  onSource: (id: string) => void
  /** The measured output net (set by the canvas probe via the hook, shown here read-only). */
  outputNet: string
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
  const inSource = sources.includes(source) ? source : (sources[0] ?? '')
  const [freqIdx, setFreqIdx] = useState(2)
  const [driveText, setDriveText] = useState('1')
  const freq = FREQS[freqIdx] ?? FREQS[2]
  // biome-ignore lint/style/noNonNullAssertion: FREQS[2] is a literal fallback
  const fHz = freq!.hz
  const maxDrive = Number(driveText) > 0 ? Number(driveText) : 1

  const opts = useMemo(
    () => ({
      inputSource: inSource,
      outputNet,
      fundamentalHz: fHz,
      temperaturesC,
      ...ENGINE_WINDOW,
    }),
    [inSource, outputNet, fHz, temperaturesC],
  )

  // Log-spaced drive sweep from maxDrive/128 up to maxDrive — small enough at the bottom to catch the
  // small-signal gain, large enough at the top to push the stage into compression.
  const amps = useMemo(
    () =>
      Array.from(
        { length: SWEEP_POINTS },
        (_, i) => maxDrive * 128 ** (i / (SWEEP_POINTS - 1) - 1),
      ),
    [maxDrive],
  )

  const ready = inSource !== '' && outputNet !== ''
  const compression = useMemo(
    () => (ready ? gainCompression(world, opts, amps) : null),
    [ready, world, opts, amps],
  )
  // Take the harmonic spectrum at the HIGHEST drive that actually converged — the rightmost point on the
  // compression curve — not unconditionally maxDrive. gainCompression drops any drive whose transient diverged,
  // so if the top drive failed but lower ones ran, the spectrum still follows the curve instead of going blank.
  const specDrive = compression?.sweep.at(-1)?.inputVolts ?? maxDrive
  const topSpectrum = useMemo(
    () => (ready && specDrive > 0 ? largeSignalSpectrum(world, opts, specDrive) : null),
    [ready, world, opts, specDrive],
  )

  const comp = compression ? compressionCurveView(compression) : null
  const spec = topSpectrum ? spectrumView(topSpectrum) : null
  const hasCurve = comp !== null && comp.points.length > 0

  const [xLo, xHi] = comp?.xAxis ?? [-40, 0]
  const [yLo, yHi] = comp?.yAxis ?? [-40, 0]
  const compTop = PAD.top
  const compBot = COMP_H - PAD.bottom
  const xOf = (db: number) => PAD.left + ((db - xLo) / (xHi - xLo)) * INNER_W
  const yComp = (db: number) => compTop + ((yHi - db) / (yHi - yLo)) * (compBot - compTop)

  const actualPts = (comp?.points ?? [])
    .map((p) => `${xOf(p.inputDb)},${yComp(p.outputDb)}`)
    .join(' ')

  const specTop = COMP_H + PAD.top
  const specBot = COMP_H + SPEC_H - PAD.bottom
  const bars = spec?.bars ?? []
  const slotW = bars.length > 0 ? INNER_W / bars.length : INNER_W

  const xGrid: number[] = []
  for (let db = Math.ceil(xLo / 10) * 10; db <= xHi + 0.001; db += 10) xGrid.push(db)
  const yGrid: number[] = []
  for (let db = Math.ceil(yLo / 10) * 10; db <= yHi + 0.001; db += 10) yGrid.push(db)
  const specGrid = [0, -20, -40, -60, SPECTRUM_FLOOR_DBC]
  const ySpec = (dbc: number) =>
    specTop + ((0 - dbc) / (0 - SPECTRUM_FLOOR_DBC)) * (specBot - specTop)

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
          <span style={labelStyle}>Drive source</span>
          <select
            className="nodrag"
            value={inSource}
            onChange={(e) => onSource(e.target.value)}
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
          <span style={labelStyle}>Output</span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ ...fieldStyle, minWidth: 44, display: 'inline-block' }}>
              {outputNet || '—'}
            </span>
            <button
              type="button"
              className="nodrag"
              onClick={onPickToggle}
              title={
                picking
                  ? 'Click a terminal on the canvas to choose the output net'
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
          <span style={labelStyle}>Tone</span>
          <select
            className="nodrag"
            value={freqIdx}
            onChange={(e) => setFreqIdx(Number(e.target.value))}
            style={fieldStyle}
          >
            {FREQS.map((r, i) => (
              <option key={r.label} value={i}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={labelStyle}>Max drive (V)</span>
          <input
            className="nodrag"
            type="number"
            min={0}
            step="any"
            value={driveText}
            onChange={(e) => setDriveText(e.target.value)}
            style={{ ...fieldStyle, maxWidth: 64 }}
          />
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

      {!ready || !hasCurve ? (
        <div style={{ color: sub, fontSize: 11, padding: '24px 8px' }}>
          {sources.length === 0
            ? 'Add a source to drive and a ground, then probe an output — distortion is the harmonics a stage makes when driven hard.'
            : 'Pick a drive source and probe an output net — the compression curve and harmonic spectrum need a driven output to measure.'}
        </div>
      ) : (
        <svg
          width={PLOT_W}
          height={COMP_H + SPEC_H}
          style={{ background: light ? THEME.textBright : THEME.surfaceDeep, borderRadius: 4 }}
        >
          <title>Distortion — gain compression and harmonic spectrum</title>
          {xGrid.map((db) => (
            <g key={`x${db}`}>
              <line
                x1={xOf(db)}
                y1={compTop}
                x2={xOf(db)}
                y2={compBot}
                stroke={gridCol}
                strokeWidth={1}
                opacity={0.5}
              />
              <text x={xOf(db)} y={COMP_H - 6} fontSize={9} fill={sub} textAnchor="middle">
                {db}
              </text>
            </g>
          ))}
          {yGrid.map((db) => (
            <g key={`y${db}`}>
              <line
                x1={PAD.left}
                y1={yComp(db)}
                x2={PLOT_W - PAD.right}
                y2={yComp(db)}
                stroke={gridCol}
                strokeWidth={1}
                opacity={0.5}
              />
              <text x={PAD.left - 5} y={yComp(db) + 3} fontSize={9} fill={sub} textAnchor="end">
                {db}
              </text>
            </g>
          ))}
          {comp?.idealLine ? (
            <line
              x1={xOf(comp.idealLine.x0)}
              y1={yComp(comp.idealLine.y0)}
              x2={xOf(comp.idealLine.x1)}
              y2={yComp(comp.idealLine.y1)}
              stroke={IDEAL_COLOR}
              strokeWidth={1.3}
              strokeDasharray="4 3"
            />
          ) : null}
          <polyline fill="none" stroke={ACTUAL_COLOR} strokeWidth={1.7} points={actualPts} />
          {comp?.p1db ? (
            <g>
              <line
                x1={xOf(comp.p1db.inputDb)}
                y1={compTop}
                x2={xOf(comp.p1db.inputDb)}
                y2={compBot}
                stroke={THEME.statusDanger}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.8}
              />
              <circle
                cx={xOf(comp.p1db.inputDb)}
                cy={yComp(comp.p1db.outputDb)}
                r={3}
                fill={THEME.statusDanger}
              />
            </g>
          ) : null}
          <text x={PAD.left} y={11} fontSize={9} fill={ACTUAL_COLOR}>
            output (dBV) vs drive — gain compression
          </text>
          {/* Harmonic spectrum */}
          {specGrid.map((dbc) => (
            <g key={`s${dbc}`}>
              <line
                x1={PAD.left}
                y1={ySpec(dbc)}
                x2={PLOT_W - PAD.right}
                y2={ySpec(dbc)}
                stroke={gridCol}
                strokeWidth={1}
                opacity={0.5}
              />
              <text x={PAD.left - 5} y={ySpec(dbc) + 3} fontSize={9} fill={sub} textAnchor="end">
                {dbc}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const cx = PAD.left + slotW * (i + 0.5)
            const h = b.heightFrac * (specBot - specTop)
            return (
              <g key={`bar${b.harmonic}`}>
                <rect
                  x={cx - Math.min(14, slotW * 0.3)}
                  y={specBot - h}
                  width={Math.min(28, slotW * 0.6)}
                  height={Math.max(0, h)}
                  fill={b.harmonic === 1 ? ACTUAL_COLOR : BAR_COLOR}
                  opacity={b.harmonic === 1 ? 0.9 : 0.8}
                />
                <text x={cx} y={specBot + 12} fontSize={9} fill={sub} textAnchor="middle">
                  {b.harmonic === 1 ? 'f' : `${b.harmonic}f`}
                </text>
              </g>
            )
          })}
          <text x={PAD.left} y={COMP_H + 11} fontSize={9} fill={BAR_COLOR}>
            harmonics (dBc) at {formatEng(specDrive, 'V')} drive
          </text>
        </svg>
      )}

      {picking ? (
        <div style={{ color: THEME.accentBlue, fontSize: 11, fontWeight: 600 }}>
          Click a terminal on the canvas to choose the output net…
        </div>
      ) : null}
      {ready && hasCurve && spec !== null ? (
        <div style={{ color: sub, fontSize: 10, lineHeight: 1.6 }}>
          Small-signal gain{' '}
          <span style={{ color: text, fontWeight: 700 }}>
            {Number.isFinite(comp.smallSignalGainDb) ? comp.smallSignalGainDb.toFixed(1) : '—'} dB
          </span>
          . {formatEng(fHz, 'Hz')} tone.{' '}
          {comp.p1db ? (
            <>
              P1dB at{' '}
              <span style={{ color: THEME.statusDanger, fontWeight: 700 }}>
                {comp.p1db.inputDb.toFixed(1)} dBV
              </span>{' '}
              in ({comp.p1db.outputDb.toFixed(1)} dBV out).{' '}
            </>
          ) : (
            <>No 1-dB compression within the swept drive. </>
          )}
          THD at {formatEng(maxDrive, 'V')}:{' '}
          <span
            style={{
              color:
                spec.thdPercent < 1
                  ? THEME.statusOk
                  : spec.thdPercent < 10
                    ? THEME.lensTemp
                    : THEME.statusDanger,
              fontWeight: 700,
            }}
          >
            {spec.thdPercent < 0.01 ? '<0.01' : spec.thdPercent.toFixed(2)}%
          </span>
          .
        </div>
      ) : null}
    </div>
  )
}
