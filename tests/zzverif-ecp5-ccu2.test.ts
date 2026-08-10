/**
 * ADVERSARIAL VERIFICATION SCRATCH — ECP5 CCU2 (carry) claim.
 * Not a shipping test. Delete after the audit.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { lowerNetlistToCanvas } from '../src/renderer/fpga-icebox-canvas.ts'
import { simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'
import { reconstructEcp5Netlist } from '../src/renderer/fpga-trellis-netlist.ts'
import {
  decodeEcp5Routing,
  decodeEcp5Slices,
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
const dbFor = (type: string) => (type === 'PLC2' ? PLC2 : null)
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
function route(frames: boolean[][], tile: Ecp5Tile, sink: string, source: string): boolean {
  const bits = PLC2.muxes.get(sink)?.arcs.get(source)
  if (bits === undefined || bits.length === 0) return false
  writeGroup(frames, tile, bits)
  return true
}
/** Route pin `p` from the first real external (non-F/Q) arc the database offers, return the source name. */
function routeExternal(frames: boolean[][], tile: Ecp5Tile, pin: string): string {
  const found = [...(PLC2.muxes.get(pin)?.arcs.entries() ?? [])].find(
    ([name, bits]) => bits.length > 0 && !/^[FQ]\d$/.test(name),
  ) as [string, Ecp5Bit[]]
  route(frames, tile, pin, found[0])
  return found[0]
}

/** truth[8*d + 4*c + 2*b + a] */
const XOR2 = Array.from({ length: 16 }, (_, i) => ((i & 1) ^ ((i >> 1) & 1)) === 1)

describe('ECP5 CCU2', () => {
  test('a CCU2 slice: what the reconstructed cell carries', () => {
    const frames = blankFrames()
    const tile = GRID.get('R20C30:PLC2') as Ecp5Tile
    // SLICEA in CCU2 (carry) mode, with INJECT1_0 = NO so the carry really reaches S0
    writeGroup(frames, tile, PLC2.enums.get('SLICEA.MODE')?.options.get('CCU2') as Ecp5Bit[])
    writeGroup(
      frames,
      tile,
      PLC2.enums.get('SLICEA.CCU2.INJECT1_0')?.options.get('NO') as Ecp5Bit[],
    )
    writeLut(frames, tile, 0, XOR2) // K0 = A xor B  (the sum LUT of a full adder bit)
    const srcA = routeExternal(frames, tile, 'A0')
    const srcB = routeExternal(frames, tile, 'B0')

    const slices = decodeEcp5Slices(frames, GRID, PLC2)
    const a = slices.find((s) => s.tile === 'R20C30' && s.slice === 'A')
    console.log('decoded slices:', slices.length, ' SLICEA.mode =', a?.mode)
    console.log('INJECT1_0 decoded by decodeEcp5Slices? ', Object.keys(a ?? {}).join(','))

    const netlist = reconstructEcp5Netlist(frames, GRID, dbFor)
    const cell0 = netlist.cells.find((c) => c.ref.x === 30 && c.ref.y === 20 && c.ref.cell === 0)
    console.log('cell0 config      :', JSON.stringify(cell0?.config))
    console.log('cell0 carryOperands :', cell0?.carryOperands)
    console.log('cell0 carryIn       :', cell0?.carryIn)
    console.log('cell0 carryInSource :', cell0?.carryInSource)
    console.log('cell0 carryInConst  :', cell0?.carryInConst)
    console.log('cell0 inputs        :', JSON.stringify(cell0?.inputs))
    console.log(
      'any carry InputSource anywhere in the netlist? ',
      netlist.cells.some((c) => c.inputs.some((i) => i.kind === 'carry')),
    )
    console.log('routed A0 from', srcA, ' B0 from', srcB)

    // simulate: with A=1,B=0 the bare LUT says 1. On silicon S0 = LUT ^ FCI.
    const nets = (cell0?.inputs ?? [])
      .map((i) => (i.kind === 'primary' ? i.net : -1))
      .filter((n) => n >= 0)
    for (const [av, bv] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      const sim = simulateCombinational(
        netlist,
        new Map([
          [nets[0] as number, av],
          [nets[1] as number, bv],
        ]),
      )
      console.log(`  A=${av ? 1 : 0} B=${bv ? 1 : 0} -> F0 =`, sim.outputs.get('30_20_0'))
    }

    const lowered = lowerNetlistToCanvas(netlist)
    console.log('lowered.unfaithful:', JSON.stringify(lowered.unfaithful))
    console.log('lowered.unlowered :', JSON.stringify(lowered.unlowered))

    // does the tile's carry chain even appear in the recovered routing?
    const arcs = decodeEcp5Routing(frames, GRID, dbFor)
    console.log(
      'arcs mentioning FCI/FCO in R20C30:',
      JSON.stringify(arcs.filter((x) => x.tile === 'R20C30' && /FC[IO]/.test(x.sink + x.source))),
    )
    const arcsFixed = decodeEcp5Routing(frames, GRID, dbFor, { includeFixed: true })
    console.log(
      'with includeFixed:',
      JSON.stringify(
        arcsFixed.filter((x) => x.tile === 'R20C30' && /FC[IO]/.test(x.sink + x.source)),
      ),
    )
    expect(true).toBe(true)
  })
})
