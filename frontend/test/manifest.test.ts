/**
 * Manifest-integrity test (ADR-003, Sprint 21 Phase 0 step 7).
 *
 * `blocks.yaml` at the repo root is the single source of truth for
 * cross-cutting block metadata once the Sprint-21 codegen lands. The
 * JSON Schema (`blocks.schema.json`) validates a row's *shape*, but it
 * cannot catch the case where a row points at a file or symbol that
 * doesn't actually exist on disk — that's what this test is for.
 *
 * Each row must satisfy three on-disk invariants:
 *   1. `componentPath` resolves to a readable file under the repo root.
 *   2. That file exports a symbol named `<PascalCase>Node` where
 *      PascalCase is the file's basename (e.g. `RegisterFileNode.tsx`
 *      exports `RegisterFileNode`).
 *   3. `frontend/src/blocks/index.ts` registers the component — a
 *      `from './<PascalCase>Node'` line must appear. Catches the case
 *      where a manifest row is added but the hand-edited index.ts
 *      forgets to wire it in.
 *
 * The test tolerates `blocks.yaml` being missing — Phase 0 has a sibling
 * agent authoring it in parallel. When the file is absent we skip with
 * a clear reason. When it exists (CI + post-Phase-0 local runs) we
 * assert against its actual content.
 */

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const MANIFEST_PATH = path.join(REPO_ROOT, 'blocks.yaml')
const INDEX_TS_PATH = path.join(REPO_ROOT, 'frontend', 'src', 'blocks', 'index.ts')

type ManifestRow = {
  type: string
  componentPath: string
  backendPath: string
  backendClass: string
}

function loadManifest(): { rows: ManifestRow[] } | { skip: string } | { error: string } {
  if (!existsSync(MANIFEST_PATH)) {
    return { skip: `blocks.yaml not present at ${MANIFEST_PATH} — Phase 0 manifest authoring in flight; test will run once the file lands` }
  }
  const requireFn = createRequire(import.meta.url)
  let yaml: { load: (src: string) => unknown }
  try {
    yaml = requireFn('js-yaml')
  } catch {
    return {
      error:
        "js-yaml is required to read blocks.yaml but is not installed — run `npm install` from frontend/.",
    }
  }
  const raw = readFileSync(MANIFEST_PATH, 'utf8')
  const parsed = yaml.load(raw)
  if (!Array.isArray(parsed)) {
    return { error: `blocks.yaml must be a YAML array of block rows; got ${typeof parsed}` }
  }
  return { rows: parsed as ManifestRow[] }
}

const loaded = loadManifest()

describe('blocks.yaml manifest integrity', () => {
  if ('skip' in loaded) {
    it.skip(loaded.skip, () => {})
    return
  }
  if ('error' in loaded) {
    it('blocks.yaml loads cleanly', () => {
      throw new Error(loaded.error)
    })
    return
  }

  const indexTs = readFileSync(INDEX_TS_PATH, 'utf8')

  for (const row of loaded.rows) {
    const componentBase = path.basename(row.componentPath, '.tsx') // e.g. 'RegisterFileNode'
    const fullComponentPath = path.join(REPO_ROOT, row.componentPath)

    describe(`${row.type} (${row.componentPath})`, () => {
      it('componentPath file exists on disk', () => {
        expect(
          existsSync(fullComponentPath),
          `manifest row '${row.type}' points at ${row.componentPath} but the file does not exist`,
        ).toBe(true)
      })

      it(`exports ${componentBase}`, () => {
        const source = readFileSync(fullComponentPath, 'utf8')
        const exportRe = new RegExp(`export\\s+(function|const)\\s+${componentBase}\\b`)
        expect(
          exportRe.test(source),
          `${row.componentPath} does not export 'export function ${componentBase}' or 'export const ${componentBase}'`,
        ).toBe(true)
      })

      it(`is imported in frontend/src/blocks/index.ts`, () => {
        const importRe = new RegExp(`from\\s+['"]\\./${componentBase}['"]`)
        expect(
          importRe.test(indexTs),
          `manifest row '${row.type}' is not imported from './${componentBase}' in index.ts — was the hand-edited nodeTypes registry forgotten?`,
        ).toBe(true)
      })
    })
  }
})
