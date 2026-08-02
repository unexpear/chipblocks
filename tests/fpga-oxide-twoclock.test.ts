/**
 * FPGA fabric — Lattice Nexus: a design with TWO clocks, and the defect it pins.
 *
 * Built through the real toolchain (yosys -> nextpnr-nexus -> prjoxide) from:
 *
 *     always @(posedge clka) qa <= a & b;
 *     always @(posedge clkb) qb <= a | b;
 *
 * `resolveNexusWire` identifies a clock wire by its NAME alone, on the reasoning that a clock net crosses the
 * whole die so no tile can name it. This design shows that reasoning is wrong: the two clocks use the SAME wire
 * names throughout — `HPBX0000`, `VPSX0400`, `HPRX0400` — and are told apart by which half of the die they run
 * in (`SPINE_L1` versus `SPINE_R0`). Resolving by name merges them into one net.
 *
 * Recorded here rather than fixed. A first guess was that the branch is row-scoped; this artefact refutes that
 * too — both clocks are on row 9. The real scope is the clock REGION, which needs the device's region map, and
 * guessing at it is how the wire rule went wrong once already.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseNexusFasm } from '../src/renderer/fpga-oxide-fasm.ts'
import { resolveNexusWire } from '../src/renderer/fpga-oxide-wires.ts'

const design = parseNexusFasm(
  readFileSync(new URL('../fixtures/nexus-lifcl40-twoclock.fasm', import.meta.url), 'utf8'),
)

/** Every tile that reaches a clock branch, with the resolved name it gets. */
const branches = (): { tile: string; row: number; col: number; resolved: string }[] => {
  const found: { tile: string; row: number; col: number; resolved: string }[] = []
  for (const tile of design.tiles.values())
    for (const pip of tile.pips)
      for (const wire of [pip.destination, pip.source])
        if (wire.startsWith('BRANCH__'))
          found.push({
            tile: tile.name,
            row: tile.row,
            col: tile.col,
            resolved: resolveNexusWire(tile.row, tile.col, wire).global,
          })
  return found
}

describe('the two-clock design really contains two clocks', () => {
  test('two separate logic tiles each take a clock from a branch', () => {
    const consumers = [...design.tiles.values()].filter((t) =>
      t.pips.some((p) => p.destination === 'JCLK0' && p.source.startsWith('BRANCH__')),
    )
    expect(consumers.length).toBe(2)
    // ...and they are far apart on the die, which is what makes them different clock regions
    const columns = consumers.map((t) => t.col).sort((a, b) => a - b)
    expect((columns[1] as number) - (columns[0] as number)).toBeGreaterThan(20)
  })

  test('the toolchain reuses ONE set of wire names for BOTH clocks', () => {
    // The heart of it. If the names differed, resolving by name would be fine.
    const names = new Set(branches().map((b) => b.resolved))
    expect(names.size).toBe(1)
    expect([...names][0]).toBe('HPBX0000')
  })

  test('and they are NOT told apart by row — the first guess at a fix', () => {
    // Both clocks run along row 9, so scoping the branch by row would merge them just the same. Written down
    // because it is the obvious fix and it does not work.
    const rows = new Set(branches().map((b) => b.row))
    expect(rows.size).toBe(1)
  })

  test('KNOWN DEFECT — the two clocks resolve to a single net', () => {
    // What actually distinguishes them is the half of the die they run in: the spine tiles are `SPINE_L1` and
    // `SPINE_R0`. Resolving by name alone therefore reports one clock where the device has two, and a tile
    // clocked by one can be traced to the other's spine.
    const sides = new Set(
      [...design.tiles.values()].filter((t) => t.type.startsWith('SPINE_')).map((t) => t.type),
    )
    expect(sides.size).toBeGreaterThan(1) // the die really does use both halves

    const distinct = new Set(branches().map((b) => `${b.resolved}@${b.tile}`))
    expect(distinct.size).toBeGreaterThan(1) // several tiles reference it...
    expect(new Set(branches().map((b) => b.resolved)).size).toBe(1) // ...and all collapse to one name
  })
})
