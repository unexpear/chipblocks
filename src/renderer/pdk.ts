import type { FootprintProvenance } from './footprint.ts'

/**
 * The technology / PDK model — the chip-side twin of pcb-stackup.ts's board materials: the layer map and
 * design-rule data the chip-physical flow reads. Seeded from the SkyWater SKY130 open PDK (130 nm CMOS,
 * Apache-2.0, Google / CHIPS Alliance), so a .gds ChipBlocks emits (the GDSII-writer increment) carries
 * the REAL SKY130 layer numbers and therefore opens correctly in Magic / KLayout / OpenROAD — the export
 * bridge that lets a design leave ChipBlocks and be verified or continued in another tool.
 *
 * GDSII keys geometry by an INTEGER layer number + datatype — NOT by name; the human names live only in
 * this map (Layers Reference §2 of MASK-AND-LAYOUT-EDA-ARC.md). The DATATYPE encodes purpose: drawing/net
 * = 20, pin = 16, label = 5, cut/via = 44. Convention: each routing metal is datatype 20, and the cut/via
 * above it REUSES the metal's layer number at datatype 44 (met1 = 68/20 → via = 68/44).
 *
 * SCOPE (increment 1 of the chip-physical chapter): this ships the layer map (complete + cited) plus the
 * confirmed CORE of the design-rule deck. The full geometric rule set is sourced + expanded when the DRC
 * increment consumes it — the same staging the board flow used (rule VALUES land where a checker runs
 * them). The open SKY130 PDK is itself experimental ("not for production"); the layout-interchange layer
 * numbers, however, are stable.
 */

/** A GDSII (layer, datatype) integer pair — how the stream actually identifies geometry. */
export type GdsPair = { layer: number; datatype: number }

/** What a layer physically is, so the cell/GDS code can reason by role instead of by magic name. */
export type LayerKind =
  | 'well'
  | 'diffusion'
  | 'poly'
  | 'contact'
  | 'local_interconnect'
  | 'metal'
  | 'via'

export type PdkLayer = {
  /** PDK layer name (matches the SKY130 / Magic `calma` table). */
  name: string
  gds: GdsPair
  kind: LayerKind
  /** Plain-language description (the lead is non-technical). */
  description: string
}

/** The GDSII datatype numbers by purpose (SKY130 convention). */
export const GDS_PURPOSE = { drawing: 20, pin: 16, label: 5, cut: 44 } as const

/**
 * The SKY130 layer map — the real GDSII numbers, in stack order (bottom silicon → top metal). Every
 * `drawing`-purpose layer is datatype 20; every contact/via cut is datatype 44. These are exactly the
 * numbers Magic's `sky130gds.tech` `calma` table emits, so our .gds and a SKY130 layout share one grid.
 */
export const SKY130_LAYERS: readonly PdkLayer[] = [
  {
    name: 'nwell',
    gds: { layer: 64, datatype: 20 },
    kind: 'well',
    description: 'N-well — the n-type tub PMOS transistors sit inside.',
  },
  {
    name: 'diff',
    gds: { layer: 65, datatype: 20 },
    kind: 'diffusion',
    description: 'Diffusion / active — the source, drain and channel silicon.',
  },
  {
    name: 'poly',
    gds: { layer: 66, datatype: 20 },
    kind: 'poly',
    description: 'Polysilicon — the transistor gate; a FET forms where poly crosses diffusion.',
  },
  {
    name: 'licon1',
    gds: { layer: 66, datatype: 44 },
    kind: 'contact',
    description: 'Local-interconnect contact — connects diffusion/poly up to li1.',
  },
  {
    name: 'li1',
    gds: { layer: 67, datatype: 20 },
    kind: 'local_interconnect',
    description: 'Local interconnect — the first short-reach wiring layer.',
  },
  {
    name: 'mcon',
    gds: { layer: 67, datatype: 44 },
    kind: 'via',
    description: 'Metal contact — connects li1 up to met1.',
  },
  {
    name: 'met1',
    gds: { layer: 68, datatype: 20 },
    kind: 'metal',
    description: 'Metal 1 — the first routing metal and the cell power rails.',
  },
  {
    name: 'via',
    gds: { layer: 68, datatype: 44 },
    kind: 'via',
    description: 'Via1 — connects met1 up to met2.',
  },
  {
    name: 'met2',
    gds: { layer: 69, datatype: 20 },
    kind: 'metal',
    description: 'Metal 2 — the second routing metal.',
  },
  {
    name: 'via2',
    gds: { layer: 69, datatype: 44 },
    kind: 'via',
    description: 'Via2 — connects met2 up to met3.',
  },
]

