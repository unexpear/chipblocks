/**
 * The canvas capacity — how big a design will be DRAWN, and the doors that have to ask.
 *
 * FIVE defects live behind this file, and every test below is one of them written down. This line said
 * "three" and then listed four, which is the smallest possible version of the mistake the whole file is
 * about: a number written down beside evidence that contradicts it.
 *
 * The FIRST is that the limit was set above the point where the window already dies. It was chosen by
 * "does opening this eventually finish" — it does; everything finishes eventually — while the thing a
 * person actually experiences is how long the window answers nothing MEANWHILE.
 *
 * The SECOND is that the check existed and only two of the doors called it. A 4,746-part project opened
 * through File ▸ Open Circuit — the first item in the File menu — held the window for over half an hour
 * with no progress, no cancel and no message. So these tests are organised BY DOOR, and the point of
 * each is not that the guard works but that a particular door asks it.
 *
 * The THIRD is the one this file was first rewritten for: the limit was a cap on COUNTS — 550 parts, 713
 * wires — measured on one kind of part. Cost does not work that way. 550 grouped BLOCKS cost 3.8 s to
 * draw and 200 device SYMBOLS cost 24 s, so no pair of counts can both admit the first and refuse the
 * second. The guard estimates a cost in milliseconds instead.
 *
 * The FOURTH is that the estimate was not measuring what it said. It predicted the longest stretch the
 * window answered nothing, the refusal card called that number "how long this would take to draw", and
 * once the draw was staged behind a progress bar those were different quantities by an order of
 * magnitude. Measured against real whole-draw times it read up to 28.6x of the truth and refused SEVEN
 * designs — which drew in 10.4, 17.6, 18.7, 27.5, 31.8, 33.0 and 52.2 seconds. This paragraph used to say
 * six and the test below used to list six, both leaving out the 31.8-second one, while the test's own
 * title said seven. So the table below is WHOLE-DRAW time — click
 * to last-wire-routed — and `nothing measured drawing in under a minute is refused` is the test that
 * would have failed on the old model.
 *
 * The FIFTH is that every design the model was ever held to was a design the model had been FITTED to.
 * `MEASURED_DESIGNS` below is the fit set, and nothing in this suite looked anywhere else — so the one
 * place the model could be badly wrong was the one place nobody had a test. Probed at the admission
 * boundary afterwards, 8,000 grouped blocks with 2,000 wires estimated 46,388 ms, was admitted on BOTH
 * bounds, and drew for 96,213 — 0.482 of the truth, outside the 0.544-to-2.765 band this file asserts and
 * a worse under-prediction than the 1.838 `OVER_ESTIMATE_FACTOR` was derived from. `BOUNDARY_DESIGNS`
 * holds the seven, and they are checked with the same arithmetic as the fit set.
 *
 * The tables that used to be here measured worst-SILENCE on a build with the re-measure defect in it
 * (canvas-capacity.ts tells that story). They are in git history; they are not kept here, because a
 * number in this file that nothing is held to is a number waiting to be misread as current.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { decideCircuitOpen } from '../electron/circuit-open.ts'
import {
  type BlockData,
  type CanvasNodeLike,
  groupSelection,
  ungroupBlock,
} from '../src/renderer/blocks.ts'
import {
  DRAW_ESTIMATE_READS_HIGH_BY,
  DRAW_ESTIMATE_READS_LOW_BY,
  type DrawnDesignSize,
  designSizeOfCanvas,
  designSizeOfFile,
  estimateDrawCostMs,
  estimateWorstSilenceMs,
  isWorthStagingTheDraw,
  MAX_DRAW_WAIT_MS,
  MAX_SILENCE_MS,
  SILENCE_ESTIMATE_RUNS_HIGH_BY,
  STAGE_DRAW_ABOVE_MS,
  silenceRefusedAboveMs,
  tooBigCanvasToDrawReason,
  tooBigFileToDrawReason,
  tooBigToDrawReason,
} from '../src/renderer/canvas-capacity.ts'
import {
  FIRST_BATCH_UNITS,
  MAX_BATCH_UNITS,
  MAX_BATCHES_PER_PHASE,
  minimumBatchUnits,
  nextBatchUnits,
  OVER_ESTIMATE_FACTOR,
  reliefBatchUnits,
  SLOW_BATCH_MS,
  STALL_MS,
  STEP_TARGET_MS,
  StagedDraw,
  type StagedDrawChunk,
  type StagedDrawPhase,
  type StagedDrawProgress,
  shrinkingIsStillPaying,
  stagedDrawFraction,
  stagedDrawLabel,
  stagedDrawSettleSteps,
} from '../src/renderer/canvas-draw-staging.ts'
import { CIRCUIT_FILE_FORMAT, CIRCUIT_FILE_VERSION } from '../src/renderer/circuit-file.ts'
import { CANVAS_SOLVE_BUDGET_MS } from '../src/solver-budget.ts'

/**
 * The measurements the model is derived from, and the only reason its constants have the values they
 * have. WHOLE-DRAW time on the BUILT app (`npm run build`, then the electron binary — the bundle a user
 * runs), through the door the complaint came from: Launcher ▸ My Projects ▸ the project. The clock runs
 * from the click until the progress card is gone AND the canvas holds every part and every wire, so it
 * covers the batches, the routing and the solve — the whole of what a person waits through.
 *
 * Windows 11 Pro 10.0.26200, i7-12700H, 31.7 GB, Electron 42.3.3. A fresh app is launched and killed for
 * every run, so every run is cold; the first launch after each build is a warm-up that is thrown away
 * (…/rg/warmup-symbol400.json, warmup2-symbol100.json). 2026-08-08. TWO runs of each design, and both are
 * kept here rather than a single figure, because the spread is itself a finding: the mixed design came
 * out 22.0 s and 105.0 s. The model is fitted and held to the WORST of them.
 *
 * `artifact` is the file on disk that run wrote — a figure without one does not belong in this table.
 * They are in the test and not only in a comment because a change to the model that does not come with
 * new measurements will fail here.
 */
type Measured = {
  symbolParts: number
  blockParts: number
  wires: number
  /** Every run of it. Three designs took four to five minutes a run and were run once. */
  wholeDrawMs: number[]
  artifact: string
}

const RG = 'AppData/Local/Temp/claude/rg'
const APPL = 'AppData/Local/Temp/claude/appl'
const BS = 'AppData/Local/Temp/claude/bs'

/**
 * WORST WINDOW SILENCE — the longest single stretch, inside a draw, during which the window answered
 * nothing at all. A different measurement from the whole-draw table below and the one the refusal is
 * decided on, because it is the one that says whether the app looks dead.
 *
 * Same machine, same door, same harness; the longest gap between two ticks of a 100 ms in-page heartbeat.
 * Measured on the bundle these tests ship with — the one where the batch sizer may go below its count
 * floor when a batch is measured to have held the window (canvas-draw-staging.ts). Every run is kept,
 * because the spread is a finding on its own: the mixed design came out 2.4, 2.9, 3.2 and 11.8 seconds on
 * four cold runs of the SAME bundle.
 *
 * `beforeTheSizerChange` marks the four designs that were NOT re-measured. All four are refused, so the
 * app never draws them; their figures are from the earlier bundle and are labelled rather than passed off
 * as current.
 */
type MeasuredSilence = {
  symbolParts: number
  blockParts: number
  wires: number
  silenceMs: number[]
  wholeDrawMs: number[]
  beforeTheSizerChange?: true
  artifact: string
}

