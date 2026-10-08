/**
 * Registry index schema, download checks, and install that writes nothing until the
 * bytes match. Uses file:// fixtures and an injected https reader — no network.
 */

import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import AjvModule from 'ajv/dist/2020.js'
import { afterEach, describe, expect, test } from 'vitest'
import { downloadBounded, readHttpsBounded } from '../electron/registry-download.ts'
import { emptyContentIndex, type InstalledPackRecord } from '../src/renderer/content-manager.ts'
import { CONTENT_PACK_FORMAT, CONTENT_PACK_VERSION } from '../src/renderer/content-pack.ts'
import { sha256HexBytes } from '../src/renderer/content-pack-integrity.ts'
import { exportRawPublicKeyHex, signPackBodyHex } from '../src/renderer/content-pack-signature.ts'
import {
  checkRegistryDownload,
  classifyRegistryUrl,
  commitRegistrySettings,
  installDownloadedRegistryPack,
  isNewerRegistryVersion,
  NO_REGISTRY_CONFIGURED,
  parseRegistryIndex,
  REGISTRY_MAX_PACK_BYTES,
  type RegistryPackEntry,
  registrySettingsAfterSet,
  registryUpdates,
} from '../src/renderer/content-registry.ts'
import type { UserPart } from '../src/renderer/user-parts.ts'

// biome-ignore lint/suspicious/noExplicitAny: CJS interop for Ajv default export
const Ajv = (AjvModule as any).default ?? AjvModule

const validateIndex = new Ajv({ allErrors: true, strict: false }).compile(
  JSON.parse(readFileSync(join('schemas', 'content-registry-index.schema.json'), 'utf8')),
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

async function signedDownload(over: { name?: string; version?: string } = {}): Promise<{
  text: string
  bytes: Uint8Array
  entry: RegistryPackEntry
}> {
  const pair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])
  const version = over.version ?? '1.0.0'
  const raw = {
    format: CONTENT_PACK_FORMAT,
    version: CONTENT_PACK_VERSION,
    id: 'sig_demo',
    name: over.name ?? 'Sig Demo',
    packVersion: version,
    license: 'MIT',
    parts: [samplePart('sig_buf')],
  }
  const body = JSON.stringify(raw, null, 2)
  const publicKey = await exportRawPublicKeyHex(pair.publicKey)
  const sig = await signPackBodyHex(body, pair.privateKey)
  const text = JSON.stringify({ ...raw, signature: { alg: 'ed25519', publicKey, sig } }, null, 2)
  const bytes = new TextEncoder().encode(text)
  const entry: RegistryPackEntry = {
    id: 'sig_demo',
    name: raw.name,
    version,
    downloadUrl: 'https://example.invalid/sig_demo.json',
    size: bytes.byteLength,
    sha256: await sha256HexBytes(bytes),
    signature: { alg: 'ed25519', publicKey, sig },
  }
  return { text, bytes, entry }
}

function indexText(entry: RegistryPackEntry): string {
  return JSON.stringify(
    {
      format: 'chipblocks-content-registry-index',
      version: 1,
      packs: [
        {
          id: entry.id,
          name: entry.name,
          version: entry.version,
          downloadUrl: entry.downloadUrl,
          size: entry.size,
          sha256: entry.sha256,
          signature: entry.signature,
        },
      ],
    },
    null,
    2,
  )
}

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('registry index schema', () => {
  test('a real signed entry validates, and the size cap matches the runtime constant', async () => {
    const { entry } = await signedDownload()
    const raw = JSON.parse(indexText(entry)) as unknown
    expect(validateIndex(raw)).toBe(true)
    const parsed = parseRegistryIndex(indexText(entry))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.packs[0]?.id).toBe('sig_demo')
    const schema = JSON.parse(
      readFileSync(join('schemas', 'content-registry-index.schema.json'), 'utf8'),
    ) as { $defs: { pack: { properties: { size: { maximum: number } } } } }
    expect(schema.$defs.pack.properties.size.maximum).toBe(REGISTRY_MAX_PACK_BYTES)
  })

  test('the schema and the parser refuse a bad index', async () => {
    const { entry } = await signedDownload()
    const httpEntry = { ...entry, downloadUrl: 'http://example.invalid/sig_demo.json' }
    expect(validateIndex(JSON.parse(indexText(httpEntry)))).toBe(false)
    const parsedHttp = parseRegistryIndex(indexText(httpEntry))
    expect(parsedHttp.ok).toBe(false)
    if (parsedHttp.ok) return
    expect(parsedHttp.reason).toMatch(/https/)

    const future = indexText(entry).replace('"version": 1', '"version": 2')
    expect(validateIndex(JSON.parse(future))).toBe(false)
    const parsedFuture = parseRegistryIndex(future)
    expect(parsedFuture.ok).toBe(false)
    if (parsedFuture.ok) return
    expect(parsedFuture.reason).toMatch(/Unsupported registry index version/)

    const extra = indexText(entry).replace('"packs"', '"note": "x", "packs"')
    expect(validateIndex(JSON.parse(extra))).toBe(false)
  })
})

