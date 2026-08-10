/**
 * The bookkeeping around ONE staged draw: what is drawing, what the canvas looked like before it
 * started, and the pulse that lets a stall be noticed.
 *
 * Why this is a thing of its own rather than four `useRef`s in the canvas component, which is what it
 * was. The four are not independent — the running draw, the flag that holds the solver and the
 * auto-router off, the canvas Stop puts back, and the watchdog's pulse all begin and end together, and
 * they were begun and ended by hand in three separate places. A mutation run applied one deletion at a
 * time to those places and the whole suite stayed green for every one of them, because a React closure
 * inside an 11,000-line component is not reachable from any test in this project. The rules here are
 * the same rules; they are here so that they can be exercised rather than only read.
 *
 * Each of them is a defect that was found the hard way:
 *   • A draw begun while another is still drawing must CANCEL the first. Two stagers appending to one
 *     canvas interleave two designs into a circuit nobody drew.
 *   • The flag must come down on the way out of every exit — finished, cancelled, stopped. Left up, the
 *     window refuses every Save ("the design is still being drawn") and does nothing when Solve is
 *     pressed, for the rest of the session, with nothing drawing.
 *   • A FINISHED draw must let go of the canvas it replaced. That canvas is what Stop puts back, and a
 *     draw that finished has no Stop to offer — so holding it can only ever put an old design back over
 *     the design the user is now looking at, and until then it keeps every part of it alive in memory.
 *   • A CANCELLED draw must keep it, because cancelling is how Stop asks, and the answer is the thing
 *     Stop is for.
 */

/** As much of the stager as a session needs to know about. `StagedDraw` is the one that is passed. */
export type StagedDrawRunner = {
  cancel: () => void
  tick: () => void
}

/** Whether a draw has reached an end, in the only two ways it can. */
export type StagedDrawOutcome = {
  done: boolean
  cancelled: boolean
}

/**
 * How often the watchdog asks a running draw to re-check itself.
 *
 * It is the ONLY thing in the app that can ever report a stall. The stall check watches the gap since a
 * batch RETURNED — the scheduler never calling back, with the thread perfectly free — and nothing else
 * runs in that state, so without a pulse the check is unreachable code and a starved draw looks exactly
 * like the freeze this whole mechanism exists to replace. A quarter second notices a five-second stall
 * within a fifth of its length.
 */
export const STALL_PULSE_MS = 250

export class StagedDrawSession<TCanvas> {
  private runner: StagedDrawRunner | null = null
  private canvasBefore: TCanvas | null = null
  private drawing = false

  /** True from the moment a draw begins until it finishes, is cancelled, or is stopped. */
  get isDrawing(): boolean {
    return this.drawing
  }

  /**
   * A new draw is about to start. Whatever was drawing is called off FIRST, before this draw's canvas
   * is remembered and before the flag goes up — the cancelled draw reports its own end through
   * `progressed`, and that report arriving after either of them would take down the flag of the draw
   * that is only just beginning.
   */
  begin(canvasBefore: TCanvas): void {
    this.runner?.cancel()
    this.runner = null
    this.canvasBefore = canvasBefore
    this.drawing = true
  }

  /** The stager now driving this draw. */
  attach(runner: StagedDrawRunner): void {
    this.runner = runner
  }

  /** What the stager reported. Everything held for the draw is let go on the way out. */
  progressed(outcome: StagedDrawOutcome): void {
    if (!outcome.done && !outcome.cancelled) return
    this.drawing = false
    this.runner = null
    if (outcome.done) this.canvasBefore = null
  }

  /**
   * Stop pressed. Returns the canvas to put back, or null when there is nothing to put back and so
   * nothing to say — which is the state a draw that already finished leaves behind.
   */
  stop(): TCanvas | null {
    const restore = this.canvasBefore
    this.runner?.cancel()
    this.runner = null
    this.canvasBefore = null
    this.drawing = false
    return restore
  }

  /** Start the watchdog's pulse; the returned call stops it. */
  pulseWhileDrawing(): () => void {
    const pulse = setInterval(() => this.runner?.tick(), STALL_PULSE_MS)
    return () => clearInterval(pulse)
  }
}
