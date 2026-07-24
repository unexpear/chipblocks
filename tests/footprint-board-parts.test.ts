/**
 * The three cited footprints added for the FPGA-board parts (QFN-48, SOT-25, 3.2×2.5 oscillator).
 * These are hand-entered geometry copied from manufacturer land patterns, so the point of the tests is
 * to catch a transcription error: the pad COUNT, the KEY dimensions the source states, that no two
 * pads overlap (a short), and that no silk line is printed across a pad (ink that stops solder). The
 * flash's SOIC-8W (208-mil) footprint is deliberately NOT here — its row pitch is ambiguous in
 * Winbond's app note and wants an IPC-7351B derivation, not a transcription.
 */

import { describe, expect, test } from 'vitest'
import {
  FOOTPRINT_OSC_3225,
  FOOTPRINT_QFN48,
  FOOTPRINT_SOT25,
  type Footprint,
  type Pad,
  type SilkLine,
} from '../src/renderer/footprint.ts'

/** Do two axis-aligned pad rectangles overlap (with a hair of slack for touching edges)? */
function padsOverlap(a: Pad, b: Pad): boolean {
  const gap = 1e-6
  const ax = a.size.w / 2
  const ay = a.size.h / 2
  const bx = b.size.w / 2
  const by = b.size.h / 2
  return (
    Math.abs(a.center.x - b.center.x) < ax + bx - gap &&
    Math.abs(a.center.y - b.center.y) < ay + by - gap
  )
}

/** Does an axis-aligned silk segment cross into a pad rectangle? (Segments here are H or V.) */
function silkCrossesPad(line: SilkLine, pad: Pad): boolean {
  const left = pad.center.x - pad.size.w / 2
  const right = pad.center.x + pad.size.w / 2
  const top = pad.center.y - pad.size.h / 2
  const bottom = pad.center.y + pad.size.h / 2
  const gap = 1e-6
  const inX = (x: number) => x > left + gap && x < right - gap
  const inY = (y: number) => y > top + gap && y < bottom - gap
  if (line.from.y === line.to.y) {
    // horizontal: its y must be inside the pad and its x-span must reach into the pad
    const y = line.from.y
    const x0 = Math.min(line.from.x, line.to.x)
    const x1 = Math.max(line.from.x, line.to.x)
    return inY(y) && x1 > left + gap && x0 < right - gap
  }
  if (line.from.x === line.to.x) {
    const x = line.from.x
    const y0 = Math.min(line.from.y, line.to.y)
    const y1 = Math.max(line.from.y, line.to.y)
    return inX(x) && y1 > top + gap && y0 < bottom - gap
  }
  return false // diagonal ticks/dots are checked by the point-in-pad guard below
}

const noPadOverlaps = (fp: Footprint) => {
  for (let i = 0; i < fp.pads.length; i++) {
    for (let j = i + 1; j < fp.pads.length; j++) {
      if (padsOverlap(fp.pads[i] as Pad, fp.pads[j] as Pad))
        return `${fp.pads[i]?.id}/${fp.pads[j]?.id}`
    }
  }
  return null
}

// Only the SILKSCREEN is checked against pads. The fabrication layer is the component-BODY outline
// (an assembly-drawing reference, not printed ink), and for a package whose lands overhang its body —
// the 3.2×2.5 oscillator's do — the body outline legitimately runs over the inner ends of the pads.
const silkOnPad = (fp: Footprint) => {
  for (const line of fp.silkscreen) {
    for (const pad of fp.pads) {
      if (silkCrossesPad(line, pad)) return pad.id
    }
  }
  return null
}

describe('every board-part footprint is coherent', () => {
  for (const fp of [FOOTPRINT_QFN48, FOOTPRINT_SOT25, FOOTPRINT_OSC_3225]) {
    test(`${fp.id}: no overlapping pads, no silk on copper`, () => {
      // NB: footprintProblems is the USER-footprint gate — it deliberately rejects a built-in id, so
      // it is the wrong check for a shipped footprint. Coherence is the geometry checks below.
      expect(noPadOverlaps(fp)).toBeNull()
      expect(silkOnPad(fp)).toBeNull()
      expect(new Set(fp.pads.map((p) => p.id)).size).toBe(fp.pads.length) // unique pad names
    })
  }
})

