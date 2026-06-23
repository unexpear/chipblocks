import type { TimingReport } from '../static-timing.ts'
import { THEME } from './theme.ts'

/**
 * Timing panel (rung 3c) — the static-timing readout for a clocked circuit. It shows the max clock
 * frequency the design can run at, the critical register-to-register path, and the slack / violations.
 * The gate delays and the critical path are REAL (summed from the transistors via timing-graph.ts);
 * the flip-flop's own t_cq / setup / hold are estimated from a reference gate delay (stated below).
 */

const fmtFreq = (hz: number): string => {
  if (!Number.isFinite(hz)) return '—'
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(2)} GHz`
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(1)} MHz`
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} kHz`
  return `${hz.toFixed(1)} Hz`
}
const fmtTime = (s: number): string => {
  if (!Number.isFinite(s)) return '—'
  if (s >= 1e-3) return `${(s * 1e3).toFixed(2)} ms`
  if (s >= 1e-6) return `${(s * 1e6).toFixed(2)} µs`
  if (s >= 1e-9) return `${(s * 1e9).toFixed(2)} ns`
  return `${(s * 1e12).toFixed(1)} ps`
}

export function TimingPanel({
  report,
  clockDetected,
  light,
}: {
  report: TimingReport
  clockDetected: boolean
  light: boolean
}) {
  const text = light ? THEME.textPrimary : THEME.textSoft
  const { critical, maxFrequency, setupSlack, setupViolated, holdViolations } = report

  if (!critical) {
    return (
      <div style={{ width: 240, fontSize: 11, color: text }}>
        No register-to-register paths yet — wire combinational logic between flip-flops to analyse
        the clock speed.
      </div>
    )
  }

  const row = (label: string, value: string, color?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: THEME.textMuted }}>{label}</span>
      <span style={{ color: color ?? text, fontWeight: 600 }}>{value}</span>
    </div>
  )

  return (
    <div
      style={{
        width: 240,
        fontSize: 11,
        color: text,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {row('Max clock', fmtFreq(maxFrequency), THEME.accentBlueSoft)}
      {row('Critical path', `${critical.from} → ${critical.to}`)}
      {row(
        'Logic depth',
        `${critical.gates.length} gate${critical.gates.length === 1 ? '' : 's'} · ${fmtTime(critical.logicDelayMax)}`,
      )}
      {clockDetected
        ? row('Setup slack', fmtTime(setupSlack), setupViolated ? THEME.statusDanger : text)
        : row('Setup slack', 'add a clock source', THEME.textMuted)}
      {holdViolations.length > 0
        ? row(
            'Hold',
            `⚠ ${holdViolations.length} violation${holdViolations.length === 1 ? '' : 's'}`,
            THEME.statusWarn,
          )
        : row('Hold', 'ok')}
      <div style={{ fontSize: 9, color: THEME.textFaint, marginTop: 4, lineHeight: 1.4 }}>
        Gate delays + the critical path are real (from the transistors). The flip-flop's own
        clock-to-Q / setup / hold are estimated from a reference gate delay.
      </div>
    </div>
  )
}
