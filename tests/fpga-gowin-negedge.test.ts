/**
 * FPGA fabric — Gowin: telling a FALLING-EDGE flip-flop from a genuine LATCH, and clocking it on the right edge.
 *
 * THE DEFECT THIS PINS. The chipdb gives ONE physical fuse three different meanings depending on the register's
 * mode. For GW1N-1 tile type 12, CLS0, five rows of the `CLS0` shortval table matter:
 *
 *     REGMODE=FF    & CLKMUX_CLK=INV   ->  (22,3)
 *     REGMODE=FF    & CLKMUX_1=0       ->  (22,3)
 *     REGMODE=LATCH & CLKMUX_1=1       ->  (22,3)
 *     REGMODE=LATCH & CLKMUX_CLK=SIG   ->  (22,3)
 *     REGMODE=LATCH                    ->  (22,5)
 *
 * `parse_attrvals` keeps every MAXIMAL match and all four (22,3) rows are one bit long, so none is a strict
 * subset of another: when (22,3) is programmed all four match and the last in insertion order wins. That is
 * `REGMODE=LATCH, CLKMUX_CLK=SIG`, always. Every one of the eight negative-edge variants therefore read back as
 * a latch — and two of them (`DFFNR`, `DFFNS`) as NOTHING AT ALL, because a synchronous set/reset has no latch
 * equivalent, which deleted them from the recovered netlist. Upstream Apicula has the identical defect.
 *
 * WHERE THE EXPECTED VALUES COME FROM. Not from Apicula, which is wrong here, and not from this decoder. Each of
 * the sixteen entries in `gowin-gw1n1-regvariants.json` is a bitstream built by the real vendor-format toolchain
 * — yosys `synth_gowin` -> `nextpnr-himbaechel --device GW1N-LV1QN48C6/I5` -> `gowin_pack -d GW1N-1` — from a
 * module that instantiates ONE Gowin register primitive by name:
 *
 *     module top(input clk, input d, input ctrl, output q);
 *       DFFNC inst (.Q(q), .CLK(clk), .D(d), .CLEAR(ctrl));
 *     endmodule
 *
 * `gowin_pack` was then INSTRUMENTED (its `place_dff` monkey-patched) to record which cell index it placed the
 * register at, the flip-flop mode it wrote, and its own `is_latch` flag. Those three are stored alongside the
 * tile's programmed bits, so the fixture carries the packer's own account of what it built, not an inference
 * from the bits. `primitive` is what the Verilog asked for; `packer_mode` + `packer_is_latch` is what the packer
 * says it emitted; the two agree by construction and are cross-checked below.
 *
 * `gowin-gw1n1-mixedreg.fs` is a seventeenth build — a whole real bitstream rather than an excerpt — holding a
 * plain flip-flop, a falling-edge flip-flop, a latch and a falling-edge latch at once:
 *
 *     module top(input clk, input d, input ctrl, output [5:0] q);
 *       DFF i0(...); DFFN i1(...); DL i2(...); DLN i3(...); DFFNC i4(...); DLNC i5(...);
 *     endmodule
 *
 * It matters because the sixteen single-primitive builds all land in `CLS0`, and this one does not: its usable
 * registers land in `CLS1` and `CLS2`, whose latch fuse sits at (22,26) and (22,37) rather than CLS0's (22,5).
 * A decoder that wrote the coordinate down instead of looking it up by attribute name would pass every one of
 * the sixteen and fail here.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseGowinAttributeDatabase } from '../src/renderer/fpga-apicula-attributes.ts'
import {
  DFF_TYPES,
  decodeGowinFlipFlops,
  extractGowinTileBits,
  type GowinChipdb,
  gowinTileAt,
  isGowinLatch,
  parseGowinChipdb,
} from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'
import {
  GOWIN_FALLING_EDGE,
  GOWIN_LATCH_KINDS,
  gowinFixedAliases,
  parseGowinWireAliases,
  reconstructGowinNetlist,
} from '../src/renderer/fpga-apicula-netlist.ts'
import { parseGowinPipDatabase } from '../src/renderer/fpga-apicula-routing.ts'

const at = (name: string): URL => new URL(`../fixtures/${name}`, import.meta.url)
const db: GowinChipdb = parseGowinChipdb(readFileSync(at('gowin-gw1n1-chipdb.json'), 'utf8'))

type RegisterVariant = {
  /** the primitive the Verilog instantiated. */
  primitive: string
  ttyp: number
  /** the cell index `gowin_pack` placed it at, from the instrumented run. */
  index: number
  /** the flip-flop mode the packer wrote, and its own latch flag — a latch is `DFF`/`DFFN`/... plus `is_latch`. */
  packer_mode: string
  packer_is_latch: boolean
  /** every programmed bit of the tile the register landed in. */
  bits: number[][]
}
const VARIANTS: RegisterVariant[] = JSON.parse(
  readFileSync(at('gowin-gw1n1-regvariants.json'), 'utf8'),
)

