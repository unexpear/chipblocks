/**
 * Items 5 and 6: the trust seal (electron/trust-seal.ts + content-store.ts) protects the publisher
 * pins and the per-pack rollback floor. safeStorage is MOCKED here with AES-256-GCM under a
 * random in-memory key, so no test touches an OS key store (DPAPI / Keychain); the Electron
 * workflows exercise the real safeStorage in the sandboxed test profile.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { createContentStore } from '../electron/content-store.ts'
import { ContentLock } from '../electron/home-lock.ts'
import {
  floorsAfterIndexWrite,
  readSeal,
  SEAL_DOWNGRADED,
  SEAL_MISSING,
  SEAL_OS_UNAVAILABLE,
  SEAL_PINS_CHANGED,
  SEAL_UNOPENABLE,
  type SealCrypto,
  sealText,
} from '../electron/trust-seal.ts'
import {
  emptyContentIndex,
  installedPackFiles,
  installLocalPackVerified,
  serializeContentIndex,
} from '../src/renderer/content-manager.ts'
import { CONTENT_PACK_FORMAT, CONTENT_PACK_VERSION } from '../src/renderer/content-pack.ts'
import {
  exportRawPublicKeyHex,
  serializeTrustedPublishers,
  signPackBodyHex,
} from '../src/renderer/content-pack-signature.ts'
import { verifyStoredSignature } from '../src/renderer/content-pack-stored-trust.ts'
import {
  PINS_SEALED_NOTE,
  PINS_UNPROTECTED_NOTE,
  rollbackReason,
  sealedTrustedPublishers,
} from '../src/renderer/trust-seal-view.ts'
import { applyEnabledPacks } from '../src/renderer/use-content-manager.tsx'

const root = mkdtempSync(join(tmpdir(), 'chipblocks-seal-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let n = 0

/** Stand-in for Electron safeStorage: authenticated encryption under a key only this object has. */
function mockSafeStorage(available = true): SealCrypto & { setAvailable: (v: boolean) => void } {
  const key = randomBytes(32)
  let on = available
  return {
    setAvailable: (v) => {
      on = v
    },
    available: () => on,
    encrypt: (plain) => {
      const iv = randomBytes(12)
      const c = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
      return Buffer.concat([iv, c.getAuthTag(), body])
    },
    decrypt: (blob) => {
      const b = Buffer.from(blob)
      const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12))
      d.setAuthTag(b.subarray(12, 28))
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')
    },
  }
}

function newStore(crypto: SealCrypto = mockSafeStorage()) {
  const home = join(root, `home-${++n}`)
  const store = createContentStore({
    root: () => home,
    crypto,
    lock: new ContentLock(() => join(home, 'content.lock')),
  })
  return { home, store, crypto }
}

const KEY_A = 'a1'.repeat(32)
const KEY_B = 'b2'.repeat(32)
const pinsText = (...keys: string[]) =>
  serializeTrustedPublishers({
    format: 'chipblocks-trusted-publishers',
    version: 1,
    keys: keys.map((publicKey) => ({ publicKey })),
  })

