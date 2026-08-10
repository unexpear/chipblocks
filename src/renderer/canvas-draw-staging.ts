/**
 * Putting a big design on the canvas WITHOUT the window going dead — and saying, the whole time, what
 * is actually happening.
 *
 * The defect this exists for: a placer or a file open handed React the whole design in one call, and the
 * window then answered nothing until every part was measured and every wire routed. Measured on the
 * BUILT app, the calculator demo (119 parts / 241 wires) held it for 4.1 to 8.8 seconds across five cold
 * runs, and a 200-part / 262-wire saved design for 30 seconds. Nothing was on screen for any of it: no
 * progress, no cancel, no message. A person cannot tell that from a crash.
 *
 * The project lead's decision, in their words: "so loading long is fine just make sure its not just
 * stuck". So the fix is NOT a smaller demo and NOT a tighter limit. It is that the work is handed over a
 * batch at a time, the browser paints between batches, and what gets painted is driven by work actually
 * done — parts placed of parts to place, wires drawn of wires to draw. Nothing here animates on a timer.
 *
 * WHAT IS REAL AND WHAT IS NOT, precisely, because a progress bar that guesses is a lie:
 *   • The PARTS and WIRES phases are counted. `unitsDone` is the number of parts and wires actually
 *     committed to the canvas, and it only moves after the commit returns.
 *   • The SETTLING phase is NOT counted and says so (`determinate: false`). Wire routing, measurement
 *     and the solve that follows are three calls into React and the solver with no unit to count between
 *     them, so it reports that it cannot say how far along it is rather than inventing a percentage.
 *     Three calls rather than one is what lets the browser paint in the middle of it; it is still not a
 *     thing that can be counted.
 *   • `elapsedMs` is a clock reading, not a projection. Nothing here predicts a finish time.
 *
 * HOW LONG A BATCH TOOK IS NOT HOW LONG `commit` TOOK. This is the defect the first version of this file
 * shipped with, and every other number here depends on getting it right. `commit` hands React a state
 * update and returns; the render, the layout and the paint it causes all happen AFTER that return. So
 * timing the call itself read ~0 ms every single time, `nextBatchUnits` never saw an overrun, and the
 * batch grew without bound — on the built app the progress card went 4, 33, 54, 86, 134, 314, 476, 1,084
 * parts inside about a second (…/repair/before-2000.json). Those eight figures are the RUNNING TOTAL the
 * card shows ("Placing parts — 1,084 of 2,000"), sampled every 100 ms; they are not batch sizes, and an
 * earlier version of this comment read them as if they were. The largest step between two samples is 608
 * parts, and since one sample can cover several batches even that is an upper bound on any single batch.
 * A 2,000-block project drawn that way still stopped the window for 6,132 ms in one stretch, with single
 * tasks of 5,397 and 3,710 ms (…/repair/before-2000.json — an earlier version of this passage also said
 * that run "printed its own stall message quoting a longest-step-so-far of 0 ms", and no artifact on disk
 * holds that: the file cited has no troubles field at all, so the sentence is gone). What a batch really
 * costs is only known when the NEXT one starts, so that is when it is measured here: the batch clock runs
 * from one batch beginning to the next beginning, which covers the commit, React's render, the layout and
 * the paint.
 *
 * WHAT IT CAN AND CANNOT DETECT. The batches run on the thread that paints the window, so a batch that
 * never returns cannot be reported by this code while it is happening — no JavaScript on that thread
 * runs. What IS detected, and what makes this different from a spinner:
 *   • a batch that returned but took far longer than the ones before it — reported the moment the NEXT
 *     batch starts, which is the first instant that cost can be known (`SLOW_BATCH_MS`);
 *   • the scheduler never calling back at all (the window occluded, the frame callback starved), which
 *     leaves the thread free and the watchdog able to fire — the case a spinner would sit through for
 *     ever;
 *   • the whole load running well past the estimate it was admitted under.
 * All three leave the canvas intact and offer to stop. None of them destroys the user's work.
 *
 * ─── WHAT IT DID, MEASURED ON THE BUILT APP ──────────────────────────────────────────────────────────
 *
 * Same machine, same method and the same three demos as the before-numbers above (Windows 11 Pro
 * 10.0.26200, i7-12700H, 31.7 GB; `npm run build` then `npx electron .`; a 100 ms in-page heartbeat plus
 * PerformanceObserver('longtask'); a full reload and a fresh Circuit editor before every cold run;
 * triggered through toolbar ▸ Add Part ▸ the row ▸ Place). Longest gap between two heartbeats — the
 * stretch during which the window answered nothing — worst of eight runs each:
 *
 *      calculator          8,812 ms  →  610 ms
 *      Verilog CPU demo      676 ms  →  283 ms
 *      8-bit Verilog CPU   1,071 ms  →  238 ms
 *
 * Five of the eight on the bundle before the launcher door was staged (…/appl/staged-r1.json …
 * staged-r5.json) and three on the one after (…/appl/staged-final-r1.json … staged-final-r3.json); the
 * worst of all eight is kept, and the two sets agree — the calculator's worst is 610 ms on one and
 * 595 ms on the other.
 *
 * THREE MORE COLD RUNS, measured independently afterwards with a harness written from scratch for the
 * audit (…/appl/audit-three.json), found worse than any of those eight for the calculator: 593 / 592 /
 * 1,023 ms. The other two demos agreed (181, 236). So the figures to hold this code to are 1,023 / 236 /
 * 283 ms, and eight runs were not enough to find the worst of a quantity this noisy — which is the same
 * lesson the appliance table in canvas-capacity.ts carries about a single run. Two further runs on the
 * bundle after the stage-on-mount fix agree (929 / 222 / 263 ms, …/appl/audit-after.json): that fix
 * changed which SMALL designs are staged and left these three where they were.
 *
 * The same runs sampled the bar's own DOM on the same 100 ms tick. It rendered in all twenty-four, and
 * the fraction it showed rose monotonically, with the label counting real parts and real wires
 * ("Placing parts — 86 of 119", "Drawing wires — 129 of 241"). That is the check that could not be done
 * by reading the code: a bar wrapped around one long synchronous call renders exactly once, at the end,
 * and looks perfectly correct in the source. How MANY distinct values were caught is a property of the
 * design's size, not of the bar: six to eight for the calculator, and as few as one for the 8-bit CPU
 * demo, whose whole staged draw can be over inside two samples.
 *
 * The door the complaint itself came from — a saved project opened through the launcher (My Projects ▸
 * the project) — measured on the same fixture the earlier freeze work used, 200 resistors and 262 wires
 * (…/appl/file-door.json, three cold runs). One call: 10,338 ms of dead window. In batches: worst gap
 * 287 / 673 / 451 ms, with the bar showing eight to eleven distinct fractions and reading, in order,
 * "Placing parts — 4 of 200" through "Drawing wires — 206 of 262" and then "Routing wires and
 * simulating — this step cannot report how far along it is". Whole load, 8.3 to 11.0 s.
 *
 * The design that comes out is the same design: 119 parts and 241 wires, a solve ran (164 ms), and
 * pressing 7 on the placed keypad changed the seven-segment displays and re-solved
 * (…/appl/verify-staged.json).
 *
 * STOPPING. An earlier version of this comment said a Stop "halted at 10 parts" and left them on the
 * canvas, with undo to take them back. Both halves of that were wrong in the app, and measured wrong:
 * stopping half way through a placement over a 300-part project left 54 new parts beside the OLD
 * project's 250 wires (…/repair/before-stop.json), and on the door a saved project opens through there
 * was no checkpoint to undo at all. Stopping now puts the canvas back exactly as it was — the stager
 * still simply halts, and App.tsx owns the restore, because what to put back is not a thing this file
 * can know.
 *
 * ─── WHY A BATCH USED TO COST WHAT THE CANVAS COSTS, AND NO LONGER DOES ──────────────────────────────
 *
 * An earlier version of this comment said the remaining freeze could not be fixed by any arrangement of
 * batches, because "committing anything makes React re-render the canvas already there, so ONE render of
 * a 2,000-block canvas is 5 to 7 seconds". That was a guess dressed as a finding, and it was wrong.
 * Making React skip the parts already drawn (memoising every node component) changed a 2,000-block draw
 * by nothing at all — 12,157 ms of worst silence became 13,166 (…/repair/t2/before-blk2000.json,
 * memo-blk2000.json). React's render was never where the time went.
 *
 * The V8 sampling profiler on the built app said where it did. Of a 30,846 ms draw of that same design,
 * 18,224 ms — 59 % — was inside React Flow's `updateNodeInternals`, with 3,865 ms of self time in its
 * store's `memoizedSelector` and 3,838 ms in the `shallow` comparison after it
 * (…/repair/t2/prof-blk2000.json). Two places asked for one part to be re-measured at a time, and each
 * ask is a store write every part on the canvas then answers: N parts re-measured one by one cost N × N.
 * The library's own hook takes a LIST and writes once for the whole list. Collecting the ids and handing
 * them over together is the whole fix (src/renderer/node-internals.ts).
 *
 * That is what the batch sizer needed. A feedback loop can only find a batch size that keeps the window
 * answering if such a size exists, and while every commit cost the whole canvas, none did.
 *
 * ─── BEFORE AND AFTER, ON THE FOUR DESIGNS THE VERIFIERS USED ────────────────────────────────────────
 *
 * Same machine, same hour, same door (Launcher ▸ My Projects ▸ the project), three cold runs each; the
 * "before" build is this same tree with the two re-measure call sites put back the way they were, so the
 * pair is minutes apart rather than the usual hours. Longest gap between two ticks of a 100 ms in-page
 * heartbeat — the stretch during which the window answered nothing — all three runs, worst last.
 *
 * WHAT NONE OF THESE TABLES USED TO SAY IS THAT THEY ARE WARM-RUN DATA. Every run is cold in the sense
 * that the app is launched and killed for it, but the FIRST launch after a build is not the same
 * measurement as the ones after it, and a table that quietly averages it in is comparing two things. The
 * rule since is that the first launch after each build is a named warm-up that is thrown away: 400
 * symbols / 520 wires drew in 4,040 ms on the first launch against 4,085 and 4,271 warm, and 100 / 130
 * in 1,082 against 761 and 778 (…/rg/warmup-symbol400.json, warmup2-symbol100.json). The penalty is not
 * reliably in one direction — no penalty at all in the first of those, 1.4x in the second, and a
 * 2,500-block draw's first launch after a build came out FASTER than both runs after it, 9,199 ms
 * against 9,218 and 9,599 (…/rg/block2500w1000.json) — which is the reason for naming the run rather
 * than averaging it in.
 *
 *                                     whole draw                 longest silence
 *      400 symbols /  520 wires   3.7-3.8 s → 3.8-4.0 s      795/914/800 →  830/901/808   ms
 *    1,000 blocks / 1,000 wires  14.4-17.0 s → 4.8 s      4,423/4,564/5,588 →  806/1,101/933
 *    2,000 blocks / 1,000 wires  48.1-73.9 s → 7.9-8.8 s  17,697/28,217/29,609 → 1,225/1,448/1,293
 *    2,500 blocks / 1,000 wires 83.1-117.7 s → 9.8-10.2 s 33,895/61,813/49,256 → 1,412/1,432/1,478
 *
 * (…/repair/t2/before-symbol400.json … before-block2500.json, after-symbol400.json …
 * after-block2500.json.) The 400-symbol design is unchanged, and that is expected rather than
 * disappointing: it has no grouped blocks, so only one of the two call sites applied to it and 400 parts
 * is small enough for that one not to dominate. Where the defect bit, the worst silence on a 2,500-block
 * design fell from 61.8 seconds to 1.5.
 *
 * "THE BIGGEST DESIGN THIS APP ADMITS" is what that last sentence used to say about 2,500 blocks, and it
 * was already false when written and is further from true now: 8,000 grouped blocks with 1,000 wires are
 * admitted and drawn, and so are 6,000 and 4,000 (…/bs/after-block8000w1000.json and its neighbours).
 * 2,500 blocks is a design in the middle of the range, not at the top of it.
 *
 * Two of those before-figures are worth reading twice. A 2,500-block project is ADMITTED by the capacity
 * check, and it stopped the window for 61.8 seconds in one stretch — longer than the minute the check
 * exists to keep the wait under. And the spread across three identical cold runs (33.9 / 61.8 / 49.3 s)
 * is why single runs are not trusted anywhere in this file.
 *
 * ─── WHAT IS STILL TRUE ──────────────────────────────────────────────────────────────────────────────
 *
 * Batching still does not make a big canvas free. A second and a half of silence is a second and a half,
 * and on a slower machine it will be more. What the fix changes is that the silence is now roughly the
 * cost of ONE BATCH rather than of the whole canvas, which is the thing a batch sizer can actually
 * govern — and across the twelve runs above it held every batch under the second the slow-batch check
 * watches for, so none of them printed a trouble message.
 *
 * Those four designs are not the big end, though, and past them it does not hold. Measured on the bundle
 * these tests ship with, at sizes this app admits: 3,000 blocks print two to three slow-batch messages a
 * run, 8,000 blocks TEN to fourteen — 14, 14, 11, 12 and 10 across its five runs, and an earlier version
 * of this line said "eleven to fourteen" and left the tenth out (…/bs/after-block3000w1000.json,
 * after-block8000w1000.json). They are true, the card says them out loud, and the draw keeps going.
 *
 * ─── WHAT THE SIZER CANNOT REACH, AND WHAT WAS NOT THE SIZER'S AT ALL ────────────────────────────────
 *
 * THIS PASSAGE USED TO CALL THE SETTLING STEP A FLOOR NOTHING COULD LOWER. It said: "route every wire,
 * measure, solve — is one call. No batch sizer touches it… That is the floor this file cannot lower."
 * The first half was a description of how it was written, not a fact about the work: routing every wire
 * and solving the circuit share nothing, and they are three calls now, one per scheduler turn with a
 * paint between (`settle` is a LIST). The second half was wrong twice over, because the batch sizer was
 * never where the time was going either.
 *
 * WHAT THE TIME WAS REALLY GOING ON, profiled rather than reasoned about. A 46,674 ms draw of 2,000
 * grouped blocks with 3,400 wires spent 15,071 ms inside `findWireCrossings` and 9,501 more in the
 * segment intersection under it — 53 % of the whole draw (…/cg/prof-b2000w3400.json, V8 sampling
 * profiler at 1 ms on the built app). That scan compares every wire with every other one, and it was
 * being re-run from scratch on EVERY batch, over a half-drawn canvas whose crossings cannot be clicked
 * yet. It is not the batch sizer's to fix and no batch size makes it cheaper.
 *
 * That was worth knowing before touching the sizer, because the sizer had already been blamed. Handing
 * over SMALLER batches was measured making it worse, not better: on the same design a run that descended
 * below the count floor handed over 3 wires and took 4,415 ms doing it, then 25 wires for 7,843
 * (…/cg/after1-b2000w3400.json, rep 3 — a 149,503 ms draw). A cost paid per HANDOVER cannot be batched
 * away, and that is what a quadratic scan re-run per handover looks like from inside the sizer.
 *
 * WHAT THE THREE FIXES DID, measured on the built app through the launcher door, three cold runs each,
 * longest gap between two ticks of a 100 ms in-page heartbeat. 2,000 grouped blocks with 3,400 wires —
 * the worst-silence design of the seven this app admits at its boundary:
 *
 *      worst silence   8,270 / 8,469 / 7,794 ms  →  3,379 / 2,994 / 3,030 ms
 *      whole draw       30.4 /  32.0 /  29.7 s   →   18.7 /  19.3 /  19.1 s
 *
 * (…/cg/before-b2000w3400.json → …/cg/after4-b2000w3400.json.) BOTH went down, which is the part worth
 * saying out loud: the trade a smaller batch would have cost — a longer draw for a quieter window — was
 * not the trade on offer, because the work being removed was work nobody wanted done.
 *
 * The settling step is still the longest single silence of that draw, and now it is three of them rather
 * than one. It is still where a wire-heavy design's worst stretch lands, and it is still why
 * canvas-capacity.ts refuses on a SILENCE estimate rather than trusting the sizer to keep every design
 * quiet.
 */

