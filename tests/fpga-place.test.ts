/**
 * FPGA fabric — Stage 1: the packer + placer + net extractor (fpga-place.ts), and the FULL end-to-end
 * acceptance test. Proves placement minimizes wirelength (SA cuts HPWL and is reproducible from a seed) and
 * — the payoff — that the whole mini-VPR flow COMPOSES: a real logic block goes gates → LUTs (coverToLuts) →
 * tiles (pack + place) → wires (routeDesign) → 0/1 sim (bridgeToSim + stepLogic), and its truth table is
 * bit-for-bit the golden gate simulation (characterizeBlock). Nothing hand-placed, nothing hand-routed.
 */
import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasNodeLike } from '../src/renderer/blocks.ts'
import {
  FULL_ADDER_BLOCK,
  HALF_ADDER_BLOCK,
  RIPPLE_CARRY_2BIT,
} from '../src/renderer/builtin-blocks.ts'
import { coverToLuts, type KLut } from '../src/renderer/fpga-fabric.ts'
import {
  coolingGamma,
  extractRouting,
  packLuts,
  placeClusters,
} from '../src/renderer/fpga-place.ts'
import { routeDesign } from '../src/renderer/fpga-router.ts'
import { DEFAULT_FABRIC_ARCH, generateFabric } from '../src/renderer/fpga-rrg.ts'
import { bridgeToSim, type Drive } from '../src/renderer/fpga-sim.ts'
import {
  type CompiledLogic,
  characterizeBlock,
  compileLogic,
  isOutputPort,
  POWER_PORT_IDS,
  stepLogic,
} from '../src/renderer/logic-sim.ts'

