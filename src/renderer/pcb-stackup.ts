import type { FootprintProvenance } from './footprint.ts'

/**
 * The PCB stack-up — the board's physical SUBSTANCE, the layer that turns the geometry (outline +
 * placements + copper) into a real object a fab builds and quotes: the FR4 substrate and its
 * dielectric/thermal properties, the copper layers and their weight (the metal thickness), the
 * trace physics that weight sets (DC resistance + current-carrying capacity), and the surface
 * finish plated onto the exposed copper. Every value is CITED (the anti-placeholder rule applies to
 * materials exactly like it does to geometry) — the shipped default is the standard 2-layer FR4
 * board a prototype fab makes, ground-truthed against the installed KiCad 10.0's own default
 * stack-up and the project's Layer-0 material catalog (fixtures/valid/material-fr4.yaml +
 * material-copper.yaml), with the electrical laws from IPC-2221.
 *
 * This is the fab-ORDER spec: material, finished thickness, copper weight, layer count, surface
 * finish — the fields a real board house needs and the manufacturing ZIP was missing. Without it a
 * fab silently defaults everything (1.6 mm / FR4 / 1 oz / HASL); stating it makes the order explicit.
 */

/** Copper foil weight, in ounces per square foot — the trade unit for copper thickness. */
export type CopperWeight = 'half_oz' | 'one_oz' | 'two_oz'

/**
 * Copper weight → foil thickness. 1 oz/ft² of copper is the IPC-defined nominal 1.37 mil ≈ 34.8 µm;
 * the industry — and KiCad's stack-up — rounds it to 35 µm = 0.035 mm. (A pure density calculation
 * from 8.96 g/cm³ over a square foot gives ~34.1 µm, close to the nominal within the rounding.)
 * Half- and two-ounce scale linearly. 1 oz is the standard outer-layer default.
 */
export const COPPER_WEIGHT_MM: Record<CopperWeight, number> = {
  half_oz: 0.0175,
  one_oz: 0.035,
  two_oz: 0.07,
}

export const COPPER_WEIGHT_PROVENANCE: FootprintProvenance = {
  source_type: 'standard',
  title: 'Copper foil weight → thickness: 1 oz/ft² = 1.37 mil ≈ 35 µm (IPC nominal)',
  citation:
    'IPC-4562 / IPC-2221 copper foil weights: 1 oz/ft² = 1.37 mil = 34.8 µm is the DEFINED industry nominal (rounded to 35 µm = 0.035 mm). A pure density calculation (28.35 g over one square foot at 8.96 g/cm³) gives ~34.1 µm — consistent with the nominal to the rounding. Ground-truthed against the installed KiCad 10.0 default stack-up, which stores F.Cu / B.Cu at 0.035 mm.',
  confidence: 'high',
  url: 'https://www.ipc.org',
  date_accessed: '2026-07-04',
}

/** Copper's electrical constants, for trace DC resistance and its temperature drift. */
export const COPPER = {
  /** Resistivity ρ at 20 °C (Ω·m). The Layer-0 catalog value (material-copper.yaml). */
  resistivityOhmM: 1.68e-8,
  /** Temperature coefficient of resistance α (per °C) — resistance rises ~0.39 %/°C. */
  tempCoeffPerC: 0.00393,
  provenance: {
    source_type: 'reference',
    title: 'Copper: ρ = 1.68e-8 Ω·m @ 20 °C, α = 0.00393 /°C',
    citation:
      'ρ from the project Layer-0 catalog (fixtures/valid/material-copper.yaml, CRC Handbook 102nd ed., high-conductivity copper; the IEC 60028 annealed-conductor standard is 1.7241e-8). α = 0.00393 /°C is the standard annealed-copper temperature coefficient (IEC 60028 / CRC).',
    confidence: 'high',
    url: 'https://www.ipc.org',
    date_accessed: '2026-07-04',
  } satisfies FootprintProvenance,
} as const

/** The FR4 substrate, as the shipped default board is built from — the catalog's cited FR4 with the
 *  dielectric values a fab quotes (and an impedance calc would use), matching KiCad's stack-up. */
