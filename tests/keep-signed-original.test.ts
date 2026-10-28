/**
 * Signed packs keep their signed original on disk, and trust is re-verified from that file on
 * load. Edits to the pack file or to the install index's trust fields make the pack
 * unverified (treated as untrusted), never trusted. No disk access: install output is captured
 * in memory.
 */

import { describe, expect, test } from 'vitest'
import {
  emptyContentIndex,
  type InstalledPackRecord,
  installedPackFiles,
  installLocalPackVerified,
} from '../src/renderer/content-manager.ts'
import {
  CONTENT_PACK_FORMAT,
  CONTENT_PACK_VERSION,
  serializeContentPack,
} from '../src/renderer/content-pack.ts'
import { sha256HexBytes } from '../src/renderer/content-pack-integrity.ts'
import {
  exportRawPublicKeyHex,
  publisherTrustLabel,
  signPackBodyHex,
  type TrustedPublishers,
} from '../src/renderer/content-pack-signature.ts'
import {
  liveTrustFromStored,
  STORED_SIGNATURE_MISSING,
  verifyStoredSignature,
} from '../src/renderer/content-pack-stored-trust.ts'
import {
  installDownloadedRegistryPack,
  type RegistryPackEntry,
} from '../src/renderer/content-registry.ts'
import { applyEnabledPacks } from '../src/renderer/use-content-manager.tsx'

type KeyPair = { publicKey: CryptoKey; privateKey: CryptoKey }

