/**
 * FPGA fabric — Gowin: the BLOCK MEMORY, and why it is refused rather than recovered.
 *
 * A block memory is a bank of memory built into the chip, and a design that uses one has a piece nothing here
 * can express: the shared recovered cell is a four-input lookup table with one flip-flop beside it, and there
 * is no memory in it at all. That on its own would only have meant a missing part. What it actually meant was
 * a WRONG PICTURE reported as a right one — the memory's data outputs are wires nothing else drives, so the
 * backward trace walked into each of them, found nothing, and minted a chip input: a switch offered to the
 * user, on a tile in the middle of the fabric that carries no package pin, feeding a part that then computed
 * something the chip does not.
 *
 * Measured on `fixtures/gowin-gw1n1-bram1k.fs`, which has been in this repository throughout: twelve chip
 * inputs, ELEVEN of them stranded, eight of those eleven the memory's own data outputs — and the report said
 * nothing refused, nothing incomplete, nothing untrustworthy. `tests/fpga-gowin-door.test.ts` listed it among
 * the designs "with nothing to declare", and `tests/fpga-gowin-wide-mux.test.ts` pinned its numbers as right.
 *
 * WHY REFUSING IS THE ANSWER AND NOT A HALF-MEASURE. Two of the three things needed to say what a memory puts
 * on its outputs are out of reach, and one of them is a fact about the bits rather than about our effort:
 * WHICH of the memory's two ports is wired for reading and which for writing cannot be told from the file at
 * all. The four attribute tables that would say (`BSRAM_SP`, `_DP`, `_SDP`, `_ROM`) cover byte-identical bit
 * coordinates on this fabric, so all four decode for a memory that is only ever one of them — stated and
 * tested at `decodeGowinBlockMemory`. A recovered memory would have to guess that, and a correct refusal
 * beats a plausible guess.
 *
 * THE ORACLE. `gowin_unpack` (Project Apicula 0.33.dev19+gdfb3c8702), a second and independent reader of the
 * same files, is what the wire names below are pinned against — it emits one `BSRAM` instance per memory and
 * names the first data output of each `.DO0(R6C5_F0)` for the main tile's plain outputs and `.DO18(R6C14_Q0)`
 * for its registered ones.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  decodeGowinBlockMemory,
  parseGowinAttributeDatabase,
} from '../src/renderer/fpga-apicula-attributes.ts'
import {
  extractGowinTileBits,
  gowinTileAt,
  parseGowinChipdb,
} from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'
import {
  GOWIN_BLOCK_MEMORY_AUXILIARY_BEL,
  GOWIN_BLOCK_MEMORY_BEL,
  GOWIN_BLOCK_MEMORY_OFFSET,
  GOWIN_BLOCK_MEMORY_OUTPUTS,
  gowinBlockMemoryRef,
  gowinBlockMemoryTiles,
  gowinFixedAliases,
  gowinPartPlace,
  parseGowinWireAliases,
  reconstructGowinNetlist,
} from '../src/renderer/fpga-apicula-netlist.ts'
import { parseGowinPipDatabase } from '../src/renderer/fpga-apicula-routing.ts'

const at = (name: string): URL => new URL(`../fixtures/${name}`, import.meta.url)
const text = (name: string): string => readFileSync(at(name), 'utf8')

const db = parseGowinChipdb(text('gowin-gw1n1-chipdb.json'))
const pipdb = parseGowinPipDatabase(text('gowin-gw1n1-pips.json'))
const attributes = parseGowinAttributeDatabase(text('gowin-gw1n1-attributes.json'))
const aliases = new Map([
  ...parseGowinWireAliases(text('gowin-gw1n1-nodes.json')),
  ...gowinFixedAliases(db.rows, db.cols),
])

const decode = (name: string) =>
  reconstructGowinNetlist(
    parseGowinBitstream(text(`gowin-gw1n1-${name}.fs`)).frames,
    db,
    pipdb,
    attributes,
    aliases,
  )

/** every Gowin bitstream committed here, so the sweep below is the whole corpus and not a sample */
const ALL_GOWIN = readdirSync(new URL('../fixtures/', import.meta.url))
  .filter((file) => file.startsWith('gowin-gw1n1-') && file.endsWith('.fs'))
  .map((file) => file.slice('gowin-gw1n1-'.length, -'.fs'.length))
  .sort()

