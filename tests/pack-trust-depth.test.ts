/**
 * Depth checks for content-pack trust: pack ids that are not safe folder names, file URLs that
 * reach a network share, an https index pointing at local files, truncated and malformed
 * downloads, hash and key spelling, signatures over the wrong bytes, version rollback, a pinned
 * key being replaced, failed writes, and the index re-read before every write. No network;
 * the only files touched are in a temp folder.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { writeFileAtomic } from '../electron/atomic-write.ts'
import {
  downloadBounded,
  readFileUrlBounded,
  readHttpsBounded,
} from '../electron/registry-download.ts'
import {
  type ContentIndex,
  emptyContentIndex,
  type InstalledPackRecord,
  installLocalPackVerified,
  type PackFileIO,
  readIndexForWrite,
  serializeContentIndex,
  writeInstalledPack,
} from '../src/renderer/content-manager.ts'
import {
  CONTENT_PACK_FORMAT,
  CONTENT_PACK_VERSION,
  deserializeContentPack,
  PACK_ID_MAX_LENGTH,
  packIdProblem,
} from '../src/renderer/content-pack.ts'
import { sha256HexBytes } from '../src/renderer/content-pack-integrity.ts'
import {
  bytesToHex,
  exportRawPublicKeyHex,
  signPackBodyHex,
  type TrustedPublishers,
} from '../src/renderer/content-pack-signature.ts'
import {
  checkRegistryDownload,
  classifyRegistryUrl,
  installDownloadedRegistryPack,
  parseRegistryIndex,
  REGISTRY_MAX_PACK_BYTES,
  type RegistryPackEntry,
} from '../src/renderer/content-registry.ts'

type KeyPair = { publicKey: CryptoKey; privateKey: CryptoKey }

async function newKey(): Promise<KeyPair> {
  return (await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as KeyPair
}

function packBody(id: string, version: string): Record<string, unknown> {
  return {
    format: CONTENT_PACK_FORMAT,
    version: CONTENT_PACK_VERSION,
    id,
    name: 'Depth Pack',
    packVersion: version,
    license: 'MIT',
    parts: [
      {
        id: `${id}_buf`,
        name: 'Depth Buffer',
        designatorPrefix: 'U',
        pins: [
          { id: 'a', name: 'A', side: 'left', electrical: 'input' },
          { id: 'y', name: 'Y', side: 'right', electrical: 'output' },
        ],
      },
    ],
  }
}

/** A signed pack and its registry entry. `signOver` replaces the bytes that get signed. */
async function signedPack(
  opts: {
    id?: string
    version?: string
    key?: KeyPair
    signOver?: (canonical: string) => string
  } = {},
): Promise<{ text: string; bytes: Uint8Array; entry: RegistryPackEntry; publicKey: string }> {
  const id = opts.id ?? 'depth_pack'
  const version = opts.version ?? '1.0.0'
  const key = opts.key ?? (await newKey())
  const raw = packBody(id, version)
  const canonical = JSON.stringify(raw, null, 2)
  const publicKey = await exportRawPublicKeyHex(key.publicKey)
  const sig = await signPackBodyHex(
    opts.signOver ? opts.signOver(canonical) : canonical,
    key.privateKey,
  )
  const text = JSON.stringify({ ...raw, signature: { alg: 'ed25519', publicKey, sig } }, null, 2)
  const bytes = new TextEncoder().encode(text)
  const entry: RegistryPackEntry = {
    id,
    version,
    downloadUrl: `https://example.invalid/${id}.json`,
    size: bytes.byteLength,
    sha256: await sha256HexBytes(bytes),
    signature: { alg: 'ed25519', publicKey, sig },
  }
  return { text, bytes, entry, publicKey }
}

function indexDoc(packs: unknown[]): string {
  return JSON.stringify({ format: 'chipblocks-content-registry-index', version: 1, packs })
}

function entryJson(entry: RegistryPackEntry, over: Record<string, unknown> = {}): unknown {
  return { ...entry, ...over }
}

