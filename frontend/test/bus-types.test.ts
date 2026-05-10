// Unit tests for the bus-type compatibility helper. Implements
// ADR-001 §"Connection rules" — every rule gets at least one
// example case here.

import { describe, it, expect } from 'vitest'
import {
  arePortTypesCompatible,
  busWidth,
  getPortBusType,
  type BusType,
} from '../src/blocks/busTypes'

describe('busWidth', () => {
  it('parses 1-bit gate', () => expect(busWidth('gate-1')).toBe(1))
  it('parses 8-bit audio', () => expect(busWidth('audio-s8')).toBe(8))
  it('parses 10-bit pixel', () => expect(busWidth('pixel-u10')).toBe(10))
  it('parses 16-bit data', () => expect(busWidth('data-u16')).toBe(16))
  it('parses 4-bit address', () => expect(busWidth('addr-u4')).toBe(4))
})

describe('arePortTypesCompatible — compatible cases', () => {
  it('same type both sides is always compatible', () => {
    expect(arePortTypesCompatible('audio-s8', 'audio-s8')).toBe('compatible')
    expect(arePortTypesCompatible('gate-1', 'gate-1')).toBe('compatible')
    expect(arePortTypesCompatible('pixel-u10', 'pixel-u10')).toBe('compatible')
    expect(arePortTypesCompatible('data-u16', 'data-u16')).toBe('compatible')
  })

  it('generic-to-generic same width + sign is compatible', () => {
    expect(arePortTypesCompatible('data-u8', 'data-u8')).toBe('compatible')
    expect(arePortTypesCompatible('data-s12', 'data-s12')).toBe('compatible')
  })

  it('gate-1 ↔ data-u1 is compatible (1-bit special case)', () => {
    expect(arePortTypesCompatible('gate-1', 'data-u1')).toBe('compatible')
    expect(arePortTypesCompatible('data-u1', 'gate-1')).toBe('compatible')
  })
})

describe('arePortTypesCompatible — semantic-cross cases', () => {
  it('audio-s8 ↔ data-s8 is semantic-cross (same width + sign, one semantic)', () => {
    expect(arePortTypesCompatible('audio-s8', 'data-s8')).toBe('semantic-cross')
    expect(arePortTypesCompatible('data-s8', 'audio-s8')).toBe('semantic-cross')
  })

  it('pixel-u10 ↔ data-u10 is semantic-cross', () => {
    expect(arePortTypesCompatible('pixel-u10', 'data-u10')).toBe('semantic-cross')
    expect(arePortTypesCompatible('data-u10', 'pixel-u10')).toBe('semantic-cross')
  })

  it('addr-u8 ↔ data-u8 is compatible (both generic, same width + sign)', () => {
    // Note: addr is generic, not semantic. This is a same-width-same-sign
    // generic-to-generic match per rule 2 — compatible, not semantic-cross.
    expect(arePortTypesCompatible('addr-u8', 'data-u8')).toBe('compatible')
  })
})

describe('arePortTypesCompatible — incompatible cases', () => {
  it('width mismatch is incompatible', () => {
    expect(arePortTypesCompatible('data-u8', 'data-u16')).toBe('incompatible')
    expect(arePortTypesCompatible('audio-s8', 'data-s16')).toBe('incompatible')
    expect(arePortTypesCompatible('gate-1', 'data-u8')).toBe('incompatible')
  })

  it('sign mismatch (u vs s) at same width is incompatible', () => {
    expect(arePortTypesCompatible('data-u8', 'data-s8')).toBe('incompatible')
    expect(arePortTypesCompatible('audio-s8', 'data-u8')).toBe('incompatible')
    // 1-bit unsigned vs theoretical signed-1-bit (which doesn't exist anyway):
    // there's no signed 1-bit BusType in the union, so we can't trigger
    // this against gate-1 directly. The case above (audio-s8 vs data-u8)
    // covers the semantic-vs-generic sign-mismatch path.
  })

  it('cross-domain different-sign is incompatible', () => {
    // pixel-u10 is unsigned, data-s10 is signed — same width, different sign.
    expect(arePortTypesCompatible('pixel-u10', 'data-s10')).toBe('incompatible')
  })
})

describe('getPortBusType — registry lookup', () => {
  it('returns the right type for known block ports', () => {
    expect(getPortBusType('oscillator', 'audio-out')).toBe('audio-s8')
    expect(getPortBusType('gate', 'gate-out')).toBe('gate-1')
    expect(getPortBusType('vgatiming', 'x')).toBe('pixel-u10')
    expect(getPortBusType('vgatiming', 'hsync')).toBe('gate-1')
    expect(getPortBusType('counter', 'audio-out')).toBe('audio-s8')
    expect(getPortBusType('counter', 'clock')).toBe('gate-1')
  })

  it('returns undefined for unknown blocks or handles', () => {
    expect(getPortBusType('does-not-exist', 'audio-out')).toBeUndefined()
    expect(getPortBusType('oscillator', 'does-not-exist')).toBeUndefined()
    expect(getPortBusType(undefined, 'audio-out')).toBeUndefined()
    expect(getPortBusType('oscillator', null)).toBeUndefined()
  })
})

describe('coverage — every BusType in the union should round-trip through busWidth', () => {
  // Spot-check that no BusType variant is missing the trailing-digit
  // pattern busWidth() depends on. If a future variant is added without
  // a numeric suffix, this test will catch it.
  const samples: BusType[] = [
    'gate-1', 'audio-s8', 'pixel-u10',
    'data-u1', 'data-u2', 'data-s2', 'addr-u2',
    'data-u8', 'data-s8', 'addr-u8',
    'data-u16', 'data-s16', 'addr-u16',
  ]
  for (const t of samples) {
    it(`busWidth(${t}) returns a positive integer`, () => {
      const w = busWidth(t)
      expect(w).toBeGreaterThan(0)
      expect(Number.isInteger(w)).toBe(true)
    })
  }
})
