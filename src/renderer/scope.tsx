import { useEffect, useRef, useState } from 'react'
import type { World } from '../cross-fk-validator.ts'
import { readScalarParam } from '../instance-params.ts'
import type { TransientResult } from '../transient-solver.ts'
import { scopeCsv } from './scope-csv.ts'
import { cursorReadout, interpolateSeries } from './scope-cursors.ts'
import { fftMagnitudes, spectrumPeak } from './scope-fft.ts'
import { H_DIVISIONS, TIMEBASES, transformFor, V_DIVISIONS, VOLTS_PER_DIV } from './scope-scales.ts'
import { alignSweep, autoLevel, type TriggerEdge, type TriggerMode } from './scope-trigger.ts'
import { formatEng } from './units.ts'
import { measureSeries } from './waveform-measure.ts'

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

/**
 * One scope channel. A VOLTAGE channel reads its net directly; a CURRENT
 * channel (S19-v3-83, a clamp on a wire) reads (vA−vB)/R of that wire — the
 * wire is a real resistor the solver already solved, so its branch current
 * at every step is exact Ohm's law, no current invented. Like a real clamp,
 * it goes around a WIRE — and every branch has one.
 */
export type ScopeChannel = {
  key: string
  label: string
  unit: 'V' | 'A'
  /** Voltage channels: the net to read. */
  net?: string
  /** Current channels: the clamped wire's two nets and its real resistance. */
  diff?: { netA: string; netB: string; ohms: number }
}

/** The channel's value at one solved instant — every consumer reads through this. */
export function channelValue(channel: ScopeChannel, nodes: Map<string, number>): number {
  if (channel.diff !== undefined) {
    return (
      ((nodes.get(channel.diff.netA) ?? 0) - (nodes.get(channel.diff.netB) ?? 0)) /
      channel.diff.ohms
    )
  }
  return channel.net !== undefined ? (nodes.get(channel.net) ?? 0) : 0
}

/** A probe: clipped on a terminal (volts) or clamped around a wire (amps). */
export type ScopeProbe =
  | { kind: 'terminal'; nodeId: string; handleId: string }
  | { kind: 'wire'; edgeId: string }

export function scopeProbeKey(probe: ScopeProbe): string {
  return probe.kind === 'terminal' ? `${probe.nodeId}/${probe.handleId}` : `clamp:${probe.edgeId}`
}

/**
 * Channels from the user's probes (S19-v3-77; clamps S19-v3-83): a probe
 * whose terminal or wire no longer resolves (the part was deleted) is
 * dropped, never invented. A clamped wire with no real resistance (a 0 Ω
 * ideal short) is also dropped — ΔV/R can't read it. Pure — the App supplies
 * the terminal→net lookup (the same one the multimeter probes use) and the
 * wire lookup.
 */
export function channelsForProbes(
  probes: ScopeProbe[],
  netOfTerminal: (terminalKey: string) => string | undefined,
  wireOf: (
    edgeId: string,
  ) => { netA: string; netB: string; ohms: number; label: string } | undefined,
): ScopeChannel[] {
  const channels: ScopeChannel[] = []
  for (const probe of probes) {
    if (probe.kind === 'terminal') {
      const key = scopeProbeKey(probe)
      const net = netOfTerminal(key)
      if (net === undefined) continue
      channels.push({
        key,
        label: `${probe.nodeId} · ${probe.handleId.replace(/_/g, ' ')}`,
        unit: 'V',
        net,
      })
      continue
    }
    const wire = wireOf(probe.edgeId)
    if (wire === undefined || !(wire.ohms > 0)) continue
    channels.push({
      key: scopeProbeKey(probe),
      label: wire.label,
      unit: 'A',
      diff: { netA: wire.netA, netB: wire.netB, ohms: wire.ohms },
    })
  }
  return channels
}

/**
 * What unit a math trace carries (S19-v3-83): subtraction needs MATCHING
 * units (volts minus amps is not a quantity); multiplying volts by amps is
 * WATTS — the real instantaneous power a bench scope gets from a voltage
 * probe × a current probe. Null = the combination is refused.
 */
export function mathResultUnit(
  unitA: 'V' | 'A',
  unitB: 'V' | 'A',
  op: 'sub' | 'mul',
): string | null {
  if (op === 'sub') return unitA === unitB ? unitA : null
  if (unitA !== unitB) return 'W'
  return unitA === 'V' ? 'V·V' : 'A·A'
}

const PLOT_W = 440
const PLOT_H = 190
const MARGIN = { left: 48, right: 10, top: 8, bottom: 20 }
const TRIGGER_COLOR = '#d6a23c'
const CURSOR_COLOR = '#9ecbff'
const MATH_COLOR = '#e8e8e8'
const MATH_KEY = '__math__'
const FFT_H = 110
const INNER_W = PLOT_W - MARGIN.left - MARGIN.right