/** What the draw is doing right now. The order is the order they run in. */
export type StagedDrawPhase = 'parts' | 'wires' | 'settling'

/** One handover of work to the canvas: a half-open range of one phase's items. */
export type StagedDrawChunk = { phase: StagedDrawPhase; from: number; to: number }

/** Why a draw is in trouble, or undefined while it is healthy. */
export type StagedDrawTrouble = {
  kind: 'stalled' | 'slow-batch' | 'over-estimate'
  message: string
}

/** Everything the progress UI is allowed to show, and nothing it is not. */
export type StagedDrawProgress = {
  /** What is being drawn, in the words of the door that started it — "the calculator". */
  what: string
  phase: StagedDrawPhase
  /** Parts and wires committed so far, and how many there are. Real counts, never a projection. */
  unitsDone: number
  unitsTotal: number
  /**
   * The same, counted within the phase on show. The bar is filled from the whole design, but the words
   * beside it name one kind of thing, and "Placing parts — 10 of 360" is a sentence that counts parts up
   * to a total of parts AND wires. Measured on the built app it read exactly that (…/appl/
   * staged-probe.json), which is how the mismatch was found.
   */
  phaseDone: number
  phaseTotal: number
  /** False during settling, where there is no unit to count and no honest percentage to show. */
  determinate: boolean
  elapsedMs: number
  /** The draw-cost estimate this design was admitted under, for the over-estimate check. */
  expectedMs: number
  /**
   * The longest single batch so far, measured beginning-to-beginning so React's render and the paint
   * are inside it. Zero until a second batch has started, because until then no batch has finished
   * being paid for.
   */
  worstStepMs: number
  trouble: StagedDrawTrouble | undefined
  done: boolean
  cancelled: boolean
}

