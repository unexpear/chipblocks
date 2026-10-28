import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import {
  type ContentIndex,
  deserializeContentIndex,
  emptyContentIndex,
  enabledPackIds,
  installedPackFiles,
  installLocalPackVerified,
  KEY_ROTATION_INSTALL_NOTE,
  type PackLoadIssue,
  readIndexForWrite,
  serializeContentIndex,
  setPackEnabled,
  uninstallPack,
  writeInstalledPack,
} from './content-manager.ts'
import {
  ContentManagerPanel,
  type PublisherCard,
  type PublisherRotation,
} from './content-manager-panel.tsx'
import { type ContentPack, deserializeContentPack } from './content-pack.ts'
import { assertStoredContentHash } from './content-pack-integrity.ts'
import {
  canonicalPublicKeyHex,
  commitTrustedPublisherChange,
  effectiveTrustedPublishers,
  emptyTrustedPublishers,
  publisherKeyFingerprint,
  type TrustedPublishers,
  trustedPublishersAfterTrust,
  trustedPublishersAfterUntrust,
} from './content-pack-signature.ts'
import {
  liveTrustFromStored,
  type StoredSignature,
  verifyStoredSignature,
} from './content-pack-stored-trust.ts'
import {
  commitRegistrySettings,
  installDownloadedRegistryPack,
  NO_REGISTRY_CONFIGURED,
  parseRegistryIndex,
  parseRegistrySettings,
  REGISTRY_DOWNLOAD_TIMEOUT_MS,
  REGISTRY_INDEX_TIMEOUT_MS,
  REGISTRY_MAX_INDEX_BYTES,
  REGISTRY_MAX_PACK_BYTES,
  type RegistryPackEntry,
  registryUpdates,
  TRUSTED_PUBLISHERS_UNAVAILABLE,
} from './content-registry.ts'
import {
  type RotationState,
  type RotationVerdict,
  rotationForPackText,
  rotationStateAfterConfirm,
} from './key-rotation.ts'
import {
  rollbackReason,
  type SealedTrust,
  sealedTrustedPublishers,
  type TrustSealView,
} from './trust-seal-view.ts'
import { clearCommunityPackFootprints, setCommunityPackFootprints } from './user-footprints.ts'
import { clearCommunityPackParts, setCommunityPackParts } from './user-parts.ts'

/**
 * Content Manager state + panel. Loads ~/.chipblocks/libraries/index.json (and each enabled
 * pack's pack.json) at mount; Tools → Plugin & Content Manager opens the panel via a window
 * event (broadcast from main.tsx, same shape as Shortcuts). The home tab and every project
 * tab stay mounted and all hear that event — only the active screen opens its panel, so
 * closing it on the visible tab does not leave a copy open on the others.
 */

type Bridge = NonNullable<Window['chipblocks']>

// One write queue for every Content Manager in this window. The home tab and each project tab
// mount their own copy of this hook; their index writes must not interleave.
let sharedIndexWriteChain: Promise<void> = Promise.resolve()

// Community parts are registered once per window, not per tab. This is the install state they
// were last registered from, so a change notice re-registers them once, in whichever tab sees
// it first, and only when something that matters changed.
let appliedPacksKey: string | null = null
let sharedLoadIssues: PackLoadIssue[] = []
function packsKey(index: ContentIndex): string {
  return JSON.stringify(
    index.packs.map((p) => [p.id, p.enabled, p.contentHash ?? '', p.packVersion]),
  )
}

/**
 * Hold the cross-window content lock (main process, ~/.chipblocks/content.lock) for one whole
 * change: from re-reading the index to the last write. Without the desktop bridge, run as is.
 */
async function withContentLock(
  bridge: Bridge | undefined,
  onRefused: (reason: string) => void,
  task: () => Promise<void>,
): Promise<void> {
  const acquire = bridge?.acquireContentLock
  const release = bridge?.releaseContentLock
  if (acquire === undefined || release === undefined) {
    await task()
    return
  }
  const got = await acquire()
  if (!got.ok) {
    onRefused(got.reason)
    return
  }
  try {
    await task()
  } finally {
    await release(got.token).catch(() => false)
  }
}

/** Pins and floors from the seal when the bridge has it; pins alone (unsealed) otherwise. */
async function loadSealedTrust(bridge: Bridge): Promise<SealedTrust | null> {
  if (bridge.readTrustSeal !== undefined) {
    try {
      return sealedTrustedPublishers(await bridge.readTrustSeal())
    } catch (error) {
      const view: TrustSealView = {
        pinsText: null,
        pinsError: String(error),
        pins: { status: 'no-pins' },
        floors: null,
        rotation: null,
        protection: 'none',
      }
      return sealedTrustedPublishers(view)
    }
  }
  if (bridge.readTrustedPublishers === undefined) return null
  try {
    const text = await bridge.readTrustedPublishers()
    return {
      ...effectiveTrustedPublishers(text),
      pinsVouched: true,
      floors: null,
      rotation: null,
    }
  } catch (error) {
    return {
      ...effectiveTrustedPublishers(null, String(error)),
      pinsVouched: true,
      floors: null,
      rotation: null,
    }
  }
}

async function persistIndex(bridge: Bridge, index: ContentIndex): Promise<boolean> {
  if (bridge.writeContentIndex === undefined) return false
  const result = await bridge.writeContentIndex(serializeContentIndex(index))
  return result.ok
}