describe('pins are sealed (item 5)', () => {
  test('a pin list saved by ChipBlocks is sealed and trusted, with the OS-protection note', async () => {
    const { store, home } = newStore()
    expect((await store.writePins(pinsText(KEY_A))).ok).toBe(true)
    const view = await store.readTrustSeal()
    expect(view.pins).toEqual({ status: 'sealed' })
    expect(view.protection).toBe('os')
    const seal = JSON.parse(readFileSync(join(home, 'trust-seal.json'), 'utf8'))
    expect(seal).toMatchObject({ format: 'chipblocks-trust-seal', version: 1, protection: 'os' })
    // Encrypted: the key list and the hash are not readable in the file.
    expect(readFileSync(join(home, 'trust-seal.json'), 'utf8')).not.toMatch(/pinsSha256|floors/)
    const trust = sealedTrustedPublishers(view)
    expect(trust.pinsLoaded).toBe(true)
    expect(trust.publishers.keys.map((k) => k.publicKey)).toEqual([KEY_A])
    expect(trust.status).toContain(PINS_SEALED_NOTE)
  })

  test('a key added outside ChipBlocks: no key is trusted, with a clear reason, and re-pinning starts a new list', async () => {
    const { store, home } = newStore()
    await store.writePins(pinsText(KEY_A))
    writeFileSync(join(home, 'trusted-publishers.json'), pinsText(KEY_A, KEY_B))
    const view = await store.readTrustSeal()
    expect(view.pins).toEqual({ status: 'unsealed', reason: SEAL_PINS_CHANGED })
    const trust = sealedTrustedPublishers(view)
    expect(trust.pinsLoaded).toBe(false)
    expect(trust.publishers.keys).toEqual([])
    expect(trust.pinsVouched).toBe(false)
    expect(trust.status).toMatch(
      /^trusted-publishers\.json was changed outside ChipBlocks .* No publisher key from that file is treated as pinned\. Pin a key again/,
    )
  })

  test('even a whitespace-only edit counts: the seal covers the exact bytes', async () => {
    const { store, home } = newStore()
    await store.writePins(pinsText(KEY_A))
    writeFileSync(join(home, 'trusted-publishers.json'), `${pinsText(KEY_A)}\n`)
    expect((await store.readTrustSeal()).pins.status).toBe('unsealed')
  })

  test('an edited, forged, or deleted seal is reported, never trusted', async () => {
    const crypto = mockSafeStorage()
    const { store, home } = newStore(crypto)
    await store.writePins(pinsText(KEY_A))
    const sealPath = join(home, 'trust-seal.json')
    const seal = JSON.parse(readFileSync(sealPath, 'utf8'))
    // Flip one byte of the ciphertext.
    const blob = Buffer.from(seal.sealed, 'base64')
    blob.writeUInt8(blob.readUInt8(blob.length - 1) ^ 1, blob.length - 1)
    writeFileSync(sealPath, JSON.stringify({ ...seal, sealed: blob.toString('base64') }))
    expect((await store.readTrustSeal()).pins).toEqual({
      status: 'unsealed',
      reason: SEAL_UNOPENABLE,
    })
    // A seal made with another key (another computer, account, or a forger) does not open.
    writeFileSync(sealPath, sealText({ pinsSha256: null, floors: {} }, mockSafeStorage()))
    expect((await store.readTrustSeal()).pins).toEqual({
      status: 'unsealed',
      reason: SEAL_UNOPENABLE,
    })
    // A plain-text seal, written to dodge the encryption, while OS storage is available.
    writeFileSync(sealPath, sealText({ pinsSha256: null, floors: {} }, mockSafeStorage(false)))
    expect((await store.readTrustSeal()).pins).toEqual({
      status: 'unsealed',
      reason: SEAL_DOWNGRADED,
    })
    rmSync(sealPath)
    expect((await store.readTrustSeal()).pins).toEqual({ status: 'unsealed', reason: SEAL_MISSING })
  })

  test('pins from an older ChipBlocks (no seal) are not trusted until pinned again', async () => {
    const { store, home } = newStore()
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'trusted-publishers.json'), pinsText(KEY_A))
    const trust = sealedTrustedPublishers(await store.readTrustSeal())
    expect(trust.pinsLoaded).toBe(false)
    expect(trust.status.startsWith(SEAL_MISSING)).toBe(true)
    // Pinning in the app (the hook passes a null base when pins are not vouched) seals the new list.
    await store.writePins(pinsText(KEY_A))
    expect((await store.readTrustSeal()).pins.status).toBe('sealed')
  })

  test('no OS-protected storage: an honest unprotected fallback, and a seal it cannot open is untrusted', async () => {
    const crypto = mockSafeStorage(false)
    const { store } = newStore(crypto)
    await store.writePins(pinsText(KEY_A))
    const view = await store.readTrustSeal()
    expect(view.pins).toEqual({ status: 'unprotected' })
    expect(view.protection).toBe('none')
    const trust = sealedTrustedPublishers(view)
    expect(trust.pinsLoaded).toBe(true)
    expect(trust.status).toContain(PINS_UNPROTECTED_NOTE)
    // OS storage was available when sealed, and is not now: cannot be opened, so not trusted.
    const os = mockSafeStorage(true)
    const sealed = newStore(os)
    await sealed.store.writePins(pinsText(KEY_A))
    os.setAvailable(false)
    expect((await sealed.store.readTrustSeal()).pins).toEqual({
      status: 'unsealed',
      reason: SEAL_OS_UNAVAILABLE,
    })
  })

  test('no pin file, or an empty list, needs no seal', async () => {
    const { store } = newStore()
    const view = await store.readTrustSeal()
    expect(view.pins).toEqual({ status: 'no-pins' })
    expect(sealedTrustedPublishers(view).pinsLoaded).toBe(true)
  })
})

