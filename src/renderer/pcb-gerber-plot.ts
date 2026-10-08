import {
  isHiddenEmptyBottom,
  type MmPoint,
  type ParsedPlot,
  type PlotDraw,
  parseChipblocksPlot,
} from './pcb-gerber-parse.ts'

/**
 * How a parsed manufacturing file is placed on one shared board frame. The parser already has the
 * geometry; this module decides the frame, the layer order, and which pictures would be a lie
 * (a negative film drawn as ink, a layer cropped to itself, a stack that quietly dropped a file).
 */

export type MmBounds = { minX: number; minY: number; maxX: number; maxY: number }

export type PlotRole =
  | 'copper-top'
  | 'copper-bottom'
  | 'copper-inner'
  | 'mask-top'
  | 'mask-bottom'
  | 'paste-top'
  | 'paste-bottom'
  | 'silk-top'
  | 'silk-bottom'
  | 'fab'
  | 'edge'
  | 'drill'
  | 'drill-npth'
  | 'other'

export type GerberLayerModel = {
  name: string
  role: PlotRole
  label: string
  color: string
  plot: ParsedPlot
  hidden: boolean
}

export type ViewBox = { minX: number; minY: number; w: number; h: number; margin: number }

export type GerberCheckModel = {
  layers: GerberLayerModel[]
  texts: { name: string; text: string }[]
  hiddenNames: string[]
  frame: MmBounds | null
  outline: MmPoint[] | null
  incomplete: { name: string; warnings: string[] }[]
}

const ROLE_STYLE: Record<PlotRole, { label: string; color: string }> = {
  'copper-top': { label: 'Top copper', color: '#e2b15c' },
  'copper-bottom': { label: 'Bottom copper', color: '#c4844a' },
  'copper-inner': { label: 'Inner copper', color: '#e07a4a' },
  'mask-top': { label: 'Top mask', color: '#1f7a45' },
  'mask-bottom': { label: 'Bottom mask', color: '#143d28' },
  'paste-top': { label: 'Top paste', color: '#d5dde6' },
  'paste-bottom': { label: 'Bottom paste', color: '#9aa6b2' },
  'silk-top': { label: 'Top silk', color: '#f4f6f8' },
  'silk-bottom': { label: 'Bottom silk', color: '#c5c8ce' },
  fab: { label: 'Fabrication', color: '#c4b48a' },
  edge: { label: 'Outline', color: '#5ee0a0' },
  drill: { label: 'Plated drills', color: '#8ec5ff' },
  'drill-npth': { label: 'Non-plated drills', color: '#ffb089' },
  other: { label: 'Other', color: '#e2b15c' },
}

/** Back to front, looking down from the top. Bottom mask is a separate tab — a second film would hide the bottom copper. */
const STACK_RANK: Partial<Record<PlotRole, number>> = {
  'copper-bottom': 0,
  'copper-inner': 1,
  'copper-top': 2,
  drill: 3,
  'drill-npth': 4,
  'mask-top': 5,
  'paste-top': 6,
  'silk-top': 7,
  fab: 8,
  edge: 9,
}

export const STACK_NOTE =
  'Stack looks down from the top, in one millimetre frame (Y down — factory Y flipped back). Bottom copper sits under the top. Nothing is mirrored. Bottom mask, bottom paste, and bottom silk are their own tabs.'

export const COPPER_NOTE =
  'Copper is solid. Plated holes are not cut out of this copper image — they are in the drill file.'

export const NEGATIVE_NOTE =
  'Negative polarity: the green film is the solder mask. The holes in it are where the file removes mask, not ink left behind.'

export const EDGE_NOTE =
  'The fab cuts the centreline of the outline stroke. The stroke width is the aperture in the file.'

export const DRILL_NOTE =
  'Each circle is a drilled hole, drawn under the solder mask. A tented via has no mask opening, so the stack covers it — open the drill file to see every hole. The diameter is the tool.'

export const OMITTED_POLARITY_NOTE =
  'This file does not say FilePolarity. The plot treats the strokes as ink — Gerber’s default is positive.'

