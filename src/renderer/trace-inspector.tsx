/**
 * The run-trace inspector panel — pick a clocked digital design, hold its inputs, clock it for N cycles, and
 * read the whole run at once: every output's value each cycle, how much the registers churned, how hard the
 * logic worked to settle, and a plain-English list of anomalies (a cycle that oscillated, a one-cycle glitch,
 * a slow cycle, or outputs that depend on the flip-flops' power-up state). All of it comes from run-trace.ts
 * clocking the real gates — nothing here fakes a value.
 */

import { type JSX, useEffect, useMemo, useState } from 'react'
import { type BlockTestResult, createBlockTestCase, runBlockTests } from './block-tests.ts'
import type { BlockData, BlockTestCase } from './blocks.ts'
import { buildTraceCausalReplay } from './causal-replay.ts'
import { CausalReplayPanel } from './causal-replay-panel.tsx'
import { type Anomaly, runTrace, type TraceResult } from './run-trace.ts'
import { buildLogicHarness } from './verilog-debug.ts'
import { WhyPanel } from './why-panel.tsx'

export type TraceBlock = { id: string; label: string; block: BlockData }

const ANOMALY_COLOR: Record<Anomaly['kind'], string> = {
  unsettled: 'var(--statusDanger)',
  'power-up-dependent': 'var(--statusWarn)',
  pulse: 'var(--accentTimeline)',
  'slow-cycle': 'var(--accentTimeline)',
}
const ANOMALY_LABEL: Record<Anomaly['kind'], string> = {
  unsettled: "didn't settle",
  'power-up-dependent': 'power-up dependent',
  pulse: '1-cycle pulse',
  'slow-cycle': 'slow cycle',
}

const testButtonStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 5,
  border: '1px solid var(--borderStrong)',
  background: 'var(--surfaceInput)',
  color: 'var(--textPrimary)',
  cursor: 'pointer',
  fontSize: 11,
}

