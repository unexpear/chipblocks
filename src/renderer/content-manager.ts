/**
 * Plugin / Content Manager — install index, enable/disable, and honest install refusals.
 *
 * Persistence target: ~/.chipblocks/libraries/index.json (main process owns the path; this
 * module owns the format). Packs themselves live at ~/.chipblocks/libraries/<id>/pack.json
 * after a validated local install (FINAL-STATE-VISION.md / ADR-006 community origin).
 *
 * What this DOES:
 * - Browse the cited catalog (content-catalog.ts) alongside installed packs
 * - Install from a LOCAL pack file the user picked (validate format + license first)
 * - Enable / disable an installed pack (disabled packs stay on disk but leave the session registry;
 *   parts + footprints are registered/cleared together)
 * - Uninstall (drop index entry; main deletes the pack directory)
 *
 * What this REFUSES (honestly, with a reason — never "success" without validation):
 * - An arbitrary URL install (refuseRemoteInstall). A user-configured registry is a separate
 *   path in content-registry.ts: https (or file:// for a local test), hash + signature checked
 *   before any pack file is written, no registry URL shipped with the app
 * - Packs that fail deserializeContentPack (bad JSON, wrong format, future version, bad id)
 * - Packs whose license fails licenseGate (GPL/AGPL/LGPL/unknown)
 * - Marketplace / unsigned arbitrary code execution framing — this is local content registration
 * - Invalid publisher signatures (ed25519 over pack body); undeclared ≠ verified
 *
 * Not Synopsys parity; not KiCad PCM feature-complete. Smallest honest slice for Track 2 item 6.
 */

import { CITED_CONTENT_CATALOG, type ContentCatalogEntry } from './content-catalog.ts'
import {
  type ContentPack,
  deserializeContentPack,
  licenseGate,
  serializeContentPack,
} from './content-pack.ts'
import {
  type IntegrityVerdict,
  sha256Hex,
  trustNoteForVerdict,
  verifyPackIntegrity,
} from './content-pack-integrity.ts'
import {
  type SignatureVerdict,
  type TrustedPublishers,
  trustNoteForSignature,
  verifyPackSignature,
} from './content-pack-signature.ts'

export const CONTENT_INDEX_FORMAT = 'chipblocks-content-index'
export const CONTENT_INDEX_VERSION = 1

export type InstalledPackRecord = {
  id: string
  name: string
  packVersion: string
  license: string
  enabled: boolean
  /** ms epoch when the validated local install landed. */
  installedAt: number
  /** Always local-pack: the installed bytes live under ~/.chipblocks/libraries, not as a remote pointer. */
  source: 'local-pack'
  /** How those bytes were obtained. Absent on rows from before registry install existed. */
  acquiredFrom?: 'local-file' | 'registry'
  description?: string
  homepage?: string
  partCount: number
  footprintCount: number
  /**
   * Trust note shown in the UI — always honest about what was and was not checked
   * (format + license + optional content hash; never a silent "secure" claim).
   */
  trustNote: string
  /**
   * SHA-256 (hex) of the exact pack.json text written at install — tamper-evidence on reload.
   * Absent only on legacy index rows from before this field existed.
   */
  contentHash?: string
  /** Did install-time declared integrity match? 'match' | 'undeclared' | omitted on legacy rows. */
  integrityStatus?: 'match' | 'undeclared'
  /**
   * Publisher-signature status at install:
   * - none: undeclared (≠ verified)
   * - valid-untrusted: ed25519 ok for self-declared key (not pinned)
   * - valid-trusted: ed25519 ok against trusted-publishers pin
   */
  signatureStatus?: 'none' | 'valid-untrusted' | 'valid-trusted'
  /**
   * Lowercase hex of the ed25519 public key, recorded when install verified a signature.
   * The on-disk pack.json is the normalized pack body (signature stripped), so the fingerprint
   * shown later comes from here.
   */
  publisherKeyHex?: string
}

