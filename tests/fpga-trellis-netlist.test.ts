/**
 * FPGA fabric — ECP5: a decoded bitstream becomes a netlist our EXISTING engine runs (fpga-trellis-netlist.ts).
 *
 * The payoff test of the ECP5 arc: a two-LUT design is written into a real LFE5U-25F frame array — through the
 * real PLC2 database's own bit positions and mux arcs — then reconstructed and handed, unchanged, to the very
 * `simulateCombinational` and `lowerNetlistToCanvas` the iCE40 path uses. Nothing about the simulator or the canvas
 * lowering is ECP5-specific; a second FPGA family reuses them wholesale.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { CanvasNodeLike } from '../src/renderer/blocks.ts'
import { lowerNetlistToCanvas } from '../src/renderer/fpga-icebox-canvas.ts'
import { simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'
import { parseEcp5Bitstream } from '../src/renderer/fpga-trellis-bit.ts'
import { reconstructEcp5Netlist } from '../src/renderer/fpga-trellis-netlist.ts'
import {
  type Ecp5Bit,
  type Ecp5Tile,
  parseEcp5TileBits,
  parseEcp5TileGrid,
} from '../src/renderer/fpga-trellis-tiles.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

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

/** Stamp a group of database bits so it matches (stored = value XOR inv). */
function writeGroup(frames: boolean[][], tile: Ecp5Tile, bits: readonly Ecp5Bit[]): void {
  for (const { frame, bit, inv } of bits) {
    const row = frames[tile.startFrame + frame] as boolean[]
    row[tile.startBit + bit] = !inv
  }
}
/** Write LUT k's truth table (SLICE = A + floor(k/2), K = k mod 2). */
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
/** Route `source` into the mux driving `sink`, returning false if that arc does not exist. */
function route(frames: boolean[][], tile: Ecp5Tile, sink: string, source: string): boolean {
  const bits = PLC2.muxes.get(sink)?.arcs.get(source)
  if (bits === undefined || bits.length === 0) return false
  writeGroup(frames, tile, bits)
  return true
}
const drive = (node: CanvasNodeLike, volts: number): CanvasNodeLike => ({
  ...node,
  data: {
    ...node.data,
    parameters: { nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } } },
  },
})

const AND2 = Array.from({ length: 16 }, (_, i) => (i & 1) === 1 && ((i >> 1) & 1) === 1)
const BUF = Array.from({ length: 16 }, (_, i) => (i & 1) === 1)

describe('reconstructEcp5Netlist — an ECP5 bitstream becomes a netlist the shared engine runs', () => {
  /** LUT0 = AND of two external inputs; LUT1 = a buffer of LUT0, wired through the tile's own routing. */
  const DRIVER = 5
  const CONSUMER = 1
  const buildDesign = (): { frames: boolean[][]; tile: Ecp5Tile } => {
    const frames = blankFrames()
    const tile = GRID.get('R20C30:PLC2') as Ecp5Tile
    writeLut(frames, tile, DRIVER, AND2)
    writeLut(frames, tile, CONSUMER, BUF)
    // LUT0's A/B inputs come from outside the tile; pick real arcs from the database.
    for (const pin of [`A${DRIVER}`, `B${DRIVER}`]) {
      const [source] = [...(PLC2.muxes.get(pin)?.arcs.entries() ?? [])].find(
        ([name, bits]) => bits.length > 0 && !/^[FQ]\d$/.test(name),
      ) as [string, Ecp5Bit[]]
      route(frames, tile, pin, source)
    }
    // LUT1's A input is driven by LUT0's output F0 — an in-tile connection, if the fabric offers that arc.
    // the in-tile hop this device really supports: there is no F0 -> A1 arc, but F5 -> A1 exists
    expect(route(frames, tile, `A${CONSUMER}`, `F${DRIVER}`)).toBe(true)
    return { frames, tile }
  }

  test('recovers both LUTs at their real device coordinates, with external inputs as primaries', () => {
    const { frames, tile } = buildDesign()
    const netlist = reconstructEcp5Netlist(frames, GRID, dbFor)
    expect(tile.name).toBe('R20C30') // row 20, col 30 — asymmetric, so a row/col swap cannot hide

    const lut0 = netlist.cells.find(
      (c) => c.ref.x === 30 && c.ref.y === 20 && c.ref.cell === DRIVER,
    )
    const lut1 = netlist.cells.find(
      (c) => c.ref.x === 30 && c.ref.y === 20 && c.ref.cell === CONSUMER,
    )
    expect(lut0?.config.truth).toEqual(AND2)
    expect(lut1?.config.truth).toEqual(BUF)
    // the tile/SLICE each cell came from is retained, so a cell traces back to the device
    expect(netlist.origin.get(`30_20_${DRIVER}`)).toEqual({ tile: 'R20C30', slice: 'C', lut: 1 })
    expect(netlist.origin.get(`30_20_${CONSUMER}`)).toEqual({ tile: 'R20C30', slice: 'A', lut: 1 })

    // LUT0's two routed inputs arrived from outside the tile, so they are primaries with real wire names
    const primaries = (lut0?.inputs ?? []).filter((i) => i.kind === 'primary')
    expect(primaries.length).toBeGreaterThanOrEqual(2)
    for (const p of primaries) expect(netlist.netNames.get((p as { net: number }).net)).toBeTruthy()
  })

  test('an in-tile connection is recovered as a cell source, and the design simulates', () => {
    const { frames } = buildDesign()
    const netlist = reconstructEcp5Netlist(frames, GRID, dbFor)
    const lut0 = netlist.cells.find((c) => c.ref.cell === DRIVER && c.ref.x === 30)
    const lut1 = netlist.cells.find((c) => c.ref.cell === CONSUMER && c.ref.x === 30)
    expect(lut1?.inputs[0]).toMatchObject({ kind: 'cell', driver: { x: 30, y: 20, cell: DRIVER } })

    // run it on the EXISTING simulator — no ECP5-specific simulation code
    const nets = (lut0?.inputs ?? [])
      .filter((i) => i.kind === 'primary')
      .map((i) => (i as { net: number }).net)
    for (const a of [false, true])
      for (const b of [false, true]) {
        const sim = simulateCombinational(
          netlist,
          new Map([
            [nets[0] as number, a],
            [nets[1] as number, b],
          ]),
        )
        expect(sim.outputs.get(`30_20_${DRIVER}`)).toBe(a && b) // the AND
        expect(sim.outputs.get(`30_20_${CONSUMER}`)).toBe(a && b) // the buffer follows it
      }
  })

  test('the recovered ECP5 netlist lowers onto the canvas and the app engine agrees', () => {
    const { frames } = buildDesign()
    const netlist = reconstructEcp5Netlist(frames, GRID, dbFor)
    const lowered = lowerNetlistToCanvas(netlist)
    expect(lowered.nodes.length).toBeGreaterThan(0)
    expect(lowered.unfaithful).toEqual([]) // nothing the lowering could not represent

    const lut0 = netlist.cells.find((c) => c.ref.cell === DRIVER && c.ref.x === 30)
    const nets = (lut0?.inputs ?? [])
      .filter((i) => i.kind === 'primary')
      .map((i) => (i as { net: number }).net)
    for (const a of [false, true])
      for (const b of [false, true]) {
        const values = new Map([
          [nets[0] as number, a],
          [nets[1] as number, b],
        ])
        const nodes = lowered.nodes.map((n) => {
          for (const [net, id] of lowered.inputNodes)
            if (id === n.id) return drive(n, values.get(net) ? 5 : 0)
          return n
        })
        const canvas = simulateLogic(nodes, lowered.edges)
        // the canvas gate network computes exactly what the FPGA simulator does
        expect(canvas.value(lowered.cellOutputs.get(`30_20_${DRIVER}`) as string, 'out')).toBe(
          simulateCombinational(netlist, values).outputs.get(`30_20_${DRIVER}`),
        )
      }
  })

  test('a blank device yields an empty netlist — nothing invented', () => {
    const netlist = reconstructEcp5Netlist(blankFrames(), GRID, dbFor)
    expect(netlist.cells).toEqual([])
  })
})

