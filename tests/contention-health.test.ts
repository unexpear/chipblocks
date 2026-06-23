import { describe, expect, test } from 'vitest'
import { contentionHealth, mergeHealth, type NodeHealth } from '../src/renderer/health.ts'
import type { ContentionFinding } from '../src/renderer/output-contention.ts'

const finding = (severity: 'error' | 'warning', nodeIds: string[]): ContentionFinding => ({
  severity,
  code: severity === 'error' ? 'output-contention' : 'open-collector-no-pullup',
  message: 'msg',
  pins: nodeIds.map((nodeId) => ({ nodeId, portId: 'o' })),
})

describe('contentionHealth — findings become per-block health', () => {
  test('an error marks every involved block as failed', () => {
    const h = contentionHealth([finding('error', ['a', 'b'])])
    expect(h.get('a')?.failed).toBe(true)
    expect(h.get('b')?.failed).toBe(true)
  })

  test('a warning marks blocks warned, not failed', () => {
    const h = contentionHealth([finding('warning', ['a'])])
    expect(h.get('a')?.warned).toBe(true)
    expect(h.get('a')?.failed).toBeUndefined()
  })

  test('a block caught by both an error and a warning stays failed (error wins)', () => {
    const h = contentionHealth([finding('warning', ['a']), finding('error', ['a'])])
    expect(h.get('a')?.failed).toBe(true)
  })
})

describe('mergeHealth — overlay the contention pass on the solved health', () => {
  test('an empty overlay returns the base untouched (same reference)', () => {
    const base = new Map<string, NodeHealth>([['a', { lit: true }]])
    expect(mergeHealth(base, new Map())).toBe(base)
  })

  test('the overlay adds new nodes and leaves existing ones intact', () => {
    const base = new Map<string, NodeHealth>([['a', { lit: true, glow: 'red' }]])
    const overlay = new Map<string, NodeHealth>([['b', { warned: true, note: 'bus' }]])
    const out = mergeHealth(base, overlay)
    expect(out.get('a')?.lit).toBe(true)
    expect(out.get('b')?.warned).toBe(true)
  })

  test('a hard failure wins over a warning on the same node; the notes combine', () => {
    const base = new Map<string, NodeHealth>([['a', { failed: true, note: 'over current' }]])
    const overlay = new Map<string, NodeHealth>([['a', { warned: true, note: 'bus caution' }]])
    const out = mergeHealth(base, overlay)
    expect(out.get('a')?.failed).toBe(true)
    expect(out.get('a')?.warned).toBe(false)
    expect(out.get('a')?.note).toContain('over current')
    expect(out.get('a')?.note).toContain('bus caution')
  })
})