const tileOf = (variant: RegisterVariant): boolean[][] => {
  const shape = db.tileTypes.get(variant.ttyp) as { width: number; height: number }
  const grid = Array.from({ length: shape.height }, () =>
    new Array<boolean>(shape.width).fill(false),
  )
  for (const [row, col] of variant.bits) (grid[row as number] as boolean[])[col as number] = true
  return grid
}

describe('every register primitive the vendor toolchain can build decodes back to itself', () => {
  test('the fixture really holds all sixteen, from real packer runs', () => {
    expect(VARIANTS.map((v) => v.primitive).sort()).toEqual(
      [
        'DFF',
        'DFFC',
        'DFFN',
        'DFFNC',
        'DFFNP',
        'DFFNR',
        'DFFNS',
        'DFFP',
        'DFFR',
        'DFFS',
        'DL',
        'DLC',
        'DLN',
        'DLNC',
        'DLNP',
        'DLP',
      ].sort(),
    )
    // The packer's own account has to agree with the Verilog, or the fixture is describing a different build:
    // a latch is written as the FF-equivalent mode plus `is_latch`, so `DLNC` is `DFFNC` + latch.
    for (const v of VARIANTS) {
      expect(v.packer_is_latch, v.primitive).toBe(v.primitive.startsWith('DL'))
      const equivalent = v.packer_is_latch ? v.primitive.replace(/^DL/, 'DFF') : v.primitive
      expect(v.packer_mode, v.primitive).toBe(equivalent)
    }
  })

  for (const variant of VARIANTS) {
    test(`${variant.primitive} decodes as ${variant.primitive}`, () => {
      const decoded = decodeGowinFlipFlops(tileOf(variant), db, variant.ttyp)
      expect(decoded.get(`DFF${variant.index}`)).toBe(variant.primitive)
    })
  }

  test('the eight negative-edge builds are the ones that used to be wrong', () => {
    // Names the regression precisely rather than only asserting the fixed state. Under the old decode every
    // primitive with an inverted clock read back as a latch — `DFFN` as `DL`, `DLN` as `DL` — and `DFFNR`/`DFFNS`
    // as null, vanishing from the netlist entirely. If a future change reintroduces that, the loop above fails;
    // this states which eight it would be.
    const inverted = VARIANTS.filter((v) => /^D(FFN|LN)/.test(v.primitive))
    expect(inverted.map((v) => v.primitive).sort()).toEqual([
      'DFFN',
      'DFFNC',
      'DFFNP',
      'DFFNR',
      'DFFNS',
      'DLN',
      'DLNC',
      'DLNP',
    ])
  })

  test('a latch and its falling-edge flip-flop twin differ by exactly ONE fuse', () => {
    // The crux, stated as data: `DL` is `DFFN` plus the latch fuse. That one bit is the entire difference, which
    // is why the maximal-match attribute decode cannot see it and why a rule that ignored it would rename every
    // genuine latch after a flip-flop.
    const bitsOf = (name: string): Set<string> =>
      new Set(
        (VARIANTS.find((v) => v.primitive === name) as RegisterVariant).bits.map((b) =>
          b.join(','),
        ),
      )
    const latch = bitsOf('DL')
    const negedge = bitsOf('DFFN')
    expect([...negedge].every((b) => latch.has(b))).toBe(true)
    expect([...latch].filter((b) => !negedge.has(b))).toEqual(['22,5'])
  })
})