export const FR4_SUBSTRATE = {
  /** Relative permittivity (Dk) — KiCad's stack-up default; the catalog fixture is 4.4 @ 1 MHz, and
   *  real FR4 runs ~4.2–4.7, drifting down with frequency. */
  dielectricConstant: 4.5,
  /** Loss tangent (Df / dissipation factor). */
  lossTangent: 0.02,
  /** Glass-transition temperature (°C) — standard FR4 grade. */
  glassTransitionC: 140,
  /** Through-plane thermal conductivity (W/m·K). */
  thermalConductivityWmK: 0.3,
  provenance: {
    source_type: 'standard',
    title: 'Standard FR4 laminate: Dk 4.5, Df 0.02, Tg ~140 °C, k 0.3 W/m·K',
    citation:
      'Dk 4.5 / Df 0.02 are the installed KiCad 10.0 stack-up defaults (FR4 core), consistent with the project Layer-0 catalog (material-fr4.yaml: Dk 4.4 @ 1 MHz per IPC-4101/126, Df 0.020, Tg 130–180 °C typ 140, k 0.3 W/m·K through-plane; Isola/ITEQ datasheets). FR4 is a UL 94 V-0 glass-reinforced epoxy laminate.',
    confidence: 'medium',
    url: 'https://www.ipc.org',
    date_accessed: '2026-07-04',
  } satisfies FootprintProvenance,
} as const

/** A surface finish plated onto the exposed copper (the solder-mask openings) — what solders to. */
export type SurfaceFinishId =
  | 'hasl'
  | 'hasl_lead_free'
  | 'enig'
  | 'enepig'
  | 'osp'
  | 'immersion_silver'
  | 'immersion_tin'

export type SurfaceFinish = {
  id: SurfaceFinishId
  name: string
  /** One-line description of the coating + what it's for. */
  description: string
  /** RoHS / lead-free? */
  leadFree: boolean
  provenance: FootprintProvenance
}

/**
 * The common surface finishes a prototype fab offers. HASL (hot-air solder levelling) is the
 * cheapest and the default; ENIG (electroless nickel / immersion gold) is the flat, fine-pitch /
 * BGA choice; OSP and immersion silver are the flat, lead-free, lower-cost middle. Each carries the
 * cited coating description; the exact metal thicknesses live in the citation.
 */
