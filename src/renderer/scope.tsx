import { useEffect, useState } from 'react'
import type { World } from '../cross-fk-validator.ts'
import { readScalarParam } from '../instance-params.ts'
import type { TransientResult } from '../transient-solver.ts'
import { H_DIVISIONS, TIMEBASES, transformFor, V_DIVISIONS, VOLTS_PER_DIV } from './scope-scales.ts'
import { alignSweep, autoLevel, type TriggerEdge, type TriggerMode } from './scope-trigger.ts'
import { formatEng } from './units.ts'

/**
 * Scope (Sprint 19 S19-v3-42..45 arc; TRIGGERING S19-v3-75): run the canvas
 * circuit through TIME and plot node voltages as waveforms. The record is
 * several windows long; the TRIGGER aligns the displayed sweep to the chosen
 * signal crossing the chosen level on the chosen edge — t = 0 of the display
 * IS the trigger instant (with a slice of pre-trigger history to its left),
 * so a repeating wave stands still instead of wandering. Modes follow the
 * bench convention: Auto free-runs when nothing triggers, Normal waits,
 * Single captures one triggered sweep and holds it. Run/Stop freezes the
 * display. The physics all comes from solveTransient.
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

/**
 * The fastest AC source present — the honest-sampling constraint. The window
 * heuristic above follows the SLOWEST source (what's worth looking at); the
 * sample spacing must follow the fastest (what would alias). Shared with the
 * multimeter's V~ mode.
 */
export function fastestSourceHz(world: World): number {
  let fastest = 0
  for (const inst of world.instances.values()) {
    if (inst.definition !== 'power_source') continue
    const amplitude = readScalarParam(inst, 'ac_amplitude') ?? 0
    const frequency = readScalarParam(inst, 'frequency') ?? 0
    if (amplitude > 0 && frequency > fastest) fastest = frequency
  }
  return fastest
}

export const TRACE_COLORS = [
  '#e0594f',
  '#5a86d8',
  '#6ec06e',
  '#d8a35a',
  '#a06ad8',
  '#5ad8c8',
  '#d85a9a',
  '#9ad85a',
]

/** One scope channel: a probed terminal, the net it sits on, its label. */
export type ScopeChannel = { key: string; label: string; net: string }

/**
 * Channels from the user's probes (S19-v3-77): each probed terminal becomes
 * a channel reading ITS net; a probe whose terminal no longer resolves (the
 * part was deleted) is dropped, never invented. Pure — the App supplies the
 * terminal→net lookup (the same one the multimeter probes use).
 */
export function channelsForProbes(
  probes: { nodeId: string; handleId: string }[],
  netOfTerminal: (terminalKey: string) => string | undefined,
): ScopeChannel[] {
  const channels: ScopeChannel[] = []
  for (const probe of probes) {
    const key = `${probe.nodeId}/${probe.handleId}`
    const net = netOfTerminal(key)
    if (net === undefined) continue
    channels.push({
      key,
      label: `${probe.nodeId} · ${probe.handleId.replace(/_/g, ' ')}`,
      net,
    })
  }
  return channels
}

const PLOT_W = 440
const PLOT_H = 190
const MARGIN = { left: 48, right: 10, top: 8, bottom: 20 }
const TRIGGER_COLOR = '#d6a23c'

// The graticule's line positions, keyed by division number (a fixed ruler,
// not list data — the division IS the identity).
const H_GRID_DIVS = Array.from({ length: H_DIVISIONS + 1 }, (_, k) => k)
const V_GRID_DIVS = Array.from({ length: V_DIVISIONS + 1 }, (_, k) => k)
const X_LABEL_DIVS = Array.from({ length: H_DIVISIONS / 2 + 1 }, (_, k) => 2 * k)

/** One displayed sweep: the points, where the trigger sits, what was set. */
type Sweep = {
  points: { time: number; nodes: Map<string, number> }[]
  /** Index inside `points` of the trigger instant; null = free-running. */
  triggerIndex: number | null
  level: number | null
  sourceKey: string | null
  channels: ScopeChannel[]
}

