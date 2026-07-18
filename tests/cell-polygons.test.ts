import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import {
  AND_BLOCK,
  BUFFER_BLOCK,
  INVERTER_BLOCK,
  NAND2_BLOCK,
  NOR2_BLOCK,
  OR_BLOCK,
  XNOR_BLOCK,
  XOR_BLOCK,
} from '../src/renderer/builtin-blocks.ts'
import { cellGeometry } from '../src/renderer/cell-layout.ts'
import {
  type CellRect,
  cellBlock,
  cellPolygons,
  extractNetlist,
} from '../src/renderer/cell-polygons.ts'

const ALL: BlockData[] = [
  INVERTER_BLOCK,
  BUFFER_BLOCK,
  NAND2_BLOCK,
  NOR2_BLOCK,
  AND_BLOCK,
  OR_BLOCK,
  XOR_BLOCK,
  XNOR_BLOCK,
]

const strictOverlap = (a: CellRect, b: CellRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('the standard-cell registry', () => {
  test('all 8 gate names resolve; an unknown name does not', () => {
    for (const g of ALL) expect(cellBlock(g.name)).toBe(g)
    expect(cellBlock('MYSTERY')).toBeUndefined()
    expect(cellBlock('constructor')).toBeUndefined()
  })
})

describe('netlist extraction', () => {
  test('NAND2: 2 NMOS series, 2 PMOS parallel, distinct rails + output, 2 inputs', () => {
    const net = extractNetlist(NAND2_BLOCK)
    expect(net.transistors.filter((t) => t.type === 'n')).toHaveLength(2)
    expect(net.transistors.filter((t) => t.type === 'p')).toHaveLength(2)
    expect(net.inputs).toHaveLength(2)
    expect(new Set([net.vdd, net.vss, net.out]).size).toBe(3)
    // both PMOS bridge VDD↔OUT (parallel)
    for (const p of net.transistors.filter((t) => t.type === 'p'))
      expect(new Set(p.sd)).toEqual(new Set([net.vdd, net.out]))
    // exactly one NMOS touches VSS and one touches OUT, sharing an internal middle net (series)
    const n = net.transistors.filter((t) => t.type === 'n')
    expect(n.filter((t) => t.sd.includes(net.vss))).toHaveLength(1)
    expect(n.filter((t) => t.sd.includes(net.out))).toHaveLength(1)
  })

  test('extraction is deterministic (same net ids twice)', () => {
    const a = extractNetlist(NAND2_BLOCK)
    const b = extractNetlist(NAND2_BLOCK)
    expect(a.transistors).toEqual(b.transistors)
    expect([a.vdd, a.vss, a.out]).toEqual([b.vdd, b.vss, b.out])
  })

  test('AND (composite): 6 transistors, cell output distinct from the internal NAND output', () => {
    const net = extractNetlist(AND_BLOCK)
    expect(net.transistors).toHaveLength(6)
    expect(new Set([net.vdd, net.vss, net.out]).size).toBe(3)
  })
})

describe('cell geometry invariants (all 8 gates)', () => {
  test('width matches the area model, height is the row height', () => {
    for (const g of ALL) {
      const layout = cellPolygons(g)
      expect(layout.widthLambda).toBe(cellGeometry(g).widthLambda)
      expect(layout.heightLambda).toBe(90)
    }
  })

  test('column count = round(transistors/2)', () => {
    const expected: Record<string, number> = {
      NOT: 1,
      Buffer: 2,
      NAND: 2,
      NOR: 2,
      AND: 3,
      OR: 3,
      XOR: 8,
      XNOR: 9,
    }
    for (const g of ALL) expect(cellPolygons(g).columns.length).toBe(expected[g.name])
  })

  test('every gate lays out reliably (balanced, common Euler ordering found)', () => {
    for (const g of ALL) expect(cellPolygons(g).reliable).toBe(true)
  })

  test('all rectangles are in-bounds [0,W]×[0,90] with non-negative coordinates', () => {
    for (const g of ALL) {
      const layout = cellPolygons(g)
      for (const r of layout.rects) {
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.x + r.w).toBeLessThanOrEqual(layout.widthLambda + 1e-9)
        expect(r.y + r.h).toBeLessThanOrEqual(90 + 1e-9)
      }
    }
  })

  test('no short: within each layer, overlapping rectangles share one defined net', () => {
    for (const g of ALL) {
      const layout = cellPolygons(g)
      const byLayer = new Map<string, CellRect[]>()
      for (const r of layout.rects) {
        const list = byLayer.get(r.layer) ?? []
        list.push(r)
        byLayer.set(r.layer, list)
      }
      for (const [layer, rects] of byLayer) {
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i] as CellRect
            const b = rects[j] as CellRect
            if (!strictOverlap(a, b)) continue
            expect(
              a.net !== undefined && a.net === b.net,
              `${g.name}: overlapping ${layer} rects on nets ${a.net} / ${b.net}`,
            ).toBe(true)
          }
        }
      }
    }
  })

  test('every gate has real device layers present', () => {
    for (const g of ALL) {
      const layers = new Set(cellPolygons(g).rects.map((r) => r.layer))
      for (const need of ['poly', 'diff', 'nwell', 'met1'])
        expect(layers.has(need as CellRect['layer']), `${g.name} missing ${need}`).toBe(true)
    }
  })

  test('the connection stack is continuous: every contact/via is covered by a same-net li1', () => {
    // A licon1 (diff/poly → li1) or mcon (li1 → met1) that is not OVERLAPPED by an li1 of its net is an
    // electrical OPEN — the exact class of bug an edge-touch (zero-area) strap produces. li1 must share
    // positive area with each cut/via, not merely abut it.
    for (const g of ALL) {
      const layout = cellPolygons(g)
      const li1 = layout.rects.filter((r) => r.layer === 'li1')
      for (const via of layout.rects) {
        if (via.layer !== 'licon1' && via.layer !== 'mcon') continue
        const covered = li1.some((l) => l.net === via.net && strictOverlap(l, via))
        expect(
          covered,
          `${g.name}: ${via.layer} on net ${via.net} at (${via.x},${via.y}) not covered by li1`,
        ).toBe(true)
      }
    }
  })
})

