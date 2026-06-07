import type { CSSProperties } from 'react'
import { formatCurrent } from './edge-currents.ts'
import { defaultParameters, defaultProvenance, type Parameters } from './part-defaults.ts'
import type { PartReading } from './part-readings.ts'

/**
 * Properties inspector (Sprint 19). For the selected part it shows:
 *  - LIVE READINGS — current through / voltage across / power, each against its
 *    rating where one applies (e.g. "14.9 mA · 74% of 20 mA"). Real solved data.
 *  - EDITABLE VALUES — scalar params as number fields (edit → live re-solve), a
 *    switch's state as a dropdown, an LED color picker, and material refs as a
 *    dropdown of catalog materials.
 *  - PROVENANCE — the cited source behind a value, shown while it's the default.
 */

type ScalarValue = { kind: 'scalar'; amount: number; unit: string }

function asScalar(value: unknown): ScalarValue | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v.kind !== 'scalar' || typeof v.amount !== 'number' || typeof v.unit !== 'string') return null
  return { kind: 'scalar', amount: v.amount, unit: v.unit }
}

const amountOf = (parameters: Parameters | undefined, key: string): number | undefined =>
  asScalar(parameters?.[key]?.value)?.amount

const humanize = (key: string): string =>
  key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

const LED_DEFINITIONS = new Set(['led', 'led_uv_algan'])
const MATERIAL_REF_KEYS = new Set(['resistive_material', 'n_side', 'p_side', 'contact_material'])

/**
 * LED emission-color presets. Picking one sets a CONSISTENT real LED — the
 * peak_wavelength (glow color), the semiconductor it would actually be made of,
 * AND that material's typical forward voltage — so the chemistry backs the color
 * (a blue LED is InGaN at ~3 V, not red AlGaInP at 2 V). Forward-voltage ranges
 * from the LED definition (AlGaInP red ~2 V; InGaN green/blue ~3.0–3.2 V; AlGaN
 * UV ~3.4 V). `material` is the base id; n_side/p_side append _n_type/_p_type.
 */
const LED_COLORS: {
  label: string
  nm: number
  css: string
  forwardVoltage: number
  material: string
}[] = [
  {
    label: 'Red',
    nm: 640,
    css: 'rgb(255, 40, 0)',
    forwardVoltage: 2.0,
    material: 'aluminum_gallium_indium_phosphide',
  },
  {
    label: 'Green',
    nm: 530,
    css: 'rgb(70, 220, 0)',
    forwardVoltage: 3.2,
    material: 'indium_gallium_nitride',
  },
  {
    label: 'Blue',
    nm: 470,
    css: 'rgb(0, 140, 255)',
    forwardVoltage: 3.0,
    material: 'indium_gallium_nitride',
  },
  {
    label: 'UV',
    nm: 340,
    css: 'rgb(120, 70, 210)',
    forwardVoltage: 3.4,
    material: 'aluminum_gallium_nitride',
  },
]

/** The reading quantity that carries a rating, and its limit — for headroom. */
function ratingFor(
  definition: string,
  parameters: Parameters | undefined,
): { quantity: 'current' | 'power'; limit: number } | null {
  if (LED_DEFINITIONS.has(definition)) {
    const limit = amountOf(parameters, 'max_forward_current')
    return limit ? { quantity: 'current', limit } : null
  }
  if (definition === 'resistor') {
    const limit = amountOf(parameters, 'power_rating')
    return limit ? { quantity: 'power', limit } : null
  }
  if (definition === 'switch_spst_toggle') {
    const limit = amountOf(parameters, 'max_current')
    return limit ? { quantity: 'current', limit } : null
  }
  return null
}

const formatVolts = (v: number): string =>
  v >= 1 ? `${v.toFixed(2)} V` : `${(v * 1000).toFixed(0)} mV`
const formatWatts = (w: number): string =>
  w >= 1
    ? `${w.toFixed(2)} W`
    : w >= 1e-3
      ? `${(w * 1000).toFixed(1)} mW`
      : `${(w * 1e6).toFixed(0)} µW`

function isDefaultValue(definition: string, key: string, scalar: ScalarValue): boolean {
  const def = asScalar(defaultParameters(definition)[key]?.value)
  return def !== null && def.amount === scalar.amount && def.unit === scalar.unit
}

export type SelectedPart = {
  id: string
  definition: string
  parameters: Parameters | undefined
}

export type PartInspectorProps = {
  selected: SelectedPart | null
  reading: PartReading | undefined
  materials: string[]
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
const sectionLabel: CSSProperties = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#667',
  marginTop: 8,
  marginBottom: 2,
}
const sourceNote: CSSProperties = {
  fontSize: 9,
  color: '#667',
  margin: '-2px 0 4px',
  fontStyle: 'italic',
}