describe('download verification', () => {
  test('a file:// download of a good pack verifies and installs', async () => {
    const { bytes, entry } = await signedDownload()
    const dir = await mkdtemp(join(tmpdir(), 'cb-registry-'))
    dirs.push(dir)
    const path = join(dir, 'pack.json')
    await writeFile(path, bytes)
    const fileUrl = pathToFileURL(path).href
    const downloaded = await downloadBounded(fileUrl, {
      maxBytes: REGISTRY_MAX_PACK_BYTES,
      timeoutMs: 1000,
    })
    expect(downloaded.ok).toBe(true)
    if (!downloaded.ok) return
    const localEntry = { ...entry, downloadUrl: fileUrl }
    const writes: string[] = []
    const indexes: string[] = []
    const installed = await installDownloadedRegistryPack({
      index: emptyContentIndex(),
      entry: localEntry,
      body: downloaded.bytes,
      io: {
        writePack: async (_id, text) => {
          writes.push(text)
          return { ok: true }
        },
        writeIndex: async (text) => {
          indexes.push(text)
          return { ok: true }
        },
        removePack: async () => ({ ok: true }),
      },
    })
    expect(installed.ok).toBe(true)
    if (!installed.ok) return
    expect(installed.record.signatureStatus).toBe('valid-untrusted')
    expect(installed.record.acquiredFrom).toBe('registry')
    expect(installed.record.source).toBe('local-pack')
    expect(writes).toHaveLength(1)
    expect(indexes).toHaveLength(1)
    expect(installed.record.trustNote).toMatch(/registry SHA-256/)
  })

  test('a bad hash, a bad signature, an oversize file, and a non-https URL write nothing', async () => {
    const { bytes, entry } = await signedDownload()
    const writes: string[] = []
    const io = {
      writePack: async (id: string, text: string) => {
        writes.push(`${id}:${text.length}`)
        return { ok: true }
      },
      writeIndex: async () => ({ ok: true }),
      removePack: async () => ({ ok: true }),
    }

    const badHash = await installDownloadedRegistryPack({
      index: emptyContentIndex(),
      entry: { ...entry, sha256: 'ab'.repeat(32) },
      body: bytes,
      io,
    })
    expect(badHash.ok).toBe(false)
    if (badHash.ok) return
    expect(badHash.reason).toMatch(/SHA-256/)
    expect(badHash.reason).toMatch(/Nothing was written/)

    const changedText = new TextDecoder().decode(bytes).replace('Sig Demo', 'Sig Dem0')
    const tampered = new TextEncoder().encode(changedText)
    const tamperedEntry: RegistryPackEntry = {
      ...entry,
      size: tampered.byteLength,
      sha256: await sha256HexBytes(tampered),
    }
    const badSig = await installDownloadedRegistryPack({
      index: emptyContentIndex(),
      entry: tamperedEntry,
      body: tampered,
      io,
    })
    expect(badSig.ok).toBe(false)
    if (badSig.ok) return
    expect(badSig.reason).toMatch(/signature|publisher key/i)
    expect(badSig.reason).toMatch(/Nothing was written/)

    const dir = await mkdtemp(join(tmpdir(), 'cb-registry-'))
    dirs.push(dir)
    const path = join(dir, 'big.json')
    await writeFile(path, new Uint8Array(64))
    const oversize = await downloadBounded(pathToFileURL(path).href, {
      maxBytes: 16,
      timeoutMs: 1000,
    })
    expect(oversize.ok).toBe(false)
    if (oversize.ok) return
    expect(oversize.reason).toMatch(/over the 16 byte limit/)
    expect(oversize.reason).toMatch(/Nothing was kept/)

    const huge = new Uint8Array(8)
    const hugeEntry: RegistryPackEntry = { ...entry, size: REGISTRY_MAX_PACK_BYTES + 1 }
    const overEntry = await checkRegistryDownload(hugeEntry, huge)
    expect(overEntry.ok).toBe(false)
    if (overEntry.ok) return
    expect(overEntry.reason).toMatch(/byte limit/)
    expect(overEntry.reason).toMatch(/Nothing was written/)

    let httpsCalled = false
    const refused = await downloadBounded('http://127.0.0.1:9/pack.json', {
      maxBytes: 1000,
      timeoutMs: 1000,
      httpsGet: async () => {
        httpsCalled = true
        return { ok: true, bytes: new Uint8Array() }
      },
    })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toMatch(/must be https/)
    expect(httpsCalled).toBe(false)
    expect(classifyRegistryUrl('file:///tmp/pack.json').ok).toBe(true)

    const httpInstall = await installDownloadedRegistryPack({
      index: emptyContentIndex(),
      entry: { ...entry, downloadUrl: 'http://example.invalid/pack.json' },
      body: bytes,
      io,
    })
    expect(httpInstall.ok).toBe(false)
    expect(writes).toEqual([])
  })

  test('https redirects are refused and a stalled download times out', async () => {
    const original = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(null, { status: 302, headers: { location: 'http://example.invalid/' } })
    try {
      const redirected = await readHttpsBounded(
        'https://example.invalid/index.json',
        new AbortController().signal,
        1000,
      )
      expect(redirected.ok).toBe(false)
      if (redirected.ok) return
      expect(redirected.reason).toMatch(/redirected/i)
      expect(redirected.reason).toMatch(/Nothing was downloaded/)
    } finally {
      globalThis.fetch = original
    }

    const timed = await downloadBounded('https://example.invalid/pack.json', {
      maxBytes: 1000,
      timeoutMs: 30,
      httpsGet: (_url, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            resolve({ ok: false, reason: 'aborted' })
          })
        }),
    })
    expect(timed.ok).toBe(false)
    if (timed.ok) return
    expect(timed.reason).toMatch(/timed out/)
  })

  test('a failed index save does not leave a new pack behind, and an update puts the old file back', async () => {
    const { bytes, entry } = await signedDownload()
    const removed: string[] = []
    const fresh = await installDownloadedRegistryPack({
      index: emptyContentIndex(),
      entry,
      body: bytes,
      io: {
        writePack: async () => ({ ok: true }),
        writeIndex: async () => ({ ok: false, reason: 'disk full' }),
        removePack: async (id) => {
          removed.push(id)
          return { ok: true }
        },
      },
    })
    expect(fresh.ok).toBe(false)
    if (fresh.ok) return
    expect(removed).toEqual(['sig_demo'])
    expect(fresh.reason).toMatch(/removed/)
    expect(fresh.reason).toMatch(/disk full/)

    const previous = 'PREVIOUS PACK'
    const written: string[] = []
    const prior: InstalledPackRecord = {
      id: 'sig_demo',
      name: 'Sig Demo',
      packVersion: '1.0.0',
      license: 'MIT',
      enabled: true,
      installedAt: 1,
      source: 'local-pack',
      partCount: 1,
      footprintCount: 0,
      trustNote: 'old',
    }
    const update = await installDownloadedRegistryPack({
      index: { ...emptyContentIndex(), packs: [prior] },
      entry,
      body: bytes,
      io: {
        readPack: async () => previous,
        writePack: async (_id, text) => {
          written.push(text)
          return { ok: true }
        },
        writeIndex: async () => ({ ok: false, reason: 'disk full' }),
        removePack: async () => ({ ok: true }),
      },
    })
    expect(update.ok).toBe(false)
    expect(written.at(-1)).toBe(previous)
    expect(written.length).toBeGreaterThan(1)
  })
})

