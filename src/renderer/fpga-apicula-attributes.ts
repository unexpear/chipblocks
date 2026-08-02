/**
 * FPGA fabric — Gowin (via Project Apicula): the general attribute engine, and the cells built on it.
 *
 * The flip-flop decode next door works by reading one attribute table out of a tile's bits. That same machinery
 * decodes almost everything else the fabric can be configured to do — the carry chain, the I/O buffers, the
 * block memories — differing only in WHICH table is read and which name dictionary decodes it:
 *
 *   carry / ALU     `CLS0..CLS2` (shortval), `SLICE` names   — a MODE value inside the logic-cell table
 *   I/O buffers     `IOBA..IOBJ` (longval),  `IOB` names     — a separate table per buffer in the tile
 *   block memory    `BSRAM_*`    (shortval), `BSRAM` names
 *
 * So this module holds the engine once and the per-cell readers on top, rather than three near-copies.
 *
 * The engine is Apicula's `parse_attrvals`, and its three passes are described at `decodeAttributeTable`. The
 * one that is easy to miss supplies DEFAULTS from rows whose bits are ABSENT, which is why a blank tile reports
 * real settings rather than nothing.
 */

/** One row of an attribute table: signed attribute-value indices, and the bits selecting them. */
export type GowinAttributeRow = {
  key: readonly number[]
  bits: readonly string[]
}

/** Every attribute table of a device, plus the dictionaries that name what they decode to. */
export type GowinAttributeDatabase = {
  /** tile type -> table name (`CLS0`, `IOBA`, `BSRAM_SP`, ...) -> its rows. */
  tables: ReadonlyMap<number, ReadonlyMap<string, readonly GowinAttributeRow[]>>
  /** logic class (`SLICE`, `IOB`, `BSRAM`, ...) -> value index -> `[attribute id, raw value]`. */
  logicinfo: ReadonlyMap<string, ReadonlyMap<number, readonly [number, number]>>
  /** family (`cls`, `iob`, ...) -> attribute id -> name, and raw value -> name. */
  families: ReadonlyMap<string, { attributes: Map<number, string>; values: Map<number, string> }>
}

/** Which dictionaries decode a given table. */
export type GowinAttributeFamily = {
  /** the `logicinfo` class holding this table's value indices. */
  logicClass: string
  /** the attribute-name family. */
  family: string
}

export const GOWIN_SLICE_FAMILY: GowinAttributeFamily = { logicClass: 'SLICE', family: 'cls' }
export const GOWIN_IOB_FAMILY: GowinAttributeFamily = { logicClass: 'IOB', family: 'iob' }
export const GOWIN_BSRAM_FAMILY: GowinAttributeFamily = { logicClass: 'BSRAM', family: 'bsram' }

/** Parse the converted attribute database. */
export function parseGowinAttributeDatabase(text: string): GowinAttributeDatabase {
  const raw = JSON.parse(text) as {
    tables: Record<string, Record<string, Record<string, number[][]>>>
    logicinfo: Record<string, Record<string, number[]>>
    families: Record<string, { attrids: Record<string, number>; attrvals: Record<string, number> }>
  }

  const tables = new Map<number, Map<string, GowinAttributeRow[]>>()
  for (const [ttyp, byName] of Object.entries(raw.tables)) {
    const perTable = new Map<string, GowinAttributeRow[]>()
    for (const [name, rows] of Object.entries(byName)) {
      const parsed: GowinAttributeRow[] = []
      for (const [key, coords] of Object.entries(rows))
        parsed.push({
          key: key.split(',').map((n) => Number.parseInt(n, 10)),
          bits: coords.map((c) => `${c[0]},${c[1]}`),
        })
      perTable.set(name, parsed)
    }
    tables.set(Number.parseInt(ttyp, 10), perTable)
  }

  const logicinfo = new Map<string, Map<number, readonly [number, number]>>()
  for (const [cls, entries] of Object.entries(raw.logicinfo)) {
    const reversed = new Map<number, readonly [number, number]>()
    for (const [index, pair] of Object.entries(entries))
      reversed.set(Number.parseInt(index, 10), [pair[0] as number, pair[1] as number])
    logicinfo.set(cls, reversed)
  }

  const families = new Map<
    string,
    { attributes: Map<number, string>; values: Map<number, string> }
  >()
  for (const [name, dictionaries] of Object.entries(raw.families)) {
    const attributes = new Map<number, string>()
    for (const [text_, id] of Object.entries(dictionaries.attrids)) attributes.set(id, text_)
    const values = new Map<number, string>()
    for (const [text_, id] of Object.entries(dictionaries.attrvals)) values.set(id, text_)
    families.set(name, { attributes, values })
  }

  return { tables, logicinfo, families }
}

const isStrictSubset = (bits: readonly string[], of: readonly string[]): boolean => {
  if (bits.length >= of.length) return false
  const target = new Set(of)
  return bits.every((bit) => target.has(bit))
}

