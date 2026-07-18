import { THEME } from './theme.ts'

export type NetlistReport = {
  /** Which direction — sets the wording. */
  kind: 'import' | 'export'
  /** How many parts converted. */
  count: number
  /** Things with no faithful equivalent — listed verbatim, never silently dropped. */
  unsupported: string[]
  /** Converted, but with a stated assumption (a defaulted model, an ignored bulk node, auto-layout…). */
  warnings: string[]
  /** The interchange format — tunes the wording; absent ⇒ the SPICE / netlist wording. */
  format?: 'verilog' | 'gds' | 'lef' | 'def' | 'oas' | 'lib'
}

/**
 * The report shown after importing or exporting a netlist: how many parts converted, what could not
 * (listed verbatim, per the anti-placeholder rule), and the assumptions made. A dismissible overlay —
 * there is no in-app modal system, and it never blocks the canvas.
 */
export function NetlistReportCard({
  report,
  onDismiss,
}: {
  report: NetlistReport
  onDismiss: () => void
}) {
  const isImport = report.kind === 'import'
  const plural = report.count === 1 ? '' : 's'

  const title = (() => {
    if (report.format === 'verilog')
      return isImport
        ? `Imported a Verilog module — ${report.count} gate${plural}`
        : `Exported ${report.count} gate${plural} as Verilog`
    if (report.format === 'gds')
      return isImport
        ? `Imported ${report.count} cell${plural} from GDSII`
        : `Exported ${report.count} cell${plural} as GDSII`
    if (report.format === 'oas')
      return isImport
        ? `Imported ${report.count} cell${plural} from OASIS`
        : `Exported ${report.count} cell${plural} as OASIS`
    if (report.format === 'lef')
      return `Exported a standard-cell library (LEF) — ${report.count} macro${plural}`
    if (report.format === 'def')
      return `Exported a placed design (DEF) — ${report.count} component${plural}`
    if (report.format === 'lib')
      return `Exported a timing library (Liberty) — ${report.count} cell${plural}`
    return isImport
      ? `Imported ${report.count} part${plural} from the netlist`
      : `Exported ${report.count} part${plural} to a netlist`
  })()
  const unsupportedTitle = (() => {
    if (report.format === 'verilog')
      return isImport
        ? 'Could not represent — reported, not built'
        : 'Could not export — not a logic gate'
    if (report.format === 'gds' || report.format === 'oas') return 'Could not place'
    if (report.format === 'lef') return 'Not a primitive cell — black-boxed'
    if (report.format === 'def') return 'Could not place'
    if (report.format === 'lib') return 'Not a primitive cell — omitted (untimed)'
    return isImport
      ? 'Could not convert — left out of the circuit'
      : 'Could not export — no SPICE equivalent'
  })()

  const section = (heading: string, items: string[], color: string) =>
    items.length === 0 ? null : (
      <div style={{ marginTop: 10 }}>
        <div style={{ color, fontWeight: 600, marginBottom: 3 }}>
          {heading} ({items.length})
        </div>
        <ul style={{ margin: 0, paddingLeft: 16, color: THEME.textSoft, lineHeight: 1.5 }}>
          {items.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    )

  return (
    <div
      style={{
        position: 'fixed',
        top: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        width: 480,
        maxWidth: '90vw',
        maxHeight: '72vh',
        overflowY: 'auto',
        padding: '14px 16px',
        borderRadius: 8,
        background: THEME.surfacePanel,
        border: `1px solid ${THEME.borderStrong}`,
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)',
        fontSize: 12,
        color: THEME.textPrimary,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            border: 'none',
            background: 'transparent',
            color: THEME.textMuted,
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
      {report.unsupported.length === 0 && report.warnings.length === 0 ? (
        <div style={{ marginTop: 6, color: THEME.textSoft }}>
          {isImport ? 'Everything converted cleanly.' : 'Everything exported cleanly.'}
        </div>
      ) : null}
      {section(unsupportedTitle, report.unsupported, THEME.statusDanger)}
      {section('Notes', report.warnings, THEME.statusWarn)}
    </div>
  )
}
