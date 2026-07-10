/**
 * The transient solver's honesty check (the DC solver's, mirrored). The time-domain solver resolves
 * elements across SEVERAL passes, so an unknown definition used to be silently skipped — treated as an
 * open circuit with a plain 'solved' status, unlike DC's explicit "unsupported element" warning. Now a
 * primitive-device instance no transient pass models warns by name and flips the status to
 * 'unsupported-element' — while the SUPPORTED part of the circuit still genuinely runs (the series is
 * real, the electro-thermal loop keeps settling, the instruments can still display honest traces).
 * The no-false-warning sweep is the ledger's regression net: every solver pass's parts must stay quiet.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { LIGHT_CURRENT_DEFINITIONS } from '../src/dc-solver.ts'
import { solveTransientThermal } from '../src/electro-thermal.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import {
  solveTransient,
  TRANSIENT_SUPPORTED_DEFINITIONS,
  transientRan,
} from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

/** A charging RC loop (τ = 100 µs), optionally with a mystery black-box part across the capacitor. */
const rcWorld = (withMystery: boolean) => {
  const nodes: CanvasNode[] = [
    {
      id: 'v1',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(5, 'volt'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
    { id: 'c1', definition: 'capacitor', parameters: { capacitance: scalar(1e-6, 'farad') } },
    { id: 'gnd', definition: 'ground' },
    ...(withMystery ? [{ id: 'x1', definition: 'flux_capacitor' }] : []),
  ]
  const edges = [
    g('v1', 'terminal_positive', 'r1', 'terminal_a'),
    g('r1', 'terminal_b', 'c1', 'terminal_a'),
    g('c1', 'terminal_b', 'v1', 'terminal_negative'),
    g('gnd', 'reference_terminal', 'v1', 'terminal_negative'),
    // the mystery part hangs across the capacitor — wired, so it survives the floating-circuit prune
    ...(withMystery ? [g('x1', 'p1', 'c1', 'terminal_a'), g('x1', 'p2', 'c1', 'terminal_b')] : []),
  ]
  return canvasToWorld(nodes, edges)
}
const RC_OPTIONS = { timeStep: 2e-6, duration: 5e-4 } // 5 τ in 250 steps

describe('an unknown element in a transient run is surfaced, never silently skipped', () => {
  test('warns by name + flips the status — and the supported RC still genuinely runs', () => {
    const result = solveTransient(rcWorld(true), RC_OPTIONS)
    expect(result.status).toBe('unsupported-element')
    expect(
      result.warnings.some((w) => w.includes("Unsupported element 'x1' (flux_capacitor)")),
    ).toBe(true)
    // the real RC physics still ran: the cap charged to ~5 V over 5 τ
    const last = result.series.at(-1)
    const capNet = [...(last?.nodes.keys() ?? [])]
    expect(result.series.length).toBeGreaterThan(100)
    expect(capNet.length).toBeGreaterThan(0)
    const vCap = Math.max(...(last ? [...last.nodes.values()] : [0]))
    expect(vCap).toBeGreaterThan(4.8)
  })

  test('the electro-thermal loop keeps settling instead of bailing on the new status', () => {
    const { result } = solveTransientThermal(rcWorld(true), RC_OPTIONS)
    expect(result.status).toBe('unsupported-element')
    expect(result.series.length).toBeGreaterThan(100) // the run is real, not an aborted first pass
  })

  test('transientRan says the physics ran for both solved and unsupported-element', () => {
    expect(transientRan('solved')).toBe(true)
    expect(transientRan('unsupported-element')).toBe(true)
    expect(transientRan('no-ground')).toBe(false)
    expect(transientRan('singular-matrix')).toBe(false)
    expect(transientRan('did-not-converge')).toBe(false)
    expect(transientRan('bad-options')).toBe(false)
  })
})

describe('the ledger is complete — parsed from the solver source itself', () => {
  test('every definition ANY transient pass consumes is in TRANSIENT_SUPPORTED_DEFINITIONS', () => {
    // Enumerate the source: every `inst.definition === '…'` / `!== '…'` comparison in any pass, plus
    // the definition sets the passes key on (DIODE_DEFINITIONS is spread into the ledger itself;
    // LIGHT_CURRENT_DEFINITIONS is imported). A new element added to a pass but forgotten from the
    // ledger fails HERE — before it ever false-warns on a working circuit.
    const source = readFileSync('src/transient-solver.ts', 'utf8')
    const consumed = new Set<string>()
    for (const m of source.matchAll(/\.definition\s+[!=]==\s+'([a-z0-9_]+)'/g)) {
      consumed.add(m[1] as string)
    }
    for (const def of LIGHT_CURRENT_DEFINITIONS) consumed.add(def)
    expect(consumed.size).toBeGreaterThan(30) // the parse genuinely swept the passes
    const missing = [...consumed].filter((def) => !TRANSIENT_SUPPORTED_DEFINITIONS.has(def))
    expect(missing).toEqual([])
  })
})

describe('no false warnings — every transient pass’s parts stay quiet', () => {
  test('a plain RC circuit is a clean solved with zero unsupported warnings', () => {
    const result = solveTransient(rcWorld(false), RC_OPTIONS)
    expect(result.status).toBe('solved')
    expect(result.warnings.filter((w) => w.startsWith('Unsupported element'))).toEqual([])
  })

  test('a sweep across the separate passes (resistive, pot, chain, light-current) warns for none', () => {
    // One part per PASS, each wired rail-to-rail so the prune keeps it. Some may be skipped by their
    // own pass for missing params — that's their own (named) warning, never an "Unsupported element".
    const nodes: CanvasNode[] = [
      {
        id: 'v1',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(5, 'volt'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      { id: 'th1', definition: 'thermistor', parameters: { resistance: scalar(1000, 'ohm') } },
      { id: 'pot1', definition: 'potentiometer', parameters: { resistance: scalar(1000, 'ohm') } },
      { id: 'c1', definition: 'capacitor', parameters: { capacitance: scalar(1e-6, 'farad') } },
      { id: 'l1', definition: 'inductor', parameters: { inductance: scalar(1e-3, 'henry') } },
      { id: 'd1', definition: 'led' },
      { id: 'q1', definition: 'transistor_mosfet_nmos' },
      { id: 'pd1', definition: 'photodiode' },
      { id: 'sw1', definition: 'switch_spst_toggle' },
      { id: 'gnd', definition: 'ground' },
    ]
    const rail = (id: string, a: string, b: string) => [
      g('v1', 'terminal_positive', id, a),
      g(id, b, 'v1', 'terminal_negative'),
    ]
    const edges = [
      g('gnd', 'reference_terminal', 'v1', 'terminal_negative'),
      ...rail('r1', 'terminal_a', 'terminal_b'),
      ...rail('th1', 'terminal_a', 'terminal_b'),
      ...rail('pot1', 'terminal_a', 'terminal_b'),
      ...rail('c1', 'terminal_a', 'terminal_b'),
      ...rail('l1', 'terminal_a', 'terminal_b'),
      ...rail('d1', 'anode', 'cathode'),
      ...rail('q1', 'drain', 'source'),
      g('q1', 'gate', 'v1', 'terminal_positive'),
      ...rail('pd1', 'cathode', 'anode'),
      ...rail('sw1', 'terminal_in', 'terminal_out'),
    ]
    const result = solveTransient(canvasToWorld(nodes, edges), { timeStep: 1e-5, duration: 1e-3 })
    expect(result.warnings.filter((w) => w.startsWith('Unsupported element'))).toEqual([])
  })
})