/** The channel with the LARGEST swing — what the trigger's Auto source picks. */
function widestSwingChannel(
  series: { nodes: Map<string, number> }[],
  channels: ScopeChannel[],
): ScopeChannel | null {
  let best: ScopeChannel | null = null
  let bestSwing = -1
  for (const channel of channels) {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const pt of series) {
      const v = pt.nodes.get(channel.net) ?? 0
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (hi - lo > bestSwing) {
      bestSwing = hi - lo
      best = channel
    }
  }
  return best
}

/**
 * Node-voltage waveforms from a transient run, displayed through a real
 * trigger. Non-solved statuses report honestly; a held sweep stays held.
 */
export function ScopePlot({
  result,
  light,
  windowDuration,
  channels,
  onRemoveChannel,
  secPerDiv,
  onSecPerDiv,
  autoSecPerDiv,
  refusal,
}: {
  result: TransientResult | null
  light: boolean
  /** One display-window's worth of time; the record is several windows long. */
  windowDuration: number
  /** The probed channels (S19-v3-77) — ONLY these plot; clutter hides answers. */
  channels: ScopeChannel[]
  onRemoveChannel: (key: string) => void
  /** Timebase SETTING (S19-v3-78): seconds per division, or the auto heuristic. */
  secPerDiv: number | 'auto'
  onSecPerDiv: (next: number | 'auto') => void
  /** What the auto timebase currently works out to — labels the auto stop. */
  autoSecPerDiv: number
  /** Honest-sampling refusal from the App; when set, no trace is drawn. */
  refusal: string | null
}) {
  const textColor = light ? '#556' : '#9aa'
  const [trigSource, setTrigSource] = useState('auto')
  const [levelText, setLevelText] = useState('auto')
  const [edge, setEdge] = useState<TriggerEdge>('rising')
  const [mode, setMode] = useState<TriggerMode>('auto')
  const [held, setHeld] = useState<Sweep | null>(null)
  const [armed, setArmed] = useState(false)
  // Per-channel volts/div knob (S19-v3-78); absent = auto fit.
  const [vdivSettings, setVdivSettings] = useState<Record<string, number | 'auto'>>({})

  // Derive this run's sweep (live path; a held sweep displays instead).
  const solved = result !== null && result.status === 'solved' && result.series.length >= 2
  const series = solved ? result.series : []
  const dt = series.length >= 2 ? (series[1]?.time ?? 0) - (series[0]?.time ?? 0) : 1
  const windowPoints = Math.max(2, Math.min(series.length, Math.round(windowDuration / dt) + 1))
  // The trigger watches a CHANNEL; a removed channel falls back to auto.
  const pickedChannel =
    trigSource === 'auto' ? undefined : channels.find((c) => c.key === trigSource)
  const sourceChannel = pickedChannel ?? widestSwingChannel(series, channels)
  const samples =
    sourceChannel === null ? [] : series.map((p) => p.nodes.get(sourceChannel.net) ?? 0)
  const parsedLevel = Number.parseFloat(levelText)
  const level =
    levelText.trim() === 'auto' || Number.isNaN(parsedLevel) ? autoLevel(samples) : parsedLevel
  const aligned =
    samples.length > 0
      ? alignSweep({ samples, level, edge, windowPoints, searchFrom: windowPoints })
      : null

  const liveSweep: Sweep | null =
    !solved || channels.length === 0
      ? null
      : aligned !== null
        ? {
            points: series.slice(aligned.start, aligned.start + windowPoints),
            triggerIndex: aligned.triggerOffset,
            level,
            sourceKey: sourceChannel?.key ?? null,
            channels,
          }
        : {
            // Free run: the first window (the power-on view — a charging
            // capacitor's curve lives here).
            points: series.slice(0, windowPoints),
            triggerIndex: null,
            level: sourceChannel === null ? null : level,
            sourceKey: sourceChannel?.key ?? null,
            channels,
          }

  // Single: capture the first sweep whose trigger fires, then hold it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveSweep/aligned are derived from these inputs each render; listing the inputs is the stable form
  useEffect(() => {
    if (mode !== 'single' || !armed || held !== null) return
    if (aligned === null || liveSweep === null) return
    setHeld(liveSweep)
    setArmed(false)
  }, [result, mode, armed, held, trigSource, levelText, edge])

  const sweep = held ?? liveSweep

  const controlStyle: React.CSSProperties = {
    fontSize: 10,
    background: light ? '#fff' : '#1b1b1f',
    color: light ? '#223' : '#cdd6e0',
    border: '1px solid #2a2a2f',
    borderRadius: 4,
    padding: '2px 4px',
  }

  // The horizontal knob: seconds per grid square, 10 squares across. Always
  // rendered — even (especially) when the current setting was refused, so the
  // user can back out to an honest one.
  const horizRow = (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, maxWidth: PLOT_W }}
    >
      <span style={{ fontSize: 10, color: textColor }}>Horiz</span>
      <select
        value={secPerDiv === 'auto' ? 'auto' : String(secPerDiv)}
        onChange={(e) => {
          const next = e.target.value
          onSecPerDiv(next === 'auto' ? 'auto' : Number(next))
          setHeld(null)
          if (mode === 'single') setArmed(true)
        }}
        className="nodrag"
        title={`How much time one grid square spans (10 squares across the screen) — zoom into one edge or out to many cycles. Auto fits a few cycles of the slowest source (now ${formatEng(autoSecPerDiv, 's')}/div). Changing it re-runs the capture at the new sample spacing, like a real scope re-acquiring.`}
        style={controlStyle}
      >
        <option value="auto">auto ({formatEng(autoSecPerDiv, 's')}/div)</option>
        {TIMEBASES.map((t) => (
          <option key={t} value={String(t)}>
            {formatEng(t, 's')}/div
          </option>
        ))}
      </select>
    </div>
  )

  if (refusal !== null) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif' }}>
        {horizRow}
        <div style={{ fontSize: 11, color: textColor, maxWidth: 340 }}>{refusal}</div>
      </div>
    )
  }

  if (sweep === null) {
    if (solved && channels.length === 0) {
      return (
        <div style={{ fontSize: 11, color: textColor, maxWidth: 320, fontFamily: 'system-ui' }}>
          No probes attached. With the Scope open (and the plain select tool), CLICK terminal dots
          on the canvas to clip a probe there — each probed point becomes a colored channel, like
          clipping real scope leads where you care. Click a dot again to unclip it.
        </div>
      )
    }
    return (
      <div style={{ fontSize: 11, color: textColor, maxWidth: 300, fontFamily: 'system-ui' }}>
        Scope could not run: {result?.status ?? 'no simulation yet'}
        {result !== null && result.warnings.length > 0 ? ` — ${result.warnings[0]}` : ''}
      </div>
    )
  }

  const waitingInNormal = held === null && mode === 'normal' && sweep.triggerIndex === null
  const points = sweep.points
  // t = 0 at the trigger instant (pre-trigger history shows as negative time);
  // a free-running sweep starts its clock at the window's first sample.
  const tZero =
    sweep.triggerIndex !== null ? (points[sweep.triggerIndex]?.time ?? 0) : (points[0]?.time ?? 0)
  const tFirst = (points[0]?.time ?? 0) - tZero
  const tLast = (points[points.length - 1]?.time ?? 1) - tZero

  // Each channel maps volts → pixels through ITS OWN knob (S19-v3-78): the
  // scale is that channel's volts/div (auto = fit), the offset auto-centers
  // on the channel's midpoint — display placement only, the data is untouched.
  // Auto fit reads the whole live record so the scale doesn't breathe as the
  // trigger slides; a held sweep fits its frozen points.
  const fitPoints = held !== null ? held.points : series
  const transforms = new Map<string, { voltsPerDiv: number; offsetVolts: number }>()
  for (const channel of sweep.channels) {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const pt of fitPoints) {
      const v = pt.nodes.get(channel.net) ?? 0
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    transforms.set(channel.key, transformFor(lo, hi, vdivSettings[channel.key] ?? 'auto'))
  }

  const innerW = PLOT_W - MARGIN.left - MARGIN.right
  const innerH = PLOT_H - MARGIN.top - MARGIN.bottom
  const x = (t: number) => MARGIN.left + ((t - tFirst) / (tLast - tFirst || 1)) * innerW
  const pxPerDivY = innerH / V_DIVISIONS
  const centerY = MARGIN.top + innerH / 2
  const yFor = (key: string) => {
    const tf = transforms.get(key)
    if (tf === undefined) return () => centerY
    return (v: number) => centerY - ((v - tf.offsetVolts) / tf.voltsPerDiv) * pxPerDivY
  }
  // The axis numbers and the trigger-level line live in the SOURCE channel's
  // volts (the bold ▶ trace) — one ruler can only speak one channel's units.
  const sourceTf = sweep.sourceKey !== null ? transforms.get(sweep.sourceKey) : undefined
  const levelY =
    sweep.level !== null && sweep.sourceKey !== null ? yFor(sweep.sourceKey)(sweep.level) : null

  const gridStroke = light ? '#d4d8de' : '#26262c'

  // Steady DC: every trace flat is CORRECT (nothing changes over time in a DC
  // circuit at rest) — but it reads as "broken" without saying so.
  const allFlat = sweep.channels.every((channel) => {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const pt of points) {
      const v = pt.nodes.get(channel.net) ?? 0
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    return hi - lo < 1e-9
  })

  const status =
    held !== null
      ? mode === 'single'
        ? '● captured'
        : '● hold'
      : sweep.triggerIndex !== null
        ? "● trig'd"
        : mode === 'normal'
          ? '○ waiting'
          : '○ free'
  const statusColor =
    held !== null ? '#7ab8ff' : sweep.triggerIndex !== null ? '#6ec06e' : '#d6a23c'

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* The trigger row — the instrument's knobs. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 4,
          maxWidth: PLOT_W,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 10, color: textColor }}>Trig</span>
        <select
          value={trigSource}
          onChange={(e) => {
            setTrigSource(e.target.value)
            setHeld(null)
          }}
          className="nodrag"
          title="Which signal the trigger watches. Auto picks the one swinging the most."
          style={{ ...controlStyle, maxWidth: 110 }}
        >
          <option value="auto">
            auto{sourceChannel !== null ? ` (${sourceChannel.label})` : ''}
          </option>
          {channels.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="nodrag"
          onClick={() => {
            setEdge(edge === 'rising' ? 'falling' : 'rising')
            setHeld(null)
          }}
          title="Trigger edge: fire when the signal crosses the level going up (↗) or down (↘)"
          style={{ ...controlStyle, cursor: 'pointer' }}
        >
          {edge === 'rising' ? '↗' : '↘'}
        </button>
        <input
          value={levelText}
          onChange={(e) => {
            setLevelText(e.target.value)
            setHeld(null)
          }}
          className="nodrag"
          title={`Trigger level in volts — the sweep aligns where the signal crosses it. "auto" = the midpoint of the swing (now ${formatEng(level, 'V', { signed: true })}).`}
          style={{ ...controlStyle, width: 44 }}
        />
        <select
          value={mode}
          onChange={(e) => {
            const next = e.target.value as TriggerMode
            setMode(next)
            setHeld(null)
            setArmed(next === 'single')
          }}
          className="nodrag"
          title="Auto: free-run when nothing triggers. Normal: draw only when triggered. Single: capture the next triggered sweep and hold it (the sim re-runs from t = 0 on every edit; Single freezes the first sweep whose trigger fires)."
          style={controlStyle}
        >
          <option value="auto">Auto</option>
          <option value="normal">Normal</option>
          <option value="single">Single</option>
        </select>
        {mode === 'single' && held !== null ? (
          <button
            type="button"
            className="nodrag"
            onClick={() => {
              setHeld(null)
              setArmed(true)
            }}
            title="Drop the captured sweep and wait for the next trigger"
            style={{ ...controlStyle, cursor: 'pointer' }}
          >
            re-arm
          </button>
        ) : (
          <button
            type="button"
            className="nodrag"
            onClick={() => setHeld(held !== null ? null : sweep)}
            title="Stop freezes the display exactly as it is; Run lets it follow the circuit live again"
            style={{ ...controlStyle, cursor: 'pointer' }}
          >
            {held !== null ? 'run' : 'stop'}
          </button>
        )}
        <span style={{ fontSize: 10, color: statusColor, marginLeft: 'auto' }}>{status}</span>
      </div>
      {horizRow}

      <svg
        width={PLOT_W}
        height={PLOT_H}
        style={{ background: light ? '#fafbfc' : '#0e0e11', borderRadius: 4 }}
        role="img"
        aria-label="Node voltages over time"
      >
        <defs>
          <clipPath id="scope-screen">
            <rect x={MARGIN.left} y={MARGIN.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>
        {/* The graticule: 10 × 8 grid squares, center lines emphasized — the
            fixed ruler the /div knobs are read against. */}
        {H_GRID_DIVS.map((k) => (
          <line
            key={`gx${k}`}
            x1={MARGIN.left + (k / H_DIVISIONS) * innerW}
            y1={MARGIN.top}
            x2={MARGIN.left + (k / H_DIVISIONS) * innerW}
            y2={MARGIN.top + innerH}
            stroke={gridStroke}
            strokeWidth={1}
            opacity={k === H_DIVISIONS / 2 ? 1 : 0.5}
          />
        ))}
        {V_GRID_DIVS.map((k) => (
          <line
            key={`gy${k}`}
            x1={MARGIN.left}
            y1={MARGIN.top + (k / V_DIVISIONS) * innerH}
            x2={PLOT_W - MARGIN.right}
            y2={MARGIN.top + (k / V_DIVISIONS) * innerH}
            stroke={gridStroke}
            strokeWidth={1}
            opacity={k === V_DIVISIONS / 2 ? 1 : 0.5}
          />
        ))}
        {/* Axis numbers speak the ▶ source channel's volts (top, center, bottom). */}
        {sourceTf !== undefined
          ? [V_DIVISIONS / 2, 0, -V_DIVISIONS / 2].map((divs) => (
              <text
                key={`y${divs}`}
                x={MARGIN.left - 4}
                y={centerY - divs * pxPerDivY + 3}
                fontSize={9}
                fill={textColor}
                textAnchor="end"
              >
                {formatEng(sourceTf.offsetVolts + divs * sourceTf.voltsPerDiv, 'V', {
                  signed: true,
                })}
              </text>
            ))
          : null}
        {X_LABEL_DIVS.map((div) => {
          const t = tFirst + (div / H_DIVISIONS) * (tLast - tFirst)
          return (
            <text
              key={`x${div}`}
              x={x(t)}
              y={PLOT_H - 6}
              fontSize={9}
              fill={textColor}
              textAnchor="middle"
            >
              {formatEng(t, 's', { signed: sweep.triggerIndex !== null })}
            </text>
          )
        })}
        {/* Each channel's 0 V mark at the left edge (its offset auto-centers,
            so ground can sit off-screen — the arrow clamps and dims there). */}
        {waitingInNormal
          ? null
          : sweep.channels.map((channel, i) => {
              const yZero = yFor(channel.key)(0)
              const clamped = Math.max(MARGIN.top, Math.min(MARGIN.top + innerH, yZero))
              const offScreen = clamped !== yZero
              return (
                <path
                  key={`gnd-${channel.key}`}
                  d={`M ${MARGIN.left} ${clamped - 4} L ${MARGIN.left + 7} ${clamped} L ${MARGIN.left} ${clamped + 4} Z`}
                  fill={TRACE_COLORS[i % TRACE_COLORS.length]}
                  opacity={offScreen ? 0.35 : 0.9}
                >
                  <title>
                    CH{i + 1} 0 V{offScreen ? ' (off screen at this scale)' : ''}
                  </title>
                </path>
              )
            })}
        {/* The trigger's level (dashed) and instant (vertical at t = 0). */}
        {levelY !== null &&
        levelY >= MARGIN.top &&
        levelY <= MARGIN.top + innerH &&
        !waitingInNormal ? (
          <line
            x1={MARGIN.left}
            y1={levelY}
            x2={PLOT_W - MARGIN.right}
            y2={levelY}
            stroke={TRIGGER_COLOR}
            strokeWidth={1}
            strokeDasharray="5 4"
            opacity={0.7}
          />
        ) : null}
        {sweep.triggerIndex !== null ? (
          <line
            x1={x(0)}
            y1={MARGIN.top}
            x2={x(0)}
            y2={PLOT_H - MARGIN.bottom}
            stroke={TRIGGER_COLOR}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.7}
          />
        ) : null}
        {waitingInNormal ? null : (
          <g clipPath="url(#scope-screen)">
            {sweep.channels.map((channel, i) => {
              const yChannel = yFor(channel.key)
              return (
                <polyline
                  key={channel.key}
                  fill="none"
                  stroke={TRACE_COLORS[i % TRACE_COLORS.length]}
                  strokeWidth={channel.key === sweep.sourceKey ? 2 : 1.4}
                  points={points
                    .map((p) => `${x(p.time - tZero)},${yChannel(p.nodes.get(channel.net) ?? 0)}`)
                    .join(' ')}
                />
              )
            })}
          </g>
        )}
        {waitingInNormal ? (
          <text x={PLOT_W / 2} y={PLOT_H / 2} fontSize={11} fill={textColor} textAnchor="middle">
            Normal: waiting for {sourceChannel?.label ?? 'the source'} to cross{' '}
            {formatEng(level, 'V', { signed: true })} ({edge})
          </text>
        ) : null}
      </svg>
      {/* Channel chips: CH number, where it's clipped, its volts/div knob,
          and an unclip ×. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4, maxWidth: PLOT_W }}>
        {sweep.channels.map((channel, i) => (
          <span
            key={channel.key}
            style={{
              fontSize: 10,
              color: TRACE_COLORS[i % TRACE_COLORS.length],
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            {channel.key === sweep.sourceKey ? '▶' : '—'} CH{i + 1} {channel.label}
            <select
              value={
                vdivSettings[channel.key] === undefined || vdivSettings[channel.key] === 'auto'
                  ? 'auto'
                  : String(vdivSettings[channel.key])
              }
              onChange={(e) => {
                const next = e.target.value
                setVdivSettings((current) => ({
                  ...current,
                  [channel.key]: next === 'auto' ? 'auto' : Number(next),
                }))
              }}
              className="nodrag"
              title={`CH${i + 1} vertical scale: volts per grid square (8 squares tall). Auto fits this channel's swing. Each channel centers on its own midpoint — the ▸ arrow at the left edge marks where ITS 0 V sits. The axis numbers follow the ▶ trigger-source channel. Rescaling redraws the same captured data (a vertical knob, not a re-acquire).`}
              style={{
                fontSize: 9,
                background: light ? '#fff' : '#1b1b1f',
                color: 'inherit',
                border: '1px solid #2a2a2f',
                borderRadius: 3,
                padding: '0 2px',
              }}
            >
              <option value="auto">
                auto ({formatEng(transforms.get(channel.key)?.voltsPerDiv ?? 0, 'V')}/div)
              </option>
              {VOLTS_PER_DIV.map((v) => (
                <option key={v} value={String(v)}>
                  {formatEng(v, 'V')}/div
                </option>
              ))}
            </select>
            {held === null ? (
              <button
                type="button"
                className="nodrag"
                onClick={() => onRemoveChannel(channel.key)}
                title="Unclip this probe"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 10,
                  padding: 0,
                  opacity: 0.7,
                }}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
      </div>
      {allFlat && !waitingInNormal ? (
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
