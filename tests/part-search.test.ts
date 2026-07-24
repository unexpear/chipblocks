/**
 * The part-picker fuzzy search. The behaviours that make it feel like a real command palette: a query
 * matches when its letters appear in order, matches are RANKED sensibly (exact > prefix > initials >
 * scattered), a hit on hidden keywords still finds the part, and the matched positions come back so the
 * UI can bold them.
 */

import { describe, expect, test } from 'vitest'
import { fuzzyScore, type SearchItem, searchParts } from '../src/renderer/part-search.ts'

describe('fuzzyScore — subsequence matching', () => {
  test('matches a subsequence, rejects a non-subsequence', () => {
    expect(fuzzyScore('np', 'NPN')).not.toBeNull()
    expect(fuzzyScore('hadd', 'Half Adder')).not.toBeNull() // word-initial acronym
    expect(fuzzyScore('xyz', 'Resistor')).toBeNull()
    expect(fuzzyScore('nnn', 'NPN')).toBeNull() // only two n's
  })

  test('an empty query matches everything with no highlight', () => {
    expect(fuzzyScore('', 'anything')).toEqual({ score: 0, positions: [] })
  })

  test('returns the matched positions, for highlighting', () => {
    expect(fuzzyScore('np', 'NPN')?.positions).toEqual([0, 1])
    // "add" in "Half Adder": the A of Adder (5), d (6), d (7)
    expect(fuzzyScore('add', 'Half Adder')?.positions).toEqual([5, 6, 7])
  })

  test('exact beats prefix beats word-initial beats scattered', () => {
    const exact = fuzzyScore('and', 'AND')?.score ?? 0
    const prefix = fuzzyScore('and', 'ANDgate')?.score ?? 0
    const scattered = fuzzyScore('and', 'a night dog')?.score ?? -1 // a…n…d across words
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(scattered)
  })

  test('a contiguous run outranks the same letters scattered', () => {
    const contiguous = fuzzyScore('mos', 'MOSFET')?.score ?? 0
    const scattered = fuzzyScore('mos', 'mouse')?.score ?? -1 // m-o-…-s across a gap
    expect(contiguous).toBeGreaterThan(scattered)
  })
})

describe('searchParts — ranking a list', () => {
  const items: SearchItem[] = [
    {
      definition: 'transistor_bjt_npn',
      label: 'NPN',
      haystack: 'transistor_bjt_npn transistors bipolar',
    },
    {
      definition: 'transistor_mosfet_nmos',
      label: 'NMOS',
      haystack: 'transistor_mosfet_nmos transistors mosfet fet',
    },
    { definition: 'logic_nand', label: 'NAND', haystack: 'logic_nand logic gates' },
    { definition: 'resistor', label: 'Resistor', haystack: 'resistor passives' },
  ]

  test('a label hit is preferred over a hidden-keyword hit', () => {
    // "nmos" hits the NMOS label exactly; it also appears in NMOS's haystack. It must win.
    const r = searchParts('nmos', items)
    expect(r[0]?.definition).toBe('transistor_mosfet_nmos')
    expect(r[0]?.highlight.length).toBeGreaterThan(0) // highlighted, because it hit the label
  })

  test('a keyword-only hit still finds the part, without a highlight', () => {
    // "mosfet" is nowhere in the NMOS label — only its haystack. It should still be found.
    const r = searchParts('mosfet', items)
    expect(r.map((x) => x.definition)).toContain('transistor_mosfet_nmos')
    const nmos = r.find((x) => x.definition === 'transistor_mosfet_nmos')
    expect(nmos?.highlight).toEqual([]) // no label highlight — the match was in the haystack
  })

  test('non-matches are dropped', () => {
    expect(searchParts('zzzz', items)).toEqual([])
  })

  test('ties keep input order (a stable sort preserves the category ordering)', () => {
    // both NPN and NAND start with "N"; equal-ish label prefix — the one listed first stays first
    const r = searchParts('n', items).map((x) => x.definition)
    expect(r.indexOf('transistor_bjt_npn')).toBeLessThan(r.indexOf('logic_nand'))
  })
})
