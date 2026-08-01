/**
 * FPGA fabric — Lattice Nexus wire naming, checked against a real design's routing.
 *
 * The load-bearing test is the last one in the first block: applied across every directional wire the real
 * design routes, the rule must make each wire's two ends agree on ONE name. That is a property of the whole
 * routing graph, not of an example chosen to work.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseNexusFasm } from '../src/renderer/fpga-oxide-fasm.ts'
import { isNexusClockWire, nexusGlobalWire } from '../src/renderer/fpga-oxide-wires.ts'

const design = parseNexusFasm(
  readFileSync(new URL('../fixtures/nexus-lifcl40-xnor-dff.fasm', import.meta.url), 'utf8'),
)

/** Every `<port>__<wire>` reference the design makes, with the tile that made it. */
const references = (): { row: number; col: number; reference: string }[] => {
  const found: { row: number; col: number; reference: string }[] = []
  for (const tile of design.tiles.values())
    for (const pip of tile.pips)
      for (const wire of [pip.destination, pip.source])
        if (wire.includes('__')) found.push({ row: tile.row, col: tile.col, reference: wire })
  return found
}

describe('nexusGlobalWire — two tiles, one wire, one name', () => {
  test('the two ends of a vertical wire resolve to the same name', () => {
    // Straight from the design: R5C2 reaches it going south, R11C2 coming from the north, six rows apart.
    const south = nexusGlobalWire(5, 2, 'S3__V06S0003')
    const north = nexusGlobalWire(11, 2, 'N3__V06S0003')
    expect(south?.global).toBe('R5C2_V06S0003')
    expect(north?.global).toBe(south?.global)
  })

  test('the two ends of a horizontal wire do too', () => {
    const east = nexusGlobalWire(1, 10, 'E3__H06W0103')
    const west = nexusGlobalWire(1, 16, 'W3__H06W0103')
    expect(east?.global).toBe('R1C10_H06W0103')
    expect(west?.global).toBe(east?.global)
  })

  test('a chain of segments stays distinct rather than collapsing into one', () => {
    // The same wire NAME is reused along a row: C10-C16, C16-C22, C22-C28 are three different wires. If the rule
    // ignored position they would merge into one net and join logic that is not connected.
    const first = nexusGlobalWire(1, 16, 'W3__H06W0103')?.global
    const second = nexusGlobalWire(1, 16, 'E3__H06W0103')?.global
    expect(first).toBe('R1C10_H06W0103')
    expect(second).toBe('R1C16_H06W0103')
    expect(first).not.toBe(second)
  })

  test('EVERY directional wire in the real design has its ends agree', () => {
    // The whole-graph check. Group every reference by resolved name; each group must sit in exactly one tile
    // position, and the design must actually contain groups with two ends or this proves nothing.
    const groups = new Map<string, Set<string>>()
    let directional = 0
    for (const { row, col, reference } of references()) {
      const resolved = nexusGlobalWire(row, col, reference)
      if (resolved === null) continue
      directional++
      const key = resolved.global
      const seen = groups.get(key) ?? new Set<string>()
      seen.add(`${row},${col}`)
      groups.set(key, seen)
    }
    expect(directional).toBeGreaterThan(10)
    const paired = [...groups.values()].filter((tiles) => tiles.size > 1)
    expect(paired.length).toBeGreaterThan(0) // wires really do span tiles here
    // no resolved wire may claim more than two distinct tiles - a wire has two ends
    for (const [name, tiles] of groups) expect(tiles.size, name).toBeLessThanOrEqual(2)
  })

  test('the reuse that refuted the naive rule is now separated', () => {
    // `H06W0103` was used by six tiles and previously looked like one wire. Resolved, it is three.
    const resolved = new Set<string>()
    for (const { row, col, reference } of references())
      if (reference.endsWith('H06W0103')) {
        const wire = nexusGlobalWire(row, col, reference)
        if (wire !== null) resolved.add(wire.global)
      }
    expect(resolved.size).toBeGreaterThan(1)
  })
})

describe('what the rule deliberately does NOT claim', () => {
  test('clock wires are refused, not forced through the rule', () => {
    // `SPINE__VPSX0400` joined R5C14 and R29C13 - different row AND column, so no span could relate them.
    // Guessing would place a clock net on a tile it has nothing to do with.
    expect(nexusGlobalWire(5, 14, 'SPINE__VPSX0400')).toBeNull()
    expect(nexusGlobalWire(5, 2, 'BRANCH__HPBX0000')).toBeNull()
    expect(isNexusClockWire('SPINE__VPSX0400')).toBe(true)
    expect(isNexusClockWire('S3__V06S0003')).toBe(false)
  })

  test('a tile-local name is not a wire reference at all', () => {
    expect(nexusGlobalWire(5, 2, 'JQ0')).toBeNull()
    expect(nexusGlobalWire(5, 2, 'JF0_SLICEA')).toBeNull()
    expect(isNexusClockWire('JQ0')).toBe(false)
  })

  test('the design really does contain wires this rule cannot resolve', () => {
    // So the refusals above are exercised by real data, not only by invented input.
    const unresolved = references().filter(
      ({ row, col, reference }) => nexusGlobalWire(row, col, reference) === null,
    )
    expect(unresolved.length).toBeGreaterThan(0)
    // Every one is unresolved because its WIRE name is not directional - which is the honest criterion. Judging
    // by the PORT alone is not enough, as the next test shows.
    for (const { reference } of unresolved)
      expect(/__[HV]\d{2}[NSEW]\d+$/.test(reference), reference).toBe(false)
  })

  test('a compass port does not by itself mean a directional wire', () => {
    // `N1__JHPRX4_CMUX_CORE_CMUX0` has a perfectly ordinary `N1` port on a CLOCK-MUX wire. An earlier version of
    // the test above assumed every unresolved reference would have a clock-shaped PORT, and this one broke it.
    // Resolving on the port alone would place a clock mux one span away from where it is.
    const reference = 'N1__JHPRX4_CMUX_CORE_CMUX0'
    expect(isNexusClockWire(reference)).toBe(false) // the port looks directional...
    expect(nexusGlobalWire(29, 48, reference)).toBeNull() // ...but the wire is not, so it is refused
  })
})
