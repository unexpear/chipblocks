import type { CSSProperties } from 'react'
import type { Parameters } from './part-defaults.ts'

/**
 * Properties inspector (Sprint 19) — the selected part's editable values. This is
 * the "let users enter their own values instead of the defaults" surface: a
 * scalar parameter becomes a number field (edit → live re-solve), a switch's
 * state is a dropdown, and material / shape refs show read-only (a picker is
 * future work). Editing routes back to App, which updates the node's parameters
 * and the canvas re-solves.
 */

type ScalarValue = { kind: 'scalar'; amount: number; unit: string }

function asScalar(value: unknown): ScalarValue | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v.kind !== 'scalar' || typeof v.amount !== 'number' || typeof v.unit !== 'string') return null
  return { kind: 'scalar', amount: v.amount, unit: v.unit }
}

const humanize = (key: string): string =>
  key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export type SelectedPart = {
  id: string
  definition: string
  parameters: Parameters | undefined
}

export type PartInspectorProps = {
  selected: SelectedPart | null
  onParam: (key: string, amount: number) => void
  onEnum: (key: string, value: string) => void
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 11,
  margin: '4px 0',
}
const field: CSSProperties = {
  background: '#1a1a1e',
  border: '1px solid #3a3a3f',
  color: '#cdd6e0',
  borderRadius: 3,
  padding: '2px 4px',
  fontSize: 11,
}

export function PartInspector({ selected, onParam, onEnum }: PartInspectorProps) {
  if (selected === null) {
    return (
      <div style={{ width: 160, fontSize: 11, color: '#8089a0' }}>
        Select a part to edit its values.
      </div>
    )
  }
  const entries = Object.entries(selected.parameters ?? {})
  return (
    <div style={{ width: 178, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontSize: 12, color: '#cdd6e0' }}>{selected.id}</div>
      <div style={{ fontSize: 10, color: '#778', marginBottom: 6 }}>{selected.definition}</div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 11, color: '#8089a0' }}>No editable values.</div>
      ) : (
        entries.map(([key, param]) => {
          const scalar = asScalar(param.value)
          if (scalar !== null) {
            return (
              <label key={`${selected.id}:${key}`} style={row}>
                <span style={{ color: '#aab' }}>{humanize(key)}</span>
                <span style={{ whiteSpace: 'nowrap' }}>
                  <input
                    type="number"
                    defaultValue={scalar.amount}
                    onChange={(event) => {
                      const next = event.target.valueAsNumber
                      if (Number.isFinite(next)) onParam(key, next)
                    }}
                    className="nodrag"
                    style={{ ...field, width: 58, marginRight: 4 }}
                  />
                  <span style={{ color: '#778', fontSize: 10 }}>{scalar.unit}</span>
                </span>
              </label>
            )
          }
          if (key === 'state' && typeof param.value === 'string') {
            return (
              <label key={`${selected.id}:${key}`} style={row}>
                <span style={{ color: '#aab' }}>{humanize(key)}</span>
                <select
                  value={param.value}
                  onChange={(event) => onEnum(key, event.target.value)}
                  className="nodrag"
                  style={field}
                >
                  <option value="closed">closed</option>
                  <option value="open">open</option>
                </select>
              </label>
            )
          }
          // material / shape ref — read-only for now (a picker comes later)
          return (
            <div key={`${selected.id}:${key}`} style={row}>
              <span style={{ color: '#aab' }}>{humanize(key)}</span>
              <span style={{ color: '#8089a0' }}>{String(param.value)}</span>
            </div>
          )
        })
      )}
    </div>
  )
}
