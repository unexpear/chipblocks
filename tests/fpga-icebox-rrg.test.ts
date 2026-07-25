/**
 * FPGA fabric — Stage 2, increment 2: convert a REAL iCE40 icebox device into the Stage-1 routing-resource
 * graph and route on it (fpga-icebox-rrg.ts). Two verbatim genuine-iCE40 fixtures (Project IceStorm, device
 * "384", ISC-licensed): a connected 3-wire routing slice (a real lutff_2/out → span12 → span4 path) proves
 * the UNCHANGED PathFinder router runs on real topology and that the routed pips map back to the real CRAM
 * bits they program; the original all-dangling fragment proves excluded pips are fully reported, never
 * silently dropped. Nothing here models logic cells / placement / LUT-init / timing (deferred) — routing
 * topology only.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  cramBitsForRoute,
  type IceboxWire,
  parseIceboxChipdb,
} from '../src/renderer/fpga-icebox.ts'
import {
  classifyWire,
  cramBitsForRoutedPips,
  rrgFromIcebox,
  wireNodeId,
} from '../src/renderer/fpga-icebox-rrg.ts'
import { routeDesign } from '../src/renderer/fpga-router.ts'
import {
  DEFAULT_FABRIC_ARCH,
  generateFabric,
  reachableFrom,
  rrgIntegrity,
} from '../src/renderer/fpga-rrg.ts'

const SLICE = parseIceboxChipdb(
  readFileSync(
    new URL('../fixtures/icebox-ice40-384-routing-slice.chipdb', import.meta.url),
    'utf8',
  ),
)
const FRAGMENT = parseIceboxChipdb(
  readFileSync(new URL('../fixtures/icebox-ice40-384-fragment.chipdb', import.meta.url), 'utf8'),
)

/** A synthetic icebox wire from a list of segment names, for classifier unit tests. */
const wire = (index: number, ...names: string[]): IceboxWire => ({
  index,
  name: names[0] ?? '',
  segments: names.map((name, i) => ({ x: i, y: 0, name })),
  span: names.length,
})

describe('classifyWire — real iCE40 wire-name → RRG kind', () => {
  test('classifies each family from its real segment names', () => {
    expect(classifyWire(wire(1, 'lutff_0/out')).kind).toBe('opin') // cell output pin
    expect(classifyWire(wire(2, 'lutff_0/lout')).kind).toBe('opin')
    expect(classifyWire(wire(3, 'lutff_7/cout')).kind).toBe('opin') // carry-chain output
    expect(classifyWire(wire(4, 'io_0/D_IN_0')).kind).toBe('opin') // pad-in drives the fabric
    expect(classifyWire(wire(5, 'lutff_0/in_2')).kind).toBe('ipin') // LUT input pin
    expect(classifyWire(wire(6, 'io_0/D_OUT_1')).kind).toBe('ipin')
    expect(classifyWire(wire(7, 'lutff_global/clk')).kind).toBe('ipin') // global control input
    expect(classifyWire(wire(8, 'carry_in')).kind).toBe('ipin')
    expect(classifyWire(wire(9, 'sp4_h_r_13')).kind).toBe('chanx') // horizontal span-4 track
    expect(classifyWire(wire(10, 'span12_horz_7')).kind).toBe('chanx')
    expect(classifyWire(wire(11, 'sp4_v_b_0')).kind).toBe('chany') // vertical span-4 track
    expect(classifyWire(wire(12, 'span4_vert_t_12')).kind).toBe('chany')
    expect(classifyWire(wire(13, 'sp4_r_v_b_0')).kind).toBe('chany') // the shifted vertical variant
    expect(classifyWire(wire(14, 'glb_netwk_3')).kind).toBe('global') // chip-wide clock net
    expect(classifyWire(wire(15, 'fabout')).kind).toBe('global')
    expect(classifyWire(wire(16, 'padin_1')).kind).toBe('global')
    expect(classifyWire(wire(17, 'local_g0_1')).kind).toBe('local') // tile-local interconnect
    expect(classifyWire(wire(18, 'neigh_op_bnr_2')).kind).toBe('local')
  })

  test('a multi-name net classifies by its truest role — a driver pin wins over local aliases', () => {
    // Net 2246 is REALLY a LUT output (lutff_2/out) but also appears as logic_op_*/neigh_op_* in the tiles it
    // reaches; ~36% of real nets carry several names. Scanning all names and preferring the driver pin makes it
    // classify as opin, not local. (Classifying by the FIRST segment name alone would wrongly say 'local'.)
    const multi = classifyWire(wire(2246, 'logic_op_tnr_2', 'lutff_2/out', 'neigh_op_bot_2'))
    expect(multi.kind).toBe('opin')
    // canonical tile + span come from the segment list
    expect({ x: multi.x, y: multi.y, span: multi.span }).toEqual({ x: 0, y: 0, span: 3 })
  })

  test('order-dependent multi-family wires classify by priority — the real cases that pin the scan order', () => {
    // These pit two REAL kinds against each other (not a real kind vs the `local` fallback), so a priority
    // inversion between two real families reddens here instead of shipping green.
    // Carry chain: ONE net is both the driver `cout` and the next cell's `carry_in` — the driver (opin) wins.
    expect(classifyWire(wire(1, 'lutff_7/cout', 'carry_in')).kind).toBe('opin')
    // A fabric-out that also aliases a global-control pin is a GLOBAL net, not an input pin (global before ipin).
    expect(classifyWire(wire(2, 'fabout', 'io_global/latch')).kind).toBe('global')
    // …but a bare global-control pin (no global-network name) is still an input pin.
    expect(classifyWire(wire(3, 'io_global/latch')).kind).toBe('ipin')
    // A corner-wrapping span classifies by its DOMINANT orientation, not whichever end is matched first:
    // 2 vertical + 1 horizontal segment ⇒ chany; 2 horizontal + 1 vertical ⇒ chanx.
    expect(classifyWire(wire(4, 'span4_vert_b_0', 'span4_vert_b_4', 'span4_horz_l_12')).kind).toBe(
      'chany',
    )
    expect(classifyWire(wire(5, 'span4_horz_r_0', 'span4_horz_r_4', 'span4_vert_t_12')).kind).toBe(
      'chanx',
    )
  })
})

