/**
 * FPGA fabric — Lattice Nexus: reading FASM, checked against BOTH views of one real design.
 *
 * The fixtures are a genuine flow: a XNOR feeding a flip-flop, synthesised, routed, and packed into a real
 * bitstream. Two FASM files come out of that — what the router ASKED for, and what the packer's own reader gets
 * back OUT of the finished bitstream. Agreeing with both is a stronger check than either alone.
 *
 * The design is deliberately the same one used for the Gowin family, so the two are comparable.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  type NexusFasm,
  nexusAssignmentsNamed,
  nexusFeaturesNamed,
  nexusTilesOfType,
  parseNexusFasm,
} from '../src/renderer/fpga-oxide-fasm.ts'

const read = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

/** What nextpnr asked the packer to build. */
const requested: NexusFasm = parseNexusFasm(read('nexus-lifcl40-xnor-dff.fasm'))
/** What prjoxide reads back out of the packed bitstream. */
const readBack: NexusFasm = parseNexusFasm(read('nexus-lifcl40-xnor-dff-unpacked.fasm'))

describe('parseNexusFasm — design attributes', () => {
  test('both views name the same device and variant', () => {
    expect(requested.device).toBe('LIFCL-40')
    expect(readBack.device).toBe('LIFCL-40')
    expect(requested.attributes.get('oxide.device_variant')).toBe('ES')
    expect(readBack.attributes.get('oxide.device_variant')).toBe('ES')
  })
})

describe('parseNexusFasm — tiles carry their own coordinates', () => {
  test('a plain logic tile parses name, position and type', () => {
    const tile = requested.tiles.get('R5C2__PLC')
    expect(tile).toBeDefined()
    expect([tile?.row, tile?.col, tile?.type]).toEqual([5, 2, 'PLC'])
  })

  test('a prefixed tile keeps its prefix out of the coordinates', () => {
    // `CIB_R29C13__SPINE_L1` is row 29 column 13 - the region prefix must not be read as part of the position.
    const tile = requested.tiles.get('CIB_R29C13__SPINE_L1')
    expect(tile).toBeDefined()
    expect([tile?.row, tile?.col, tile?.type]).toEqual([29, 13, 'SPINE_L1'])
  })

  test('a tile whose prefix itself contains R and C digits is still read correctly', () => {
    // `TAP_PLC_R5C14__TAP_PLC` - the type name contains letters that look like coordinates. Taking the FIRST
    // match rather than the last would place this tile somewhere else entirely.
    const tile = requested.tiles.get('TAP_PLC_R5C14__TAP_PLC')
    expect(tile).toBeDefined()
    expect([tile?.row, tile?.col, tile?.type]).toEqual([5, 14, 'TAP_PLC'])
  })

  test('the design occupies many tiles of several types', () => {
    expect(requested.tiles.size).toBeGreaterThan(10)
    expect(nexusTilesOfType(requested, 'PLC').length).toBeGreaterThan(0)
  })
})

describe('parseNexusFasm — routing and configuration are told apart', () => {
  test('routing arcs record what drives what', () => {
    const tile = requested.tiles.get('R5C2__PLC')
    const arc = tile?.pips.find((p) => p.source === 'JQ0')
    expect(arc).toBeDefined()
    expect(arc?.destination).toBe('S3__V06S0003')
  })

  test('the router’s view is mostly routing; the bitstream’s view is mostly configuration', () => {
    // A real difference between the two files, worth pinning: nextpnr writes the arcs it chose, while the
    // packed bitstream also carries every default a real chip must have set.
    const requestedPips = [...requested.tiles.values()].reduce((n, t) => n + t.pips.length, 0)
    const readBackFeatures = [...readBack.tiles.values()].reduce((n, t) => n + t.features.length, 0)
    expect(requestedPips).toBeGreaterThan(0)
    expect(readBackFeatures).toBeGreaterThan(requestedPips)
  })

  test('a configuration setting splits into a path and a value', () => {
    const io = readBack.tiles.get('CIB_R0C76__SYSIO_B0_0_ODD')
    expect(io).toBeDefined()
    const base = io?.features.find((f) => f.path === 'PIOA.BASE_TYPE')
    expect(base?.value).toBe('INPUT_LVCMOS33')
  })
})

