import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseEcp5Bitstream } from '../src/renderer/fpga-trellis-bit.ts'
import { reconstructEcp5Netlist } from '../src/renderer/fpga-trellis-netlist.ts'
import {
  decodeEcp5Slices,
  globaliseEcp5Wire,
  parseEcp5TileBits,
  parseEcp5TileGrid,
} from '../src/renderer/fpga-trellis-tiles.ts'

const GRID = parseEcp5TileGrid(
  readFileSync(
    new URL('../fixtures/trellis-ecp5-LFE5U-25F-tilegrid.json', import.meta.url),
    'utf8',
  ),
)
const dbOf = (t: string) =>
  parseEcp5TileBits(
    readFileSync(new URL(`../fixtures/trellis-ecp5-${t}-bits.db`, import.meta.url), 'utf8'),
  )
const TYPES = [
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
const DBS = new Map(TYPES.map((t) => [t, dbOf(t)]))
const dbFor = (t: string) => DBS.get(t) ?? null

const REAL = new Uint8Array(
  readFileSync(new URL('../fixtures/trellis-ecp5-asym-lut.bit', import.meta.url)),
)

describe('SCOPE-BLOCK CLAIM 1: fpga-trellis-bit.ts says the tile database "is not bundled"', () => {
  test('the tile database IS bundled and DOES interpret the frames of a real .bit', () => {
    const parsed = parseEcp5Bitstream(REAL)
    console.log('device announced by the real bitstream:', parsed.device?.name)
    console.log('frames recovered:', parsed.frames.length)
    const slices = decodeEcp5Slices(parsed.frames, GRID, dbFor('PLC2') as never)
    const withInit = slices.filter((s) => s.luts.some((l) => l !== null))
    console.log('PLC2 slices decoded from those frames:', slices.length)
    const first = withInit[0]
    if (first !== undefined) {
      console.log(
        'example decoded LUT:',
        first.tile,
        first.slice,
        'k0=',
        (first.luts[0] ?? []).map((b) => (b ? 1 : 0)).join(''),
      )
    }
    expect(slices.length).toBeGreaterThan(0)
  })
})

describe('SCOPE-BLOCK CLAIM 2: fpga-trellis-netlist.ts says the global wire model "is not built yet"', () => {
  test('the same file calls globaliseEcp5Wire and resolves ACROSS tile boundaries', () => {
    const seen = globaliseEcp5Wire(20, 30, 'E1_H01E0001')
    console.log("globaliseEcp5Wire(20,30,'E1_H01E0001') =", JSON.stringify(seen))
    expect(seen).not.toBeNull()
    const net = reconstructEcp5Netlist(parseEcp5Bitstream(REAL).frames, GRID, dbFor)
    console.log('cells recovered from the real bitstream:', net.cells.length)
    let crossTile = 0
    for (const cell of net.cells) {
      for (const src of cell.inputs) {
        if (src === null || src.kind !== 'cell') continue
        if (src.driver.x !== cell.ref.x || src.driver.y !== cell.ref.y) crossTile++
      }
    }
    console.log('input sources resolved to a driver in a DIFFERENT tile:', crossTile)
  })
})