export const SKY130_LAYERS_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'SkyWater SKY130 open PDK — GDSII layer numbers (130 nm CMOS, Apache-2.0)',
  citation:
    'SkyWater SKY130 Layers Reference + the open_pdks Magic techfile `calma` table (sky130gds.tech): nwell 64/20, diff 65/20, poly 66/20, licon1 66/44, li1 67/20, mcon 67/44, met1 68/20, via 68/44, met2 69/20, via2 69/44. Datatype purpose: drawing/net 20, pin 16, label 5, cut/via 44. Verified 2026-07-17 (also cross-checked in MASK-AND-LAYOUT-EDA-ARC.md via two deep-research passes). Steward Google / CHIPS Alliance; the open PDK subset is experimental / not-for-production, but the layout-interchange numbers are stable.',
  confidence: 'high',
  url: 'https://skywater-pdk.readthedocs.io/en/main/rules/layers.html',
  date_accessed: '2026-07-17',
}

/** name → layer, via a Map (not a plain-object index — an untrusted PDK name must not reach an inherited
 *  Object member; see the prototype-pollution hardening). */
const LAYER_BY_NAME: ReadonlyMap<string, PdkLayer> = new Map(SKY130_LAYERS.map((l) => [l.name, l]))

/** The PDK layer of the given name, or undefined if it is not a real SKY130 layer. */
export function pdkLayer(name: string): PdkLayer | undefined {
  return LAYER_BY_NAME.get(name)
}

/** The GDSII (layer, datatype) pair for a named layer, or undefined for an unknown name. */
export function gdsOf(name: string): GdsPair | undefined {
  return LAYER_BY_NAME.get(name)?.gds
}

/** The layer occupying a given GDSII (layer, datatype) pair — the inverse map (for reading a .gds back). */
export function layerAtGds(layer: number, datatype: number): PdkLayer | undefined {
  return SKY130_LAYERS.find((l) => l.gds.layer === layer && l.gds.datatype === datatype)
}

export type DesignRuleKind = 'min_width' | 'min_spacing'

/** One geometric design rule, in microns, cited. The set below is the CONFIRMED CORE — the full SKY130
 *  deck is expanded when the DRC increment consumes it (values sourced where a checker runs them). */
export type DesignRule = {
  layer: string
  kind: DesignRuleKind
  valueUm: number
  description: string
  provenance: FootprintProvenance
}

const skyRule = (
  layer: string,
  kind: DesignRuleKind,
  valueUm: number,
  ruleId: string,
  description: string,
): DesignRule => ({
  layer,
  kind,
  valueUm,
  description,
  provenance: {
    source_type: 'reference',
    title: `SkyWater SKY130 design rule ${ruleId}`,
    citation: `SkyWater SKY130 Periphery Rules (${ruleId}): ${layer} ${kind.replace('_', ' ')} = ${valueUm} µm. Confirmed 2026-07-17 against the SkyWater SKY130 PDK rules documentation.`,
    confidence: 'high',
    url: 'https://skywater-pdk.readthedocs.io/en/main/rules/periphery.html',
    date_accessed: '2026-07-17',
  },
})

/** The confirmed core of the SKY130 geometric rule deck (µm). Expanded to the full deck at the DRC
 *  increment; these are the load-bearing minimums a first standard-cell library needs to be legal. */
export const SKY130_CORE_RULES: readonly DesignRule[] = [
  skyRule('poly', 'min_width', 0.15, 'poly.1a', 'A gate/poly wire must be at least 0.15 µm wide.'),
  skyRule(
    'li1',
    'min_spacing',
    0.17,
    'li.3',
    'Two local-interconnect shapes must be at least 0.17 µm apart.',
  ),
  skyRule('met1', 'min_width', 0.14, 'm1.1', 'A metal-1 wire must be at least 0.14 µm wide.'),
  skyRule(
    'nwell',
    'min_width',
    0.84,
    'nwell.1',
    'An n-well must be at least 0.84 µm wide (it is a deep, lightly-doped tub).',
  ),
]

/** The rule value (µm) for a layer + kind, or undefined if not in the confirmed core yet. */
export function ruleFor(layer: string, kind: DesignRuleKind): number | undefined {
  return SKY130_CORE_RULES.find((r) => r.layer === layer && r.kind === kind)?.valueUm
}
