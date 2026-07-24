/**
 * FPGA fabric — Stage 2, increment 1: ingest a REAL iCE40 icebox chipdb (fpga-icebox.ts).
 * The fixture is verbatim genuine iCE40 data (Project IceStorm's icebox, device "384", ISC-licensed — see
 * fixtures/icebox-ice40-384-fragment.chipdb), so these tests prove the parser reads the ACTUAL device format,
 * not an invented one: wires with real spans, `.buffer`/`.routing` pips with their real CRAM bits, and the
 * CRAM programming a chosen routing requires. (The parser was also run against the full ~2 MB / 8294-net /
 * 86,864-pip chipdb during development — every declared net parsed — but only this small fragment is vendored.)
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { cramBitsForRoute, type IceboxPip, parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'

const FRAGMENT = readFileSync(
  new URL('../fixtures/icebox-ice40-384-fragment.chipdb', import.meta.url),
  'utf8',
)
const device = parseIceboxChipdb(FRAGMENT)

describe('parseIceboxChipdb — the real icebox grammar', () => {
  test('.device carries the real device geometry', () => {
    expect(device.name).toBe('384')
    expect(device.width).toBe(8)
    expect(device.height).toBe(10)
    expect(device.numNets).toBe(8294)
  })

  test('a .net becomes a wire whose SPAN is the tile positions it occupies', () => {
    // net 0 is a single-tile local wire; net 79 is a real span-4 track crossing five tile positions.
    const fabout = device.wires.get(0)
    expect(fabout?.name).toBe('fabout')
    expect(fabout?.span).toBe(1)

    const sp4 = device.wires.get(79)
    expect(sp4?.name).toBe('span4_horz_0')
    expect(sp4?.span).toBe(5) // fills the WireNode.span hook left open in Stage 1
    expect(sp4?.segments.map((s) => `${s.x},${s.y}`)).toEqual(['0,1', '1,1', '2,1', '3,1', '4,1'])
  })

  test('a single-bit .buffer parses to a directional src→dst pip gated by one CRAM bit', () => {
    // real line: ".buffer 0 1 87 B0[0]" / "1 9"  ⇒ wire 9 drives wire 87 at tile (0,1) when B0[0] = 1
    const pip = device.pips.find((p) => p.src === 9 && p.dst === 87)
    expect(pip).toBeDefined()
    expect(pip?.kind).toBe('buffer')
    expect(pip?.x).toBe(0)
    expect(pip?.y).toBe(1)
    expect(pip?.condition).toEqual([{ bit: { row: 0, col: 0 }, value: 1 }])
  })

  test('a multi-bit .buffer parses the full PATTERN into per-bit required values', () => {
    // real: ".buffer 0 1 23 B0[4] B1[4] B1[5] B1[6] B1[7]" / "00011 77" ⇒ wire 77 drives 23 when those
    // five bits hold 0,0,0,1,1 in header order.
    const pip = device.pips.find((p) => p.src === 77 && p.dst === 23)
    expect(pip?.condition).toEqual([
      { bit: { row: 0, col: 4 }, value: 0 },
      { bit: { row: 1, col: 4 }, value: 0 },
      { bit: { row: 1, col: 5 }, value: 0 },
      { bit: { row: 1, col: 6 }, value: 1 },
      { bit: { row: 1, col: 7 }, value: 1 },
    ])
  })

  test('a .routing mux parses to one pip PER source option, each with its own bit pattern', () => {
    // real: ".routing 0 1 143 B0[11] B0[12]" with body 01→97, 10→127, 11→80 — three mutually-exclusive
    // sources for wire 143, selected by the two-bit code.
    const toDst = device.pips.filter((p) => p.dst === 143 && p.kind === 'routing')
    expect(toDst.length).toBe(3)
    const bySrc = new Map(toDst.map((p) => [p.src, p.condition]))
    expect(bySrc.get(97)).toEqual([
      { bit: { row: 0, col: 11 }, value: 0 },
      { bit: { row: 0, col: 12 }, value: 1 },
    ])
    expect(bySrc.get(127)).toEqual([
      { bit: { row: 0, col: 11 }, value: 1 },
      { bit: { row: 0, col: 12 }, value: 0 },
    ])
    expect(bySrc.get(80)).toEqual([
      { bit: { row: 0, col: 11 }, value: 1 },
      { bit: { row: 0, col: 12 }, value: 1 },
    ])
  })
})

describe('cramBitsForRoute — a routing → the CRAM bits it programs (the Stage-3 bridge)', () => {
  const pip = (src: number, dst: number): IceboxPip => {
    const found = device.pips.find((p) => p.src === src && p.dst === dst)
    if (!found) throw new Error(`no pip ${src}->${dst}`)
    return found
  }

  test('the required bits + values are collected across the selected pips, with no conflict for a legal route', () => {
    const { bits, conflicts } = cramBitsForRoute([pip(9, 87), pip(77, 23)])
    expect(conflicts).toEqual([])
    // exactly the six bits those two real pips constrain, at tile (0,1), with their values
    const asText = bits.map((b) => `${b.x},${b.y}:B${b.row}[${b.col}]=${b.value}`).sort()
    expect(asText).toEqual([
      '0,1:B0[0]=1',
      '0,1:B0[4]=0',
      '0,1:B1[4]=0',
      '0,1:B1[5]=0',
      '0,1:B1[6]=1',
      '0,1:B1[7]=1',
    ])
  })

  test('two source options of the same mux are a CONFLICT — they need one bit both ways (illegal routing)', () => {
    // selecting both 97→143 (B0[12]=1) and 127→143 (B0[12]=0) demands B0[12] be 0 AND 1 — reported, not faked
    const { conflicts } = cramBitsForRoute([pip(97, 143), pip(127, 143)])
    expect(conflicts).toContain('0_1_B0[12]')
    expect(conflicts).toContain('0_1_B0[11]')
  })
})