const blockCanvas = (block: BlockData): CanvasNodeLike[] => [
  { id: 'b', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
]
const outputNetsOf = (block: BlockData, compiled: CompiledLogic): Set<string> =>
  new Set(
    block.ports
      .filter((p) => !POWER_PORT_IDS.has(p.id.toLowerCase()) && isOutputPort(p))
      .map((p) => compiled.portNet('b', p.id)),
  )

/** A hand LUT netlist: three LUTs in a chain a→X→Y plus a shared input, so placement has something to optimize. */
const chainLuts = (): KLut[] => [
  { id: 'L0', k: 2, config: [false, false, false, true], inputs: ['a', 'b'], output: 'x' }, // x = a&b
  { id: 'L1', k: 2, config: [false, true, true, true], inputs: ['x', 'c'], output: 'y' }, // y = x|c
  { id: 'L2', k: 2, config: [false, true, true, false], inputs: ['y', 'a'], output: 'z' }, // z = y^a
]

/** A four-LUT chain — used with a 4-tile fabric so every accepted anneal move displaces an occupant (a dense grid). */
const fourLuts = (): KLut[] => [
  { id: 'L0', k: 2, config: [false, false, false, true], inputs: ['a', 'b'], output: 'w' },
  { id: 'L1', k: 2, config: [false, true, true, true], inputs: ['w', 'c'], output: 'x' },
  { id: 'L2', k: 2, config: [false, true, true, false], inputs: ['x', 'd'], output: 'y' },
  { id: 'L3', k: 2, config: [false, false, false, true], inputs: ['y', 'a'], output: 'z' },
]

/**
 * An n-LUT chain sharing one primary input: L0 = pi, Lᵢ = Lᵢ₋₁ ∧ pi. A scalable design whose annealing
 * TRAJECTORY affects the returned placement — used to stress incremental-cost exactness, determinism (a tiny
 * design converges to the same optimum regardless of trajectory, so it can't detect nondeterminism), and
 * schedule quality on a design big enough that the adaptive schedule's mechanisms actually matter.
 */
const sharedInputChain = (n: number): KLut[] =>
  Array.from({ length: n }, (_, i) =>
    i === 0
      ? { id: 'L0', k: 1, config: [false, true], inputs: ['pi'], output: 'w0' }
      : {
          id: `L${i}`,
          k: 2,
          config: [false, false, false, true],
          inputs: [`w${i - 1}`, 'pi'],
          output: `w${i}`,
        },
  )

/** A 2-D mesh: LUT[r][c] reads its left and up neighbour — a connectivity-rich design where spreading matters. */
const meshLuts = (side: number): KLut[] => {
  const luts: KLut[] = []
  for (let r = 0; r < side; r++)
    for (let c = 0; c < side; c++) {
      const inputs: string[] = []
      if (c > 0) inputs.push(`m_${r}_${c - 1}`)
      if (r > 0) inputs.push(`m_${r - 1}_${c}`)
      if (inputs.length === 0) inputs.push('pi')
      const k = Math.max(1, inputs.length)
      luts.push({
        id: `m_${r}_${c}`,
        k,
        config: Array(1 << k).fill(true),
        inputs,
        output: `m_${r}_${c}`,
      })
    }
  return luts
}

/** A star: one driver feeding many consumers — its identity placement scatters, so annealing has clear work. */
const starLuts = (fanout: number): KLut[] => [
  { id: 'D', k: 1, config: [false, true], inputs: ['pi'], output: 's' },
  ...Array.from({ length: fanout }, (_, i) => ({
    id: `C${i}`,
    k: 1,
    config: [false, true] as boolean[],
    inputs: ['s'],
    output: `o${i}`,
  })),
]

describe('packLuts — one BLE per tile (Stage-1 fabric)', () => {
  test('each LUT becomes its own single-BLE cluster', () => {
    const clusters = packLuts(chainLuts())
    expect(clusters.length).toBe(3)
    expect(clusters.every((c) => c.luts.length === 1)).toBe(true)
    expect(new Set(clusters.map((c) => c.id)).size).toBe(3) // distinct ids
  })
})

describe('placeClusters — SA minimizes half-perimeter wirelength', () => {
  test('annealing does not increase HPWL, and returns a valid one-cluster-per-tile placement', () => {
    const device = generateFabric(DEFAULT_FABRIC_ARCH, 4, 4).device
    const clusters = packLuts(chainLuts())
    const res = placeClusters(clusters, device, { seed: 1 })
    expect(res.fits).toBe(true)
    expect(res.hpwl).toBeLessThanOrEqual(res.initialHpwl) // SA never ships a worse placement than it started with
    // every cluster placed on a distinct real logic tile
    const tiles = [...res.placement.values()].map((t) => `${t.x}_${t.y}`)
    expect(tiles.length).toBe(3)
    expect(new Set(tiles).size).toBe(3)
    const logic = new Set(device.tiles.map((t) => `${t.x}_${t.y}`))
    for (const t of tiles) expect(logic.has(t)).toBe(true)
  })

  test('SA actually improves a deliberately-bad spread — final HPWL is strictly lower', () => {
    // A star net (one driver, many consumers) on a big grid: the identity placement scatters the consumers to
    // the far corners; annealing must pull them together, strictly cutting HPWL.
    const device = generateFabric(DEFAULT_FABRIC_ARCH, 6, 6).device
    const res = placeClusters(packLuts(starLuts(6)), device, { seed: 7 })
    expect(res.fits).toBe(true)
    expect(res.hpwl).toBeLessThan(res.initialHpwl)
  })

  test('best-seen: even a flat/short anneal (cooling 1, few moves) never returns worse than the initial', () => {
    // placeClusters returns the BEST placement seen, not the final SA state. Returning the final state would
    // ship a random-walk endpoint worse than doing nothing under a warm/short schedule; best-seen makes
    // hpwl ≤ initialHpwl hold under ANY schedule. (Reverting to the final state reddens this across these seeds.)
    const device = generateFabric(DEFAULT_FABRIC_ARCH, 6, 6).device
    const clusters = packLuts(starLuts(7))
    for (const seed of [0, 1, 2, 3, 5, 8, 13, 21, 34, 55]) {
      const res = placeClusters(clusters, device, { seed, cooling: 1, moves: 40 })
      expect(res.hpwl).toBeLessThanOrEqual(res.initialHpwl)
    }
  })

  test('the reported hpwl exactly equals an independent full HPWL recompute (the incremental Δ stays exact)', () => {
    // The annealer scores each move as a Δ over only the affected nets rather than recomputing the whole HPWL.
    // If that Δ accounting ever drifted, the running cost would diverge from the truth — so recompute the HPWL
    // of the returned placement from scratch and require it to match exactly, over a design big enough (a
    // 20-LUT chain) that thousands of incremental moves accumulate.
    const clusters = packLuts(sharedInputChain(20))
    const device = generateFabric(DEFAULT_FABRIC_ARCH, 6, 6).device
    const res = placeClusters(clusters, device, { seed: 3 })

    const driverOf = new Map<string, string>()
    for (const c of clusters) for (const l of c.luts) driverOf.set(l.output, c.id)
    const netEnds = new Map<string, Set<string>>()
    for (const c of clusters)
      for (const l of c.luts)
        for (const w of l.inputs) {
          const s = netEnds.get(w) ?? new Set<string>()
          s.add(c.id)
          const d = driverOf.get(w)
          if (d !== undefined) s.add(d)
          netEnds.set(w, s)
        }
    let hpwl = 0
    for (const ids of netEnds.values()) {
      const pts = [...ids].map((id) => res.placement.get(id)).filter((p) => p !== undefined)
      if (pts.length < 2) continue
      const xs = pts.map((p) => (p as { x: number }).x)
      const ys = pts.map((p) => (p as { y: number }).y)
      hpwl += Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys))
    }
    expect(res.hpwl).toBe(hpwl)
  })

  test('on a DENSE grid (clusters == tiles) the annealed placement stays a true permutation — no tile double-booked', () => {
    // A 2×2 fabric has exactly 4 logic tiles and we place 4 clusters, so EVERY accepted move displaces an
    // occupant — exercising the swap-with-occupant path the sparse test never hits. After annealing the
    // placement must still be a bijection onto distinct tiles. (A double-booking swap bug reddens this.)
    const device = generateFabric(DEFAULT_FABRIC_ARCH, 2, 2).device
    const clusters = packLuts(fourLuts())
    for (const seed of [1, 2, 3, 4, 5, 7, 13, 42, 99]) {
      const res = placeClusters(clusters, device, { seed })
      expect(res.fits).toBe(true)
      expect(res.placement.size).toBe(4)
      const tiles = [...res.placement.values()].map((t) => `${t.x}_${t.y}`)
      expect(new Set(tiles).size).toBe(4) // 4 distinct tiles — no cluster shares a tile with another
    }
  })

  test('deterministic: same seed ⇒ identical placement AND hpwl; a design larger than the fabric reports fits:false', () => {
    // Use a NON-TRIVIAL design (20-LUT chain on 6×6) whose annealing TRAJECTORY affects the returned placement.
    // A tiny 3-cluster design converges to the same optimum regardless of the trajectory, so it can't detect a
    // stray nondeterministic tiebreak (e.g. a Math.random in the accept path) — on this design, injected
    // nondeterminism diverges run-to-run and reddens this directly, rather than relying on the flow suite.
    const clusters = packLuts(sharedInputChain(20))
    const device = generateFabric(DEFAULT_FABRIC_ARCH, 6, 6).device
    const a = placeClusters(clusters, device, { seed: 42 })
    const b = placeClusters(clusters, device, { seed: 42 })
    expect([...a.placement.entries()]).toEqual([...b.placement.entries()])
    expect(a.hpwl).toBe(b.hpwl)
    expect(a.initialHpwl).toBe(b.initialHpwl)

    const tiny = generateFabric(DEFAULT_FABRIC_ARCH, 1, 1).device // 1 tile ⇒ 20 clusters cannot fit
    expect(placeClusters(clusters, tiny, { seed: 1 }).fits).toBe(false)
  })

  test('congestionWeight defaults to 0 — a congestion map with no weight leaves the placement unchanged', () => {
    // Pins the no-regression guarantee: the congestion cost is inert unless a caller opts in with a weight,
    // so shipping congestion support did not alter pure-HPWL placement. (Raising the default to nonzero would
    // change these placements and redden this test.)
    const device = generateFabric(DEFAULT_FABRIC_ARCH, 4, 4).device
    const clusters = packLuts(chainLuts())
    const congestion = new Map([
      ['chanx_0', 5],
      ['chany_1', 3],
    ])
    const base = placeClusters(clusters, device, { seed: 3 })
    const withMapNoWeight = placeClusters(clusters, device, { seed: 3, congestion }) // weight defaults to 0
    expect([...withMapNoWeight.placement.entries()]).toEqual([...base.placement.entries()])
    expect(withMapNoWeight.hpwl).toBe(base.hpwl)
    // and opting in DOES change the objective (so the term is real, not dead): with every channel congested,
    // any net spans a congested channel, so the reported cost carries a real penalty above pure wirelength.
    const allChannels = new Map<string, number>()
    for (let i = 0; i < 4; i++) {
      allChannels.set(`chanx_${i}`, 5)
      allChannels.set(`chany_${i}`, 5)
    }
    const withWeight = placeClusters(clusters, device, {
      seed: 3,
      congestion: allChannels,
      congestionWeight: 8,
    })
    expect(withWeight.hpwl).toBeGreaterThan(base.hpwl)
  })

  test('the adaptive schedule beats a long fixed-budget anneal on larger designs — pins the range limiter', () => {
    // The range limiter (rlim shrinking toward α ≈ 0.44) is what makes the cold phase do LOCAL swaps instead
    // of random long-distance ones; freezing it at full range costs 20–40% wirelength on large designs, yet
    // every existing test still passes (they anneal tiny grids where rlim barely moves). Guard it behaviourally:
    // on larger designs with room to spread, the DEFAULT adaptive schedule reaches STRICTLY SHORTER wirelength
    // than the same placer run as a long fixed geometric anneal (moves = clusters × tiles × 20, full-range
    // throughout) — the scaling claim, made testable. Freezing rlim (or gutting the adaptive schedule) makes the
    // default tie-or-lose against that long anneal and reddens this. Everything is seeded, so it is exact, not flaky.
    for (const { luts, grid, seed } of [
      { luts: sharedInputChain(60), grid: 14, seed: 2 },
      { luts: meshLuts(7), grid: 12, seed: 1 },
      { luts: meshLuts(7), grid: 12, seed: 4 },
    ]) {
      const clusters = packLuts(luts)
      const device = generateFabric(DEFAULT_FABRIC_ARCH, grid, grid).device
      const tiles = device.tiles.filter((t) => t.kind === 'logic').length
      const adaptive = placeClusters(clusters, device, { seed })
      const fixedLong = placeClusters(clusters, device, {
        seed,
        moves: clusters.length * tiles * 20,
      })
      expect(adaptive.hpwl).toBeLessThan(fixedLong.hpwl)
    }
  })

  test('an explicit moves budget is clamped — Infinity terminates, NaN/negative is a no-op, not undefined behaviour', () => {
    // Termination is a required invariant under ANY options. The fixed-schedule loop `for (m=0; m<moves; m++)`
    // has no finiteness guard of its own, so a stray moves:Infinity would spin forever. The clamp makes Infinity
    // (and NaN/negative) degrade to "zero moves ⇒ return the initial placement". WITHOUT the clamp this test
    // hangs on the Infinity case — so it guards the clamp directly.
    const device = generateFabric(DEFAULT_FABRIC_ARCH, 4, 4).device
    const clusters = packLuts(chainLuts())
    for (const moves of [Number.POSITIVE_INFINITY, Number.NaN, -5, 0]) {
      const res = placeClusters(clusters, device, { seed: 1, moves })
      expect(res.hpwl).toBe(res.initialHpwl) // zero moves ⇒ the initial placement, unchanged
      expect(res.fits).toBe(true)
      expect(res.placement.size).toBe(3)
    }
    // a normal finite budget still anneals (the clamp only rejects non-finite/non-positive budgets)
    const normal = placeClusters(clusters, device, { seed: 1, moves: 400 })
    expect(normal.hpwl).toBeLessThanOrEqual(normal.initialHpwl)
  })
})

