/**
 * How long this design will take to DRAW, how long the window will answer NOTHING while it does, and the
 * sizes past which it is refused instead — the second half of "a window that never stops responding", and
 * a different limit from the solvers' (solver-budget.ts).
 *
 * TWO QUANTITIES, AND EACH CONSTANT BELOW BELONGS TO EXACTLY ONE OF THEM. This is the whole of what the
 * sixth version of this file changed, and it exists because the fifth conflated them:
 *
 *   • WHOLE-DRAW TIME — click to last wire routed. `estimateDrawCostMs`, bounded by MAX_DRAW_WAIT_MS
 *     (60 s). This is how long a person WAITS, and it is what the refusal card quotes.
 *   • WORST WINDOW SILENCE — the longest single stretch inside that draw during which the window answers
 *     nothing at all. `estimateWorstSilenceMs`, bounded by MAX_SILENCE_MS (5 s). This is whether the app
 *     LOOKS DEAD, and it is the project lead's actual requirement: "so loading long is fine just make
 *     sure its not just stuck".
 *
 * The fifth version re-derived its curve from silence onto whole-draw time and kept the 60-second ceiling,
 * which left nothing at all bounding the silence. Measured on designs it admitted: a mixed design's card
 * sat at "Placing parts — 1,354 of 2,400" for 54,267 ms (…/rg/mixed2400w1000.json), and 2,000 grouped
 * blocks with 5,000 wires drew for 78,002 ms with 18,922 of them in one unbroken silence
 * (…/rg/verify-audit.json). Neither could be reported while it happened — the stall watchdog runs on the
 * blocked thread — so a person saw a frozen card and no message. That is "stuck".
 *
 * WHAT THIS FILE'S PREDECESSORS GOT WRONG, in order, because each mistake is one of the numbers below.
 *
 * The FIRST version asked "does opening this design eventually finish". It does; everything finishes
 * eventually. What the window does MEANWHILE is the only thing a person sitting in front of it feels, and
 * that was never measured, so the limit landed at 2,000 parts — a size that stopped the window dead.
 *
 * The SECOND version measured the right thing but capped a PAIR OF COUNTS: 550 parts / 713 wires. A cap
 * on counts cannot work, because the cost of a design depends on what KIND of parts it has — 550 grouped
 * blocks and 200 device symbols were 3.8 s and 24.0 s on that build.
 *
 * The THIRD version replaced the cap with a cost estimate per part kind, and was fitted to a defect: an
 * always-on re-solve ran once per React Flow measurement report, 155 full solves to put one design on the
 * canvas (fixed by `solveAfterTheBurst` in App.tsx).
 *
 * The FOURTH version was a change of PURPOSE. Shown the refusal card for a design that would have taken
 * about ten seconds, the project lead's decision was "the app should give 30sec to 1min", "or check with
 * a loading bar", and finally "so loading long is fine just make sure its not just stuck". Refusing
 * became the LAST resort, and the design stopped being handed to the canvas in one blind call: it is
 * drawn a batch at a time behind a progress bar counting real parts and real wires, with a Stop
 * (canvas-draw-staging.ts).
 *
 * The FIFTH version is this one, and it exists because the fourth quoted the user a number that was not
 * true. Two things were wrong with it and they compounded.
 *
 * The estimate predicted the longest stretch the window ANSWERED NOTHING, and the sentence on the card
 * said that number was how long the design "would take to draw". Those stopped being the same quantity
 * the moment the draw was staged: a staged draw of 2,000 grouped blocks takes about eight seconds and its
 * worst silence inside that is about one and a half. Then the batching work fixed a defect that had made
 * re-measuring a part cost a store write every part on the canvas answered (src/renderer/
 * node-internals.ts), and the curve was left fitted to a cost the app no longer pays. Measured on the
 * built app against WHOLE-DRAW time, the old curve read between 0.79x and 28.6x of the truth
 * (…/rg/estimate-vs-measured.json, `oldModelOverchargeRange`), and it refused SEVEN designs this app drew
 * in 10.4 to 52.2 seconds, among them 4,000 grouped blocks (18.7 s, estimated 92.9 s) and 8,000 (33.0 s,
 * estimated 289.7 s). An earlier version of this sentence said "ten to thirty-three seconds", which covers
 * six of the seven and leaves out the slowest of them: 1,000 device symbols with 1,300 wires drew in
 * 52.2 s. "It is refused rather than attempted" was being said about designs the app could comfortably
 * have drawn, which is the opposite of the decision above.
 *
 * So the model below predicts WHOLE-DRAW time — from the click on the door to the last wire routed and
 * the circuit solved, the whole of what a person waits through — and it is fitted to that, measured.
 *
 * ─── THE MEASUREMENTS ────────────────────────────────────────────────────────────────────────────────
 *
 * Machine: Windows 11 Pro 10.0.26200, i7-12700H (14 cores / 20 logical), 31.7 GB, Electron 42.3.3. BUILT
 * app (`npm run build`, then the electron binary directly — the bundle a user runs, not the dev server).
 * Door: Launcher ▸ My Projects ▸ the project, which is the door the original complaint came from. Method:
 * arm a 100 ms heartbeat inside the page plus a PerformanceObserver on long tasks, click the project, and
 * stop the clock when the progress card is gone AND the canvas holds every part and every wire. A fresh
 * app is launched and killed for every run, so every run is cold. Two runs of each design except the
 * three marked ←1 below, which took four to five minutes a run and were run once; the WORST run is what
 * the model is fitted to and what the tests hold. 2026-08-08. Harness and artifacts: …/rg/probe.mjs,
 * …/rg/gen.mjs, one JSON per design named for it (…/rg/block4000w1000.json and so on), with the model's
 * residuals against all twenty-one in …/rg/estimate-vs-measured.json.
 *
 * MEASUREMENT HYGIENE, undisclosed in the tables this replaces: the FIRST launch after a build is a
 * different measurement from the rest, so here the first launch after each build is a warm-up run that is
 * thrown away and named rather than quietly averaged in. Both of them are on disk: 400 symbols / 520
 * wires drew in 4,040 ms on the first launch against 4,085 and 4,271 warm (…/rg/warmup-symbol400.json),
 * and 100 symbols / 130 wires in 1,082 ms against 761 and 778 (…/rg/warmup2-symbol100.json) — no penalty
 * worth the name in the first, 1.4x in the second.
 *
 * Whole draw, both runs, and the longest single stretch the window answered nothing inside it:
 *
 *   DEVICE SYMBOLS (resistors — parts drawn from the schematic symbol set), parts / wires:
 *        100 /  130      761 /     778 ms     worst silence    189 ms
 *        200 /  262    1,609 /   2,171        worst silence    420
 *        400 /  520    4,085 /   4,271        worst silence    847
 *        800 /    0   28,971 /  29,356        worst silence  6,244
 *        800 / 1040   10,339 /  10,444        worst silence  3,013
 *      1,000 / 1300   51,779 /  52,181        worst silence 10,084
 *      1,200 / 1560   74,114 / 129,292        worst silence 47,058
 *      1,600 / 2080  153,964 / 201,159        worst silence 72,813
 *
 *   GROUPED BLOCKS (the blocks a recovered FPGA design lands on the canvas as):
 *        500 /  650    2,281 /   2,348 ms     worst silence    558 ms
 *      1,000 / 1000    4,749 /   4,851        worst silence    928
 *      2,000 /    0    2,414 /   2,567        worst silence    631
 *      2,000 / 1000    7,897 /   8,221        worst silence  1,475
 *      2,000 / 2600   17,397 /  17,578        worst silence  5,079
 *      2,000 / 4000   31,775             ←1   worst silence  9,755
 *      2,000 / 8000  279,169             ←1   worst silence 44,381
 *      3,000 / 1000   12,711 /  12,994        worst silence  1,814
 *      4,000 / 1000   17,330 /  18,681        worst silence  2,445
 *      4,000 / 8000  281,249             ←1   worst silence 44,535
 *      6,000 / 1000   24,763 /  27,451        worst silence  3,006
 *      8,000 / 1000   33,005 /  33,029        worst silence  4,185
 *
 *   MIXED — 1,000 symbols and 1,400 blocks in one design, the only test of the assumption that the two
 *   families can simply be added:
 *      2,400 / 1000   21,995 / 105,008 ms     worst silence 54,267
 *
 *   ←1 marks a design run ONCE rather than twice: each of those three took four to five minutes a run.
 *
 * ─── WHAT FITS THEM ──────────────────────────────────────────────────────────────────────────────────
 *
 * Three things the measurements say that no single curve over one weighted part count can:
 *
 *   • The part families do not share a shape. 2,000 grouped blocks with no wires draw in 2.6 s and 800
 *     device symbols with no wires take 29.4 s. Blocks stay close to linear in their count out to 8,000;
 *     symbols climb steeply enough that 800 → 1,200 of them is 10 s → 129 s.
 *   • A wire costs a flat few milliseconds while there are not many of them. On 2,000 blocks: 2.6 s with
 *     no wires, 8.2 s with 1,000, 17.6 s with 2,600 — 5.7, 5.8 ms a wire.
 *   • AND THEN IT DOES NOT. The same 2,000 blocks take 31.8 s with 4,000 wires and 279.2 s with 8,000 —
 *     7.3 ms a wire, then 34.6. It is the WIRES phase that runs away, batch by batch: the card's own
 *     samples on the 4,000-block / 8,000-wire draw step "Drawing wires — 516 of 8,000" at 5 s and
 *     "7,684 of 8,000" at 150 s (…/rg/block4000w8000.json). At 8,000 wires the part count stops
 *     mattering at all — 2,000 parts and 4,000 parts both take 280 s. Nothing here explains why; the
 *     second wire term is the shape that fits it, not a mechanism.
 *
 * So each part family is charged its own curve, and wires are charged flat plus a term that only wakes
 * up when there are thousands of them:
 *
 *      cost_ms  ≈  0.0000032 · symbols^3.4  +  0.0026 · blocks^1.83
 *                +  4.91 · wires  +  0.00000000000064 · wires^4.5
 *
 * Fitted by coordinate descent from random starts on the sum of squared log ratios against the worst run
 * of each design (…/rg/fit5.mjs). Against all twenty-one it reads between 0.54 and 2.77 of what they
 * measure (…/rg/estimate-vs-measured.json), where the model it replaces was between 0.79 and 28.6.
 *
 * ─── WHAT IS NOT PROVEN ──────────────────────────────────────────────────────────────────────────────
 *
 * • TWO DESIGNS OF THE SAME SIZE CONTRADICT EACH OTHER, and the model cannot serve both. 800 symbols with
 *   1,040 wires draw in 10.4 s; the SAME 800 symbols with no wires at all take 29.4 s — fewer wires,
 *   three times the wait, twice each. Nothing that rises with both counts can fit that pair, and the
 *   2.765x over-charge on the wired one is the model splitting the difference — an earlier version of
 *   this line said 2.66x, two lines after the same passage had correctly given the band as 0.54 to 2.77
 *   and seven lines before the test asserted 2.765 (…/bs/silence-model.json is the re-run of the same
 *   arithmetic; the whole-draw ratios in …/bs/silence-fit-before.json come out 0.544 to 2.765). Why
 *   removing work makes the draw slower is not known and is not answered here.
 * • REPEATING A MEASUREMENT MOVES IT, and near the ceiling it moves it a lot: the mixed design took
 *   22.0 s and 105.0 s on two cold runs minutes apart, 4.8x, with nothing changed between them; 1,200
 *   symbols spread 74 s to 129 s. A model asked to decide a boundary to better than about twofold is
 *   being asked something the quantity does not support, and two runs are not enough to have found the
 *   worst of it.
 * • COST IS NOT A FUNCTION OF THE COUNTS ALONE. Everything here is laid out on a grid. An earlier pass
 *   measured two 101-part / 100-wire designs at 3,855 ms and 10,685 ms — layout alone moved it 3x.
 * • ONLY TWO PART KINDS WERE WEIGHED. Everything not drawn by the block renderer is charged the
 *   device-symbol curve, including kinds plainly cheaper to draw (a junction dot, a keycap). That is the
 *   conservative direction and it is a guess about them.
 * • THE WIRE CLIFF RESTS ON THREE SINGLE RUNS. 4,000 and 8,000 wires were measured once each (four to
 *   five minutes a run), so the exponent that carries the climb between them is fitted to three points
 *   with no repeat to say how much they move. Where the wire count alone crosses the ceiling — about
 *   5,200 on a block design — is interpolation between 4,000 wires measured at 31.8 s and 8,000
 *   measured at 279.2 s. Bracketed by measurement, which is more than the previous model could say, but
 *   not measured at the crossing.
 * • Outside 100–1,600 symbols, 500–8,000 blocks and 0–8,000 wires this is extrapolation, and both the
 *   symbol term's exponent of 3.4 and the crowded-wire term's 4.5 extrapolate violently — which is why
 *   the refusal calls its own figure an estimate and stops quoting one at all past ten minutes.
 * • The mixed design is admitted BY THE WHOLE-DRAW CEILING at 57,134 ms estimated — an earlier version of
 *   this line said 55.3 s, which turns the 2.9-second margin against the 60-second ceiling into 4.7 — and
 *   its worse run took 105 s. It is NOT the one design this file let through that crossed the ceiling,
 *   which the version this replaces claimed: 2,000 grouped blocks with 5,000 wires were admitted too and
 *   drew for 78,002 ms (…/rg/verify-audit.json). Both are now refused, on the silence bound rather than
 *   this one.
 *
 * ─── THE SECOND MODEL: WORST WINDOW SILENCE ──────────────────────────────────────────────────────────
 *
 * The same artifacts carry a second number per run — the longest gap between two ticks of a
 * 100 ms in-page heartbeat — and that is the one that decides whether a design is drawn at all, because
 * it is the one that says whether the window looks dead. It is NOT a fraction of the whole draw: on
 * 2,000 grouped blocks with 1,000 wires the draw is 7.6 s and the worst silence 1.4; on the same blocks
 * with 5,000 wires the draw is 65.7 s and the worst silence 15.4.
 *
 * Re-measured on the bundle these tests ship with, after the batch sizer was given permission to go below
 * its count floor (canvas-draw-staging.ts). Same machine, same door, same method, warm-up run thrown
 * away, two cold runs of each except the two crowded-wire designs which take a minute a run; artifacts
 * one JSON per design in …/bs, listed in …/bs/silence-model.json with every run's figures.
 *
 *   parts (symbols + blocks) / wires    worst silence   whole draw     before the sizer change
 *        100 s /   130 w                     250 ms        1.3 s          189 ms /  0.8 s
 *        200 s /   262 w                     283           1.6            420    /  2.2
 *        400 s /   520 w                     851           4.3            847    /  4.3
 *        800 s /     0 w                   3,030           9.5          6,244    / 29.4
 *        800 s / 1,040 w                   2,813          12.0          3,013    / 10.4
 *      1,000 s / 1,300 w                  14,661          86.0         10,084    / 52.2
 *        500 b /   650 w                     556           2.9            558    /  2.3
 *      1,000 b / 1,000 w                     876           4.6            928    /  4.9
 *      2,000 b /     0 w                     643           2.3            631    /  2.6
 *      2,000 b / 1,000 w                   1,383           7.8          1,475    /  8.2
 *      2,000 b / 2,600 w                   5,936          26.7          5,079    / 17.6
 *      2,000 b / 4,000 w                  14,255          44.0          9,755    / 31.8
 *      2,000 b / 5,000 w                  15,410          65.7         18,922    / 78.0
 *      2,500 b / 1,000 w                   1,676          10.9          1,699    /  9.6
 *      3,000 b / 1,000 w                   1,654          12.9          1,814    / 13.0
 *      4,000 b / 1,000 w                   3,073          27.1          2,445    / 18.7
 *      6,000 b / 1,000 w                   3,975          40.0          3,006    / 27.5
 *      8,000 b / 1,000 w                   5,419          51.9          4,185    / 33.0
 *      1,000 s + 1,400 b / 1,000 w        11,835          71.5         54,267    / 105.0
 *
 * REPEATING A RUN MOVES IT SEVERALFOLD, and the worst column above hides that. The mixed design came out
 * 2.4, 2.9, 3.2 and 11.8 seconds of silence on four cold runs of the SAME bundle, and 1,000 device
 * symbols with 1,300 wires came out 1.3, 1.5, 2.7 and 14.7. Every run is in …/bs/silence-model.json. Two
 * runs are not enough to find the worst of a quantity that moves like that, and the model is fitted and
 * held to the worst that was found.
 *
 * Four designs were NOT re-measured, because all four are refused and so never drawn: 1,200 and 1,600
 * device symbols, and 2,000 and 4,000 grouped blocks with 8,000 wires. Their rows in the model file are
 * the figures from before the sizer change and are marked as such.
 *
 * TWO ROWS OF THAT TABLE ARE NOT FROM THE BUNDLE ITS HEADING NAMES, and the heading said "re-measured on
 * the bundle these tests ship with" without qualification. The 800-symbol row (3,030 ms / 9.5 s) and the
 * 2,000-block / 2,600-wire row (5,936 / 26.7) are from …/bs/after-symbol800w0.json and
 * after-block2000w2600.json, and later runs on the finished bundle disagree with both on whole draw:
 * 7,697 and 7,393 ms against 9.5 s, and 21,784 ms against 26.7 (…/bs/final-symbol800w0.json,
 * final-block2000w2600.json). Their SILENCE figures are close (2,624 / 2,543 and 5,126), which is why the
 * fit is left alone; the draw times are not, and the table is the worse of the pair in both.
 */