/**
 * The mixed bitstream: three CLS tables, three different latch-fuse coordinates, one file.
 *
 * The expected kinds are the primitives named in the Verilog, cross-checked against the instrumented packer's
 * placement record. `R9C8 DFF0`/`DFF1` are deliberately ABSENT: nextpnr put a `DLNC` and a `DFFNC` in the same
 * CLS pair, and `gowin_pack` keys its attribute dictionary on the pair, so the second write overwrote `REGMODE`
 * and the packed bitstream says FF for both. The latch was lost by the PACKER before any decoding — no reader
 * can recover it — so it is excluded rather than pretended about.
 */
const mixed = parseGowinBitstream(readFileSync(at('gowin-gw1n1-mixedreg.fs'), 'utf8')).frames

/** tile row, tile col, cell index, the primitive the Verilog asked for. */
const MIXED_TRUTH: [number, number, number, string][] = [
  [9, 5, 2, 'DFF'],
  [9, 6, 5, 'DFFN'],
  [9, 8, 2, 'DL'],
  [9, 8, 4, 'DLN'],
]

describe('a REAL bitstream holding latches and falling-edge flip-flops at once', () => {
  const decodedAt = (row: number, col: number): Map<string, string | null> => {
    const tile = gowinTileAt(db, row, col) as { ttyp: number }
    return decodeGowinFlipFlops(
      extractGowinTileBits(mixed, db, row, col) as boolean[][],
      db,
      tile.ttyp,
    )
  }

  for (const [row, col, index, primitive] of MIXED_TRUTH) {
    test(`R${row}C${col} DFF${index} is the ${primitive} the Verilog asked for`, () => {
      expect(decodedAt(row, col).get(`DFF${index}`)).toBe(primitive)
    })
  }

  test('the two genuine latches sit in DIFFERENT CLS tables, and one shares a table with a DFFN', () => {
    // Without this the file could pass while proving only what a single-table fixture proves: `DL` is read out
    // of one CLS table and `DLN` out of another — two different latch-fuse coordinates — and the second table
    // also has to separate that `DLN` from a `DFFN`, which is the pair the old decode collapsed.
    //
    // This used to compute entirely over the hand-written expectations table, never touching the bitstream or
    // the decoder, so it passed unchanged against the PRE-FIX code. It now reads what the decoder actually
    // returns for each cell of the real fixture.
    const table = (index: number): number => Math.floor(index / 2)
    const tableOf = (name: string): number => {
      const hit = MIXED_TRUTH.find(
        ([row, col, index]) => decodedAt(row, col).get(`DFF${index}`) === name,
      )
      expect(hit, `the decoder returned no ${name}`).toBeDefined()
      return table((hit as [number, number, number, string])[2])
    }
    expect(tableOf('DL')).not.toBe(tableOf('DLN'))
    expect(tableOf('DLN')).toBe(tableOf('DFFN'))
  })

  test('the latch fuse sits at a DIFFERENT coordinate in each of those tables', () => {
    // The reason the rule looks the row up by attribute name. A written-down coordinate would decode one table
    // and mis-read the others; here the same tile type carries the latch fuse at three separate places.
    const tile = gowinTileAt(db, 9, 8) as { ttyp: number }
    const latchRowBits = (table: string): string => {
      const entries = db.clsFuses.get(tile.ttyp)?.get(table) ?? []
      for (const entry of entries) {
        if (entry.key.some((k) => k < 0)) continue
        const names = entry.key
          .filter((k) => k > 0)
          .map((k) => {
            const pair = db.logicinfoSlice.get(k) as readonly [number, number]
            return `${db.attributeNames.get(pair[0])}=${db.valueNames.get(pair[1])}`
          })
        if (names.length === 1 && names[0] === 'REGMODE=LATCH') return entry.bits.join(' ')
      }
      return ''
    }
    const coordinates = ['CLS0', 'CLS1', 'CLS2'].map(latchRowBits)
    expect(coordinates).toEqual(['22,5', '22,26', '22,37'])
    expect(new Set(coordinates).size).toBe(3)
  })

  test('a genuine latch is still REFUSED by the netlist, not simulated as a register', () => {
    // The other half of the risk: making falling-edge flip-flops decodable must not turn level-sensitive
    // hardware into edge-triggered hardware. A latch is transparent while enabled; the shared cell cannot say
    // that, so it stays refused.
    const pipdb = parseGowinPipDatabase(readFileSync(at('gowin-gw1n1-pips.json'), 'utf8'))
    const attributes = parseGowinAttributeDatabase(
      readFileSync(at('gowin-gw1n1-attributes.json'), 'utf8'),
    )
    const aliases = new Map([
      ...parseGowinWireAliases(readFileSync(at('gowin-gw1n1-nodes.json'), 'utf8')),
      ...gowinFixedAliases(db.rows, db.cols),
    ])
    const design = reconstructGowinNetlist(mixed, db, pipdb, attributes, aliases)
    const refusedLatches = design.unsupported.filter((u) => GOWIN_LATCH_KINDS.has(u.kind))
    expect(refusedLatches).toHaveLength(2)
    // and every refused latch really is one this bitstream contains
    for (const refused of refusedLatches) expect(isGowinLatch(refused.kind)).toBe(true)
    // A refused cell must not also appear in the netlist — that was a separate bug once.
    const present = new Set(design.netlist.cells.map((c) => `${c.ref.x}_${c.ref.y}_${c.ref.cell}`))
    for (const refused of refusedLatches)
      expect(present.has(`${refused.ref.x}_${refused.ref.y}_${refused.ref.cell}`)).toBe(false)
  })

  test('the falling-edge flip-flop SURVIVES and carries negClk', () => {
    const pipdb = parseGowinPipDatabase(readFileSync(at('gowin-gw1n1-pips.json'), 'utf8'))
    const attributes = parseGowinAttributeDatabase(
      readFileSync(at('gowin-gw1n1-attributes.json'), 'utf8'),
    )
    const aliases = new Map([
      ...parseGowinWireAliases(readFileSync(at('gowin-gw1n1-nodes.json'), 'utf8')),
      ...gowinFixedAliases(db.rows, db.cols),
    ])
    const design = reconstructGowinNetlist(mixed, db, pipdb, attributes, aliases)
    const negedge = design.cells.filter((c) => c.flipFlop === 'DFFN')
    expect(negedge).toHaveLength(1) // measured: exactly one cell decodes to plain DFFN (the others are DFFN* variants)
    for (const cell of negedge) {
      const recovered = design.netlist.cells.find(
        (r) => r.ref.x === cell.ref.x && r.ref.y === cell.ref.y && r.ref.cell === cell.ref.cell,
      )
      // It used to be deleted here, refused as a latch. Present AND on the falling edge is the whole fix.
      expect(recovered, `R${cell.row}C${cell.col} cell ${cell.ref.cell}`).toBeDefined()
      expect(recovered?.negClk).toBe(true)
    }
  })
})

