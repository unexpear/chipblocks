/**
 * User-configured content registry — index parse, download checks, install.
 *
 * No registry URL ships with the app. The desktop process downloads bytes
 * (electron/registry-download.ts); this module decides whether those bytes may be installed.
 * A failed check returns a reason and does not ask the caller to write a pack file.
 */

import {
  type ContentIndex,
  type InstallResult,
  installedPackFiles,
  installLocalPackVerified,
  type PackFileIO,
  writeInstalledPack,
} from './content-manager.ts'
import { packIdProblem } from './content-pack.ts'
import { sha256HexBytes } from './content-pack-integrity.ts'
import {
  bytesToHex,
  canonicalPublicKeyHex,
  decodeKeyOrSigBytes,
  readDeclaredSignature,
  type TrustedPublishers,
  verifyPackSignature,
} from './content-pack-signature.ts'
import type { RotationState } from './key-rotation.ts'
import { comparePackVersions, isPreRelease } from './pack-version.ts'

export const REGISTRY_INDEX_FORMAT = 'chipblocks-content-registry-index'
export const REGISTRY_INDEX_VERSION = 1
export const REGISTRY_SETTINGS_FORMAT = 'chipblocks-content-registry-settings'
export const REGISTRY_SETTINGS_VERSION = 1

/** Hard cap for one pack download. Matches the JSON Schema maximum on `size`. */
export const REGISTRY_MAX_PACK_BYTES = 2_097_152
/** Hard cap for the index document itself. */
export const REGISTRY_MAX_INDEX_BYTES = 512 * 1024
export const REGISTRY_DOWNLOAD_TIMEOUT_MS = 20_000
export const REGISTRY_INDEX_TIMEOUT_MS = 15_000

export const NO_REGISTRY_CONFIGURED =
  'No content registry is configured. ChipBlocks does not ship one, because no public registry exists. Paste an https index URL you choose. Nothing is downloaded until you install a pack.'

export const TRUSTED_PUBLISHERS_UNAVAILABLE =
  'This window has no desktop bridge, so ~/.chipblocks/trusted-publishers.json stays unread. No publisher key is treated as pinned.'

const HEX64 = /^[a-f0-9]{64}$/i

export type RegistrySignature = {
  alg: 'ed25519'
  publicKey: string
  sig: string
}

export type RegistryPackEntry = {
  id: string
  version: string
  downloadUrl: string
  size: number
  sha256: string
  signature: RegistrySignature
  name?: string
}

export type RegistryIndex = { ok: true; packs: RegistryPackEntry[] } | { ok: false; reason: string }

const INDEX_FIELDS = new Set(['format', 'version', 'packs'])
const PACK_FIELDS = new Set(['id', 'name', 'version', 'downloadUrl', 'size', 'sha256', 'signature'])
const SIG_FIELDS = new Set(['alg', 'publicKey', 'sig'])

function unknownField(record: Record<string, unknown>, allowed: Set<string>): string | null {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return key
  }
  return null
}

export type RegistryUrlClass =
  | { ok: true; scheme: 'https' | 'file'; url: URL }
  | { ok: false; reason: string }

/** https, or file:// for a local test / dev index. Anything else is refused before a connection. */
export function classifyRegistryUrl(raw: string): RegistryUrlClass {
  const trimmed = raw.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return {
      ok: false,
      reason: `Not a URL (${trimmed || 'empty'}). Registry indexes must be https. Nothing was downloaded.`,
    }
  }
  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      reason: 'Registry URLs must not include a username or password. Nothing was downloaded.',
    }
  }
  if (url.protocol === 'file:') {
    // A file URL with a host, or a //server path, is a network share. On Windows, opening one
    // makes the computer sign in to that server, so it is refused before anything is read.
    const host = url.hostname.toLowerCase()
    if ((host !== '' && host !== 'localhost') || url.pathname.startsWith('//')) {
      return {
        ok: false,
        reason: `file:// registry URLs must point at a file on this computer, not a network share (${trimmed}). Nothing was downloaded.`,
      }
    }
    return { ok: true, scheme: 'file', url }
  }
  if (url.protocol === 'https:') {
    if (url.hostname === '') {
      return { ok: false, reason: 'That https URL has no host. Nothing was downloaded.' }
    }
    return { ok: true, scheme: 'https', url }
  }
  return {
    ok: false,
    reason: `Registry URLs must be https. Refused ${url.protocol} (${trimmed}). file:// is accepted only for a local test or dev index. Nothing was downloaded.`,
  }
}