const MEASURED_SILENCE: MeasuredSilence[] = [
  {
    symbolParts: 100,
    blockParts: 0,
    wires: 130,
    silenceMs: [250, 241],
    wholeDrawMs: [1260, 1211],
    artifact: `${BS}/after-symbol100w130.json`,
  },
  {
    symbolParts: 200,
    blockParts: 0,
    wires: 262,
    silenceMs: [270, 283],
    wholeDrawMs: [1564, 1574],
    artifact: `${BS}/after-symbol200w262.json`,
  },
  {
    symbolParts: 400,
    blockParts: 0,
    wires: 520,
    silenceMs: [851, 744],
    wholeDrawMs: [4345, 3941],
    artifact: `${BS}/after-symbol400w520.json`,
  },
  {
    symbolParts: 800,
    blockParts: 0,
    wires: 0,
    silenceMs: [2518, 3030],
    wholeDrawMs: [9464, 9353],
    artifact: `${BS}/after-symbol800w0.json`,
  },
  {
    symbolParts: 800,
    blockParts: 0,
    wires: 1040,
    silenceMs: [2813, 2806],
    wholeDrawMs: [12033, 11946],
    artifact: `${BS}/after-symbol800w1040.json`,
  },
  {
    symbolParts: 1000,
    blockParts: 0,
    wires: 1300,
    silenceMs: [2718, 14661],
    wholeDrawMs: [62786, 86013],
    artifact: `${BS}/after-symbol1000w1300.json`,
  },
  {
    symbolParts: 0,
    blockParts: 500,
    wires: 650,
    silenceMs: [556, 432],
    wholeDrawMs: [2925, 2246],
    artifact: `${BS}/after-block500w650.json`,
  },
  {
    symbolParts: 0,
    blockParts: 1000,
    wires: 1000,
    silenceMs: [876, 726],
    wholeDrawMs: [4575, 4623],
    artifact: `${BS}/after-block1000w1000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 2000,
    wires: 0,
    silenceMs: [610, 643],
    wholeDrawMs: [2082, 2342],
    artifact: `${BS}/after-block2000w0.json`,
  },
  {
    symbolParts: 0,
    blockParts: 2000,
    wires: 1000,
    silenceMs: [1383, 1227],
    wholeDrawMs: [7613, 7780],
    artifact: `${BS}/after-block2000w1000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 2000,
    wires: 2600,
    silenceMs: [5078, 5936],
    wholeDrawMs: [22218, 26728],
    artifact: `${BS}/after-block2000w2600.json`,
  },
  {
    symbolParts: 0,
    blockParts: 2000,
    wires: 4000,
    silenceMs: [14255],
    wholeDrawMs: [44012],
    artifact: `${BS}/after-block2000w4000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 2000,
    wires: 5000,
    silenceMs: [15410],
    wholeDrawMs: [65729],
    artifact: `${BS}/after-block2000w5000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 2500,
    wires: 1000,
    silenceMs: [1395, 1676],
    wholeDrawMs: [9192, 10877],
    artifact: `${BS}/after-block2500w1000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 3000,
    wires: 1000,
    silenceMs: [1654, 1562],
    wholeDrawMs: [12852, 11879],
    artifact: `${BS}/after-block3000w1000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 4000,
    wires: 1000,
    silenceMs: [2904, 3073],
    wholeDrawMs: [22247, 27064],
    artifact: `${BS}/after-block4000w1000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 6000,
    wires: 1000,
    silenceMs: [3975, 2711],
    wholeDrawMs: [39965, 29837],
    artifact: `${BS}/after-block6000w1000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 8000,
    wires: 1000,
    silenceMs: [4161, 4537, 4266, 4135, 5419],
    wholeDrawMs: [44714, 51936, 47452, 43944, 39274],
    artifact: `${BS}/after-block8000w1000.json`,
  },
  {
    symbolParts: 1000,
    blockParts: 1400,
    wires: 1000,
    silenceMs: [2877, 3244, 2422, 11835],
    wholeDrawMs: [15475, 17394, 15505, 71464],
    artifact: `${BS}/after-mixed2400w1000.json`,
  },
  {
    symbolParts: 1200,
    blockParts: 0,
    wires: 1560,
    silenceMs: [47058, 14446],
    wholeDrawMs: [129292, 74114],
    beforeTheSizerChange: true,
    artifact: `${RG}/symbol1200w1560.json`,
  },
  {
    symbolParts: 1600,
    blockParts: 0,
    wires: 2080,
    silenceMs: [69523, 72813],
    wholeDrawMs: [153964, 201159],
    beforeTheSizerChange: true,
    artifact: `${RG}/symbol1600w2080.json`,
  },
  {
    symbolParts: 0,
    blockParts: 2000,
    wires: 8000,
    silenceMs: [44381],
    wholeDrawMs: [279169],
    beforeTheSizerChange: true,
    artifact: `${RG}/block2000w8000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 4000,
    wires: 8000,
    silenceMs: [44535],
    wholeDrawMs: [281249],
    beforeTheSizerChange: true,
    artifact: `${RG}/block4000w8000.json`,
  },
]

const silenceSizeOf = (m: MeasuredSilence): DrawnDesignSize => ({
  parts: m.symbolParts + m.blockParts,
  symbolParts: m.symbolParts,
  blockParts: m.blockParts,
  wires: m.wires,
})
const worstSilenceOf = (m: MeasuredSilence) => Math.max(...m.silenceMs)
const namedSilence = (m: MeasuredSilence) => `${m.symbolParts}s+${m.blockParts}b/${m.wires}w`

const CG = 'AppData/Local/Temp/claude/cg'

/**
 * DESIGNS THE MODEL WAS NEVER FITTED TO, probed at and just inside the boundary it admits at.
 *
 * `MEASURED_DESIGNS` and `MEASURED_SILENCE` are both fit sets, and every test in this file used to be a
 * test of the model against its own training data. The one place a fitted curve can be badly wrong is
 * exactly the place nobody was looking, and it was: 8,000 grouped blocks with 2,000 wires — a size no row
 * of either table is near — estimated 46,388 ms, was admitted on both bounds, and drew for 96,213. That
 * is 0.482 of the truth, outside the 0.544-to-2.765 band this file asserts of the fit set and a worse
 * under-prediction than the 1.838 `OVER_ESTIMATE_FACTOR` was derived from.
 *
 * `wholeDrawMs` and `silenceMs` are the runs on the bundle these tests ship with (…/cg), measured after
 * the crossing scan was taken out of the draw and the settling step split; `beforeMs` is what the SAME
 * design did on the bundle before that work (…/bs/atk-admitted-residuals.json), kept so the two are not
 * confused and the change is checkable. Same machine, same door, same 100 ms heartbeat, a fresh app per
 * rep, every rep kept.
 */
type BoundaryDesign = {
  symbolParts: number
  blockParts: number
  wires: number
  /** Named only where two rows share their counts and differ in how the parts were laid out. */
  layout?: string
  wholeDrawMs: number[]
  silenceMs: number[]
  beforeMs: { wholeDraw: number[]; silence: number[]; artifact: string }
  artifact: string
}

const BOUNDARY_DESIGNS: BoundaryDesign[] = [
  {
    symbolParts: 0,
    blockParts: 2000,
    wires: 3400,
    wholeDrawMs: [18651, 19338, 19092],
    silenceMs: [3379, 2994, 3030],
    beforeMs: {
      wholeDraw: [30411, 31975, 29713],
      silence: [8270, 8469, 7794],
      artifact: `${CG}/before-b2000w3400.json`,
    },
    artifact: `${CG}/after4-b2000w3400.json`,
  },
  {
    symbolParts: 0,
    blockParts: 8000,
    wires: 2000,
    wholeDrawMs: [55870, 70425],
    silenceMs: [3849, 4532],
    beforeMs: {
      wholeDraw: [96213, 65085],
      silence: [8547, 6585],
      artifact: `${BS}/atk-s0b8000w2000.json`,
    },
    artifact: `${CG}/after4-b8000w2000.json`,
  },
  {
    symbolParts: 600,
    blockParts: 0,
    wires: 3300,
    wholeDrawMs: [12220, 11951],
    silenceMs: [1996, 2423],
    beforeMs: {
      wholeDraw: [44191, 32094],
      silence: [9073, 8880],
      artifact: `${BS}/atk-s600b0w3300.json`,
    },
    artifact: `${CG}/after4-s600w3300.json`,
  },
  {
    symbolParts: 0,
    blockParts: 300,
    wires: 3570,
    wholeDrawMs: [5784, 5668],
    silenceMs: [2285, 2284],
    beforeMs: {
      wholeDraw: [24764, 24568],
      silence: [8588, 8541],
      artifact: `${BS}/atk-s0b300w3570.json`,
    },
    artifact: `${CG}/after4-b300w3570.json`,
  },
  {
    symbolParts: 960,
    blockParts: 0,
    wires: 0,
    wholeDrawMs: [10298, 12358],
    silenceMs: [2916, 2848],
    beforeMs: {
      wholeDraw: [30234, 38201],
      silence: [3432, 5033],
      artifact: `${BS}/atk-s960b0w0.json`,
    },
    artifact: `${CG}/after4-s960.json`,
  },
  {
    symbolParts: 920,
    blockParts: 1400,
    wires: 1000,
    wholeDrawMs: [14069, 14340],
    silenceMs: [2039, 2054],
    beforeMs: {
      wholeDraw: [14106, 14812, 13760],
      silence: [1953, 2319, 1961],
      artifact: `${BS}/atk-s920b1400w1000.json`,
    },
    artifact: `${CG}/after4-s920b1400w1000.json`,
  },
  {
    // The SAME counts as the first row, laid out on a 20px pitch instead of 160 — every part on top of
    // every other, so every wire runs through the whole field. Cost is not a function of the counts, and
    // this pair is the sharpest evidence of it in the project: identical numbers, 3.4 s of worst silence
    // against 5.9. The model cannot tell them apart and does not claim to.
    layout: 'pitch 20',
    symbolParts: 0,
    blockParts: 2000,
    wires: 3400,
    wholeDrawMs: [31248, 28401],
    silenceMs: [5891, 5124],
    beforeMs: {
      wholeDraw: [30924, 34267],
      silence: [9255, 6224],
      artifact: `${BS}/atk-s0b2000w3400-tight.json`,
    },
    artifact: `${CG}/after4-b2000w3400tight.json`,
  },
]

const boundarySizeOf = (m: BoundaryDesign): DrawnDesignSize => ({
  parts: m.symbolParts + m.blockParts,
  symbolParts: m.symbolParts,
  blockParts: m.blockParts,
  wires: m.wires,
})
const namedBoundary = (m: BoundaryDesign) =>
  `${m.symbolParts}s+${m.blockParts}b/${m.wires}w${m.layout === undefined ? '' : ` (${m.layout})`}`

const MEASURED_DESIGNS: Measured[] = [
  {
    symbolParts: 100,
    blockParts: 0,
    wires: 130,
    wholeDrawMs: [761, 778],
    artifact: `${RG}/symbol100w130.json`,
  },
  {
    symbolParts: 200,
    blockParts: 0,
    wires: 262,
    wholeDrawMs: [1609, 2171],
    artifact: `${RG}/symbol200w262.json`,
  },
  {
    symbolParts: 400,
    blockParts: 0,
    wires: 520,
    wholeDrawMs: [4271, 4085],
    artifact: `${RG}/symbol400w520.json`,
  },
  {
    symbolParts: 0,
    blockParts: 500,
    wires: 650,
    wholeDrawMs: [2348, 2281],
    artifact: `${RG}/block500w650.json`,
  },
  {
    symbolParts: 800,
    blockParts: 0,
    wires: 0,
    wholeDrawMs: [28971, 29356],
    artifact: `${RG}/symbol800w0.json`,
  },
  {
    symbolParts: 800,
    blockParts: 0,
    wires: 1040,
    wholeDrawMs: [10339, 10444],
    artifact: `${RG}/symbol800w1040.json`,
  },
  {
    symbolParts: 0,
    blockParts: 1000,
    wires: 1000,
    wholeDrawMs: [4851, 4749],
    artifact: `${RG}/block1000w1000.json`,
  },
  {
    symbolParts: 1000,
    blockParts: 0,
    wires: 1300,
    wholeDrawMs: [51779, 52181],
    artifact: `${RG}/symbol1000w1300.json`,
  },
  {
    symbolParts: 1200,
    blockParts: 0,
    wires: 1560,
    wholeDrawMs: [129292, 74114],
    artifact: `${RG}/symbol1200w1560.json`,
  },
  {
    symbolParts: 1600,
    blockParts: 0,
    wires: 2080,
    wholeDrawMs: [153964, 201159],
    artifact: `${RG}/symbol1600w2080.json`,
  },
  {
    symbolParts: 0,
    blockParts: 2000,
    wires: 0,
    wholeDrawMs: [2567, 2414],
    artifact: `${RG}/block2000w0.json`,
  },
  {
    symbolParts: 0,
    blockParts: 2000,
    wires: 1000,
    wholeDrawMs: [7897, 8221],
    artifact: `${RG}/block2000w1000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 2000,
    wires: 2600,
    wholeDrawMs: [17578, 17397],
    artifact: `${RG}/block2000w2600.json`,
  },
  {
    symbolParts: 0,
    blockParts: 2000,
    wires: 4000,
    wholeDrawMs: [31775],
    artifact: `${RG}/block2000w4000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 2000,
    wires: 8000,
    wholeDrawMs: [279169],
    artifact: `${RG}/block2000w8000.json`,
  },
  {
    symbolParts: 1000,
    blockParts: 1400,
    wires: 1000,
    wholeDrawMs: [105008, 21995],
    artifact: `${RG}/mixed2400w1000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 3000,
    wires: 1000,
    wholeDrawMs: [12994, 12711],
    artifact: `${RG}/block3000w1000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 4000,
    wires: 1000,
    wholeDrawMs: [18681, 17330],
    artifact: `${RG}/block4000w1000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 4000,
    wires: 8000,
    wholeDrawMs: [281249],
    artifact: `${RG}/block4000w8000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 6000,
    wires: 1000,
    wholeDrawMs: [27451, 24763],
    artifact: `${RG}/block6000w1000.json`,
  },
  {
    symbolParts: 0,
    blockParts: 8000,
    wires: 1000,
    wholeDrawMs: [33005, 33029],
    artifact: `${RG}/block8000w1000.json`,
  },
]

const sizeOf = (m: Measured): DrawnDesignSize => ({
  parts: m.symbolParts + m.blockParts,
  symbolParts: m.symbolParts,
  blockParts: m.blockParts,
  wires: m.wires,
})
const worstOf = (m: Measured) => Math.max(...m.wholeDrawMs)
const named = (m: Measured) => `${m.symbolParts}s+${m.blockParts}b/${m.wires}w`

/**
 * The model this one replaces, so "it over-charged" is computed here rather than remembered. Its own
 * constants, from the version of canvas-capacity.ts that shipped before this: a floor of 180 ms, one
 * curve over a weighted part count, and a grouped block charged a tenth of a device symbol.
 */
const previousEstimateMs = (m: Measured) => {
  const weightedParts = m.symbolParts + 0.1 * m.blockParts
  return 180 + 0.0458 * weightedParts ** 2.1 + 0.00735 * weightedParts ** 1.55 * m.wires
}

const symbolSize = (parts: number, wires: number): DrawnDesignSize => ({
  parts,
  symbolParts: parts,
  blockParts: 0,
  wires,
})
const blockSize = (parts: number, wires: number): DrawnDesignSize => ({
  parts,
  symbolParts: 0,
  blockParts: parts,
  wires,
})

const file = (parts: number, wires: number, definition = 'resistor') => ({
  format: CIRCUIT_FILE_FORMAT,
  version: CIRCUIT_FILE_VERSION,
  nodes: Array.from({ length: parts }, (_, i) => ({
    id: `r${i}`,
    definition,
    x: i * 10,
    y: 0,
  })),
  wires: Array.from({ length: wires }, (_, i) => ({
    id: `w${i}`,
    source: `r${i % Math.max(parts, 1)}`,
    sourceHandle: 'terminal_a',
    target: `r${(i + 1) % Math.max(parts, 1)}`,
    targetHandle: 'terminal_b',
  })),
})

describe('what decides admit-vs-refuse is the WINDOW SILENCE, not the whole draw', () => {
  test('the quantity the ceiling is compared against is the one that says the app looks dead', () => {
    // The defect this whole describe exists for. The estimate was re-derived from worst-silence onto
    // whole-draw time and the 60,000 ms ceiling was kept, which are different quantities — so nothing
    // bounded the freeze at all. Two designs the app ADMITTED under that arrangement: the mixed one, its
    // card frozen at "Placing parts — 1,354 of 2,400" for 54,267 ms, and 2,000 blocks with 5,000 wires,
    // 78,002 ms of draw with 18,922 in one unbroken silence. Neither could be reported while it happened
    // — the stall watchdog runs on the thread the draw is blocking.
    expect(tooBigToDrawReason(blockSize(2000, 5000))).toBeDefined()
    expect(
      tooBigToDrawReason({ parts: 2400, symbolParts: 1000, blockParts: 1400, wires: 1000 }),
    ).toBeDefined()
    // …and both are inside the WAIT ceiling, so the wait alone would still admit them. That is the proof
    // that the decision moved rather than the numbers being tightened.
    expect(estimateDrawCostMs(blockSize(2000, 5000))).toBeLessThan(MAX_DRAW_WAIT_MS)
    expect(
      estimateDrawCostMs({ parts: 2400, symbolParts: 1000, blockParts: 1400, wires: 1000 }),
    ).toBeLessThan(MAX_DRAW_WAIT_MS)
  })

  test('NOTHING measured going quiet for less than the ceiling is refused', () => {
    // The mirror of the wait ceiling's own test, and the one that keeps this from becoming the
    // over-refusing model it replaces.
    for (const m of MEASURED_SILENCE) {
      if (worstSilenceOf(m) >= MAX_SILENCE_MS) continue
      expect({
        design: namedSilence(m),
        wentQuietForMs: worstSilenceOf(m),
        refused: tooBigToDrawReason(silenceSizeOf(m)) !== undefined,
      }).toEqual({ design: namedSilence(m), wentQuietForMs: worstSilenceOf(m), refused: false })
    }
  })

  test('the design the over-charge allowance is really deciding is named, with its own numbers', () => {
    // 8,000 grouped blocks with 1,000 wires. Five cold runs: 4,135, 4,161, 4,266, 4,537 and 5,419 ms of
    // worst silence, drawing in 39.3 to 51.9 s. The estimate reads 5,214, which is over the five-second
    // line — so without the allowance the app would refuse a design it draws, which is exactly the
    // mistake the model before this one was written to undo.
    //
    // AND IT IS NOT FREE, which is why this is its own test rather than a clause in another. One of the
    // five runs went quiet for 5,419 ms, over the line the app says it allows. The allowance is what let
    // that through. Refusing it instead would have cost four runs that were inside the line, and a draw
    // the user could have watched; this is the trade, stated rather than smoothed over.
    const design = MEASURED_SILENCE.find((m) => m.blockParts === 8000) as MeasuredSilence
    expect(design.silenceMs.filter((ms) => ms < MAX_SILENCE_MS).length).toBe(4)
    expect(worstSilenceOf(design)).toBe(5419)
    expect(Math.round(estimateWorstSilenceMs(silenceSizeOf(design)))).toBe(5214)
    expect(estimateWorstSilenceMs(silenceSizeOf(design))).toBeGreaterThan(MAX_SILENCE_MS)
    expect(tooBigToDrawReason(silenceSizeOf(design))).toBeUndefined()
  })

  test('every design that IS refused on silence was measured going quiet for over ten seconds', () => {
    // The other direction: a refusal has to be earned. Each of these has a run on disk in which the
    // window answered nothing for longer than ten seconds in one stretch.
    const refusedForSilence = MEASURED_SILENCE.filter(
      (m) => estimateWorstSilenceMs(silenceSizeOf(m)) > silenceRefusedAboveMs(),
    )
    expect(refusedForSilence.map(namedSilence)).toEqual([
      '1000s+0b/1300w',
      '0s+2000b/4000w',
      '0s+2000b/5000w',
      '1000s+1400b/1000w',
      '1200s+0b/1560w',
      '1600s+0b/2080w',
      '0s+2000b/8000w',
      '0s+4000b/8000w',
    ])
    for (const m of refusedForSilence) {
      expect({ design: namedSilence(m), overTenSeconds: worstSilenceOf(m) > 10_000 }).toEqual({
        design: namedSilence(m),
        overTenSeconds: true,
      })
    }
  })

  test('the silence estimate reads within the band it claims on every design re-measured', () => {
    // 0.562 to 1.578 across the nineteen designs drawn on this bundle (…/bs/silence-model.json). The
    // band is what SILENCE_ESTIMATE_RUNS_HIGH_BY is set from, so moving a coefficient without measuring
    // something new fails here.
    const redrawn = MEASURED_SILENCE.filter((m) => m.beforeTheSizerChange !== true)
    expect(redrawn.length).toBe(19)
    const ratios = redrawn.map((m) => ({
      design: namedSilence(m),
      ratio: estimateWorstSilenceMs(silenceSizeOf(m)) / worstSilenceOf(m),
    }))
    for (const { design, ratio } of ratios) {
      expect({ design, inBand: ratio >= 0.56 && ratio <= 1.58 }).toEqual({ design, inBand: true })
    }
    expect(Math.max(...ratios.map((r) => r.ratio))).toBeCloseTo(SILENCE_ESTIMATE_RUNS_HIGH_BY, 2)
  })

  test('silence is not a fixed fraction of the draw, which is the assumption that let 54 s through', () => {
    // On 2,000 grouped blocks with 1,000 wires the draw is 7.8 s and the worst silence 1.4 — 18 %. On
    // the same blocks with 5,000 wires the draw is 65.7 s and the worst silence 15.4 — 23 %. On 8,000
    // blocks with 1,000 wires, 51.9 s and 4.5 — 9 %. No one multiplier turns one into the other, so a
    // model of one cannot be reused as a model of the other however the constant is chosen.
    const fractions = MEASURED_SILENCE.filter((m) => m.beforeTheSizerChange !== true).map(
      (m) => worstSilenceOf(m) / Math.max(...m.wholeDrawMs),
    )
    expect(Math.min(...fractions)).toBeLessThan(0.1)
    expect(Math.max(...fractions)).toBeGreaterThan(0.3)
  })

  test('the refusal says WHICH bound was crossed, because they mean different things', () => {
    const silent = tooBigToDrawReason(blockSize(2000, 5000)) as string
    expect(silent).toContain('stop answering')
    expect(silent).toContain('long enough to look like it had died')
    // The sentence and the branch beside it have to name the SAME rule. The card used to read "This app
    // allows 5 seconds of that" while the branch refused at MAX_SILENCE_MS × SILENCE_ESTIMATE_RUNS_HIGH_BY
    // — 7,890 ms — so six of the seven designs it admitted at the boundary went quiet for longer than the
    // five seconds it promised (…/bs/atk-admitted-residuals.json).
    expect(silent).toContain('aims to keep that under 5 seconds')
    expect(silent).toContain(
      `it does not refuse until the estimate passes ${Math.round(silenceRefusedAboveMs() / 1000)} seconds`,
    )
    // The two bounds usually fall together, and where they do the silence is what is named — it is the
    // more surprising of the two and the one a person could not have guessed. 11,000 grouped blocks with
    // no wires is the case where only the WAIT is crossed, and there the message says only that.
    const slow = tooBigToDrawReason(blockSize(11_000, 0)) as string
    expect(slow).toContain('waits 60 seconds at most')
    expect(slow).not.toContain('stop answering')
    // Both still say what did NOT happen, in the words of the door — a refusal must never leave a person
    // wondering whether it ate their work.
    expect(silent).toContain('Nothing was opened.')
    expect(tooBigToDrawReason(blockSize(2000, 5000), 'The paste was not made.')).toContain(
      'The paste was not made.',
    )
  })

  test('an empty design and a tiny one are silent for nothing and refused for nothing', () => {
    expect(estimateWorstSilenceMs(symbolSize(0, 0))).toBe(0)
    expect(estimateWorstSilenceMs(symbolSize(22, 36))).toBeLessThan(MAX_SILENCE_MS)
    expect(tooBigToDrawReason(symbolSize(22, 36))).toBeUndefined()
  })

  test('the silence estimate never falls as a design grows', () => {
    for (let parts = 1; parts < 3000; parts += 37) {
      expect(estimateWorstSilenceMs(symbolSize(parts + 1, 40))).toBeGreaterThan(
        estimateWorstSilenceMs(symbolSize(parts, 40)),
      )
      expect(estimateWorstSilenceMs(blockSize(parts + 1, 40))).toBeGreaterThan(
        estimateWorstSilenceMs(blockSize(parts, 40)),
      )
    }
    for (let wires = 0; wires < 6000; wires += 61) {
      expect(estimateWorstSilenceMs(blockSize(500, wires + 1))).toBeGreaterThan(
        estimateWorstSilenceMs(blockSize(500, wires)),
      )
    }
  })
})

describe('the estimate is WHOLE-DRAW time, and answers to every measured design', () => {
  test('NOTHING measured drawing in under a minute is over the WAIT ceiling', () => {
    // THE test this model exists for. The one it replaces refused SEVEN of these — designs that drew in
    // 10.4, 17.6, 18.7, 27.5, 31.8, 33.0 and 52.2 seconds — while telling the user they would take
    // minutes. Six was the count this comment carried; the seventh, 2,000 blocks with 4,000 wires at
    // 31.8 s, is in the list the next test asserts and was missing from this one.
    //
    // It asks about the WAIT ceiling specifically, and it used to ask `tooBigToDrawReason`. Those are no
    // longer the same question: a design can be well under a minute to draw and still stop the window
    // dead for fifteen seconds inside it, and that is now its own refusal with its own test below.
    for (const m of MEASURED_DESIGNS) {
      if (worstOf(m) > MAX_DRAW_WAIT_MS) continue
      expect({
        design: named(m),
        drewInMs: worstOf(m),
        overTheWaitCeiling: estimateDrawCostMs(sizeOf(m)) > MAX_DRAW_WAIT_MS,
      }).toEqual({ design: named(m), drewInMs: worstOf(m), overTheWaitCeiling: false })
    }
  })

  test('the model this replaces refused seven of them, and by how much is why it was replaced', () => {
    // SEVEN, and the seven are listed. The header of this file used to say six, list six, and leave out
    // the 31.8-second design, while the title of this very test said seven.
    const wronglyRefused = MEASURED_DESIGNS.filter(
      (m) => worstOf(m) <= MAX_DRAW_WAIT_MS && previousEstimateMs(m) > MAX_DRAW_WAIT_MS,
    )
    expect(wronglyRefused.map(named)).toEqual([
      '800s+0b/1040w',
      '1000s+0b/1300w',
      '0s+2000b/2600w',
      '0s+2000b/4000w',
      '0s+4000b/1000w',
      '0s+6000b/1000w',
      '0s+8000b/1000w',
    ])
    // The worst of it: 8,000 grouped blocks draw in 33.0 s and were quoted at 289.7 s, 8.8x over.
    const overcharge = MEASURED_DESIGNS.map((m) => previousEstimateMs(m) / worstOf(m))
    expect(Math.max(...overcharge)).toBeGreaterThan(28)
    const now = MEASURED_DESIGNS.map((m) => estimateDrawCostMs(sizeOf(m)) / worstOf(m))
    expect(Math.max(...now)).toBeLessThan(3)
  })

  test('the estimate reads between half and three times every design measured', () => {
    // The band is the finding, not a target: twenty-one designs, 0.54 to 2.77
    // (…/rg/estimate-vs-measured.json). It is held tightly enough that moving a coefficient without
    // measuring something new fails here.
    const ratios = MEASURED_DESIGNS.map((m) => ({
      design: named(m),
      ratio: estimateDrawCostMs(sizeOf(m)) / worstOf(m),
    }))
    for (const { design, ratio } of ratios) {
      expect({ design, inBand: ratio >= 0.5 && ratio <= 2.8 }).toEqual({ design, inBand: true })
    }
    const values = ratios.map((r) => r.ratio)
    expect(Math.min(...values)).toBeCloseTo(0.544, 2)
    expect(Math.max(...values)).toBeCloseTo(2.765, 2)
  })

  test('thousands of wires are what the previous model had no term for at all', () => {
    // The same 2,000 blocks: 17.6 s with 2,600 wires, 31.8 s with 4,000, 279.2 s with 8,000. A flat
    // per-wire cost admits the last one at 41 s. This is the one place this file refuses MORE than the
    // model it replaces, and it is refusing a design measured taking four and a half minutes.
    const cliff = MEASURED_DESIGNS.filter((m) => m.wires === 8000)
    expect(cliff.map(named)).toEqual(['0s+2000b/8000w', '0s+4000b/8000w'])
    for (const m of cliff) {
      expect({
        design: named(m),
        drewInMs: worstOf(m),
        refused: tooBigToDrawReason(sizeOf(m)) !== undefined,
      }).toEqual({
        design: named(m),
        drewInMs: worstOf(m),
        refused: true,
      })
    }
    // …and the 4,000-wire design just below it is still inside the WAIT ceiling, at 31.8 s measured.
    // It is refused all the same, on the other bound: re-measured on this bundle it drew in 44.0 s with
    // 14,255 ms of that in one silent stretch (…/bs/after-block2000w4000.json).
    expect(estimateDrawCostMs(blockSize(2000, 4000))).toBeLessThan(MAX_DRAW_WAIT_MS)
    expect(tooBigToDrawReason(blockSize(2000, 4000))).toContain('stop answering')
    // A flat per-wire charge is what would let 8,000 wires through, so the term that stops it is held
    // here by the ratio it creates between two wire counts on the same parts.
    const crowded =
      estimateDrawCostMs(blockSize(2000, 8000)) - estimateDrawCostMs(blockSize(2000, 0))
    const roomy = estimateDrawCostMs(blockSize(2000, 1000)) - estimateDrawCostMs(blockSize(2000, 0))
    expect(crowded / roomy).toBeGreaterThan(30)
  })

  test('the two designs that contradict each other are both in the table, and one is over-charged', () => {
    // 800 symbols with no wires take 29.4 s; the same 800 symbols with 1,040 wires take 10.4 s. Fewer
    // wires, three times the wait, on two runs each. Nothing that rises with both counts can fit that
    // pair, so the model splits them — and the 2.765x on the wired one is that split, not a mistake to
    // be tuned away. (2.66x is what this comment used to say, seven lines above an assertion of 2.765.)
    // Deleting either row would make the model look better than it is.
    const bare = MEASURED_DESIGNS.find((m) => m.symbolParts === 800 && m.wires === 0)
    const wired = MEASURED_DESIGNS.find((m) => m.symbolParts === 800 && m.wires === 1040)
    expect([bare, wired].every((m) => m !== undefined)).toBe(true)
    if (bare === undefined || wired === undefined) return
    expect(worstOf(bare)).toBeGreaterThan(worstOf(wired) * 2.5)
    expect(estimateDrawCostMs(sizeOf(wired)) / worstOf(wired)).toBeGreaterThan(2.5)
  })

  test('WHERE the WAIT ceiling falls is measured on both sides of it now', () => {
    // The version this replaces could not say this: the slowest design it had ever measured took 26.9 s
    // against a 60 s line, so every refusal was extrapolation past all of its data. These two are 200
    // parts apart and sit either side of the line, measured.
    const under = MEASURED_DESIGNS.find((m) => m.symbolParts === 1000 && m.wires === 1300)
    const over = MEASURED_DESIGNS.find((m) => m.symbolParts === 1200)
    expect([under, over].every((m) => m !== undefined)).toBe(true)
    if (under === undefined || over === undefined) return
    expect(worstOf(under)).toBeLessThan(MAX_DRAW_WAIT_MS)
    expect(estimateDrawCostMs(sizeOf(under))).toBeLessThan(MAX_DRAW_WAIT_MS)
    expect(Math.min(...over.wholeDrawMs)).toBeGreaterThan(MAX_DRAW_WAIT_MS)
    expect(estimateDrawCostMs(sizeOf(over))).toBeGreaterThan(MAX_DRAW_WAIT_MS)
    // The 1,000-symbol design passes the wait ceiling and is refused anyway, because on this bundle it
    // was measured going silent for 14,661 ms in one stretch (…/bs/after-symbol1000w1300.json). Naming
    // that here is the point: two bounds, and which one fired is not guesswork.
    expect(tooBigToDrawReason(sizeOf(under))).toContain('stop answering')
    expect(tooBigToDrawReason(sizeOf(over))).toContain('stop answering')
  })

  test('no measured design that ran past the ceiling is admitted any more', () => {
    // WHAT THIS TEST USED TO SAY, and why it is written this way now. It asserted by exact equality that
    // the mixed design was "the ONE measured design where something this file let through crossed the
    // ceiling", and the file said the same in prose. A single probe refuted it while the words were being
    // written: 2,000 grouped blocks with 5,000 wires were admitted too and drew for 78,002 ms, with
    // 18,922 of them in one unbroken silence (…/rg/verify-audit.json). An exact-equality assertion on a
    // list of "the only one" is a claim about designs nobody has measured, which is not a thing a test
    // can hold.
    //
    // So the claim is inverted. Both of those are now refused — on the silence bound, not the wait one —
    // and what is asserted is that NOTHING measured overrunning the ceiling is still let through.
    const overrunning = MEASURED_DESIGNS.filter(
      (m) => worstOf(m) > MAX_DRAW_WAIT_MS && tooBigToDrawReason(sizeOf(m)) === undefined,
    )
    expect(overrunning.map(named)).toEqual([])
    const mixed = MEASURED_DESIGNS.find((m) => m.symbolParts === 1000 && m.blockParts === 1400)
    expect(mixed?.wholeDrawMs).toEqual([105008, 21995])
    // 57,134 ms, not the "55.3 s" the file used to quote: a 2.9-second margin against the ceiling, not
    // 4.7. It clears the wait ceiling and is refused on the other bound.
    expect(Math.round(estimateDrawCostMs(sizeOf(mixed as Measured)))).toBe(57134)
    expect(tooBigToDrawReason(sizeOf(mixed as Measured))).toContain('stop answering')
    expect(tooBigToDrawReason(blockSize(2000, 5000))).toContain('stop answering')
  })

  test('the two part families are charged different curves, because they measure differently', () => {
    // 2,000 grouped blocks with no wires draw in 2.6 s; 800 device symbols with no wires take 29.4 s.
    // One weight times one shared curve cannot hold both, which is what the previous model tried.
    expect(estimateDrawCostMs(symbolSize(800, 0))).toBeGreaterThan(
      estimateDrawCostMs(blockSize(2000, 0)) * 5,
    )
    // The whole point: the same counts cost differently, so they are decided differently.
    expect(tooBigToDrawReason(symbolSize(1100, 1430))).toBeDefined()
    expect(tooBigToDrawReason(blockSize(1100, 1430))).toBeUndefined()
  })

  test('cost rises with parts and with wires, so nothing gets cheaper by growing', () => {
    for (let parts = 1; parts < 400; parts += 7) {
      expect(estimateDrawCostMs(symbolSize(parts + 1, 40))).toBeGreaterThan(
        estimateDrawCostMs(symbolSize(parts, 40)),
      )
      expect(estimateDrawCostMs(symbolSize(parts, 41))).toBeGreaterThan(
        estimateDrawCostMs(symbolSize(parts, 40)),
      )
    }
  })

  test('the wait a user may be asked for is NOT the solver’s runaway stop, and is the lead’s number', () => {
    // These were one constant, on the argument that both hold the thread that paints the window so the
    // app should have one answer for "too long". They are different questions and now have different
    // answers. The solver's is a stop for something uninterruptible that was never going to finish. This
    // one is how long a person may be asked to wait for a design they chose to open, watching it arrive
    // — the project lead's decision, "the app should give 30sec to 1min", taken at the top of the range
    // because refusing is the last resort and a shorter line is only more designs nobody can open.
    expect(MAX_DRAW_WAIT_MS).toBe(60_000)
    expect(MAX_DRAW_WAIT_MS).toBeGreaterThan(CANVAS_SOLVE_BUDGET_MS)
  })
})

describe('counting a design', () => {
  test('a file is counted by its own parts, and a block part is counted as a block', () => {
    expect(designSizeOfFile(file(10, 12))).toEqual({
      parts: 10,
      symbolParts: 10,
      blockParts: 0,
      wires: 12,
    })
    expect(designSizeOfFile(file(10, 12, 'block'))).toEqual({
      parts: 10,
      symbolParts: 0,
      blockParts: 10,
      wires: 12,
    })
  })

  test('a drawn node is a block when the BLOCK renderer draws it — its type, not its definition', () => {
    // A block dropped from the palette keeps the definition it was dropped as; only its type says
    // block. Counting the definition alone charged those the device-symbol curve, which at a thousand
    // parts is the difference between five seconds and a minute.
    const dropped = [{ type: 'block', data: { definition: 'display_seven_segment' } }]
    expect(designSizeOfCanvas(dropped, 0).blockParts).toBe(1)
    const fromFile = [{ type: 'block', data: { definition: 'block' } }]
    expect(designSizeOfCanvas(fromFile, 0).blockParts).toBe(1)
    const device = [{ type: 'device', data: { definition: 'resistor' } }]
    expect(designSizeOfCanvas(device, 0)).toEqual({
      parts: 1,
      symbolParts: 1,
      blockParts: 0,
      wires: 0,
    })
  })

  test('an unmeasured part kind is charged the most expensive kind that WAS measured', () => {
    // Junctions and keycaps are plainly simpler to draw than a resistor; nobody has measured them.
    for (const definition of ['junction', 'keycap', 'mosfet_nmos', undefined]) {
      expect(designSizeOfCanvas([{ type: 'device', data: { definition } }], 0).symbolParts).toBe(1)
    }
  })
})

describe('what the refusal says', () => {
  test('the biggest design measured drawing quietly, of each kind, is not refused', () => {
    // 1,000 device symbols with 1,300 wires used to be here as "measured 52.2 s and not refused". It is
    // refused now, and not for its wait: re-measured on this bundle it went silent for 14,661 ms in one
    // stretch (…/bs/after-symbol1000w1300.json). What is left in its place is the biggest design of each
    // kind that was measured drawing WITHOUT a silence over the ceiling.
    expect(tooBigToDrawReason(symbolSize(800, 1040))).toBeUndefined() // 12.0 s, quiet for 2.8
    expect(tooBigToDrawReason(blockSize(8000, 1000))).toBeUndefined() // 51.9 s, quiet for 4.5
  })

  test('a design refused for the WAIT alone says so, and does not mention the window going quiet', () => {
    // Both bounds usually fall together, because both curves rise with the same counts. Blocks with no
    // wires are where they come apart: 11,000 grouped blocks estimate 64.7 s of draw, over the minute,
    // and 6.6 s of silence, under the line the silence bound refuses at.
    const waitOnly = blockSize(11_000, 0)
    expect(estimateDrawCostMs(waitOnly)).toBeGreaterThan(MAX_DRAW_WAIT_MS)
    expect(estimateWorstSilenceMs(waitOnly)).toBeLessThan(
      MAX_SILENCE_MS * SILENCE_ESTIMATE_RUNS_HIGH_BY,
    )
    const reason = tooBigToDrawReason(waitOnly) as string
    expect(reason).toContain('waits 60 seconds at most')
    expect(reason).not.toContain('stop answering')
  })

  test('the refusal carries the design’s own size and both ceilings it is protecting', () => {
    const reason = tooBigToDrawReason(symbolSize(4746, 8227)) as string
    expect(reason).toContain('4,746')
    expect(reason).toContain('8,227')
    expect(reason).toContain(`${Math.round(MAX_DRAW_WAIT_MS / 1000)}`)
    expect(reason).toContain(`${Math.round(MAX_SILENCE_MS / 1000)}`)
    // …and it never quotes arithmetic nobody could act on. This design's silence estimate is over three
    // hours; the difference between that and forty minutes changes nothing a person would do.
    expect(reason).not.toContain('11251')
    expect(reason).toContain('many minutes')
  })

  test('it reads as a sentence — the shipped one said "would take for roughly 2 minutes to draw"', () => {
    // A grammar defect, seen on the built app: the helper already returns the "for", and the sentence
    // it is dropped into supplied another. It is a test rather than a careful read because this is
    // shipped text a user is shown at their worst moment, and nothing else here reads the whole phrase.
    expect(tooBigToDrawReason(symbolSize(1200, 1560))).toContain(
      'would take roughly 2 minutes to draw.',
    )
    expect(tooBigToDrawReason(symbolSize(1100, 1430))).toContain(
      'would take roughly 77 seconds to draw.',
    )
    for (const size of [symbolSize(1200, 1560), symbolSize(1100, 1430), symbolSize(99_999, 0)]) {
      expect(tooBigToDrawReason(size)).not.toContain('take for ')
    }
  })

  test('it does not invent a number for a design far past anything measured', () => {
    // 17,919 parts extrapolates to years. Quoting that would be a fabricated figure, not a measurement.
    expect(tooBigToDrawReason(symbolSize(17919, 32070))).toContain(
      'would take many minutes to draw',
    )
    expect(tooBigToDrawReason(symbolSize(1100, 1430))).toContain('seconds to draw')
  })

  test('the number it quotes is called an estimate, and says how far out it has been', () => {
    // The band is measured and belongs in the sentence: saying "would take 78 seconds" flat would
    // present a fitted curve as a reading, and this is the one number on the card a person cannot
    // check for themselves.
    //
    // THIS TEST USED TO PIN THE WRONG BAND. It asserted the literal words "between half and three
    // times what they really took" — the band across the twenty-one designs the model was FITTED to.
    // The boundary designs, which it was not fitted to, read 0.659 to 4.120, and when those were
    // measured and asserted further down this file the sentence on the card was left alone. A literal
    // string here is what made that possible, so the assertion now goes through the same two constants
    // the card is built from.
    const reason = tooBigToDrawReason(symbolSize(1100, 1430))
    expect(reason).toContain('That is an estimate from designs that were measured drawing')
    expect(reason).toContain(
      `between ${DRAW_ESTIMATE_READS_LOW_BY} and ${DRAW_ESTIMATE_READS_HIGH_BY} times what they really took`,
    )
  })

  test('the real designs that hung the window are refused', () => {
    expect(tooBigToDrawReason(symbolSize(4746, 8227))).toBeDefined() // behind File ▸ Open Circuit
    expect(tooBigToDrawReason(symbolSize(3808, 6834))).toBeDefined() // pairmix: 157 s of dead window
    expect(tooBigToDrawReason(symbolSize(1582, 2761))).toBeDefined() // splitout: 10.2 s then 8.4 s
    expect(tooBigToDrawReason(symbolSize(17919, 32070))).toBeDefined() // the largest repo fixture
    // …and the two biggest are refused even if every last part of them is a cheap grouped block.
    expect(tooBigToDrawReason(blockSize(4746, 8227))).toBeDefined()
    expect(tooBigToDrawReason(blockSize(17919, 32070))).toBeDefined()
    // The 1,582-part splitout design is the one this changes its mind about: as grouped blocks it
    // estimates 17 s and is ADMITTED, and as blocks it measured 10.2 s and 8.4 s, so refusing it was
    // the guard being wrong. It is admitted, drawn in batches, and can be stopped.
    expect(tooBigToDrawReason(blockSize(1582, 2761))).toBeUndefined()
    // As BLOCKS the 4,746-part project is refused too, and that is new: its 8,227 wires alone are past
    // the wire counts measured at four and a half minutes. The model this replaces charged wires flat
    // and would have started that draw.
    expect(tooBigToDrawReason(blockSize(4746, 8227))).toBeDefined()
  })

  test('it says what did NOT happen, in the words of the door that refused', () => {
    const size = symbolSize(99_999, 0)
    expect(tooBigToDrawReason(size)).toContain('Nothing was opened.')
    expect(tooBigToDrawReason(size, 'Nothing was pasted.')).toContain('Nothing was pasted.')
    expect(tooBigToDrawReason(size, 'Nothing was pasted.')).not.toContain('Nothing was opened')
  })

  test('a whole file, and a whole canvas, are refused through the same estimate', () => {
    expect(tooBigFileToDrawReason(file(300, 389))).toBeUndefined()
    expect(tooBigFileToDrawReason(file(1200, 1560))).toBeDefined()
    expect(tooBigFileToDrawReason(file(5000, 6500, 'block'))).toBeDefined()
    expect(tooBigFileToDrawReason(file(550, 713, 'block'))).toBeUndefined()
    const canvas = Array.from({ length: 1200 }, () => ({ type: 'device', data: {} }))
    expect(tooBigCanvasToDrawReason(canvas, 1560, 'Nothing was pasted.')).toContain(
      'Nothing was pasted.',
    )
  })
})

describe('the door in the main process — File ▸ Open Circuit and the launcher both read through it', () => {
  test('a project too big to draw is refused before any window is handed it', () => {
    const decision = decideCircuitOpen(JSON.stringify(file(4746, 8227)))
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.kind).toBe('too-big')
    expect(decision.reason).toContain('too big to put on the canvas')
  })

  test('a refused project is told apart from a missing one, so its entry is never pruned', () => {
    const refused = decideCircuitOpen(JSON.stringify(file(4746, 8227)))
    const junk = decideCircuitOpen('not a circuit file at all')
    expect(refused.ok || junk.ok).toBe(false)
    if (refused.ok || junk.ok) return
    expect(refused.kind).toBe('too-big')
    expect(junk.kind).toBe('unreadable')
  })

  test('a project at the limit still opens', () => {
    expect(decideCircuitOpen(JSON.stringify(file(300, 389))).ok).toBe(true)
  })

  test('the same door judges a block-heavy project by the block curve', () => {
    // The two families measure so far apart that the same counts land on opposite sides of the line:
    // 1,200 grouped blocks and 1,560 wires estimate 9 s, and the same design as device symbols
    // estimates 103 s — which is what 1,200 symbols and 1,560 wires really took, twice (74 s, 129 s).
    expect(decideCircuitOpen(JSON.stringify(file(1200, 1560, 'block'))).ok).toBe(true)
    expect(decideCircuitOpen(JSON.stringify(file(1200, 1560, 'resistor'))).ok).toBe(false)
  })
})

describe('the door that is not a file at all — ungrouping a block', () => {
  const blockOf = (innerParts: number): BlockData => ({
    name: 'big',
    origin: { x: 0, y: 0 },
    nodes: Array.from({ length: innerParts }, (_, i) => ({
      id: `inner_${i}`,
      definition: 'resistor',
      x: i * 10,
      y: 0,
    })),
    edges: [],
    ports: [],
  })
  const canvasWith = (innerParts: number): CanvasNodeLike[] => [
    {
      id: 'blk',
      position: { x: 0, y: 0 },
      data: { definition: 'block', block: blockOf(innerParts) },
    },
  ]

  test('a block holding more parts than the canvas can draw is refused, and left alone', () => {
    const result = ungroupBlock(canvasWith(1200), [], 'blk')
    expect('reason' in result).toBe(true)
    if (!('reason' in result)) return
    expect(result.reason).toContain('too big to put on the canvas')
    expect(result.reason).toContain('The block was left as it is.')
  })

  test('an ordinary block still ungroups', () => {
    const result = ungroupBlock(canvasWith(4), [], 'blk')
    expect('reason' in result).toBe(false)
    if ('reason' in result) return
    expect(result.nodes.length).toBe(4)
  })

  test('grouping is not affected — it makes the canvas smaller, never bigger', () => {
    const nodes: CanvasNodeLike[] = Array.from({ length: 3 }, (_, i) => ({
      id: `r${i}`,
      position: { x: i * 40, y: 0 },
      data: { definition: 'resistor' },
      selected: true,
    }))
    const grouped = groupSelection(nodes, [], new Set(['r0', 'r1', 'r2']), 'blk', 'trio')
    expect('reason' in grouped).toBe(false)
  })
})

/**
 * The call sites the type system cannot police.
 *
 * Inside App.tsx a door CANNOT forget the FILE check: `circuitFileToFlow` returns a refusal-or-canvas
 * union, so a door that does not handle the refusal does not compile — `npx tsc --noEmit` is the
 * detector there.
 *
 * The rest are ordinary function calls that would compile perfectly well if deleted, and none lives
 * anywhere a unit test can reach (React closures inside an 11,000-line component, and a launcher
 * component with no DOM test environment in this project). These tests cannot prove they are CORRECT —
 * only that they are still there, which is exactly the regression that produced this whole defect: a
 * guard that quietly stopped being called.
 *
 * The right answer, where it can be had, is to move the rule OUT of the closure so that it can be run
 * by a test. That is what happened to the four rules around a running draw — cancel the draw already
 * drawing, lower the flag on every exit, let go of the replaced canvas when a draw finishes, pulse the
 * watchdog. They are `staged-draw-session.ts` now and tests/staged-draw-session.test.ts exercises every
 * one of them for real. What is left here is the four CALL SITES that hand work to it, and reading the
 * source is all this project can do about those.
 */
describe('the call sites no test can otherwise reach', () => {
  const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const appSection = (from: string, to: string) => {
    const text = source('src/renderer/App.tsx')
    const start = text.indexOf(from)
    expect(start).toBeGreaterThan(-1)
    const end = text.indexOf(to, start)
    expect(end).toBeGreaterThan(start)
    return text.slice(start, end)
  }

  test('the launcher checks every saved circuit it opens a tab for', () => {
    const text = source('src/renderer/project-browser.tsx')
    // openFromFile (the file dialog + reopening a recent project) and startTemplate (a saved template).
    expect(text.split('tooBigFileToDrawReason').length - 1).toBeGreaterThanOrEqual(3)
  })

  test('paste checks the canvas it would leave behind', () => {
    const paste = appSection('const doPaste', 'const doRotate')
    expect(paste).toContain('tooBigCanvasToDrawReason')
    expect(paste).toContain('Nothing was pasted.')
  })

  test('the one function that builds a canvas from a file asks BEFORE it builds anything', () => {
    // Every file door — Open, Import, Read-a-chip-file, a tab mounting on a saved project — goes
    // through this function, and its refusal is the only thing standing between them and the freeze.
    // Deleting the two lines still compiles and left this suite green until this test existed.
    const build = appSection('function circuitFileToFlow', 'const nodes = file.nodes.map')
    expect(build).toContain('tooBigFileToDrawReason(file)')
    expect(build).toContain('return { ok: false, reason: tooBig }')
  })

  test('a tab opening on a saved project keeps the refusal and shows it', () => {
    // The type system catches a door that IGNORES the refusal, because it cannot reach the canvas
    // without narrowing. It does not catch a door that narrows correctly and then throws the reason
    // away — which would leave this tab opening blank and silent, the exact shape of the original bug.
    const text = source('src/renderer/App.tsx')
    expect(text).toContain('!loadedFlow.ok ? loadedFlow.reason')
    expect(text).toContain('initial.refusedReason')
  })

  test('the app hands the draw the settling steps the helper builds, not a list of its own', () => {
    // WRITTEN BECAUSE THE MUTATION SURVIVED. The three tests further down this file that count the
    // settling steps call `stagedDrawSettleSteps` themselves, so they say what the helper returns and
    // nothing about whether the app still uses it. Replacing the call site with the audit's exact cut —
    // `settle: [() => setAutoRouteWires(true)]` — left all 4,330 tests green
    // (…/qs/vfy-mutations.json, mutation M8d), which is the same defect the helper was extracted to fix,
    // one level up. This reads the source, so it proves the call is THERE and not that it works; that is
    // the most this project can reach inside an 11,000-line component, and it is what the mutation needed.
    const staged = appSection('settle: stagedDrawSettleSteps({', 'onProgress:')
    expect(staged).toContain('enableAutoRoute: () => setAutoRouteWires(true)')
    expect(staged).toContain('reSolve: () => reSolve(plan.nodes, plan.edges)')
    expect(staged).toContain('afterwards: plan.afterwards')
    // No second settle list anywhere: an array literal handed straight over is the shape of the cut.
    const text = source('src/renderer/App.tsx')
    expect(text.split('settle:').length - 1).toBe(1)
  })

  test('the crossing scan is asked for the plain limit, because the cap already adds its one', () => {
    // WRITTEN BECAUSE THE MUTATION SURVIVED. `markableWireCrossings` scans for `limit + 1` so that a
    // truncated scan can be told from a full one. Putting the old undisclosed `+ 1` back at the call site
    // as well — which is what this file's own history did — makes the scan ask for `limit + 2`: up to
    // 2,001 dots are then drawn against a stated cap of 2,000, and overflow is only reported past 2,001.
    // Every test stayed green for it (…/qs/vfy-mutations.json, mutation X4).
    const marked = appSection('markableWireCrossings(', '[wireGeoms, edges, drawProgress]')
    expect(marked).toContain('WIRE_CROSSING_MARK_LIMIT,')
    expect(marked).not.toContain('WIRE_CROSSING_MARK_LIMIT +')
  })

  test('each appliance placer checks the whole design it lays out', () => {
    // The calculator and the two Verilog CPU demos each build a hundred-odd parts in one go — a bulk
    // canvas load wearing a different hat, and one that used to be placed with no check at all.
    const text = source('src/renderer/App.tsx')
    expect(text.split('refuseApplianceIfTooBig(').length - 1).toBe(3) // the three placers
    for (const placer of [
      'const placeCalculator',
      'const placeVerilogCpuDemo',
      'const placeVerilogCpu8Demo',
    ]) {
      expect(appSection(placer, 'stageDraw({')).toContain('refuseApplianceIfTooBig')
    }
  })

  test('every appliance is drawn through the STAGER, not handed over in one call', () => {
    // The one that used to hand React 119 parts and 241 wires in a single setNodes is the reason the
    // window went dead for up to 8.8 s with nothing on screen. A placer that goes back to doing that
    // compiles perfectly well and shows no bar at all, which is the regression this catches.
    const text = source('src/renderer/App.tsx')
    // Three placers, a saved project on mount, and File ▸ Open Circuit.
    expect(text.split('stageDraw({').length - 1).toBe(5)
    for (const placer of [
      'const placeCalculator',
      'const placeVerilogCpuDemo',
      'const placeVerilogCpu8Demo',
    ]) {
      const body = appSection(placer, '}, [stageDraw')
      expect(body).toContain('stageDraw({')
      expect(body).not.toContain('setNodes(() =>')
      expect(body).not.toContain('setEdges(() =>')
    }
  })

  test('the always-on re-solve stands down while a design is being staged in', () => {
    // Without this the stager would solve a half-drawn circuit once per batch — dozens of solves of a
    // design that is not there yet, which is the very cost the batching exists to avoid.
    const text = source('src/renderer/App.tsx')
    // Two re-solve effects, plus the startup fit — which without it frames the first four parts of a
    // design still arriving and then latches, leaving a big project opened zoomed onto a corner of it —
    // plus the Solve BUTTON, which had no check at all and was measured running a full 1,927 ms solve of
    // a half-drawn canvas and reporting the answer as the circuit's.
    expect(text.split('drawSessionRef.current.isDrawing) return').length - 1).toBe(4)
  })

  test('a saved project big enough to be worth watching is STAGED, not handed over in one call', () => {
    // The door the whole guard was written for. It is also the door where the raised ceiling would
    // have done real harm on its own: a minute of dead window where five seconds used to be refused.
    const build = appSection('const wholeFlow = {', 'const materials =')
    expect(build).toContain('const stageOnMount =')
    // The whole assignment, not just the name in it: `const stageOnMount = false && isWorth…(` reads
    // fine, keeps every substring a looser check looks for, and stages nothing ever. Mutation-tested —
    // it survived the whole suite against `toContain('isWorthStagingTheDraw(')`.
    expect(build).toContain('const stageOnMount = isWorthStagingTheDraw(')
    expect(build).toContain('const nodes: Node[] = stageOnMount ? [] : wholeFlow.nodes')
    // …and the WHOLE call, argument included. This is a source read because the call sits inside an
    // 11,000-line React component that no test in this project can render; what it can do is make the
    // reachable part of the decision as large as possible, which is why the threshold is no longer
    // passed in here. It used to be, and `isWorthStagingTheDraw(size, Number.MAX_SAFE_INTEGER)` —
    // which stages nothing, ever — was mutation-tested against the whole 4,253-test suite and SURVIVED.
    // What is left to get wrong here is the size, so the size is read too.
    expect(build).toContain(
      'isWorthStagingTheDraw(\n      designSizeOfCanvas(wholeFlow.nodes, wholeFlow.edges.length),\n    )',
    )
    const text = source('src/renderer/App.tsx')
    expect(text).toContain('const staged = initial.stagedFlow')
    expect(text).toContain('frameWhenDone: true')
  })

  test('File ▸ Open Circuit is drawn in batches too — the last door that was not', () => {
    // It was the only remaining one-call load: `setNodes(flow.nodes); setEdges(flow.edges)` with no
    // card, no counts and no Stop. It is also the door that most needed them, because it is the only
    // one that makes the opened file the file a plain Ctrl+S then writes to.
    const open = appSection('return bridge.onCircuitOpened((text) => {', '// A saved project')
    expect(open).toContain('stageDraw({')
    expect(open).not.toContain('setNodes(flow.nodes)')
    expect(open).not.toContain('setEdges(flow.edges)')
    // Everything else the file replaces is remembered before it is replaced, and put back by Stop.
    expect(open).toContain('const previous = {')
    expect(open.indexOf('const previous = {')).toBeLessThan(open.indexOf('onStart: () => {'))
    for (const restored of [
      'setProjectAmbientC(previous.ambientC)',
      'setSheetSettings(previous.sheet)',
      'setPcbPlacements(previous.placements)',
      'setChipLayout(previous.chipLayout)',
      'setPcbStackupOptions(previous.stackup)',
      'setPcbVScoredSides(previous.vScoredSides)',
      'setPcbProfile(previous.boardProfile)',
      'setUserTraces(previous.traces)',
      'setUserVias(previous.vias)',
      'dropCount.current = previous.dropCount',
    ]) {
      expect(open).toContain(restored)
    }
  })

  test('a stopped open makes the window forget the file it opened', () => {
    // The hazard staging this door CREATES, and the reason the previous pass left it unstaged. Stop
    // puts the old canvas back; without this the window is still pointed at the file just opened, and
    // the next plain Ctrl+S writes the old design over it with no dialog at all. This project has
    // already destroyed a project file that way.
    const open = appSection('return bridge.onCircuitOpened((text) => {', '// A saved project')
    const onStop = open.slice(open.indexOf('onStop: () => {'))
    expect(onStop).toContain('bridge.forgetCircuitPath?.()')
    // …and the main process has to actually forget it. Setting the path to null is what makes the next
    // Save ask for a location instead of writing over the file the user opened and did not keep.
    const main = source('electron/main.ts')
    expect(main).toContain(`ipcMain.handle('circuit:forget-path'`)
    const handler = main.slice(main.indexOf(`ipcMain.handle('circuit:forget-path'`))
    expect(handler.slice(0, 200)).toContain('setCircuitPath(window, null)')
    expect(source('electron/preload.ts')).toContain(`ipcRenderer.invoke('circuit:forget-path')`)
  })

  test('Stop runs the door’s own undo, not only the stager’s', () => {
    // Parts, wires and logic state are the stager's to put back. A loaded file's board ambient, sheet,
    // copper and the file the window would Save to are the DOOR's, because only the door knows it
    // changed them — and a Stop that leaves them changed has cost the user their board.
    const stop = appSection('const stopStagedDraw', 'const drawIsRunning')
    expect(stop).toContain('before.onStop?.()')
    const start = appSection('const stageDraw = useCallback', 'const runner = new StagedDraw')
    expect(start).toContain('onStop: plan.onStop')
    // The guard goes up BEFORE the door's own resets run, or the always-on re-solve and the
    // auto-router see a canvas mid-swap: a loaded file's ambient against the previous file's parts.
    expect(start.indexOf('drawSessionRef.current.begin({')).toBeLessThan(
      start.indexOf('plan.onStart?.()'),
    )
  })

  test('every draw is run through the session that knows how to end one', () => {
    // SOURCE-SHAPE ONLY, and said so: what these four lines DO is tested for real in
    // tests/staged-draw-session.test.ts, which is where they were moved to so that they could be. All
    // this can see is that the canvas still hands its draw over to it. Deleting any one of them
    // compiles: `attach` is what gives the watchdog something to pulse, `progressed` is what ends the
    // session, `stop` is the Stop button's whole body, and the effect is the pulse itself.
    const start = appSection('const stageDraw = useCallback', 'const stopStagedDraw')
    expect(start).toContain('drawSessionRef.current.begin({')
    expect(start).toContain('drawSessionRef.current.progressed(progress)')
    expect(start).toContain('drawSessionRef.current.attach(runner)')
    const stop = appSection('const stopStagedDraw', 'const drawIsRunning')
    expect(stop).toContain('const before = drawSessionRef.current.stop()')
    const pulse = appSection('const drawIsRunning', 'File ▸ Open Circuit')
    expect(pulse).toContain('return drawSessionRef.current.pulseWhileDrawing()')
  })

  test('the appliance refusal REFUSES — it reports and then says no', () => {
    // Reporting the refusal and then returning false reads perfectly well, compiles, shows the user the
    // right card, and places the design anyway. Nothing else in this suite can see inside the closure.
    const guard = appSection('const refuseApplianceIfTooBig', 'const placeCalculator')
    expect(guard).toContain('if (tooBig === undefined) return false')
    expect(guard.slice(guard.indexOf('setNetlistReport'))).toContain('return true')
  })

  test('a refused appliance leaves the canvas, the logic state and the undo history alone', () => {
    // Every one of these placers used to reset the flip-flop memory and push an undo checkpoint BEFORE
    // it had built anything, so a refusal would have cost the user state in exchange for nothing.
    for (const placer of ['const placeCalculator', 'const placeVerilogCpuDemo']) {
      const upToTheCheck = appSection(placer, 'refuseApplianceIfTooBig')
      expect(upToTheCheck).not.toContain('checkpointAction(')
      expect(upToTheCheck).not.toContain('logicStateRef.current =')
    }
  })

  test('the block-pin effect re-measures the blocks that CHANGED, not every block on the canvas', () => {
    // THE ROOT CAUSE, at its call site. React Flow writes to its store on every `updateNodeInternals`
    // call and every part on the canvas answers every write, so re-measuring the whole canvas costs
    // N × N — and this effect re-measured the whole canvas whenever ANY block's pins changed, which
    // during a staged draw is once per batch. Profiled on the built app: 18,224 ms of a 30,846 ms
    // 2,000-block draw inside `updateNodeInternals` (…/repair/t2/prof-blk2000.json). Going back to
    // `for (const nodeId of blockPinSignatures.keys())` compiles, behaves identically to the eye, and
    // is the whole defect — this is the only thing standing in its way.
    const effect = appSection('const previousBlockPinSignatures', 'DEV-only control surface')
    expect(effect).toContain('nodesNeedingRemeasure(previousBlockPinSignatures.current')
    expect(effect).toContain('for (const nodeId of changed) updateNodeInternals(nodeId)')
    expect(effect).not.toContain('blockPinSignatures.keys()')
    // …and the updater it calls has to be the coalescing one. The uncoalesced hook is one store write
    // per id, which is the same N × N by the other route.
    const text = source('src/renderer/App.tsx')
    expect(text).toContain('const updateNodeInternals = useCoalescedUpdateNodeInternals()')
    expect(text).not.toContain('useUpdateNodeInternals()')
    expect(source('src/renderer/symbols.tsx')).toContain('useCoalescedUpdateNodeInternals()')
    expect(source('src/renderer/symbols.tsx')).not.toContain('useUpdateNodeInternals()')
  })

  test('a save fired while a design is still arriving writes nothing at all', () => {
    // MEASURED on the built app, and the worst thing in this file: the save handler serialized the
    // half-drawn canvas and main wrote it over the remembered path with no dialog. A file holding 119
    // parts and 241 wires came back holding 10 parts and the OLD file's 241 wires — a circuit that
    // never existed, in place of the user's (…/repair/before-save-mid-draw.json, reproduced twice).
    // Both serializing doors are held, because either one writes a partial design somewhere.
    const save = appSection('bridge.onSaveRequest(() => {', 'const file = serializeCircuit')
    expect(save).toContain('if (drawSessionRef.current.isDrawing) {')
    expect(save).toContain('return')
    const template = appSection(
      'bridge.onSaveTemplateRequest(() => {',
      'const circuit = serializeCircuit',
    )
    expect(template).toContain('if (drawSessionRef.current.isDrawing) {')
    expect(template).toContain('return')
  })

  test('Stop puts the canvas back exactly as it was, and takes its checkpoint with it', () => {
    // Measured: stopping at "Placing parts — 33 of 119" over a 300-part project left 54 components and
    // the OLD project's 250 wires (…/repair/before-stop.json) — every part of one design beside every
    // wire of another. A Stop must cost the user nothing, so it restores rather than keeps.
    const stop = appSection('const stopStagedDraw', 'const drawIsRunning')
    expect(stop).toContain('setNodes(before.nodes)')
    expect(stop).toContain('setEdges(before.edges)')
    expect(stop).toContain('logicStateRef.current = before.logicState')
    expect(stop).toContain('dropLastCheckpoint(undoHistory.current, before.undoTag)')
    // And it must not go on claiming the old promise, which was measured false on the tab-mount door.
    expect(stop).not.toContain('undo takes the whole placement back')
    // The state it restores has to be read BEFORE the draw touches anything — after the first commit
    // there is nothing left to remember.
    const start = appSection('const stageDraw = useCallback', 'const runner = new StagedDraw')
    expect(start).toContain('nodes: nodesRef.current')
    expect(start).toContain('edges: edgesRef.current')
    expect(start).toContain('logicState: logicStateRef.current')
    expect(start.indexOf('drawSessionRef.current.begin({')).toBeLessThan(
      start.indexOf('plan.onStart?.()'),
    )
  })

  test('the old design leaves in one step — never its wires beside the arriving parts', () => {
    // For 552 ms the status line read "4 components, 302 wires": the arriving design's parts beside
    // the departing design's wires, whose endpoints no longer existed. Both halves go together now,
    // before the first batch, and every batch after that only appends.
    const start = appSection('const stageDraw = useCallback', 'const runner = new StagedDraw')
    expect(start).toContain('setNodes([])')
    expect(start).toContain('setEdges([])')
    const commit = appSection('commit: (chunk) => {', 'settle: ')
    expect(commit).not.toContain('chunk.from === 0')
  })

  test('the three placers hand their pre-draw resets to the draw, so a Stop undoes them too', () => {
    // Clearing the flip-flop memory before the draw meant a Stop left the canvas restored and the
    // logic state of whatever had been running on it wiped — user work, quietly gone.
    const text = source('src/renderer/App.tsx')
    // One per placer, plus File ▸ Open Circuit, and nowhere else.
    expect(text.split("undoTag: '").length - 1).toBe(4)
    for (const placer of [
      'const placeCalculator',
      'const placeVerilogCpuDemo',
      'const placeVerilogCpu8Demo',
    ]) {
      const body = appSection(placer, '}, [stageDraw')
      expect(body).toContain('onStart: () => {')
      expect(body).toContain('undoTag:')
      const beforeTheDraw = body.slice(0, body.indexOf('stageDraw({'))
      expect(beforeTheDraw).not.toContain('logicStateRef.current =')
      expect(beforeTheDraw).not.toContain('checkpointAction(')
    }
  })

  test('no built-in starting template is bigger than the canvas can draw', () => {
    // A new tab lays out a wired template, so that is a door too — but the templates are constants in
    // the source, not user data, and a runtime refusal for a constant would be unreachable code. The
    // door is held shut here instead. The most expensive of the 39 is 22 parts / 36 wires ≈ 177 ms; an
    // earlier version of this line said "22 parts / 45 wires", which is the largest part count of one
    // template beside the largest wire count of another and describes no template that exists.
    const text = source('src/renderer/App.tsx')
    const literal = text.slice(
      text.indexOf('const TEMPLATE_FLOWS'),
      text.indexOf('function templateFlow'),
    )
    const templates = literal.split(/\n {2}'?[\w-]+'?: \{\n/).slice(1)
    expect(templates.length).toBe(39)
    for (const template of templates) {
      const parts = (template.match(/\bid: '/g) ?? []).length
      const wires = (template.match(/\['/g) ?? []).length
      expect({
        parts,
        wires,
        refused: tooBigToDrawReason(symbolSize(parts, wires)) !== undefined,
      }).toEqual({ parts, wires, refused: false })
    }
  })

  test('adding one part checks the canvas it would grow into', () => {
    // A canvas grown one drop at a time past what can be DRAWN saves fine and then cannot be opened
    // again. Both placement paths — drag-drop and the Add-Part pop-up — ask.
    const text = source('src/renderer/App.tsx')
    expect(text.split('refuseOnePartIfTooBig(').length - 1).toBe(4) // 3 drop paths + the pop-up
    expect(appSection('const onDrop', 'const placePart')).toContain('refuseOnePartIfTooBig')
    expect(appSection('const placePart', 'Schematic Hierarchy outline')).toContain(
      'refuseOnePartIfTooBig',
    )
    // …and it REFUSES. Reporting the refusal and returning false reads perfectly well, shows the user
    // the right card, and adds the part anyway. Mutation-tested: without this line, turning that
    // `return true` into `return false` left the whole 4,224-test suite green.
    const guard = appSection('const refuseOnePartIfTooBig', 'const onDrop')
    expect(guard).toContain('if (tooBig === undefined) return false')
    expect(guard.slice(guard.indexOf('setNetlistReport'))).toContain('return true')
  })

  test('the draw yields to the browser between batches, which is the whole reason a bar can exist', () => {
    // `paintThenRun` is the one piece of the stager the unit tests cannot see: they inject their own
    // scheduler, so this function has no coverage at all. Deleting its yield turns the staged draw back
    // into one long synchronous block, the bar renders once at the end, and every test still passes —
    // mutation-tested, and it survived the whole suite. Reading the source is all that can be done from
    // here; that the frame is really painted is measured on the built app (…/appl/audit-three.json,
    // where the card was sampled on a 100 ms tick and moved through seven to nine distinct states).
    const text = source('src/renderer/canvas-draw-staging.ts')
    const yielder = text.slice(text.indexOf('export function paintThenRun'))
    expect(yielder).toContain('requestAnimationFrame(')
    expect(yielder).toContain('setTimeout(run, 0)')
    // rAF alone fires BEFORE paint, so a batch run from it lands in the same frame and nothing appears.
    expect(yielder.indexOf('requestAnimationFrame(')).toBeLessThan(
      yielder.indexOf('setTimeout(run'),
    )
    expect(yielder).toContain('cancelAnimationFrame(')
    expect(yielder).toContain('clearTimeout(')
  })

  test('a design with nothing to watch is drawn in one call, and shows no bar counting 0 of 0', () => {
    // Measured on the built app: creating a BLANK project put a card reading "Placing parts — 0 of 0"
    // on screen (…/appl/audit-mount.json), because the decision compared the WHOLE estimate against the
    // batch target and the empty-canvas floor alone (180 ms) already exceeded it. Every design there can
    // ever be was staged. There is no floor in the estimate now, so a blank project costs zero and is
    // never staged whatever the line is set to.
    const nothing = symbolSize(0, 0)
    expect(estimateDrawCostMs(nothing)).toBe(0)
    expect(isWorthStagingTheDraw(nothing)).toBe(false)
    expect(isWorthStagingTheDraw(symbolSize(1, 0))).toBe(false)
    // Every built-in starting template is on the same side of it — a new tab must not flash a bar.
    const text = source('src/renderer/App.tsx')
    const literal = text.slice(
      text.indexOf('const TEMPLATE_FLOWS'),
      text.indexOf('function templateFlow'),
    )
    for (const template of literal.split(/\n {2}'?[\w-]+'?: \{\n/).slice(1)) {
      const parts = (template.match(/\bid: '/g) ?? []).length
      const wires = (template.match(/\['/g) ?? []).length
      expect({
        parts,
        wires,
        staged: isWorthStagingTheDraw(symbolSize(parts, wires)),
      }).toEqual({ parts, wires, staged: false })
    }
    // …and everything a person would actually wait for still is staged. The calculator demo is 89
    // device symbols, 30 grouped blocks and 241 wires; 100 parts and 130 wires is the smallest design
    // ever measured through the launcher and it took 778 ms.
    const calculator: DrawnDesignSize = { parts: 119, symbolParts: 89, blockParts: 30, wires: 241 }
    expect(isWorthStagingTheDraw(calculator)).toBe(true)
    expect(isWorthStagingTheDraw(symbolSize(100, 130))).toBe(true)
    // The line sits in a gap nothing measured falls into: the biggest template estimates 177 ms and
    // that 100-part design estimates 658. Both sides of the gap are held here, so moving the line into
    // either measured neighbourhood fails.
    expect(estimateDrawCostMs(symbolSize(22, 36))).toBeLessThan(200)
    expect(estimateDrawCostMs(symbolSize(100, 130))).toBeGreaterThan(600)
    expect(STAGE_DRAW_ABOVE_MS).toBeGreaterThan(estimateDrawCostMs(symbolSize(22, 36)))
    expect(STAGE_DRAW_ABOVE_MS).toBeLessThan(estimateDrawCostMs(symbolSize(100, 130)))
  })
})

/**
 * Drawing a design in batches, and the bar that reports it.
 *
 * The requirement these are written against is one sentence from the project lead — "so loading long is
 * fine just make sure its not just stuck" — so what is tested is not that the draw is fast. It is that
 * every number the bar shows was really earned, that the one step which cannot report a fraction says so
 * instead of inventing one, and that a draw which stops moving is NOTICED. A bar sitting at 40% for ever
 * is the freeze it replaced.
 *
 * The clock and the scheduler are injected, so a five-second stall is tested in no time at all and the
 * batches can be counted exactly. What this cannot prove is that the browser paints between them — that
 * is measured on the built app over CDP, not here.
 */
describe('drawing a big design in batches, with the progress reporting real work', () => {
  /** A draw wired to a fake clock and a fake scheduler; `stepMs` says what each batch costs. */
  const harness = (
    parts: number,
    wires: number,
    opts: {
      stepMs?: number
      expectedMs?: number
      paintMs?: number
      /** Paint cost per item in the batch just handed over — a cost paid per ITEM rather than per call. */
      paintPerUnitMs?: number
      /** Which phase `paintPerUnitMs` does NOT apply to, so one phase can be cheap and the other not. */
      cheapPhase?: StagedDrawPhase
      /**
       * What one more item already on the canvas adds to the per-item paint cost — the thing every fixed
       * cost in this harness leaves out. Measured on the built app, a wire cost about 2.5 ms to draw on
       * an empty canvas and about 20 at the far end of the same phase (…/cg/before-b2000w3400.json, rep
       * 1, card samples). A sizer judged only against costs that never move is a sizer judged in a world
       * that does not exist.
       */
      paintPerUnitPerDrawnMs?: number
    } = {},
  ) => {
    const clock = { ms: 1000 }
    const committed: StagedDrawChunk[] = []
    const progress: StagedDrawProgress[] = []
    // Which scheduler turn each progress update was emitted in. Everything said within one turn is
    // one React render and ONE paint, so only the last of them is ever seen — which is how "1,000 of
    // 1,000" was emitted, asserted, and still never shown to anybody.
    const emittedInTurn: number[] = []
    let turn = 0
    const state = { pending: undefined as (() => void) | undefined, settled: 0 }
    const draw = new StagedDraw({
      what: 'the calculator',
      parts,
      wires,
      expectedMs: opts.expectedMs ?? 10_000,
      now: () => clock.ms,
      schedule: (run) => {
        // `paintMs` is the time that passes AFTER a batch returns and before the next one starts —
        // React's render, the layout and the paint that the commit only enqueued. It is the whole
        // reason the cost of a batch cannot be read from the commit call, so the harness can produce
        // a batch that costs nothing to hand over and a great deal to draw.
        state.pending = () => {
          const last = committed[committed.length - 1]
          const cheap = last === undefined || last.phase === opts.cheapPhase
          const drawn = last === undefined ? 0 : last.to
          const perUnit = cheap
            ? 0
            : (opts.paintPerUnitMs ?? 0) + (opts.paintPerUnitPerDrawnMs ?? 0) * drawn
          clock.ms += (opts.paintMs ?? 0) + perUnit * (last === undefined ? 0 : last.to - last.from)
          turn += 1
          run()
        }
        return () => {
          state.pending = undefined
        }
      },
      commit: (chunk) => {
        committed.push(chunk)
        clock.ms += opts.stepMs ?? 10
      },
      settle: [
        () => {
          state.settled += 1
          clock.ms += opts.stepMs ?? 10
        },
      ],
      onProgress: (p) => {
        progress.push(p)
        emittedInTurn.push(turn)
      },
    })
    const runPending = () => {
      const next = state.pending
      state.pending = undefined
      next?.()
    }
    const latest = () => progress[progress.length - 1] as StagedDrawProgress
    const runToEnd = () => {
      draw.start()
      for (let i = 0; i < 2000; i++) {
        if (state.pending === undefined || latest().done) break
        runPending()
      }
    }
    /** The updates that actually reach a screen: the last one emitted in each scheduler turn. */
    const painted = () => progress.filter((_, i) => emittedInTurn[i] !== emittedInTurn[i + 1])
    return { committed, progress, state, clock, draw, runPending, latest, runToEnd, painted }
  }

  test('every part and every wire is committed exactly once, parts first', () => {
    const run = harness(119, 241)
    run.runToEnd()
    const parts = run.committed.filter((c) => c.phase === 'parts')
    const wires = run.committed.filter((c) => c.phase === 'wires')
    // Contiguous, in order, covering the whole design — a batch skipped or repeated is a part missing
    // from the canvas or drawn twice, and the counts on the bar would still look right.
    const covers = (chunks: StagedDrawChunk[], total: number) => {
      let at = 0
      for (const c of chunks) {
        if (c.from !== at) return false
        at = c.to
      }
      return at === total
    }
    expect(covers(parts, 119)).toBe(true)
    expect(covers(wires, 241)).toBe(true)
    expect(run.committed.findIndex((c) => c.phase === 'wires')).toBe(parts.length)
    expect(run.state.settled).toBe(1)
  })

  test('it takes many batches, or there would be nothing to paint between', () => {
    const run = harness(119, 241)
    run.runToEnd()
    expect(run.committed.length).toBeGreaterThan(4)
  })

  test('the count on the bar is what has really landed, never what is about to', () => {
    const run = harness(20, 10)
    run.draw.start()
    // Before any batch runs the bar is up and reads zero — the point of SCHEDULING the first batch
    // rather than running it is that the card is on screen before the expensive part, not after.
    expect((run.progress[0] as StagedDrawProgress).unitsDone).toBe(0)
    expect((run.progress[0] as StagedDrawProgress).unitsTotal).toBe(30)
    run.runPending()
    expect(run.latest().unitsDone).toBe(FIRST_BATCH_UNITS)
    expect(run.latest().unitsDone).toBe((run.committed[0] as StagedDrawChunk).to)
  })

  test('the step that cannot count says so, and shows no percentage at all', () => {
    const run = harness(8, 4)
    run.runToEnd()
    const settling = run.progress.filter((p) => p.phase === 'settling' && !p.done)
    expect(settling.length).toBeGreaterThan(0)
    for (const p of settling) {
      expect(p.determinate).toBe(false)
      expect(stagedDrawFraction(p)).toBeUndefined()
      expect(stagedDrawLabel(p)).toContain('cannot report how far along it is')
    }
    // …and while it CAN count, it says what it is doing as well as how far along it is.
    // The words count the thing they name; the BAR is filled from the whole design. On the built app
    // this once read "Placing parts — 10 of 360", counting parts towards a total of parts and wires.
    const placing = run.progress.find((p) => p.phase === 'parts' && p.unitsDone > 0)
    expect(stagedDrawLabel(placing as StagedDrawProgress)).toBe('Placing parts — 4 of 8')
    expect(stagedDrawFraction(placing as StagedDrawProgress)).toBeCloseTo(4 / 12, 10)
    const wiring = harness(8, 40)
    wiring.runToEnd()
    const drawingWires = wiring.progress.find((p) => p.phase === 'wires' && p.phaseDone > 0)
    expect(stagedDrawLabel(drawingWires as StagedDrawProgress)).toContain(' of 40')
  })

  test('batches shrink when they overrun the target and grow when they undershoot it', () => {
    expect(nextBatchUnits(16, STEP_TARGET_MS * 2)).toBe(8)
    expect(nextBatchUnits(16, STEP_TARGET_MS / 4)).toBe(24)
    expect(nextBatchUnits(16, STEP_TARGET_MS * 0.9)).toBe(16)
    expect(nextBatchUnits(1, STEP_TARGET_MS * 10)).toBe(1) // never zero, or it would never finish
    // On a machine where every batch overruns, the draw does not give up on painting: it keeps handing
    // over the smallest batch this design allows, which is its floor and never less.
    const slow = harness(30, 0, { stepMs: STEP_TARGET_MS * 3 })
    slow.runToEnd()
    const sizes = slow.committed.filter((c) => c.phase === 'parts').map((c) => c.to - c.from)
    expect(sizes[0]).toBe(FIRST_BATCH_UNITS)
    // Only the LAST batch may be smaller than the floor, and only because there is less than that left.
    for (const size of sizes.slice(1, -1)) expect(size).toBe(minimumBatchUnits(30))
  })

  test('what a batch COST is the work React does after it, not the call that handed it over', () => {
    // The defect this file's first version shipped with. `commit` enqueues; the render and the paint
    // run after it returns, so a batch that hands over cheaply and draws expensively read as free.
    // Here every commit is instant and every PAINT is three times the target — the sizer must still
    // see an overrun and back off. Measured on the built app before this was fixed, the batch grew
    // 4, 33, 54, 86, 134, 314, 476, 1084 and the window went quiet for 6,132 ms in one stretch.
    const run = harness(400, 0, { stepMs: 0, paintMs: STEP_TARGET_MS * 3 })
    run.runToEnd()
    const sizes = run.committed.filter((c) => c.phase === 'parts').map((c) => c.to - c.from)
    // Every batch overran, so it backed off to the floor and stayed there. Read the commit's own
    // duration instead and it grows to four figures on exactly this input.
    expect(Math.max(...sizes)).toBe(minimumBatchUnits(400))
    expect(run.latest().worstStepMs).toBeGreaterThanOrEqual(STEP_TARGET_MS * 3)
  })

  test('a batch never grows past the ceiling, however cheap the ones before it looked', () => {
    // Growth only corrects a batch AFTER it has been paid for, so the size a cheap history can reach
    // is the size of the freeze a change of cost can then cause. 3,000 parts of free work is the
    // extreme of that: without a ceiling the batch reaches four figures.
    const run = harness(3000, 0, { stepMs: 0, paintMs: 0 })
    run.runToEnd()
    const sizes = run.committed.filter((c) => c.phase === 'parts').map((c) => c.to - c.from)
    expect(Math.max(...sizes)).toBe(MAX_BATCH_UNITS)
    expect(nextBatchUnits(MAX_BATCH_UNITS, 1)).toBe(MAX_BATCH_UNITS)
  })

  test('a batch never shrinks below the floor WHILE NOTHING HAS GONE WRONG', () => {
    // The pathology the floor exists for: committing anything re-renders the canvas already there, so on
    // a big design a batch can overrun however small it is. Halving on every overrun then walks the batch
    // down to one item and the draw to a standstill.
    //
    // THE ARTIFACT THAT USED TO BE CITED HERE PROVES NOTHING. This comment said a 2,000-block design
    // "did not finish in 600 seconds" with the bounds taken out; …/repair/after-2000-nofloor.json holds
    // no draw time and no silence figure at all, only `"error": "timed out waiting for draw finished"`
    // on the build with the re-measure defect, and its own captured app log opens with the debug port
    // failing to bind. What is left is the shape of the argument, which is sound, and the tests below,
    // which exercise it.
    //
    // The floor is NOT absolute any more, and that is the fix for the freeze this suite is named after:
    // a batch measured holding the window past SLOW_BATCH_MS sets it aside for the rest of its phase.
    // Everything asserted here is the untroubled case, where the floor still holds.
    expect(minimumBatchUnits(2400)).toBe(300)
    expect(minimumBatchUnits(8)).toBe(1)
    expect(minimumBatchUnits(0)).toBe(1)
    expect(minimumBatchUnits(100_000)).toBe(MAX_BATCH_UNITS) // the floor never outranks the ceiling
    // However many times in a row a batch overruns, it stops at the floor.
    let units = 400
    for (let i = 0; i < 50; i++) units = nextBatchUnits(units, STEP_TARGET_MS * 10, 25)
    expect(units).toBe(25)
    // And a phase is broken into no more handovers than the floor allows.
    const run = harness(1200, 0, { stepMs: 0, paintMs: STEP_TARGET_MS * 5 })
    run.runToEnd()
    const batches = run.committed.filter((c) => c.phase === 'parts').length
    expect(batches).toBeLessThanOrEqual(MAX_BATCHES_PER_PHASE + 1) // +1: the small first batch
  })

  test('a batch measured FREEZING the window goes below the count floor', () => {
    // THE test this whole change exists for, and the one that fails if the relief is taken out.
    //
    // The count floor is `phaseTotal / 8`. On 2,400 parts that is 300 per handover whatever they cost —
    // and measured on the built app, 300 device symbols on a canvas that already held 1,500 took 33.5
    // seconds in ONE batch, with the card frozen at "Placing parts — 1,354 of 2,400" for 54,267 ms and
    // the stall watchdog unable to fire because it runs on the thread the batch is blocking
    // (…/rg/mixed2400w1000.json). A floor that keeps handing over a size already measured to freeze the
    // window is the defect, not the safety net.
    //
    // Here every part costs 30 ms of paint, so a batch of 300 costs 9 seconds and a batch of 33 costs
    // just under one. The sizer must get under the floor.
    const run = harness(2400, 0, { stepMs: 0, paintPerUnitMs: 30 })
    run.runToEnd()
    const sizes = run.committed.filter((c) => c.phase === 'parts').map((c) => c.to - c.from)
    expect(minimumBatchUnits(2400)).toBe(300)
    // Batch 1 is the deliberately tiny first one and batch 2 is the floor being tried; from batch 3 on,
    // every handover is smaller than the floor allows.
    expect(Math.max(...sizes.slice(2))).toBeLessThan(minimumBatchUnits(2400))
    // …and what that buys is the thing the project lead asked for. ONE step is long enough to look like
    // a dead window — the one that measures what the floor costs, which is the price of knowing — and
    // then no more. Without the relief the sizer sits on 300 and every one of the eight is nine seconds.
    const slowSteps = run.painted().filter((p) => p.trouble?.kind === 'slow-batch')
    expect(slowSteps.length).toBe(1)
    expect(run.latest().worstStepMs).toBe(9_000)
  })

  test('the descent aims at the window, not at the batch target', () => {
    // The relief cuts to SLOW_BATCH_MS, not to STEP_TARGET_MS, and the difference is ten times the batch
    // size for nothing a person could feel. Aiming at the 100 ms target instead was measured taking 800
    // device symbols with 1,040 wires from a 10.4-second draw to 113.5
    // (…/bs/overshoot-symbol800w1040.json against …/rg/symbol800w1040.json).
    expect(reliefBatchUnits(300, 33_500)).toBe(8) // 300 parts cost 33.5 s → about 8 will cost a second
    expect(reliefBatchUnits(300, 3_000)).toBe(100)
    expect(reliefBatchUnits(300, 1_000)).toBe(300) // already at the line: nothing to cut
    expect(reliefBatchUnits(300, 900)).toBe(300) // never GROWS the batch
    expect(reliefBatchUnits(4, 1_000_000)).toBe(1) // never zero, or the draw would never finish
    expect(reliefBatchUnits(50, 0)).toBe(50) // a step of no length says nothing
  })

  test('a batch under the line is LEFT ALONE, not shrunk further', () => {
    // Once the count floor is out of the way, the ordinary halving rule would go on halving at anything
    // over 100 ms — buying nothing anybody can feel and paying a handover each time. Here every part
    // costs 30 ms, so the first 300-part batch takes 9 s and trips the relief, the relief asks for 33,
    // and 33 parts cost 990 ms. That is under the line, so it must be kept.
    const run = harness(2400, 0, { stepMs: 0, paintPerUnitMs: 30 })
    run.runToEnd()
    const sizes = run.committed.filter((c) => c.phase === 'parts').map((c) => c.to - c.from)
    const afterTheDescent = sizes.slice(2, -1)
    expect(afterTheDescent.length).toBeGreaterThan(3)
    expect(new Set(afterTheDescent)).toEqual(new Set([33])) // one size, held
    // Halving on instead would walk 33 to 16 to 8 to 4 to 2 and hand the design over two parts at a
    // time — a thousand handovers of a design that needs seventy.
    expect(sizes.length).toBeLessThan(100)
  })

  test('the settling step is several calls, each in its own turn, and every one of them runs', () => {
    // Routing every wire and solving the circuit share nothing, and run together they were the longest
    // single silence left in a big draw — 6,885 to 7,710 ms on 2,000 grouped blocks with 3,400 wires
    // (…/cg/after3-b2000w3400.json). Split, with a paint between, the worst of the same three runs is
    // 3,379 (…/cg/after4-b2000w3400.json).
    //
    // What this has to hold is that ALL of them run and NONE of them shares a turn: stopping after the
    // first would leave the wires unrouted and the circuit unsolved on a draw that reported itself done,
    // and running them together would put the split back the way it was with the code still saying it
    // had been split.
    const turnOf: number[] = []
    let turn = 0
    const clock = { ms: 0 }
    let pending: (() => void) | undefined
    const draw = new StagedDraw({
      what: 'three settling steps',
      parts: 2,
      wires: 0,
      expectedMs: 10_000,
      now: () => clock.ms,
      schedule: (run) => {
        pending = () => {
          turn += 1
          run()
        }
        return () => {
          pending = undefined
        }
      },
      commit: () => {
        clock.ms += 1
      },
      settle: [() => turnOf.push(turn), () => turnOf.push(turn), () => turnOf.push(turn)],
      onProgress: () => undefined,
    })
    draw.start()
    for (let i = 0; i < 20 && pending !== undefined; i++) pending()
    expect(turnOf.length).toBe(3)
    expect(new Set(turnOf).size).toBe(3)
  })

  test('a floor set on a measurement that has since been contradicted is dropped', () => {
    // THE freeze this round of work was about, in a harness that reproduces it. A wire costs more to draw
    // the more wires are already drawn — 2.5 ms on an empty canvas, about 20 at the far end of a
    // 3,400-wire phase — so a batch measured early costs several times as much later. The floor the
    // throughput check sets is a MEMORY of one early measurement, and it was kept for the whole phase.
    //
    // Measured on the built app before the memory was allowed to expire: the wires phase of 2,000 grouped
    // blocks with 3,400 wires pinned itself at its count floor of 425 on the phase's second and third
    // batches and then handed over 425 wires for the rest of the phase whatever they cost — the gaps
    // between card samples growing 1,115, 1,364, 1,795, 2,507, 3,742 and 8,270 ms
    // (…/cg/before-b2000w3400.json, rep 1).
    //
    // Here 3,400 items cost 0.0059 ms each per item already drawn, which is that same climb. What the
    // expiry has to buy is that no size is handed over again after it has been measured costing MORE than
    // it cost when the floor was set on it.
    const run = harness(3400, 0, { stepMs: 0, paintPerUnitPerDrawnMs: 0.0059 })
    run.runToEnd()
    const steps = run.painted().map((p) => p.worstStepMs)
    // Without the expiry the sizer sits on the pinned size and the worst batch runs to eight seconds.
    expect(Math.max(...steps)).toBeLessThan(4_000)
    // …and it does not pay for that by walking the batch down to nothing: the phase is still handed over
    // in a countable number of pieces.
    expect(run.committed.filter((c) => c.phase === 'parts').length).toBeLessThan(60)
  })

  test('shrinking that stops paying stops, or the draw never finishes', () => {
    // The other half, and the reason the floor existed at all. When the cost is paid per HANDOVER rather
    // than per item, a smaller batch costs the same and simply gets fewer items a second — so walking
    // down multiplies the handovers without shortening a single freeze. Here every batch costs 1.5 s
    // whatever its size, which is that regime exactly.
    const run = harness(2400, 0, { stepMs: 0, paintMs: 1_500 })
    run.runToEnd()
    const sizes = run.committed.filter((c) => c.phase === 'parts').map((c) => c.to - c.from)
    // It probes — one batch below the floor is what buys the evidence — and then it stops.
    expect(sizes.filter((size) => size < minimumBatchUnits(2400)).length).toBeLessThan(4)
    expect(sizes.filter((size) => size === minimumBatchUnits(2400)).length).toBeGreaterThan(3)
    expect(run.committed.filter((c) => c.phase === 'parts').length).toBeLessThan(16)
  })

  test('what "still paying" means is items a second, not a shorter step', () => {
    // A shorter step is not the test, and getting that wrong is what took a 10.4-second draw to 113.5.
    // Going from 130 items in 5,000 ms to 2 items in 300 ms IS a shorter step — and it is four times
    // fewer items a second, so the cost was in the handover and the descent has to stop.
    expect(shrinkingIsStillPaying({ units: 130, stepMs: 5_000 }, { units: 2, stepMs: 300 })).toBe(
      false,
    )
    // Cost paid per item: half the batch, half the step, the same items a second. Free, so keep going.
    expect(
      shrinkingIsStillPaying({ units: 300, stepMs: 6_000 }, { units: 150, stepMs: 3_000 }),
    ).toBe(true)
    // Cost paid per handover: half the batch, the same step. Nothing bought.
    expect(
      shrinkingIsStillPaying({ units: 300, stepMs: 6_000 }, { units: 150, stepMs: 6_000 }),
    ).toBe(false)
    // A batch that did not shrink is not evidence about shrinking either way.
    expect(shrinkingIsStillPaying({ units: 100, stepMs: 100 }, { units: 400, stepMs: 9_000 })).toBe(
      true,
    )
    expect(shrinkingIsStillPaying({ units: 0, stepMs: 0 }, { units: 0, stepMs: 0 })).toBe(true)
  })

  test('an untroubled draw is sized exactly as it was before the relief existed', () => {
    // The relief may only ever fire on evidence. A draw whose batches all come back quickly must be
    // handed over in the same sizes as before, or every small design pays for a defect it does not have.
    const quiet = harness(2400, 0, { stepMs: 0, paintMs: 30 })
    quiet.runToEnd()
    const sizes = quiet.committed.filter((c) => c.phase === 'parts').map((c) => c.to - c.from)
    expect(Math.min(...sizes.slice(1, -1))).toBeGreaterThanOrEqual(minimumBatchUnits(2400))
  })

  test('the relief starts over at each phase, because wires are not parts', () => {
    // A parts phase that had to go below its floor says nothing about wires on the canvas it left
    // behind. Here the parts are expensive and the wires are not: the wire phase must be sized from the
    // wire measurements, starting at its own floor rather than at whatever the parts phase ended on.
    const run = harness(800, 800, { stepMs: 0, paintPerUnitMs: 30, cheapPhase: 'wires' })
    run.runToEnd()
    const partSizes = run.committed.filter((c) => c.phase === 'parts').map((c) => c.to - c.from)
    const wireSizes = run.committed.filter((c) => c.phase === 'wires').map((c) => c.to - c.from)
    expect(Math.max(...partSizes.slice(2))).toBeLessThan(minimumBatchUnits(800))
    // The wires phase begins at ITS floor. Carrying the parts phase's relief across would start it at
    // the four-item first batch and grow from there, half a dozen extra handovers before it reached a
    // size nothing about wires had ever objected to.
    expect(wireSizes[0]).toBe(FIRST_BATCH_UNITS)
    expect(wireSizes[1]).toBeGreaterThanOrEqual(minimumBatchUnits(800))
  })

  test('the first batch of a phase is charged nothing for the phase change before it', () => {
    // A phase change hands the thread back so the new phase's name is painted before any work runs
    // under it, and the gap that follows is the whole parts phase being rendered, laid out and
    // painted. No batch is responsible for it. Charging it to the first WIRE batch — which is what
    // happens if the phase change forgets to forget the previous batch's start — invents a slow step
    // on a perfectly healthy draw, poisons the worst-step figure the stall message quotes, and halves
    // the first wire batch on the strength of it.
    const run = harness(8, 8, { stepMs: 10 })
    run.draw.start()
    run.runPending() // parts 0-4, at t = 1000
    run.clock.ms += 30
    run.runPending() // parts 4-8: the batch before it cost 40 ms
    run.clock.ms += 50
    run.runPending() // the phase change: the last parts batch cost 60 ms, and that is the worst
    expect(run.latest().phase).toBe('wires')
    expect(run.latest().worstStepMs).toBe(60)
    // Three seconds of painting the finished parts phase, and then the first wire batch.
    run.clock.ms += 3_000
    run.runPending()
    expect(run.latest().trouble).toBeUndefined()
    expect(run.latest().worstStepMs).toBe(60)
    // …and it is sized as a first batch, not as a batch punished for a cost it did not incur.
    const firstWireBatch = run.committed.find((c) => c.phase === 'wires') as StagedDrawChunk
    expect(firstWireBatch.to - firstWireBatch.from).toBe(FIRST_BATCH_UNITS)
  })

  test('a batch that took far too long is reported the moment the next one starts', () => {
    // The header promised this check and the first version did not have it — there was no code for it
    // anywhere in the file. It cannot fire DURING the slow batch (no thread), so the moment the next
    // batch starts is the earliest anything here can speak.
    const run = harness(400, 0, { stepMs: 0, paintMs: SLOW_BATCH_MS + 50 })
    run.draw.start()
    run.runPending()
    expect(run.latest().trouble).toBeUndefined() // nothing has been paid for yet
    run.runPending()
    expect(run.latest().trouble?.kind).toBe('slow-batch')
    expect(run.latest().trouble?.message).toContain('could not answer')
    expect(run.latest().trouble?.message).toContain('It is drawing again now')
    expect(run.latest().trouble?.message).toContain('puts the canvas back exactly as it was')
    // It must not promise the next step will be smaller: on a big design the batch is already at its
    // floor, and shrinking further is exactly what the floor exists to stop.
    expect(run.latest().trouble?.message).not.toContain('smaller')
    // …and it clears itself once the batches come back inside the threshold.
    const healthy = harness(400, 0, { stepMs: 0, paintMs: 5 })
    healthy.runToEnd()
    expect(healthy.progress.filter((p) => p.trouble !== undefined)).toEqual([])
  })

  test('the one step that cannot be counted is also the one that cannot be reported slow', () => {
    // A LIMITATION, written down because "no trouble message" reads as "no step was slow" and on a big
    // design that is not what it means. Measured on the built app: three runs of 2,500 blocks / 1,000
    // wires printed no trouble at all, and the longest single task in one of them was 1,275 ms — over
    // the slow-batch threshold. The card's own samples in the same artifact show no gap between two
    // batches over 926 ms, so that task is the settling step (…/rg/block2500w1000.json).
    //
    // It cannot be otherwise here: the draw is finished the moment settling returns, and a batch's cost
    // is only knowable when the NEXT one starts. There is no next one. What the card can honestly do is
    // what it does — name the step, and say it cannot report how far along it is.
    const clock = { ms: 0 }
    const progress: StagedDrawProgress[] = []
    let pending: (() => void) | undefined
    const draw = new StagedDraw({
      what: 'a saved project',
      parts: 4,
      wires: 0,
      expectedMs: 60_000,
      now: () => clock.ms,
      schedule: (run) => {
        pending = run
        return () => {
          pending = undefined
        }
      },
      commit: () => {
        clock.ms += 5
      },
      settle: [
        () => {
          clock.ms += 3_000 // routing, measuring and solving the whole design, in one call
        },
      ],
      onProgress: (p) => progress.push(p),
    })
    draw.start()
    for (let i = 0; i < 12 && progress[progress.length - 1]?.done !== true; i++) pending?.()
    const settling = progress.filter((p) => p.phase === 'settling')
    expect(settling.length).toBeGreaterThan(0)
    expect(settling[0]?.determinate).toBe(false)
    expect(stagedDrawFraction(settling[0] as StagedDrawProgress)).toBeUndefined()
    // Three seconds of window silence, and nothing said about it. This is the honest state of it.
    const last = progress[progress.length - 1] as StagedDrawProgress
    expect(last.done).toBe(true)
    expect(last.elapsedMs).toBeGreaterThanOrEqual(3_000)
    expect(progress.filter((p) => p.trouble?.kind === 'slow-batch')).toEqual([])
  })

  test('the bar is seen reaching the total it counts towards, not stopping short of it', () => {
    // EMITTING the full count is not showing it. The previous fix emitted "Placing parts — 300 of
    // 300" and then flipped the phase and emitted again in the SAME turn; React renders once per
    // turn, so the screen only ever got the second one. Measured on the built app afterwards, the
    // highest count the card was seen showing on a 1,000-part phase was 942
    // (…/repair/t2/before-block1000.json, card samples). So the assertion is on what is PAINTED —
    // the last update of each scheduler turn — and not on what was merely said.
    const run = harness(20, 10)
    run.runToEnd()
    const painted = run.painted()
    expect(
      painted.filter((p) => p.phase === 'parts' && p.phaseDone === p.phaseTotal).length,
    ).toBeGreaterThan(0)
    const wiresFull = painted.filter((p) => p.phase === 'wires' && p.phaseDone === p.phaseTotal)
    expect(wiresFull.length).toBeGreaterThan(0)
    expect(stagedDrawFraction(wiresFull[0] as StagedDrawProgress)).toBe(1)
    // The step that cannot report a fraction is NAMED before it runs, not after: it is one
    // uninterruptible call, and a card that only says "Routing wires and simulating" once the routing
    // is over has said it to nobody.
    const settlingPainted = painted.findIndex((p) => p.phase === 'settling')
    expect(settlingPainted).toBeGreaterThan(-1)
    expect(painted[settlingPainted]?.done).toBe(false)
  })

  test('a draw that stops moving is NOTICED, and says what it was doing when it stopped', () => {
    const run = harness(100, 0)
    run.draw.start()
    run.runPending()
    expect(run.latest().trouble).toBeUndefined()
    // The scheduler never calls back — the case a spinner sits through for ever. The thread is free,
    // so the watchdog's pulse is what finds it.
    run.clock.ms += STALL_MS - 1
    run.draw.tick()
    expect(run.latest().trouble).toBeUndefined()
    run.clock.ms += 2
    run.draw.tick()
    expect(run.latest().trouble?.kind).toBe('stalled')
    expect(run.latest().trouble?.message).toContain('Placing parts')
    expect(run.latest().trouble?.message).toContain('made no progress')
    // It must also say the user's work is safe, because the alternative reading is that it ate it —
    // and it must say the TRUE thing about Stop, which restores rather than keeping what is drawn.
    expect(run.latest().trouble?.message).toContain('Nothing you had is lost')
    // No message anywhere in this file may go on saying what Stop used to do. Every one of the three
    // said "Stop leaves it as it is" / "Stop leaves what has been drawn on the canvas", and a Stop now
    // puts the canvas back — a warning that lies about the button beside it is worse than no warning.
    const staging = readFileSync(
      new URL('../src/renderer/canvas-draw-staging.ts', import.meta.url),
      'utf8',
    )
    expect(staging).not.toContain('Stop leaves')
    expect(run.latest().trouble?.message).toContain('puts the canvas back exactly as it was')
  })

  test('a draw far past the estimate it was admitted under says so, and keeps going', () => {
    // Progress keeps moving throughout, so the stall check cannot fire and this is the other one.
    const run = harness(600, 0, { stepMs: 60, expectedMs: 100 })
    run.draw.start()
    for (let i = 0; i < 40; i++) {
      run.clock.ms += 20
      run.runPending()
    }
    const overrun = run.progress.filter((p) => p.trouble?.kind === 'over-estimate')
    expect(overrun.length).toBeGreaterThan(0)
    expect(overrun[0]?.trouble?.message).toContain(`${OVER_ESTIMATE_FACTOR} times the`)
    expect(overrun[0]?.trouble?.message).toContain('puts the canvas back exactly as it was')
    // It warns and keeps going: the draw was still un-finished and still moving when it first said so,
    // and it went on to finish. A check that stopped the draw would cost the user the design.
    expect(overrun[0]?.done).toBe(false)
    expect(overrun[0]?.unitsDone).toBeGreaterThan(0)
    expect(run.latest().done).toBe(true)
  })

  test('an ordinary placement never trips either check', () => {
    // The calculator, against the estimate the SHIPPED model gives it. 2,749 ms is what this test used
    // to hard-code as "its own estimate", and that figure came from the model before last: 180 ms floor,
    // one curve over a weighted part count. The calculator is 89 device symbols, 30 grouped blocks and
    // 241 wires, and the model that ships reads it at 1,198 ms — so the margin this test was pretending
    // to check was 2.3x bigger than the real one. It is computed here rather than typed, so it cannot go
    // stale again.
    const calculator = { parts: 119, symbolParts: 89, blockParts: 30, wires: 241 }
    const expectedMs = estimateDrawCostMs(calculator)
    expect(Math.round(expectedMs)).toBe(1198)
    const run = harness(119, 241, { stepMs: 24, expectedMs })
    run.runToEnd()
    expect(run.progress.filter((p) => p.trouble !== undefined)).toEqual([])
    expect(run.latest().done).toBe(true)
    expect(run.latest().elapsedMs).toBeLessThan(expectedMs * OVER_ESTIMATE_FACTOR)
  })

  test('the over-estimate factor clears the model’s own worst under-prediction', () => {
    // What OVER_ESTIMATE_FACTOR is set from, recomputed rather than remembered, and OVER EVERY DESIGN
    // EVER MEASURED DRAWING rather than over the fit set alone — which is how the figure it was derived
    // from came to be wrong. Against MEASURED_DESIGNS the worst under-prediction is 1.838x. Against a
    // design the model was never fitted to it was worse: 8,000 grouped blocks with 2,000 wires estimated
    // 46,388 ms and drew for 96,213 on the bundle of the day, 2.074x (…/bs/atk-s0b8000w2000.json). A
    // factor of 5 is not 2.5x clear of 2.074, so the margin this test asserts was FALSE the whole time
    // the boundary went unmeasured.
    const fitSetWorst = Math.max(
      ...MEASURED_DESIGNS.map((m) => worstOf(m) / estimateDrawCostMs(sizeOf(m))),
    )
    expect(fitSetWorst).toBeCloseTo(1.838, 2)
    const boundaryNow = Math.max(
      ...BOUNDARY_DESIGNS.map(
        (m) => Math.max(...m.wholeDrawMs) / estimateDrawCostMs(boundarySizeOf(m)),
      ),
    )
    const boundaryBefore = Math.max(
      ...BOUNDARY_DESIGNS.map(
        (m) => Math.max(...m.beforeMs.wholeDraw) / estimateDrawCostMs(boundarySizeOf(m)),
      ),
    )
    expect(boundaryNow).toBeCloseTo(1.518, 2)
    expect(boundaryBefore).toBeCloseTo(2.074, 2)
    // The factor answers to the worst of all three, including the one measured on a bundle that no
    // longer ships — a healthy draw the app once really did must not be able to trip the warning.
    const worstUnderPrediction = Math.max(fitSetWorst, boundaryNow, boundaryBefore)
    expect(OVER_ESTIMATE_FACTOR).toBeGreaterThan(worstUnderPrediction * 2.5)
  })

  test('the boundary designs are measured, and the model answers for them too', () => {
    // The fifth defect: every ratio this file checked was a ratio against the model's own training data.
    // These SEVEN are not in either fit table, and the model reads them from 0.66 to 4.12 of what they
    // really take — far outside the 0.544-to-2.765 band asserted of the fit set.
    const ratios = BOUNDARY_DESIGNS.map((m) => ({
      design: namedBoundary(m),
      ratio: estimateDrawCostMs(boundarySizeOf(m)) / Math.max(...m.wholeDrawMs),
    }))
    expect(Math.min(...ratios.map((r) => r.ratio))).toBeCloseTo(0.659, 2)
    expect(Math.max(...ratios.map((r) => r.ratio))).toBeCloseTo(4.12, 1)
    // WHICH WAY IT IS WRONG MATTERS. Five of the seven are OVER-charged now, because the draw got faster
    // and the model did not: it is refusing headroom it no longer needs. TWO are under-charged — the
    // 8,000-block design at 0.659, which is the one that breaches the app's own "waits 60 seconds at
    // most" (see the next test), and the pitch-20 row at 0.785, which the model cannot tell from its
    // pitch-160 twin at all. Both counts are asserted, because prose above a single assertion is how
    // this passage came to say "six" and "one" over a table of seven holding five and two.
    expect(ratios.filter((r) => r.ratio > 1).length).toBe(5)
    expect(ratios.filter((r) => r.ratio < 1).length).toBe(2)
    expect(ratios.length).toBe(7)
    // AND THE SENTENCE THE USER READS SAYS THE SAME BAND. The seventh defect was this passage being
    // re-fitted to 0.659-to-4.120 while the refusal card went on telling the user the estimate lands
    // "between half and three times" what a design really takes — a number the tree's own data
    // contradicted, in the one place a user would ever see it. The card is built from these two
    // constants, so a re-measurement that moves the band and not the card fails here.
    expect(DRAW_ESTIMATE_READS_LOW_BY).toBeCloseTo(Math.min(...ratios.map((r) => r.ratio)), 2)
    expect(DRAW_ESTIMATE_READS_HIGH_BY).toBeCloseTo(Math.max(...ratios.map((r) => r.ratio)), 1)
    const card = tooBigToDrawReason({
      parts: 50_000,
      symbolParts: 0,
      blockParts: 50_000,
      wires: 50_000,
    })
    expect(card).toBeDefined()
    expect(card).toContain(
      `between ${DRAW_ESTIMATE_READS_LOW_BY} and ${DRAW_ESTIMATE_READS_HIGH_BY}`,
    )
    expect(card).not.toContain('between half and three times')
  })

  test('one admitted design still draws for longer than the app says it waits, and it is named', () => {
    // 8,000 grouped blocks with 2,000 wires. Admitted on BOTH bounds — estimate 46,388 ms against the
    // 60-second wait ceiling, silence estimate 6,693 against the line the app refuses at — and measured
    // drawing for 96,213 ms on the bundle before this work and 70,425 after it
    // (…/bs/atk-s0b8000w2000.json, …/cg/after4-b8000w2000.json). It is 30 % faster and STILL over the
    // minute the refusal card promises. This is a defect written down, not a defect fixed: the honest
    // repairs are re-fitting the whole-draw model to designs outside its fit set, or lowering the
    // ceiling, and neither is done here.
    const over = BOUNDARY_DESIGNS.filter((m) => Math.max(...m.wholeDrawMs) > MAX_DRAW_WAIT_MS)
    expect(over.map(namedBoundary)).toEqual(['0s+8000b/2000w'])
    for (const m of over) {
      expect({
        design: namedBoundary(m),
        admitted: tooBigToDrawReason(boundarySizeOf(m)) === undefined,
      }).toEqual({ design: namedBoundary(m), admitted: true })
    }
  })

  test('the designs the app admits at its boundary, and how long each still goes quiet for', () => {
    // THE requirement, on the designs it is actually about: "so loading long is fine just make sure its
    // not just stuck". Six of the seven probed at the boundary used to breach the five seconds the card
    // promises — 9,603 / 9,255 / 9,073 / 8,588 / 8,547 / 5,033 ms (…/bs/atk-admitted-residuals.json).
    // Re-measured on this bundle: every run of six of the seven is under it, and ONE IS NOT. It is
    // named rather than averaged away.
    const stillOver = BOUNDARY_DESIGNS.filter((m) => Math.max(...m.silenceMs) >= MAX_SILENCE_MS)
    expect(stillOver.map(namedBoundary)).toEqual(['0s+2000b/3400w (pitch 20)'])
    expect(Math.max(...(stillOver[0] as BoundaryDesign).silenceMs)).toBe(5891)
    // Every one of them got quieter, and every design whose worst silence is still over the line is one
    // whose parts are laid on top of each other — the wire router's cost, not the batch sizer's.
    for (const m of BOUNDARY_DESIGNS) {
      expect({
        design: namedBoundary(m),
        quieterThanBefore: Math.max(...m.silenceMs) < Math.max(...m.beforeMs.silence),
      }).toEqual({ design: namedBoundary(m), quieterThanBefore: true })
    }
    // …and it is not a wash traded against a longer wait. Every one of the seven got FASTER as well as
    // quieter, which is the part worth saying out loud: a smaller batch would have bought the window at
    // the draw's expense, and the work taken out was work nobody wanted done.
    for (const m of BOUNDARY_DESIGNS) {
      expect({
        design: namedBoundary(m),
        fasterThanBefore: Math.max(...m.wholeDrawMs) < Math.max(...m.beforeMs.wholeDraw),
      }).toEqual({ design: namedBoundary(m), fasterThanBefore: true })
    }
  })

  test('stopping stops, and everything already drawn stays drawn', () => {
    const run = harness(100, 50)
    run.draw.start()
    run.runPending()
    run.runPending()
    const drawnBefore = run.committed.length
    run.draw.cancel()
    run.runPending()
    expect(run.committed.length).toBe(drawnBefore)
    expect(run.state.settled).toBe(0)
    expect(run.latest().cancelled).toBe(true)
    expect(run.latest().done).toBe(false)
    expect(run.latest().unitsDone).toBeGreaterThan(0) // what was drawn is still counted as drawn
  })

  test('the batch times measured on the built app are what the stall threshold is set from', () => {
    // Five cold runs of each of the three demos on the BUILT app, plus the two functional checks. The
    // number that matters here is the LONGEST the thread was busy in one stretch, because that is what
    // a stall threshold has to clear: set it under this and the warning fires during ordinary drawing.
    const MEASURED_STAGED = [
      {
        what: 'calculator',
        wasMs: 8812,
        nowMs: 610,
        artifact: `${APPL}/staged-r1..r5.json + staged-final-r1..r3.json`,
      },
      {
        what: 'verilog cpu demo',
        wasMs: 676,
        nowMs: 283,
        artifact: `${APPL}/staged-r1..r5.json + staged-final-r1..r3.json`,
      },
      {
        what: '8-bit verilog cpu',
        wasMs: 1071,
        nowMs: 238,
        artifact: `${APPL}/staged-r1..r5.json + staged-final-r1..r3.json`,
      },
      // Three more cold runs of the same three, measured afterwards with a harness written from scratch
      // for the audit. The calculator's worst here is above all eight runs above, which is why the ratio
      // asserted at the end of this test is four and not five.
      {
        what: 'calculator, audited again',
        wasMs: 8812,
        nowMs: 1023,
        artifact: `${APPL}/audit-three.json`,
      },
      // And once more on the bundle these tests are shipping with, after the stage-on-mount fix — the
      // point being that the fix changed which SMALL designs stage, and left these three alone.
      {
        what: 'calculator, after the stage-on-mount fix',
        wasMs: 8812,
        nowMs: 929,
        artifact: `${APPL}/audit-after.json`,
      },
      {
        what: 'verilog cpu demo, after the stage-on-mount fix',
        wasMs: 676,
        nowMs: 222,
        artifact: `${APPL}/audit-after.json`,
      },
      {
        what: '8-bit verilog cpu, after the stage-on-mount fix',
        wasMs: 1071,
        nowMs: 263,
        artifact: `${APPL}/audit-after.json`,
      },
      {
        what: 'verilog cpu demo, audited again',
        wasMs: 676,
        nowMs: 181,
        artifact: `${APPL}/audit-three.json`,
      },
      {
        what: '8-bit verilog cpu, audited again',
        wasMs: 1071,
        nowMs: 236,
        artifact: `${APPL}/audit-three.json`,
      },
      {
        what: 'calculator, then a key pressed',
        wasMs: 8812,
        nowMs: 751,
        artifact: `${APPL}/verify-staged.json`,
      },
      {
        what: 'calculator, stopped 2.7 s in',
        wasMs: 8812,
        nowMs: 113,
        artifact: `${APPL}/verify-staged.json`,
      },
      {
        what: 'a saved 200-part / 262-wire project, opened from the launcher',
        wasMs: 10338,
        nowMs: 673,
        artifact: `${APPL}/file-door.json`,
      },
    ]
    for (const m of MEASURED_STAGED) {
      expect({ ...m, quieterThanTheStallCheck: m.nowMs < STALL_MS }).toEqual({
        ...m,
        quieterThanTheStallCheck: true,
      })
      // …and every one of them is a fraction of what the same placement used to cost.
      expect({ ...m, better: m.nowMs < m.wasMs / 2 }).toEqual({ ...m, better: true })
    }
    // Four, not five. The worst window silence ever recorded during a staged draw is 1,023 ms, and
    // 5,000 is 4.9x that — so the earlier x5 assertion could only stay true by never measuring again.
    // What the check really watches, the gap since a batch RETURNED, has a worst of 500 ms and is
    // cleared ten times over; the figure asserted here is the cruder upper bound on purpose.
    expect(STALL_MS).toBeGreaterThan(Math.max(...MEASURED_STAGED.map((m) => m.nowMs)) * 4)
  })

  test('Stop calls OFF the frame that is already booked — the first line of defence', () => {
    // MUTATION-TESTED, and this is the test that catches it: deleting `this.cancelPending?.()` from
    // `StagedDraw.cancel` left the whole suite green, because the only test covering that path used a
    // scheduler that cannot be called off and so could only ever exercise the SECOND line of defence
    // (the next test). Both matter and they are not the same. The second stops the batch from drawing;
    // the first stops the browser from ever running it, which is what keeps a frame from being scheduled,
    // woken and thrown away on a canvas the user has just been handed back.
    const clock = { ms: 0 }
    const cancelled: string[] = []
    let pending: (() => void) | undefined
    const draw = new StagedDraw({
      what: 'a big saved project',
      parts: 400,
      wires: 100,
      expectedMs: 1000,
      now: () => clock.ms,
      schedule: (run) => {
        pending = run
        return () => {
          cancelled.push('the booked frame')
          pending = undefined
        }
      },
      commit: () => {
        clock.ms += 5
      },
      settle: [() => undefined],
      onProgress: () => undefined,
    })
    draw.start()
    pending?.() // one batch runs and books the next frame
    expect(pending).toBeDefined()
    draw.cancel()
    expect(cancelled).toEqual(['the booked frame'])
    expect(pending).toBeUndefined()
  })

  test('a cancelled draw commits nothing more, even if its scheduler fires anyway', () => {
    // Cancelling the pending callback is the first line of defence — the test above. Refusing to act on
    // one that arrives regardless is the second, and this is that one. Without it, a batch already in
    // flight when Stop is pressed carries on drawing into a canvas the user has just been told is
    // theirs again.
    const clock = { ms: 0 }
    const committed: StagedDrawChunk[] = []
    let pending: (() => void) | undefined
    const draw = new StagedDraw({
      what: 'the calculator',
      parts: 40,
      wires: 10,
      expectedMs: 1000,
      now: () => clock.ms,
      schedule: (run) => {
        pending = run
        return () => undefined // a scheduler that cannot be called off
      },
      commit: (chunk) => {
        committed.push(chunk)
        clock.ms += 5
      },
      settle: [
        () => {
          committed.push({ phase: 'settling', from: 0, to: 0 })
        },
      ],
      onProgress: () => undefined,
    })
    draw.start()
    pending?.()
    const drawnBefore = committed.length
    draw.cancel()
    pending?.()
    pending?.()
    expect(committed.length).toBe(drawnBefore)
  })

  test('a design with no wires at all still finishes', () => {
    const run = harness(3, 0)
    run.runToEnd()
    expect(run.state.settled).toBe(1)
    expect(run.latest().done).toBe(true)
  })
})

/**
 * The settling steps the APP actually hands the draw — not a set built by a test.
 *
 * WHY THIS EXISTS SEPARATELY from the settling test further up this file. That one builds its own
 * `StagedDraw` around a synthetic three-element array, so it proves the draw runs whatever it is given,
 * one per turn — and nothing whatever about what the app gives it. With the split written inline at the
 * call site, cutting the app's list to `[() => setAutoRouteWires(true)]`, or collapsing all three into a
 * single entry, left the whole suite green. The list is built by `stagedDrawSettleSteps` for that reason,
 * and these are the tests that now fail for both of those changes.
 *
 * What is at stake: dropping the solve leaves a draw that reported itself finished showing a circuit that
 * was never solved, and collapsing the entries puts back the longest silence in a big draw — 6,885 to
 * 7,710 ms on 2,000 grouped blocks with 3,400 wires (…/cg/after3-b2000w3400.json) — with the code still
 * saying it had been split.
 */
describe('what the app hands the draw to settle with', () => {
  function recordingWork() {
    const ran: string[] = []
    return {
      ran,
      work: {
        enableAutoRoute: () => ran.push('auto-route'),
        reSolve: () => ran.push('solve'),
        afterwards: () => ran.push('afterwards'),
      },
    }
  }

  test('there are THREE steps, so the draw can put a paint between them', () => {
    // Fails for collapsing the three into one entry, which is the change that looks harmless and undoes
    // the whole split while every other test in this file stays green.
    expect(stagedDrawSettleSteps(recordingWork().work).length).toBe(3)
  })

  test('each step does exactly ONE of the three pieces of work', () => {
    // Fails for any entry that bundles two of them together: an entry that did both the routing and the
    // solve would run them in one turn, which is what the split exists to stop.
    const { ran, work } = recordingWork()
    const steps = stagedDrawSettleSteps(work)
    const perStep = steps.map((step) => {
      ran.length = 0
      step()
      return [...ran]
    })
    expect(perStep).toEqual([['auto-route'], ['solve'], ['afterwards']])
  })

  test('running all of them does every piece of work, once, in order', () => {
    // Fails for dropping a step — the truncation that leaves the wires unrouted or the circuit unsolved
    // on a draw that has told the user it finished.
    const { ran, work } = recordingWork()
    for (const step of stagedDrawSettleSteps(work)) step()
    expect(ran).toEqual(['auto-route', 'solve', 'afterwards'])
  })

  test('a draw with nothing to do afterwards still has three steps, and none of them throws', () => {
    // The optional hook is still a step: making it conditional would give the draw a list whose length
    // depends on the caller, and the step that does the solve would move.
    const ran: string[] = []
    const steps = stagedDrawSettleSteps({
      enableAutoRoute: () => ran.push('auto-route'),
      reSolve: () => ran.push('solve'),
      afterwards: undefined,
    })
    expect(steps.length).toBe(3)
    for (const step of steps) step()
    expect(ran).toEqual(['auto-route', 'solve'])
  })
})

/**
 * The two promises the app makes, against designs it ADMITS — and how badly the measurement itself behaves.
 *
 * The card tells the user two things: this app waits at most MAX_DRAW_WAIT_MS, and it aims to keep any one
 * dead stretch under MAX_SILENCE_MS. `BOUNDARY_DESIGNS` names ONE design that breaks the first, pinned by
 * exact equality, which reads as "one design is over, and here it is". It is not one design. Every one of
 * these was admitted by `tooBigToDrawReason` and measured over the ceiling, and they are neighbours of each
 * other in size, so what is over the line is a REGION of the high-block frontier and not a point on it.
 *
 * ALL FIGURES ARE FROM THE ARTIFACT NAMED BESIDE THEM: built app, launcher ▸ My Projects door, 100 ms
 * in-page heartbeat plus PerformanceObserver(longtask), a fresh Electron per rep, every rep kept.
 *
 * THE PITCH ON EACH ROW IS DERIVED, NOT READ. Only the …/qs artifacts carry a `pitch` field; the …/cg
 * harness never wrote one. What every artifact does carry is the PATH of the design file it opened, and
 * the pitch is the spacing of the part coordinates in that file — checked that way for all six rows here
 * and in `LAYOUT_FAMILY`, which is why they can be labelled at all. Worth knowing before another row is
 * added from a …/cg run: the pitch has to be read out of the design, not assumed from the harness default.
 */
const OVER_CEILING_DESIGNS = [
  {
    what: '9,000 grouped blocks / 2,000 wires',
    size: { parts: 9000, symbolParts: 0, blockParts: 9000, wires: 2000 },
    pitch: 160,
    wholeDrawMs: [64235, 92876, 177493, 230095],
    artifact: '…/qs/after-b9000w2000.json, after2-b9000w2000.json, after3-b9000w2000.json',
  },
  {
    what: '10,000 grouped blocks / 1,000 wires',
    size: { parts: 10000, symbolParts: 0, blockParts: 10000, wires: 1000 },
    pitch: 160,
    wholeDrawMs: [77511],
    artifact: '…/cg/av-av-b10000w1000.json',
  },
  {
    what: '8,000 grouped blocks / 2,400 wires',
    size: { parts: 8000, symbolParts: 0, blockParts: 8000, wires: 2400 },
    pitch: 160,
    wholeDrawMs: [78870],
    artifact: '…/cg/av-av-b8000w2400.json',
  },
]

describe('the sixty-second promise is broken by a region, not by one design', () => {
  test('every one of them is ADMITTED, and every one of them draws for longer than the promise', () => {
    // The defect stated plainly. It is written down rather than fixed: the honest repairs are re-fitting
    // the whole-draw model to designs outside its fit set or lowering the ceiling, and this does neither.
    for (const design of OVER_CEILING_DESIGNS) {
      expect({
        what: design.what,
        admitted: tooBigToDrawReason(design.size) === undefined,
        slowestRunOverCeiling: Math.max(...design.wholeDrawMs) > MAX_DRAW_WAIT_MS,
      }).toEqual({ what: design.what, admitted: true, slowestRunOverCeiling: true })
    }
  })

  test('the model under-reads EVERY one of them, so this is not one design the fit happened to miss', () => {
    for (const design of OVER_CEILING_DESIGNS) {
      const ratio = estimateDrawCostMs(design.size) / Math.max(...design.wholeDrawMs)
      expect({ what: design.what, underReads: ratio < 1 }).toEqual({
        what: design.what,
        underReads: true,
      })
    }
  })

  test('they are NEIGHBOURS in size, which is what makes them a region', () => {
    // 8,000 / 9,000 / 10,000 parts with 1,000 to 2,400 wires. A table that names only the 8,000-block
    // design invites the reading that its neighbours are fine, and they are not.
    const parts = OVER_CEILING_DESIGNS.map((d) => d.size.parts).sort((a, b) => a - b)
    expect(parts).toEqual([8000, 9000, 10000])
    expect(BOUNDARY_DESIGNS.some((m) => m.blockParts === 9000 || m.blockParts === 10000)).toBe(
      false,
    )
  })
})

/**
 * Layout is a variable the tables do not carry, and it is worth more than the counts.
 *
 * Every table in this file is keyed on (parts, wires). These are the SAME counts at different grid
 * pitches, measured the same way, and they disagree by more than the difference between designs the
 * tables treat as far apart. A (parts, wires) row therefore cannot describe what a design costs — which
 * is stated in `BOUNDARY_DESIGNS` for one pair and is true across the board.
 */
const LAYOUT_FAMILY = [
  {
    what: '2,000 grouped blocks / 3,400 wires',
    size: { parts: 2000, symbolParts: 0, blockParts: 2000, wires: 3400 },
    byPitch: [
      { pitch: 160, worstSilenceMs: 3379, artifact: '…/cg/after4-b2000w3400.json' },
      { pitch: 20, worstSilenceMs: 5891, artifact: '…/cg/after4-b2000w3400tight.json' },
      { pitch: 10, worstSilenceMs: 7751, artifact: '…/cg/av-av-b2000w3400p10.json' },
    ],
  },
  {
    what: '300 grouped blocks / 3,570 wires',
    size: { parts: 300, symbolParts: 0, blockParts: 300, wires: 3570 },
    byPitch: [
      { pitch: 160, worstSilenceMs: 2285, artifact: '…/cg/after4-b300w3570.json' },
      { pitch: 20, worstSilenceMs: 6427, artifact: '…/cg/av-av-b300w3570p20.json' },
      { pitch: 8, worstSilenceMs: 7437, artifact: '…/cg/av-av-b300w3570p8.json' },
    ],
  },
]

describe('the same design, laid out differently, is a different cost', () => {
  test('tightening the pitch makes the window go quiet for longer, on both families', () => {
    for (const family of LAYOUT_FAMILY) {
      const loosest = family.byPitch[0]
      const tightest = family.byPitch[family.byPitch.length - 1]
      expect({
        what: family.what,
        tighterIsWorse: (tightest?.worstSilenceMs ?? 0) > (loosest?.worstSilenceMs ?? 0),
      }).toEqual({ what: family.what, tighterIsWorse: true })
    }
  })

  test('the estimate cannot tell them apart at all, because it never sees the layout', () => {
    // Not a criticism the model can answer as written — it takes counts and nothing else. It is recorded
    // so that the next person to widen a tolerance to make a layout fit knows what they are hiding.
    for (const family of LAYOUT_FAMILY) {
      const silences = family.byPitch.map((p) => p.worstSilenceMs)
      expect(Math.max(...silences) / Math.min(...silences)).toBeGreaterThan(1.7)
      expect(new Set(family.byPitch.map(() => estimateWorstSilenceMs(family.size))).size).toBe(1)
    }
  })

  test('the worst silence on the bundle these rows were measured on is 7,751 ms, and it is a LAYOUT', () => {
    // `BOUNDARY_DESIGNS` pins 5,891 ms as its worst, from the pitch-20 row. The pitch-10 layout of the
    // same counts is 32 % worse again, and the 300-block design at pitch 8 measured 7,437 ms against a
    // table entry of 2,285 ms for the same counts.
    //
    // NOT "the worst ever measured", which is what this test used to be called. Every row above is from
    // the …/cg bundle, and the one that ships now is faster; searching the SAME variable on the current
    // bundle found a worse one, and `TIGHT_LAYOUT_NOW` below holds it.
    const worst = Math.max(...LAYOUT_FAMILY.flatMap((f) => f.byPitch.map((p) => p.worstSilenceMs)))
    expect(worst).toBe(7751)
    expect(worst).toBeGreaterThan(Math.max(...BOUNDARY_DESIGNS.flatMap((m) => m.silenceMs)))
  })
})

/**
 * The same variable, searched again on the bundle that ships NOW — and it goes further than the tables say.
 *
 * Every figure in `LAYOUT_FAMILY` and `OVER_CEILING_DESIGNS` was measured on the …/cg bundle, before the
 * label-layer lookup came out of the draw. This bundle is faster on the designs those tables name — the
 * 2,000-block / 3,400-wire design at pitch 10 measured 7,751 ms of silence there and 2,287 ms here — so a
 * search for the worst case had to be run again rather than inherited. It was, over both pitch and counts,
 * one rep per point and the tightest pitches carried further than any table had gone.
 *
 * TWO THINGS THE TABLES ABOVE GET WRONG, both about which designs are at risk rather than by how much:
 *
 *  - The worst silence is NOT on the biggest design and not at the tightest pitch. 300 parts at pitch 2 is
 *    the worst point found anywhere, and pitch 1 — tighter still — is better than pitch 2 by 3.2 seconds.
 *    A monotone "tighter is worse" rule, which is what the test above checks, does not survive the sweep.
 *  - `OVER_CEILING_DESIGNS` calls the sixty-second breach a high-block frontier and names 8,000 to 10,000
 *    parts. This design has THREE HUNDRED parts and one of its three runs drew for 70,110 ms. What breaches
 *    the promise is the layout, and a table keyed on counts cannot see it coming.
 *
 * ALL FIGURES ARE FROM THE ARTIFACT NAMED BESIDE THEM: built app (index-DJKNvHY_.js), launcher ▸ My
 * Projects door, 100 ms in-page heartbeat plus PerformanceObserver(longtask), a fresh Electron per rep,
 * every rep kept, and the pitch recorded in the artifact itself.
 */
const QS = 'AppData/Local/Temp/claude/qs'

const TIGHT_LAYOUT_NOW = [
  {
    what: '300 grouped blocks / 3,570 wires',
    size: { parts: 300, symbolParts: 0, blockParts: 300, wires: 3570 },
    byPitch: [
      {
        pitch: 8,
        silenceMs: [1534],
        wholeDrawMs: [12717],
        artifact: `${QS}/vfy-silence-s0b300w3570p8.json`,
      },
      {
        pitch: 4,
        silenceMs: [4433],
        wholeDrawMs: [17067],
        artifact: `${QS}/vfy-silence-s0b300w3570p4.json`,
      },
      {
        pitch: 2,
        silenceMs: [8205, 8206, 8457],
        wholeDrawMs: [58896, 58146, 70110],
        artifact: `${QS}/vfy-silence-s0b300w3570p2.json + ${QS}/vfy-silence-b300w3570p2-reps23.json`,
      },
      {
        pitch: 1,
        silenceMs: [5224],
        wholeDrawMs: [25827],
        artifact: `${QS}/vfy-silence-s0b300w3570p1.json`,
      },
    ],
  },
  {
    what: '2,000 grouped blocks / 3,400 wires',
    size: { parts: 2000, symbolParts: 0, blockParts: 2000, wires: 3400 },
    byPitch: [
      {
        pitch: 10,
        silenceMs: [2287],
        wholeDrawMs: [11952],
        artifact: `${QS}/vfy-silence-s0b2000w3400p10.json`,
      },
      {
        pitch: 4,
        silenceMs: [2403],
        wholeDrawMs: [12157],
        artifact: `${QS}/vfy-silence-s0b2000w3400p4.json`,
      },
      {
        pitch: 2,
        silenceMs: [2371],
        wholeDrawMs: [54451],
        artifact: `${QS}/vfy-silence-s0b2000w3400p2.json`,
      },
    ],
  },
  {
    what: '600 device symbols / 3,300 wires',
    size: { parts: 600, symbolParts: 600, blockParts: 0, wires: 3300 },
    byPitch: [
      {
        pitch: 8,
        silenceMs: [2111],
        wholeDrawMs: [17054],
        artifact: `${QS}/vfy-silence-s600b0w3300p8.json`,
      },
      {
        pitch: 4,
        silenceMs: [2982],
        wholeDrawMs: [34290],
        artifact: `${QS}/vfy-silence-s600b0w3300p4.json`,
      },
    ],
  },
]

const tightestPoints = TIGHT_LAYOUT_NOW.flatMap((family) =>
  family.byPitch.map((point) => ({ family, point })),
)

describe('the worst silence on the bundle that ships now, hunted over pitch as well as counts', () => {
  test('every design in the sweep is one the app ADMITS, so none of this is about a refusal', () => {
    for (const { family, point } of tightestPoints) {
      expect({
        what: `${family.what} at pitch ${point.pitch}`,
        admitted: tooBigToDrawReason(family.size) === undefined,
      }).toEqual({ what: `${family.what} at pitch ${point.pitch}`, admitted: true })
    }
  })

  test('the worst silence found is 8,457 ms, on a THREE HUNDRED part design', () => {
    // Worse than the 7,751 ms the table above calls its worst, on a bundle that is otherwise faster, and
    // on a design two orders of magnitude smaller than the ones OVER_CEILING_DESIGNS names.
    const worstPoint = tightestPoints.reduce((worst, candidate) =>
      Math.max(...candidate.point.silenceMs) > Math.max(...worst.point.silenceMs)
        ? candidate
        : worst,
    )
    expect(Math.max(...worstPoint.point.silenceMs)).toBe(8457)
    expect(worstPoint.family.size.parts).toBe(300)
    expect(worstPoint.point.pitch).toBe(2)
    expect(Math.max(...worstPoint.point.silenceMs)).toBeGreaterThan(
      Math.max(...LAYOUT_FAMILY.flatMap((f) => f.byPitch.map((p) => p.worstSilenceMs))),
    )
  })

  test('tighter is not simply worse: pitch 1 is three seconds quieter than pitch 2', () => {
    // The rule the older table asserts — loosest row against tightest row — happens to hold there and is
    // not a rule. Anyone tuning against pitch should know the curve turns over.
    const family = TIGHT_LAYOUT_NOW[0] as (typeof TIGHT_LAYOUT_NOW)[0]
    const at = (pitch: number) =>
      Math.max(...(family.byPitch.find((p) => p.pitch === pitch)?.silenceMs ?? [0]))
    expect(at(2)).toBeGreaterThan(at(1))
    expect(at(2) - at(1)).toBeGreaterThan(3000)
  })

  test('a 300-part design breaks the sixty-second promise, so the breach is not a high-block frontier', () => {
    // Written down, not fixed — the same posture as OVER_CEILING_DESIGNS, and for the same reason: the
    // honest repairs are teaching the model about layout or lowering the ceiling, and this does neither.
    const tightest = (TIGHT_LAYOUT_NOW[0] as (typeof TIGHT_LAYOUT_NOW)[0]).byPitch.find(
      (p) => p.pitch === 2,
    )
    expect(Math.max(...(tightest?.wholeDrawMs ?? [0]))).toBeGreaterThan(MAX_DRAW_WAIT_MS)
    expect(Math.min(...OVER_CEILING_DESIGNS.map((d) => d.size.parts))).toBeGreaterThan(300)
  })

  test('the estimate cannot see any of it, because it still takes counts and nothing else', () => {
    for (const family of TIGHT_LAYOUT_NOW) {
      const silences = family.byPitch.map((p) => Math.max(...p.silenceMs))
      expect(new Set(family.byPitch.map(() => estimateWorstSilenceMs(family.size))).size).toBe(1)
      if (family.size.parts !== 300) continue
      // And it under-reads the worst point by more than the allowance it refuses on.
      expect(estimateWorstSilenceMs(family.size) / Math.max(...silences)).toBeLessThan(1)
    }
  })
})

/**
 * How far the whole-draw MEASUREMENT can be trusted, which is the thing every table above rests on.
 *
 * Four reps of one design on ONE build, same machine, same door, same harness, a fresh Electron each
 * time, ran 64,235 / 92,876 / 177,493 / 230,095 ms (…/qs/after-b9000w2000.json, after2-, after3-). That
 * is a 3.6x spread with nothing changed between reps. Two consequences, and both are load-bearing:
 *
 *  - A model fitted to `Math.max(...wholeDrawMs)` from one to three reps is fitted to a draw from that
 *    distribution, not to the design's cost. The ratios asserted above are real, and they are also
 *    noisier than they look.
 *  - Two builds cannot be told apart on this design by drawing it a few times. An attempt to do exactly
 *    that during this work produced 78,957 ms for a build WITHOUT one of the changes
 *    (…/qs/portalsonly-b9000w2000.json) — comfortably inside the spread of the build WITH it, and
 *    therefore evidence of nothing either way.
 *
 * WORST SILENCE IS THE STEADIER NUMBER, and this is why the requirement is written against it: the same
 * pair of reps that ran 37,104 and 222,925 ms end to end reported worst silences of 6,691 and 6,557 ms
 * (…/qs/beforeprobe-b2000w3400p10.json, grid pitch 10) — a 6x spread in the total beside a 2 % spread in
 * the silence. Claims about this canvas should be made about silence, and about profiled self time, in
 * preference to wall-clock totals.
 */
const REPEATED_RUNS_ONE_BUILD = {
  what: '9,000 grouped blocks / 2,000 wires, grid pitch 160',
  wholeDrawMs: [64235, 92876, 177493, 230095],
  artifact: '…/qs/after-b9000w2000.json, after2-b9000w2000.json, after3-b9000w2000.json',
}
const SILENCE_REPS_ONE_BUILD = {
  what: '2,000 grouped blocks / 3,400 wires, grid pitch 10',
  wholeDrawMs: [37104, 222925],
  worstSilenceMs: [6691, 6557],
  artifact: '…/qs/beforeprobe-b2000w3400p10.json',
}

describe('what a single measurement of a big draw is worth', () => {
  test('one design, one build, four reps: the slowest is more than three times the fastest', () => {
    const runs = REPEATED_RUNS_ONE_BUILD.wholeDrawMs
    expect(Math.max(...runs) / Math.min(...runs)).toBeGreaterThan(3)
  })

  test('the spread is wider than the gap the tables above treat as a real difference', () => {
    // The first BOUNDARY_DESIGNS row improved from 30,411 to 18,651 ms and that was read as a change.
    // It may well be one — but it is a 1.6x gap, and this is a 3.6x spread with nothing changed at all.
    const runs = REPEATED_RUNS_ONE_BUILD.wholeDrawMs
    const firstRow = BOUNDARY_DESIGNS[0]
    const claimedGain =
      Math.max(...(firstRow?.beforeMs.wholeDraw ?? [1])) /
      Math.max(...(firstRow?.wholeDrawMs ?? [1]))
    expect(Math.max(...runs) / Math.min(...runs)).toBeGreaterThan(claimedGain)
  })

  test('worst silence holds still across reps whose totals differ six-fold', () => {
    // This is the evidence for preferring silence over wall time, and it is the reason the app's own
    // promise is written about silence.
    const { wholeDrawMs, worstSilenceMs } = SILENCE_REPS_ONE_BUILD
    expect(Math.max(...wholeDrawMs) / Math.min(...wholeDrawMs)).toBeGreaterThan(5)
    expect(Math.max(...worstSilenceMs) / Math.min(...worstSilenceMs)).toBeLessThan(1.1)
  })
})