describe('rrgFromIcebox — build the routing-resource graph from a real device', () => {
  const built = rrgFromIcebox(SLICE)

  test('every wire becomes a well-formed node with real id, kind, canonical tile, and span', () => {
    expect(wireNodeId(2246)).toBe('w2246')
    const cellOut = built.rrg.nodes.get('w2246')
    expect(cellOut).toMatchObject({ kind: 'opin', x: 2, y: 0, span: 9 }) // segments[0] = "2 0 logic_op_tnr_2"
    expect(built.rrg.nodes.get('w76')).toMatchObject({ kind: 'chanx', x: 0, y: 1, span: 8 }) // span12_horz
    expect(built.rrg.nodes.get('w122')).toMatchObject({ kind: 'chanx', x: 0, y: 1, span: 5 }) // span4_horz
    expect(built.report.nodesByKind.opin).toBe(1)
    expect(built.report.nodesByKind.chanx).toBe(2)
  })

  test('every .buffer/.routing becomes a directional pip carrying its REAL CRAM condition, and the graph is sound', () => {
    expect(rrgIntegrity(built.rrg).ok).toBe(true) // no pip references a missing node
    const drive = built.rrg.pips.find((p) => p.from === 'w2246' && p.to === 'w76')
    expect(drive?.kind).toBe('buffer')
    expect(drive?.configBits).toEqual([{ bit: { row: 4, col: 47 }, value: 1 }]) // real bit B4[47]=1 at (3,1)
    const hop = built.rrg.pips.find((p) => p.from === 'w76' && p.to === 'w122')
    expect(hop?.configBits).toEqual([{ bit: { row: 0, col: 2 }, value: 1 }])
    expect(built.report).toMatchObject({
      wiresTotal: 3,
      pipsTotal: 2,
      pipsIncluded: 2,
      pipsExcluded: 0,
    })
  })

  test('the UNCHANGED PathFinder router routes a real cell-output → track path over the derived graph', () => {
    // Routability probe first, then the real router.
    expect(reachableFrom(built.rrg, ['w2246']).has('w122')).toBe(true)
    const result = routeDesign(built.rrg, [{ id: 'n', source: 'w2246', sinks: ['w122'] }])
    expect(result.routed).toBe(true)
    // it went through BOTH real buffer pips
    const pipIds = new Set(built.rrg.pips.map((p) => p.id))
    for (const on of result.onPips) expect(pipIds.has(on)).toBe(true)
    expect(result.onPips.size).toBe(2)
  })

  test('a routed design maps back to the REAL CRAM bits it programs (the Stage-3 bitstream bridge)', () => {
    const result = routeDesign(built.rrg, [{ id: 'n', source: 'w2246', sinks: ['w122'] }])
    const cram = cramBitsForRoutedPips(result.onPips, built.pipToIcebox)
    expect(cram.conflicts).toEqual([])
    expect(cram.unknownPips).toEqual([])
    const asText = cram.bits.map((b) => `${b.x},${b.y}:B${b.row}[${b.col}]=${b.value}`).sort()
    expect(asText).toEqual(['1,1:B0[2]=1', '3,1:B4[47]=1']) // exactly the two real pips' bits
    // identical to running the existing cramBitsForRoute on the raw IceboxPips directly
    const raw = cramBitsForRoute([...built.pipToIcebox.values()])
    expect(new Set(cram.bits.map((b) => `${b.x},${b.y}:B${b.row}[${b.col}]=${b.value}`))).toEqual(
      new Set(raw.bits.map((b) => `${b.x},${b.y}:B${b.row}[${b.col}]=${b.value}`)),
    )
  })

  test('a closed .routing switch is included as a routing pip carrying its pattern-derived CRAM condition', () => {
    // The routing-slice fixture is all .buffer; a .routing pip must survive the SAME inclusion path with its
    // kind and its per-bit pattern preserved. (A regression that mislabeled routing pips as buffer, or dropped
    // their configBits, would otherwise ship green — no fixture exercises an INCLUDED .routing pip.)
    const device = parseIceboxChipdb(
      [
        '.device T 4 4 2',
        '.net 0',
        '0 0 wa',
        '.net 1',
        '1 0 wb',
        '.routing 0 0 1 B2[3] B2[4]',
        '01 0',
      ].join('\n'),
    )
    const { rrg } = rrgFromIcebox(device)
    const pip = rrg.pips.find((p) => p.from === 'w0' && p.to === 'w1')
    expect(pip?.kind).toBe('routing')
    expect(pip?.configBits).toEqual([
      { bit: { row: 2, col: 3 }, value: 0 },
      { bit: { row: 2, col: 4 }, value: 1 },
    ])
  })

  test('cramBitsForRoutedPips surfaces a foreign pip id in unknownPips instead of silently dropping it', () => {
    // The safety net must FIRE, not just be trivially empty on the happy path: a pip id not from this graph
    // (e.g. mixed in from another graph) is reported, while the genuine pip still contributes its bits.
    const cram = cramBitsForRoutedPips(['ip0', 'not-a-pip'], built.pipToIcebox)
    expect(cram.unknownPips).toEqual(['not-a-pip'])
    expect(cram.bits.length).toBeGreaterThan(0) // 'ip0' is a real pip, so its CRAM bits are still emitted
  })
})

