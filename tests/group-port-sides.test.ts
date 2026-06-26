/**
 * Attachment-points-as-pins (auto-wirer overhaul, piece 1): when a selection is grouped into a reusable
 * block, its pins spread across ALL FOUR edges by where each part sits in the selection — the nearest
 * edge of the bounding box — instead of cramming onto left/right. Cleaner attachment points for both
 * manual wiring and the auto-router; users can still drag any pin to another edge afterwards.
 */

import { describe, expect, test } from 'vitest'
import {
  type BlockData,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  groupSelection,
} from '../src/renderer/blocks.ts'

const node = (id: string, x: number, y: number): CanvasNodeLike => ({
  id,
  position: { x, y },
  data: { definition: 'resistor' },
})
const wire = (id: string, s: string, t: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: 'p',
  target: t,
  targetHandle: 'p',
})

describe('groupSelection spreads ports across all four edges', () => {
  test('each pin lands on the bounding-box edge nearest its part', () => {
    const nodes: CanvasNodeLike[] = [
      node('L', 0, 100), // left of center
      node('R', 200, 100), // right
      node('T', 100, 0), // top
      node('B', 100, 200), // bottom
      node('oL', -300, 100),
      node('oR', 500, 100),
      node('oT', 100, -300),
      node('oB', 100, 500),
    ]
    const edges: CanvasEdgeLike[] = [
      wire('eL', 'L', 'oL'),
      wire('eR', 'R', 'oR'),
      wire('eT', 'T', 'oT'),
      wire('eB', 'B', 'oB'),
    ]
    const result = groupSelection(nodes, edges, new Set(['L', 'R', 'T', 'B']), 'BLK', 'Quad')
    expect('reason' in result).toBe(false)
    if ('reason' in result) return
    const block = (
      result.nodes.find((n) => n.id === 'BLK')?.data as { block?: BlockData } | undefined
    )?.block
    expect(block).toBeDefined()
    const sideOf = (innerNodeId: string) =>
      block?.ports.find((p) => p.inner.nodeId === innerNodeId)?.side
    expect(sideOf('L')).toBe('left')
    expect(sideOf('R')).toBe('right')
    expect(sideOf('T')).toBe('top')
    expect(sideOf('B')).toBe('bottom')
    expect(new Set(block?.ports.map((p) => p.side)).size).toBe(4) // all four edges used, not crammed on two
  })
})