/**
 * Two guards in the fuse lookup that NO REAL DEVICE EXERCISES, pinned on a synthetic one.
 *
 * The rule picks its rows out of `clsFuses` by attribute name. Two things could make it pick the wrong row:
 *
 *   1. a NEGATIVELY keyed row whose positive part happens to name `REGMODE=LATCH`. Those rows mean the opposite
 *      thing — a negative index says the value must be ERASED — so reading one as the latch row inverts it.
 *   2. a row carrying NO bits. `every` over an empty list is vacuously true, so an unguarded check would call it
 *      programmed and report every register in the device as a latch.
 *
 * Neither occurs in any device database Apicula ships: across GW1N-1/2/4/9/9C, GW1NS-4, GW1NZ-1, GW2A-18/18C,
 * GW5A-25A and GW5AST-138C there are 4524 `CLS*` fuse rows, 247 of them negatively keyed, and NONE of the 247
 * names one of the three rows this rule looks for, and NONE of the 4524 has an empty bit list. So mutating
 * either guard away leaves every real-bitstream test green — which is exactly the shape of an untested guard.
 * These two devices are built to contain the hostile rows, so the guards have something that kills them.
 */
const syntheticDevice = (tables: Record<string, Record<string, number[][]>>): string =>
  JSON.stringify({
    device: 'SYNTHETIC',
    idcode: '0',
    grid: [[1]],
    center_row: 1,
    center_col: 1,
    tiles: { 1: { width: 4, height: 1, bels: [], pips: 0 } },
    cmd_hdr: [],
    cmd_ftr: [],
    cls_fuses: { 1: tables },
    // index -> [attribute id, value id]
    logicinfo_slice: { 1: [10, 20], 2: [10, 21], 3: [11, 22], 4: [11, 23], 5: [12, 24] },
    cls_attrids: { REGMODE: 10, CLKMUX_CLK: 11, REG0_REGSET: 12 },
    cls_attrvals: { FF: 20, LATCH: 21, SIG: 22, INV: 23, RESET: 24 },
  })

