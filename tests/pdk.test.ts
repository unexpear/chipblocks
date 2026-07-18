/**
 * The technology / PDK model (chip-physical chapter, increment 1). Pins the SKY130 layer map to its REAL
 * GDSII numbers — these are the export contract, the numbers that make a .gds we emit open correctly in
 * Magic / KLayout / OpenROAD — and enforces the SKY130 datatype convention + the anti-placeholder rule
 * (every layer + rule cited). A drift in a layer number silently corrupts every exported layout.
 */
import { describe, expect, test } from 'vitest'
import {
  type DesignRule,
  GDS_PURPOSE,
  gdsOf,
  layerAtGds,
  pdkLayer,
  ruleFor,
  SKY130_CORE_RULES,
  SKY130_LAYERS,
  SKY130_LAYERS_PROVENANCE,
} from '../src/renderer/pdk.ts'

describe('SKY130 layer map — the real GDSII numbers (the export contract)', () => {
  test('every layer carries its exact SKY130 GDS layer/datatype', () => {
    const expected: Record<string, [number, number]> = {
      nwell: [64, 20],
      diff: [65, 20],
      poly: [66, 20],
      licon1: [66, 44],
      li1: [67, 20],
      mcon: [67, 44],
      met1: [68, 20],
      via: [68, 44],
      met2: [69, 20],
      via2: [69, 44],
    }
    for (const [name, [layer, datatype]] of Object.entries(expected)) {
      expect(gdsOf(name), name).toEqual({ layer, datatype })
    }
    // the map holds EXACTLY these layers (no phantom extras)
    expect(new Set(SKY130_LAYERS.map((l) => l.name))).toEqual(new Set(Object.keys(expected)))
  })

  test('the datatype convention: drawing = 20, cut/via = 44; a via reuses the metal-below layer number', () => {
    expect(GDS_PURPOSE.drawing).toBe(20)
    expect(GDS_PURPOSE.cut).toBe(44)
    // met1 = 68/20 → via1 sits above it as 68/44 (same layer number, cut datatype); met2 69/20 → via2 69/44
    expect(gdsOf('via')).toEqual({ layer: gdsOf('met1')?.layer, datatype: 44 })
    expect(gdsOf('via2')).toEqual({ layer: gdsOf('met2')?.layer, datatype: 44 })
    // every metal is a drawing layer, every via/contact is a cut layer
    for (const l of SKY130_LAYERS) {
      if (
        l.kind === 'metal' ||
        l.kind === 'well' ||
        l.kind === 'diffusion' ||
        l.kind === 'poly' ||
        l.kind === 'local_interconnect'
      ) {
        expect(l.gds.datatype, l.name).toBe(20)
      }
      if (l.kind === 'via' || l.kind === 'contact') expect(l.gds.datatype, l.name).toBe(44)
    }
  })

  test('name ↔ GDS round-trips, and unknown / prototype-member names are safe (undefined, no crash)', () => {
    for (const l of SKY130_LAYERS) {
      expect(layerAtGds(l.gds.layer, l.gds.datatype)?.name).toBe(l.name)
      expect(pdkLayer(l.name)).toBe(l)
    }
    // a Map-backed lookup: an unknown name, and a prototype member, both return undefined (not the Object ctor)
    for (const bad of ['not_a_layer', 'constructor', '__proto__', 'toString']) {
      expect(pdkLayer(bad)).toBeUndefined()
      expect(gdsOf(bad)).toBeUndefined()
    }
    expect(layerAtGds(999, 999)).toBeUndefined()
  })

  test('every layer is cited-able and described (the anti-placeholder rule)', () => {
    for (const l of SKY130_LAYERS) {
      expect(l.description.length, l.name).toBeGreaterThan(0)
    }
    expect(SKY130_LAYERS_PROVENANCE.confidence).toBe('high')
    expect(SKY130_LAYERS_PROVENANCE.citation).toContain('68/20') // the real met1 number is in the citation
    expect(SKY130_LAYERS_PROVENANCE.url).toContain('skywater')
  })
})

describe('SKY130 core design rules', () => {
  test('the confirmed core rules read back by layer + kind, all positive and cited', () => {
    expect(ruleFor('poly', 'min_width')).toBe(0.15)
    expect(ruleFor('met1', 'min_width')).toBe(0.14)
    expect(ruleFor('li1', 'min_spacing')).toBe(0.17)
    expect(ruleFor('nwell', 'min_width')).toBe(0.84)
    for (const r of SKY130_CORE_RULES as DesignRule[]) {
      expect(r.valueUm, r.layer).toBeGreaterThan(0)
      expect(r.provenance.confidence).toBe('high')
      expect(r.provenance.citation.length).toBeGreaterThan(10)
      // a rule only ever references a real PDK layer
      expect(pdkLayer(r.layer), r.layer).toBeDefined()
    }
  })

  test('a rule not in the confirmed core reads undefined (honest — not a faked value)', () => {
    expect(ruleFor('poly', 'min_spacing')).toBeUndefined() // comes with the full DRC-increment deck
    expect(ruleFor('made_up_layer', 'min_width')).toBeUndefined()
  })
})
