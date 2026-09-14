/**
 * What the Electron MAIN process can reach. It opens project files itself (circuit-open.ts →
 * circuit-file.ts → the part validators), so every module on that path runs in plain Node — and a VALUE
 * import of React or @xyflow anywhere on it crashes the packaged app at start-up. Type-only imports are
 * erased at compile time and are fine. This walks the real import graph from main.ts and fails if a
 * forbidden package is reached as a value, naming the chain that reached it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const FORBIDDEN = ['react', 'react-dom', '@xyflow/react', '@xyflow/system']

const STATEMENT_RE = /^(?:import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm
const SIDE_EFFECT_RE = /^import\s+['"]([^'"]+)['"]/gm

/** The modules a file imports as VALUES (type-only imports and `{ type A, type B }` lists skipped). */
function valueImports(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(STATEMENT_RE)) {
    const [, typeKeyword, clause = '', specifier = ''] = match
    if (typeKeyword !== undefined) continue
    const list = clause.trim().match(/^\{([\s\S]*)\}$/)
    const names = list?.[1]
      ?.split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
    if (names !== undefined && names.length > 0 && names.every((n) => n.startsWith('type '))) {
      continue
    }
    found.push(specifier)
  }
  for (const match of source.matchAll(SIDE_EFFECT_RE)) found.push(match[1] ?? '')
  return found
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate
  }
  return null
}

/** Every local module main.ts reaches through value imports, and the bare packages it pulls in. */
function walk(entry: string): { modules: Map<string, string[]>; packages: Map<string, string[]> } {
  const modules = new Map<string, string[]>([[entry, [entry]]])
  const packages = new Map<string, string[]>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift() as string
    const chain = modules.get(file) as string[]
    for (const specifier of valueImports(readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('.')) {
        if (!packages.has(specifier)) packages.set(specifier, chain)
        continue
      }
      const target = resolveLocal(file, specifier)
      if (target === null || modules.has(target)) continue
      modules.set(target, [...chain, target])
      queue.push(target)
    }
  }
  return { modules, packages }
}

describe('the Electron main process never reaches React or @xyflow', () => {
  const root = resolve('.')
  const { modules, packages } = walk(resolve('electron/main.ts'))
  const rel = (files: string[]) => files.map((f) => relative(root, f).replace(/\\/g, '/'))

  test('the walk covers the file loader and the drawn-symbol validator (so the check means something)', () => {
    const reached = rel([...modules.keys()])
    expect(reached).toContain('src/renderer/circuit-file.ts')
    expect(reached).toContain('src/renderer/user-part-validate.ts')
    expect(reached).toContain('src/renderer/user-symbol-validate.ts')
    expect(reached).toContain('src/renderer/symbol-geometry.ts')
  })

  for (const name of FORBIDDEN) {
    test(`no value import of ${name}`, () => {
      const chain = packages.get(name)
      expect(chain === undefined ? 'not reached' : rel(chain).join(' → ')).toBe('not reached')
    })
  }
})
