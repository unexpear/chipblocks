/**
 * A cancelled or failed save must not wear a success headline.
 *
 * The canvas used to set the export card in the same turn it asked the main process to
 * write, so closing the save dialog still read "Exported N parts to a netlist". These
 * checks are the decision the canvas now makes after the dialog answers.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { type NetlistReport, NetlistReportCard } from '../src/renderer/import-report.tsx'
import {
  circuitSaveEffect,
  type ExportReport,
  exportReportAfterSave,
  manufacturingZipNote,
  settleExportReport,
  templateSaveEffect,
} from '../src/renderer/save-outcome.ts'

const card = (report: NetlistReport): string =>
  renderToStaticMarkup(
    createElement(NetlistReportCard, {
      report,
      onDismiss: () => {},
    }),
  )

const netlist: ExportReport = {
  kind: 'export',
  count: 4,
  unsupported: ['lamp has no SPICE equivalent'],
  warnings: ['model defaulted'],
}

const verilog: ExportReport = {
  kind: 'export',
  count: 2,
  unsupported: [],
  warnings: [],
  format: 'verilog',
}

describe('export report after the save dialog', () => {
  test('a real write keeps the existing success card, count and notes included', async () => {
    const report = await exportReportAfterSave(
      Promise.resolve({ ok: true, path: '/tmp/led.cir' }),
      netlist,
      'the netlist',
    )
    expect(report).toEqual(netlist)
    const html = card(report as NetlistReport)
    expect(html).toContain('Exported 4 parts to a netlist')
    expect(html).toContain('lamp has no SPICE equivalent')
    expect(html).toContain('model defaulted')
  })

  test('Verilog success still counts gates', async () => {
    const report = await exportReportAfterSave(
      Promise.resolve({ ok: true, path: '/tmp/design.v' }),
      verilog,
      'Verilog',
    )
    expect(report).toBe(verilog)
    expect(card(report as NetlistReport)).toContain('Exported 2 gates as Verilog')
  })

  test('cancelling the dialog shows nothing', async () => {
    const shown: NetlistReport[] = []
    await settleExportReport(
      Promise.resolve({ ok: false, cancelled: true }),
      netlist,
      'the netlist',
      (report) => shown.push(report),
    )
    expect(shown).toEqual([])
    expect(
      await exportReportAfterSave(
        Promise.resolve({ ok: false, cancelled: true }),
        verilog,
        'Verilog',
      ),
    ).toBeNull()
  })

  test('a failed write says it failed and does not say Exported', async () => {
    const formats = [
      'the netlist',
      'Verilog',
      'GDSII',
      'OASIS',
      'the LEF library',
      'the DEF design',
      'the Liberty library',
    ]
    for (const what of formats) {
      const shown: NetlistReport[] = []
      await settleExportReport(
        Promise.resolve({ ok: false, reason: 'Writing the file failed: disk full' }),
        { ...netlist, ...(what === 'Verilog' ? { format: 'verilog' as const } : {}) },
        what,
        (report) => shown.push(report),
      )
      expect(shown).toHaveLength(1)
      const html = card(shown[0] as NetlistReport)
      expect(html).toContain(`Could not export ${what}`)
      expect(html).toContain('Nothing was written.')
      expect(html).toContain('disk full')
      expect(html).not.toContain('Exported')
      expect(html).not.toContain('exported cleanly')
    }
  })

  test('a bare { ok: false } is a failure, not a quiet cancel', async () => {
    const report = await exportReportAfterSave(
      Promise.resolve({ ok: false }),
      netlist,
      'the netlist',
    )
    expect(report?.kind).toBe('refused')
    expect(card(report as NetlistReport)).not.toContain('Exported')
  })

  test('a rejected save and a missing save both refuse, and neither says Exported', async () => {
    const rejected = await exportReportAfterSave(
      Promise.reject(new Error('ipc down')),
      netlist,
      'the netlist',
    )
    const missing = await exportReportAfterSave(undefined, netlist, 'GDSII')
    for (const report of [rejected, missing]) {
      expect(report?.kind).toBe('refused')
      const html = card(report as NetlistReport)
      expect(html).toContain('Nothing was written.')
      expect(html).not.toContain('Exported')
    }
    expect(card(rejected as NetlistReport)).toContain('ipc down')
    expect(card(missing as NetlistReport)).toContain('Could not export GDSII')
  })
})

describe('circuit and template saves', () => {
  test('success remembers the real path', () => {
    expect(circuitSaveEffect({ ok: true, path: '/tmp/led.chipblocks' })).toEqual({
      kind: 'remember',
      path: '/tmp/led.chipblocks',
    })
  })

  test('cancel is quiet and writes nothing into the recent list', () => {
    expect(circuitSaveEffect({ ok: false, cancelled: true })).toEqual({ kind: 'quiet' })
  })

  test('a failed circuit save says it was not saved', () => {
    const effect = circuitSaveEffect({ ok: false, reason: 'Writing the file failed: EACCES' })
    expect(effect.kind).toBe('failed')
    if (effect.kind !== 'failed') return
    const html = card(effect.report)
    expect(html).toContain('Not saved')
    expect(html).toContain('Nothing was written.')
    expect(html).toContain('EACCES')
    expect(html).not.toContain('Exported')
  })

  test('a template is announced only after the write succeeds', () => {
    expect(templateSaveEffect({ ok: true, path: '/tmp/user-templates.json' })).toEqual({
      kind: 'saved',
    })
    const failed = templateSaveEffect({ ok: false, reason: 'Writing failed: disk full' })
    expect(failed.kind).toBe('failed')
    if (failed.kind !== 'failed') return
    const html = card(failed.report)
    expect(html).toContain('Not saved as a template')
    expect(html).toContain('Nothing was written.')
    expect(html).not.toContain('Saved')
  })
})

describe('manufacturing ZIP note', () => {
  test('success names the path that was written', () => {
    expect(manufacturingZipNote({ ok: true, path: '/tmp/manufacturing.zip' })).toBe(
      'manufacturing ZIP saved — /tmp/manufacturing.zip',
    )
  })

  test('cancel leaves no note', () => {
    expect(manufacturingZipNote({ ok: false, cancelled: true })).toBeNull()
  })

  test('a failed write says it was not exported', () => {
    const note = manufacturingZipNote({ ok: false, reason: 'Writing the file failed: disk full' })
    expect(note).toBe('not exported — Writing the file failed: disk full')
    expect(note).not.toContain('saved')
  })
})

describe('the canvas waits for every export dialog', () => {
  test('App.tsx does not report an export before the save promise settles', () => {
    const app = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/App.tsx'),
      'utf8',
    )
    const calls = [
      'saveNetlistData',
      'saveVerilogData',
      'saveGdsData',
      'saveOasisData',
      'saveLefData',
      'saveDefData',
      'saveLibData',
    ]
    for (const name of calls) {
      const at = app.indexOf(`bridge.${name}`)
      expect(at, name).toBeGreaterThan(-1)
      expect(app.slice(Math.max(0, at - 160), at)).toContain('settleExportReport')
    }
    expect(app).not.toMatch(/void bridge\.save(?:Netlist|Verilog|Gds|Oasis|Lef|Def|Lib)Data/)
    expect(app).toContain('manufacturingZipNote')
    expect(app).toContain('circuitSaveEffect')
    expect(app).toContain('templateSaveEffect')
  })
})
