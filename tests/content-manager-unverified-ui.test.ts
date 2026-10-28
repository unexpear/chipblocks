/**
 * An unverified pack shows the reason and offers no pin button, in jsdom.
 *
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, expect, test } from 'vitest'
import { emptyContentIndex, type InstalledPackRecord } from '../src/renderer/content-manager.ts'
import { ContentManagerPanel } from '../src/renderer/content-manager-panel.tsx'
import { STORED_SIGNATURE_MISSING } from '../src/renderer/content-pack-stored-trust.ts'
import { NO_REGISTRY_CONFIGURED } from '../src/renderer/content-registry.ts'
import { HELP } from '../src/renderer/help-text.ts'

const reactGlobals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActFlag = reactGlobals.IS_REACT_ACT_ENVIRONMENT
reactGlobals.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActFlag === undefined) delete reactGlobals.IS_REACT_ACT_ENVIRONMENT
  else reactGlobals.IS_REACT_ACT_ENVIRONMENT = previousActFlag
})

const record: InstalledPackRecord = {
  id: 'legacy_pack',
  name: 'Legacy Pack',
  packVersion: '1.0.0',
  license: 'MIT',
  enabled: true,
  installedAt: 1,
  source: 'local-pack',
  partCount: 1,
  footprintCount: 0,
  trustNote:
    'ed25519 signature verified against a public key pinned in your trusted-publishers list.',
  signatureStatus: 'valid-trusted',
  publisherKeyHex: 'ab'.repeat(32),
}

test('an unverified pack shows its reason, hides the install-time trust note, and cannot be pinned', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(ContentManagerPanel, {
        index: { ...emptyContentIndex(), packs: [record] },
        statusMessage: null,
        light: false,
        trustedStatus: '1 publisher key pinned.',
        registryUrl: '',
        registryStatus: NO_REGISTRY_CONFIGURED,
        registryPacks: [],
        registrySelection: '',
        updates: [],
        publisherByPack: {
          legacy_pack: {
            publicKeyHex: '',
            fingerprint: '',
            trust: 'unverified',
            reason: STORED_SIGNATURE_MISSING,
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
        onTrustPublisher: () => {},
      }),
    )
  })
  const state = container.querySelector('[data-testid="content-manager-trust-state"]')
  expect(state?.getAttribute('data-trust')).toBe('unverified')
  expect(state?.textContent).toMatch(/treated as untrusted/)
  expect(container.querySelector('[data-testid="content-manager-trust-reason"]')?.textContent).toBe(
    STORED_SIGNATURE_MISSING,
  )
  expect(container.querySelector('[data-testid="content-manager-trust-toggle"]')).toBeNull()
  expect(
    container.querySelector('[data-testid="content-manager-publisher-fingerprint"]'),
  ).toBeNull()
  expect(container.textContent).not.toContain('verified against a public key pinned')
  expect(HELP['content.trust.unverified']?.summary).toMatch(/did not verify/)
  await act(async () => {
    root.unmount()
  })
  container.remove()
})
