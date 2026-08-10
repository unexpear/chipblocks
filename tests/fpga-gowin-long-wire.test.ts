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
import { readFileSync } from 'node:fs'
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
    // `gowin-gw1n1-bram1k.fs` has been in this repository throughout and violates the rule below on eight
    // wires — but it has no source file beside it, so it could not be listed here and nothing checked it.
    // `bramlogic` is two memories with combinational logic beside them on their own pins, built for this, so
    // both halves are checkable: the memories must be refused and their readers marked, and the logic must
    // still come back right.
    'bramlogic',
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
      // more. Refusing a part leaves the wire it drove with nothing behind it, and that wire is offered as an
      // input — an input the reader has SAID is not a signal of the chip, sitting in the middle of the fabric
      // where no package pin is. `bramlogic` has thirty-nine inputs against twenty-nine declared ports, and
      // eleven of the thirty-nine are those. The count that means anything is the other twenty-eight.
      //
      // The strict form still holds wherever nothing was refused, which is sixteen of these seventeen
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
      // A design that REFUSES a part is a different case and not a defect: the wires that part drove really
      // do have nothing behind them, which is why they are offered as inputs, and the reader says so. So the
      // rule is tied to the report the user is shown — a design claiming nothing is wrong must have nothing
      // stranded, and a design with something stranded must be saying so.
      const design = decode(name)
      const located = gowinDesignPins(design.primaryWires, pins)
      const stranded = [...design.primaryWires.entries()]
        .filter(([net]) => !located.has(net))
        .map(([, wire]) => wire)
      if (design.unsupported.length === 0) expect(stranded, name).toEqual([])
      else if (stranded.length > 0) expect(design.distrusted.length, name).toBeGreaterThan(0)
    })

  test('every part reading a wire a BLOCK MEMORY drives is marked untrustworthy', () => {
    // The rule the shipped block-memory fixture broke, and the one a count of chip inputs cannot catch.
    //
    // A block memory's tiles hold no lookup tables — `BSRAM` and `BSRAM_AUX` are the only cells their tile
    // types declare — so a recovered chip input whose wire sits on one of them is a memory output and nothing
    // else. Before this, eight such wires on `bram1k` were offered as switches with nothing anywhere saying
    // so; the parts reading them looked like ordinary parts with one more input.
    const memoryTiles = new Set<string>()
    for (let row = 0; row < db.rows; row++)
      for (let col = 0; col < db.cols; col++)
        if ((gowinTileAt(db, row, col)?.bels ?? []).some((bel) => bel.startsWith('BSRAM')))
          memoryTiles.add(`R${row + 1}C${col + 1}`)
    expect(memoryTiles.size).toBeGreaterThan(0)

    for (const name of WITH_SOURCE) {
      const design = decode(name)
      const fromMemory = new Set<number>()
      for (const [net, wire] of design.primaryWires)
        if (memoryTiles.has(wire.slice(0, wire.lastIndexOf('_')))) fromMemory.add(net)
      if (fromMemory.size === 0) continue
      // the memory itself is refused, and named as a memory
      expect(
        design.unsupported.some((entry) => entry.kind === 'BSRAM'),
        name,
      ).toBe(true)
      const marked = new Set(design.distrusted.map((entry) => cellKey(entry.ref)))
      for (const cell of design.netlist.cells) {
        const reads = [
          ...cell.inputs,
          ...(cell.carryOperands ?? []),
          cell.setReset,
          cell.clockEnable,
        ]
        if (!reads.some((source) => source?.kind === 'primary' && fromMemory.has(source.net)))
          continue
        expect(
          marked.has(cellKey(cell.ref)),
          `${name}: ${cellKey(cell.ref)} reads the memory`,
        ).toBe(true)
      }
    }
  })

  test('bramlogic: every wire left with nothing behind it, and what each one is', () => {
    // The exhaustive form of the rule above, so that nothing this design strands is merely tolerated.
    //
    // Eleven wires end up with nothing driving them and all eleven are accounted for. Eight are the two
    // memories' data outputs, four each — and the two memories present them on DIFFERENT wires, which is the
    // whole reason this design holds two. The single-port one at `R6C5` puts its four bits on `F0`..`F3`; the
    // one written on one port and read on the other, at `R6C14`, puts them on `Q0`..`Q3`. `gowin_unpack`
    // reading the same file names the first wire of each: `.DO0(R6C5_F0)` and `.DO18(R6C14_Q0)`.
    //
    // The other three are NOT a memory and are not fixed here; they are the two omissions this reader already
    // declares, named so that a change to either becomes a failing test rather than a silent one:
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
    expect(stranded).toEqual([
      'R5C3_E27',
      'R5C5_X07',
      'R5C6_Q5',
      'R6C14_Q0',
      'R6C14_Q1',
      'R6C14_Q2',
      'R6C14_Q3',
      'R6C5_F0',
      'R6C5_F1',
      'R6C5_F2',
      'R6C5_F3',
    ])
    expect(design.unsupported.map((entry) => entry.kind)).toEqual(['BSRAM', 'BSRAM'])
    expect(design.distrusted).toHaveLength(12)
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
    for (const entry of design.distrusted) expect(entry.kind).toBe('invented-input')
    expect(design.distrusted.some((entry) => entry.reason.includes('long wire'))).toBe(true)
  })
})
