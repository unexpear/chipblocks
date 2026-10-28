/**
 * Publisher key rotation: a publisher moves a pack to a new signing key with a statement signed by
 * the old key (and countersigned by the new one), so someone who pinned the old key can follow the
 * change without trusting an unknown key blindly.
 *
 * Statement (one link), carried in the pack's `signature.rotations` array, oldest link first:
 *   {
 *     "format": "chipblocks-key-rotation", "version": 1,
 *     "oldKey": <64 hex: raw ed25519 public key being retired>,
 *     "newKey": <64 hex: raw ed25519 public key taking over>,
 *     "packIds": [<pack ids this rotation covers>],
 *     "sequence": <integer >= 1, rises with each rotation the old key signs>,
 *     "issuedAt": <ISO 8601 UTC time, e.g. 2026-10-27T20:00:00Z>,
 *     "sig": <128 hex: ed25519 by oldKey over the signing text>,
 *     "newKeySig": <128 hex: ed25519 by newKey over the same text, proving it holds the new key>
 *   }
 * Signing text: "chipblocks-key-rotation-v1\n" + JSON.stringify of format, version, oldKey,
 * newKey, packIds (sorted, unique), sequence, issuedAt, in that order, no spaces.
 * `signature.rotations` sits inside the pack's signature object, which the pack signature and
 * the content hash both leave out, so attaching a rotation does not change the signed pack body.
 *
 * Acceptance never changes trust by itself: a valid rotation from a pinned key only lets the pack
 * install (instead of the pinned-key-change refusal) and makes the Content Manager ask you to
 * confirm the new key. Nothing is pinned until you confirm.
 */
import { decodeKeyOrSigBytes } from './content-pack-signature.ts'
import { emptyRotationState, mergeRotationState, type RotationState } from './rotation-state.ts'

export { emptyRotationState, type RotationState }

export const KEY_ROTATION_FORMAT = 'chipblocks-key-rotation'
export const KEY_ROTATION_VERSION = 1
export const KEY_ROTATION_DOMAIN = 'chipblocks-key-rotation-v1\n'
export const MAX_ROTATION_LINKS = 8
/** A statement dated later than this past the local clock is refused. */
export const ROTATION_CLOCK_SKEW_MS = 5 * 60 * 1000

export type KeyRotationStatement = {
  format: typeof KEY_ROTATION_FORMAT
  version: typeof KEY_ROTATION_VERSION
  oldKey: string
  newKey: string
  packIds: string[]
  sequence: number
  issuedAt: string
  sig: string
  newKeySig: string
}

export type RotationLink = { oldKey: string; newKey: string; sequence: number }

export type RotationVerdict =
  /** The pack carries no rotation. */
  | { kind: 'none' }
  /** Malformed, forged, edited, out of scope, or not ending at the pack's signing key. */
  | { kind: 'broken'; reason: string }
  /** Verifies, but no key in the chain is pinned here, so it means nothing on this computer. */
  | { kind: 'unanchored'; reason: string }
  /** The pack's signing key is already pinned: nothing to confirm. */
  | { kind: 'current' }
  /** Starts at a pinned key, but replays an old rotation or returns to a retired key. */
  | { kind: 'refused'; reason: string }
  /** Starts at pinned `fromKey` and ends at the pack's key `toKey`. Needs your confirmation. */
  | { kind: 'valid'; fromKey: string; toKey: string; links: RotationLink[] }

const FIELDS = [
  'format',
  'version',
  'oldKey',
  'newKey',
  'packIds',
  'sequence',
  'issuedAt',
  'sig',
  'newKeySig',
] as const
const HEX32 = /^[0-9a-f]{64}$/
const HEX64 = /^[0-9a-f]{128}$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

export function rotationSigningText(s: {
  oldKey: string
  newKey: string
  packIds: readonly string[]
  sequence: number
  issuedAt: string
}): string {
  const packIds = [...new Set(s.packIds)].sort()
  return `${KEY_ROTATION_DOMAIN}${JSON.stringify({
    format: KEY_ROTATION_FORMAT,
    version: KEY_ROTATION_VERSION,
    oldKey: s.oldKey,
    newKey: s.newKey,
    packIds,
    sequence: s.sequence,
    issuedAt: s.issuedAt,
  })}`
}

/** `signature.rotations` of raw pack JSON: null when absent, a reason when it is not an array. */
export function readDeclaredRotations(rawPack: unknown): unknown[] | { reason: string } | null {
  if (typeof rawPack !== 'object' || rawPack === null) return null
  const signature = (rawPack as Record<string, unknown>).signature
  if (typeof signature !== 'object' || signature === null) return null
  if (!Object.hasOwn(signature, 'rotations')) return null
  const rotations = (signature as Record<string, unknown>).rotations
  if (!Array.isArray(rotations)) return { reason: 'signature.rotations must be an array.' }
  return rotations
}

