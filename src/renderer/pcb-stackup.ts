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
export type SurfaceFinishId = 'hasl' | 'hasl_lead_free' | 'enig' | 'osp' | 'immersion_silver'

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

export type StackupOptions = {
  thicknessMm: number
  copperWeight: CopperWeight
  surfaceFinish: SurfaceFinishId
}

/** The default board the editor starts from: 2-layer, 1.6 mm FR4, 1 oz copper, HASL. */
export const DEFAULT_STACKUP_OPTIONS: StackupOptions = {
  thicknessMm: 1.6,
  copperWeight: 'one_oz',
  surfaceFinish: 'hasl',
}

/**
 * Build a 2-layer FR4 stack-up from the editable knobs (finished thickness, copper weight, surface
 * finish). The cross-section is the standard KiCad build — solder mask / copper / FR4 core / copper
 * / solder mask — with the FR4 CORE thickness computed to fill whatever the copper + mask leave, so
 * the finished board is exactly the chosen thickness. The default (1.6 mm / 1 oz / HASL) reproduces
 * the installed KiCad 10.0 default stack-up byte-for-byte.
 */
export function buildStackup(options: StackupOptions = DEFAULT_STACKUP_OPTIONS): Stackup {
  const cu = COPPER_WEIGHT_MM[options.copperWeight]
  // the FR4 core is what's left after the two copper layers and two mask layers
  const core = Math.round((options.thicknessMm - 2 * SOLDER_MASK_MM - 2 * cu) * 1000) / 1000
  const finish = SURFACE_FINISHES[options.surfaceFinish]
  return {
    copperLayers: 2,
    thicknessMm: options.thicknessMm,
    copperWeight: options.copperWeight,
    surfaceFinish: options.surfaceFinish,
    layers: [
      { name: 'F.Mask', type: 'solder_mask', thicknessMm: SOLDER_MASK_MM },
      { name: 'F.Cu', type: 'copper', thicknessMm: cu },
      {
        name: 'dielectric 1',
        type: 'core',
        thicknessMm: core,
        material: 'FR4',
        dielectricConstant: FR4_SUBSTRATE.dielectricConstant,
        lossTangent: FR4_SUBSTRATE.lossTangent,
      },
      { name: 'B.Cu', type: 'copper', thicknessMm: cu },
      { name: 'B.Mask', type: 'solder_mask', thicknessMm: SOLDER_MASK_MM },
    ],
    provenance: {
      source_type: 'reference',
      title: `Stack-up: 2-layer, ${options.thicknessMm} mm FR4, ${options.copperWeight === 'two_oz' ? '2' : options.copperWeight === 'half_oz' ? '0.5' : '1'} oz copper, ${finish.name}`,
      citation:
        'Standard prototype 2-layer FR4 stack-up: mask / copper / FR4 core / copper / mask, the KiCad construction (0.01 mm mask per side, core filling to the chosen finished thickness). Thickness per the standard fab range, copper per IPC-4562, finish per its own citation. The 1.6 mm / 1 oz / HASL default reproduces the installed KiCad 10.0 default stack-up byte-for-byte.',
      confidence: 'high',
      url: 'https://gitlab.com/kicad/code/kicad',
      date_accessed: '2026-07-04',
    },
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
