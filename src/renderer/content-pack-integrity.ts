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
 * - Cryptographic publisher signatures (ADR-010 still open) — a `signature` field is ignored
 *   as proof and called out in the trust note if present
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

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Pull an optional integrity declaration from raw pack JSON (before/without full deserialize). */
export function readDeclaredIntegrity(raw: unknown): PackIntegrityDecl | null {
  if (typeof raw !== 'object' || raw === null) return null
  const integrity = (raw as Record<string, unknown>).integrity
  if (typeof integrity !== 'object' || integrity === null) return null
  const i = integrity as Record<string, unknown>
  if (typeof i.alg !== 'string' || typeof i.hash !== 'string') return null
  if (i.alg.toLowerCase() !== 'sha256') return null
  const hash = i.hash.trim().toLowerCase()
  if (!HEX64.test(hash)) return null
  return { alg: 'sha256', hash }
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
  'Installed from a local file you chose. Format and license were validated. A signature field was present but is NOT verified in this build (ADR-010 pending) — it is ignored as proof. A SHA-256 of the installed file is recorded for tamper-evidence on reload. Treat the pack as trusted as the file you picked.'

export function trustNoteForVerdict(verdict: IntegrityVerdict): string {
  if (verdict.kind === 'match') return TRUST_NOTE_HASH_MATCH
  if (verdict.kind === 'undeclared' && verdict.signatureFieldPresent) {
    return TRUST_NOTE_UNDECLARED_WITH_SIGNATURE_FIELD
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
