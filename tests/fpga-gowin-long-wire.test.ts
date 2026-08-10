/**
 * TWO CONNECTIONS THE GOWIN READER NEVER FOLLOWED, and the property that would have caught either.
 *
 * The reader could recover an ordinary design, report `0 refused / 0 incomplete / 0 untrusted`, and be wrong.
 * Two hops in the fabric leave no fuse behind, so a fuse-only decode walked into the wire and found nothing:
 *
 *   THE POWER-UP ARC. A Gowin routing multiplexer has one source no fuse selects — the state it powers up in,
 *   which Apicula records as a source with an empty bit list. The reader knew about those for a register's
 *   `Q<n>` and for no other wire, so a lookup table feeding another in its own tile over such an arc was lost.
 *   `gowin-gw1n1-passlut.fs` is seven lines of Verilog that does exactly that, and the recovered netlist
 *   disagreed with Icarus Verilog on 56 of 256 input vectors while reporting nothing wrong.
 *
 *   THE LONG WIRE. `LB01`..`LB71` are read 3,220 times across the GW1N-1 routing database and are a pip
 *   destination nowhere in it, because they are driven from a multiplexer at one end of their column. Every
 *   tile reading one long wire therefore minted its OWN chip input: `gowin-gw1n1-dense.fs`, whose source
 *   declares six ports, came back with 236 chip inputs, 189 of them long wires. `gowin-gw1n1-longwire.fs` is
 *   48 lookup tables sharing one high-fanout enable, which is what makes the placer reach for a long wire.
 *
 * THE PROPERTY, which neither defect could have survived: EVERY RECOVERED CHIP INPUT MUST BE A PORT THE
 * SOURCE DESIGN DECLARES. Nothing in a bitstream says so, but the sources are committed beside the bitstreams,
 * so it is checkable — and for the three designs with a pin-constraint file it is checkable exactly, pin by
 * pin, with no searching: the constraint file names the port at each package pin, and the pinout says which
 * pins sit on the tile a recovered input's wire belongs to.
 *
 * And then the proof that matters, because a netlist that merely looks well-formed has been wrong three times
 * in this work: those three designs are SIMULATED, on all 256 of their input vectors, against what Icarus
 * Verilog says their own source computes.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseGowinAttributeDatabase } from '../src/renderer/fpga-apicula-attributes.ts'
import {
  type GowinSegment,
  gowinSegmentAt,
  gowinTileAt,
  parseGowinChipdb,
} from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'
import {
  type GowinDesign,
  gowinDefaultCellOutputArcs,
  gowinFixedAliases,
  gowinLongWirePlan,
  parseGowinWireAliases,
  reconstructGowinNetlist,
} from '../src/renderer/fpga-apicula-netlist.ts'
import { gowinDesignPins, parseGowinPinout } from '../src/renderer/fpga-apicula-pinout.ts'
import { parseGowinPipDatabase } from '../src/renderer/fpga-apicula-routing.ts'
import { simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'

const at = (name: string): URL => new URL(`../fixtures/${name}`, import.meta.url)
const text = (name: string): string => readFileSync(at(name), 'utf8')

const chipdbText = text('gowin-gw1n1-chipdb.json')
const db = parseGowinChipdb(chipdbText)
const pipdb = parseGowinPipDatabase(text('gowin-gw1n1-pips.json'))
const attributes = parseGowinAttributeDatabase(text('gowin-gw1n1-attributes.json'))
const aliases = new Map([
  ...parseGowinWireAliases(text('gowin-gw1n1-nodes.json')),
  ...gowinFixedAliases(db.rows, db.cols),
])
const pins = parseGowinPinout(text('gowin-gw1n1-pinout.json'), db.rows, db.cols).get(
  'QFN48',
) as ReadonlyMap<string, { name: string; row: number; col: number; buffer: string }>

const decode = (name: string, chipdb = db): GowinDesign =>
  reconstructGowinNetlist(
    parseGowinBitstream(text(`gowin-gw1n1-${name}.fs`)).frames,
    chipdb,
    pipdb,
    attributes,
    aliases,
  )

/** Every Gowin bitstream committed here — the rules below that need no source file run over all of them. */
const ALL_GOWIN = readdirSync(new URL('../fixtures/', import.meta.url))
  .filter((file) => file.startsWith('gowin-gw1n1-') && file.endsWith('.fs'))
  .map((file) => file.slice('gowin-gw1n1-'.length, -'.fs'.length))
  .sort()

/** The input ports one source file declares, one entry per bit of a vector. */
function declaredInputPorts(name: string): string[] {
  const header = /module\s+\w+\s*\(([^)]*)\)/s.exec(text(`gowin-gw1n1-${name}.v`))
  if (header === null) throw new Error(`${name}: no module header`)
  const ports: string[] = []
  for (const raw of (header[1] as string).split(',')) {
    const match = /^(input|output|inout)\s+(?:\[(\d+):(\d+)\]\s*)?(\w+)$/.exec(raw.trim())
    if (match === null || match[1] !== 'input') continue
    const port = match[4] as string
    if (match[2] === undefined) {
      ports.push(port)
      continue
    }
    const high = Number(match[2])
    const low = Number(match[3])
    for (let bit = Math.min(high, low); bit <= Math.max(high, low); bit++)
      ports.push(`${port}[${bit}]`)
  }
  return ports
}