export type PackTrustStamp = {
  trustNote: string
  contentHash: string
  integrityStatus: 'match' | 'undeclared'
  signatureStatus?: 'none' | 'valid-untrusted' | 'valid-trusted'
  publisherKeyHex?: string
}

export type ContentIndex = {
  format: typeof CONTENT_INDEX_FORMAT
  version: typeof CONTENT_INDEX_VERSION
  packs: InstalledPackRecord[]
}

export type IndexResult = { ok: true; index: ContentIndex } | { ok: false; reason: string }

export type InstallResult =
  | { ok: true; record: InstalledPackRecord; pack: ContentPack; index: ContentIndex }
  | { ok: false; reason: string }

/** Why an enabled pack did not fully load on reload. `blocked` means parts were not registered. */
export type PackLoadIssue = { id: string; reason: string; blocked: boolean }

/** Badge for an installed pack. A blocked load stays enabled in the index but parts were not registered. */
export function installedPackStatusLabel(enabled: boolean, blocked: boolean): string {
  if (!enabled) return 'DISABLED'
  return blocked ? 'ENABLED · NOT LOADED' : 'ENABLED'
}

export type ManagerRow =
  | {
      kind: 'installed'
      record: InstalledPackRecord
      catalog?: ContentCatalogEntry
    }
  | {
      kind: 'catalog'
      entry: ContentCatalogEntry
      installed: false
    }

/** @deprecated Prefer trustNoteForVerdict — kept as the undeclared-hash fallback string. */
export const LOCAL_PACK_TRUST_NOTE =
  'Installed from a local file you chose. Format and license were validated; no content-hash declaration was present. A SHA-256 of the installed file is recorded for tamper-evidence on reload. Not a publisher signature (ADR-010). Treat the pack as trusted as the file you picked.'

export function emptyContentIndex(): ContentIndex {
  return { format: CONTENT_INDEX_FORMAT, version: CONTENT_INDEX_VERSION, packs: [] }
}

export function serializeContentIndex(index: ContentIndex): string {
  return JSON.stringify(
    {
      format: CONTENT_INDEX_FORMAT,
      version: CONTENT_INDEX_VERSION,
      packs: index.packs,
    },
    null,
    2,
  )
}

export function deserializeContentIndex(text: string): IndexResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'The content-manager index is not valid JSON.' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'The content-manager index is not a JSON object.' }
  }
  const file = raw as Record<string, unknown>
  if (file.format !== CONTENT_INDEX_FORMAT) {
    return {
      ok: false,
      reason: 'Not a ChipBlocks content-manager index (wrong or missing format).',
    }
  }
  if (file.version !== CONTENT_INDEX_VERSION) {
    return {
      ok: false,
      reason: `Unsupported content-index version ${String(file.version)} (this build reads ${CONTENT_INDEX_VERSION}).`,
    }
  }
  const list = Array.isArray(file.packs) ? file.packs : []
  const packs: InstalledPackRecord[] = []
  for (const entry of list) {
    const rec = validateRecord(entry)
    if (rec !== null) packs.push(rec)
  }
  return {
    ok: true,
    index: { format: CONTENT_INDEX_FORMAT, version: CONTENT_INDEX_VERSION, packs },
  }
}