async function newKey(): Promise<KeyPair> {
  return (await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as KeyPair
}

function body(id: string, name = 'Kept Pack'): Record<string, unknown> {
  return {
    format: CONTENT_PACK_FORMAT,
    version: CONTENT_PACK_VERSION,
    id,
    name,
    packVersion: '1.0.0',
    license: 'MIT',
    parts: [
      {
        id: `${id}_buf`,
        name: 'Kept Buffer',
        designatorPrefix: 'U',
        pins: [
          { id: 'a', name: 'A', side: 'left', electrical: 'input' },
          { id: 'y', name: 'Y', side: 'right', electrical: 'output' },
        ],
      },
    ],
  }
}

async function signed(id = 'kept_pack', key?: KeyPair): Promise<{ text: string; key: string }> {
  const pair = key ?? (await newKey())
  const raw = body(id)
  const publicKey = await exportRawPublicKeyHex(pair.publicKey)
  const sig = await signPackBodyHex(JSON.stringify(raw, null, 2), pair.privateKey)
  return {
    text: JSON.stringify({ ...raw, signature: { alg: 'ed25519', publicKey, sig } }, null, 2),
    key: publicKey,
  }
}

function pins(...keys: string[]): TrustedPublishers {
  return {
    format: 'chipblocks-trusted-publishers',
    version: 1,
    keys: keys.map((publicKey) => ({ publicKey })),
  }
}

/** What install writes: the on-disk text and the index row. */
async function install(text: string, trusted?: TrustedPublishers) {
  const installed = await installLocalPackVerified(emptyContentIndex(), text, 1, trusted)
  if (!installed.ok) throw new Error(installed.reason)
  return installedPackFiles(installed, text)
}

describe('install keeps the signed original', () => {
  test('a signed pack is written exactly as signed, with its signature and signer key', async () => {
    const pack = await signed()
    const files = await install(pack.text)
    expect(files.onDiskText).toBe(pack.text)
    const onDisk = JSON.parse(files.onDiskText) as { signature: { publicKey: string } }
    expect(onDisk.signature.publicKey).toBe(pack.key)
    expect(files.record.contentHash).toBe(
      await sha256HexBytes(new TextEncoder().encode(files.onDiskText)),
    )
    expect(files.record.publisherKeyHex).toBe(pack.key)
  })

  test('an unsigned pack is still written normalized, as before', async () => {
    const text = JSON.stringify({ ...body('plain_pack'), extra: 'dropped' })
    const installed = await installLocalPackVerified(emptyContentIndex(), text, 1)
    if (!installed.ok) throw new Error(installed.reason)
    const files = await installedPackFiles(installed, text)
    expect(files.onDiskText).toBe(serializeContentPack(installed.pack))
    expect(await verifyStoredSignature(files.record, files.onDiskText)).toEqual({
      kind: 'unsigned',
    })
  })

  test('a registry install writes the signed original too', async () => {
    const pack = await signed('reg_kept')
    const bytes = new TextEncoder().encode(pack.text)
    const sig = (JSON.parse(pack.text) as { signature: { publicKey: string; sig: string } })
      .signature
    const entry: RegistryPackEntry = {
      id: 'reg_kept',
      version: '1.0.0',
      downloadUrl: 'https://example.invalid/reg_kept.json',
      size: bytes.byteLength,
      sha256: await sha256HexBytes(bytes),
      signature: { alg: 'ed25519', publicKey: sig.publicKey, sig: sig.sig },
    }
    const written: string[] = []
    const result = await installDownloadedRegistryPack({
      index: emptyContentIndex(),
      entry,
      body: bytes,
      io: {
        writePack: async (_id, text) => {
          written.push(text)
          return { ok: true }
        },
        writeIndex: async () => ({ ok: true }),
        removePack: async () => ({ ok: true }),
      },
    })
    expect(result.ok).toBe(true)
    expect(written).toEqual([pack.text])
  })

  test('the kept original still loads its parts on reload', async () => {
    const pack = await signed('load_kept')
    const files = await install(pack.text)
    const issues = await applyEnabledPacks(
      { readContentPack: async () => files.onDiskText },
      files.index,
    )
    expect(issues).toEqual([])
  })
})

describe('trust on load comes from the file, not from index.json', () => {
  test('an untouched pack verifies; pinned shows trusted, unpinned or unloaded pins do not', async () => {
    const pack = await signed()
    const files = await install(pack.text)
    const stored = await verifyStoredSignature(files.record, files.onDiskText)
    expect(stored).toEqual({ kind: 'verified', publicKeyHex: pack.key })
    expect(liveTrustFromStored(stored, pins(pack.key), true)).toBe('valid-trusted')
    expect(liveTrustFromStored(stored, pins(pack.key.toUpperCase()), true)).toBe('valid-trusted')
    expect(liveTrustFromStored(stored, pins(), true)).toBe('valid-untrusted')
    expect(liveTrustFromStored(stored, pins(pack.key), false)).toBe('valid-untrusted')
  })

  test('the index row claiming valid-trusted does not make anything trusted by itself', async () => {
    const pack = await signed()
    const files = await install(pack.text)
    const claimed: InstalledPackRecord = { ...files.record, signatureStatus: 'valid-trusted' }
    const stored = await verifyStoredSignature(claimed, files.onDiskText)
    // Still verified from the file, and still only as trusted as the pin list says.
    expect(liveTrustFromStored(stored, pins(), true)).toBe('valid-untrusted')
  })

  test('editing the signed pack (even with the hash rewritten) is unverified', async () => {
    const pack = await signed()
    const files = await install(pack.text)
    const edited = JSON.stringify(
      { ...(JSON.parse(files.onDiskText) as object), name: 'Kept Pack (edited)' },
      null,
      2,
    )
    const record = {
      ...files.record,
      contentHash: await sha256HexBytes(new TextEncoder().encode(edited)),
    }
    const stored = await verifyStoredSignature(record, edited)
    expect(stored.kind).toBe('unverified')
    if (stored.kind === 'unverified') {
      expect(stored.reason).toMatch(/no longer matches its publisher signature/)
      expect(stored.reason).toMatch(/Treated as untrusted/)
      expect(stored.reason).not.toMatch(/Install refused/)
    }
    expect(liveTrustFromStored(stored, pins(pack.key), true)).toBe('unverified')
  })

  test('a stripped signature, or a pack from before this change, needs a reinstall', async () => {
    const pack = await signed()
    const files = await install(pack.text)
    const installed = await installLocalPackVerified(emptyContentIndex(), pack.text, 1)
    if (!installed.ok) throw new Error(installed.reason)
    // Before this change a signed pack was written normalized, without its signature.
    const legacy = serializeContentPack(installed.pack)
    const stored = await verifyStoredSignature(files.record, legacy)
    expect(stored).toEqual({ kind: 'unverified', reason: STORED_SIGNATURE_MISSING })
    expect(STORED_SIGNATURE_MISSING).toMatch(/reinstall to re-verify/)
  })

  test('an unsigned pack whose index row is forged as signed is unverified', async () => {
    const text = JSON.stringify(body('plain_pack'), null, 2)
    const forged: InstalledPackRecord = {
      ...(await install(text)).record,
      signatureStatus: 'valid-trusted',
      publisherKeyHex: 'ab'.repeat(32),
    }
    const stored = await verifyStoredSignature(forged, text)
    expect(stored.kind).toBe('unverified')
    expect(liveTrustFromStored(stored, pins('ab'.repeat(32)), true)).toBe('unverified')
  })

  test('a recorded key that differs from the signer, or a signed file for another id, is unverified', async () => {
    const pack = await signed()
    const files = await install(pack.text)
    const swapped = await verifyStoredSignature(
      { ...files.record, publisherKeyHex: 'cd'.repeat(32) },
      files.onDiskText,
    )
    expect(swapped.kind).toBe('unverified')
    if (swapped.kind === 'unverified') expect(swapped.reason).toMatch(/different publisher key/)

    const other = await signed('other_pack')
    const wrongId = await verifyStoredSignature(files.record, other.text)
    expect(wrongId.kind).toBe('unverified')
    if (wrongId.kind === 'unverified') expect(wrongId.reason).toMatch(/not for "kept_pack"/)
  })

  test('a missing, unreadable, non-JSON or garbled file never throws and is never trusted', async () => {
    const pack = await signed()
    const files = await install(pack.text)
    expect((await verifyStoredSignature(files.record, null)).kind).toBe('unverified')
    expect((await verifyStoredSignature(files.record, '{ nope')).kind).toBe('unverified')
    const doc = JSON.parse(files.onDiskText) as { signature: Record<string, unknown> }
    for (const signature of [
      { ...doc.signature, sig: 'zz' },
      { ...doc.signature, alg: 'rsa' },
      { ...doc.signature, publicKey: 'ab' },
      'not an object',
    ]) {
      const garbled = JSON.stringify({ ...doc, signature }, null, 2)
      const stored = await verifyStoredSignature(files.record, garbled)
      expect(stored.kind, JSON.stringify(signature)).toBe('unverified')
    }
    const unsignedRecord: InstalledPackRecord = {
      ...files.record,
      signatureStatus: 'none',
    }
    delete unsignedRecord.publisherKeyHex
    expect(await verifyStoredSignature(unsignedRecord, null)).toEqual({ kind: 'unsigned' })
  })

  test('the unverified label says the pack is treated as untrusted', () => {
    expect(publisherTrustLabel('unverified')).toMatch(/treated as untrusted/)
  })
})
