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
  parseChipdb,
  reachableFrom,
  rrgIntegrity,
  serializeChipdb,
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

describe('chipdb round-trip — the RRG serializes/parses in IceStorm chipdb vocabulary', () => {
  test('a generated fabric survives serialize → parse identically', () => {
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 3, 3)
    const back = parseChipdb(serializeChipdb(fabric))
    // device + arch + tiles
    expect(back.device.gridWidth).toBe(fabric.device.gridWidth)
    expect(back.device.gridHeight).toBe(fabric.device.gridHeight)
    expect(back.device.arch).toEqual(fabric.device.arch)
    expect(back.device.tiles).toEqual(fabric.device.tiles)
    // every node reconstructed exactly (id, kind, coords, track/pin/span)
    expect(back.rrg.nodes.size).toBe(fabric.rrg.nodes.size)
    for (const [id, node] of fabric.rrg.nodes) expect(back.rrg.nodes.get(id)).toEqual(node)
    // every pip reconstructed (from, to, kind) in order, and the parsed graph is still well-formed
    expect(back.rrg.pips.map((p) => `${p.from}->${p.to}:${p.kind}`)).toEqual(
      fabric.rrg.pips.map((p) => `${p.from}->${p.to}:${p.kind}`),
    )
    expect(rrgIntegrity(back.rrg).ok).toBe(true)
  })

  test('the span (Stage-2 segmentation) hook round-trips — serialize AND parse carry it', () => {
    // Stage 1 never sets span, so the fabric round-trip above can't prove it survives. Inject a
    // segmented wire (the Stage-2 shape) and confirm both directions carry span, end to end.
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 2, 1)
    fabric.rrg.nodes.set('seg', { id: 'seg', kind: 'chanx', x: 0, y: 0, track: 1, span: 4 })
    const back = parseChipdb(serializeChipdb(fabric))
    expect(back.rrg.nodes.get('seg')).toEqual({
      id: 'seg',
      kind: 'chanx',
      x: 0,
      y: 0,
      track: 1,
      span: 4,
    })
    // and span= parses straight from icebox-shaped text
    expect(parseChipdb('.net w chany 1 2 span=12').rrg.nodes.get('w')?.span).toBe(12)
  })

  test('a hand-written IceStorm-shaped snippet parses into the RRG types (schema is a data-load target)', () => {
    const snippet = [
      '# a hand-authored chipdb fragment in icebox vocabulary',
      '.device 2 2',
      '.arch k=4 n=1 i=4 w=2 fc_in=1 fc_out=1 fs=2',
      '.logic_tile 0 0',
      '.io_tile 1 0',
      '.net drv opin 0 0',
      '.net trk chanx 0 0 track=1',
      '.net ld ipin 1 0 pin=2',
      '.buffer drv trk',
      '.routing trk ld',
      '.foobar 9 9 ignored', // an unknown directive is skipped, not fatal
    ].join('\n')
    const fabric = parseChipdb(snippet)
    expect(fabric.device.gridWidth).toBe(2)
    expect(fabric.device.arch.k).toBe(4)
    expect(fabric.device.arch.clusterInputs).toBe(4)
    expect(fabric.device.tiles).toEqual([
      { x: 0, y: 0, kind: 'logic' },
      { x: 1, y: 0, kind: 'io' },
    ])
    expect(fabric.rrg.nodes.get('trk')).toEqual({ id: 'trk', kind: 'chanx', x: 0, y: 0, track: 1 })
    expect(fabric.rrg.nodes.get('ld')).toEqual({ id: 'ld', kind: 'ipin', x: 1, y: 0, pin: 2 })
    expect(fabric.rrg.pips).toHaveLength(2)
    expect(fabric.rrg.pips[0]).toEqual({
      id: 'p0',
      from: 'drv',
      to: 'trk',
      kind: 'buffer',
      configBits: null,
    })
    expect(fabric.rrg.pips[1]?.kind).toBe('routing')
    expect(rrgIntegrity(fabric.rrg).ok).toBe(true) // every pip endpoint resolved to a parsed node
  })
})