export function roleFor(name: string, fileFunction: string | null): PlotRole {
  const fn = fileFunction ?? ''
  if (fn.startsWith('Copper,') && fn.endsWith(',Top')) return 'copper-top'
  if (fn.startsWith('Copper,') && fn.endsWith(',Bot')) return 'copper-bottom'
  if (fn.startsWith('Copper,') && fn.endsWith(',Inr')) return 'copper-inner'
  if (fn === 'Soldermask,Top') return 'mask-top'
  if (fn === 'Soldermask,Bot') return 'mask-bottom'
  if (fn === 'Paste,Top') return 'paste-top'
  if (fn === 'Paste,Bot') return 'paste-bottom'
  if (fn === 'Legend,Top') return 'silk-top'
  if (fn === 'Legend,Bot') return 'silk-bottom'
  if (fn.startsWith('AssemblyDrawing')) return 'fab'
  if (fn.startsWith('Profile')) return 'edge'
  if (fn.startsWith('NonPlated')) return 'drill-npth'
  if (fn.startsWith('Plated')) return 'drill'
  if (name.includes('NPTH')) return 'drill-npth'
  if (name.endsWith('.drl')) return 'drill'
  if (name.includes('Mask') && name.includes('B_')) return 'mask-bottom'
  if (name.includes('Mask')) return 'mask-top'
  if (name.includes('Paste') && name.includes('B_')) return 'paste-bottom'
  if (name.includes('Paste')) return 'paste-top'
  if (name.includes('Silk') && name.includes('B_')) return 'silk-bottom'
  if (name.includes('Silk')) return 'silk-top'
  if (name.includes('Fab')) return 'fab'
  if (name.includes('Edge')) return 'edge'
  if (name.includes('_Cu') && name.includes('In')) return 'copper-inner'
  if (name.includes('B_Cu') || name.endsWith('.gbl')) return 'copper-bottom'
  if (name.includes('Cu') || name.endsWith('.gtl')) return 'copper-top'
  return 'other'
}

export function gerberCheckModel(
  files: readonly { name: string; text: string }[],
): GerberCheckModel {
  const layers: GerberLayerModel[] = []
  const texts: { name: string; text: string }[] = []
  for (const file of files) {
    const plot = parseChipblocksPlot(file.text)
    if (plot.kind === 'text') {
      texts.push({ name: file.name, text: file.text })
      continue
    }
    const role = roleFor(file.name, plot.fileFunction)
    const style = ROLE_STYLE[role]
    layers.push({
      name: file.name,
      role,
      label: style.label,
      color: style.color,
      plot,
      hidden: plot.complete && isHiddenEmptyBottom(file.name, plot.draws.length),
    })
  }
  return {
    layers,
    texts,
    hiddenNames: layers.filter((layer) => layer.hidden).map((layer) => layer.name),
    frame: frameOf(layers),
    outline: outlineOf(layers),
    incomplete: layers
      .filter((layer) => !layer.plot.complete)
      .map((layer) => ({ name: layer.name, warnings: layer.plot.warnings })),
  }
}

export function layersInStack(layers: readonly GerberLayerModel[]): GerberLayerModel[] {
  return layers
    .map((layer, index) => ({ layer, index }))
    .filter(
      ({ layer }) => !layer.hidden && layer.plot.complete && STACK_RANK[layer.role] !== undefined,
    )
    .sort(
      (a, b) =>
        (STACK_RANK[a.layer.role] ?? 0) - (STACK_RANK[b.layer.role] ?? 0) || a.index - b.index,
    )
    .map(({ layer }) => layer)
}

export function emptyPlotMessage(plot: ParsedPlot): string {
  if (plot.polarity === 'Negative') {
    return 'No openings in this negative file — the film is left intact.'
  }
  if (plot.kind === 'excellon') return 'No holes in this drill file.'
  return 'No artwork in this file.'
}

function closePoint(a: MmPoint, b: MmPoint): boolean {
  return Math.abs(a.x - b.x) <= 1e-6 && Math.abs(a.y - b.y) <= 1e-6
}

/** Chain stroked edges into the closed outline they came from. A broken chain is not guessed. */
export function chainLoop(draws: readonly PlotDraw[]): MmPoint[] | null {
  const segs = draws.filter((draw) => draw.op === 'draw')
  if (segs.length < 3) return null
  const first = segs[0]
  if (first === undefined || first.op !== 'draw') return null
  const pts: MmPoint[] = [first.from]
  for (const seg of segs) {
    if (seg.op !== 'draw') return null
    const prev = pts[pts.length - 1]
    if (prev === undefined || !closePoint(prev, seg.from)) return null
    pts.push(seg.to)
  }
  const start = pts[0]
  const end = pts[pts.length - 1]
  if (start === undefined || end === undefined || !closePoint(start, end)) return null
  pts.pop()
  return pts
}

