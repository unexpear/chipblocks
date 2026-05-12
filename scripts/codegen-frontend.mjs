#!/usr/bin/env node
// codegen-frontend.mjs — Phase 0 scaffolding for ADR-003 block manifest.
//
// Reads blocks.yaml + blocks.schema.json at repo root, validates the
// manifest, and emits fragment strings for 5 frontend target files:
//
//   1. frontend/src/blocks/index.ts         — imports + nodeTypes + AppNode
//   2. frontend/src/blocks/busTypes.ts      — BLOCK_PORT_TYPES only
//   3. frontend/src/Palette.tsx             — PALETTE + defaultDataForType
//   4. frontend/src/App.css                 — .block-<type> rules block
//   5. frontend/src/ai/prompt.ts            — block list + tool-call schema
//
// Modes:
//   --check (default) — extract the live section from each target via an
//                       anchor regex, byte-diff against generated output,
//                       exit non-zero with a unified diff if any diverge.
//   --write           — insert fragments between `@begin codegen <name>`
//                       and `@end codegen <name>` markers. NOT used in
//                       Phase 0; left in place for the Phase 1 cutover.
//
// Boundary detection per target (anchor strategy):
//   index.ts:    imports — first/last line beginning with `import { ... } from './...Node'`;
//                nodeTypes — `export const nodeTypes = {` to the matching `}`;
//                AppNode  — `export type AppNode =` to end-of-file (final union member).
//   busTypes.ts: BLOCK_PORT_TYPES — `export const BLOCK_PORT_TYPES: Record...= {`
//                to the matching `}` at column 0. Inner block (category dividers + rows).
//   Palette.tsx: PALETTE — `export const PALETTE: PaletteEntry[] = [` to the matching `]`.
//                defaultDataForType — body of the switch statement, from `switch (type) {`
//                to the matching `}`.
//   App.css:     first `.block-<type>` rule to the last `.block-<type>` rule before a
//                non-block selector. Detect via regex on `.block-<known-type>`.
//   prompt.ts:   block-list section — from `# Block library (all 42 types ...` heading
//                to the next `# ...` heading (`# Naming conventions`).
//                tool-call schema — `blockTypeIds` enum derives directly from PALETTE
//                so no separate slot; the per-block data-shape list inside add_node's
//                description string IS a codegen target.
//
// Install (devDependencies, both MIT-licensed):
//   cd frontend && npm install --save-dev js-yaml ajv
//
// Invocation (run from frontend/ directory):
//   node ../scripts/codegen-frontend.mjs            # --check (default)
//   node ../scripts/codegen-frontend.mjs --write    # Phase 1 only
//
// Or from repo root:
//   npm --prefix frontend run codegen
//
// Phase 0 contract: `--check` exits 0 iff every target file's extracted
// section is byte-identical to the corresponding generated fragment.
// Otherwise prints a unified diff per divergent target and exits 1.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const MANIFEST = path.join(REPO_ROOT, 'blocks.yaml')
const SCHEMA = path.join(REPO_ROOT, 'blocks.schema.json')

const mode = process.argv.includes('--write') ? 'write' : 'check'

// ────────────────────────────────────────────────────────────────────────────
// Manifest load + validate
// ────────────────────────────────────────────────────────────────────────────
//
// js-yaml + ajv are devDependencies under frontend/. This script lives at
// scripts/ but is invoked from frontend/ via `npm run codegen` so cwd-based
// resolution finds them. Use createRequire keyed off the frontend's
// package.json so ESM `import` looks them up via the frontend node_modules.

let yamlModule, ajvModule
try {
  const requireFromFrontend = createRequire(
    pathToFileURL(path.join(REPO_ROOT, 'frontend', 'package.json'))
  )
  const yamlPath = requireFromFrontend.resolve('js-yaml')
  const ajvPath = requireFromFrontend.resolve('ajv')
  yamlModule = await import(pathToFileURL(yamlPath).href)
  ajvModule = await import(pathToFileURL(ajvPath).href)
} catch (err) {
  console.error('[codegen-frontend] Missing dependency. From frontend/:')
  console.error('  npm install --save-dev js-yaml ajv')
  console.error('  Underlying error:', err.message)
  process.exit(2)
}