/** package pin -> the port the design's constraint file ties to it. */
function pinConstraints(name: string): Map<string, string> {
  const byPin = new Map<string, string>()
  for (const line of text(`gowin-gw1n1-${name}.cst`).split('\n')) {
    const match = /^IO_LOC\s+"([^"]+)"\s+(\d+);/.exec(line.trim())
    if (match !== null) byPin.set(match[2] as string, match[1] as string)
  }
  return byPin
}

const cellKey = (ref: { x: number; y: number; cell: number }): string =>
  `${ref.x}_${ref.y}_${ref.cell}`

/** the recovered parts nothing else on the chip reads — what a package pin is driven by. */
function sinksOf(design: GowinDesign): string[] {
  const read = new Set<string>()
  for (const cell of design.netlist.cells)
    for (const source of cell.inputs) if (source.kind === 'cell') read.add(cellKey(source.driver))
  return design.netlist.cells
    .filter((cell) => !read.has(cellKey(cell.ref)))
    .map((cell) => cellKey(cell.ref))
}

describe('the long-wire segment table this device ships', () => {
  test('it covers every branch of every tile once, or not at all — never twice', () => {
    // What makes a segment usable as an answer: where one covers the tile it is the only one that does, so
    // "which end drives this branch" has a single answer rather than a choice the reader would have to make.
    let one = 0
    let none = 0
    let several = 0
    for (let row = 0; row < db.rows; row++)
      for (let col = 0; col < db.cols; col++)
        for (let index = 0; index < 8; index++) {
          const covering = [...(db.segments.get(index) ?? [])].filter(
            (segment) =>
              row >= segment.minRow &&
              row <= segment.maxRow &&
              col >= segment.minCol &&
              col <= segment.maxCol,
          )
          if (covering.length === 1) one += 1
          else if (covering.length === 0) none += 1
          else several += 1
          expect(gowinSegmentAt(db.segments, index, row, col), `${row},${col},${index}`).toBe(
            covering.length === 1 ? covering[0] : null,
          )
        }
    expect([one, none, several]).toEqual([1694, 66, 0])
  })

  test('gowinSegmentAt on tables this device does not have', () => {
    // Two of `gowinSegmentAt`'s three answers cannot be reached from the shipped table, which the test above
    // is what establishes: on GW1N-1 no tile is claimed by two segments of the same branch, and every segment
    // spans the whole height of the die, so the row half of the coverage box never excludes anything. Both
    // guards are for a device database that is not this one, so they are driven here directly — otherwise
    // removing either would leave the whole suite green, which was measured.
    const box = (over: Partial<GowinSegment>): GowinSegment => ({
      column: 1,
      index: 3,
      minCol: 0,
      maxCol: 4,
      minRow: 0,
      maxRow: 4,
      topRow: 0,
      bottomRow: 4,
      topWire: 'LT02',
      bottomWire: 'LT02',
      ...over,
    })
    const inside = box({})
    const rowsAbove = box({ column: 7, minRow: 5, maxRow: 9, topRow: 5, bottomRow: 9 })
    const table = new Map([[3, [inside, rowsAbove]]])

    expect(gowinSegmentAt(table, 3, 2, 2)).toBe(inside)
    // the row half of the box really is read: the same column, a row only the second segment covers
    expect(gowinSegmentAt(table, 3, 7, 2)).toBe(rowsAbove)
    // a branch index with no segment at all, and a tile outside every box
    expect(gowinSegmentAt(table, 5, 2, 2)).toBeNull()
    expect(gowinSegmentAt(table, 3, 2, 9)).toBeNull()
    // two segments claiming one tile is not a choice to make — it is an answer this reader does not have
    const overlapping = new Map([[3, [inside, box({ column: 3 })]]])
    expect(gowinSegmentAt(overlapping, 3, 2, 2)).toBeNull()
  })

  test('every segment names two ends that really are pip destinations of their own tiles', () => {
    // The whole join rests on this: the branch has no driver in the database, but the wire at the end of its
    // column DOES, so the ordinary decode takes over from there. A segment naming a wire no tile can drive
    // would be a join to nowhere.
    let checked = 0
    for (const list of db.segments.values())
      for (const segment of list)
        for (const end of [
          { row: segment.topRow, wire: segment.topWire },
          { row: segment.bottomRow, wire: segment.bottomWire },
        ]) {
          const ttyp = (db.grid[end.row] as readonly number[])[segment.column] as number
          const tables = pipdb.get(ttyp)
          expect(
            tables?.pips.has(end.wire) === true || tables?.clockPips.has(end.wire) === true,
            `segment at column ${segment.column} names ${end.wire} in row ${end.row} (tile type ${ttyp})`,
          ).toBe(true)
          checked += 1
        }
    expect(checked).toBe(80)
  })

  test('`LB<n>1` really is a source everywhere and a destination nowhere', () => {
    // If this ever stopped being true the join would be unnecessary — and, worse, would be overriding a real
    // fused driver. Counted rather than asserted so a database change is visible.
    let asSource = 0
    let asDestination = 0
    for (const tables of pipdb.values())
      for (const table of [tables.pips, tables.clockPips])
        for (const [destination, sources] of table) {
          if (/^LB\d1$/.test(destination)) asDestination += 1
          for (const source of sources.keys()) if (/^LB\d1$/.test(source)) asSource += 1
        }
    expect(asDestination).toBe(0)
    expect(asSource).toBe(3220)
  })
})

