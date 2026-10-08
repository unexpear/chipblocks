/**
 * Content Manager empty state and the publisher confirm, in jsdom.
 *
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { emptyContentIndex, type InstalledPackRecord } from '../src/renderer/content-manager.ts'
import { ContentManagerPanel } from '../src/renderer/content-manager-panel.tsx'
import {
  NO_REGISTRY_CONFIGURED,
  TRUSTED_PUBLISHERS_UNAVAILABLE,
} from '../src/renderer/content-registry.ts'
import { useContentManager } from '../src/renderer/use-content-manager.tsx'

const reactGlobals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActFlag = reactGlobals.IS_REACT_ACT_ENVIRONMENT
reactGlobals.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActFlag === undefined) delete reactGlobals.IS_REACT_ACT_ENVIRONMENT
  else reactGlobals.IS_REACT_ACT_ENVIRONMENT = previousActFlag
})

function text(id: string): string {
  return document.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''
}

const record: InstalledPackRecord = {
  id: 'sig_demo',
  name: 'Sig Demo',
  packVersion: '1.0.0',
  license: 'MIT',
  enabled: true,
  installedAt: 1,
  source: 'local-pack',
  partCount: 1,
  footprintCount: 0,
  trustNote: 'At install the signature was valid and the key was not pinned.',
  signatureStatus: 'valid-untrusted',
  publisherKeyHex: 'ab'.repeat(32),
}

function OpenPanel(): ReactNode {
  const manager = useContentManager(false, true)
  return createElement('div', null, manager.panel)
}

describe('content manager registry and trust testids', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    Reflect.deleteProperty(window, 'chipblocks')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  test('with no bridge the panel says no registry is configured and no key is pinned', async () => {
    await act(async () => {
      root.render(createElement(OpenPanel))
    })
    await act(async () => {
      window.dispatchEvent(new Event('chipblocks:content-manager'))
    })
    expect(text('content-manager-registry-status')).toContain('No content registry is configured')
    expect(text('content-manager-registry-status')).toContain('no public registry exists')
    expect(text('content-manager-registry-status')).toBe(NO_REGISTRY_CONFIGURED)
    const url = document.querySelector('[data-testid="content-manager-registry-url"]')
    expect(url).toBeInstanceOf(HTMLInputElement)
    expect((url as HTMLInputElement).value).toBe('')
    expect(
      document.querySelector('[data-testid="content-manager-install-from-registry"]'),
    ).not.toBeNull()
    expect(text('content-manager-trusted-status')).toBe(TRUSTED_PUBLISHERS_UNAVAILABLE)
    expect(container.textContent).toContain('No publisher keys ship as trusted')
  })

  test('a signed pack shows its fingerprint and the trust confirm repeats it', async () => {
    const fingerprint = '0123456789abcdef'.repeat(4)
    let trusted: boolean | null = null
    await act(async () => {
      root.render(
        createElement(ContentManagerPanel, {
          index: { ...emptyContentIndex(), packs: [record] },
          statusMessage: null,
          light: false,
          trustedStatus: 'No publisher keys are pinned.',
          registryUrl: '',
          registryStatus: NO_REGISTRY_CONFIGURED,
          registryPacks: [],
          registrySelection: '',
          updates: [{ id: 'sig_demo', name: 'Sig Demo', installed: '1.0.0', offered: '1.1.0' }],
          publisherByPack: {
            sig_demo: {
              publicKeyHex: record.publisherKeyHex ?? '',
              fingerprint,
              trust: 'valid-untrusted',
            },
          },
          onClose: () => {},
          onInstallLocal: () => {},
          onSetEnabled: () => {},
          onUninstall: () => {},
          onRegistryUrlChange: () => {},
          onSaveRegistryUrl: () => {},
          onLoadRegistry: () => {},
          onRegistrySelection: () => {},
          onInstallFromRegistry: () => {},
          onTrustPublisher: (_key, trust) => {
            trusted = trust
          },
        }),
      )
    })
    expect(text('content-manager-publisher-fingerprint')).toContain(fingerprint)
    expect(text('content-manager-trust-state')).toMatch(/not pinned/)
    expect(
      document
        .querySelector('[data-testid="content-manager-trust-state"]')
        ?.getAttribute('data-trust'),
    ).toBe('valid-untrusted')
    expect(text('content-manager-update-available')).toMatch(/Update available/)
    expect(text('content-manager-update-available')).toMatch(/until you install this one/)

    const toggle = document.querySelector('[data-testid="content-manager-trust-toggle"]')
    if (!(toggle instanceof HTMLButtonElement)) throw new Error('trust toggle missing')
    await act(async () => {
      toggle.click()
    })
    expect(text('content-manager-trust-confirm')).toContain(fingerprint)
    const yes = document.querySelector('[data-testid="content-manager-trust-confirm-yes"]')
    if (!(yes instanceof HTMLButtonElement)) throw new Error('confirm missing')
    await act(async () => {
      yes.click()
    })
    expect(trusted).toBe(true)
  })
})
