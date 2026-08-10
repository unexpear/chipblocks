/**
 * FPGA fabric — iCE40: a FALLING-EDGE flip-flop, checked against the vendor toolchain's own answer.
 *
 * A logic tile has one shared `NegClk` bit that makes all eight of its flip-flops clock on the falling edge. It
 * was decoded into the tile layout and then read by NOBODY: `ParsedDesign` carried only the carry bit, so a
 * design built with negative-edge flip-flops decoded to a configuration identical to the positive-edge one.
 * Nothing warned, and `ok` was true.
 *
 * It is not a cosmetic difference. A negedge flip-flop BETWEEN two posedge ones moves data through in ONE clock
 * period rather than two, because it samples half a period after the first one latched — the standard
 * half-cycle pipeline idiom. Simulating it as a posedge flip-flop reports the design a full period slow.
 *
 * THE ORACLE IS THE VENDOR'S OWN: both fixtures are the SAME Verilog, built through yosys -> nextpnr-ice40 ->
 * icepack, differing only in whether the middle flip-flop is `always @(negedge clk)` or `@(posedge clk)`. Feeding
 * each .asc to icebox_vlog — icebox's own bitstream-to-Verilog recovery — and simulating with iverilog gives:
 *
 *     ALLPOS   q rises at cycle 4
 *     NEGMID   q rises at cycle 3        <- one period earlier, on the real silicon
 *
 * icebox_vlog writes exactly one `always @(negedge …)` for NEGMID and none for ALLPOS, which is the vendor
 * treating this bit as load-bearing. Those cycle numbers are what the assertions below pin.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import { type Ice40ChipDb, loadIce40Bitstream } from '../src/renderer/fpga-icebox-load.ts'
import { parseLogicTileBits } from '../src/renderer/fpga-icebox-logic.ts'
import { simulateClocked } from '../src/renderer/fpga-icebox-run.ts'

const chipdbText = readFileSync(
  new URL('../fixtures/icebox-ice40-1k-chipdb.txt', import.meta.url),
  'utf8',
)
const CHIPDBS: Record<string, Ice40ChipDb> = {
  '1k': { device: parseIceboxChipdb(chipdbText), layout: parseLogicTileBits(chipdbText) },
}

const load = (name: string) => {
  const result = loadIce40Bitstream(
    new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url))),
    CHIPDBS,
  )
  if (!result.ok) throw new Error(`could not load ${name}: ${result.reason}`)
  return result
}

const negmid = load('p3_NEGMID.bin')
const allpos = load('p3_ALLPOS.bin')

/**
 * The design's `d` pin, FOUND rather than written down. Both builds place the head register differently, but each
 * takes exactly one external data input, so the design's single primary net is `d`.
 *
 * This used to be the literal constant 4134, with a comment saying the obvious search could not work: the
 * recovered netlist listed 14 primary inputs for a design with two, because a LUT pin the vendor never routed was
 * being reported as a drivable external input (the decoded truth table legitimately depends on such a pin — an
 * unrouted iCE40 input reads LOW on silicon — so the don't-care mask does not remove it). With unrouted pins
 * classified as the constants they are, the search returns exactly one net, and it is 4134 in both builds: the
 * number that had to be hard-coded is now the one a search finds.
 */
function dataNet(loaded: ReturnType<typeof load>): number {
  const nets = [
    ...new Set(
      loaded.netlist.cells
        .flatMap((c) => c.inputs)
        .filter((i) => i.kind === 'primary')
        .map((i) => i.net),
    ),
  ]
  expect(nets).toHaveLength(1) // one data input, so one primary net — no phantoms to choose between
  return nets[0] as number
}

/** The cycle at which the design's output register first reads 1, or -1. */
function risesAt(loaded: ReturnType<typeof load>, cycles: number): number {
  const data = dataNet(loaded)
  // One-cycle pulse on the data pin, exactly as the reference testbench drives it.
  const { trace } = simulateClocked(
    loaded.netlist,
    (cy: number) => new Map([[data, cy === 1]]),
    cycles,
  )
  // The output is the registered cell nothing else reads — the end of the three-stage chain.
  const driven = new Set(
    loaded.netlist.cells.flatMap((c) =>
      c.inputs
        .filter((i) => i.kind === 'cell' || i.kind === 'carry')
        .map((i) => `${i.driver.x}_${i.driver.y}_${i.driver.cell}`),
    ),
  )
  const tail = loaded.netlist.cells.filter(
    (c) => c.config.dffEnable && !driven.has(`${c.ref.x}_${c.ref.y}_${c.ref.cell}`),
  )
  expect(tail).toHaveLength(1)
  const key = `${tail[0]?.ref.x}_${tail[0]?.ref.y}_${tail[0]?.ref.cell}`
  for (let cy = 0; cy < cycles; cy++) if (trace[cy]?.get(key) === true) return cy
  return -1
}