function recordingIO(over: Partial<PackFileIO> = {}): PackFileIO & { log: string[] } {
  const log: string[] = []
  return {
    log,
    writePack: async (id, text) => {
      log.push(`writePack ${id} ${text.length}`)
      return { ok: true }
    },
    writeIndex: async () => {
      log.push('writeIndex')
      return { ok: true }
    },
    removePack: async (id) => {
      log.push(`removePack ${id}`)
      return { ok: true }
    },
    readPack: async (id) => {
      log.push(`readPack ${id}`)
      return 'PREVIOUS'
    },
    ...over,
  }
}

function pinned(...keys: string[]): TrustedPublishers {
  return {
    format: 'chipblocks-trusted-publishers',
    version: 1,
    keys: keys.map((publicKey) => ({ publicKey })),
  }
}

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cb-depth-'))
  dirs.push(dir)
  return dir
}

describe('pack ids are safe folder names', () => {
  test('traversal, absolute paths, separators, device names and over-long ids are refused', () => {
    for (const bad of [
      '../evil',
      '..',
      '/etc/passwd',
      'C:\\Windows',
      'a/b',
      'a\\b',
      'Abc',
      '_lead',
      '1pack',
      'pack.json',
      '',
      'con',
      'nul',
      'aux',
      'prn',
      'com1',
      'lpt9',
      'a'.repeat(PACK_ID_MAX_LENGTH + 1),
      42,
      null,
    ]) {
      expect(packIdProblem(bad), String(bad)).not.toBeNull()
    }
    for (const good of ['pack', 'con_pack', 'com10', 'console', 'a'.repeat(PACK_ID_MAX_LENGTH)]) {
      expect(packIdProblem(good), good).toBeNull()
    }
  })

  test('a pack file and a registry index with an unsafe id are refused', async () => {
    const pack = deserializeContentPack(JSON.stringify(packBody('con', '1.0.0')))
    expect(pack.ok).toBe(false)
    if (!pack.ok) expect(pack.reason).toMatch(/Windows device name/)

    const { entry } = await signedPack()
    for (const id of ['../evil', 'nul', 'x'.repeat(65)]) {
      const parsed = parseRegistryIndex(indexDoc([entryJson(entry, { id })]))
      expect(parsed.ok, id).toBe(false)
    }
  })
})

describe('registry URLs', () => {
  test('http, ftp, credentials and network-share file URLs are refused before any read', async () => {
    for (const bad of [
      'http://example.invalid/index.json',
      'ftp://example.invalid/index.json',
      'https://user:pw@example.invalid/index.json',
      'file://evil.example/share/index.json',
      'file:////evil.example/share/index.json',
      'file://localhost//evil.example/share/index.json',
      'not a url',
    ]) {
      expect(classifyRegistryUrl(bad).ok, bad).toBe(false)
    }
    expect(classifyRegistryUrl('file:///C:/registry/index.json').ok).toBe(true)
    expect(classifyRegistryUrl('file://localhost/C:/registry/index.json').ok).toBe(true)
    expect(classifyRegistryUrl('  https://example.invalid/index.json  ').ok).toBe(true)

    const share = await downloadBounded('file://evil.example/share/pack.json', {
      maxBytes: 1000,
      timeoutMs: 1000,
    })
    expect(share.ok).toBe(false)
    if (!share.ok) expect(share.reason).toMatch(/network share/)
  })

  test('the file reader refuses a UNC path even if a URL slipped past the scheme check', async () => {
    const url = new URL('file://evil.example/share/pack.json')
    const read = await readFileUrlBounded(url, 1000)
    if (process.platform === 'win32') {
      expect(read.ok).toBe(false)
      if (!read.ok) expect(read.reason).toMatch(/network share/)
    } else {
      // fileURLToPath refuses a file URL with a host outside Windows.
      expect(read.ok).toBe(false)
    }
  })

  test('an https index may not list file:// downloads; a file:// index may', async () => {
    const { entry } = await signedPack()
    const local = indexDoc([entryJson(entry, { downloadUrl: 'file:///C:/packs/depth_pack.json' })])
    const fromHttps = parseRegistryIndex(local, 'https://example.invalid/index.json')
    expect(fromHttps.ok).toBe(false)
    if (!fromHttps.ok) expect(fromHttps.reason).toMatch(/may only list https downloads/)
    expect(parseRegistryIndex(local, 'file:///C:/packs/index.json').ok).toBe(true)
    expect(parseRegistryIndex(local).ok).toBe(true)
    expect(
      parseRegistryIndex(indexDoc([entryJson(entry)]), 'https://example.invalid/i.json').ok,
    ).toBe(true)
  })
})

