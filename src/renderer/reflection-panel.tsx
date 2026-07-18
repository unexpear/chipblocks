import { useMemo, useState } from 'react'
import { portReflectionSweep } from '../ac-analysis.ts'
import type { World } from '../cross-fk-validator.ts'
import { readScalarParam } from '../instance-params.ts'
import {
  panelColors,
  panelFieldStyle,
  panelLabelStyle,
  RF_FREQUENCY_RANGES as RANGES,
} from './panel-style.ts'
import { RL_PLOT_MAX, reflectionView, VSWR_PLOT_MAX } from './reflection-view.ts'
import { THEME } from './theme.ts'
import { formatEng } from './units.ts'

/**
 * Reflection panel — the canvas front end for the 1-port RF reflection engine (portReflectionSweep). Pick a
 * PORT (a source or a reference-port), set the reference impedance Z0, choose a frequency span, and it draws
 * the two-stack match view: RETURN LOSS in dB on top (higher = better matched — it PEAKS where the input is
 * matched) and VSWR beneath (dips to 1 at a match). The complex input impedance Zin the port sees is read
 * straight out of the same AC solve the Bode panel uses — this is the read-out RF work lives by.
 *
 * Like the Bode panel, selections are stored loosely (by id) and re-validated each render, and non-finite
 * points are dropped. Z0 defaults to the port's own reference impedance (a reference-port's 50 Ω) and can be
 * overridden in the field.
 */

const PLOT_W = 470
const RL_H = 128
const VSWR_H = 116
const PAD = { left: 52, right: 16, top: 12, bottom: 18 }
const INNER_W = PLOT_W - PAD.left - PAD.right
const RL_COLOR = THEME.accentBlueBright
const VSWR_COLOR = THEME.lensTemp
const PORT_DEFINITIONS = new Set(['power_source', 'reference_port'])