/**
 * The longest wait the app will START. Past this a design is refused; under it, it is drawn — and while
 * it draws, the user watches a bar counting the parts and wires as they land.
 *
 * The project lead's number, not a derived one: "the app should give 30sec to 1min". A minute is the top
 * of the range they gave, and the top is the right end of it because refusing is the last resort.
 *
 * WHAT IT BOUNDS, said plainly because the version this replaces did not: the WAIT. It is compared
 * against `estimateDrawCostMs` and against nothing else. It says nothing whatever about how long the
 * window answers nothing while that wait goes by — MAX_SILENCE_MS below is the constant for that, and
 * having only this one is how a 54-second dead window got admitted.
 */
export const MAX_DRAW_WAIT_MS = 60_000

/**
 * The longest the window may be expected to answer NOTHING. Past this a design is refused; under it, it
 * is drawn behind a bar it can be stopped from.
 *
 * NOT A NEW NUMBER, and deliberately so. This project already had a figure for "silent for long enough
 * that the user must be told something is wrong" — STALL_MS in canvas-draw-staging.ts, five seconds,
 * the gap after which the draw prints that it has made no progress. The trouble is that a stall check
 * runs on the same thread the drawing blocks, so it can never fire during the silence it is about: the
 * one place a five-second silence CAN be acted on is before the draw is started at all. So the same
 * number is used here, where it can do something.
 */