export function PartInspector({
  selected,
  reading,
  materials,
  onParam,
  onEnum,
}: PartInspectorProps) {
  if (selected === null) {
    return (
      <div style={{ width: 170, fontSize: 11, color: '#8089a0' }}>
        Select a part to inspect + edit it.
      </div>
    )
  }
  const entries = Object.entries(selected.parameters ?? {})
  const rating = ratingFor(selected.definition, selected.parameters)

  const headroom = (quantity: 'current' | 'power', value: number) => {
    if (rating === null || rating.quantity !== quantity) return null
    const pct = Math.round((value / rating.limit) * 100)
    const limitText =
      quantity === 'current' ? formatCurrent(rating.limit) : formatWatts(rating.limit)
    return { text: `${pct}% of ${limitText}`, over: value >= rating.limit }
  }

  return (
    <div style={{ width: 190, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontSize: 12, color: '#cdd6e0' }}>{selected.id}</div>
      <div style={{ fontSize: 10, color: '#778' }}>{selected.definition}</div>

      {reading ? (
        <>
          <div style={sectionLabel}>Readings</div>
          {reading.current !== undefined
            ? readingRow(
                'Current',
                formatCurrent(reading.current),
                headroom('current', reading.current),
              )
            : null}
          {reading.voltage !== undefined
            ? readingRow('Voltage', formatVolts(reading.voltage), null)
            : null}
          {reading.power !== undefined
            ? readingRow('Power', formatWatts(reading.power), headroom('power', reading.power))
            : null}
        </>
      ) : null}

      <div style={sectionLabel}>Values</div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 11, color: '#8089a0' }}>No editable values.</div>
      ) : (
        entries.map(([key, param]) => {
          const scalar = asScalar(param.value)
          if (scalar !== null) {
            const source = isDefaultValue(selected.definition, key, scalar)
              ? defaultProvenance(selected.definition, key)
              : undefined
            return (
              <div key={`${selected.id}:${key}`}>
                <label style={row}>
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
                {source ? <div style={sourceNote}>{source}</div> : null}
              </div>
            )
          }
          if (key === 'state' && typeof param.value === 'string') {
            return (
              <label key={`${selected.id}:${key}`} style={row}>
                <span style={{ color: '#aab' }}>{humanize(key)}</span>
                <select
                  value={param.value}
                  onChange={(e) => onEnum(key, e.target.value)}
                  className="nodrag"
                  style={field}
                >
                  <option value="closed">closed</option>
                  <option value="open">open</option>
                </select>
              </label>
            )
          }
          if (MATERIAL_REF_KEYS.has(key) && typeof param.value === 'string') {
            const current = param.value
            const options = materials.includes(current) ? materials : [current, ...materials]
            return (
              <label key={`${selected.id}:${key}`} style={row}>
                <span style={{ color: '#aab' }}>{humanize(key)}</span>
                <select
                  value={current}
                  onChange={(e) => onEnum(key, e.target.value)}
                  className="nodrag"
                  style={{ ...field, maxWidth: 112 }}
                >
                  {options.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            )
          }
          return (
            <div key={`${selected.id}:${key}`} style={row}>
              <span style={{ color: '#aab' }}>{humanize(key)}</span>
              <span style={{ color: '#8089a0' }}>{String(param.value)}</span>
            </div>
          )
        })
      )}

      {LED_DEFINITIONS.has(selected.definition) ? (
        <div style={row}>
          <span style={{ color: '#aab' }}>Color</span>
          <span style={{ display: 'flex', gap: 4 }}>
            {LED_COLORS.map((c) => (
              <button
                key={c.nm}
                type="button"
                title={`${c.label} — ${c.nm} nm, ${c.forwardVoltage} V (${c.material.replace(/_/g, ' ')})`}
                onClick={() => {
                  // Set a consistent real LED: color + semiconductor + its V_F.
                  onParam('peak_wavelength', c.nm)
                  onParam('forward_voltage', c.forwardVoltage)
                  onEnum('n_side', `${c.material}_n_type`)
                  onEnum('p_side', `${c.material}_p_type`)
                }}
                className="nodrag"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: c.css,
                  border: '1px solid #3a3a3f',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** One Readings row: a value, optionally annotated with rating headroom (green/red). */
function readingRow(label: string, text: string, hr: { text: string; over: boolean } | null) {
  return (
    <div style={row}>
      <span style={{ color: '#aab' }}>{label}</span>
      <span style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
        <span style={{ color: '#cdd6e0' }}>{text}</span>
        {hr ? (
          <span style={{ color: hr.over ? '#ff6a52' : '#6ec06e', fontSize: 9, marginLeft: 5 }}>
            {hr.text}
          </span>
        ) : null}
      </span>
    </div>
  )
}
