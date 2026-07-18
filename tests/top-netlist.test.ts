/**
 * TOP-LEVEL GATE NETLIST — the DEF connectivity source (chip-physical chapter, signoff C1). Verifies that
 * extractTopNetlist recovers which gate output drives which gate inputs, honours net-label teleports,
 * routes power pins away from the signal nets, and infers top-level I/O pins with a direction. These are the
 * connections def.ts turns into the DEF NETS / PINS / SPECIALNETS sections.
 */
import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { INVERTER_BLOCK, NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { extractTopNetlist } from '../src/renderer/top-netlist.ts'

const gate = (id: string, block: BlockData): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'block', block },
})
const label = (id: string, name: string): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'net_label', parameters: { net_name: { value: name } } },
})
const rail = (id: string, definition: 'power_source' | 'ground'): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition },
})
const wire = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): CanvasEdgeLike => ({ id, source, sourceHandle, target, targetHandle })

describe('extractTopNetlist', () => {
  test('a gate-free design yields nothing', () => {
    expect(extractTopNetlist([], [])).toEqual({
      signalNets: [],
      tieConnections: [],
      hasCells: false,
    })
    const r = extractTopNetlist([label('l', 'X')], [])
    expect(r).toEqual({ signalNets: [], tieConnections: [], hasCells: false })
  })

  test('recovers a gate-to-gate signal net (NAND output → inverter input) with A/B/Y pin names', () => {
    // g1 (NAND) out drives g2 (INV) in — one internal signal net, no top-level label.
    const nodes = [gate('g1', NAND2_BLOCK), gate('g2', INVERTER_BLOCK)]
    const edges = [wire('w', 'g1', 'out', 'g2', 'in')]
    const nl = extractTopNetlist(nodes, edges)
    expect(nl.hasCells).toBe(true)
    expect(nl.signalNets).toHaveLength(1)
    const net = nl.signalNets[0]
    expect(net?.pin).toBeUndefined() // no net-label → internal, not a top-level pin
    // the driver (NAND out → Y) and the sink (INV in → A) — pin names match the LEF macro
    expect(new Set(net?.connections.map((c) => `${c.instId}.${c.pin}`))).toEqual(
      new Set(['g1.Y', 'g2.A']),
    )
  })

  test('a named net-label makes a top-level pin; direction follows whether a gate drives it', () => {
    // L_A labels g1.a (fed from outside → INPUT); L_Y labels g2.out (driven by the chip → OUTPUT).
    const nodes = [
      gate('g1', NAND2_BLOCK),
      gate('g2', INVERTER_BLOCK),
      label('L_A', 'A_IN'),
      label('L_Y', 'RESULT'),
    ]
    const edges = [
      wire('w1', 'g1', 'out', 'g2', 'in'), // internal
      wire('w2', 'g1', 'a', 'L_A', 'p'), // g1.A ← input pin
      wire('w3', 'g2', 'out', 'L_Y', 'p'), // g2.Y → output pin
    ]
    const nl = extractTopNetlist(nodes, edges)
    const byName = new Map(nl.signalNets.map((n) => [n.name, n]))
    expect(byName.get('A_IN')?.pin).toEqual({ name: 'A_IN', direction: 'INPUT' })
    expect(byName.get('RESULT')?.pin).toEqual({ name: 'RESULT', direction: 'OUTPUT' })
    // the internal net is still there, unnamed → synthesized name, no pin
    const internal = nl.signalNets.find((n) => n.pin === undefined)
    expect(internal?.connections.map((c) => `${c.instId}.${c.pin}`).sort()).toEqual([
      'g1.Y',
      'g2.A',
    ])
  })

  test('two same-named net-labels teleport into ONE net (canvas-to-world semantics)', () => {
    // g1.out and g2.a both wear a "BUS" label but are NOT physically wired — they must merge into one net.
    const nodes = [
      gate('g1', NAND2_BLOCK),
      gate('g2', NAND2_BLOCK),
      label('L1', 'BUS'),
      label('L2', 'BUS'),
    ]
    const edges = [wire('w1', 'g1', 'out', 'L1', 'p'), wire('w2', 'g2', 'a', 'L2', 'p')]
    const nl = extractTopNetlist(nodes, edges)
    // one merged net named BUS carrying both the driver and the sink
    const bus = nl.signalNets.filter((n) => n.name === 'BUS')
    expect(bus).toHaveLength(1)
    expect(bus[0]?.connections.map((c) => `${c.instId}.${c.pin}`).sort()).toEqual(['g1.Y', 'g2.A'])
    // driven by a gate output → OUTPUT
    expect(bus[0]?.pin?.direction).toBe('OUTPUT')
  })

  test('a power/ground net is excluded from the signal nets (it is a SPECIALNETS wildcard)', () => {
    // wire the two gates' VDD pins together — a rail, not a routable signal.
    const nodes = [gate('g1', NAND2_BLOCK), gate('g2', NAND2_BLOCK)]
    const edges = [
      wire('sig', 'g1', 'out', 'g2', 'a'),
      wire('pwr', 'g1', 'v_dd', 'g2', 'v_dd'),
      wire('gnd', 'g1', 'gnd', 'g2', 'gnd'),
    ]
    const nl = extractTopNetlist(nodes, edges)
    // only the one signal net survives; the VDD and GND nets are dropped (covered by the wildcard)
    expect(nl.signalNets).toHaveLength(1)
    expect(nl.signalNets[0]?.connections.map((c) => `${c.instId}.${c.pin}`).sort()).toEqual([
      'g1.Y',
      'g2.A',
    ])
  })

  test('a gate input tied to a power/ground symbol becomes a rail TIE, not a floating net', () => {
    // wiring a gate input straight to a power_source '+' / ground is the app's only tie-hi / tie-lo.
    const nodes = [gate('g1', NAND2_BLOCK), rail('vdd', 'power_source'), rail('gnd', 'ground')]
    const edges = [
      wire('hi', 'vdd', 'terminal_positive', 'g1', 'a'), // A tied HIGH
      wire('lo', 'gnd', 'reference_terminal', 'g1', 'b'), // B tied LOW
    ]
    const nl = extractTopNetlist(nodes, edges)
    expect(nl.signalNets).toHaveLength(0) // neither tie is a routable signal net
    expect(nl.tieConnections).toContainEqual({ rail: 'VDD', instId: 'g1', pin: 'A' })
    expect(nl.tieConnections).toContainEqual({ rail: 'VSS', instId: 'g1', pin: 'B' })
  })

  test('a user net-label named VDD/VSS is renamed so it cannot collide with the power rails', () => {
    // DEF shares one net namespace across NETS + SPECIALNETS, so a signal net must never be named VDD/VSS.
    const nodes = [gate('g1', NAND2_BLOCK), gate('g2', INVERTER_BLOCK), label('L', 'VDD')]
    const edges = [wire('w', 'g1', 'out', 'g2', 'in'), wire('lab', 'g1', 'out', 'L', 'p')]
    const nl = extractTopNetlist(nodes, edges)
    // the labelled net exists but its name was uniquified away from the reserved rail name
    expect(nl.signalNets.map((n) => n.name)).not.toContain('VDD')
    expect(nl.signalNets.some((n) => n.name === 'VDD_1')).toBe(true)
    expect(nl.signalNets.find((n) => n.name === 'VDD_1')?.pin?.name).toBe('VDD_1')
  })

  test('every emitted net name is distinct (DEF requires unique net ids)', () => {
    // two separate internal nets, each synthesizing an n<i> name — they must never collide.
    const nodes = [gate('g1', NAND2_BLOCK), gate('g2', INVERTER_BLOCK), gate('g3', INVERTER_BLOCK)]
    const edges = [
      wire('w1', 'g1', 'out', 'g2', 'in'), // net {g1.Y, g2.A}
      wire('w2', 'g1', 'b', 'g3', 'in'), // net {g1.B, g3.A}
    ]
    const nl = extractTopNetlist(nodes, edges)
    const names = nl.signalNets.map((n) => n.name)
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(names.length) // all distinct
  })
})
