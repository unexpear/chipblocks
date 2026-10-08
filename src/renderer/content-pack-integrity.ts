/**
 * Pack content-hash integrity — the smallest honest trust step beyond format + license.
 *
 * What this DOES:
 * - SHA-256 of pack text (Web Crypto) for local tamper-evidence after install
 * - Optional pack-declared `integrity: { alg: "sha256", hash }` checked at install
 *   against a canonical serialize of the pack with the integrity field stripped
 * - Clear trust notes: verified hash ≠ publisher signature ≠ remote trust
 *
 * What this REFUSES / does not claim:
 * - Publisher identity by itself — see content-pack-signature.ts for ed25519 verify;
 *   this module only handles content hashes. A `signature` field is stripped from the
 *   hash body and is NOT treated as a content-hash substitute
 * - Silent trust of remote/arbitrary code (remote install stays refused in content-manager)
 * - Any "secure" / marketplace attestation wording
 */
export type PackIntegrityDecl = {
  alg: 'sha256'
  hash: string
}

export type IntegrityVerdict =
  | { kind: 'match'; hash: string }
  | { kind: 'undeclared'; hash: string; signatureFieldPresent: boolean }
  | { kind: 'mismatch'; hash: string; declared: string; reason: string }
  | { kind: 'unsupported'; hash: string; reason: string }

const HEX64 = /^[a-f0-9]{64}$/i

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const buf = await globalThis.crypto.subtle.digest('SHA-256', copy)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(text: string): Promise<string> {
  return sha256HexBytes(new TextEncoder().encode(text))
}

/**
 * Pull an optional integrity declaration from raw pack JSON.
 * No `integrity` key → null (undeclared, install allowed).
 * A present but unusable declaration → `{ reason }` (unsupported — install must refuse).
 * A usable sha256 declaration → the hash to check.
 */
export function readDeclaredIntegrity(raw: unknown): PackIntegrityDecl | { reason: string } | null {
  if (typeof raw !== 'object' || raw === null) return null
  if (!Object.hasOwn(raw as object, 'integrity')) return null
  const integrity = (raw as Record<string, unknown>).integrity
  if (typeof integrity !== 'object' || integrity === null) {
    return { reason: 'Pack integrity field is present but not an object — refused.' }
  }
  const i = integrity as Record<string, unknown>
  if (typeof i.alg !== 'string' || i.alg.toLowerCase() !== 'sha256') {
    return {
      reason: `Unsupported pack integrity alg ${JSON.stringify(i.alg)} — only sha256 is accepted.`,
    }
  }
  if (typeof i.hash !== 'string' || !HEX64.test(i.hash.trim().toLowerCase())) {
    return { reason: 'Pack integrity hash must be 64 hex characters (SHA-256).' }
  }
  return { alg: 'sha256', hash: i.hash.trim().toLowerCase() }
}

export function packHasSignatureField(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  return Object.hasOwn(raw as object, 'signature')
}

/**
 * Canonical body for a declared-integrity check: parse JSON, drop `integrity` + `signature`,
 * re-stringify with stable key order via JSON.stringify of a sorted shallow copy is NOT enough
 * for nested objects — so we hash the UTF-8 of the file with those top-level keys removed by
 * regenerating from a JSON.parse → delete → JSON.stringify(…, null, 2) of the remaining object.
 * Authors should compute the declared hash the same way (see tests).
 */
export function canonicalPackTextForIntegrity(packText: string): string | { reason: string } {
  let raw: unknown
  try {
    raw = JSON.parse(packText)
  } catch {
    return { reason: 'Pack text is not valid JSON — cannot check integrity.' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { reason: 'Pack text is not a JSON object — cannot check integrity.' }
  }
  const copy = { ...(raw as Record<string, unknown>) }
  delete copy.integrity
  delete copy.signature
  return JSON.stringify(copy, null, 2)
}

export async function verifyPackIntegrity(packText: string): Promise<IntegrityVerdict> {
  const fileHash = await sha256Hex(packText)
  let raw: unknown
  try {
    raw = JSON.parse(packText)
  } catch {
    return {
      kind: 'unsupported',
      hash: fileHash,
      reason: 'Pack text is not valid JSON — cannot check integrity.',
    }
  }
  const signatureFieldPresent = packHasSignatureField(raw)
  const declared = readDeclaredIntegrity(raw)
  if (declared === null) {
    return { kind: 'undeclared', hash: fileHash, signatureFieldPresent }
  }
  if ('reason' in declared) {
    return { kind: 'unsupported', hash: fileHash, reason: declared.reason }
  }

  const canonical = canonicalPackTextForIntegrity(packText)
  if (typeof canonical !== 'string') {
    return { kind: 'unsupported', hash: fileHash, reason: canonical.reason }
  }
  const bodyHash = await sha256Hex(canonical)
  if (bodyHash !== declared.hash) {
    return {
      kind: 'mismatch',
      hash: fileHash,
      declared: declared.hash,
      reason: `Declared integrity hash does not match the pack body (SHA-256 of the pack with integrity/signature stripped). Expected ${declared.hash}, got ${bodyHash}.`,
    }
  }
  return { kind: 'match', hash: fileHash }
}

export const TRUST_NOTE_HASH_MATCH =
  'Local content hash checked: declared SHA-256 matched the pack body. This is file integrity only — not a publisher signature and not remote trust.'

export const TRUST_NOTE_UNDECLARED =
  'Installed from a local file you chose. Format and license were validated; no content-hash declaration was present. A SHA-256 of the installed file is recorded for tamper-evidence on reload. Not a publisher signature (ADR-010). Treat the pack as trusted as the file you picked.'

export const TRUST_NOTE_UNDECLARED_WITH_SIGNATURE_FIELD =
  'Installed from a local file you chose. Format and license were validated; no content-hash declaration was present. A signature field is present — publisher-signature verification is handled separately (content-pack-signature). A SHA-256 of the installed file is recorded for tamper-evidence on reload. Treat the pack as trusted as the file you picked.'

export function trustNoteForVerdict(verdict: IntegrityVerdict): string {
  if (verdict.kind === 'match') return TRUST_NOTE_HASH_MATCH
  // Signature presence is handled by content-pack-signature trust notes; keep the hash note
  // focused on file integrity (signatureFieldPresent is still exposed on the verdict for callers).
  if (verdict.kind === 'undeclared' && verdict.signatureFieldPresent) {
    return TRUST_NOTE_UNDECLARED
  }
  return TRUST_NOTE_UNDECLARED
}

/** Reload check: installed file must still match the hash recorded at install. */
export type ContentHashCheck =
  | { ok: true; hash: string; legacyMissingHash?: boolean }
  | { ok: false; reason: string }

export async function assertStoredContentHash(
  packText: string,
  expectedHash: string | undefined,
): Promise<ContentHashCheck> {
  const hash = await sha256Hex(packText)
  if (expectedHash === undefined || expectedHash.trim() === '') {
    // Legacy index row: load is allowed, but do not silently pretend integrity was checked.
    return {
      ok: true,
      hash,
      legacyMissingHash: true,
    }
  }
  if (hash !== expectedHash.toLowerCase()) {
    return {
      ok: false,
      reason: `Pack file no longer matches the SHA-256 recorded at install (tamper or edit). Recorded ${expectedHash.toLowerCase()}, got ${hash}. Pack left unloaded.`,
    }
  }
  return { ok: true, hash }
}
