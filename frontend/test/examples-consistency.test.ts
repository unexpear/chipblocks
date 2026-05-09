/**
 * Examples-consistency test (Sprint-12 C3, partial).
 *
 * `frontend/src/examples.ts` and `<repo-root>/examples/*.json` are two
 * sources of truth for the same demo graphs:
 *   - examples.ts: imported at build time so the renderer's
 *     "Load > Examples" menu works in dev and packaged builds without
 *     IPC.
 *   - examples/*.json: canonical save-format files we ship next to the
 *     code (also referenced from docs and integration tests).
 *
 * If those two ever drift, the menu will show different graphs from
 * what users see when they open the canonical JSON. This test asserts
 * both sides agree on `nodes` and `edges` for every example id.
 *
 * The TS module deliberately omits the v1 envelope (`version`, `app`,
 * `savedAt`, `viewport`) — those are properties of the on-disk save
 * format, not of the in-memory graph data. So we compare only the
 * `nodes` and `edges` arrays.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { EXAMPLES } from '../src/examples'

const REPO_EXAMPLES_DIR = path.resolve(__dirname, '..', '..', 'examples')

describe('examples.ts <-> examples/*.json consistency', () => {
  for (const ex of EXAMPLES) {
    it(`'${ex.id}' matches examples/${ex.id}.json`, () => {
      const jsonPath = path.join(REPO_EXAMPLES_DIR, `${ex.id}.json`)
      // readFileSync throws ENOENT — let it bubble. Test failure with
      // a clear file path is easier to fix than a swallowed null.
      const raw = readFileSync(jsonPath, 'utf8')
      const parsed = JSON.parse(raw) as {
        version?: number
        app?: string
        nodes: unknown[]
        edges: unknown[]
      }
      // Basic envelope sanity (the JSON files all carry v1 today).
      expect(parsed.version).toBe(1)
      expect(parsed.app).toBe('ChipBlocks')
      // The headline assertions: nodes and edges deep-equal between
      // sources. Order matters here — both sources are authored
      // by hand and we want to flag accidental reordering too.
      expect(parsed.nodes).toEqual(ex.nodes)
      expect(parsed.edges).toEqual(ex.edges)
    })
  }
})
