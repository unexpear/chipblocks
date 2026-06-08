import type { CSSProperties } from 'react'
import { defaultParameters, defaultProvenance, type Parameters } from './part-defaults.ts'
import type { PartReading } from './part-readings.ts'
import { formatEng } from './units.ts'

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

/**
 * Source-type presets (S19-v3-38). A Source is the circuit's push; picking a type
 * sets a CONSISTENT, real DC source — its nominal voltage AND its internal
 * resistance (why a coin cell sags under load while a 9 V block barely does). All
 * are DC: a battery, or a wall adapter that has already rectified the mains to DC
 * (raw AC mains is the later transient sim). One cited spec per type.
 */
const SOURCE_TYPES: {
  label: string
  voltage: number
  internalResistance: number
  source: string
}[] = [
  {
    label: '9 V battery',
    voltage: 9,
    internalResistance: 1,
    source: 'ANSI/IEC 60086-2 — 9 V 6LR61 (PP3); ~1 Ω fresh',
  },
  {
    label: 'AA battery (1.5 V)',
    voltage: 1.5,
    internalResistance: 0.15,
    source: 'IEC LR6 AA alkaline; ~0.15 Ω fresh',
  },
  {
    label: 'Coin cell (3 V)',
    voltage: 3,
    internalResistance: 10,
    source: 'CR2032 Li coin; ~10 Ω (high internal R)',
  },
  {
    label: 'USB adapter (5 V)',
    voltage: 5,
    internalResistance: 0.5,
    source: 'USB 5 V wall adapter (DC out); ~0.5 Ω w/ cable',
  },
  {
    label: '12 V adapter',
    voltage: 12,
    internalResistance: 0.5,
    source: '12 V DC barrel-jack adapter; ~0.5 Ω regulated',
  },
]

/** The source-type preset whose nominal voltage matches the current value (else null = Custom). */
function currentSourceType(parameters: Parameters | undefined) {
  const v = amountOf(parameters, 'nominal_voltage')
  return SOURCE_TYPES.find((t) => t.voltage === v) ?? null
}

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
  /**
   * Valid material ids per role key (e.g. n_side → direct-bandgap semiconductors).
   * A dropdown falls back to all `materials` when its role isn't listed.
   */
  validMaterials: Record<string, string[]>
  onParam: (key: string, amount: number) => void
  onEnum: (key: string, value: string) => void
  /**
   * Change a material ref. Distinct from onEnum so the App can react physically —
   * e.g. an LED's n_side re-derives its color + forward voltage from the chosen
   * semiconductor's bandgap. The curated color picker stays on onEnum.
   */
  onMaterial: (key: string, value: string) => void
  /** Recompute a resistor's R = ρL/A from its material + geometry (the "Derive R" button). */
  onDeriveResistance: () => void
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
const deriveButton: CSSProperties = {
  marginTop: 6,
  width: '100%',
  background: '#1a1a1e',
  border: '1px solid #3a3a3f',
  color: '#9fb0c0',
  borderRadius: 3,
  padding: '3px 4px',
  fontSize: 10,
  cursor: 'pointer',
}

export function PartInspector({
  selected,
  reading,
  materials,
  validMaterials,
  onParam,
  onEnum,
  onMaterial,
  onDeriveResistance,
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
  // A Source (power_source) gets a type picker that sets a consistent real DC
  // source; the matched preset (by nominal voltage) drives the dropdown + citation.
  const sourceType =
    selected.definition === 'power_source' ? currentSourceType(selected.parameters) : null
  // A resistor carrying a material + geometry can derive R = ρL/A on demand.
  const canDeriveResistance =
    selected.definition === 'resistor' &&
    selected.parameters?.resistive_material !== undefined &&
    selected.parameters?.length !== undefined &&
    selected.parameters?.cross_section_area !== undefined

  const headroom = (quantity: 'current' | 'power', value: number) => {
    if (rating === null || rating.quantity !== quantity) return null
    const pct = Math.round((value / rating.limit) * 100)
    const limitText =
      quantity === 'current' ? formatEng(rating.limit, 'A') : formatEng(rating.limit, 'W')
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
                formatEng(reading.current, 'A'),
                headroom('current', reading.current),
              )
            : null}
          {reading.voltage !== undefined
            ? readingRow('Voltage', formatEng(reading.voltage, 'V'), null)
            : null}
          {reading.power !== undefined
            ? readingRow('Power', formatEng(reading.power, 'W'), headroom('power', reading.power))
            : null}
        </>
      ) : null}

      <div style={sectionLabel}>Values</div>
      {selected.definition === 'power_source' ? (
        <div>
          <label style={row}>
            <span style={{ color: '#aab' }}>Source type</span>
            <select
              value={sourceType ? sourceType.label : 'custom'}
              onChange={(e) => {
                const picked = SOURCE_TYPES.find((s) => s.label === e.target.value)
                if (picked === undefined) return
                // Set a consistent real DC source: nominal voltage + internal resistance.
                onParam('nominal_voltage', picked.voltage)
                onParam('internal_resistance', picked.internalResistance)
              }}
              className="nodrag"
              style={{ ...field, maxWidth: 130 }}
            >
              {sourceType === null ? <option value="custom">Custom</option> : null}
              {SOURCE_TYPES.map((t) => (
                <option key={t.label} value={t.label}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {sourceType ? <div style={sourceNote}>{sourceType.source}</div> : null}
        </div>
      ) : null}
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
            // Offer only materials valid for this role (e.g. n_side → direct-bandgap
            // semiconductors); fall back to all materials when the role isn't listed.
            const allowed = validMaterials[key]
            const base = allowed && allowed.length > 0 ? allowed : materials
            const options = base.includes(current) ? base : [current, ...base]
            return (
              <label key={`${selected.id}:${key}`} style={row}>
                <span style={{ color: '#aab' }}>{humanize(key)}</span>
                <select
                  value={current}
                  onChange={(e) => onMaterial(key, e.target.value)}
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

      {canDeriveResistance ? (
        <button
          type="button"
          onClick={onDeriveResistance}
          className="nodrag"
          style={deriveButton}
          title="Recompute resistance from ρ·L/A — the material's resistivity × the geometry"
        >
          ⟳ Derive R = ρL/A
        </button>
      ) : null}

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