describe('malformed registry indexes', () => {
  test('each malformed shape is refused with its own reason', async () => {
    const { entry } = await signedPack()
    const cases: [string, string, RegExp][] = [
      ['not json', '{', /not valid JSON/],
      ['array', '[]', /not a JSON object/],
      [
        'packs not array',
        JSON.stringify({ format: 'chipblocks-content-registry-index', version: 1, packs: {} }),
        /must be an array/,
      ],
      ['duplicate', indexDoc([entryJson(entry), entryJson(entry)]), /more than once/],
      ['short sha', indexDoc([entryJson(entry, { sha256: 'ab'.repeat(31) })]), /64 hex/],
      ['negative size', indexDoc([entryJson(entry, { size: -1 })]), /whole number/],
      ['fractional size', indexDoc([entryJson(entry, { size: 1.5 })]), /whole number/],
      [
        'over cap',
        indexDoc([entryJson(entry, { size: REGISTRY_MAX_PACK_BYTES + 1 })]),
        /byte limit/,
      ],
      [
        'bad alg',
        indexDoc([entryJson(entry, { signature: { ...entry.signature, alg: 'rsa' } })]),
        /ed25519/,
      ],
      [
        'short key',
        indexDoc([entryJson(entry, { signature: { ...entry.signature, publicKey: 'ab' } })]),
        /32 raw/,
      ],
      [
        'short sig',
        indexDoc([entryJson(entry, { signature: { ...entry.signature, sig: 'ab'.repeat(32) } })]),
        /64 raw/,
      ],
      [
        'extra sig field',
        indexDoc([entryJson(entry, { signature: { ...entry.signature, x: 1 } })]),
        /unknown field/,
      ],
      ['empty name', indexDoc([entryJson(entry, { name: ' ' })]), /name must be/],
      ['no version', indexDoc([entryJson(entry, { version: '' })]), /version/],
    ]
    for (const [label, text, reason] of cases) {
      const parsed = parseRegistryIndex(text)
      expect(parsed.ok, label).toBe(false)
      if (!parsed.ok) expect(parsed.reason, label).toMatch(reason)
    }
  })

  test('hash case and padding, and hex or base64 key spelling, are accepted as the same values', async () => {
    const { bytes, entry } = await signedPack()
    const keyB64 = Buffer.from(entry.signature.publicKey, 'hex').toString('base64')
    const parsed = parseRegistryIndex(
      indexDoc([
        entryJson(entry, {
          sha256: `  ${entry.sha256.toUpperCase()}  `,
          signature: { alg: 'ed25519', publicKey: keyB64, sig: entry.signature.sig.toUpperCase() },
        }),
      ]),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const row = parsed.packs[0] as RegistryPackEntry
    expect(row.sha256).toBe(entry.sha256)
    expect(row.signature.publicKey).toBe(entry.signature.publicKey)
    expect(row.signature.sig).toBe(entry.signature.sig)
    expect((await checkRegistryDownload(row, bytes)).ok).toBe(true)
  })
})

describe('downloaded bytes', () => {
  test('a truncated, padded, non-UTF-8 or non-JSON download is refused even with a matching hash', async () => {
    const { bytes, entry } = await signedPack()
    const truncated = await checkRegistryDownload(entry, bytes.slice(0, bytes.byteLength - 10))
    expect(truncated.ok).toBe(false)
    if (!truncated.ok)
      expect(truncated.reason).toMatch(/declares \d+ bytes but the download is \d+ bytes/)

    const notUtf8 = new Uint8Array([0xff, 0xfe, 0xfd])
    const r1 = await checkRegistryDownload(
      { ...entry, size: 3, sha256: await sha256HexBytes(notUtf8) },
      notUtf8,
    )
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.reason).toMatch(/not UTF-8/)

    const notJson = new TextEncoder().encode('{ nope')
    const r2 = await checkRegistryDownload(
      { ...entry, size: notJson.byteLength, sha256: await sha256HexBytes(notJson) },
      notJson,
    )
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.reason).toMatch(/not JSON/)

    const unsigned = new TextEncoder().encode(JSON.stringify(packBody('depth_pack', '1.0.0')))
    const r3 = await checkRegistryDownload(
      { ...entry, size: unsigned.byteLength, sha256: await sha256HexBytes(unsigned) },
      unsigned,
    )
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.reason).toMatch(/declares no publisher signature/)
  })

  test('https: a body that breaks off, a declared oversize, and an undeclared oversize are refused', async () => {
    const signal = new AbortController().signal
    const broken = await readHttpsBounded(
      'https://example.invalid/p.json',
      signal,
      1000,
      async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(10))
            controller.error(new Error('connection reset'))
          },
        })
        return new Response(body, { status: 200 })
      },
    )
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.reason).toMatch(/did not complete \(connection reset\)/)

    const viaDownload = await downloadBounded('https://example.invalid/p.json', {
      maxBytes: 1000,
      timeoutMs: 1000,
      httpsGet: (url, s, max) =>
        readHttpsBounded(url, s, max, async () => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(10))
              controller.error(new Error('connection reset'))
            },
          })
          return new Response(body, { status: 200 })
        }),
    })
    expect(viaDownload.ok).toBe(false)
    if (!viaDownload.ok) expect(viaDownload.reason).toMatch(/did not complete \(connection reset\)/)

    const declared = await readHttpsBounded(
      'https://example.invalid/p.json',
      signal,
      100,
      async () =>
        new Response('x'.repeat(10), { status: 200, headers: { 'content-length': '5000' } }),
    )
    expect(declared.ok).toBe(false)
    if (!declared.ok) expect(declared.reason).toMatch(/declares 5000 bytes/)

    const streamed = await readHttpsBounded(
      'https://example.invalid/p.json',
      signal,
      100,
      async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (let i = 0; i < 5; i++) controller.enqueue(new Uint8Array(40))
            controller.close()
          },
        })
        return new Response(body, { status: 200 })
      },
    )
    expect(streamed.ok).toBe(false)
    if (!streamed.ok) expect(streamed.reason).toMatch(/exceeded the 100 byte limit/)

    for (const status of [301, 307, 308, 404, 500]) {
      const r = await readHttpsBounded(
        'https://example.invalid/p.json',
        signal,
        100,
        async () =>
          new Response(null, { status, headers: { location: 'https://elsewhere.invalid/' } }),
      )
      expect(r.ok, String(status)).toBe(false)
    }
  })

  test('a signature over the wrong bytes is refused', async () => {
    // Signed over compact JSON instead of the canonical two-space body.
    const compact = await signedPack({ signOver: (c) => JSON.stringify(JSON.parse(c)) })
    const r1 = await checkRegistryDownload(compact.entry, compact.bytes)
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.reason).toMatch(/does not verify over the canonical pack body/)

    // Signed over the body with a trailing newline.
    const newline = await signedPack({ signOver: (c) => `${c}\n` })
    expect((await checkRegistryDownload(newline.entry, newline.bytes)).ok).toBe(false)

    // A valid signature from the same key over a different pack, pasted into this one.
    const key = await newKey()
    const a = await signedPack({ key, version: '1.0.0' })
    const b = await signedPack({ key, version: '2.0.0' })
    const swapped = JSON.parse(a.text) as Record<string, unknown>
    swapped.signature = (JSON.parse(b.text) as Record<string, unknown>).signature
    const swappedBytes = new TextEncoder().encode(JSON.stringify(swapped, null, 2))
    const swappedEntry: RegistryPackEntry = {
      ...a.entry,
      size: swappedBytes.byteLength,
      sha256: await sha256HexBytes(swappedBytes),
      signature: b.entry.signature,
    }
    const r3 = await checkRegistryDownload(swappedEntry, swappedBytes)
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.reason).toMatch(/does not verify/)

    // The index names the right key but a different signature than the pack carries.
    const other = await signedPack()
    const mismatch = await checkRegistryDownload(
      { ...other.entry, signature: { ...other.entry.signature, sig: 'ab'.repeat(64) } },
      other.bytes,
    )
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok) expect(mismatch.reason).toMatch(/signature does not match the registry entry/)
  })
})