/**
 * How long one batch aims to take. The browser paints between batches, so this is also roughly how
 * often the bar can move and how quickly a Cancel is noticed. 100 ms is the same interval this
 * project's freeze measurements sample at, which is what makes a batch that overruns it visible in
 * those measurements rather than hidden between two samples.
 */
export const STEP_TARGET_MS = 100

/**
 * How many parts the first batch commits. Deliberately small: the first batch of a fresh canvas is the
 * most expensive one (React mounts the node renderers), and starting small is what gets the bar on
 * screen before the expensive part of the work rather than after it. Every batch after this one is
 * sized from what the previous one actually cost.
 */
export const FIRST_BATCH_UNITS = 4

/**
 * The most parts or wires one batch may ever commit, however cheap the batches before it looked.
 *
 * The growth rule below is a feedback loop, and a feedback loop only corrects a batch AFTER it has been
 * paid for: a batch sized from a cheap history is still handed over whole, and the window is gone for
 * however long that costs. Unbounded, the growth measured on the built app put 1,084 parts on the canvas
 * inside a second and cost a 5,397 ms task in the middle of it (…/repair/before-2000.json) — see the
 * header on why 1,084 is a running total rather than one batch.
 *
 * 512 IS REACHED, and it is reached in plain sight. On 8,000 grouped blocks with 1,000 wires the parts
 * phase hands over 512 at a time and the card's own samples say so: rep 3 steps by 1,028, 512, 512,
 * 1,024, 512, 512, 1,024, 512 and rep 1 by 1,028, 1,024, 512, 512, 512, 512 (…/bs/after-block8000w1000
 * .json, card samples — a 1,024 is two of these batches inside one 100 ms sample). The floor there is
 * 512 as well, so those samples cannot tell the two apart; what they do settle is that a batch of 512 is
 * really handed over, which two earlier versions of this comment denied. One called it "what the sizer is
 * actually sitting on" without a figure; the other said "nothing measured has ever reached it".
 *
 * AN ARITHMETIC PROOF THAT STOOD HERE IS GONE, because it was not sound. It read a 1,399-part increment
 * on a 3,000-block run as 375 + 512 + 512, on the grounds that "a 3,000-part phase can only ever hand
 * over 375 (its floor) or 512 (this ceiling)". It can hand over neither: `nextBatchUnits` ramps 4, 6, 9,
 * 14, 21, 32, 48, 72, 108, 162, 243 before the floor binds, and 1,399 is the SECOND increment of that
 * run — inside the ramp. The nine increments that passage called non-multiples of the floor are
 * explained by the ramp and by the last batch of a phase, which is `min(batchUnits, remaining)` and so
 * is smaller than the rest whenever the phase does not divide evenly.
 *
 * Beyond that, the floor below is `phaseTotal / 8` capped at this number, so ANY phase of more than 4,096
 * items has a floor of exactly 512 and the sizer has no room at all: it hands over 512 every time whatever
 * it measures. That is arithmetic, not a measurement.
 */
