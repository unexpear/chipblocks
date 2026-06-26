/**
 * blockPortAliases resolves a block's external port to the REAL flattened terminal — descending through
 * nested sub-blocks. A direct gate (NAND, whose `out` maps straight to a MOSFET) resolves one level; a
 * nested composite (AND = NAND + inverter) must resolve all the way to the inverter's transistor, so the
 * meter / logic + behaviour readback can show its output (the previous one-level alias stopped short).
 */

import { describe, expect, test } from 'vitest'
import { blockPortAliases, type CanvasNodeLike } from '../src/renderer/blocks.ts'
import { AND_BLOCK, NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'

const node = (id: string, block: typeof AND_BLOCK): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'block', block },
})

describe('blockPortAliases — resolves nested composite ports to the real terminal', () => {
  test('a DIRECT gate (NAND, out → a real MOSFET) resolves one level', () => {
    const aliases = blockPortAliases([node('g', NAND2_BLOCK)])
    expect(aliases.find((a) => a.outer === 'g/out')?.inner).toBe('g.p_a/drain')
  })

  test('a NESTED composite (AND = NAND + inverter) resolves all the way down', () => {
    const aliases = blockPortAliases([node('g', AND_BLOCK)])
    // AND.out → inverter sub-block → its pmos drain. Before the fix this stopped at 'g.inv/out',
    // which is not a real terminal, so the output never read back.
    expect(aliases.find((a) => a.outer === 'g/out')?.inner).toBe('g.inv.pmos/drain')
  })
})