export const SURFACE_FINISHES: Record<SurfaceFinishId, SurfaceFinish> = {
  hasl: {
    id: 'hasl',
    name: 'HASL (tin-lead)',
    description:
      'Hot-air solder levelling: molten Sn63/Pb37 blown flat over the copper. Cheapest, most solderable, long shelf life; uneven surface makes it poor for fine-pitch/BGA. Contains lead.',
    leadFree: false,
    provenance: {
      source_type: 'reference',
      title: 'HASL (Sn-Pb) — the default fab finish',
      citation:
        'JLCPCB / PCBWay capabilities: HASL with lead is the standard free finish. Solder coat a few µm to ~25 µm, uneven meniscus. IPC-A-600 acceptability.',
      confidence: 'high',
      url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
      date_accessed: '2026-07-04',
    },
  },
  hasl_lead_free: {
    id: 'hasl_lead_free',
    name: 'Lead-free HASL',
    description:
      'HASL with a lead-free solder alloy (SnCu / SAC). RoHS-compliant, same uneven surface as leaded HASL, slightly higher process temperature.',
    leadFree: true,
    provenance: {
      source_type: 'reference',
      title: 'Lead-free HASL — RoHS HASL',
      citation:
        'JLCPCB / PCBWay: lead-free HASL (SnCu-based), the RoHS drop-in for leaded HASL. IPC J-STD-003 solderability.',
      confidence: 'high',
      url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
      date_accessed: '2026-07-04',
    },
  },
  enig: {
    id: 'enig',
    name: 'ENIG',
    description:
      'Electroless nickel (~3–6 µm) under a thin immersion gold (~0.05–0.1 µm). Dead flat — the fine-pitch / BGA finish — flat, lead-free, long shelf life; costs more, and the nickel adds a little resistance.',
    leadFree: true,
    provenance: {
      source_type: 'standard',
      title: 'ENIG per IPC-4552: Ni 3–6 µm, Au 0.05–0.1 µm',
      citation:
        'IPC-4552 (ENIG specification): electroless nickel 118–236 µin (3–6 µm) with immersion gold 2–4 µin (0.05–0.1 µm), gold 0.05 µm minimum. The flat finish for fine-pitch and BGA; offered by JLCPCB/PCBWay at a surcharge.',
      confidence: 'high',
      url: 'https://www.ipc.org',
      date_accessed: '2026-07-04',
    },
  },
  enepig: {
    id: 'enepig',
    name: 'ENEPIG',
    description:
      'Electroless nickel (~3–6 µm) / electroless palladium (~0.05–0.3 µm) / immersion gold (~0.03–0.1 µm). The premium finish — the palladium barrier eliminates ENIG’s "black pad" risk, it is wire-bondable AND solderable, and it is dead flat; the most expensive of the common finishes.',
    leadFree: true,
    provenance: {
      source_type: 'standard',
      title: 'ENEPIG per IPC-4556: Ni 3–6 µm, Pd 0.05–0.3 µm, Au 0.03–0.1 µm',
      citation:
        'IPC-4556 (ENEPIG specification): electroless nickel 118–236 µin (3–6 µm), electroless palladium 2–12 µin (0.05–0.3 µm), immersion gold 1.2–3.9 µin (0.03–0.1 µm). Wire-bondable + solderable, no black-pad; the top-tier finish, offered by PCBWay/JLCPCB at a surcharge.',
      confidence: 'high',
      url: 'https://www.ipc.org',
      date_accessed: '2026-07-06',
    },
  },
  osp: {
    id: 'osp',
    name: 'OSP',
    description:
      'Organic solderability preservative — a thin organic film grown on bare copper. Flat, lead-free, cheapest flat finish; shorter shelf life, not re-workable many times, no probe-through-film for test.',
    leadFree: true,
    provenance: {
      source_type: 'reference',
      title: 'OSP — organic coating on bare copper',
      citation:
        'Fab capabilities (JLCPCB, PCBWay) + IPC J-STD-003 solderability: a sub-micron azole organic film preserving bare-copper solderability. Flat and RoHS, limited shelf life (~6–12 months). (Unlike ENIG/ImAg/ImSn, OSP has no dedicated IPC-455x finish standard.)',
      confidence: 'medium',
      url: 'https://jlcpcb.com/capabilities/pcb-capabilities',
      date_accessed: '2026-07-04',
    },
  },
  immersion_silver: {
    id: 'immersion_silver',
    name: 'Immersion silver',
    description:
      'A thin immersion silver layer (~0.1–0.4 µm) on the copper. Flat, lead-free, good solderability and RF loss; can tarnish, needs careful handling.',
    leadFree: true,
    provenance: {
      source_type: 'standard',
      title: 'Immersion silver per IPC-4553: ~0.1–0.4 µm Ag',
      citation:
        'IPC-4553 (immersion silver specification): 0.12–0.40 µm (5–16 µin) silver on copper. Flat, RoHS, low RF loss; sulfur-sensitive.',
      confidence: 'medium',
      url: 'https://www.ipc.org',
      date_accessed: '2026-07-04',
    },
  },
  immersion_tin: {
    id: 'immersion_tin',
    name: 'Immersion tin',
    description:
      'A thin immersion tin layer (~0.8–1.2 µm) on the copper. Flat, lead-free, excellent for fine-pitch and press-fit connectors; limited shelf life (copper-tin intermetallic keeps growing) and best with a single reflow.',
    leadFree: true,
    provenance: {
      source_type: 'standard',
      title: 'Immersion tin per IPC-4554: ~0.8–1.2 µm Sn',
      citation:
        'IPC-4554 (immersion tin specification): minimum 1.0 µm (40 µin) tin on copper, typically 0.8–1.2 µm. Flat, RoHS, ideal for press-fit / fine-pitch; Cu-Sn intermetallic growth limits shelf life + reflow count.',
      confidence: 'medium',
      url: 'https://www.ipc.org',
      date_accessed: '2026-07-06',
    },
  },
}

/** One physical layer of the board cross-section, KiCad's stack-up shape. */
export type StackupLayer = {
  name: string
  type: 'copper' | 'core' | 'prepreg' | 'solder_mask'
  thicknessMm: number
  /** Dielectric material name (cores/prepregs) — 'FR4'. */
  material?: string
  /** Relative permittivity (dielectrics only). */
  dielectricConstant?: number
  lossTangent?: number
}

export type Stackup = {
  /** Copper layer count — 2 (the standard minimum fab order). */
  copperLayers: number
  /** Finished board thickness, in mm (the fab's quoted thickness). */
  thicknessMm: number
  /** Outer-copper weight (inner layers, when present, are typically lighter). */
  copperWeight: CopperWeight
  surfaceFinish: SurfaceFinishId
  /** The full cross-section, top → bottom. */
  layers: StackupLayer[]
  provenance: FootprintProvenance
}

/** The standard finished board thicknesses a prototype fab offers (mm) — the stack-up editor's
 *  thickness choices. 1.6 mm is the default. */