export const MAX_SILENCE_MS = 5_000

/**
 * How far the silence estimate has been measured to run HIGH, and the allowance the refusal makes for it.
 *
 * Against the nineteen designs re-measured on this bundle the silence model reads between 0.562 and 1.578
 * of what they really did (…/bs/shipped-silence-residuals.json, `shippedRatio` over its nineteen
 * `after-*` rows; its last four rows are the refused designs, which were never re-drawn, and they run to
 * 2.204. An earlier version of this line cited …/bs/silence-model.json, whose own `ratioRange` is the
 * FIT's — 0.56 to 1.581 — and not the pair quoted here). Refusing the moment the raw estimate
 * crosses the line would therefore refuse designs whose real silence is well under it — and refusing is
 * the last resort. So the estimate is allowed its own worst measured over-charge before it is believed.
 *
 * It decides one real case: 8,000 grouped blocks with 1,000 wires estimate 5,214 ms of silence, which is
 * over the five-second line, and measured 4.1, 4.2, 4.3, 4.5 and 5.4 seconds across five cold runs.
 * Without this allowance the app would refuse a design it draws in 39 to 52 seconds, which is the exact
 * mistake the previous version of this file was written to undo. IT IS NOT FREE: the fifth of those runs
 * is over the line the app says it allows, and the allowance is what let it through. That is the trade,
 * and it is written here rather than left to be discovered.
 */
