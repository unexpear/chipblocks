/**
 * Pack content-hash integrity — optional declared SHA-256, recorded on-disk hash, honest trust notes.
 * Never claims publisher-signature trust; mismatch refuses install; undeclared is allowed with clear UX.
 */
import { describe, expect, test } from 'vitest'
import {
  emptyContentIndex,
  installedPackStatusLabel,
  installLocalPackVerified,
  LOCAL_PACK_TRUST_NOTE,
  refuseRemoteInstall,
} from '../src/renderer/content-manager.ts'
import { CONTENT_MANAGER_INTRO } from '../src/renderer/content-manager-panel.tsx'
import {
  CONTENT_PACK_FORMAT,
  CONTENT_PACK_VERSION,
  deserializeContentPack,
  serializeContentPack,
} from '../src/renderer/content-pack.ts'
import {
  assertStoredContentHash,
  canonicalPackTextForIntegrity,
  sha256Hex,
  trustNoteForVerdict,
  verifyPackIntegrity,
} from '../src/renderer/content-pack-integrity.ts'
import { applyEnabledPacks } from '../src/renderer/use-content-manager.tsx'
import {
  clearAllCommunityParts,
  getCommunityPackIdForPart,
  registerUserPart,
  resolveUserPart,
  setUserParts,
  type UserPart,
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

function basePackObject(over: Record<string, unknown> = {}) {
  return {
    format: CONTENT_PACK_FORMAT,
    version: CONTENT_PACK_VERSION,
    id: 'trust_demo',
    name: 'Trust Demo',
    packVersion: '1.0.0',
    license: 'MIT',
    parts: [samplePart('trust_buf')],
    ...over,
  }
}

describe('content-pack integrity', () => {
  test('undeclared integrity installs with honest trust note + recorded hash', async () => {
    const text = JSON.stringify(basePackObject(), null, 2)
    const installed = await installLocalPackVerified(emptyContentIndex(), text, 1)
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    expect(installed.record.integrityStatus).toBe('undeclared')
    expect(installed.record.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(installed.record.trustNote).toContain('Not a publisher signature')
    expect(installed.record.trustNote).not.toMatch(/secure/i)
  })

  test('declared SHA-256 matching the canonical body installs as match', async () => {
    const raw = basePackObject()
    const body = JSON.stringify(raw, null, 2)
    const hash = await sha256Hex(body)
    const withIntegrity = { ...raw, integrity: { alg: 'sha256', hash } }
    const text = JSON.stringify(withIntegrity, null, 2)
    // Sanity: canonical strip matches body we hashed
    const canonical = canonicalPackTextForIntegrity(text)
    expect(canonical).toBe(body)

    const installed = await installLocalPackVerified(emptyContentIndex(), text, 2)
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    expect(installed.record.integrityStatus).toBe('match')
    expect(installed.record.trustNote).toContain('file integrity only')
    expect(installed.record.trustNote).not.toMatch(/\bsecure\b/i)
  })

  test('declared SHA-256 mismatch refuses install', async () => {
    const raw = basePackObject({
      integrity: {
        alg: 'sha256',
        hash: '0'.repeat(64),
      },
    })
    const text = JSON.stringify(raw, null, 2)
    const installed = await installLocalPackVerified(emptyContentIndex(), text, 3)
    expect(installed.ok).toBe(false)
    if (installed.ok) return
    expect(installed.reason).toMatch(/does not match/i)
  })

  test('malformed signature field is not treated as content-hash proof; install refuses via signature gate', async () => {
    const text = JSON.stringify(
      basePackObject({ signature: { alg: 'ed25519', sig: 'deadbeef' } }),
      null,
      2,
    )
    const verdict = await verifyPackIntegrity(text)
    expect(verdict.kind).toBe('undeclared')
    if (verdict.kind !== 'undeclared') return
    expect(verdict.signatureFieldPresent).toBe(true)
    const note = trustNoteForVerdict(verdict)
    expect(note).not.toMatch(/\bsecure\b/i)
    // Integrity alone would allow install; the signature gate refuses a malformed sig.
    const installed = await installLocalPackVerified(emptyContentIndex(), text, 4)
    expect(installed.ok).toBe(false)
    if (installed.ok) return
    expect(installed.reason).toMatch(/signature|publicKey|ed25519/i)
  })

  test('assertStoredContentHash catches tamper; missing hash loads with legacy flag (not silent trust)', async () => {
    const text = JSON.stringify(basePackObject(), null, 2)
    const hash = await sha256Hex(text)
    expect((await assertStoredContentHash(text, hash)).ok).toBe(true)
    expect((await assertStoredContentHash(`${text}\n`, hash)).ok).toBe(false)
    const missing = await assertStoredContentHash(text, undefined)
    expect(missing.ok).toBe(true)
    if (missing.ok) expect(missing.legacyMissingHash).toBe(true)
  })

  test('remote install still refused; LOCAL_PACK_TRUST_NOTE stays non-secure', () => {
    expect(refuseRemoteInstall('https://evil.example/pack.json').ok).toBe(false)
    expect(LOCAL_PACK_TRUST_NOTE).not.toMatch(/\bsecure\b/i)
  })

  test('a declared but unusable integrity field is refused, not treated as "no hash"', async () => {
    const sha512 = JSON.stringify(
      basePackObject({ integrity: { alg: 'sha512', hash: 'ab'.repeat(64) } }),
      null,
      2,
    )
    const verdict = await verifyPackIntegrity(sha512)
    expect(verdict.kind).toBe('unsupported')
    const installed = await installLocalPackVerified(emptyContentIndex(), sha512, 5)
    expect(installed.ok).toBe(false)
    if (installed.ok) return
    expect(installed.reason).toMatch(/sha512|only sha256/i)
    expect(installed.reason).not.toMatch(/no content-hash declaration/i)

    const badHash = JSON.stringify(
      basePackObject({ integrity: { alg: 'sha256', hash: 'not-a-hash' } }),
      null,
      2,
    )
    const bad = await installLocalPackVerified(emptyContentIndex(), badHash, 6)
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.reason).toMatch(/64 hex/i)
  })

  test('serialize round-trip stays a valid pack (integrity field not required on disk)', () => {
    const parsed = deserializeContentPack(JSON.stringify(basePackObject(), null, 2))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const again = deserializeContentPack(serializeContentPack(parsed.pack))
    expect(again.ok).toBe(true)
  })
})

describe('enabled pack reload does not hide a failed load', () => {
  const enabled = (id: string, contentHash?: string) => ({
    ...emptyContentIndex(),
    packs: [
      {
        id,
        name: id,
        packVersion: '1.0.0',
        license: 'MIT',
        enabled: true,
        installedAt: 1,
        source: 'local-pack' as const,
        partCount: 1,
        footprintCount: 0,
        trustNote: 'install-time note that must not hide a failed reload',
        integrityStatus: 'match' as const,
        ...(contentHash !== undefined ? { contentHash } : {}),
      },
    ],
  })

  test('a missing pack file is reported as blocked, not silently skipped', async () => {
    const issues = await applyEnabledPacks(
      { readContentPack: async () => null },
      enabled('missing_pack'),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]?.blocked).toBe(true)
    expect(issues[0]?.reason).toMatch(/could not be read/)
    expect(installedPackStatusLabel(true, true)).toBe('ENABLED · NOT LOADED')
  })

  test('a file that no longer parses is reported, even when the stored hash matches', async () => {
    const text = '{not json'
    const hash = await sha256Hex(text)
    const issues = await applyEnabledPacks(
      { readContentPack: async () => text },
      enabled('bad_pack', hash),
    )
    expect(issues.some((issue) => issue.blocked && /did not load/i.test(issue.reason))).toBe(true)
  })

  test('a part id you already authored is skipped, and the skip is reported', async () => {
    const text = JSON.stringify(
      basePackObject({ parts: [samplePart('already_mine'), samplePart('from_the_pack')] }),
    )
    registerUserPart(samplePart('already_mine'))
    try {
      const hash = await sha256Hex(text)
      const issues = await applyEnabledPacks(
        { readContentPack: async () => text },
        enabled('trust_demo', hash),
      )
      expect(issues.some((issue) => !issue.blocked && /skipped/i.test(issue.reason))).toBe(true)
      expect(resolveUserPart('from_the_pack')?.id).toBe('from_the_pack')
      expect(getCommunityPackIdForPart('from_the_pack')).toBe('trust_demo')
      expect(getCommunityPackIdForPart('already_mine')).toBeUndefined()
      expect(resolveUserPart('already_mine')?.id).toBe('already_mine')
    } finally {
      setUserParts([])
      clearAllCommunityParts()
    }
  })

  test('the content-manager intro does not claim signatures are unchecked', () => {
    expect(CONTENT_MANAGER_INTRO).not.toMatch(/signatures are not verified/i)
    expect(CONTENT_MANAGER_INTRO).toMatch(/invalid signatures are refused/i)
    expect(CONTENT_MANAGER_INTRO).toMatch(/trusted-publishers\.json/)
    expect(CONTENT_MANAGER_INTRO).not.toMatch(/\bsecure\b/i)
  })
})
