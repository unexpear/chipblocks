/**
 * ~/.chipblocks/trusted-publishers.json — strict parse, trust/untrust writes that refuse to
 * replace a file they could not read, and valid-trusted vs valid-untrusted once the pins are fed in.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import AjvModule from 'ajv/dist/2020.js'
import { describe, expect, test } from 'vitest'
import { emptyContentIndex, installLocalPackVerified } from '../src/renderer/content-manager.ts'
import { CONTENT_PACK_FORMAT, CONTENT_PACK_VERSION } from '../src/renderer/content-pack.ts'
import {
  bytesToHex,
  commitTrustedPublisherChange,
  effectiveTrustedPublishers,
  emptyTrustedPublishers,
  exportRawPublicKeyHex,
  isTrustedPublishers,
  parseTrustedPublishers,
  publisherKeyFingerprint,
  serializeTrustedPublishers,
  signPackBodyHex,
  trustedPublishersAfterTrust,
  trustedPublishersAfterUntrust,
} from '../src/renderer/content-pack-signature.ts'
import type { UserPart } from '../src/renderer/user-parts.ts'

// biome-ignore lint/suspicious/noExplicitAny: CJS interop for Ajv default export
const Ajv = (AjvModule as any).default ?? AjvModule

const validateTrusted = new Ajv({ allErrors: true, strict: false }).compile(
  JSON.parse(readFileSync(join('schemas', 'trusted-publishers.schema.json'), 'utf8')),
)

const samplePart = (id: string): UserPart => ({
  id,
  name: id,
  designatorPrefix: 'U',
  pins: [
    { id: 'a', name: 'A', side: 'left', electrical: 'input' },
    { id: 'y', name: 'Y', side: 'right', electrical: 'output' },
  ],
})

const basePack = () => ({
  format: CONTENT_PACK_FORMAT,
  version: CONTENT_PACK_VERSION,
  id: 'sig_demo',
  name: 'Sig Demo',
  packVersion: '1.0.0',
  license: 'MIT',
  parts: [samplePart('sig_buf')],
})

async function signedPackText(): Promise<{ text: string; publicKey: string }> {
  const pair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])
  const raw = basePack()
  const body = JSON.stringify(raw, null, 2)
  const publicKey = await exportRawPublicKeyHex(pair.publicKey)
  const sig = await signPackBodyHex(body, pair.privateKey)
  const text = JSON.stringify({ ...raw, signature: { alg: 'ed25519', publicKey, sig } }, null, 2)
  return { text, publicKey }
}

function pinFile(publicKey: string, id = 'alice'): string {
  return JSON.stringify(
    {
      format: 'chipblocks-trusted-publishers',
      version: 1,
      keys: [{ id, publicKey }],
    },
    null,
    2,
  )
}

describe('trusted-publishers schema and strict parse', () => {
  test('a well-formed pin file passes the schema and the parser', () => {
    const text = pinFile('ab'.repeat(32))
    const raw = JSON.parse(text) as unknown
    expect(validateTrusted(raw)).toBe(true)
    const parsed = parseTrustedPublishers(text)
    expect(isTrustedPublishers(parsed)).toBe(true)
    if (!isTrustedPublishers(parsed)) return
    expect(parsed.keys).toEqual([{ id: 'alice', publicKey: 'ab'.repeat(32) }])
    expect(validateTrusted(JSON.parse(serializeTrustedPublishers(parsed)))).toBe(true)
  })

  test('malformed files are refused in full, not quietly shortened', () => {
    const cases: Array<[string, RegExp]> = [
      ['{', /not valid JSON/],
      ['[]', /not a JSON object/],
      [JSON.stringify({ format: 'nope', version: 1, keys: [] }), /wrong or missing format/],
      [
        JSON.stringify({ format: 'chipblocks-trusted-publishers', version: 2, keys: [] }),
        /Unsupported trusted-publishers version/,
      ],
      [JSON.stringify({ format: 'chipblocks-trusted-publishers', version: 1 }), /must be an array/],
      [
        JSON.stringify({
          format: 'chipblocks-trusted-publishers',
          version: 1,
          keys: [],
          extra: true,
        }),
        /unknown field/,
      ],
      [
        JSON.stringify({
          format: 'chipblocks-trusted-publishers',
          version: 1,
          keys: [{ publicKey: 'ab'.repeat(32) }, { publicKey: 'nope' }],
        }),
        /Publisher key 2/,
      ],
      [
        JSON.stringify({
          format: 'chipblocks-trusted-publishers',
          version: 1,
          keys: [{ publicKey: 'ab'.repeat(32) }, { publicKey: 'ab'.repeat(32) }],
        }),
        /repeats a public key/,
      ],
    ]
    for (const [text, pattern] of cases) {
      const parsed = parseTrustedPublishers(text)
      expect(isTrustedPublishers(parsed)).toBe(false)
      if (isTrustedPublishers(parsed)) continue
      expect(parsed.reason).toMatch(pattern)
      const effective = effectiveTrustedPublishers(text)
      expect(effective.publishers.keys).toEqual([])
      expect(effective.pinsLoaded).toBe(false)
      expect(effective.status).toMatch(pattern)
      expect(effective.status).toMatch(/Nothing will be written/)
    }
  })

  test('a missing file is no pins, and a later trust click may create the file', () => {
    const effective = effectiveTrustedPublishers(null)
    expect(effective.pinsLoaded).toBe(true)
    expect(effective.publishers).toEqual(emptyTrustedPublishers())
    expect(effective.status).toMatch(/No key is trusted by default/)
  })

  test('a read failure is reported and treated as no trusted keys', () => {
    const effective = effectiveTrustedPublishers(null, 'EACCES')
    expect(effective.pinsLoaded).toBe(false)
    expect(effective.publishers.keys).toEqual([])
    expect(effective.status).toMatch(/EACCES/)
    expect(effective.status).toMatch(/Nothing will be written/)
  })
})

describe('trust and untrust writes', () => {
  test('trust creates a file when none exists, and untrust removes the key', () => {
    const key = 'cd'.repeat(32)
    const trusted = trustedPublishersAfterTrust(null, { publicKey: key, id: 'bob' })
    expect(trusted.ok).toBe(true)
    if (!trusted.ok) return
    expect(trusted.publishers.keys.map((entry) => entry.publicKey)).toEqual([key])
    const dropped = trustedPublishersAfterUntrust(trusted.text, key)
    expect(dropped.ok).toBe(true)
    if (!dropped.ok) return
    expect(dropped.publishers.keys).toEqual([])
  })

  test('trust and untrust refuse to replace a file that does not parse', () => {
    const broken = '{not json'
    const trust = trustedPublishersAfterTrust(broken, { publicKey: 'ab'.repeat(32) })
    const untrust = trustedPublishersAfterUntrust(broken, 'ab'.repeat(32))
    expect(trust.ok).toBe(false)
    expect(untrust.ok).toBe(false)
    if (trust.ok || untrust.ok) return
    expect(trust.reason).toMatch(/Nothing was written/)
    expect(untrust.reason).toMatch(/Nothing was written/)
    expect(trust.reason).toMatch(/not valid JSON/)
  })

  test('untrust of a missing file writes nothing', () => {
    const result = trustedPublishersAfterUntrust(null, 'ab'.repeat(32))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/Nothing was written/)
  })

  test('a read that throws does not call the writer', async () => {
    const writes: string[] = []
    const result = await commitTrustedPublisherChange({
      read: async () => {
        throw new Error('EIO')
      },
      write: async (text) => {
        writes.push(text)
        return { ok: true }
      },
      change: 'trust',
      publicKey: 'ab'.repeat(32),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/EIO/)
    expect(result.reason).toMatch(/Nothing was written/)
    expect(writes).toEqual([])

    const untrust = await commitTrustedPublisherChange({
      read: async () => {
        throw new Error('EIO')
      },
      write: async (text) => {
        writes.push(text)
        return { ok: true }
      },
      change: 'untrust',
      publicKey: 'ab'.repeat(32),
    })
    expect(untrust.ok).toBe(false)
    expect(writes).toEqual([])
  })

  test('a successful trust writes the canonical file and an untrust removes it', async () => {
    let stored: string | null = null
    const key = 'ef'.repeat(32)
    const trusted = await commitTrustedPublisherChange({
      read: async () => stored,
      write: async (text) => {
        stored = text
        return { ok: true }
      },
      change: 'trust',
      publicKey: key,
      id: 'carol',
    })
    expect(trusted.ok).toBe(true)
    expect(stored).not.toBeNull()
    const parsed = parseTrustedPublishers(stored ?? '')
    expect(isTrustedPublishers(parsed) && parsed.keys[0]?.id).toBe('carol')

    const removed = await commitTrustedPublisherChange({
      read: async () => stored,
      write: async (text) => {
        stored = text
        return { ok: true }
      },
      change: 'untrust',
      publicKey: key,
    })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.publishers.keys).toEqual([])
  })
})

describe('trusted vs untrusted classification', () => {
  test('the same signature is valid-trusted only when the pin file names that key', async () => {
    const { text, publicKey } = await signedPackText()
    const pinned = parseTrustedPublishers(pinFile(publicKey))
    expect(isTrustedPublishers(pinned)).toBe(true)
    if (!isTrustedPublishers(pinned)) return

    const trusted = await installLocalPackVerified(emptyContentIndex(), text, 1, pinned)
    expect(trusted.ok).toBe(true)
    if (!trusted.ok) return
    expect(trusted.record.signatureStatus).toBe('valid-trusted')
    expect(trusted.record.publisherKeyHex).toBe(publicKey)

    const untrusted = await installLocalPackVerified(
      emptyContentIndex(),
      text,
      2,
      emptyTrustedPublishers(),
    )
    expect(untrusted.ok).toBe(true)
    if (!untrusted.ok) return
    expect(untrusted.record.signatureStatus).toBe('valid-untrusted')
    expect(untrusted.record.publisherKeyHex).toBe(publicKey)

    const brokenPins = effectiveTrustedPublishers(
      pinFile(publicKey).replace('version": 1', 'version": 9'),
    )
    expect(brokenPins.pinsLoaded).toBe(false)
    const notTrusted = await installLocalPackVerified(
      emptyContentIndex(),
      text,
      3,
      brokenPins.publishers,
    )
    expect(notTrusted.ok).toBe(true)
    if (!notTrusted.ok) return
    expect(notTrusted.record.signatureStatus).toBe('valid-untrusted')
  })

  test('hex and base64 of the same key share one fingerprint', async () => {
    const bytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) bytes[i] = i
    const hex = bytesToHex(bytes)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const b64 = btoa(binary)
    const fromHex = await publisherKeyFingerprint(hex)
    const fromB64 = await publisherKeyFingerprint(b64)
    expect(fromHex).toBe(fromB64)
    expect(fromHex).toMatch(/^[a-f0-9]{64}$/)
  })
})
