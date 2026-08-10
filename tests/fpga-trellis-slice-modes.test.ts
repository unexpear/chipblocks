/**
 * FPGA fabric — ECP5: a SLICE is not always two plain lookup tables, and this pins the three shapes where it is
 * something else against REAL vendor bitstreams.
 *
 * Every fixture here was built with the open Lattice toolchain and is checked against that toolchain's own
 * unpacker, so each assertion pins a VALUE rather than a shape:
 *
 *   yosys 0.67+122  -p 'synth_ecp5 -json D.json' D.v
 *   nextpnr-ecp5    --25k --package CABGA381 --json D.json --textcfg D.cfg --write D.post.json --seed 1
 *   ecppack         D.cfg D.bit                  →  fixtures/trellis-ecp5-<name>.bit
 *   ecpunpack       --textcfg D.unpack.cfg D.bit →  fixtures/trellis-ecp5-<name>.ecpunpack.cfg
 *
 * The five designs and what each is for:
 *
 *   shift8    `sr <= {sr[6:0], din}` — 8 flip-flops, ZERO lookup tables. Every register takes its data from the
 *             routed `M<k>` input, so this is the design that the old decoder turned into eight constant-1
 *             registers with the design's `din` appearing nowhere.
 *   lut-reg   `r <= a & b` — ONE lookup table feeding ONE register through the `DI` path. The control that says
 *             the `M` handling does not steal an ordinary register.
 *   widemux   a 6-input function feeding four registers — the wide-function multiplexers `OFX0` / `OFX1`, with
 *             real consumers reading the wire they come out on.
 *   dpram     a 16x4 distributed RAM — `MODE` `DPRAM` / `RAMW`.
 *   ccu2-add4 a 4-bit adder — `MODE` `CCU2`. Also the fixture the ECP5 suite has been missing: the POSITIVE
 *             arithmetic case, previously recorded as an honest gap.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { simulateClocked } from '../src/renderer/fpga-icebox-run.ts'
import { parseEcp5Bitstream } from '../src/renderer/fpga-trellis-bit.ts'
import { type Ecp5Netlist, reconstructEcp5Netlist } from '../src/renderer/fpga-trellis-netlist.ts'
import {
  decodeEcp5Routing,
  decodeEcp5Slices,
  type Ecp5TileDb,
  parseEcp5TileBits,
  parseEcp5TileGrid,
} from '../src/renderer/fpga-trellis-tiles.ts'

const GRID = parseEcp5TileGrid(
  readFileSync(
    new URL('../fixtures/trellis-ecp5-LFE5U-25F-tilegrid.json', import.meta.url),
    'utf8',
  ),
)
/** Every tile type whose bit database is vendored — routing crosses all of them, not just the logic tiles. */
const TILE_TYPES = [
  'PLC2',
  'CIB',
  'CIB_LR',
  'CIB_EBR',
  'CIB_DSP',
  'TAP_DRIVE',
  'PIOT0',
  'PIOT1',
  'PICT0',
  'PICT1',
]
const DBS = new Map<string, Ecp5TileDb>(
  TILE_TYPES.map((type) => [
    type,
    parseEcp5TileBits(
      readFileSync(new URL(`../fixtures/trellis-ecp5-${type}-bits.db`, import.meta.url), 'utf8'),
    ),
  ]),
)
const dbFor = (type: string): Ecp5TileDb | null => DBS.get(type) ?? null
const PLC2 = DBS.get('PLC2') as Ecp5TileDb

const framesOf = (name: string): boolean[][] =>
  parseEcp5Bitstream(
    new Uint8Array(readFileSync(new URL(`../fixtures/trellis-ecp5-${name}.bit`, import.meta.url))),
  ).frames
const netlistOf = (name: string): Ecp5Netlist => reconstructEcp5Netlist(framesOf(name), GRID, dbFor)