describe('coolingGamma — the VPR VPlace temperature-cooling band table', () => {
  test('selects the Betz–Rose γ band from the acceptance rate α, and always cools (γ < 1)', () => {
    // These four bands are VPR's published VPlace schedule — pinning the exact constants here means a refactor
    // cannot silently invert, drop, or mis-tune a band. No placement-quality test catches a broken γ (scrambling
    // it barely moves final wirelength, since best-seen + the range limiter mask it), so this unit test is the
    // only guard on the schedule's SHAPE.
    expect(coolingGamma(0.99)).toBe(0.5) // far too hot ⇒ cool fast
    expect(coolingGamma(0.9)).toBe(0.9) // hot ⇒ ease off
    expect(coolingGamma(0.5)).toBe(0.95) // productive band ⇒ dwell
    expect(coolingGamma(0.05)).toBe(0.8) // nearly frozen ⇒ cool faster again
    // band boundaries are strict `>`, so a value ON a threshold falls into the LOWER band
    expect(coolingGamma(0.96)).toBe(0.9)
    expect(coolingGamma(0.8)).toBe(0.95)
    expect(coolingGamma(0.15)).toBe(0.8)
    // every band cools — this is what guarantees the anneal terminates
    for (const alpha of [0, 0.1, 0.15, 0.44, 0.8, 0.96, 1])
      expect(coolingGamma(alpha)).toBeLessThan(1)
  })
})

