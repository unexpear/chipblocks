/**
 * Publisher signatures for content packs — smallest honest ed25519 scheme.
 *
 * What this DOES:
 * - Verify an optional pack-declared ed25519 signature over the same canonical body
 *   used for content-hash integrity (integrity + signature fields stripped)
 * - Optionally match the declared public key against a user-pinned trusted-publishers
 *   list (local file / in-memory allowlist)
 * - Refuse an invalid or malformed signature
 *
 * What this does NOT claim (no fake PKI):
 * - A self-declared publicKey + valid sig is NOT publisher identity trust — anyone can
 *   put their own key in the pack. Only a key pinned in trusted-publishers upgrades to
 *   "verified against a key you chose to trust."
 * - No CA chain, no remote attestation, no "secure" / marketplace wording
 * - Undeclared signature ≠ verified
 */
import { sha256HexBytes } from './content-pack-integrity.ts'

export type PackSignatureDecl = {
  alg: 'ed25519'
  /** Raw 32-byte public key as lowercase hex OR standard/base64url. */
  publicKey: string
  /** Raw 64-byte signature as lowercase hex OR standard/base64url. */
  sig: string
}

export type TrustedPublisherKey = {
  /** Optional human label (not used for crypto). */
  id?: string
  /** Raw 32-byte public key (hex or base64/base64url). */
  publicKey: string
  comment?: string
}

export type TrustedPublishers = {
  format: 'chipblocks-trusted-publishers'
  version: 1
  keys: TrustedPublisherKey[]
}

export type SignatureVerdict =
  | { kind: 'undeclared' }
  | {
      kind: 'valid-untrusted'
      publicKeyHex: string
      note: string
    }
  | {
      kind: 'valid-trusted'
      publicKeyHex: string
      trustedId?: string
      note: string
    }
  | { kind: 'invalid'; reason: string }

export const TRUST_NOTE_SIG_UNDECLARED =
  'No publisher signature was declared. Undeclared ≠ verified (ADR-010). Content-hash integrity (when present) is separate from publisher identity.'

export const TRUST_NOTE_SIG_VALID_UNTRUSTED =
  'ed25519 signature is cryptographically valid for the public key declared in the pack. That key is NOT in your trusted-publishers list — this is self-declared integrity under an author-chosen key, not publisher identity trust. No CA / PKI. Pin the key in trusted-publishers to treat it as verified against a key you chose.'

export const TRUST_NOTE_SIG_VALID_TRUSTED =
  'ed25519 signature verified against a public key pinned in your trusted-publishers list. Trust is only as strong as that local pin — no CA chain, no remote attestation, no marketplace guarantee.'

function stripAsciiWs(s: string): string {
  return s.replace(/\s+/g, '')
}

/** Decode hex or base64/base64url into bytes. Returns null on failure. */
export function decodeKeyOrSigBytes(raw: string, expectedLen: number): Uint8Array | null {
  const t = stripAsciiWs(raw.trim())
  if (t.length === 0) return null
  if (/^[a-f0-9]+$/i.test(t)) {
    if (t.length !== expectedLen * 2) return null
    const out = new Uint8Array(expectedLen)
    for (let i = 0; i < expectedLen; i++) {
      const byte = Number.parseInt(t.slice(i * 2, i * 2 + 2), 16)
      if (!Number.isFinite(byte)) return null
      out[i] = byte
    }
    return out
  }
  // base64 / base64url
  try {
    const b64 = t.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4))
    const bin = atob(pad)
    if (bin.length !== expectedLen) return null
    const out = new Uint8Array(expectedLen)
    for (let i = 0; i < expectedLen; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Pull an optional signature declaration from raw pack JSON. */
export function readDeclaredSignature(raw: unknown): PackSignatureDecl | { reason: string } | null {
  if (typeof raw !== 'object' || raw === null) return null
  if (!Object.hasOwn(raw as object, 'signature')) return null
  const signature = (raw as Record<string, unknown>).signature
  if (typeof signature !== 'object' || signature === null) {
    return { reason: 'Pack signature field is present but not an object — refused.' }
  }
  const s = signature as Record<string, unknown>
  if (typeof s.alg !== 'string' || s.alg.toLowerCase() !== 'ed25519') {
    return {
      reason: `Unsupported pack signature alg ${JSON.stringify(s.alg)} — only ed25519 is accepted.`,
    }
  }
  if (typeof s.publicKey !== 'string' || typeof s.sig !== 'string') {
    return {
      reason: 'Pack signature must declare string publicKey and sig (ed25519 raw key + signature).',
    }
  }
  const publicKey = s.publicKey.trim()
  const sig = s.sig.trim()
  if (publicKey === '' || sig === '') {
    return { reason: 'Pack signature publicKey/sig must be non-empty.' }
  }
  return { alg: 'ed25519', publicKey, sig }
}

const TRUSTED_TOP_FIELDS = new Set(['format', 'version', 'keys'])
const TRUSTED_KEY_FIELDS = new Set(['id', 'publicKey', 'comment'])

function unknownField(record: Record<string, unknown>, allowed: Set<string>): string | null {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return key
  }
  return null
}