export const STANDARD_BOARD_THICKNESSES_MM = [0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0, 2.4] as const

export const BOARD_THICKNESS_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'Standard finished board thicknesses: 0.4–2.4 mm, 1.6 mm default',
  citation:
    "PCBWay multi-layer stack-up selector offers 0.4 / 0.6 / 0.8 / 1.0 / 1.2 / 1.6 / 2.0 / 2.4 mm; 1.6 mm is the industry default (and the installed KiCad 10.0 default stack-up's finished thickness).",
  confidence: 'high',
  url: 'https://www.pcbway.com/capabilities.html',
  date_accessed: '2026-07-04',
}

/** The solder-mask thickness per side (mm) — KiCad's stack-up default, fixed for every board. */
const SOLDER_MASK_MM = 0.01

/**
 * The prepreg (pre-impregnated glass sheet) thickness bonding an outer copper foil to a core in a
 * multilevel build, mm. Standard 7628 glass-style prepreg is ~0.20 mm — JLCPCB's published 4-layer
 * 1.6 mm stack-up lists 7628 prepreg at 0.2104 mm, PCBWay's at ~0.196 mm; 0.20 mm is the cited
 * nominal. Fixed material — it does NOT scale with the finished thickness; the CORE is ground to hit
 * the ordered thickness, exactly as a fab laminates the stack.
 */
const PREPREG_MM = 0.2

/** Inner copper layers are typically LIGHTER than the outer plated copper — 0.5 oz is the fab norm
 *  (JLCPCB inner base ≈ 0.0152 mm ≈ 0.44 oz; our 0.5 oz nominal = 0.0175 mm). */
const INNER_COPPER_MM = COPPER_WEIGHT_MM.half_oz

/** The copper layer counts the stack-up editor offers — 2 (standard) or 4 / 6 (multilevel: inner
 *  copper planes buried in the FR4, seen in the exploded 3-D view). */
export type CopperLayerCount = 2 | 4 | 6

export const MULTILAYER_PROVENANCE: FootprintProvenance = {
  source_type: 'reference',
  title: 'Multilevel FR4 stack-up: 4/6-layer construction (7628 prepreg + 0.5 oz inner copper)',
  citation:
    'Standard multilevel FR4 build, per JLCPCB (JLC04161H 4-layer) and PCBWay (4-/6-layer laminated structure): outer copper foil (chosen weight) — 7628 prepreg ~0.20 mm — inner copper (0.5 oz, lighter than outer per the fab norm) around FR4 core(s), the core(s) ground so the finished board is the ordered thickness. 4-layer = 2 prepregs + 1 core; 6-layer = 3 prepregs + 2 cores. Verified 2026-07-05 against JLCPCB (jlcpcb.com/impedance) + PCBWay (pcbway.com/multi-layer-laminated-structure.html), both ≈1.6 mm total.',
  confidence: 'medium',
  url: 'https://www.pcbway.com/multi-layer-laminated-structure.html',
  date_accessed: '2026-07-05',
}

export type StackupOptions = {
  thicknessMm: number
  copperWeight: CopperWeight
  surfaceFinish: SurfaceFinishId
  /** Copper layer count — 2 (default) or 4 / 6 (multilevel). Absent = 2. */
  copperLayers?: CopperLayerCount
}

/** The default board the editor starts from: 2-layer, 1.6 mm FR4, 1 oz copper, HASL. */
export const DEFAULT_STACKUP_OPTIONS: StackupOptions = {
  thicknessMm: 1.6,
  copperWeight: 'one_oz',
  surfaceFinish: 'hasl',
  copperLayers: 2,
}

/**
 * Build an FR4 stack-up from the editable knobs (finished thickness, copper weight, surface finish,
 * copper-layer count). 2-layer is the standard KiCad build — solder mask / copper / FR4 core / copper
 * / solder mask. 4- and 6-layer are the real multilevel builds — the outer foils bond to the core(s)
 * through prepreg, with lighter inner copper planes buried between (the sandwich you see in the
 * exploded 3-D view). In every case the FR4 CORE thickness is computed to fill whatever the copper +
 * mask + prepreg leave, so the finished board is exactly the chosen thickness (how a fab grinds the
 * core to hit the order). The 2-layer default (1.6 mm / 1 oz / HASL) reproduces the installed KiCad
 * 10.0 default stack-up byte-for-byte.
 */
