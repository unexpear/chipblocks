import type { Footprint } from './footprint.ts'
import { allAvailableFootprints, allUserFootprints, resolveFootprint } from './user-footprints.ts'
import { getUserPart, type UserPart } from './user-parts.ts'

/**
 * A user-authored part lands on the board too (user-made parts, slice 4a): it declares a footprint id,
 * and its pins map to that footprint's pads IN DECLARATION ORDER (pin 1 → pad 1, …). A footprint only
 * fits if it has at least as many pads as the part has pins. This returns the part's footprint — the
 * per-instance chosen override if it fits, else the part's own default — or undefined if neither fits.
 */
function userPartFootprint(userPart: UserPart, chosenId?: string): Footprint | undefined {
  const fits = (id: string | undefined): Footprint | undefined => {
    if (id === undefined) return undefined
    // resolveFootprint checks the AUTHORED library first, then the built-ins, and carries the
    // Object.hasOwn guard a persisted (untrusted) footprintId needs — 'constructor' / '__proto__' would
    // otherwise hand back an inherited member whose `.pads` is undefined → a crash on `.length`.
    const fp = resolveFootprint(id)
    return fp !== undefined && fp.pads.length >= userPart.pins.length ? fp : undefined
  }
  return fits(chosenId) ?? fits(userPart.footprintId)
}

/**
 * The schematic → board join: which physical footprint(s) a catalog part can land on, and its default.
 * The schematic says a part IS a resistor; this says a resistor SOLDERS as (by default) a 0603 chip —
 * the bridge the PCB canvas needs to turn a drawn circuit into copper. Per the anti-placeholder rule a
 * part is only mapped when a REAL matching footprint exists; everything else is honestly unassigned
 * until its package footprint is added (a BJT waits for SOT-23, an op-amp for SOIC-8, etc.), rather
 * than being forced onto a footprint that isn't its package.
 *
 * `options` lists every footprint the part could take (a chip passive comes in 0402 / 0603 / 0805);
 * `default` is the one a freshly-dropped part gets (the 0603, the workhorse middle size). The lists
 * grow as the footprint set does, with no change here beyond adding ids.
 */
export const PART_FOOTPRINTS: Record<string, { default: string; options: string[] }> = {
  // The 2-terminal chip passives — offered in the four common sizes (0402 / 0603 / 0805 / 1206), 0603 default.
  resistor: {
    default: 'R_0603_1608Metric',
    options: ['R_0402_1005Metric', 'R_0603_1608Metric', 'R_0805_2012Metric', 'R_1206_3216Metric'],
  },
  capacitor: {
    default: 'R_0603_1608Metric',
    options: ['R_0402_1005Metric', 'R_0603_1608Metric', 'R_0805_2012Metric', 'R_1206_3216Metric'],
  },
  thermistor: {
    default: 'R_0603_1608Metric',
    options: ['R_0402_1005Metric', 'R_0603_1608Metric', 'R_0805_2012Metric', 'R_1206_3216Metric'],
  },
  inductor: {
    default: 'R_0603_1608Metric',
    options: ['R_0402_1005Metric', 'R_0603_1608Metric', 'R_0805_2012Metric', 'R_1206_3216Metric'],
  },
  // Diodes land on the SOD-123 SMD package (pad 1 = cathode, the band-marked end).
  diode: { default: 'D_SOD-123', options: ['D_SOD-123'] },
  // Small transistors ship SMD in SOT-23 (default) or through-hole in TO-92 — BJTs and small-signal
  // MOSFETs alike. The two packages pin out differently (see TERMINAL_PADS_BY_FOOTPRINT).
  transistor_bjt_npn: { default: 'SOT-23', options: ['SOT-23', 'TO-92_Inline'] },
  transistor_bjt_pnp: { default: 'SOT-23', options: ['SOT-23', 'TO-92_Inline'] },
  transistor_mosfet_nmos: { default: 'SOT-23', options: ['SOT-23', 'TO-92_Inline'] },
  transistor_mosfet_pmos: { default: 'SOT-23', options: ['SOT-23', 'TO-92_Inline'] },
  // An LED lands SMD (0805, default) or as the 5 mm through-hole indicator (pad 1 = cathode either way).
  led: { default: 'LED_0805_2012Metric', options: ['LED_0805_2012Metric', 'LED_D5.0mm'] },
  // The rectifier diode ships in the axial DO-41 (1N400x, default) or, small-signal, the SMD SOD-123.
  diode_silicon_rectifier: {
    default: 'D_DO-41_SOD81_P10.16mm_Horizontal',
    options: ['D_DO-41_SOD81_P10.16mm_Horizontal', 'D_SOD-123'],
  },
  // A DC supply / battery enters a real board through a connector: a 2-pin 0.1″ header is the power-in land
  // (its + / − terminals become the two pads). Screw terminals / barrel jacks are future footprint options.
  power_source: {
    default: 'PinHeader_1x02_P2.54mm_Vertical',
    options: ['PinHeader_1x02_P2.54mm_Vertical'],
  },
}

