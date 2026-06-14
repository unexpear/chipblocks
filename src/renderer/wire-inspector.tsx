import type { CSSProperties } from 'react'
import { formatEng } from './units.ts'
import { formatLength, WIRE_GAUGES } from './wire-length.ts'

/**
 * Properties inspector for a selected wire (the edge equivalent of PartInspector).
 * The gauge (AWG) is the one editable knob — picking a thinner gauge raises the
 * wire's R = ρ·L/A live, which re-solves the circuit and reddens its hot spot.
 * Length comes from how the wire is drawn; resistance + current are solved values.
 */
export type SelectedWire = {
  id: string
  gaugeAwg: number
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
const muted: CSSProperties = { color: '#9fb0c0' }

export function WireInspector({
  wire,
  onGauge,
}: {
  wire: SelectedWire
  onGauge: (gaugeAwg: number) => void
}) {
  const { gaugeAwg, lengthM, ohms, amps } = wire
  return (
    <div style={{ width: 170, fontSize: 11, color: '#cdd6e0' }}>
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
        <span>{amps !== null ? formatEng(amps, 'A') : '—'}</span>
      </div>
    </div>
  )
}
