/**
 * User-made parts, slice 4b — a custom part with a REAL behaviour actually simulates. A part that
 * declares it behaves as a built-in device is lowered to that real device before the solve, so the real
 * physics runs (no faking). Here a custom part behaving as a 100 Ω resistor, in the same 9 V / 1 Ω-source
 * loop the built-in-resistor pipeline test uses, must carry the SAME ~89.1 mA — proof the custom part is
 * genuinely modelled as the real resistor, connected on the right nets via its pin→terminal map.
 */
import type { Edge, Node } from '@xyflow/react'
import { afterEach, describe, expect, test } from 'vitest'
import { canvasWorld } from '../src/renderer/pipeline/canvas-world.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'
import { terminalsOf } from '../src/renderer/symbols.tsx'
import { BEHAVIOUR_DEVICES } from '../src/renderer/user-part-draft.ts'
import { registerUserPart, setUserParts, type UserPart } from '../src/renderer/user-parts.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const node = (id: string, definition: string, parameters?: Record<string, unknown>): Node =>
  ({
    id,
    position: { x: 0, y: 0 },
    data: { definition, ...(parameters ? { parameters } : {}) },
  }) as unknown as Node

// A custom part that behaves as a resistor between its two pins.
const customResistor: UserPart = {
  id: 'my_shunt',
  name: 'My Shunt',
  designatorPrefix: 'R',
  pins: [
    { id: 'in', name: 'IN', side: 'left', electrical: 'passive' },
    { id: 'out', name: 'OUT', side: 'right', electrical: 'passive' },
  ],
  behavesAs: { definition: 'resistor', terminals: { terminal_a: 'in', terminal_b: 'out' } },
}

// The same loop as the built-in-resistor pipeline test, but the resistor is our custom part, wired on
// its OWN pin ids ('in'/'out') — which the behaviour lowering remaps to the resistor's terminal_a/_b.
const nodes: Node[] = [
  node('bat', 'power_source', {
    nominal_voltage: scalar(9, 'volt'),
    internal_resistance: scalar(1, 'ohm'),
  }),
  node('rx', 'my_shunt', { resistance: scalar(100, 'ohm') }),
  node('gnd', 'ground'),
]
const edges: Edge[] = [
  { id: 'e1', source: 'bat', sourceHandle: 'terminal_positive', target: 'rx', targetHandle: 'in' },
  { id: 'e2', source: 'rx', sourceHandle: 'out', target: 'bat', targetHandle: 'terminal_negative' },
  {
    id: 'e3',
    source: 'gnd',
    sourceHandle: 'reference_terminal',
    target: 'bat',
    targetHandle: 'terminal_negative',
  },
] as unknown as Edge[]

afterEach(() => setUserParts([]))

describe('a custom part with behavesAs is lowered to the real device and solves', () => {
  test('canvasWorld emits the REAL resistor instance (not the black-box custom id)', () => {
    registerUserPart(customResistor)
    const { world } = canvasWorld(nodes, edges)
    const rx = world.instances.get('rx')
    expect(rx?.definition).toBe('resistor') // lowered from my_shunt → resistor
    // its pins were remapped to the resistor's terminals on the right nets
    const terminals = (rx?.connects ?? []).map((c) => c.terminal).sort()
    expect(terminals).toEqual(['terminal_a', 'terminal_b'])
  })

  test('it carries real current — the same ~89.1 mA a built-in 100 Ω resistor would', () => {
    registerUserPart(customResistor)
    const result = solveCanvasDispatch(nodes, edges)
    expect(result.solution.status).toBe('solved')
    expect(Math.abs(result.solution.branches.get('rx') ?? -1)).toBeCloseTo(0.0891, 4)
  })

  test('a WIRED unmapped pin doesn’t break a passive behaviour (its wire is dropped, not counted)', () => {
    // A 3-pin part behaving as a 2-terminal resistor: the third pin has no device terminal. Wiring it
    // must NOT add a phantom 3rd connection that makes the resistor stamp bail — the part still solves.
    registerUserPart({
      id: 'sensor3',
      name: 'Sensor 3',
      designatorPrefix: 'U',
      pins: [
        { id: 'in', name: 'IN', side: 'left', electrical: 'passive' },
        { id: 'out', name: 'OUT', side: 'right', electrical: 'passive' },
        { id: 'extra', name: 'EXTRA', side: 'top', electrical: 'passive' },
      ],
      behavesAs: { definition: 'resistor', terminals: { terminal_a: 'in', terminal_b: 'out' } },
    })
    const n: Node[] = [
      node('bat', 'power_source', {
        nominal_voltage: scalar(9, 'volt'),
        internal_resistance: scalar(1, 'ohm'),
      }),
      node('rx', 'sensor3', { resistance: scalar(100, 'ohm') }),
      node('gnd', 'ground'),
    ]
    const e: Edge[] = [
      {
        id: 'e1',
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'rx',
        targetHandle: 'in',
      },
      {
        id: 'e2',
        source: 'rx',
        sourceHandle: 'out',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'e3',
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
      // the unmapped EXTRA pin is wired — must not perturb the solve
      {
        id: 'e4',
        source: 'rx',
        sourceHandle: 'extra',
        target: 'gnd',
        targetHandle: 'reference_terminal',
      },
    ] as unknown as Edge[]
    const result = solveCanvasDispatch(n, e)
    expect(result.solution.status).toBe('solved')
    expect(Math.abs(result.solution.branches.get('rx') ?? -1)).toBeCloseTo(0.0891, 4)
  })

  test('WITHOUT the behaviour, the same custom part is an honest black box (unsupported, not faked)', () => {
    const { behavesAs, ...blackBox } = customResistor
    void behavesAs
    registerUserPart(blackBox)
    const result = solveCanvasDispatch(nodes, edges)
    // the black box can't be solved as a device — the DC solver reports it unsupported (never a fake pass)
    expect(result.solution.status).not.toBe('solved')
  })
})

describe('BEHAVIOUR_DEVICES terminal names match the real device terminals (can’t drift)', () => {
  for (const device of BEHAVIOUR_DEVICES) {
    test(`${device.definition}: every listed terminal is a real terminal of the device`, () => {
      const real = new Set(terminalsOf(device.definition, undefined).map((t) => t.id))
      for (const terminal of device.terminals) expect(real.has(terminal)).toBe(true)
    })
  }
})
