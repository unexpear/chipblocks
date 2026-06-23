import { describe, expect, it } from 'vitest'
import {
  buildNets,
  extractSchematic,
  resolvePinPositions,
} from '../src/renderer/kicad-schematic.ts'

// A tiny hand-built schematic exercising the geometric net-builder: a vertical resistor R1 with a
// +5V port on its top pin, wired down to R2, whose bottom pin sits on a GND port — plus a rotated
// R3 and a mirrored R4 to pin down the transform. Device:R has pins at local (0,±10); the +5V / GND
// power ports each have one pin at their origin. Coordinates are chosen round so the math reads.
const SCH = `
(kicad_sch
  (version 20231120)
  (lib_symbols
    (symbol "Device:R"
      (symbol "R_1_1"
        (pin passive line (at 0 10 270) (length 2) (name "~") (number "1"))
        (pin passive line (at 0 -10 90) (length 2) (name "~") (number "2"))
      )
    )
    (symbol "power:+5V"
      (pin power_in line (at 0 0 90) (length 0) (name "+5V") (number "1"))
    )
    (symbol "power:GND"
      (pin power_in line (at 0 0 270) (length 0) (name "GND") (number "1"))
    )
  )
  (symbol (lib_id "Device:R") (at 50 50 0) (property "Reference" "R1") (property "Value" "1k"))
  (symbol (lib_id "Device:R") (at 50 80 0) (property "Reference" "R2") (property "Value" "2k"))
  (symbol (lib_id "Device:R") (at 100 50 90) (property "Reference" "R3") (property "Value" "3k"))
  (symbol (lib_id "Device:R") (at 150 50 0) (mirror x) (property "Reference" "R4") (property "Value" "4k"))
  (symbol (lib_id "power:+5V") (at 50 40 0) (property "Reference" "#PWR01") (property "Value" "+5V"))
  (symbol (lib_id "power:GND") (at 50 90 0) (property "Reference" "#PWR02") (property "Value" "GND"))
  (wire (pts (xy 50 60) (xy 50 70)))
)
`

const sch = extractSchematic(SCH)

describe('kicad pin resolution', () => {
  const at = (ref: string, num: string) => {
    const p = resolvePinPositions(sch).find((q) => q.reference === ref && q.pinNumber === num)
    return p ? { x: p.x, y: p.y } : undefined
  }

  it('places an un-rotated resistor (the Y axis flips: lib +y is sheet −y)', () => {
    expect(at('R1', '1')).toEqual({ x: 50, y: 40 }) // local (0,10) → top
    expect(at('R1', '2')).toEqual({ x: 50, y: 60 }) // local (0,-10) → bottom
  })

  it('rotates 90° (a vertical resistor becomes horizontal)', () => {
    expect(at('R3', '1')).toEqual({ x: 90, y: 50 })
    expect(at('R3', '2')).toEqual({ x: 110, y: 50 })
  })

  it('mirrors across the X axis (top/bottom pins swap)', () => {
    expect(at('R4', '1')).toEqual({ x: 150, y: 60 }) // mirrored: pin 1 now at the bottom
    expect(at('R4', '2')).toEqual({ x: 150, y: 40 })
  })

  it('skips power ports — they name nets, they are not devices', () => {
    const refs = resolvePinPositions(sch).map((p) => p.reference)
    expect(refs).not.toContain('#PWR01')
    expect(refs).not.toContain('#PWR02')
  })
})

describe('kicad net extraction', () => {
  const nets = buildNets(sch)
  const netNamed = (name: string) => nets.find((n) => n.name === name)
  const pinKeys = (refPin: string) => (n: { pins: { reference: string; pinNumber: string }[] }) =>
    n.pins.some((p) => `${p.reference}.${p.pinNumber}` === refPin)

  it('a power port names the net its pin lands on', () => {
    expect(netNamed('+5V')?.pins).toEqual([{ reference: 'R1', pinNumber: '1', pinName: '~' }])
    expect(netNamed('GND')?.pins).toEqual([{ reference: 'R2', pinNumber: '2', pinName: '~' }])
  })

  it('a wire ties two pins into one net', () => {
    const mid = nets.find(pinKeys('R1.2'))
    expect(mid?.pins.some((p) => `${p.reference}.${p.pinNumber}` === 'R2.1')).toBe(true)
  })

  it('unconnected pins are their own single-pin nets', () => {
    const r3a = nets.find(pinKeys('R3.1'))
    expect(r3a?.pins).toHaveLength(1)
    expect(r3a?.name).toBeUndefined()
  })
})
