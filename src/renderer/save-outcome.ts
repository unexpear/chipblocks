import type { NetlistReport } from './import-report.tsx'

/**
 * What a save or export dialog returns.
 *
 * `cancelled` is set only when the user closed the dialog, so the canvas can stay quiet.
 * A write that failed leaves `cancelled` unset and carries `reason`. `ok: true` means the
 * bytes are on disk at `path`. Older callers that only read `ok` still work.
 */
export type SaveDialogOutcome = {
  ok: boolean
  path?: string
  cancelled?: boolean
  reason?: string
}

/**
 * The success card. `kind` is the literal `'export'` (the shared report type also allows
 * `'import'` on the same shape, so Extract cannot pick this branch out).
 */
export type ExportReport = {
  kind: 'export'
  count: number
  unsupported: string[]
  warnings: string[]
  format?: 'verilog' | 'gds' | 'lef' | 'def' | 'oas' | 'lib'
}

/** A refusal whose headline cannot be read as a successful save or export. */
export function refusedSaveReport(title: string, detail: string | undefined): NetlistReport {
  const extra = detail?.trim() ?? ''
  const reason =
    extra.length === 0
      ? 'Nothing was written.'
      : extra.startsWith('Nothing was written')
        ? extra
        : `Nothing was written. ${extra}`
  return { kind: 'refused', title, reason }
}

/**
 * The card to show after an export dialog. `null` means stay quiet: the user cancelled,
 * and a success card would be a lie about a file that was not written.
 */
export async function exportReportAfterSave(
  save: Promise<SaveDialogOutcome> | undefined,
  success: ExportReport,
  what: string,
): Promise<NetlistReport | null> {
  if (save === undefined) {
    return refusedSaveReport(`Could not export ${what}`, 'This window cannot save a file.')
  }
  let result: SaveDialogOutcome
  try {
    result = await save
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return refusedSaveReport(`Could not export ${what}`, message)
  }
  if (result.ok === true) return success
  if (result.cancelled === true) return null
  return refusedSaveReport(`Could not export ${what}`, result.reason)
}

/** Show the export card only when there is something true to say. Cancel stays silent. */
export function settleExportReport(
  save: Promise<SaveDialogOutcome> | undefined,
  success: ExportReport,
  what: string,
  show: (report: NetlistReport) => void,
): Promise<void> {
  return exportReportAfterSave(save, success, what).then((report) => {
    if (report !== null) show(report)
  })
}

export type CircuitSaveEffect =
  | { kind: 'remember'; path: string }
  | { kind: 'quiet' }
  | { kind: 'failed'; report: NetlistReport }

/** Remember a circuit only after it is on disk. Cancel is quiet; a failed write says so. */
export function circuitSaveEffect(result: SaveDialogOutcome): CircuitSaveEffect {
  if (result.ok === true && result.path !== undefined && result.path.length > 0) {
    return { kind: 'remember', path: result.path }
  }
  if (result.cancelled === true) return { kind: 'quiet' }
  return { kind: 'failed', report: refusedSaveReport('Not saved', result.reason) }
}

export type TemplateSaveEffect = { kind: 'saved' } | { kind: 'failed'; report: NetlistReport }

export function templateSaveEffect(result: SaveDialogOutcome): TemplateSaveEffect {
  if (result.ok === true) return { kind: 'saved' }
  return { kind: 'failed', report: refusedSaveReport('Not saved as a template', result.reason) }
}

/**
 * The one-line manufacturing-ZIP note. Success names the real path. Cancel is no note.
 * A failed write says it was not exported, and never says "saved".
 */
export function manufacturingZipNote(result: SaveDialogOutcome): string | null {
  if (result.ok === true && result.path !== undefined && result.path.length > 0) {
    return `manufacturing ZIP saved — ${result.path}`
  }
  if (result.ok === true) return 'manufacturing ZIP saved'
  if (result.cancelled === true) return null
  const detail = result.reason?.trim() || 'the file was not written'
  return `not exported — ${detail}`
}