describe('the bitstream really contains the design we asked for', () => {
  test('the I/O standard matches what the flow defaulted to', () => {
    // The constraint file named pins but no signalling standard, so the tools chose LVCMOS33 - and that is what
    // the packed bitstream reads back as. A decoder that mis-parsed the value would not land on it.
    const types = nexusFeaturesNamed(readBack, 'BASE_TYPE').map((f) => f.feature.value)
    expect(types).toContain('INPUT_LVCMOS33')
    expect(types.some((t) => t.startsWith('OUTPUT_'))).toBe(true)
  })

  test('both an input and an output buffer are configured, as a design with pins must have', () => {
    const types = new Set(nexusFeaturesNamed(readBack, 'BASE_TYPE').map((f) => f.feature.value))
    expect([...types].filter((t) => t.startsWith('INPUT_')).length).toBeGreaterThan(0)
    expect([...types].filter((t) => t.startsWith('OUTPUT_')).length).toBeGreaterThan(0)
  })
})

describe('parseNexusFasm — nothing is silently dropped', () => {
  test('every line of both real files is understood', () => {
    // A skipped line looks exactly like an understood one, so leftovers are collected rather than ignored. If
    // this ever fails, the format has a shape the parser does not know - which is worth finding out.
    expect(requested.unrecognised).toEqual([])
    expect(readBack.unrecognised).toEqual([])
  })

  test('a line with no tile name is kept, not discarded', () => {
    const parsed = parseNexusFasm('nonsense_without_coordinates.FOO.BAR\n')
    expect(parsed.unrecognised).toHaveLength(1)
    expect(parsed.tiles.size).toBe(0)
  })

  test('comments and blank lines are ignored without becoming leftovers', () => {
    const parsed = parseNexusFasm('# a comment\n\n   \nR1C1__PLC.PIP.A.B\n')
    expect(parsed.unrecognised).toEqual([])
    expect(parsed.tiles.size).toBe(1)
  })
})

describe('the two halves of the toolchain name tiles differently', () => {
  test('the router uses ONE underscore where the packer uses two', () => {
    // Not a guess: both forms appear in these real files, for the same kind of thing. Accepting only the
    // doubled form silently dropped 1492 of the router's lines - a third of the file - while every test above
    // still passed. The leftovers check is what caught it.
    const single = requested.tiles.get('R15C0_PIOA')
    expect(single).toBeDefined()
    expect([single?.row, single?.col, single?.type]).toEqual([15, 0, 'PIOA'])

    const double = readBack.tiles.get('CIB_R0C76__SYSIO_B0_0_ODD')
    expect(double).toBeDefined()
    expect(double?.type).toBe('SYSIO_B0_0_ODD')
  })

  test('so the router’s own view also carries the I/O configuration', () => {
    // Which it does - it was simply unreadable before. Both views now agree the design drives an output.
    const types = nexusFeaturesNamed(requested, 'BASE_TYPE').map((f) => f.feature.value)
    expect(types).toContain('OUTPUT_LVCMOS33')
    expect(types).toContain('INPUT_LVCMOS33')
  })
})

describe('device-wide settings', () => {
  test('bank supply voltages are recorded, not filed under a tile', () => {
    // `GLOBAL.BANK0.VCC.3V3` has no coordinates - it describes the whole chip. Forcing it into a tile would
    // invent a location for it.
    const banks = requested.globals.filter((g) => g.path.startsWith('BANK'))
    expect(banks.length).toBeGreaterThan(0)
    expect(banks.some((b) => b.value === '3V3')).toBe(true)
  })

  test('and a genuinely unparseable line is still a leftover', () => {
    // The globals rule must not become a catch-all that hides malformed input.
    expect(parseNexusFasm('nonsense_without_coordinates.FOO.BAR\n').unrecognised).toHaveLength(1)
  })
})

