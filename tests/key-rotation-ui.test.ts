/**
 * The key change card: shown for a valid rotation, with both fingerprints; nothing is confirmed
 * until the confirm button; Cancel writes nothing. jsdom.
 *
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, expect, test } from 'vitest'
import { emptyContentIndex, type InstalledPackRecord } from '../src/renderer/content-manager.ts'
import {
  ContentManagerPanel,
  keyRotationPrompt,
  type PublisherCard,
} from '../src/renderer/content-manager-panel.tsx'
import { NO_REGISTRY_CONFIGURED } from '../src/renderer/content-registry.ts'
import { HELP } from '../src/renderer/help-text.ts'

const reactGlobals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActFlag = reactGlobals.IS_REACT_ACT_ENVIRONMENT
reactGlobals.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActFlag === undefined) delete reactGlobals.IS_REACT_ACT_ENVIRONMENT
  else reactGlobals.IS_REACT_ACT_ENVIRONMENT = previousActFlag
})

const OLD_FP = '11'.repeat(32)
const NEW_FP = '22'.repeat(32)
const record: InstalledPackRecord = {
  id: 'rot_pack',
  name: 'Rot Pack',
  packVersion: '1.1.0',
  license: 'MIT',
  enabled: true,
  installedAt: 1,
  source: 'local-pack',
  partCount: 1,
  footprintCount: 0,
  trustNote: 'Signed.',
  signatureStatus: 'valid-untrusted',
  publisherKeyHex: 'cd'.repeat(32),
}

async function render(publisher: PublisherCard) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const confirmed: string[] = []
  const trusted: string[] = []
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
        publisherByPack: { rot_pack: publisher },
        onClose: () => {},
        onInstallLocal: () => {},
        onSetEnabled: () => {},
        onUninstall: () => {},
        onRegistryUrlChange: () => {},
        onSaveRegistryUrl: () => {},
        onLoadRegistry: () => {},
        onRegistrySelection: () => {},
        onInstallFromRegistry: () => {},
        onTrustPublisher: (key) => trusted.push(key),
        onConfirmRotation: (id) => confirmed.push(id),
      }),
    )
  })
  const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
  const click = async (id: string) => {
    await act(async () => {
      q(id)?.click()
    })
  }
  return { container, root, q, click, confirmed, trusted }
}

const card: PublisherCard = {
  publicKeyHex: 'cd'.repeat(32),
  fingerprint: NEW_FP,
  trust: 'valid-untrusted',
  rotation: { kind: 'valid', fromFingerprint: OLD_FP, toFingerprint: NEW_FP },
}

test('a valid rotation shows the key change and replaces the plain pin button', async () => {
  const { q, root } = await render(card)
  expect(q('content-manager-key-rotation-text')?.textContent).toBe(
    `Publisher key changed: ${OLD_FP} → ${NEW_FP}, signed by your pinned key.`,
  )
  expect(keyRotationPrompt(OLD_FP, NEW_FP)).toBe(
    `Publisher key changed: ${OLD_FP} → ${NEW_FP}, signed by your pinned key.`,
  )
  expect(q('content-manager-trust-state')?.getAttribute('data-trust')).toBe('valid-untrusted')
  expect(q('content-manager-trust-toggle')).toBeNull()
  await act(async () => root.unmount())
})

test('Cancel confirms nothing; the confirm button confirms once', async () => {
  const { q, click, confirmed, trusted, root } = await render(card)
  await click('content-manager-key-rotation-review')
  expect(q('content-manager-key-rotation-confirm')?.textContent).toMatch(
    new RegExp(`Pin the new publisher key ${NEW_FP} .* in place of ${OLD_FP}\\?`),
  )
  await click('content-manager-key-rotation-cancel')
  expect(confirmed).toEqual([])
  expect(q('content-manager-key-rotation-confirm')).toBeNull()
  await click('content-manager-key-rotation-review')
  await click('content-manager-key-rotation-confirm-yes')
  expect(confirmed).toEqual(['rot_pack'])
  expect(trusted).toEqual([])
  await act(async () => root.unmount())
})

test('a pinned key, or a refused rotation, shows no key change card', async () => {
  const pinned = await render({ ...card, trust: 'valid-trusted' })
  expect(pinned.q('content-manager-key-rotation')).toBeNull()
  await act(async () => pinned.root.unmount())
  const refused = await render({
    ...card,
    rotation: { kind: 'refused', reason: 'An old or reused rotation is refused.' },
  })
  expect(refused.q('content-manager-key-rotation')).toBeNull()
  expect(refused.q('content-manager-key-rotation-refused')?.textContent).toBe(
    'An old or reused rotation is refused.',
  )
  expect(refused.q('content-manager-trust-toggle')).not.toBeNull()
  await act(async () => refused.root.unmount())
})

test('every key rotation control has hover help', () => {
  for (const id of [
    'content.rotation.card',
    'content.rotation.review',
    'content.rotation.confirm',
    'content.rotation.cancel',
    'content.rotation.refused',
  ]) {
    expect(HELP[id]?.summary, id).toBeTruthy()
  }
})