function validateRecord(raw: unknown): InstalledPackRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null
  if (typeof r.packVersion !== 'string' || typeof r.license !== 'string') return null
  if (typeof r.enabled !== 'boolean') return null
  if (typeof r.installedAt !== 'number') return null
  if (r.source !== 'local-pack') return null
  const gated = licenseGate(r.license)
  if (!gated.ok) return null
  const partCount = typeof r.partCount === 'number' && r.partCount >= 0 ? r.partCount : 0
  const footprintCount =
    typeof r.footprintCount === 'number' && r.footprintCount >= 0 ? r.footprintCount : 0
  const trustNote =
    typeof r.trustNote === 'string' && r.trustNote.trim() !== ''
      ? r.trustNote
      : LOCAL_PACK_TRUST_NOTE
  const record: InstalledPackRecord = {
    id: r.id,
    name: r.name,
    packVersion: r.packVersion,
    license: gated.license,
    enabled: r.enabled,
    installedAt: r.installedAt,
    source: 'local-pack',
    partCount,
    footprintCount,
    trustNote,
  }
  if (typeof r.contentHash === 'string' && /^[a-f0-9]{64}$/i.test(r.contentHash.trim())) {
    record.contentHash = r.contentHash.trim().toLowerCase()
  }
  if (r.integrityStatus === 'match' || r.integrityStatus === 'undeclared') {
    record.integrityStatus = r.integrityStatus
  }
  if (
    r.signatureStatus === 'none' ||
    r.signatureStatus === 'valid-untrusted' ||
    r.signatureStatus === 'valid-trusted'
  ) {
    record.signatureStatus = r.signatureStatus
  }
  if (typeof r.publisherKeyHex === 'string' && /^[a-f0-9]{64}$/i.test(r.publisherKeyHex.trim())) {
    record.publisherKeyHex = r.publisherKeyHex.trim().toLowerCase()
  }
  if (r.acquiredFrom === 'local-file' || r.acquiredFrom === 'registry') {
    record.acquiredFrom = r.acquiredFrom
  }
  if (typeof r.description === 'string' && r.description.trim() !== '') {
    record.description = r.description.trim()
  }
  if (typeof r.homepage === 'string' && r.homepage.trim() !== '') {
    record.homepage = r.homepage.trim()
  }
  return record
}

/** Build the UI rows: installed packs first (newest first), then uninstalled catalog entries. */
export function managerRows(index: ContentIndex): ManagerRow[] {
  const installedIds = new Set(index.packs.map((p) => p.id))
  const installed: ManagerRow[] = [...index.packs]
    .sort((a, b) => b.installedAt - a.installedAt)
    .map((record) => {
      const catalog = CITED_CONTENT_CATALOG.find((c) => c.id === record.id)
      return catalog !== undefined
        ? { kind: 'installed' as const, record, catalog }
        : { kind: 'installed' as const, record }
    })
  const catalog: ManagerRow[] = CITED_CONTENT_CATALOG.filter((e) => !installedIds.has(e.id)).map(
    (entry) => ({ kind: 'catalog' as const, entry, installed: false as const }),
  )
  return [...installed, ...catalog]
}

/**
 * Refuse a remote / network install. The Content Manager never silently downloads a URL and
 * claims success — local pack files only for this slice.
 */
export function refuseRemoteInstall(url: string): { ok: false; reason: string } {
  const trimmed = url.trim()
  return {
    ok: false,
    reason: `Remote install refused (${trimmed || 'empty URL'}). This build only installs from a local pack file you pick after format + license validation — no silent network installs.`,
  }
}

/** Record metadata from a validated pack (used when writing the index after a successful install). */
export function recordFromPack(
  pack: ContentPack,
  installedAt: number,
  enabled = true,
  trust?: PackTrustStamp,
): InstalledPackRecord {
  const record: InstalledPackRecord = {
    id: pack.id,
    name: pack.name,
    packVersion: pack.packVersion,
    license: pack.license,
    enabled,
    installedAt,
    source: 'local-pack',
    partCount: pack.parts.length,
    footprintCount: pack.footprints.length,
    trustNote: trust?.trustNote ?? LOCAL_PACK_TRUST_NOTE,
  }
  if (pack.description !== undefined) record.description = pack.description
  if (pack.homepage !== undefined) record.homepage = pack.homepage
  if (trust !== undefined) {
    record.contentHash = trust.contentHash
    record.integrityStatus = trust.integrityStatus
    if (trust.signatureStatus !== undefined) record.signatureStatus = trust.signatureStatus
    if (trust.publisherKeyHex !== undefined) record.publisherKeyHex = trust.publisherKeyHex
  }
  return record
}

/**
 * Validate pack text and fold it into the index (replace same id). Does not touch disk — the
 * caller writes pack.json + index.json only after ok: true.
 * Prefer `installLocalPackVerified` so content-hash integrity is checked; this sync path is for
 * format/license unit tests and callers that already verified.
 */