/**
 * Wide assignments — and a mis-parse the leftovers check could NOT catch.
 *
 * A lookup table's truth table is written as `SLICEA.K0.INIT[15:0] = 16'b1111000000001111`: an `=` and a
 * Verilog literal, not a dotted value. Read as a plain setting it parses happily, producing a path of
 * `SLICEA.K0` and a "value" of the entire `INIT[15:0] = 16'b...` tail — no leftover, no complaint, and the
 * number thrown away. That is the limit of the leftovers check: it finds lines that fit NO shape, not lines
 * that fit the WRONG one. This one was found by going looking for the design's logic and not finding it.
 */
describe('wide assignments carry the actual logic', () => {
  test('the truth table is read as a number, not swallowed as text', () => {
    const inits = nexusAssignmentsNamed(requested, 'INIT')
    expect(inits.length).toBeGreaterThan(0)
    const first = inits[0]?.assignment
    expect(first?.path).toMatch(/INIT$/)
    expect([first?.high, first?.low, first?.width]).toEqual([15, 0, 16])
  })

  test('THE PAYOFF — the recovered truth table really is exclusive-NOR', () => {
    // The source was `q <= (a & b) | (~a & ~b)`. The router placed it on inputs 2 and 3 of a four-input cell,
    // giving 0xF00F: entry i is 1 exactly when those two inputs agree. Nothing in the parser was told what the
    // design does - this is the number the real toolchain wrote into a real bitstream.
    const inits = nexusAssignmentsNamed(requested, 'INIT').filter((i) => i.assignment.width === 16)
    expect(inits).toHaveLength(1)
    const truth = (inits[0] as { assignment: { value: number } }).assignment.value
    expect(truth).toBe(0xf00f)
    for (let entry = 0; entry < 16; entry++) {
      const agree = ((entry >> 2) & 1) === ((entry >> 3) & 1)
      expect(((truth >> entry) & 1) === 1, `entry ${entry}`).toBe(agree)
    }
  })

  test('it is XNOR of TWO inputs, and the other two are ignored', () => {
    // Confirms which inputs matter, rather than assuming: the output must not change with inputs 0 or 1.
    const truth = (nexusAssignmentsNamed(requested, 'INIT')[0] as { assignment: { value: number } })
      .assignment.value
    const dependsOn = (pin: number): boolean => {
      for (let entry = 0; entry < 16; entry++)
        if (
          ((entry >> pin) & 1) === 0 &&
          ((truth >> entry) & 1) !== ((truth >> (entry | (1 << pin))) & 1)
        )
          return true
      return false
    }
    expect([dependsOn(0), dependsOn(1), dependsOn(2), dependsOn(3)]).toEqual([
      false,
      false,
      true,
      true,
    ])
  })

  test('the flip-flop the design asked for is configured in the same slice', () => {
    // `always @(posedge clk)` - so the slice holding the logic must have its register switched on.
    const slice = requested.tiles.get('R5C2__PLC')
    expect(slice?.features.some((f) => f.path === 'SLICEA.REG0.USED' && f.value === 'YES')).toBe(
      true,
    )
    expect(slice?.features.some((f) => f.path === 'SLICEA.CLKMUX' && f.value === 'CLK')).toBe(true)
  })

  test('a plain setting is still not mistaken for an assignment', () => {
    const parsed = parseNexusFasm(
      "R1C1__PLC.SLICEA.CLKMUX.CLK\nR1C1__PLC.SLICEA.K0.INIT[3:0] = 4'b1010\n",
    )
    const tile = parsed.tiles.get('R1C1__PLC')
    expect(tile?.features.map((f) => [f.path, f.value])).toEqual([['SLICEA.CLKMUX', 'CLK']])
    expect(tile?.assignments.map((a) => [a.path, a.value])).toEqual([['SLICEA.K0.INIT', 0b1010]])
    expect(parsed.unrecognised).toEqual([])
  })
})