describe('gowinLongWirePlan — which end drives a long wire, one condition at a time', () => {
  // Two of these four answers no bitstream in this repository produces, which is the reason the decision is a
  // function of its own rather than a branch inside the walk.
  const segment: GowinSegment = {
    column: 6,
    index: 2,
    minCol: 5,
    maxCol: 8,
    minRow: 0,
    maxRow: 10,
    topRow: 0,
    bottomRow: 10,
    topWire: 'LT02',
    bottomWire: 'LT02',
  }
  const drivenAt =
    (...rows: number[]) =>
    (row: number) =>
      rows.includes(row)

  test('the top end alone', () => {
    const plan = gowinLongWirePlan(segment, drivenAt(0))
    expect(plan.end).toEqual({ row: 0, col: 6, wire: 'LT02' })
    expect(plan.refusal).toBeNull()
  })

  test('the bottom end alone', () => {
    const plan = gowinLongWirePlan(segment, drivenAt(10))
    expect(plan.end).toEqual({ row: 10, col: 6, wire: 'LT02' })
  })

  test('neither end switched on is refused, not guessed', () => {
    const plan = gowinLongWirePlan(segment, drivenAt())
    expect(plan.end).toBeNull()
    expect(plan.refusal).toContain('neither end')
  })

  test('both ends switched on is refused, not resolved to whichever comes first', () => {
    // Picking one would be a coin toss dressed up as a decode.
    const plan = gowinLongWirePlan(segment, drivenAt(0, 10))
    expect(plan.end).toBeNull()
    expect(plan.refusal).toContain('both ends')
  })

  test('no segment reaching the tile is refused too', () => {
    const plan = gowinLongWirePlan(null, drivenAt(0))
    expect(plan.end).toBeNull()
    expect(plan.refusal).toContain('no long wire')
  })
})

describe('gowinDefaultCellOutputArcs — both of a cell’s outputs, and only where no fuse selects', () => {
  const arcs = gowinDefaultCellOutputArcs(pipdb)

  test('every arc it reports really has an EMPTY bit list in the database', () => {
    // Treating a fused arc as a power-up one would report a connection whatever the bitstream says.
    for (const [ttyp, list] of arcs) {
      const tables = pipdb.get(ttyp)
      for (const arc of list) {
        const sources =
          tables?.pips.get(arc.destination) ?? tables?.clockPips.get(arc.destination) ?? new Map()
        expect(sources.get(arc.source), `ttyp ${ttyp} ${arc.destination} <- ${arc.source}`).toEqual(
          [],
        )
      }
    }
  })

  test('it finds both families, in the numbers the database holds', () => {
    // The `F<n>` family is the one that was missing entirely. Counted from
    // `fixtures/gowin-gw1n1-pips.json`, whose 77,477 arcs include 3,282 with an empty bit list.
    let registerArcs = 0
    let lutArcs = 0
    for (const list of arcs.values())
      for (const arc of list) {
        if (/^Q\d+$/.test(arc.source)) registerArcs += 1
        if (/^F\d+$/.test(arc.source)) lutArcs += 1
      }
    expect(registerArcs).toBe(1868)
    expect(lutArcs).toBe(900)
  })

  test('the `VCC` power-up sources are deliberately left out', () => {
    // Reading those as connections would hold every unrouted set/reset high, which contradicts what this
    // decode says today, and nothing here settles which is right. Stated as a test so the omission is a
    // decision rather than an oversight.
    for (const list of arcs.values()) for (const arc of list) expect(arc.source).not.toBe('VCC')
  })
})