function installedRecord(
  id: string,
  version: string,
  publisherKeyHex?: string,
): InstalledPackRecord {
  const record: InstalledPackRecord = {
    id,
    name: 'Depth Pack',
    packVersion: version,
    license: 'MIT',
    enabled: true,
    installedAt: 1,
    source: 'local-pack',
    partCount: 1,
    footprintCount: 0,
    trustNote: 'old',
  }
  if (publisherKeyHex !== undefined) {
    record.publisherKeyHex = publisherKeyHex
    record.signatureStatus = 'valid-untrusted'
  }
  return record
}

describe('reinstall, upgrade and rollback', () => {
  test('a registry install does not go back a version; the same version or a newer one installs', async () => {
    const key = await newKey()
    const index: ContentIndex = {
      ...emptyContentIndex(),
      packs: [installedRecord('depth_pack', '1.2.0')],
    }
    const older = await signedPack({ key, version: '1.1.0' })
    const io = recordingIO()
    const rolledBack = await installDownloadedRegistryPack({
      index,
      entry: older.entry,
      body: older.bytes,
      io,
    })
    expect(rolledBack.ok).toBe(false)
    if (!rolledBack.ok) expect(rolledBack.reason).toMatch(/does not go back a version/)
    expect(io.log).toEqual([])

    for (const version of ['1.2.0', '1.3.0']) {
      const next = await signedPack({ key, version })
      const ok = await installDownloadedRegistryPack({
        index,
        entry: next.entry,
        body: next.bytes,
        io: recordingIO(),
      })
      expect(ok.ok, version).toBe(true)
      if (ok.ok) {
        expect(ok.index.packs).toHaveLength(1)
        expect(ok.index.packs[0]?.packVersion).toBe(version)
      }
    }
  })

  test('the pack file id and version must match the registry entry', async () => {
    const pack = await signedPack({ id: 'depth_pack' })
    const wrongId = await installDownloadedRegistryPack({
      index: emptyContentIndex(),
      entry: { ...pack.entry, id: 'other_pack' },
      body: pack.bytes,
      io: recordingIO(),
    })
    expect(wrongId.ok).toBe(false)
    const wrongVersion = await installDownloadedRegistryPack({
      index: emptyContentIndex(),
      entry: { ...pack.entry, version: '9.9.9' },
      body: pack.bytes,
      io: recordingIO(),
    })
    expect(wrongVersion.ok).toBe(false)
    if (!wrongVersion.ok) expect(wrongVersion.reason).toMatch(/version is "1.0.0"/)
  })
})

