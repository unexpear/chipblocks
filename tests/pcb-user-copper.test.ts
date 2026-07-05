/**
 * Hand-drawn copper made REAL. `copperConnects` is the physical-connectivity check (union-find over a
 * spatial grid, per layer, vias bridging) and `mergeUserCopper` unions the user's traces/vias into the
 * auto-router's output AND recomputes the owed (unrouted) list — the keystone that lets a hand-routed
 * board actually satisfy the export gate. These prove the honest cases: same-layer copper joins, copper
 * on different layers does NOT join without a via, a via bridges it, and a trace that stops short of a
 * pad leaves the connection owed.
 */
import { describe, expect, test } from 'vitest'
import type { Airwire } from '../src/renderer/pcb-board.ts'
import {
  type BoardRouting,
  type CopperTrace,
  copperConnects,
  mergeUserCopper,
  type Via,
} from '../src/renderer/pcb-route.ts'

const trace = (layer: 'top' | 'bottom', points: { x: number; y: number }[]): CopperTrace => ({
  net: 'N',
  widthMm: 0.25,
  layer,
  points,
})

describe('copperConnects — real physical connectivity', () => {
  test('a single trace joins its two ends on the same layer', () => {
    const t = trace('top', [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ])
    expect(copperConnects({ x: 0, y: 0 }, { x: 5, y: 0 }, [t], [])).toBe(true)
  })

  test('copper on DIFFERENT layers that meet at a point does NOT join without a via', () => {
    const top = trace('top', [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ])
    const bot = trace('bottom', [
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ])
    expect(copperConnects({ x: 0, y: 0 }, { x: 10, y: 0 }, [top, bot], [])).toBe(false)
  })

  test('a via at the meeting point bridges the layers — now it joins', () => {
    const top = trace('top', [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ])
    const bot = trace('bottom', [
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ])
    const via: Via = { net: 'N', at: { x: 5, y: 0 }, diameterMm: 0.6, drillMm: 0.4 }
    expect(copperConnects({ x: 0, y: 0 }, { x: 10, y: 0 }, [top, bot], [via])).toBe(true)
  })

  test('a trace that stops short of the far pad does not connect it', () => {
    const t = trace('top', [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ])
    expect(copperConnects({ x: 0, y: 0 }, { x: 5, y: 0 }, [t], [])).toBe(false)
  })
})

describe('mergeUserCopper — union + recompute the owed list', () => {
  const owed: Airwire = { net: 'N', from: { x: 0, y: 0 }, to: { x: 5, y: 0 } }
  const auto: BoardRouting = { traces: [], vias: [], unrouted: [owed] }

  test('empty user copper returns the auto routing unchanged (same object)', () => {
    expect(mergeUserCopper(auto, [], [])).toBe(auto)
  })

  test('a user trace that joins the pads drops the airwire from the owed list AND ships the copper', () => {
    const t = trace('top', [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ])
    const merged = mergeUserCopper(auto, [t], [])
    expect(merged.unrouted.length).toBe(0) // delivered → export gate can pass
    expect(merged.traces).toContain(t) // the copper flows to the view / DRC / Gerber
  })

  test('a user trace that does NOT reach the far pad leaves the connection owed', () => {
    const t = trace('top', [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ])
    const merged = mergeUserCopper(auto, [t], [])
    expect(merged.unrouted.length).toBe(1) // still owed — honest
    expect(merged.traces).toContain(t)
  })

  test('a two-layer hand route (top → via → bottom) delivers the connection', () => {
    const owed2: Airwire = { net: 'N', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }
    const auto2: BoardRouting = { traces: [], vias: [], unrouted: [owed2] }
    const top = trace('top', [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ])
    const bot = trace('bottom', [
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ])
    const via: Via = { net: 'N', at: { x: 5, y: 0 }, diameterMm: 0.6, drillMm: 0.4 }
    const merged = mergeUserCopper(auto2, [top, bot], [via])
    expect(merged.unrouted.length).toBe(0)
    expect(merged.vias).toContain(via)
  })
})