function parseSignature(
  raw: unknown,
  label: string,
): { ok: true; signature: RegistrySignature } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: `${label} signature must be an object.` }
  }
  const s = raw as Record<string, unknown>
  const extra = unknownField(s, SIG_FIELDS)
  if (extra !== null) {
    return { ok: false, reason: `${label} signature has unknown field ${JSON.stringify(extra)}.` }
  }
  if (s.alg !== 'ed25519') {
    return { ok: false, reason: `${label} signature alg must be ed25519.` }
  }
  if (typeof s.publicKey !== 'string' || typeof s.sig !== 'string') {
    return { ok: false, reason: `${label} signature needs string publicKey and sig.` }
  }
  const publicKey = canonicalPublicKeyHex(s.publicKey)
  if (publicKey === null) {
    return {
      ok: false,
      reason: `${label} signature publicKey must be 32 raw ed25519 bytes.`,
    }
  }
  const sigBytes = decodeKeyOrSigBytes(s.sig, 64)
  if (sigBytes === null) {
    return {
      ok: false,
      reason: `${label} signature sig must be 64 raw ed25519 bytes.`,
    }
  }
  return { ok: true, signature: { alg: 'ed25519', publicKey, sig: bytesToHex(sigBytes) } }
}

function parsePackEntry(
  raw: unknown,
  index: number,
): { ok: true; entry: RegistryPackEntry } | { ok: false; reason: string } {
  const label = `Registry pack ${index + 1}`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: `${label} is not an object.` }
  }
  const p = raw as Record<string, unknown>
  const extra = unknownField(p, PACK_FIELDS)
  if (extra !== null) {
    return { ok: false, reason: `${label} has unknown field ${JSON.stringify(extra)}.` }
  }
  const idProblem = packIdProblem(p.id)
  if (idProblem !== null || typeof p.id !== 'string') {
    return { ok: false, reason: `${label}: ${idProblem ?? 'id must be snake_case.'}` }
  }
  if (typeof p.version !== 'string' || p.version.trim() === '' || p.version.trim().length > 64) {
    return { ok: false, reason: `${label} (${p.id}) needs a version string.` }
  }
  if (typeof p.downloadUrl !== 'string') {
    return { ok: false, reason: `${label} (${p.id}) needs a downloadUrl string.` }
  }
  const url = classifyRegistryUrl(p.downloadUrl)
  if (!url.ok) {
    return { ok: false, reason: `${label} (${p.id}): ${url.reason}` }
  }
  if (typeof p.size !== 'number' || !Number.isInteger(p.size) || p.size < 0) {
    return { ok: false, reason: `${label} (${p.id}) size must be a whole number of bytes.` }
  }
  if (p.size > REGISTRY_MAX_PACK_BYTES) {
    return {
      ok: false,
      reason: `${label} (${p.id}) declares ${p.size} bytes, over the ${REGISTRY_MAX_PACK_BYTES} byte limit.`,
    }
  }
  if (typeof p.sha256 !== 'string' || !HEX64.test(p.sha256.trim())) {
    return { ok: false, reason: `${label} (${p.id}) sha256 must be 64 hex characters.` }
  }
  const signature = parseSignature(p.signature, `${label} (${p.id})`)
  if (!signature.ok) return signature
  const entry: RegistryPackEntry = {
    id: p.id,
    version: p.version.trim(),
    downloadUrl: p.downloadUrl.trim(),
    size: p.size,
    sha256: p.sha256.trim().toLowerCase(),
    signature: signature.signature,
  }
  if (p.name !== undefined) {
    if (typeof p.name !== 'string' || p.name.trim() === '') {
      return {
        ok: false,
        reason: `${label} (${p.id}) name must be a non-empty string when present.`,
      }
    }
    entry.name = p.name.trim()
  }
  return { ok: true, entry }
}

