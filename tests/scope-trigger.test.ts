/**
 * Scope trigger tests (S19-v3-75) — the synchronizer's math: edge-crossing
 * detection on sample arrays, the auto level, and sweep alignment with
 * pre-trigger history and clamping.
 */

import { describe, expect, test } from 'vitest'
import { alignSweep, autoLevel, findTriggerIndex } from '../src/renderer/scope-trigger.ts'

/** One sample per degree: sin starting at 0, rising. */
const sine = Array.from({ length: 720 }, (_, i) => 5 * Math.sin((i * Math.PI) / 180))

describe('findTriggerIndex', () => {
  // Levels sit BETWEEN samples (2.4 V on a 5 V-peak, 1°-per-sample sine) so
  // float rounding at an exact crossing can't flip the comparison.
  test('rising edge: fires where the trace crosses UP through the level', () => {
    // 5·sin(28°) = 2.347 < 2.4 ≤ 5·sin(29°) = 2.424 → index 29.
    expect(findTriggerIndex(sine, 2.4, 'rising', 1)).toBe(29)
  })

  test('falling edge: fires on the way DOWN', () => {
    // falls through 2.4 between 151° (2.424) and 152° (2.347).
    expect(findTriggerIndex(sine, 2.4, 'falling', 1)).toBe(152)
  })

  test('the search respects fromIndex — the NEXT period triggers a cycle later', () => {
    expect(findTriggerIndex(sine, 2.4, 'rising', 30)).toBe(389) // 29° + 360°
  })

  test('a flat trace never triggers — null, not an invented event', () => {
    expect(findTriggerIndex(new Array(100).fill(3), 2.5, 'rising', 1)).toBeNull()
    expect(findTriggerIndex(new Array(100).fill(1), 2.5, 'rising', 1)).toBeNull()
  })

  test('a trace entirely above the level never rising-triggers', () => {
    expect(
      findTriggerIndex(
        Array.from({ length: 100 }, (_, i) => 4 + Math.sin(i / 5)),
        2.5,
        'rising',
        1,
      ),
    ).toBeNull()
  })
})

describe('autoLevel', () => {
  test('the midpoint of the swing — a 0–5 V clock auto-levels at 2.5 V', () => {
    const clock = Array.from({ length: 100 }, (_, i) => (i % 20 < 10 ? 0 : 5))
    expect(autoLevel(clock)).toBe(2.5)
  })
  test('an empty trace levels at 0 (nothing to measure)', () => {
    expect(autoLevel([])).toBe(0)
  })
})

describe('alignSweep', () => {
  test('the sweep starts a pre-trigger margin before the crossing', () => {
    // window 360 points, 10% pretrigger = 36; trigger search from 360 finds
    // the 389° crossing → start 353, trigger sits 36 in.
    const aligned = alignSweep({
      samples: sine,
      level: 2.4,
      edge: 'rising',
      windowPoints: 360,
      searchFrom: 360,
    })
    expect(aligned).toEqual({ start: 353, triggerOffset: 36 })
  })

  test('clamps so a full window always fits inside the record', () => {
    // Trigger near the end (falling 152° + 360° = 512°): start would
    // overflow → clamped to length − window.
    const aligned = alignSweep({
      samples: sine,
      level: 2.4,
      edge: 'falling',
      windowPoints: 360,
      searchFrom: 500,
    })
    expect(aligned?.start).toBe(720 - 360)
    expect(aligned?.triggerOffset).toBe(512 - 360)
  })

  test('no crossing → null (Normal mode shows "waiting", never a fake sweep)', () => {
    expect(
      alignSweep({
        samples: new Array(300).fill(1),
        level: 2.5,
        edge: 'rising',
        windowPoints: 100,
        searchFrom: 100,
      }),
    ).toBeNull()
  })
})
