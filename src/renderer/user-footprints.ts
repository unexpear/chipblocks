/**
 * USER-AUTHORED FOOTPRINTS — the "author a footprint" half of the two-way footprint model.
 *
 * Until now a footprint could only be one of the 15 hand-written `BUILTIN_FOOTPRINTS` constants: you could
 * PICK a package but never make one, so any part whose package wasn't already in the library (a QFN, a
 * QFP, a connector) simply could not go on a board — not by you, and not by the app without a code edit.
 * This is the registry that fixes that: footprints authored in the app live here, and every consumer
 * resolves an id through `resolveFootprint` — user library first, built-ins as the fallback layer.
 *
 * It deliberately mirrors user-parts.ts (same store shape, same subscribe/snapshot pair for React, same
 * refuse-to-shadow rule) so the two authoring paths behave identically. A user footprint may NOT take a
 * built-in's id: the built-in library is cited, shared, and referenced by the shipped parts, so shadowing
 * one would silently re-shape a part that other projects rely on.
 */

import { BUILTIN_FOOTPRINTS, type Footprint } from './footprint.ts'

const registry = new Map<string, Footprint>()

// A stable snapshot: rebuilt only on mutation, so useSyncExternalStore never sees a new array per render.
let snapshot: Footprint[] = []
const listeners = new Set<() => void>()
function publish(): void {
  snapshot = [...registry.values()]
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

/** Register an authored footprint. Refuses (and warns) an id that belongs to a built-in — returns success. */
export function registerUserFootprint(footprint: Footprint): boolean {
  if (isBuiltinFootprintId(footprint.id)) {
    console.warn(
      `[user-footprints] refusing "${footprint.id}": that id belongs to a built-in footprint`,
    )
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
    if (isBuiltinFootprintId(fp.id)) {
      console.warn(`[user-footprints] skipping "${fp.id}": that id belongs to a built-in footprint`)
      continue
    }
    registry.set(fp.id, fp)
  }
  publish()
}

/**
 * Add footprints WITHOUT clobbering (a project loading its footprints into a session that may already hold
 * another tab's): an id already registered is KEPT, so a loaded project can never silently re-shape a
 * package another open board is placing. Built-in ids are skipped. Returns how many were newly added.
 */
export function mergeUserFootprints(footprints: readonly Footprint[]): number {
  let added = 0
  for (const fp of footprints) {
    if (registry.has(fp.id) || isBuiltinFootprintId(fp.id)) continue
    registry.set(fp.id, fp)
    added++
  }
  if (added > 0) publish()
  return added
}

/**
 * THE lookup every footprint consumer must use — the board, the picker, the 3-D view, the fab export.
 * A user-authored footprint wins over the built-in library only when the id is genuinely new (shadowing a
 * built-in is refused at registration), so this is really "the user library, then the shipped one".
 */
export function resolveFootprint(id: string): Footprint | undefined {
  const authored = registry.get(id) // a Map, so no prototype members to fall through to
  if (authored !== undefined) return authored
  // Object.hasOwn: BUILTIN_FOOTPRINTS['constructor'] / ['__proto__'] would otherwise hand back an
  // inherited member instead of undefined.
  return Object.hasOwn(BUILTIN_FOOTPRINTS, id) ? BUILTIN_FOOTPRINTS[id] : undefined
}

/** Every footprint that can be placed right now — the shipped library plus whatever has been authored. */
export function allAvailableFootprints(): Footprint[] {
  return [...Object.values(BUILTIN_FOOTPRINTS), ...registry.values()]
}
