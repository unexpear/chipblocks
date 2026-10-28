/**
 * The trust seal: ~/.chipblocks/trust-seal.json, written only by ChipBlocks, beside the pin list.
 *
 * It holds the SHA-256 of trusted-publishers.json as ChipBlocks last saved it, and per pack the
 * highest version ever installed through ChipBlocks (the rollback floor). With OS-protected
 * storage (Electron safeStorage: DPAPI on Windows, the Keychain on macOS, the Secret Service on
 * Linux) the payload is encrypted with the OS-protected key, an authenticated cipher, so it
 * cannot be read or forged by editing files.
 *
 * What it stops: an edit of trusted-publishers.json (or of a pack's version) made outside
 * ChipBlocks by a person, a script, a sync or backup tool, or a program that can write the home
 * folder but does not run as you with access to your OS key store. Such an edit is detected and
 * the pins are treated as untrusted, with the reason shown.
 * What it does not stop: malware running as you, which can ask the OS to decrypt or encrypt with
 * the same key the app uses; or putting back an older set of all three files (pins, seal, pack)
 * that ChipBlocks itself wrote earlier. When OS-protected storage is not available the payload is
 * stored in the clear and only catches accidental edits; the app says so.
 */
import { createHash } from 'node:crypto'
import { comparePackVersions } from '../src/renderer/pack-version.ts'
import {
  isRotationState,
  mergeRotationState,
  type RotationState,
} from '../src/renderer/rotation-state.ts'
import type { PinsSeal, TrustSealView } from '../src/renderer/trust-seal-view.ts'

export type { PinsSeal, TrustSealView }

export const TRUST_SEAL_FORMAT = 'chipblocks-trust-seal'
export const TRUST_SEAL_VERSION = 1

export type SealCrypto = {
  /** OS-protected encryption is available right now (not Linux's plain-text fallback). */
  available: () => boolean
  encrypt: (plain: string) => Uint8Array
  decrypt: (blob: Uint8Array) => string
}

export type SealPayload = {
  /** SHA-256 of trusted-publishers.json as last saved by ChipBlocks; null = not vouched for. */
  pinsSha256: string | null
  /** Highest version of each installed pack ever installed through ChipBlocks. */
  floors: Record<string, string>
  /**
   * Publisher key rotations you confirmed: keys rotated away from, and the highest sequence
   * accepted per old key. Absent in seals written before key rotation (read as none).
   */
  rotation?: RotationState
}

export type SealState =
  | { kind: 'ok'; protection: 'os' | 'none'; payload: SealPayload }
  | { kind: 'missing' }
  | { kind: 'broken'; reason: string }

export const SEAL_MISSING =
  'trusted-publishers.json has no seal from ChipBlocks: it was saved by an older ChipBlocks, or the seal file (trust-seal.json) was removed.'
export const SEAL_PINS_CHANGED =
  'trusted-publishers.json was changed outside ChipBlocks since ChipBlocks last saved it (it no longer matches the seal in trust-seal.json).'
export const SEAL_UNOPENABLE =
  "The seal in trust-seal.json could not be opened with this computer's OS-protected storage. It was edited, copied from another computer or account, or the app's data folder was reset."
export const SEAL_OS_UNAVAILABLE =
  "This computer's OS-protected storage is not available right now, so the seal in trust-seal.json could not be opened."
export const SEAL_DOWNGRADED =
  'The seal in trust-seal.json was saved without OS protection although this computer has it, so it proves nothing.'

export const sha256Text = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

function isPayload(raw: unknown): raw is SealPayload {
  if (typeof raw !== 'object' || raw === null) return false
  const p = raw as Record<string, unknown>
  if (
    p.pinsSha256 !== null &&
    (typeof p.pinsSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.pinsSha256))
  )
    return false
  if (typeof p.floors !== 'object' || p.floors === null || Array.isArray(p.floors)) return false
  if (p.rotation !== undefined && !isRotationState(p.rotation)) return false
  return Object.values(p.floors).every((v) => typeof v === 'string')
}

