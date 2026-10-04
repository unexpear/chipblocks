import type { BlockData, BlockTestCase } from './blocks.ts'
import { MAX_TRACE_CYCLES } from './run-trace.ts'
import { type SavedSimulationTest, validateSimulationTests } from './simulation-test-suite.ts'
import { buildLogicHarness } from './verilog-debug.ts'

export function importBlockTest(
  block: BlockData,
  blockId: string,
  test: BlockTestCase,
): { ok: true; test: SavedSimulationTest } | { ok: false; reason: string } {
  if (!Number.isInteger(test.cycles) || test.cycles < 1 || test.cycles > MAX_TRACE_CYCLES)
    return { ok: false, reason: 'The saved block test needs 1–256 complete cycles.' }
  const harness = buildLogicHarness(structuredClone(block))
  if (!harness || harness.outputSignals.length === 0)
    return { ok: false, reason: 'The block has no testable digital outputs.' }
  if (
    Object.keys(test.expected).length !== harness.outputSignals.length ||
    harness.outputSignals.some((signal) => {
      const waveform = test.expected[signal.name]
      return (
        !waveform ||
        waveform.length !== test.cycles ||
        waveform.some(
          (value) => !Number.isSafeInteger(value) || value < 0 || value >= 2 ** signal.bits.length,
        )
      )
    })
  )
    return {
      ok: false,
      reason: 'Every current output needs exactly one valid unsigned expectation per cycle.',
    }
  for (const [name, value] of Object.entries(test.inputs)) {
    const signal = harness.inputSignals.find((input) => input.name === name)
    if (!signal || !Number.isSafeInteger(value) || value < 0 || value >= 2 ** signal.bits.length)
      return { ok: false, reason: `Input ${name} is missing or outside its unsigned bit width.` }
  }
  const id = `block-test:${JSON.stringify([blockId, test.id])}`
  const candidate: SavedSimulationTest = {
    version: 1,
    id,
    name: `${blockId}: ${test.name}`,
    run: { kind: 'digital', blockId, cycles: test.cycles, inputs: { ...test.inputs } },
    assertions: Object.entries(test.expected).flatMap(([signal, waveform]) =>
      waveform.map((value, index) => ({
        id: JSON.stringify([signal, index + 1]),
        label: `${signal}, cycle ${index + 1}`,
        signal,
        unit: 'dimensionless',
        measurement: { kind: 'point', at: index + 1 },
        expected: { kind: 'near', value, absolute: 0, relative: 0 },
        provenance: {
          kind: 'captured',
          description: `Imported saved block test ${test.id}. Legacy capture/manual origin was not recorded; this waveform is not independent physics evidence.`,
        },
      })),
    ),
  }
  const validated = validateSimulationTests([candidate])
  if (!validated.ok) return validated
  const imported = validated.tests[0]
  return imported ? { ok: true, test: imported } : { ok: false, reason: 'No test was imported.' }
}
