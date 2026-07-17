/**
 * The stress-bench panel — ramp ambient temperature, the supply voltage, or a component's value across a
 * range and see, part by part, the safe operating window and exactly where each part gives out (and why).
 * The sweep is the real electro-thermal solver + failure checks (stress-bench.ts) run at each point; every
 * result is the actual physics, not an estimate.
 */

import type { Edge, Node } from '@xyflow/react'
import { type JSX, useEffect, useMemo, useState } from 'react'
import { runStressSweep, type StressAxis, type StressResult } from './stress-bench.ts'

type Mode = 'ambient' | 'supply' | 'component'

const paramAmount = (node: Node, param: string): number | undefined => {
  const p = (node.data as { parameters?: Record<string, { value?: { amount?: number } }> })
    .parameters
  return p?.[param]?.value?.amount
}
const isSupply = (n: Node): boolean =>
  (n.data as { definition?: string }).definition === 'power_source' &&
  paramAmount(n, 'nominal_voltage') !== undefined
const isLoad = (n: Node): boolean => paramAmount(n, 'resistance') !== undefined
const labelOf = (n: Node): string => {
  const d = n.data as { label?: string; definition?: string }
  return d.label ?? d.definition ?? n.id
}

export function StressBench({
  nodes,
  edges,
  baseAmbientC,
  onClose,
}: {
  nodes: Node[]
  edges: Edge[]
  baseAmbientC: number
  onClose: () => void
}): JSX.Element {
  const [mode, setMode] = useState<Mode>('ambient')
  const [componentId, setComponentId] = useState('')
  const [from, setFrom] = useState(-20)
  const [to, setTo] = useState(150)
  const [steps, setSteps] = useState(24)
  const [result, setResult] = useState<StressResult | null>(null)

  const supplies = useMemo(() => nodes.filter(isSupply), [nodes])
  const loads = useMemo(() => nodes.filter(isLoad), [nodes])

  // Sensible default range + reset the last run when the axis changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-defaults on a mode switch
  useEffect(() => {
    setResult(null)
    if (mode === 'ambient') {
      setFrom(-20)
      setTo(150)
    } else if (mode === 'supply') {
      const v = Math.max(...supplies.map((s) => paramAmount(s, 'nominal_voltage') ?? 0), 5)
      setFrom(0)
      setTo(Math.round(v * 2))
    } else {
      const load = loads.find((l) => l.id === componentId) ?? loads[0]
      if (load) setComponentId(load.id)
      const r = load ? (paramAmount(load, 'resistance') ?? 100) : 100
      setFrom(Math.round(r / 2))
      setTo(Math.round(r * 2))
    }
  }, [mode])

  const unit = mode === 'ambient' ? '°C' : mode === 'supply' ? 'V' : 'Ω'
  const axis: StressAxis | null =
    mode === 'ambient'
      ? { kind: 'ambient' }
      : mode === 'supply'
        ? supplies.length > 0
          ? {
              kind: 'param',
              targets: supplies.map((s) => ({ nodeId: s.id, param: 'nominal_voltage' })),
            }
          : null
        : // guard against a stale id (the chosen component was deleted): disable Sweep rather than
          // silently solving the unchanged circuit
          componentId && loads.some((l) => l.id === componentId)
          ? { kind: 'param', targets: [{ nodeId: componentId, param: 'resistance' }] }
          : null

  const run = () => {
    if (axis) setResult(runStressSweep(nodes, edges, axis, from, to, steps, baseAmbientC))
  }

  const fmt = (v: number | null): string =>
    v === null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        bottom: 16,
        right: 16,
        width: 660,
        maxWidth: 'calc(100vw - 32px)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surfacePanel)',
        border: '1px solid var(--borderStrong)',
        borderRadius: 8,
        zIndex: 60,
        boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
        overflow: 'hidden',
      }}
    >
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
        <span>Stress bench</span>
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

      <div
        style={{
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          overflow: 'auto',
          minHeight: 0,
        }}
      >
        {/* axis picker */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['ambient', 'supply', 'component'] as Mode[]).map((m) => {
            const disabled =
              (m === 'supply' && supplies.length === 0) || (m === 'component' && loads.length === 0)
            const label = m === 'ambient' ? 'Ambient °C' : m === 'supply' ? 'Supply V' : 'Component'
            return (
              <button
                key={m}
                type="button"
                disabled={disabled}
                onClick={() => setMode(m)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--borderStrong)',
                  background: mode === m ? 'var(--accentBlueDeep)' : 'var(--surfaceRaised)',
                  color: disabled
                    ? 'var(--textFaint)'
                    : mode === m
                      ? 'var(--white)'
                      : 'var(--textPrimary)',
                  cursor: disabled ? 'default' : 'pointer',
                  fontSize: 12,
                }}
              >
                {label}
              </button>
            )
          })}
          {mode === 'component' && loads.length > 0 && (
            <select
              value={componentId}
              onChange={(e) => {
                setComponentId(e.target.value)
                setResult(null) // a stale result for the old component would be misleading
              }}
              style={{
                background: 'var(--surfaceInput)',
                color: 'var(--textPrimary)',
                border: '1px solid var(--borderStrong)',
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 12,
              }}
            >
              {loads.map((l) => (
                <option key={l.id} value={l.id}>
                  {labelOf(l)} (resistance)
                </option>
              ))}
            </select>
          )}
        </div>

        {/* range */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
            fontSize: 12,
            color: 'var(--textSoft)',
          }}
        >
          {(
            [
              ['from', from, setFrom],
              ['to', to, setTo],
              ['steps', steps, setSteps],
            ] as [string, number, (n: number) => void][]
          ).map(([name, val, set]) => (
            <label key={name}>
              {name}{' '}
              <input
                type="number"
                value={val}
                onChange={(e) => set(Number(e.target.value))}
                style={{
                  width: 64,
                  background: 'var(--surfaceInput)',
                  color: 'var(--textPrimary)',
                  border: '1px solid var(--borderStrong)',
                  borderRadius: 6,
                  padding: '4px 6px',
                  fontSize: 12,
                }}
              />
              {name !== 'steps' ? unit : ''}
            </label>
          ))}
          <button
            type="button"
            onClick={run}
            disabled={axis === null}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid var(--borderStrong)',
              background: axis ? 'var(--accentBlueDeep)' : 'var(--surfaceRaised)',
              color: axis ? 'var(--white)' : 'var(--textFaint)',
              cursor: axis ? 'pointer' : 'default',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            ▸ Sweep
          </button>
        </div>

        {result && <StressResults result={result} unit={unit} fmt={fmt} />}
      </div>
    </div>
  )
}

