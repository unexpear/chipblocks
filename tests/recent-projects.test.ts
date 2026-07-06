import { beforeEach, describe, expect, test } from 'vitest'
import {
  listRecentProjects,
  projectNameFromPath,
  recordRecentProject,
  removeRecentProject,
} from '../src/renderer/recent-projects.ts'

/**
 * The "My Projects" most-recently-used list — a localStorage-backed record of saved .chipblocks
 * files. These pin the behaviour the launcher relies on: newest first, dedup by path, prune, and
 * graceful tolerance of a missing/corrupt store.
 */

// a minimal in-memory localStorage for the node test env
beforeEach(() => {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
})

describe('recent projects MRU', () => {
  test('record + list is newest-first and dedups by path (a re-save moves it up + updates the name)', () => {
    recordRecentProject({ name: 'A', path: '/a.chipblocks', savedAt: 100 })
    recordRecentProject({ name: 'B', path: '/b.chipblocks', savedAt: 200 })
    recordRecentProject({ name: 'A2', path: '/a.chipblocks', savedAt: 300 })
    const list = listRecentProjects()
    expect(list.map((p) => p.path)).toEqual(['/a.chipblocks', '/b.chipblocks'])
    expect(list[0]?.name).toBe('A2')
  })

  test('remove drops an entry', () => {
    recordRecentProject({ name: 'A', path: '/a.chipblocks', savedAt: 100 })
    recordRecentProject({ name: 'B', path: '/b.chipblocks', savedAt: 200 })
    removeRecentProject('/a.chipblocks')
    expect(listRecentProjects().map((p) => p.path)).toEqual(['/b.chipblocks'])
  })

  test('a corrupt / non-array store degrades to an empty list, never a throw', () => {
    localStorage.setItem('chipblocks.projects', 'not json{')
    expect(listRecentProjects()).toEqual([])
    localStorage.setItem('chipblocks.projects', '{"not":"an array"}')
    expect(listRecentProjects()).toEqual([])
  })

  test('malformed entries are filtered out', () => {
    localStorage.setItem(
      'chipblocks.projects',
      JSON.stringify([{ name: 'ok', path: '/ok.chipblocks', savedAt: 1 }, { bogus: true }, null]),
    )
    expect(listRecentProjects().map((p) => p.path)).toEqual(['/ok.chipblocks'])
  })

  test('projectNameFromPath strips the directory and the .chipblocks extension', () => {
    expect(projectNameFromPath('C:/foo/bar/MyThing.chipblocks')).toBe('MyThing')
    expect(projectNameFromPath('/x/y/z.chipblocks')).toBe('z')
    expect(projectNameFromPath('C:\\win\\path\\Board.chipblocks')).toBe('Board')
  })
})