describe('every recovered chip input is a port the source design declares', () => {
  // The rule neither defect could have survived. Every bitstream here has its source Verilog committed beside
  // it, so "how many signals really enter this chip" is knowable and does not have to be taken on trust.
  const WITH_SOURCE = [
    'dense',
    'pairmix',
    'splitout',
    'splitmix',
    'splitkeep',
    'splitpad',
    'mux8',
    'muxreg',
    'muxsel',
    'muxconst',
    'muxzero',
    'muxvcc',
    'widemux',
    'muxlatch',
    'longwire',
    'longwiremux',
    'passlut',
    // The BLOCK-MEMORY design, and the reason this list could not reach the defect it was written for.
    // `gowin-gw1n1-bram1k.fs` has been in this repository throughout and violated the rule below on eight
    // wires — but it has no source file beside it, so it could not be listed here and nothing checked it.
    // `bramlogic` is two memories with combinational logic beside them on their own pins, built for this, so
    // both halves are checkable: the memories must be refused and their readers marked, and the logic must
    // still come back right.
    'bramlogic',
    // The memory the main tile CANNOT SEE. `gowin_pack` writes `CSA_i` only where bit `i` of the `BLK_SEL`
    // parameter is 0, so `BLK_SEL = 3'b111` writes none of the three — and with them gone this design's main
    // tile decodes to nothing at all, so a detector reading the main tile alone finds no memory here.
    // `gowin-gw1n1-blkselhide.v` instantiates the `SP` primitive with exactly that, nextpnr places it (its own
    // placement is committed beside the bitstream), and before the auxiliary tiles were consulted this whole
    // design reported `0 refused / 0 incomplete / 0 untrusted` with eight invented switches on it.
    'blkselhide',
  ] as const

  for (const name of WITH_SOURCE)
    test(`${name}: no more chip inputs than the source has input ports`, () => {
      const design = decode(name)
      const ports = declaredInputPorts(name)
      expect(ports.length).toBeGreaterThan(0)
      // Fewer is legitimate — a clock is not a net of the recovered netlist, and the synthesiser drops a port
      // its logic does not use. MORE is never legitimate: it is a signal the silicon does not have.
      //
      // COUNTED ON THE INPUTS THAT REACH A PIN, because a design with something refused legitimately has
      // more. Refusing a LOOKUP TABLE leaves the wire it drove with nothing behind it, and that wire is
      // offered as an input — an input the reader has SAID is not a signal of the chip, sitting in the middle
      // of the fabric where no package pin is. `bramlogic` has thirty-one inputs against twenty-nine declared
      // ports, and three of the thirty-one are those. The count that means anything is the other twenty-eight.
      //
      // A refused BLOCK MEMORY is no longer among them: its data outputs are not offered as inputs at all, so
      // `bramlogic` lost eight of the thirty-nine it used to report and `blkselhide` lost eight of thirteen.
      //
      // The strict form still holds wherever nothing was refused, which is seventeen of these nineteen
      // designs, so this is not the rule loosened — it is the rule applied to the right set.
      const located = gowinDesignPins(design.primaryWires, pins)
      expect(located.size, `${name}: ports ${ports.join(' ')}`).toBeLessThanOrEqual(ports.length)
      if (design.unsupported.length === 0)
        expect(design.primaryWires.size, `${name}: ports ${ports.join(' ')}`).toBe(located.size)
    })

  for (const name of WITH_SOURCE)
    test(`${name}: a clean report means every chip input arrives on a package pin`, () => {
      // A signal entering the chip arrives at an I/O block on the edge of the die. A trace ending in the
      // middle of the fabric has not reached a pin, it has run out of routing — which is what both defects
      // looked like, and `dense` used to end that way on 226 tiles.
      //
      // A design that REFUSES a part is a different case and not always a defect: the wires that part drove
      // really do have nothing behind them.
      //
      // THIS RULE WAS DISARMED AND IS NOW BACK. It used to read "a design with something stranded must have at
      // least one distrusted part", which any design that refuses anything satisfies with ONE — so a block
      // memory's eight invented switches rode along unchecked for as long as one other part carried a warning.
      // Every stranded wire is now named, per design, with what it is; a design not listed here must strand
      // NOTHING. Two of these nineteen designs strand anything at all, and neither strands a memory output.
      const STRANDED: Record<string, string[]> = {
        // a level-sensitive latch and the wide multiplexer above it, both refused — see the test below
        muxlatch: ['R8C9_OF0', 'R8C9_Q0'],
        // an erased flip-flop and two power-up-arc wires, all three named in the test below. Its two memories
        // strand nothing: their data outputs are not offered as inputs at all.
        bramlogic: ['R5C3_E27', 'R5C5_X07', 'R5C6_Q5'],
      }
      const design = decode(name)
      const located = gowinDesignPins(design.primaryWires, pins)
      const stranded = [...design.primaryWires.entries()]
        .filter(([net]) => !located.has(net))
        .map(([, wire]) => wire)
        .sort()
      expect(stranded, name).toEqual(STRANDED[name] ?? [])
    })

  test('NO chip input is ever invented for a block memory, in any file here', () => {
    // THE RULE THIS WHOLE THING IS FOR, and the one that needs no source file — so it reaches `bram1k`, the
    // one shipped fixture that violated it and the one `WITH_SOURCE` cannot list.
    //
    // A block memory's tiles hold no lookup tables — `BSRAM` and `BSRAM_AUX` are the only cells their tile
    // types declare — so a recovered chip input whose wire sits on one of them is a memory output and nothing
    // else. Eight such wires on `bram1k` and eight on `bramlogic` were offered as switches you could set to
    // 0 V or 5 V, on tiles with no package pin under any package. There must now be NONE, in any of the
    // twenty-six bitstreams committed here.
    const memoryTiles = new Set<string>()
    for (let row = 0; row < db.rows; row++)
      for (let col = 0; col < db.cols; col++)
        if ((gowinTileAt(db, row, col)?.bels ?? []).some((bel) => bel.startsWith('BSRAM')))
          memoryTiles.add(`R${row + 1}C${col + 1}`)
    expect(memoryTiles.size).toBe(18)

    expect(ALL_GOWIN.length).toBe(26)
    for (const name of ALL_GOWIN) {
      const design = decode(name)
      const onMemoryTile = [...design.primaryWires.values()].filter((wire) =>
        memoryTiles.has(wire.slice(0, wire.lastIndexOf('_'))),
      )
      expect(onMemoryTile, name).toEqual([])
    }
  })

  test('every part whose value depends on a block memory is marked — however far away', () => {
    // The other half, and the one a warning that stops at the direct readers fails. A part reading a part that
    // reads the memory computes a value decided by something that is not there just as surely.
    //
    // Measured by flipping the value every `unreadable` pin carries and re-simulating: on `blkselhide`,
    // eighteen parts change value. Sixteen read the memory directly; the other two do not, and before the
    // marking was made to follow the wires they carried no warning at all.
    for (const name of ALL_GOWIN) {
      const design = decode(name)
      const marked = new Set(design.distrusted.map((entry) => cellKey(entry.ref)))
      const byRef = new Map(design.netlist.cells.map((cell) => [cellKey(cell.ref), cell]))
      const readsUnreadable = (key: string): boolean => {
        const cell = byRef.get(key)
        if (cell === undefined) return false
        return [
          ...cell.inputs,
          ...(cell.carryOperands ?? []),
          cell.setReset,
          cell.clockEnable,
        ].some((source) => source?.kind === 'unreadable')
      }
      // every direct reader, and then everything that reads a marked part
      for (const cell of design.netlist.cells) {
        const key = cellKey(cell.ref)
        if (readsUnreadable(key))
          expect(marked.has(key), `${name}: ${key} reads a memory`).toBe(true)
        const feeders = [
          ...cell.inputs,
          ...(cell.carryOperands ?? []),
          cell.setReset,
          cell.clockEnable,
        ]
        for (const source of feeders) {
          if (source == null) continue
          if (source.kind !== 'cell' && source.kind !== 'carry') continue
          if (!marked.has(cellKey(source.driver))) continue
          expect(
            marked.has(key),
            `${name}: ${key} reads the marked ${cellKey(source.driver)}`,
          ).toBe(true)
        }
      }
    }
  })

  test('bramlogic: every wire left with nothing behind it, and what each one is', () => {
    // The exhaustive form of the rule above, so that nothing this design strands is merely tolerated.
    //
    // THIS LIST USED TO HOLD ELEVEN WIRES and eight of them were the two memories' data outputs, four each —
    // `R6C5_F0`..`F3` from the single-port memory and `R6C14_Q0`..`Q3` from the one written on one port and
    // read on the other, which is the whole reason this design holds two. `gowin_unpack` reading the same file
    // names the first wire of each: `.DO0(R6C5_F0)` and `.DO18(R6C14_Q0)`. All eight are gone: a wire a
    // refused memory drives is no longer offered as an input, so the parts reading them get an `unreadable`
    // pin and no switch. The three that remain are NOT a memory and are not fixed here; they are the two
    // omissions this reader already declares, named so that a change to either becomes a failing test rather
    // than a silent one:
    //
    //   R5C6_Q5    a flip-flop whose lookup table has no fuse blown. Reading `0xffff` it is dropped as erased
    //              (`decodeGowinLuts`), which takes its flip-flop with it — `gowin_unpack` reading the same
    //              file emits `DFFE R5C6_DFFE_5` with no `LUT4` at that position beside it.
    //   R5C3_E27   wires whose multiplexer POWERS UP reading the supply rail. Those arcs are deliberately not
    //   R5C5_X07   followed — see "the `VCC` power-up sources are deliberately left out" above — and
    //              `gowin_unpack` writes `assign R5C3_E27 = VCC;` and `assign R5C5_X07 = VCC;`.
    const design = decode('bramlogic')
    const located = gowinDesignPins(design.primaryWires, pins)
    const stranded = [...design.primaryWires.entries()]
      .filter(([net]) => !located.has(net))
      .map(([, wire]) => wire)
      .sort()
    expect(stranded).toEqual(['R5C3_E27', 'R5C5_X07', 'R5C6_Q5'])
    expect(design.unsupported.map((entry) => entry.kind)).toEqual(['BSRAM', 'BSRAM'])
    expect(design.distrusted).toHaveLength(12)
    // and the eight that went are readers of the memories, marked, with no switch anywhere
    const unreadable = design.netlist.cells.flatMap((cell) =>
      cell.inputs.filter((source) => source.kind === 'unreadable'),
    )
    expect(
      [...new Set(unreadable.map((source) => (source as { wire: string }).wire))].sort(),
    ).toEqual([
      'R6C14_Q0',
      'R6C14_Q1',
      'R6C14_Q2',
      'R6C14_Q3',
      'R6C5_F0',
      'R6C5_F1',
      'R6C5_F2',
      'R6C5_F3',
    ])
  })

  test('blkselhide: the hidden memory, refused, with nothing invented and everything marked', () => {
    // The design the whole change is for. `nextpnr-himbaechel` placed an `SP` block memory at `X4Y5/BSRAM`
    // with `BLK_SEL = 3'b111` — its own placement is committed as `gowin-gw1n1-blkselhide-placement.json` —
    // and the reader saw nothing there at all: `0 refused / 0 incomplete / 0 untrusted`, with eight of its
    // thirteen chip inputs sitting on the memory's own tiles.
    //
    // `gowin_unpack` IS NOT THE ORACLE HERE, and that is worth stating rather than assuming: it reports a
    // BSRAM only where the `BSRAM_SP` table decodes non-empty, which is exactly the blind spot this design
    // exposes, and it finds ZERO memories in this file. nextpnr's placement is the ground truth.
    const placement = JSON.parse(text('gowin-gw1n1-blkselhide-placement.json')) as {
      blockMemoryBels: Record<string, { kind: string; blkSel: string }>
    }
    expect(Object.keys(placement.blockMemoryBels)).toEqual(['X4Y5/BSRAM'])
    expect(placement.blockMemoryBels['X4Y5/BSRAM']?.blkSel).toBe('111')

    const design = decode('blkselhide')
    // X4Y5 is column 4, row 5 — the refusal has to land on that tile and nowhere else
    expect(
      design.unsupported.map((entry) => `${entry.kind} ${entry.ref.x},${entry.ref.y}`),
    ).toEqual(['BSRAM 4,5'])
    const located = gowinDesignPins(design.primaryWires, pins)
    expect(design.primaryWires.size).toBe(5)
    expect(located.size).toBe(5)
    // the logic beside the memory is untouched: its twenty-five parts are all still here
    expect(design.netlist.cells).toHaveLength(25)
    expect(design.distrusted).toHaveLength(20)
    expect(new Set(design.distrusted.map((entry) => entry.kind))).toEqual(
      new Set(['unreadable-input', 'depends-on-untrusted']),
    )
  })

  test('muxlatch strands an input, and it is the refusal that does it', () => {
    // Named rather than left as a hole in the rule above. `gowin-gw1n1-muxlatch.fs` holds a level-sensitive
    // latch and a wide multiplexer above it, both refused, and the two wires they drove are what is left with
    // nothing behind them — the tile is in the middle of the fabric and carries no package pin at all.
    const design = decode('muxlatch')
    const located = gowinDesignPins(design.primaryWires, pins)
    const stranded = [...design.primaryWires.entries()]
      .filter(([net]) => !located.has(net))
      .map(([, wire]) => wire)
      .sort()
    expect(stranded).toEqual(['R8C9_OF0', 'R8C9_Q0'])
    expect(design.unsupported.map((entry) => entry.kind).sort()).toEqual(['DL', 'MUX2_LUT5'])
    expect(design.distrusted).toHaveLength(1)
  })

  for (const name of WITH_SOURCE)
    test(`${name}: none of them is a long wire or a lookup table’s own input pin`, () => {
      // The two defects named, as the shapes they left behind. `RxCy_LB21` is a wire that crosses the die;
      // `RxCy_C6` is the C pin of the lookup table at position 6 of that tile. Neither can be a package pin.
      const design = decode(name)
      for (const wire of design.primaryWires.values()) {
        expect(wire, name).not.toMatch(/_LB\d1?$/)
        expect(wire, name).not.toMatch(/_[ABCD]\d$/)
      }
    })

  for (const name of ['longwire', 'longwiremux', 'passlut'] as const)
    test(`${name}: each chip input is a DIFFERENT declared input port, named by its pin`, () => {
      // The exact form of the rule, for the two designs whose pins are constrained. No searching: the
      // constraint file says which port is on which pin, and the pinout says which pins are on the tile a
      // recovered input's wire belongs to.
      const design = decode(name)
      const constraints = pinConstraints(name)
      const inputs = new Set(declaredInputPorts(name))
      const claimed = new Set<string>()
      for (const [, entry] of gowinDesignPins(design.primaryWires, pins)) {
        const ports = new Set(
          entry.candidates.map((pin) => constraints.get(pin)).filter((port) => port !== undefined),
        )
        expect(ports.size, `${name} ${entry.wire} on pins ${entry.candidates.join('/')}`).toBe(1)
        const port = [...ports][0] as string
        expect(inputs.has(port), `${name} ${entry.wire} -> ${port}`).toBe(true)
        expect(claimed.has(port), `${name}: two chip inputs both claim ${port}`).toBe(false)
        claimed.add(port)
      }
      expect(claimed.size).toBe(design.primaryWires.size)
    })
})