describe('registry settings and update notices', () => {
  test('no registry is configured until the user saves an https URL, and a bad file is not replaced', async () => {
    expect(NO_REGISTRY_CONFIGURED).toMatch(/No content registry is configured/)
    expect(NO_REGISTRY_CONFIGURED).toMatch(/no public registry exists/)
    const created = registrySettingsAfterSet(null, 'https://example.invalid/index.json')
    expect(created.ok).toBe(true)
    const refused = registrySettingsAfterSet('not json', 'https://example.invalid/other.json')
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toMatch(/Nothing was written/)
    const http = registrySettingsAfterSet(null, 'http://example.invalid/index.json')
    expect(http.ok).toBe(false)

    const writes: string[] = []
    const failed = await commitRegistrySettings({
      read: async () => {
        throw new Error('EIO')
      },
      write: async (text) => {
        writes.push(text)
        return { ok: true }
      },
      indexUrl: 'https://example.invalid/index.json',
    })
    expect(failed.ok).toBe(false)
    expect(writes).toEqual([])
  })

  test('a newer numeric version is announced and is not installed by itself', () => {
    expect(isNewerRegistryVersion('1.0.0', '1.2.0')).toBe(true)
    expect(isNewerRegistryVersion('1.2.0', '1.2.0')).toBe(false)
    expect(isNewerRegistryVersion('1.2.0', '1.2')).toBe(false)
    expect(isNewerRegistryVersion('1.0.0', '1.0.0-beta')).toBe(false)
    const updates = registryUpdates(
      [{ id: 'sig_demo', name: 'Sig Demo', packVersion: '1.0.0' }],
      [
        {
          id: 'sig_demo',
          version: '1.1.0',
          downloadUrl: 'https://example.invalid/sig_demo.json',
          size: 10,
          sha256: 'ab'.repeat(32),
          signature: { alg: 'ed25519', publicKey: 'cd'.repeat(32), sig: 'ef'.repeat(64) },
        },
      ],
    )
    expect(updates).toEqual([
      { id: 'sig_demo', name: 'Sig Demo', installed: '1.0.0', offered: '1.1.0' },
    ])
  })
})
