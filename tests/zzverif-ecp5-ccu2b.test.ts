/**
 * ADVERSARIAL VERIFICATION SCRATCH #2 — ECP5 CCU2 vs the reference CCU2C model.
 * Oracle transcribed VERBATIM from Yosys techlibs/lattice/ccu2c_sim.vh (the ECP5 primitive sim model).
 * Not a shipping test.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { lowerNetlistToCanvas } from '../src/renderer/fpga-icebox-canvas.ts'
import { simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'
import { reconstructEcp5Netlist } from '../src/renderer/fpga-trellis-netlist.ts'
import {
  type Ecp5Bit,
  type Ecp5Tile,
  parseEcp5TileBits,
  parseEcp5TileGrid,
  readTileEnum,
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
  const word = PLC2.words.get(name) as NonNullable<ReturnType<typeof PLC2.words.get>>
  word.bits.forEach((group, i) => {
    for (const { frame, bit, inv } of group) {
      const row = frames[tile.startFrame + frame] as boolean[]
      row[tile.startBit + bit] = (truth[i] as boolean) !== inv
    }
  })
}
/** Route pin from a DISTINCT external (non-F/Q) arc so every pin gets its own primary net. */
function routeExternal(frames: boolean[][], tile: Ecp5Tile, pin: string, nth: number): string {
  const arcs = [...(PLC2.muxes.get(pin)?.arcs.entries() ?? [])].filter(
    ([name, bits]) => bits.length > 0 && !/^[FQ]\d$/.test(name),
  )
  const [name, bits] = arcs[nth % arcs.length] as [string, Ecp5Bit[]]
  writeGroup(frames, tile, bits)
  return name
}

// yosys arith_map_ccu2c.v: every ECP5 adder bit is CCU2C #(.INIT0(16'b1001011010101010),
//   .INIT1(16'b1001011010101010), .INJECT1_0("NO"), .INJECT1_1("NO")) with C0=BI, D0=1'b1.
const INIT_ADDER = 0x96aa
const truthOf = (init: number): boolean[] =>
  Array.from({ length: 16 }, (_, i) => ((init >> i) & 1) === 1)

const lut4 = (init: number, a: boolean, b: boolean, c: boolean, d: boolean): boolean =>
  ((init >> ((d ? 8 : 0) | (c ? 4 : 0) | (b ? 2 : 0) | (a ? 1 : 0))) & 1) === 1
const lut2 = (init: number, a: boolean, b: boolean): boolean =>
  ((init >> ((b ? 2 : 0) | (a ? 1 : 0))) & 1) === 1

/** VERBATIM port of Yosys ccu2c_sim.vh's CCU2C body. */
function ccu2cReference(
  init0: number,
  init1: number,
  inject0: boolean,
  inject1: boolean,
  cin: boolean,
  p: {
    a0: boolean
    b0: boolean
    c0: boolean
    d0: boolean
    a1: boolean
    b1: boolean
    c1: boolean
    d1: boolean
  },
): { s0: boolean; s1: boolean; cout: boolean } {
  const LUT4_0 = lut4(init0, p.a0, p.b0, p.c0, p.d0)
  const LUT2_0 = lut2(init0 & 0xf, p.a0, p.b0)
  const gated_cin_0 = inject0 ? false : cin
  const s0 = LUT4_0 !== gated_cin_0
  const gated_lut2_0 = inject0 ? false : LUT2_0
  const cout_0 = (!LUT4_0 && gated_lut2_0) || (LUT4_0 && cin)
  const LUT4_1 = lut4(init1, p.a1, p.b1, p.c1, p.d1)
  const LUT2_1 = lut2(init1 & 0xf, p.a1, p.b1)
  const gated_cin_1 = inject1 ? false : cout_0
  const s1 = LUT4_1 !== gated_cin_1
  const gated_lut2_1 = inject1 ? false : LUT2_1
  const cout = (!LUT4_1 && gated_lut2_1) || (LUT4_1 && cout_0)
  return { s0, s1, cout }
}