describe('extractRouting — logical nets → physical route nets + placed LUTs', () => {
  test('internal nets become RouteNets to distinct ipins; primary inputs pass through by name', () => {
    const clusters = packLuts(chainLuts())
    const device = generateFabric(DEFAULT_FABRIC_ARCH, 4, 4).device
    const { placement } = placeClusters(clusters, device, { seed: 3 })
    const ex = extractRouting(clusters, placement)

    // x and y are internal (LUT-driven) ⇒ routed; a, b, c are primary inputs ⇒ passed through
    expect(new Set(ex.nets.map((n) => n.id))).toEqual(new Set(['x', 'y']))
    expect(new Set(ex.primaryInputs)).toEqual(new Set(['a', 'b', 'c']))
    // each internal net sources at its driver's src node and sinks at an ipin
    for (const net of ex.nets) {
      expect(net.source.startsWith('src_')).toBe(true)
      expect(net.sinks.every((s) => s.startsWith('ipin_'))).toBe(true)
    }
    // every driven net is readable at a src node; three LUTs ⇒ three placed luts
    expect(ex.netDriverNode.has('z')).toBe(true) // the design output
    expect(ex.placedLuts.length).toBe(3)
    expect(ex.placedLuts.every((l) => l.output.startsWith('src_'))).toBe(true)
  })

  test('a partial (!fits) placement is rejected loudly — never silently shorted onto tile (0,0)', () => {
    const clusters = packLuts(chainLuts())
    const tiny = generateFabric(DEFAULT_FABRIC_ARCH, 1, 1).device // 1 tile, 3 clusters ⇒ fits:false
    const { placement, fits } = placeClusters(clusters, tiny, { seed: 1 })
    expect(fits).toBe(false)
    // extracting an incomplete placement would collapse LUTs onto (0,0) and short distinct nets — it must throw
    expect(() => extractRouting(clusters, placement)).toThrow(/not placed/)
  })
})