export const MAX_BATCH_UNITS = 512

/**
 * The most batches one phase is broken into WHILE NOTHING HAS GONE WRONG — a floor under the batch size,
 * and the reason the ceiling above is not simply set as low as it will go. It is not the last word: a
 * batch measured to have held the window past SLOW_BATCH_MS sets this floor aside for the rest of its
 * phase (`shrinkingIsStillPaying` below), because a floor that keeps handing over a batch already
 * measured to freeze the window is the defect this whole file exists against.
 *
 * A batch does not cost only what its own items cost. Handing anything to React carries a price that is
 * paid per HANDOVER, not per item, so past a certain canvas size every batch overruns STEP_TARGET_MS
 * however small it is — and a rule that only ever halves on an overrun then walks the batch down towards
 * one item and the draw towards a standstill.
 *
 * So the batch size is floored at `phaseTotal / 8`, which bounds a phase at eight handovers however
 * expensive they get. EIGHT IS SWEPT, not chosen — and re-swept on the fixed build, because the first
 * sweep was run against the re-measure defect and could not be assumed to survive it. Opening a
 * generated project through the launcher, whole draw and longest stretch with the window answering
 * nothing:
 *
 *   batches per phase   design        build          whole draw       longest silence   artifact
 *      no bounds        2,000 blocks  with defect    NO FIGURES             —      repair/after-2000-nofloor.json
 *      4  (cap 1024)    3,000 blocks  with defect    84.2 s              52.3 s    repair/ab-b4.json
 *      8  (cap  512)    3,000 blocks  with defect    58.0-75.0 s      23.0-25.1 s  repair/after-3000-r1..r3.json
 *     24  (cap  256)    2,000 blocks  with defect    70.1 s              10.7 s    repair/after-2000.json
 *     32  (cap  512)    2,500 blocks  FIXED          28.6 s               2.0 s    repair/t2/sweep-b32.json
 *      8  (cap  512)    2,500 blocks  FIXED          9.7 s                1.7 s    repair/t2/sweep-b8.json
 *      8  (cap  512)    2,500 blocks  FIXED          9.8-10.2 s       1.41-1.48 s  repair/t2/after-block2500.json
 *
 * On the sizes in that table it is worse in BOTH directions, and the fixed build says so as loudly as the
 * broken one did: 32 handovers per phase is three times the draw and worse silence than 8, because at
 * that size every batch still overruns the target and the sizer simply sits on the floor — so a lower
 * floor buys nothing and pays for another handover each time. THE NO-FLOOR ROW IS NOT A MEASUREMENT. Its
 * artifact holds no draw time and no silence figure at all, only `"error": "timed out waiting for draw
 * finished"` on the build with the re-measure defect, and its own captured app log begins with the debug
 * port failing to bind — so it says the harness gave up, and nothing about what the app was doing.
 *
 * WHAT THE TABLE DOES NOT COVER, and what the relief rule below is for: every design in it is grouped
 * blocks, the cheap family. On expensive parts a floor of `phaseTotal / 8` is a floor under the freeze
 * as well as under the batch — 2,400 parts means 300 per handover whatever they cost, and on device
 * symbols that bought two dead windows of 33 and 54 seconds (…/rg/mixed2400w1000.json, rep 1: the card
 * sat at "Placing parts — 604 of 2,400" for 33,124 ms, then at "1,354 of 2,400" for 54,267 ms).
 * NEITHER GAP IS ONE BATCH, and an earlier version of this sentence called the first one that: the card
 * advanced 604 → 1,354 across it, which is 750 parts and so at least three handovers at the 300 floor.
 * The gaps are what the WINDOW did, not what a batch cost — the same misreading the header at the top of
 * this file warns about, made again here.
 */
export const MAX_BATCHES_PER_PHASE = 8

/** The smallest batch a phase of this many items may be broken into while nothing has gone wrong. */
export function minimumBatchUnits(phaseTotal: number): number {
  return Math.max(1, Math.min(MAX_BATCH_UNITS, Math.ceil(phaseTotal / MAX_BATCHES_PER_PHASE)))
}

/**
 * The size of the next batch, from how long the last one really took. Halve on an overrun, grow by half
 * on an underrun — the standard slow-start shape, and the reason no batch size is hard-coded: a fast
 * machine draws in big batches and a slow one in small ones, both landing near STEP_TARGET_MS. The two
 * bounds either side of it are what stops the loop running away in either direction.
 *
 * HALVING RATHER THAN JUMPING STRAIGHT TO THE ANSWER while nothing has gone wrong. A batch that overruns
 * the 100 ms target by a little is not evidence of much, and a sizer that reads "300 units cost 140 ms,
 * so take 214" chases the noise. The case where the measurement really does have to be taken at its word
 * — a batch that held the window for seconds — is `reliefBatchUnits` below, and it is separate because
 * the two want different things: this one wants a batch near the target, that one wants the window back.
 */
export function nextBatchUnits(previousUnits: number, lastStepMs: number, minUnits = 1): number {
  const wanted =
    lastStepMs > STEP_TARGET_MS
      ? Math.floor(previousUnits / 2)
      : lastStepMs * 2 < STEP_TARGET_MS
        ? Math.ceil(previousUnits * 1.5)
        : previousUnits
  const floor = Math.max(1, Math.min(minUnits, MAX_BATCH_UNITS))
  return Math.max(floor, Math.min(MAX_BATCH_UNITS, wanted))
}

/**
 * Did making the batch smaller actually buy anything? The question the count floor above was standing in
 * for, asked of the measurements instead of assumed.
 *
 * Two models can explain a batch that overruns. If the cost is paid per ITEM, a batch of half the size
 * costs half as much and gets through the same number of items a second, so shrinking is free and it is
 * the whole cure. If it is paid per HANDOVER — React's own price for being handed anything at all, which
 * is real and is why a floor was wanted — a batch of half the size costs the SAME, so half as many items
 * go by per second, shrinking cures nothing, and walking the batch down towards one item multiplies the
 * handovers until the draw never ends.
 *
 * What separates them is items per millisecond, which is also the thing that decides whether the draw
 * ever finishes. The per-item model predicts it is unchanged; the per-handover model predicts it falls by
 * exactly the factor the batch shrank by. The answer is read against the midpoint between those two
 * predictions — not a tuned constant, but the point at which the two are equally far away.
 *
 * THE STRICTER LINE WAS TRIED AND IS WORSE. Demanding that shrinking cost no items a second at all reads
 * an ordinary 9 % dip as proof that the cost is in the handover, and then pins the batch back at the size
 * that was freezing: measured on the built app, three cold runs of a mixed design came out 14.4 s, 90.0 s
 * and 32.0 s, the middle one with a worst silence of 37,515 ms and a single 37,183 ms task inside it
 * (…/bs/strict-mixed2400w1000.json — an earlier version of this line cited
 * …/bs/after-mixed2400w1000.json "before this line was moved back", and that file holds the runs on the
 * shipped rule, 15.5 / 17.4 / 15.5 / 71.5 s, not the stricter one). The same design on the midpoint rule:
 * 15.5 and 17.4 s, worst silence 2.9 and 3.2 (…/bs/hold-mixed2400w1000.json).
 */
