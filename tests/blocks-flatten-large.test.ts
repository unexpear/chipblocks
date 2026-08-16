/**
 * Flattening a design big enough to be a real chip.
 *
 * `flattenBlocks` appended each recursion's result with `push(...expanded.nodes)`, which passes every element
 * as a separate argument. Measured in the running app: a flattened Intel 8080 (10,068 gates → 54,716 parts
 * and 136,783 wires once expanded) threw "Maximum call stack size exceeded" and the editor fell back to its
 * error page, while a 3,525-gate design (28,662 parts / 71,648 wires) flattened fine. The threshold is the
 * engine's argument limit, not anything about the design — measured at ~125,000 in this Node/V8.
 */

import { describe, expect, test } from 'vitest'
import {
  type BlockData,
  type BlockInnerEdge,
  type BlockInnerNode,
  type CanvasNodeLike,
  flattenBlocks,
} from '../src/renderer/blocks.ts'

const PARTS = 150_000

describe('flattenBlocks over a design past the argument limit', () => {
  test('every nested part and wire comes back, none lost to a stack overflow', () => {
    const parts: BlockInnerNode[] = Array.from({ length: PARTS }, (_, i) => ({
      id: `r${i}`,
      definition: 'resistor',
      x: i,
      y: 0,
    }))
    const wires: BlockInnerEdge[] = Array.from({ length: PARTS - 1 }, (_, i) => ({
      id: `w${i}`,
      source: `r${i}`,
      sourceHandle: 'b',
      target: `r${i + 1}`,
      targetHandle: 'a',
    }))
    const inner: BlockData = {
      name: 'chain',
      origin: { x: 0, y: 0 },
      nodes: parts,
      edges: wires,
      ports: [{ id: 'p', label: 'p', side: 'left', inner: { nodeId: 'r0', handleId: 'a' } }],
    }
    const outer: BlockData = {
      name: 'wrapper',
      origin: { x: 0, y: 0 },
      nodes: [{ id: 'chain', definition: 'block', x: 0, y: 0, block: inner }],
      edges: [],
      ports: [{ id: 'p', label: 'p', side: 'left', inner: { nodeId: 'chain', handleId: 'p' } }],
    }
    const canvas: CanvasNodeLike[] = [
      { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block: outer } },
    ]
    const flat = flattenBlocks(canvas, [])
    expect(flat.nodes.length).toBe(PARTS)
    expect(flat.edges.length).toBe(PARTS - 1)
    // The outer port must still chain through both levels to the real resistor terminal.
    expect(flat.portTarget.get('M/p')).toEqual({ nodeId: 'M.chain.r0', handleId: 'a' })
  })
})