describe('the tile’s falling-edge bit is decoded, not thrown away', () => {
  test('the two bitstreams recover the same number of cells, differing in the edge bit', () => {
    // Same Verilog, same tools, same seed - only the middle flip-flop's edge changed in the SOURCE. The two are
    // NOT placed alike (the router puts the chain in different tiles, and the negedge build necessarily spills
    // into a second tile because the bit is tile-wide), so this asserts the cell count and the bit, which is
    // what it can honestly claim. Recovering the same count is why simulating them identically looked plausible.
    expect(negmid.netlist.cells).toHaveLength(allpos.netlist.cells.length)
    expect(negmid.netlist.cells.some((c) => c.negClk === true)).toBe(true)
    expect(allpos.netlist.cells.some((c) => c.negClk === true)).toBe(false)
    // and both builds present the same single data input — the net `dataNet` finds below
    expect([dataNet(negmid), dataNet(allpos)]).toEqual([4134, 4134])
  })

  test('exactly ONE flip-flop is on the falling edge, as the source says', () => {
    // The design has three registers and one of them is `always @(negedge clk)`. NOTE this does not prove the
    // bit is applied per-cell rather than per-tile - only one recovered cell lives in that tile, so the two are
    // indistinguishable here. Tile-wide IS the correct hardware semantics; the count is pinned because a decoder
    // that flagged every cell in the DESIGN would pass the tests below and fail this.
    const falling = negmid.netlist.cells.filter((c) => c.config.dffEnable && c.negClk === true)
    expect(falling).toHaveLength(1)
  })

  test('THE ORACLE — the positive-edge design rises at cycle 4, as icebox_vlog + iverilog say', () => {
    expect(risesAt(allpos, 10)).toBe(4)
  })

  test('THE ORACLE — the negative-edge design rises a period EARLIER, at cycle 3', () => {
    // This is the whole defect in one number. Before the falling-edge bit was read, this returned 4: the
    // recovered netlist was byte-identical in behaviour to the positive-edge one and ran a full period slow.
    expect(risesAt(negmid, 10)).toBe(3)
  })

  test('and the two are genuinely different, not merely both plausible', () => {
    // The negative control: if the fix had shifted BOTH designs, or neither, this passes only by the two
    // disagreeing in the same direction the hardware disagrees. `risesAt` returns -1 for "never rises", and -1
    // is less than everything, so a design that produced no output at all would have satisfied a bare
    // `toBeLessThan` - both are required to actually rise first.
    const negmidAt = risesAt(negmid, 10)
    const allposAt = risesAt(allpos, 10)
    expect(negmidAt).toBeGreaterThanOrEqual(0)
    expect(allposAt).toBeGreaterThanOrEqual(0)
    expect(negmidAt).toBe(allposAt - 1)
  })

  test('the falling-edge flip-flop passes data through in the SAME cycle as its driver', () => {
    // The mechanism, not just the end result: the negedge cell samples half a period after the posedge cell
    // that feeds it latched, so both read 1 on the same cycle. Under a single-edge model the negedge cell would
    // lag its driver by one cycle - which is precisely where the missing period came from.
    const data = dataNet(negmid)
    const { trace } = simulateClocked(
      negmid.netlist,
      (cy: number) => new Map([[data, cy === 1]]),
      10,
    )
    const falling = negmid.netlist.cells.find((c) => c.negClk === true)
    const driver = falling?.inputs.find((i) => i.kind === 'cell')
    expect(driver).toBeDefined()
    const at = (r: { x: number; y: number; cell: number }): number =>
      trace.findIndex((m) => m.get(`${r.x}_${r.y}_${r.cell}`) === true)
    expect(at(falling?.ref as { x: number; y: number; cell: number })).toBe(
      at((driver as { driver: { x: number; y: number; cell: number } }).driver),
    )
  })
})