/** What `ecpunpack` says about a bitstream: its arcs and its enum settings, per tile. */
type Reference = { arcs: Set<string>; enums: Set<string> }
function readReference(name: string): Reference {
  const text = readFileSync(
    new URL(`../fixtures/trellis-ecp5-${name}.ecpunpack.cfg`, import.meta.url),
    'utf8',
  )
  const arcs = new Set<string>()
  const enums = new Set<string>()
  let tile = ''
  for (const raw of text.split(String.fromCharCode(10))) {
    const line = raw.trim()
    const tileLine = /^\.tile\s+(\S+?):\S+$/.exec(line)
    if (tileLine !== null) {
      tile = tileLine[1] as string
      continue
    }
    const arc = /^arc:\s+(\S+)\s+(\S+)$/.exec(line)
    if (arc !== null) arcs.add(`${tile} ${arc[1]} ${arc[2]}`)
    const setting = /^enum:\s+(\S+)\s+(\S+)$/.exec(line)
    if (setting !== null) enums.add(`${tile} ${setting[1]} ${setting[2]}`)
  }
  return { arcs, enums }
}

const FIXTURES = ['shift8', 'lut-reg', 'widemux', 'dpram', 'ccu2-add4'] as const
const cellKey = (c: { ref: { x: number; y: number; cell: number } }): string =>
  `${c.ref.x}_${c.ref.y}_${c.ref.cell}`

describe('our decode of a real ECP5 bitstream agrees with ecpunpack', () => {
  // The reference decodes are the vendor unpacker's own output, vendored beside each bitstream. Comparing
  // against them is what makes every count below a measurement rather than a guess.
  for (const name of FIXTURES)
    test(`${name}: the SLICE-output, register-data and mode settings match`, () => {
      const frames = framesOf(name)
      const reference = readReference(name)
      // the two mux families this file is about: the SLICE output wires F<k> and the register data inputs M<k>
      const ours = decodeEcp5Routing(frames, GRID, dbFor)
        .filter((arc) => /^[FM][0-7]$/.test(arc.sink))
        .map((arc) => `${arc.tile} ${arc.sink} ${arc.source}`)
        .sort()
      const theirs = [...reference.arcs].filter((a) => / [FM][0-7] /.test(a)).sort()
      expect(ours).toEqual(theirs)

      // and the SLICE settings that decide what the lookup tables MEAN
      const slices = decodeEcp5Slices(frames, GRID, PLC2)
      for (const slice of slices) {
        if (slice.mode !== null)
          expect(reference.enums).toContain(`${slice.tile} SLICE${slice.slice}.MODE ${slice.mode}`)
        slice.regs.forEach((reg, index) => {
          if (reg.sd !== null)
            expect(reference.enums).toContain(
              `${slice.tile} SLICE${slice.slice}.REG${index}.SD ${reg.sd}`,
            )
        })
      }
      // nothing the reference reports as a non-default mode may be missing from ours
      const referenceModes = [...reference.enums].filter((e) => /SLICE[A-D]\.MODE /.test(e)).sort()
      const ourModes = slices
        .filter((s) => s.mode !== null)
        .map((s) => `${s.tile} SLICE${s.slice}.MODE ${s.mode}`)
        .sort()
      expect(ourModes).toEqual(referenceModes)
    })
})