/** `REGMODE=FF & CLKMUX_CLK=INV` (unprogrammed) and `REG0_REGSET=RESET` (programmed) — the shared tail. */
const COMMON_ROWS = { '1,4': [[0, 2]], '5': [[0, 3]] }

describe('fuse rows that must NOT be mistaken for the latch row', () => {
  test('a NEGATIVELY keyed row naming REGMODE=LATCH does not make the cell a latch', () => {
    // The negative row is listed BEFORE the real one and its bit IS programmed, so a lookup that failed to skip
    // it would find it first. The real `REGMODE=LATCH` row's bit is erased, so the honest answer is a plain
    // rising-edge flip-flop.
    //
    // The real row is keyed `2,0` rather than `2` on purpose. Both mean the same thing — index 0 is the padding
    // sentinel the real database uses, e.g. GW1N-1's own latch row is keyed `3,0` — but a JSON key of `"2"` is
    // integer-like, and JavaScript hoists integer-like object keys to the FRONT in numeric order. Written that
    // way the real row would be visited first whatever the lookup did, and this test would pass against a
    // decoder with the guard removed. It did, until the mutation run showed it.
    const db = parseGowinChipdb(
      syntheticDevice({ CLS0: { '-5,2': [[0, 0]], '2,0': [[0, 1]], ...COMMON_ROWS } }),
    )
    const bits = [[true, false, false, true]]
    expect(decodeGowinFlipFlops(bits, db, 1).get('DFF0')).toBe('DFF')
  })

  test('a REGMODE=LATCH row carrying no bits at all is not treated as programmed', () => {
    // Nothing was observed, so nothing may be concluded. Vacuous truth would read every cell as a latch.
    const db = parseGowinChipdb(syntheticDevice({ CLS0: { '2': [], ...COMMON_ROWS } }))
    const bits = [[false, false, false, true]]
    expect(decodeGowinFlipFlops(bits, db, 1).get('DFF0')).toBe('DFF')
  })

  test('the same synthetic device DOES report a latch when the real row is programmed', () => {
    // The positive control. Without it both tests above would pass on a decoder that never reports a latch.
    const db = parseGowinChipdb(
      syntheticDevice({ CLS0: { '-5,2': [[0, 0]], '2,0': [[0, 1]], ...COMMON_ROWS } }),
    )
    expect(decodeGowinFlipFlops([[false, true, false, true]], db, 1).get('DFF0')).toBe('DL')
  })
})

/**
 * The consumer half. Identifying a `DFFN` correctly is only an improvement if something downstream clocks it on
 * the falling edge — otherwise the cell goes from "deleted" to "simulated on the wrong edge", which is worse,
 * because it looks entirely ordinary.
 */