export function shrinkingIsStillPaying(
  previous: { units: number; stepMs: number },
  latest: { units: number; stepMs: number },
): boolean {
  if (previous.units <= 0 || latest.units >= previous.units) return true
  if (previous.stepMs <= 0 || latest.stepMs <= 0) return true
  const before = previous.units / previous.stepMs
  const now = latest.units / latest.stepMs
  const ifPaidPerHandover = before * (latest.units / previous.units)
  return now >= (before + ifPaidPerHandover) / 2
}

/**
 * The size to take after a batch that held the window for a whole second or more, computed from that
 * batch rather than backed away from a step at a time.
 *
 * Halving is the right answer to a mild overrun and the wrong one here. A batch of 300 parts that cost
 * 33.5 seconds halves to 150, which costs about 16; then 75, about 8; then 37, about 4 — five more dead
 * windows, adding a minute, before the size is anywhere near sane. Measured on the built app: the parts
 * phase of 1,000 device symbols mixed with 1,400 grouped blocks went 979 parts in 22.7 s, then 300 in
 * 33.5 s, then 300 in 16.0 s, with the halving rule doing exactly that (…/bs/halving-mixed2400w1000.json,
 * card samples). So the measurement is taken at its word: if `units` cost `stepMs`, then `units × target
 * ÷ stepMs` costs about the target.
 *
 * The target here is SLOW_BATCH_MS, not STEP_TARGET_MS, and the difference is the whole point. What is
 * wanted is not a fast batch — it is a batch that does not look like a hung window, and the app already
 * has a number for that: the length at which it tells the user a step was slow. Aiming at the 100 ms
 * batch target instead cuts the batch ten times smaller for no further gain in how the window feels, and
 * pays for it in handovers: on 800 device symbols with 1,040 wires that turned a 10.4-second draw into
 * 113.5 (…/bs/overshoot-symbol800w1040.json).
 */
export function reliefBatchUnits(previousUnits: number, lastStepMs: number): number {
  if (lastStepMs <= 0) return previousUnits
  const wanted = Math.floor((previousUnits * SLOW_BATCH_MS) / lastStepMs)
  return Math.max(1, Math.min(previousUnits, wanted))
}

/**
 * How long the draw may make no progress at all before the user is told.
 *
 * WHAT THIS CHECK IS NOT. It is not a check on how long a batch takes — that is SLOW_BATCH_MS below, and
 * conflating the two is how the previous version of this comment came to be wrong. It watches the gap
 * since a batch RETURNED, on a thread that is free: the scheduler never calling back, the frame callback
 * starved, the window occluded. While a batch is actually running nothing on this thread runs at all,
 * including the watchdog, so this can never fire during one however long it is.
 *
 * That is also why it is not calibrated against batch times any more. An earlier version of this comment
 * set it against "the longest single batch ever seen on the built app, 500 ms (…/appl/audit-three.json)"
 * — a figure produced by the broken clock this file shipped with, which timed the commit call and read
 * near zero. Before the re-measure defect was found, a 2,500-block draw held the window for 61.8 seconds
 * between two heartbeats and its longest SINGLE task was 31.7 seconds (…/repair/t2/before-block2500.json
 * — an earlier version of this comment called the 61.8 one batch, which it is not: it is the worst gap,
 * and a gap can hold several tasks). Either figure is many times this threshold and neither tripped it:
 * the progress clock is reset when the batch returns and the watchdog cannot run before then. This check
 * has never been about how long a batch takes and cannot be made to be.
 *
 * Five seconds is kept as the gap after which a free but silent thread is worth reporting. Raising it
 * only makes a real stall take longer to report; lowering it towards the scheduler's own jitter makes
 * the message fire during ordinary drawing, and an ignored warning is not a warning.
 */
export const STALL_MS = 5_000

/**
 * How long ONE batch may take before the user is told that this particular step was slow — the check the
 * header promises and the first version of this file did not have.
 *
 * It can only fire once the next batch starts, because that is the first moment the cost of the last one
 * is knowable at all (see the header). That is not a weakness of the threshold: while a batch is running
 * there is no thread to report anything on, so "the moment it comes back" is the earliest any code here
 * could speak.
 *
 * One second is ten times the batch target, and the line between the two sides of the defect above. On
 * the build with the re-measure defect it fired, with real seconds in it — "The last step took 2.0
 * seconds", on a 1,000-block design (…/repair/t2/before-block1000.json), and four times per run on the
 * 2,000- and 2,500-block ones. On the build without it, twelve cold runs across those same four designs
 * printed no trouble message at all, their longest single task being 830 ms
 * (…/repair/t2/after-symbol400.json … after-block2500.json, longest longtask per run — an earlier
 * version of this comment said "under 800", and 830 is in the artifact it cites).
 *
 * WHAT THAT IS NOT is a promise of silence on every design this app admits, which is how the sentence
 * above used to read. Those four designs are the small end of what is allowed. On the same build, a
 * 3,000-block project prints three of these messages per run, a 4,000-block one four to six, and an
 * 8,000-block one eight to nine (…/rg/block3000w1000.json, block4000w1000.json, block8000w1000.json).
 * They are true — those batches really did take over a second — and the card says so and keeps drawing.
 *
 * AND SILENCE IS NOT PROOF THAT EVERY STEP WAS QUICK, which is the other half of what "printed no
 * trouble" can be read to mean. Re-measured on the bundle these tests ship with, three warm cold-start
 * runs of 2,500 blocks / 1,000 wires: no trouble message in any of the three, whole draws of 9.2, 9.2
 * and 9.6 s — and longest single tasks of 788, 752 and 1,275 ms (…/rg/block2500w1000.json). The third is
 * over this threshold and printed nothing, and the same artifact says why: the card's own samples, taken
 * every 100 ms, show no gap between two batches over 926 ms in any of the three runs, so the 1,275 ms
 * task is in the SETTLING step.
 *
 * THAT LAST SENTENCE USED TO END "the one step this check can never speak about", and it is now only
 * mostly true. The settling step is a LIST of calls with a scheduler turn between each, so every step but
 * the last is priced by the one after it exactly as a batch is, and a slow one prints. The LAST step
 * still cannot be reported — `finished` is set before its progress goes out and nothing follows it to
 * price it — so what is left unsayable is the final call rather than the whole step.
 */
export const SLOW_BATCH_MS = 1_000

