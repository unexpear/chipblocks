/**
 * Series ammeter tests (S20-v3-11) — the meter as a REAL circuit element:
 * a shunt behind a fuse between the probes. The headline pair: the correct
 * procedure (bridge a deliberately opened switch) reads the loop current
 * exactly with its honest burden, and the famous mistake (probes across a
 * live source on the mA jack) blows the 440 mA fuse — while the 10 A jack
 * survives the same 9 V abuse, exactly like the real instruments.
 */

import { describe, expect, test } from 'vitest'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { AMMETER_JACKS, seriesAmmeter, terminalNets } from '../src/renderer/meter.tsx'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** 9 V (1 Ω inside) → switch → 470 Ω → back. The demo-anchor loop. */
function switchLoop(switchState: 'open' | 'closed', internalOhms = 1) {
  const nodes: CanvasNode[] = [
    {
      id: 'bat',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(9, 'volt'),
        internal_resistance: scalar(internalOhms, 'ohm'),
      },
    },
    {
      id: 'sw',
      definition: 'switch_spst_toggle',
      parameters: { state: { value: switchState } },
    },
    { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'bat', sourceHandle: 'terminal_positive', target: 'sw', targetHandle: 'terminal_in' },
    { source: 'sw', sourceHandle: 'terminal_out', target: 'r1', targetHandle: 'terminal_a' },
    { source: 'r1', sourceHandle: 'terminal_b', target: 'bat', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'bat',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

function netOf(world: ReturnType<typeof switchLoop>, key: string): string {
  const net = terminalNets(world).get(key)
  if (net === undefined) throw new Error(`no net for ${key}`)
  return net
}

describe('the correct procedure: open the circuit, bridge the gap', () => {
  test('across an OPEN switch the meter completes the loop and reads it exactly', () => {
    // Loop with the meter in series: 9 V over (1 + 470 + 1.8 Ω shunt).
    const world = switchLoop('open')
    const result = seriesAmmeter(
      world,
      netOf(world, 'sw/terminal_in'),
      netOf(world, 'sw/terminal_out'),
      'milliamp',
    )
    if (result.status !== 'measured') throw new Error(`expected a reading, got ${result.status}`)
    expect(result.amps).toBeCloseTo(9 / (1 + 470 + 1.8), 9)
    // The burden is the shunt's real drop — what insertion costs.
    expect(result.burdenVolts).toBeCloseTo(result.amps * 1.8, 12)
  })

  test('the burden is honest: the inserted meter reads LESS than the unbroken loop carries', () => {
    const world = switchLoop('open')
    const result = seriesAmmeter(
      world,
      netOf(world, 'sw/terminal_in'),
      netOf(world, 'sw/terminal_out'),
      'milliamp',
    )
    if (result.status !== 'measured') throw new Error('expected a reading')
    const unbrokenAmps = 9 / (1 + 470)
    expect(result.amps).toBeLessThan(unbrokenAmps)
    // ...by exactly the shunt's share: same loop, 1.8 Ω more.
    expect(unbrokenAmps / result.amps).toBeCloseTo((1 + 470 + 1.8) / (1 + 470), 9)
  })

  test('reversed probes read the same current with the opposite sign', () => {
    const world = switchLoop('open')
    const forward = seriesAmmeter(
      world,
      netOf(world, 'sw/terminal_in'),
      netOf(world, 'sw/terminal_out'),
      'milliamp',
    )
    const reversed = seriesAmmeter(
      world,
      netOf(world, 'sw/terminal_out'),
      netOf(world, 'sw/terminal_in'),
      'milliamp',
    )
    if (forward.status !== 'measured' || reversed.status !== 'measured')
      throw new Error('expected readings')
    expect(forward.amps).toBeGreaterThan(0)
    expect(reversed.amps).toBeCloseTo(-forward.amps, 12)
  })

  test('both probes on the same net read zero — nothing to flow through the meter', () => {
    const world = switchLoop('closed')
    const net = netOf(world, 'r1/terminal_a')
    const result = seriesAmmeter(world, net, net, 'milliamp')
    if (result.status !== 'measured') throw new Error('expected a reading')
    expect(Math.abs(result.amps)).toBeLessThan(1e-12)
  })
})

describe('the famous mistake: probes across a live source', () => {
  test('mA jack across the 9 V battery → the 440 mA fuse blows, naming the current', () => {
    // The 1.8 Ω shunt lands straight across the source (1 Ω inside, the
    // 471 Ω loop in parallel barely matters): ~3.2 A through a 0.44 A fuse.
    const world = switchLoop('closed')
    const result = seriesAmmeter(
      world,
      netOf(world, 'bat/terminal_positive'),
      netOf(world, 'bat/terminal_negative'),
      'milliamp',
    )
    if (result.status !== 'blew') throw new Error(`expected the fuse to blow, got ${result.status}`)
    expect(Math.abs(result.amps)).toBeGreaterThan(3)
    expect(Math.abs(result.amps)).toBeLessThan(3.5)
    expect(Math.abs(result.amps)).toBeGreaterThan(AMMETER_JACKS.milliamp.fuseAmps)
  })

  test('the 10 A jack SURVIVES the same 9 V abuse — its fuse rating sits above the short current', () => {
    // 0.03 Ω across 9 V behind 1 Ω: ~8.7 A — under the 11 A fuse, exactly the
    // real-world fact that a fresh 9 V cannot blow a Fluke's amp-jack fuse.
    const world = switchLoop('closed')
    const result = seriesAmmeter(
      world,
      netOf(world, 'bat/terminal_positive'),
      netOf(world, 'bat/terminal_negative'),
      'amp',
    )
    if (result.status !== 'measured') throw new Error(`expected a reading, got ${result.status}`)
    expect(result.amps).toBeGreaterThan(8)
    expect(result.amps).toBeLessThan(9)
    expect(result.amps).toBeLessThan(AMMETER_JACKS.amp.fuseAmps)
  })

  test('a stiff source blows even the 11 A fuse', () => {
    // 9 V behind 0.02 Ω (a bench supply / car-battery class source): the
    // 0.03 Ω shunt sees ~180 A. POP.
    const world = switchLoop('closed', 0.02)
    const result = seriesAmmeter(
      world,
      netOf(world, 'bat/terminal_positive'),
      netOf(world, 'bat/terminal_negative'),
      'amp',
    )
    if (result.status !== 'blew') throw new Error(`expected the fuse to blow, got ${result.status}`)
    expect(Math.abs(result.amps)).toBeGreaterThan(100)
  })

  test('meter ACROSS a resistor disturbs the circuit honestly — it reads its own shunted share', () => {
    // In parallel with the 470 Ω the 1.8 Ω shunt steals nearly all the
    // current: the loop sees 1 + (470 ∥ 1.8) ohms and the shunt carries the
    // 470-side divider share. Real meters do exactly this damage.
    const world = switchLoop('closed')
    const result = seriesAmmeter(
      world,
      netOf(world, 'r1/terminal_a'),
      netOf(world, 'r1/terminal_b'),
      'milliamp',
    )
    if (result.status !== 'blew') throw new Error(`expected the fuse to blow, got ${result.status}`)
    // 9 / (1 + 1.793) ≈ 3.22 A total, ~all of it through the 1.8 Ω shunt.
    expect(Math.abs(result.amps)).toBeGreaterThan(3)
  })
})