function StressResults({
  result,
  unit,
  fmt,
}: {
  result: StressResult
  unit: string
  fmt: (v: number | null) => string
}): JSX.Element {
  const lo = result.values[0] ?? 0
  const hi = result.values[result.values.length - 1] ?? 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--textSoft)' }}>
        swept {fmt(lo)}–{fmt(hi)} · {result.totalParts} parts · {result.noFailure} flagged no
        failure
      </div>

      {result.warning && (
        <div style={{ fontSize: 12, color: 'var(--statusWarn)' }}>⚠ {result.warning}</div>
      )}

      {result.failingParts.length === 0 ? (
        <div style={{ color: 'var(--statusOk)', fontSize: 12 }}>
          ✓ no part failed anywhere in this range
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--textBright)' }}>
          Safe operating window:{' '}
          {result.safeWindow ? (
            <strong style={{ color: 'var(--statusOk)' }}>
              {fmt(result.safeWindow.from)} to {fmt(result.safeWindow.to)}
            </strong>
          ) : (
            <strong style={{ color: 'var(--statusDanger)' }}>
              none — a part fails at every point
            </strong>
          )}
        </div>
      )}

      {/* per failing part: a safe(green)/fail(red) bar across the swept axis + the reason */}
      {result.failingParts.map((p) => (
        <div key={p.partId} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--textBright)', fontWeight: 600 }}>{p.label}</span>
            <span style={{ color: 'var(--statusDanger)' }}>
              fails at {fmt(p.firstFailValue)} — {p.worstNote}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              height: 14,
              borderRadius: 3,
              overflow: 'hidden',
              border: '1px solid var(--borderStrong)',
            }}
          >
            {result.points.map((pt, i) => {
              // A part is unsafe here if it tripped a limit OR the whole point ran away thermally (an
              // unconverged solve isn't a survivable operating point). Keyed by index — sweep values can
              // repeat (e.g. from === to).
              const unsafe = !pt.converged || pt.failures.some((f) => f.partId === p.partId)
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional; values can repeat
                  key={i}
                  title={`${fmt(pt.value)}: ${!pt.converged ? 'thermal runaway' : unsafe ? 'fails' : 'ok'}`}
                  style={{
                    flex: 1,
                    background: unsafe ? 'var(--statusDanger)' : 'var(--statusOk)',
                  }}
                />
              )
            })}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 10,
              color: 'var(--textFaint)',
            }}
          >
            <span>{fmt(lo)}</span>
            <span>
              safe {fmt(p.safeFrom)}–{fmt(p.safeTo)}
            </span>
            <span>{fmt(hi)}</span>
          </div>
        </div>
      ))}

      {result.points.some((p) => !p.converged) && (
        <div style={{ fontSize: 11, color: 'var(--statusWarn)' }}>
          ⚠ some points didn't reach a thermal steady state (runaway) — treat those as failing
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--textFaint)', lineHeight: 1.5 }}>
        A part with no rating for this stress can't be checked, so “safe throughout” means “no rated
        limit was exceeded”, not a guarantee. Units: {unit || 'component value'}.
      </div>
    </div>
  )
}
