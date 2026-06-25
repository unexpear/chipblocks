/**
 * Multi-digit seven-segment display — proves it is REAL physical hardware (like an actual seven-segment
 * display), not a drawn face, at EVERY size. Each version flattens to nothing but genuine LEDs +
 * current-limiting resistors (7 per digit, plus a point and a comma between each adjacent pair), all
 * sharing ONE common cathode. And the physics is real: a lit segment carries the Ohm's-law current
 * ((5−Vf)/330 ≈ 9 mA), its series resistor carries the IDENTICAL current (KCL), undriven legs carry
 * ~none, and nothing is pushed past its rating. The on-canvas face only READS these solved per-LED
 * currents — it never fakes a lit segment.
 */

import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import {
  type BlockData,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  flattenBlocks,
} from '../src/renderer/blocks.ts'
import { multiDigitDisplay } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld, groundedComponent } from '../src/renderer/canvas-to-world.ts'
import { canvasHealth } from '../src/renderer/health.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

function build(display: BlockData, drivenPorts: string[] = []) {
  const nodes: CanvasNodeLike[] = [
    { id: 'd', position: { x: 0, y: 0 }, data: { definition: 'block', block: display } },
    { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    ...drivenPorts.map((p) => ({
      id: `src_${p}`,
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    })),
  ]
  const edges: CanvasEdgeLike[] = [
    {
      id: 'w_common',
      source: 'd',
      sourceHandle: 'common',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
    ...drivenPorts.flatMap((p) => [
      {
        id: `w_${p}_p`,
        source: `src_${p}`,
        sourceHandle: 'terminal_positive',
        target: 'd',
        targetHandle: p,
      },
      {
        id: `w_${p}_n`,
        source: `src_${p}`,
        sourceHandle: 'terminal_negative',
        target: 'gnd',
        targetHandle: 'reference_terminal',
      },
    ]),
  ]
  const flat = flattenBlocks(nodes, edges)
  const world = canvasToWorld(
    flat.nodes.map((nd) => ({
      id: nd.id,
      definition: nd.data.definition,
      parameters: nd.data.parameters,
    })),
    flat.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  )
  const solution = solveDCRobust(world)
  return {
    flat,
    world,
    solution,
    branchOf: (id: string) => Math.abs(solution.branches.get(id) ?? 0),
  }
}

describe('multi-digit display is REAL hardware — only LEDs + resistors, the right count, one common cathode', () => {
  for (const n of [2, 3, 4, 6]) {
    const expected = 7 * n + 2 * (n - 1) // 7 segments/digit + a point and a comma between each pair
    test(`${n}-digit flattens to ${expected} real LEDs + ${expected} resistors and nothing else`, () => {
      const { flat, world } = build(multiDigitDisplay(n))
      const parts = flat.nodes.filter((nd) => nd.data.definition !== 'ground')
      const leds = parts.filter((nd) => nd.data.definition === 'led')
      const resistors = parts.filter((nd) => nd.data.definition === 'resistor')
      expect(leds.length).toBe(expected)
      expect(resistors.length).toBe(expected)
      // every inner part is a genuine LED or resistor — no faked/placeholder element
      expect(
        parts.every((nd) => nd.data.definition === 'led' || nd.data.definition === 'resistor'),
      ).toBe(true)
      // common cathode: with ONLY the common pin grounded, every LED must reach ground — and its only
      // path there is its cathode, so this proves all the cathodes tie together, like a real display.
      const grounded = groundedComponent(world)
      for (const nd of leds) {
        expect(grounded.instances.has(nd.id), `${nd.id} cathode is not on the common`).toBe(true)
      }
    })
  }
})

describe("multi-digit display physics is REAL — Ohm's-law current, KCL, nothing over-rated", () => {
  for (const n of [2, 3, 6]) {
    test(`${n}-digit: a lit segment carries ~9 mA, its series resistor the same, dark legs ~0, no failures`, () => {
      const { world, solution, branchOf } = build(multiDigitDisplay(n), ['seg_d0_a', 'comma_0'])
      expect(solution.status).toBe('solved')
      // digit 0 is a bare display sub-block, so its LEDs live one level down at `digit0.led_*`
      const iLed = branchOf('d.digit0.led_a')
      const iRes = branchOf('d.r_d0_a')
      // real Ohm's-law magnitude through a 330 Ω + red LED off 5 V: (5 − ~1.9) / 330 ≈ 9 mA
      expect(iLed).toBeGreaterThan(0.005)
      expect(iLed).toBeLessThan(0.015)
      // KCL: the series resistor carries the IDENTICAL current (it is in series with the LED)
      expect(Math.abs(iLed - iRes)).toBeLessThan(1e-6)
      // the driven comma lights too; an undriven segment of the same digit stays dark
      expect(branchOf('d.led_comma_0')).toBeGreaterThan(0.005)
      expect(branchOf('d.digit0.led_b')).toBeLessThan(1e-4)
      // nothing in the display is driven past its rating (real, safe operation)
      for (const [pid, h] of canvasHealth(world, solution)) {
        expect(h.failed === true, `${pid} should not be over its rating`).toBe(false)
      }
    })
  }
})

describe('multi-digit display is built from real bare 7-seg displays + resistors (descend-able)', () => {
  for (const n of [3, 6]) {
    const leds = 7 * n + 2 * (n - 1)
    test(`${n}-digit: the shipped module = ${n} bare displays + ${leds} resistors; the bare version has zero resistors`, () => {
      const shipped = build(multiDigitDisplay(n))
      const shippedLeds = shipped.flat.nodes.filter((nd) => nd.data.definition === 'led').length
      const shippedRes = shipped.flat.nodes.filter((nd) => nd.data.definition === 'resistor').length
      expect(shippedLeds).toBe(leds)
      expect(shippedRes).toBe(leds) // one current-limiting resistor per LED leg

      // the BARE multi has the same LEDs but NO resistors — the raw component
      const bare = build(multiDigitDisplay(n, false))
      expect(bare.flat.nodes.filter((nd) => nd.data.definition === 'led').length).toBe(leds)
      expect(bare.flat.nodes.filter((nd) => nd.data.definition === 'resistor').length).toBe(0)
    })
  }
})
