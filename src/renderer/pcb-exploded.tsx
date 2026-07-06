import type { ReactElement } from 'react'
import type { Pad } from './footprint.ts'
import { type Board, footprintByPlacement, placePoint, silkReferenceAnchor } from './pcb-board.ts'
import {
  type BoardLayer,
  boardLayerIdForCopper,
  boardLayers,
  copperLayerOf,
  copperTraceColor,
  layerLabel,
} from './pcb-layers.ts'
import type { CopperLayer, CopperTrace, Via } from './pcb-route.ts'
import type { Stackup } from './pcb-stackup.ts'
import { SILK_TEXT, strokeText } from './stroke-font.ts'

/**
 * The PCB as an EXPLODED lamination — the board's sheets pulled apart in space so you can see each
 * plane and the copper it carries, with the plated vias drawn as vertical barrels bridging the two
 * copper planes across the gap (the "multilevel interaction" a real via is). This is the 3-D companion
 * to the flat + stack-of-paper 2-D views: same board, same real geometry, projected obliquely and
 * separated vertically.
 *
 * The projection is a plain oblique one — affine, so a single projector maps every feature (sheet
 * outlines, traces, pads, drills, silk) identically. The vertical GAP between sheets is exaggerated:
 * a real 35 µm copper film next to a 1.5 mm core would collapse to one line, so the view spaces the
 * sheets for legibility while each sheet's LABEL still states its real thickness.
 */

// Oblique projection: x goes right; the board's depth axis (y) shears right and rises as it recedes.
const SHEAR = 0.52 // how far the depth axis leans right
const RISE = -0.3 // how much the depth axis rises going back (negative = up the screen)
const GAP = 58 // px between adjacent sheets in the stack

const COPPER = '#d9a441'
const COPPER_EDGE = '#b5852b'
const COPPER_BOTTOM = '#4a7fd4'
const HOLE = '#06180f'
const SILK = '#e8eaed'
const COURTYARD = '#7fe3b0'
const VIA_BARREL = '#e8c069'
const LABEL = '#9fb0c3'

type P = { x: number; y: number }

function projectRaw(x: number, y: number, pxPerMm: number): P {
  return { x: x * pxPerMm + y * pxPerMm * SHEAR, y: y * pxPerMm * RISE }
}