/**
 * How far past its own estimate a draw runs before the user is told it has overrun.
 *
 * RE-DERIVED, because the reasoning this replaces used a model that no longer ships. It read "on the
 * three appliance demos the estimate reads 0.26 to 0.35 of what they really take (…/appl/ratios.json)",
 * and that artifact's own header records the constants it was computed with — `EMPTY: 180, A: 0.0458,
 * PE: 2.1` — which are the FOURTH version's, replaced since. Under the model that actually ships, the
 * calculator (89 device symbols, 30 grouped blocks, 241 wires) estimates 1,198 ms rather than the 2,749
 * that comment's arithmetic was built on, so the margin it reasoned about was 2.3x smaller than it said.
 *
 * The figure this is set from is the shipped model's own worst under-prediction, recomputed from the
 * measurements rather than remembered. It was derived from the FIT SET alone, and that is why it was too
 * small: across the designs the model was fitted to, `estimateDrawCostMs` reads between 0.544 and 2.765
 * of the truth (…/bs/silence-fit-before.json, `wholeDrawRatioRange`), an under-prediction of 1.84x. But a
 * design the model was never fitted to did worse — 8,000 grouped blocks with 2,000 wires estimated
 * 46,388 ms and drew for 96,213, which is 2.074x (…/bs/atk-s0b8000w2000.json). Five is only 2.4x clear of
 * that, and the 2.7x margin this constant was written with wants six.
 *
 * The margin is for a quantity measured moving more than fourfold between two identical cold runs of the
 * same design (a mixed design drew in 15.5 s and 71.5 s, …/bs/after-mixed2400w1000.json). Six is 2.9x
 * clear of the worst under-prediction on any design ever measured drawing, fitted or not.
 */
export const OVER_ESTIMATE_FACTOR = 6

const PHASE_WORDS: Record<StagedDrawPhase, string> = {
  parts: 'Placing parts',
  wires: 'Drawing wires',
  settling: 'Routing wires and simulating',
}

/** What the bar says it is doing — the phase and, where there is one, the real count. */
export function stagedDrawLabel(progress: StagedDrawProgress): string {
  const phase = PHASE_WORDS[progress.phase]
  if (!progress.determinate) return `${phase} — this step cannot report how far along it is`
  return `${phase} — ${progress.phaseDone.toLocaleString()} of ${progress.phaseTotal.toLocaleString()}`
}

/** The fraction drawn, or undefined where there is no honest fraction to give. */
export function stagedDrawFraction(progress: StagedDrawProgress): number | undefined {
  if (!progress.determinate || progress.unitsTotal === 0) return undefined
  return Math.min(1, progress.unitsDone / progress.unitsTotal)
}

function troubleOf(
  progress: Omit<StagedDrawProgress, 'trouble'>,
  msSinceProgress: number,
  lastStepMs: number,
): StagedDrawTrouble | undefined {
  if (msSinceProgress >= STALL_MS) {
    return {
      kind: 'stalled',
      message:
        `${stagedDrawLabel(progress as StagedDrawProgress)} has made no progress for ` +
        `${Math.round(msSinceProgress / 1000)} seconds. The longest step before this one took ` +
        `${Math.round(progress.worstStepMs)} ms, so this one is not simply slow. Nothing you had is ` +
        'lost either way — Stop puts the canvas back exactly as it was before this started.',
    }
  }
  if (lastStepMs >= SLOW_BATCH_MS) {
    return {
      kind: 'slow-batch',
      message:
        `The last step took ${(lastStepMs / 1000).toFixed(1)} seconds, during which the window could ` +
        'not answer. It is drawing again now. Stop puts the canvas back exactly as it was before ' +
        'this started.',
    }
  }
  if (progress.expectedMs > 0 && progress.elapsedMs > progress.expectedMs * OVER_ESTIMATE_FACTOR) {
    return {
      kind: 'over-estimate',
      message:
        `This is taking ${Math.round(progress.elapsedMs / 1000)} seconds, more than ` +
        `${OVER_ESTIMATE_FACTOR} times the ${Math.round(progress.expectedMs / 1000)} seconds it was ` +
        'expected to. It is still moving, so it is working — but it is past anything measured for a ' +
        'design this size. Stop puts the canvas back exactly as it was before this started.',
    }
  }
  return undefined
}

export type StagedDrawOptions = {
  what: string
  parts: number
  wires: number
  /** The draw-cost estimate this design was admitted under (canvas-capacity.ts). */
  expectedMs: number
  now: () => number
  /** Hand a batch to the canvas. Runs on the drawing thread; its duration is what sizes the next one. */
  commit: (chunk: StagedDrawChunk) => void
  /**
   * The last, uncountable step: route, measure, solve — as SEPARATE calls, one per scheduler turn, so
   * the browser paints between them.
   *
   * It is one phase and it still cannot report a fraction, because nothing in it has a unit to count. But
   * it is not one uninterruptible call any more, and that is what the window feels. Measured on the built
   * app, the settling step of 2,000 grouped blocks with 3,400 wires was the longest single silence of the
   * whole draw once the batched phases were fixed — 6,885 to 7,710 ms with the card already gone
   * (…/cg/after3-b2000w3400.json). Routing every wire and solving the circuit are two pieces of work with
   * nothing shared between them, so they are two calls.
   */
  settle: readonly (() => void)[]
  /** Yield to the browser so it can PAINT, then call back. Returns a cancel for the pending callback. */
  schedule: (run: () => void) => () => void
  onProgress: (progress: StagedDrawProgress) => void
}

/**
 * Draws a design in batches, reporting real progress between them.
 *
 * Every piece of the environment is injected — the clock, the scheduler, the commit — because the thing
 * worth testing here is the sequence of batches and what the progress says about them, and neither can
 * be observed through React and a real browser frame.
 */
export class StagedDraw {
  private readonly options: StagedDrawOptions
  private phase: StagedDrawPhase = 'parts'
  private placedParts = 0
  private drawnWires = 0
  /** How many of the settling step's calls have been made. Each gets its own scheduler turn. */
  private settleStepsDone = 0
  private batchUnits = FIRST_BATCH_UNITS
  private startedAtMs = 0
  private lastProgressAtMs = 0
  private worstStepMs = 0
  private lastStepMs = 0
  /** When the batch before this one BEGAN — undefined when there is no comparable batch to price. */
  private previousBatchStartedAtMs: number | undefined
  private previousBatchUnits = FIRST_BATCH_UNITS
  /** The last batch this phase priced, kept so the next one can be asked whether shrinking paid. */
  private pricedBatch: { units: number; stepMs: number } | undefined
  /** True once a batch in this phase has held the window past SLOW_BATCH_MS. */
  private countFloorSetAside = false
  /**
   * The size the descent came down from when a smaller batch was measured to get fewer items a second,
   * kept WITH the cost that decided it — because that decision expires. See `shrinkFloorIsStale`.
   */
  private shrinkFloor: { units: number; stepMs: number } | undefined
  private cancelPending: (() => void) | undefined
  private finished = false
  private stopped = false

  constructor(options: StagedDrawOptions) {
    this.options = options
  }

  /** Begin. The first batch is scheduled rather than run, so the bar is painted before any work. */
  start(): void {
    this.startedAtMs = this.options.now()
    this.lastProgressAtMs = this.startedAtMs
    this.emit()
    this.scheduleNext()
  }