export function readSeal(text: string | null, crypto: SealCrypto): SealState {
  if (text === null) return { kind: 'missing' }
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { kind: 'broken', reason: 'trust-seal.json is not valid JSON.' }
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    raw.format !== TRUST_SEAL_FORMAT ||
    raw.version !== TRUST_SEAL_VERSION ||
    (raw.protection !== 'os' && raw.protection !== 'none') ||
    typeof raw.sealed !== 'string'
  ) {
    return { kind: 'broken', reason: 'trust-seal.json is not a ChipBlocks trust seal.' }
  }
  const blob = Buffer.from(raw.sealed, 'base64')
  let plain: string
  if (raw.protection === 'os') {
    if (!crypto.available()) return { kind: 'broken', reason: SEAL_OS_UNAVAILABLE }
    try {
      plain = crypto.decrypt(blob)
    } catch {
      return { kind: 'broken', reason: SEAL_UNOPENABLE }
    }
  } else {
    plain = blob.toString('utf8')
  }
  let payload: unknown
  try {
    payload = JSON.parse(plain)
  } catch {
    return { kind: 'broken', reason: SEAL_UNOPENABLE }
  }
  if (!isPayload(payload)) return { kind: 'broken', reason: SEAL_UNOPENABLE }
  return {
    kind: 'ok',
    protection: raw.protection,
    payload: {
      pinsSha256: payload.pinsSha256,
      floors: { ...payload.floors },
      ...(payload.rotation !== undefined
        ? { rotation: mergeRotationState(null, payload.rotation) }
        : {}),
    },
  }
}

export function sealText(payload: SealPayload, crypto: SealCrypto): string {
  const plain = JSON.stringify({
    pinsSha256: payload.pinsSha256,
    floors: payload.floors,
    ...(payload.rotation !== undefined ? { rotation: payload.rotation } : {}),
  })
  const os = crypto.available()
  const sealed = os
    ? Buffer.from(crypto.encrypt(plain)).toString('base64')
    : Buffer.from(plain, 'utf8').toString('base64')
  return JSON.stringify(
    {
      format: TRUST_SEAL_FORMAT,
      version: TRUST_SEAL_VERSION,
      protection: os ? 'os' : 'none',
      sealed,
    },
    null,
    2,
  )
}

/** A seal is only trusted when it carries the protection this computer can give. */
function trustedSeal(state: SealState, crypto: SealCrypto): SealState {
  if (state.kind === 'ok' && state.protection === 'none' && crypto.available()) {
    return { kind: 'broken', reason: SEAL_DOWNGRADED }
  }
  return state
}

export function sealView(
  sealTextOnDisk: string | null,
  pinsText: string | null,
  crypto: SealCrypto,
  pinsError?: string,
): TrustSealView {
  const state = trustedSeal(readSeal(sealTextOnDisk, crypto), crypto)
  const protection: 'os' | 'none' = crypto.available() ? 'os' : 'none'
  let pins: PinsSeal
  if (pinsText === null) pins = { status: 'no-pins' }
  else if (state.kind === 'missing') pins = { status: 'unsealed', reason: SEAL_MISSING }
  else if (state.kind === 'broken') pins = { status: 'unsealed', reason: state.reason }
  else if (state.payload.pinsSha256 !== sha256Text(pinsText))
    pins = { status: 'unsealed', reason: SEAL_PINS_CHANGED }
  else pins = { status: state.protection === 'os' ? 'sealed' : 'unprotected' }
  const view: TrustSealView = {
    pinsText,
    pins,
    floors: state.kind === 'ok' ? state.payload.floors : null,
    rotation: state.kind === 'ok' ? mergeRotationState(null, state.payload.rotation ?? null) : null,
    protection,
  }
  if (pinsError !== undefined) view.pinsError = pinsError
  return view
}

/** The payload to build on: the trusted one, or a fresh one that vouches for nothing. */
export function basePayload(sealTextOnDisk: string | null, crypto: SealCrypto): SealPayload | null {
  const state = trustedSeal(readSeal(sealTextOnDisk, crypto), crypto)
  return state.kind === 'ok' ? state.payload : null
}

/**
 * Floors after ChipBlocks writes index.json: each listed pack keeps the higher of its floor and
 * its row's version; a pack no longer listed (uninstalled in the app) loses its floor. A version
 * with no SemVer order replaces the floor, since it cannot be ranked.
 */
export function floorsAfterIndexWrite(
  previous: Record<string, string>,
  indexText: string,
): Record<string, string> {
  let rows: unknown
  try {
    rows = (JSON.parse(indexText) as { packs?: unknown }).packs
  } catch {
    return previous
  }
  if (!Array.isArray(rows)) return previous
  const next: Record<string, string> = {}
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const { id, packVersion } = row as { id?: unknown; packVersion?: unknown }
    if (typeof id !== 'string' || typeof packVersion !== 'string') continue
    const prior = previous[id]
    next[id] =
      prior !== undefined && comparePackVersions(packVersion, prior) === -1 ? prior : packVersion
  }
  return next
}

/** Floors to start from when the seal is missing or untrusted: the versions index.json lists now. */
export function floorsFromIndex(indexText: string | null): Record<string, string> {
  return indexText === null ? {} : floorsAfterIndexWrite({}, indexText)
}
