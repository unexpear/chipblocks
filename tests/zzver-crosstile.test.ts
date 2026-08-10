import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { reconstructEcp5Netlist } from '../src/renderer/fpga-trellis-netlist.ts'
import {
  type Ecp5Bit,
  type Ecp5Tile,
  parseEcp5TileBits,
  parseEcp5TileGrid,
} from '../src/renderer/fpga-trellis-tiles.ts'

const GRID = parseEcp5TileGrid(
  readFileSync(
    new URL('../fixtures/trellis-ecp5-LFE5U-25F-tilegrid.json', import.meta.url),
    'utf8',
  ),
)
const PLC2 = parseEcp5TileBits(
  readFileSync(new URL('../fixtures/trellis-ecp5-PLC2-bits.db', import.meta.url), 'utf8'),
)
const dbFor = (t: string) => (t === 'PLC2' ? PLC2 : null)
const blankFrames = (): boolean[][] =>
  Array.from({ length: 7562 }, () => Array.from({ length: 592 }, () => false))

function writeGroup(frames: boolean[][], tile: Ecp5Tile, bits: readonly Ecp5Bit[]): void {
  for (const { frame, bit, inv } of bits) {
    const row = frames[tile.startFrame + frame] as boolean[]
    row[tile.startBit + bit] = !inv
  }
}
function writeLut(frames: boolean[][], tile: Ecp5Tile, k: number, truth: boolean[]): void {
  const name = `SLICE${'ABCD'[Math.floor(k / 2)]}.K${k % 2}.INIT`
  const word = PLC2.words.get(name)
  if (word === undefined) throw new Error(`no ${name}`)
  word.bits.forEach((group, i) => {
    for (const { frame, bit, inv } of group) {
      const row = frames[tile.startFrame + frame] as boolean[]
      row[tile.startBit + bit] = (truth[i] as boolean) !== inv
    }
  })
}
function route(frames: boolean[][], tile: Ecp5Tile, sink: string, source: string): void {
  const bits = PLC2.muxes.get(sink)?.arcs.get(source)
  if (bits === undefined || bits.length === 0) throw new Error(`no arc ${source} -> ${sink}`)
  writeGroup(frames, tile, bits)
}

const BUF = Array.from({ length: 16 }, (_, i) => (i & 1) === 1)

describe('fpga-trellis-netlist.ts header says "connectivity is resolved WITHIN a tile"', () => {
  test('it actually resolves a driver in the NEIGHBOURING tile', () => {
    const frames = blankFrames()
    const west = GRID.get('R20C30:PLC2') as Ecp5Tile
    const east = GRID.get('R20C31:PLC2') as Ecp5Tile
    // WEST tile: LUT5 is a buffer, and its F5 output drives the outgoing wire E1_H02E0501
    // (globalises to the wire H02E0501 of the tile one column EAST).
    writeLut(frames, west, 5, BUF)
    route(frames, west, 'E1_H02E0501', 'F5')
    // EAST tile: LUT0 is a buffer whose A0 input is driven by that same wire, named locally H02E0501.
    writeLut(frames, east, 0, BUF)
    route(frames, east, 'A0', 'H02E0501')

    const net = reconstructEcp5Netlist(frames, GRID, dbFor)
    const consumer = net.cells.find((c) => c.ref.x === 31 && c.ref.y === 20 && c.ref.cell === 0)
    console.log('consumer cell:', JSON.stringify(consumer?.ref))
    console.log('its A0 input source:', JSON.stringify(consumer?.inputs[0]))
    console.log(
      'net name for that source:',
      net.netNames.get((consumer?.inputs[0] as { net: number }).net),
    )
    expect(consumer?.inputs[0]).toEqual({
      kind: 'cell',
      driver: { x: 30, y: 20, cell: 5 },
      net: expect.any(Number),
    })
  })
})