  /** Stop where it is. What has been drawn stays drawn; the caller decides whether to undo it. */
  cancel(): void {
    if (this.finished) return
    this.stopped = true
    this.finished = true
    this.cancelPending?.()
    this.cancelPending = undefined
    this.emit()
  }

  /** The watchdog's pulse: re-check for trouble while nothing is progressing. Reports, never acts. */
  tick(): void {
    if (this.finished) return
    this.emit()
  }

  private scheduleNext(): void {
    this.cancelPending = this.options.schedule(() => {
      this.cancelPending = undefined
      this.runBatch()
    })
  }

  private runBatch(): void {
    if (this.finished) return
    const startedAt = this.options.now()
    this.priceThePreviousBatch(startedAt)
    if (this.advancePhaseIfComplete()) {
      // A phase change hands the thread straight back, so the new phase's name is PAINTED before any
      // work is done under it. It matters most for the settling step, which is one uninterruptible
      // call: named after it instead, the card would say "Drawing wires" throughout the longest step
      // of the whole draw and then vanish.
      this.lastProgressAtMs = this.options.now()
      this.scheduleNext()
      return
    }
    if (this.phase === 'settling') {
      const step = this.options.settle[this.settleStepsDone]
      step?.()
      this.settleStepsDone += 1
      this.previousBatchStartedAtMs = startedAt
      this.previousBatchUnits = 1
      this.lastProgressAtMs = this.options.now()
      if (this.settleStepsDone < this.options.settle.length) {
        this.emit()
        this.scheduleNext()
        return
      }
      this.finished = true
      this.emit()
      return
    }
    const remaining =
      this.phase === 'parts'
        ? this.options.parts - this.placedParts
        : this.options.wires - this.drawnWires
    const take = Math.min(this.batchUnits, remaining)
    if (take > 0) {
      const from = this.phase === 'parts' ? this.placedParts : this.drawnWires
      this.options.commit({ phase: this.phase, from, to: from + take })
      if (this.phase === 'parts') this.placedParts += take
      else this.drawnWires += take
    }
    this.previousBatchStartedAtMs = startedAt
    this.previousBatchUnits = Math.max(take, 1)
    this.lastProgressAtMs = this.options.now()
    // The LAST thing said before the thread is handed back, so it is the state the browser paints.
    this.emit()
    this.scheduleNext()
  }

  /**
   * Move to the next phase when this one has committed everything, at the START of the following
   * batch rather than at the end of the one that finished it.
   *
   * The batch that finishes a phase says "Placing parts — 1,000 of 1,000", and that sentence only
   * reaches the screen if nothing overwrites it before the browser paints. Flipping the phase in the
   * same batch did exactly that: two updates in one task, React renders the second, and the first is
   * never drawn. It was written as fixed and measured as not — on the built app the highest count the
   * card was ever seen showing on a 1,000-part phase was 942 (…/repair/t2/before-block1000.json, card
   * samples). Waiting for the next batch costs nothing and puts a paint in between.
   */
  private advancePhaseIfComplete(): boolean {
    const partsDone = this.phase === 'parts' && this.placedParts >= this.options.parts
    const wiresDone = this.phase === 'wires' && this.drawnWires >= this.options.wires
    if (!partsDone && !wiresDone) return false
    this.phase = partsDone ? 'wires' : 'settling'
    this.startPhaseFresh()
    this.emit() // as the new phase, so the card names the step it is about to take
    return true
  }

  /**
   * What the batch before this one really cost, known only now. The size of THIS batch comes from it,
   * which is the whole feedback loop — see the header on why the commit call's own duration is not it.
   */
  private priceThePreviousBatch(startedAtMs: number): void {
    if (this.previousBatchStartedAtMs === undefined) return
    this.lastStepMs = startedAtMs - this.previousBatchStartedAtMs
    this.worstStepMs = Math.max(this.worstStepMs, this.lastStepMs)
    const priced = { units: this.previousBatchUnits, stepMs: this.lastStepMs }
    // STRICTLY over the line, not at it. `reliefBatchUnits` aims for exactly SLOW_BATCH_MS, so the batch
    // the descent asks for is the one that lands ON the line — and `stillSlow` gates the throughput check
    // below as well as the shrinking. Reading a batch that landed where it was aimed as "still too slow"
    // runs that check against a pair of measurements taken as the canvas fills and the price of a part
    // rises, which reads as a throughput loss and stops the descent.
    //
    // AN EARLIER VERSION OF THIS COMMENT PUT A MEASUREMENT HERE THAT NO ARTIFACT HOLDS. It said the `>=`
    // form took 800 device symbols "from a 9.5-second draw with 3.0 s of worst silence to 32.6 s with
    // 7.2 — the sizer sitting on its count floor of 100, its steps growing 1.7, 2.9, 3.4, 4.2, 5.2, 6.1,
    // 7.2 s". Both artifacts it cited refute it: …/bs/final-symbol800w0.json holds a 7,697 ms draw with
    // 2,624 ms of worst silence and parts increments of 100, 200, 76, 38, 38, 38 — below the floor rather
    // than sitting on it — and …/bs/after-symbol800w0.json holds 9,464 and 2,518. No file on disk holds a
    // silence between 6,800 and 7,600 ms or a 31-34.5 s draw of an 800-part design. THE CHOICE IS
    // UNVERIFIED: `>` and `>=` differ only for a batch that lands exactly on SLOW_BATCH_MS, the whole
    // suite is green either way, and the reasoning above is why `>` is written, not a measurement.
    const stillSlow = priced.stepMs > SLOW_BATCH_MS
    // A batch at or above the count floor is the first evidence about what the floor itself costs. The
    // FIRST batch of a phase is FIRST_BATCH_UNITS by design — deliberately tiny, so the bar is on screen
    // before the expensive work — and its cost says nothing about the floor. Reading it as if it did sent
    // the descent below the floor before the floor had ever been tried, and the size it then settled on
    // was the small first batch rather than anything measured.
    if (stillSlow && priced.units >= this.countFloorNow()) this.countFloorSetAside = true
    if (this.shrinkFloorIsStale(priced)) this.shrinkFloor = undefined
    if (stillSlow && this.pricedBatch !== undefined) {
      if (!shrinkingIsStillPaying(this.pricedBatch, priced)) this.shrinkFloor = this.pricedBatch
    }
    this.pricedBatch = priced
    this.batchUnits = this.countFloorSetAside
      ? this.sizeWhileTheWindowIsAtStake(priced, stillSlow)
      : nextBatchUnits(priced.units, priced.stepMs, this.smallestBatchAllowedNow())
  }