if (!fs.existsSync(MANIFEST)) {
  console.error(`[codegen-frontend] blocks.yaml not found at ${MANIFEST}`)
  console.error('  Phase 0 step 1 (manifest authoring) has to land before codegen runs.')
  process.exit(2)
}
if (!fs.existsSync(SCHEMA)) {
  console.error(`[codegen-frontend] blocks.schema.json not found at ${SCHEMA}`)
  process.exit(2)
}

const manifest = yamlModule.load(fs.readFileSync(MANIFEST, 'utf8'))
const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'))
const Ajv = ajvModule.default
const ajv = new Ajv({ allErrors: true })
const validate = ajv.compile(schema)
if (!validate(manifest)) {
  console.error('[codegen-frontend] blocks.yaml fails schema validation:')
  for (const err of validate.errors) {
    const row = err.instancePath.match(/^\/(\d+)/)?.[1] ?? '?'
    console.error(`  row ${row}: ${err.instancePath} ${err.message}`)
  }
  process.exit(2)
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

// Title-cased React class name (BlockClass) — preserved from manifest.
const toComponent = (b) => path.basename(b.componentPath, '.tsx')
const toBlockType = (b) => toComponent(b).replace(/Node$/, 'Block')

// Pad a string to a column width, right-padding with spaces.
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length))

// Unified diff helper for --check failures.
function unifiedDiff(actual, expected, label) {
  const a = actual.split('\n')
  const b = expected.split('\n')
  const out = [`--- ${label} (current)`, `+++ ${label} (generated)`]
  // Naive line-by-line diff; the user iterates the template until empty.
  const max = Math.max(a.length, b.length)
  let inHunk = false
  for (let i = 0; i < max; i++) {
    const av = a[i], bv = b[i]
    if (av !== bv) {
      if (!inHunk) {
        out.push(`@@ line ${i + 1} @@`)
        inHunk = true
      }
      if (av !== undefined) out.push('-' + av)
      if (bv !== undefined) out.push('+' + bv)
    } else {
      inHunk = false
    }
  }
  return out.join('\n')
}

