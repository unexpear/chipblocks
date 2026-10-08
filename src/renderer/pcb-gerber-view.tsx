import { useMemo, useState } from 'react'
import type { ManufacturingFile } from './pcb-fab.ts'
import type { MmPoint, PlotDraw } from './pcb-gerber-parse.ts'
import {
  COPPER_NOTE,
  DRILL_NOTE,
  EDGE_NOTE,
  emptyPlotMessage,
  fitPxPerMm,
  type GerberLayerModel,
  gerberCheckModel,
  hairlineNote,
  layersInStack,
  type MmBounds,
  NEGATIVE_NOTE,
  OMITTED_POLARITY_NOTE,
  STACK_NOTE,
  scaleBarAt,
  subpixelStrokeMm,
  viewBoxFor,
} from './pcb-gerber-plot.ts'
import { THEME } from './theme.ts'

/**
 * Plots the manufacturing files ChipBlocks just generated — the same Gerber and Excellon strings
 * the ZIP stores. It does not draw the board model. Every layer shares one millimetre frame, and a
 * file that could not be read in full is not drawn at all.
 */

const PLOT_BG = '#0b1220'
const FR4 = '#0d3b26'
const HOLE = '#06180f'

function DrawShape({
  draw,
  color,
  paint,
}: {
  draw: PlotDraw
  color: string
  paint: 'ink' | 'hole' | 'drill'
}) {
  if (draw.op === 'draw') {
    return (
      <line
        x1={draw.from.x}
        y1={draw.from.y}
        x2={draw.to.x}
        y2={draw.to.y}
        stroke={paint === 'hole' ? '#000000' : color}
        strokeWidth={draw.widthMm}
        strokeLinecap="round"
      />
    )
  }
  if (draw.op === 'drill') {
    return (
      <circle
        cx={draw.at.x}
        cy={draw.at.y}
        r={draw.diameterMm / 2}
        fill={HOLE}
        stroke={color}
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
      />
    )
  }
  const { shape, at } = draw
  const fill = paint === 'hole' ? '#000000' : paint === 'drill' ? HOLE : color
  if (shape.kind === 'circle') {
    return <circle cx={at.x} cy={at.y} r={shape.dMm / 2} fill={fill} />
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
      fill={fill}
    />
  )
}

function shapes(layer: GerberLayerModel, paint: 'ink' | 'hole' | 'drill') {
  return layer.plot.draws.map((draw, index) => (
    <DrawShape
      key={`${layer.name}-${String(index)}`}
      draw={draw}
      color={layer.color}
      paint={paint}
    />
  ))
}