describe('a pinned publisher key cannot be swapped under the same pack id', () => {
  test('local install: another key or no signature is refused while the old key is pinned', async () => {
    const keyOne = await newKey()
    const first = await signedPack({ key: keyOne, version: '1.0.0' })
    const index: ContentIndex = {
      ...emptyContentIndex(),
      packs: [installedRecord('depth_pack', '1.0.0', first.publicKey)],
    }
    const trusted = pinned(first.publicKey)

    const otherKey = await signedPack({ version: '1.1.0' })
    const swapped = await installLocalPackVerified(index, otherKey.text, 2, trusted)
    expect(swapped.ok).toBe(false)
    if (!swapped.ok) {
      expect(swapped.reason).toMatch(/installed from a publisher key you pinned/)
      expect(swapped.reason).toMatch(/signed by a different publisher key/)
      expect(swapped.reason).toMatch(/Nothing was written/)
    }

    const unsigned = JSON.stringify(packBody('depth_pack', '1.2.0'), null, 2)
    const bare = await installLocalPackVerified(index, unsigned, 2, trusted)
    expect(bare.ok).toBe(false)
    if (!bare.ok) expect(bare.reason).toMatch(/has no publisher signature/)

    const sameKey = await signedPack({ key: keyOne, version: '1.1.0' })
    const update = await installLocalPackVerified(index, sameKey.text, 2, trusted)
    expect(update.ok).toBe(true)
    if (update.ok) expect(update.record.signatureStatus).toBe('valid-trusted')

    // Pinned key given as base64 still counts as the same pin.
    const b64 = Buffer.from(first.publicKey, 'hex').toString('base64')
    expect((await installLocalPackVerified(index, otherKey.text, 2, pinned(b64))).ok).toBe(false)

    // Once the old key is no longer pinned, a different key may replace the pack.
    expect((await installLocalPackVerified(index, otherKey.text, 2, pinned())).ok).toBe(true)
    // A different pack id is not affected by the pin on depth_pack.
    const elsewhere = await signedPack({ id: 'other_pack' })
    expect((await installLocalPackVerified(index, elsewhere.text, 2, trusted)).ok).toBe(true)
  })

  test('registry install: the same guard applies and nothing is written', async () => {
    const first = await signedPack({ version: '1.0.0' })
    const index: ContentIndex = {
      ...emptyContentIndex(),
      packs: [installedRecord('depth_pack', '1.0.0', first.publicKey)],
    }
    const impostor = await signedPack({ version: '2.0.0' })
    const io = recordingIO()
    const result = await installDownloadedRegistryPack({
      index,
      entry: impostor.entry,
      body: impostor.bytes,
      trusted: pinned(first.publicKey),
      io,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/publisher key you pinned/)
    expect(io.log).toEqual([])
  })
})

describe('failed writes do not leave a pack the index does not describe', () => {
  const index = emptyContentIndex()

  test('a fresh install whose pack write fails removes the new folder and skips the index', async () => {
    const io = recordingIO({
      writePack: async (id) => {
        io.log.push(`writePack ${id}`)
        return { ok: false, reason: 'Writing pack failed: ENOSPC.' }
      },
    })
    const result = await writeInstalledPack({
      id: 'depth_pack',
      onDiskText: 'NEW',
      index,
      hadPrevious: false,
      io,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/ENOSPC/)
      expect(result.reason).toMatch(/new pack directory was removed/)
    }
    expect(io.log).toEqual(['writePack depth_pack', 'removePack depth_pack'])
  })

  test('an update whose pack write fails leaves the old folder alone', async () => {
    const io = recordingIO({
      writePack: async (id) => {
        io.log.push(`writePack ${id}`)
        return { ok: false, reason: 'Writing pack failed: EIO.' }
      },
    })
    const result = await writeInstalledPack({
      id: 'depth_pack',
      onDiskText: 'NEW',
      index,
      hadPrevious: true,
      io,
    })
    expect(result.ok).toBe(false)
    expect(io.log).toEqual(['readPack depth_pack', 'writePack depth_pack'])
  })

  test('an index write failure removes a new pack, or puts the previous pack back', async () => {
    const fresh = recordingIO({ writeIndex: async () => ({ ok: false, reason: 'disk full' }) })
    expect(
      (
        await writeInstalledPack({
          id: 'depth_pack',
          onDiskText: 'NEW',
          index,
          hadPrevious: false,
          io: fresh,
        })
      ).ok,
    ).toBe(false)
    expect(fresh.log).toEqual(['writePack depth_pack 3', 'removePack depth_pack'])

    const update = recordingIO({ writeIndex: async () => ({ ok: false, reason: 'disk full' }) })
    const r = await writeInstalledPack({
      id: 'depth_pack',
      onDiskText: 'NEW',
      index,
      hadPrevious: true,
      io: update,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/previous pack file was put back/)
    expect(update.log).toEqual([
      'readPack depth_pack',
      'writePack depth_pack 3',
      'writePack depth_pack 8',
    ])
  })

  test('a local install goes through the same path: a refused pack writes nothing', async () => {
    const bad = JSON.stringify({ ...packBody('depth_pack', '1.0.0'), license: 'GPL-3.0' })
    const result = await installLocalPackVerified(index, bad)
    expect(result.ok).toBe(false)
  })
})

describe('every index write starts from the file on disk', () => {
  const stale: ContentIndex = { ...emptyContentIndex(), packs: [installedRecord('tab_a', '1.0.0')] }

  test('the disk copy wins over the copy a tab read earlier', async () => {
    const onDisk: ContentIndex = {
      ...emptyContentIndex(),
      packs: [installedRecord('tab_a', '1.0.0'), installedRecord('tab_b', '1.0.0')],
    }
    const latest = await readIndexForWrite(async () => serializeContentIndex(onDisk), stale)
    expect(latest.ok).toBe(true)
    if (latest.ok) expect(latest.index.packs.map((p) => p.id)).toEqual(['tab_a', 'tab_b'])
  })

  test('a missing file is empty, an unreadable or broken file refuses, no bridge uses the copy', async () => {
    const missing = await readIndexForWrite(async () => null, stale)
    expect(missing.ok && missing.index.packs.length === 0).toBe(true)
    const locked = await readIndexForWrite(async () => {
      throw new Error('EBUSY')
    }, stale)
    expect(locked.ok).toBe(false)
    if (!locked.ok) expect(locked.reason).toMatch(/EBUSY.*Nothing was written/)
    const broken = await readIndexForWrite(async () => '{"format":', stale)
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.reason).toMatch(/Nothing was written over that index file/)
    const noBridge = await readIndexForWrite(undefined, stale)
    expect(noBridge.ok && noBridge.index === stale).toBe(true)
  })
})

describe('atomic file replace', () => {
  test('a write replaces the file and leaves no temp file', async () => {
    const dir = await tempDir()
    const target = join(dir, 'index.json')
    await writeFile(target, 'OLD', 'utf8')
    await writeFileAtomic(target, 'NEW')
    expect(await readFile(target, 'utf8')).toBe('NEW')
    expect(await readdir(dir)).toEqual(['index.json'])
  })

  test('a write that fails part-way leaves the old file whole and removes the temp file', async () => {
    const dir = await tempDir()
    const target = join(dir, 'pack.json')
    await writeFile(target, 'OLD', 'utf8')
    await expect(
      writeFileAtomic(target, 'NEW CONTENT', {
        writeFile: async (path, text) => {
          await writeFile(path, text.slice(0, 3), 'utf8')
          throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
        },
      }),
    ).rejects.toThrow(/ENOSPC/)
    expect(await readFile(target, 'utf8')).toBe('OLD')
    expect(await readdir(dir)).toEqual(['pack.json'])
  })

  test('a rename blocked for a moment is retried; a rename that keeps failing removes the temp file', async () => {
    const dir = await tempDir()
    const target = join(dir, 'trusted-publishers.json')
    let tries = 0
    const { rename } = await import('node:fs/promises')
    await writeFileAtomic(target, 'PINS', {
      sleep: async () => undefined,
      rename: async (from, to) => {
        tries++
        if (tries < 3) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
        await rename(from, to)
      },
    })
    expect(tries).toBe(3)
    expect(await readFile(target, 'utf8')).toBe('PINS')

    await expect(
      writeFileAtomic(target, 'LOST', {
        sleep: async () => undefined,
        rename: async () => {
          throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
        },
      }),
    ).rejects.toThrow(/EXDEV/)
    expect(await readFile(target, 'utf8')).toBe('PINS')
    expect(await readdir(dir)).toEqual(['trusted-publishers.json'])
  })
})

test('bytesToHex stays lowercase so stored keys compare by value', () => {
  expect(bytesToHex(new Uint8Array([0xab, 0x01]))).toBe('ab01')
})
