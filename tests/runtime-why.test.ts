import { describe, expect, test } from 'vitest'
import { asDiagnosticId, type RuntimeDiagnostic } from '../src/runtime-contracts.ts'
import {
  measurementWhy,
  runtimeAnalysisWithWhy,
  whyExplanation,
  whyForDiagnostic,
  whySystemFor,
} from '../src/runtime-why.ts'

const diagnostic = (code: string, state: RuntimeDiagnostic['state']): RuntimeDiagnostic => ({
  id: asDiagnosticId(`test-${code}`),
  code,
  severity: state === 'failed' ? 'error' : 'warning',
  state,
  message: `${code} happened`,
  repair: { action: 'select', message: 'Select the affected element.' },
})

describe('runtime why system', () => {
  test('preserves the source-to-output path and reports its first blocked hop', () => {
    const explanation = whyExplanation({
      id: 'why-missing-driver',
      state: 'blocked',
      summary: 'An input has no driver.',
      path: [
        { kind: 'terminal', label: 'IN', state: 'complete' },
        { kind: 'net', label: 'net n1', state: 'blocked' },
        { kind: 'device-state', label: 'waiting for input', state: 'blocked' },
        { kind: 'output', label: 'Q', state: 'blocked' },
      ],
      transitions: [{ from: 'ready', to: 'blocked', detail: 'No driver was found.' }],
    })
    expect(explanation.path.map((step) => step.kind)).toEqual([
      'terminal',
      'net',
      'device-state',
      'output',
    ])
    expect(explanation.firstBlockedHop?.label).toBe('net n1')
    expect(explanation.transitions[0]?.to).toBe('blocked')
  })

  test('solver warnings become one shared diagnostic explanation with repair guidance', () => {
    const analysis = runtimeAnalysisWithWhy('transient', 'over-budget', ['stopped at step 4'])
    expect(analysis.why).toMatchObject({ state: 'blocked' })
    expect(analysis.why?.explanations[0]).toMatchObject({
      cause: { kind: 'solver' },
      diagnostics: [{ code: 'transient-over-budget' }],
    })
    expect(analysis.why?.explanations[0]?.cause?.repair?.action).toBe('inspect')
  })

  test('unsupported warnings locate the affected device and offer selection repair', () => {
    const analysis = runtimeAnalysisWithWhy('dc', 'unsupported-element', [
      "Skipped resistor stamp for instance 'u1' because it is unsupported",
    ])
    expect(analysis.diagnostics[0]).toMatchObject({
      code: 'dc-unsupported-device',
      state: 'waiting',
      target: { blockId: 'u1' },
      repair: { action: 'select', target: { blockId: 'u1' } },
    })
  })

  test('diagnostic causes classify contention, overload, thermal, and incompatible inputs', () => {
    expect(whyForDiagnostic(diagnostic('output-contention', 'failed')).cause?.kind).toBe(
      'contention',
    )
    expect(whyForDiagnostic(diagnostic('resistor-overpower', 'failed')).cause?.kind).toBe(
      'overload',
    )
    expect(whyForDiagnostic(diagnostic('part-overtemperature', 'failed')).cause?.kind).toBe(
      'thermal',
    )
    expect(whyForDiagnostic(diagnostic('incompatible-connection', 'failed')).cause?.kind).toBe(
      'incompatible-connection',
    )
  })

  test('measurement results keep an honest blocked state instead of inventing a value', () => {
    const system = measurementWhy('meter', 'capacitance', 'over-range', 'Still charging.')
    expect(system.state).toBe('blocked')
    expect(system.observations).toEqual([])
    expect(system.explanations[0]?.cause?.kind).toBe('measurement')
    expect(system.explanations[0]?.diagnostics[0]?.repair?.action).toBe('inspect')
  })

  test('systems aggregate diagnostics and observations without losing the first blocked hop', () => {
    const first = whyExplanation({
      id: 'why-ready',
      state: 'complete',
      summary: 'Source drove the net.',
      path: [{ kind: 'source', label: 'V1', state: 'complete' }],
      observations: [
        { source: 'scope', label: 'voltage', detail: '5 V', quantity: { value: 5, unit: 'volt' } },
      ],
    })
    const second = whyExplanation({
      id: 'why-blocked',
      state: 'blocked',
      summary: 'The load is waiting.',
      path: [{ kind: 'net', label: 'n1', state: 'blocked' }],
    })
    const system = whySystemFor([first, second])
    expect(system.state).toBe('blocked')
    expect(system.diagnostics).toHaveLength(0)
    expect(system.observations[0]?.quantity).toEqual({ value: 5, unit: 'volt' })
    expect(system.firstBlockedHop?.label).toBe('n1')
  })
})
