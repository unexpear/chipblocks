import { BUILTIN_FOOTPRINTS, type Footprint } from './footprint.ts'

/**
 * The schematic → board join: which physical footprint(s) a catalog part can land on, and its default.
 * The schematic says a part IS a resistor; this says a resistor SOLDERS as (by default) a 0603 chip —
 * the bridge the PCB canvas needs to turn a drawn circuit into copper. Per the anti-placeholder rule a
 * part is only mapped when a REAL matching footprint exists; everything else is honestly unassigned
 * until its package footprint is added (a BJT waits for SOT-23, an op-amp for SOIC-8, etc.), rather
 * than being forced onto a footprint that isn't its package.
 *
 * `options` lists every footprint the part could take (a resistor also comes in 0402/0805/through-hole);
 * `default` is the one a freshly-dropped part gets. Today only the 0603 exists for these, so the lists
 * are short — they grow as the footprint set does, with no change here beyond adding ids.
 */
export const PART_FOOTPRINTS: Record<string, { default: string; options: string[] }> = {
  // The 2-terminal chip parts that genuinely come in an 0603 (1608 metric) package.
  resistor: { default: 'R_0603_1608Metric', options: ['R_0603_1608Metric'] },
  capacitor: { default: 'R_0603_1608Metric', options: ['R_0603_1608Metric'] },
  thermistor: { default: 'R_0603_1608Metric', options: ['R_0603_1608Metric'] },
  inductor: { default: 'R_0603_1608Metric', options: ['R_0603_1608Metric'] },
}

/**
 * The footprint a part lands on: the chosen one if it's a valid option for this part, else the part's
 * default. `undefined` when the part has no real footprint yet (honest — never a wrong package).
 */
export function footprintForPart(definition: string, chosenId?: string): Footprint | undefined {
  const entry = PART_FOOTPRINTS[definition]
  if (entry === undefined) return undefined
  const id = chosenId !== undefined && entry.options.includes(chosenId) ? chosenId : entry.default
  return BUILTIN_FOOTPRINTS[id]
}

/** Every footprint this part can take (for a future footprint picker); empty when the part is unmapped. */
export function footprintOptions(definition: string): Footprint[] {
  const entry = PART_FOOTPRINTS[definition]
  if (entry === undefined) return []
  return entry.options
    .map((id) => BUILTIN_FOOTPRINTS[id])
    .filter((f): f is Footprint => f !== undefined)
}