/**
 * Strict reader for ~/.chipblocks/trusted-publishers.json.
 * A bad file is a refusal, not a shorter key list: one broken entry means no key from
 * that file is trusted. Callers then show the reason and skip the write.
 */
export function parseTrustedPublishers(text: string): TrustedPublishers | { reason: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { reason: 'trusted-publishers file is not valid JSON.' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { reason: 'trusted-publishers file is not a JSON object.' }
  }
  const f = raw as Record<string, unknown>
  const extra = unknownField(f, TRUSTED_TOP_FIELDS)
  if (extra !== null) {
    return { reason: `trusted-publishers file has unknown field ${JSON.stringify(extra)}.` }
  }
  if (f.format !== 'chipblocks-trusted-publishers') {
    return { reason: 'Not a chipblocks-trusted-publishers file (wrong or missing format).' }
  }
  if (f.version !== 1) {
    return {
      reason: `Unsupported trusted-publishers version ${String(f.version)} (this build reads 1).`,
    }
  }
  if (!Array.isArray(f.keys)) {
    return { reason: 'trusted-publishers file "keys" must be an array.' }
  }
  const keys: TrustedPublisherKey[] = []
  const seen = new Set<string>()
  for (let i = 0; i < f.keys.length; i++) {
    const entry = f.keys[i]
    const label = `Publisher key ${i + 1}`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { reason: `${label} is not an object.` }
    }
    const e = entry as Record<string, unknown>
    const extraKey = unknownField(e, TRUSTED_KEY_FIELDS)
    if (extraKey !== null) {
      return { reason: `${label} has unknown field ${JSON.stringify(extraKey)}.` }
    }
    if (typeof e.publicKey !== 'string' || e.publicKey.trim() === '') {
      return { reason: `${label} needs a publicKey string.` }
    }
    const rawBytes = decodeKeyOrSigBytes(e.publicKey, 32)
    if (rawBytes === null) {
      return {
        reason: `${label} publicKey must be 32 raw ed25519 bytes (64 hex characters or base64).`,
      }
    }
    const publicKey = bytesToHex(rawBytes)
    if (seen.has(publicKey)) {
      return { reason: `${label} repeats a public key already listed.` }
    }
    seen.add(publicKey)
    const key: TrustedPublisherKey = { publicKey }
    if (e.id !== undefined) {
      if (typeof e.id !== 'string' || e.id.trim() === '') {
        return { reason: `${label} id must be a non-empty string when present.` }
      }
      key.id = e.id.trim()
    }
    if (e.comment !== undefined) {
      if (typeof e.comment !== 'string' || e.comment.trim() === '') {
        return { reason: `${label} comment must be a non-empty string when present.` }
      }
      key.comment = e.comment.trim()
    }
    keys.push(key)
  }
  return { format: 'chipblocks-trusted-publishers', version: 1, keys }
}

export function isTrustedPublishers(
  value: TrustedPublishers | { reason: string },
): value is TrustedPublishers {
  return !('reason' in value)
}

export function serializeTrustedPublishers(publishers: TrustedPublishers): string {
  return JSON.stringify(
    {
      format: 'chipblocks-trusted-publishers' as const,
      version: 1 as const,
      keys: publishers.keys,
    },
    null,
    2,
  )
}

export type TrustedPublishersWrite =
  | { ok: true; text: string; publishers: TrustedPublishers }
  | { ok: false; reason: string }

