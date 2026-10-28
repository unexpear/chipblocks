/**
 * Re-verify an installed pack's publisher signature from the file on disk.
 *
 * A signed pack is installed as the exact signed original (pack body + `signature` with the
 * signer's public key), so its trust can be checked again on every load. The trust fields in
 * index.json are only a claim made at install: they never make a pack trusted by themselves.
 * Anyone who can write ~/.chipblocks can edit index.json, but cannot make an edited pack
 * verify under a key they do not hold.
 */
import type { InstalledPackRecord } from './content-manager.ts'
import {
  type LivePublisherTrust,
  readDeclaredSignature,
  type TrustedPublishers,
  verifyPackSignature,
} from './content-pack-signature.ts'

export type StoredSignature =
  | { kind: 'unsigned' }
  | { kind: 'verified'; publicKeyHex: string }
  | { kind: 'unverified'; reason: string }

/** Shown for packs installed before the signed original was kept, and for a stripped signature. */
export const STORED_SIGNATURE_MISSING =
  'The install record says this pack was signed, but its pack file carries no signature. Packs installed before ChipBlocks kept the signed original need a reinstall to re-verify; otherwise the pack file or the install index was edited. Treated as untrusted.'

function claimsSignature(record: InstalledPackRecord): boolean {
  return (
    record.signatureStatus === 'valid-trusted' ||
    record.signatureStatus === 'valid-untrusted' ||
    record.publisherKeyHex !== undefined
  )
}

/**
 * What the pack file on disk proves right now. `text` is the pack.json text, or null when it
 * could not be read. Never throws.
 */
export async function verifyStoredSignature(
  record: InstalledPackRecord,
  text: string | null,
): Promise<StoredSignature> {
  const claims = claimsSignature(record)
  if (text === null) {
    return claims
      ? {
          kind: 'unverified',
          reason:
            'The pack file could not be read, so its publisher signature was not checked. Treated as untrusted.',
        }
      : { kind: 'unsigned' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return claims
      ? {
          kind: 'unverified',
          reason:
            'The pack file is not valid JSON, so its publisher signature was not checked. Treated as untrusted.',
        }
      : { kind: 'unsigned' }
  }
  const declared = readDeclaredSignature(raw)
  if (declared === null) {
    return claims ? { kind: 'unverified', reason: STORED_SIGNATURE_MISSING } : { kind: 'unsigned' }
  }
  if (typeof raw !== 'object' || raw === null || (raw as { id?: unknown }).id !== record.id) {
    return {
      kind: 'unverified',
      reason: `The signed pack file is not for "${record.id}". The pack file or the install index was edited. Treated as untrusted. Reinstall it from a file you trust.`,
    }
  }
  let verdict: Awaited<ReturnType<typeof verifyPackSignature>>
  try {
    verdict = await verifyPackSignature(text)
  } catch (error) {
    return {
      kind: 'unverified',
      reason: `The publisher signature could not be checked (${String(error)}). Treated as untrusted.`,
    }
  }
  if (verdict.kind === 'invalid') {
    return {
      kind: 'unverified',
      reason: `The pack file no longer matches its publisher signature, so it was edited after install. ${verdict.reason.replace(/ Install refused\.$/, '')} Treated as untrusted. Reinstall it from a file you trust.`,
    }
  }
  if (verdict.kind === 'undeclared') {
    return claims ? { kind: 'unverified', reason: STORED_SIGNATURE_MISSING } : { kind: 'unsigned' }
  }
  const recorded = record.publisherKeyHex?.toLowerCase()
  if (recorded !== undefined && recorded !== verdict.publicKeyHex) {
    return {
      kind: 'unverified',
      reason:
        'The pack file is signed by a different publisher key than the one recorded at install. The pack file or the install index was edited. Treated as untrusted. Reinstall it from a file you trust.',
    }
  }
  return { kind: 'verified', publicKeyHex: verdict.publicKeyHex }
}

/** Trust to show now: from the verified signature and the pin list, never from index fields. */
export function liveTrustFromStored(
  stored: StoredSignature,
  trusted: TrustedPublishers,
  pinsLoaded: boolean,
): LivePublisherTrust {
  if (stored.kind === 'unsigned') return 'none'
  if (stored.kind === 'unverified') return 'unverified'
  if (!pinsLoaded) return 'valid-untrusted'
  return trusted.keys.some((key) => key.publicKey.toLowerCase() === stored.publicKeyHex)
    ? 'valid-trusted'
    : 'valid-untrusted'
}
