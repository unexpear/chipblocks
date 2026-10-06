/**
 * Plugin / Content Manager — pack format, license gate, install index, cited catalog rows,
 * and honest remote-install refusal. No network; local pack validation only.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { CITED_CONTENT_CATALOG } from '../src/renderer/content-catalog.ts'
import {
  deserializeContentIndex,
  emptyContentIndex,
  enabledPackIds,
  installLocalPack,
  LOCAL_PACK_TRUST_NOTE,
  managerRows,
  refuseRemoteInstall,
  serializeContentIndex,
  setPackEnabled,
  uninstallPack,
} from '../src/renderer/content-manager.ts'
import {
  ACCEPTED_PACK_LICENSES,
  CONTENT_PACK_FORMAT,
  CONTENT_PACK_VERSION,
  deserializeContentPack,
  licenseGate,
  serializeContentPack,
} from '../src/renderer/content-pack.ts'
import type { UserPart } from '../src/renderer/user-parts.ts'
import {
  clearAllCommunityParts,
  getCommunityPackIdForPart,
  resolveUserPart,
  setCommunityPackParts,
} from '../src/renderer/user-parts.ts'

const samplePart = (id: string): UserPart => ({
  id,
  name: id,
  designatorPrefix: 'U',
  pins: [
    { id: 'a', name: 'A', side: 'left', electrical: 'input' },
    { id: 'y', name: 'Y', side: 'right', electrical: 'output' },
  ],
})

const samplePackJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: CONTENT_PACK_FORMAT,
    version: CONTENT_PACK_VERSION,
    id: 'demo_pack',
    name: 'Demo Pack',
    packVersion: '1.0.0',
    license: 'MIT',
    description: 'A test community pack',
    parts: [samplePart('demo_buffer')],
    ...over,
  })

afterEach(() => {
  clearAllCommunityParts()
})

describe('content pack format + license gate', () => {
  test('round-trips a valid local pack', () => {
    const parsed = deserializeContentPack(samplePackJson())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.pack.id).toBe('demo_pack')
    expect(parsed.pack.parts).toHaveLength(1)
    const again = deserializeContentPack(serializeContentPack(parsed.pack))
    expect(again.ok).toBe(true)
    if (again.ok) expect(again.pack.parts[0]?.id).toBe('demo_buffer')
  })

  test('rejects bad JSON, wrong format, future version, bad id', () => {
    expect(deserializeContentPack('not json').ok).toBe(false)
    expect(deserializeContentPack(JSON.stringify({ format: 'nope' })).ok).toBe(false)
    expect(deserializeContentPack(samplePackJson({ version: 99 })).ok).toBe(false)
    expect(deserializeContentPack(samplePackJson({ id: 'Bad-Id' })).ok).toBe(false)
  })

  test('license gate accepts whitelist and refuses GPL / unknown', () => {
    for (const lic of ACCEPTED_PACK_LICENSES) {
      expect(licenseGate(lic).ok).toBe(true)
    }
    expect(licenseGate('GPL-3.0').ok).toBe(false)
    expect(licenseGate('AGPL-3.0').ok).toBe(false)
    expect(licenseGate('Proprietary-Evil').ok).toBe(false)
    expect(licenseGate('').ok).toBe(false)
    expect(deserializeContentPack(samplePackJson({ license: 'GPL-3.0' })).ok).toBe(false)
  })

  test('drops a malformed part, keeps the good ones', () => {
    const text = samplePackJson({
      parts: [samplePart('good_one'), { id: 'Bad Id', name: 'x', designatorPrefix: 'U', pins: [] }],
    })
    const parsed = deserializeContentPack(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.pack.parts.map((p) => p.id)).toEqual(['good_one'])
  })
})

describe('install index + manager rows', () => {
  test('installLocalPack validates then records; remote install refused', () => {
    const empty = emptyContentIndex()
    const installed = installLocalPack(empty, samplePackJson(), 1000)
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    expect(installed.record.source).toBe('local-pack')
    expect(installed.record.enabled).toBe(true)
    expect(installed.record.trustNote).toBe(LOCAL_PACK_TRUST_NOTE)
    expect(enabledPackIds(installed.index)).toEqual(['demo_pack'])

    const remote = refuseRemoteInstall('https://example.com/pack.json')
    expect(remote.ok).toBe(false)
    expect(remote.reason).toMatch(/Remote install refused/)

    const bad = installLocalPack(empty, samplePackJson({ license: 'GPL-3.0' }))
    expect(bad.ok).toBe(false)
  })

  test('enable / disable / uninstall; index round-trip', () => {
    const installed = installLocalPack(emptyContentIndex(), samplePackJson(), 50)
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    const disabled = setPackEnabled(installed.index, 'demo_pack', false)
    expect('ok' in disabled && disabled.ok === false).toBe(false)
    if ('ok' in disabled) return
    expect(enabledPackIds(disabled)).toEqual([])
    const gone = uninstallPack(disabled, 'demo_pack')
    expect('ok' in gone && gone.ok === false).toBe(false)
    if ('ok' in gone) return
    expect(gone.packs).toHaveLength(0)

    const text = serializeContentIndex(installed.index)
    const back = deserializeContentIndex(text)
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.index.packs[0]?.id).toBe('demo_pack')
  })

  test('managerRows lists installed then uninstalled cited catalog entries', () => {
    expect(CITED_CONTENT_CATALOG.length).toBeGreaterThanOrEqual(6)
    const installed = installLocalPack(
      emptyContentIndex(),
      samplePackJson({ id: 'chipblocks_audio', name: 'chipblocks-audio' }),
      1,
    )
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    const rows = managerRows(installed.index)
    expect(rows[0]).toMatchObject({ kind: 'installed', record: { id: 'chipblocks_audio' } })
    expect(rows.some((r) => r.kind === 'catalog' && r.entry.id === 'chipblocks_peripherals')).toBe(
      true,
    )
    expect(rows.some((r) => r.kind === 'catalog' && r.entry.id === 'chipblocks_audio')).toBe(false)
  })
})

describe('community registry (enabled pack parts)', () => {
  test('setCommunityPackParts registers for resolve; clear removes', () => {
    const part = samplePart('community_xor')
    expect(setCommunityPackParts('demo_pack', [part])).toBe(1)
    expect(resolveUserPart('community_xor')?.name).toBe('community_xor')
    expect(getCommunityPackIdForPart('community_xor')).toBe('demo_pack')
    clearAllCommunityParts()
    expect(resolveUserPart('community_xor')).toBeUndefined()
  })
})
