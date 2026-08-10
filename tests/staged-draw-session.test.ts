/**
 * The bookkeeping around one staged draw — and the four guards a mutation run proved nothing was
 * holding.
 *
 * All four lived as single lines inside a React closure in an 11,000-line component: cancel the draw
 * already running, lower the "still arriving" flag on the way out of Stop, let go of the old canvas
 * when a draw finishes, and pulse the watchdog. Each was deleted on its own and the whole 4,253-test
 * suite stayed green for every one of them, because nothing in this project can render that component.
 * They are now in `staged-draw-session.ts` for exactly that reason, and these are the tests that fail.
 *
 * What is exercised here is the state machine, driven the way the canvas drives it. What is NOT reached
 * from here — said plainly rather than covered by a test that greps for it — is the four CALL SITES in
 * App.tsx: `begin`/`attach` in `stageDraw`, `progressed` in the stager's own progress callback, `stop`
 * in the Stop button, and the effect that runs `pulseWhileDrawing` while the card is on screen. A
 * deletion there compiles and no test in this repository can see it. The tests at the end of
 * canvas-capacity.ts's suite read the source for those four, which proves the lines are present and
 * nothing more; the behaviour they guard is proven here.
 */

import { describe, expect, test, vi } from 'vitest'
import { StagedDraw, type StagedDrawChunk } from '../src/renderer/canvas-draw-staging.ts'
import { STALL_PULSE_MS, StagedDrawSession } from '../src/renderer/staged-draw-session.ts'

/** The canvas a draw replaced — only its identity matters here. */
type Canvas = { parts: string }

/** A stager stand-in that records what the session asked of it. */
function fakeRunner() {
  const calls = { cancels: 0, ticks: 0 }
  return {
    calls,
    runner: {
      cancel: () => {
        calls.cancels += 1
      },
      tick: () => {
        calls.ticks += 1
      },
    },
  }
}

describe('a draw beginning while another is still drawing', () => {
  test('the one already drawing is called off', () => {
    const session = new StagedDrawSession<Canvas>()
    const first = fakeRunner()
    session.begin({ parts: 'the old canvas' })
    session.attach(first.runner)
    session.begin({ parts: 'what the second draw replaces' })
    expect(first.calls.cancels).toBe(1)
  })

  test('the cancelled draw’s own report cannot take down the new draw’s flag', () => {
    // The order is the whole guard. The cancelled stager reports its end synchronously, through the
    // same `progressed` the live draw uses, so a cancel issued AFTER the flag went up lowers it again
    // — and a canvas that is drawing with the flag down re-solves a half-built circuit on every batch
    // and refuses nothing it should refuse.
    const session = new StagedDrawSession<Canvas>()
    const reporting = {
      cancel: () => session.progressed({ done: false, cancelled: true }),
      tick: () => undefined,
    }
    session.begin({ parts: 'the old canvas' })
    session.attach(reporting)
    session.begin({ parts: 'what the second draw replaces' })
    expect(session.isDrawing).toBe(true)
  })

  test('the first draw commits nothing more once the second has begun', () => {
    // The same thing with the real stager on both sides: two draws appending to one canvas interleave
    // two designs into a circuit nobody drew. The scheduler here hands back a callback that is fired
    // by hand, which is what a browser frame arriving after the second draw started looks like.
    const session = new StagedDrawSession<Canvas>()
    const committed: { draw: string; chunk: StagedDrawChunk }[] = []
    let pendingFirst: (() => void) | undefined
    const first = new StagedDraw({
      what: 'the first design',
      parts: 200,
      wires: 0,
      expectedMs: 1000,
      now: () => 0,
      schedule: (run) => {
        pendingFirst = run
        return () => {
          pendingFirst = undefined
        }
      },
      commit: (chunk) => committed.push({ draw: 'first', chunk }),
      settle: [() => undefined],
      onProgress: (progress) => session.progressed(progress),
    })
    session.begin({ parts: 'the canvas before either' })
    session.attach(first)
    first.start()
    pendingFirst?.()
    expect(committed.length).toBe(1)
    // A second design starts. Whatever the browser does with the first draw's pending frame, nothing
    // more of the first design may land.
    session.begin({ parts: 'the canvas the first draw left' })
    pendingFirst?.()
    pendingFirst?.()
    expect(committed.map((c) => c.draw)).toEqual(['first'])
  })
})