export function ReflectionPanel({
  world,
  temperaturesC,
  light,
  onClose,
  port,
  onPort,
  picking,
  onPickToggle,
}: {
  world: World
  temperaturesC: Map<string, number>
  light: boolean
  onClose: () => void
  /** The port instance id, lifted to App so a canvas terminal-click can set it. */
  port: string
  onPort: (id: string) => void
  picking: boolean
  onPickToggle: () => void
}) {
  const { text, gridCol, sub } = panelColors(light)
  const fieldStyle = panelFieldStyle(light)

  const sources = useMemo(
    () =>
      [...world.instances.values()]
        .filter((i) => PORT_DEFINITIONS.has(i.definition))
        .map((i) => i.id),
    [world],
  )
  const inPort = sources.includes(port) ? port : (sources[0] ?? '')
  // Z0 defaults to the port's own reference impedance (a reference-port carries 50 Ω); a field can override.
  const portZ0 = useMemo(() => {
    const inst = inPort === '' ? undefined : world.instances.get(inPort)
    const z = inst ? readScalarParam(inst, 'reference_impedance') : undefined
    return z && z > 0 ? z : 50
  }, [world, inPort])
  const [z0Text, setZ0Text] = useState('')
  const z0Override = Number(z0Text)
  const z0 = z0Text.trim() !== '' && z0Override > 0 ? z0Override : portZ0
  const [rangeIdx, setRangeIdx] = useState(1)

  const range = RANGES[rangeIdx] ?? RANGES[1]
  // biome-ignore lint/style/noNonNullAssertion: RANGES[1] is a literal fallback
  const { lo: fLo, hi: fHi } = range!

  const sweep = useMemo(() => {
    if (inPort === '') return []
    return portReflectionSweep(world, {
      inputSource: inPort,
      z0Ohms: z0,
      fStartHz: fLo,
      fStopHz: fHi,
      pointsPerDecade: 20,
      temperaturesC,
    }).filter((p) => Number.isFinite(p.gammaMag))
  }, [world, inPort, z0, fLo, fHi, temperaturesC])

  const logLo = Math.log10(fLo)
  const logHi = Math.log10(fHi)
  const xOf = (f: number) => PAD.left + ((Math.log10(f) - logLo) / (logHi - logLo)) * INNER_W
  const decades: number[] = []
  for (let d = Math.ceil(logLo); d <= Math.floor(logHi); d++) decades.push(10 ** d)

  // The plot model — clamps, axes (VSWR floored at 1), and the best match — is a pure, unit-tested function
  // (reflection-view.ts); the panel only maps it to SVG. `best` is null for an empty sweep.
  const view = reflectionView(sweep)
  const [rlLo, rlHi] = view.rlAxis
  const [vLo, vHi] = view.vswrAxis
  const best = view.best

  const rlTop = PAD.top
  const rlBot = RL_H - PAD.bottom
  const yRl = (db: number) => rlTop + ((rlHi - db) / (rlHi - rlLo)) * (rlBot - rlTop)
  const vTop = RL_H + PAD.top
  const vBot = RL_H + VSWR_H - PAD.bottom
  const yVswr = (v: number) => vTop + ((vHi - v) / (vHi - vLo)) * (vBot - vTop)

  const rlPts = sweep
    .map((p, i) => `${xOf(p.frequencyHz)},${yRl(view.rlClamped[i] as number)}`)
    .join(' ')
  const vswrPts = sweep
    .map((p, i) => `${xOf(p.frequencyHz)},${yVswr(view.vswrClamped[i] as number)}`)
    .join(' ')

  const rlGrid: number[] = []
  for (let db = rlLo; db <= rlHi + 0.001; db += 10) rlGrid.push(db)
  const vGrid: number[] = []
  const vStep = Math.max(1, Math.round((vHi - vLo) / 4))
  for (let v = vLo; v <= vHi + 0.001; v += vStep) vGrid.push(v)

  const labelStyle = panelLabelStyle(light)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 6, minWidth: PLOT_W }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={labelStyle}>Port</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <select
              className="nodrag"
              value={inPort}
              onChange={(e) => onPort(e.target.value)}
              style={fieldStyle}
            >
              {sources.length === 0 ? <option value="">(no port)</option> : null}
              {sources.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="nodrag"
              onClick={onPickToggle}
              title={
                picking
                  ? 'Click a source / port terminal on the canvas to choose the port'
                  : 'Pick the port by clicking a source terminal on the canvas, like a scope probe'
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
          <span style={labelStyle}>Z₀ (Ω)</span>
          <input
            className="nodrag"
            type="number"
            min={1}
            value={z0Text}
            placeholder={String(portZ0)}
            onChange={(e) => setZ0Text(e.target.value)}
            style={{ ...fieldStyle, maxWidth: 64 }}
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
          {sources.length === 0
            ? 'Add a Port (or a source) and a ground — the reflection is measured looking into the port.'
            : 'No reflection — check the port is wired to the circuit and a ground is present.'}
        </div>
      ) : (
        <svg
          width={PLOT_W}
          height={RL_H + VSWR_H}
          style={{ background: light ? THEME.textBright : THEME.surfaceDeep, borderRadius: 4 }}
        >
          <title>Reflection — return loss and VSWR versus frequency</title>
          {decades.map((f) => (
            <g key={`dec${f}`}>
              <line
                x1={xOf(f)}
                y1={rlTop}
                x2={xOf(f)}
                y2={rlBot}
                stroke={gridCol}
                strokeWidth={1}
              />
              <line x1={xOf(f)} y1={vTop} x2={xOf(f)} y2={vBot} stroke={gridCol} strokeWidth={1} />
              <text x={xOf(f)} y={RL_H + VSWR_H - 5} fontSize={9} fill={sub} textAnchor="middle">
                {formatEng(f, 'Hz')}
              </text>
            </g>
          ))}
          {rlGrid.map((db) => (
            <g key={`rl${db}`}>
              <line
                x1={PAD.left}
                y1={yRl(db)}
                x2={PLOT_W - PAD.right}
                y2={yRl(db)}
                stroke={gridCol}
                strokeWidth={1}
                opacity={0.5}
              />
              <text x={PAD.left - 5} y={yRl(db) + 3} fontSize={9} fill={sub} textAnchor="end">
                {db}
              </text>
            </g>
          ))}
          {vGrid.map((v) => (
            <g key={`v${v}`}>
              <line
                x1={PAD.left}
                y1={yVswr(v)}
                x2={PLOT_W - PAD.right}
                y2={yVswr(v)}
                stroke={gridCol}
                strokeWidth={1}
                opacity={v === 1 ? 1 : 0.5}
              />
              <text x={PAD.left - 5} y={yVswr(v) + 3} fontSize={9} fill={sub} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {best?.frequencyHz !== undefined ? (
            <line
              x1={xOf(best.frequencyHz)}
              y1={rlTop}
              x2={xOf(best.frequencyHz)}
              y2={rlBot}
              stroke={RL_COLOR}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.7}
            />
          ) : null}
          <polyline fill="none" stroke={RL_COLOR} strokeWidth={1.7} points={rlPts} />
          <polyline fill="none" stroke={VSWR_COLOR} strokeWidth={1.7} points={vswrPts} />
          <text x={PAD.left} y={9} fontSize={9} fill={RL_COLOR}>
            return loss (dB)
          </text>
          <text x={PAD.left} y={RL_H + 9} fontSize={9} fill={VSWR_COLOR}>
            VSWR
          </text>
        </svg>
      )}

      {picking ? (
        <div style={{ color: THEME.accentBlue, fontSize: 11, fontWeight: 600 }}>
          Click a source / port terminal on the canvas to choose the port…
        </div>
      ) : null}
      {best !== null ? (
        <div style={{ color: sub, fontSize: 10, lineHeight: 1.6 }}>
          Best match ≈ {formatEng(best.frequencyHz, 'Hz')}:{' '}
          <span
            style={{
              color:
                best.vswr < 1.5
                  ? THEME.statusOk
                  : best.vswr < 3
                    ? THEME.lensTemp
                    : THEME.statusDanger,
              fontWeight: 700,
            }}
          >
            {best.returnLossDb >= RL_PLOT_MAX ? '∞' : best.returnLossDb.toFixed(1)} dB
          </span>{' '}
          return loss, VSWR {best.vswr >= VSWR_PLOT_MAX ? '∞' : best.vswr.toFixed(2)}, Zin{' '}
          {best.zinRe.toFixed(1)}
          {best.zinIm >= 0 ? ' + j' : ' − j'}
          {Math.abs(best.zinIm).toFixed(1)} Ω. Referenced to Z₀ = {z0} Ω, {formatEng(fLo, 'Hz')} to{' '}
          {formatEng(fHi, 'Hz')}.
        </div>
      ) : null}
    </div>
  )
}