/**
 * Packages YOU drew that a shipped part may also be given: the ones with the same number of pads as its
 * standard land pattern. Without this, an authored footprint could only ever reach a custom part —
 * you could draw a better 0603 land pattern and have no way to put a resistor on it. The pad-count
 * match is what keeps it honest: a two-pad resistor can take another two-pad land pattern, never a
 * 48-pad QFN.
 */
function authoredOptionsFor(defaultFootprintId: string): Footprint[] {
  const standard = resolveFootprint(defaultFootprintId)
  if (standard === undefined) return []
  return allUserFootprints().filter((f) => f.pads.length === standard.pads.length)
}

/**
 * The footprint a part lands on: the chosen one if it's a valid option for this part, else the part's
 * default. `undefined` when the part has no real footprint yet (honest — never a wrong package).
 */
export function footprintForPart(definition: string, chosenId?: string): Footprint | undefined {
  // Object.hasOwn, not `PART_FOOTPRINTS[definition]`: an untrusted definition ('constructor' etc.) from a
  // loaded file returns the inherited Object ctor (truthy), so the guard below would pass and
  // `entry.options.includes` crash. hasOwn only matches a real mapping.
  const entry = Object.hasOwn(PART_FOOTPRINTS, definition) ? PART_FOOTPRINTS[definition] : undefined
  if (entry !== undefined) {
    const allowed =
      chosenId !== undefined &&
      (entry.options.includes(chosenId) ||
        authoredOptionsFor(entry.default).some((f) => f.id === chosenId))
    return resolveFootprint(allowed && chosenId !== undefined ? chosenId : entry.default)
  }
  const userPart = getUserPart(definition)
  return userPart !== undefined ? userPartFootprint(userPart, chosenId) : undefined
}

/** Every footprint this part can take (for the footprint picker); empty when the part is unmapped. A
 *  custom part can take any built-in footprint with at least as many pads as it has pins. */
export function footprintOptions(definition: string): Footprint[] {
  const entry = PART_FOOTPRINTS[definition]
  if (entry !== undefined) {
    return [
      ...entry.options
        .map((id) => resolveFootprint(id))
        .filter((f): f is Footprint => f !== undefined),
      ...authoredOptionsFor(entry.default),
    ]
  }
  const userPart = getUserPart(definition)
  if (userPart === undefined) return []
  return footprintsForPinCount(userPart.pins.length)
}

/** The built-in footprints a part with `pinCount` pins can take (at least that many pads), sorted
 *  small → large. The New-Part editor uses this for an in-progress (unregistered) part; footprintOptions
 *  uses it for a saved custom part. */
export function footprintsForPinCount(pinCount: number): Footprint[] {
  // the AUTHORED library too — a package you drew is exactly what a part the built-ins don't cover needs
  return allAvailableFootprints()
    .filter((f) => f.pads.length >= pinCount)
    .sort((a, b) => a.pads.length - b.pads.length || a.name.localeCompare(b.name))
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
  // SOD-123 diode: pad 1 is the CATHODE (band-marked end), pad 2 the anode — the diode-footprint
  // convention, so a wired anode/cathode lands on the physically correct end.
  diode: { anode: '2', cathode: '1' },
  // The rectifier diode: pad 1 = cathode on both its packages (DO-41 band end, SOD-123 band end).
  diode_silicon_rectifier: { anode: '2', cathode: '1' },
  // An LED: pad 1 = cathode on both its packages (0805 marked end, 5 mm square/flat-side pin).
  led: { anode: '2', cathode: '1' },
  // A supply's + / − enter the board on the 2-pin power header: positive → pin 1 (square), negative → pin 2.
  power_source: { terminal_positive: '1', terminal_negative: '2' },
  // SOT-23 pinouts, the industry-standard assignments the datasheets print:
  // BJT 1=Base 2=Emitter 3=Collector (Nexperia BC846/BC847 series, SOT-23 marking diagram);
  // MOSFET 1=Gate 2=Source 3=Drain (onsemi/Nexperia 2N7002, SOT-23 pinning).
  transistor_bjt_npn: { base: '1', emitter: '2', collector: '3' },
  transistor_bjt_pnp: { base: '1', emitter: '2', collector: '3' },
  transistor_mosfet_nmos: { gate: '1', source: '2', drain: '3' },
  transistor_mosfet_pmos: { gate: '1', source: '2', drain: '3' },
}