export const SILENCE_ESTIMATE_RUNS_HIGH_BY = 1.578

/**
 * How far the WHOLE-DRAW estimate has been seen to miss, on designs it was never fitted to.
 *
 * The card has to tell the user how much to trust the number it just showed them, and the honest answer
 * is the widest miss actually measured — not the widest miss inside the model's own training data, which
 * is the mistake this pair replaces. Measured over the seven boundary designs, none of which is in either
 * fit table: the estimate reads between 0.659 and 4.120 times the longest run of the same design
 * (the ratios are computed and asserted in tests/canvas-capacity.test.ts, from the runs recorded per
 * design in its BOUNDARY_DESIGNS row).
 *
 * They are constants, and the card is built from them, because the sentence the user reads had drifted
 * from the band the tests assert: the tests were re-fitted to 0.659-to-4.120 and the card went on saying
 * "between half and three times". Anything that re-measures the band now moves both or fails.
 */
export const DRAW_ESTIMATE_READS_LOW_BY = 0.659
export const DRAW_ESTIMATE_READS_HIGH_BY = 4.12

/**
 * The estimate a design is actually refused above — ONE function, so the branch that decides and the
 * sentence that explains it cannot say different numbers.
 *
 * They did. The card read "This app allows 5 seconds of that" while the branch beside it compared against
 * MAX_SILENCE_MS × SILENCE_ESTIMATE_RUNS_HIGH_BY, which is 7,890 ms, and the estimate itself under-reads
 * by up to 1.28x at that boundary — so the real allowance was about ten seconds and the card named five.
 * Six of the seven designs probed at the boundary and ADMITTED measured over the five seconds the card
 * promised: 9,603 / 9,255 / 9,073 / 8,588 / 8,547 / 5,033 ms
 * (…/bs/atk-admitted-residuals.json). A UI that misstates its own rule is a faked status, whichever way
 * the misstatement leans.
 */
