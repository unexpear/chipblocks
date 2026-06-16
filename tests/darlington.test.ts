/**
 * Darlington pair block — proof it's two cascaded NPN BJTs, not one. Wired as an emitter
 * follower and solved through the real flatten-and-solve pipeline, the emitter sits ~1.3 V
 * below the base: TWO base-emitter junctions in series (a single transistor would drop ~0.7 V).
 * That doubled drop is the Darlington signature, and it falls out of the two real BJTs.
 */

import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import { type CanvasEdgeLike, type CanvasNodeLike, flattenBlocks } from '../src/renderer/blocks.ts'
import { DARLINGTON_BLOCK, PHOTO_DARLINGTON_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

/**
 * Wire the Darlington as an emitter follower — base ← Vb, collector ← Vc, emitter → 1 kΩ → GND
 * — flatten + solve, and return the solved base and emitter node voltages.
 */
function follower(baseVolts: number, collectorVolts: number): { vBase: number; vEmit: number } {
  const nodes: CanvasNodeLike[] = [
    { id: 'd', position: { x: 0, y: 0 }, data: { definition: 'block', block: DARLINGTON_BLOCK } },
    {
      id: 'vb',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(baseVolts) },
    },
    {
      id: 'vc',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(collectorVolts) },
    },
    {
      id: 're',
      position: { x: 0, y: 0 },
      data: { definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
    },
    { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
  ]
  const edges: CanvasEdgeLike[] = [
    {
      id: 'e_vb',
      source: 'vb',
      sourceHandle: 'terminal_positive',
      target: 'd',
      targetHandle: 'base',
    },
    {
      id: 'e_vbn',
      source: 'vb',
      sourceHandle: 'terminal_negative',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
    {
      id: 'e_vc',
      source: 'vc',
      sourceHandle: 'terminal_positive',
      target: 'd',
      targetHandle: 'collector',
    },
    {
      id: 'e_vcn',
      source: 'vc',
      sourceHandle: 'terminal_negative',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
    { id: 'e_re', source: 'd', sourceHandle: 'emitter', target: 're', targetHandle: 'terminal_a' },
    {
      id: 'e_ren',
      source: 're',
      sourceHandle: 'terminal_b',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
  ]
  const flat = flattenBlocks(nodes, edges)
  const world = canvasToWorld(
    flat.nodes.map((n) => ({
      id: n.id,
      definition: n.data.definition,
      parameters: n.data.parameters,
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
  const netOf = (portId: string): string | undefined => {
    const t = flat.portTarget.get(`d/${portId}`)
    return t
      ? world.instances.get(t.nodeId)?.connects?.find((c) => c.terminal === t.handleId)?.net
      : undefined
  }
  return {
    vBase: solution.nodes.get(netOf('base') ?? '') ?? Number.NaN,
    vEmit: solution.nodes.get(netOf('emitter') ?? '') ?? Number.NaN,
  }
}

describe('Darlington pair block — two cascaded NPN BJTs', () => {
  test('the emitter follows the base one DOUBLED V_BE drop below (~1.3 V)', () => {
    const { vBase, vEmit } = follower(5, 9)
    expect(vBase).toBeCloseTo(5, 6) // ideal base source
    expect(vEmit).toBeGreaterThan(3) // it conducts and follows
    // Two base-emitter junctions in series — clearly more than one ~0.7 V drop.
    expect(vBase - vEmit).toBeGreaterThan(1.0)
    expect(vBase - vEmit).toBeLessThan(1.7)
  })
})

/**
 * Wire the photo-Darlington with a collector pull-up (V+ → 1 kΩ → collector, emitter → GND)
 * and the phototransistor input stage set to `lux` lux; return the solved collector voltage.
 */
function photoCollector(lux: number): number {
  const nodes: CanvasNodeLike[] = [
    {
      id: 'pd',
      position: { x: 0, y: 0 },
      data: { definition: 'block', block: PHOTO_DARLINGTON_BLOCK },
    },
    {
      id: 'vp',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(9) },
    },
    {
      id: 'rc',
      position: { x: 0, y: 0 },
      data: { definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
    },
    { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
  ]
  const edges: CanvasEdgeLike[] = [
    {
      id: 'e_vp',
      source: 'vp',
      sourceHandle: 'terminal_positive',
      target: 'rc',
      targetHandle: 'terminal_a',
    },
    {
      id: 'e_rc',
      source: 'rc',
      sourceHandle: 'terminal_b',
      target: 'pd',
      targetHandle: 'collector',
    },
    {
      id: 'e_em',
      source: 'pd',
      sourceHandle: 'emitter',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
    {
      id: 'e_vpn',
      source: 'vp',
      sourceHandle: 'terminal_negative',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
  ]
  const flat = flattenBlocks(nodes, edges)
  const world = canvasToWorld(
    flat.nodes.map((n) => ({
      id: n.id,
      definition: n.data.definition,
      // Illuminate the phototransistor input stage (light is its "base" drive).
      parameters:
        n.data.definition === 'phototransistor'
          ? { ...n.data.parameters, ambient_illuminance: scalar(lux, 'lux') }
          : n.data.parameters,
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
  const t = flat.portTarget.get('pd/collector')
  const net = t
    ? world.instances.get(t.nodeId)?.connects?.find((c) => c.terminal === t.handleId)?.net
    : undefined
  return solution.nodes.get(net ?? '') ?? Number.NaN
}

describe('Photo-Darlington block — phototransistor input stage + BJT', () => {
  test('dark → off (collector near V+); lit → conducting hard (collector pulled low)', () => {
    expect(photoCollector(0)).toBeGreaterThan(8) // dark: ~9 V, the composite is off
    expect(photoCollector(50)).toBeLessThan(3) // lit: photocurrent × β2 pulls the collector down
  })
})
