import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import {
  type ContentIndex,
  deserializeContentIndex,
  emptyContentIndex,
  enabledPackIds,
  installedPackFiles,
  installLocalPackVerified,
  type PackLoadIssue,
  serializeContentIndex,
  setPackEnabled,
  uninstallPack,
} from './content-manager.ts'
import { ContentManagerPanel, type PublisherCard } from './content-manager-panel.tsx'
import { type ContentPack, deserializeContentPack } from './content-pack.ts'
import { assertStoredContentHash } from './content-pack-integrity.ts'
import {
  commitTrustedPublisherChange,
  effectiveTrustedPublishers,
  emptyTrustedPublishers,
  livePublisherTrust,
  publisherKeyFingerprint,
  type TrustedPublishers,
} from './content-pack-signature.ts'
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

async function persistIndex(bridge: Bridge, index: ContentIndex): Promise<boolean> {
  if (bridge.writeContentIndex === undefined) return false
  const result = await bridge.writeContentIndex(serializeContentIndex(index))
  return result.ok
}

export async function applyEnabledPacks(
  bridge: { readContentPack?: (id: string) => Promise<string | null> },
  index: ContentIndex,
  onTrustIssue?: (message: string) => void,
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
  const [fingerprints, setFingerprints] = useState<Readonly<Record<string, string>>>({})
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
  const writeChain = useRef(Promise.resolve())
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
    setPinsLoaded(loaded)
    setTrustedStatus(status)
  }, [])

  const enqueueIndexWrite = useCallback((task: () => Promise<void>) => {
    writeChain.current = writeChain.current.then(task, task)
  }, [])

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
    }
    window.addEventListener('chipblocks:content-manager', open)

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
          rememberLoads(await applyEnabledPacks(bridge, result.index))
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

    if (bridge?.readTrustedPublishers !== undefined) {
      void bridge
        .readTrustedPublishers()
        .then((text) => {
          const effective = effectiveTrustedPublishers(text)
          commitTrusted(effective.publishers, effective.pinsLoaded, effective.status)
        })
        .catch((error: unknown) => {
          const effective = effectiveTrustedPublishers(null, String(error))
          commitTrusted(effective.publishers, effective.pinsLoaded, effective.status)
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

    return () => window.removeEventListener('chipblocks:content-manager', open)
  }, [rememberLoads, commitIndex, commitTrusted])

  useEffect(() => {
    let cancelled = false
    const packs = index.packs.filter((pack) => pack.publisherKeyHex !== undefined)
    if (packs.length === 0) {
      setFingerprints({})
      return
    }
    void (async () => {
      const next: Record<string, string> = {}
      for (const pack of packs) {
        if (pack.publisherKeyHex === undefined) continue
        const fingerprint = await publisherKeyFingerprint(pack.publisherKeyHex)
        if (typeof fingerprint === 'string') next[pack.id] = fingerprint
      }
      if (!cancelled) setFingerprints(next)
    })()
    return () => {
      cancelled = true
    }
  }, [index])

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
      const installed = await installLocalPackVerified(
        indexRef.current,
        picked.text,
        Date.now(),
        trustedRef.current,
      )
      if (!installed.ok) {
        setStatusMessage(installed.reason)
        return
      }
      const pack: ContentPack = installed.pack
      // Hash the bytes we actually write — serialize may differ from the picked file (dropped
      // malformed entries, stable field order). Reload tamper-checks this on-disk text.
      const files = await installedPackFiles(installed)
      const record = files.record
      const onDiskText = files.onDiskText
      const nextIndex = files.index
      const written = await writePack(pack.id, onDiskText)
      if (!written.ok) {
        setStatusMessage(
          written.reason ?? 'Could not write the pack under ~/.chipblocks/libraries/.',
        )
        return
      }
      const saved = await persistIndex(bridge, nextIndex)
      if (!saved) {
        setStatusMessage('Pack file written, but the install index could not be saved.')
        return
      }
      commitIndex(nextIndex)
      const partsKept = setCommunityPackParts(pack.id, pack.parts, { name: pack.name })
      const fpKept = setCommunityPackFootprints(pack.id, pack.footprints)
      const trustBit =
        record.integrityStatus === 'match' ? 'declared content hash matched' : 'no declared hash'
      const registered =
        partsKept === pack.parts.length
          ? `${partsKept} part(s), ${fpKept} footprint(s) registered at community origin`
          : `${partsKept} of ${pack.parts.length} part(s) registered (${pack.parts.length - partsKept} skipped — id already in use), ${fpKept} footprint(s)`
      setStatusMessage(
        `Installed "${record.name}" v${record.packVersion} (${record.license}; ${trustBit}). Enabled — ${registered}.`,
      )
    })
  }, [commitIndex, enqueueIndexWrite, indexWritesAllowed])

  const onSetEnabled = useCallback(
    (id: string, enabled: boolean) => {
      enqueueIndexWrite(async () => {
        const next = setPackEnabled(indexRef.current, id, enabled)
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
          const issues = await applyEnabledPacks(bridge, next)
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
    },
    [commitIndex, enqueueIndexWrite, indexWritesAllowed, rememberLoads],
  )

  const onUninstall = useCallback(
    (id: string) => {
      enqueueIndexWrite(async () => {
        const next = uninstallPack(indexRef.current, id)
        if (isRefuse(next)) {
          setStatusMessage(next.reason)
          return
        }
        const bridge = window.chipblocks
        if (bridge?.writeContentIndex !== undefined || bridge?.removeContentPack !== undefined) {
          if (!indexWritesAllowed()) return
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
        setStatusMessage(`Uninstalled "${id}".`)
      })
    },
    [commitIndex, enqueueIndexWrite, indexWritesAllowed],
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
      trustWriteChain.current = trustWriteChain.current.then(async () => {
        const result = await commitTrustedPublisherChange({
          read,
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
      })
    },
    [commitTrusted],
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
      const parsed = parseRegistryIndex(text)
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
      const installed = await installDownloadedRegistryPack({
        index: indexRef.current,
        entry,
        body: downloaded.bytes,
        trusted: trustedRef.current,
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
        `Installed "${installed.record.name}" v${installed.record.packVersion} from the registry (${trustBit}). ${partsKept} part(s), ${fpKept} footprint(s).`,
      )
    })
  }, [commitIndex, enqueueIndexWrite, indexWritesAllowed, registryPacks, registrySelection])

  const publisherByPack: Record<string, PublisherCard> = {}
  for (const pack of index.packs) {
    if (pack.publisherKeyHex === undefined) continue
    if (pack.signatureStatus !== 'valid-trusted' && pack.signatureStatus !== 'valid-untrusted') {
      continue
    }
    publisherByPack[pack.id] = {
      publicKeyHex: pack.publisherKeyHex,
      fingerprint: fingerprints[pack.id] ?? '',
      trust: livePublisherTrust(pack.signatureStatus, pack.publisherKeyHex, trusted, pinsLoaded),
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
    />
  ) : null

  return { isOpen, panel }
}
