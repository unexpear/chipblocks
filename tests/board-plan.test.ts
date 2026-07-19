/**
 * The Board manufacturing-readiness plan data (board-plan.ts) — the seed for the Plan dock. This guards the
 * declarative list's integrity: every tier present, every item fully filled + cited (an item with no value
 * or no citation would be a placeholder, which the project forbids), ids globally unique (the Plan panel
 * keys status overrides by id — a duplicate would silently share a checkbox), and valid size/status enums.
 */
import { describe, expect, test } from 'vitest'
import { BOARD_PLAN, type PlanItemSize, type PlanStatus } from '../src/renderer/board-plan.ts'

const SIZES: PlanItemSize[] = ['S', 'M', 'L']
const STATUSES: PlanStatus[] = ['todo', 'doing', 'done']

describe('BOARD_PLAN — the manufacturing-readiness roadmap data', () => {
  test('has the five tiers 0–4, each non-empty', () => {
    expect(BOARD_PLAN.map((t) => t.tier)).toEqual([0, 1, 2, 3, 4])
    for (const tier of BOARD_PLAN) {
      expect(tier.name.length).toBeGreaterThan(0)
      expect(tier.items.length).toBeGreaterThan(0)
    }
  })

  test('every item is fully specified + cited (no placeholders)', () => {
    for (const tier of BOARD_PLAN) {
      for (const item of tier.items) {
        expect(item.id.length).toBeGreaterThan(0)
        expect(item.title.length).toBeGreaterThan(0)
        expect(item.what.length).toBeGreaterThan(0)
        expect(item.value.length, `${item.id} needs a real value`).toBeGreaterThan(0)
        expect(item.cite.length, `${item.id} needs a citation`).toBeGreaterThan(0)
        expect(SIZES).toContain(item.size)
        expect(STATUSES).toContain(item.status)
      }
    }
  })

  test('item ids are globally unique (the Plan panel keys status by id)', () => {
    const ids = BOARD_PLAN.flatMap((t) => t.items.map((i) => i.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('Tier 0 is the honesty patches — the immediate work — and is substantial', () => {
    const tier0 = BOARD_PLAN.find((t) => t.tier === 0)
    expect(tier0).toBeDefined()
    expect(tier0?.items.length ?? 0).toBeGreaterThanOrEqual(10)
    // the high-severity items the reconfirm surfaced must be present
    const ids = new Set(tier0?.items.map((i) => i.id))
    expect(ids.has('voltage-clearance-creepage-t0')).toBe(true)
    expect(ids.has('trace-width-by-copper-weight')).toBe(true)
    expect(ids.has('annular-ring-drc')).toBe(true)
  })
})
