/**
 * Content pack format — the community-origin unit the Plugin & Content Manager installs.
 *
 * A pack is a versioned JSON file the user provides locally (or that lands under
 * ~/.chipblocks/libraries/<id>/pack.json after a validated install). It is NOT a marketplace
 * download blob and NOT arbitrary unsigned code execution: it carries declared catalog content
 * (today: user-part-shaped definitions + optional footprints) with an SPDX-ish license the
 * install gate checks against the open-hardware whitelist (OPEN-HARDWARE-ECOSYSTEM.md / ADR-010
 * candidate). Remote URL installs are refused in content-manager.ts — this module only parses
 * and validates a pack body that is already in hand.
 *
 * Origin: `community` (OBJECT-MODEL.md §5). Resolution still walks project → user_local →
 * community → builtin; this file does not invent Synopsys / KiCad PCM parity.
 */

import type { Footprint } from './footprint.ts'
import { validateUserFootprint } from './user-footprint-validate.ts'
import { validateUserPart } from './user-part-validate.ts'
import type { UserPart } from './user-parts.ts'

export const CONTENT_PACK_FORMAT = 'chipblocks-content-pack'
export const CONTENT_PACK_VERSION = 1

/**
 * Licenses accepted for community packs (permissive / file-level-permissive). Matches
 * CLAUDE.md principle 4 + OPEN-HARDWARE-ECOSYSTEM.md license posture. Case-insensitive match
 * after normalizing spaces/underscores to hyphens.
 */
export const ACCEPTED_PACK_LICENSES: readonly string[] = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'CC0-1.0',
  'MPL-2.0',
  'CERN-OHL-P',
  'CERN-OHL-P-2.0',
  'SHL-0.51',
  'Solderpad-2.0',
]

/** Licenses that are always refused for in-app installed community content. */
export const REFUSED_PACK_LICENSES: readonly string[] = [
  'GPL-2.0',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'AGPL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'LGPL-2.1',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'CERN-OHL-S',
  'CERN-OHL-S-2.0',
  'CERN-OHL-W',
  'CERN-OHL-W-2.0',
]

export type ContentPack = {
  format: typeof CONTENT_PACK_FORMAT
  version: typeof CONTENT_PACK_VERSION
  /** snake_case id — also the install directory name under ~/.chipblocks/libraries/. */
  id: string
  name: string
  /** Semver-ish string the author declared (pinned in the install index; not auto-upgraded). */
  packVersion: string
  /** SPDX-ish license id; must pass licenseGate. */
  license: string
  description?: string
  /** Optional homepage / repo URL for citation — never fetched by the install path. */
  homepage?: string
  /** Parts this pack contributes at community origin (validated like user parts). */
  parts: UserPart[]
  /** Optional footprints (validated like user footprints). */
  footprints: Footprint[]
}

export type PackParseResult = { ok: true; pack: ContentPack } | { ok: false; reason: string }

export type LicenseGateResult = { ok: true; license: string } | { ok: false; reason: string }

const ID_RE = /^[a-z][a-z0-9_]*$/

/** Normalize a license string for whitelist comparison. */
export function normalizeLicense(raw: string): string {
  return raw.trim().replace(/[_\s]+/g, '-')
}

/**
 * Honest license gate for community packs. Accepts the permissive whitelist; refuses copyleft
 * and unknowns rather than guessing. Case-insensitive.
 */
export function licenseGate(raw: unknown): LicenseGateResult {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {
      ok: false,
      reason: 'Pack declares no license — community content must name a permissive SPDX license.',
    }
  }
  const license = normalizeLicense(raw)
  const lower = license.toLowerCase()
  for (const refused of REFUSED_PACK_LICENSES) {
    if (refused.toLowerCase() === lower) {
      return {
        ok: false,
        reason: `License ${license} is refused for in-app community packs (copyleft / case-by-case — see OPEN-HARDWARE-ECOSYSTEM.md).`,
      }
    }
  }
  for (const accepted of ACCEPTED_PACK_LICENSES) {
    if (accepted.toLowerCase() === lower) {
      return { ok: true, license: accepted }
    }
  }
  return {
    ok: false,
    reason: `License ${license} is not on the community-pack whitelist (MIT / Apache-2.0 / BSD / ISC / CC0 / MPL-2.0 / CERN-OHL-P / Solderpad).`,
  }
}

/**
 * Parse + validate a pack body. Wrong format / future version / bad id / refused license →
 * rejected with a reason. Malformed individual parts/footprints are dropped so a mostly-good
 * pack can still install its good entries (same resilience as user-library.ts).
 */
export function deserializeContentPack(text: string): PackParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'The content pack is not valid JSON.' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'The content pack is not a JSON object.' }
  }
  const file = raw as Record<string, unknown>
  if (file.format !== CONTENT_PACK_FORMAT) {
    return { ok: false, reason: 'Not a ChipBlocks content pack (wrong or missing format).' }
  }
  if (file.version !== CONTENT_PACK_VERSION) {
    return {
      ok: false,
      reason: `Unsupported content-pack version ${String(file.version)} (this build reads ${CONTENT_PACK_VERSION}).`,
    }
  }
  if (typeof file.id !== 'string' || !ID_RE.test(file.id)) {
    return {
      ok: false,
      reason: 'Pack id must be snake_case (letter, then letters/digits/underscores).',
    }
  }
  if (typeof file.name !== 'string' || file.name.trim() === '') {
    return { ok: false, reason: 'Pack name is required.' }
  }
  if (typeof file.packVersion !== 'string' || file.packVersion.trim() === '') {
    return { ok: false, reason: 'Pack packVersion is required (author-declared version string).' }
  }
  const gated = licenseGate(file.license)
  if (!gated.ok) return gated

  const partList = Array.isArray(file.parts) ? file.parts : []
  const parts = partList.map((p) => validateUserPart(p)).filter((p): p is UserPart => p !== null)
  const footprintList = Array.isArray(file.footprints) ? file.footprints : []
  const footprints = footprintList
    .map((f) => validateUserFootprint(f))
    .filter((f): f is Footprint => f !== null)

  const pack: ContentPack = {
    format: CONTENT_PACK_FORMAT,
    version: CONTENT_PACK_VERSION,
    id: file.id,
    name: file.name.trim(),
    packVersion: file.packVersion.trim(),
    license: gated.license,
    parts,
    footprints,
  }
  if (typeof file.description === 'string' && file.description.trim() !== '') {
    pack.description = file.description.trim()
  }
  if (typeof file.homepage === 'string' && file.homepage.trim() !== '') {
    pack.homepage = file.homepage.trim()
  }
  return { ok: true, pack }
}

/** Serialize a validated pack for disk (pretty JSON, same shape as deserialize expects). */
export function serializeContentPack(pack: ContentPack): string {
  return JSON.stringify(
    {
      format: CONTENT_PACK_FORMAT,
      version: CONTENT_PACK_VERSION,
      id: pack.id,
      name: pack.name,
      packVersion: pack.packVersion,
      license: pack.license,
      ...(pack.description !== undefined ? { description: pack.description } : {}),
      ...(pack.homepage !== undefined ? { homepage: pack.homepage } : {}),
      parts: pack.parts,
      ...(pack.footprints.length > 0 ? { footprints: pack.footprints } : {}),
    },
    null,
    2,
  )
}
