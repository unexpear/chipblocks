import { describe, expect, test } from 'vitest'
import { NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { STANDARD_CELL_BLOCKS } from '../src/renderer/cell-drc.ts'
import { type CellRect, cellPolygons, extractNetlist } from '../src/renderer/cell-polygons.ts'
import {
  compareNetlists,
  extractLayoutNetlist,
  lvsCompare,
  standardCellLvs,
  summarizeLvs,
} from '../src/renderer/lvs.ts'

const nandRects = () => cellPolygons(NAND2_BLOCK).rects
const stageCount = (name: string) =>
  cellPolygons(
    STANDARD_CELL_BLOCKS.find((b) => b.name === name) as (typeof STANDARD_CELL_BLOCKS)[number],
  ).stageCount

describe('geometric extraction (labels never consulted for connectivity)', () => {
  test('NAND recovers 2 NMOS in series + 2 PMOS in parallel, rails and output resolved', () => {
    const L = extractLayoutNetlist(nandRects())
    const nmos = L.transistors.filter((t) => t.type === 'n')
    const pmos = L.transistors.filter((t) => t.type === 'p')
    expect(nmos).toHaveLength(2)
    expect(pmos).toHaveLength(2)
    expect(new Set([L.vdd, L.vss, L.out]).size).toBe(3)
    // both PMOS bridge VDD ↔ OUT (parallel)
    for (const p of pmos) expect(new Set(p.sd)).toEqual(new Set([L.vdd, L.out]))
    // NMOS series: one touches VSS, one touches OUT, and they share a middle diffusion node
    expect(nmos.filter((t) => t.sd.includes(L.vss))).toHaveLength(1)
    expect(nmos.filter((t) => t.sd.includes(L.out))).toHaveLength(1)
    const mid = (nmos[0] as { sd: [string, string] }).sd.find(
      (s) => s !== L.vss && s !== L.out,
    ) as string
    expect(nmos.every((t) => t.sd.includes(mid))).toBe(true)
    expect(L.inputs).toHaveLength(2)
    expect(L.notes).toHaveLength(0)
  })

  test('every gate extracts the right transistor count + type split', () => {
    const expected: Record<string, [number, number]> = {
      NOT: [1, 1],
      Buffer: [2, 2],
      NAND: [2, 2],
      NOR: [2, 2],
      AND: [3, 3],
      OR: [3, 3],
      XOR: [8, 8],
      XNOR: [9, 9],
    }
    for (const b of STANDARD_CELL_BLOCKS) {
      const L = extractLayoutNetlist(cellPolygons(b).rects)
      const [n, p] = expected[b.name] as [number, number]
      expect(
        L.transistors.filter((t) => t.type === 'n'),
        b.name,
      ).toHaveLength(n)
      expect(
        L.transistors.filter((t) => t.type === 'p'),
        b.name,
      ).toHaveLength(p)
      expect(L.vdd, `${b.name} vdd`).not.toBe('')
      expect(L.vss, `${b.name} vss`).not.toBe('')
    }
  })
})

describe('the LVS verdict on the standard-cell library', () => {
  const reports = standardCellLvs()
  const byName = new Map(reports.map((r) => [r.name, r.result]))

  test('single-stage gates (NOT/NAND/NOR) MATCH from geometry alone', () => {
    for (const name of ['NOT', 'NAND', 'NOR']) {
      const r = byName.get(name)
      expect(stageCount(name)).toBe(1)
      expect(r?.status, name).toBe('match')
      expect(r?.areaEstimate).toBe(false)
      expect(r?.deviceMap.size).toBe(r?.deviceCountSchematic)
    }
  })

  test('composite gates now MATCH too (the inter-stage router closed the gap)', () => {
    for (const name of ['Buffer', 'AND', 'OR', 'XOR', 'XNOR']) {
      const r = byName.get(name)
      expect(stageCount(name)).toBeGreaterThan(1)
      expect(r?.status, name).toBe('match')
      expect(r?.areaEstimate, name).toBe(false)
      expect(r?.deviceMap.size, name).toBe(r?.deviceCountSchematic)
      expect(r?.notes.some((n) => n.includes('unrouted'))).toBe(false)
    }
  })

  test('summarizeLvs reports a full 8/8 match, no area-estimates', () => {
    const s = summarizeLvs(reports)
    expect(s).toContain('8/8 cells match')
    expect(s).not.toContain('area-estimate')
    expect(s).toContain('0 true mismatch')
  })
})

describe('the inter-stage router', () => {
  test("a primary input fanning out to several columns is strapped into ONE net (XOR's A/B)", () => {
    const xor = STANDARD_CELL_BLOCKS.find(
      (b) => b.name === 'XOR',
    ) as (typeof STANDARD_CELL_BLOCKS)[number]
    const L = extractLayoutNetlist(cellPolygons(xor).rects)
    // XOR has TWO primary inputs (A, B), each gating several columns — after routing they extract as 2 nets
    expect(L.inputs).toHaveLength(2)
    expect(lvsCompare(xor).match).toBe(true)
  })

  test('no composite has a floating gate left (every gate net is contacted)', () => {
    for (const name of ['Buffer', 'AND', 'OR', 'XOR', 'XNOR']) {
      const b = STANDARD_CELL_BLOCKS.find(
        (x) => x.name === name,
      ) as (typeof STANDARD_CELL_BLOCKS)[number]
      expect(extractLayoutNetlist(cellPolygons(b).rects).notes.join(' ')).not.toContain('unrouted')
    }
  })

  test('routing introduces no different-net overlap (short) on met1 or li1', () => {
    const overlapArea = (a: CellRect, b: CellRect) =>
      Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-9 &&
      Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-9
    for (const b of STANDARD_CELL_BLOCKS) {
      for (const layer of ['met1', 'li1'] as const) {
        const rs = cellPolygons(b).rects.filter((r) => r.layer === layer)
        for (let i = 0; i < rs.length; i++) {
          for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i] as CellRect
            const c = rs[j] as CellRect
            if (overlapArea(a, c) && a.net !== undefined && a.net !== c.net) {
              throw new Error(`${b.name}: ${layer} short between ${a.net} and ${c.net}`)
            }
          }
        }
      }
    }
  })

  test('routing is deterministic (XOR/XNOR rects identical across calls)', () => {
    for (const name of ['XOR', 'XNOR']) {
      const b = STANDARD_CELL_BLOCKS.find(
        (x) => x.name === name,
      ) as (typeof STANDARD_CELL_BLOCKS)[number]
      expect(cellPolygons(b).rects).toEqual(cellPolygons(b).rects)
    }
  })
})

