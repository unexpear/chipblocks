/**
 * Undo/redo history tests (S19-v3-73) — the desktop contract: checkpoint
 * before each change, undo walks back, redo walks forward, a fresh edit
 * forks off the redo branch, bursts of typing coalesce into one step.
 */

import { describe, expect, test } from 'vitest'
import {
  canRedo,
  canUndo,
  checkpoint,
  dropLastCheckpoint,
  emptyHistory,
  MAX_UNDO_STEPS,
  redo,
  undo,
} from '../src/renderer/undo-history.ts'

describe('undo / redo walk', () => {
  test('undo restores the checkpointed state; redo brings the change back', () => {
    let h = emptyHistory<string>()
    h = checkpoint(h, 'empty canvas', 'drop', 1000) // about to drop a part
    const afterDrop = 'canvas with resistor'

    const back = undo(h, afterDrop)
    expect(back).not.toBeNull()
    if (back === null) return
    expect(back.restored).toBe('empty canvas')
    expect(canRedo(back.history)).toBe(true)

    const forward = redo(back.history, back.restored, 2000)
    expect(forward?.restored).toBe(afterDrop)
    expect(canUndo(forward?.history ?? emptyHistory())).toBe(true)
  })

  test('undo on an empty history is a clean null, not a crash', () => {
    expect(undo(emptyHistory<string>(), 'anything')).toBeNull()
    expect(redo(emptyHistory<string>(), 'anything', 0)).toBeNull()
  })

  test('a fresh edit after an undo discards the redo branch (the fork rule)', () => {
    let h = emptyHistory<string>()
    h = checkpoint(h, 'A', 'drop', 1000)
    const back = undo(h, 'B')
    if (back === null) throw new Error('expected undo')
    expect(canRedo(back.history)).toBe(true)
    const forked = checkpoint(back.history, back.restored, 'wire', 2000)
    expect(canRedo(forked)).toBe(false) // 'B' is gone — the timeline forked
  })

  test('several undos walk all the way back in order', () => {
    let h = emptyHistory<string>()
    h = checkpoint(h, 'v1', 'drop', 1000)
    h = checkpoint(h, 'v2', 'wire', 2000)
    h = checkpoint(h, 'v3', 'delete', 3000)
    const b1 = undo(h, 'v4')
    const b2 = undo(b1?.history ?? h, b1?.restored ?? '')
    const b3 = undo(b2?.history ?? h, b2?.restored ?? '')
    expect([b1?.restored, b2?.restored, b3?.restored]).toEqual(['v3', 'v2', 'v1'])
    expect(undo(b3?.history ?? h, 'v1')).toBeNull() // bottom of the stack
  })
})

describe('coalescing — typing is one step, structure is many', () => {
  test('rapid same-param edits merge: one undo returns to before the typing', () => {
    let h = emptyHistory<string>()
    h = checkpoint(h, 'R=', 'param:r1:resistance', 1000) // user types 4
    h = checkpoint(h, 'R=4', 'param:r1:resistance', 1200) // …7
    h = checkpoint(h, 'R=47', 'param:r1:resistance', 1400) // …0
    expect(h.past.length).toBe(1)
    expect(undo(h, 'R=470')?.restored).toBe('R=')
  })

  test('a pause longer than the window starts a NEW step', () => {
    let h = emptyHistory<string>()
    h = checkpoint(h, 'R=', 'param:r1:resistance', 1000)
    h = checkpoint(h, 'R=470', 'param:r1:resistance', 5000) // separate edit later
    expect(h.past.length).toBe(2)
  })

  test('structural edits never coalesce — two quick drops are two undo steps', () => {
    let h = emptyHistory<string>()
    h = checkpoint(h, 'empty', 'drop', 1000)
    h = checkpoint(h, 'one part', 'drop', 1100)
    expect(h.past.length).toBe(2)
  })

  test('the stack caps out instead of growing forever', () => {
    let h = emptyHistory<number>()
    for (let i = 0; i < MAX_UNDO_STEPS + 20; i++) {
      h = checkpoint(h, i, 'drop', i * 2000)
    }
    expect(h.past.length).toBe(MAX_UNDO_STEPS)
    expect(h.past[0]?.state).toBe(20) // the oldest fell off
  })
})

describe('an action that checkpointed and was then abandoned', () => {
  test('taking the checkpoint back leaves the history exactly as it was', () => {
    // A staged draw checkpoints, starts, and is Stopped — the canvas is put back, so the checkpoint
    // now describes the state already on screen. Left behind, the user's first Ctrl+Z appears to do
    // nothing, which is the complaint the Stop path was measured making.
    let h = emptyHistory<string>()
    h = checkpoint(h, 'their circuit', 'drop', 1000)
    const before = h
    h = checkpoint(h, 'their circuit', 'calculator', 2000)
    expect(h.past.length).toBe(2)
    h = dropLastCheckpoint(h, 'calculator')
    expect(h).toEqual(before)
    expect(undo(h, 'their circuit')?.restored).toBe('their circuit')
  })

  test('it will not trim a checkpoint that is not the one it pushed', () => {
    // Another edit landed in between, so the history is no longer ours to shorten — trimming here
    // would silently throw away the user's own undo step.
    let h = emptyHistory<string>()
    h = checkpoint(h, 'a', 'calculator', 1000)
    h = checkpoint(h, 'b', 'drop', 2000)
    expect(dropLastCheckpoint(h, 'calculator')).toEqual(h)
    expect(dropLastCheckpoint(emptyHistory<string>(), 'calculator').past).toEqual([])
  })

  test('the redo branch it was going to fork is left where the drop found it', () => {
    let h: ReturnType<typeof emptyHistory<string>> = { past: [], future: ['later'] }
    h = { past: [{ state: 'now', tag: 'calculator', at: 1000 }], future: h.future }
    expect(dropLastCheckpoint(h, 'calculator')).toEqual({ past: [], future: ['later'] })
  })
})