export function installLocalPack(
  index: ContentIndex,
  packText: string,
  installedAt: number = Date.now(),
  trust?: PackTrustStamp,
): InstallResult {
  const parsed = deserializeContentPack(packText)
  if (!parsed.ok) return parsed
  const record = recordFromPack(parsed.pack, installedAt, true, trust)
  const packs = [...index.packs.filter((p) => p.id !== record.id), record]
  return {
    ok: true,
    record,
    pack: parsed.pack,
    index: { ...index, packs },
  }
}

/**
 * Install after an honest integrity check. Refuses on declared-hash mismatch; records SHA-256 of
 * the exact pack text for reload tamper-evidence; never claims publisher-signature trust.
 */
export async function installLocalPackVerified(
  index: ContentIndex,
  packText: string,
  installedAt: number = Date.now(),
  trustedPublishers?: TrustedPublishers,
): Promise<InstallResult> {
  const verdict: IntegrityVerdict = await verifyPackIntegrity(packText)
  if (verdict.kind === 'mismatch' || verdict.kind === 'unsupported') {
    return { ok: false, reason: verdict.reason }
  }
  const sig: SignatureVerdict = await verifyPackSignature(packText, trustedPublishers)
  if (sig.kind === 'invalid') {
    return { ok: false, reason: sig.reason }
  }
  const signatureStatus: 'none' | 'valid-untrusted' | 'valid-trusted' =
    sig.kind === 'undeclared'
      ? 'none'
      : sig.kind === 'valid-trusted'
        ? 'valid-trusted'
        : 'valid-untrusted'
  const integrityNote = trustNoteForVerdict(verdict)
  const signatureNote = trustNoteForSignature(sig)
  const stamp: PackTrustStamp = {
    trustNote: `${integrityNote} ${signatureNote}`,
    contentHash: verdict.hash,
    integrityStatus: verdict.kind === 'match' ? 'match' : 'undeclared',
    signatureStatus,
  }
  if (sig.kind === 'valid-trusted' || sig.kind === 'valid-untrusted') {
    stamp.publisherKeyHex = sig.publicKeyHex
  }
  return installLocalPack(index, packText, installedAt, stamp)
}

/**
 * The bytes local install and registry install both write: normalized pack.json, plus the index
 * row whose content hash is those bytes (the picked file's hash is only the install-time check).
 */
export async function installedPackFiles(installed: {
  record: InstalledPackRecord
  pack: ContentPack
  index: ContentIndex
}): Promise<{ onDiskText: string; record: InstalledPackRecord; index: ContentIndex }> {
  const onDiskText = serializeContentPack(installed.pack)
  const diskHash = await sha256Hex(onDiskText)
  const record: InstalledPackRecord = { ...installed.record, contentHash: diskHash }
  const index: ContentIndex = {
    ...installed.index,
    packs: installed.index.packs.map((pack) => (pack.id === record.id ? record : pack)),
  }
  return { onDiskText, record, index }
}

export function setPackEnabled(
  index: ContentIndex,
  id: string,
  enabled: boolean,
): ContentIndex | { ok: false; reason: string } {
  const i = index.packs.findIndex((p) => p.id === id)
  if (i < 0) return { ok: false, reason: `No installed pack "${id}" to enable/disable.` }
  const packs = index.packs.map((p, idx) => (idx === i ? { ...p, enabled } : p))
  return { ...index, packs }
}

export function uninstallPack(
  index: ContentIndex,
  id: string,
): ContentIndex | { ok: false; reason: string } {
  if (!index.packs.some((p) => p.id === id)) {
    return { ok: false, reason: `No installed pack "${id}" to uninstall.` }
  }
  return { ...index, packs: index.packs.filter((p) => p.id !== id) }
}

export function enabledPackIds(index: ContentIndex): string[] {
  return index.packs.filter((p) => p.enabled).map((p) => p.id)
}