describe('NAND-specific layout (the Euler abutment payoff)', () => {
  const layout = cellPolygons(NAND2_BLOCK)
  test('exactly 2 poly columns', () => {
    expect(layout.rects.filter((r) => r.layer === 'poly')).toHaveLength(2)
  })
  test('the pull-down NMOS diffusion is ONE unbroken strip (series abutment)', () => {
    const nDiff = layout.rects.filter((r) => r.layer === 'diff' && r.y < 40)
    expect(nDiff).toHaveLength(1)
  })
  test('no diffusion contact on the internal series-middle net', () => {
    // 2-input NAND: n-diff vertices VSS, MIDN, OUT → contacts only on VSS + OUT (2), never MIDN
    const nContacts = layout.rects.filter((r) => r.layer === 'licon1' && r.y < 40)
    expect(nContacts.length).toBe(2)
  })
})

describe('composite AND: two stages, one diffusion break per row', () => {
  const layout = cellPolygons(AND_BLOCK)
  test('3 columns across 2 stages', () => {
    expect(layout.columns.length).toBe(3)
    expect(layout.stageCount).toBe(2)
  })
  test('each diffusion row is broken into 2 runs (NAND stage + inverter stage)', () => {
    expect(layout.rects.filter((r) => r.layer === 'diff' && r.y < 40)).toHaveLength(2)
    expect(layout.rects.filter((r) => r.layer === 'diff' && r.y > 40)).toHaveLength(2)
  })
})

describe('fallback: an unbalanced / non-CMOS block never crashes', () => {
  const LONE: BlockData = {
    name: 'TEST_LONE',
    symbol: 'not',
    origin: { x: 0, y: 0 },
    nodes: [{ id: 'n', definition: 'transistor_mosfet_nmos', x: 0, y: 0 }],
    edges: [],
    ports: [
      { id: 'in', label: 'in', side: 'left', offset: 10, inner: { nodeId: 'n', handleId: 'gate' } },
      {
        id: 'gnd',
        label: 'GND',
        side: 'left',
        offset: 30,
        inner: { nodeId: 'n', handleId: 'source' },
      },
      {
        id: 'out',
        label: 'out',
        side: 'right',
        offset: 10,
        inner: { nodeId: 'n', handleId: 'drain' },
      },
    ],
  }
  test('produces valid non-overlapping geometry, reliable=false, with a note', () => {
    const layout = cellPolygons(LONE)
    expect(layout.reliable).toBe(false)
    expect(layout.notes.length).toBeGreaterThan(0)
    expect(layout.rects.length).toBeGreaterThan(0)
    for (const r of layout.rects) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(layout.widthLambda + 1e-9)
    }
  })
})