export function silenceRefusedAboveMs(): number {
  return MAX_SILENCE_MS * SILENCE_ESTIMATE_RUNS_HIGH_BY
}

/**
 * A device symbol's cost, and the steepest part term in this file: 100 of them draw in 0.8 s, 800 in
 * 10.4 s, and 1,200 in 74 to 129 s. The exponent is what that shape costs to describe, not a choice —
 * and the parts phase is where the whole minute of the 1,200-symbol draw goes
 * (…/rg/symbol1200w1560.json, card samples: "Placing parts — 1,054 of 1,200 · 38s").
 */
const SYMBOL_PART_COST_MS = 0.0000032
const SYMBOL_PART_EXPONENT = 3.4

/**
 * A grouped block's cost. Nearly linear in the count where a symbol's is not: 2,000 blocks with no wires
 * draw in 2.6 s and 8,000 with 1,000 wires in 33.0 s. This is why there is no single "block weight" any
 * more — one weight times a shared curve over-charged block designs by up to 28x at the sizes a recovered
 * FPGA design actually lands at, and refused them.
 */
const BLOCK_PART_COST_MS = 0.0026
const BLOCK_PART_EXPONENT = 1.83

/**
 * A wire's cost while a design has hundreds or low thousands of them: flat, and the same figure fits both
 * part families. On a 2,000-block canvas the first 1,000 wires cost 5.7 ms each and the next 1,600 cost
 * 5.8 ms each (2.6 s → 8.2 s → 17.6 s).
 */
const WIRE_COST_MS = 4.91

