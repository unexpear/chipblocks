/**
 * FPGA fabric — Lattice Nexus: the design's logic cells, recovered from both views of a real bitstream.
 *
 * The design is `always @(posedge clk) q <= (a & b) | (~a & ~b)` — one exclusive-NOR into one register. So the
 * recovered slices must show exactly that: one lookup table computing XNOR, one register switched on, clocked.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { type NexusFasm, parseNexusFasm } from '../src/renderer/fpga-oxide-fasm.ts'
import {
  decodeNexusSlices,
  nexusLutInputs,
  nexusLutUsesInput,
  nexusSliceInUse,
} from '../src/renderer/fpga-oxide-slice.ts'

const read = (name: string): NexusFasm =>
  parseNexusFasm(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'))

const requested = read('nexus-lifcl40-xnor-dff.fasm')
const readBack = read('nexus-lifcl40-xnor-dff-unpacked.fasm')

describe('decodeNexusSlices — a one-gate design', () => {
  const slices = decodeNexusSlices(requested)

  test('exactly one slice is configured, out of thousands on the chip', () => {
    // A decoder that reported every slice would bury the one in use.
    expect(slices).toHaveLength(1)
    expect(slices[0]?.name).toBe('A')
    expect([slices[0]?.tile.row, slices[0]?.tile.col]).toEqual([5, 2])
  })

  test('it holds one lookup table, computing exclusive-NOR', () => {
    const luts = slices[0]?.luts as { name: string; init: number }[]
    expect(luts).toHaveLength(1)
    expect(luts[0]?.name).toBe('K0')
    expect(luts[0]?.init).toBe(0xf00f)
  })

  test('the register is switched on, and the slice is clocked', () => {
    const slice = slices[0] as {
      registers: { name: string; used: boolean; regset: string | null }[]
      clock: string | null
    }
    const used = slice.registers.filter((r) => r.used)
    expect(used).toHaveLength(1)
    expect(used[0]?.name).toBe('REG0')
    expect(used[0]?.regset).toBe('RESET')
    expect(slice.clock).toBe('CLK')
  })

  test('the clock and set/reset are read as SLICE settings, not per register', () => {
    // Real hardware shares them across the slice. Two registers here cannot be clocked differently, so storing
    // them per-register would describe a chip that does not exist.
    const slice = slices[0] as {
      clock: string | null
      setReset: string | null
      srMode: string | null
    }
    expect(slice.clock).toBe('CLK')
    expect(slice.setReset).toBe('INV')
    expect(slice.srMode).toBe('LSR_OVER_CE')
  })
})

describe('the same design read out of the packed BITSTREAM', () => {
  const asked = decodeNexusSlices(requested)
  const got = decodeNexusSlices(readBack)

  test('the slice that does the work is identical in both views', () => {
    const mine = got.find((s) => s.tile.name === asked[0]?.tile.name && s.name === asked[0]?.name)
    expect(mine).toBeDefined()
    expect(mine?.luts).toEqual(asked[0]?.luts)
    expect(mine?.clock).toBe(asked[0]?.clock)
    expect(mine?.registers.filter((r) => r.used).map((r) => r.name)).toEqual(
      asked[0]?.registers.filter((r) => r.used).map((r) => r.name),
    )
  })

  test('the bitstream ALSO configures a neighbouring slice that does no work', () => {
    // Found, not predicted: the packed bitstream sets the clock and set/reset on SLICEB too, because those are
    // shared across a region of the chip. It has no lookup table and no enabled register. Treating "a slice
    // appears" as "a slice is used" would report this one-gate design as using two slices.
    expect(got.length).toBeGreaterThan(asked.length)
    const idle = got.filter((s) => !nexusSliceInUse(s))
    expect(idle.length).toBeGreaterThan(0)
    expect(idle[0]?.luts).toEqual([])
    expect(idle[0]?.clock).toBe('CLK') // configured...
    expect(idle[0]?.registers.some((r) => r.used)).toBe(false) // ...but doing nothing
  })

  test('so counting only slices IN USE gives the same answer from both views', () => {
    expect(got.filter(nexusSliceInUse)).toHaveLength(asked.filter(nexusSliceInUse).length)
    expect(got.filter(nexusSliceInUse)).toHaveLength(1)
  })

  test('one register setting is requested but NOT carried in the bitstream', () => {
    // `REG0.SEL.DL` appears in what the router asked for and is absent from what the packer reads back. Stated
    // rather than smoothed over: either it is a default the packer omits, or it lives somewhere this decoder
    // does not yet look. Asserting the two views were identical would have hidden it.
    expect(asked[0]?.registers[0]?.select).toBe('DL')
    const mine = got.find((s) => s.name === 'A' && s.tile.name === asked[0]?.tile.name)
    expect(mine?.registers[0]?.select).toBeNull()
  })
})

describe('which inputs a lookup table actually reads', () => {
  test('the recovered XNOR uses two of its four inputs', () => {
    // Checked rather than assumed: the router placed the gate on inputs 2 and 3, leaving 0 and 1 wired but
    // ignored. Counting all four as design inputs would invent two signals.
    expect(nexusLutInputs(0xf00f)).toEqual([2, 3])
    expect(nexusLutUsesInput(0xf00f, 0)).toBe(false)
    expect(nexusLutUsesInput(0xf00f, 3)).toBe(true)
  })

  test('familiar truth tables come out right', () => {
    expect(nexusLutInputs(0x0000)).toEqual([]) // constant zero depends on nothing
    expect(nexusLutInputs(0xffff)).toEqual([]) // constant one likewise
    expect(nexusLutInputs(0x8888)).toEqual([0, 1]) // AND of the low two inputs
    expect(nexusLutInputs(0x9999)).toEqual([0, 1]) // the XNOR Gowin's fabric used, on inputs 0 and 1
  })

  test('a design with no logic recovers no slices', () => {
    expect(decodeNexusSlices(parseNexusFasm('{ oxide.device="LIFCL-40" }\n'))).toEqual([])
  })
})