/**
 * Strict index reader. One bad pack refuses the whole index — bad rows are not skipped.
 * When `indexUrl` is given and is https, every downloadUrl must be https too: an index from
 * the network may not send the app to read files on this computer.
 */
export function parseRegistryIndex(text: string, indexUrl?: string): RegistryIndex {
  const from = indexUrl === undefined ? null : classifyRegistryUrl(indexUrl)
  const remoteIndex = from?.ok === true && from.scheme === 'https'
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'The registry index is not valid JSON.' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'The registry index is not a JSON object.' }
  }
  const file = raw as Record<string, unknown>
  const extra = unknownField(file, INDEX_FIELDS)
  if (extra !== null) {
    return { ok: false, reason: `The registry index has unknown field ${JSON.stringify(extra)}.` }
  }
  if (file.format !== REGISTRY_INDEX_FORMAT) {
    return {
      ok: false,
      reason: 'Not a ChipBlocks content registry index (wrong or missing format).',
    }
  }
  if (file.version !== REGISTRY_INDEX_VERSION) {
    return {
      ok: false,
      reason: `Unsupported registry index version ${String(file.version)} (this build reads ${REGISTRY_INDEX_VERSION}).`,
    }
  }
  if (!Array.isArray(file.packs)) {
    return { ok: false, reason: 'The registry index "packs" must be an array.' }
  }
  const packs: RegistryPackEntry[] = []
  const seen = new Set<string>()
  for (let i = 0; i < file.packs.length; i++) {
    const parsed = parsePackEntry(file.packs[i], i)
    if (!parsed.ok) return parsed
    if (remoteIndex && !parsed.entry.downloadUrl.toLowerCase().startsWith('https:')) {
      return {
        ok: false,
        reason: `Registry pack ${i + 1} (${parsed.entry.id}): an https registry index may only list https downloads. Refused ${parsed.entry.downloadUrl}. Nothing was downloaded.`,
      }
    }
    if (seen.has(parsed.entry.id)) {
      return { ok: false, reason: `The registry index lists "${parsed.entry.id}" more than once.` }
    }
    seen.add(parsed.entry.id)
    packs.push(parsed.entry)
  }
  return { ok: true, packs }
}

/**
 * Is `offered` a later version than `installed`, by SemVer precedence (see pack-version.ts)?
 * A version with no SemVer order is never called newer.
 */
export function isNewerRegistryVersion(installed: string, offered: string): boolean {
  return comparePackVersions(offered, installed) === 1
}

export type RegistryUpdate = {
  id: string
  name: string
  installed: string
  offered: string
}

export function registryUpdates(
  installed: readonly { id: string; name: string; packVersion: string }[],
  packs: readonly RegistryPackEntry[],
): RegistryUpdate[] {
  const updates: RegistryUpdate[] = []
  for (const pack of packs) {
    const have = installed.find((row) => row.id === pack.id)
    if (have === undefined) continue
    if (!isNewerRegistryVersion(have.packVersion, pack.version)) continue
    // A pre-release is only offered as an update to someone already on a pre-release.
    if (isPreRelease(pack.version) && !isPreRelease(have.packVersion)) continue
    updates.push({
      id: pack.id,
      name: pack.name ?? have.name,
      installed: have.packVersion,
      offered: pack.version,
    })
  }
  return updates
}

/**
 * Checks that run on bytes already in memory, before any pack directory is written.
 * Order: declared size, cap, SHA-256, UTF-8, registry signature vs the pack's signature, ed25519.
 */