export function TraceInspector({
  blocks,
  onClose,
  onTestsChange,
}: {
  blocks: TraceBlock[]
  onClose: () => void
  onTestsChange?: (blockId: string, tests: BlockTestCase[]) => void
}): JSX.Element {
  const [sel, setSel] = useState(0)
  const [cycles, setCycles] = useState(32)
  const [inputVals, setInputVals] = useState<Map<string, number>>(new Map())
  const [result, setResult] = useState<TraceResult | null>(null)
  const [testName, setTestName] = useState('Test 1')
  const [testResults, setTestResults] = useState<BlockTestResult[]>([])

  const chosen = blocks[Math.min(sel, blocks.length - 1)]
  // Key on the block's stable node id, NOT the `chosen` wrapper: App rebuilds the blocks list (new wrapper
  // objects) on every canvas change, so keying on the object would recompile the harness AND wipe the user's
  // held inputs on any unrelated edit while the panel is open. The id only changes when they pick a new block.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the stable block id by design
  const harness = useMemo(() => (chosen ? buildLogicHarness(chosen.block) : null), [chosen?.id])

  // Reset the held inputs + clear the last run only when the chosen design actually changes (its id).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the stable block id by design
  useEffect(() => {
    setInputVals(new Map())
    setResult(null)
    setTestResults([])
    setTestName(`Test ${(chosen?.block.tests?.length ?? 0) + 1}`)
  }, [chosen?.id])

  const run = () => {
    if (chosen) setResult(runTrace(chosen.block, cycles, inputVals))
  }

  const savedTests = chosen?.block.tests ?? []
  const saveTest = () => {
    if (!chosen || !onTestsChange) return
    const test = createBlockTestCase(
      chosen.block,
      `${chosen.id}-test-${Date.now()}`,
      testName,
      cycles,
      inputVals,
    )
    if (!test) return
    const next = [...savedTests, test]
    onTestsChange(chosen.id, next)
    setTestResults(runBlockTests(chosen.block, next))
    setTestName(`Test ${next.length + 1}`)
  }

  const runSavedTests = () => {
    if (chosen) setTestResults(runBlockTests(chosen.block, savedTests))
  }

  const runSavedTest = (id: string) => {
    if (!chosen) return
    const test = savedTests.find((candidate) => candidate.id === id)
    if (!test) return
    const [testResult] = runBlockTests(chosen.block, [test])
    if (!testResult) return
    setTestResults((current) => [
      ...current.filter((testResult) => testResult.test.id !== id),
      testResult,
    ])
  }

  const deleteTest = (id: string) => {
    if (!chosen || !onTestsChange) return
    const next = savedTests.filter((test) => test.id !== id)
    onTestsChange(chosen.id, next)
    setTestResults((current) => current.filter((result) => result.test.id !== id))
  }

  const resultByTest = useMemo(
    () => new Map(testResults.map((testResult) => [testResult.test.id, testResult])),
    [testResults],
  )

  const anomalyCycles = useMemo(() => {
    const m = new Map<number, Anomaly>()
    for (const a of result?.anomalies ?? []) if (!m.has(a.cycle)) m.set(a.cycle, a)
    return m
  }, [result])
  const chosenBlock = chosen?.block
  const chosenId = chosen?.id
  const chosenLabel = chosen?.label
  const replay = useMemo(() => {
    if (!result || !chosenBlock || !chosenId || !chosenLabel) return null
    return buildTraceCausalReplay(result, chosenBlock, { id: chosenId, label: chosenLabel })
  }, [result, chosenBlock, chosenId, chosenLabel])

  const panel: React.CSSProperties = {
    position: 'absolute',
    top: 16,
    bottom: 16,
    right: 16,
    width: 640,
    maxWidth: 'calc(100vw - 32px)',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--surfacePanel)',
    border: '1px solid var(--borderStrong)',
    borderRadius: 8,
    zIndex: 60,
    boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
    overflow: 'hidden',
  }

  return (
    <div style={panel}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--borderSubtle)',
          color: 'var(--textBright)',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span>Run-trace inspector</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 0,
            color: 'var(--textSoft)',
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          ×
        </button>
      </header>

      {blocks.length === 0 || !chosen ? (
        <div style={{ padding: 16, color: 'var(--textSoft)', fontSize: 13, lineHeight: 1.6 }}>
          No clocked digital design on the canvas to trace. Drop a synthesized Verilog module (or a
          gate design with a clock), then reopen this.
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 12,
            overflow: 'auto',
            minHeight: 0,
          }}
        >
          {/* config */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {blocks.length > 1 && (
              <select
                value={sel}
                onChange={(e) => setSel(Number(e.target.value))}
                style={{
                  background: 'var(--surfaceInput)',
                  color: 'var(--textPrimary)',
                  border: '1px solid var(--borderStrong)',
                  borderRadius: 6,
                  padding: '5px 8px',
                  fontSize: 12,
                }}
              >
                {blocks.map((b, i) => (
                  <option key={b.id} value={i}>
                    {b.label}
                  </option>
                ))}
              </select>
            )}
            <label style={{ fontSize: 12, color: 'var(--textSoft)' }}>
              cycles{' '}
              <input
                type="number"
                min={1}
                max={256}
                value={cycles}
                onChange={(e) => setCycles(Math.max(1, Math.min(256, Number(e.target.value) || 1)))}
                style={{
                  width: 60,
                  background: 'var(--surfaceInput)',
                  color: 'var(--textPrimary)',
                  border: '1px solid var(--borderStrong)',
                  borderRadius: 6,
                  padding: '4px 6px',
                  fontSize: 12,
                }}
              />
            </label>
            <button
              type="button"
              onClick={run}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid var(--borderStrong)',
                background: 'var(--accentBlueDeep)',
                color: 'var(--white)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              ▸ Run {harness?.clockPortId ? `${cycles} cycles` : 'settle'}
            </button>
          </div>

          {/* input holds */}
          {harness && harness.inputSignals.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {harness.inputSignals.map((sig) => {
                // 2**n (not 1<<n): a 31+-bit shift overflows JS's 32-bit signed int, which would make wide
                // input buses undrivable (a negative max).
                const max = 2 ** sig.bits.length - 1
                return (
                  <label key={sig.name} style={{ fontSize: 12, color: 'var(--textSoft)' }}>
                    {sig.name}{' '}
                    <input
                      type="number"
                      min={0}
                      max={max}
                      value={inputVals.get(sig.name) ?? 0}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(max, Number(e.target.value) || 0))
                        setInputVals((prev) => new Map(prev).set(sig.name, v))
                      }}
                      style={{
                        width: 52,
                        background: 'var(--surfaceInput)',
                        color: 'var(--textPrimary)',
                        border: '1px solid var(--borderStrong)',
                        borderRadius: 6,
                        padding: '3px 6px',
                        fontSize: 12,
                        fontFamily: 'monospace',
                      }}
                    />
                  </label>
                )
              })}
            </div>
          )}

          {(onTestsChange || savedTests.length > 0) && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 8,
                border: '1px solid var(--borderSubtle)',
                borderRadius: 6,
              }}
            >
              <div style={{ color: 'var(--textBright)', fontSize: 12, fontWeight: 600 }}>
                Saved block tests
              </div>
              {onTestsChange ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <input
                    aria-label="Test name"
                    value={testName}
                    onChange={(event) => setTestName(event.target.value)}
                    style={{
                      flex: '1 1 150px',
                      minWidth: 130,
                      background: 'var(--surfaceInput)',
                      color: 'var(--textPrimary)',
                      border: '1px solid var(--borderStrong)',
                      borderRadius: 6,
                      padding: '4px 6px',
                      fontSize: 12,
                    }}
                  />
                  <button
                    type="button"
                    onClick={saveTest}
                    disabled={!harness}
                    style={testButtonStyle}
                  >
                    Save current vector
                  </button>
                </div>
              ) : null}
              {savedTests.length > 0 ? (
                <>
                  <button type="button" onClick={runSavedTests} style={testButtonStyle}>
                    Run saved tests
                  </button>
                  {savedTests.map((test) => {
                    const testResult = resultByTest.get(test.id)
                    return (
                      <div
                        key={test.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          flexWrap: 'wrap',
                          fontSize: 11,
                          color: 'var(--textSoft)',
                        }}
                      >
                        <span style={{ flex: '1 1 180px' }}>
                          {test.name} · {test.cycles} cycles
                          {testResult ? (
                            <strong
                              style={{
                                color: testResult.passed
                                  ? 'var(--statusOk)'
                                  : 'var(--statusDanger)',
                                marginLeft: 6,
                              }}
                            >
                              {testResult.passed ? 'PASS' : `FAIL (${testResult.failures.length})`}
                            </strong>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          onClick={() => runSavedTest(test.id)}
                          style={testButtonStyle}
                        >
                          Run
                        </button>
                        {onTestsChange ? (
                          <button
                            type="button"
                            onClick={() => deleteTest(test.id)}
                            style={testButtonStyle}
                          >
                            Delete
                          </button>
                        ) : null}
                        {testResult && !testResult.passed ? (
                          <span style={{ flexBasis: '100%', color: 'var(--statusDanger)' }}>
                            {testResult.failures
                              .slice(0, 2)
                              .map(
                                (failure) =>
                                  `${failure.signal} cycle ${failure.cycle}: expected ${failure.expected ?? '—'}, got ${failure.actual ?? '—'}`,
                              )
                              .join(' · ')}
                          </span>
                        ) : null}
                      </div>
                    )
                  })}
                </>
              ) : (
                <div style={{ color: 'var(--textSoft)', fontSize: 11 }}>
                  Save the current input vector to create a repeatable expected-output test.
                </div>
              )}
            </div>
          )}

          {result && <Results result={result} anomalyCycles={anomalyCycles} replay={replay} />}
        </div>
      )}
    </div>
  )
}