export async function applyEnabledPacks(
  bridge: { readContentPack?: (id: string) => Promise<string | null> },
  index: ContentIndex,
  onTrustIssue?: (message: string) => void,
  floors: Readonly<Record<string, string>> | null = null,
): Promise<PackLoadIssue[]> {
  const issues: PackLoadIssue[] = []
  const report = (id: string, reason: string, blocked: boolean) => {
    const prior = issues.find((issue) => issue.id === id)
    if (prior) {
      prior.reason = `${prior.reason} ${reason}`
      prior.blocked = prior.blocked || blocked
    } else {
      issues.push({ id, reason, blocked })
    }
    onTrustIssue?.(reason)
  }
  const enabled = new Set(enabledPackIds(index))
  for (const rec of index.packs) {
    if (!enabled.has(rec.id)) {
      clearCommunityPackParts(rec.id)
      clearCommunityPackFootprints(rec.id)
      continue
    }
    if (bridge.readContentPack === undefined) {
      clearCommunityPackParts(rec.id)
      clearCommunityPackFootprints(rec.id)
      report(
        rec.id,
        `Pack "${rec.id}" is enabled, but pack files cannot be read in this session. Parts were not loaded.`,
        true,
      )
      continue
    }
    const text = await bridge.readContentPack(rec.id)
    if (text === null) {
      clearCommunityPackParts(rec.id)
      clearCommunityPackFootprints(rec.id)
      report(
        rec.id,
        `Pack "${rec.id}" is enabled, but its pack file could not be read. Parts were not loaded.`,
        true,
      )
      continue
    }
    const hashCheck = await assertStoredContentHash(text, rec.contentHash)
    if (!hashCheck.ok) {
      clearCommunityPackParts(rec.id)
      clearCommunityPackFootprints(rec.id)
      report(rec.id, `Pack "${rec.id}": ${hashCheck.reason}`, true)
      continue
    }
    if (hashCheck.legacyMissingHash) {
      report(
        rec.id,
        `Pack "${rec.id}": no content hash was recorded at install — loaded anyway; re-install from the local file to enable tamper-evidence. Not silently treated as verified.`,
        false,
      )
    }
    const parsed = deserializeContentPack(text)
    if (!parsed.ok) {
      clearCommunityPackParts(rec.id)
      clearCommunityPackFootprints(rec.id)
      report(rec.id, `Pack "${rec.id}" did not load: ${parsed.reason}`, true)
      continue
    }
    const rollback = rollbackReason(rec.id, parsed.pack.packVersion, floors)
    if (rollback !== null) {
      clearCommunityPackParts(rec.id)
      clearCommunityPackFootprints(rec.id)
      report(rec.id, rollback, true)
      continue
    }
    const partsKept = setCommunityPackParts(rec.id, parsed.pack.parts, { name: parsed.pack.name })
    const footprintsKept = setCommunityPackFootprints(rec.id, parsed.pack.footprints)
    const partsSkipped = parsed.pack.parts.length - partsKept
    const footprintsSkipped = parsed.pack.footprints.length - footprintsKept
    if (partsSkipped > 0 || footprintsSkipped > 0) {
      const footprintsBit =
        parsed.pack.footprints.length > 0
          ? ` and ${footprintsKept} of ${parsed.pack.footprints.length} footprint(s)`
          : ''
      report(
        rec.id,
        `Pack "${rec.id}": registered ${partsKept} of ${parsed.pack.parts.length} part(s)${footprintsBit}. The rest were skipped because those ids already belong to a built-in, something you authored, or another pack.`,
        false,
      )
    }
  }
  return issues
}

/** Pinned keys as canonical hex, for checking where a key rotation starts. */
function pinnedKeySet(trusted: TrustedPublishers, pinsLoaded: boolean): Set<string> {
  if (!pinsLoaded) return new Set()
  return new Set(
    trusted.keys
      .map((key) => canonicalPublicKeyHex(key.publicKey))
      .filter((key): key is string => key !== null),
  )
}

async function fingerprintOrShort(hex: string): Promise<string> {
  const fp = await publisherKeyFingerprint(hex)
  return typeof fp === 'string' ? fp : `${hex.slice(0, 16)}…`
}

function rotationReason(verdict: RotationVerdict): string {
  if (verdict.kind === 'broken' || verdict.kind === 'refused' || verdict.kind === 'unanchored') {
    return verdict.reason
  }
  if (verdict.kind === 'current') return 'The pack’s publisher key is already pinned.'
  if (verdict.kind === 'none') return 'The pack carries no key rotation.'
  return ''
}

function isRefuse(result: ContentIndex | { ok: false; reason: string }): result is {
  ok: false
  reason: string
} {
  return 'ok' in result && result.ok === false
}

