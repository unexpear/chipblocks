import type { World } from '../cross-fk-validator.ts'
import { readScalarParam } from '../instance-params.ts'
import type { TransientResult } from '../transient-solver.ts'
import { formatEng } from './units.ts'

/**
 * Scope (Sprint 19 S19-v3-42..45 arc): run the canvas circuit through TIME and
 * plot every node voltage as a waveform — the first place the user can watch a
 * capacitor charge, an AC source swing, a rectifier chop, an amplifier amplify.
 * The plot is plain SVG; the physics all comes from solveTransient.
 */

/**
 * Pick the simulated window. This is a DISPLAY heuristic (what's worth looking
 * at), not physics: 3 periods of the slowest AC source if one exists; else 5× the
 * slowest charging timescale present — R·C for capacitors, L/R for inductors
 * (largest values of each); else 1 ms (a circuit with no time-dependent elements
 * settles instantly — flat lines are honest). Always 500 steps across the window.
 */
export function scopeWindow(world: World): { timeStep: number; duration: number } {
  let slowestAcHz = Number.POSITIVE_INFINITY
  let maxOhms = 0
  let maxFarads = 0
  let maxHenry = 0
  for (const inst of world.instances.values()) {
    if (inst.definition === 'power_source') {
      const amplitude = readScalarParam(inst, 'ac_amplitude') ?? 0
      const frequency = readScalarParam(inst, 'frequency') ?? 0
      if (amplitude > 0 && frequency > 0) slowestAcHz = Math.min(slowestAcHz, frequency)
    } else if (inst.definition === 'resistor') {
      maxOhms = Math.max(maxOhms, readScalarParam(inst, 'resistance') ?? 0)
    } else if (inst.definition === 'capacitor') {
      maxFarads = Math.max(maxFarads, readScalarParam(inst, 'capacitance') ?? 0)
    } else if (inst.definition === 'inductor') {
      maxHenry = Math.max(maxHenry, readScalarParam(inst, 'inductance') ?? 0)
    } else if (
      inst.definition === 'transformer' ||
      inst.definition === 'transformer_center_tapped'
    ) {
      maxHenry = Math.max(maxHenry, readScalarParam(inst, 'primary_inductance') ?? 0)
    }
  }
  let duration: number
  if (Number.isFinite(slowestAcHz)) {
    duration = 3 / slowestAcHz
  } else {
    const tauRC = maxOhms > 0 && maxFarads > 0 ? maxOhms * maxFarads : 0
    const tauRL = maxOhms > 0 && maxHenry > 0 ? maxHenry / maxOhms : 0
    const tau = Math.max(tauRC, tauRL)
    duration = tau > 0 ? 5 * tau : 1e-3
  }
  return { timeStep: duration / 500, duration }
}

const TRACE_COLORS = [
  '#e0594f',
  '#5a86d8',
  '#6ec06e',
  '#d8a35a',
  '#a06ad8',
  '#5ad8c8',
  '#d85a9a',
  '#9ad85a',
]

const PLOT_W = 440
const PLOT_H = 190
const MARGIN = { left: 48, right: 10, top: 8, bottom: 20 }

/** Node-voltage waveforms from a transient run. Non-solved statuses report honestly. */
export function ScopePlot({ result, light }: { result: TransientResult; light: boolean }) {
  const textColor = light ? '#556' : '#9aa'
  if (result.status !== 'solved' || result.series.length < 2) {
    return (
      <div style={{ fontSize: 11, color: textColor, maxWidth: 300, fontFamily: 'system-ui' }}>
        Scope could not run: {result.status}
        {result.warnings.length > 0 ? ` — ${result.warnings[0]}` : ''}
      </div>
    )
  }

  const series = result.series
  const first = series[0]
  if (first === undefined) return null
  // Every net except the ground reference (always flat 0 — it IS the zero line).
  const nets = [...first.nodes.keys()].filter((n) => n !== result.ground).sort()

  const tEnd = series[series.length - 1]?.time ?? 1
  let vMin = Number.POSITIVE_INFINITY
  let vMax = Number.NEGATIVE_INFINITY
  for (const pt of series) {
    for (const net of nets) {
      const v = pt.nodes.get(net) ?? 0
      if (v < vMin) vMin = v
      if (v > vMax) vMax = v
    }
  }
  if (!(vMax > vMin)) {
    // All traces flat at one value — open a ±0.5 V window around it.
    vMin -= 0.5
    vMax += 0.5
  }
  const pad = 0.06 * (vMax - vMin)
  vMin -= pad
  vMax += pad

  const innerW = PLOT_W - MARGIN.left - MARGIN.right
  const innerH = PLOT_H - MARGIN.top - MARGIN.bottom
  const x = (t: number) => MARGIN.left + (t / tEnd) * innerW
  const y = (v: number) => MARGIN.top + (1 - (v - vMin) / (vMax - vMin)) * innerH

  const gridStroke = light ? '#d4d8de' : '#26262c'
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => vMin + f * (vMax - vMin))
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * tEnd)

  // Steady DC: every trace flat is CORRECT (nothing changes over time in a DC
  // circuit at rest) — but it reads as "broken" without saying so.
  const allFlat = nets.every((net) => {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const pt of series) {
      const v = pt.nodes.get(net) ?? 0
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    return hi - lo < 1e-9
  })

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <svg
        width={PLOT_W}
        height={PLOT_H}
        style={{ background: light ? '#fafbfc' : '#0e0e11', borderRadius: 4 }}
        role="img"
        aria-label="Node voltages over time"
      >
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line
              x1={MARGIN.left}
              y1={y(v)}
              x2={PLOT_W - MARGIN.right}
              y2={y(v)}
              stroke={gridStroke}
              strokeWidth={1}
            />
            <text x={MARGIN.left - 4} y={y(v) + 3} fontSize={9} fill={textColor} textAnchor="end">
              {formatEng(v, 'V', { signed: true })}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text
            key={`x${t}`}
            x={x(t)}
            y={PLOT_H - 6}
            fontSize={9}
            fill={textColor}
            textAnchor="middle"
          >
            {formatEng(t, 's')}
          </text>
        ))}
        {nets.map((net, i) => (
          <polyline
            key={net}
            fill="none"
            stroke={TRACE_COLORS[i % TRACE_COLORS.length]}
            strokeWidth={1.4}
            points={series.map((p) => `${x(p.time)},${y(p.nodes.get(net) ?? 0)}`).join(' ')}
          />
        ))}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4, maxWidth: PLOT_W }}>
        {nets.map((net, i) => (
          <span key={net} style={{ fontSize: 10, color: TRACE_COLORS[i % TRACE_COLORS.length] }}>
            — {net}
          </span>
        ))}
      </div>
      {allFlat ? (
        <div style={{ fontSize: 10, color: textColor, marginTop: 4, maxWidth: PLOT_W }}>
          Flat lines = steady DC. Current IS flowing — each line sits at that point's real voltage
          (a bench oscilloscope on a battery circuit shows the same) — it just isn't changing over
          time. Add an AC source (Source → type → "AC signal") or wire in a capacitor / inductor to
          see voltages move.
        </div>
      ) : null}
    </div>
  )
}
