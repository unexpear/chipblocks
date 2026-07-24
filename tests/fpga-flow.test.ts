/**
 * FPGA fabric — Stage 1: the routability-driven place-and-route loop (fpga-flow.ts).
 * Proves the outer loop actually closes the placement↔routing gap: a chain whose shortest-wirelength
 * placement the router CANNOT legalize on a width-1 fabric routes only after the router's congestion is fed
 * back into re-placement — and the recovered routing is electrically correct. Also proves it routes cleanly
 * on the first attempt when there's room, composes with the real flow (a mapped block → golden truth table),
 * and fails HONESTLY (fits:false, or exhausted attempts with the overused channels named).
 */
import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { RIPPLE_CARRY_2BIT } from '../src/renderer/builtin-blocks.ts'
import { coverToLuts, type KLut } from '../src/renderer/fpga-fabric.ts'
import { placeAndRoute } from '../src/renderer/fpga-flow.ts'
import { extractRouting, packLuts, placeClusters } from '../src/renderer/fpga-place.ts'
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

/** A tight fabric arch: one track per channel, so a compact placement over-subscribes a channel. */
const W1 = { ...DEFAULT_FABRIC_ARCH, channelWidth: 1, fs: 1 }

/**
 * An AND-chain sharing one primary input: L0 = pi, Lᵢ = Lᵢ₋₁ ∧ pi, so every wire equals pi and the output
 * w_{n-1} = pi. That makes it both a congestion generator (a line of internal nets the router must thread
 * through the channels) and an electrical probe — a dropped or mis-routed wire breaks output == pi.
 */
const andChain = (n: number): KLut[] =>
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