describe('ECP5 CCU2 vs the reference CCU2C model', () => {
  test('a real-toolchain adder SLICE: decoder+simulator vs Yosys ccu2c_sim.vh', () => {
    const frames = blankFrames()
    const tile = GRID.get('R20C30:PLC2') as Ecp5Tile
    writeGroup(frames, tile, PLC2.enums.get('SLICEA.MODE')?.options.get('CCU2') as Ecp5Bit[])
    writeGroup(
      frames,
      tile,
      PLC2.enums.get('SLICEA.CCU2.INJECT1_0')?.options.get('NO') as Ecp5Bit[],
    )
    writeGroup(
      frames,
      tile,
      PLC2.enums.get('SLICEA.CCU2.INJECT1_1')?.options.get('NO') as Ecp5Bit[],
    )
    writeLut(frames, tile, 0, truthOf(INIT_ADDER))
    writeLut(frames, tile, 1, truthOf(INIT_ADDER))
    const pinArc = new Map<string, string>()
    ;['A0', 'B0', 'C0', 'D0', 'A1', 'B1', 'C1', 'D1'].forEach((pin, i) => {
      pinArc.set(pin, routeExternal(frames, tile, pin, i))
    })
    console.log('routed pins:', JSON.stringify([...pinArc]))
    console.log(
      'the bitstream really says MODE=',
      readTileEnum(frames, tile, PLC2.enums.get('SLICEA.MODE') as never),
      ' INJECT1_0=',
      readTileEnum(frames, tile, PLC2.enums.get('SLICEA.CCU2.INJECT1_0') as never),
      ' INJECT1_1=',
      readTileEnum(frames, tile, PLC2.enums.get('SLICEA.CCU2.INJECT1_1') as never),
    )

    const netlist = reconstructEcp5Netlist(frames, GRID, dbFor)
    const c0 = netlist.cells.find((c) => c.ref.cell === 0 && c.ref.x === 30) as never as {
      inputs: { kind: string; net: number }[]
      config: { truth: boolean[]; carryEnable: boolean }
    }
    const c1 = netlist.cells.find((c) => c.ref.cell === 1 && c.ref.x === 30) as never as {
      inputs: { kind: string; net: number }[]
    }
    console.log('cell0 inputs:', JSON.stringify(c0.inputs))
    console.log('cell1 inputs:', JSON.stringify(c1.inputs))
    const nets0 = c0.inputs.map((i) => i.net)
    const nets1 = c1.inputs.map((i) => i.net)
    const all = [...nets0, ...nets1]
    console.log('nets per pin (A0 B0 C0 D0 | A1 B1 C1 D1):', all.join(' '))
    expect(new Set(all).size).toBe(8) // every pin is its own primary — otherwise the drive below is ambiguous

    // Drive: A0=1 B0=1 C0=0 D0=1  (adder half 0: LUT4_0 = A^B = 0, LUT2_0 = A = 1 -> cout_0 = 1)
    //        A1=1 B1=0 C1=0 D1=1  (adder half 1: LUT4_1 = A^B = 1)
    const p = {
      a0: true,
      b0: true,
      c0: false,
      d0: true,
      a1: true,
      b1: false,
      c1: false,
      d1: true,
    }
    const stim = new Map<number, boolean>([
      [nets0[0] as number, p.a0],
      [nets0[1] as number, p.b0],
      [nets0[2] as number, p.c0],
      [nets0[3] as number, p.d0],
      [nets1[0] as number, p.a1],
      [nets1[1] as number, p.b1],
      [nets1[2] as number, p.c1],
      [nets1[3] as number, p.d1],
    ])
    const sim = simulateCombinational(netlist, stim)
    const ref = ccu2cReference(INIT_ADDER, INIT_ADDER, false, false, false, p)
    console.log('OURS   F0 =', sim.outputs.get('30_20_0'), '  F1 =', sim.outputs.get('30_20_1'))
    console.log('REFERENCE S0 =', ref.s0, '  S1 =', ref.s1, '  COUT =', ref.cout)

    const lowered = lowerNetlistToCanvas(netlist)
    console.log('lowered.unfaithful:', JSON.stringify(lowered.unfaithful))
    console.log('lowered.unlowered :', JSON.stringify(lowered.unlowered))

    // full 4-input sweep of the two halves, cin = 0 (nothing chains into SLICEA)
    let mismatches = 0
    for (let m = 0; m < 16; m++) {
      const q = {
        a0: (m & 1) === 1,
        b0: (m & 2) === 2,
        c0: false,
        d0: true,
        a1: (m & 4) === 4,
        b1: (m & 8) === 8,
        c1: false,
        d1: true,
      }
      const s = simulateCombinational(
        netlist,
        new Map<number, boolean>([
          [nets0[0] as number, q.a0],
          [nets0[1] as number, q.b0],
          [nets0[2] as number, q.c0],
          [nets0[3] as number, q.d0],
          [nets1[0] as number, q.a1],
          [nets1[1] as number, q.b1],
          [nets1[2] as number, q.c1],
          [nets1[3] as number, q.d1],
        ]),
      )
      const r = ccu2cReference(INIT_ADDER, INIT_ADDER, false, false, false, q)
      const ourS1 = s.outputs.get('30_20_1')
      if (ourS1 !== r.s1) {
        mismatches++
        console.log(
          `  MISMATCH a0=${+q.a0} b0=${+q.b0} a1=${+q.a1} b1=${+q.b1}  ours S1=${ourS1} ref S1=${r.s1}`,
        )
      }
    }
    console.log('S1 mismatches over the 16 input combinations:', mismatches, '/ 16')
    expect(true).toBe(true)
  })
})
