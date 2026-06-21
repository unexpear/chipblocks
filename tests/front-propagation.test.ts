import { describe, expect, it } from 'vitest'
import { SPEED_OF_LIGHT_M_S } from '../src/field-energy.ts'
import {
  computeFront,
  frontFraction,
  WIRE_VELOCITY_FACTOR,
  wireDelaySeconds,
} from '../src/renderer/front-propagation.ts'

describe('wireDelaySeconds — finite signal speed', () => {
  it('is length / (c · velocity factor); ~5 ns per metre at 2/3 c', () => {
    expect(wireDelaySeconds(1)).toBeCloseTo(1 / (SPEED_OF_LIGHT_M_S * WIRE_VELOCITY_FACTOR), 18)
    expect(wireDelaySeconds(1)).toBeGreaterThan(4e-9)
    expect(wireDelaySeconds(1)).toBeLessThan(6e-9)
    expect(wireDelaySeconds(2)).toBeCloseTo(2 * wireDelaySeconds(1), 18) // twice the wire, twice the delay
  })
})

describe('computeFront — the front sweeps out from the source in wire-length order', () => {
  // source S ─[w1: 1 m]─ A ║part║ B ─[w2: 2 m]─ L(oad / far bulb)
  const input = {
    wires: [
      { id: 'w1', netA: 'S', netB: 'A', lengthM: 1 },
      { id: 'w2', netA: 'B', netB: 'L', lengthM: 2 },
    ],
    bridges: [['A', 'B']],
    sourceNets: ['S'],
  }
  const d1 = wireDelaySeconds(1)

  it('reaches the near part first and the far load last (the bulb lights last)', () => {
    const { arrival } = computeFront(input)
    expect(arrival.get('S')).toBe(0)
    expect(arrival.get('A')).toBeCloseTo(d1, 18)
    expect(arrival.get('B')).toBeCloseTo(d1, 18) // the part bridges A→B instantly
    expect(arrival.get('L')).toBeCloseTo(3 * d1, 18) // 1 m + 2 m of wire
    // ordering: the far bulb is reached strictly after the near part
    expect((arrival.get('L') ?? 0) > (arrival.get('A') ?? 0)).toBe(true)
  })

  it("each wire's entry/exit time matches its endpoints, and maxTime is the last arrival", () => {
    const { wires, maxTime } = computeFront(input)
    const w1 = wires.get('w1')
    const w2 = wires.get('w2')
    expect(w1?.entryTime).toBe(0)
    expect(w1?.exitTime).toBeCloseTo(d1, 18)
    expect(w1?.entryFromA).toBe(true) // enters from S (netA), the source end
    expect(w2?.entryTime).toBeCloseTo(d1, 18)
    expect(w2?.exitTime).toBeCloseTo(3 * d1, 18)
    expect(w2?.reached).toBe(true)
    expect(maxTime).toBeCloseTo(3 * d1, 18)
  })

  it('a floating section the front never reaches comes back unreached', () => {
    const { wires } = computeFront({
      wires: [{ id: 'wf', netA: 'X', netB: 'Y', lengthM: 1 }],
      bridges: [],
      sourceNets: ['S'],
    })
    expect(wires.get('wf')?.reached).toBe(false)
  })
})

describe('frontFraction — how far the front has crawled along a wire', () => {
  const wire = { entryTime: 10, exitTime: 30, delay: 20, entryFromA: true, reached: true }
  it('is 0 before entry, ramps linearly across, and clamps at 1 after exit', () => {
    expect(frontFraction(wire, 5)).toBe(0)
    expect(frontFraction(wire, 10)).toBe(0)
    expect(frontFraction(wire, 20)).toBeCloseTo(0.5, 12)
    expect(frontFraction(wire, 30)).toBe(1)
    expect(frontFraction(wire, 100)).toBe(1)
  })
  it('an unreached wire is always 0', () => {
    expect(frontFraction({ ...wire, reached: false }, 25)).toBe(0)
  })
})