/**
 * The full acceptance harness: map a block to LUTs, pack + place them, route the internal nets, then sweep
 * every input combination through bridgeToSim + stepLogic and read the outputs at their driver tiles.
 * Returns the truth-table rows, or null if placement/routing failed (so a failure is loud, never a false pass).
 */
function characterizeViaFabric(
  block: BlockData,
  grid: number,
  seed: number,
  k = 4,
): {
  rows: boolean[][]
  inputs: string[]
  outputs: string[]
  internalNets: number
  routedPips: number
} | null {
  const compiled = compileLogic(blockCanvas(block), [])
  const nonPower = block.ports.filter((p) => !POWER_PORT_IDS.has(p.id.toLowerCase()))
  const outputs = nonPower.filter(isOutputPort).map((p) => p.id)
  const inputs = nonPower.filter((p) => !isOutputPort(p)).map((p) => p.id)

  const luts = coverToLuts(compiled, outputNetsOf(block, compiled), k)
  const fabric = generateFabric(DEFAULT_FABRIC_ARCH, grid, grid)
  const clusters = packLuts(luts)
  const { placement, fits } = placeClusters(clusters, fabric.device, { seed })
  if (!fits) return null
  const ex = extractRouting(clusters, placement)
  const route = routeDesign(fabric.rrg, ex.nets)
  if (!route.routed) return null

  // node to READ each block output on = the src of the LUT that drives its net (or the net itself if a PI passes through)
  const readNodeOf = (portId: string): string => {
    const net = compiled.portNet('b', portId)
    return ex.netDriverNode.get(net) ?? net
  }
  const inputNetOf = (portId: string): string => compiled.portNet('b', portId)

  const rows: boolean[][] = []
  for (let combo = 0; combo < 1 << inputs.length; combo++) {
    const inBits = inputs.map((_, i) => ((combo >> i) & 1) === 1)
    const drives: Drive[] = inputs.map((port, i) => ({
      node: inputNetOf(port),
      high: inBits[i] as boolean,
    }))
    const sim = stepLogic(bridgeToSim(fabric.rrg, route.onPips, ex.placedLuts, drives))
    rows.push(outputs.map((port) => sim.value(readNodeOf(port), '') === true))
  }
  return { rows, inputs, outputs, internalNets: ex.nets.length, routedPips: route.onPips.size }
}