function Film({
  layer,
  outline,
  frame,
  box,
}: {
  layer: GerberLayerModel
  outline: readonly MmPoint[] | null
  frame: MmBounds
  box: ReturnType<typeof viewBoxFor>
}) {
  const id = `gerber-film-${layer.role}`
  const mask = `url(#${id})`
  return (
    <g data-layer={layer.role} data-polarity="Negative" data-render="film-openings">
      <mask id={id} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
        <rect x={box.minX} y={box.minY} width={box.w} height={box.h} fill="#ffffff" />
        {shapes(layer, 'hole')}
      </mask>
      {outline !== null ? (
        <polygon
          points={outline.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={layer.color}
          mask={mask}
        />
      ) : (
        <rect
          x={frame.minX}
          y={frame.minY}
          width={frame.maxX - frame.minX}
          height={frame.maxY - frame.minY}
          fill={layer.color}
          mask={mask}
        />
      )}
    </g>
  )
}

function PlotCanvas({
  frame,
  outline,
  layers,
  showBoard,
  pxPerMm,
}: {
  frame: MmBounds
  outline: readonly MmPoint[] | null
  layers: readonly GerberLayerModel[]
  showBoard: boolean
  pxPerMm: number
}) {
  const box = viewBoxFor(frame)
  const span = Math.max(frame.maxX - frame.minX, frame.maxY - frame.minY, 0.1)
  const bar = scaleBarAt(box, span)
  return (
    <div style={{ overflow: 'auto', maxHeight: 420, background: PLOT_BG, borderRadius: 4 }}>
      <svg
        data-testid="gerber-plot"
        width={box.w * pxPerMm}
        height={box.h * pxPerMm}
        viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`}
        role="img"
        aria-label="Gerber plot, millimetres, Y down"
      >
        <title>Gerber plot, millimetres, Y down</title>
        {showBoard && outline !== null && (
          <polygon
            data-testid="gerber-board"
            points={outline.map((p) => `${p.x},${p.y}`).join(' ')}
            fill={FR4}
          />
        )}
        {layers.map((layer) =>
          layer.plot.polarity === 'Negative' ? (
            <Film key={layer.name} layer={layer} outline={outline} frame={frame} box={box} />
          ) : (
            <g
              key={layer.name}
              data-layer={layer.role}
              opacity={layer.role === 'paste-top' || layer.role === 'paste-bottom' ? 0.55 : 1}
            >
              {shapes(
                layer,
                layer.role === 'drill' || layer.role === 'drill-npth' ? 'drill' : 'ink',
              )}
            </g>
          ),
        )}
        <g data-testid="gerber-scale" data-mm={String(bar.mm)}>
          <line
            x1={bar.x1}
            y1={bar.y}
            x2={bar.x2}
            y2={bar.y}
            stroke="#d5dde6"
            strokeWidth={Math.max(span * 0.004, 0.05)}
          />
          <text
            x={bar.x1}
            y={bar.y - span * 0.02}
            fill="#d5dde6"
            fontSize={Math.max(span * 0.035, 0.6)}
          >
            {bar.mm} mm
          </text>
        </g>
      </svg>
    </div>
  )
}

function counts(draws: readonly PlotDraw[]): string {
  const flashes = draws.filter((d) => d.op === 'flash').length
  const strokes = draws.filter((d) => d.op === 'draw').length
  const drills = draws.filter((d) => d.op === 'drill').length
  return `${flashes} flash${flashes === 1 ? '' : 'es'} · ${strokes} stroke${strokes === 1 ? '' : 's'} · ${drills} drill${drills === 1 ? '' : 's'}`
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

export function GerberCheck({ files }: { files: readonly ManufacturingFile[] }) {
  const model = useMemo(() => gerberCheckModel(files), [files])
  const [mode, setMode] = useState<'stack' | 'one'>('stack')
  const [index, setIndex] = useState(0)
  const [pxOverride, setPxOverride] = useState<number | null>(null)
  const visible = model.layers.filter((layer) => !layer.hidden)
  const active = visible[index] ?? visible[0]
  const frame = model.frame
  const pxPerMm = frame === null ? 14 : (pxOverride ?? fitPxPerMm(frame))
  const stack = layersInStack(model.layers)
  const shown = mode === 'stack' || active === undefined ? stack : [active]
  const strokeDraws = shown.flatMap((layer) => layer.plot.draws)
  const thin = subpixelStrokeMm(strokeDraws, pxPerMm)
  const refused = model.incomplete.length > 0

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
      {model.hiddenNames.length > 0 && (
        <span style={{ fontSize: 11, color: THEME.textFaint }}>
          Hidden empty files: {model.hiddenNames.join(', ')} (no bottom-mounted parts).
        </span>
      )}
      {refused ? (
        <div
          data-testid="gerber-unplotted"
          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          <span style={{ fontSize: 11, color: THEME.statusWarn }}>
            Not plotted. Part of a file was skipped, and a partial picture would look finished.
          </span>
          {model.incomplete.map((item) => (
            <span key={item.name} style={{ fontSize: 11, color: THEME.statusWarn }}>
              {item.name}: {item.warnings.join(' ')}
            </span>
          ))}
        </div>
      ) : frame === null || active === undefined ? (
        <span style={{ fontSize: 11, color: THEME.textFaint }}>
          {visible[0] !== undefined
            ? emptyPlotMessage(visible[0].plot)
            : model.hiddenNames.length > 0
              ? 'No artwork to plot.'
              : 'No manufacturing files to plot.'}
        </span>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button
              type="button"
              onClick={() => setMode('stack')}
              style={{
                ...zoomBtn,
                background: mode === 'stack' ? THEME.surfaceActive : THEME.surfaceInput,
              }}
            >
              Stack
            </button>
            {visible.map((layer, i) => (
              <button
                key={layer.name}
                type="button"
                onClick={() => {
                  setMode('one')
                  setIndex(i)
                }}
                style={{
                  ...zoomBtn,
                  background:
                    mode === 'one' && i === (visible[index] ? index : 0)
                      ? THEME.surfaceActive
                      : THEME.surfaceInput,
                }}
              >
                {layer.name}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: THEME.textFaint }}>
            {mode === 'stack'
              ? 'All plotted layers, one frame.'
              : `${counts(active.plot.draws)}${active.plot.fileFunction !== null ? ` · ${active.plot.fileFunction}` : ''}${active.plot.polarity !== null ? ` · ${active.plot.polarity}` : ''}`}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {shown.map((layer) => (
              <span key={layer.name} style={{ fontSize: 10, color: THEME.textSoft }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    marginRight: 4,
                    background: layer.color,
                    borderRadius: 2,
                  }}
                />
                {layer.label}
              </span>
            ))}
          </div>
          <span style={{ fontSize: 11, color: THEME.textFaint }}>{STACK_NOTE}</span>
          {shown.some((layer) => layer.role.startsWith('copper')) && (
            <span style={{ fontSize: 11, color: THEME.textFaint }}>{COPPER_NOTE}</span>
          )}
          {shown.some((layer) => layer.plot.polarity === 'Negative') && (
            <span style={{ fontSize: 11, color: THEME.textFaint }}>{NEGATIVE_NOTE}</span>
          )}
          {shown.some((layer) => layer.role === 'edge') && (
            <span style={{ fontSize: 11, color: THEME.textFaint }}>{EDGE_NOTE}</span>
          )}
          {shown.some((layer) => layer.role === 'edge' && layer.plot.polarity === null) && (
            <span style={{ fontSize: 11, color: THEME.textFaint }}>{OMITTED_POLARITY_NOTE}</span>
          )}
          {shown.some((layer) => layer.role === 'drill' || layer.role === 'drill-npth') && (
            <span style={{ fontSize: 11, color: THEME.textFaint }}>{DRILL_NOTE}</span>
          )}
          {thin !== null && (
            <span style={{ fontSize: 11, color: THEME.statusWarn }}>
              {hairlineNote(thin, pxPerMm)}
            </span>
          )}
          {mode === 'one' && active.plot.draws.length === 0 && (
            <span style={{ fontSize: 11, color: THEME.textFaint }}>
              {emptyPlotMessage(active.plot)}
            </span>
          )}
          {mode === 'stack' ||
          active.plot.draws.length > 0 ||
          active.plot.polarity === 'Negative' ? (
            <>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setPxOverride(Math.max(2, pxPerMm / 1.5))}
                  style={zoomBtn}
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setPxOverride(Math.min(80, pxPerMm * 1.5))}
                  style={zoomBtn}
                >
                  +
                </button>
                <button type="button" onClick={() => setPxOverride(null)} style={zoomBtn}>
                  Fit
                </button>
                {thin !== null && (
                  <button
                    type="button"
                    onClick={() => setPxOverride(Math.min(80, 2 / thin))}
                    style={zoomBtn}
                  >
                    Zoom to thinnest line
                  </button>
                )}
              </span>
              <PlotCanvas
                frame={frame}
                outline={model.outline}
                layers={shown}
                showBoard={mode === 'stack'}
                pxPerMm={pxPerMm}
              />
            </>
          ) : null}
        </>
      )}
      {model.texts.length > 0 && (
        <span style={{ fontSize: 11, color: THEME.textFaint }}>
          Not plotted (not a Gerber or drill file):{' '}
          {model.texts.map((file) => file.name).join(', ')}.
        </span>
      )}
    </div>
  )
}