export function buildStackup(options: StackupOptions = DEFAULT_STACKUP_OPTIONS): Stackup {
  const copperLayers: CopperLayerCount = options.copperLayers ?? 2
  const outerCu = COPPER_WEIGHT_MM[options.copperWeight]
  const innerCu = INNER_COPPER_MM
  const finish = SURFACE_FINISHES[options.surfaceFinish]
  const round3 = (x: number) => Math.round(x * 1000) / 1000
  const fr4 = {
    material: 'FR4',
    dielectricConstant: FR4_SUBSTRATE.dielectricConstant,
    lossTangent: FR4_SUBSTRATE.lossTangent,
  } as const
  const mask = (name: string): StackupLayer => ({
    name,
    type: 'solder_mask',
    thicknessMm: SOLDER_MASK_MM,
  })
  const cu = (name: string, t: number): StackupLayer => ({ name, type: 'copper', thicknessMm: t })
  const prepreg = (name: string): StackupLayer => ({
    name,
    type: 'prepreg',
    thicknessMm: PREPREG_MM,
    ...fr4,
  })
  const core = (name: string, t: number): StackupLayer => ({
    name,
    type: 'core',
    thicknessMm: Math.max(round3(t), 0.05),
    ...fr4,
  })

  let layers: StackupLayer[]
  if (copperLayers === 4) {
    // outer / prepreg / inner / CORE / inner / prepreg / outer — the core fills to the finished thickness
    const coreMm =
      options.thicknessMm - 2 * SOLDER_MASK_MM - 2 * outerCu - 2 * innerCu - 2 * PREPREG_MM
    layers = [
      mask('F.Mask'),
      cu('F.Cu', outerCu),
      prepreg('prepreg 1'),
      cu('In1.Cu', innerCu),
      core('dielectric 1', coreMm),
      cu('In2.Cu', innerCu),
      prepreg('prepreg 2'),
      cu('B.Cu', outerCu),
      mask('B.Mask'),
    ]
  } else if (copperLayers === 6) {
    // outer / pp / inner / core / inner / pp / inner / core / inner / pp / outer — two cores share the
    // dielectric fill. Round the budget ONCE and let the second core absorb the remainder, so the two
    // rounded cores sum to the budget EXACTLY (halving then rounding each drifts ~1 µm per core, e.g.
    // 0.5 oz copper makes each core 0.4375 → 0.438, and 2× overshoots the ordered thickness by 1 µm).
    const coreBudget = round3(
      options.thicknessMm - 2 * SOLDER_MASK_MM - 2 * outerCu - 4 * innerCu - 3 * PREPREG_MM,
    )
    const core1Mm = round3(coreBudget / 2)
    const core2Mm = round3(coreBudget - core1Mm)
    layers = [
      mask('F.Mask'),
      cu('F.Cu', outerCu),
      prepreg('prepreg 1'),
      cu('In1.Cu', innerCu),
      core('dielectric 1', core1Mm),
      cu('In2.Cu', innerCu),
      prepreg('prepreg 2'),
      cu('In3.Cu', innerCu),
      core('dielectric 2', core2Mm),
      cu('In4.Cu', innerCu),
      prepreg('prepreg 3'),
      cu('B.Cu', outerCu),
      mask('B.Mask'),
    ]
  } else {
    // 2-layer (default): mask / copper / FR4 core / copper / mask — the KiCad construction, byte-for-byte
    const coreMm = round3(options.thicknessMm - 2 * SOLDER_MASK_MM - 2 * outerCu)
    layers = [
      mask('F.Mask'),
      cu('F.Cu', outerCu),
      core('dielectric 1', coreMm),
      cu('B.Cu', outerCu),
      mask('B.Mask'),
    ]
  }

  // The layers always sum to the finished board. For a feasible board that IS the requested thickness;
  // for an infeasible thin multilevel combo (copper + prepreg already exceed it) the cores clamp to
  // their floor and the real board is thicker — so we report the HONEST finished thickness, never a lie.
  const finishedMm = round3(layers.reduce((sum, l) => sum + l.thicknessMm, 0))
  const weightLabel =
    options.copperWeight === 'two_oz' ? '2' : options.copperWeight === 'half_oz' ? '0.5' : '1'
  const provenance: FootprintProvenance =
    copperLayers === 2
      ? {
          source_type: 'reference',
          title: `Stack-up: 2-layer, ${finishedMm} mm FR4, ${weightLabel} oz copper, ${finish.name}`,
          citation:
            'Standard prototype 2-layer FR4 stack-up: mask / copper / FR4 core / copper / mask, the KiCad construction (0.01 mm mask per side, core filling to the chosen finished thickness). Thickness per the standard fab range, copper per IPC-4562, finish per its own citation. The 1.6 mm / 1 oz / HASL default reproduces the installed KiCad 10.0 default stack-up byte-for-byte.',
          confidence: 'high',
          url: 'https://gitlab.com/kicad/code/kicad',
          date_accessed: '2026-07-04',
        }
      : {
          ...MULTILAYER_PROVENANCE,
          title: `Stack-up: ${copperLayers}-layer, ${finishedMm} mm FR4, ${weightLabel} oz outer / 0.5 oz inner copper, ${finish.name}`,
        }

  return {
    copperLayers,
    thicknessMm: finishedMm,
    copperWeight: options.copperWeight,
    surfaceFinish: options.surfaceFinish,
    layers,
    provenance,
  }
}