describe('the falling-edge family reaches the simulator as falling-edge', () => {
  const pipdb = parseGowinPipDatabase(readFileSync(at('gowin-gw1n1-pips.json'), 'utf8'))
  const attributes = parseGowinAttributeDatabase(
    readFileSync(at('gowin-gw1n1-attributes.json'), 'utf8'),
  )
  const aliases = new Map([
    ...parseGowinWireAliases(readFileSync(at('gowin-gw1n1-nodes.json'), 'utf8')),
    ...gowinFixedAliases(db.rows, db.cols),
  ])
  const variants = parseGowinBitstream(readFileSync(at('gowin-gw1n1-ffvariants.fs'), 'utf8')).frames

  test('GOWIN_FALLING_EDGE names exactly the `N` variants of the flip-flop table', () => {
    // The two tables are declared separately, so they can drift. Every flip-flop whose name says it clocks on
    // the falling edge must be in the set, and nothing else may be.
    const inverted = [...DFF_TYPES.values()].filter((name) => name.startsWith('DFFN'))
    expect(inverted.sort()).toEqual(['DFFN', 'DFFNC', 'DFFNP', 'DFFNR', 'DFFNS'])
    expect([...GOWIN_FALLING_EDGE].sort()).toEqual(inverted.sort())
    for (const name of DFF_TYPES.values())
      expect(GOWIN_FALLING_EDGE.has(name), name).toBe(name.startsWith('DFFN'))
  })

  test('the ffvariants design recovers its falling-edge register instead of deleting it', () => {
    // MEASURED BEFORE THE FIX: this design recovered 3 cells and deleted 1 of them, refusing it as a latch it is
    // not. The fuse evidence is direct — at R9C5 the `REGMODE=LATCH` row's bit is programmed in NO CLS table of
    // that tile, so there is no latch there to refuse.
    const design = reconstructGowinNetlist(variants, db, pipdb, attributes, aliases)
    expect(design.unsupported.filter((u) => GOWIN_LATCH_KINDS.has(u.kind))).toEqual([])
    const negedge = design.netlist.cells.filter((c) => c.negClk === true)
    expect(negedge).toHaveLength(1) // measured; the whole point is that this used to be one lower
    for (const cell of negedge) expect(cell.config.dffEnable).toBe(true)
  })

  test('the rising-edge registers in the same design are NOT marked falling', () => {
    // The negative half. A consumer that set `negClk` on every register would pass the test above.
    const design = reconstructGowinNetlist(variants, db, pipdb, attributes, aliases)
    const byRef = new Map(
      design.cells.map((c) => [`${c.ref.x}_${c.ref.y}_${c.ref.cell}`, c.flipFlop]),
    )
    let rising = 0
    for (const cell of design.netlist.cells) {
      const kind = byRef.get(`${cell.ref.x}_${cell.ref.y}_${cell.ref.cell}`) ?? ''
      expect(cell.negClk, kind).toBe(kind.startsWith('DFFN'))
      if (cell.negClk === false) rising++
    }
    expect(rising).toBeGreaterThan(0)
  })

  test('an unclocked cell is never marked falling-edge', () => {
    let checked = 0
    // `flipFlop` is null when no clock is routed, and `negClk` must follow — a combinational cell claiming a
    // clock edge would make the two-phase partition act on cells that hold nothing.
    //
    // This assertion USED to sit inside `if (!cell.config.dffEnable)` over two designs in which every recovered
    // cell is clocked, so it executed zero times and passed whatever the decoder did. It now counts what it
    // checked and requires that to be non-zero, which is the only thing that makes the loop mean anything.
    // bram1k is used because it is the ONLY fixture that RECOVERS combinational cells (9 of its 18); the two
    // designs this used to loop over recover none at all, which is why the assertion never ran.
    for (const file of ['gowin-gw1n1-bram1k.fs', 'gowin-gw1n1-xnor-dff.fs']) {
      const design = reconstructGowinNetlist(
        parseGowinBitstream(readFileSync(at(file), 'utf8')).frames,
        db,
        pipdb,
        attributes,
        aliases,
      )
      for (const cell of design.netlist.cells)
        if (!cell.config.dffEnable) {
          expect(cell.negClk, file).toBe(false)
          checked++
        }
    }
    expect(checked, 'no unclocked cell was actually examined').toBeGreaterThan(0)
  })
})