describe('the flag that holds the solver and the auto-router off', () => {
  test('it is down again after Stop', () => {
    // Left up, every Save is refused with "the design is still being drawn", Save as Template is
    // refused, the Solve button does nothing and both automatic re-solves stand down — for the rest of
    // the session, with nothing drawing and no way for the user to find out why.
    const session = new StagedDrawSession<Canvas>()
    session.begin({ parts: 'before' })
    session.attach(fakeRunner().runner)
    expect(session.isDrawing).toBe(true)
    session.stop()
    expect(session.isDrawing).toBe(false)
  })

  test('it is down again after a draw finishes, and after one that reports itself cancelled', () => {
    const finished = new StagedDrawSession<Canvas>()
    finished.begin({ parts: 'before' })
    finished.progressed({ done: true, cancelled: false })
    expect(finished.isDrawing).toBe(false)

    const cancelled = new StagedDrawSession<Canvas>()
    cancelled.begin({ parts: 'before' })
    cancelled.progressed({ done: false, cancelled: true })
    expect(cancelled.isDrawing).toBe(false)
  })

  test('it stays up while the draw is only progressing', () => {
    const session = new StagedDrawSession<Canvas>()
    session.begin({ parts: 'before' })
    session.progressed({ done: false, cancelled: false })
    expect(session.isDrawing).toBe(true)
  })
})