/**
 * Per-FOOTPRINT pinout overrides — for parts whose pad↔terminal assignment DIFFERS by package. Most
 * parts pin out the same in every package (a chip resistor is 1/2 in 0402/0603/0805), so they only need
 * the default TERMINAL_PADS above. But a transistor's PHYSICAL pin order is package-specific: SOT-23
 * (the default) is Base/Emitter/Collector on pins 1/2/3, while the TO-92 jellybeans put the control pin
 * in the MIDDLE. Keyed definition → footprintId → {terminal: pad}; anything absent falls back to
 * TERMINAL_PADS. This is what keeps the ratsnest + routing physically correct when a part's package
 * changes (a base net wired to the emitter pin would be a real, silent mis-route).
 */
export const TERMINAL_PADS_BY_FOOTPRINT: Record<string, Record<string, Record<string, string>>> = {
  // TO-92, standard small-signal pinouts (flat face toward you, leads down):
  // BJT 2N3904 / 2N3906 = Emitter / Base / Collector on pins 1 / 2 / 3;
  // MOSFET 2N7000 / BS170 = Source / Gate / Drain on pins 1 / 2 / 3 — the control pin is the MIDDLE one.
  transistor_bjt_npn: { 'TO-92_Inline': { base: '2', emitter: '1', collector: '3' } },
  transistor_bjt_pnp: { 'TO-92_Inline': { base: '2', emitter: '1', collector: '3' } },
  transistor_mosfet_nmos: { 'TO-92_Inline': { gate: '2', source: '1', drain: '3' } },
  transistor_mosfet_pmos: { 'TO-92_Inline': { gate: '2', source: '1', drain: '3' } },
}

/** The pad↔terminal map for a part in a specific footprint: the per-footprint override if one exists,
 *  else the part's default (TERMINAL_PADS). undefined when the part is unmapped. */
function pinoutFor(definition: string, footprintId?: string): Record<string, string> | undefined {
  const override =
    footprintId !== undefined ? TERMINAL_PADS_BY_FOOTPRINT[definition]?.[footprintId] : undefined
  return override ?? TERMINAL_PADS[definition]
}

/** The pad a part's terminal solders to, for the part's chosen footprint (or its default pinout when
 *  no footprint is given). undefined when the part or terminal isn't mapped (honest). */
export function padForTerminal(
  definition: string,
  handleId: string,
  footprintId?: string,
): string | undefined {
  const pinout = pinoutFor(definition, footprintId)
  if (pinout !== undefined) return pinout[handleId]
  const map = userPartPadMap(definition, footprintId)
  return map?.get(handleId)
}

/**
 * Which pad each of a custom part's pins solders to — the one answer both directions read, so the
 * board's pin→pad and its pad→pin can never disagree.
 *
 * Three ways, in this order:
 *  1. the pad the pin NAMES (`pin.pad`) — a real symbol carries the package's pad label alongside the
 *     signal name, and on a 48-pin chip 'IO_12' and pad '31' have nothing to do with each other;
 *  2. a pad whose label matches the pin's name — so a package drawn with GND / VCC / OUT pads lines
 *     itself up with a part whose pins are called that, with nothing to fill in;
 *  3. declaration order over whatever pads are left — pin 1 → pad 1, which is what a two-pin part
 *     wants and what every part authored before pins could name a pad already relies on.
 *
 * A pad is claimed once, so an explicit or by-name match never steals the pad an earlier pin took.
 */
