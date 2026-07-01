/**
 * The partition primitives that route a mixed canvas — `findBridges` in particular, the digital↔analog
 * boundary finder both co-sim coordinators (DC solveCanvasMixed, transient solveTransientCoSim) build on.
 * It was inline-duplicated in both; lifting it into partition.ts is the step that lets them share one
 * coordinator, so it earns a direct test of the boundary classification.
 */

import { describe, expect, test } from 'vitest'
import type { DriveKind } from '../src/renderer/blocks.ts'
import { findBridges } from '../src/renderer/pipeline/partition.ts'

describe('findBridges — the digital↔analog boundary primitive', () => {
  const edges = [
    // a logic OUTPUT (push-pull 'out') → an analog LED: the logic DRIVES the analog
    { id: 'e_out', source: 'gate', sourceHandle: 'out', target: 'led', targetHandle: 'anode' },
    // an analog node → a logic INPUT ('in'): the analog DRIVES the logic (read back)
    {
      id: 'e_in',
      source: 'sensor',
      sourceHandle: 'terminal_a',
      target: 'gate',
      targetHandle: 'in',
    },
    // logic ↔ logic: not a boundary
    { id: 'e_ll', source: 'gate', sourceHandle: 'out', target: 'gate2', targetHandle: 'in' },
    // logic ↔ a passive supply: not a real load, so not a boundary
    {
      id: 'e_pwr',
      source: 'gate',
      sourceHandle: 'vdd',
      target: 'supply',
      targetHandle: 'terminal_positive',
    },
  ]
  const logicIds = new Set(['gate', 'gate2'])
  const isRealLoad = (id: string) => id === 'led' || id === 'sensor'
  const driveOf = (_id: string, handle: string): DriveKind | undefined =>
    handle === 'out' ? 'push_pull' : handle === 'in' ? 'input' : undefined

  test('finds only logic↔real-analog crossings, classified by drive direction', () => {
    const bridges = findBridges(edges, logicIds, isRealLoad, driveOf)
    expect(bridges.map((b) => b.edgeId).sort()).toEqual(['e_in', 'e_out'])
    expect(bridges.find((b) => b.edgeId === 'e_out')).toMatchObject({
      logicId: 'gate',
      logicHandle: 'out',
      analogId: 'led',
      analogHandle: 'anode',
      output: true, // push-pull drive → the logic drives the analog
    })
    expect(bridges.find((b) => b.edgeId === 'e_in')).toMatchObject({
      logicId: 'gate',
      logicHandle: 'in',
      analogId: 'sensor',
      output: false, // input pin → the analog drives the logic
    })
  })

  test('a known output handle name counts as an output even without a declared drive', () => {
    const bridges = findBridges(
      [{ id: 'e', source: 'g', sourceHandle: 'q', target: 'led', targetHandle: 'anode' }],
      new Set(['g']),
      () => true,
      () => undefined, // no declared drive — falls back to the handle name
    )
    expect(bridges[0]?.output).toBe(true) // 'q' is a LOGIC_OUTPUT_HANDLES name
  })
})