/**
 * What a wire costs ON TOP of that once a design has thousands of them, which is the single biggest thing
 * the previous model had no term for — and the one place this file refuses MORE than it used to rather
 * than less. The same 2,000 blocks that draw in 17.6 s with 2,600 wires take 31.8 s with 4,000 and
 * 279.2 s with 8,000 (…/rg/block2000w4000.json, block2000w8000.json), and 4,000 blocks with 8,000 wires
 * take the same 281 s as 2,000 do — past a few thousand wires the part count stops mattering.
 *
 * A flat per-wire cost would have quoted 41 s for a real project of this shape (4,746 parts and 8,227
 * wires, the FPGA design that first got behind File ▸ Open Circuit) and let it start a draw that the
 * measurements say takes about five minutes.
 */
const CROWDED_WIRE_COST_MS = 0.00000000000064
const CROWDED_WIRE_EXPONENT = 4.5

/**
 * The WORST WINDOW SILENCE curve — the same four terms, fitted to a different measurement.
 *
 *     silence_ms  ≈  0.00000000018 · symbols^4.57  +  0.0063 · blocks^1.49
 *                 +  1.08 · wires  +  0.000000000091 · wires^3.84
 *
 * Fitted by coordinate descent from six hundred random starts on the sum of squared log ratios against
 * the worst run of each of the nineteen designs re-measured on this bundle (…/bs/fit-silence.mjs, results
 * in …/bs/silence-model.json). It reads between 0.562 and 1.578 of what they measured.
 *
 * Why it is not simply a fraction of the whole-draw curve, which was the assumption that let a 54-second
 * silence through: the two do not rise together. A block's silence exponent is 1.49 against its draw-time
 * 1.83 — batching a big block design mostly works, so more blocks lengthen the draw far faster than they
 * lengthen any one silent stretch. A symbol's is 4.57 against 3.4 — the opposite, because on the parts
 * phase of a symbol design one batch is one long uninterruptible measure-and-lay-out.
 *
 * WHAT SETS THE FLOOR UNDER ALL OF IT is the settling step: routing every wire, measuring, and solving.
 * On 2,000 blocks with 2,600 wires the batches were held under 1.8 s and the worst silence was still 5.9
 * — the card's own samples put it between "Drawing wires — 2,441 of 2,600" and the settling step
 * (…/bs/after-block2000w2600.json). That is why the wire terms here are steep.
 *
 * THIS PASSAGE USED TO END "and no batch sizer can touch it", WHICH WAS TRUE OF THE SIZER AND FALSE OF
 * THE STEP. Routing and solving share nothing, so they are separate calls with a paint between them now,
 * and the quadratic wire-crossing scan that was being re-run on every batch — 53 % of a profiled 46.7 s
 * draw — has been taken out of the draw altogether (canvas-draw-staging.ts header;
 * …/cg/prof-b2000w3400.json). Measured on the built app, the worst silence of 2,000 grouped blocks with
 * 3,400 wires went from 8,469 ms to 3,379 and the whole draw from 32.0 s to 19.3
 * (…/cg/before-b2000w3400.json → …/cg/after4-b2000w3400.json, three cold runs each).
 *
 * EVERY SILENCE FIGURE IN THE TABLE ABOVE IS THEREFORE AN UPPER BOUND ON A BUNDLE THAT NO LONGER SHIPS,
 * and the model fitted to them now reads HIGH. That is not free and is not left unsaid: reading high is
 * the direction that refuses designs the app could draw quietly, which is the mistake this file's fifth
 * version was written to undo. Putting it right means re-measuring all nineteen designs and re-fitting,
 * which has not been done — the seven probed at the admission boundary were re-measured instead, and they
 * are the ones the limit is actually decided on.
 */
const SYMBOL_SILENCE_COST_MS = 0.00000000018206
const SYMBOL_SILENCE_EXPONENT = 4.5662
const BLOCK_SILENCE_COST_MS = 0.0063059
const BLOCK_SILENCE_EXPONENT = 1.4895
const WIRE_SILENCE_COST_MS = 1.0785
const CROWDED_WIRE_SILENCE_COST_MS = 0.000000000090827
const CROWDED_WIRE_SILENCE_EXPONENT = 3.8397

/** Which nodes are grouped blocks — the same test the canvas itself uses to pick the block renderer. */
export function isBlockDefinition(definition: string | undefined): boolean {
  return definition === 'block'
}

/**
 * A drawn node is a block when it is drawn by the BLOCK renderer, which on the canvas is its React Flow
 * `type` — not its definition. A block dropped from the palette keeps the definition it was dropped as
 * (`display_seven_segment`) and only its type says `block`; a node built from a saved file gets its type
 * FROM `definition === 'block'`. Reading both is what makes the two agree.
 */
function isBlockCanvasNode(node: { type?: unknown; data?: unknown }): boolean {
  if (node.type === 'block') return true
  return isBlockDefinition((node.data as { definition?: string } | undefined)?.definition)
}