/** Pointer position → cursor position as a fraction of the plot width. */
function cursorFracFromClientX(svg: SVGSVGElement, clientX: number): number {
  const rect = svg.getBoundingClientRect()
  return Math.min(1, Math.max(0, (clientX - rect.left - MARGIN.left) / INNER_W))
}

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
      const v = channelValue(channel, pt.nodes)
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
  // Cursors (S19-v3-79): two time lines as fractions of the plot width —
  // fractions survive timebase changes the way real cursors keep their
  // screen position. The drag gesture lives in a ref (the gesture lesson).
  const [cursorsOn, setCursorsOn] = useState(false)
  const [cursorFracs, setCursorFracs] = useState<{ a: number; b: number }>({ a: 0.3, b: 0.7 })
  const cursorDrag = useRef<'a' | 'b' | null>(null)
  // Auto-measurements (S19-v3-80): live numbers per channel, off by default.
  const [measureOn, setMeasureOn] = useState(false)
  // Math channel + FFT (S19-v3-81). A−B is volts; A×B is honestly V·V (both
  // probes read volts — a real scope multiplies volts × a CURRENT probe to
  // get watts, and that awaits per-step solver currents).
  const [mathOp, setMathOp] = useState<'off' | 'sub' | 'mul'>('off')
  const [mathA, setMathA] = useState<string | null>(null)
  const [mathB, setMathB] = useState<string | null>(null)
  const [fftOn, setFftOn] = useState(false)
  // The extras (S19-v3-82): persistence ghosts, XY mode, CSV export.
  const [displayMode, setDisplayMode] = useState<'yt' | 'xy'>('yt')
  const [persistOn, setPersistOn] = useState(false)
  const [ghosts, setGhosts] = useState<{ id: number; sweep: Sweep }[]>([])
  const prevSweepRef = useRef<Sweep | null>(null)
  const ghostIdRef = useRef(0)

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
    sourceChannel === null ? [] : series.map((p) => channelValue(sourceChannel, p.nodes))
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

  // Persistence (S19-v3-82): when a NEW record arrives, the sweep it replaced
  // becomes a ghost (capped at 7, oldest faintest). A deterministic simulator
  // re-runs the same circuit identically — so the ghosts show what your EDITS
  // changed, a before/after overlay no real scope can draw.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires once per new record; the flag and the outgoing sweep are read at that moment
  useEffect(() => {
    if (persistOn && prevSweepRef.current !== null) {
      const previous = prevSweepRef.current
      ghostIdRef.current += 1
      const id = ghostIdRef.current
      setGhosts((current) => [...current.slice(-6), { id, sweep: previous }])
    }
    prevSweepRef.current = liveSweep
  }, [result])

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
      <button
        type="button"
        className="nodrag"
        onClick={() => setCursorsOn((on) => !on)}
        title="Cursors: two draggable time lines, A and B. Each reads the ▶ trigger-source channel where it crosses the trace; the strip under the plot gives Δt (B − A), 1/Δt (set them one full cycle apart and that IS the signal's frequency), and ΔV — measuring rise times, periods, and ripple straight off the trace."
        style={{
          ...controlStyle,
          cursor: 'pointer',
          ...(cursorsOn ? { borderColor: CURSOR_COLOR, color: CURSOR_COLOR } : {}),
        }}
      >
        cursors
      </button>
      <button
        type="button"
        className="nodrag"
        onClick={() => setMeasureOn((on) => !on)}
        title="Auto-measurements: live numbers read off each channel's displayed sweep — peak-to-peak, DC level, AC true-RMS and counted frequency (the multimeter's own math, shared code), period, duty (time above the 50 % level), and 10–90 % rise ↑ / fall ↓ times. A dash means that number honestly can't be read from what's on screen (no countable cycle, no edge, flat line)."
        style={{
          ...controlStyle,
          cursor: 'pointer',
          ...(measureOn ? { borderColor: CURSOR_COLOR, color: CURSOR_COLOR } : {}),
        }}
      >
        measure
      </button>
      <button
        type="button"
        className="nodrag"
        onClick={() => setFftOn((on) => !on)}
        title="FFT: the ▶ trigger-source signal broken into the frequencies it contains, plotted below the time view. A pure sine is ONE spike; a square wave is its fundamental plus shrinking odd harmonics (3rd at 1/3, 5th at 1/5 — why squares sound buzzy and sines pure). Analyzed over the settled record with a Hann window, mean removed (the dc number lives in the measure strip); Δf states the resolution honestly."
        style={{
          ...controlStyle,
          cursor: 'pointer',
          ...(fftOn ? { borderColor: CURSOR_COLOR, color: CURSOR_COLOR } : {}),
        }}
      >
        fft
      </button>
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
      const v = channelValue(channel, pt.nodes)
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

  // Cursors (S19-v3-79) read the ▶ source channel's trace — the same channel
  // the axis numbers and trigger level speak for, one coherent ruler. The
  // value at a cursor is the drawn polyline's value there (linear between
  // recorded samples), via interpolateSeries.
  const sweepSourceChannel =
    sweep.sourceKey !== null ? sweep.channels.find((c) => c.key === sweep.sourceKey) : undefined
  const cursorSeries =
    cursorsOn && sweepSourceChannel !== undefined
      ? points.map((p) => ({ t: p.time - tZero, v: channelValue(sweepSourceChannel, p.nodes) }))
      : null
  const cursorAt = (frac: number) => {
    const t = tFirst + frac * (tLast - tFirst)
    return {
      t,
      v: cursorSeries !== null ? interpolateSeries(cursorSeries, t) : null,
      x: MARGIN.left + frac * INNER_W,
    }
  }
  const cursorA = cursorAt(cursorFracs.a)
  const cursorB = cursorAt(cursorFracs.b)
  const cursors = cursorReadout(cursorA, cursorB)

  // Math channel (S19-v3-81; unit algebra S19-v3-83): M = A−B or A×B,
  // computed point-by-point from the same record the traces draw. A and B
  // default to the first two channels; a vanished probe simply blanks the
  // trace, never invents. Volts × amps = WATTS — real instantaneous power;
  // subtracting mismatched units is refused (volts minus amps is nothing).
  const mathAKey = mathA ?? sweep.channels[0]?.key ?? null
  const mathBKey = mathB ?? sweep.channels[1]?.key ?? null
  const mathAChannel =
    mathAKey !== null ? sweep.channels.find((c) => c.key === mathAKey) : undefined
  const mathBChannel =
    mathBKey !== null ? sweep.channels.find((c) => c.key === mathBKey) : undefined
  const mathUnit =
    mathOp !== 'off' && mathAChannel !== undefined && mathBChannel !== undefined
      ? mathResultUnit(mathAChannel.unit, mathBChannel.unit, mathOp)
      : null
  const mathOn = mathOp !== 'off' && mathUnit !== null
  const mathValueAt = (nodes: Map<string, number>): number => {
    const a = mathAChannel !== undefined ? channelValue(mathAChannel, nodes) : 0
    const b = mathBChannel !== undefined ? channelValue(mathBChannel, nodes) : 0
    return mathOp === 'mul' ? a * b : a - b
  }
  if (mathOn) {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const pt of fitPoints) {
      const v = mathValueAt(pt.nodes)
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    transforms.set(MATH_KEY, transformFor(lo, hi, vdivSettings[MATH_KEY] ?? 'auto'))
  }
  const mathLabel = mathOp === 'mul' ? 'A×B' : 'A−B'
  const mathUnitsClash =
    mathOp === 'sub' &&
    mathAChannel !== undefined &&
    mathBChannel !== undefined &&
    mathAChannel.unit !== mathBChannel.unit

  // Auto-measurements read each row over the DISPLAYED sweep — measure what
  // you see, the bench convention. A held sweep measures its frozen points;
  // zooming changes what there is to measure.
  const measurementRows = measureOn
    ? [
        ...sweep.channels.map((channel, i) => ({
          key: channel.key,
          label: `CH${i + 1}`,
          color: TRACE_COLORS[i % TRACE_COLORS.length] ?? MATH_COLOR,
          unit: channel.unit as string,
          m: measureSeries(points.map((p) => ({ t: p.time, v: channelValue(channel, p.nodes) }))),
        })),
        ...(mathOn && mathUnit !== null
          ? [
              {
                key: MATH_KEY,
                label: `M ${mathLabel}`,
                color: MATH_COLOR,
                unit: mathUnit,
                m: measureSeries(points.map((p) => ({ t: p.time, v: mathValueAt(p.nodes) }))),
              },
            ]
          : []),
      ]
    : null

  // FFT (S19-v3-81) analyzes the ▶ source channel: the settled record when
  // live (the first window holds power-on transients), the frozen points
  // when held — Stop freezes the spectrum with the trace.
  const fftInput =
    fftOn && sweepSourceChannel !== undefined
      ? held !== null
        ? points
        : series.filter((p) => p.time >= windowDuration)
      : null
  const spectrum =
    fftInput !== null && sweepSourceChannel !== undefined
      ? fftMagnitudes(
          fftInput.map((p) => channelValue(sweepSourceChannel, p.nodes)),
          dt,
        )
      : null
  const fftPeak = spectrum !== null ? spectrumPeak(spectrum) : null
  // Show out to the last bin still carrying real content (≥3 % of the peak),
  // with margin — a 1 kHz sine doesn't need the view stretched to Nyquist.
  let fftLastIdx = 0
  if (spectrum !== null && fftPeak !== null && fftPeak.amplitude > 0) {
    for (let i = 0; i < spectrum.amplitude.length; i++) {
      if ((spectrum.amplitude[i] ?? 0) >= 0.03 * fftPeak.amplitude) fftLastIdx = i
    }
    fftLastIdx = Math.min(spectrum.amplitude.length - 1, Math.max(8, Math.ceil(fftLastIdx * 1.3)))
  }

  // XY mode (S19-v3-82): plot one channel AGAINST another, time implicit —
  // the phase-pattern view. Each axis uses its channel's own volts/div knob:
  // X spans the 10 horizontal squares, Y the 8 vertical ones. Two in-phase
  // signals draw a straight line; a phase shift opens it into an ellipse.
  const xyOn = displayMode === 'xy'
  const xyXKey = mathA ?? sweep.channels[0]?.key ?? null
  const xyYKey = mathB ?? sweep.channels[1]?.key ?? null
  const xyXChannel = sweep.channels.find((c) => c.key === xyXKey)
  const xyYChannel = sweep.channels.find((c) => c.key === xyYKey)
  const xyReady =
    xyOn &&
    xyXChannel !== undefined &&
    xyYChannel !== undefined &&
    transforms.has(xyXChannel.key) &&
    transforms.has(xyYChannel.key)
  const xyXPos = (v: number): number => {
    const tf = xyXChannel !== undefined ? transforms.get(xyXChannel.key) : undefined
    if (tf === undefined) return MARGIN.left + innerW / 2
    return (
      MARGIN.left + innerW / 2 + ((v - tf.offsetVolts) / tf.voltsPerDiv) * (innerW / H_DIVISIONS)
    )
  }

  // The vertical axis speaks the ▶ source channel in YT, the Y channel in XY
  // — value AND unit (a clamp channel's axis reads amps).
  const axisYTf = xyOn
    ? xyYChannel !== undefined
      ? transforms.get(xyYChannel.key)
      : undefined
    : sourceTf
  const axisYUnit = (xyOn ? xyYChannel?.unit : sweepSourceChannel?.unit) ?? 'V'
  const sourceUnit = sourceChannel?.unit ?? 'V'
  const fftUnit = sweepSourceChannel?.unit ?? 'V'

  const downloadCsv = () => {
    const columns = [
      ...sweep.channels.map((channel) => ({
        label: channel.label,
        unit: channel.unit as string,
        values: points.map((p) => channelValue(channel, p.nodes)),
      })),
      ...(mathOn && mathUnit !== null
        ? [
            {
              label: `M ${mathLabel}`,
              unit: mathUnit,
              values: points.map((p) => mathValueAt(p.nodes)),
            },
          ]
        : []),
    ]
    const csv = scopeCsv(
      points.map((p) => p.time),
      tZero,
      columns,
    )
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'chipblocks-scope.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const gridStroke = light ? '#d4d8de' : '#26262c'

  // Steady DC: every trace flat is CORRECT (nothing changes over time in a DC
  // circuit at rest) — but it reads as "broken" without saying so.
  const allFlat = sweep.channels.every((channel) => {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const pt of points) {
      const v = channelValue(channel, pt.nodes)
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
          title={`Trigger level in the source channel's unit (${sourceUnit}) — the sweep aligns where the signal crosses it. "auto" = the midpoint of the swing (now ${formatEng(level, sourceUnit, { signed: true })}).`}
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
      {/* The math channel row: M = A−B (volts across, what one probe can't
          read) or A×B (the product waveform, in V·V — watts need a current
          input, which awaits per-step solver currents). */}
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
        <span style={{ fontSize: 10, color: textColor }}>Math</span>
        <select
          value={mathOp}
          onChange={(e) => setMathOp(e.target.value as 'off' | 'sub' | 'mul')}
          className="nodrag"
          title="A−B subtracts trace B from trace A point-by-point — a DIFFERENTIAL measurement, the voltage ACROSS a part (clip A and B on its two terminals; units must match). A×B multiplies them — and a VOLTAGE channel × a CURRENT clamp is WATTS, the real instantaneous power flowing in that branch (volts × volts stays V·V, honestly)."
          style={controlStyle}
        >
          <option value="off">off</option>
          <option value="sub">A − B</option>
          <option value="mul">A × B</option>
        </select>
        {mathOp !== 'off' || displayMode === 'xy' ? (
          <>
            <select
              value={mathAKey ?? ''}
              onChange={(e) => setMathA(e.target.value)}
              className="nodrag"
              title="Which channel is A (math's first operand; XY's horizontal axis)"
              style={{ ...controlStyle, maxWidth: 110 }}
            >
              {sweep.channels.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              value={mathBKey ?? ''}
              onChange={(e) => setMathB(e.target.value)}
              className="nodrag"
              title="Which channel is B (math's second operand; XY's vertical axis)"
              style={{ ...controlStyle, maxWidth: 110 }}
            >
              {sweep.channels.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            {mathUnitsClash ? (
              <span style={{ fontSize: 10, color: textColor }}>
                A − B needs matching units (volts minus amps is not a quantity) — A × B of these
                would be watts
              </span>
            ) : (mathOp !== 'off' && !mathOn) || (displayMode === 'xy' && !xyReady) ? (
              <span style={{ fontSize: 10, color: textColor }}>needs two clipped probes</span>
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          className="nodrag"
          onClick={() => setDisplayMode(displayMode === 'yt' ? 'xy' : 'yt')}
          title="XY mode: plot A against B with time implicit — the phase-pattern view (Lissajous figures). Two in-phase signals draw a straight LINE whose slope is their ratio; a phase shift between them opens the line into an ELLIPSE (add a capacitor and watch). Each axis keeps its channel's volts/div knob. Click again for the normal voltage-vs-time view."
          style={{
            ...controlStyle,
            cursor: 'pointer',
            ...(xyOn ? { borderColor: CURSOR_COLOR, color: CURSOR_COLOR } : {}),
          }}
        >
          XY
        </button>
        <button
          type="button"
          className="nodrag"
          onClick={() => {
            setPersistOn(!persistOn)
            if (persistOn) setGhosts([])
          }}
          title="Persistence: keep faded ghosts of the last 7 sweeps under the live trace. A simulated circuit re-runs IDENTICALLY, so the ghosts show what your EDITS changed — tweak a value and compare before/after in one picture (a real scope's persistence only catches jitter; ours catches intent)."
          style={{
            ...controlStyle,
            cursor: 'pointer',
            ...(persistOn ? { borderColor: CURSOR_COLOR, color: CURSOR_COLOR } : {}),
          }}
        >
          persist
        </button>
        <button
          type="button"
          className="nodrag"
          onClick={downloadCsv}
          title="Download the displayed sweep as a CSV file: a time column (t = 0 at the trigger, matching the axis) plus one column per channel and the math trace — ready for a spreadsheet or any plotting tool."
          style={{ ...controlStyle, cursor: 'pointer' }}
        >
          csv
        </button>
      </div>

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
        {/* Axis numbers: the ▶ source channel's volts in YT; the Y channel's
            in XY (top, center, bottom). */}
        {axisYTf !== undefined
          ? [V_DIVISIONS / 2, 0, -V_DIVISIONS / 2].map((divs) => (
              <text
                key={`y${divs}`}
                x={MARGIN.left - 4}
                y={centerY - divs * pxPerDivY + 3}
                fontSize={9}
                fill={textColor}
                textAnchor="end"
              >
                {formatEng(axisYTf.offsetVolts + divs * axisYTf.voltsPerDiv, axisYUnit, {
                  signed: true,
                })}
              </text>
            ))
          : null}
        {!xyOn
          ? X_LABEL_DIVS.map((div) => {
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
            })
          : null}
        {/* XY's horizontal axis speaks the X channel's volts. */}
        {xyOn && xyXChannel !== undefined
          ? [-H_DIVISIONS / 2, 0, H_DIVISIONS / 2].map((divs) => {
              const tf = transforms.get(xyXChannel.key)
              if (tf === undefined) return null
              return (
                <text
                  key={`xy${divs}`}
                  x={MARGIN.left + innerW / 2 + divs * (innerW / H_DIVISIONS)}
                  y={PLOT_H - 6}
                  fontSize={9}
                  fill={textColor}
                  textAnchor="middle"
                >
                  {formatEng(tf.offsetVolts + divs * tf.voltsPerDiv, xyXChannel.unit, {
                    signed: true,
                  })}
                </text>
              )
            })
          : null}
        {/* Each channel's 0 V mark at the left edge (its offset auto-centers,
            so ground can sit off-screen — the arrow clamps and dims there). */}
        {waitingInNormal || xyOn
          ? null
          : [
              ...sweep.channels.map((channel, i) => ({
                key: channel.key,
                color: TRACE_COLORS[i % TRACE_COLORS.length] ?? MATH_COLOR,
                name: `CH${i + 1}`,
              })),
              ...(mathOn ? [{ key: MATH_KEY, color: MATH_COLOR, name: `M ${mathLabel}` }] : []),
            ].map(({ key, color, name }) => {
              const yZero = yFor(key)(0)
              const clamped = Math.max(MARGIN.top, Math.min(MARGIN.top + innerH, yZero))
              const offScreen = clamped !== yZero
              return (
                <path
                  key={`gnd-${key}`}
                  d={`M ${MARGIN.left} ${clamped - 4} L ${MARGIN.left + 7} ${clamped} L ${MARGIN.left} ${clamped + 4} Z`}
                  fill={color}
                  opacity={offScreen ? 0.35 : 0.9}
                >
                  <title>
                    {name} 0{offScreen ? ' (off screen at this scale)' : ''}
                  </title>
                </path>
              )
            })}
        {/* The trigger's level (dashed) and instant (vertical at t = 0). */}
        {levelY !== null &&
        levelY >= MARGIN.top &&
        levelY <= MARGIN.top + innerH &&
        !waitingInNormal &&
        !xyOn ? (
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
        {sweep.triggerIndex !== null && !xyOn ? (
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
        {waitingInNormal ? null : xyOn ? (
          xyReady && xyXChannel !== undefined && xyYChannel !== undefined ? (
            <g clipPath="url(#scope-screen)">
              <polyline
                fill="none"
                stroke={
                  TRACE_COLORS[
                    Math.max(
                      0,
                      sweep.channels.findIndex((c) => c.key === xyYChannel.key),
                    ) % TRACE_COLORS.length
                  ]
                }
                strokeWidth={1.8}
                points={points
                  .map(
                    (p) =>
                      `${xyXPos(channelValue(xyXChannel, p.nodes))},${yFor(xyYChannel.key)(channelValue(xyYChannel, p.nodes))}`,
                  )
                  .join(' ')}
              />
            </g>
          ) : (
            <text x={PLOT_W / 2} y={PLOT_H / 2} fontSize={11} fill={textColor} textAnchor="middle">
              XY needs two clipped probes (A is the horizontal axis, B the vertical)
            </text>
          )
        ) : (
          <g clipPath="url(#scope-screen)">
            {/* Persistence ghosts: each aligned at ITS OWN trigger instant,
                drawn through the CURRENT knobs, oldest faintest. */}
            {ghosts.map(({ id, sweep: ghost }, gi) => {
              const ghostTZero =
                ghost.triggerIndex !== null
                  ? (ghost.points[ghost.triggerIndex]?.time ?? 0)
                  : (ghost.points[0]?.time ?? 0)
              return ghost.channels.map((channel, i) =>
                transforms.has(channel.key) ? (
                  <polyline
                    key={`ghost-${id}-${channel.key}`}
                    fill="none"
                    stroke={TRACE_COLORS[i % TRACE_COLORS.length]}
                    strokeWidth={1}
                    opacity={0.1 + 0.18 * ((gi + 1) / ghosts.length)}
                    points={ghost.points
                      .map(
                        (p) =>
                          `${x(p.time - ghostTZero)},${yFor(channel.key)(channelValue(channel, p.nodes))}`,
                      )
                      .join(' ')}
                  />
                ) : null,
              )
            })}
            {sweep.channels.map((channel, i) => {
              const yChannel = yFor(channel.key)
              return (
                <polyline
                  key={channel.key}
                  fill="none"
                  stroke={TRACE_COLORS[i % TRACE_COLORS.length]}
                  strokeWidth={channel.key === sweep.sourceKey ? 2 : 1.4}
                  points={points
                    .map((p) => `${x(p.time - tZero)},${yChannel(channelValue(channel, p.nodes))}`)
                    .join(' ')}
                />
              )
            })}
            {mathOn ? (
              <polyline
                fill="none"
                stroke={MATH_COLOR}
                strokeWidth={1.4}
                strokeDasharray="7 3"
                points={points
                  .map((p) => `${x(p.time - tZero)},${yFor(MATH_KEY)(mathValueAt(p.nodes))}`)
                  .join(' ')}
              />
            ) : null}
          </g>
        )}
        {/* The cursors: draggable time lines A and B; the dot marks where each
            reads the ▶ source trace. (Time cursors — hidden in XY.) */}
        {cursorsOn && !waitingInNormal && !xyOn
          ? (['a', 'b'] as const).map((which) => {
              const cursor = which === 'a' ? cursorA : cursorB
              return (
                <g key={`cursor-${which}`}>
                  <line
                    x1={cursor.x}
                    y1={MARGIN.top}
                    x2={cursor.x}
                    y2={MARGIN.top + innerH}
                    stroke={CURSOR_COLOR}
                    strokeWidth={1}
                    strokeDasharray="2 3"
                    opacity={0.9}
                  />
                  <text
                    x={cursor.x}
                    y={MARGIN.top + 8}
                    fontSize={9}
                    fill={CURSOR_COLOR}
                    textAnchor="middle"
                  >
                    {which.toUpperCase()}
                  </text>
                  {cursor.v !== null && sweep.sourceKey !== null ? (
                    <g clipPath="url(#scope-screen)">
                      <circle
                        cx={cursor.x}
                        cy={yFor(sweep.sourceKey)(cursor.v)}
                        r={3}
                        fill={CURSOR_COLOR}
                      />
                    </g>
                  ) : null}
                  <rect
                    x={cursor.x - 6}
                    y={MARGIN.top}
                    width={12}
                    height={innerH}
                    fill="transparent"
                    style={{ cursor: 'ew-resize', pointerEvents: 'all' }}
                    className="nodrag"
                    onPointerDown={(e) => {
                      cursorDrag.current = which
                      e.currentTarget.setPointerCapture(e.pointerId)
                      e.stopPropagation()
                    }}
                    onPointerMove={(e) => {
                      if (cursorDrag.current !== which) return
                      const svg = e.currentTarget.ownerSVGElement
                      if (svg === null) return
                      const frac = cursorFracFromClientX(svg, e.clientX)
                      setCursorFracs((current) => ({ ...current, [which]: frac }))
                    }}
                    onPointerUp={() => {
                      cursorDrag.current = null
                    }}
                  >
                    <title>Drag cursor {which.toUpperCase()}</title>
                  </rect>
                </g>
              )
            })
          : null}
        {waitingInNormal ? (
          <text x={PLOT_W / 2} y={PLOT_H / 2} fontSize={11} fill={textColor} textAnchor="middle">
            Normal: waiting for {sourceChannel?.label ?? 'the source'} to cross{' '}
            {formatEng(level, sourceUnit, { signed: true })} ({edge})
          </text>
        ) : null}
      </svg>
      {/* The FFT panel: the source signal split into its frequencies. */}
      {fftOn && !waitingInNormal && spectrum !== null && fftPeak !== null ? (
        <div style={{ marginTop: 4 }}>
          <svg
            width={PLOT_W}
            height={FFT_H}
            style={{ background: light ? '#fafbfc' : '#0e0e11', borderRadius: 4 }}
            role="img"
            aria-label="Frequency content of the trigger-source signal"
          >
            {(() => {
              const innerFftH = FFT_H - MARGIN.top - MARGIN.bottom
              const fMax = spectrum.freqHz[fftLastIdx] ?? 1
              const aMax = fftPeak.amplitude * 1.1 || 1
              const xF = (f: number) => MARGIN.left + (f / fMax) * innerW
              const yF = (a: number) => MARGIN.top + (1 - a / aMax) * innerFftH
              const bins = spectrum.freqHz.slice(0, fftLastIdx + 1)
              return (
                <>
                  {[0.25, 0.5, 0.75, 1].map((f) => (
                    <line
                      key={`fx${f}`}
                      x1={xF(f * fMax)}
                      y1={MARGIN.top}
                      x2={xF(f * fMax)}
                      y2={MARGIN.top + innerFftH}
                      stroke={gridStroke}
                      strokeWidth={1}
                      opacity={0.5}
                    />
                  ))}
                  {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                    <text
                      key={`fxl${f}`}
                      x={xF(f * fMax)}
                      y={FFT_H - 6}
                      fontSize={9}
                      fill={textColor}
                      textAnchor="middle"
                    >
                      {formatEng(f * fMax, 'Hz')}
                    </text>
                  ))}
                  <text
                    x={MARGIN.left - 4}
                    y={MARGIN.top + 9}
                    fontSize={9}
                    fill={textColor}
                    textAnchor="end"
                  >
                    {formatEng(aMax, fftUnit)}
                  </text>
                  <polyline
                    fill="none"
                    stroke={
                      TRACE_COLORS[
                        Math.max(
                          0,
                          sweep.channels.findIndex((c) => c.key === sweep.sourceKey),
                        ) % TRACE_COLORS.length
                      ]
                    }
                    strokeWidth={1.6}
                    points={bins
                      .map((f, i) => `${xF(f)},${yF(spectrum.amplitude[i] ?? 0)}`)
                      .join(' ')}
                  />
                </>
              )
            })()}
          </svg>
          <div style={{ fontSize: 10, color: textColor, maxWidth: PLOT_W, marginTop: 2 }}>
            peak {formatEng(fftPeak.freqHz, 'Hz')} at {formatEng(fftPeak.amplitude, fftUnit)} · Δf{' '}
            {formatEng(spectrum.deltaFHz, 'Hz')} ({spectrum.pointCount} pts) · Hann · mean removed
          </div>
        </div>
      ) : null}
      {/* The cursor strip: what A and B read, and the deltas between them. */}
      {cursorsOn && !waitingInNormal && !xyOn ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginTop: 3,
            maxWidth: PLOT_W,
            fontSize: 10,
            color: textColor,
          }}
        >
          <span style={{ color: CURSOR_COLOR }}>
            A {formatEng(cursorA.t, 's', { signed: true })}
            {cursorA.v !== null ? ` · ${formatEng(cursorA.v, fftUnit, { signed: true })}` : ''}
          </span>
          <span style={{ color: CURSOR_COLOR }}>
            B {formatEng(cursorB.t, 's', { signed: true })}
            {cursorB.v !== null ? ` · ${formatEng(cursorB.v, fftUnit, { signed: true })}` : ''}
          </span>
          <span>Δt {formatEng(cursors.deltaT, 's', { signed: true })}</span>
          <span>
            1/Δt{' '}
            {cursors.inverseDeltaT !== null
              ? formatEng(cursors.inverseDeltaT, 'Hz', { signed: true })
              : '—'}
          </span>
          <span>
            Δ
            {cursors.deltaV !== null
              ? ` ${formatEng(cursors.deltaV, fftUnit, { signed: true })}`
              : ' —'}
          </span>
        </div>
      ) : null}
      {/* The measurement strip: one row of live numbers per trace. */}
      {measurementRows !== null && !waitingInNormal ? (
        <div style={{ marginTop: 3, maxWidth: PLOT_W, fontSize: 10 }}>
          {measurementRows.map(({ key, label, color, unit, m }) => (
            <div
              key={key}
              style={{
                color,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <span>{label}</span>
              <span>pp {formatEng(m.vpp, unit)}</span>
              <span>dc {formatEng(m.mean, unit, { signed: true })}</span>
              <span>rms~ {formatEng(m.rmsAc, unit)}</span>
              <span>{m.hz !== null ? formatEng(m.hz, 'Hz') : '— Hz'}</span>
              <span>T {m.periodS !== null ? formatEng(m.periodS, 's') : '—'}</span>
              <span>duty {m.dutyHigh !== null ? `${(m.dutyHigh * 100).toFixed(1)} %` : '—'}</span>
              <span>↑ {m.riseS !== null ? formatEng(m.riseS, 's') : '—'}</span>
              <span>↓ {m.fallS !== null ? formatEng(m.fallS, 's') : '—'}</span>
            </div>
          ))}
        </div>
      ) : null}
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
              title={`CH${i + 1} vertical scale: ${channel.unit === 'A' ? 'amps' : 'volts'} per grid square (8 squares tall). Auto fits this channel's swing. Each channel centers on its own midpoint — the ▸ arrow at the left edge marks where ITS zero sits. The axis numbers follow the ▶ trigger-source channel. Rescaling redraws the same captured data (a vertical knob, not a re-acquire).`}
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
                auto ({formatEng(transforms.get(channel.key)?.voltsPerDiv ?? 0, channel.unit)}
                /div)
              </option>
              {VOLTS_PER_DIV.map((v) => (
                <option key={v} value={String(v)}>
                  {formatEng(v, channel.unit)}/div
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
        {mathOn ? (
          <span
            style={{
              fontSize: 10,
              color: MATH_COLOR,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            — M {mathLabel}
            <select
              value={
                vdivSettings[MATH_KEY] === undefined || vdivSettings[MATH_KEY] === 'auto'
                  ? 'auto'
                  : String(vdivSettings[MATH_KEY])
              }
              onChange={(e) => {
                const next = e.target.value
                setVdivSettings((current) => ({
                  ...current,
                  [MATH_KEY]: next === 'auto' ? 'auto' : Number(next),
                }))
              }}
              className="nodrag"
              title={`The math trace's vertical scale, in ${mathUnit ?? ''} per grid square. Auto fits its swing; its ▸ zero mark sits at the left edge like the channels'.`}
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
                auto ({formatEng(transforms.get(MATH_KEY)?.voltsPerDiv ?? 0, mathUnit ?? '')}/div)
              </option>
              {VOLTS_PER_DIV.map((v) => (
                <option key={v} value={String(v)}>
                  {formatEng(v, mathUnit ?? '')}/div
                </option>
              ))}
            </select>
          </span>
        ) : null}
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
