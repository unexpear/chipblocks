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

/**
 * Which copper pad each schematic terminal solders to — the pin-level half of the schematic→board
 * join (the part-level half is PART_FOOTPRINTS). Keyed by the canvas handle id (`terminal_a` …), the
 * value is the footprint pad id ('1', '2' …). For the symmetric 2-terminal chips the a→1 / b→2
 * orientation is arbitrary electrically but fixed here so the ratsnest and (later) the router are
 * deterministic — and it matches the KiCad-import convention (kicad-schematic.ts maps pin 1 →
 * terminal_a for 2-terminal parts), so a round-tripped schematic lands on the same pads.
 */
export const TERMINAL_PADS: Record<string, Record<string, string>> = {
  resistor: { terminal_a: '1', terminal_b: '2' },
  capacitor: { terminal_a: '1', terminal_b: '2' },
  thermistor: { terminal_a: '1', terminal_b: '2' },
  inductor: { terminal_a: '1', terminal_b: '2' },
}

/** The pad a part's terminal solders to; undefined when the part or terminal isn't mapped (honest). */
export function padForTerminal(definition: string, handleId: string): string | undefined {
  return TERMINAL_PADS[definition]?.[handleId]
}