/** A design measured in the terms the cost model is written in. */
export type DrawnDesignSize = {
  /** Parts, as counted by a person looking at the canvas — what the refusal message quotes. */
  parts: number
  /** Parts drawn from the schematic symbol set, and everything else not drawn as a grouped block. */
  symbolParts: number
  blockParts: number
  wires: number
}

export function designSizeOfDefinitions(
  definitions: Iterable<string | undefined>,
  wires: number,
): DrawnDesignSize {
  let symbolParts = 0
  let blockParts = 0
  for (const definition of definitions) {
    if (isBlockDefinition(definition)) blockParts += 1
    else symbolParts += 1
  }
  return { parts: symbolParts + blockParts, symbolParts, blockParts, wires }
}

/** A saved / imported / decoded file's size, read off the file itself before anything is built from it. */
export function designSizeOfFile(file: {
  nodes: readonly { definition?: string }[]
  wires: readonly unknown[]
}): DrawnDesignSize {
  return designSizeOfDefinitions(
    file.nodes.map((node) => node.definition),
    file.wires.length,
  )
}

/** A canvas's size, read off the drawn React Flow nodes (where the definition lives under `data`). */
export function designSizeOfCanvas(
  nodes: readonly { type?: unknown; data?: unknown }[],
  wires: number,
): DrawnDesignSize {
  let blockParts = 0
  for (const node of nodes) if (isBlockCanvasNode(node)) blockParts += 1
  return { parts: nodes.length, symbolParts: nodes.length - blockParts, blockParts, wires }
}

/** How long the whole draw is expected to take, in milliseconds: parts, wires, routing and the solve. */
export function estimateDrawCostMs(size: DrawnDesignSize): number {
  return (
    SYMBOL_PART_COST_MS * size.symbolParts ** SYMBOL_PART_EXPONENT +
    BLOCK_PART_COST_MS * size.blockParts ** BLOCK_PART_EXPONENT +
    WIRE_COST_MS * size.wires +
    CROWDED_WIRE_COST_MS * size.wires ** CROWDED_WIRE_EXPONENT
  )
}

/**
 * The longest single stretch, inside that draw, during which the window is expected to answer nothing.
 * A different number from the one above and usually a small fraction of it — this is the one that says
 * whether the app looks dead, and so it is the one the refusal is decided on.
 */
export function estimateWorstSilenceMs(size: DrawnDesignSize): number {
  return (
    SYMBOL_SILENCE_COST_MS * size.symbolParts ** SYMBOL_SILENCE_EXPONENT +
    BLOCK_SILENCE_COST_MS * size.blockParts ** BLOCK_SILENCE_EXPONENT +
    WIRE_SILENCE_COST_MS * size.wires +
    CROWDED_WIRE_SILENCE_COST_MS * size.wires ** CROWDED_WIRE_SILENCE_EXPONENT
  )
}

/**
 * The shortest draw worth putting a progress bar on. Under it a design is handed to the canvas in one
 * call, as everything was before the stager existed.
 *
 * A GAP, not a measurement, and the gap is what makes it safe. The most expensive built-in starting
 * template — 22 parts, 36 wires — estimates 177 ms, and the smallest design ever measured through the
 * launcher, 100 parts and 130 wires, took 778 ms and estimates 658. Nothing this project has measured
 * sits between those two, so anything from 180 to 650 draws exactly the same line through everything
 * known; 400 is the middle of it. What the line has to do is keep a new tab from flashing a bar at a
 * template nobody waits for, while still watching anything a person would notice waiting for.
 */
export const STAGE_DRAW_ABOVE_MS = 400

/**
 * Is this design worth drawing in batches behind a progress bar, rather than handed over in one call?
 *
 * An empty canvas estimates exactly zero — there is no floor constant left to subtract first — so a blank
 * project is never staged whatever the line is set to. That matters: comparing a whole estimate which
 * began at a 180 ms floor against a 100 ms batch target answered yes for every design there can ever be,
 * and put a progress card reading "Placing parts — 0 of 0" on screen every time a blank project was
 * created (…/appl/audit-mount.json).
 *
 * The line is NOT a parameter, and that is deliberate. It used to be one, and its only caller sits inside
 * an 11,000-line React component where no test can reach it — so passing the wrong number there was a
 * one-token change that the whole 4,253-test suite could not see. Mutation-tested: replacing the argument
 * with `Number.MAX_SAFE_INTEGER`, which stages nothing ever, left every test green. With the decision
 * whole and in one place, the tests below exercise the real thing.
 */
export function isWorthStagingTheDraw(size: DrawnDesignSize): boolean {
  return estimateDrawCostMs(size) > STAGE_DRAW_ABOVE_MS
}

/**
 * How long the refusal says the design would take.
 *
 * Past ten minutes it stops quoting: the difference between "40 minutes" and "3 hours" changes nothing a
 * person would do, and both would be inventions dressed as arithmetic. Ten is a wording choice, not a
 * measurement.
 */
