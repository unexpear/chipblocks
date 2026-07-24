/**
 * CATALOG PARTS made placeable — the commercial devices from the fixture catalog, dropped on a board.
 *
 * The point of these: a catalog part must behave like any other placeable part (resolve for drawing,
 * land on its footprint, route by pin→pad) WITHOUT becoming a "user part" — it must never be written
 * into a project save file, because it ships in the app. That separation is the whole design.
 */

import { afterEach, describe, expect, test } from 'vitest'
import { CATALOG_PARTS, registerCatalogParts } from '../src/renderer/catalog-parts.ts'
import { serializeCircuit } from '../src/renderer/circuit-file.ts'
import { footprintForPart, padForTerminal } from '../src/renderer/footprint-assignment.ts'
import { resolveFootprint } from '../src/renderer/user-footprints.ts'
import {
  allUserParts,
  getUserPart,
  getUserPartsSnapshot,
  registerUserPart,
  resolveUserPart,
  setUserParts,
} from '../src/renderer/user-parts.ts'

registerCatalogParts()
afterEach(() => setUserParts([])) // clear the authored registry between tests; built-ins persist

describe('a catalog part is placeable and resolves like any other', () => {
  test('every catalog part resolves and lands on a real footprint that fits its pins', () => {
    for (const part of CATALOG_PARTS) {
      expect(resolveUserPart(part.id)?.name).toBe(part.name)
      expect(part.footprintId).toBeDefined()
      const fp = resolveFootprint(part.footprintId as string)
      expect(fp, `${part.id} footprint`).toBeDefined()
      // the package must have room for every pin
      expect((fp?.pads.length ?? 0) >= part.pins.length).toBe(true)
      // and footprintForPart resolves the same package
      expect(footprintForPart(part.id)?.id).toBe(part.footprintId)
    }
  })

  test('each pin lands on the pad it names — the regulator VIN → pad 1, VOUT → pad 5', () => {
    const reg = CATALOG_PARTS.find((p) => p.id === 'catalog_ap2112k_33')
    expect(reg).toBeDefined()
    if (!reg) return
    for (const pin of reg.pins) {
      expect(pin.pad, `${pin.name} needs a pad`).toBeDefined()
      expect(padForTerminal(reg.id, pin.id)).toBe(pin.pad)
    }
    // spot-check the two that matter: input and output diagonally opposite
    expect(padForTerminal(reg.id, 'vin')).toBe('1')
    expect(padForTerminal(reg.id, 'vout')).toBe('5')
  })

  test('it shows up in the palette snapshot', () => {
    const ids = getUserPartsSnapshot().map((p) => p.id)
    for (const part of CATALOG_PARTS) expect(ids).toContain(part.id)
  })
})

describe('a catalog part is NOT a user part', () => {
  test('it is invisible to the authoring/save paths', () => {
    for (const part of CATALOG_PARTS) {
      expect(getUserPart(part.id)).toBeUndefined() // registry-only lookup does not see it
      expect(allUserParts().some((p) => p.id === part.id)).toBe(false)
    }
  })

  test('a user cannot author over a catalog id', () => {
    const clash = { ...(CATALOG_PARTS[0] as (typeof CATALOG_PARTS)[number]), name: 'impostor' }
    expect(registerUserPart(clash)).toBe(false) // reserved
    expect(resolveUserPart(clash.id)?.name).not.toBe('impostor')
  })

  test('placing a catalog part does NOT write it into the project file', () => {
    // A node using a catalog definition, saved with the whole registry as the userParts arg — the way
    // App saves. The catalog part must be skipped (it resolves from the app, like a built-in footprint).
    const node = [
      { id: 'U1', position: { x: 0, y: 0 }, data: { definition: 'catalog_ap2112k_33' } },
    ]
    const saved = serializeCircuit(
      node,
      [],
      undefined, // projectAmbientC
      undefined, // sheet
      undefined, // placements
      allUserParts(), // userParts — registry-only, never contains a catalog part
    )
    expect(saved.userParts).toBeUndefined()
  })
})
