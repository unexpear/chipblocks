/**
 * FPGA fabric — Gowin: which PACKAGE PINS a recovered design uses.
 *
 * The ground truth here is unusually good. The test bitstreams were built from constraint files written by hand,
 * so the pin each signal was assigned to is known exactly:
 *
 *   XNOR design   clk -> pin 10,  a -> pin 13,  b -> pin 14,  q -> pin 15   (QN48)
 *
 * The decoder is told none of that. It reads a bitstream, follows the routing to where the signals leave the
 * fabric, and has to arrive at the same pins.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { type GowinChipdb, parseGowinChipdb } from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'
import {
  gowinFixedAliases,
  parseGowinWireAliases,
  reconstructGowinNetlist,
} from '../src/renderer/fpga-apicula-netlist.ts'
import {
  type GowinPackagePins,
  gowinDesignPins,
  gowinIoLocation,
  gowinPinsAtTile,
  parseGowinPinout,
} from '../src/renderer/fpga-apicula-pinout.ts'
import { parseGowinPipDatabase } from '../src/renderer/fpga-apicula-routing.ts'

const db: GowinChipdb = parseGowinChipdb(
  readFileSync(new URL('../fixtures/gowin-gw1n1-chipdb.json', import.meta.url), 'utf8'),
)
const pipdb = parseGowinPipDatabase(
  readFileSync(new URL('../fixtures/gowin-gw1n1-pips.json', import.meta.url), 'utf8'),
)
const pinout = parseGowinPinout(
  readFileSync(new URL('../fixtures/gowin-gw1n1-pinout.json', import.meta.url), 'utf8'),
  db.rows,
  db.cols,
)
const aliases = new Map([
  ...parseGowinWireAliases(
    readFileSync(new URL('../fixtures/gowin-gw1n1-nodes.json', import.meta.url), 'utf8'),
  ),
  ...gowinFixedAliases(db.rows, db.cols),
])
const xnor = parseGowinBitstream(
  readFileSync(new URL('../fixtures/gowin-gw1n1-xnor-dff.fs', import.meta.url), 'utf8'),
).frames

const qn48 = pinout.get('QFN48') as GowinPackagePins

describe('gowinIoLocation — an I/O block name resolves to a tile', () => {
  test('each edge maps to the row or column it runs along', () => {
    expect(gowinIoLocation('IOT5A', 11, 20)).toEqual({ name: 'IOT5A', row: 0, col: 4, buffer: 'A' })
    expect(gowinIoLocation('IOB3A', 11, 20)).toEqual({
      name: 'IOB3A',
      row: 10,
      col: 2,
      buffer: 'A',
    })
    expect(gowinIoLocation('IOL7A', 11, 20)).toEqual({ name: 'IOL7A', row: 6, col: 0, buffer: 'A' })
    expect(gowinIoLocation('IOR2B', 11, 20)).toEqual({
      name: 'IOR2B',
      row: 1,
      col: 19,
      buffer: 'B',
    })
  })

  test('a name that is not an I/O block, or is off the die, is refused', () => {
    // Guessing a position would attribute a signal to the wrong physical pin.
    expect(gowinIoLocation('LUT0', 11, 20)).toBeNull()
    expect(gowinIoLocation('IOB99A', 11, 20)).toBeNull()
    expect(gowinIoLocation('IOL99A', 11, 20)).toBeNull()
  })
})

describe('the package pinout', () => {
  test('every package the die is sold in is present, with distinct pins', () => {
    expect(pinout.size).toBeGreaterThanOrEqual(5)
    expect(qn48.size).toBeGreaterThan(20)
  })

  test('pins 13 and 14 are the two buffers of ONE bottom-edge tile', () => {
    // Straight from the database: IOB3A and IOB3B. The constraint file put `a` and `b` on exactly these.
    const a = qn48.get('13') as { name: string; row: number; col: number }
    const b = qn48.get('14') as { name: string; row: number; col: number }
    expect([a.name, b.name]).toEqual(['IOB3A', 'IOB3B'])
    expect([a.row, a.col]).toEqual([b.row, b.col])
  })

  test('a tile lookup returns its buffers in a stable order', () => {
    const found = gowinPinsAtTile(qn48, 10, 2)
    expect(found.map((f) => f.pin)).toEqual(['13', '14'])
    expect(found.map((f) => f.location.buffer)).toEqual(['A', 'B'])
  })

  test('an interior tile has no pins at all', () => {
    expect(gowinPinsAtTile(qn48, 5, 9)).toEqual([])
  })
})

describe('gowinDesignPins — where a REAL design’s signals enter the chip', () => {
  const design = reconstructGowinNetlist(xnor, db, pipdb, null, aliases)
  const pins = gowinDesignPins(design.primaryWires, qn48)

  test('both of the design’s inputs are located on the package', () => {
    expect(design.primaryWires.size).toBe(2)
    expect(pins.size).toBe(2)
  })

  test('THE PAYOFF — they are pins 13 and 14, which is where a and b were assigned', () => {
    // The decoder was never shown the constraint file. It read a bitstream, followed the routing out to the
    // edge of the fabric, and landed on the two pins the design's inputs were actually wired to.
    const candidates = [...pins.values()].map((entry) => entry.candidates)
    for (const list of candidates) expect(list).toEqual(['13', '14'])
  })

  test('and NOT on the pins used for the clock or the output', () => {
    // The negative half: pin 10 carries the clock and pin 15 the result, so neither should be reported as a
    // data input. A decoder that returned every pin on the package would pass the test above and fail this.
    const reported = new Set([...pins.values()].flatMap((entry) => entry.candidates))
    expect(reported.has('10')).toBe(false)
    expect(reported.has('15')).toBe(false)
  })

  test('the candidates are the whole I/O block, and that is stated rather than narrowed by guessing', () => {
    // A tile carries two buffers and the wire name alone does not say which, so both pins are reported. Picking
    // one would look more precise while being right only half the time.
    for (const entry of pins.values()) expect(entry.candidates.length).toBe(2)
  })

  test('a wire that is not on an edge tile yields no pins', () => {
    const interior = new Map([[1, 'R6C10_SPINE16']])
    expect(gowinDesignPins(interior, qn48).size).toBe(0)
  })
})
