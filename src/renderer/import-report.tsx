import { chipName, type FpgaOpenReport } from './fpga-open.ts'
import { plural } from './plain-words.ts'
import { THEME } from './theme.ts'

/**
 * How wide the report is, and how far it stands off the canvas edge.
 *
 * Exported because the canvas has to know: a report about a design that COVERS that design is no use, so the
 * canvas fits the design into the room left beside the card, and it can only do that if it is told the number
 * once rather than guessing it.
 */
export const REPORT_WIDTH = 340
export const REPORT_MARGIN = 10

/** A length in canvas pixels. The unit is part of the type because leaving it off changes the meaning. */
export type CanvasPixels = `${number}px`

/**
 * The margin to fit a recovered design inside, in the canvas's own units.
 *
 * Every number carries its `px`. React Flow reads a BARE number as a fraction of the pane, so `right: 374`
 * asks for a margin 374 times the width of the canvas — which it obeys, drawing the whole 286-part design 36
 * pixels across (measured). The unit is not decoration.
 */
export const designFitPadding = (
  reportShowing: boolean,
): { top: CanvasPixels; bottom: CanvasPixels; left: CanvasPixels; right: CanvasPixels } => ({
  top: '24px',
  bottom: '24px',
  left: '24px',
  // The report's own width, its margins, and the shadow it casts past them.
  right: reportShowing ? (`${REPORT_WIDTH + REPORT_MARGIN * 2 + 14}px` as CanvasPixels) : '24px',
})

/**
 * The dismissible overlay every "we brought a foreign file in" report is drawn in. There is no in-app modal
 * system, and this must never block the canvas.
 *
 * It sits INSIDE the canvas area (the element that holds the drawing is the positioned one), not over the
 * whole window. Pinned to the window it covered the toolbar — Connect, Lasso, Meter, Solve and Add Part all
 * sat underneath it — so the first thing a user wanted to do after reading a chip file was the one thing they
 * could not do until they dismissed the report. Now the toolbar is never underneath it, whatever size the
 * window is and however many rows the toolbar has wrapped onto.
 */
function ReportShell({
  title,
  onDismiss,
  children,
}: {
  title: string
  onDismiss: () => void
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: REPORT_MARGIN,
        right: REPORT_MARGIN,
        zIndex: 1000,
        // Border-box so the width and height here are the room it really takes: the canvas keeps the design
        // clear of exactly REPORT_WIDTH, and the card must not quietly be its padding and border wider.
        boxSizing: 'border-box',
        width: REPORT_WIDTH,
        maxWidth: `calc(100% - ${REPORT_MARGIN * 2}px)`,
        maxHeight: `calc(100% - ${REPORT_MARGIN * 2}px)`,
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
      {children}
    </div>
  )
}

