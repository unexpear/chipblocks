/**
 * Publisher key rotation (src/renderer/key-rotation.ts): the statement format, every refusal, the
 * install rule for a pack installed from a pinned key, and the publisher tool
 * (scripts/pack-key-rotation.mjs) checked against the app's own verifier. Keys are throwaway
 * in-memory ed25519 keys; nothing is written outside a temp folder; no network.
 */
import crypto, { type KeyObject } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import {
  attachRotations,
  createRotation,
  rawPublicKeyHex,
  main as rotationTool,
  signPackText,
  rotationSigningText as toolSigningText,
} from '../scripts/pack-key-rotation.mjs'
import {
  type ContentIndex,
  emptyContentIndex,
  installedPackFiles,
  installLocalPackVerified,
} from '../src/renderer/content-manager.ts'
import { CONTENT_PACK_FORMAT, CONTENT_PACK_VERSION } from '../src/renderer/content-pack.ts'
import {
  type TrustedPublishers,
  verifyPackSignature,
} from '../src/renderer/content-pack-signature.ts'
import {
  type KeyRotationStatement,
  MAX_ROTATION_LINKS,
  type RotationState,
  rotationForPackText,
  rotationSigningText,
  rotationStateAfterConfirm,
  verifyRotationChain,
} from '../src/renderer/key-rotation.ts'

