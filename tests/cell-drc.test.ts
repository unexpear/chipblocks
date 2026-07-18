import { describe, expect, test } from 'vitest'
import { cellDrc, namedCellDrc, standardCellDrc, summarizeDrc } from '../src/renderer/cell-drc.ts'
import type { CellRect } from '../src/renderer/cell-polygons.ts'

// ---- engine correctness: each rule caught in isolation on synthetic geometry ----
describe('the DRC engine catches each rule (synthetic geometry)', () => {
  test('min_width: a poly stripe thinner than 2 λ is flagged; 2 λ passes', () => {
    const thin: CellRect[] = [{ layer: 'poly', net: 'g', x: 0, y: 0, w: 1, h: 40 }]
    const ok: CellRect[] = [{ layer: 'poly', net: 'g', x: 0, y: 0, w: 2, h: 40 }]
    expect(cellDrc(thin).filter((v) => v.kind === 'min_width')).toHaveLength(1)
    expect(cellDrc(ok).filter((v) => v.kind === 'min_width')).toHaveLength(0)
  })

  test('min_spacing: different-net met1 shapes 1 λ apart flagged; same net or ≥2 λ clean', () => {
    const close: CellRect[] = [
      { layer: 'met1', net: 'a', x: 0, y: 0, w: 4, h: 4 },
      { layer: 'met1', net: 'b', x: 5, y: 0, w: 4, h: 4 }, // 1 λ gap
    ]
    const sameNet: CellRect[] = [
      { layer: 'met1', net: 'a', x: 0, y: 0, w: 4, h: 4 },
      { layer: 'met1', net: 'a', x: 5, y: 0, w: 4, h: 4 },
    ]
    const far: CellRect[] = [
      { layer: 'met1', net: 'a', x: 0, y: 0, w: 4, h: 4 },
      { layer: 'met1', net: 'b', x: 10, y: 0, w: 4, h: 4 }, // 6 λ gap
    ]
    expect(cellDrc(close).filter((v) => v.kind === 'min_spacing')).toHaveLength(1)
    expect(cellDrc(sameNet).filter((v) => v.kind === 'min_spacing')).toHaveLength(0)
    expect(cellDrc(far).filter((v) => v.kind === 'min_spacing')).toHaveLength(0)
  })

  test('exact_size: a licon1 that is not 2×2 λ is flagged', () => {
    const wrong: CellRect[] = [{ layer: 'licon1', net: 'x', x: 0, y: 0, w: 3, h: 2 }]
    const right: CellRect[] = [
      { layer: 'diff', x: 0, y: 0, w: 10, h: 10 },
      { layer: 'licon1', net: 'x', x: 4, y: 4, w: 2, h: 2 },
    ]
    expect(cellDrc(wrong).filter((v) => v.kind === 'exact_size')).toHaveLength(1)
    expect(cellDrc(right).filter((v) => v.kind === 'exact_size')).toHaveLength(0)
  })

  test('containment: a licon1 hanging off its diffusion is flagged; fully on it passes', () => {
    const off: CellRect[] = [
      { layer: 'diff', x: 0, y: 0, w: 4, h: 4 },
      { layer: 'licon1', net: 'x', x: 3, y: 1, w: 2, h: 2 }, // spills past x=4
    ]
    const on: CellRect[] = [
      { layer: 'diff', x: 0, y: 0, w: 10, h: 10 },
      { layer: 'licon1', net: 'x', x: 4, y: 4, w: 2, h: 2 },
    ]
    expect(cellDrc(off).filter((v) => v.kind === 'containment')).toHaveLength(1)
    expect(cellDrc(on).filter((v) => v.kind === 'containment')).toHaveLength(0)
  })

  test('a fully clean synthetic cell reports nothing', () => {
    const clean: CellRect[] = [
      { layer: 'diff', x: 0, y: 0, w: 10, h: 10 },
      { layer: 'poly', net: 'g', x: 20, y: 0, w: 2, h: 10 },
      { layer: 'met1', net: 'vss', x: 0, y: 30, w: 30, h: 8 },
      { layer: 'licon1', net: 'x', x: 4, y: 4, w: 2, h: 2 },
    ]
    expect(cellDrc(clean)).toHaveLength(0)
  })
})

// ---- characterisation of the real standard cells (what the engine reports, honestly) ----
describe('the standard-cell library under DRC', () => {
  const reports = standardCellDrc()
  const byName = new Map(reports.map((r) => [r.name, r.violations]))

  test('every gate is width-clean and contact-size-clean (no min_width, no exact_size)', () => {
    for (const r of reports) {
      const bad = r.violations.filter((v) => v.kind === 'min_width' || v.kind === 'exact_size')
      expect(bad, `${r.name} has width/size violations`).toHaveLength(0)
    }
  })

  test('single-stage gates (NOT/NAND/NOR) have NO containment violations', () => {
    for (const name of ['NOT', 'NAND', 'NOR']) {
      const v = byName.get(name) ?? []
      expect(
        v.filter((x) => x.kind === 'containment'),
        `${name} containment`,
      ).toHaveLength(0)
    }
  })

  test('composite gates report containment violations only (the disclosed stage-boundary relaxation)', () => {
    for (const name of ['AND', 'OR', 'XOR', 'XNOR']) {
      const v = byName.get(name) ?? []
      const containment = v.filter((x) => x.kind === 'containment')
      expect(
        containment.length,
        `${name} should have stage-boundary containment relaxations`,
      ).toBeGreaterThan(0)
      // and they are all on contact layers
      for (const c of containment) expect(['licon1', 'mcon']).toContain(c.layer)
    }
  })

  test('the only violation kinds across the whole library are min_spacing + containment', () => {
    const all = new Set<string>()
    for (const r of reports) for (const v of r.violations) all.add(v.kind)
    expect([...all].sort()).toEqual(['containment', 'min_spacing'])
  })

  test('the DRC is deterministic (same violations twice)', () => {
    expect(standardCellDrc()).toEqual(reports)
  })

  test('summarizeDrc reports a clean sweep and a dirty sweep sensibly', () => {
    const clean = summarizeDrc([{ name: 'X', violations: [] }])
    expect(clean).toContain('clean')
    const dirty = summarizeDrc(reports)
    expect(dirty).toMatch(/containment|min_spacing/)
    expect(dirty).toContain('not foundry-DRC-clean')
  })
})

describe('namedCellDrc — the per-design sweep', () => {
  test('dedupes cell names and skips unknown ones', () => {
    const reports = namedCellDrc(['NAND', 'NAND', 'MYSTERY', 'NOT'])
    expect(reports.map((r) => r.name)).toEqual(['NAND', 'NOT']) // NAND once, MYSTERY dropped
  })

  test('a design of only NAND is width-clean with just its minimal-pitch spacing note', () => {
    const reports = namedCellDrc(['NAND'])
    const v = reports[0]?.violations ?? []
    expect(v.every((x) => x.kind === 'min_spacing')).toBe(true)
  })
})