describe('the guards inside the fuse rule, one at a time', () => {
  // A rule with several conditions can have all but one covered and still look proved, so each is taken alone.
  //
  // MEASURED, and stated because it would otherwise be assumed: of the four conditions in the rule, only two
  // are actually reachable on this device. Mutating the latch-mode polarity fails 9 tests and disabling the
  // rule outright fails 24, so those two are pinned. The null-row check and the all-bits check are NOT — both
  // mutate green, because every fuse row consulted on GW1N-1 exists and is one bit long. The tests below are
  // worth having on their own merits; they are not evidence for those two conditions.
  const pipdb = parseGowinPipDatabase(readFileSync(at('gowin-gw1n1-pips.json'), 'utf8'))
  const attributes = parseGowinAttributeDatabase(
    readFileSync(at('gowin-gw1n1-attributes.json'), 'utf8'),
  )
  const aliases = new Map([
    ...parseGowinWireAliases(readFileSync(at('gowin-gw1n1-nodes.json'), 'utf8')),
    ...gowinFixedAliases(db.rows, db.cols),
  ])

  test('an ERASED tile decodes to no latches and no falling-edge registers', () => {
    // A blank part is the one input whose correct answer is known without any oracle at all: nothing is
    // configured, so nothing may be reported. A rule that read unprogrammed fuses as set would fill a blank
    // device with registers, which is how a related ECP5 defect (51,896 phantom arcs) was found.
    const blank = parseGowinBitstream(
      readFileSync(at('gowin-gw1n1-xnor-dff.fs'), 'utf8'),
    ).frames.map((row) => row.map(() => false))
    const design = reconstructGowinNetlist(blank, db, pipdb, attributes, aliases)
    expect(design.netlist.cells).toEqual([])
    expect(design.cells.filter((c) => c.flipFlop !== null)).toEqual([])
  })

  test('a latch and a falling-edge register are told apart in the SAME tile type', () => {
    // Both kinds come out of ONE real bitstream, so a rule that collapsed them would have to get one of the two
    // wrong — which is exactly what the old decode did, calling every falling-edge register a latch.
    const decodeAt = (row: number, col: number): Map<string, string | null> => {
      const tile = gowinTileAt(db, row, col) as { ttyp: number }
      return decodeGowinFlipFlops(
        extractGowinTileBits(mixed, db, row, col) as boolean[][],
        db,
        tile.ttyp,
      )
    }
    const kinds = new Set(
      MIXED_TRUTH.map(([row, col, index]) => decodeAt(row, col).get(`DFF${index}`)),
    )
    expect(kinds.has('DFFN')).toBe(true)
    expect([...kinds].some((k) => k?.startsWith('DL'))).toBe(true)
  })
})

describe('HONEST GAP — the falling-edge flag is set, but no Gowin fixture can show it working', () => {
  test('no Gowin fixture contains a cell-to-cell link at all, so no design here crosses a clock edge', () => {
    // Everything above pins the LABEL. Pinning the BEHAVIOUR would need a design where a signal crosses from a
    // rising-edge register to a falling-edge one — that crossing is the entire observable effect of the flag.
    //
    // MEASURED: neither fixture has ANY cell-to-cell link. ffvariants recovers 3 cells and mixedreg 4, and every
    // input of every one of them is a primary or unused. So the flag provably CANNOT change a simulated value
    // in these designs, and a test asserting it did would be asserting something false.
    //
    // The two-phase semantics ARE pinned, on the iCE40 side, against the vendor toolchain — see
    // tests/fpga-icebox-twophase.test.ts and tests/fpga-icebox-negclk.test.ts. What is NOT demonstrated is that
    // the Gowin path reaches them on a real Gowin design. This assertion flips the day a Gowin fixture with a
    // register-to-register path lands, which also needs the separate defect where cross-tile register links
    // dead-end into phantom primary inputs.
    const pipdb = parseGowinPipDatabase(readFileSync(at('gowin-gw1n1-pips.json'), 'utf8'))
    const attributes = parseGowinAttributeDatabase(
      readFileSync(at('gowin-gw1n1-attributes.json'), 'utf8'),
    )
    const aliases = new Map([
      ...parseGowinWireAliases(readFileSync(at('gowin-gw1n1-nodes.json'), 'utf8')),
      ...gowinFixedAliases(db.rows, db.cols),
    ])
    for (const file of ['gowin-gw1n1-ffvariants.fs', 'gowin-gw1n1-mixedreg.fs']) {
      const frames = parseGowinBitstream(readFileSync(at(file), 'utf8')).frames
      const design = reconstructGowinNetlist(frames, db, pipdb, attributes, aliases)
      expect(design.netlist.cells.length, file).toBeGreaterThan(0)
      const links = design.netlist.cells.flatMap((c) => c.inputs.filter((i) => i.kind === 'cell'))
      expect(
        links,
        `${file} now HAS cell-to-cell links - pin the waveform instead of this gap`,
      ).toEqual([])
    }
  })
})
