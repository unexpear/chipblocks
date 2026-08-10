/**
 * FPGA fabric — Gowin: the WIDE MULTIPLEXERS, which is how the chip computes a function of more than four
 * inputs.
 *
 * A Gowin slice is not only eight four-input lookup tables. Eight two-input multiplexers sit above them in a
 * fixed tree, and `synth_gowin` uses them BY DEFAULT — `-nowidelut` is the flag that turns them off. This
 * decoder had no notion of them: it returned the leaf lookup tables as if they were the whole design, said
 * nothing was refused, nothing was untrustworthy and nothing was left out, and handed whatever read a
 * multiplexer's output a CHIP INPUT the silicon does not have.
 *
 * Measured on `gowin-gw1n1-widemux.fs` before this existed: 14 recovered cells, 0 refused, 0 untrusted, 0
 * incomplete, and 13 chip inputs — one more than the twelve the source declares, the extra one being
 * `R10C9_OF0`, a multiplexer output offered to the user as a switch. The design's two outputs were each a
 * function of that invented switch, so neither depended on any of the eight data inputs it selects between.
 * Every Gowin fixture in this repository that predates these was built with `-nowidelut`, which is why three
 * adversarial audits of the decoder found nothing.
 *
 * THE ORACLE. Nothing here is hand-made. Each bitstream was synthesised, placed and packed by the real
 * toolchain and comes with the tools' own records beside it:
 *
 *   yosys 0.67+122                            synth_gowin, DEFAULT settings (wide lookup tables allowed)
 *   nextpnr-himbaechel 0.10-108-g68c1acd8     --device GW1N-LV1QN48C6/I5 --vopt family=GW1N-1 --seed 1
 *   gowin_pack (Project Apicula 0.33.dev19+gdfb3c8702)   -d GW1N-1
 *   gowin_unpack (same Apicula)               a SECOND, independent reader
 *   Icarus Verilog 14.0 (devel) s20260301-328-geda9fdcd1-dirty   what the SOURCE computes
 *
 *   `-placement.json`  every placed cell's `NEXTPNR_BEL`, including the MUX bels — nextpnr's own answer for
 *                      which wide multiplexers the design has and where.
 *   `-muxes.json`      distilled from `gowin_unpack`: which multiplexer selects the bitstream routes, and
 *                      which multiplexer outputs something reads. A separate implementation of the same read.
 *   `-vectors.json`    the source's whole truth table from Icarus Verilog, a different tool on a different
 *                      file — 4096 vectors for `widemux`, 256 for `mux8`.
 *
 * `gowin-gw1n1-widemux-narrow.fs` is the SAME Verilog with `-nowidelut`, so it holds no multiplexer at all.
 * It is here because an over-broad refusal erases real hardware, which has happened twice in this work: the
 * narrow control must recover exactly as it did before, and so must every fixture that came before it.
 *
 * SIX MORE BITSTREAMS reach what `widemux` and `mux8` cannot — `muxreg`, `muxsel`, `muxconst`, `muxzero`,
 * `muxvcc` and `muxlatch`, all built by the same tools, each pinning the one placement it needs with a `BEL`
 * constraint. They exist because four lines of this decode were once carried with nothing exercising them,
 * and one of the four turned out to be hiding a defect of its own: `muxconst` showed a multiplexer whose
 * choice is tied to a constant 1 being REFUSED, its reader marked untrustworthy, and real hardware erased.
 * See `describe('the corners an ordinary design does not reach')` at the foot of this file.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseGowinAttributeDatabase } from '../src/renderer/fpga-apicula-attributes.ts'
import { parseGowinChipdb } from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'
import type { GowinMuxChoice } from '../src/renderer/fpga-apicula-netlist.ts'
import {
  GOWIN_STORED_HALF_OFFSET,
  GOWIN_WIDE_MUX_OFFSET,
  GOWIN_WIDE_MUX_TREE,
  GOWIN_WIDE_MUX_TRUTH,
  gowinFixedAliases,
  gowinPartPlace,
  gowinWideMuxClosure,
  gowinWideMuxPlan,
  gowinWideMuxRef,
  parseGowinWireAliases,
  reconstructGowinNetlist,
} from '../src/renderer/fpga-apicula-netlist.ts'
import { gowinPinsAtTile, parseGowinPinout } from '../src/renderer/fpga-apicula-pinout.ts'
import { parseGowinPipDatabase } from '../src/renderer/fpga-apicula-routing.ts'
import type { CellRef } from '../src/renderer/fpga-icebox-run.ts'
import { simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'

const at = (name: string): URL => new URL(`../fixtures/${name}`, import.meta.url)
const read = (name: string): string => readFileSync(at(name), 'utf8')

const db = parseGowinChipdb(read('gowin-gw1n1-chipdb.json'))
const pipdb = parseGowinPipDatabase(read('gowin-gw1n1-pips.json'))
const attributes = parseGowinAttributeDatabase(read('gowin-gw1n1-attributes.json'))
// the table the app itself builds — `fpga-open.ts` layers the generated geometric identities over the
// database's own equivalence groups, and a decode without them names the same copper two ways
const aliases = new Map([
  ...parseGowinWireAliases(read('gowin-gw1n1-nodes.json')),
  ...gowinFixedAliases(db.rows, db.cols),
])

const decode = (name: string) =>
  reconstructGowinNetlist(
    parseGowinBitstream(read(`gowin-gw1n1-${name}.fs`)).frames,
    db,
    pipdb,
    attributes,
    aliases,
  )

type Placement = {
  lutBels: Record<string, { kind: string; init: string }>
  muxBels: Record<string, string>
  dffBels: string[]
}
type Muxes = {
  selectRouted: Record<string, number[]>
  ofRead: { tile: string; output: number; readBy: string }[]
}
const placementOf = (name: string): Placement =>
  JSON.parse(read(`gowin-gw1n1-${name}-placement.json`)) as Placement
const muxesOf = (name: string): Muxes => JSON.parse(read(`gowin-gw1n1-${name}-muxes.json`)) as Muxes

const widemux = decode('widemux')
const narrow = decode('widemux-narrow')
const mux8 = decode('mux8')
// the six built to reach what an ordinary design does not — see `describe('the corners...')` below
const muxreg = decode('muxreg')
const muxsel = decode('muxsel')
const muxconst = decode('muxconst')
const muxzero = decode('muxzero')
const muxvcc = decode('muxvcc')
const muxlatch = decode('muxlatch')
/** every Gowin bitstream committed here, so a property can be asserted over the whole corpus */
const ALL_GOWIN = readdirSync(new URL('../fixtures/', import.meta.url))
  .filter((file) => file.startsWith('gowin-gw1n1-') && file.endsWith('.fs'))
  .map((file) => file.slice('gowin-gw1n1-'.length, -'.fs'.length))
  .sort()

