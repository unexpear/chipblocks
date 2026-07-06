import { COPPER_WEIGHT_MM, type Stackup } from './pcb-stackup.ts'

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

export type BoardLayerId = 'f_silk' | 'f_cu' | 'core' | 'b_cu'

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
const SILK_COLOR = '#e8eaed'
const FR4_COLOR = '#0d3b26'

/**
 * The drawable layer stack, top → bottom, with real thicknesses read from the stack-up. Two copper
 * layers today (the board is 2-layer); F.Silkscreen sits above the top copper, the FR4 core between
 * the two coppers. The copper thickness is the chosen copper weight; the core is the stack-up's core
 * layer.
 */
export function boardLayers(stackup: Stackup): BoardLayer[] {
  const copperMm = COPPER_WEIGHT_MM[stackup.copperWeight]
  // The simplified "FR4 core" sheet stands for the WHOLE dielectric slab. On a multilevel board that
  // is every core + prepreg (not just the first core), so the label states the real dielectric depth
  // — otherwise a 4-/6-layer board would read a ~0.4 mm core under a 1.6 mm stated board thickness.
  const dielectricSum = stackup.layers
    .filter((l) => l.type === 'core' || l.type === 'prepreg')
    .reduce((sum, l) => sum + l.thicknessMm, 0)
  const coreMm = dielectricSum > 0 ? Math.round(dielectricSum * 1000) / 1000 : undefined
  return [
    { id: 'f_silk', name: 'F.Silkscreen', kind: 'silk', side: 'top', color: SILK_COLOR },
    {
      id: 'f_cu',
      name: 'F.Cu',
      kind: 'copper',
      side: 'top',
      thicknessMm: copperMm,
      color: COPPER_TOP,
    },
    {
      id: 'core',
      name: 'FR4 core',
      kind: 'dielectric',
      side: 'core',
      ...(coreMm !== undefined ? { thicknessMm: coreMm } : {}),
      color: FR4_COLOR,
    },
    {
      id: 'b_cu',
      name: 'B.Cu',
      kind: 'copper',
      side: 'bottom',
      thicknessMm: copperMm,
      color: COPPER_BOTTOM,
    },
  ]
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
