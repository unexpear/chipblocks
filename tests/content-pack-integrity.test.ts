/**
 * Pack content-hash integrity — optional declared SHA-256, recorded on-disk hash, honest trust notes.
 * Never claims publisher-signature trust; mismatch refuses install; undeclared is allowed with clear UX.
 */
import { describe, expect, test } from 'vitest'
import {
  emptyContentIndex,
  installLocalPackVerified,
  LOCAL_PACK_TRUST_NOTE,
  refuseRemoteInstall,
} from '../src/renderer/content-manager.ts'
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
import type { UserPart } from '../src/renderer/user-parts.ts'

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

  test('signature field is not treated as proof; trust note says so', async () => {
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
    expect(note).toMatch(/NOT verified/i)
    expect(note).not.toMatch(/\bsecure\b/i)

    const installed = await installLocalPackVerified(emptyContentIndex(), text, 4)
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    expect(installed.record.trustNote).toMatch(/NOT verified/i)
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

  test('serialize round-trip stays a valid pack (integrity field not required on disk)', () => {
    const parsed = deserializeContentPack(JSON.stringify(basePackObject(), null, 2))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const again = deserializeContentPack(serializeContentPack(parsed.pack))
    expect(again.ok).toBe(true)
  })
})