const cellKey = (ref: CellRef): string => `${ref.x}_${ref.y}_${ref.cell}`
/** a placement key `x,y,position` for a recovered multiplexer, so the two records can be compared */
const muxPlacementKey = (entry: { ref: CellRef; output: number }): string =>
  `${entry.ref.x},${entry.ref.y},${entry.output}`

describe('the multiplexer tree itself', () => {
  test('is the eight-multiplexer tree Apicula describes, ordered bottom-up', () => {
    // Bottom-up matters: `reconstructGowinNetlist` walks this list once and expects everything a multiplexer
    // reads to have been decided already. A reordering here would silently refuse the upper multiplexers.
    expect(GOWIN_WIDE_MUX_TREE.map((mux) => mux.output)).toEqual([0, 2, 4, 6, 1, 5, 3, 7])
    const decided = new Set<number>()
    for (const mux of GOWIN_WIDE_MUX_TREE) {
      for (const source of [mux.low, mux.high])
        if (source.kind === 'mux') expect(decided.has(source.output)).toBe(true)
      decided.add(mux.output)
    }
  })

  test('every lookup table of a slice is a choice of exactly one multiplexer', () => {
    const leaves = GOWIN_WIDE_MUX_TREE.flatMap((mux) =>
      [mux.low, mux.high].filter((source) => source.kind === 'lut').map((source) => source.index),
    )
    expect([...leaves].sort((one, other) => one - other)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  test('only the eight-input multiplexer crosses into another tile', () => {
    const crossing = GOWIN_WIDE_MUX_TREE.filter((mux) =>
      [mux.low, mux.high].some((source) => source.kind === 'eastMux'),
    )
    expect(crossing.map((mux) => [mux.output, mux.kind])).toEqual([[7, 'MUX2_LUT8']])
  })

  test('the truth table is `select ? high : low`, and ignores its fourth pin', () => {
    // `O = S0 ? I1 : I0`, from the MUX2 model in the Gowin cell library yosys ships
    // (share/yosys/gowin/cells_sim.v). Getting this backwards would be invisible in a count and fatal in a value.
    for (let entry = 0; entry < 16; entry++) {
      const low = (entry & 1) !== 0
      const high = (entry & 2) !== 0
      const select = (entry & 4) !== 0
      expect(GOWIN_WIDE_MUX_TRUTH[entry]).toBe(select ? high : low)
    }
  })

  test('a multiplexer cell can never land on a lookup table or a stored half', () => {
    // Every map in every consumer is keyed by `{x, y, cell}`; a collision would REPLACE a real part rather
    // than sit beside it. Checked from the constants rather than reasoned about.
    for (const mux of GOWIN_WIDE_MUX_TREE) {
      const ref = gowinWideMuxRef(3, 4, mux.output)
      expect(ref.cell).toBeGreaterThanOrEqual(GOWIN_WIDE_MUX_OFFSET)
      // lookup tables occupy 0..7 and stored halves 8..15
      expect(GOWIN_WIDE_MUX_OFFSET).toBeGreaterThanOrEqual(GOWIN_STORED_HALF_OFFSET + 8)
      expect(ref.x).toBe(3)
      expect(ref.y).toBe(4)
    }
  })
})

describe('which multiplexers a design uses', () => {
  test('the closure finds the whole chain under a read output', () => {
    // Reading `OF3` is reading a seven-input function: the multiplexer at `OF3` reads `OF1` and `OF5`, those
    // read the four `OF0/OF2/OF4/OF6` below them, and only then the lookup tables. Nothing routes between
    // them, so nothing but this closure can find them.
    const needed = gowinWideMuxClosure(new Map([['8,9', [3]]]), () => true)
    expect([...(needed.get('8,9') as Set<number>)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ])
    expect(needed.size).toBe(1)
  })

  test('the eight-input multiplexer pulls in the tile to its EAST', () => {
    const needed = gowinWideMuxClosure(new Map([['8,5', [7]]]), () => true)
    expect([...(needed.get('8,5') as Set<number>)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ])
    expect([...(needed.get('8,6') as Set<number>)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ])
  })

  test('widemux recovers exactly the multiplexers nextpnr placed', () => {
    const placed = Object.entries(placementOf('widemux').muxBels)
    expect(placed).toHaveLength(8)
    expect(widemux.wideMuxes.map(muxPlacementKey).sort()).toEqual(placed.map(([key]) => key).sort())
    for (const entry of widemux.wideMuxes)
      expect(placementOf('widemux').muxBels[muxPlacementKey(entry)]).toBe(entry.kind)
  })

  test('mux8 recovers exactly the multiplexers nextpnr placed, across two tiles', () => {
    const placed = Object.entries(placementOf('mux8').muxBels)
    expect(placed).toHaveLength(15)
    expect(mux8.wideMuxes.map(muxPlacementKey).sort()).toEqual(placed.map(([key]) => key).sort())
    // the one that matters most: the eight-input multiplexer, whose second choice is in the NEXT TILE
    const wide = mux8.wideMuxes.filter((entry) => entry.kind === 'MUX2_LUT8')
    expect(wide).toHaveLength(1)
    expect(muxPlacementKey(wide[0] as (typeof mux8.wideMuxes)[number])).toBe('5,8,7')
  })

  test('a SECOND reader agrees about which multiplexers are in use', () => {
    // `gowin_unpack` writes an unrouted select as `= VCC`; the ones it writes as a real signal are the ones
    // the design uses. That is a different implementation reading the same bits.
    for (const [name, design] of [
      ['widemux', widemux],
      ['mux8', mux8],
    ] as const) {
      const expected = new Set<string>()
      for (const [tile, outputs] of Object.entries(muxesOf(name).selectRouted)) {
        const match = /^R(\d+)C(\d+)$/.exec(tile) as RegExpExecArray
        const x = Number.parseInt(match[2] as string, 10) - 1
        const y = Number.parseInt(match[1] as string, 10) - 1
        for (const output of outputs) expected.add(`${x},${y},${output}`)
      }
      expect(design.wideMuxes.map(muxPlacementKey).sort()).toEqual([...expected].sort())
    }
  })

  test('the outputs the second reader sees read are the ones our routing sees read', () => {
    for (const [name, design] of [
      ['widemux', widemux],
      ['mux8', mux8],
    ] as const) {
      const wires = new Set([...design.drivers.values()])
      for (const entry of muxesOf(name).ofRead)
        expect(wires.has(`${entry.tile}_OF${entry.output}`)).toBe(true)
    }
  })
})

/**
 * Which chip input each recovered primary net is, worked out rather than searched for.
 *
 * Every input of these designs is constrained to a package pin on a tile of its own (see the `.cst` beside
 * each bitstream), so a primary's tile names exactly one of the source's ports: the pinout database says
 * which pins sit on that tile, and the constraint file says which of them the design uses. Two nets can be
 * two pieces of copper carrying one input — the decoder does not join every equivalent name — and this maps
 * both to the same port, which is what makes the comparison below exact instead of a search over namings.
 */
const inputBitOfNet = (
  design: ReturnType<typeof decode>,
  name: string,
  ports: string[],
): Map<number, number> => {
  const pack = parseGowinPinout(read('gowin-gw1n1-pinout.json'), db.rows, db.cols).get('QFN48')
  if (pack === undefined) throw new Error('the pinout database has no QFN48 package')
  const signalOfPin = new Map<string, string>()
  for (const line of read(`gowin-gw1n1-${name}.cst`).split(String.fromCharCode(10))) {
    const match = /^IO_LOC "([^"]+)" (\d+);/.exec(line.trim())
    if (match !== null) signalOfPin.set(match[2] as string, match[1] as string)
  }
  const bits = new Map<number, number>()
  for (const [net, wire] of design.primaryWires) {
    const match = /^R(\d+)C(\d+)_/.exec(wire)
    if (match === null) continue
    const used = gowinPinsAtTile(
      pack,
      Number.parseInt(match[1] as string, 10) - 1,
      Number.parseInt(match[2] as string, 10) - 1,
    )
      .map((entry) => signalOfPin.get(entry.pin))
      .filter((port): port is string => port !== undefined)
    if (used.length !== 1) continue
    const bit = ports.indexOf(used[0] as string)
    if (bit >= 0) bits.set(net, bit)
  }
  return bits
}

/** the parts nothing else on the chip reads — what a package pin is driven by */
const sinksOf = (design: ReturnType<typeof decode>): string[] => {
  const consumed = new Set<string>()
  for (const cell of design.netlist.cells)
    for (const source of [...cell.inputs, cell.setReset, cell.clockEnable])
      if (source != null && source.kind === 'cell') consumed.add(cellKey(source.driver))
  return design.netlist.cells
    .filter((cell) => !consumed.has(cellKey(cell.ref)))
    .map((cell) => cellKey(cell.ref))
}

const check = (name: string, design: ReturnType<typeof decode>, outputs: string[]): string[] => {
  const vectors = JSON.parse(read(`gowin-gw1n1-${name}-vectors.json`)) as {
    inputs: string[]
    inputBits: number
  } & Record<string, string>
  const bits = inputBitOfNet(design, name, vectors.inputs)
  // Every chip input the decode reports has to BE one of the source's ports. A primary this cannot place is
  // a signal the silicon does not have, which is exactly the failure being fixed.
  expect(bits.size).toBe(design.primaryWires.size)
  const sinks = sinksOf(design)
  const traces: Map<string, boolean>[] = []
  for (let vector = 0; vector < 1 << vectors.inputBits; vector++) {
    const primary = new Map<number, boolean>()
    for (const [net, bit] of bits) primary.set(net, ((vector >> bit) & 1) === 1)
    traces.push(simulateCombinational(design.netlist, primary).outputs)
  }
  const found: string[] = []
  for (const output of outputs) {
    const golden = vectors[output] as string
    const goldenBit = (vector: number): boolean =>
      ((Number.parseInt(golden.charAt(vector >> 2), 16) >> (vector & 3)) & 1) === 1
    const matching = sinks.filter((sink) =>
      traces.every((trace, vector) => (trace.get(sink) ?? false) === goldenBit(vector)),
    )
    expect(matching, `no recovered part reproduces ${output}`).toHaveLength(1)
    found.push(matching[0] as string)
  }
  expect(new Set(found).size, 'two outputs cannot be the same part').toBe(found.length)
  return found
}

describe('the recovered design computes what the source computes', () => {
  test('widemux reproduces both outputs on all 4096 input vectors', () => {
    const found = check('widemux', widemux, ['y', 'z'])
    // and the parts that do it really do read the multiplexers, so the agreement is about them
    const muxKeys = new Set(widemux.wideMuxes.map((entry) => cellKey(entry.ref)))
    const byKey = new Map(widemux.netlist.cells.map((cell) => [cellKey(cell.ref), cell]))
    const reachesAMultiplexer = (from: string): boolean => {
      const seen = new Set<string>()
      const pending = [from]
      while (pending.length > 0) {
        const key = pending.pop() as string
        if (muxKeys.has(key)) return true
        if (seen.has(key)) continue
        seen.add(key)
        for (const source of byKey.get(key)?.inputs ?? [])
          if (source.kind === 'cell') pending.push(cellKey(source.driver))
      }
      return false
    }
    for (const sink of found) expect(reachesAMultiplexer(sink)).toBe(true)
  })

  test('mux8 reproduces its output on all 256 input vectors, through the two-tile multiplexer', () => {
    const found = check('mux8', mux8, ['y'])
    // the part that computes the answer IS the eight-input multiplexer, the one that reads the next tile
    const wide = mux8.wideMuxes.find((entry) => entry.kind === 'MUX2_LUT8')
    expect(found).toEqual([cellKey((wide as (typeof mux8.wideMuxes)[number]).ref)])
  })
})

describe('a design without wide multiplexers is untouched', () => {
  test('the same Verilog built with -nowidelut recovers with no multiplexer and nothing refused', () => {
    expect(narrow.wideMuxes).toHaveLength(0)
    expect(Object.keys(placementOf('widemux-narrow').muxBels)).toHaveLength(0)
    expect(narrow.netlist.cells).toHaveLength(
      Object.keys(placementOf('widemux-narrow').lutBels).length,
    )
    expect(narrow.unsupported).toHaveLength(0)
    expect(narrow.distrusted).toHaveLength(0)
    expect(narrow.partial).toHaveLength(0)
  })

  test('both builds of the same source report the same twelve chip inputs', () => {
    // The wide build used to report THIRTEEN — the extra one a multiplexer output offered as a switch.
    expect(narrow.primaryWires.size).toBe(12)
    expect(widemux.primaryWires.size).toBe(12)
    for (const wire of [...widemux.primaryWires.values(), ...narrow.primaryWires.values()])
      expect(wire).not.toMatch(/_OF\d$/)
  })

  test('every earlier Gowin fixture recovers exactly as it did, with no multiplexer at all', () => {
    // An over-broad refusal erases real hardware, which has happened twice in this work, so the whole corpus
    // is pinned rather than sampled.
    //
    // THE CHIP-INPUT COLUMN USED TO BE WRONG, and this test was pinning it. `dense` sat here at 236 chip
    // inputs for a source that declares six ports (`gowin-gw1n1-dense.v`), `pairmix` at 17 for six, and
    // `splitout` at 8 for five — three designs described elsewhere in this suite as "the negative controls".
    // They were nothing of the kind: they were wrong reads with clean reports, because a signal travelling a
    // long wire or a power-up arc dead-ended and a chip input was invented in its place. The first four
    // numbers of every row are unchanged — nothing was refused, dropped or newly distrusted to get here.
    // `fpga-gowin-long-wire.test.ts` holds the rule that would have caught it: a recovered chip input has to
    // be a port the source declares.
    const counts: Record<string, [number, number, number, number, number]> = {
      // cells, refused, incomplete, untrusted, chip inputs
      adder16: [16, 18, 0, 16, 16],
      adder4: [4, 6, 0, 4, 4],
      // THE BLOCK-MEMORY ROW USED TO READ `[18, 0, 0, 0, 12]`, and it was pinning a defect exactly as the
      // chip-input column above once did. `bram1k` is a design built around a block memory; nothing here read
      // block memories at all, so the memory's eight data outputs dead-ended and became eight of those twelve
      // "chip inputs" — on tiles in the middle of the fabric that carry no package pin — while the design
      // reported nothing refused, nothing incomplete and nothing untrustworthy. The memory is now refused (1)
      // and all sixteen parts reading it are marked (16). The cell count is unchanged: refusing the memory
      // takes no lookup table away.
      bram1k: [18, 1, 0, 16, 12],
      dense: [729, 0, 0, 0, 5],
      ffvariants: [3, 0, 0, 0, 3],
      mixedreg: [4, 2, 0, 0, 2],
      pairmix: [161, 0, 0, 0, 5],
      splitkeep: [3, 0, 2, 0, 6],
      splitmix: [14, 0, 0, 0, 4],
      splitout: [83, 0, 0, 0, 4],
      splitpad: [6, 0, 0, 0, 5],
      'xnor-dff': [1, 0, 0, 0, 2],
    }
    for (const [name, expected] of Object.entries(counts)) {
      const design = decode(name)
      expect(
        [
          design.netlist.cells.length,
          design.unsupported.length,
          design.partial.length,
          design.distrusted.length,
          design.primaryWires.size,
        ],
        name,
      ).toEqual(expected)
      expect(design.wideMuxes, name).toHaveLength(0)
    }
  })
})

describe('a multiplexer whose choice was DROPPED is refused, not guessed', () => {
  // The decision on its own, one condition at a time. `gowin-gw1n1-muxlatch.fs` below drives the same
  // decision through the whole decoder on a real bitstream; these reach the branches that bitstream does not,
  // and pin the difference between a choice that is MISSING and one that is merely not programmed.
  const somewhere: CellRef = { x: 1, y: 2, cell: 0 }
  const elsewhere: CellRef = { x: 1, y: 2, cell: 1 }
  const drives = (ref: CellRef): GowinMuxChoice => ({ kind: 'cell', driver: ref })
  const dropped: GowinMuxChoice = { kind: 'dropped' }
  const five = GOWIN_WIDE_MUX_TREE.find(
    (mux) => mux.output === 0,
  ) as (typeof GOWIN_WIDE_MUX_TREE)[number]
  const eight = GOWIN_WIDE_MUX_TREE.find(
    (mux) => mux.output === 7,
  ) as (typeof GOWIN_WIDE_MUX_TREE)[number]

  test('both choices present: the two lookup tables become the two inputs, in that order', () => {
    const plan = gowinWideMuxPlan(
      five,
      (index) => drives(index === 0 ? somewhere : elsewhere),
      () => null,
    )
    expect(plan.refusal).toBeNull()
    expect(plan.inputs).toEqual([
      { kind: 'cell', driver: somewhere, net: 0 },
      { kind: 'cell', driver: elsewhere, net: 0 },
    ])
  })

  test('the low choice dropped is a refusal', () => {
    const plan = gowinWideMuxPlan(
      five,
      (index) => (index === 0 ? dropped : drives(elsewhere)),
      () => null,
    )
    expect(plan.inputs).toBeNull()
    expect(plan.refusal).toContain('one of those two is not recovered')
  })

  test('the high choice dropped is a refusal', () => {
    const plan = gowinWideMuxPlan(
      five,
      (index) => (index === 0 ? drives(somewhere) : dropped),
      () => null,
    )
    expect(plan.inputs).toBeNull()
    expect(plan.refusal).toBeTypeOf('string')
  })

  test('a choice that is not programmed at all is the constant one, NOT a refusal', () => {
    // The difference this whole type exists for. `gowin-gw1n1-muxconst.fs` is the bitstream that showed why:
    // treating an unprogrammed table as a missing one refused a multiplexer whose value was perfectly well
    // known and marked its reader untrustworthy.
    const plan = gowinWideMuxPlan(
      five,
      (index) => (index === 0 ? { kind: 'unprogrammed' } : drives(elsewhere)),
      () => null,
    )
    expect(plan.refusal).toBeNull()
    expect(plan.inputs).toEqual([
      { kind: 'const', value: true },
      { kind: 'cell', driver: elsewhere, net: 0 },
    ])
  })

  test('the eight-input multiplexer asks the tile EAST for its low choice and its own for the high', () => {
    const asked: { output: number; eastward: boolean }[] = []
    const plan = gowinWideMuxPlan(
      eight,
      () => dropped,
      (output, eastward) => {
        asked.push({ output, eastward })
        return eastward ? somewhere : elsewhere
      },
    )
    expect(asked).toEqual([
      { output: 3, eastward: true },
      { output: 3, eastward: false },
    ])
    expect(plan.inputs).toEqual([
      { kind: 'cell', driver: somewhere, net: 0 },
      { kind: 'cell', driver: elsewhere, net: 0 },
    ])
  })

  test('a neighbouring tile with no multiplexer refuses the eight-input one', () => {
    // A LOWER multiplexer has no unprogrammed case: the tree is hard wiring, so if the one below is not
    // there the value really is unknown. That is the whole difference from the lookup tables above.
    const plan = gowinWideMuxPlan(
      eight,
      () => dropped,
      (_output, eastward) => (eastward ? null : elsewhere),
    )
    expect(plan.inputs).toBeNull()
  })
})

describe('an unrouted select is the constant the fabric powers up with', () => {
  test('SEL is tied to VCC by a source no fuse selects', () => {
    // The whole reason an unrouted select can be stated as a constant rather than reported as a chip input.
    // Read out of the pip database that ships beside the bitstreams, not asserted from memory.
    for (const ttyp of [12, 13, 14]) {
      const sources = pipdb.get(ttyp)?.pips.get('SEL0')
      expect(sources?.get('VCC'), `tile type ${ttyp}`).toEqual([])
    }
  })

  test('muxvcc really does leave a USED multiplexer’s select unrouted', () => {
    // The second reader's answer, not ours: `gowin_unpack` lists no routed select for the tile, and lists the
    // multiplexer's output as a wire something takes its signal from. So the multiplexer is in use with a
    // select no fuse drives.
    const record = muxesOf('muxvcc')
    expect(record.selectRouted).toEqual({})
    expect(record.ofRead.map((entry) => `${entry.tile}/OF${entry.output}`)).toEqual(['R8C9/OF0'])
  })

  test('muxvcc reads that select as the constant 1, and computes the source on all 2048 vectors', () => {
    expect(muxvcc.wideMuxes).toHaveLength(1)
    const mux = muxvcc.netlist.cells.find(
      (cell) => cell.ref.cell === GOWIN_WIDE_MUX_OFFSET,
    ) as (typeof muxvcc.netlist.cells)[number]
    expect(mux.inputs[2]).toEqual({ kind: 'const', value: true })
    // and no chip input was invented for it
    for (const wire of muxvcc.primaryWires.values()) expect(wire).not.toMatch(/_SEL\d$/)
    check('muxvcc', muxvcc, ['y'])
  })

  test('mux8 leaves one select unrouted, and that multiplexer passes its high choice', () => {
    // `R9C7_SEL7` is absent from the second reader's routed list, and the multiplexer at OF7 of that tile is
    // not one this design uses — so the constant is what the multiplexers ABOVE an unused one would see.
    expect(muxesOf('mux8').selectRouted['R9C7']).not.toContain(7)
    const selects = mux8.netlist.cells
      .filter((cell) => cell.ref.cell >= GOWIN_WIDE_MUX_OFFSET)
      .map((cell) => cell.inputs[2])
    expect(selects).toHaveLength(15)
    for (const select of selects)
      expect(select?.kind === 'const' || select?.kind === 'primary').toBe(true)
  })
})

/**
 * The corners an ordinary design does not reach, on bitstreams built to reach them.
 *
 * Four lines of this change were carried with nothing exercising them, because `synth_gowin` plus nextpnr's
 * own packer will not, left to themselves, put a wide multiplexer in any of these positions: the packer
 * inserts a pass-through lookup table rather than let a multiplexer and a flip-flop share one, and it routes
 * the select of every multiplexer it places. Each design below pins the placement it needs with a `BEL`
 * attribute — an ordinary user-available constraint, not a hand-edited bitstream — and is then synthesised,
 * placed, packed and read back by the same real tools as every other fixture here.
 *
 * Every one of them is legal silicon: a Gowin slice wires each lookup table's `F<n>` to BOTH the multiplexer
 * tree above it and the flip-flop beside it, so a table feeding a multiplexer while its own flip-flop is in
 * use is hardware, not a contrivance. Another vendor's packer, a hand-written netlist, or a later version of
 * this one can produce all of them.
 */
describe('the corners an ordinary design does not reach', () => {
  const muxCellOf = (design: ReturnType<typeof decode>) =>
    design.netlist.cells.find((cell) => cell.ref.cell === GOWIN_WIDE_MUX_OFFSET)
  const cellAt = (design: ReturnType<typeof decode>, key: string) =>
    design.netlist.cells.find((cell) => cellKey(cell.ref) === key)

  test('muxreg: a lookup table read by the multiplexer above it is NOT reported as a register', () => {
    // nextpnr's own record first — the flip-flop really is on the same position the multiplexer's low choice
    // comes from, so this is the shape the guard is for.
    const placement = placementOf('muxreg')
    expect(placement.muxBels['8,7,0']).toBe('MUX2_LUT5')
    expect(placement.dffBels).toContain('8,7,0')
    expect(Object.keys(placement.lutBels).sort()).toEqual(['8,7,0', '8,7,1'])

    // The multiplexer's choices are the two lookup tables, and the low one carries the TABLE's value, not the
    // value its flip-flop holds. Without the multiplexer's choices counted as reads of those tables this cell
    // comes back with `dffEnable` true and the multiplexer silently reads a stored value instead — measured,
    // and with nothing refused, untrusted or incomplete to show for it.
    expect(cellAt(muxreg, '8_7_0')?.config.dffEnable).toBe(false)
    expect(muxCellOf(muxreg)?.inputs[0]).toEqual({
      kind: 'cell',
      driver: { x: 8, y: 7, cell: 0 },
      net: 0,
    })
    // and the flip-flop that IS there is said to be left out rather than passed over in silence
    expect(muxreg.partial.map((entry) => entry.kind)).toEqual(['register-not-shown'])
    check('muxreg', muxreg, ['y'])
  })

  test('muxsel: a lookup table driving a multiplexer SELECT is NOT reported as a register', () => {
    const placement = placementOf('muxsel')
    expect(placement.muxBels['8,7,0']).toBe('MUX2_LUT5')
    expect(placement.dffBels).toContain('9,7,0')

    expect(cellAt(muxsel, '9_7_0')?.config.dffEnable).toBe(false)
    expect(muxCellOf(muxsel)?.inputs[2]).toEqual({
      kind: 'cell',
      driver: { x: 9, y: 7, cell: 0 },
      net: 0,
    })
    check('muxsel', muxsel, ['y'])
  })

  test('muxzero: a constant-ZERO choice is packed as sixteen zero bits and read back as a part', () => {
    // The control that makes the next test a measurement rather than an assumption. Same design, same
    // position, the only difference being which constant the multiplexer's low choice is tied to.
    expect(placementOf('muxzero').lutBels['8,7,0']).toEqual({ kind: 'LUT1', init: '00' })
    expect(cellAt(muxzero, '8_7_0')?.config.truth.some(Boolean)).toBe(false)
    expect(muxCellOf(muxzero)?.inputs[0]).toEqual({
      kind: 'cell',
      driver: { x: 8, y: 7, cell: 0 },
      net: 0,
    })
    expect(muxzero.unsupported).toHaveLength(0)
    check('muxzero', muxzero, ['y'])
  })

  test('muxconst: a constant-ONE choice is packed as sixteen one bits and is a constant, not a refusal', () => {
    // Same tool, same position, the other constant — and sixteen ones is what the decode used to discard as
    // an erased table. Doing so refused the multiplexer, a part that was read perfectly well, marked its
    // reader untrustworthy, and cost the design an input: measured at 2 cells / 1 refused / 1 untrusted.
    expect(placementOf('muxconst').lutBels['8,7,0']).toEqual({ kind: 'LUT1', init: '11' })
    expect(muxCellOf(muxconst)?.inputs[0]).toEqual({ kind: 'const', value: true })
    expect(muxconst.unsupported).toHaveLength(0)
    expect(muxconst.distrusted).toHaveLength(0)
    expect(muxconst.wideMuxes).toHaveLength(1)
    check('muxconst', muxconst, ['y'])
  })

  test('muxlatch: a refused choice refuses the multiplexer, and everything that read it is distrusted', () => {
    // The whole refusal path on a real bitstream, which nothing reached before. The low choice is a
    // level-sensitive latch — a thing this reader will not describe — so the multiplexer above it cannot say
    // which value it passes, and the lookup table that read the multiplexer is left with an invented input.
    expect(placementOf('muxlatch').muxBels['8,7,0']).toBe('MUX2_LUT5')
    const refused = muxlatch.unsupported.map((entry) => [cellKey(entry.ref), entry.kind])
    expect(refused).toContainEqual(['8_7_0', 'DL'])
    expect(refused).toContainEqual([`8_7_${GOWIN_WIDE_MUX_OFFSET}`, 'MUX2_LUT5'])

    // the producer side: the multiplexer is not offered as a recovered part and is not indexed as a driver
    expect(muxlatch.wideMuxes).toHaveLength(0)
    expect(muxCellOf(muxlatch)).toBeUndefined()

    // the consumer side, which is the half that has gone missing seven times in this work: the part that read
    // it is named, and the reason names BOTH things it lost.
    expect(muxlatch.distrusted.map((entry) => cellKey(entry.ref))).toEqual(['9_7_0'])
    const reason = (muxlatch.distrusted[0] as (typeof muxlatch.distrusted)[number]).reason
    expect(reason).toContain('wide multiplexer that could not be read')
    expect(reason).toContain('a part that could not be read')
    // and the invented inputs really are on the canvas, so the warning is about something the user can see
    expect(
      cellAt(muxlatch, '9_7_0')?.inputs.filter((source) => source.kind === 'primary'),
    ).toHaveLength(4)
  })

  test('none of the five that decode invents a chip input on a multiplexer output', () => {
    // The original defect, stated as the property it broke: `R10C9_OF0` was offered to the user as a switch.
    for (const [name, design] of [
      ['muxreg', muxreg],
      ['muxsel', muxsel],
      ['muxconst', muxconst],
      ['muxzero', muxzero],
      ['muxvcc', muxvcc],
    ] as const)
      for (const wire of design.primaryWires.values())
        expect(wire, `${name} invents ${wire}`).not.toMatch(/_OF\d$/)
    // muxlatch is the exception and says so out loud: its multiplexer IS refused, the reader IS handed an
    // invented input, and that part is listed as untrustworthy above.
    expect([...muxlatch.primaryWires.values()].filter((wire) => /_OF\d$/.test(wire))).toEqual([
      'R8C9_OF0',
    ])
  })
})

describe('the two rules no bitstream can reach, checked on their own', () => {
  // Neither is reachable from a file this toolchain produces, and each was reached by DELETING it and
  // running every FPGA test: both left the suite green, which is what these are for. They are not
  // decoration — one names a part for the user, the other keeps the reader off the edge of the chip.
  test('a part is named by what it IS, for each of the three kinds of position', () => {
    expect(gowinPartPlace({ x: 3, y: 4, cell: 1 })).toBe(
      'the logic part at column 3, row 4, position 1',
    )
    expect(gowinPartPlace({ x: 3, y: 4, cell: GOWIN_STORED_HALF_OFFSET + 1 })).toBe(
      'the stored value of the logic part at column 3, row 4, position 1',
    )
    expect(gowinPartPlace({ x: 3, y: 4, cell: GOWIN_WIDE_MUX_OFFSET + 7 })).toBe(
      'the wide multiplexer above the logic parts at column 3, row 4',
    )
    // and the whole point: no sentence a user reads names a position the chip does not have
    for (let cell = GOWIN_STORED_HALF_OFFSET; cell < GOWIN_WIDE_MUX_OFFSET + 8; cell++)
      expect(gowinPartPlace({ x: 0, y: 0, cell })).not.toContain(`position ${cell}`)
  })

  test('the eastward closure stops at the edge of the chip', () => {
    // The eight-input multiplexer's low choice lives one column EAST, so a tile in the last column asks for
    // one that is not there. Apicula draws the same line — its own reader emits the eight-input multiplexer
    // only `if col < db.cols`. Without this the tiles beyond the edge come back as wanted, and every lookup
    // table of a tile that does not exist reads as unprogrammed, which is to say as a constant 1.
    const lastColumn = db.cols - 1
    const read = new Map([[`5,${lastColumn}`, [7]]])
    const onDevice = (_row: number, col: number): boolean => col < db.cols
    expect([...gowinWideMuxClosure(read, onDevice).keys()]).toEqual([`5,${lastColumn}`])
    // the same seed with no edge at all does reach the neighbouring tile, so the test above is about the edge
    // and not about the closure failing to walk eastward in the first place
    expect([...gowinWideMuxClosure(read, () => true).keys()].sort()).toEqual(
      [`5,${lastColumn}`, `5,${db.cols}`].sort(),
    )
  })

  test('no recovered part, refusal or warning ever sits off the chip', () => {
    // The property the rule above exists to hold, over every Gowin bitstream here.
    for (const name of ALL_GOWIN) {
      const design = decode(name)
      const places = [
        ...design.netlist.cells.map((cell) => cell.ref),
        ...design.unsupported.map((entry) => entry.ref),
        ...design.distrusted.map((entry) => entry.ref),
        ...design.partial.map((entry) => entry.ref),
      ]
      for (const ref of places) {
        expect(ref.x, `${name} column ${ref.x}`).toBeLessThan(db.cols)
        expect(ref.y, `${name} row ${ref.y}`).toBeLessThan(db.rows)
      }
    }
  })
})