describe('the two designs compute what their own Verilog computes', () => {
  // The proof that matters. Everything above counts and classifies; this runs the recovered netlist.
  //
  // The golden values are Icarus Verilog's, run on the source beside the bitstream with the Gowin cell models
  // yosys ships (`share/yosys/gowin/cells_sim.v`), over every one of the 256 input vectors — so the whole of
  // each design's behaviour is pinned, not a sample of it.
  const CASES = [
    {
      name: 'longwire',
      // `input en, input [6:0] a` — `en` is the high bit of the vector, `a[k]` the rest.
      bitOf: (port: string): number => (port === 'en' ? 7 : Number(/\[(\d+)\]/.exec(port)?.[1])),
      outputs: ['y'],
    },
    {
      // The same shape, built WITHOUT `-nowidelut`, so its output leaves the fabric through a wide
      // multiplexer — the one combination nothing else here covers, and the one the segment table touches
      // directly: a segment's gate wire is `A6`/`A7`, which is also where a power-up arc lands.
      name: 'longwiremux',
      bitOf: (port: string): number => (port === 'en' ? 7 : Number(/\[(\d+)\]/.exec(port)?.[1])),
      outputs: ['y'],
    },
    {
      name: 'passlut',
      bitOf: (port: string): number => Number(/\[(\d+)\]/.exec(port)?.[1]),
      outputs: ['y', 'z'],
    },
  ] as const

  for (const { name, bitOf, outputs } of CASES)
    test(`${name}: every one of the 256 input vectors`, () => {
      const design = decode(name)
      expect(design.unsupported).toHaveLength(0)
      expect(design.distrusted).toHaveLength(0)
      const constraints = pinConstraints(name)
      const portOfNet = new Map<number, string>()
      for (const [net, entry] of gowinDesignPins(design.primaryWires, pins)) {
        const ports = new Set(
          entry.candidates.map((pin) => constraints.get(pin)).filter((port) => port !== undefined),
        )
        portOfNet.set(net, [...ports][0] as string)
      }
      expect(portOfNet.size).toBe(design.primaryWires.size)

      const sinks = sinksOf(design)
      expect(sinks).toHaveLength(outputs.length)
      const golden = JSON.parse(text(`gowin-gw1n1-${name}-vectors.json`)) as Record<
        string,
        number[]
      >

      // Which recovered sink is which output is not knowable from the bitstream — nothing says which part
      // drives which package pin — so every assignment of sinks to outputs is tried and one must reproduce
      // every output on every vector.
      const agreement = new Map<string, Set<string>>()
      for (const output of outputs) {
        expect(golden[output]).toHaveLength(256)
        agreement.set(output, new Set())
      }
      for (const sink of sinks) {
        const computed: number[] = []
        for (let vector = 0; vector < 256; vector++) {
          const primary = new Map<number, boolean>()
          for (const [net, port] of portOfNet) primary.set(net, ((vector >> bitOf(port)) & 1) === 1)
          const run = simulateCombinational(design.netlist, primary)
          computed.push(run.outputs.get(sink) === true ? 1 : 0)
        }
        for (const output of outputs)
          if (computed.every((bit, vector) => bit === (golden[output] as number[])[vector]))
            (agreement.get(output) as Set<string>).add(sink)
      }
      for (const output of outputs)
        expect(
          [...(agreement.get(output) as Set<string>)],
          `${name}.${output}: no recovered part reproduces it`,
        ).not.toEqual([])
      // and the assignment is one-to-one, so two outputs cannot both be explained by one part
      expect(
        new Set(outputs.map((output) => [...(agreement.get(output) as Set<string>)][0])).size,
      ).toBe(outputs.length)
    })
})