/** The shipped default stack-up (2-layer, 1.6 mm FR4, 1 oz copper, HASL). */
export const defaultStackup = (): Stackup => buildStackup(DEFAULT_STACKUP_OPTIONS)

/** A trace's copper thickness (mm) for a copper weight. */
export const traceThicknessMm = (weight: CopperWeight): number => COPPER_WEIGHT_MM[weight]

/**
 * A trace's DC resistance (Ω): R = ρ(T)·L / (w·t), with copper's resistivity drifting up with
 * temperature, ρ(T) = ρ₂₀·(1 + α·(T − 20)). All lengths in mm; the /1000 factors convert to metres.
 */
export function traceResistanceOhm(
  widthMm: number,
  lengthMm: number,
  weight: CopperWeight,
  tempC = 20,
): number {
  const t = traceThicknessMm(weight)
  if (widthMm <= 0 || t <= 0 || lengthMm <= 0) return 0
  const rho = COPPER.resistivityOhmM * (1 + COPPER.tempCoeffPerC * (tempC - 20))
  const areaM2 = (widthMm / 1000) * (t / 1000)
  return (rho * (lengthMm / 1000)) / areaM2
}

/** The IPC-2221 current-capacity constants — k for external (outer) vs internal (buried) copper.
 *  Internal traces are cooler-running-limited (no air), so they carry about HALF an external trace. */
export const IPC2221 = {
  kExternal: 0.048,
  kInternal: 0.024,
  provenance: {
    source_type: 'standard',
    title: 'IPC-2221 trace ampacity: I = k·ΔT^0.44·A^0.725 (k ext 0.048, int 0.024)',
    citation:
      'IPC-2221A §6.2 conductor sizing charts, curve-fit: I = k·ΔT^0.44·A^0.725 with A the cross-section in mil² and ΔT the allowed temperature rise in °C; k = 0.048 for external conductors, 0.024 for internal. The charts trace to 1955 U.S. NBS/Navy free-air data (the internal constant is the external simply halved, no in-board testing), so the rule is CONSERVATIVE — it oversizes; the modern IPC-2152 (2009) corrects it with real in-board measurements for tighter, design-specific sizing.',
    confidence: 'high',
    url: 'https://www.ipc.org',
    date_accessed: '2026-07-04',
  } satisfies FootprintProvenance,
} as const

const MM2_PER_MIL2 = (1 / 0.0254) ** 2 // 1 mm = 39.37 mil, so 1 mm² = 1550 mil²

/**
 * A trace's current-carrying capacity (A) for a temperature rise, by IPC-2221:
 *   I = k · ΔT^0.44 · A^0.725,   A = width × copper-thickness, in mil².
 * `layer` picks the external (default) or internal constant. Returns the amps the trace carries
 * without heating more than `deltaTempC` above ambient.
 */
export function traceAmpacity(
  widthMm: number,
  weight: CopperWeight,
  deltaTempC = 10,
  layer: 'external' | 'internal' = 'external',
): number {
  const areaMil2 = widthMm * traceThicknessMm(weight) * MM2_PER_MIL2
  if (areaMil2 <= 0 || deltaTempC <= 0) return 0
  const k = layer === 'external' ? IPC2221.kExternal : IPC2221.kInternal
  return k * deltaTempC ** 0.44 * areaMil2 ** 0.725
}

/** The plated copper on a via's hole wall — the barrel that carries current between layers. IPC-6012
 *  Class 2 requires ≥ 20 µm (0.8 mil) average copper in a plated through-hole; we size to that minimum
 *  (a conservative ampacity — the real plating is usually a little thicker). */