// Marker comment shapes by source language.
//   ts   — TypeScript / JavaScript: `// @begin codegen <slot>`
//   css  — CSS:                     `/* @begin codegen <slot> */`
//   html — Template-literal text:   `<!-- @begin codegen <slot> -->`
// Marker comments wrap every generated section so the next `--check` can
// locate the live block by marker instead of falling back to the anchor
// regex. Both detectors stay in place — first run sees no markers and
// uses the anchor; subsequent runs hit the marker pair first.
function makeMarkers(slot, style) {
  if (style === 'ts') {
    return [`// @begin codegen ${slot}`, `// @end codegen ${slot}`]
  }
  if (style === 'css') {
    return [`/* @begin codegen ${slot} */`, `/* @end codegen ${slot} */`]
  }
  if (style === 'html') {
    return [`<!-- @begin codegen ${slot} -->`, `<!-- @end codegen ${slot} -->`]
  }
  throw new Error(`Unknown marker style: ${style}`)
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// If marker pair exists, return the captured content between them. Returns
// null if the markers are not present.
function extractByMarkers(src, slot, style) {
  const [open, close] = makeMarkers(slot, style)
  const re = new RegExp(
    `${escapeRegex(open)}\\n([\\s\\S]*?)\\n[ \\t]*${escapeRegex(close)}`,
  )
  const m = src.match(re)
  return m ? m[1] : null
}

// Replace the generated section in `src` with markers + new content.
// First-run path: markers absent. Use the legacy extractor to locate the
// live block, then splice in `<begin>\n<generated>\n<end>` at the same
// position.
// Re-run path: markers present. Swap the content between them.
function applyWrite(src, target, generated) {
  const [open, close] = makeMarkers(target.slot, target.commentStyle)
  const reMarkers = new RegExp(
    `(${escapeRegex(open)})\\n[\\s\\S]*?\\n([ \\t]*${escapeRegex(close)})`,
  )
  if (reMarkers.test(src)) {
    return src.replace(reMarkers, `$1\n${generated}\n$2`)
  }
  const live = target.extractor(src)
  if (live == null || live === '') {
    throw new Error(`[codegen-frontend] cannot locate live section for ${target.name}`)
  }
  const idx = src.indexOf(live)
  if (idx < 0) {
    throw new Error(`[codegen-frontend] live section text not found in ${target.path} for ${target.name}`)
  }
  const replacement = `${open}\n${generated}\n${close}`
  return src.slice(0, idx) + replacement + src.slice(idx + live.length)
}

// ────────────────────────────────────────────────────────────────────────────
// Fragment generators (one per target file)
// ────────────────────────────────────────────────────────────────────────────

function genIndexTs() {
  // Column widths chosen to match the current file's alignment.
  const importLines = manifest.map((b) => {
    const comp = toComponent(b)
    const blk = toBlockType(b)
    const left = `import { ${pad(comp + ',', 20)}type ${pad(blk + ' }', 22)}`
    return `${left}from './${comp}'`
  })

  const nodeTypeRows = manifest.map((b) => {
    const comp = toComponent(b)
    return `  ${pad(b.type + ':', 11)}${comp},`
  })

  const appNodeMembers = manifest.map((b, i) => {
    const blk = toBlockType(b)
    return (i === 0 ? '  | ' : '  | ') + blk
  })

  return {
    imports: importLines.join('\n'),
    nodeTypes:
      'export const nodeTypes = {\n' + nodeTypeRows.join('\n') + '\n}',
    appNode: 'export type AppNode =\n' + appNodeMembers.join('\n'),
  }
}

function genBusTypes() {
  // BLOCK_PORT_TYPES inner rows. Category-divider comments live here too;
  // since the schema doesn't carry divider text we key it off `category`
  // transitions in the manifest order. Phase 0 will iterate this mapping
  // until the byte-diff is empty.
  //
  // The mapping below is the current divider text per category cluster.
  // If the manifest reorders rows or splits a category, the user updates
  // this table and re-runs codegen.
  const dividers = {
    source: '  // ─── Audio sources (8 blocks, 1 source handle each) ──────────────',
    modulation: '  // ─── Modulation / control ───────────────────────────────────────',
    filter: '  // ─── Filters ────────────────────────────────────────────────────',
    effect: '  // ─── Effects ────────────────────────────────────────────────────',
    logic: '  // ─── Logic (boolean gates + clocked counter) ───────────────────',
    routing: '  // ─── Mixing / routing ──────────────────────────────────────────',
    visual: '  // ─── Visual ────────────────────────────────────────────────────',
    bus: '  // ─── Bus (cross-width composition — Sprint 16) ─────────────────',
    computation: '  // ─── Computation / CPU primitives (Sprint 17, ADR-002) ─────────',
  }

  // Column width for handle-id key — wide enough to align the trailing
  // value column across the longest handle name in the block.
  const renderBlock = (b) => {
    const portNames = Object.keys(b.ports)
    const keyWidth = Math.max(...portNames.map((n) => `'${n}':`.length))
    const keyColumn = keyWidth + 1 // trailing space before value
    const headerKey = pad(b.type + ':', 13)
    const lines = []
    portNames.forEach((name, i) => {
      const k = pad(`'${name}':`, keyColumn)
      const v = `'${b.ports[name].bus}'`
      const first = i === 0
      const last = i === portNames.length - 1
      if (first && last) {
        // Single-port block — collapse to one line, matching the
        // hand-written style for oscillators / output / etc.
        lines.push(`  ${headerKey}{ ${k}${v} },`)
      } else if (first) {
        lines.push(`  ${headerKey}{ ${k}${v},`)
      } else {
        const indent = ' '.repeat(2 + headerKey.length + 2)
        lines.push(`${indent}${k}${v}${last ? ' },' : ','}`)
      }
    })
    return lines.join('\n')
  }

  // The manifest is PALETTE order; some categories recur (e.g. routing
  // for both Mixer and Output; modulation for the post-filter cluster).
  // Each divider is emitted only on its first occurrence so the file
  // reads as one grouped TOC rather than repeating headers. Blocks land
  // in their PALETTE-order positions regardless.
  let lastCategory = null
  const emitted = new Set()
  const out = []
  for (const b of manifest) {
    if (b.category !== lastCategory) {
      if (dividers[b.category] && !emitted.has(b.category)) {
        if (lastCategory !== null) out.push('')
        out.push(dividers[b.category])
        emitted.add(b.category)
      } else if (lastCategory !== null) {
        // Category change but no divider (already emitted) — still
        // insert a blank line between clusters so the file reads cleanly.
        out.push('')
      }
      lastCategory = b.category
    }
    out.push(renderBlock(b))
  }

  return out.join('\n')
}

function genPaletteTs() {
  // PALETTE entries — column alignment matches the current file.
  // Widths: type:24 label:21 color:11 description:rest
  const typeW = Math.max(...manifest.map((b) => `'${b.type}',`.length)) + 1
  const labelW = Math.max(...manifest.map((b) => `'${b.label}',`.length)) + 1
  const colorW = Math.max(...manifest.map((b) => `'${b.color}',`.length)) + 1
  const rows = manifest.map((b) => {
    return (
      `  { type: ${pad(`'${b.type}',`, typeW)}` +
      `label: ${pad(`'${b.label}',`, labelW)}` +
      `color: ${pad(`'${b.color}',`, colorW)}` +
      `description: '${b.description}' },`
    )
  })

  const palette =
    'export const PALETTE: PaletteEntry[] = [\n' + rows.join('\n') + '\n]'

  // defaultDataForType — group blocks with identical default-data shape.
  // Build a Map from JSON-stringified-default → list of block types.
  const groups = new Map()
  const noParamTypes = []
  for (const b of manifest) {
    if (!b.parameters || Object.keys(b.parameters).length === 0) {
      noParamTypes.push(b.type)
      continue
    }
    const dataObj = {}
    for (const [key, p] of Object.entries(b.parameters)) {
      dataObj[key] = p.default
    }
    const repr = JSON.stringify(dataObj)
    if (!groups.has(repr)) groups.set(repr, [])
    groups.get(repr).push(b.type)
  }

  const switchLines = ['  switch (type) {']
  for (const [repr, types] of groups.entries()) {
    for (const t of types) switchLines.push(`    case '${t}':`)
    const dataObj = JSON.parse(repr)
    // Render the body: array values via Array(N).fill(0), etc.
    const body = renderDefaultBody(dataObj)
    switchLines.push(`      return ${body}`)
  }
  for (const t of noParamTypes) switchLines.push(`    case '${t}':`)
  switchLines.push('    default:')
  switchLines.push('      return {}')
  switchLines.push('  }')

  const switchBody =
    'export function defaultDataForType(type: string): Record<string, unknown> {\n' +
    switchLines.join('\n') +
    '\n}'

  return { palette, defaultDataForType: switchBody }
}

function renderDefaultBody(dataObj) {
  const parts = []
  for (const [k, v] of Object.entries(dataObj)) {
    if (Array.isArray(v) && v.length === 16 && v.every((x) => x === 0)) {
      parts.push(`${k}: Array(16).fill(0)`)
    } else if (typeof v === 'string') {
      parts.push(`${k}: '${v}'`)
    } else {
      parts.push(`${k}: ${JSON.stringify(v)}`)
    }
  }
  return `{ ${parts.join(', ')} }`
}

function genAppCss() {
  // .block-<type> { border-color: <color>; min-height / min-width? } rules.
  // Category-divider comments interleave with rules; same approach as
  // genBusTypes — iterate template until byte-diff is clean.
  const renderRule = (b) => {
    const lines = [`.block-${b.type} {`, `  border-color: ${b.color};`]
    if (b.cssMinHeight != null) lines.push(`  min-height: ${b.cssMinHeight}px;`)
    if (b.cssMinWidth != null) lines.push(`  min-width: ${b.cssMinWidth}px;`)
    lines.push('}')
    return lines.join('\n')
  }
  return manifest.map(renderRule).join('\n\n')
}

function genPromptTs() {
  // Per-block structural-facts section. Format:
  //   **<type>** — <description-prose>
  //   - Input port `<id>` (<bus>)
  //   - Output port `<id>` (<bus>)
  //   - Parameter `<key>`: <min>–<max> <unit> (default <default>)
  //
  // Per Decision 2 in the Phase 0 brief, this is the only AI-prompt
  // codegen target — the rich behavioral prose stays hand-written.
  //
  // Backticks are emitted as `\\\`` because the structural section
  // lives inside the STATIC_SYSTEM template literal, so the file's
  // raw source text contains escape sequences rather than literal
  // backtick characters. The extractor reads file text, so we have
  // to emit the same escape form here for byte-equality to hold.
  const bt = '\\`'
  const blocks = manifest.map((b) => {
    const lines = [`**${b.type}** — ${b.description}`]
    const inputs = Object.entries(b.ports).filter(([, p]) => p.dir === 'target')
    const outputs = Object.entries(b.ports).filter(([, p]) => p.dir === 'source')
    if (inputs.length === 1) {
      const [name, p] = inputs[0]
      lines.push(`- Input port ${bt}${name}${bt} (${p.bus})`)
    } else if (inputs.length > 1) {
      const names = inputs.map(([n, p]) => `${bt}${n}${bt} (${p.bus})`).join(', ')
      lines.push(`- Input ports: ${names}`)
    }
    if (outputs.length === 1) {
      const [name, p] = outputs[0]
      lines.push(`- Output port ${bt}${name}${bt} (${p.bus})`)
    } else if (outputs.length > 1) {
      const names = outputs.map(([n, p]) => `${bt}${n}${bt} (${p.bus})`).join(', ')
      lines.push(`- Output ports: ${names}`)
    }
    if (b.parameters && Object.keys(b.parameters).length > 0) {
      for (const [key, p] of Object.entries(b.parameters)) {
        const range = p.min != null && p.max != null ? `${p.min}–${p.max} ` : ''
        const unit = p.unit ? `${p.unit} ` : ''
        lines.push(`- Parameter ${bt}${key}${bt}: ${range}${unit}(default ${JSON.stringify(p.default)})`)
      }
    } else {
      lines.push('- No parameters')
    }
    return lines.join('\n')
  })
  return blocks.join('\n\n')
}

// ────────────────────────────────────────────────────────────────────────────
// --check / --write driver
// ────────────────────────────────────────────────────────────────────────────

const targets = [
  {
    name: 'index.ts:imports',
    slot: 'blocks-imports',
    commentStyle: 'ts',
    path: 'frontend/src/blocks/index.ts',
    extractor: (s) => {
      // First `import { ...Node, type ...Block } from './...Node'` line through
      // the last consecutive line of that shape. The codegen pads the column
      // widths so multiple spaces appear around `type` and `from`; the regex
      // uses \s+ for those gaps.
      const lines = s.split('\n')
      const re = /^import \{ \w+Node,\s+type \w+Block \}\s+from '\.\/\w+Node'$/
      let start = -1
      let end = -1
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          if (start < 0) start = i
          end = i
        } else if (start >= 0 && end >= 0 && lines[i].trim() === '') {
          break
        }
      }
      return lines.slice(start, end + 1).join('\n')
    },
    generator: () => genIndexTs().imports,
  },
  {
    name: 'index.ts:nodeTypes',
    slot: 'node-types',
    commentStyle: 'ts',
    path: 'frontend/src/blocks/index.ts',
    extractor: (s) => {
      const m = s.match(/export const nodeTypes = \{[\s\S]*?\n\}/)
      return m ? m[0] : ''
    },
    generator: () => genIndexTs().nodeTypes,
  },
  {
    name: 'index.ts:AppNode',
    slot: 'app-node-union',
    commentStyle: 'ts',
    path: 'frontend/src/blocks/index.ts',
    extractor: (s) => {
      const m = s.match(/export type AppNode =[\s\S]*$/)
      return m ? m[0].replace(/\n$/, '') : ''
    },
    generator: () => genIndexTs().appNode,
  },
  {
    name: 'busTypes.ts:BLOCK_PORT_TYPES',
    slot: 'block-port-types',
    commentStyle: 'ts',
    path: 'frontend/src/blocks/busTypes.ts',
    extractor: (s) => {
      const m = s.match(
        /export const BLOCK_PORT_TYPES:[^=]*= \{\n([\s\S]*?)\n\}/
      )
      return m ? m[1] : ''
    },
    generator: genBusTypes,
  },
  {
    name: 'Palette.tsx:PALETTE',
    slot: 'palette-array',
    commentStyle: 'ts',
    path: 'frontend/src/Palette.tsx',
    extractor: (s) => {
      const m = s.match(/export const PALETTE: PaletteEntry\[\] = \[[\s\S]*?\n\]/)
      return m ? m[0] : ''
    },
    generator: () => genPaletteTs().palette,
  },
  {
    name: 'Palette.tsx:defaultDataForType',
    slot: 'default-data-for-type',
    commentStyle: 'ts',
    path: 'frontend/src/Palette.tsx',
    extractor: (s) => {
      const m = s.match(
        /export function defaultDataForType\(type: string\): Record<string, unknown> \{[\s\S]*?\n\}/
      )
      return m ? m[0] : ''
    },
    generator: () => genPaletteTs().defaultDataForType,
  },
  {
    name: 'App.css:.block-rules',
    slot: 'block-rules',
    commentStyle: 'css',
    path: 'frontend/src/App.css',
    extractor: (s) => {
      // Match from first .block-<type> rule (where type is in the manifest)
      // to the last consecutive .block-<type> rule.
      const types = manifest.map((b) => b.type).join('|')
      const re = new RegExp(
        `\\.block-(?:${types}) \\{[\\s\\S]*?\\n\\}(?:\\s*\\.block-(?:${types}) \\{[\\s\\S]*?\\n\\})*`
      )
      const m = s.match(re)
      return m ? m[0] : ''
    },
    generator: genAppCss,
  },
  {
    name: 'ai/prompt.ts:block-descriptions',
    slot: 'block-reference',
    commentStyle: 'html',
    path: 'frontend/src/ai/prompt.ts',
    extractor: (s) => {
      // Per Decision 2 in the Phase 0 brief, the codegen scope for the
      // AI prompt is narrowed to a single compact structural-facts
      // section. The rich behavioral prose (paragraphs, "common
      // workflows", LD-aware do/don't table) lives outside this region
      // and stays hand-written.
      //
      // The HTML-style markers (`<!-- @begin codegen block-reference -->`)
      // are kept verbatim — they were authored before the ts/css marker
      // convention and the AI consultant sees them inside the prompt's
      // template literal.
      const m = s.match(
        /<!-- @begin codegen block-reference -->\n([\s\S]*?)\n<!-- @end codegen block-reference -->/
      )
      return m ? m[1] : ''
    },
    generator: genPromptTs,
  },
]