const blockCanvas = (block: BlockData): CanvasNodeLike[] => [
  { id: 'b', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
]
const outputNetsOf = (block: BlockData, compiled: CompiledLogic): Set<string> =>
  new Set(
    block.ports
      .filter((p) => !POWER_PORT_IDS.has(p.id.toLowerCase()) && isOutputPort(p))
      .map((p) => compiled.portNet('b', p.id)),
  )

describe('placeAndRoute — congestion feedback recovers a placement the router could not legalize', () => {
  test('a chain that FAILS single-shot on a width-1 fabric routes after congestion-driven re-placement', () => {
    const clusters = packLuts(andChain(6))
    const fabric = generateFabric(W1, 3, 3)

    // The seed is held FIXED across attempts, so attempt 1 IS this placement — and the router cannot legalize
    // it (the shortest-wirelength layout packs the chain onto too few channels for a width-1 fabric).
    const oneShot = placeClusters(clusters, fabric.device, { seed: 6 })
    expect(routeDesign(fabric.rrg, extractRouting(clusters, oneShot.placement).nets).routed).toBe(
      false,
    )

    // The loop: same seed each round, only the router's congestion feedback moving the nets — it converges.
    const pr = placeAndRoute(clusters, fabric, { seed: 6, maxAttempts: 10 })
    expect(pr.routed).toBe(true)
    expect(pr.fits).toBe(true)
    expect(pr.attempts).toBeGreaterThan(1) // one placement was NOT enough — feedback was required
    expect(pr.congestion.size).toBeGreaterThan(0) // it actually accumulated per-channel congestion

    // The KEY control: with the SAME fixed seed but the feedback OFF (weight 0), every attempt re-places
    // identically and the loop can never recover. So the recovery above is the congestion feedback doing the
    // work, not a lucky random restart.
    const noFeedback = placeAndRoute(clusters, fabric, {
      seed: 6,
      maxAttempts: 10,
      congestionWeight: 0,
    })
    expect(noFeedback.routed).toBe(false)

    // The recovered routing is electrically correct: output w5 tracks pi through the routed chain.
    const read = pr.extraction?.netDriverNode.get('w5') as string
    for (const hi of [true, false]) {
      const sim = stepLogic(
        bridgeToSim(fabric.rrg, pr.route?.onPips ?? new Set(), pr.extraction?.placedLuts ?? [], [
          { node: 'pi', high: hi },
        ]),
      )
      expect(sim.value(read, '')).toBe(hi)
    }
  })

  test('a harder placement takes MORE feedback rounds — congestion accumulates channel by channel', () => {
    const pr = placeAndRoute(packLuts(andChain(6)), generateFabric(W1, 3, 3), {
      seed: 2,
      maxAttempts: 12,
    })
    expect(pr.routed).toBe(true)
    expect(pr.attempts).toBeGreaterThan(2) // seed 2 needs several rounds, not just one re-place
    expect(pr.congestion.size).toBeGreaterThan(1) // several channels got fed back before it spread enough
  })
})

describe('placeAndRoute — routes cleanly and composes with the real flow', () => {
  test('a design that fits comfortably routes on the FIRST attempt with no congestion feedback', () => {
    const pr = placeAndRoute(packLuts(andChain(6)), generateFabric(DEFAULT_FABRIC_ARCH, 6, 6), {
      seed: 1,
    })
    expect(pr.routed).toBe(true)
    expect(pr.attempts).toBe(1)
    expect(pr.congestion.size).toBe(0) // nothing was overused, so nothing was fed back
  })

  test('a real block (2-bit ripple carry, k=2) placed+routed through the loop computes its golden truth table', () => {
    const block = RIPPLE_CARRY_2BIT
    const compiled = compileLogic(blockCanvas(block), [])
    const nonPower = block.ports.filter((p) => !POWER_PORT_IDS.has(p.id.toLowerCase()))
    const outputs = nonPower.filter(isOutputPort).map((p) => p.id)
    const inputs = nonPower.filter((p) => !isOutputPort(p)).map((p) => p.id)

    const luts = coverToLuts(compiled, outputNetsOf(block, compiled), 2)
    const fabric = generateFabric(DEFAULT_FABRIC_ARCH, 6, 6)
    const pr = placeAndRoute(packLuts(luts), fabric, { seed: 1 })
    expect(pr.routed).toBe(true)

    const golden = characterizeBlock(block)
    const readNodeOf = (portId: string): string =>
      pr.extraction?.netDriverNode.get(compiled.portNet('b', portId)) ??
      compiled.portNet('b', portId)
    const rows: boolean[][] = []
    for (let combo = 0; combo < 1 << inputs.length; combo++) {
      const drives: Drive[] = inputs.map((port, i) => ({
        node: compiled.portNet('b', port),
        high: ((combo >> i) & 1) === 1,
      }))
      const sim = stepLogic(
        bridgeToSim(
          fabric.rrg,
          pr.route?.onPips ?? new Set(),
          pr.extraction?.placedLuts ?? [],
          drives,
        ),
      )
      rows.push(outputs.map((port) => sim.value(readNodeOf(port), '') === true))
    }
    expect(rows).toEqual(golden?.rows.map((r) => r.out))
  })
})

describe('placeAndRoute — fails honestly with a diagnostic', () => {
  test('a design larger than the fabric returns fits:false and never fakes a route', () => {
    const pr = placeAndRoute(packLuts(andChain(6)), generateFabric(DEFAULT_FABRIC_ARCH, 1, 1), {
      seed: 1,
    })
    expect(pr.routed).toBe(false)
    expect(pr.fits).toBe(false)
    expect(pr.route).toBeNull() // routing was never attempted on an unplaceable design
    expect(pr.attempts).toBe(1) // no point re-placing a design that cannot fit
  })

  test('a design that cannot be legalized even with feedback exhausts its attempts and names the overused channels', () => {
    const pr = placeAndRoute(packLuts(andChain(9)), generateFabric(W1, 3, 3), {
      seed: 0,
      maxAttempts: 8,
    })
    expect(pr.routed).toBe(false)
    expect(pr.fits).toBe(true) // it fit; it just could not be routed on this poor fabric
    expect(pr.attempts).toBe(8) // it tried every round before giving up
    expect(pr.route?.overused.length ?? 0).toBeGreaterThan(0) // the failure is NAMED, not a silent give-up
  })

  test('maxAttempts ≤ 0 is clamped to one real attempt — never a fabricated fits:true with nothing placed', () => {
    // A degenerate maxAttempts must still place+check once, so the reported fits/route reflect reality rather
    // than the loop's fall-through defaults. On a 1-tile fabric a 6-LUT design genuinely does not fit.
    for (const maxAttempts of [0, -3]) {
      const pr = placeAndRoute(packLuts(andChain(6)), generateFabric(DEFAULT_FABRIC_ARCH, 1, 1), {
        seed: 1,
        maxAttempts,
      })
      expect(pr.fits).toBe(false) // actually computed, not the hardcoded fall-through fits:true
      expect(pr.routed).toBe(false)
      expect(pr.route).toBeNull()
      expect(pr.attempts).toBe(1)
    }
    // and a routable design still routes under maxAttempts:0 (clamped to one attempt)
    const ok = placeAndRoute(packLuts(andChain(6)), generateFabric(DEFAULT_FABRIC_ARCH, 6, 6), {
      seed: 1,
      maxAttempts: 0,
    })
    expect(ok.routed).toBe(true)
    expect(ok.attempts).toBe(1)
  })
})

describe('placeAndRoute — deterministic', () => {
  test('same (clusters, fabric, options) ⇒ identical routed, attempts, and ON-pip set — even through the feedback loop', () => {
    const clusters = packLuts(andChain(6))
    // (a) a first-shot case, and (b) a case that runs several feedback rounds — both must reproduce exactly.
    for (const { fabric, opts } of [
      { fabric: generateFabric(DEFAULT_FABRIC_ARCH, 6, 6), opts: { seed: 1 } },
      // seed 2 runs several feedback rounds AND its per-round congestion magnitudes matter — so a
      // nondeterministic feedback (e.g. a stray Math.random in the bump) diverges run-to-run and reddens this.
      { fabric: generateFabric(W1, 3, 3), opts: { seed: 2, maxAttempts: 12 } },
    ]) {
      const a = placeAndRoute(clusters, fabric, opts)
      const b = placeAndRoute(clusters, fabric, opts)
      expect(a.routed).toBe(true)
      expect(a.routed).toBe(b.routed)
      expect(a.attempts).toBe(b.attempts)
      expect([...(a.route?.onPips ?? [])].sort()).toEqual([...(b.route?.onPips ?? [])].sort())
    }
  })
})