export function PcbExplodedView({
  board,
  stackup,
  traces = [],
  vias = [],
  pxPerMm = 11,
}: {
  board: Board
  stackup: Stackup
  /** Routed copper on both layers — drawn on its own plane (bottom blue, top gold). */
  traces?: CopperTrace[]
  /** Plated vias — drawn as vertical barrels between the two copper planes. */
  vias?: Via[]
  pxPerMm?: number
}) {
  const layers = boardLayers(stackup)
  const n = layers.length
  const o = board.outline
  // The stack, top → bottom: the top sheet (index 0) floats highest, so it lifts the most.
  const liftOf = (stackIndex: number) => (n - 1 - stackIndex) * GAP
  const project =
    (lift: number) =>
    (x: number, y: number): P => {
      const r = projectRaw(x, y, pxPerMm)
      return { x: r.x, y: r.y - lift }
    }
  const copperLift = (cl: CopperLayer) =>
    liftOf(layers.findIndex((l) => l.id === boardLayerIdForCopper(cl)))

  // Bounding box: every board corner at the top and bottom lift, plus a wide left margin for labels.
  const cTL = { x: o.x, y: o.y }
  const cTR = { x: o.x + o.w, y: o.y }
  const cBR = { x: o.x + o.w, y: o.y + o.h }
  const cBL = { x: o.x, y: o.y + o.h }
  const corners: P[] = [cTL, cTR, cBR, cBL]
  const ring: P[] = [cTL, cTR, cBR, cBL] // polygon winding order
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const lift of [0, liftOf(0)]) {
    const p = project(lift)
    for (const c of corners) {
      const s = p(c.x, c.y)
      minX = Math.min(minX, s.x)
      minY = Math.min(minY, s.y)
      maxX = Math.max(maxX, s.x)
      maxY = Math.max(maxY, s.y)
    }
  }
  const labelPad = 96
  const pad = 20
  const originX = labelPad - minX
  const originY = pad - minY
  const wPx = maxX - minX + labelPad + pad
  const hPx = maxY - minY + 2 * pad
  const at = (s: P): P => ({ x: originX + s.x, y: originY + s.y })

  const traceEls = (cl: CopperLayer) => {
    const lift = copperLift(cl)
    const p = project(lift)
    return traces
      .filter((t) => t.layer === cl)
      .map((t) => (
        <polyline
          key={`tr${cl}${t.net}-${t.points[0]?.x},${t.points[0]?.y}-${t.points[t.points.length - 1]?.x},${t.points[t.points.length - 1]?.y}`}
          points={t.points
            .map((pt) => {
              const s = at(p(pt.x, pt.y))
              return `${s.x},${s.y}`
            })
            .join(' ')}
          fill="none"
          stroke={copperTraceColor(cl)}
          strokeWidth={t.widthMm * pxPerMm}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-trace={t.net}
          data-layer={cl}
        />
      ))
  }

  // A pad drawn as its four board-space corners projected onto the copper plane (keeps the rotation).
  const padQuad = (pl: Board['placements'][number], pad0: Pad, lift: number, key: string) => {
    const p = project(lift)
    const hw = pad0.size.w / 2
    const hh = pad0.size.h / 2
    const localCorners = [
      { x: pad0.center.x - hw, y: pad0.center.y - hh },
      { x: pad0.center.x + hw, y: pad0.center.y - hh },
      { x: pad0.center.x + hw, y: pad0.center.y + hh },
      { x: pad0.center.x - hw, y: pad0.center.y + hh },
    ]
    const pts = localCorners
      .map((lc) => {
        const b = placePoint(pl, lc)
        const s = at(p(b.x, b.y))
        return `${s.x.toFixed(1)},${s.y.toFixed(1)}`
      })
      .join(' ')
    const hole =
      pad0.type === 'through_hole' && pad0.holeDiameter !== undefined
        ? (() => {
            const b = placePoint(pl, pad0.center)
            const s = at(p(b.x, b.y))
            return <circle cx={s.x} cy={s.y} r={(pad0.holeDiameter / 2) * pxPerMm} fill={HOLE} />
          })()
        : null
    return (
      <g key={key}>
        <polygon points={pts} fill={COPPER} stroke={COPPER_EDGE} strokeWidth={0.5} />
        {hole}
      </g>
    )
  }

  const padsFor = (which: 'top' | 'bottom') => {
    const lift = copperLift(which)
    return board.placements.flatMap((pl) => {
      const fp = footprintByPlacement(pl)
      if (fp === undefined) return []
      // top plane carries every pad; bottom plane only the through-hole pads' rings
      const pads = which === 'top' ? fp.pads : fp.pads.filter((pd) => pd.type === 'through_hole')
      return pads.map((pd) => padQuad(pl, pd, lift, `pad-${which}-${pl.partId}-${pd.id}`))
    })
  }

  const drillEls = () => {
    const lift = liftOf(layers.findIndex((l) => l.id === 'core'))
    const p = project(lift)
    const out: ReactElement[] = []
    for (const pl of board.placements) {
      const fp = footprintByPlacement(pl)
      if (fp === undefined) continue
      for (const pd of fp.pads) {
        if (pd.holeDiameter === undefined) continue
        const b = placePoint(pl, pd.center)
        const s = at(p(b.x, b.y))
        out.push(
          <circle
            key={`drill-${pl.partId}-${pd.id}`}
            cx={s.x}
            cy={s.y}
            r={(pd.holeDiameter / 2) * pxPerMm}
            fill={HOLE}
            stroke={COPPER_EDGE}
            strokeWidth={0.4}
          />,
        )
      }
    }
    for (const v of vias) {
      const b = at(p(v.at.x, v.at.y))
      out.push(
        <circle
          key={`vdrill-${v.at.x},${v.at.y}`}
          cx={b.x}
          cy={b.y}
          r={(v.drillMm / 2) * pxPerMm}
          fill={HOLE}
          stroke={COPPER_EDGE}
          strokeWidth={0.4}
        />,
      )
    }
    return out
  }

  // The vias — vertical barrels joining the top copper plane to the bottom copper plane.
  const viaBarrels = () => {
    const top = project(copperLift('top'))
    const bot = project(copperLift('bottom'))
    return vias.map((v) => {
      const a = at(top(v.at.x, v.at.y))
      const b = at(bot(v.at.x, v.at.y))
      const r = (v.diameterMm / 2) * pxPerMm
      return (
        <g key={`via${v.at.x},${v.at.y}`} data-via={v.net}>
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={VIA_BARREL}
            strokeWidth={r * 1.6}
            strokeLinecap="round"
            opacity={0.85}
          />
          <circle cx={a.x} cy={a.y} r={r} fill={COPPER} stroke={COPPER_EDGE} strokeWidth={0.5} />
          <circle
            cx={b.x}
            cy={b.y}
            r={r}
            fill={COPPER_BOTTOM}
            stroke={COPPER_EDGE}
            strokeWidth={0.5}
          />
        </g>
      )
    })
  }

  const silkEls = () => {
    const lift = liftOf(layers.findIndex((l) => l.id === 'f_silk'))
    const p = project(lift)
    const els: ReactElement[] = []
    for (const pl of board.placements) {
      const fp = footprintByPlacement(pl)
      if (fp === undefined) continue
      // courtyard
      {
        const cx = fp.courtyard
        const cc = [
          { x: cx.x, y: cx.y },
          { x: cx.x + cx.w, y: cx.y },
          { x: cx.x + cx.w, y: cx.y + cx.h },
          { x: cx.x, y: cx.y + cx.h },
        ]
        const pts = cc
          .map((lc) => {
            const b = placePoint(pl, lc)
            const s = at(p(b.x, b.y))
            return `${s.x.toFixed(1)},${s.y.toFixed(1)}`
          })
          .join(' ')
        els.push(
          <polygon
            key={`court-${pl.partId}`}
            points={pts}
            fill="none"
            stroke={COURTYARD}
            strokeWidth={0.6}
            strokeDasharray="3 2"
            opacity={0.3}
          />,
        )
      }
      for (const s of fp.silkscreen) {
        const a = placePoint(pl, s.from)
        const b = placePoint(pl, s.to)
        const sa = at(p(a.x, a.y))
        const sb = at(p(b.x, b.y))
        els.push(
          <line
            key={`silk-${pl.partId}-${s.from.x},${s.from.y}-${s.to.x},${s.to.y}`}
            x1={sa.x}
            y1={sa.y}
            x2={sb.x}
            y2={sb.y}
            stroke={SILK}
            strokeWidth={Math.max(0.8, s.width * pxPerMm)}
            strokeLinecap="round"
          />,
        )
      }
      // reference designator
      const text = strokeText(
        pl.designator ?? pl.partId,
        silkReferenceAnchor(pl, fp),
        SILK_TEXT.heightMm,
      )
      for (const s of text.segments) {
        const sa = at(p(s.from.x, s.from.y))
        const sb = at(p(s.to.x, s.to.y))
        els.push(
          <line
            key={`ref-${pl.partId}-${s.from.x},${s.from.y}-${s.to.x},${s.to.y}`}
            x1={sa.x}
            y1={sa.y}
            x2={sb.x}
            y2={sb.y}
            stroke={SILK}
            strokeWidth={Math.max(0.8, SILK_TEXT.thicknessMm * pxPerMm)}
            strokeLinecap="round"
          />,
        )
      }
    }
    return els
  }

  const sheetFor = (layer: BoardLayer, stackIndex: number) => {
    const lift = liftOf(stackIndex)
    const isCopper = layer.kind === 'copper'
    const isCore = layer.kind === 'dielectric'
    const fill = layer.color
    const fillOpacity = isCore ? 0.55 : isCopper ? 0.14 : 0.06
    // the sheet outline
    const p = project(lift)
    const ringPts = ring
      .map((c) => {
        const s = at(p(c.x, c.y))
        return `${s.x.toFixed(1)},${s.y.toFixed(1)}`
      })
      .join(' ')
    // label anchored to the left of the sheet's near-left corner
    const anchor = at(p(o.x, o.y + o.h))
    return (
      <g key={`sheet-${layer.id}`}>
        <polygon
          points={ringPts}
          fill={fill}
          fillOpacity={fillOpacity}
          stroke={layer.color}
          strokeOpacity={0.9}
          strokeWidth={1.2}
        />
        <line
          x1={anchor.x - 8}
          y1={anchor.y}
          x2={anchor.x - 4}
          y2={anchor.y}
          stroke={LABEL}
          strokeWidth={1}
        />
        <text
          x={anchor.x - 12}
          y={anchor.y + 3}
          textAnchor="end"
          fontSize={10}
          fill={LABEL}
          fontFamily="system-ui, sans-serif"
        >
          {layerLabel(layer)}
        </text>
      </g>
    )
  }

  // Draw bottom → top so upper sheets overlay, interleaving each sheet's own artwork.
  const drawOrder = layers.map((l, i) => ({ l, i })).reverse()
  // On a multilevel board there are several FR4 dielectric sheets; the drilled holes pass through the
  // whole board, so draw them once (on the first core sheet), not once per dielectric.
  const firstCoreIndex = layers.findIndex((l) => l.id === 'core')

  return (
    <svg
      width={wPx}
      height={hPx}
      viewBox={`0 0 ${wPx} ${hPx}`}
      style={{ display: 'block', fontFamily: 'system-ui, sans-serif' }}
      role="img"
      aria-label="PCB exploded lamination view"
    >
      <title>{`PCB exploded view — ${n} layers, ${board.placements.length} parts`}</title>
      {drawOrder.map(({ l, i }) => {
        const cl = l.kind === 'copper' ? copperLayerOf(l.id) : undefined
        return (
          <g key={`layer-${l.id}`}>
            {sheetFor(l, i)}
            {cl !== undefined && traceEls(cl)}
            {l.id === 'b_cu' && padsFor('bottom')}
            {l.id === 'core' && i === firstCoreIndex && drillEls()}
            {l.id === 'f_cu' && padsFor('top')}
            {l.id === 'f_silk' && silkEls()}
          </g>
        )
      })}
      {/* via barrels bridge the copper planes — drawn last so they read as the through-connection */}
      {viaBarrels()}
    </svg>
  )
}