// Combined extractor — try marker pair first, fall back to anchor regex.
// On first --write, only the anchor fires; after the markers land, every
// subsequent --check / --write uses the marker pair.
function extract(src, target) {
  const fromMarker = extractByMarkers(src, target.slot, target.commentStyle)
  if (fromMarker !== null) return fromMarker
  return target.extractor(src)
}

// ────────────────────────────────────────────────────────────────────────────
// --check / --write driver
// ────────────────────────────────────────────────────────────────────────────

// Phase 1 in-place rewrite. Two-pass: compute every replacement first,
// then commit to disk. Either every target lands or none do — leaving a
// half-written tree was the failure mode the Phase 0 brief warned about.
if (mode === 'write') {
  const fileEdits = new Map()
  let failed = false
  for (const t of targets) {
    const filePath = path.join(REPO_ROOT, t.path)
    if (!fs.existsSync(filePath)) {
      console.error(`[codegen-frontend] target missing: ${t.path}`)
      failed = true
      continue
    }
    const current = fileEdits.get(filePath) ?? fs.readFileSync(filePath, 'utf8')
    let generated
    try {
      generated = t.generator()
    } catch (err) {
      console.error(`[codegen-frontend] generator threw for ${t.name}: ${err.message}`)
      failed = true
      continue
    }
    let next
    try {
      next = applyWrite(current, t, generated)
    } catch (err) {
      console.error(err.message)
      failed = true
      continue
    }
    fileEdits.set(filePath, next)
    console.log(`write ${t.name}`)
  }
  if (failed) {
    console.error('\n[codegen-frontend] --write aborted; no files modified.')
    process.exit(1)
  }
  for (const [filePath, content] of fileEdits.entries()) {
    fs.writeFileSync(filePath, content)
  }
  console.log('\n[codegen-frontend] all targets written.')
  process.exit(0)
}

// --check mode
let divergent = 0
for (const t of targets) {
  const filePath = path.join(REPO_ROOT, t.path)
  if (!fs.existsSync(filePath)) {
    console.error(`[codegen-frontend] target missing: ${t.path}`)
    divergent++
    continue
  }
  const live = fs.readFileSync(filePath, 'utf8')
  const actual = extract(live, t)
  let expected
  try {
    expected = t.generator()
  } catch (err) {
    console.error(`[codegen-frontend] generator threw for ${t.name}: ${err.message}`)
    divergent++
    continue
  }
  if (actual === expected) {
    console.log(`ok   ${t.name}`)
  } else {
    console.log(`DIFF ${t.name}`)
    console.log(unifiedDiff(actual, expected, t.name))
    divergent++
  }
}

if (divergent > 0) {
  console.error(`\n[codegen-frontend] ${divergent} target(s) diverged from manifest.`)
  console.error('  Phase 0 gate: iterate the templates in this script until the diff is empty.')
  process.exit(1)
}
console.log('\n[codegen-frontend] all targets match.')
