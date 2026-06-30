/**
 * The scanned multiplexed display works end to end: the REAL clocked scanner drives the REAL analog
 * matrix, one row at a time, and the accumulated persistence-of-vision image is exactly the picture you
 * asked for. This is the whole point of multiplexing — a 16-pin (8 row + 8 column) panel shows an
 * arbitrary 64-pixel image, painted row by row by a real counter + decoder + LED grid, nothing faked.
 */

import { describe, expect, test } from 'vitest'
import {
  buildFrameBuffer,
  DOT_MATRIX_MUX_8X8,
  ROW_SCANNER_8,
} from '../src/renderer/builtin-blocks.ts'
import { scanMatrixFromBuffer, scanMatrixImage } from '../src/renderer/scan-display.ts'

// A recognizable 8×8 picture — an X / diamond outline.
const X = [
  '#......#',
  '.#....#.',
  '..#..#..',
  '...##...',
  '...##...',
  '..#..#..',
  '.#....#.',
  '#......#',
].map((row) => [...row].map((ch) => ch === '#'))

describe('scanned multiplexed display — scanner + matrix co-sim paints a whole picture (persistence of vision)', () => {
  test('clocking the real scanner over the real matrix reproduces an arbitrary 8×8 image exactly', () => {
    const pov = scanMatrixImage(ROW_SCANNER_8, DOT_MATRIX_MUX_8X8, X)
    expect(pov).toEqual(X)
  })

  test('a different image (a solid border frame) is reproduced too — it is the image, not a fixed pattern', () => {
    const FRAME = Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) => r === 0 || r === 7 || c === 0 || c === 7),
    )
    expect(scanMatrixImage(ROW_SCANNER_8, DOT_MATRIX_MUX_8X8, FRAME)).toEqual(FRAME)
  })

  test('every lit pixel of the picture is accounted for across the full scan', () => {
    const pov = scanMatrixImage(ROW_SCANNER_8, DOT_MATRIX_MUX_8X8, X)
    expect(pov.flat().filter(Boolean).length).toBe(X.flat().filter(Boolean).length)
  })

  test('real all the way down: the picture read from a FRAME BUFFER (flip-flop memory) reproduces it', () => {
    // The image lives in real flip-flops; the scanner's one-hot address reads each row out of memory and
    // the matrix lights it — no bitmap handed to the co-sim, just hardware reading hardware.
    const fb = buildFrameBuffer(X)
    expect(scanMatrixFromBuffer(ROW_SCANNER_8, fb, DOT_MATRIX_MUX_8X8, 8, 8)).toEqual(X)
  })

  test('a column pattern the full-row solve fails to converge on still reproduces exactly', () => {
    // cols 2,3,6,7 set in every row: the all-at-once Newton solve hits its iteration cap on row 2 and
    // collapses to all-dark. The matrix columns are independent (the driven row line is held at the supply
    // voltage), so solveMatrixRow falls back to per-column solves and recovers it exactly — a regression
    // guard for that convergence fallback. Before it, row 2 came back blank.
    const pat = Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, (_, c) => ((c >> 1) & 1) === 1),
    )
    expect(scanMatrixImage(ROW_SCANNER_8, DOT_MATRIX_MUX_8X8, pat)).toEqual(pat)
  })
})