export type NetlistReport =
  | {
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
  | {
      /**
       * Nothing came in and nothing went out — the file was refused.
       *
       * Its own shape, because a refusal dressed as an import reads as a success: sent through the import
       * wording with a count of zero, a refused netlist was headlined "Imported 0 parts from the netlist"
       * with "Nothing was opened" filed underneath as a note. The headline is the only line some people
       * read, and that headline said the opposite of what happened.
       */
      kind: 'refused'
      /** The headline — names the door, e.g. 'Could not open “big.chipblocks”'. */
      title: string
      /** Why, in plain words, and what to do instead. */
      reason: string
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
  if (report.kind === 'refused')
    return (
      <ReportShell title={report.title} onDismiss={onDismiss}>
        <div style={{ marginTop: 8, color: THEME.textSoft, lineHeight: 1.55 }}>{report.reason}</div>
      </ReportShell>
    )

  const isImport = report.kind === 'import'
  const countSuffix = report.count === 1 ? '' : 's'

  const title = (() => {
    if (report.format === 'verilog')
      return isImport
        ? `Imported a Verilog module — ${report.count} gate${countSuffix}`
        : `Exported ${report.count} gate${countSuffix} as Verilog`
    if (report.format === 'gds')
      return isImport
        ? `Imported ${report.count} cell${countSuffix} from GDSII`
        : `Exported ${report.count} cell${countSuffix} as GDSII`
    if (report.format === 'oas')
      return isImport
        ? `Imported ${report.count} cell${countSuffix} from OASIS`
        : `Exported ${report.count} cell${countSuffix} as OASIS`
    if (report.format === 'lef')
      return `Exported a standard-cell library (LEF) — ${report.count} macro${countSuffix}`
    if (report.format === 'def')
      return `Exported a placed design (DEF) — ${report.count} component${countSuffix}`
    if (report.format === 'lib')
      return `Exported a timing library (Liberty) — ${report.count} cell${countSuffix}`
    return isImport
      ? `Imported ${report.count} part${countSuffix} from the netlist`
      : `Exported ${report.count} part${countSuffix} to a netlist`
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
    <ReportShell title={title} onDismiss={onDismiss}>
      {report.unsupported.length === 0 && report.warnings.length === 0 ? (
        <div style={{ marginTop: 6, color: THEME.textSoft }}>
          {isImport ? 'Everything converted cleanly.' : 'Everything exported cleanly.'}
        </div>
      ) : null}
      {section(unsupportedTitle, report.unsupported, THEME.statusDanger)}
      {section('Notes', report.warnings, THEME.statusWarn)}
    </ReportShell>
  )
}

/** What the FPGA card is showing: a design that was read, or the reason there isn't one. */
export type FpgaPanel =
  | { kind: 'read'; fileName: string; report: FpgaOpenReport }
  | { kind: 'refused'; fileName: string; reason: string; canChooseDescription: boolean }

/**
 * What came back from reading a programmed FPGA chip — and, far more importantly, what did NOT.
 *
 * A recovered chip design is never complete: some parts cannot be described at all, some are read but must not
 * be believed. Showing only the parts that worked would hand the user a circuit that looks whole and is not, so
 * the three lists below are not an appendix — they are the point of the card, and each one names the individual
 * part and says in ordinary words what is wrong with it.
 */
export function FpgaReportCard({
  panel,
  onDismiss,
  onChooseDescription,
}: {
  panel: FpgaPanel
  onDismiss: () => void
  onChooseDescription: () => void
}) {
  if (panel.kind === 'refused')
    return (
      <ReportShell title={`Could not read “${panel.fileName}”`} onDismiss={onDismiss}>
        <div style={{ marginTop: 8, color: THEME.textSoft, lineHeight: 1.55 }}>{panel.reason}</div>
        {panel.canChooseDescription ? (
          <button
            type="button"
            onClick={onChooseDescription}
            style={{
              marginTop: 12,
              padding: '6px 12px',
              borderRadius: 6,
              border: `1px solid ${THEME.borderStrong}`,
              background: THEME.surfaceRaised,
              color: THEME.textPrimary,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Choose the chip description…
          </button>
        ) : null}
      </ReportShell>
    )

  const { report } = panel
  const chip = chipName(report.family, report.device)
  const partSection = (
    heading: string,
    explanation: string,
    lines: FpgaOpenReport['missing'],
    color: string,
  ) =>
    lines.length === 0 ? null : (
      <div style={{ marginTop: 12 }}>
        <div style={{ color, fontWeight: 600 }}>
          {heading} ({lines.length})
        </div>
        <div style={{ color: THEME.textMuted, marginBottom: 4 }}>{explanation}</div>
        <ul style={{ margin: 0, paddingLeft: 16, color: THEME.textSoft, lineHeight: 1.5 }}>
          {lines.map((line) => (
            <li key={`${line.part}|${line.reason}`}>
              <span style={{ color: THEME.textPrimary }}>{line.part}</span> — {line.reason}.
            </li>
          ))}
        </ul>
      </div>
    )

  return (
    <ReportShell
      title={`Read a ${chip} chip — ${plural(report.partCount, 'logic part', 'logic parts')} recovered`}
      onDismiss={onDismiss}
    >
      <div style={{ marginTop: 6, color: THEME.textSoft, lineHeight: 1.55 }}>
        Those parts are on the canvas as {plural(report.pieceCount, 'piece', 'pieces')} you can open
        and run, with {plural(report.inputCount, 'chip input', 'chip inputs')} you can switch
        between 0 V and 5 V.
      </div>
      {report.missing.length === 0 &&
      report.untrusted.length === 0 &&
      report.incomplete.length === 0 ? (
        <div style={{ marginTop: 10, color: THEME.statusOk }}>
          Nothing was found among the parts that were read that could not be stood behind.
        </div>
      ) : null}
      {partSection(
        'Not read at all — missing from the canvas',
        'These parts of the chip could not be described, so they are not here. Anything they fed is missing too.',
        report.missing,
        THEME.statusDanger,
      )}
      {partSection(
        'Read, but do not trust these',
        'These parts ARE on the canvas and will run, but the value they produce is not the one the real chip produces.',
        report.untrusted,
        THEME.statusDanger,
      )}
      {partSection(
        'Read, with something left out',
        'These parts are right for everything that reads them here, but the chip holds something this reading does not show.',
        report.incomplete,
        THEME.statusWarn,
      )}
      {report.notes.length === 0 ? null : (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: THEME.statusWarn, fontWeight: 600, marginBottom: 3 }}>
            Also worth knowing ({report.notes.length})
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, color: THEME.textSoft, lineHeight: 1.5 }}>
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {/* Always, findings or none. An empty report is not a clean bill of health for the whole chip, and this
          is the sentence that keeps it from reading like one. */}
      <div
        style={{
          marginTop: 12,
          paddingTop: 8,
          borderTop: `1px solid ${THEME.borderSubtle}`,
          color: THEME.textMuted,
          lineHeight: 1.5,
        }}
      >
        {report.scope}
      </div>
      <div style={{ marginTop: 8, color: THEME.textMuted, lineHeight: 1.5 }}>
        {report.untrusted.length + report.incomplete.length === 0
          ? 'No part on the canvas carries a warning of its own.'
          : `The ${plural(report.untrusted.length + report.incomplete.length, 'part', 'parts')} listed above ${report.untrusted.length + report.incomplete.length === 1 ? 'is' : 'are'} marked with a ⚠ on the canvas, and stay${report.untrusted.length + report.incomplete.length === 1 ? 's' : ''} marked when you save this circuit and open it again. Hover a marked part to read why.`}
      </div>
    </ReportShell>
  )
}
