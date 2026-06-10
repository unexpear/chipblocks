/**
 * Clipboard tests (S19-v3-69) — desktop-style copy/cut/paste with history:
 * 15 copy slots (oldest falls off), ONE cut at a time, paste = the newest of
 * either, and materialized pastes are fully independent (fresh ids everywhere,
 * deep-copied values, block internals re-cloned).
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import {
  emptyClipboard,
  latestItem,
  MAX_COPY_SLOTS,
  materializeItem,
  snapshotSelection,
  withCopy,
  withCut,
} from '../src/renderer/clipboard.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const nodes: CanvasNodeLike[] = [
  {
    id: 'r1',
    type: 'device',
    position: { x: 100, y: 100 },
    data: {
      definition: 'resistor',
      rotation: 90,
      parameters: { resistance: scalar(470, 'ohm') },
    },
  },
  {
    id: 'led1',
    type: 'device',
    position: { x: 300, y: 100 },
    data: { definition: 'led' },
  },
  {
    id: 'bat1',
    type: 'device',
    position: { x: 100, y: 300 },
    data: { definition: 'power_source' },
  },
]
const edges: CanvasEdgeLike[] = [
  {
    id: 'w1',
    source: 'r1',
    sourceHandle: 'terminal_b',
    target: 'led1',
    targetHandle: 'anode',
    data: { waypoints: [{ id: 'wp1', x: 200, y: 80 }], curved: true },
  },
  {
    id: 'w2',
    source: 'bat1',
    sourceHandle: 'terminal_positive',
    target: 'r1',
    targetHandle: 'terminal_a',
  },
]

describe('snapshotSelection', () => {
  test('keeps selected parts and ONLY the wires fully inside the selection', () => {
    const item = snapshotSelection(nodes, edges, new Set(['r1', 'led1']))
    expect(item).not.toBeNull()
    if (item === null) return
    expect(item.nodes.map((n) => n.id).sort()).toEqual(['led1', 'r1'])
    // w2 reaches the unselected battery — it has nowhere to attach on paste.
    expect(item.edges.map((e) => e.id)).toEqual(['w1'])
    expect(item.edges[0]?.curved).toBe(true)
    expect(item.edges[0]?.waypoints?.length).toBe(1)
    expect(item.label).toBe('resistor + led')
  })

  test('nothing selected → null (no empty clipboard entries)', () => {
    expect(snapshotSelection(nodes, edges, new Set())).toBeNull()
  })

  test('the snapshot is a deep copy — editing the original later cannot change it', () => {
    const item = snapshotSelection(nodes, edges, new Set(['r1']))
    if (item === null) throw new Error('no snapshot')
    const original = nodes[0]?.data.parameters?.resistance as { value: { amount: number } }
    original.value.amount = 999
    const kept = item.nodes[0]?.parameters?.resistance as { value: { amount: number } }
    expect(kept.value.amount).toBe(470)
    original.value.amount = 470 // restore for other tests
  })
})

describe('copy history + cut slot', () => {
  const itemNamed = (label: string) => ({ label, nodes: [], edges: [] })

  test('copies stack newest-first and the 16th pushes the oldest off', () => {
    let state = emptyClipboard()
    for (let i = 1; i <= MAX_COPY_SLOTS + 1; i++) {
      state = withCopy(state, itemNamed(`copy ${i}`))
    }
    expect(state.copies.length).toBe(MAX_COPY_SLOTS)
    expect(state.copies[0]?.label).toBe('copy 16') // newest first
    expect(state.copies.at(-1)?.label).toBe('copy 2') // copy 1 fell off
  })

  test('one cut at a time — a new cut replaces the old', () => {
    let state = emptyClipboard()
    state = withCut(state, itemNamed('first cut'))
    state = withCut(state, itemNamed('second cut'))
    expect(state.cut?.label).toBe('second cut')
    expect(state.copies.length).toBe(0)
  })

  test('plain paste takes the NEWEST thing, cut or copy', () => {
    let state = emptyClipboard()
    state = withCopy(state, itemNamed('older copy'))
    state = withCut(state, itemNamed('newer cut'))
    expect(latestItem(state)?.label).toBe('newer cut')
    state = withCopy(state, itemNamed('newest copy'))
    expect(latestItem(state)?.label).toBe('newest copy')
    expect(latestItem(emptyClipboard())).toBeNull()
  })
})

describe('materializeItem', () => {
  test('fresh ids everywhere, wires re-pointed, group centered on the target', () => {
    const item = snapshotSelection(nodes, edges, new Set(['r1', 'led1']))
    if (item === null) throw new Error('no snapshot')
    const out = materializeItem({ ...item, stamp: 1 }, 'p7', { x: 500, y: 400 })

    expect(out.nodes.map((n) => n.id).sort()).toEqual(['led1_p7', 'r1_p7'])
    expect(out.edges[0]?.source).toBe('r1_p7')
    expect(out.edges[0]?.target).toBe('led1_p7')
    expect(out.edges[0]?.id).not.toBe('w1')
    // Original bbox center was (200, 100) → everything shifts by (+300, +300).
    expect(out.nodes.find((n) => n.id === 'r1_p7')?.position).toEqual({ x: 400, y: 400 })
    expect(out.nodes.find((n) => n.id === 'led1_p7')?.position).toEqual({ x: 600, y: 400 })
    // Waypoints travel with the group (and get fresh ids).
    const wp = (out.edges[0]?.data?.waypoints as { id: string; x: number; y: number }[])[0]
    expect(wp).toMatchObject({ x: 500, y: 380 })
    expect(wp?.id).not.toBe('wp1')
    // Pasted parts arrive selected, ready to drag as a group.
    expect(out.nodes.every((n) => n.selected === true)).toBe(true)
    // Values are kept (and rotation).
    const r = out.nodes.find((n) => n.id === 'r1_p7')
    expect(r?.data.rotation).toBe(90)
    expect((r?.data.parameters?.resistance as { value: { amount: number } }).value.amount).toBe(470)
  })

  test('a copied BLOCK pastes with re-cloned internals (fresh inner ids too)', () => {
    const blockNode: CanvasNodeLike = {
      id: 'block_1',
      type: 'block',
      position: { x: 50, y: 50 },
      data: {
        definition: 'block',
        label: 'NOT gate',
        block: {
          name: 'NOT gate',
          origin: { x: 50, y: 50 },
          nodes: [{ id: 'mn1', definition: 'transistor_mosfet_nmos', x: 0, y: 0 }],
          edges: [],
          ports: [],
        },
      },
    }
    const item = snapshotSelection([blockNode], [], new Set(['block_1']))
    if (item === null) throw new Error('no snapshot')
    const out = materializeItem({ ...item, stamp: 1 }, '9', { x: 50, y: 50 })
    const pasted = out.nodes[0]
    expect(pasted?.id).toBe('block_1_9')
    expect(pasted?.data.block?.nodes[0]?.id).toBe('mn1_9')
    expect(item.nodes[0]?.block?.nodes[0]?.id).toBe('mn1') // clipboard copy untouched
  })

  test('pasting the same item twice yields two independent groups', () => {
    const item = snapshotSelection(nodes, edges, new Set(['r1']))
    if (item === null) throw new Error('no snapshot')
    const a = materializeItem({ ...item, stamp: 1 }, 'a', { x: 0, y: 0 })
    const b = materializeItem({ ...item, stamp: 1 }, 'b', { x: 50, y: 50 })
    expect(a.nodes[0]?.id).not.toBe(b.nodes[0]?.id)
    const pa = a.nodes[0]?.data.parameters as { resistance: { value: { amount: number } } }
    pa.resistance.value.amount = 1
    const pb = b.nodes[0]?.data.parameters as { resistance: { value: { amount: number } } }
    expect(pb.resistance.value.amount).toBe(470)
  })
})