export async function checkRegistryDownload(
  entry: RegistryPackEntry,
  body: Uint8Array,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  if (entry.size > REGISTRY_MAX_PACK_BYTES || body.byteLength > REGISTRY_MAX_PACK_BYTES) {
    return {
      ok: false,
      reason: `Download for "${entry.id}" is over the ${REGISTRY_MAX_PACK_BYTES} byte limit (declared ${entry.size}, got ${body.byteLength}). Nothing was written.`,
    }
  }
  if (body.byteLength !== entry.size) {
    return {
      ok: false,
      reason: `Registry entry "${entry.id}" declares ${entry.size} bytes but the download is ${body.byteLength} bytes. Nothing was written.`,
    }
  }
  const actual = await sha256HexBytes(body)
  if (actual !== entry.sha256) {
    return {
      ok: false,
      reason: `SHA-256 of the download for "${entry.id}" does not match the registry index. Expected ${entry.sha256}, got ${actual}. Nothing was written.`,
    }
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return {
      ok: false,
      reason: `The download for "${entry.id}" is not UTF-8 text. Nothing was written.`,
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: `The download for "${entry.id}" is not JSON. Nothing was written.` }
  }
  const declared = readDeclaredSignature(raw)
  if (declared === null) {
    return {
      ok: false,
      reason: `The downloaded pack "${entry.id}" declares no publisher signature, but the registry index requires one. Nothing was written.`,
    }
  }
  if ('reason' in declared) {
    return { ok: false, reason: `${declared.reason} Nothing was written.` }
  }
  const packKey = canonicalPublicKeyHex(declared.publicKey)
  const packSig = decodeKeyOrSigBytes(declared.sig, 64)
  if (packKey === null || packSig === null) {
    return {
      ok: false,
      reason: `The downloaded pack "${entry.id}" has a publisher key or signature that is not raw ed25519. Nothing was written.`,
    }
  }
  if (packKey !== entry.signature.publicKey) {
    return {
      ok: false,
      reason: `The downloaded pack's publisher key does not match the registry entry for "${entry.id}". Nothing was written.`,
    }
  }
  if (bytesToHex(packSig) !== entry.signature.sig) {
    return {
      ok: false,
      reason: `The downloaded pack's publisher signature does not match the registry entry for "${entry.id}". Nothing was written.`,
    }
  }
  const verdict = await verifyPackSignature(text)
  if (verdict.kind === 'invalid' || verdict.kind === 'undeclared') {
    const why = verdict.kind === 'invalid' ? verdict.reason : 'No publisher signature was declared.'
    return { ok: false, reason: `${why} Nothing was written.` }
  }
  return { ok: true, text }
}

export type RegistryInstallIO = PackFileIO

/**
 * Verify, then install through the same pack + index write as a local file.
 * Verification failure does not call writePack. If the pack or the index cannot be saved, a new
 * pack directory is removed and an update puts the previous pack.json back when it was readable.
 * An older version than the one installed is refused: a registry must not roll a pack back.
 */
export async function installDownloadedRegistryPack(args: {
  index: ContentIndex
  entry: RegistryPackEntry
  body: Uint8Array
  trusted?: TrustedPublishers
  /** Rollback floors from the trust seal: an entry older than its floor is refused. */
  floors?: Readonly<Record<string, string>> | null
  /** Retired keys and accepted sequences from the trust seal, for key rotations. */
  rotation?: RotationState | null
  installedAt?: number
  io: RegistryInstallIO
}): Promise<InstallResult> {
  const url = classifyRegistryUrl(args.entry.downloadUrl)
  if (!url.ok) return url
  const have = args.index.packs.find((pack) => pack.id === args.entry.id)
  if (have !== undefined && comparePackVersions(args.entry.version, have.packVersion) === -1) {
    return {
      ok: false,
      reason: `"${args.entry.id}" ${have.packVersion} is installed, and the registry offers the older ${args.entry.version}. A registry install does not go back a version. Nothing was written. Uninstall first if you mean to go back.`,
    }
  }
  const checked = await checkRegistryDownload(args.entry, args.body)
  if (!checked.ok) return checked
  const installed = await installLocalPackVerified(
    args.index,
    checked.text,
    args.installedAt ?? Date.now(),
    args.trusted,
    args.floors,
    args.rotation,
  )
  if (!installed.ok) return installed
  if (installed.pack.id !== args.entry.id) {
    return {
      ok: false,
      reason: `The pack file id is "${installed.pack.id}" but the registry entry says "${args.entry.id}". Nothing was written.`,
    }
  }
  if (installed.pack.packVersion !== args.entry.version) {
    return {
      ok: false,
      reason: `The pack file version is "${installed.pack.packVersion}" but the registry entry says "${args.entry.version}". Nothing was written.`,
    }
  }
  const files = await installedPackFiles(installed, checked.text)
  const note = `Installed from a content registry entry "${args.entry.id}" ${args.entry.version} after the downloaded bytes matched the registry SHA-256 and ed25519 signature. ${files.record.trustNote}`
  const record = { ...files.record, trustNote: note, acquiredFrom: 'registry' as const }
  const index: ContentIndex = {
    ...files.index,
    packs: files.index.packs.map((pack) => (pack.id === record.id ? record : pack)),
  }
  const saved = await writeInstalledPack({
    id: record.id,
    onDiskText: files.onDiskText,
    index,
    hadPrevious: have !== undefined,
    io: args.io,
  })
  if (!saved.ok) return saved
  return {
    ok: true,
    record,
    pack: installed.pack,
    index,
    ...(installed.keyRotation !== undefined ? { keyRotation: installed.keyRotation } : {}),
  }
}