export function boundsOfDraws(draws: readonly PlotDraw[]): MmBounds | null {
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
  for (const draw of draws) {
    if (draw.op === 'draw') {
      const pad = draw.widthMm / 2
      add(draw.from.x, draw.from.y, pad, pad)
      add(draw.to.x, draw.to.y, pad, pad)
    } else if (draw.op === 'drill') {
      add(draw.at.x, draw.at.y, draw.diameterMm / 2, draw.diameterMm / 2)
    } else {
      const hw = draw.shape.kind === 'circle' ? draw.shape.dMm / 2 : draw.shape.wMm / 2
      const hh = draw.shape.kind === 'circle' ? draw.shape.dMm / 2 : draw.shape.hMm / 2
      add(draw.at.x, draw.at.y, hw, hh)
    }
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

export function unionBounds(items: readonly (MmBounds | null)[]): MmBounds | null {
  let acc: MmBounds | null = null
  for (const bounds of items) {
    if (bounds === null) continue
    if (acc === null) {
      acc = { ...bounds }
      continue
    }
    acc = {
      minX: Math.min(acc.minX, bounds.minX),
      minY: Math.min(acc.minY, bounds.minY),
      maxX: Math.max(acc.maxX, bounds.maxX),
      maxY: Math.max(acc.maxY, bounds.maxY),
    }
  }
  return acc
}

function frameOf(layers: readonly GerberLayerModel[]): MmBounds | null {
  return unionBounds(
    layers
      .filter((layer) => !layer.hidden && layer.plot.complete)
      .map((layer) => boundsOfDraws(layer.plot.draws)),
  )
}

function outlineOf(layers: readonly GerberLayerModel[]): MmPoint[] | null {
  const edge = layers.find((layer) => layer.role === 'edge' && layer.plot.complete)
  if (edge === undefined) return null
  return chainLoop(edge.plot.draws)
}

export function frameMargin(frame: MmBounds): number {
  const span = Math.max(frame.maxX - frame.minX, frame.maxY - frame.minY, 0.1)
  return Math.max(1, 0.06 * span)
}

export function viewBoxFor(frame: MmBounds): ViewBox {
  const margin = frameMargin(frame)
  return {
    minX: frame.minX - margin,
    minY: frame.minY - margin,
    w: Math.max(frame.maxX - frame.minX, 0.1) + margin * 2,
    h: Math.max(frame.maxY - frame.minY, 0.1) + margin * 2,
    margin,
  }
}

/** Fit the whole frame in the pane. Per-layer cropping made a pad and the outline look like different boards. */
export function fitPxPerMm(frame: MmBounds, maxW = 720, maxH = 400): number {
  const box = viewBoxFor(frame)
  const raw = Math.min(maxW / box.w, maxH / box.h)
  return Math.min(48, Math.max(2, raw))
}

export function scaleBarMm(spanMm: number): number {
  const candidates = [100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1]
  for (const candidate of candidates) {
    if (candidate <= spanMm * 0.35) return candidate
  }
  return 0.1
}

export function scaleBarAt(
  box: ViewBox,
  spanMm: number,
): { x1: number; x2: number; y: number; mm: number } {
  const mm = scaleBarMm(spanMm)
  const x1 = box.minX + box.margin * 0.35
  return { x1, x2: x1 + mm, y: box.minY + box.h - box.margin * 0.45, mm }
}

/** The thinnest stroked aperture, when it is under one screen pixel at this zoom. */
export function subpixelStrokeMm(draws: readonly PlotDraw[], pxPerMm: number): number | null {
  let thin = Infinity
  for (const draw of draws) {
    if (draw.op === 'draw') thin = Math.min(thin, draw.widthMm)
  }
  if (!Number.isFinite(thin) || thin * pxPerMm >= 1) return null
  return thin
}

export function hairlineNote(mm: number, pxPerMm: number): string {
  const px = mm * pxPerMm
  return `The thinnest stroke is ${String(mm)} mm (${px.toFixed(2)} screen pixels). Zoom in before treating a faint line as missing artwork.`
}
