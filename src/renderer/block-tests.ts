import type { BlockData, BlockTestCase } from './blocks.ts'
import { runTrace, type TraceInputs, type TraceResult } from './run-trace.ts'

export type BlockTestFailure = {
  cycle: number
  signal: string
  expected: number | null
  actual: number | null
}

export type BlockTestResult = {
  test: BlockTestCase
  trace: TraceResult | null
  passed: boolean
  failures: BlockTestFailure[]
}

const traceInputs = (inputs: Record<string, number>): TraceInputs => new Map(Object.entries(inputs))

export function createBlockTestCase(
  block: BlockData,
  id: string,
  name: string,
  cycles: number,
  inputs: TraceInputs,
): BlockTestCase | null {
  const trace = runTrace(block, cycles, inputs)
  if (trace === null) return null
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
  const actualSignals = new Set(trace.outputs.map((signal) => signal.name))
  for (const signal of trace.outputs) {
    const expected = test.expected[signal.name]
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