describe('a register fed from routing keeps its data (SLICE?.REG?.SD selects M<k>)', () => {
  // ecpunpack on this bitstream: 8 `enum: SLICE?.REG?.SD 0` lines and 8 `arc: M<k> ...` lines, no lookup table
  // programmed anywhere — and nextpnr's own report for the design says "Total LUT4s: 0 / Total DFFs: 8".
  test('all eight flip-flops resolve to a single 8-stage chain from one primary input', () => {
    const netlist = netlistOf('shift8')
    const registers = netlist.cells.filter((c) => c.config.dffEnable)
    expect(registers).toHaveLength(8)
    // every one is a BUFFER of a single traced source — not the untouched all-ones table it sits beside
    for (const register of registers) {
      expect(register.config.truth).toEqual(Array.from({ length: 16 }, (_, i) => (i & 1) === 1))
      expect(register.inputs[0]?.kind).not.toBe('unused')
      expect(register.inputs.slice(1).every((i) => i.kind === 'unused')).toBe(true)
    }
    // exactly one stage is fed from outside the logic fabric: the design's `din`
    const heads = registers.filter((c) => c.inputs[0]?.kind === 'primary')
    expect(heads).toHaveLength(1)
    // and following each stage's driver walks all eight, in order, without repeating
    const byKey = new Map(registers.map((c) => [cellKey(c), c]))
    const chain: string[] = [cellKey(heads[0] as (typeof registers)[number])]
    while (chain.length < 8) {
      const next = registers.find((c) => {
        const source = c.inputs[0]
        return (
          source?.kind === 'cell' && cellKey({ ref: source.driver }) === chain[chain.length - 1]
        )
      })
      expect(next).toBeDefined()
      chain.push(cellKey(next as (typeof registers)[number]))
    }
    expect(new Set(chain).size).toBe(8)
    expect(chain.every((key) => byKey.has(key))).toBe(true)

    // nothing was refused: the design is fully recovered, so nothing may be marked untrustworthy
    expect(netlist.unfaithful).toEqual([])
  })

  test('a one-cycle pulse on din walks the chain and leaves after exactly eight clocks', () => {
    // The behaviour of `sr <= {sr[6:0], din}` with `din` high for one cycle: stage n is high on cycle n+1 and at
    // no other time. This is the check the old decoder could not even be given — it recovered no primary net, so
    // there was no input to drive, and every flip-flop read 1 from the first edge onward.
    const netlist = netlistOf('shift8')
    const registers = netlist.cells.filter((c) => c.config.dffEnable)
    const head = registers.find((c) => c.inputs[0]?.kind === 'primary')
    const din = (head?.inputs[0] as { net: number }).net
    const run = simulateClocked(netlist, (cycle) => new Map([[din, cycle === 0]]), 12)

    const high = (cycle: number): string[] =>
      registers.filter((c) => run.trace[cycle]?.get(cellKey(c)) === true).map(cellKey)
    expect(high(0)).toEqual([]) // the pulse has not been clocked in yet
    const walked: string[] = []
    for (let cycle = 1; cycle <= 8; cycle++) {
      const lit = high(cycle)
      expect(lit).toHaveLength(1) // exactly one stage holds the pulse
      walked.push(lit[0] as string)
    }
    expect(new Set(walked).size).toBe(8) // a different stage each cycle — a chain, not a loop
    for (let cycle = 9; cycle < 12; cycle++) expect(high(cycle)).toEqual([]) // and then it is gone
  })

  test('a register fed from its own lookup table is NOT rewritten as a buffer', () => {
    // The control. ecpunpack on this bitstream reports no `REG?.SD` line at all (the setting sits at the
    // database default `1`, the `DI` path) and no `M<k>` arc; nextpnr's placed netlist wires the flip-flop
    // through its `DI` port. Treating the default as the routed path would erase this design's only function.
    const netlist = netlistOf('lut-reg')
    const registers = netlist.cells.filter((c) => c.config.dffEnable)
    expect(registers).toHaveLength(1)
    const register = registers[0] as (typeof registers)[number]
    // `a & b` as ecppack wrote it: the table depends on two pins and is not a buffer
    expect(register.config.truth.map((b) => (b ? 1 : 0)).join('')).toBe('0000000000001111')
    expect(register.inputs.filter((i) => i.kind === 'primary')).toHaveLength(2)
    expect(netlist.unfaithful).toEqual([])
  })
})

