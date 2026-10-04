import type { BlockData, BlockTestCase } from './blocks.ts'
import { MAX_TRACE_CYCLES, runTrace, type TraceInputs, type TraceResult } from './run-trace.ts'

export type BlockTestFailure = {
  cycle: number
  signal: string
  expected: number | null
  actual: number | null
  reason?: string
}

export type BlockTestResult = {
  test: BlockTestCase
  trace: TraceResult | null
  passed: boolean
  failures: BlockTestFailure[]
}

const traceInputs = (inputs: Record<string, number>): TraceInputs => new Map(Object.entries(inputs))

const validCycles = (cycles: number): boolean =>
  Number.isInteger(cycles) && cycles >= 1 && cycles <= MAX_TRACE_CYCLES

export function createBlockTestCase(
  block: BlockData,
  id: string,
  name: string,
  cycles: number,
  inputs: TraceInputs,
): BlockTestCase | null {
  if (!validCycles(cycles) || [...inputs.values()].some((value) => !Number.isSafeInteger(value)))
    return null
  const trace = runTrace(block, cycles, inputs)
  if (
    trace === null ||
    trace.cycles.length !== cycles ||
    trace.outputs.length === 0 ||
    trace.cycles.some((cycle) => !cycle.settled)
  )
    return null
  const expected: Record<string, number[]> = {}
  for (const signal of trace.outputs) {
    const values = trace.cycles.map((cycle) => cycle.values.get(signal.name))
    if (values.some((value) => value === undefined)) return null
    expected[signal.name] = values as number[]
  }
  return {
    id,
    name: name.trim() || id,
    cycles: trace.cycles.length,
    inputs: Object.fromEntries(inputs),
    expected,
  }
}

export function runBlockTest(block: BlockData, test: BlockTestCase): BlockTestResult {
  const invalid = (signal: string, reason: string): BlockTestResult => ({
    test,
    trace: null,
    passed: false,
    failures: [{ cycle: 0, signal, expected: null, actual: null, reason }],
  })
  if (!validCycles(test.cycles))
    return invalid(
      'cycles',
      `Choose a whole cycle count from 1 to ${MAX_TRACE_CYCLES}; no truncation is allowed.`,
    )
  for (const [signal, value] of Object.entries(test.inputs)) {
    if (!Number.isSafeInteger(value))
      return invalid(
        signal,
        'Set this digital input to a finite safe integer before running the test.',
      )
  }
  const trace = runTrace(block, test.cycles, traceInputs(test.inputs))
  if (trace === null) {
    return {
      test,
      trace: null,
      passed: false,
      failures: [{ cycle: 0, signal: 'run', expected: null, actual: null }],
    }
  }

  const failures: BlockTestFailure[] = []
  if (trace.cycles.length !== test.cycles || trace.outputs.length === 0)
    return invalid(
      'run',
      'The trace did not cover the requested cycles and outputs; inspect the block interfaces and rerun.',
    )
  for (const cycle of trace.cycles) {
    if (!cycle.settled)
      failures.push({
        cycle: cycle.cycle,
        signal: 'settled',
        expected: 1,
        actual: 0,
        reason: 'The logic did not settle; inspect feedback paths before trusting this cycle.',
      })
  }
  const actualSignals = new Set(trace.outputs.map((signal) => signal.name))
  for (const signal of trace.outputs) {
    const expected = test.expected[signal.name]
    if (expected && expected.length > test.cycles)
      failures.push({
        cycle: test.cycles + 1,
        signal: signal.name,
        expected: expected[test.cycles] ?? null,
        actual: null,
        reason:
          'The expectation extends beyond the requested run; align the waveform length and cycle count.',
      })
    for (let index = 0; index < trace.cycles.length; index++) {
      const expectedValue = expected?.[index]
      const actualValue = trace.cycles[index]?.values.get(signal.name)
      if (expectedValue === undefined || actualValue !== expectedValue) {
        failures.push({
          cycle: index + 1,
          signal: signal.name,
          expected: expectedValue ?? null,
          actual: actualValue ?? null,
        })
      }
    }
  }
  for (const signal of Object.keys(test.expected)) {
    if (actualSignals.has(signal)) continue
    failures.push({ cycle: 0, signal, expected: test.expected[signal]?.[0] ?? null, actual: null })
  }
  return { test, trace, passed: failures.length === 0, failures }
}

export function runBlockTests(block: BlockData, tests: BlockTestCase[]): BlockTestResult[] {
  return tests.map((test) => runBlockTest(block, test))
}
