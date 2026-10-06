/**
 * USER-AUTHORED FOOTPRINTS — the "author a footprint" half of the two-way footprint model.
 *
 * Until now a footprint could only be one of the 15 hand-written `BUILTIN_FOOTPRINTS` constants: you could
 * PICK a package but never make one, so any part whose package wasn't already in the library (a QFN, a
 * QFP, a connector) simply could not go on a board — not by you, and not by the app without a code edit.
 * This is the registry that fixes that: footprints authored in the app live here, and every consumer
 * resolves an id through `resolveFootprint` — authored first, then community packs, then built-ins.
 *
 * It deliberately mirrors user-parts.ts (same store shape, same subscribe/snapshot pair for React, same
 * refuse-to-shadow rule) so the two authoring paths behave identically. A user footprint may NOT take a
 * built-in's id: the built-in library is cited, shared, and referenced by the shipped parts, so shadowing
 * one would silently re-shape a part that other projects rely on.
 */

import {
  BUILTIN_FOOTPRINTS,
  type Footprint,
  parseProvisionalFootprintId,
  provisionalLand,
} from './footprint.ts'

const registry = new Map<string, Footprint>()

// COMMUNITY pack footprints — installed content-manager packs (OBJECT-MODEL.md §5 / community origin).
// Kept separate from the authored registry so a pack never lands in the user-footprint save path and
// never shadows a cited built-in or a provisional_<N>pad id. Resolution: authored → community → builtin.
const communityFootprints = new Map<string, Footprint>()
/** footprint id → pack id that contributed it (so one pack can be cleared without touching others). */
const communityOwners = new Map<string, string>()

// A stable snapshot: rebuilt only on mutation, so useSyncExternalStore never sees a new array per render.
let snapshot: Footprint[] = []
const listeners = new Set<() => void>()
function publish(): void {
  snapshot = [...communityFootprints.values(), ...registry.values()]
  for (const listener of listeners) listener()
}

/** Subscribe to registry changes (returns an unsubscribe). Pairs with getUserFootprintsSnapshot. */
export function subscribeUserFootprints(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The current user footprints as a STABLE reference (unchanged until the next mutation) — for React. */
export function getUserFootprintsSnapshot(): readonly Footprint[] {
  return snapshot
}

/** Is this id one of the shipped, cited built-in footprints? (The authoring UI checks a proposed id.) */
export function isBuiltinFootprintId(id: string): boolean {
  return Object.hasOwn(BUILTIN_FOOTPRINTS, id)
}

/**
 * Built-in ids and `provisional_<N>pad` are reserved. A user footprint must not take either:
 * shadowing a built-in would re-shape a cited package, and shadowing a provisional id would
 * drop the honesty flag the BOM and the validation report print.
 */
function reservedFootprintReason(id: string): string | undefined {
  if (isBuiltinFootprintId(id)) return 'that id belongs to a built-in footprint'
  if (parseProvisionalFootprintId(id) !== undefined) {
    return 'provisional lands stay generated and labeled provisional'
  }
  return undefined
}

/** Register an authored footprint. Refuses (and warns) a reserved id — returns success. */
export function registerUserFootprint(footprint: Footprint): boolean {
  const reserved = reservedFootprintReason(footprint.id)
  if (reserved !== undefined) {
    console.warn(`[user-footprints] refusing "${footprint.id}": ${reserved}`)
    return false
  }
  registry.set(footprint.id, footprint)
  publish()
  return true
}

export function getUserFootprint(id: string): Footprint | undefined {
  return registry.get(id)
}

export function isUserFootprint(id: string): boolean {
  return registry.has(id)
}

export function allUserFootprints(): Footprint[] {
  return [...registry.values()]
}

/** Replace the whole registry (a project load / editor commit sets the full set at once). */
export function setUserFootprints(footprints: readonly Footprint[]): void {
  registry.clear()
  for (const fp of footprints) {
    const reserved = reservedFootprintReason(fp.id)
    if (reserved !== undefined) {
      console.warn(`[user-footprints] skipping "${fp.id}": ${reserved}`)
      continue
    }
    registry.set(fp.id, fp)
  }
  publish()
}

/**
 * Add footprints WITHOUT clobbering (a project loading its footprints into a session that may already hold
 * another tab's): an id already registered is KEPT, so a loaded project can never silently re-shape a
 * package another open board is placing. Built-in and provisional ids are skipped. Returns how many
 * were newly added.
 */
export function mergeUserFootprints(footprints: readonly Footprint[]): number {
  let added = 0
  for (const fp of footprints) {
    if (registry.has(fp.id) || reservedFootprintReason(fp.id) !== undefined) continue
    registry.set(fp.id, fp)
    added++
  }
  if (added > 0) publish()
  return added
}

/**
 * Replace one pack contribution in the community footprint registry. Skips reserved built-in /
 * provisional ids and ids already authored in the user registry (user_local wins). Returns how many
 * footprints are now owned by this pack after the swap.
 */
export function setCommunityPackFootprints(
  packId: string,
  footprints: readonly Footprint[],
): number {
  for (const [id, owner] of [...communityOwners.entries()]) {
    if (owner === packId) {
      communityOwners.delete(id)
      communityFootprints.delete(id)
    }
  }
  let kept = 0
  for (const fp of footprints) {
    if (reservedFootprintReason(fp.id) !== undefined || registry.has(fp.id)) continue
    const existingOwner = communityOwners.get(fp.id)
    if (existingOwner !== undefined && existingOwner !== packId) continue
    communityFootprints.set(fp.id, fp)
    communityOwners.set(fp.id, packId)
    kept++
  }
  publish()
  return kept
}

/** Drop every footprint owned by one pack (disable / uninstall). */
export function clearCommunityPackFootprints(packId: string): void {
  let changed = false
  for (const [id, owner] of [...communityOwners.entries()]) {
    if (owner !== packId) continue
    communityOwners.delete(id)
    communityFootprints.delete(id)
    changed = true
  }
  if (changed) publish()
}

/** Drop all community pack footprints (tests / full reload). */
export function clearAllCommunityFootprints(): void {
  if (communityFootprints.size === 0) return
  communityFootprints.clear()
  communityOwners.clear()
  publish()
}

export function getCommunityPackIdForFootprint(footprintId: string): string | undefined {
  return communityOwners.get(footprintId)
}

/**
 * THE lookup every footprint consumer must use — the board, the picker, the 3-D view, the fab export.
 * Order: authored (user_local) → community pack → built-in → provisional. Shadowing a built-in or
 * provisional id is refused at registration, so a cited package is never silently re-shaped.
 */
export function resolveFootprint(id: string): Footprint | undefined {
  const authored = registry.get(id) // a Map, so no prototype members to fall through to
  if (authored !== undefined) return authored
  const community = communityFootprints.get(id)
  if (community !== undefined) return community
  // Object.hasOwn: BUILTIN_FOOTPRINTS['constructor'] / ['__proto__'] would otherwise hand back an
  // inherited member instead of undefined.
  if (Object.hasOwn(BUILTIN_FOOTPRINTS, id)) return BUILTIN_FOOTPRINTS[id]
  // Generated on demand — not a built-in package, so it never appears in the picker library.
  const pinCount = parseProvisionalFootprintId(id)
  return pinCount === undefined ? undefined : provisionalLand(pinCount)
}

/** Every footprint that can be placed right now — shipped library + community packs + authored. */
export function allAvailableFootprints(): Footprint[] {
  return [
    ...Object.values(BUILTIN_FOOTPRINTS),
    ...communityFootprints.values(),
    ...registry.values(),
  ]
}