describe('a wide-function multiplexer is declared untrustworthy, not reported as a bare lookup table', () => {
  /** Every tile+index whose `F<k>` mux the reference says selects a wide-multiplexer source. */
  const referenceWide = (): string[] =>
    [...readReference('widemux').arcs]
      .filter((a) => / F[0-7] /.test(a))
      .map((a) => {
        const [tile, sink] = a.split(' ')
        return `${tile} ${sink}`
      })
      .sort()

  test('every cell whose output wire carries the wide multiplexer is flagged, with the source named', () => {
    const netlist = netlistOf('widemux')
    expect(referenceWide()).toHaveLength(12) // 4 tiles x 3 wires, per ecpunpack
    const flagged = netlist.unfaithful.filter((u) => /wide-function/.test(u.reason))
    // Ten of the twelve: in one tile the wide multiplexer's own SLICE is otherwise untouched, so no cell for it
    // is emitted at all — and a wire with no cell behind it cannot be mis-attributed to one either.
    expect(flagged).toHaveLength(10)
    for (const listed of flagged) {
      const key = `R${listed.ref.y}C${listed.ref.x} F${listed.ref.cell}`
      expect(referenceWide()).toContain(key)
      expect(listed.reason).toMatch(/F5[A-D]_SLICE|FX[A-D]_SLICE/) // the selected source, named
    }
  })

  test('a consumer of that wire is NOT told it reads the lookup table', () => {
    // The half of the fix that changes the CONSUMER. In tile R12C9 the wide multiplexer leaves on wire `F1` and
    // is routed onward into the `M4` register input of the same tile (ecpunpack: `arc: E1_H01E0101 F1` and
    // `arc: M4 E1_H01E0101`). Binding `F1` to lookup table 1 made that register read a four-input function that
    // is not what the wire carries; leaving it unbound makes the trace end on the wide multiplexer's own wire,
    // reported as an honest primary.
    const netlist = netlistOf('widemux')
    const consumer = netlist.cells.find((c) => c.ref.x === 9 && c.ref.y === 12 && c.ref.cell === 4)
    expect(consumer?.config.dffEnable).toBe(true)
    const source = consumer?.inputs[0]
    expect(source?.kind).toBe('primary')
    expect(netlist.netNames.get((source as { net: number }).net)).toBe('9/12/FXA_SLICE')
    // and no cell at all claims to drive it
    for (const cell of netlist.cells)
      for (const input of cell.inputs)
        if (input.kind === 'cell')
          expect(`${input.driver.x}/${input.driver.y}/${input.driver.cell}`).not.toBe('9/12/1')
  })

  test('an ARITHMETIC slice is not mistaken for a wide multiplexer, though the bits look identical', () => {
    // The trap. `.mux F0`'s `F5A_SLICE` is selected by bit F8B10 — the SAME bit as `SLICEA.CCU2.INJECT1_0 = NO`,
    // and likewise for the other three SLICEs. So ecpunpack reports NINE `arc: F<k> F5?/FX?_SLICE` lines for
    // this 4-bit adder, while nextpnr's own pre-pack configuration for those tiles says `arc: F2 F2_SLICE` (the
    // lookup table) plus `CCU2.INJECT1_0 NO`. Reading the arc without checking the mode would unbind nine
    // correct connections and file nine wrong reasons.
    const reference = readReference('ccu2-add4')
    expect([...reference.arcs].filter((a) => / F[0-7] /.test(a))).toHaveLength(9)
    const netlist = netlistOf('ccu2-add4')
    expect(netlist.unfaithful.filter((u) => /wide-function/.test(u.reason))).toEqual([])
  })
})