export function useContentManager(
  light: boolean,
  active = true,
): {
  isOpen: boolean
  panel: ReactNode
} {
  const [index, setIndex] = useState<ContentIndex>(emptyContentIndex)
  const [isOpen, setIsOpen] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const [loadIssues, setLoadIssues] = useState<ReadonlyMap<string, PackLoadIssue>>(new Map())
  const [trusted, setTrusted] = useState<TrustedPublishers>(emptyTrustedPublishers())
  const [pinsLoaded, setPinsLoaded] = useState(false)
  const [trustedStatus, setTrustedStatus] = useState(TRUSTED_PUBLISHERS_UNAVAILABLE)
  // Rollback floors from the trust seal (null: not known), and whether the seal vouches for the
  // pin file's keys. A trust click on an unvouched list starts a new list instead of keeping keys
  // nobody confirmed in this app.
  const [floors, setFloors] = useState<Readonly<Record<string, string>> | null>(null)
  const floorsRef = useRef<Readonly<Record<string, string>> | null>(null)
  const pinsVouchedRef = useRef(true)
  const pinsLoadedRef = useRef(false)
  // Key rotations you confirmed (retired keys, accepted sequences), from the seal.
  const [rotationState, setRotationState] = useState<RotationState | null>(null)
  const rotationRef = useRef<RotationState | null>(null)
  // Per pack: what the pack file on disk proves on this load, and the fingerprint of the key
  // that verified. Trust shown in the panel comes from here, not from index.json.
  const [storedTrust, setStoredTrust] = useState<
    Readonly<
      Record<string, { stored: StoredSignature; fingerprint: string; rotation?: PublisherRotation }>
    >
  >({})
  const [registryUrl, setRegistryUrl] = useState('')
  const [registryStatus, setRegistryStatus] = useState(NO_REGISTRY_CONFIGURED)
  const [registryPacks, setRegistryPacks] = useState<readonly RegistryPackEntry[]>([])
  const [registrySelection, setRegistrySelection] = useState('')
  // Install / enable / uninstall all rewrite index.json from whatever they last read. The ref is
  // the copy those writes actually build on, updated as soon as a write is accepted, so a second
  // click does not start from the index from before the first click. Writes wait until the first
  // read has settled, and they stop entirely when that read failed — an empty stand-in must not
  // replace a file this session could not read.
  const indexRef = useRef(index)
  const indexReady = useRef(false)
  const indexWritable = useRef(false)
  const trustedRef = useRef(trusted)
  const trustedReady = useRef(false)
  const trustWriteChain = useRef(Promise.resolve())
  const registryWriteChain = useRef(Promise.resolve())

  const commitIndex = useCallback((next: ContentIndex) => {
    indexRef.current = next
    setIndex(next)
  }, [])

  const commitTrusted = useCallback((next: TrustedPublishers, loaded: boolean, status: string) => {
    trustedRef.current = next
    setTrusted(next)
    pinsLoadedRef.current = loaded
    setPinsLoaded(loaded)
    setTrustedStatus(status)
  }, [])

  const commitSealed = useCallback(
    (sealed: SealedTrust) => {
      commitTrusted(sealed.publishers, sealed.pinsLoaded, sealed.status)
      floorsRef.current = sealed.floors
      setFloors(sealed.floors)
      pinsVouchedRef.current = sealed.pinsVouched
      rotationRef.current = sealed.rotation
      setRotationState(sealed.rotation)
    },
    [commitTrusted],
  )

  // Pins and floors as they are on disk now (inside a locked change, before deciding anything).
  const latestTrust = useCallback(async (): Promise<void> => {
    const bridge = window.chipblocks
    if (bridge === undefined) return
    const sealed = await loadSealedTrust(bridge)
    if (sealed !== null) commitSealed(sealed)
  }, [commitSealed])

  const enqueueIndexWrite = useCallback((task: () => Promise<void>) => {
    sharedIndexWriteChain = sharedIndexWriteChain.then(task, task)
  }, [])

  // Every index write starts from the file on disk. Another tab or window may have installed,
  // removed, or toggled a pack since this tab last read it.
  const latestIndex = useCallback(async (): Promise<ContentIndex | null> => {
    const latest = await readIndexForWrite(window.chipblocks?.readContentIndex, indexRef.current)
    if (!latest.ok) {
      setStatusMessage(latest.reason)
      return null
    }
    commitIndex(latest.index)
    return latest.index
  }, [commitIndex])

  const indexWritesAllowed = useCallback((): boolean => {
    if (!indexReady.current) {
      setStatusMessage(
        'The content-manager index is still loading. Nothing was written. Try again in a moment.',
      )
      return false
    }
    if (!indexWritable.current) {
      setStatusMessage(
        'The content-manager index could not be read, so this change was not saved over that file.',
      )
      return false
    }
    return true
  }, [])

  const rememberLoads = useCallback((issues: PackLoadIssue[]) => {
    sharedLoadIssues = issues
    setLoadIssues(new Map(issues.map((issue) => [issue.id, issue])))
    if (issues.length > 0) setStatusMessage(issues.map((issue) => issue.reason).join('\n'))
  }, [])

  useEffect(() => {
    if (!active) setIsOpen(false)
  }, [active])

  useEffect(() => {
    const bridge = window.chipblocks
    const open = () => {
      if (!activeRef.current) return
      setIsOpen(true)
      // Show what is on disk now; another tab may have changed the index or the pins.
      if (indexReady.current && indexWritable.current && bridge?.readContentIndex !== undefined) {
        const read = bridge.readContentIndex
        sharedIndexWriteChain = sharedIndexWriteChain.then(async () => {
          try {
            const text = await read()
            const result = text === null ? null : deserializeContentIndex(text)
            if (result?.ok) commitIndex(result.index)
            if (text === null) commitIndex(emptyContentIndex())
          } catch {
            // The next write re-reads and reports a failure; opening the panel does not.
          }
        })
      }
      if (trustedReady.current && bridge !== undefined) {
        void loadSealedTrust(bridge).then((sealed) => {
          if (sealed !== null) commitSealed(sealed)
        })
      }
    }
    window.addEventListener('chipblocks:content-manager', open)

    // Something changed on disk (this window, another ChipBlocks window, or a hand edit): every tab
    // re-reads now, not only when its panel is next opened. Queued behind writes in this window.
    const refresh = () => {
      if (bridge === undefined) return
      sharedIndexWriteChain = sharedIndexWriteChain.then(async () => {
        const sealed = await loadSealedTrust(bridge)
        if (sealed !== null) commitSealed(sealed)
        const read = bridge.readContentIndex
        if (!indexReady.current || !indexWritable.current || read === undefined) return
        let next: ContentIndex
        try {
          const text = await read()
          if (text === null) next = emptyContentIndex()
          else {
            const parsed = deserializeContentIndex(text)
            if (!parsed.ok) return // the next write re-reads and reports it
            next = parsed.index
          }
        } catch {
          return
        }
        commitIndex(next)
        const key = packsKey(next)
        if (key !== appliedPacksKey) {
          appliedPacksKey = key
          rememberLoads(await applyEnabledPacks(bridge, next, undefined, floorsRef.current))
        } else {
          setLoadIssues(new Map(sharedLoadIssues.map((issue) => [issue.id, issue])))
        }
      })
    }
    window.addEventListener('chipblocks:content-changed', refresh)
    const trustLoad =
      bridge !== undefined &&
      (bridge.readTrustSeal !== undefined || bridge.readTrustedPublishers !== undefined)
        ? loadSealedTrust(bridge)
        : null

    if (bridge?.readContentIndex !== undefined) {
      void bridge
        .readContentIndex()
        .then(async (text) => {
          if (text === null) {
            indexReady.current = true
            indexWritable.current = true
            commitIndex(emptyContentIndex())
            return
          }
          const result = deserializeContentIndex(text)
          if (!result.ok) {
            indexReady.current = true
            indexWritable.current = false
            setStatusMessage(`${result.reason} Nothing will be written over that index file.`)
            return
          }
          indexReady.current = true
          indexWritable.current = true
          commitIndex(result.index)
          const sealed = trustLoad === null ? null : await trustLoad
          appliedPacksKey = packsKey(result.index)
          rememberLoads(
            await applyEnabledPacks(bridge, result.index, undefined, sealed?.floors ?? null),
          )
        })
        .catch((error: unknown) => {
          indexReady.current = true
          indexWritable.current = false
          setStatusMessage(
            `Could not read the content-manager index (${String(error)}). Nothing will be written over that file.`,
          )
        })
    } else {
      indexReady.current = true
      indexWritable.current = true
    }

    if (trustLoad !== null) {
      void trustLoad
        .then((sealed) => {
          if (sealed !== null) commitSealed(sealed)
        })
        .finally(() => {
          trustedReady.current = true
        })
    } else {
      trustedReady.current = true
    }

    if (bridge?.readContentRegistrySettings !== undefined) {
      void bridge
        .readContentRegistrySettings()
        .then((text) => {
          if (text === null) {
            setRegistryStatus(NO_REGISTRY_CONFIGURED)
            return
          }
          const parsed = parseRegistrySettings(text)
          if (!parsed.ok) {
            setRegistryStatus(
              `${parsed.reason} The saved registry URL was not used. Nothing will be written over that settings file.`,
            )
            return
          }
          if (parsed.indexUrl === '') {
            setRegistryStatus(NO_REGISTRY_CONFIGURED)
            return
          }
          setRegistryUrl(parsed.indexUrl)
          setRegistryStatus(
            `Registry index saved: ${parsed.indexUrl}. Load the index when you want to see its packs. Nothing is installed by saving.`,
          )
        })
        .catch((error: unknown) => {
          setRegistryStatus(
            `The registry settings file could not be read (${String(error)}). No registry URL was used. Nothing will be written over that file.`,
          )
        })
    }

    return () => {
      window.removeEventListener('chipblocks:content-manager', open)
      window.removeEventListener('chipblocks:content-changed', refresh)
    }
  }, [rememberLoads, commitIndex, commitSealed])

  useEffect(() => {
    let cancelled = false
    if (index.packs.length === 0) {
      setStoredTrust({})
      return
    }
    const read = window.chipblocks?.readContentPack
    void (async () => {
      const pinned = pinnedKeySet(trusted, pinsLoaded)
      const next: Record<
        string,
        { stored: StoredSignature; fingerprint: string; rotation?: PublisherRotation }
      > = {}
      for (const pack of index.packs) {
        let text: string | null = null
        if (read !== undefined) {
          try {
            text = await read(pack.id)
          } catch {
            text = null
          }
        }
        let stored = await verifyStoredSignature(pack, text)
        if (stored.kind === 'verified' && text !== null) {
          const version = (JSON.parse(text) as { packVersion?: unknown }).packVersion
          const rollback =
            typeof version === 'string' ? rollbackReason(pack.id, version.trim(), floors) : null
          if (rollback !== null) stored = { kind: 'unverified', reason: rollback }
        }
        let fingerprint = ''
        if (stored.kind === 'verified') {
          const fp = await publisherKeyFingerprint(stored.publicKeyHex)
          if (typeof fp === 'string') fingerprint = fp
        }
        let rotation: PublisherRotation | undefined
        if (stored.kind === 'verified' && text !== null) {
          // Recomputed on every load against the pins the seal vouches for now: the rotation is
          // kept in the signed original, and nothing about it is believed from index.json.
          const verdict = await rotationForPackText({
            packId: pack.id,
            signerKeyHex: stored.publicKeyHex,
            packText: text,
            pinned,
            state: rotationState,
          })
          if (verdict.kind === 'valid') {
            rotation = {
              kind: 'valid',
              fromFingerprint: await fingerprintOrShort(verdict.fromKey),
              toFingerprint: fingerprint || (await fingerprintOrShort(verdict.toKey)),
            }
          } else if (verdict.kind === 'refused') {
            rotation = { kind: 'refused', reason: verdict.reason }
          }
        }
        next[pack.id] =
          rotation !== undefined ? { stored, fingerprint, rotation } : { stored, fingerprint }
      }
      if (!cancelled) setStoredTrust(next)
    })()
    return () => {
      cancelled = true
    }
  }, [index, floors, trusted, pinsLoaded, rotationState])

  const onInstallLocal = useCallback(() => {
    const bridge = window.chipblocks
    if (bridge === undefined) {
      setStatusMessage(
        'Install from local pack needs the desktop app bridge (pick file + write under ~/.chipblocks/libraries/).',
      )
      return
    }
    const pickLocal = bridge.pickLocalContentPack
    const writePack = bridge.writeContentPack
    if (pickLocal === undefined || writePack === undefined) {
      setStatusMessage(
        'Install from local pack needs the desktop app bridge (pick file + write under ~/.chipblocks/libraries/).',
      )
      return
    }
    enqueueIndexWrite(async () => {
      if (!indexWritesAllowed()) return
      if (!trustedReady.current) {
        setStatusMessage(
          'Trusted publishers are still loading. Nothing was installed. Try again in a moment.',
        )
        return
      }
      const picked = await pickLocal()
      if (!picked.ok) {
        if (picked.reason) setStatusMessage(picked.reason)
        return
      }
      if (picked.text === undefined) {
        setStatusMessage('No pack file text returned.')
        return
      }
      const pickedText = picked.text
      await withContentLock(bridge, setStatusMessage, async () => {
        await latestTrust()
        const base = await latestIndex()
        if (base === null) return
        const installed = await installLocalPackVerified(
          base,
          pickedText,
          Date.now(),
          trustedRef.current,
          floorsRef.current,
          rotationRef.current,
        )
        if (!installed.ok) {
          setStatusMessage(installed.reason)
          return
        }
        const pack: ContentPack = installed.pack
        // Hash the bytes we actually write — serialize may differ from the picked file (dropped
        // malformed entries, stable field order). Reload tamper-checks this on-disk text.
        const files = await installedPackFiles(installed, pickedText)
        const record = files.record
        const onDiskText = files.onDiskText
        const nextIndex = files.index
        const writeIndex = bridge.writeContentIndex
        const removePack = bridge.removeContentPack
        if (writeIndex === undefined || removePack === undefined) {
          setStatusMessage(
            'Install from local pack needs the desktop app bridge (pick file + write under ~/.chipblocks/libraries/).',
          )
          return
        }
        const readPack = bridge.readContentPack
        const saved = await writeInstalledPack({
          id: pack.id,
          onDiskText,
          index: nextIndex,
          hadPrevious: base.packs.some((row) => row.id === pack.id),
          io: {
            writePack,
            writeIndex: async (text) => {
              const result = await writeIndex(text)
              return result.ok
                ? { ok: true }
                : { ok: false, reason: 'The install index could not be saved.' }
            },
            removePack,
            ...(readPack !== undefined ? { readPack } : {}),
          },
        })
        if (!saved.ok) {
          setStatusMessage(saved.reason)
          return
        }
        commitIndex(nextIndex)
        appliedPacksKey = packsKey(nextIndex)
        sharedLoadIssues = sharedLoadIssues.filter((issue) => issue.id !== pack.id)
        const partsKept = setCommunityPackParts(pack.id, pack.parts, { name: pack.name })
        const fpKept = setCommunityPackFootprints(pack.id, pack.footprints)
        const trustBit =
          record.integrityStatus === 'match' ? 'declared content hash matched' : 'no declared hash'
        const registered =
          partsKept === pack.parts.length
            ? `${partsKept} part(s), ${fpKept} footprint(s) registered at community origin`
            : `${partsKept} of ${pack.parts.length} part(s) registered (${pack.parts.length - partsKept} skipped — id already in use), ${fpKept} footprint(s)`
        setStatusMessage(
          `Installed "${record.name}" v${record.packVersion} (${record.license}; ${trustBit}). Enabled — ${registered}.${installed.keyRotation !== undefined ? ` ${KEY_ROTATION_INSTALL_NOTE}` : ''}`,
        )
      })
    })
  }, [commitIndex, enqueueIndexWrite, indexWritesAllowed, latestIndex, latestTrust])

  const onSetEnabled = useCallback(
    (id: string, enabled: boolean) => {
      enqueueIndexWrite(async () => {
        if (window.chipblocks?.writeContentIndex !== undefined && !indexWritesAllowed()) return
        await withContentLock(window.chipblocks, setStatusMessage, async () => {
          const base = await latestIndex()
          if (base === null) return
          const next = setPackEnabled(base, id, enabled)
          if (isRefuse(next)) {
            setStatusMessage(next.reason)
            return
          }
          const bridge = window.chipblocks
          if (bridge?.writeContentIndex !== undefined) {
            if (!indexWritesAllowed()) return
            const saved = await persistIndex(bridge, next)
            if (!saved) {
              setStatusMessage('Could not save enable/disable to the install index.')
              return
            }
            const issues = await applyEnabledPacks(bridge, next, undefined, floorsRef.current)
            appliedPacksKey = packsKey(next)
            rememberLoads(issues)
            commitIndex(next)
            if (issues.length === 0) {
              setStatusMessage(
                enabled ? `Enabled "${id}".` : `Disabled "${id}" (pack stays on disk).`,
              )
            }
            return
          }
          if (!enabled) {
            clearCommunityPackParts(id)
            clearCommunityPackFootprints(id)
          }
          commitIndex(next)
          setStatusMessage(
            enabled
              ? `Marked "${id}" enabled in this window, but pack files cannot be read here, so its parts were not loaded.`
              : `Disabled "${id}" in this window (nothing was written to disk).`,
          )
        })
      })
    },
    [commitIndex, enqueueIndexWrite, indexWritesAllowed, latestIndex, rememberLoads],
  )

  const onUninstall = useCallback(
    (id: string) => {
      enqueueIndexWrite(async () => {
        const bridge = window.chipblocks
        if (bridge?.writeContentIndex !== undefined || bridge?.removeContentPack !== undefined) {
          if (!indexWritesAllowed()) return
        }
        await withContentLock(bridge, setStatusMessage, async () => {
          const base = await latestIndex()
          if (base === null) return
          const next = uninstallPack(base, id)
          if (isRefuse(next)) {
            setStatusMessage(next.reason)
            return
          }
          clearCommunityPackParts(id)
          clearCommunityPackFootprints(id)
          if (bridge?.removeContentPack !== undefined) {
            const removed = await bridge.removeContentPack(id)
            if (!removed.ok) {
              setStatusMessage(removed.reason ?? `Could not remove ~/.chipblocks/libraries/${id}/.`)
              return
            }
          }
          if (bridge?.writeContentIndex !== undefined) {
            const saved = await persistIndex(bridge, next)
            if (!saved) {
              setStatusMessage('Pack directory removed, but the install index could not be saved.')
              return
            }
          }
          commitIndex(next)
          appliedPacksKey = packsKey(next)
          sharedLoadIssues = sharedLoadIssues.filter((issue) => issue.id !== id)
          setStatusMessage(`Uninstalled "${id}".`)
        })
      })
    },
    [commitIndex, enqueueIndexWrite, indexWritesAllowed, latestIndex],
  )

  const onTrustPublisher = useCallback(
    (publicKeyHex: string, trust: boolean, packId: string) => {
      const bridge = window.chipblocks
      const read = bridge?.readTrustedPublishers
      const write = bridge?.writeTrustedPublishers
      if (read === undefined || write === undefined) {
        setStatusMessage(
          'Pinning a publisher key needs the desktop app bridge (read and write ~/.chipblocks/trusted-publishers.json).',
        )
        return
      }
      trustWriteChain.current = trustWriteChain.current.then(() =>
        withContentLock(bridge, setStatusMessage, async () => {
          await latestTrust()
          // A list the seal does not vouch for is not built on: pinning starts a new list with only
          // the key confirmed here, so a key added outside ChipBlocks is not blessed by this click.
          const base =
            trust && !pinsVouchedRef.current ? async (): Promise<string | null> => null : read
          const result = await commitTrustedPublisherChange({
            read: base,
            write,
            change: trust ? 'trust' : 'untrust',
            publicKey: publicKeyHex,
            id: packId,
            comment: `Pinned in Content Manager from pack ${packId}.`,
          })
          if (!result.ok) {
            setStatusMessage(result.reason)
            return
          }
          const count = result.publishers.keys.length
          commitTrusted(
            result.publishers,
            true,
            count === 0
              ? 'No publisher keys are pinned. ~/.chipblocks/trusted-publishers.json lists none. No key is trusted by default.'
              : `${count} publisher key${count === 1 ? '' : 's'} pinned in ~/.chipblocks/trusted-publishers.json. Trust is only this local pin.`,
          )
          setStatusMessage(
            trust
              ? `Pinned the publisher key from "${packId}". Packs signed by that key now count as trusted on this computer.`
              : `Removed the publisher key. Packs signed by it no longer count as pinned.`,
          )
        }),
      )
    },
    [commitTrusted, latestTrust],
  )

  // Confirm a publisher key rotation: re-check it from the pack file on disk against the pins and
  // the seal as they are now, then pin the new key, drop the old one (unless another installed
  // pack is still signed by it), and seal the retired keys and sequences in the same write.
  const onConfirmRotation = useCallback(
    (packId: string) => {
      const bridge = window.chipblocks
      const read = bridge?.readTrustedPublishers
      const write = bridge?.writeTrustedPublishersRotation
      const readPack = bridge?.readContentPack
      if (read === undefined || write === undefined || readPack === undefined) {
        setStatusMessage(
          'Confirming a publisher key change needs the desktop app bridge (read and write ~/.chipblocks/trusted-publishers.json). Nothing was written.',
        )
        return
      }
      const readText = async (id: string): Promise<string | null> => {
        try {
          return await readPack(id)
        } catch {
          return null
        }
      }
      trustWriteChain.current = trustWriteChain.current.then(() =>
        withContentLock(bridge, setStatusMessage, async () => {
          await latestTrust()
          const base = await latestIndex()
          if (base === null) return
          const refuse = (why: string) =>
            setStatusMessage(
              `The publisher key change for "${packId}" was not confirmed: ${why} Nothing was written.`,
            )
          if (!pinsVouchedRef.current || !pinsLoadedRef.current) {
            refuse('your pinned keys could not be read or are not vouched for by the seal.')
            return
          }
          const record = base.packs.find((pack) => pack.id === packId)
          if (record === undefined) {
            refuse('the pack is no longer installed.')
            return
          }
          const text = await readText(packId)
          const stored = await verifyStoredSignature(record, text)
          if (stored.kind !== 'verified' || text === null) {
            refuse('its pack file did not verify on this load.')
            return
          }
          const verdict = await rotationForPackText({
            packId,
            signerKeyHex: stored.publicKeyHex,
            packText: text,
            pinned: pinnedKeySet(trustedRef.current, true),
            state: rotationRef.current,
          })
          if (verdict.kind !== 'valid') {
            refuse(rotationReason(verdict))
            return
          }
          const fromFp = await fingerprintOrShort(verdict.fromKey)
          const toFp = await fingerprintOrShort(verdict.toKey)
          // Another installed pack still signed by the old key keeps it pinned.
          const stillUsing: string[] = []
          for (const other of base.packs) {
            if (other.id === packId) continue
            const otherStored = await verifyStoredSignature(other, await readText(other.id))
            if (otherStored.kind === 'verified' && otherStored.publicKeyHex === verdict.fromKey) {
              stillUsing.push(other.id)
            }
          }
          let pinsText: string | null
          try {
            pinsText = await read()
          } catch (error) {
            refuse(`the trusted-publishers file could not be read (${String(error)}).`)
            return
          }
          const added = trustedPublishersAfterTrust(pinsText, {
            publicKey: verdict.toKey,
            id: packId,
            comment: `Pinned in Content Manager from pack ${packId} after a key rotation from ${fromFp}.`,
          })
          if (!added.ok) {
            setStatusMessage(added.reason)
            return
          }
          let nextText = added.text
          let publishers = added.publishers
          const keepOld = stillUsing.length > 0
          if (!keepOld) {
            const removed = trustedPublishersAfterUntrust(nextText, verdict.fromKey)
            if (removed.ok) {
              nextText = removed.text
              publishers = removed.publishers
            }
          }
          // Keys handed over along the chain are retired; the pinned start only when it is dropped.
          const retire = verdict.links
            .map((link) => link.oldKey)
            .filter((key) => key !== verdict.fromKey || !keepOld)
          const nextState = rotationStateAfterConfirm(rotationRef.current, verdict.links, retire)
          const written = await write(nextText, nextState)
          if (!written.ok) {
            setStatusMessage(
              'The trusted-publishers file could not be saved. Your pins were left as they were.',
            )
            return
          }
          const count = publishers.keys.length
          commitTrusted(
            publishers,
            true,
            `${count} publisher key${count === 1 ? '' : 's'} pinned in ~/.chipblocks/trusted-publishers.json. Trust is only this local pin.`,
          )
          await latestTrust()
          setStatusMessage(
            keepOld
              ? `Pinned the new publisher key for "${packId}" (${toFp}). The old key ${fromFp} stays pinned because ${stillUsing.map((id) => `"${id}"`).join(', ')} ${stillUsing.length === 1 ? 'is' : 'are'} still signed by it.`
              : `Pinned the new publisher key for "${packId}" (${toFp}) and removed the old key ${fromFp}. A key rotation back to the old key will be refused.`,
          )
        }),
      )
    },
    [commitTrusted, latestIndex, latestTrust],
  )

  const onSaveRegistryUrl = useCallback(() => {
    const bridge = window.chipblocks
    const read = bridge?.readContentRegistrySettings
    const write = bridge?.writeContentRegistrySettings
    if (read === undefined || write === undefined) {
      setStatusMessage(
        'Saving a registry URL needs the desktop app bridge (~/.chipblocks/content-registry.json).',
      )
      return
    }
    const url = registryUrl
    registryWriteChain.current = registryWriteChain.current.then(async () => {
      const result = await commitRegistrySettings({ read, write, indexUrl: url })
      if (!result.ok) {
        setRegistryStatus(result.reason)
        setStatusMessage(result.reason)
        return
      }
      setRegistryUrl(result.indexUrl)
      setRegistryPacks([])
      setRegistrySelection('')
      setRegistryStatus(
        result.indexUrl === ''
          ? NO_REGISTRY_CONFIGURED
          : `Registry index saved: ${result.indexUrl}. Load the index when you want to see its packs. Nothing is installed by saving.`,
      )
    })
  }, [registryUrl])

  const onLoadRegistry = useCallback(() => {
    const bridge = window.chipblocks
    const download = bridge?.downloadRegistryResource
    if (download === undefined) {
      setStatusMessage(
        'Loading a registry index needs the desktop app bridge. Nothing was downloaded.',
      )
      return
    }
    const url = registryUrl.trim()
    if (url === '') {
      setRegistryStatus(NO_REGISTRY_CONFIGURED)
      setStatusMessage('No registry index URL is set. Nothing was downloaded.')
      return
    }
    void (async () => {
      const downloaded = await download(url, REGISTRY_MAX_INDEX_BYTES, REGISTRY_INDEX_TIMEOUT_MS)
      if (!downloaded.ok) {
        setRegistryStatus(downloaded.reason)
        setStatusMessage(downloaded.reason)
        setRegistryPacks([])
        return
      }
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(downloaded.bytes)
      } catch {
        const reason = 'The registry index is not UTF-8 text. It was not used.'
        setRegistryStatus(reason)
        setStatusMessage(reason)
        setRegistryPacks([])
        return
      }
      const parsed = parseRegistryIndex(text, url)
      if (!parsed.ok) {
        setRegistryStatus(parsed.reason)
        setStatusMessage(parsed.reason)
        setRegistryPacks([])
        return
      }
      setRegistryPacks(parsed.packs)
      setRegistrySelection('')
      setRegistryStatus(
        `Loaded ${parsed.packs.length} pack${parsed.packs.length === 1 ? '' : 's'} from the registry index. Nothing was installed.`,
      )
    })()
  }, [registryUrl])

  const onInstallFromRegistry = useCallback(() => {
    const bridge = window.chipblocks
    const download = bridge?.downloadRegistryResource
    const writePack = bridge?.writeContentPack
    const removePack = bridge?.removeContentPack
    const writeIndex = bridge?.writeContentIndex
    const readPack = bridge?.readContentPack
    if (
      download === undefined ||
      writePack === undefined ||
      removePack === undefined ||
      writeIndex === undefined
    ) {
      setStatusMessage(
        'Install from registry needs the desktop app to download the pack and write ~/.chipblocks/libraries/. Nothing was written.',
      )
      return
    }
    const entry = registryPacks.find((pack) => pack.id === registrySelection)
    if (entry === undefined) {
      setStatusMessage('Choose a pack from a loaded registry index. Nothing was installed.')
      return
    }
    enqueueIndexWrite(async () => {
      if (!indexWritesAllowed()) return
      if (!trustedReady.current) {
        setStatusMessage(
          'Trusted publishers are still loading. Nothing was installed. Try again in a moment.',
        )
        return
      }
      const downloaded = await download(
        entry.downloadUrl,
        REGISTRY_MAX_PACK_BYTES,
        REGISTRY_DOWNLOAD_TIMEOUT_MS,
      )
      if (!downloaded.ok) {
        setStatusMessage(downloaded.reason)
        return
      }
      const body = downloaded.bytes
      await withContentLock(bridge, setStatusMessage, async () => {
        await latestTrust()
        const base = await latestIndex()
        if (base === null) return
        const installed = await installDownloadedRegistryPack({
          index: base,
          entry,
          body,
          trusted: trustedRef.current,
          floors: floorsRef.current,
          rotation: rotationRef.current,
          io: {
            writePack,
            writeIndex,
            ...(readPack !== undefined ? { readPack } : {}),
            removePack,
          },
        })
        if (!installed.ok) {
          setStatusMessage(installed.reason)
          return
        }
        commitIndex(installed.index)
        appliedPacksKey = packsKey(installed.index)
        sharedLoadIssues = sharedLoadIssues.filter((issue) => issue.id !== installed.pack.id)
        const partsKept = setCommunityPackParts(installed.pack.id, installed.pack.parts, {
          name: installed.pack.name,
        })
        const fpKept = setCommunityPackFootprints(installed.pack.id, installed.pack.footprints)
        const trustBit =
          installed.record.signatureStatus === 'valid-trusted'
            ? 'publisher key pinned'
            : installed.record.signatureStatus === 'valid-untrusted'
              ? 'publisher signature valid, key not pinned'
              : 'no publisher signature'
        setStatusMessage(
          `Installed "${installed.record.name}" v${installed.record.packVersion} from the registry (${trustBit}). ${partsKept} part(s), ${fpKept} footprint(s).${installed.keyRotation !== undefined ? ` ${KEY_ROTATION_INSTALL_NOTE}` : ''}`,
        )
      })
    })
  }, [
    commitIndex,
    enqueueIndexWrite,
    indexWritesAllowed,
    latestIndex,
    latestTrust,
    registryPacks,
    registrySelection,
  ])

  const publisherByPack: Record<string, PublisherCard> = {}
  for (const pack of index.packs) {
    const checked = storedTrust[pack.id]
    if (checked === undefined || checked.stored.kind === 'unsigned') continue
    const trust = liveTrustFromStored(checked.stored, trusted, pinsLoaded)
    if (checked.stored.kind === 'verified') {
      const card: PublisherCard = {
        publicKeyHex: checked.stored.publicKeyHex,
        fingerprint: checked.fingerprint,
        trust,
      }
      if (checked.rotation !== undefined) card.rotation = checked.rotation
      publisherByPack[pack.id] = card
    } else {
      publisherByPack[pack.id] = {
        publicKeyHex: '',
        fingerprint: '',
        trust,
        reason: checked.stored.reason,
      }
    }
  }
  const updates = registryUpdates(index.packs, registryPacks)

  const panel = isOpen ? (
    <ContentManagerPanel
      index={index}
      statusMessage={statusMessage}
      loadIssues={loadIssues}
      light={light}
      trustedStatus={trustedStatus}
      registryUrl={registryUrl}
      registryStatus={registryStatus}
      registryPacks={registryPacks}
      registrySelection={registrySelection}
      updates={updates}
      publisherByPack={publisherByPack}
      onClose={() => setIsOpen(false)}
      onInstallLocal={onInstallLocal}
      onSetEnabled={onSetEnabled}
      onUninstall={onUninstall}
      onRegistryUrlChange={setRegistryUrl}
      onSaveRegistryUrl={onSaveRegistryUrl}
      onLoadRegistry={onLoadRegistry}
      onRegistrySelection={setRegistrySelection}
      onInstallFromRegistry={onInstallFromRegistry}
      onTrustPublisher={onTrustPublisher}
      onConfirmRotation={onConfirmRotation}
    />
  ) : null

  return { isOpen, panel }
}
