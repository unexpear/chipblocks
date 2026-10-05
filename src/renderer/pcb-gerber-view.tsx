import { useMemo, useState } from 'react'
import type { ManufacturingFile } from './pcb-fab.ts'
import {
  isHiddenEmptyBottom,
  type ParsedPlot,
  type PlotDraw,
  parseChipblocksPlot,
} from './pcb-gerber-parse.ts'
import { THEME } from './theme.ts'

/**
 * Plots the manufacturing files ChipBlocks just generated — the same Gerber and Excellon strings
 * the ZIP stores — read back by pcb-gerber-parse.ts. It does not draw the board model. A check
 * that painted BoardView would pass even if the fab files were wrong.
 */

function inkFor(name: string): string {
  if (name.endsWith('.drl')) return '#8ec5ff'
  if (name.includes('Mask')) return '#d2a4ff'
  if (name.includes('Paste')) return '#d5dde6'
  if (name.includes('Silk')) return '#f4f6f8'
  if (name.includes('Fab')) return '#8a7a5a'
  if (name.includes('Edge')) return '#5ee0a0'
  return '#e2b15c'
}

function boundsOf(draws: readonly PlotDraw[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (x: number, y: number, hx: number, hy: number) => {
    minX = Math.min(minX, x - hx)
    minY = Math.min(minY, y - hy)
    maxX = Math.max(maxX, x + hx)
    maxY = Math.max(maxY, y + hy)
  }
  for (const d of draws) {
    if (d.op === 'draw') {
      const pad = d.widthMm / 2
      add(d.from.x, d.from.y, pad, pad)
      add(d.to.x, d.to.y, pad, pad)
    } else if (d.op === 'drill') {
      add(d.at.x, d.at.y, d.diameterMm / 2, d.diameterMm / 2)
    } else {
      const hw = d.shape.kind === 'circle' ? d.shape.dMm / 2 : d.shape.wMm / 2
      const hh = d.shape.kind === 'circle' ? d.shape.dMm / 2 : d.shape.hMm / 2
      add(d.at.x, d.at.y, hw, hh)
    }
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

function DrawShape({ draw, color }: { draw: PlotDraw; color: string }) {
  if (draw.op === 'draw') {
    return (
      <line
        x1={draw.from.x}
        y1={draw.from.y}
        x2={draw.to.x}
        y2={draw.to.y}
        stroke={color}
        strokeWidth={draw.widthMm}
        strokeLinecap="round"
      />
    )
  }
  if (draw.op === 'drill') {
    return <circle cx={draw.at.x} cy={draw.at.y} r={draw.diameterMm / 2} fill={color} />
  }
  const { shape, at } = draw
  if (shape.kind === 'circle') {
    return <circle cx={at.x} cy={at.y} r={shape.dMm / 2} fill={color} />
  }
  const rx =
    shape.kind === 'rect'
      ? 0
      : shape.kind === 'obround'
        ? Math.min(shape.wMm, shape.hMm) / 2
        : shape.rMm
  return (
    <rect
      x={at.x - shape.wMm / 2}
      y={at.y - shape.hMm / 2}
      width={shape.wMm}
      height={shape.hMm}
      rx={rx}
      ry={rx}
      fill={color}
    />
  )
}

function PlotSvg({
  draws,
  color,
  pxPerMm,
}: {
  draws: readonly PlotDraw[]
  color: string
  pxPerMm: number
}) {
  const bounds = boundsOf(draws)
  if (bounds === null) return null
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.1)
  const spanY = Math.max(bounds.maxY - bounds.minY, 0.1)
  const margin = Math.max(1, 0.06 * Math.max(spanX, spanY))
  const vbW = spanX + margin * 2
  const vbH = spanY + margin * 2
  return (
    <div style={{ overflow: 'auto', maxHeight: 420, background: '#0b1220', borderRadius: 4 }}>
      <svg
        width={vbW * pxPerMm}
        height={vbH * pxPerMm}
        viewBox={`${bounds.minX - margin} ${bounds.minY - margin} ${vbW} ${vbH}`}
        role="img"
        aria-label="Gerber plot, millimetres, Y down"
      >
        <title>Gerber plot, millimetres, Y down</title>
        {drawKeys(draws).map((key, i) => {
          const draw = draws[i]
          if (draw === undefined) return null
          return <DrawShape key={key} draw={draw} color={color} />
        })}
      </svg>
    </div>
  )
}

function drawKeys(draws: readonly PlotDraw[]): string[] {
  const seen = new Map<string, number>()
  return draws.map((draw) => {
    const base = JSON.stringify(draw)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}#${n}`
  })
}

function counts(draws: readonly PlotDraw[]): string {
  const flashes = draws.filter((d) => d.op === 'flash').length
  const strokes = draws.filter((d) => d.op === 'draw').length
  const drills = draws.filter((d) => d.op === 'drill').length
  return `${flashes} flash${flashes === 1 ? '' : 'es'} · ${strokes} stroke${strokes === 1 ? '' : 's'} · ${drills} drill${drills === 1 ? '' : 's'}`
}

export function GerberCheck({ files }: { files: readonly ManufacturingFile[] }) {
  const { tabs, hiddenNames } = useMemo(() => {
    const next: { name: string; text: string; plot: ParsedPlot }[] = []
    const hiddenNames: string[] = []
    for (const file of files) {
      const plot = parseChipblocksPlot(file.text)
      if (isHiddenEmptyBottom(file.name, plot.draws.length)) hiddenNames.push(file.name)
      else next.push({ name: file.name, text: file.text, plot })
    }
    return { tabs: next, hiddenNames }
  }, [files])
  const [index, setIndex] = useState(0)
  const [pxPerMm, setPxPerMm] = useState(14)
  const active = tabs[index] ?? tabs[0]
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        border: `1px solid ${THEME.borderStrong}`,
        borderRadius: 6,
        padding: 8,
        background: THEME.surfaceDeep,
      }}
    >
      <span style={{ fontSize: 11, color: THEME.textSoft }}>
        Gerber check — plots ChipBlocks output only. Drawn from the Gerber and Excellon strings
        Export ZIP would write, read back and plotted. Not the board view.
      </span>
      {hiddenNames.length > 0 && (
        <span style={{ fontSize: 11, color: THEME.textFaint }}>
          Hidden empty files: {hiddenNames.join(', ')} (no bottom-mounted parts).
        </span>
      )}
      {active === undefined ? (
        <span style={{ fontSize: 11, color: THEME.textFaint }}>
          No manufacturing files to plot.
        </span>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tabs.map((tab, i) => (
              <button
                key={tab.name}
                type="button"
                onClick={() => setIndex(i)}
                style={{
                  border: `1px solid ${THEME.borderStrong}`,
                  background:
                    i === (tabs[index] ? index : 0) ? THEME.surfaceActive : THEME.surfaceInput,
                  color: THEME.textSoft,
                  borderRadius: 4,
                  fontSize: 10,
                  padding: '2px 6px',
                  cursor: 'pointer',
                }}
              >
                {tab.name}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: THEME.textFaint }}>
            {active.plot.kind === 'text'
              ? 'Not a Gerber or drill file — shown as text, not plotted.'
              : counts(active.plot.draws)}
            {active.plot.fileFunction !== null ? ` · ${active.plot.fileFunction}` : ''}
            {active.plot.polarity !== null ? ` · ${active.plot.polarity}` : ''}
            {active.plot.polarity === 'Negative'
              ? ' — shapes are openings (mask removed), not copper left behind.'
              : ''}
          </span>
          {active.plot.warnings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {active.plot.warnings.slice(0, 8).map((w) => (
                <span key={w} style={{ fontSize: 11, color: THEME.statusWarn }}>
                  {w}
                </span>
              ))}
            </div>
          )}
          {active.plot.kind === 'text' ? (
            <pre
              style={{
                margin: 0,
                maxHeight: 360,
                overflow: 'auto',
                fontSize: 10,
                lineHeight: 1.35,
                color: THEME.textPrimary,
                whiteSpace: 'pre-wrap',
              }}
            >
              {active.text.length > 8000 ? `${active.text.slice(0, 8000)}\n…` : active.text}
            </pre>
          ) : active.plot.draws.length === 0 ? (
            <span style={{ fontSize: 11, color: THEME.textFaint }}>No draws in this file.</span>
          ) : (
            <>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setPxPerMm((z) => Math.max(4, z / 1.5))}
                  style={zoomBtn}
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setPxPerMm((z) => Math.min(48, z * 1.5))}
                  style={zoomBtn}
                >
                  +
                </button>
                <span style={{ fontSize: 10, color: THEME.textFaint }}>
                  millimetres, Y down (factory Y flipped back). Stroke widths are the apertures.
                </span>
              </span>
              <PlotSvg draws={active.plot.draws} color={inkFor(active.name)} pxPerMm={pxPerMm} />
            </>
          )}
        </>
      )}
    </div>
  )
}

const zoomBtn = {
  border: `1px solid ${THEME.borderStrong}`,
  background: THEME.surfaceInput,
  color: THEME.textSoft,
  borderRadius: 4,
  fontSize: 11,
  padding: '0 8px',
  cursor: 'pointer',
} as const