/**
 * Cross-checking the two views against each other.
 *
 * This is what having a packer that reads its own output buys. One view is what the router ASKED for; the other
 * is what a genuine bitstream ACTUALLY contains, recovered by the vendor's own tool. Agreement between them
 * means the logic survived synthesis, placement, packing into a real binary, and being read back out - a much
 * stronger statement than either file alone supports.
 */
describe('what was asked for is what the bitstream contains', () => {
  test('every wide assignment the router requested is present in the bitstream, unchanged', () => {
    // Compare on the BITS, not the number: a memory's contents are wider than a number holds exactly, and
    // `value` is deliberately null there.
    const key = (t: { name: string }, a: { path: string; bits: boolean[]; high: number }): string =>
      `${t.name}.${a.path}[${a.high}]=${a.bits.map((b) => (b ? '1' : '0')).join('')}`
    const asked = new Set(
      [...requested.tiles.values()].flatMap((t) => t.assignments.map((a) => key(t, a))),
    )
    const got = new Set(
      [...readBack.tiles.values()].flatMap((t) => t.assignments.map((a) => key(t, a))),
    )
    expect(asked.size).toBeGreaterThan(0)
    for (const entry of asked) expect(got.has(entry), entry).toBe(true)
  })

  test('the truth table itself round-trips through a real binary', () => {
    // The strongest single claim available for this family: 0xF00F was written into an 808 KB bitstream and read
    // back out of it, in the same tile and the same slice.
    const inTile = (fasm: NexusFasm): { tile: string; value: number | null } | null => {
      for (const tile of fasm.tiles.values())
        for (const assignment of tile.assignments)
          if (assignment.path.endsWith('INIT') && assignment.width === 16)
            return { tile: tile.name, value: assignment.value }
      return null
    }
    const before = inTile(requested)
    const after = inTile(readBack)
    expect(before).toEqual(after)
    expect(after?.value).toBe(0xf00f)
    expect(after?.tile).toBe('R5C2__PLC')
  })

  test('both views agree the register is used and clocked', () => {
    for (const view of [requested, readBack]) {
      const slice = view.tiles.get('R5C2__PLC')
      expect(slice?.features.some((f) => f.path === 'SLICEA.REG0.USED' && f.value === 'YES')).toBe(
        true,
      )
      expect(slice?.features.some((f) => f.path === 'SLICEA.CLKMUX' && f.value === 'CLK')).toBe(
        true,
      )
    }
  })

  test('the bitstream carries MORE than was asked for, as a real chip must', () => {
    // Not a discrepancy: a packed bitstream also sets every default a physical device needs. The check above is
    // one-directional on purpose, and this states why.
    const askedFeatures = [...requested.tiles.values()].reduce((n, t) => n + t.features.length, 0)
    const gotFeatures = [...readBack.tiles.values()].reduce((n, t) => n + t.features.length, 0)
    expect(gotFeatures).toBeGreaterThan(askedFeatures)
    expect(readBack.tiles.size).toBeGreaterThan(0)
  })
})

/**
 * A REFUTED hypothesis about wire names, recorded so it is not tried again.
 *
 * Wire names in the routing come in two forms: tile-local ones like `JQ0`, and ones with a doubled underscore
 * like `S3__V06S0003`. The obvious guess is that the part after `__` names a physical wire, so two tiles using
 * the same suffix are talking about the same copper — which would make building a netlist across tiles easy.
 *
 * It is wrong, and the real design says so.
 */
