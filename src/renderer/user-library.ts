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
export const USER_LIBRARY_VERSION = 1

export type UserLibraryFile = {
  format: typeof USER_LIBRARY_FORMAT
  version: typeof USER_LIBRARY_VERSION
  userParts: UserPart[]
}

/** The library parts → the versioned file text written to ~/.chipblocks/user-parts.json. */
export function serializeUserLibrary(parts: readonly UserPart[]): string {
  const file: UserLibraryFile = {
    format: USER_LIBRARY_FORMAT,
    version: USER_LIBRARY_VERSION,
    userParts: [...parts],
  }
  return JSON.stringify(file, null, 2)
}

export type LibraryResult = { ok: true; parts: UserPart[] } | { ok: false; reason: string }

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
  if (file.version !== USER_LIBRARY_VERSION) {
    return {
      ok: false,
      reason: `Unsupported parts-library version ${String(file.version)} (this build reads ${USER_LIBRARY_VERSION}).`,
    }
  }
  const list = Array.isArray(file.userParts) ? file.userParts : []
  const parts = list.map((p) => validateUserPart(p)).filter((p): p is UserPart => p !== null)
  return { ok: true, parts }
}

/**
 * Add (or update) a part in a library-parts list, deduped by id — the newly authored part wins over an
 * existing one with the same id. The library grows ONLY by authoring: parts that merely passed through
 * the session from opening someone else's project are not added here.
 */
export function withPart(parts: readonly UserPart[], part: UserPart): UserPart[] {
  return [...parts.filter((p) => p.id !== part.id), part]
}