function parseStatement(raw: unknown, n: number): KeyRotationStatement | { reason: string } {
  const label = `Key rotation ${n}`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { reason: `${label} is not an object.` }
  }
  const r = raw as Record<string, unknown>
  for (const key of Object.keys(r)) {
    if (!(FIELDS as readonly string[]).includes(key)) {
      return { reason: `${label} has unknown field ${JSON.stringify(key)}.` }
    }
  }
  if (r.format !== KEY_ROTATION_FORMAT || r.version !== KEY_ROTATION_VERSION) {
    return { reason: `${label} is not a ${KEY_ROTATION_FORMAT} version 1 statement.` }
  }
  if (typeof r.oldKey !== 'string' || !HEX32.test(r.oldKey)) {
    return { reason: `${label} oldKey must be 64 lowercase hex characters (a raw ed25519 key).` }
  }
  if (typeof r.newKey !== 'string' || !HEX32.test(r.newKey)) {
    return { reason: `${label} newKey must be 64 lowercase hex characters (a raw ed25519 key).` }
  }
  if (
    !Array.isArray(r.packIds) ||
    r.packIds.length === 0 ||
    !r.packIds.every((id) => typeof id === 'string' && id !== '')
  ) {
    return { reason: `${label} packIds must be a non-empty list of pack ids.` }
  }
  if (typeof r.sequence !== 'number' || !Number.isSafeInteger(r.sequence) || r.sequence < 1) {
    return { reason: `${label} sequence must be a whole number of 1 or more.` }
  }
  if (
    typeof r.issuedAt !== 'string' ||
    !ISO_UTC.test(r.issuedAt) ||
    Number.isNaN(Date.parse(r.issuedAt))
  ) {
    return {
      reason: `${label} issuedAt must be an ISO 8601 UTC time such as 2026-10-27T20:00:00Z.`,
    }
  }
  if (typeof r.sig !== 'string' || !HEX64.test(r.sig)) {
    return { reason: `${label} sig must be 128 lowercase hex characters (an ed25519 signature).` }
  }
  if (typeof r.newKeySig !== 'string' || !HEX64.test(r.newKeySig)) {
    return {
      reason: `${label} newKeySig must be 128 lowercase hex characters (the new key's countersignature).`,
    }
  }
  return r as unknown as KeyRotationStatement
}

async function ed25519Verify(publicKeyHex: string, sigHex: string, text: string): Promise<boolean> {
  const key = decodeKeyOrSigBytes(publicKeyHex, 32)
  const sig = decodeKeyOrSigBytes(sigHex, 64)
  if (key === null || sig === null) return false
  try {
    const imported = await globalThis.crypto.subtle.importKey(
      'raw',
      key as BufferSource,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    return await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      imported,
      sig as BufferSource,
      new TextEncoder().encode(text),
    )
  } catch {
    return false
  }
}

const short = (hex: string) => `${hex.slice(0, 16)}…`

/**
 * Check a pack's rotation chain. `signerKeyHex` is the key whose signature over the pack already
 * verified. `pinned` holds the pinned keys (canonical hex) that the seal vouches for.
 */