/** the two files that hold a block memory, and the tiles the memories sit on */
const WITH_MEMORY: Record<string, string[]> = {
  bram1k: ['R6C2'],
  bramlogic: ['R6C5', 'R6C14'],
}

describe('where a block memory can be, on this device', () => {
  test('four sites, each a main tile followed by exactly two auxiliaries', () => {
    // The shape the whole refusal rests on. A memory is wider than a tile, so it occupies three: one carrying
    // the `BSRAM` cell and two beside it carrying `BSRAM_AUX`.
    const mains: string[] = []
    for (let row = 0; row < db.rows; row++)
      for (let col = 0; col < db.cols; col++) {
        const tile = gowinTileAt(db, row, col)
        if (tile === null || !tile.bels.includes(GOWIN_BLOCK_MEMORY_BEL)) continue
        mains.push(`R${row + 1}C${col + 1}`)
        for (const step of [1, 2])
          expect(
            gowinTileAt(db, row, col + step)?.bels,
            `R${row + 1}C${col + 1} + ${step}`,
          ).toContain(GOWIN_BLOCK_MEMORY_AUXILIARY_BEL)
      }
    expect(mains).toEqual(['R6C2', 'R6C5', 'R6C14', 'R6C17'])
  })

  test('a memory tile holds no lookup table of any kind', () => {
    // This is what makes claiming all of a memory tile's `F` and `Q` wires exactly-scoped rather than
    // over-broad: on those tiles there is no lookup table whose output could be taken away by mistake.
    for (let row = 0; row < db.rows; row++)
      for (let col = 0; col < db.cols; col++) {
        const tile = gowinTileAt(db, row, col)
        if (tile === null || !tile.bels.some((bel) => bel.startsWith('BSRAM'))) continue
        expect(
          tile.bels.filter((bel) => !bel.startsWith('BSRAM')),
          `R${row + 1}C${col + 1}`,
        ).toEqual([])
      }
  })

  test('the tiles one memory takes stop at two auxiliaries, however many follow', () => {
    // The memory at column 5 is followed by SIX unattached `BSRAM_AUX` tiles at columns 8..13 as well as its
    // own two, so a walk that simply ran while the tiles were auxiliaries would swallow a third of the row.
    const auxiliaryEverywhere = () => true
    expect(gowinBlockMemoryTiles({ row: 5, col: 4 }, auxiliaryEverywhere)).toEqual([
      { row: 5, col: 4 },
      { row: 5, col: 5 },
      { row: 5, col: 6 },
    ])
    // and a tile that is not an auxiliary stops it earlier, rather than being claimed anyway
    expect(gowinBlockMemoryTiles({ row: 5, col: 4 }, (_, col) => col === 5)).toEqual([
      { row: 5, col: 4 },
      { row: 5, col: 5 },
    ])
    expect(gowinBlockMemoryTiles({ row: 5, col: 4 }, () => false)).toEqual([{ row: 5, col: 4 }])
  })

  test('on this device it finds the three real tiles of each of the four sites', () => {
    const auxiliaryAt = (row: number, col: number): boolean =>
      (gowinTileAt(db, row, col)?.bels ?? []).includes(GOWIN_BLOCK_MEMORY_AUXILIARY_BEL)
    for (const col of [1, 4, 13, 16])
      expect(gowinBlockMemoryTiles({ row: 5, col }, auxiliaryAt).map((tile) => tile.col)).toEqual([
        col,
        col + 1,
        col + 2,
      ])
  })
})

