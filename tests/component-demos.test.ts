/**
 * Component-level starter DEMOS — the electromechanical parts wired to a driver so they run, solved
 * through the real dispatch. The DC-observable ones (DC motor, relay, potentiometer) check their
 * operating point; the transformer just has to converge (its step-up is an AC/transient story). These
 * mirror the browser's `comp-*-demo` template flows.
 */
import { describe, expect, test } from 'vitest'
import { defaultParameters } from '../src/renderer/part-defaults.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'

const sc = (a: number, u: string) => ({ value: { kind: 'scalar' as const, amount: a, unit: u } })
// biome-ignore lint/suspicious/noExplicitAny: minimal React Flow node/edge shapes for the solve
type Any = any
const dev = (id: string, definition: string, params: Record<string, unknown> = {}): Any => ({
  id,
  type: 'device',
  position: { x: 0, y: 0 },
  data: { definition, parameters: { ...defaultParameters(definition), ...params } },
})
const net = (id: string, s: string, sh: string, t: string, th: string): Any => ({
  id,
  type: 'net',
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})
const V = (v: number) => ({ nominal_voltage: sc(v, 'volt'), internal_resistance: sc(0, 'ohm') })

describe('component starter demos run through the real solve', () => {
  test('DC motor: 12 V through a closed switch reaches the motor', () => {
    const nodes = [
      dev('V1', 'power_source', V(12)),
      dev('SW', 'switch_spst_toggle', { state: { value: 'closed' } }),
      dev('M', 'dc_motor'),
      dev('G', 'ground'),
    ]
    const edges = [
      net('a', 'V1', 'terminal_positive', 'SW', 'terminal_in'),
      net('b', 'SW', 'terminal_out', 'M', 'terminal_positive'),
      net('c', 'M', 'terminal_negative', 'G', 'reference_terminal'),
      net('d', 'V1', 'terminal_negative', 'G', 'reference_terminal'),
    ]
    const solved = solveCanvasDispatch(nodes, edges)
    expect(solved.terminalVolts.get('M/terminal_positive') ?? 0).toBeGreaterThan(11)
  })

  test('relay: energizing the coil closes its contact onto a separate LED load', () => {
    const nodes = [
      dev('VC', 'power_source', V(5)),
      dev('SW', 'switch_spst_toggle', { state: { value: 'closed' } }),
      dev('K', 'relay'),
      dev('VL', 'power_source', V(12)),
      dev('RL', 'resistor', { resistance: sc(330, 'ohm') }),
      dev('DL', 'led'),
      dev('G', 'ground'),
    ]
    const edges = [
      net('a', 'VC', 'terminal_positive', 'SW', 'terminal_in'),
      net('b', 'SW', 'terminal_out', 'K', 'coil_a'),
      net('c', 'K', 'coil_b', 'G', 'reference_terminal'),
      net('d', 'VC', 'terminal_negative', 'G', 'reference_terminal'),
      net('e', 'VL', 'terminal_positive', 'K', 'common'),
      net('f', 'K', 'normally_open', 'RL', 'terminal_a'),
      net('g', 'RL', 'terminal_b', 'DL', 'anode'),
      net('h', 'DL', 'cathode', 'G', 'reference_terminal'),
      net('i', 'VL', 'terminal_negative', 'G', 'reference_terminal'),
    ]
    const solved = solveCanvasDispatch(nodes, edges)
    // The LED lights only if the contact closed (its anode sits at the LED forward drop, ~2 V).
    expect(solved.terminalVolts.get('DL/anode') ?? 0).toBeGreaterThan(1.5)
  })

  test('potentiometer: the wiper feeds a lit LED from a 5 V divider', () => {
    const nodes = [
      dev('V1', 'power_source', V(5)),
      dev('POT', 'potentiometer'),
      dev('RL', 'resistor', { resistance: sc(330, 'ohm') }),
      dev('DL', 'led'),
      dev('G', 'ground'),
    ]
    const edges = [
      net('a', 'V1', 'terminal_positive', 'POT', 'terminal_a'),
      net('b', 'POT', 'terminal_b', 'G', 'reference_terminal'),
      net('c', 'POT', 'wiper', 'RL', 'terminal_a'),
      net('d', 'RL', 'terminal_b', 'DL', 'anode'),
      net('e', 'DL', 'cathode', 'G', 'reference_terminal'),
      net('f', 'V1', 'terminal_negative', 'G', 'reference_terminal'),
    ]
    const solved = solveCanvasDispatch(nodes, edges)
    const wiper = solved.terminalVolts.get('POT/wiper') ?? 0
    expect(wiper).toBeGreaterThan(0.5)
    expect(wiper).toBeLessThan(5)
  })

  test('transformer: an AC-fed primary with a loaded secondary converges', () => {
    const nodes = [
      dev('VAC', 'power_source', {
        nominal_voltage: sc(0, 'volt'),
        ac_amplitude: sc(12, 'volt'),
        frequency: sc(60, 'hertz'),
      }),
      dev('XF', 'transformer'),
      dev('RL', 'resistor', { resistance: sc(1000, 'ohm') }),
      dev('G', 'ground'),
    ]
    const edges = [
      net('a', 'VAC', 'terminal_positive', 'XF', 'primary_a'),
      net('b', 'XF', 'primary_b', 'G', 'reference_terminal'),
      net('c', 'VAC', 'terminal_negative', 'G', 'reference_terminal'),
      net('d', 'XF', 'secondary_a', 'RL', 'terminal_a'),
      net('e', 'RL', 'terminal_b', 'XF', 'secondary_b'),
      net('f', 'XF', 'secondary_b', 'G', 'reference_terminal'),
    ]
    const solved = solveCanvasDispatch(nodes, edges)
    expect(solved.solution.converged).toBe(true)
  })
})
