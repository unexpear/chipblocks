/**
 * Board footprint COVERAGE — the everyday board parts that previously had no footprint (so they silently
 * dropped off the PCB): the LED, the rectifier diode, and the power-in connector (a DC supply lands as a
 * 2-pin header). This checks the whole schematic→board join for each — the footprint resolves, the
 * terminals land on the physically correct pads (pad 1 = cathode / pin 1 = +), the designator prints the
 * right class letter — and that a COMPLETE little board (power connector → resistor → LED) now places all
 * three parts and forms a full ratsnest, which it couldn't before these footprints existed.
 */
import { describe, expect, test } from 'vitest'
import {
  BUILTIN_FOOTPRINTS,
  FOOTPRINT_DO41,
  FOOTPRINT_LED_5MM,
  FOOTPRINT_LED_0805,
  FOOTPRINT_PINHDR_1X2,
} from '../src/renderer/footprint.ts'
import {
  boardDesignator,
  footprintForPart,
  padForTerminal,
} from '../src/renderer/footprint-assignment.ts'
import { computeRatsnest, deriveBoard, type RatsnestWorld } from '../src/renderer/pcb-board.ts'

describe('the four new footprints exist + are registered', () => {
  test('all four are in BUILTIN_FOOTPRINTS, keyed by id', () => {
    for (const fp of [
      FOOTPRINT_LED_0805,
      FOOTPRINT_LED_5MM,
      FOOTPRINT_PINHDR_1X2,
      FOOTPRINT_DO41,
    ]) {
      expect(BUILTIN_FOOTPRINTS[fp.id]).toBe(fp)
    }
  })

  test('LED_0805: two 1.025×1.4 mm SMD pads on 1.825 mm centres, pad 1 = cathode + a cathode bar', () => {
    const p = FOOTPRINT_LED_0805.pads
    expect(p).toHaveLength(2)
    expect(p.every((pad) => pad.type === 'smd')).toBe(true)
    expect((p[1]?.center.x ?? 0) - (p[0]?.center.x ?? 0)).toBeCloseTo(1.825, 6)
    expect(p[0]?.id).toBe('1') // pad 1 is the cathode
    // more than the 8 corner ticks — the added cathode bar (a vertical silk segment on the pad-1 side)
    expect(FOOTPRINT_LED_0805.silkscreen.length).toBeGreaterThan(8)
  })

  test('LED_D5.0mm: two 0.9 mm-drill through-hole pads on 2.54 mm pitch, pin 1 square = cathode', () => {
    const p = FOOTPRINT_LED_5MM.pads
    expect(p).toHaveLength(2)
    expect(p.every((pad) => pad.type === 'through_hole' && pad.holeDiameter === 0.9)).toBe(true)
    expect(p[0]?.shape).toBe('rect') // pin 1 square = cathode
    expect((p[1]?.center.x ?? 0) - (p[0]?.center.x ?? 0)).toBeCloseTo(2.54, 6)
    // the round body outline is a closed polygon (the 5 mm dome), not a rectangle
    expect(FOOTPRINT_LED_5MM.fabrication.length).toBeGreaterThan(12)
  })

  test('PinHeader_1x02: two 1.0 mm-drill through-hole pads on 2.54 mm pitch, pin 1 square', () => {
    const p = FOOTPRINT_PINHDR_1X2.pads
    expect(p).toHaveLength(2)
    expect(p.every((pad) => pad.type === 'through_hole' && pad.holeDiameter === 1)).toBe(true)
    expect(p[0]?.shape).toBe('rect') // pin 1 square
    expect((p[1]?.center.y ?? 0) - (p[0]?.center.y ?? 0)).toBeCloseTo(2.54, 6)
  })

  test('DO-41: two 1.0 mm-drill through-hole pads on 10.16 mm (0.4″) centres, pin 1 square = cathode', () => {
    const p = FOOTPRINT_DO41.pads
    expect(p).toHaveLength(2)
    expect(p.every((pad) => pad.type === 'through_hole' && pad.holeDiameter === 1)).toBe(true)
    expect(p[0]?.shape).toBe('rect') // pin 1 square = cathode (band)
    expect((p[1]?.center.x ?? 0) - (p[0]?.center.x ?? 0)).toBeCloseTo(10.16, 6)
  })
})