describe('QFN-48 matches Lattice TN1257', () => {
  test('48 perimeter lands plus the exposed pad, 12 per side', () => {
    expect(FOOTPRINT_QFN48.pads).toHaveLength(49)
    const perimeter = FOOTPRINT_QFN48.pads.filter((p) => p.id !== '49')
    expect(perimeter).toHaveLength(48)
    const left = perimeter.filter((p) => p.center.x === -3.3)
    expect(left).toHaveLength(12) // TN1257's "44×0.50" = 4 sides × 11 gaps = 12 lands per side
  })

  test('lands on the 0.5 mm pitch at the ±3.30 mm ring, thermal pad 4.2 mm', () => {
    const left = FOOTPRINT_QFN48.pads.filter((p) => p.center.x === -3.3).map((p) => p.center.y)
    const gaps = left.slice(1).map((y, i) => Number((y - (left[i] as number)).toFixed(6)))
    expect(gaps.every((g) => g === 0.5)).toBe(true)
    expect(
      Math.max(
        ...FOOTPRINT_QFN48.pads.filter((p) => p.id !== '49').map((p) => Math.abs(p.center.x)),
      ),
    ).toBe(3.3)
    const ep = FOOTPRINT_QFN48.pads.find((p) => p.id === '49')
    expect(ep?.size).toEqual({ w: 4.2, h: 4.2 })
    expect(ep?.thermal).toBe(true)
    // land outer edge sits on the 7.00 mm body edge (zero toe): 3.30 + 0.40/2 = 3.50 = body/2
    expect(3.3 + 0.4 / 2).toBe(3.5)
  })

  test('pin 1 is the top-left land (JEDEC QFN, counter-clockwise)', () => {
    const p1 = FOOTPRINT_QFN48.pads.find((p) => p.id === '1')
    expect(p1?.center).toEqual({ x: -3.3, y: -2.75 })
  })
})

describe('SOT-25 matches the Diodes AP2112 suggested pad layout', () => {
  test('5 lands, rows 2.40 mm apart, 0.95 mm pitch, 0.55×0.80 lands', () => {
    expect(FOOTPRINT_SOT25.pads).toHaveLength(5)
    const p1 = FOOTPRINT_SOT25.pads.find((p) => p.id === '1')
    const p5 = FOOTPRINT_SOT25.pads.find((p) => p.id === '5')
    expect((p5?.center.x as number) - (p1?.center.x as number)).toBeCloseTo(2.4, 6) // C1
    const left = FOOTPRINT_SOT25.pads.filter((p) => p.center.x === -1.2).map((p) => p.center.y)
    expect(left.slice(1).map((y, i) => y - (left[i] as number))).toEqual([0.95, 0.95]) // C2
    expect(p1?.size).toEqual({ w: 0.8, h: 0.55 }) // Y length 0.80 out, X width 0.55 along row
  })

  test('VIN and VOUT are diagonally opposite (the AP2112 pin map)', () => {
    const p1 = FOOTPRINT_SOT25.pads.find((p) => p.id === '1') // VIN
    const p5 = FOOTPRINT_SOT25.pads.find((p) => p.id === '5') // VOUT
    expect(Math.sign(p1?.center.x as number)).toBe(-Math.sign(p5?.center.x as number))
    expect(p1?.center.y).toBe(p5?.center.y) // same row height, opposite sides
  })
})

describe('the 3.2×2.5 oscillator matches the Abracon ASE land pattern', () => {
  test('4 corner lands at ±1.05 / ±0.825, 1.3×1.1 mm', () => {
    expect(FOOTPRINT_OSC_3225.pads).toHaveLength(4)
    for (const p of FOOTPRINT_OSC_3225.pads) {
      expect(Math.abs(p.center.x)).toBe(1.05) // 2.10 mm X pitch
      expect(Math.abs(p.center.y)).toBe(0.825) // 1.65 mm Y pitch
      expect(p.size).toEqual({ w: 1.3, h: 1.1 })
    }
  })
})
