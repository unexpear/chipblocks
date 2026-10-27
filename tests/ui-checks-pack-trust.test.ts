/**
 * The ui-checks content-pack trust fixtures prove what they claim: the local test registry's good
 * entry passes the app's own registry download check and each faulty entry is refused for its own
 * reason (bad SHA-256, signature broken after signing, a publisher key the index does not name), and
 * the real-home guard notices any change under the folder it watches. Everything here lives in a
 * temp folder; the real ~/.chipblocks is never read or written by these tests.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { checkRegistryDownload, parseRegistryIndex } from '../src/renderer/content-registry.ts'

type Entry = { id: string; downloadUrl: string }
type Fixture = {
  makeRegistry: (args: {
    dir: string
    packs: { id: string; name: string; fault?: 'sha' | 'sig' | 'key' }[]
    writeFile: (file: string, text: string) => void
    fileUrl: (file: string) => string
  }) => { indexUrl: string; entries: Entry[] }
}
type Snapshot = { root: string; lines: string[] }
type Guard = {
  chipblocksSnapshot: (root: string) => Snapshot
  snapshotDiff: (a: Snapshot, b: Snapshot) => { gone: string[]; added: string[] }
}

const load = async <T>(rel: string): Promise<T> =>
  (await import(pathToFileURL(resolve(rel)).href)) as T

const scratch = mkdtempSync(join(tmpdir(), 'cb-pack-trust-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('ui-checks local test registry', () => {
  test('good entry passes the registry check; each fault is refused for its own reason', async () => {
    const { makeRegistry } = await load<Fixture>('ui-checks/src/pack-fixture.mjs')
    const dir = join(scratch, 'registry')
    const { indexUrl } = makeRegistry({
      dir,
      packs: [
        { id: 'reg_good', name: 'Reg Good' },
        { id: 'reg_badsha', name: 'Reg Bad SHA', fault: 'sha' },
        { id: 'reg_badsig', name: 'Reg Bad Signature', fault: 'sig' },
        { id: 'reg_wrongkey', name: 'Reg Wrong Key', fault: 'key' },
      ],
      writeFile: (file, text) => {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, text, 'utf8')
      },
      fileUrl: (file) => pathToFileURL(resolve(file)).href,
    })
    expect(indexUrl.startsWith('file:///')).toBe(true)
    const index = parseRegistryIndex(readFileSync(join(dir, 'index.json'), 'utf8'))
    if (!index.ok) throw new Error(index.reason)
    expect(index.packs.map((p) => p.id)).toEqual([
      'reg_good',
      'reg_badsha',
      'reg_badsig',
      'reg_wrongkey',
    ])
    const verdict = async (id: string) => {
      const entry = index.packs.find((p) => p.id === id)
      if (entry === undefined) throw new Error(id)
      const body = new Uint8Array(readFileSync(new URL(entry.downloadUrl)))
      return checkRegistryDownload(entry, body)
    }
    expect((await verdict('reg_good')).ok).toBe(true)
    const sha = await verdict('reg_badsha')
    expect(sha.ok).toBe(false)
    if (!sha.ok)
      expect(sha.reason).toMatch(/^SHA-256 of the download for "reg_badsha" does not match/)
    const sig = await verdict('reg_badsig')
    expect(sig.ok).toBe(false)
    if (!sig.ok)
      expect(sig.reason).toMatch(/signature does not verify over the canonical pack body/)
    const key = await verdict('reg_wrongkey')
    expect(key.ok).toBe(false)
    if (!key.ok)
      expect(key.reason).toMatch(
        /publisher key does not match the registry entry for "reg_wrongkey"/,
      )
  })
})

describe('ui-checks real-home guard', () => {
  test('reports absent, then any added, changed or removed file', async () => {
    const { chipblocksSnapshot, snapshotDiff } = await load<Guard>('ui-checks/src/home-guard.mjs')
    const root = join(scratch, 'home', '.chipblocks')
    expect(chipblocksSnapshot(root).lines).toEqual(['absent'])
    mkdirSync(join(root, 'libraries'), { recursive: true })
    writeFileSync(join(root, 'user-parts.json'), '[]', 'utf8')
    const before = chipblocksSnapshot(root)
    expect(snapshotDiff(before, chipblocksSnapshot(root))).toEqual({ gone: [], added: [] })
    writeFileSync(join(root, 'trusted-publishers.json'), '{}', 'utf8')
    writeFileSync(join(root, 'user-parts.json'), '[1]', 'utf8')
    const diff = snapshotDiff(before, chipblocksSnapshot(root))
    expect(diff.added.some((l) => l.startsWith('trusted-publishers.json'))).toBe(true)
    expect(diff.added.some((l) => l.startsWith('user-parts.json  3'))).toBe(true)
    expect(diff.gone.some((l) => l.startsWith('user-parts.json  2'))).toBe(true)
  })
})