describe('the schematic→board join for the newly-covered parts', () => {
  test('LED resolves to the 0805 SMD land by default, the 5 mm THT when picked', () => {
    expect(footprintForPart('led')?.id).toBe('LED_0805_2012Metric')
    expect(footprintForPart('led', 'LED_D5.0mm')?.id).toBe('LED_D5.0mm')
  })

  test('the rectifier diode resolves to DO-41 by default, SOD-123 when picked', () => {
    expect(footprintForPart('diode_silicon_rectifier')?.id).toBe(
      'D_DO-41_SOD81_P10.16mm_Horizontal',
    )
    expect(footprintForPart('diode_silicon_rectifier', 'D_SOD-123')?.id).toBe('D_SOD-123')
  })

  test('a power source resolves to the 2-pin power-in header', () => {
    expect(footprintForPart('power_source')?.id).toBe('PinHeader_1x02_P2.54mm_Vertical')
  })

  test('polarity lands on the right pad: LED + rectifier cathode → pad 1, supply + → pin 1', () => {
    expect(padForTerminal('led', 'cathode')).toBe('1')
    expect(padForTerminal('led', 'anode')).toBe('2')
    expect(padForTerminal('diode_silicon_rectifier', 'cathode')).toBe('1')
    expect(padForTerminal('diode_silicon_rectifier', 'anode')).toBe('2')
    expect(padForTerminal('power_source', 'terminal_positive')).toBe('1')
    expect(padForTerminal('power_source', 'terminal_negative')).toBe('2')
  })

  test('designators print the standard class letters: LED/rectifier = D, connector = J', () => {
    expect(boardDesignator('led_1', 'led')).toBe('D1')
    expect(boardDesignator('diode_silicon_rectifier_2', 'diode_silicon_rectifier')).toBe('D2')
    expect(boardDesignator('power_source_1', 'power_source')).toBe('J1')
  })
})

describe('a complete LED-indicator board now places every part + forms a full ratsnest', () => {
  // power connector (J1) → resistor (R1) → LED (D1) → back to the connector's negative pin.
  const parts = [
    { id: 'power_source_1', definition: 'power_source' },
    { id: 'resistor_1', definition: 'resistor' },
    { id: 'led_1', definition: 'led' },
  ]
  const board = deriveBoard(parts)

  test('all three parts place (the connector + LED no longer drop off the board)', () => {
    expect(board.placements).toHaveLength(3)
    const byId = new Map(board.placements.map((p) => [p.partId, p]))
    expect(byId.get('power_source_1')?.footprintId).toBe('PinHeader_1x02_P2.54mm_Vertical')
    expect(byId.get('power_source_1')?.designator).toBe('J1')
    expect(byId.get('resistor_1')?.footprintId).toBe('R_0603_1608Metric')
    expect(byId.get('resistor_1')?.designator).toBe('R1')
    expect(byId.get('led_1')?.footprintId).toBe('LED_0805_2012Metric')
    expect(byId.get('led_1')?.designator).toBe('D1')
  })

  test('the ratsnest joins the three nets — 3 airwires over the 6 placed pads', () => {
    const world: RatsnestWorld = {
      instances: new Map([
        ['power_source_1', { definition: 'power_source' }],
        ['resistor_1', { definition: 'resistor' }],
        ['led_1', { definition: 'led' }],
      ]),
      nets: new Map([
        [
          'n1',
          {
            members: [
              { instance: 'power_source_1', terminal: 'terminal_positive' },
              { instance: 'resistor_1', terminal: 'terminal_a' },
            ],
          },
        ],
        [
          'n2',
          {
            members: [
              { instance: 'resistor_1', terminal: 'terminal_b' },
              { instance: 'led_1', terminal: 'anode' },
            ],
          },
        ],
        [
          'n3',
          {
            members: [
              { instance: 'led_1', terminal: 'cathode' },
              { instance: 'power_source_1', terminal: 'terminal_negative' },
            ],
          },
        ],
      ]),
    }
    const rats = computeRatsnest(world, board)
    // 3 nets × 2 pins each → 1 airwire per net; 3 parts × 2 pads → 6 pad boxes.
    expect(rats.airwires).toHaveLength(3)
    expect(rats.padBoxes).toHaveLength(6)
  })
})
