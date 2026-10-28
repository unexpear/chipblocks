/**
 * What the renderer does with the trust seal (electron/trust-seal.ts): pins that the seal does not
 * vouch for are not trusted, and an installed pack older than the highest version ChipBlocks
 * installed (its floor) is a rollback.
 */
import {
  effectiveTrustedPublishers,
  emptyTrustedPublishers,
  type TrustedPublishers,
} from './content-pack-signature.ts'
import { comparePackVersions } from './pack-version.ts'
import type { RotationState } from './rotation-state.ts'

export type PinsSeal =
  | { status: 'sealed' }
  | { status: 'unprotected' }
  | { status: 'no-pins' }
  | { status: 'unsealed'; reason: string }

/** IPC `trust-seal:read`. */
export type TrustSealView = {
  pinsText: string | null
  pinsError?: string
  pins: PinsSeal
  /** null when the seal could not be trusted, so versions cannot be checked for a rollback. */
  floors: Record<string, string> | null
  /** Confirmed key rotations from the seal; null (or absent, older app) when it is not trusted. */
  rotation?: RotationState | null
  protection: 'os' | 'none'
}

export type SealedTrust = {
  publishers: TrustedPublishers
  pinsLoaded: boolean
  status: string
  /**
   * False only when the seal does not vouch for a readable pin list with keys: a trust click then
   * starts a new list. An unreadable or malformed list stays true, so the click re-reads it and
   * refuses rather than writing over it.
   */
  pinsVouched: boolean
  floors: Readonly<Record<string, string>> | null
  rotation: RotationState | null
}

export const PINS_SEALED_NOTE =
  "The list is sealed with this computer's OS-protected storage, so an edit made outside ChipBlocks is detected."
export const PINS_UNPROTECTED_NOTE =
  'This computer has no OS-protected storage, so an edit made outside ChipBlocks cannot be detected.'
export const FLOORS_UNKNOWN_NOTE =
  'Installed pack versions cannot be checked for a rollback until ChipBlocks saves the seal again (the next install, enable, disable, or uninstall).'

export function sealedTrustedPublishers(view: TrustSealView): SealedTrust {
  const floors = view.floors
  const rotation = view.rotation ?? null
  if (view.pinsError !== undefined) {
    return {
      ...effectiveTrustedPublishers(null, view.pinsError),
      pinsVouched: true,
      floors,
      rotation,
    }
  }
  const effective = effectiveTrustedPublishers(view.pinsText)
  if (!effective.pinsLoaded || effective.publishers.keys.length === 0) {
    return { ...effective, pinsVouched: true, floors, rotation }
  }
  if (view.pins.status === 'unsealed') {
    return {
      publishers: emptyTrustedPublishers(),
      pinsLoaded: false,
      status: `${view.pins.reason} No publisher key from that file is treated as pinned. Pin a key again in Content Manager to trust it; that saves a new list with only the keys you pin there.`,
      pinsVouched: false,
      floors,
      rotation,
    }
  }
  const note = view.pins.status === 'unprotected' ? PINS_UNPROTECTED_NOTE : PINS_SEALED_NOTE
  return {
    ...effective,
    status: `${effective.status} ${note}`,
    pinsVouched: true,
    floors,
    rotation,
  }
}

/**
 * The version in the pack file on disk against the floor. A pack file older than a version
 * ChipBlocks installed was put back outside ChipBlocks, even when index.json was rewritten to
 * match it. Versions with no SemVer order are not judged.
 */
export function rollbackReason(
  id: string,
  fileVersion: string,
  floors: Readonly<Record<string, string>> | null,
): string | null {
  const floor = floors?.[id]
  if (floor === undefined) return null
  if (comparePackVersions(fileVersion, floor) !== -1) return null
  return `Pack "${id}" on disk is version ${fileVersion}, but ChipBlocks already installed version ${floor} of it on this computer. An older pack file was put in its place outside ChipBlocks (a rollback), so it is treated as untrusted and its parts were not loaded. Reinstall the current version, or uninstall it first if you mean to go back.`
}

/** Refusal for installing an older version over a newer one (index row or floor). */
export function downgradeRefusal(
  id: string,
  offered: string,
  installed: string | undefined,
  floors: Readonly<Record<string, string>> | null | undefined,
): string | null {
  const floor = floors?.[id]
  const higher = [installed, floor].find(
    (v): v is string => v !== undefined && comparePackVersions(offered, v) === -1,
  )
  if (higher === undefined) return null
  return `"${id}" ${higher} is installed, and this file is the older ${offered}. ChipBlocks does not install an older version over a newer one. Nothing was written. Uninstall first if you mean to go back.`
}