/**
 * Decode one attribute table out of a tile's bits — Apicula's `parse_attrvals`.
 *
 * Three passes, because a row's key lists indices that must be PROGRAMMED (positive) or ERASED (negative):
 *  1. positively keyed rows whose bits are all programmed, keeping only MAXIMAL matches;
 *  2. negatively keyed rows whose bits ARE programmed, which never override pass 1;
 *  3. negatively keyed rows whose bits are NOT programmed — the DEFAULTS.
 *
 * Values come back raw, as Apicula returns them; `gowinValueName` turns one into a name.
 */
export function decodeAttributeTable(
  tileBits: readonly (readonly boolean[])[],
  database: GowinAttributeDatabase,
  ttyp: number,
  table: string,
  family: GowinAttributeFamily,
): Map<string, number> {
  return decodeAttributeTableDetailed(tileBits, database, ttyp, table, family).attributes
}

/**
 * The same decode, plus which of its answers the BITS actually determined.
 *
 * The algorithm keeps the last matching row, so when two rows write the same attribute with different values the
 * winner is decided by the order the table happens to be in — not by anything in the bitstream. That is true of
 * the reference implementation too, so it cannot be "fixed" without diverging from the only oracle available;
 * what it can be is REPORTED, so a caller can tell a value the bits pin down from one that fell out of table
 * order. Shuffling the rows of a real device's tables changes an answer in more than half of them, and until
 * now nothing said which half.
 *
 * `ambiguous` names the attributes that were written more than once with disagreeing values. Everything not
 * listed is stable however the table is ordered.
 */
export function decodeAttributeTableDetailed(
  tileBits: readonly (readonly boolean[])[],
  database: GowinAttributeDatabase,
  ttyp: number,
  table: string,
  family: GowinAttributeFamily,
): { attributes: Map<string, number>; ambiguous: Set<string> } {
  const result = new Map<string, number>()
  const seen = new Map<string, Set<number>>()
  const ambiguous = new Set<string>()
  const rows = database.tables.get(ttyp)?.get(table)
  const indexToPair = database.logicinfo.get(family.logicClass)
  const names = database.families.get(family.family)
  if (rows === undefined || indexToPair === undefined || names === undefined)
    return { attributes: result, ambiguous }

  const negativeKey = (key: readonly number[]): boolean => key.some((k) => k < 0)
  const positives = (key: readonly number[]): number[] => key.filter((k) => k > 0)
  const negatives = (key: readonly number[]): number[] =>
    key.filter((k) => k < 0).map((k) => Math.abs(k))

  const programmedAt = (bit: string): boolean => {
    const comma = bit.indexOf(',')
    const row = Number(bit.slice(0, comma))
    const col = Number(bit.slice(comma + 1))
    return (tileBits[row] as readonly boolean[] | undefined)?.[col] === true
  }
  const setBits = new Set<string>()
  const negBits = new Set<string>()
  for (const row of rows)
    for (const bit of row.bits) {
      if (!programmedAt(bit)) continue
      if (negativeKey(row.key)) negBits.add(bit)
      else setBits.add(bit)
    }

  const nameOf = (attributeId: number): string => names.attributes.get(attributeId) ?? ''
  const record = (index: number): void => {
    const pair = indexToPair.get(index)
    if (pair === undefined) return
    const attribute = nameOf(pair[0])
    const values = seen.get(attribute) ?? new Set<number>()
    values.add(pair[1])
    seen.set(attribute, values)
    if (values.size > 1) ambiguous.add(attribute)
    result.set(attribute, pair[1])
  }

  const matched = rows.filter((r) => !negativeKey(r.key) && r.bits.every((b) => setBits.has(b)))
  const used = new Set<number>()
  for (const row of matched) {
    if (matched.some((other) => isStrictSubset(row.bits, other.bits))) continue
    for (const index of positives(row.key)) {
      used.add(index)
      record(index)
    }
  }

  const negMatched = rows.filter((r) => negativeKey(r.key) && r.bits.every((b) => negBits.has(b)))
  const carried = new Set<number>()
  const ignored = new Set<number>()
  for (const row of negMatched) {
    if (negMatched.some((other) => isStrictSubset(row.bits, other.bits))) continue
    // Upstream has a second rejection here — "skip this row if one of its attributes is already set" — and it
    // CANNOT FIRE: it compares a numeric attribute code against a dictionary keyed by attribute NAMES, so the
    // test is always false. Transcribing it as a working check (comparing name to name, which is the obvious
    // reading) made this pass reject rows the reference keeps, and cost 97 of 520 I/O tables their `PADDI` and
    // the right `IO_TYPE`. The reference is the oracle, so its behaviour is what we reproduce — deliberately,
    // and said out loud, rather than by quietly writing the same no-op.
    for (const index of positives(row.key)) carried.add(index)
    for (const index of negatives(row.key)) ignored.add(index)
  }
  for (const index of carried) record(index)

  for (const row of rows) {
    if (!negativeKey(row.key) || row.bits.every((b) => negBits.has(b))) continue
    const wanted = positives(row.key)
    const keep = negatives(row.key).every(
      (index) => !ignored.has(index) && wanted.every((w) => used.has(w)),
    )
    if (!keep) continue
    for (const index of negatives(row.key)) record(index)
  }
  return { attributes: result, ambiguous }
}