export async function verifyRotationChain(args: {
  packId: string
  signerKeyHex: string
  rotations: unknown
  pinned: ReadonlySet<string>
  state: RotationState | null
  now?: number
}): Promise<RotationVerdict> {
  if (args.rotations === null || args.rotations === undefined) return { kind: 'none' }
  if (!Array.isArray(args.rotations)) {
    return { kind: 'broken', reason: 'signature.rotations must be an array.' }
  }
  const list = args.rotations
  if (list.length === 0) return { kind: 'none' }
  if (list.length > MAX_ROTATION_LINKS) {
    return {
      kind: 'broken',
      reason: `The key rotation chain has ${list.length} links; at most ${MAX_ROTATION_LINKS} are read.`,
    }
  }
  const now = args.now ?? Date.now()
  const links: KeyRotationStatement[] = []
  for (let i = 0; i < list.length; i++) {
    const parsed = parseStatement(list[i], i + 1)
    if ('reason' in parsed) return { kind: 'broken', reason: parsed.reason }
    links.push(parsed)
  }
  const seen = new Set<string>()
  let previousTime = Number.NEGATIVE_INFINITY
  for (let i = 0; i < links.length; i++) {
    const link = links[i] as KeyRotationStatement
    const n = i + 1
    if (link.oldKey === link.newKey) {
      return { kind: 'broken', reason: `Key rotation ${n} rotates a key to itself.` }
    }
    if (i > 0 && link.oldKey !== (links[i - 1] as KeyRotationStatement).newKey) {
      return {
        kind: 'broken',
        reason: `Key rotation ${n} does not start at the key rotation ${i} moved to, so the chain is broken.`,
      }
    }
    if (i === 0) seen.add(link.oldKey)
    if (seen.has(link.newKey)) {
      return {
        kind: 'broken',
        reason: `Key rotation ${n} goes back to a key earlier in the chain (${short(link.newKey)}). A rotation only moves forward.`,
      }
    }
    seen.add(link.newKey)
    if (!link.packIds.includes(args.packId)) {
      return {
        kind: 'broken',
        reason: `Key rotation ${n} covers ${link.packIds.map((id) => `"${id}"`).join(', ')}, not "${args.packId}".`,
      }
    }
    const at = Date.parse(link.issuedAt)
    if (at > now + ROTATION_CLOCK_SKEW_MS) {
      return {
        kind: 'broken',
        reason: `Key rotation ${n} is dated in the future (${link.issuedAt}).`,
      }
    }
    if (at < previousTime) {
      return {
        kind: 'broken',
        reason: `Key rotation ${n} is dated before the rotation it follows.`,
      }
    }
    previousTime = at
    const text = rotationSigningText(link)
    if (!(await ed25519Verify(link.oldKey, link.sig, text))) {
      return {
        kind: 'broken',
        reason: `Key rotation ${n} is not signed by the key it retires (${short(link.oldKey)}): it was forged or edited after signing.`,
      }
    }
    if (!(await ed25519Verify(link.newKey, link.newKeySig, text))) {
      return {
        kind: 'broken',
        reason: `Key rotation ${n} is not countersigned by the new key (${short(link.newKey)}), so it does not prove the publisher holds that key.`,
      }
    }
  }
  const last = links[links.length - 1] as KeyRotationStatement
  if (last.newKey !== args.signerKeyHex) {
    return {
      kind: 'broken',
      reason: `The key rotation chain ends at ${short(last.newKey)}, not at the key that signed this pack (${short(args.signerKeyHex)}).`,
    }
  }
  if (args.pinned.has(args.signerKeyHex)) return { kind: 'current' }
  // Start from the newest pinned key in the chain: links before it were already followed.
  let start = -1
  for (let i = links.length - 1; i >= 0; i--) {
    if (args.pinned.has((links[i] as KeyRotationStatement).oldKey)) {
      start = i
      break
    }
  }
  if (start < 0) {
    return {
      kind: 'unanchored',
      reason:
        'No key in this pack’s key rotation chain is pinned on this computer, so the rotation does not lead back to a publisher you pinned.',
    }
  }
  const used = links.slice(start)
  const state = args.state ?? emptyRotationState()
  const retired = new Set(state.retired)
  for (const link of used) {
    if (retired.has(link.newKey)) {
      return {
        kind: 'refused',
        reason: `The key rotation moves to ${short(link.newKey)}, a key you already rotated away from on this computer. Going back to a retired key is refused.`,
      }
    }
    const lastSeq = state.sequences[link.oldKey]
    if (lastSeq !== undefined && link.sequence <= lastSeq) {
      return {
        kind: 'refused',
        reason: `The key rotation from ${short(link.oldKey)} has sequence ${link.sequence}, but sequence ${lastSeq} from that key was already accepted here. An old or reused rotation is refused.`,
      }
    }
  }
  return {
    kind: 'valid',
    fromKey: (used[0] as KeyRotationStatement).oldKey,
    toKey: last.newKey,
    links: used.map((l) => ({ oldKey: l.oldKey, newKey: l.newKey, sequence: l.sequence })),
  }
}

/** Rotation from the pack text on disk (signed original). Never throws. */
export async function rotationForPackText(args: {
  packId: string
  signerKeyHex: string
  packText: string
  pinned: ReadonlySet<string>
  state: RotationState | null
  now?: number
}): Promise<RotationVerdict> {
  let raw: unknown
  try {
    raw = JSON.parse(args.packText)
  } catch {
    return { kind: 'none' }
  }
  const declared = readDeclaredRotations(raw)
  if (declared === null) return { kind: 'none' }
  if (!Array.isArray(declared)) {
    return { kind: 'broken', reason: declared.reason }
  }
  return verifyRotationChain({ ...args, rotations: declared })
}

/** Rotation state after you confirm: retire what you moved away from, remember each sequence. */
export function rotationStateAfterConfirm(
  state: RotationState | null,
  links: readonly RotationLink[],
  retire: readonly string[],
): RotationState {
  const sequences: Record<string, number> = {}
  for (const link of links) {
    sequences[link.oldKey] = Math.max(sequences[link.oldKey] ?? 0, link.sequence)
  }
  return mergeRotationState(state, { retired: [...retire], sequences })
}
