/**
 * Publisher signatures — ed25519 over canonical pack body; refuse invalid; undeclared ≠ verified.
 * No fake PKI: self-declared key ≠ trusted pin.
 */
import { describe, expect, test } from 'vitest'
import { emptyContentIndex, installLocalPackVerified } from '../src/renderer/content-manager.ts'
import { CONTENT_PACK_FORMAT, CONTENT_PACK_VERSION } from '../src/renderer/content-pack.ts'
import { canonicalPackTextForIntegrity, sha256Hex } from '../src/renderer/content-pack-integrity.ts'
import {
  bytesToHex,
  canonicalPackTextForSignature,
  emptyTrustedPublishers,
  exportRawPublicKeyHex,
  parseTrustedPublishers,
  signPackBodyHex,
  verifyPackSignature,
} from '../src/renderer/content-pack-signature.ts'
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
    id: 'sig_demo',
    name: 'Sig Demo',
    packVersion: '1.0.0',
    license: 'MIT',
    parts: [samplePart('sig_buf')],
    ...over,
  }
}

async function generateEd25519() {
  return globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

describe('content-pack publisher signatures (ed25519)', () => {
  test('undeclared signature is not verified', async () => {
    const text = JSON.stringify(basePackObject(), null, 2)
    const v = await verifyPackSignature(text)
    expect(v.kind).toBe('undeclared')
    const installed = await installLocalPackVerified(emptyContentIndex(), text, 1)
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    expect(installed.record.signatureStatus).toBe('none')
    expect(installed.record.trustNote).toMatch(/Undeclared ≠ verified|undeclared ≠ verified/i)
    expect(installed.record.trustNote).not.toMatch(/\bsecure\b/i)
  })

  test('valid self-declared signature installs as valid-untrusted (not pinned identity)', async () => {
    const pair = await generateEd25519()
    const raw = basePackObject()
    const body = JSON.stringify(raw, null, 2)
    const pubHex = await exportRawPublicKeyHex(pair.publicKey)
    const sigHex = await signPackBodyHex(body, pair.privateKey)
    const text = JSON.stringify(
      { ...raw, signature: { alg: 'ed25519', publicKey: pubHex, sig: sigHex } },
      null,
      2,
    )
    // Canonical for signature matches the body we signed
    expect(canonicalPackTextForSignature(text)).toBe(body)

    const v = await verifyPackSignature(text)
    expect(v.kind).toBe('valid-untrusted')

    const installed = await installLocalPackVerified(emptyContentIndex(), text, 2)
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    expect(installed.record.signatureStatus).toBe('valid-untrusted')
    expect(installed.record.trustNote).toMatch(/NOT in your trusted-publishers/i)
    expect(installed.record.trustNote).not.toMatch(/\bsecure\b/i)
  })

  test('valid signature against trusted-publishers pin is valid-trusted', async () => {
    const pair = await generateEd25519()
    const raw = basePackObject()
    const body = JSON.stringify(raw, null, 2)
    const pubHex = await exportRawPublicKeyHex(pair.publicKey)
    const sigHex = await signPackBodyHex(body, pair.privateKey)
    const text = JSON.stringify(
      { ...raw, signature: { alg: 'ed25519', publicKey: pubHex, sig: sigHex } },
      null,
      2,
    )
    const trusted = {
      ...emptyTrustedPublishers(),
      keys: [{ id: 'alice', publicKey: pubHex, comment: 'test pin' }],
    }
    const v = await verifyPackSignature(text, trusted)
    expect(v.kind).toBe('valid-trusted')
    if (v.kind === 'valid-trusted') expect(v.trustedId).toBe('alice')

    const installed = await installLocalPackVerified(emptyContentIndex(), text, 3, trusted)
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    expect(installed.record.signatureStatus).toBe('valid-trusted')
    expect(installed.record.trustNote).toMatch(/trusted-publishers/i)
    expect(installed.record.trustNote).not.toMatch(/\bsecure\b/i)
  })

  test('invalid signature refuses install', async () => {
    const pair = await generateEd25519()
    const raw = basePackObject()
    const body = JSON.stringify(raw, null, 2)
    const pubHex = await exportRawPublicKeyHex(pair.publicKey)
    const sigHex = await signPackBodyHex(body, pair.privateKey)
    // Tamper the body after signing by changing the name in the signed-over object via a different pack
    const tampered = JSON.stringify(
      {
        ...raw,
        name: 'Tampered',
        signature: { alg: 'ed25519', publicKey: pubHex, sig: sigHex },
      },
      null,
      2,
    )
    const v = await verifyPackSignature(tampered)
    expect(v.kind).toBe('invalid')
    const installed = await installLocalPackVerified(emptyContentIndex(), tampered, 4)
    expect(installed.ok).toBe(false)
    if (installed.ok) return
    expect(installed.reason).toMatch(/does not verify|signature/i)
  })

  test('malformed signature field refuses (not silently ignored)', async () => {
    const text = JSON.stringify(
      basePackObject({ signature: { alg: 'ed25519', publicKey: 'nope', sig: 'nope' } }),
      null,
      2,
    )
    const installed = await installLocalPackVerified(emptyContentIndex(), text, 5)
    expect(installed.ok).toBe(false)
  })

  test('signature + matching integrity hash can both pass', async () => {
    const pair = await generateEd25519()
    const raw = basePackObject()
    const body = JSON.stringify(raw, null, 2)
    const hash = await sha256Hex(body)
    const pubHex = await exportRawPublicKeyHex(pair.publicKey)
    const sigHex = await signPackBodyHex(body, pair.privateKey)
    const withBoth = {
      ...raw,
      integrity: { alg: 'sha256', hash },
      signature: { alg: 'ed25519', publicKey: pubHex, sig: sigHex },
    }
    const text = JSON.stringify(withBoth, null, 2)
    expect(canonicalPackTextForIntegrity(text)).toBe(body)
    expect(canonicalPackTextForSignature(text)).toBe(body)
    const installed = await installLocalPackVerified(emptyContentIndex(), text, 6)
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    expect(installed.record.integrityStatus).toBe('match')
    expect(installed.record.signatureStatus).toBe('valid-untrusted')
  })

  test('parseTrustedPublishers accepts the pinned-keys file shape', () => {
    const text = JSON.stringify(
      {
        format: 'chipblocks-trusted-publishers',
        version: 1,
        keys: [{ id: 'bob', publicKey: 'a'.repeat(64) }],
      },
      null,
      2,
    )
    const parsed = parseTrustedPublishers(text)
    expect('keys' in parsed && parsed.keys.length === 1).toBe(true)
  })

  test('bytesToHex round-trip helper is stable', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe('000fff')
  })
})