const tmp = mkdtempSync(join(tmpdir(), 'chipblocks-rotation-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const newKey = () => crypto.generateKeyPairSync('ed25519').privateKey
const A = newKey()
const B = newKey()
const C = newKey()
const hexA = rawPublicKeyHex(A)
const hexB = rawPublicKeyHex(B)
const hexC = rawPublicKeyHex(C)
const NOW = Date.parse('2026-10-27T20:00:00Z')

const rot = (
  from: KeyObject,
  to: KeyObject,
  opts: { sequence?: number; packIds?: string[]; issuedAt?: string } = {},
): KeyRotationStatement =>
  createRotation({
    oldPrivateKey: from,
    newPrivateKey: to,
    packIds: opts.packIds ?? ['rot_pack'],
    sequence: opts.sequence ?? 1,
    issuedAt: opts.issuedAt ?? '2026-10-01T12:00:00Z',
  }) as KeyRotationStatement

const verify = (
  rotations: unknown,
  signer: string,
  pinned: string[],
  state: RotationState | null = null,
  packId = 'rot_pack',
) =>
  verifyRotationChain({
    packId,
    signerKeyHex: signer,
    rotations,
    pinned: new Set(pinned),
    state,
    now: NOW,
  })

function packText(id: string, version: string, key: KeyObject, rotations?: unknown[]): string {
  const body = {
    format: CONTENT_PACK_FORMAT,
    version: CONTENT_PACK_VERSION,
    id,
    name: 'Rot Pack',
    packVersion: version,
    license: 'MIT',
    description: 'key rotation test pack',
    parts: [
      {
        id: `${id}_buffer`,
        name: 'Rot Buffer',
        designatorPrefix: 'U',
        description: 'A two-pin test part.',
        pins: [
          { id: 'a', name: 'A', side: 'left', electrical: 'input' },
          { id: 'y', name: 'Y', side: 'right', electrical: 'output' },
        ],
      },
    ],
    integrity: { alg: 'sha256', hash: '' },
  }
  const signed = signPackText(JSON.stringify(body), key)
  return rotations === undefined ? signed : attachRotations(signed, rotations)
}

const pins = (...keys: string[]): TrustedPublishers => ({
  format: 'chipblocks-trusted-publishers',
  version: 1,
  keys: keys.map((publicKey) => ({ publicKey })),
})

describe('statement format and the publisher tool', () => {
  test('the tool and the app build the same domain-separated signing text', () => {
    const s = rot(A, B, { packIds: ['z_pack', 'rot_pack', 'z_pack'] })
    expect(s.packIds).toEqual(['rot_pack', 'z_pack'])
    expect(toolSigningText(s)).toBe(rotationSigningText(s))
    expect(rotationSigningText(s).startsWith('chipblocks-key-rotation-v1\n{"format":')).toBe(true)
    expect(Object.keys(s)).toEqual([
      'format',
      'version',
      'oldKey',
      'newKey',
      'packIds',
      'sequence',
      'issuedAt',
      'sig',
      'newKeySig',
    ])
  })

  test('a statement made by the tool verifies in the app, and a pack it signs verifies too', async () => {
    expect(await verify([rot(A, B)], hexB, [hexA])).toEqual({
      kind: 'valid',
      fromKey: hexA,
      toKey: hexB,
      links: [{ oldKey: hexA, newKey: hexB, sequence: 1 }],
    })
    const text = packText('rot_pack', '1.1.0', B, [rot(A, B)])
    const sig = await verifyPackSignature(text)
    expect(sig.kind).toBe('valid-untrusted')
    // Rotations ride inside `signature`, outside the signed body and the content hash.
    expect(JSON.parse(text).signature.rotations).toHaveLength(1)
  })

  test('the CLI: keygen, sign, create, attach end to end', async () => {
    const oldPem = join(tmp, 'old.pem')
    const newPem = join(tmp, 'new.pem')
    const log = console.log
    console.log = () => {}
    const err = console.error
    console.error = () => {}
    try {
      rotationTool(['keygen', '--out', oldPem])
      rotationTool(['keygen', '--out', newPem])
      expect(() => rotationTool(['keygen', '--out', oldPem])).toThrow(/already exists/)
      const unsigned = join(tmp, 'pack.json')
      writeFileSync(unsigned, packText('cli_pack', '2.0.0', A))
      const signedPath = join(tmp, 'signed.json')
      rotationTool(['sign', '--key', newPem, '--pack', unsigned, '--out', signedPath])
      const rotPath = join(tmp, 'rotation.json')
      rotationTool([
        'create',
        '--old-key',
        oldPem,
        '--new-key',
        newPem,
        '--pack-id',
        'cli_pack',
        '--sequence',
        '4',
        '--issued-at',
        '2026-10-20T00:00:00Z',
        '--out',
        rotPath,
      ])
      const outPath = join(tmp, 'out.json')
      rotationTool(['attach', '--pack', signedPath, '--rotation', rotPath, '--out', outPath])
      const text = readFileSync(outPath, 'utf8')
      const oldHex = rawPublicKeyHex(crypto.createPrivateKey(readFileSync(oldPem, 'utf8')))
      const newHex = rawPublicKeyHex(crypto.createPrivateKey(readFileSync(newPem, 'utf8')))
      expect((await verifyPackSignature(text)).kind).toBe('valid-untrusted')
      const verdict = await rotationForPackText({
        packId: 'cli_pack',
        signerKeyHex: newHex,
        packText: text,
        pinned: new Set([oldHex]),
        state: null,
        now: NOW,
      })
      expect(verdict).toMatchObject({ kind: 'valid', fromKey: oldHex, toKey: newHex })
      expect(() => rotationTool(['attach', '--pack', unsigned, '--rotation', rotPath])).toThrow(
        /does not end at the key that signed this pack/,
      )
    } finally {
      console.log = log
      console.error = err
    }
  })
})

describe('verification refusals', () => {
  test('no rotations, or an empty list, is none', async () => {
    expect(await verify(undefined, hexB, [hexA])).toEqual({ kind: 'none' })
    expect(await verify([], hexB, [hexA])).toEqual({ kind: 'none' })
  })

  test('the signer already pinned: current, nothing to confirm', async () => {
    expect(await verify([rot(A, B)], hexB, [hexA, hexB])).toEqual({ kind: 'current' })
  })

  test('not signed by a pinned key: unanchored, does not lead back to a pinned key', async () => {
    const v = await verify([rot(B, C)], hexC, [hexA])
    expect(v.kind).toBe('unanchored')
    expect(v.kind === 'unanchored' && v.reason).toMatch(
      /does not lead back to a publisher you pinned/,
    )
  })

  test('a forged statement (signed by another key while naming the pinned key) is broken', async () => {
    const forged = { ...rot(C, B), oldKey: hexA }
    // Re-sign the countersignature so only the old-key signature is wrong.
    forged.newKeySig = crypto
      .sign(null, Buffer.from(rotationSigningText(forged), 'utf8'), B)
      .toString('hex')
    const v = await verify([forged], hexB, [hexA])
    expect(v).toMatchObject({ kind: 'broken' })
    expect(v.kind === 'broken' && v.reason).toMatch(
      /not signed by the key it retires .*forged or edited/,
    )
  })

  test.each([
    ['scope widened', (s: KeyRotationStatement) => ({ ...s, packIds: ['other', 'rot_pack'] })],
    ['sequence raised', (s: KeyRotationStatement) => ({ ...s, sequence: 9 })],
    ['date moved', (s: KeyRotationStatement) => ({ ...s, issuedAt: '2026-10-02T12:00:00Z' })],
    ['new key swapped', (s: KeyRotationStatement) => ({ ...s, newKey: hexC })],
  ])('a tampered statement (%s) is broken', async (_name, edit) => {
    const v = await verify([edit(rot(A, B))], edit(rot(A, B)).newKey, [hexA])
    expect(v.kind).toBe('broken')
    expect(v.kind === 'broken' && v.reason).toMatch(/forged or edited/)
  })

  test('a missing or wrong countersignature by the new key is broken', async () => {
    const s = { ...rot(A, B), newKeySig: rot(A, C).newKeySig }
    const v = await verify([s], hexB, [hexA])
    expect(v.kind === 'broken' && v.reason).toMatch(/not countersigned by the new key/)
  })

  test('a rotation for other packs only is broken (out of scope)', async () => {
    const v = await verify([rot(A, B, { packIds: ['other_pack'] })], hexB, [hexA])
    expect(v.kind === 'broken' && v.reason).toMatch(/covers "other_pack", not "rot_pack"/)
  })

  test('a chain that does not end at the pack signer, or does not connect, is broken', async () => {
    const end = await verify([rot(A, B)], hexC, [hexA])
    expect(end.kind === 'broken' && end.reason).toMatch(/not at the key that signed this pack/)
    const gap = await verify([rot(A, B), rot(A, C)], hexC, [hexA])
    expect(gap.kind === 'broken' && gap.reason).toMatch(/chain is broken/)
  })

  test('a cycle or a self-rotation is broken', async () => {
    const cyc = await verify([rot(A, B), rot(B, A, { issuedAt: '2026-10-02T00:00:00Z' })], hexA, [])
    expect(cyc.kind === 'broken' && cyc.reason).toMatch(/goes back to a key earlier in the chain/)
    const self = { ...rot(A, B), newKey: hexA }
    const v = await verify([self], hexA, [hexA])
    expect(v.kind === 'broken' && v.reason).toMatch(/rotates a key to itself/)
  })

  test('a future date, dates out of order, malformed fields, or too many links are broken', async () => {
    const future = await verify([rot(A, B, { issuedAt: '2026-10-28T00:00:00Z' })], hexB, [hexA])
    expect(future.kind === 'broken' && future.reason).toMatch(/dated in the future/)
    const order = await verify(
      [
        rot(A, B, { issuedAt: '2026-10-05T00:00:00Z' }),
        rot(B, C, { issuedAt: '2026-10-01T00:00:00Z' }),
      ],
      hexC,
      [hexA],
    )
    expect(order.kind === 'broken' && order.reason).toMatch(/dated before the rotation it follows/)
    const extra = await verify([{ ...rot(A, B), note: 'x' }], hexB, [hexA])
    expect(extra.kind === 'broken' && extra.reason).toMatch(/unknown field "note"/)
    const notArray = await verify({}, hexB, [hexA])
    expect(notArray.kind).toBe('broken')
    const long = await verify(new Array(MAX_ROTATION_LINKS + 1).fill(rot(A, B)), hexB, [hexA])
    expect(long.kind === 'broken' && long.reason).toMatch(/at most 8 are read/)
    const upper = await verify([{ ...rot(A, B), oldKey: hexA.toUpperCase() }], hexB, [hexA])
    expect(upper.kind === 'broken' && upper.reason).toMatch(/64 lowercase hex/)
  })

  test('a rotation back to a retired key is refused', async () => {
    const state = rotationStateAfterConfirm(
      null,
      [{ oldKey: hexA, newKey: hexB, sequence: 1 }],
      [hexA],
    )
    const v = await verify([rot(B, A)], hexA, [hexB], state)
    expect(v.kind === 'refused' && v.reason).toMatch(/a key you already rotated away from/)
  })

  test('a reused or older rotation from the same key is refused; a newer one is valid', async () => {
    const state = rotationStateAfterConfirm(null, [{ oldKey: hexA, newKey: hexB, sequence: 2 }], [])
    for (const sequence of [1, 2]) {
      const v = await verify([rot(A, C, { sequence })], hexC, [hexA], state)
      expect(v.kind === 'refused' && v.reason).toMatch(
        new RegExp(`has sequence ${sequence}, but sequence 2 from that key was already accepted`),
      )
    }
    expect((await verify([rot(A, C, { sequence: 3 })], hexC, [hexA], state)).kind).toBe('valid')
  })

  test('a two-link chain starts at the newest pinned key; links already followed are skipped', async () => {
    const chain = [
      rot(A, B, { sequence: 1 }),
      rot(B, C, { sequence: 1, issuedAt: '2026-10-05T00:00:00Z' }),
    ]
    expect(await verify(chain, hexC, [hexA])).toMatchObject({
      kind: 'valid',
      fromKey: hexA,
      links: [
        { oldKey: hexA, newKey: hexB },
        { oldKey: hexB, newKey: hexC },
      ],
    })
    // After A → B was confirmed (A retired, sequence 1 for A), only B → C is asked for.
    const state = rotationStateAfterConfirm(
      null,
      [{ oldKey: hexA, newKey: hexB, sequence: 1 }],
      [hexA],
    )
    expect(await verify(chain, hexC, [hexB], state)).toMatchObject({
      kind: 'valid',
      fromKey: hexB,
      links: [{ oldKey: hexB, newKey: hexC }],
    })
  })

  test('rotation state only grows: retired keys stay, sequences never go down', () => {
    const one = rotationStateAfterConfirm(
      null,
      [{ oldKey: hexA, newKey: hexB, sequence: 5 }],
      [hexA],
    )
    const two = rotationStateAfterConfirm(
      one,
      [{ oldKey: hexA, newKey: hexC, sequence: 3 }],
      [hexB],
    )
    expect(two.retired).toEqual([hexA, hexB].sort())
    expect(two.sequences[hexA]).toBe(5)
  })
})

describe('install over a pack from a pinned key', () => {
  async function installedFrom(key: KeyObject): Promise<ContentIndex> {
    const text = packText('rot_pack', '1.0.0', key)
    const first = await installLocalPackVerified(emptyContentIndex(), text, 1, pins(), null)
    if (!first.ok) throw new Error(first.reason)
    return (await installedPackFiles(first, text)).index
  }

  test('a valid rotation from the pinned key installs as valid but NOT pinned, and says a key changed', async () => {
    const index = await installedFrom(A)
    const text = packText('rot_pack', '1.1.0', B, [rot(A, B)])
    const result = await installLocalPackVerified(index, text, 2, pins(hexA), null, null)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.signatureStatus).toBe('valid-untrusted')
    expect(result.record.publisherKeyHex).toBe(hexB)
    expect(result.keyRotation).toEqual({ fromKey: hexA, toKey: hexB })
  })

  test('with no rotation, the pinned-key-change refusal is as before', async () => {
    const index = await installedFrom(A)
    const result = await installLocalPackVerified(
      index,
      packText('rot_pack', '1.1.0', B),
      2,
      pins(hexA),
      null,
      null,
    )
    expect(result).toEqual({
      ok: false,
      reason:
        '"rot_pack" is installed from a publisher key you pinned. This file is signed by a different publisher key, so it was not installed over it. Nothing was written. If the publisher really changed keys, uninstall the old pack first, then install this one and decide whether to pin its key.',
    })
  })

  test('a rotation from a key that is not pinned is refused, with its reason', async () => {
    const index = await installedFrom(A)
    const result = await installLocalPackVerified(
      index,
      packText('rot_pack', '1.1.0', C, [rot(B, C)]),
      2,
      pins(hexA),
      null,
      null,
    )
    expect(result.ok === false && result.reason).toMatch(
      /^"rot_pack" is installed from a publisher key you pinned\. .* Its key rotation does not lead back to the key you pinned for this pack: .* Nothing was written\.$/,
    )
  })

  test('a rotation that starts at a different pinned key than the installed one is refused', async () => {
    const index = await installedFrom(A)
    const result = await installLocalPackVerified(
      index,
      packText('rot_pack', '1.1.0', C, [rot(B, C)]),
      2,
      pins(hexA, hexB),
      null,
      null,
    )
    expect(result.ok === false && result.reason).toMatch(
      /does not start at the key this pack was installed from\. Nothing was written\.$/,
    )
  })

  test('a broken or replayed rotation is refused even on a fresh install, so it is never stored', async () => {
    const tampered = { ...rot(A, B), sequence: 7 }
    const broken = await installLocalPackVerified(
      emptyContentIndex(),
      packText('rot_pack', '1.0.0', B, [tampered]),
      1,
      pins(),
      null,
      null,
    )
    expect(broken.ok === false && broken.reason).toMatch(
      /^This file carries a publisher key rotation that was refused: Key rotation 1 is not signed by the key it retires .* Nothing was written\.$/,
    )
    const state = rotationStateAfterConfirm(null, [{ oldKey: hexA, newKey: hexC, sequence: 1 }], [])
    const replay = await installLocalPackVerified(
      emptyContentIndex(),
      packText('rot_pack', '1.0.0', B, [rot(A, B)]),
      1,
      pins(hexA),
      null,
      state,
    )
    expect(replay.ok === false && replay.reason).toMatch(/old or reused rotation is refused/)
  })

  test('a fresh install with a rotation from an unpinned key installs untrusted, with no key change', async () => {
    const result = await installLocalPackVerified(
      emptyContentIndex(),
      packText('rot_pack', '1.0.0', C, [rot(B, C)]),
      1,
      pins(hexA),
      null,
      null,
    )
    expect(result.ok && result.record.signatureStatus).toBe('valid-untrusted')
    expect(result.ok && result.keyRotation).toBeUndefined()
  })
})