const STOP_QUOTING_ABOVE_MS = 600_000

function howLongItWouldTake(estimateMs: number): string {
  if (estimateMs > STOP_QUOTING_ABOVE_MS) return 'many minutes'
  if (estimateMs >= 90_000) return `roughly ${Math.round(estimateMs / 60_000)} minutes`
  return `roughly ${Math.round(estimateMs / 1000)} seconds`
}

/**
 * Why this design will not be drawn, or undefined when it fits. Plain English, with the design's own
 * size, what it would cost, the limit, and what to do instead — the project's honest refusal, not a
 * silent attempt.
 *
 * A refusal is the LAST resort: a big design is drawn in batches behind a progress bar
 * (canvas-draw-staging.ts) and can be stopped, so what is left here is only the sizes where waiting would
 * be hopeless — or where the waiting would not look like waiting.
 *
 * TWO REASONS TO REFUSE, and they are different questions. The design would take too LONG (whole draw
 * against MAX_DRAW_WAIT_MS), or the window would go DEAD for too long inside it (worst silence against
 * MAX_SILENCE_MS, after the estimate is allowed its own measured over-charge). The second is the one the
 * project lead's requirement is about and the one the version this replaces had no test for at all. Both
 * are checked; the message names the one that was crossed, because "this would take 3 minutes" and "the
 * window would stop answering for 20 seconds" are different things to be told.
 *
 * Whichever fires, the wait is quoted from the whole-draw estimate, because that is the number a person
 * is actually deciding about. The wording is one sentence per idea for a reason. The version this
 * replaces read "would take for roughly 2 minutes to draw" on the built app: the helper already returned
 * the "for", and the sentence around it supplied another.
 *
 * `nothingHappened` says, in the words of the door being refused, what did NOT happen. Every door has to
 * supply it, because "Nothing was opened" is a lie on a paste and on an ungroup.
 */
export function tooBigToDrawReason(
  size: DrawnDesignSize,
  nothingHappened = 'Nothing was opened.',
): string | undefined {
  const estimateMs = estimateDrawCostMs(size)
  const silenceMs = estimateWorstSilenceMs(size)
  const tooSilent = silenceMs > silenceRefusedAboveMs()
  if (estimateMs <= MAX_DRAW_WAIT_MS && !tooSilent) return undefined
  const howBig =
    `This design is too big to put on the canvas: ${size.parts.toLocaleString()} parts and ` +
    `${size.wires.toLocaleString()} wires would take ${howLongItWouldTake(estimateMs)} to draw. `
  const whyRefused = tooSilent
    ? `Somewhere in that, the window would stop answering for ${howLongItWouldTake(silenceMs)} in one ` +
      'stretch — long enough to look like it had died. This app aims to keep that under ' +
      `${Math.round(MAX_SILENCE_MS / 1000)} seconds, and because this estimate has been measured ` +
      `reading up to ${SILENCE_ESTIMATE_RUNS_HIGH_BY.toFixed(2)} times high, it does not refuse until ` +
      `the estimate passes ${Math.round(silenceRefusedAboveMs() / 1000)} seconds. It waits ` +
      `${Math.round(MAX_DRAW_WAIT_MS / 1000)} seconds in all. `
    : `This app waits ${Math.round(MAX_DRAW_WAIT_MS / 1000)} seconds at most. `
  return (
    `${howBig}That is an estimate from designs that were measured drawing, and on designs outside ` +
    `those it has come out anywhere between ${DRAW_ESTIMATE_READS_LOW_BY} and ` +
    `${DRAW_ESTIMATE_READS_HIGH_BY} times what they really took. ${whyRefused}${nothingHappened} ` +
    'It is refused rather than attempted. Open a smaller design, or take a smaller piece of this one.'
  )
}

/**
 * The same refusal for a whole saved / imported / decoded file, before anything is built from it.
 *
 * Every door that turns a file into a canvas goes through this one function, so adding a door means
 * meeting it. The four that did not — File ▸ Open Circuit, reopening a saved project, opening a saved
 * template, and the tab's own mount — are exactly how a 4,746-part project got behind the first item of
 * the File menu with no check at all.
 */
export function tooBigFileToDrawReason(
  file: { nodes: readonly { definition?: string }[]; wires: readonly unknown[] },
  nothingHappened?: string,
): string | undefined {
  return tooBigToDrawReason(designSizeOfFile(file), nothingHappened)
}

/** The same refusal for a canvas that is about to exist — a paste, an ungroup, a placer, a drop. */
export function tooBigCanvasToDrawReason(
  nodes: readonly { type?: unknown; data?: unknown }[],
  wires: number,
  nothingHappened: string,
): string | undefined {
  return tooBigToDrawReason(designSizeOfCanvas(nodes, wires), nothingHappened)
}