describe('untouched slices and untouched companion tables', () => {
  /** The genuine ecppack artefact, decoded end to end. */
  const realNetlist = () => {
    const bits = parseEcp5Bitstream(
      new Uint8Array(
        readFileSync(new URL('../fixtures/trellis-ecp5-asym-lut.bit', import.meta.url)),
      ),
    )
    return reconstructEcp5Netlist(bits.frames, GRID, dbFor)
  }

  test('the real vendor bitstream yields ONLY the cell the vendor programmed', () => {
    // It used to yield two: the real one, plus its companion lookup table sitting at the database's all-ones
    // default with nothing routed to it. That phantom constant-1 cell exists nowhere in the design.
    const netlist = realNetlist()
    expect(netlist.cells).toHaveLength(1)
    expect(netlist.cells[0]?.config.truth.map((b) => (b ? 1 : 0)).join('')).toBe('1100000000000001')
  })

  test('the surviving cell is the programmed one, not whichever came first', () => {
    // Guards against "fixed" by dropping the wrong one of the pair.
    const cell = realNetlist().cells[0]
    expect(cell?.config.truth.some((b) => !b)).toBe(true) // a real function, not the all-ones default
  })
})

describe('arithmetic slices are declared untrustworthy, not silently simulated', () => {
  const realNetlist = () => {
    const bits = parseEcp5Bitstream(
      new Uint8Array(
        readFileSync(new URL('../fixtures/trellis-ecp5-asym-lut.bit', import.meta.url)),
      ),
    )
    return reconstructEcp5Netlist(bits.frames, GRID, dbFor)
  }

  test('every arithmetic cell is listed in `unfaithful`, and nothing else is', () => {
    // What this does NOT do is model the carry. A slice in arithmetic mode outputs its lookup table combined
    // with the incoming carry, and the chain runs between cells; we recover the mode flag and nothing else, so
    // such a cell would simulate as a plain lookup table and be wrong — 256 of 512 combinations on the first
    // sum bit of a real adder.
    //
    // The alternative was to model the chain with the iCE40 carry formula. That is a DIFFERENT function,
    // measured to disagree on 128 of 512 combinations, so it would have swapped a visible wrong answer for a
    // plausible one. Declaring such a cell untrustworthy is the honest position until the arithmetic is decoded.
    const netlist = realNetlist()
    const arithmetic = netlist.cells.filter((c) => c.config.carryEnable)
    expect(netlist.unfaithful).toHaveLength(arithmetic.length)
    for (const listed of netlist.unfaithful) expect(listed.reason).toMatch(/carry/)
  })

  test('HONEST GAP: no CCU2 bitstream exists in the fixtures, so the POSITIVE case is unverified', () => {
    // Written as a test rather than a comment so it cannot be forgotten. The fixture we have contains no
    // arithmetic slice, so the test above currently checks only that nothing is wrongly flagged. Whether a real
    // arithmetic slice is correctly DETECTED and reported is not yet demonstrated — building a CCU2 adder
    // through yosys/nextpnr/ecppack would close it, and this assertion flips the moment such a fixture lands.
    expect(realNetlist().cells.some((c) => c.config.carryEnable)).toBe(false)
  })
})