describe('the corners of the register data mux that no vendor bitstream here reaches', () => {
  // A real ecppack bitstream only ever shows ONE shape of the routed-data path: `SD 0` with `M<k>` routed and
  // the flip-flop read. These three cases are the shapes a bitstream COULD carry that the five fixtures do not,
  // built here by stamping the real PLC2 database's own bit positions into a blank frame array — the bit
  // positions, the mux arcs and the enum options are the vendor's, only the combination is ours.
  const BLANK = (): boolean[][] =>
    Array.from({ length: 7562 }, () => Array.from({ length: 592 }, () => false))
  const TILE = GRID.get('R20C30:PLC2') as NonNullable<ReturnType<typeof GRID.get>>
  const K = 1 // SLICEA.K1 — the database offers both a `Q1` and an `F1` route out of this tile
  const MARKER = Array.from({ length: 16 }, (_, i) => i === 3 || i === 12) // a table no default could be

  const stamp = (
    frames: boolean[][],
    bits: readonly { frame: number; bit: number; inv: boolean }[],
  ) => {
    for (const { frame, bit, inv } of bits)
      (frames[TILE.startFrame + frame] as boolean[])[TILE.startBit + bit] = !inv
  }
  const route = (frames: boolean[][], sink: string, source: string): void => {
    const bits = PLC2.muxes.get(sink)?.arcs.get(source)
    if (bits === undefined || bits.length === 0) throw new Error(`no ${sink} <- ${source} arc`)
    stamp(frames, bits)
  }
  /** Route `sink` from the first REAL external source the database offers it (never another cell's F/Q). */
  const routeExternal = (frames: boolean[][], sink: string): string => {
    const arc = [...(PLC2.muxes.get(sink)?.arcs.entries() ?? [])].find(
      ([name, bits]) => bits.length > 0 && !/^[FQ]\d$/.test(name),
    )
    if (arc === undefined) throw new Error(`no external source for ${sink}`)
    stamp(frames, arc[1])
    return arc[0] as string
  }
  const writeLut = (frames: boolean[][], k: number, truth: boolean[]): void => {
    const word = PLC2.words.get(`SLICE${'ABCD'[Math.floor(k / 2)]}.K${k % 2}.INIT`)
    if (word === undefined) throw new Error('no INIT word')
    word.bits.forEach((group, i) => {
      for (const { frame, bit, inv } of group)
        (frames[TILE.startFrame + frame] as boolean[])[TILE.startBit + bit] =
          (truth[i] as boolean) !== inv
    })
  }
  /** Select `SLICEA.REG1.SD` = 0, the routed-M data path. */
  const selectRoutedData = (frames: boolean[][]): void => {
    const option = PLC2.enums.get(`SLICEA.REG${K}.SD`)?.options.get('0')
    if (option === undefined || option.length === 0) throw new Error('no SD=0 option')
    stamp(frames, option)
  }
  /** A tile-local wire name with its direction prefix stripped — the form `globaliseEcp5Wire` keeps. */
  const baseName = (wire: string): string => wire.replace(/^(?:[NS]\d+)?(?:[EW]\d+)?_/, '')
  const cellAt = (netlist: Ecp5Netlist) =>
    netlist.cells.find((c) => c.ref.x === 30 && c.ref.y === 20 && c.ref.cell === K)

  test('SD selects M but the flip-flop is unused: the lookup table is left alone', () => {
    // Nothing reads `Q1`, so there is no flip-flop in this design at all — the cell is its lookup table, and
    // rewriting it into a buffer of the register's data input would delete a real function.
    const frames = BLANK()
    writeLut(frames, K, MARKER)
    selectRoutedData(frames)
    routeExternal(frames, `M${K}`)
    route(frames, 'B2', `F${K}`) // the lookup table's own output is what this design reads
    const netlist = reconstructEcp5Netlist(frames, GRID, dbFor)
    expect(cellAt(netlist)?.config.dffEnable).toBe(false)
    expect(cellAt(netlist)?.config.truth).toEqual(MARKER)
    expect(netlist.unfaithful).toEqual([])
  })

  test('SD selects M but nothing is routed to it: the data source is refused, not invented', () => {
    const frames = BLANK()
    writeLut(frames, K, MARKER)
    selectRoutedData(frames)
    route(frames, 'E1_H01E0001', `Q${K}`) // the flip-flop IS read — but its data input is unrouted
    const netlist = reconstructEcp5Netlist(frames, GRID, dbFor)
    expect(cellAt(netlist)?.config.dffEnable).toBe(true)
    expect(cellAt(netlist)?.config.truth).toEqual(MARKER) // not silently turned into a constant-0 buffer
    expect(netlist.unfaithful.map((u) => u.reason)).toEqual([
      expect.stringMatching(/nothing is routed to M1/),
    ])
  })

  test('the lookup table AND a separately-fed flip-flop in one cell: the loss is declared', () => {
    // Both outputs of the SLICE position are in use — `F1` combinationally and `Q1` as a register fed from
    // routing. One cell in the shared model carries one function, so the flip-flop's path is what survives and
    // the lookup table's readers are told, rather than left to assume.
    const frames = BLANK()
    writeLut(frames, K, MARKER)
    selectRoutedData(frames)
    const driver = routeExternal(frames, `M${K}`)
    route(frames, 'E1_H01E0001', `Q${K}`)
    route(frames, 'B2', `F${K}`)
    const netlist = reconstructEcp5Netlist(frames, GRID, dbFor)
    const cell = cellAt(netlist)
    expect(cell?.config.dffEnable).toBe(true)
    expect(cell?.config.truth).toEqual(Array.from({ length: 16 }, (_, i) => (i & 1) === 1))
    expect(cell?.inputs[0]?.kind).toBe('primary')
    expect(netlist.netNames.get((cell?.inputs[0] as { net: number }).net)).toContain(
      baseName(driver),
    )
    expect(netlist.unfaithful.map((u) => u.reason)).toEqual([
      expect.stringMatching(/lookup table's own output F1 is read separately/),
    ])
  })

  test('an SD sitting at the database default is resolved THROUGH that default, not assumed', () => {
    // `readTileEnum` reports a value equal to the declared default as unset. The vendored database declares `1`
    // (the `DI` path) as the default, so no real fixture can reach the other side of that resolution — this
    // doctors the declared default to `0` and programs the matching bits, which makes the setting read back as
    // unset while MEANING the routed path. Without resolving through the database's own default the register
    // would silently fall back to its lookup table, which is the trap the `REGSET` line documents.
    const doctored: Ecp5TileDb = {
      ...PLC2,
      enums: new Map(PLC2.enums),
    }
    const setting = PLC2.enums.get(`SLICEA.REG${K}.SD`) as NonNullable<
      ReturnType<typeof PLC2.enums.get>
    >
    doctored.enums.set(`SLICEA.REG${K}.SD`, { ...setting, defaultValue: '0' })
    const frames = BLANK()
    writeLut(frames, K, MARKER)
    selectRoutedData(frames)
    const driver = routeExternal(frames, `M${K}`)
    route(frames, 'E1_H01E0001', `Q${K}`)
    const doctoredDb = (type: string): Ecp5TileDb | null =>
      type === 'PLC2' ? doctored : dbFor(type)
    // sanity: with the doctored default the setting really does read back as unset
    const slice = decodeEcp5Slices(frames, GRID, doctored).find(
      (s) => s.tile === 'R20C30' && s.slice === 'A',
    )
    expect(slice?.regs[K]?.sd).toBeNull()
    const netlist = reconstructEcp5Netlist(frames, GRID, doctoredDb)
    const cell = cellAt(netlist)
    expect(cell?.config.truth).toEqual(Array.from({ length: 16 }, (_, i) => (i & 1) === 1))
    expect(netlist.netNames.get((cell?.inputs[0] as { net: number }).net)).toContain(
      baseName(driver),
    )
  })
})

describe('distributed RAM and arithmetic slices are declared untrustworthy', () => {
  test('every distributed-RAM cell is flagged, and none is handed to the carry chain', () => {
    // ecpunpack: `SLICEA.MODE DPRAM`, `SLICEB.MODE DPRAM`, `SLICEC.MODE RAMW` in one tile — 3 slices x 2 lookup
    // tables = 6 cells. The tables read back all-zero, which is the memory's power-up image faithfully read;
    // what is missing is that a write changes it, so the cell must not be presented as a settled function.
    const netlist = netlistOf('dpram')
    expect(netlist.cells).toHaveLength(6)
    expect(netlist.unfaithful).toHaveLength(6)
    for (const listed of netlist.unfaithful) expect(listed.reason).toMatch(/distributed-RAM/)
    // `carryEnable` must stay arithmetic-only: widening it alongside the flag would run a RAM through the adder
    expect(netlist.cells.some((c) => c.config.carryEnable)).toBe(false)
  })

  test('a real arithmetic bitstream flags every CCU2 cell — the positive case, no longer a gap', () => {
    // `tests/fpga-trellis-netlist.test.ts` recorded that no CCU2 bitstream existed in the fixtures, so only the
    // negative half of the arithmetic flag was demonstrated. ecpunpack on this adder reports 5 `MODE CCU2`
    // slices; 5 x 2 lookup tables = 10 cells, every one of them arithmetic and every one flagged.
    const reference = readReference('ccu2-add4')
    expect([...reference.enums].filter((e) => /\.MODE CCU2$/.test(e))).toHaveLength(5)
    const netlist = netlistOf('ccu2-add4')
    const arithmetic = netlist.cells.filter((c) => c.config.carryEnable)
    expect(arithmetic).toHaveLength(10)
    expect(netlist.unfaithful).toHaveLength(10)
    for (const listed of netlist.unfaithful) expect(listed.reason).toMatch(/carry/)
  })
})