/** Turn a raw attribute value into its name, or null when the family does not name it. */
export function gowinValueName(
  database: GowinAttributeDatabase,
  family: string,
  value: number,
): string | null {
  return database.families.get(family)?.values.get(value) ?? null
}

/**
 * Which logic cells in a tile are configured as CARRY (arithmetic) rather than as plain lookup tables.
 *
 * A Gowin logic cell does not have a separate adder — the same slice switches into an arithmetic mode, which
 * shows up as `MODE = ALU` in the cell-pair table. Apicula uses exactly this test before emitting an ALU.
 *
 * Returns the indices 0..5 of the cells in carry mode; empty when the tile has no logic-cell tables.
 */
export function decodeGowinCarryCells(
  tileBits: readonly (readonly boolean[])[],
  database: GowinAttributeDatabase,
  ttyp: number,
): number[] {
  const carry: number[] = []
  if (!database.tables.get(ttyp)?.has('CLS0')) return carry
  for (let index = 0; index < 6; index++) {
    const attributes = decodeAttributeTable(
      tileBits,
      database,
      ttyp,
      `CLS${Math.floor(index / 2)}`,
      GOWIN_SLICE_FAMILY,
    )
    const mode = attributes.get('MODE')
    if (mode !== undefined && gowinValueName(database, 'cls', mode) === 'ALU') carry.push(index)
  }
  return carry
}

/** One I/O buffer's decoded settings. */
export type GowinIoBuffer = {
  /** the buffer's letter within the tile: `A`, `B`, ... */
  name: string
  /** decoded attributes, raw values as Apicula returns them. */
  attributes: Map<string, number>
}

/** The I/O buffer letters a tile type can hold. */
const IO_BUFFERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const

/**
 * Decode the I/O buffers in a tile.
 *
 * I/O differs from logic in where its tables live — `longval`, not `shortval` — and in having one table per
 * buffer (`IOBA`, `IOBB`, ...) rather than one per pair of cells. Only buffers the tile type actually defines
 * are returned, so an interior tile yields nothing rather than ten empty buffers.
 */
export function decodeGowinIoBuffers(
  tileBits: readonly (readonly boolean[])[],
  database: GowinAttributeDatabase,
  ttyp: number,
): GowinIoBuffer[] {
  const tables = database.tables.get(ttyp)
  if (tables === undefined) return []
  const buffers: GowinIoBuffer[] = []
  for (const letter of IO_BUFFERS) {
    if (!tables.has(`IOB${letter}`)) continue
    const attributes = decodeAttributeTable(
      tileBits,
      database,
      ttyp,
      `IOB${letter}`,
      GOWIN_IOB_FAMILY,
    )
    if (attributes.size === 0) continue
    buffers.push({ name: letter, attributes })
  }
  return buffers
}

/**
 * Decode a block-memory tile's configuration.
 *
 * The four tables (`BSRAM_SP` / `BSRAM_DP` / `BSRAM_SDP` / `BSRAM_ROM`) look like one per wiring mode, but they
 * do NOT distinguish one: on the tile type this fabric uses they cover byte-identical bit coordinates, so every
 * mode decodes non-empty for a memory that is only ever one of them. Keying the result by mode therefore told a
 * caller the design contained a ROM, a dual-port and a semi-dual-port RAM that do not exist.
 *
 * So the settings are returned as ONE map. Which wiring mode a memory is in has to come from elsewhere — the
 * reference decoder names the cell mode-lessly too — and claiming it from these tables is not possible.
 *
 * Checked against a real bitstream: a 1024x8 memory, which the toolchain infers into a genuine block RAM. The
 * decode finds it at exactly the three tiles Apicula does (one main tile plus two auxiliaries), reports nothing
 * in the two designs that use no memory, and recovers a data width matching the NINE-bit primitive the toolchain
 * actually built rather than the eight-bit array the source declared.
 */
export function decodeGowinBlockMemory(
  tileBits: readonly (readonly boolean[])[],
  database: GowinAttributeDatabase,
  ttyp: number,
): Map<string, number> {
  const out = new Map<string, number>()
  const tables = database.tables.get(ttyp)
  if (tables === undefined) return out
  for (const mode of ['SP', 'DP', 'SDP', 'ROM']) {
    const table = `BSRAM_${mode}`
    if (!tables.has(table)) continue
    for (const [name, value] of decodeAttributeTable(
      tileBits,
      database,
      ttyp,
      table,
      GOWIN_BSRAM_FAMILY,
    ))
      out.set(name, value)
  }
  return out
}
