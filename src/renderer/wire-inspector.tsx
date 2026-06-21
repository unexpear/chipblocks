import type { CSSProperties } from 'react'
import { wireAmpacity } from '../thermal-model.ts'
import { THEME } from './theme.ts'
import { formatEng } from './units.ts'
import { formatLength, gaugeAreaM2, WIRE_GAUGES, WIRE_MATERIALS } from './wire-length.ts'

/**
 * Properties inspector for a selected wire (the edge equivalent of PartInspector).
 * The gauge (AWG) is the one editable knob — picking a thinner gauge raises the
 * wire's R = ρ·L/A live, which re-solves the circuit and reddens its hot spot.
 * Length comes from how the wire is drawn; resistance + current are solved values.
 */
export type SelectedWire = {
  id: string
  gaugeAwg: number
  material: string
  lengthM: number | null
  ohms: number | null
  amps: number | null
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
  background: THEME.surfaceInput,
  border: `1px solid ${THEME.borderStrong}`,
  color: THEME.textPrimary,
  borderRadius: 3,
  padding: '2px 4px',
  fontSize: 11,
}
const sectionLabel: CSSProperties = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: THEME.textFaint,
  marginTop: 8,
  marginBottom: 2,
}
const muted: CSSProperties = { color: THEME.textSoft }

export function WireInspector({
  wire,
  onGauge,
  onMaterial,
}: {
  wire: SelectedWire
  onGauge: (gaugeAwg: number) => void
  onMaterial: (material: string) => void
}) {
  const { gaugeAwg, material, lengthM, ohms, amps } = wire
  // The wire's real ampacity from the same hot-spot model — the current at which
  // its middle would reach the 105 C insulation limit — and how hard it is driven.
  const ampacity =
    lengthM !== null && ohms !== null ? wireAmpacity(ohms, lengthM, gaugeAreaM2(gaugeAwg)) : null
  const loadFrac =
    amps !== null && ampacity !== null && ampacity > 0 ? Math.abs(amps) / ampacity : null
  const loadColor =
    loadFrac === null
      ? undefined
      : loadFrac > 1
        ? THEME.statusDanger
        : loadFrac > 0.7
          ? THEME.statusWarn
          : undefined
  return (
    <div style={{ width: 170, fontSize: 11, color: THEME.textPrimary }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>Wire</div>
      <div style={sectionLabel}>Gauge</div>
      <div style={row}>
        <span style={muted}>AWG</span>
        <select
          className="nodrag"
          style={field}
          value={gaugeAwg}
          onChange={(event) => onGauge(Number(event.target.value))}
        >
          {WIRE_GAUGES.map((g) => (
            <option key={g.awg} value={g.awg}>
              {g.awg} AWG · {g.diameterMm.toFixed(2)} mm
            </option>
          ))}
        </select>
      </div>
      <div style={sectionLabel}>Material</div>
      <div style={row}>
        <span style={muted}>Metal</span>
        <select
          className="nodrag"
          style={field}
          value={material}
          onChange={(event) => onMaterial(event.target.value)}
        >
          {WIRE_MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div style={sectionLabel}>Readings</div>
      <div style={row}>
        <span style={muted}>Length</span>
        <span>{lengthM !== null ? formatLength(lengthM) : '—'}</span>
      </div>
      <div style={row}>
        <span style={muted}>Resistance</span>
        <span>{ohms !== null ? formatEng(ohms, 'Ω') : '—'}</span>
      </div>
      <div style={row}>
        <span style={muted}>Current</span>
        <span style={loadColor ? { color: loadColor } : undefined}>
          {amps !== null ? formatEng(amps, 'A') : '—'}
        </span>
      </div>
      <div style={row}>
        <span style={muted}>Rated</span>
        <span>{ampacity !== null ? `~${formatEng(ampacity, 'A')}` : '—'}</span>
      </div>
      {loadFrac !== null && loadFrac > 0.7 ? (
        <div style={{ fontSize: 10, marginTop: 4, color: loadColor }}>
          {loadFrac > 1
            ? `Undersized for this current — over its ~${formatEng(ampacity ?? 0, 'A')} rating.`
            : `Near its rating — ${Math.round(loadFrac * 100)}% of ~${formatEng(ampacity ?? 0, 'A')}.`}
        </div>
      ) : null}
    </div>
  )
}
