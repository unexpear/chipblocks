import type { CSSProperties } from 'react'
import type { NetInspection, NetStatus } from './net-inspector.ts'
import { THEME } from './theme.ts'
import { formatEng } from './units.ts'
import { WhyPanel } from './why-panel.tsx'

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 11,
  margin: '3px 0',
}
const muted: CSSProperties = { color: THEME.textSoft }
const label: CSSProperties = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: THEME.textFaint,
  marginTop: 7,
  marginBottom: 2,
}

const statusText: Record<NetStatus, string> = {
  contended: 'CONTENDED',
  attention: 'CHECK',
  driven: 'DRIVEN',
  passive: 'PASSIVE',
  undriven: 'NO DRIVER',
}

const statusColor: Record<NetStatus, string> = {
  contended: THEME.statusDanger,
  attention: THEME.statusWarn,
  driven: THEME.statusOk,
  passive: THEME.textSoft,
  undriven: THEME.statusWarn,
}

export function NetInspector({ inspection }: { inspection: NetInspection }) {
  return (
    <div data-testid="net-inspector" style={{ width: 170, fontSize: 11, color: THEME.textPrimary }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>Net Inspector</div>
      <div style={{ ...muted, fontSize: 10, overflowWrap: 'anywhere' }}>
        Canonical net: {inspection.root}
      </div>
      <div style={row}>
        <span style={muted}>State</span>
        <span style={{ color: statusColor[inspection.status], fontWeight: 600 }}>
          {statusText[inspection.status]}
        </span>
      </div>
      <div style={row}>
        <span style={muted}>Endpoints</span>
        <span>{inspection.endpoints.length}</span>
      </div>
      <div style={row}>
        <span style={muted}>Wires</span>
        <span>{inspection.wires.length}</span>
      </div>
      <div style={label}>Solved</div>
      <div style={row}>
        <span style={muted}>Current</span>
        <span>{inspection.currentA === null ? '—' : formatEng(inspection.currentA, 'A')}</span>
      </div>
      <div style={row}>
        <span style={muted}>Wire drop</span>
        <span>
          {inspection.voltageDropV === null ? '—' : formatEng(inspection.voltageDropV, 'V')}
        </span>
      </div>
      <div style={row}>
        <span style={muted}>Length</span>
        <span>{inspection.lengthM === null ? '—' : formatEng(inspection.lengthM, 'm')}</span>
      </div>
      <div style={row}>
        <span style={muted}>Resistance</span>
        <span>
          {inspection.resistanceOhm === null ? '—' : formatEng(inspection.resistanceOhm, 'Ω')}
        </span>
      </div>
      <div style={label}>Next inspection</div>
      <div
        data-testid="net-inspector-next-step"
        style={{ color: THEME.textPrimary, fontSize: 10, lineHeight: 1.35 }}
      >
        {inspection.nextStep}
      </div>
      <WhyPanel system={inspection.why} title="Why this net is here" />
      <div style={label}>Endpoints</div>
      {inspection.endpoints.map((endpoint) => (
        <div
          key={`${endpoint.nodeId}/${endpoint.portId}`}
          style={{ ...row, alignItems: 'flex-start' }}
        >
          <span style={{ ...muted, maxWidth: 108, overflowWrap: 'anywhere' }}>
            {endpoint.nodeLabel} · {endpoint.portLabel}
          </span>
          <span style={{ color: endpoint.role === 'driver' ? THEME.accentBlue : THEME.textSoft }}>
            {endpoint.role}
          </span>
        </div>
      ))}
      {inspection.findings.map((finding) => (
        <div
          key={finding.code}
          style={{
            color: finding.severity === 'error' ? THEME.statusDanger : THEME.statusWarn,
            fontSize: 10,
            lineHeight: 1.3,
            marginTop: 5,
          }}
        >
          {finding.message}
        </div>
      ))}
    </div>
  )
}
