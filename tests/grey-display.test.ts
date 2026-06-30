/**
 * Multi-bit GREY-SCALE on the on/off LED matrix — done the real way, with BIT-PLANES + Binary-Code
 * Modulation. A grey image is split into `bits` real 1-bit frame buffers; each is scanned over the real
 * matrix by the real scanner; weighting plane k by 2^k (the eye integrating the PWM) reconstructs the
 * stored grey. The point this guards: the stored grey is RENDERED, not flattened to on/off.
 */

import { describe, expect, test } from 'vitest'
import {
  buildGreyFrameBuffers,
  DOT_MATRIX_MUX_8X8,
  ROW_SCANNER_8,
} from '../src/renderer/builtin-blocks.ts'
import { scanGreyImage } from '../src/renderer/scan-display.ts'

describe('grey-scale display — multi-bit colour depth via real bit-planes (BCM PWM)', () => {
  test('a 3-bit horizontal grey ramp reads back out of real bit-plane memory at the right levels', () => {
    const bits = 3
    const maxLevel = (1 << bits) - 1 // 7 levels (0..7)
    // column c is a flat grey of level c/7 across all 8 rows — a left-to-right ramp from black to full
    const image = Array.from({ length: 8 }, () => Array.from({ length: 8 }, (_, c) => c / maxLevel))
    const planes = buildGreyFrameBuffers(image, bits)
    expect(planes.length).toBe(bits) // one real 1-bit frame buffer per plane
    const grey = scanGreyImage(ROW_SCANNER_8, planes, DOT_MATRIX_MUX_8X8, 8, 8)
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) expect(grey[r]?.[c]).toBeCloseTo(c / maxLevel, 5) // the grey, rendered
  })

  test('full-on (1) and full-off (0) pixels still read back exactly, in a checkerboard', () => {
    const bits = 2
    const image = Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) => ((r + c) % 2 === 0 ? 1 : 0)),
    )
    const grey = scanGreyImage(
      ROW_SCANNER_8,
      buildGreyFrameBuffers(image, bits),
      DOT_MATRIX_MUX_8X8,
      8,
      8,
    )
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) expect(grey[r]?.[c]).toBeCloseTo((r + c) % 2 === 0 ? 1 : 0, 5)
  })

  test('a mid grey (level 1 of 1 bit = full, of 4 bits ≈ 0.27) is distinct from black and white', () => {
    // one bit of depth: every pixel mid → only level 0 or 1 exist, so "mid" rounds to full or off; with
    // more bits a genuine mid-grey survives. Confirms colour DEPTH changes what greys are representable.
    const mid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0.27))
    const oneBit = scanGreyImage(
      ROW_SCANNER_8,
      buildGreyFrameBuffers(mid, 1),
      DOT_MATRIX_MUX_8X8,
      8,
      8,
    )
    const fourBit = scanGreyImage(
      ROW_SCANNER_8,
      buildGreyFrameBuffers(mid, 4),
      DOT_MATRIX_MUX_8X8,
      8,
      8,
    )
    expect(oneBit[0]?.[0]).toBe(0) // 0.27 rounds to off at 1-bit depth
    expect(fourBit[0]?.[0]).toBeGreaterThan(0) // but a real mid-grey at 4-bit depth
    expect(fourBit[0]?.[0]).toBeLessThan(0.5)
  })
})