  /**
   * How the batch is sized once this phase has been measured to hold the window for a whole second.
   *
   * Not the same rule as `nextBatchUnits`, and the difference is the point. That rule chases a 100 ms
   * batch, so it halves at anything over 100 ms — and once the count floor is out of the way it goes on
   * halving through every size between here and one item, buying nothing anybody can feel and paying a
   * handover for each. Here the aim is the window rather than the clock: a batch over SLOW_BATCH_MS is
   * cut to what the measurement says will land at SLOW_BATCH_MS, and a batch under it is LEFT ALONE.
   *
   * Holding rather than pinning matters, because the price of an item is not fixed: within ONE run of one
   * mixed design the parts phase went from 11.1 ms a part early on to 149.1 ms a part late in the same
   * phase (…/bs/halving-mixed2400w1000.json, rep 3: the card moved 304 → 904 in 6,649 ms, and later
   * 1,943 → 1,980 in 5,517 ms). A size recorded as safe early is not safe later, so this asks the last
   * measurement every time instead of remembering an answer.
   */
  private sizeWhileTheWindowIsAtStake(
    priced: { units: number; stepMs: number },
    stillSlow: boolean,
  ): number {
    const floor = this.smallestBatchAllowedNow()
    if (stillSlow) return Math.max(floor, reliefBatchUnits(priced.units, priced.stepMs))
    const held = priced.stepMs * 2 < STEP_TARGET_MS ? Math.ceil(priced.units * 1.5) : priced.units
    return Math.max(floor, Math.min(MAX_BATCH_UNITS, held))
  }

  /**
   * How small this phase's batches are allowed to get right now.
   *
   * The count floor holds until a batch is MEASURED to have held the window past SLOW_BATCH_MS, and from
   * then on it is set aside for the rest of the phase — set aside rather than lowered once, because a
   * floor restored the moment one batch comes in quick is a floor the sizer walks straight back into: it
   * would hand over the freezing size again, back off, and freeze again, for the whole phase.
   *
   * The descent stops on evidence of the other kind. When a smaller batch is measured to get fewer items
   * a second — the cost is in the handover, not the items — the size it came down FROM becomes the floor,
   * because that size is the last one measured to be worth handing over. It is not the count floor: a
   * descent that got as far as 16 before stopping paying keeps 16, which is smaller than the count floor
   * and was measured, where the count floor is arithmetic on the design's size and was not.
   */
  private smallestBatchAllowedNow(): number {
    const countFloor = this.countFloorNow()
    if (!this.countFloorSetAside) return countFloor
    return Math.max(1, Math.min(countFloor, this.shrinkFloor?.units ?? 1))
  }

  /**
   * Has the measurement the shrink floor rests on been overtaken by events?
   *
   * The floor is a REMEMBERED ANSWER — "at this size, making the batch smaller bought no items a second"
   * — and `sizeWhileTheWindowIsAtStake` says two lines up why a remembered answer is dangerous here: the
   * price of an item is not fixed, and rose 11.1 ms → 149.1 ms across one measured parts phase. The memory was
   * the one place that was not applied, and it is what the freeze this file is named after came down to.
   * Measured on the built app before this expiry existed, the wires phase of 2,000 grouped blocks with
   * 3,400 wires pinned itself at its count floor of 425 on the phase's second and third batches and then
   * handed over 425 wires for the whole rest of the phase, whatever they cost: the card's own samples step
   * 854, 1,279, 1,660, 2,085, 2,510, 2,935 and 3,400 of 3,400, and the gaps between them grow 1,115,
   * 1,364, 1,795, 2,507, 3,742 and 8,270 ms (…/cg/before-b2000w3400.json, rep 1).
   *
   * So the floor holds only while the batch it pinned still costs what it cost when it was pinned. A batch
   * at or above that size measured costing MORE has contradicted the measurement the floor was set on, and
   * a contradicted measurement is not evidence about anything. The descent is free to start again from
   * what the last batch really cost.
   */
  private shrinkFloorIsStale(priced: { units: number; stepMs: number }): boolean {
    if (this.shrinkFloor === undefined) return false
    return priced.units >= this.shrinkFloor.units && priced.stepMs > this.shrinkFloor.stepMs
  }

  private countFloorNow(): number {
    return minimumBatchUnits(this.phase === 'wires' ? this.options.wires : this.options.parts)
  }

  /**
   * A phase change starts the sizing over. Parts and wires are different work on a canvas that has
   * grown since, so carrying the parts phase's batch size into the wires phase would hand the first
   * wire batch a number nothing about wires has ever justified.
   */
  private startPhaseFresh(): void {
    this.batchUnits = FIRST_BATCH_UNITS
    this.previousBatchStartedAtMs = undefined
    this.previousBatchUnits = FIRST_BATCH_UNITS
    this.pricedBatch = undefined
    this.countFloorSetAside = false
    this.shrinkFloor = undefined
  }

  private emit(): void {
    const now = this.options.now()
    const base: Omit<StagedDrawProgress, 'trouble'> = {
      what: this.options.what,
      phase: this.phase,
      unitsDone: this.placedParts + this.drawnWires,
      unitsTotal: this.options.parts + this.options.wires,
      phaseDone: this.phase === 'wires' ? this.drawnWires : this.placedParts,
      phaseTotal: this.phase === 'wires' ? this.options.wires : this.options.parts,
      determinate: this.phase !== 'settling',
      elapsedMs: now - this.startedAtMs,
      expectedMs: this.options.expectedMs,
      worstStepMs: this.worstStepMs,
      done: this.finished && !this.stopped,
      cancelled: this.stopped,
    }
    const trouble = this.finished
      ? undefined
      : troubleOf(base, now - this.lastProgressAtMs, this.lastStepMs)
    this.options.onProgress({ ...base, trouble })
  }
}

/**
 * Yield to the browser so that a frame is actually PAINTED before the next batch runs, then call back.
 *
 * Both halves are needed and neither alone works. `requestAnimationFrame` fires BEFORE paint, so a batch
 * run from it lands in the same frame and the bar never appears; a bare `setTimeout` is not tied to a
 * frame at all and can run several times between paints. rAF-then-timeout is the pair that puts the
 * batch after the frame it was scheduled from.
 */
export function paintThenRun(run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(run, 0)
  })
  return () => {
    cancelAnimationFrame(frame)
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * The settling work a finished draw still has to do, as SEPARATE steps.
 *
 * Three unrelated pieces of work run at the end of a draw: switching the global router on (which re-routes
 * every wire on the canvas), solving the circuit, and whatever the caller asked to happen afterwards. Run
 * together they were the longest single silence left in a big draw — 6,885 to 7,710 ms on 2,000 grouped
 * blocks with 3,400 wires (…/cg/after3-b2000w3400.json); split, with a paint between each, the worst of
 * the same three runs is 3,379 ms (…/cg/after4-b2000w3400.json).
 *
 * WHY THIS IS A FUNCTION AND NOT THREE LINES AT THE CALL SITE. The split is only real if the steps arrive
 * as separate entries: one entry holding all three work is indistinguishable, from inside the draw, from
 * three entries — and a caller that dropped an entry would leave a draw that reported itself finished with
 * its wires unrouted and its circuit unsolved. Built here, it is something a test can hold and count.
 */
export function stagedDrawSettleSteps(work: {
  enableAutoRoute: () => void
  reSolve: () => void
  afterwards: (() => void) | undefined
}): (() => void)[] {
  return [() => work.enableAutoRoute(), () => work.reSolve(), () => work.afterwards?.()]
}