describe('label immunity — connectivity is geometry-only (the killer test)', () => {
  test('scrambling every net label leaves the NAND LVS verdict unchanged (match)', () => {
    const scrambled: CellRect[] = nandRects().map((r) =>
      r.net === undefined ? r : { ...r, net: 'SCRAMBLED' },
    )
    const L = extractLayoutNetlist(scrambled)
    const result = compareNetlists(L, extractNetlist(NAND2_BLOCK))
    expect(result.match).toBe(true)
    expect(result.areaEstimate).toBe(false)
  })
})

describe('negative / corrupted-layout mutants (labels only locate what to break)', () => {
  const schematic = extractNetlist(NAND2_BLOCK)

  test('deleting one poly stripe drops BOTH its transistors → device_count mismatch (layout 2)', () => {
    const polyX = Math.min(
      ...nandRects()
        .filter((r) => r.layer === 'poly')
        .map((r) => r.x),
    )
    const broken = nandRects().filter((r) => !(r.layer === 'poly' && r.x === polyX))
    const result = compareNetlists(extractLayoutNetlist(broken), schematic)
    expect(result.match).toBe(false)
    expect(result.deviceCountLayout).toBe(2)
    expect(result.discrepancies.some((d) => d.kind === 'device_count')).toBe(true)
    expect(result.areaEstimate).toBe(false) // a TRUE regression, not the unrouted-composite case
  })

  test('deleting the n-well makes the PMOS row extract as NMOS → device_type mismatch', () => {
    const broken = nandRects().filter((r) => r.layer !== 'nwell')
    const L = extractLayoutNetlist(broken)
    expect(L.transistors.filter((t) => t.type === 'n')).toHaveLength(4)
    expect(L.transistors.filter((t) => t.type === 'p')).toHaveLength(0)
    const result = compareNetlists(L, schematic)
    expect(result.match).toBe(false)
    expect(result.discrepancies.some((d) => d.kind === 'device_type')).toBe(true)
  })

  test('deleting the pull-down output contact opens OUT from the NMOS drain → mismatch', () => {
    // the n-diffusion OUT contact is the rightmost licon1 in the n-diffusion band (VSS is leftmost)
    const rects = nandRects()
    const nContacts = rects.filter((r) => r.layer === 'licon1' && r.y < 40)
    const nOut = nContacts.reduce((a, b) => (b.x > a.x ? b : a))
    const broken = rects.filter((r) => r !== nOut)
    const L = extractLayoutNetlist(broken)
    expect(L.out).toBe('') // no net ties both diffusion rows any more
    const result = compareNetlists(L, schematic)
    expect(result.match).toBe(false)
    expect(result.areaEstimate).toBe(false) // a true regression, not an unrouted composite
  })

  test('a TRUE regression on a composite is NOT masked as areaEstimate', () => {
    // AND carries an "unrouted inter-stage" note, but deleting a poly is a real device-count regression —
    // it must count as a true mismatch, never be hidden behind the expected-area-estimate flag.
    const and = STANDARD_CELL_BLOCKS.find(
      (b) => b.name === 'AND',
    ) as (typeof STANDARD_CELL_BLOCKS)[number]
    const rects = cellPolygons(and).rects
    const polyX = Math.min(...rects.filter((r) => r.layer === 'poly').map((r) => r.x))
    const broken = rects.filter((r) => !(r.layer === 'poly' && r.x === polyX))
    const result = compareNetlists(extractLayoutNetlist(broken), extractNetlist(and))
    expect(result.match).toBe(false)
    expect(result.discrepancies.some((d) => d.kind === 'device_count')).toBe(true)
    expect(result.areaEstimate).toBe(false)
  })

  test('a stray li1 shorting the VDD and VSS straps → short', () => {
    const stray: CellRect = { layer: 'li1', net: 'STRAY', x: 3, y: 0, w: 12, h: 90 }
    const L = extractLayoutNetlist([...nandRects(), stray])
    expect(L.vdd).toBe(L.vss) // the rails collapsed
    const result = compareNetlists(L, schematic)
    expect(result.match).toBe(false)
    expect(result.discrepancies.some((d) => d.kind === 'short')).toBe(true)
  })
})

