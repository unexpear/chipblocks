import type { CopperLayer } from './pcb-route.ts'
import type { Stackup } from './pcb-stackup.ts'

/**
 * The board's drawable layers — the "sheets" of the lamination the PCB view pages through (the
 * stack-of-paper mode) and separates in space (the exploded 3-D mode). The physical board is a
 * lamination (foliation) of these sheets, top → bottom; each carries specific artwork:
 *
 *   F.Silkscreen  the printed ink — part outlines + reference designators
 *   F.Cu          top copper — every pad, the top-layer traces, the via barrels
 *   FR4 core      the substrate slab — the drilled holes pass through it
 *   B.Cu          bottom copper — the through-hole pads' rings, the bottom traces, the via barrels
 *
 * Each layer's real thickness comes from the stack-up (the copper weight, the FR4 core), so the
 * exploded view can LABEL each sheet with what it really is — even though the view exaggerates the
 * gap between sheets so the traces and vias are legible (35 µm copper next to a 1.5 mm core would
 * otherwise be an invisible line).
 */

export type BoardLayerId =
  | 'f_silk'
  | 'f_cu'
  | 'in1_cu'
  | 'in2_cu'
  | 'in3_cu'
  | 'in4_cu'
  | 'core'
  | 'b_cu'

/** The router's copper layer a drawable layer maps to (undefined for silk / dielectric). Lets the
 *  route tool draw on a chosen inner layer. */
export function copperLayerOf(id: BoardLayerId): CopperLayer | undefined {
  switch (id) {
    case 'f_cu':
      return 'top'
    case 'b_cu':
      return 'bottom'
    case 'in1_cu':
      return 'inner1'
    case 'in2_cu':
      return 'inner2'
    case 'in3_cu':
      return 'inner3'
    case 'in4_cu':
      return 'inner4'
    default:
      return undefined
  }
}

/** The drawable-sheet id a router copper layer draws on — the inverse of copperLayerOf. */
export function boardLayerIdForCopper(cl: CopperLayer): BoardLayerId {
  if (cl === 'top') return 'f_cu'
  if (cl === 'bottom') return 'b_cu'
  return `in${cl.slice(5)}_cu` as BoardLayerId
}

const INNER_TRACE_COLORS = ['#57b07a', '#b07ac0', '#c0a24a', '#4aa8c0'] // In1..In4

/** A copper layer's trace colour — top gold, bottom blue (the EDA convention), each inner layer a
 *  distinct hue — shared by the flat and exploded views so a layer reads the same in both. */
export function copperTraceColor(cl: CopperLayer): string {
  if (cl === 'top') return COPPER_TOP
  if (cl === 'bottom') return COPPER_BOTTOM
  return INNER_TRACE_COLORS[Number(cl.slice(5)) - 1] ?? '#7a9a7a'
}

export type BoardLayerKind = 'silk' | 'copper' | 'dielectric'

export type BoardLayer = {
  id: BoardLayerId
  /** The fab-standard layer name (F.Cu, B.Cu…). */
  name: string
  kind: BoardLayerKind
  side: 'top' | 'core' | 'bottom'
  /** The layer's real thickness in mm (copper weight / FR4 core), for the sheet's label. Undefined
   *  for silkscreen (ink, not a stack-up layer). */
  thicknessMm?: number
  /** Display colour for the sheet. */
  color: string
}

const COPPER_TOP = '#d9a441'
const COPPER_BOTTOM = '#4a7fd4'
const COPPER_INNER = '#b0863c' // a dimmer copper for the buried inner layers
const SILK_COLOR = '#e8eaed'
const FR4_COLOR = '#0d3b26'

/**
 * The drawable layer stack, top → bottom, with real thicknesses read from the stack-up. Walks the
 * stack-up's cross-section: F.Silkscreen above the top copper, then every copper layer (F.Cu, the
 * buried In1.Cu / In2.Cu… on a 4-/6-layer board, then B.Cu) with a dielectric sheet between each
 * copper pair (a core or prepreg). A two-layer board is exactly F.Silkscreen / F.Cu / FR4 core / B.Cu
 * as before; a multilevel board additionally pages through — and shows in the exploded view — its
 * real inner copper planes.
 */
export function boardLayers(stackup: Stackup): BoardLayer[] {
  const copperCount = stackup.layers.filter((l) => l.type === 'copper').length
  const sheets: BoardLayer[] = [
    { id: 'f_silk', name: 'F.Silkscreen', kind: 'silk', side: 'top', color: SILK_COLOR },
  ]
  let copperSeen = 0
  let pendingDielectric = 0 // dielectric thickness accumulated since the last copper layer
  for (const layer of stackup.layers) {
    if (layer.type === 'core' || layer.type === 'prepreg') {
      if (copperSeen > 0) pendingDielectric += layer.thicknessMm // only the dielectric BETWEEN coppers
      continue
    }
    if (layer.type !== 'copper') continue // solder mask isn't a drawable sheet (silk stands in on top)
    // Flush the dielectric between the previous copper and this one as its own FR4 sheet.
    if (copperSeen > 0 && pendingDielectric > 0) {
      sheets.push({
        id: 'core',
        name: 'FR4 core',
        kind: 'dielectric',
        side: 'core',
        thicknessMm: Math.round(pendingDielectric * 1000) / 1000,
        color: FR4_COLOR,
      })
      pendingDielectric = 0
    }
    const isTop = copperSeen === 0
    const isBottom = copperSeen === copperCount - 1
    const id: BoardLayerId = isTop
      ? 'f_cu'
      : isBottom
        ? 'b_cu'
        : (`in${copperSeen}_cu` as BoardLayerId)
    sheets.push({
      id,
      name: isTop ? 'F.Cu' : isBottom ? 'B.Cu' : `In${copperSeen}.Cu`,
      kind: 'copper',
      side: isTop ? 'top' : isBottom ? 'bottom' : 'core',
      thicknessMm: layer.thicknessMm, // the layer's REAL weight (inner planes are lighter than outer)
      color: isTop ? COPPER_TOP : isBottom ? COPPER_BOTTOM : COPPER_INNER,
    })
    copperSeen++
  }
  return sheets
}

/** A short human label for a layer including its real thickness (for the sheet header). */
export function layerLabel(layer: BoardLayer): string {
  const t = layer.thicknessMm
  if (t === undefined) return `${layer.name} (ink)`
  // a copper weight reads better as its ounce label; the core as mm
  if (layer.kind === 'copper') {
    const oz = t >= 0.06 ? '2 oz' : t <= 0.02 ? '0.5 oz' : '1 oz'
    return `${layer.name} (${oz}, ${Math.round(t * 1000)} µm)`
  }
  return `${layer.name} (${Math.round(t * 100) / 100} mm)`
}