export type RegistrySettings = { ok: true; indexUrl: string } | { ok: false; reason: string }

const SETTINGS_FIELDS = new Set(['format', 'version', 'indexUrl'])

export function parseRegistrySettings(text: string): RegistrySettings {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'The registry settings file is not valid JSON.' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'The registry settings file is not a JSON object.' }
  }
  const file = raw as Record<string, unknown>
  const extra = unknownField(file, SETTINGS_FIELDS)
  if (extra !== null) {
    return {
      ok: false,
      reason: `The registry settings file has unknown field ${JSON.stringify(extra)}.`,
    }
  }
  if (file.format !== REGISTRY_SETTINGS_FORMAT) {
    return {
      ok: false,
      reason: 'Not a ChipBlocks registry settings file (wrong or missing format).',
    }
  }
  if (file.version !== REGISTRY_SETTINGS_VERSION) {
    return {
      ok: false,
      reason: `Unsupported registry settings version ${String(file.version)} (this build reads ${REGISTRY_SETTINGS_VERSION}).`,
    }
  }
  if (typeof file.indexUrl !== 'string') {
    return { ok: false, reason: 'The registry settings file needs an indexUrl string.' }
  }
  return { ok: true, indexUrl: file.indexUrl.trim() }
}

export function serializeRegistrySettings(indexUrl: string): string {
  return JSON.stringify(
    {
      format: REGISTRY_SETTINGS_FORMAT,
      version: REGISTRY_SETTINGS_VERSION,
      indexUrl,
    },
    null,
    2,
  )
}

export type RegistrySettingsWrite =
  | { ok: true; text: string; indexUrl: string }
  | { ok: false; reason: string }

/**
 * Replace the saved index URL. Empty clears it. A settings file that does not parse is left
 * alone — same rule as the templates library and the content index.
 */
export function registrySettingsAfterSet(
  existingText: string | null,
  indexUrlRaw: string,
): RegistrySettingsWrite {
  if (existingText !== null) {
    const parsed = parseRegistrySettings(existingText)
    if (!parsed.ok) {
      return {
        ok: false,
        reason: `${parsed.reason} Nothing was written, so the registry settings file was left as it is.`,
      }
    }
  }
  const indexUrl = indexUrlRaw.trim()
  if (indexUrl === '') {
    if (existingText === null) {
      return {
        ok: false,
        reason:
          'No registry settings file exists, and there is no URL to save. Nothing was written.',
      }
    }
    return { ok: true, text: serializeRegistrySettings(''), indexUrl: '' }
  }
  const url = classifyRegistryUrl(indexUrl)
  if (!url.ok) return url
  return { ok: true, text: serializeRegistrySettings(indexUrl), indexUrl }
}

export async function commitRegistrySettings(opts: {
  read: () => Promise<string | null>
  write: (text: string) => Promise<{ ok: boolean }>
  indexUrl: string
}): Promise<RegistrySettingsWrite> {
  let text: string | null
  try {
    text = await opts.read()
  } catch (error) {
    return {
      ok: false,
      reason: `The registry settings file could not be read (${String(error)}). Nothing was written.`,
    }
  }
  const next = registrySettingsAfterSet(text, opts.indexUrl)
  if (!next.ok) return next
  const written = await opts.write(next.text)
  if (!written.ok) {
    return {
      ok: false,
      reason: 'The registry settings file could not be saved. The previous file was left as it is.',
    }
  }
  return next
}