describe('END-TO-END: a block placed + routed on the fabric computes its golden truth table', () => {
  for (const block of [HALF_ADDER_BLOCK, FULL_ADDER_BLOCK, RIPPLE_CARRY_2BIT]) {
    test(`${block.name}: map → pack → place → route → sim equals the golden gate simulation (k=4)`, () => {
      const golden = characterizeBlock(block)
      expect(golden).not.toBeNull()
      const viaFabric = characterizeViaFabric(block, 4, 1)
      expect(viaFabric).not.toBeNull() // placement + routing succeeded — no silent skip
      // bit-for-bit identical to the golden truth table, computed entirely through the placed+routed fabric
      expect(viaFabric?.rows).toEqual(golden?.rows.map((r) => r.out))
    })
  }

  // At k=4 the mapper folds each output cone into ONE LUT reading primary inputs, so the adders route almost
  // nothing. Forcing k=2 makes many small LUTs with real LUT→LUT nets, so the whole flow — and the router in
  // particular — is genuinely stressed: the design only computes the golden table if placement + routing are
  // both correct across MULTIPLE internal nets.
  for (const { block, grid } of [
    { block: FULL_ADDER_BLOCK, grid: 5 },
    { block: RIPPLE_CARRY_2BIT, grid: 6 },
  ]) {
    test(`${block.name} at k=2: real internal nets are placed + routed, still equals the golden table`, () => {
      const golden = characterizeBlock(block)
      const viaFabric = characterizeViaFabric(block, grid, 1, 2)
      expect(viaFabric).not.toBeNull()
      expect(viaFabric?.internalNets ?? 0).toBeGreaterThan(1) // genuinely multi-net routing, not a trivial case
      expect(viaFabric?.routedPips ?? 0).toBeGreaterThan(0) // the router actually laid wires
      expect(viaFabric?.rows).toEqual(golden?.rows.map((r) => r.out))
    })
  }
})
