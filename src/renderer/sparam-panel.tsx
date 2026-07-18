import { useMemo, useState } from 'react'
import { portSParameterSweep } from '../ac-analysis.ts'
import type { World } from '../cross-fk-validator.ts'
import { readScalarParam } from '../instance-params.ts'
import { sparamView } from './sparam-view.ts'
import { THEME } from './theme.ts'
import { formatEng } from './units.ts'

/**
 * S-parameter panel — the canvas front end for the 2-port scattering engine (portSParameterSweep). Pick two
 * ports (Port 1 / Port 2) and a reference impedance Z0, choose a frequency span, and it draws the two-stack
 * S-parameter view: TRANSMISSION |S21| / |S12| in dB on top (the honest gain / insertion loss — 0 dB is
 * lossless, negative is loss) and MATCH |S11| / |S22| beneath (how much each port reflects — deeper is better
 * matched). The complex waves come straight out of the same AC solve the Bode/Reflection panels use.
 *
 * Selections are stored loosely (by id) and re-validated each render; non-finite points are dropped. Z0
 * defaults to Port 1's own reference impedance (a reference-port's 50 Ω) and can be overridden.
 */

const PLOT_W = 480
const TRANS_H = 128
const MATCH_H = 122
const PAD = { left: 44, right: 16, top: 12, bottom: 18 }
const INNER_W = PLOT_W - PAD.left - PAD.right
const S21_COLOR = THEME.accentBlueBright
const S12_COLOR = THEME.textMuted
const S11_COLOR = THEME.lensTemp
const S22_COLOR = THEME.textMuted
const PORT_DEFINITIONS = new Set(['power_source', 'reference_port'])

const RANGES: { label: string; lo: number; hi: number }[] = [
  { label: '1 kHz – 1 GHz', lo: 1e3, hi: 1e9 },
  { label: '1 MHz – 10 GHz', lo: 1e6, hi: 1e10 },
  { label: '10 MHz – 100 GHz', lo: 1e7, hi: 1e11 },
  { label: '1 Hz – 1 MHz', lo: 1, hi: 1e6 },
]