describe('which files hold one, over the whole corpus', () => {
  test('only the two designs built around a memory report one, and at the right tiles', () => {
    // The negative control that matters: a check that fired on every memory-capable tile would refuse four
    // memories in every design on the device, erasing whatever read those tiles' wires. Twenty-three of the
    // twenty-five files here contain no memory at all.
    expect(ALL_GOWIN.length).toBeGreaterThan(20)
    for (const name of ALL_GOWIN) {
      const frames = parseGowinBitstream(text(`gowin-gw1n1-${name}.fs`)).frames
      const found: string[] = []
      for (let row = 0; row < db.rows; row++)
        for (let col = 0; col < db.cols; col++) {
          const tile = gowinTileAt(db, row, col)
          if (tile === null || !tile.bels.includes(GOWIN_BLOCK_MEMORY_BEL)) continue
          const bits = extractGowinTileBits(frames, db, row, col)
          if (bits === null) continue
          if (decodeGowinBlockMemory(bits, attributes, tile.ttyp).size > 0)
            found.push(`R${row + 1}C${col + 1}`)
        }
      expect(found, name).toEqual(WITH_MEMORY[name] ?? [])
    }
  })

  test('every design without one refuses nothing as a memory, and none of them is the whole corpus', () => {
    let refusals = 0
    for (const name of ALL_GOWIN) {
      const design = decode(name)
      const memories = design.unsupported.filter((entry) => entry.kind === GOWIN_BLOCK_MEMORY_BEL)
      expect(memories, name).toHaveLength((WITH_MEMORY[name] ?? []).length)
      refusals += memories.length
    }
    expect(refusals).toBe(3)
  })
})

describe('what a refused memory says, and what it takes with it', () => {
  test('one refusal per memory, at its own main tile, named as a place a person could look', () => {
    for (const [name, tiles] of Object.entries(WITH_MEMORY)) {
      const design = decode(name)
      const memories = design.unsupported.filter((entry) => entry.kind === GOWIN_BLOCK_MEMORY_BEL)
      expect(
        memories.map((entry) => `R${entry.ref.y + 1}C${entry.ref.x + 1}`),
        name,
      ).toEqual(tiles)
      for (const entry of memories) {
        expect(entry.ref.cell).toBe(GOWIN_BLOCK_MEMORY_OFFSET)
        expect(gowinPartPlace(entry.ref)).toBe(
          `the block memory at column ${entry.ref.x}, row ${entry.ref.y}`,
        )
        // and the reason a person reads says what it is and why it is not here, in words
        expect(entry.reason).toContain('a bank of memory built into the chip')
        expect(entry.reason).toContain('which of the memory’s two ports is wired for reading')
      }
    }
  })

  test('a memory position names a place the chip does not have, and says so differently', () => {
    // The same trap the stored half and the wide multiplexer fell into: a position of 24 is this decode's
    // bookkeeping, and calling it "position 24" would send a user looking at a slice whose positions stop at
    // seven.
    expect(gowinPartPlace(gowinBlockMemoryRef(3, 5))).toBe('the block memory at column 3, row 5')
    expect(gowinPartPlace({ x: 3, y: 5, cell: 0 })).toBe(
      'the logic part at column 3, row 5, position 0',
    )
  })

  test('both families of data-output wire are claimed, and only those', () => {
    // Six plain outputs and six registered ones per tile. Both are needed and both are exercised by the
    // fixtures: the single-port memory of `bramlogic` presents its four bits on `F0`..`F3` and the one written
    // on one port and read on the other presents its four on `Q0`..`Q3`.
    expect([...GOWIN_BLOCK_MEMORY_OUTPUTS].sort()).toEqual([
      'F0',
      'F1',
      'F2',
      'F3',
      'F4',
      'F5',
      'Q0',
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'Q5',
    ])
    const design = decode('bramlogic')
    const stranded = [...design.primaryWires.values()]
    expect(stranded.filter((wire) => wire.startsWith('R6C5_F'))).toHaveLength(4)
    expect(stranded.filter((wire) => wire.startsWith('R6C14_Q'))).toHaveLength(4)
  })

  test('nothing but the memories is refused in either file, so the logic is untouched', () => {
    // The other direction, and the one an over-broad refusal fails: erasing real hardware. `bram1k` keeps all
    // eighteen of its lookup tables and `bramlogic` all fifty-one — refusing a memory takes no logic part
    // away, it only stops the memory's own outputs being sold as switches.
    expect(decode('bram1k').netlist.cells).toHaveLength(18)
    expect(decode('bramlogic').netlist.cells).toHaveLength(51)
    for (const name of Object.keys(WITH_MEMORY)) {
      const design = decode(name)
      expect(design.unsupported.map((entry) => entry.kind).sort(), name).toEqual(
        (WITH_MEMORY[name] as string[]).map(() => GOWIN_BLOCK_MEMORY_BEL),
      )
      expect(design.partial, name).toEqual([])
    }
  })
})
