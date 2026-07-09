/**
 * A DIGITAL custom module keeps the fast logic engine. A gates-only circuit block auto-routes to the
 * ~1000× 0/1 logic engine; saving that block as a custom part must NOT silently demote it onto the
 * transistor scaling wall (~60 s at ~650 MOSFETs). These lock: the classifier sees a module's internals
 * (nested modules resolved), the dispatch actually runs the logic engine for a saved NOT gate — with
 * the SAME answer the source block gives — an analog module stays analog, and the explicit
 * fidelity='transistor' opt-out still wins.
 */
import type { Edge, Node } from '@xyflow/react'
import { afterEach, describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { INVERTER_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { attachInternalCircuits } from '../src/renderer/pipeline/canvas-world.ts'
import { classifyCanvas } from '../src/renderer/pipeline/partition.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'
import { userPartFromBlock } from '../src/renderer/user-part-draft.ts'
import { registerUserPart, setUserParts, type UserPart } from '../src/renderer/user-parts.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const V5 = {
  nominal_voltage: scalar(5, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
}
const node = (id: string, definition: string, data: Record<string, unknown> = {}): Node =>
  ({ id, position: { x: 0, y: 0 }, data: { definition, ...data } }) as unknown as Node

/** Register the NOT gate saved as a custom part (through the real save-block-as-part builder, so the
 *  stored internals are the stripped solve core — gate identity must survive by NAME, not symbol). */
const registerNotModule = (): UserPart => {
  const r = userPartFromBlock('Not Module', 'U', INVERTER_BLOCK)
  if (!r.ok) throw new Error(r.error)
  registerUserPart(r.part)
  return r.part
}

/** The inverter driven HIGH: v+ → in and v_dd, gnd port + ground to v−. out must read LOW (0 V). */
const inverterCircuit = (
  gate: Node,
  handles: { in: string; out: string; vdd: string; gnd: string },
): { nodes: Node[]; edges: Edge[] } => ({
  nodes: [node('v1', 'power_source', { parameters: V5 }), gate, node('g1', 'ground')],
  edges: [
    {
      id: 'e1',
      source: 'v1',
      sourceHandle: 'terminal_positive',
      target: gate.id,
      targetHandle: handles.in,
      // a user-edited wire — its gauge + material must survive the logic-path edge rebuild
      data: { gaugeAwg: 18, material: 'copper' },
    },
    {
      id: 'e2',
      source: 'v1',
      sourceHandle: 'terminal_positive',
      target: gate.id,
      targetHandle: handles.vdd,
    },
    {
      id: 'e3',
      source: gate.id,
      sourceHandle: handles.gnd,
      target: 'v1',
      targetHandle: 'terminal_negative',
    },
    {
      id: 'e4',
      source: 'g1',
      sourceHandle: 'reference_terminal',
      target: 'v1',
      targetHandle: 'terminal_negative',
    },
  ] as unknown as Edge[],
})

afterEach(() => setUserParts([]))

describe('classifyCanvas sees a custom module’s internals', () => {
  test('a gates-only module classifies LOGIC (like the block it was saved from)', () => {
    registerNotModule()
    const { nodes } = inverterCircuit(node('m1', 'not_module'), {
      in: 'in',
      out: 'out',
      vdd: 'v_dd',
      gnd: 'gnd',
    })
    expect(classifyCanvas(nodes)).toBe('logic')
  })

  test('an ANALOG-internals module stays on the transistor solve', () => {
    registerUserPart({
      id: 'analog_module',
      name: 'Analog Module',
      designatorPrefix: 'U',
      pins: [
        { id: 'a', name: 'A', side: 'left', electrical: 'passive' },
        { id: 'b', name: 'B', side: 'right', electrical: 'passive' },
      ],
      internal: {
        name: 'series',
        origin: { x: 0, y: 0 },
        nodes: [
          {
            id: 'r1',
            definition: 'resistor',
            x: 0,
            y: 0,
            parameters: { resistance: scalar(100, 'ohm') },
          },
        ],
        edges: [],
        ports: [
          {
            id: 'a',
            label: 'r1 · a',
            side: 'left',
            inner: { nodeId: 'r1', handleId: 'terminal_a' },
          },
          {
            id: 'b',
            label: 'r1 · b',
            side: 'right',
            inner: { nodeId: 'r1', handleId: 'terminal_b' },
          },
        ],
      },
    })
    const nodes = [
      node('v1', 'power_source', { parameters: V5 }),
      node('m1', 'analog_module'),
      node('g1', 'ground'),
    ]
    expect(classifyCanvas(nodes)).toBe('analog')
  })

  test('the explicit fidelity=transistor opt-out beats the digital default', () => {
    registerNotModule()
    const tagged = node('m1', 'not_module', { fidelity: 'transistor' })
    const { nodes } = inverterCircuit(tagged, { in: 'in', out: 'out', vdd: 'v_dd', gnd: 'gnd' })
    expect(classifyCanvas(nodes)).toBe('analog')
  })

  test('a module NESTING another digital module still classifies LOGIC (internals resolved)', () => {
    registerNotModule()
    registerUserPart({
      id: 'wrapper_module',
      name: 'Wrapper Module',
      designatorPrefix: 'U',
      pins: [
        { id: 'in', name: 'IN', side: 'left', electrical: 'input' },
        { id: 'out', name: 'OUT', side: 'right', electrical: 'output' },
        { id: 'v_dd', name: 'V+', side: 'top', electrical: 'power_in' },
        { id: 'gnd', name: 'GND', side: 'bottom', electrical: 'power_in' },
      ],
      internal: {
        name: 'wrapper',
        origin: { x: 0, y: 0 },
        nodes: [{ id: 'inner', definition: 'not_module', x: 0, y: 0 }],
        edges: [],
        ports: [
          {
            id: 'in',
            label: 'inner · in',
            side: 'left',
            inner: { nodeId: 'inner', handleId: 'in' },
          },
          {
            id: 'out',
            label: 'inner · out',
            side: 'right',
            inner: { nodeId: 'inner', handleId: 'out' },
          },
          {
            id: 'v_dd',
            label: 'inner · v+',
            side: 'top',
            inner: { nodeId: 'inner', handleId: 'v_dd' },
          },
          {
            id: 'gnd',
            label: 'inner · gnd',
            side: 'bottom',
            inner: { nodeId: 'inner', handleId: 'gnd' },
          },
        ],
      },
    })
    const { nodes } = inverterCircuit(node('m1', 'wrapper_module'), {
      in: 'in',
      out: 'out',
      vdd: 'v_dd',
      gnd: 'gnd',
    })
    expect(classifyCanvas(nodes)).toBe('logic')
  })
})

describe('the dispatch runs the fast logic engine for a saved digital module', () => {
  test('the module takes the LOGIC path and answers exactly like its source block', () => {
    registerNotModule()
    // The same inverter, once as a canvas BLOCK and once as the saved MODULE.
    const blockNode = node('b1', 'block', { block: INVERTER_BLOCK })
    const asBlock = inverterCircuit(blockNode, { in: 'in', out: 'out', vdd: 'v_dd', gnd: 'gnd' })
    const moduleNode = node('m1', 'not_module')
    const asModule = inverterCircuit(moduleNode, { in: 'in', out: 'out', vdd: 'v_dd', gnd: 'gnd' })

    const blockResult = solveCanvasDispatch(asBlock.nodes, asBlock.edges)
    const moduleResult = solveCanvasDispatch(asModule.nodes, asModule.edges)

    // Both took the fast 0/1 engine (its solution is the digital seed: zero Newton iterations,
    // no branch currents) — the module did NOT fall onto the transistor solve.
    expect(blockResult.solution.iterations).toBe(0)
    expect(moduleResult.solution.iterations).toBe(0)
    expect(moduleResult.solution.status).toBe('solved')

    // And the answer is the same real logic: input HIGH → output LOW (0 V) on both.
    const blockOut = blockResult.terminalVolts.get('b1/out')
    const moduleOut = moduleResult.terminalVolts.get('m1/out')
    expect(blockOut).toBeDefined()
    expect(moduleOut).toBeDefined()
    expect(moduleOut).toBeCloseTo(blockOut ?? -1, 6)
    expect(moduleOut).toBeCloseTo(0, 6) // NOT(high) = low

    // The user's per-wire gauge + material survive the logic-path edge rebuild (they used to be
    // silently wiped on every re-solve once a canvas classified logic).
    const e1 = moduleResult.edges.find((e) => e.id === 'e1')
    expect((e1?.data as { gaugeAwg?: number }).gaugeAwg).toBe(18)
    expect((e1?.data as { material?: string }).material).toBe('copper')
  })
})

describe('mixed co-sim: a module’s output pin drives its analog load (the stripped-drive regression)', () => {
  test('a non-whitelist-named module output still classifies as an OUTPUT boundary', () => {
    // A COMPOSITE block wrapping an intact inverter, with its outer output port named 'y' (not in
    // LOGIC_OUTPUT_HANDLES) and declared push-pull — the block works via port.drive; the saved module
    // lost `drive` (solve core) so the boundary direction must come from the part's pin `electrical`.
    const renamed: BlockData = {
      name: 'Y wrapper',
      origin: { x: 0, y: 0 },
      nodes: [{ id: 'g', definition: 'block', x: 0, y: 0, block: INVERTER_BLOCK }],
      edges: [],
      ports: [
        { id: 'in', label: 'in', side: 'left', inner: { nodeId: 'g', handleId: 'in' } },
        {
          id: 'y',
          label: 'y',
          side: 'right',
          drive: 'push_pull',
          inner: { nodeId: 'g', handleId: 'out' },
        },
        { id: 'v_dd', label: 'v+', side: 'top', inner: { nodeId: 'g', handleId: 'v_dd' } },
        { id: 'gnd', label: 'gnd', side: 'bottom', inner: { nodeId: 'g', handleId: 'gnd' } },
      ],
    }
    const r = userPartFromBlock('Y Module', 'U', renamed)
    if (!r.ok) throw new Error(r.error)
    registerUserPart(r.part)

    // Drive in LOW → out HIGH: the module's y pin must push 5 V through the analog 1 kΩ load.
    const build = (gate: Node) => ({
      nodes: [
        node('v1', 'power_source', { parameters: V5 }),
        gate,
        node('r1', 'resistor', { parameters: { resistance: scalar(1000, 'ohm') } }),
        node('g1', 'ground'),
      ],
      edges: [
        {
          id: 'e1',
          source: 'v1',
          sourceHandle: 'terminal_positive',
          target: gate.id,
          targetHandle: 'v_dd',
        },
        {
          id: 'e2',
          source: gate.id,
          sourceHandle: 'in',
          target: 'v1',
          targetHandle: 'terminal_negative',
        },
        {
          id: 'e3',
          source: gate.id,
          sourceHandle: 'gnd',
          target: 'v1',
          targetHandle: 'terminal_negative',
        },
        { id: 'e4', source: gate.id, sourceHandle: 'y', target: 'r1', targetHandle: 'terminal_a' },
        {
          id: 'e5',
          source: 'r1',
          sourceHandle: 'terminal_b',
          target: 'v1',
          targetHandle: 'terminal_negative',
        },
        {
          id: 'e6',
          source: 'g1',
          sourceHandle: 'reference_terminal',
          target: 'v1',
          targetHandle: 'terminal_negative',
        },
      ] as unknown as Edge[],
    })

    const asBlock = build(node('b1', 'block', { block: renamed }))
    const asModule = build(node('m1', 'y_module'))
    expect(classifyCanvas(attachInternalCircuits(asBlock.nodes))).toBe('mixed')
    expect(classifyCanvas(attachInternalCircuits(asModule.nodes))).toBe('mixed')

    const blockLoad = solveCanvasDispatch(asBlock.nodes, asBlock.edges).terminalVolts.get(
      'r1/terminal_a',
    )
    const moduleLoad = solveCanvasDispatch(asModule.nodes, asModule.edges).terminalVolts.get(
      'r1/terminal_a',
    )
    expect(blockLoad).toBeCloseTo(5, 2) // the block drives its load
    expect(moduleLoad).toBeCloseTo(blockLoad ?? -1, 6) // …and the saved module drives it identically
  })
})

describe('attachInternalCircuits is a fixed point (the double-attach cycle regression)', () => {
  test('attaching an already-attached list returns it unchanged — even with mutually-referencing parts', () => {
    // A ↔ B (only reachable from a hand-edited file): the cycle guard leaves the innermost reference
    // as a black box; a SECOND attach pass must not expand it one more round (duplicating real parts).
    const pins: UserPart['pins'] = [
      { id: 'a', name: 'A', side: 'left', electrical: 'passive' },
      { id: 'b', name: 'B', side: 'right', electrical: 'passive' },
    ]
    const internalUsing = (definition: string): NonNullable<UserPart['internal']> => ({
      name: 'core',
      origin: { x: 0, y: 0 },
      nodes: [{ id: 'inner', definition, x: 0, y: 0 }],
      edges: [],
      ports: [
        { id: 'a', label: 'inner · a', side: 'left', inner: { nodeId: 'inner', handleId: 'a' } },
        { id: 'b', label: 'inner · b', side: 'right', inner: { nodeId: 'inner', handleId: 'b' } },
      ],
    })
    registerUserPart({
      id: 'a_part',
      name: 'A Part',
      designatorPrefix: 'U',
      pins,
      internal: internalUsing('b_part'),
    })
    registerUserPart({
      id: 'b_part',
      name: 'B Part',
      designatorPrefix: 'U',
      pins,
      internal: internalUsing('a_part'),
    })
    const nodes = [node('x1', 'a_part')]
    const once = attachInternalCircuits(nodes)
    const twice = attachInternalCircuits(once)
    expect(twice).toBe(once) // same array — the resolved tree is its own fixed point, no extra round
  })
})
