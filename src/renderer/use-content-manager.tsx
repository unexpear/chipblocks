import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import {
  type ContentIndex,
  deserializeContentIndex,
  emptyContentIndex,
  enabledPackIds,
  installLocalPackVerified,
  type PackLoadIssue,
  serializeContentIndex,
  setPackEnabled,
  uninstallPack,
} from './content-manager.ts'
import { ContentManagerPanel } from './content-manager-panel.tsx'
import { type ContentPack, deserializeContentPack, serializeContentPack } from './content-pack.ts'
import { assertStoredContentHash, sha256Hex } from './content-pack-integrity.ts'
import { clearCommunityPackFootprints, setCommunityPackFootprints } from './user-footprints.ts'
import { clearCommunityPackParts, setCommunityPackParts } from './user-parts.ts'

/**
 * Content Manager state + panel. Loads ~/.chipblocks/libraries/index.json (and each enabled
 * pack's pack.json) at mount; Tools → Plugin & Content Manager opens the panel via a window
 * event (broadcast from main.tsx, same shape as Shortcuts).
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

export function useContentManager(light: boolean): {
  isOpen: boolean
  panel: ReactNode
} {
  const [index, setIndex] = useState<ContentIndex>(emptyContentIndex)
  const [isOpen, setIsOpen] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [loadIssues, setLoadIssues] = useState<ReadonlyMap<string, PackLoadIssue>>(new Map())
  // Install / enable / uninstall all rewrite index.json from whatever they last read. The ref is
  // the copy those writes actually build on, updated as soon as a write is accepted, so a second
  // click does not start from the index from before the first click. Writes wait until the first
  // read has settled, and they stop entirely when that read failed — an empty stand-in must not
  // replace a file this session could not read.
  const indexRef = useRef(index)
  const indexReady = useRef(false)
  const indexWritable = useRef(false)
  const writeChain = useRef(Promise.resolve())

  const commitIndex = useCallback((next: ContentIndex) => {
    indexRef.current = next
    setIndex(next)
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
    const bridge = window.chipblocks
    const open = () => setIsOpen(true)
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

    return () => window.removeEventListener('chipblocks:content-manager', open)
  }, [rememberLoads, commitIndex])

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
      const picked = await pickLocal()
      if (!picked.ok) {
        if (picked.reason) setStatusMessage(picked.reason)
        return
      }
      if (picked.text === undefined) {
        setStatusMessage('No pack file text returned.')
        return
      }
      const installed = await installLocalPackVerified(indexRef.current, picked.text)
      if (!installed.ok) {
        setStatusMessage(installed.reason)
        return
      }
      const pack: ContentPack = installed.pack
      // Hash the bytes we actually write — serialize may differ from the picked file (dropped
      // malformed entries, stable field order). Reload tamper-checks this on-disk text.
      const onDiskText = serializeContentPack(pack)
      const diskHash = await sha256Hex(onDiskText)
      const record = { ...installed.record, contentHash: diskHash }
      const nextIndex = {
        ...installed.index,
        packs: installed.index.packs.map((p) => (p.id === record.id ? record : p)),
      }
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

  const panel = isOpen ? (
    <ContentManagerPanel
      index={index}
      statusMessage={statusMessage}
      loadIssues={loadIssues}
      light={light}
      onClose={() => setIsOpen(false)}
      onInstallLocal={onInstallLocal}
      onSetEnabled={onSetEnabled}
      onUninstall={onUninstall}
    />
  ) : null

  return { isOpen, panel }
}
