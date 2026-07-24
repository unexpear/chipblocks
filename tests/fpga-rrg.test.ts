/**
 * FPGA fabric — Stage 1, increment 3: the fabric model / routing-resource graph (fpga-rrg.ts).
 * Proves the substrate the placer + router will stand on is well-formed and routable BEFORE those hard
 * engines exist: generateFabric emits an island RRG with no dangling pips, mirrored edge maps, every
 * routing resource reachable from the fabric's sources, and a real route between opposite corners — and
 * every pip carries the `configBits` hook Stage 2 will fill with iCE40 CRAM coordinates.
 */
import { describe, expect, test } from 'vitest'
import {
  clusterInputs,
  DEFAULT_FABRIC_ARCH,
  generateFabric,
  reachableFrom,
  rrgIntegrity,
} from '../src/renderer/fpga-rrg.ts'

describe('cluster-input math (research §1: I = ceil((k/2)(N+1)))', () => {
  test('the canonical sizes', () => {
    expect(clusterInputs(4, 1)).toBe(4) // ceil(2*2)
    expect(clusterInputs(4, 8)).toBe(18) // ceil(2*9)
    expect(clusterInputs(6, 10)).toBe(33) // ceil(3*11)
    expect(DEFAULT_FABRIC_ARCH.clusterInputs).toBe(4)
  })
})

describe('generateFabric — a well-formed island routing-resource graph', () => {
  test('a 3×3 fabric has 9 logic tiles and passes structural integrity', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    expect(fabric.device.tiles.length).toBe(9)
    expect(fabric.device.tiles.every((t) => t.kind === 'logic')).toBe(true)
    const { ok, issues } = rrgIntegrity(fabric.rrg)
    expect(issues).toEqual([])
    expect(ok).toBe(true)
  })

  test('every routing resource is reachable from the fabric sources — no isolated nodes', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    const sources = [...fabric.rrg.nodes.values()]
      .filter((n) => n.kind === 'source')
      .map((n) => n.id)
    const reached = reachableFrom(fabric.rrg, sources)
    const unreached = [...fabric.rrg.nodes.keys()].filter((id) => !reached.has(id))
    expect(unreached).toEqual([])
  })

  test('a route EXISTS from one corner tile to the opposite one (src 0,0 → sink 2,2)', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    const reached = reachableFrom(fabric.rrg, ['src_0_0'])
    expect(reached.has('opin_0_0')).toBe(true) // its own output pin
    expect(reached.has('sink_2_2')).toBe(true) // and clear across the fabric
  })

  test('the graph scales with the grid (a bigger fabric has strictly more nodes + pips)', () => {
    const small = generateFabric(DEFAULT_FABRIC_ARCH, 2, 2)
    const big = generateFabric(DEFAULT_FABRIC_ARCH, 4, 4)
    expect(big.rrg.nodes.size).toBeGreaterThan(small.rrg.nodes.size)
    expect(big.rrg.pips.length).toBeGreaterThan(small.rrg.pips.length)
    expect(rrgIntegrity(big.rrg).ok).toBe(true)
  })

  test('every pip carries the Stage-2 configBits hook (null in Stage 1) and a valid kind', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 2, 2)
    expect(fabric.rrg.pips.length).toBeGreaterThan(0)
    expect(fabric.rrg.pips.every((p) => p.configBits === null)).toBe(true)
    expect(fabric.rrg.pips.every((p) => p.kind === 'buffer' || p.kind === 'routing')).toBe(true)
  })

  test('sparser Fc (fewer taps per pin) still integrates and stays routable', () => {
    const sparse = generateFabric({ ...DEFAULT_FABRIC_ARCH, fcIn: 0.5, fcOut: 0.5 }, 3, 3)
    expect(rrgIntegrity(sparse.rrg).ok).toBe(true)
    const sources = [...sparse.rrg.nodes.values()]
      .filter((n) => n.kind === 'source')
      .map((n) => n.id)
    // with sparse Fc a route to every sink is no longer guaranteed, but sources must still reach routing
    const reached = reachableFrom(sparse.rrg, sources)
    expect([...reached].some((id) => id.startsWith('chanx_'))).toBe(true)
  })
})