// ---- item 6: rollback floors ----

type KeyPair = { publicKey: CryptoKey; privateKey: CryptoKey }
const newKey = async () =>
  (await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as KeyPair

async function signedPack(key: KeyPair, packVersion: string): Promise<string> {
  const body = {
    format: CONTENT_PACK_FORMAT,
    version: CONTENT_PACK_VERSION,
    id: 'roll_pack',
    name: 'Roll Pack',
    packVersion,
    license: 'MIT',
    parts: [
      {
        id: 'roll_pack_buf',
        name: 'Roll Buffer',
        designatorPrefix: 'U',
        pins: [
          { id: 'a', name: 'A', side: 'left', electrical: 'input' },
          { id: 'y', name: 'Y', side: 'right', electrical: 'output' },
        ],
      },
    ],
  }
  const publicKey = await exportRawPublicKeyHex(key.publicKey)
  const sig = await signPackBodyHex(JSON.stringify(body, null, 2), key.privateKey)
  return JSON.stringify({ ...body, signature: { alg: 'ed25519', publicKey, sig } }, null, 2)
}

describe('rollback floors (item 6)', () => {
  test('floors rise with each install written by ChipBlocks, never fall, and go with an uninstall', () => {
    const idx = (...rows: [string, string][]) =>
      JSON.stringify({ packs: rows.map(([id, packVersion]) => ({ id, packVersion })) })
    let floors = floorsAfterIndexWrite({}, idx(['p', '1.0.0']))
    expect(floors).toEqual({ p: '1.0.0' })
    floors = floorsAfterIndexWrite(floors, idx(['p', '1.2.0-beta.1']))
    expect(floors).toEqual({ p: '1.2.0-beta.1' })
    floors = floorsAfterIndexWrite(floors, idx(['p', '1.1.0'])) // an index row lowered: floor kept
    expect(floors).toEqual({ p: '1.2.0-beta.1' })
    floors = floorsAfterIndexWrite(floors, idx(['p', '1.2.0']))
    expect(floors).toEqual({ p: '1.2.0' })
    floors = floorsAfterIndexWrite(floors, idx()) // uninstalled in the app
    expect(floors).toEqual({})
  })

  test('an older, genuinely signed pack swapped in with index.json rewritten to match is refused on load', async () => {
    const { store } = newStore()
    const key = await newKey()
    const v110 = await signedPack(key, '1.1.0')
    const v100 = await signedPack(key, '1.0.0')

    // Install 1.1.0 the way the app does: pack.json, then index.json through the store.
    const installed = await installLocalPackVerified(emptyContentIndex(), v110)
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    const files = await installedPackFiles(installed, v110)
    await store.writePack('roll_pack', files.onDiskText)
    await store.writeIndex(serializeContentIndex(files.index))
    const floors = (await store.readTrustSeal()).floors
    expect(floors).toEqual({ roll_pack: '1.1.0' })
    const sealOnDisk = readFileSync(store.paths().seal, 'utf8')
    expect(readSeal(sealOnDisk, mockSafeStorage()).kind).toBe('broken') // another key cannot open it

    // Outside ChipBlocks: put the older signed original back and rewrite the index row (hash + version).
    const older = await installLocalPackVerified(emptyContentIndex(), v100)
    if (!older.ok) throw new Error(older.reason)
    const olderFiles = await installedPackFiles(older, v100)
    writeFileSync(store.paths().pack('roll_pack'), olderFiles.onDiskText)
    writeFileSync(store.paths().index, serializeContentIndex(olderFiles.index))

    // The signature still verifies: without the floor this would load as a valid pack.
    const row = olderFiles.index.packs[0]
    if (row === undefined) throw new Error('no row')
    expect((await verifyStoredSignature(row, olderFiles.onDiskText)).kind).toBe('verified')

    const view = await store.readTrustSeal()
    expect(view.floors).toEqual({ roll_pack: '1.1.0' })
    const issues = await applyEnabledPacks(
      { readContentPack: async () => readFileSync(store.paths().pack('roll_pack'), 'utf8') },
      olderFiles.index,
      undefined,
      view.floors,
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]?.blocked).toBe(true)
    expect(issues[0]?.reason).toBe(rollbackReason('roll_pack', '1.0.0', view.floors))
    expect(issues[0]?.reason).toMatch(
      /^Pack "roll_pack" on disk is version 1\.0\.0, but ChipBlocks already installed version 1\.1\.0 of it on this computer\. .*rollback.* its parts were not loaded\./,
    )
    // And installing the older file in the app is refused too (the floor, not only the row).
    const again = await installLocalPackVerified(olderFiles.index, v100, 1, undefined, view.floors)
    expect(again.ok).toBe(false)
  })

  test('the same version (a reinstall) and a newer one load; versions with no order are not judged', () => {
    const floors = { p: '1.1.0' }
    expect(rollbackReason('p', '1.1.0', floors)).toBeNull()
    expect(rollbackReason('p', '1.1.0+rebuild', floors)).toBeNull()
    expect(rollbackReason('p', '1.2.0', floors)).toBeNull()
    expect(rollbackReason('p', '1.1.0-rc.1', floors)).not.toBeNull()
    expect(rollbackReason('p', 'weird', floors)).toBeNull()
    expect(rollbackReason('q', '0.1.0', floors)).toBeNull()
    expect(rollbackReason('p', '0.1.0', null)).toBeNull()
  })

  test('a broken seal gives no floors (reported), and the next app write starts them from index.json', async () => {
    const { store } = newStore()
    await store.writeIndex(JSON.stringify({ packs: [{ id: 'p', packVersion: '2.0.0' }] }))
    writeFileSync(store.paths().seal, '{"format":"chipblocks-trust-seal"}')
    expect((await store.readTrustSeal()).floors).toBeNull()
    await store.writeIndex(JSON.stringify({ packs: [{ id: 'p', packVersion: '2.0.0' }] }))
    expect((await store.readTrustSeal()).floors).toEqual({ p: '2.0.0' })
  })

  test('a pin write keeps the floors, and an index write keeps the pin seal', async () => {
    const { store } = newStore()
    await store.writeIndex(JSON.stringify({ packs: [{ id: 'p', packVersion: '1.0.0' }] }))
    await store.writePins(pinsText(KEY_A))
    await store.writeIndex(JSON.stringify({ packs: [{ id: 'p', packVersion: '1.0.1' }] }))
    const view = await store.readTrustSeal()
    expect(view.pins.status).toBe('sealed')
    expect(view.floors).toEqual({ p: '1.0.1' })
  })
})