function refuseUnreadableTrusted(parsed: { reason: string }): TrustedPublishersWrite {
  return {
    ok: false,
    reason: `${parsed.reason} Nothing was written, so the trusted-publishers file was left as it is.`,
  }
}

/** Canonical 32-byte hex for a declared public key, or null when it is not an ed25519 key. */
export function canonicalPublicKeyHex(publicKey: string): string | null {
  const bytes = decodeKeyOrSigBytes(publicKey, 32)
  if (bytes === null) return null
  return bytesToHex(bytes)
}

/**
 * SHA-256 of the raw 32-byte public key. Hex and base64 spellings of the same key share
 * one fingerprint. This is an identifier for the confirm dialog, not a certificate.
 */
export async function publisherKeyFingerprint(
  publicKey: string,
): Promise<string | { reason: string }> {
  const bytes = decodeKeyOrSigBytes(publicKey, 32)
  if (bytes === null) {
    return { reason: 'That publisher key is not 32 raw ed25519 bytes, so it has no fingerprint.' }
  }
  return sha256HexBytes(bytes)
}

/**
 * Add or replace one pin. `null` text means the file is not there yet, so this write creates it.
 * Text that does not parse is refused — a trust click must not replace a file it could not read.
 */
export function trustedPublishersAfterTrust(
  existingText: string | null,
  key: TrustedPublisherKey,
): TrustedPublishersWrite {
  const publicKey = canonicalPublicKeyHex(key.publicKey)
  if (publicKey === null) {
    return {
      ok: false,
      reason: 'That publisher key is not 32 raw ed25519 bytes. Nothing was written.',
    }
  }
  let publishers: TrustedPublishers
  if (existingText === null) {
    publishers = emptyTrustedPublishers()
  } else {
    const parsed = parseTrustedPublishers(existingText)
    if (!isTrustedPublishers(parsed)) return refuseUnreadableTrusted(parsed)
    publishers = parsed
  }
  const keys = publishers.keys.filter((pinned) => pinned.publicKey !== publicKey)
  const stored: TrustedPublisherKey = { publicKey }
  if (key.id !== undefined && key.id.trim() !== '') stored.id = key.id.trim()
  if (key.comment !== undefined && key.comment.trim() !== '') stored.comment = key.comment.trim()
  keys.push(stored)
  const next = emptyTrustedPublishers()
  next.keys = keys
  return { ok: true, text: serializeTrustedPublishers(next), publishers: next }
}

/**
 * Drop one pin. A missing file, or a file that does not parse, is refused — untrust must not
 * write a fresh empty list over a file this session could not read.
 */
export function trustedPublishersAfterUntrust(
  existingText: string | null,
  publicKeyRaw: string,
): TrustedPublishersWrite {
  if (existingText === null) {
    return {
      ok: false,
      reason: 'There is no trusted-publishers file to update. Nothing was written.',
    }
  }
  const parsed = parseTrustedPublishers(existingText)
  if (!isTrustedPublishers(parsed)) return refuseUnreadableTrusted(parsed)
  const publicKey = canonicalPublicKeyHex(publicKeyRaw)
  if (publicKey === null) {
    return {
      ok: false,
      reason: 'That publisher key is not 32 raw ed25519 bytes. Nothing was written.',
    }
  }
  const keys = parsed.keys.filter((pinned) => pinned.publicKey !== publicKey)
  if (keys.length === parsed.keys.length) {
    return {
      ok: false,
      reason: 'That publisher key is not pinned. Nothing was written.',
    }
  }
  const next = emptyTrustedPublishers()
  next.keys = keys
  return { ok: true, text: serializeTrustedPublishers(next), publishers: next }
}

export type TrustedPublisherCommit =
  | { ok: true; publishers: TrustedPublishers }
  | { ok: false; reason: string }

/**
 * Re-read the pin file, apply trust or untrust, then write. A read that throws never reaches
 * the writer. Serialized by the caller (one chain), same idea as the templates library.
 */
