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

export function parseTrustedPublishers(text: string): TrustedPublishers | { reason: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { reason: 'trusted-publishers file is not valid JSON.' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { reason: 'trusted-publishers file is not a JSON object.' }
  }
  const f = raw as Record<string, unknown>
  if (f.format !== 'chipblocks-trusted-publishers') {
    return { reason: 'Not a chipblocks-trusted-publishers file (wrong or missing format).' }
  }
  if (f.version !== 1) {
    return {
      reason: `Unsupported trusted-publishers version ${String(f.version)} (this build reads 1).`,
    }
  }
  const list = Array.isArray(f.keys) ? f.keys : []
  const keys: TrustedPublisherKey[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.publicKey !== 'string' || e.publicKey.trim() === '') continue
    const key: TrustedPublisherKey = { publicKey: e.publicKey.trim() }
    if (typeof e.id === 'string' && e.id.trim() !== '') key.id = e.id.trim()
    if (typeof e.comment === 'string' && e.comment.trim() !== '') key.comment = e.comment.trim()
    keys.push(key)
  }
  return { format: 'chipblocks-trusted-publishers', version: 1, keys }
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