describe('rrgFromIcebox — pips with a missing endpoint wire are excluded and fully reported', () => {
  test('the all-dangling fragment yields zero pips and a complete exclusion accounting — never a silent drop', () => {
    // The fragment defines only wires 0 and 79, but all 5 of its pips reference other (undefined) wires, so
    // every pip is excluded as missing-both. The report accounts for all of them.
    const built = rrgFromIcebox(FRAGMENT)
    expect(built.rrg.pips).toEqual([])
    expect([...built.rrg.nodes.keys()].sort()).toEqual(['w0', 'w79'])
    expect(built.rrg.nodes.get('w0')?.kind).toBe('global') // fabout
    expect(built.rrg.nodes.get('w79')?.kind).toBe('chanx') // span4_horz_0
    expect(built.report).toMatchObject({
      wiresTotal: 2,
      pipsTotal: 5,
      pipsIncluded: 0,
      pipsExcluded: 5,
      excludedMissingBoth: 5,
      excludedMissingSrc: 0,
      excludedMissingDst: 0,
    })
    expect(built.report.excluded.length).toBe(5)
    expect(built.report.excluded.every((e) => e.reason === 'missing-both')).toBe(true)
    // the three sub-counts sum to pipsExcluded exactly (no double counting)
    const { excludedMissingSrc, excludedMissingDst, excludedMissingBoth, pipsExcluded } =
      built.report
    expect(excludedMissingSrc + excludedMissingDst + excludedMissingBoth).toBe(pipsExcluded)
  })

  test('a pip missing only its src vs only its dst is labelled and counted by which end dangles', () => {
    // The fragment only ever produces missing-both, so the single-endpoint sub-buckets would go untested — a
    // mislabel (missing-src ↔ missing-dst) or a wrong excluded[] entry would ship green. Exercise each directly.
    const device = parseIceboxChipdb(
      [
        '.device T 4 4 2',
        '.net 0',
        '0 0 wa',
        '.net 1',
        '1 0 wb',
        '.buffer 2 2 1 B0[0]', // dst 1 defined, src 99 undefined ⇒ missing-src
        '1 99',
        '.buffer 3 3 99 B0[1]', // dst 99 undefined, src 0 defined ⇒ missing-dst
        '1 0',
      ].join('\n'),
    )
    const { rrg, report } = rrgFromIcebox(device)
    expect(rrg.pips).toEqual([]) // neither pip is fully connected
    expect(report).toMatchObject({
      pipsIncluded: 0,
      pipsExcluded: 2,
      excludedMissingSrc: 1,
      excludedMissingDst: 1,
      excludedMissingBoth: 0,
    })
    // the excluded[] entries carry the right tile, endpoints, and reason (not just a count)
    expect(report.excluded).toContainEqual({ x: 2, y: 2, src: 99, dst: 1, reason: 'missing-src' })
    expect(report.excluded).toContainEqual({ x: 3, y: 3, src: 0, dst: 99, reason: 'missing-dst' })
  })
})

describe('schema: widening Pip.configBits did not disturb the synthetic Stage-1 fabric', () => {
  test('generateFabric still emits configBits === null on every pip and stays structurally sound', () => {
    const { rrg } = generateFabric(DEFAULT_FABRIC_ARCH, 4, 4)
    expect(rrg.pips.length).toBeGreaterThan(0)
    expect(rrg.pips.every((p) => p.configBits === null)).toBe(true)
    expect(rrgIntegrity(rrg).ok).toBe(true)
  })
})
