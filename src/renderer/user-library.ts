import type { Footprint } from './footprint.ts'
import { validateUserFootprint } from './user-footprint-validate.ts'
import { validateUserPart } from './user-part-validate.ts'
import type { UserPart } from './user-parts.ts'

/**
 * The personal parts library (user-made parts, slice 3b — the user-local rung). The parts you author
 * live in a small JSON file at ~/.chipblocks/user-parts.json so they follow you into EVERY project, not
 * just the one you made them in. This is the four-origin model's `user_local` origin.
 *
 * PRECEDENCE, honestly: the parts registry is currently a single session-global map (shared by every
 * open tab), so it can't hold a per-project resolution. The library loads at app start as the base, and
 * a project's own embedded parts fill in only the ids the library doesn't already have (a non-clobbering
 * merge — so opening one project can't rewrite a part another open tab is using). That means for a part
 * you authored (identical in your library and your project) everything just works; but the model's full
 * "project overrides user_local" precedence — where a project embedding a DIVERGENT same-id part would
 * win for its own view — is NOT yet implemented (it needs a per-project registry, the documented next
 * step). Until then the base library copy stays.
 *
 * The main process does the raw file I/O (it owns ~/.chipblocks); this module owns the FORMAT — the
 * same versioned + validated shape the project file uses, so a malformed / future / hand-broken library
 * is rejected with a plain reason instead of half-loaded. Import-pure (only validateUserPart, which is
 * pure, and a type-only UserPart), so the Electron main process can read it too if it ever needs to.
 *
 * VERSIONING contract: a whole-file version bump is preserved untouched (persistAuthoredPart refuses to
 * downgrade a future-version library). But WITHIN a matching version, a part this build can't validate
 * is dropped on load and therefore pruned on the next save — so any breaking change to a part's shape
 * MUST bump USER_LIBRARY_VERSION, or older builds would quietly discard the new-shaped parts.
 */

export const USER_LIBRARY_FORMAT = 'chipblocks-user-library'
export const USER_LIBRARY_VERSION = 2
/**
 * Versions this build can READ. v1 held parts only; v2 adds the footprints you author, so that a
 * package you drew follows you between projects the way a part already does. A v1 library still loads
 * (it simply has no footprints) and is written back as v2.
 */
const READABLE_VERSIONS = new Set([1, 2])

export type UserLibraryFile = {
  format: typeof USER_LIBRARY_FORMAT
  version: typeof USER_LIBRARY_VERSION
  userParts: UserPart[]
  userFootprints?: Footprint[]
}

/** The library → the versioned file text written to ~/.chipblocks/user-parts.json. */
export function serializeUserLibrary(
  parts: readonly UserPart[],
  footprints: readonly Footprint[] = [],
): string {
  const file: UserLibraryFile = {
    format: USER_LIBRARY_FORMAT,
    version: USER_LIBRARY_VERSION,
    userParts: [...parts],
  }
  if (footprints.length > 0) file.userFootprints = [...footprints]
  return JSON.stringify(file, null, 2)
}

export type LibraryResult =
  | { ok: true; parts: UserPart[]; footprints: Footprint[] }
  | { ok: false; reason: string }

/** Parse + validate the library file. Honest rejections (not JSON / wrong format / future version); a
 *  malformed individual part is dropped, so a mostly-good library still loads its good parts. */
export function deserializeUserLibrary(text: string): LibraryResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'The parts library is not valid JSON.' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'The parts library is not a JSON object.' }
  }
  const file = raw as Record<string, unknown>
  if (file.format !== USER_LIBRARY_FORMAT) {
    return { ok: false, reason: 'Not a ChipBlocks parts library (wrong or missing format).' }
  }
  if (typeof file.version !== 'number' || !READABLE_VERSIONS.has(file.version)) {
    return {
      ok: false,
      reason: `Unsupported parts-library version ${String(file.version)} (this build reads ${[...READABLE_VERSIONS].join(' and ')}).`,
    }
  }
  const list = Array.isArray(file.userParts) ? file.userParts : []
  const parts = list.map((p) => validateUserPart(p)).filter((p): p is UserPart => p !== null)
  const footprintList = Array.isArray(file.userFootprints) ? file.userFootprints : []
  const footprints = footprintList
    .map((f) => validateUserFootprint(f))
    .filter((f): f is Footprint => f !== null)
  return { ok: true, parts, footprints }
}

/** Add (or replace) a footprint in a library list, deduped by id — mirrors `withPart`. */
export function withFootprint(footprints: readonly Footprint[], footprint: Footprint): Footprint[] {
  return [...footprints.filter((f) => f.id !== footprint.id), footprint]
}

/**
 * Add (or update) a part in a library-parts list, deduped by id — the newly authored part wins over an
 * existing one with the same id. The library grows ONLY by authoring: parts that merely passed through
 * the session from opening someone else's project are not added here.
 */
export function withPart(parts: readonly UserPart[], part: UserPart): UserPart[] {
  return [...parts.filter((p) => p.id !== part.id), part]
}

/**
 * The part PLUS every custom part its internals reference, transitively (resolved from `all`, the
 * session registry) — what a save must persist so a saved module isn't silently broken in every other
 * project (a module built around custom sub-parts needs those sub-parts wherever it goes). Set-guarded,
 * so a self/mutual reference can't loop; a sub-part missing from `all` is simply not included (it loads
 * as an honest black box).
 */
export function withInternalParts(part: UserPart, all: readonly UserPart[]): UserPart[] {
  const byId = new Map(all.map((p) => [p.id, p]))
  const collect = (block: NonNullable<UserPart['internal']>, into: string[]) => {
    for (const inner of block.nodes) {
      into.push(inner.definition)
      if (inner.block) collect(inner.block, into)
    }
  }
  const result: UserPart[] = []
  const seen = new Set<string>()
  const queue = [part]
  seen.add(part.id)
  while (queue.length > 0) {
    const next = queue.shift() as UserPart
    result.push(next)
    if (next.internal === undefined) continue
    const referenced: string[] = []
    collect(next.internal, referenced)
    for (const id of referenced) {
      if (seen.has(id)) continue
      seen.add(id)
      const sub = byId.get(id)
      if (sub !== undefined) queue.push(sub)
    }
  }
  return result
}
