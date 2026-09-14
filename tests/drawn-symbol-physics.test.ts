/**
 * A drawn symbol is a PICTURE — drawing one must be incapable of changing what the part does. These
 * tests hold that down the only way that counts: give the same part, on the same canvas, a drawing and
 * no drawing, and require the circuit handed to the solver (and its solved answer) to be identical — for
 * a black box, a part that behaves as a real device, and a part built from an internal circuit. And the
 * pin contract every other layer keys off — pin ids, their order, and which footprint pad each lands on —
 * must come through a drawing untouched.
 */
import type { Edge, Node } from '@xyflow/react'
import { afterEach, describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { padForTerminal, terminalForPad } from '../src/renderer/footprint-assignment.ts'
import { canvasWorld } from '../src/renderer/pipeline/canvas-world.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'
import type { DrawnSymbol } from '../src/renderer/symbol-geometry.ts'
import { validateUserPart } from '../src/renderer/user-part-validate.ts'
import { registerUserPart, setUserParts, type UserPart } from '../src/renderer/user-parts.ts'
import { OPAMP_SYMBOL, opampPart, plainOpampPart } from './drawn-symbol-fixture.ts'

afterEach(() => setUserParts([]))

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const node = (id: string, definition: string, parameters?: Record<string, unknown>): Node =>
  ({
    id,
    position: { x: 0, y: 0 },
    data: { definition, ...(parameters ? { parameters } : {}) },
  }) as unknown as Node

/** A two-pin body drawn as a plain rectangle, pins out of the left and right. */
const TWO_PIN_SYMBOL: DrawnSymbol = {
  graphics: [
    {
      kind: 'rectangle',
      start: { x: 0, y: -8 },
      end: { x: 40, y: 8 },
      strokeWidth: 1.6,
      fill: 'background',
    },
  ],
  pins: [
    { pin: 'a', at: { x: -20, y: 0 }, length: 20, style: 'line' },
    { pin: 'b', at: { x: 60, y: 0 }, length: 20, style: 'inverted' },
  ],
  fields: OPAMP_SYMBOL.fields,
}

const twoPins: UserPart['pins'] = [
  { id: 'a', name: 'A', side: 'left', electrical: 'passive' },
  { id: 'b', name: 'B', side: 'right', electrical: 'passive' },
]

const seriesPair: BlockData = {
  name: 'series pair',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'r1', definition: 'resistor', x: 0, y: 0, parameters: { resistance: scalar(50, 'ohm') } },
    {
      id: 'r2',
      definition: 'resistor',
      x: 120,
      y: 0,
      parameters: { resistance: scalar(50, 'ohm') },
    },
  ],
  edges: [
    {
      id: 'w1',
      source: 'r1',
      sourceHandle: 'terminal_b',
      target: 'r2',
      targetHandle: 'terminal_a',
    },
  ],
  ports: [
    { id: 'a', label: 'r1 · a', side: 'left', inner: { nodeId: 'r1', handleId: 'terminal_a' } },
    { id: 'b', label: 'r2 · b', side: 'right', inner: { nodeId: 'r2', handleId: 'terminal_b' } },
  ],
}

const kinds: { label: string; part: UserPart; parameters?: Record<string, unknown> }[] = [
  {
    label: 'a black box',
    part: { id: 'my_box', name: 'My Box', designatorPrefix: 'U', pins: twoPins },
  },
  {
    label: 'a part that behaves as a real resistor',
    part: {
      id: 'my_shunt',
      name: 'My Shunt',
      designatorPrefix: 'R',
      pins: twoPins,
      behavesAs: { definition: 'resistor', terminals: { terminal_a: 'a', terminal_b: 'b' } },
    },
    parameters: { resistance: scalar(100, 'ohm') },
  },
  {
    label: 'a part built from an internal circuit',
    part: {
      id: 'my_module',
      name: 'My Module',
      designatorPrefix: 'U',
      pins: twoPins,
      internal: seriesPair,
    },
  },
]

/** 9 V behind 1 Ω, across the part, grounded — the reference loop the user-part tests use. */
function loop(definition: string, parameters?: Record<string, unknown>) {
  const nodes: Node[] = [
    node('bat', 'power_source', {
      nominal_voltage: scalar(9, 'volt'),
      internal_resistance: scalar(1, 'ohm'),
    }),
    node('ux', definition, parameters),
    node('gnd', 'ground'),
  ]
  const edges = [
    { id: 'e1', source: 'bat', sourceHandle: 'terminal_positive', target: 'ux', targetHandle: 'a' },
    { id: 'e2', source: 'ux', sourceHandle: 'b', target: 'bat', targetHandle: 'terminal_negative' },
    {
      id: 'e3',
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'bat',
      targetHandle: 'terminal_negative',
    },
  ] as unknown as Edge[]
  return { nodes, edges }
}

describe('a drawing cannot change what the solver sees, or what it answers', () => {
  for (const kind of kinds) {
    test(`${kind.label}: the same world and the same solution, drawn or not`, () => {
      const { nodes, edges } = loop(kind.part.id, kind.parameters)

      registerUserPart(kind.part)
      const plainWorld = canvasWorld(nodes, edges)
      const plainSolve = solveCanvasDispatch(nodes, edges)

      const drawn = { ...kind.part, symbol: TWO_PIN_SYMBOL }
      expect(validateUserPart(drawn)?.symbol).toEqual(TWO_PIN_SYMBOL) // a drawing the loader keeps
      registerUserPart(drawn)
      const drawnWorld = canvasWorld(nodes, edges)
      const drawnSolve = solveCanvasDispatch(nodes, edges)

      expect(drawnWorld).toEqual(plainWorld)
      expect(drawnSolve.solution).toEqual(plainSolve.solution)
    })
  }

  test('…and the drawn part really is solved (the comparison is not between two empty answers)', () => {
    const shunt = kinds[1]?.part as UserPart
    registerUserPart({ ...shunt, symbol: TWO_PIN_SYMBOL })
    const { nodes, edges } = loop(shunt.id, { resistance: scalar(100, 'ohm') })
    const result = solveCanvasDispatch(nodes, edges)
    expect(result.solution.status).toBe('solved')
    expect(Math.abs(result.solution.branches.get('ux') ?? -1)).toBeCloseTo(0.0891, 4)
  })
})

describe('the pin contract comes through a drawing untouched', () => {
  const footprint = 'SOIC-8_3.9x4.9mm_P1.27mm'

  test('pin ids, their order, and the pad each solders to are the same, drawn or not', () => {
    const withoutDrawing = plainOpampPart({ footprintId: footprint })
    registerUserPart(withoutDrawing)
    const padsBefore = withoutDrawing.pins.map((p) => padForTerminal(withoutDrawing.id, p.id))
    const pinBackBefore = padsBefore.map((pad) => terminalForPad(withoutDrawing.id, pad ?? ''))

    const drawn = validateUserPart(opampPart({ footprintId: footprint })) as UserPart
    expect(drawn.symbol).toBeDefined()
    registerUserPart(drawn)
    expect(drawn.pins).toEqual(withoutDrawing.pins)
    const padsAfter = drawn.pins.map((p) => padForTerminal(drawn.id, p.id))
    expect(padsAfter).toEqual(padsBefore)
    expect(padsAfter).toEqual(['1', '2', '3', '4', '5']) // declaration order: pin 1 → pad 1, …
    expect(padsAfter.map((pad) => terminalForPad(drawn.id, pad ?? ''))).toEqual(pinBackBefore)
  })
})