export const VIA_PLATING_MM = 0.02

export const VIA_PLATING_PROVENANCE: FootprintProvenance = {
  source_type: 'standard',
  title: 'Plated-through-hole wall copper: ≥ 20 µm (IPC-6012 Class 2)',
  citation:
    'IPC-6012 (Qualification and Performance Specification for Rigid PCBs) Class 2: minimum average plated copper in a plated through-hole / via barrel is 20 µm (0.8 mil), 25 µm minimum in any one spot. Sizing the via ampacity to the 20 µm minimum is conservative — the delivered plating is typically 25 µm+.',
  confidence: 'high',
  url: 'https://www.ipc.org',
  date_accessed: '2026-07-06',
}

/**
 * A plated via's current-carrying capacity (A), IPC-2221 applied to the barrel: I = k·ΔT^0.44·A^0.725
 * with A the barrel WALL cross-section — the copper annulus around the drilled hole, area
 * π·plating·(drill + plating). A via is buried in the board, so it uses the INTERNAL constant (like an
 * inner trace). A conservative first-pass number; a real board's via ampacity depends on its length
 * and the planes it ties to, which a thermal solver would model.
 */
export function viaAmpacity(drillMm: number, platingMm = VIA_PLATING_MM, deltaTempC = 10): number {
  const areaMm2 = Math.PI * platingMm * (drillMm + platingMm)
  const areaMil2 = areaMm2 * MM2_PER_MIL2
  if (areaMil2 <= 0 || deltaTempC <= 0) return 0
  return IPC2221.kInternal * deltaTempC ** 0.44 * areaMil2 ** 0.725
}

/** The IPC-2141A controlled-impedance formulas — the closed-form single-line approximations for a
 *  trace's characteristic impedance from its width, the dielectric height to its reference plane, the
 *  copper thickness, and the dielectric constant. */
export const IPC2141 = {
  provenance: {
    source_type: 'standard',
    title:
      'IPC-2141A controlled impedance: microstrip Z₀ = (87/√(εr+1.41))·ln(5.98h/(0.8w+t)); symmetric stripline Z₀ = (60/√εr)·ln(1.9b/(0.8w+t))',
    citation:
      'IPC-2141A (2004) "Controlled Impedance Circuit Boards and High-Speed Logic Design", the closed-form single-conductor approximations. Surface microstrip is stated valid for 0.1 ≤ w/h ≤ 2.0 and 1 ≤ εr ≤ 15; symmetric (centred) stripline for w/(b−t) < 0.35 and t/b < 0.25. These are APPROXIMATIONS (typically within ~5% of a 2-D field solver, worse near the range edges); a fab\'s impedance-controlled stack-up and a field solver (e.g. Polar Si9000) are authoritative for a manufactured board.',
    confidence: 'high',
    url: 'https://www.ipc.org',
    date_accessed: '2026-07-06',
  } satisfies FootprintProvenance,
} as const

/**
 * Surface-microstrip characteristic impedance (Ω), IPC-2141A:
 *   Z₀ = (87 / √(εr + 1.41)) · ln(5.98·h / (0.8·w + t))
 * h = dielectric height from the trace to its reference plane, w = width, t = copper thickness (all
 * mm), εr = dielectric constant. Returns 0 for a non-physical geometry (the ln argument ≤ 1 — a trace
 * so wide, or a plane so close, that the formula breaks down).
 */
export function microstripImpedanceOhms(
  widthMm: number,
  dielectricHeightMm: number,
  copperThicknessMm: number,
  dielectricConstant: number,
): number {
  if (widthMm <= 0 || dielectricHeightMm <= 0 || dielectricConstant < 1) return 0
  const denom = 0.8 * widthMm + copperThicknessMm
  const arg = denom > 0 ? (5.98 * dielectricHeightMm) / denom : 0
  if (arg <= 1) return 0
  return (87 / Math.sqrt(dielectricConstant + 1.41)) * Math.log(arg)
}

/**
 * Symmetric (centred) stripline characteristic impedance (Ω), IPC-2141A:
 *   Z₀ = (60 / √εr) · ln(1.9·b / (0.8·w + t))
 * b = plane-to-plane spacing (the trace centred between them), w = width, t = copper thickness (mm).
 * For an inner trace between two reference planes.
 */