describe('determinism + robustness', () => {
  test('extraction is order-independent (shuffled rects → identical structure)', () => {
    const rects = nandRects()
    const shuffled = [...rects].reverse()
    const a = extractLayoutNetlist(rects)
    const b = extractLayoutNetlist(shuffled)
    const sig = (t: { id: string; type: string; gate: string; sd: [string, string] }) =>
      `${t.type}|${t.gate}|${[...t.sd].sort().join(',')}`
    expect(a.transistors.map(sig).sort()).toEqual(b.transistors.map(sig).sort())
    expect([a.vdd, a.vss, a.out]).toEqual([b.vdd, b.vss, b.out])
    expect(a.nets).toEqual(b.nets)
  })

  test('extraction never throws on empty / malformed input', () => {
    expect(() => extractLayoutNetlist([])).not.toThrow()
    expect(extractLayoutNetlist([]).transistors).toHaveLength(0)
    const junk: CellRect[] = [
      { layer: 'poly', net: 'x', x: 0, y: 0, w: 0, h: 0 },
      { layer: 'diff', x: -5, y: -5, w: 2, h: 2 },
      { layer: 'licon1', net: 'y', x: 100, y: 100, w: 2, h: 2 },
    ]
    expect(() =>
      compareNetlists(extractLayoutNetlist(junk), extractNetlist(NAND2_BLOCK)),
    ).not.toThrow()
  })

  test('lvsCompare on a 0-transistor extraction is a graceful mismatch, not a throw', () => {
    const result = compareNetlists(extractLayoutNetlist([]), extractNetlist(NAND2_BLOCK))
    expect(result.status).toBe('mismatch')
    expect(result.discrepancies.some((d) => d.kind === 'device_count')).toBe(true)
  })

  test('lvsCompare(block) matches the library sweep for a single cell', () => {
    expect(lvsCompare(NAND2_BLOCK).match).toBe(true)
  })
})