function userPartPadMap(definition: string, footprintId?: string): Map<string, string> | undefined {
  const userPart = getUserPart(definition)
  if (userPart === undefined) return undefined
  const fp = userPartFootprint(userPart, footprintId)
  if (fp === undefined) return undefined

  const padIds = new Set(fp.pads.map((p) => p.id))
  const assigned = new Map<string, string>()
  const claimed = new Set<string>()
  const take = (pinId: string, padId: string) => {
    assigned.set(pinId, padId)
    claimed.add(padId)
  }

  for (const pin of userPart.pins) {
    if (pin.pad !== undefined && padIds.has(pin.pad) && !claimed.has(pin.pad)) take(pin.id, pin.pad)
  }
  for (const pin of userPart.pins) {
    if (assigned.has(pin.id)) continue
    if (padIds.has(pin.name) && !claimed.has(pin.name)) take(pin.id, pin.name)
  }
  const unclaimed = fp.pads.filter((p) => !claimed.has(p.id))
  let next = 0
  for (const pin of userPart.pins) {
    if (assigned.has(pin.id)) continue
    const pad = unclaimed[next++]
    if (pad !== undefined) assigned.set(pin.id, pad.id)
  }
  return assigned
}

/** The terminal (handle) a footprint pad belongs to — the inverse of padForTerminal, for the part's
 *  chosen footprint. Lets the board over-current check route a pad back to its solved per-terminal
 *  current (base/collector/emitter, gate/source/drain). undefined when the part or pad isn't mapped. */
export function terminalForPad(
  definition: string,
  padId: string,
  footprintId?: string,
): string | undefined {
  const pads = pinoutFor(definition, footprintId)
  if (pads !== undefined) {
    for (const handle in pads) {
      if (pads[handle] === padId) return handle
    }
    return undefined
  }
  // Custom part: the inverse of the SAME map padForTerminal reads, so the two can't drift apart. A
  // footprint pad no pin claimed (a spare, a mounting hole) simply has no terminal.
  const map = userPartPadMap(definition, footprintId)
  if (map === undefined) return undefined
  for (const [pinId, pad] of map) {
    if (pad === padId) return pinId
  }
  return undefined
}

/** Which parameter is a part's BOM "value" (the number an assembler reads — '470 Ω', '100 µF'),
 *  and the unit symbol it displays with. Only the footprinted parts appear in a BOM. */
export const BOM_VALUE_PARAMS: Record<string, { param: string; unit: string }> = {
  resistor: { param: 'resistance', unit: 'Ω' },
  capacitor: { param: 'capacitance', unit: 'F' },
  thermistor: { param: 'resistance', unit: 'Ω' },
  inductor: { param: 'inductance', unit: 'H' },
}

/** The standard reference-designator class letters (ASME Y14.44 / IEEE 315 clause 22 — the R/C/L
 *  every schematic reader knows; RT is the thermal resistor). */
const DESIGNATOR_PREFIXES: Record<string, string> = {
  resistor: 'R',
  capacitor: 'C',
  inductor: 'L',
  thermistor: 'RT',
  diode: 'D',
  diode_silicon_rectifier: 'D',
  led: 'D',
  transistor_bjt_npn: 'Q',
  transistor_bjt_pnp: 'Q',
  transistor_mosfet_nmos: 'Q',
  transistor_mosfet_pmos: 'Q',
  // A connector/header (the board's power-in and 2-wire breakouts) prints as J — IEEE 315 clause 22.
  power_source: 'J',
}

/**
 * The board's short reference designator for a part — what the silkscreen prints, the BOM and the
 * pick-and-place file key on. A canvas-minted id (`resistor_3`) becomes the standard class letter
 * plus its number (`R3` — 'RESISTOR_3' would be 8 mm of silk lettering on a 1.6 mm part); a
 * hand-named id (`ra`, `alt3`) is the user's own name and is kept as they wrote it.
 */
export function boardDesignator(partId: string, definition: string): string {
  // A custom part carries its own designator letter (e.g. 'U'); built-ins use the standard class map.
  const prefix = DESIGNATOR_PREFIXES[definition] ?? getUserPart(definition)?.designatorPrefix
  if (prefix !== undefined) {
    const minted = partId.match(new RegExp(`^${definition}[_-]?(\\d+)$`, 'i'))
    if (minted !== null) return `${prefix}${minted[1]}`
  }
  return partId
}