export async function commitTrustedPublisherChange(opts: {
  read: () => Promise<string | null>
  write: (text: string) => Promise<{ ok: boolean }>
  change: 'trust' | 'untrust'
  publicKey: string
  id?: string
  comment?: string
}): Promise<TrustedPublisherCommit> {
  let text: string | null
  try {
    text = await opts.read()
  } catch (error) {
    return {
      ok: false,
      reason: `trusted-publishers file could not be read (${String(error)}). Nothing was written.`,
    }
  }
  const key: TrustedPublisherKey = { publicKey: opts.publicKey }
  if (opts.id !== undefined) key.id = opts.id
  if (opts.comment !== undefined) key.comment = opts.comment
  const next =
    opts.change === 'trust'
      ? trustedPublishersAfterTrust(text, key)
      : trustedPublishersAfterUntrust(text, opts.publicKey)
  if (!next.ok) return next
  const written = await opts.write(next.text)
  if (!written.ok) {
    return {
      ok: false,
      reason:
        'The trusted-publishers file could not be saved. Nothing new was applied over the file.',
    }
  }
  return { ok: true, publishers: next.publishers }
}

export type LivePublisherTrust = 'none' | 'valid-untrusted' | 'valid-trusted'

/** Current pin list, not the status stored at install. Unloaded pins never count as trusted. */
export function livePublisherTrust(
  signatureStatus: 'none' | 'valid-untrusted' | 'valid-trusted' | undefined,
  publicKeyHex: string | undefined,
  trusted: TrustedPublishers,
  pinsLoaded: boolean,
): LivePublisherTrust {
  if (publicKeyHex === undefined || signatureStatus === undefined || signatureStatus === 'none') {
    return 'none'
  }
  if (!pinsLoaded) return 'valid-untrusted'
  const hex = publicKeyHex.toLowerCase()
  const pinned = trusted.keys.some((key) => key.publicKey === hex)
  return pinned ? 'valid-trusted' : 'valid-untrusted'
}

export function publisherTrustLabel(trust: LivePublisherTrust): string {
  if (trust === 'none') return 'No publisher signature on this pack. Undeclared is not verified.'
  if (trust === 'valid-trusted') {
    return 'Publisher signature is valid, and this key is pinned in trusted-publishers on this computer. The pin is the whole of the trust. There is no certificate authority.'
  }
  return 'Publisher signature is valid. This key is not pinned in trusted-publishers, so it is not treated as a publisher you chose.'
}

/**
 * What to do with a pin file the desktop app just read.
 * Missing file → no pins, and a later trust click may create the file.
 * Malformed or unreadable → no pins, and the caller must not write over that file.
 */
export function effectiveTrustedPublishers(
  text: string | null,
  readFailed?: string,
): { publishers: TrustedPublishers; pinsLoaded: boolean; status: string } {
  if (readFailed !== undefined) {
    return {
      publishers: emptyTrustedPublishers(),
      pinsLoaded: false,
      status: `Could not read ~/.chipblocks/trusted-publishers.json (${readFailed}). No publisher key is treated as pinned. Nothing will be written over that file.`,
    }
  }
  if (text === null) {
    return {
      publishers: emptyTrustedPublishers(),
      pinsLoaded: true,
      status:
        'No publisher keys are pinned. There is no ~/.chipblocks/trusted-publishers.json yet, or it lists none. No key is trusted by default.',
    }
  }
  const parsed = parseTrustedPublishers(text)
  if (!isTrustedPublishers(parsed)) {
    return {
      publishers: emptyTrustedPublishers(),
      pinsLoaded: false,
      status: `${parsed.reason} No publisher key from that file is trusted. Nothing will be written over it.`,
    }
  }
  const count = parsed.keys.length
  const status =
    count === 0
      ? 'No publisher keys are pinned. ~/.chipblocks/trusted-publishers.json lists none. No key is trusted by default.'
      : `${count} publisher key${count === 1 ? '' : 's'} pinned in ~/.chipblocks/trusted-publishers.json. Trust is only this local pin.`
  return { publishers: parsed, pinsLoaded: true, status }
}

export function emptyTrustedPublishers(): TrustedPublishers {
  return { format: 'chipblocks-trusted-publishers', version: 1, keys: [] }
}

function findTrusted(
  publicKeyHex: string,
  trusted: TrustedPublishers | undefined,
): TrustedPublisherKey | undefined {
  if (trusted === undefined) return undefined
  for (const k of trusted.keys) {
    const bytes = decodeKeyOrSigBytes(k.publicKey, 32)
    if (bytes === null) continue
    if (bytesToHex(bytes) === publicKeyHex) return k
  }
  return undefined
}

