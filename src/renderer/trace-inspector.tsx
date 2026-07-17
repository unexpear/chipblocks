/**
 * The run-trace inspector panel — pick a clocked digital design, hold its inputs, clock it for N cycles, and
 * read the whole run at once: every output's value each cycle, how much the registers churned, how hard the
 * logic worked to settle, and a plain-English list of anomalies (a cycle that oscillated, a one-cycle glitch,
 * a slow cycle, or outputs that depend on the flip-flops' power-up state). All of it comes from run-trace.ts
 * clocking the real gates — nothing here fakes a value.
 */

import { type JSX, useEffect, useMemo, useState } from 'react'
import type { BlockData } from './blocks.ts'
import { type Anomaly, runTrace, type TraceResult } from './run-trace.ts'
import { buildLogicHarness } from './verilog-debug.ts'

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

export function TraceInspector({
  blocks,
  onClose,
}: {
  blocks: TraceBlock[]
  onClose: () => void
}): JSX.Element {
  const [sel, setSel] = useState(0)
  const [cycles, setCycles] = useState(32)
  const [inputVals, setInputVals] = useState<Map<string, number>>(new Map())
  const [result, setResult] = useState<TraceResult | null>(null)

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
  }, [chosen?.id])

  const run = () => {
    if (chosen) setResult(runTrace(chosen.block, cycles, inputVals))
  }

  const anomalyCycles = useMemo(() => {
    const m = new Map<number, Anomaly>()
    for (const a of result?.anomalies ?? []) if (!m.has(a.cycle)) m.set(a.cycle, a)
    return m
  }, [result])

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

          {result && <Results result={result} anomalyCycles={anomalyCycles} />}
        </div>
      )}
    </div>
  )
}

function Results({
  result,
  anomalyCycles,
}: {
  result: TraceResult
  anomalyCycles: Map<number, Anomaly>
}): JSX.Element {
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--textSoft)' }}>
        {result.cycles.length} cycles · {result.clocked ? 'clocked' : 'combinational (no clock)'} ·{' '}
        {result.registerCount} register{result.registerCount === 1 ? '' : 's'}
      </div>

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
