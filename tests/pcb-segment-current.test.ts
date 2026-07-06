import { describe, expect, test } from 'vitest'
import { netSegmentCurrents } from '../src/renderer/pcb-segment-current.ts'

/**
 * Per-segment trace current from the routed copper tree. The point: a thin branch trace feeding one
 * small load carries only that load, not the whole net's trunk current — so the over-current DRC stops
 * false-flagging branches off a high-current trunk.
 */

const P = (x: number, y: number) => ({ x, y })

describe('netSegmentCurrents', () => {
  test('a simple two-pad net: the single segment carries the through-current', () => {
    const traces = [{ points: [P(0, 0), P(5, 0)] }]
    const pads = [
      { at: P(0, 0), current: 2.4 },
      { at: P(5, 0), current: 2.4 },
    ]
    expect(netSegmentCurrents(traces, pads, 2.4)).toEqual([[2.4]])
  })

  test('a multi-drop net: the trunk carries the SUM, each branch only its own load', () => {
    // Source S (2 A) at (0,0) → junction J (5,0) → branch to L1 (1 A) and branch to L2 (1 A).
    const traces = [
      { points: [P(0, 0), P(5, 0)] }, // trunk S → J
      { points: [P(5, 0), P(5, 5)] }, // branch J → L1
      { points: [P(5, 0), P(5, -5)] }, // branch J → L2
    ]
    const pads = [
      { at: P(0, 0), current: 2 }, // source
      { at: P(5, 5), current: 1 }, // load 1
      { at: P(5, -5), current: 1 }, // load 2
    ]
    const seg = netSegmentCurrents(traces, pads, 2)
    expect(seg[0]).toEqual([2]) // the trunk carries both loads
    expect(seg[1]).toEqual([1]) // the branch to L1 carries only L1
    expect(seg[2]).toEqual([1]) // the branch to L2 carries only L2
  })

  test('the fix: a thin branch off a high-current trunk is NOT the trunk current', () => {
    // A 5 A source feeds a big 4.9 A load AND a small 0.1 A load. The small branch carries 0.1 A —
    // where the old whole-net check would have flagged it against 5 A.
    const traces = [
      { points: [P(0, 0), P(10, 0)] }, // trunk S → J
      { points: [P(10, 0), P(10, 2)] }, // branch to the BIG load
      { points: [P(10, 0), P(10, -2)] }, // branch to the SMALL load
    ]
    const pads = [
      { at: P(0, 0), current: 5 },
      { at: P(10, 2), current: 4.9 },
      { at: P(10, -2), current: 0.1 },
    ]
    const seg = netSegmentCurrents(traces, pads, 5)
    expect(seg[0]?.[0]).toBeCloseTo(5, 6) // trunk
    expect(seg[1]?.[0]).toBeCloseTo(4.9, 6) // big branch
    expect(seg[2]?.[0]).toBeCloseTo(0.1, 6) // small branch — no longer 5 A
  })

  test('a multi-segment trunk: each corner passes the through-current', () => {
    // Source → corner → corner → load, all one chain: every segment carries the full load.
    const traces = [{ points: [P(0, 0), P(5, 0), P(5, 5), P(9, 5)] }]
    const pads = [
      { at: P(0, 0), current: 1.5 },
      { at: P(9, 5), current: 1.5 },
    ]
    expect(netSegmentCurrents(traces, pads, 1.5)).toEqual([[1.5, 1.5, 1.5]])
  })

  test('a net whose copper forms a LOOP falls back to the whole-net max (topology alone is ambiguous)', () => {
    // Three pads wired in a triangle: 3 nodes, 3 edges — not a tree, so per-segment is undetermined.
    const traces = [
      { points: [P(0, 0), P(4, 0)] },
      { points: [P(4, 0), P(2, 3)] },
      { points: [P(2, 3), P(0, 0)] },
    ]
    const pads = [
      { at: P(0, 0), current: 2 },
      { at: P(4, 0), current: 1 },
      { at: P(2, 3), current: 1 },
    ]
    expect(netSegmentCurrents(traces, pads, 2)).toEqual([[2], [2], [2]])
  })

  test('a pad sitting off the routed copper falls back (the net is not a clean tree)', () => {
    const traces = [{ points: [P(0, 0), P(5, 0)] }]
    const pads = [
      { at: P(0, 0), current: 1 },
      { at: P(5, 0), current: 1 },
      { at: P(99, 99), current: 1 }, // not on any trace
    ]
    expect(netSegmentCurrents(traces, pads, 1)).toEqual([[1]])
  })
})