function Results({
  result,
  anomalyCycles,
  replay,
}: {
  result: TraceResult
  anomalyCycles: Map<number, Anomaly>
  replay: ReturnType<typeof buildTraceCausalReplay> | null
}): JSX.Element {
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--textSoft)' }}>
        {result.cycles.length} cycles · {result.clocked ? 'clocked' : 'combinational (no clock)'} ·{' '}
        {result.registerCount} register{result.registerCount === 1 ? '' : 's'}
      </div>

      {replay ? <CausalReplayPanel replay={replay} /> : null}
      <WhyPanel system={result.why} title="Why this trace has this state" />

      {result.anomalies.length === 0 ? (
        <div style={{ color: 'var(--statusOk)', fontSize: 12 }}>
          ✓ no anomalies — every cycle settled, no glitches, and the outputs don't depend on
          power-up state
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {result.anomalies.map((a) => (
            <div
              key={`${a.kind}-${a.cycle}-${a.signal ?? ''}`}
              style={{ fontSize: 12, color: ANOMALY_COLOR[a.kind], lineHeight: 1.5 }}
            >
              <strong>[{ANOMALY_LABEL[a.kind]}]</strong> {a.detail}
            </div>
          ))}
        </div>
      )}

      {/* per-cycle table */}
      <div style={{ overflow: 'auto', border: '1px solid var(--borderSubtle)', borderRadius: 6 }}>
        <table
          style={{
            borderCollapse: 'collapse',
            fontSize: 12,
            fontFamily: 'monospace',
            width: '100%',
          }}
        >
          <thead>
            <tr style={{ background: 'var(--surfaceBase)' }}>
              {['#', ...result.outputs.map((o) => o.name), 'Δregs', 'sweeps'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'right',
                    padding: '4px 8px',
                    color: 'var(--textSoft)',
                    position: 'sticky',
                    top: 0,
                    background: 'var(--surfaceBase)',
                    borderBottom: '1px solid var(--borderSubtle)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.cycles.map((c) => {
              const anom = anomalyCycles.get(c.cycle)
              return (
                <tr
                  key={c.cycle}
                  style={{
                    background: anom
                      ? `color-mix(in srgb, ${ANOMALY_COLOR[anom.kind]} 18%, transparent)`
                      : 'transparent',
                  }}
                >
                  <td style={cellStyle('var(--textSoft)')}>{c.cycle}</td>
                  {result.outputs.map((o) => (
                    <td key={o.name} style={cellStyle('var(--textBright)')}>
                      {c.values.get(o.name) ?? '—'}
                    </td>
                  ))}
                  <td style={cellStyle('var(--textMuted)')}>{c.registersChanged}</td>
                  <td style={cellStyle(c.settled ? 'var(--textMuted)' : 'var(--statusDanger)')}>
                    {c.settled ? c.sweeps : `${c.sweeps}✗`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

const cellStyle = (color: string): React.CSSProperties => ({
  textAlign: 'right',
  padding: '3px 8px',
  color,
  borderBottom: '1px solid color-mix(in srgb, var(--borderSubtle) 50%, transparent)',
})
