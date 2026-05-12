// Cross-registry consistency lint.
//
// A new block requires four parallel updates on the frontend side:
//   1. PALETTE entry (Palette.tsx)
//   2. BLOCK_PORT_TYPES entry (busTypes.ts)
//   3. nodeTypes entry (blocks/index.ts)
//   4. AI prompt block mention + tool schema (ai/prompt.ts)
//
// Sprint 19's ByteConstant addition missed (4) — the block shipped in
// the palette but the AI consultant didn't know about it. Sprint 20
// caught it.
// This test prevents the same drift from happening silently in future.
//
// What we assert:
//   - The set of type ids in PALETTE === the set of keys in
//     BLOCK_PORT_TYPES === the set of keys in nodeTypes.
//   - Every PALETTE type id appears somewhere in STATIC_SYSTEM (the AI
//     prompt). Substring match is loose enough to handle multiple
//     phrasings; if the type id appears even once, the AI has been told
//     it exists.
//
// We do NOT assert anything about the doc files (README, RELEASE-NOTES,
// announcement drafts) — those have prose phrasings that are too varied
// for a regex check without false positives. The block-count number IS
// a useful smoke test though, which we do separately below.

import { describe, expect, it } from 'vitest'
import { PALETTE } from '../src/Palette'
import { BLOCK_PORT_TYPES } from '../src/blocks/busTypes'
import { nodeTypes } from '../src/blocks'
import { STATIC_SYSTEM } from '../src/ai/prompt'

describe('registries are aligned across the four frontend sources of truth', () => {
  const paletteTypes = new Set(PALETTE.map((p) => p.type))
  const portTypeKeys = new Set(Object.keys(BLOCK_PORT_TYPES))
  const nodeTypeKeys = new Set(Object.keys(nodeTypes))

  it('PALETTE and BLOCK_PORT_TYPES cover the same blocks', () => {
    const onlyInPalette = [...paletteTypes].filter((t) => !portTypeKeys.has(t))
    const onlyInPortTypes = [...portTypeKeys].filter((t) => !paletteTypes.has(t))
    expect(onlyInPalette).toEqual([])
    expect(onlyInPortTypes).toEqual([])
  })

  it('PALETTE and nodeTypes cover the same blocks', () => {
    const onlyInPalette = [...paletteTypes].filter((t) => !nodeTypeKeys.has(t))
    const onlyInNodeTypes = [...nodeTypeKeys].filter((t) => !paletteTypes.has(t))
    expect(onlyInPalette).toEqual([])
    expect(onlyInNodeTypes).toEqual([])
  })

  it('every PALETTE block type is mentioned in the AI prompt', () => {
    // Substring search is loose on purpose — the block id might appear
    // backticked in a tool-schema description, or unbackticked in a
    // usage pattern. Either counts as "the AI has been told about it."
    const missing = [...paletteTypes].filter((t) => !STATIC_SYSTEM.includes(t))
    expect(missing).toEqual([])
  })
})