export function SParamPanel({
  world,
  temperaturesC,
  light,
  onClose,
  port1,
  onPort1,
  port2,
  onPort2,
}: {
  world: World
  temperaturesC: Map<string, number>
  light: boolean
  onClose: () => void
  port1: string
  onPort1: (id: string) => void
  port2: string
  onPort2: (id: string) => void
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
    maxWidth: 120,
  }

  const ports = useMemo(
    () =>
      [...world.instances.values()]
        .filter((i) => PORT_DEFINITIONS.has(i.definition))
        .map((i) => i.id),
    [world],
  )
  const p1 = ports.includes(port1) ? port1 : (ports[0] ?? '')
  const p2 = ports.includes(port2) ? port2 : (ports.find((id) => id !== p1) ?? '')
  const portZ0 = useMemo(() => {
    const inst = p1 === '' ? undefined : world.instances.get(p1)
    const z = inst ? readScalarParam(inst, 'reference_impedance') : undefined
    return z && z > 0 ? z : 50
  }, [world, p1])
  const [z0Text, setZ0Text] = useState('')
  const z0Override = Number(z0Text)
  const z0 = z0Text.trim() !== '' && z0Override > 0 ? z0Override : portZ0
  const [rangeIdx, setRangeIdx] = useState(0)

  const range = RANGES[rangeIdx] ?? RANGES[0]
  // biome-ignore lint/style/noNonNullAssertion: RANGES[0] is a literal fallback
  const { lo: fLo, hi: fHi } = range!

  const ready = p1 !== '' && p2 !== '' && p1 !== p2
  const sweep = useMemo(() => {
    if (!ready) return []
    return portSParameterSweep(world, {
      port1: p1,
      port2: p2,
      z0Ohms: z0,
      fStartHz: fLo,
      fStopHz: fHi,
      pointsPerDecade: 20,
      temperaturesC,
    }).filter((pt) => Number.isFinite(pt.s21Db) || Number.isFinite(pt.s11Db))
  }, [ready, world, p1, p2, z0, fLo, fHi, temperaturesC])

  const view = sparamView(sweep)
  const logLo = Math.log10(fLo)
  const logHi = Math.log10(fHi)
  const xOf = (f: number) => PAD.left + ((Math.log10(f) - logLo) / (logHi - logLo)) * INNER_W
  const decades: number[] = []
  for (let d = Math.ceil(logLo); d <= Math.floor(logHi); d++) decades.push(10 ** d)

  const [tLo, tHi] = view.transAxis
  const [mLo, mHi] = view.matchAxis
  const tTop = PAD.top
  const tBot = TRANS_H - PAD.bottom
  const yTrans = (db: number) => tTop + ((tHi - db) / (tHi - tLo)) * (tBot - tTop)
  const mTop = TRANS_H + PAD.top
  const mBot = TRANS_H + MATCH_H - PAD.bottom
  const yMatch = (db: number) => mTop + ((mHi - db) / (mHi - mLo)) * (mBot - mTop)

  const poly = (dbs: number[], y: (db: number) => number) =>
    sweep.map((pt, i) => `${xOf(pt.frequencyHz)},${y(dbs[i] as number)}`).join(' ')

  const gridDb = (lo: number, hi: number) => {
    const out: number[] = []
    for (let db = Math.ceil(lo / 10) * 10; db <= hi + 0.001; db += 10) out.push(db)
    return out
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: sub,
  }
  const portSelect = (value: string, onChange: (id: string) => void, label: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={labelStyle}>{label}</span>
      <select
        className="nodrag"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={fieldStyle}
      >
        {ports.length === 0 ? <option value="">(no port)</option> : null}
        {ports.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 6, minWidth: PLOT_W }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        {portSelect(p1, onPort1, 'Port 1')}
        {portSelect(p2, onPort2, 'Port 2')}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={labelStyle}>Z₀ (Ω)</span>
          <input
            className="nodrag"
            type="number"
            min={1}
            value={z0Text}
            placeholder={String(portZ0)}
            onChange={(e) => setZ0Text(e.target.value)}
            style={{ ...fieldStyle, maxWidth: 60 }}
          />
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
          {ports.length < 2
            ? 'Add two Ports (or sources) and a ground — S-parameters are measured between two ports.'
            : 'Pick two different ports — S-parameters describe the waves travelling between them.'}
        </div>
      ) : (
        <svg
          width={PLOT_W}
          height={TRANS_H + MATCH_H}
          style={{ background: light ? THEME.textBright : THEME.surfaceDeep, borderRadius: 4 }}
        >
          <title>S-parameters — transmission and match versus frequency</title>
          {decades.map((f) => (
            <g key={`dec${f}`}>
              <line x1={xOf(f)} y1={tTop} x2={xOf(f)} y2={tBot} stroke={gridCol} strokeWidth={1} />
              <line x1={xOf(f)} y1={mTop} x2={xOf(f)} y2={mBot} stroke={gridCol} strokeWidth={1} />
              <text
                x={xOf(f)}
                y={TRANS_H + MATCH_H - 5}
                fontSize={9}
                fill={sub}
                textAnchor="middle"
              >
                {formatEng(f, 'Hz')}
              </text>
            </g>
          ))}
          {gridDb(tLo, tHi).map((db) => (
            <g key={`t${db}`}>
              <line
                x1={PAD.left}
                y1={yTrans(db)}
                x2={PLOT_W - PAD.right}
                y2={yTrans(db)}
                stroke={gridCol}
                strokeWidth={1}
                opacity={db === 0 ? 1 : 0.5}
              />
              <text x={PAD.left - 5} y={yTrans(db) + 3} fontSize={9} fill={sub} textAnchor="end">
                {db}
              </text>
            </g>
          ))}
          {gridDb(mLo, mHi).map((db) => (
            <g key={`m${db}`}>
              <line
                x1={PAD.left}
                y1={yMatch(db)}
                x2={PLOT_W - PAD.right}
                y2={yMatch(db)}
                stroke={gridCol}
                strokeWidth={1}
                opacity={0.5}
              />
              <text x={PAD.left - 5} y={yMatch(db) + 3} fontSize={9} fill={sub} textAnchor="end">
                {db}
              </text>
            </g>
          ))}
          <polyline
            fill="none"
            stroke={S12_COLOR}
            strokeWidth={1.2}
            points={poly(view.s12Db, yTrans)}
          />
          <polyline
            fill="none"
            stroke={S21_COLOR}
            strokeWidth={1.7}
            points={poly(view.s21Db, yTrans)}
          />
          <polyline
            fill="none"
            stroke={S22_COLOR}
            strokeWidth={1.2}
            points={poly(view.s22Db, yMatch)}
          />
          <polyline
            fill="none"
            stroke={S11_COLOR}
            strokeWidth={1.7}
            points={poly(view.s11Db, yMatch)}
          />
          <text x={PAD.left} y={9} fontSize={9} fill={S21_COLOR}>
            transmission (dB) — |S21| bold, |S12| faint
          </text>
          <text x={PAD.left} y={TRANS_H + 9} fontSize={9} fill={S11_COLOR}>
            match (dB) — |S11| bold, |S22| faint
          </text>
        </svg>
      )}

      {view.peakS21 !== null || view.bestMatch !== null ? (
        <div style={{ color: sub, fontSize: 10, lineHeight: 1.6 }}>
          {view.peakS21 !== null ? (
            <>
              Peak |S21|{' '}
              <span style={{ color: S21_COLOR, fontWeight: 700 }}>
                {view.peakS21.db.toFixed(1)} dB
              </span>{' '}
              at {formatEng(view.peakS21.frequencyHz, 'Hz')}.{' '}
            </>
          ) : null}
          {view.bestMatch !== null ? (
            <>
              Best input match{' '}
              <span style={{ color: S11_COLOR, fontWeight: 700 }}>
                {view.bestMatch.db.toFixed(1)} dB
              </span>{' '}
              |S11| at {formatEng(view.bestMatch.frequencyHz, 'Hz')}.{' '}
            </>
          ) : null}
          Referenced to Z₀ = {z0} Ω.
        </div>
      ) : null}
    </div>
  )
}