describe('wire suffixes do NOT identify a shared wire', () => {
  const suffixTiles = (): Map<string, Set<string>> => {
    const map = new Map<string, Set<string>>()
    for (const tile of requested.tiles.values())
      for (const pip of tile.pips)
        for (const wire of [pip.destination, pip.source]) {
          const mark = wire.indexOf('__')
          if (mark < 0) continue
          const suffix = wire.slice(mark + 2)
          const tiles = map.get(suffix) ?? new Set<string>()
          tiles.add(tile.name)
          map.set(suffix, tiles)
        }
    return map
  }

  test('one suffix is used by far more tiles than a single wire could reach', () => {
    // `H06W0103` and friends appear in six different tiles. A wire spanning six tiles would connect neighbours;
    // these are scattered across dozens of columns, so they are different wires sharing a name.
    const shared = [...suffixTiles().values()].map((t) => t.size)
    expect(Math.max(...shared)).toBeGreaterThan(2)
  })

  test('and the tiles sharing a suffix are too far apart to be one wire', () => {
    // The decisive check. If matching by suffix were valid, a netlist built on it would join cells at opposite
    // ends of the chip — producing a graph that looks entirely reasonable and is wrong.
    let widestSpan = 0
    for (const tiles of suffixTiles().values()) {
      if (tiles.size < 3) continue
      const columns = [...tiles]
        .map((name) => /R\d+C(\d+)/.exec(name))
        .filter((m) => m !== null)
        .map((m) => Number.parseInt((m as RegExpExecArray)[1] as string, 10))
      widestSpan = Math.max(widestSpan, Math.max(...columns) - Math.min(...columns))
    }
    expect(widestSpan).toBeGreaterThan(20)
  })

  test('and half of all wire references carry no suffix at all', () => {
    // So even a correct suffix rule would only cover part of the problem: tile-local names like `JQ0` need
    // resolving too.
    let withSuffix = 0
    let without = 0
    for (const tile of requested.tiles.values())
      for (const pip of tile.pips)
        for (const wire of [pip.destination, pip.source])
          if (wire.includes('__')) withSuffix++
          else without++
    expect(without).toBeGreaterThan(0)
    expect(without).toBeGreaterThanOrEqual(withSuffix / 2)
  })
})

const NEWLINE = '\n'

describe('wide literals in every base, without losing bits', () => {
  test('a HEX literal is read, not silently mis-filed as plain text', () => {
    // `INITVAL_00[319:0] = 320'h…` is how memory contents are written. The regex accepted only binary, so this
    // parsed as an ordinary setting whose "value" was the whole tail — no leftover, no complaint, contents gone.
    const parsed = parseNexusFasm(`R1C1__EBR.EBR0.INITVAL_00[15:0] = 16'hBEEF${NEWLINE}`)
    expect(parsed.unrecognised).toEqual([])
    const found = nexusAssignmentsNamed(parsed, 'INITVAL_00')
    expect(found).toHaveLength(1)
    expect(found[0]?.assignment.value).toBe(0xbeef)
    expect(found[0]?.assignment.base).toBe('h')
  })

  test('a literal wider than a number keeps every bit', () => {
    // Two 64-bit values differing only in the low bit used to compare equal, because both rounded to the same
    // JS number. The bits are kept, and `value` is null rather than a lie.
    const lo = parseNexusFasm(`R1C1__EBR.E.V[63:0] = 64'h${'F'.repeat(15)}0${NEWLINE}`)
    const hi = parseNexusFasm(`R1C1__EBR.E.V[63:0] = 64'h${'F'.repeat(15)}1${NEWLINE}`)
    const a = nexusAssignmentsNamed(lo, 'V')[0]?.assignment
    const b = nexusAssignmentsNamed(hi, 'V')[0]?.assignment
    expect(a?.value).toBeNull()
    expect(b?.value).toBeNull()
    expect(a?.bits).not.toEqual(b?.bits)
    expect(a?.bits[0]).toBe(false)
    expect(b?.bits[0]).toBe(true)
  })

  test('the lookup table still reads as a number, being only 16 bits wide', () => {
    const init = nexusAssignmentsNamed(requested, 'INIT')[0]?.assignment
    expect(init?.value).toBe(0xf00f)
    expect(init?.bits).toHaveLength(16)
  })
})