describe('what Stop puts back', () => {
  test('the canvas as it was before the draw started', () => {
    const session = new StagedDrawSession<Canvas>()
    const runner = fakeRunner()
    session.begin({ parts: 'the design the user had' })
    session.attach(runner.runner)
    expect(session.stop()).toEqual({ parts: 'the design the user had' })
    expect(runner.calls.cancels).toBe(1)
  })

  test('a draw that FINISHED leaves nothing for Stop to put back', () => {
    // This is the guard that reads as pure tidiness and is not. The canvas held here is the canvas
    // Stop restores; a finished draw's canvas is the design now on screen, so a snapshot kept past the
    // finish can only put an old design back over the new one — the one thing a Stop must never do —
    // and until then it holds every part and every wire of the replaced design alive in memory.
    const session = new StagedDrawSession<Canvas>()
    session.begin({ parts: 'the design the user had' })
    session.attach(fakeRunner().runner)
    session.progressed({ done: true, cancelled: false })
    expect(session.stop()).toBeNull()
  })

  test('a FINISHED draw is let go of, so nothing can still reach its stager', () => {
    // MUTATION-TESTED, and this is the test that catches it: deleting `this.runner = null` from
    // `progressed` (staged-draw-session.ts) left every other test in this project green. What it breaks
    // has two halves, and both are here because neither is visible from the other.
    //
    // The stager closes over the whole design it drew, so a session that keeps a finished one keeps a
    // second copy of every part and every wire alive for as long as the tab lives. That cannot be
    // asserted directly from a test — nothing here can see the heap — so what is asserted is the thing
    // that proves the reference is gone: neither the watchdog's pulse nor a later Stop can reach it.
    const session = new StagedDrawSession<Canvas>()
    const runner = fakeRunner()
    session.begin({ parts: 'the design the user had' })
    session.attach(runner.runner)
    session.progressed({ done: true, cancelled: false })
    session.stop()
    expect(runner.calls.cancels).toBe(0)
  })

  test('a finished draw is not pulsed, because there is nothing left to re-check', () => {
    // The other half of the same guard. `tick` re-emits the draw's progress, so a finished stager still
    // on the end of the pulse goes on reporting a draw that is over, four times a second, for ever.
    vi.useFakeTimers()
    try {
      const session = new StagedDrawSession<Canvas>()
      const runner = fakeRunner()
      session.begin({ parts: 'before' })
      session.attach(runner.runner)
      const stop = session.pulseWhileDrawing()
      vi.advanceTimersByTime(STALL_PULSE_MS * 2)
      expect(runner.calls.ticks).toBe(2)
      session.progressed({ done: true, cancelled: false })
      vi.advanceTimersByTime(STALL_PULSE_MS * 8)
      expect(runner.calls.ticks).toBe(2)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  test('a draw that was CANCELLED still has it, because cancelling is how Stop asks', () => {
    // Stop cancels the stager and then asks what to restore. The stager's cancellation arrives first,
    // through `progressed`, so a session that let go on either ending would answer Stop with nothing
    // and leave the user looking at a part-drawn design where their own used to be.
    const session = new StagedDrawSession<Canvas>()
    const throughStop = {
      cancel: () => session.progressed({ done: false, cancelled: true }),
      tick: () => undefined,
    }
    session.begin({ parts: 'the design the user had' })
    session.attach(throughStop)
    expect(session.stop()).toEqual({ parts: 'the design the user had' })
  })

  test('Stop asked twice puts nothing back the second time', () => {
    const session = new StagedDrawSession<Canvas>()
    session.begin({ parts: 'the design the user had' })
    session.attach(fakeRunner().runner)
    session.stop()
    expect(session.stop()).toBeNull()
  })

  test('with nothing ever drawn there is nothing to restore and nothing to say', () => {
    expect(new StagedDrawSession<Canvas>().stop()).toBeNull()
  })
})

describe('the watchdog’s pulse', () => {
  test('a running draw is asked to re-check itself four times a second', () => {
    // Without this the stall check is unreachable code. It watches the gap since a batch RETURNED —
    // the scheduler never calling back, the thread perfectly free — and in that state nothing else in
    // the app runs to notice, so a starved draw would sit at 40 % for ever looking exactly like the
    // freeze the whole progress card exists to replace.
    vi.useFakeTimers()
    try {
      const session = new StagedDrawSession<Canvas>()
      const runner = fakeRunner()
      session.begin({ parts: 'before' })
      session.attach(runner.runner)
      const stop = session.pulseWhileDrawing()
      vi.advanceTimersByTime(STALL_PULSE_MS * 4)
      expect(runner.calls.ticks).toBe(4)
      stop()
      vi.advanceTimersByTime(STALL_PULSE_MS * 8)
      expect(runner.calls.ticks).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })

  test('the pulse is quick enough to notice a stall well inside its own threshold', () => {
    // STALL_MS is 5,000: a pulse slower than that could never fire during one, and one at the
    // threshold would report a stall a stall-length late.
    expect(STALL_PULSE_MS).toBeLessThan(5_000 / 4)
  })

  test('a real draw that stops being called back is NOTICED, and only because of the pulse', () => {
    // End to end: the stager, the session and the pulse together, with a scheduler that takes the
    // callback and never fires it — the one failure that leaves the thread free.
    vi.useFakeTimers()
    try {
      const clock = { ms: 0 }
      const session = new StagedDrawSession<Canvas>()
      const seen: (string | undefined)[] = []
      const draw = new StagedDraw({
        what: 'a big saved project',
        parts: 500,
        wires: 0,
        expectedMs: 60_000,
        now: () => clock.ms,
        schedule: () => () => undefined, // taken, never called back
        commit: () => undefined,
        settle: [() => undefined],
        onProgress: (progress) => {
          seen.push(progress.trouble?.kind)
          session.progressed(progress)
        },
      })
      session.begin({ parts: 'before' })
      session.attach(draw)
      const stop = session.pulseWhileDrawing()
      draw.start()
      expect(seen.at(-1)).toBeUndefined()
      // Six seconds of a draw that is not being called back at all.
      for (let i = 0; i < 6_000 / STALL_PULSE_MS; i++) {
        clock.ms += STALL_PULSE_MS
        vi.advanceTimersByTime(STALL_PULSE_MS)
      }
      expect(seen.at(-1)).toBe('stalled')
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
