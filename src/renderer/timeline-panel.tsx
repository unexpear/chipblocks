import { useEffect, useRef, useState } from 'react'
import type { TransientResult } from '../transient-solver.ts'
import { clampIndex } from './timeline.ts'
import { formatEng } from './units.ts'

/**
 * Timeline panel (Sprint 22) — the playback bar. It scrubs the transient the
 * scope computed and the canvas paints itself at the chosen instant (App derives
 * the per-wire frame from the playhead). The physics NEVER re-runs here: play,
 * reverse, single-step and the speed knob only move the index; the solver result
 * is fixed. Default playback loops; the whole record plays in PLAYBACK_SECONDS at 1×.
 */

const PLAYBACK_SECONDS = 6

export function TimelinePanel({
  result,
  index,
  onIndex,
  light,
}: {
  result: TransientResult | null
  index: number
  onIndex: (next: number) => void
  light: boolean
}) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [dir, setDir] = useState<1 | -1>(1)
  const indexRef = useRef(index)
  indexRef.current = index

  const solved = result !== null && result.status === 'solved' && result.series.length >= 2
  const len = solved ? result.series.length : 0
  const i = clampIndex(index, len)
  const t = solved ? (result.series[i]?.time ?? 0) : 0

  // Play loop: advance the playhead at speed×, looping at either end. rAF keeps
  // it smooth; nothing re-solves — we only move the index through the record.
  useEffect(() => {
    if (!playing || len < 2) return
    let raf = 0
    let last: number | null = null
    const tick = (ts: number) => {
      if (last === null) last = ts
      const dt = Math.min(0.05, (ts - last) / 1000)
      last = ts
      let next = indexRef.current + dir * speed * dt * (len / PLAYBACK_SECONDS)
      if (next > len - 1) next = 0
      if (next < 0) next = len - 1
      onIndex(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, dir, len, onIndex])

  const textColor = light ? '#556' : '#9aa'
  const controlStyle: React.CSSProperties = {
    fontSize: 12,
    background: light ? '#fff' : '#1b1b1f',
    color: light ? '#223' : '#cdd6e0',
    border: '1px solid #2a2a2f',
    borderRadius: 4,
    padding: '3px 8px',
    cursor: 'pointer',
    minWidth: 26,
  }

  if (!solved) {
    return (
      <div
        style={{
          fontFamily: 'system-ui, sans-serif',
          fontSize: 11,
          color: textColor,
          maxWidth: 330,
        }}
      >
        The timeline plays the time simulation back across the live circuit — the flow, the
        voltages, the warnings at each instant.{' '}
        {result === null
          ? 'No simulation yet — it runs while this panel is open.'
          : `Could not run: ${result.status}${result.warnings[0] !== undefined ? ` — ${result.warnings[0]}` : ''}`}
      </div>
    )
  }

  const stepTo = (next: number) => {
    setPlaying(false)
    onIndex(clampIndex(next, len))
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', maxWidth: 460 }}
      >
        <button
          type="button"
          className="nodrag"
          style={controlStyle}
          title="To start"
          onClick={() => stepTo(0)}
        >
          ⏮
        </button>
        <button
          type="button"
          className="nodrag"
          style={controlStyle}
          title="Step back one frame"
          onClick={() => stepTo(i - 1)}
        >
          ◁
        </button>
        <button
          type="button"
          className="nodrag"
          style={{ ...controlStyle, minWidth: 34 }}
          title="Play / pause"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          className="nodrag"
          style={controlStyle}
          title="Step forward one frame"
          onClick={() => stepTo(i + 1)}
        >
          ▷
        </button>
        <button
          type="button"
          className="nodrag"
          style={{
            ...controlStyle,
            ...(dir < 0 ? { borderColor: '#7ab8ff', color: '#7ab8ff' } : {}),
          }}
          title="Reverse playback direction"
          onClick={() => setDir((d) => (d > 0 ? -1 : 1))}
        >
          ⇄
        </button>
        <span style={{ width: 1, height: 18, background: '#2a2a2f', margin: '0 2px' }} />
        <button
          type="button"
          className="nodrag"
          style={controlStyle}
          title="Slower"
          onClick={() => setSpeed((s) => Math.max(0.25, s / 2))}
        >
          −
        </button>
        <span
          style={{
            fontSize: 11,
            color: textColor,
            minWidth: 30,
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {speed < 1 ? speed : Math.round(speed)}×
        </span>
        <button
          type="button"
          className="nodrag"
          style={controlStyle}
          title="Faster"
          onClick={() => setSpeed((s) => Math.min(4, s * 2))}
        >
          +
        </button>
        <input
          type="range"
          className="nodrag"
          min={0}
          max={len - 1}
          step={1}
          value={i}
          onChange={(e) => stepTo(Number(e.target.value))}
          title="Scrub through time"
          style={{ flex: 1, minWidth: 120 }}
        />
        <span
          style={{
            fontSize: 11,
            color: textColor,
            minWidth: 110,
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          t = {formatEng(t, 's')} · {i + 1}/{len}
        </span>
      </div>
      <div style={{ fontSize: 10, color: textColor, marginTop: 4, maxWidth: 460 }}>
        Scrub or play — the canvas shows the circuit at this instant; the physics never re-runs,
        only the view moves through the same solved result.
      </div>
    </div>
  )
}