async function importEd25519PublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'Ed25519' },
    false,
    ['verify'],
  )
}

/**
 * Canonical body for signature verification — same strip as content-hash integrity
 * (drop top-level integrity + signature, JSON.stringify with null, 2).
 */
export function canonicalPackTextForSignature(packText: string): string | { reason: string } {
  let raw: unknown
  try {
    raw = JSON.parse(packText)
  } catch {
    return { reason: 'Pack text is not valid JSON — cannot check signature.' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { reason: 'Pack text is not a JSON object — cannot check signature.' }
  }
  const copy = { ...(raw as Record<string, unknown>) }
  delete copy.integrity
  delete copy.signature
  return JSON.stringify(copy, null, 2)
}

/**
 * Verify an optional pack publisher signature. Undeclared is not an error — it is simply
 * not verified. Invalid / malformed signatures refuse.
 */
export async function verifyPackSignature(
  packText: string,
  trusted?: TrustedPublishers,
): Promise<SignatureVerdict> {
  let raw: unknown
  try {
    raw = JSON.parse(packText)
  } catch {
    return { kind: 'invalid', reason: 'Pack text is not valid JSON — cannot check signature.' }
  }
  const declared = readDeclaredSignature(raw)
  if (declared === null) return { kind: 'undeclared' }
  if ('reason' in declared) return { kind: 'invalid', reason: declared.reason }

  const pubBytes = decodeKeyOrSigBytes(declared.publicKey, 32)
  if (pubBytes === null) {
    return {
      kind: 'invalid',
      reason:
        'Pack signature publicKey must be 32 raw ed25519 bytes (64 hex chars or base64/base64url).',
    }
  }
  const sigBytes = decodeKeyOrSigBytes(declared.sig, 64)
  if (sigBytes === null) {
    return {
      kind: 'invalid',
      reason:
        'Pack signature sig must be 64 raw ed25519 bytes (128 hex chars or base64/base64url).',
    }
  }

  const canonical = canonicalPackTextForSignature(packText)
  if (typeof canonical !== 'string') {
    return { kind: 'invalid', reason: canonical.reason }
  }

  let key: CryptoKey
  try {
    key = await importEd25519PublicKey(pubBytes)
  } catch {
    return { kind: 'invalid', reason: 'Could not import the declared ed25519 public key.' }
  }

  const data = new TextEncoder().encode(canonical)
  let ok = false
  try {
    ok = await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      sigBytes as BufferSource,
      data,
    )
  } catch {
    return { kind: 'invalid', reason: 'ed25519 signature verification failed (crypto error).' }
  }
  if (!ok) {
    return {
      kind: 'invalid',
      reason:
        'Pack ed25519 signature does not verify over the canonical pack body (integrity/signature stripped). Install refused.',
    }
  }

  const publicKeyHex = bytesToHex(pubBytes)
  const pinned = findTrusted(publicKeyHex, trusted)
  if (pinned !== undefined) {
    const trustedVerdict: Extract<SignatureVerdict, { kind: 'valid-trusted' }> = {
      kind: 'valid-trusted',
      publicKeyHex,
      note: TRUST_NOTE_SIG_VALID_TRUSTED,
    }
    if (pinned.id !== undefined) trustedVerdict.trustedId = pinned.id
    return trustedVerdict
  }
  return {
    kind: 'valid-untrusted',
    publicKeyHex,
    note: TRUST_NOTE_SIG_VALID_UNTRUSTED,
  }
}

/** Test / tooling helper: sign canonical body with a CryptoKeyPair's private key. */
export async function signPackBodyHex(
  canonicalBody: string,
  privateKey: CryptoKey,
): Promise<string> {
  const data = new TextEncoder().encode(canonicalBody)
  const sig = await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, privateKey, data)
  return bytesToHex(new Uint8Array(sig))
}

export async function exportRawPublicKeyHex(publicKey: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', publicKey))
  return bytesToHex(raw)
}

export function trustNoteForSignature(verdict: SignatureVerdict): string {
  if (verdict.kind === 'undeclared') return TRUST_NOTE_SIG_UNDECLARED
  if (verdict.kind === 'valid-trusted') return verdict.note
  if (verdict.kind === 'valid-untrusted') return verdict.note
  return verdict.reason
}
