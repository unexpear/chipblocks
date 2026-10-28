/**
 * Item 2: when installed packs or pins change on disk (another tab, another ChipBlocks window,
 * a hand edit), every tab's Content Manager re-reads at once, not only when its panel is opened.
 * Main announces the change (content:changed, from its own writes and an fs.watch on
 * ~/.chipblocks); main.tsx turns it into the window event used here.
 *
 * @vitest-environment jsdom
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createChangeNotifier, watchContentHome } from '../electron/content-watch.ts'
import { type InstalledPackRecord, serializeContentIndex } from '../src/renderer/content-manager.ts'
import { CONTENT_PACK_FORMAT, CONTENT_PACK_VERSION } from '../src/renderer/content-pack.ts'
import type { TrustSealView } from '../src/renderer/trust-seal-view.ts'
import { useContentManager } from '../src/renderer/use-content-manager.tsx'

const reactGlobals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActFlag = reactGlobals.IS_REACT_ACT_ENVIRONMENT
reactGlobals.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActFlag === undefined) delete reactGlobals.IS_REACT_ACT_ENVIRONMENT
  else reactGlobals.IS_REACT_ACT_ENVIRONMENT = previousActFlag
})

function packText(id: string): string {
  return JSON.stringify(
    {
      format: CONTENT_PACK_FORMAT,
      version: CONTENT_PACK_VERSION,
      id,
      name: `Pack ${id}`,
      packVersion: '1.0.0',
      license: 'MIT',
      parts: [],
    },
    null,
    2,
  )
}

function row(id: string, enabled = true): InstalledPackRecord {
  return {
    id,
    name: `Pack ${id}`,
    packVersion: '1.0.0',
    license: 'MIT',
    enabled,
    installedAt: 1,
    source: 'local-pack',
    partCount: 0,
    footprintCount: 0,
    trustNote: 'test',
    contentHash: createHash('sha256').update(packText(id)).digest('hex'),
    integrityStatus: 'undeclared',
  }
}

/** A desktop bridge over an in-memory ~/.chipblocks that "another window" can change. */
function fakeDisk() {
  const disk = {
    index: serializeContentIndex({ format: 'chipblocks-content-index', version: 1, packs: [] }),
  }
  const packReads: string[] = []
  const bridge = {
    readContentIndex: async () => disk.index,
    readContentPack: async (id: string) => {
      packReads.push(id)
      return packText(id)
    },
    readTrustSeal: async (): Promise<TrustSealView> => ({
      pinsText: null,
      pins: { status: 'no-pins' },
      floors: {},
      protection: 'os',
    }),
  }
  return {
    disk,
    packReads,
    bridge,
    setPacks: (rows: InstalledPackRecord[]) => {
      disk.index = serializeContentIndex({
        format: 'chipblocks-content-index',
        version: 1,
        packs: rows,
      })
    },
  }
}

function Tab({ active }: { active: boolean }): ReactNode {
  const manager = useContentManager(false, active)
  return createElement('div', { 'data-tab': active ? 'active' : 'background' }, manager.panel)
}

const badges = () =>
  [...document.querySelectorAll('[data-testid="content-manager-badge"]')].map(
    (el) => `${el.getAttribute('data-pack')}:${el.textContent}`,
  )

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

describe('Content Manager re-reads on a change notice', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Reflect.deleteProperty(window, 'chipblocks')
  })

  test('an open panel shows a pack another window installed, and its disable, without reopening', async () => {
    const fake = fakeDisk()
    Object.assign(window, { chipblocks: fake.bridge })
    await act(async () => {
      root.render(
        createElement(
          'div',
          null,
          createElement(Tab, { active: false }),
          createElement(Tab, { active: true }),
        ),
      )
    })
    await settle()
    await act(async () => {
      window.dispatchEvent(new Event('chipblocks:content-manager'))
    })
    await settle()
    expect(badges()).toEqual([])

    fake.setPacks([row('other_win')])
    await settle()
    expect(badges()).toEqual([]) // nothing re-reads by itself
    await act(async () => {
      window.dispatchEvent(new Event('chipblocks:content-changed'))
    })
    await settle()
    expect(badges()).toEqual(['other_win:ENABLED'])
    // Each tab re-verifies the pack file for its own trust badge (2 reads), but the parts are
    // registered once for the window (1 read), not once per tab (which would be 4).
    expect(fake.packReads.filter((id) => id === 'other_win')).toHaveLength(3)

    fake.setPacks([row('other_win', false)])
    await act(async () => {
      window.dispatchEvent(new Event('chipblocks:content-changed'))
    })
    await settle()
    expect(badges()).toEqual(['other_win:DISABLED'])
  })

  test('a pack file swapped behind the index shows NOT LOADED on the next notice', async () => {
    const fake = fakeDisk()
    const bad = { ...row('swapped'), contentHash: '0'.repeat(64) }
    Object.assign(window, { chipblocks: fake.bridge })
    await act(async () => {
      root.render(createElement(Tab, { active: true }))
    })
    await settle()
    await act(async () => {
      window.dispatchEvent(new Event('chipblocks:content-manager'))
    })
    fake.setPacks([bad])
    await act(async () => {
      window.dispatchEvent(new Event('chipblocks:content-changed'))
    })
    await settle()
    expect(badges()).toEqual(['swapped:ENABLED · NOT LOADED'])
  })
})

describe('main-process change notice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chipblocks-watch-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('a change under ~/.chipblocks (another process writing index.json) is seen by the watcher', async () => {
    mkdirSync(join(dir, 'libraries'), { recursive: true })
    const seen = vi.fn()
    const watcher = watchContentHome(dir, seen)
    expect(watcher).not.toBeNull()
    try {
      await new Promise((r) => setTimeout(r, 100))
      writeFileSync(join(dir, 'libraries', 'index.json'), '{}')
      for (let i = 0; i < 40 && seen.mock.calls.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(seen).toHaveBeenCalled()
    } finally {
      watcher?.close()
    }
  })

  test('a missing folder gives no watcher (main retries after its first write)', () => {
    expect(watchContentHome(join(dir, 'not-there'), () => {})).toBeNull()
  })

  test('temp files and the lock file are not changes; a burst becomes one notice', async () => {
    let listener: ((event: string, name: string | null) => void) | undefined
    const fakeWatch = ((
      _d: string,
      _o: unknown,
      l: (event: string, name: string | null) => void,
    ) => {
      listener = l
      return { on: () => {}, close: () => {} }
    }) as unknown as Parameters<typeof watchContentHome>[2]
    const seen = vi.fn()
    watchContentHome(dir, seen, fakeWatch)
    listener?.('rename', 'libraries/index.json.123.abc.tmp')
    listener?.('change', 'content.lock')
    expect(seen).not.toHaveBeenCalled()
    listener?.('change', 'trusted-publishers.json')
    expect(seen).toHaveBeenCalledTimes(1)

    const send = vi.fn()
    const notifier = createChangeNotifier(send, 20)
    notifier.notify()
    notifier.notify()
    notifier.notify()
    await new Promise((r) => setTimeout(r, 60))
    expect(send).toHaveBeenCalledTimes(1)
  })
})
