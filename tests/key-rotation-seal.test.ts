/**
 * The rotation state (retired keys, accepted sequences) lives in the sealed trust-seal.json
 * payload. safeStorage is MOCKED with AES-256-GCM under a random in-memory key, as in
 * trust-seal.test.ts; no OS key store is touched. Temp folders only.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { createContentStore } from '../electron/content-store.ts'
import { ContentLock } from '../electron/home-lock.ts'
import { readSeal, type SealCrypto, sealText } from '../electron/trust-seal.ts'
import { serializeTrustedPublishers } from '../src/renderer/content-pack-signature.ts'
import { isRotationState } from '../src/renderer/rotation-state.ts'
import { sealedTrustedPublishers } from '../src/renderer/trust-seal-view.ts'

const root = mkdtempSync(join(tmpdir(), 'chipblocks-rotation-seal-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let n = 0

function mockSafeStorage(): SealCrypto {
  const key = randomBytes(32)
  return {
    available: () => true,
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

function newStore() {
  const home = join(root, `home-${++n}`)
  const crypto = mockSafeStorage()
  const store = createContentStore({
    root: () => home,
    crypto,
    lock: new ContentLock(() => join(home, 'content.lock')),
  })
  return { home, store, crypto }
}

const KEY_A = 'a1'.repeat(32)
const KEY_B = 'b2'.repeat(32)
const KEY_C = 'c3'.repeat(32)
const pinsText = (...keys: string[]) =>
  serializeTrustedPublishers({
    format: 'chipblocks-trusted-publishers',
    version: 1,
    keys: keys.map((publicKey) => ({ publicKey })),
  })

describe('rotation state in the trust seal', () => {
  test('a seal written before key rotation (no rotation field) still opens, with no rotation state', () => {
    const crypto = mockSafeStorage()
    const old = sealText({ pinsSha256: null, floors: { p: '1.0.0' } }, crypto)
    const state = readSeal(old, crypto)
    expect(state.kind).toBe('ok')
    expect(state.kind === 'ok' && state.payload.rotation).toBeUndefined()
  })

  test('the rotation state round-trips, encrypted', () => {
    const crypto = mockSafeStorage()
    const rotation = { retired: [KEY_A], sequences: { [KEY_A]: 2 } }
    const text = sealText({ pinsSha256: null, floors: {}, rotation }, crypto)
    expect(text).not.toMatch(/retired|sequences|a1a1/)
    const state = readSeal(text, crypto)
    expect(state.kind === 'ok' && state.payload.rotation).toEqual(rotation)
  })

  test('a malformed rotation state makes the seal unopenable, never half-trusted', () => {
    const crypto = mockSafeStorage()
    const text = sealText(
      // biome-ignore lint/suspicious/noExplicitAny: a malformed payload on purpose
      { pinsSha256: null, floors: {}, rotation: { retired: ['nope'], sequences: {} } as any },
      crypto,
    )
    expect(readSeal(text, crypto).kind).toBe('broken')
    expect(isRotationState({ retired: [KEY_A], sequences: { [KEY_A]: 0 } })).toBe(false)
    expect(isRotationState({ retired: [], sequences: {} })).toBe(true)
  })

  test('writePins with a rotation seals the pins and the rotation together, and only ever adds', async () => {
    const { store } = newStore()
    expect((await store.writePins(pinsText(KEY_A))).ok).toBe(true)
    expect((await store.readTrustSeal()).rotation).toEqual({ retired: [], sequences: {} })
    await store.writePins(pinsText(KEY_B), { retired: [KEY_A], sequences: { [KEY_A]: 3 } })
    let view = await store.readTrustSeal()
    expect(view.pins).toEqual({ status: 'sealed' })
    expect(view.rotation).toEqual({ retired: [KEY_A], sequences: { [KEY_A]: 3 } })
    // A lower sequence or a shorter retired list cannot undo what was sealed.
    await store.writePins(pinsText(KEY_C), { retired: [KEY_B], sequences: { [KEY_A]: 1 } })
    view = await store.readTrustSeal()
    expect(view.rotation).toEqual({ retired: [KEY_A, KEY_B], sequences: { [KEY_A]: 3 } })
    // A plain pin write keeps the rotation state.
    await store.writePins(pinsText(KEY_C, KEY_A))
    expect((await store.readTrustSeal()).rotation).toEqual({
      retired: [KEY_A, KEY_B],
      sequences: { [KEY_A]: 3 },
    })
    const sealed = sealedTrustedPublishers(await store.readTrustSeal())
    expect(sealed.rotation?.retired).toEqual([KEY_A, KEY_B])
  })

  test('an untrusted seal reports no rotation state', async () => {
    const { store, home } = newStore()
    await store.writePins(pinsText(KEY_A), { retired: [KEY_B], sequences: {} })
    const sealPath = join(home, 'trust-seal.json')
    const seal = JSON.parse(readFileSync(sealPath, 'utf8'))
    seal.sealed = Buffer.from('garbage').toString('base64')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(sealPath, JSON.stringify(seal))
    const view = await store.readTrustSeal()
    expect(view.rotation).toBeNull()
    expect(sealedTrustedPublishers(view).rotation).toBeNull()
  })
})