describe('refusing a block memory leaves the logic beside it intact', () => {
  /**
   * The proof that the refusal did not erase real hardware — the direction an over-broad refusal fails in.
   *
   * `gowin-gw1n1-bramlogic.v` is two 1024-by-4 memories with two combinational outputs beside them on their
   * own pins: `y = (a & b) | ~c` and `z = a ^ b ^ c`. Both memories are refused, twelve parts are marked as
   * reading one — and `y` and `z` must still come back computing what the source says, on every one of the
   * eight settings of their three inputs. The golden values are Icarus Verilog's, run on that source.
   *
   * Every chip input other than `a`, `b` and `c` is driven BOTH WAYS, and the answer has to be the same
   * either way: `y` and `z` do not depend on a memory in the source, so a recovery that let them depend on
   * one would be wrong however it happened to come out with those inputs left at zero.
   */
  const design = decode('bramlogic')
  const golden = JSON.parse(text('gowin-gw1n1-bramlogic-vectors.json')) as Record<string, number[]>

  test('both memories are refused and their readers marked, and the logic is left alone', () => {
    expect(design.unsupported.map((entry) => entry.kind)).toEqual(['BSRAM', 'BSRAM'])
    expect(design.distrusted).toHaveLength(12)
    expect(design.netlist.cells).toHaveLength(51)
  })

  test('y and z compute what their own Verilog computes, whatever the memory is doing', () => {
    // `a`, `b` and `c` are the only three ports of this design on a package pin that its tile carries alone,
    // which is what makes "this net is that port" an answer rather than a choice: 33 ports share 19 tiles on
    // this package, so most tiles carry several and a net landing on one of those names no single port.
    const constraints = pinConstraints('bramlogic')
    const bitOf = new Map<number, number>()
    for (const [net, entry] of gowinDesignPins(design.primaryWires, pins)) {
      const ports = new Set(
        entry.candidates.map((pin) => constraints.get(pin)).filter((port) => port !== undefined),
      )
      if (ports.size !== 1) continue
      const bit = 'abc'.indexOf([...ports][0] as string)
      if (bit >= 0) bitOf.set(net, bit)
    }
    expect([...bitOf.values()].sort()).toEqual([0, 1, 2])

    // Every other chip input is driven BOTH WAYS below, and the two runs have to agree — so a part that came
    // out depending on the memory, or on anything else this reader could not follow, cannot pass.
    const marked = new Set(design.distrusted.map((entry) => cellKey(entry.ref)))
    const trusted = design.netlist.cells.filter((cell) => !marked.has(cellKey(cell.ref)))
    expect(trusted).toHaveLength(39)

    const agreement = new Map<string, Set<string>>()
    for (const output of ['y', 'z']) {
      expect(golden[output]).toHaveLength(8)
      agreement.set(output, new Set())
    }
    const run = (sink: string, rest: boolean): number[] =>
      Array.from({ length: 8 }, (_, vector) => {
        const primary = new Map<number, boolean>()
        for (const net of design.primaryWires.keys())
          primary.set(
            net,
            bitOf.has(net) ? ((vector >> (bitOf.get(net) as number)) & 1) === 1 : rest,
          )
        return simulateCombinational(design.netlist, primary).outputs.get(sink) === true ? 1 : 0
      })
    for (const cell of trusted) {
      const sink = cellKey(cell.ref)
      const low = run(sink, false)
      const high = run(sink, true)
      if (!low.every((bit, vector) => bit === high[vector])) continue
      for (const output of ['y', 'z'])
        if (low.every((bit, vector) => bit === (golden[output] as number[])[vector]))
          (agreement.get(output) as Set<string>).add(sink)
    }
    for (const output of ['y', 'z'])
      expect(
        [...(agreement.get(output) as Set<string>)],
        `bramlogic.${output}: no recovered part reproduces it`,
      ).toHaveLength(1)
    expect(
      new Set(['y', 'z'].map((output) => [...(agreement.get(output) as Set<string>)][0])).size,
    ).toBe(2)
  })

  test('blkselhide: the same, for the memory the main tile cannot see', () => {
    // The same proof for the design whose memory is hidden by `BLK_SEL = 3'b111`. It carries the same two
    // combinational outputs beside the memory — `y = (a & b) | ~c` and `z = a ^ b ^ c` — and they must still
    // come back right now that the memory is found and refused, on all eight settings of their three inputs.
    // Golden values from Icarus Verilog on `gowin-gw1n1-blkselhide.v` with the Gowin cell models, driven by
    // `gowin-gw1n1-blkselhide-tb.v`.
    const hidden = decode('blkselhide')
    const goldenHidden = JSON.parse(text('gowin-gw1n1-blkselhide-vectors.json')) as Record<
      string,
      number[]
    >
    const constraints = pinConstraints('blkselhide')
    const bitOf = new Map<number, number>()
    for (const [net, entry] of gowinDesignPins(hidden.primaryWires, pins)) {
      const ports = new Set(
        entry.candidates.map((pin) => constraints.get(pin)).filter((port) => port !== undefined),
      )
      if (ports.size !== 1) continue
      const bit = 'abc'.indexOf([...ports][0] as string)
      if (bit >= 0) bitOf.set(net, bit)
    }
    expect([...bitOf.values()].sort()).toEqual([0, 1, 2])

    const marked = new Set(hidden.distrusted.map((entry) => cellKey(entry.ref)))
    const trusted = hidden.netlist.cells.filter((cell) => !marked.has(cellKey(cell.ref)))
    expect(trusted).toHaveLength(5)

    const agreement = new Map<string, Set<string>>()
    for (const output of ['y', 'z']) {
      expect(goldenHidden[output]).toHaveLength(8)
      agreement.set(output, new Set())
    }
    const run = (sink: string, rest: boolean): number[] =>
      Array.from({ length: 8 }, (_, vector) => {
        const primary = new Map<number, boolean>()
        for (const net of hidden.primaryWires.keys())
          primary.set(
            net,
            bitOf.has(net) ? ((vector >> (bitOf.get(net) as number)) & 1) === 1 : rest,
          )
        return simulateCombinational(hidden.netlist, primary).outputs.get(sink) === true ? 1 : 0
      })
    for (const cell of trusted) {
      const sink = cellKey(cell.ref)
      const low = run(sink, false)
      const high = run(sink, true)
      if (!low.every((bit, vector) => bit === high[vector])) continue
      for (const output of ['y', 'z'])
        if (low.every((bit, vector) => bit === (goldenHidden[output] as number[])[vector]))
          (agreement.get(output) as Set<string>).add(sink)
    }
    for (const output of ['y', 'z'])
      expect(
        [...(agreement.get(output) as Set<string>)],
        `blkselhide.${output}: no recovered part reproduces it`,
      ).toHaveLength(1)
    expect(
      new Set(['y', 'z'].map((output) => [...(agreement.get(output) as Set<string>)][0])).size,
    ).toBe(2)
  })
})

