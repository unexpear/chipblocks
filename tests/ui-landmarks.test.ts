/**
 * Stable hooks the UI check looks for: the shortcuts panel, the content manager, and the math panel.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import {
  CONTENT_INDEX_FORMAT,
  CONTENT_INDEX_VERSION,
  type InstalledPackRecord,
} from '../src/renderer/content-manager.ts'
import { ContentManagerPanel } from '../src/renderer/content-manager-panel.tsx'
import { DEFAULT_KEYBINDS } from '../src/renderer/keybinds.ts'
import { MathPanel } from '../src/renderer/math-panel.tsx'
import type { MathView } from '../src/renderer/math-view.ts'
import { ShortcutsPanel } from '../src/renderer/shortcuts-panel.tsx'

const pack: InstalledPackRecord = {
  id: 'pack.demo',
  name: 'Demo pack',
  packVersion: '1.0.0',
  license: 'MIT',
  enabled: true,
  installedAt: 0,
  source: 'local-pack',
  partCount: 2,
  footprintCount: 0,
  trustNote: 'test',
}

const view = (converged: boolean): MathView => ({
  converged,
  solver: [],
  parts: [],
  nets: [],
  fields: [],
  unitsKey: [],
})

describe('panel landmarks', () => {
  test('the shortcuts panel is a dialog and each binding is its own row', () => {
    const html = renderToStaticMarkup(
      createElement(ShortcutsPanel, {
        binds: DEFAULT_KEYBINDS,
        onChange: () => {},
        onClose: () => {},
        light: false,
      }),
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Shortcuts and controls"')
    expect(html).toContain('data-testid="shortcut-row"')
    expect(html).toContain('data-action="shortcutsPanel"')
    expect(html).toContain('data-binding="Ctrl+K"')
    expect(html).toContain('data-testid="shortcut-fixed-row"')
  })

  test('the content manager exposes its badge and status message', () => {
    const html = renderToStaticMarkup(
      createElement(ContentManagerPanel, {
        index: { format: CONTENT_INDEX_FORMAT, version: CONTENT_INDEX_VERSION, packs: [pack] },
        statusMessage: 'Installed Demo pack.',
        light: false,
        onClose: () => {},
        onInstallLocal: () => {},
        onSetEnabled: () => {},
        onUninstall: () => {},
      }),
    )
    expect(html).toContain('data-testid="content-manager-badge"')
    expect(html).toContain('data-pack="pack.demo"')
    expect(html).toContain('>ENABLED<')
    expect(html).toContain('data-testid="content-manager-status"')
    expect(html).toContain('Installed Demo pack.')
  })

  test('the math panel carries a converged flag', () => {
    const yes = renderToStaticMarkup(
      createElement(MathPanel, { view: view(true), onClose: () => {}, light: false }),
    )
    const no = renderToStaticMarkup(
      createElement(MathPanel, { view: view(false), onClose: () => {}, light: false }),
    )
    expect(yes).toContain('data-testid="math-panel"')
    expect(yes).toContain('data-converged="true"')
    expect(no).toContain('data-converged="false"')
  })
})