export function striplineImpedanceOhms(
  widthMm: number,
  planeSpacingMm: number,
  copperThicknessMm: number,
  dielectricConstant: number,
): number {
  if (widthMm <= 0 || planeSpacingMm <= 0 || dielectricConstant < 1) return 0
  const denom = 0.8 * widthMm + copperThicknessMm
  const arg = denom > 0 ? (1.9 * planeSpacingMm) / denom : 0
  if (arg <= 1) return 0
  return (60 / Math.sqrt(dielectricConstant)) * Math.log(arg)
}

export type TraceImpedance = {
  ohms: number
  model: 'microstrip'
  /** The copper layer acting as the reference plane. */
  referenceLayer: string
  /** Dielectric height from the trace to that plane (mm) — the h in the formula. */
  dielectricHeightMm: number
  dielectricConstant: number
  /** Whether the geometry sits inside IPC-2141A's stated validity range (0.1 ≤ w/h ≤ 2.0). Outside
   *  it the number is an extrapolation — reported, but flagged. */
  withinValidity: boolean
}

/**
 * A routed (outer-layer) trace's characteristic impedance on a given stack-up. An outer trace
 * references the NEAREST copper layer below/above it — on a 2-layer board the opposite side (the full
 * core between them, so a thin trace runs high-impedance); on a 4-/6-layer board the adjacent inner
 * plane (a thin prepreg, where controlled impedance is practical). It assumes that reference layer is
 * a solid plane (the standard controlled-impedance assumption). undefined when there is no second
 * copper layer to reference.
 */
export function traceImpedance(
  stackup: Stackup,
  widthMm: number,
  layer: 'top' | 'bottom' = 'top',
): TraceImpedance | undefined {
  const copperIdx: number[] = []
  stackup.layers.forEach((l, i) => {
    if (l.type === 'copper') copperIdx.push(i)
  })
  if (copperIdx.length < 2) return undefined
  const traceI = layer === 'top' ? copperIdx[0] : copperIdx[copperIdx.length - 1]
  const refI = layer === 'top' ? copperIdx[1] : copperIdx[copperIdx.length - 2]
  if (traceI === undefined || refI === undefined) return undefined
  const lo = Math.min(traceI, refI)
  const hi = Math.max(traceI, refI)
  let height = 0
  let dkSum = 0
  let dkWeight = 0
  for (let i = lo + 1; i < hi; i++) {
    const l = stackup.layers[i]
    if (l === undefined) continue
    height += l.thicknessMm
    if (l.dielectricConstant !== undefined) {
      dkSum += l.dielectricConstant * l.thicknessMm
      dkWeight += l.thicknessMm
    }
  }
  if (height <= 0) return undefined
  const dk = dkWeight > 0 ? dkSum / dkWeight : FR4_SUBSTRATE.dielectricConstant
  const t = stackup.layers[traceI]?.thicknessMm ?? traceThicknessMm(stackup.copperWeight)
  const ohms = microstripImpedanceOhms(widthMm, height, t, dk)
  const wOverH = widthMm / height
  return {
    ohms,
    model: 'microstrip',
    referenceLayer: stackup.layers[refI]?.name ?? 'plane',
    dielectricHeightMm: height,
    dielectricConstant: dk,
    withinValidity: ohms > 0 && wOverH >= 0.1 && wOverH <= 2.0 && dk >= 1 && dk <= 15,
  }
}

/**
 * The trace width (mm) that hits a target characteristic impedance on this stack-up, by bisection
 * (impedance falls as the trace widens). undefined when the target isn't reachable within a
 * manufacturable 0.05–10 mm width — e.g. 50 Ω on a full 1.6 mm two-layer core needs an impractically
 * wide trace, which is the honest answer (controlled impedance wants a thin dielectric).
 */
export function widthForImpedance(
  stackup: Stackup,
  targetOhms: number,
  layer: 'top' | 'bottom' = 'top',
): number | undefined {
  const zAt = (w: number) => traceImpedance(stackup, w, layer)?.ohms ?? 0
  let lo = 0.05
  let hi = 10
  // Impedance falls monotonically as the trace widens (to 0 once the formula goes non-physical). The
  // target is reachable only if the thinnest trace is still ABOVE it and the widest is at or below it.
  const zNarrow = zAt(lo)
  const zWidest = zAt(hi)
  if (!(targetOhms > 0) || zNarrow < targetOhms || zWidest > targetOhms) return undefined
  for (let iter = 0; iter < 48; iter++) {
    const mid = (lo + hi) / 2
    if (zAt(mid) > targetOhms) lo = mid
    else hi = mid
  }
  return Math.round(((lo + hi) / 2) * 1000) / 1000
}