describe('a long wire whose driver cannot be named is SAID, not invented', () => {
  // The other direction, and the one an incomplete fix skips: when the join cannot be made, the parts reading
  // that wire must be marked. Reached by handing the reader the same device with its segment table removed,
  // which is the state this decoder was in before — the table is what closes the hop, and nothing else can.
  const withoutSegments = parseGowinChipdb(
    chipdbText.replace(/,"segments":\{.*?\}\}(?=,"tile_types")/s, ''),
  )

  test('the stripped chip description really is the same device minus the segments', () => {
    expect(withoutSegments.segments.size).toBe(0)
    expect(db.segments.size).toBe(8)
    expect(withoutSegments.rows).toBe(db.rows)
    expect(withoutSegments.cols).toBe(db.cols)
    expect(withoutSegments.tileTypes.size).toBe(db.tileTypes.size)
  })

  test('every part reading an unresolved long wire is marked untrustworthy', () => {
    const design = decode('longwire', withoutSegments)
    // the parts are all still there — refusing to name a driver must not erase hardware
    expect(design.netlist.cells).toHaveLength(decode('longwire').netlist.cells.length)
    // the long wires really are back, and in the numbers that made this worth fixing
    // 47 long wires plus four ordinary ones, against the 8 package pins the design really has. Not the 59
    // this reader once produced for it: the power-up arcs are still being followed here, and only the
    // segment table has been taken away.
    const branches = [...design.primaryWires.values()].filter((wire) => /_LB\d1$/.test(wire))
    expect(branches).toHaveLength(47)
    expect(design.primaryWires.size).toBe(51)
    expect(design.distrusted.length).toBeGreaterThan(0)
    for (const wire of branches) {
      const reader = design.distrusted.find((entry) => entry.reason.includes(wire))
      expect(reader, `${wire} is offered as a chip input with nothing said about it`).toBeDefined()
    }
    // 48 parts read one of those wires directly. The other 17 read one of the 48 — and until the marking was
    // made to follow the wires they carried no warning at all, which is the same "one level deep" failure the
    // block memory had. 65 of 65 parts are now marked, which is right: every part of this design is downstream
    // of a wire whose driver could not be named.
    const kinds = design.distrusted.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.kind] = (counts[entry.kind] ?? 0) + 1
      return counts
    }, {})
    expect(kinds).toEqual({ 'invented-input': 48, 'depends-on-untrusted': 17 })
    expect(design.distrusted).toHaveLength(design.netlist.cells.length)
    expect(design.distrusted.some((entry) => entry.reason.includes('long wire'))).toBe(true)
  })
})
