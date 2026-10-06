import { type ReactNode, useCallback, useEffect, useState } from 'react'
import {
  type ContentIndex,
  deserializeContentIndex,
  emptyContentIndex,
  enabledPackIds,
  installLocalPack,
  serializeContentIndex,
  setPackEnabled,
  uninstallPack,
} from './content-manager.ts'
import { ContentManagerPanel } from './content-manager-panel.tsx'
import { type ContentPack, deserializeContentPack, serializeContentPack } from './content-pack.ts'
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

async function applyEnabledPacks(bridge: Bridge, index: ContentIndex): Promise<void> {
  const enabled = new Set(enabledPackIds(index))
  for (const rec of index.packs) {
    if (!enabled.has(rec.id)) {
      clearCommunityPackParts(rec.id)
      continue
    }
    if (bridge.readContentPack === undefined) continue
    const text = await bridge.readContentPack(rec.id)
    if (text === null) {
      clearCommunityPackParts(rec.id)
      continue
    }
    const parsed = deserializeContentPack(text)
    if (!parsed.ok) {
      clearCommunityPackParts(rec.id)
      continue
    }
    setCommunityPackParts(rec.id, parsed.pack.parts)
  }
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

  useEffect(() => {
    const bridge = window.chipblocks
    const open = () => setIsOpen(true)
    window.addEventListener('chipblocks:content-manager', open)

    if (bridge?.readContentIndex !== undefined) {
      void bridge.readContentIndex().then(async (text) => {
        if (text === null) {
          setIndex(emptyContentIndex())
          return
        }
        const result = deserializeContentIndex(text)
        if (!result.ok) {
          setStatusMessage(result.reason)
          setIndex(emptyContentIndex())
          return
        }
        setIndex(result.index)
        await applyEnabledPacks(bridge, result.index)
      })
    }

    return () => window.removeEventListener('chipblocks:content-manager', open)
  }, [])

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
    void (async () => {
      const picked = await pickLocal()
      if (!picked.ok) {
        if (picked.reason) setStatusMessage(picked.reason)
        return
      }
      if (picked.text === undefined) {
        setStatusMessage('No pack file text returned.')
        return
      }
      const installed = installLocalPack(index, picked.text)
      if (!installed.ok) {
        setStatusMessage(installed.reason)
        return
      }
      const pack: ContentPack = installed.pack
      const written = await writePack(pack.id, serializeContentPack(pack))
      if (!written.ok) {
        setStatusMessage(
          written.reason ?? 'Could not write the pack under ~/.chipblocks/libraries/.',
        )
        return
      }
      const saved = await persistIndex(bridge, installed.index)
      if (!saved) {
        setStatusMessage('Pack file written, but the install index could not be saved.')
        return
      }
      setIndex(installed.index)
      setCommunityPackParts(pack.id, pack.parts)
      setStatusMessage(
        `Installed "${installed.record.name}" v${installed.record.packVersion} (${installed.record.license}). Enabled — ${installed.record.partCount} part(s) registered at community origin.`,
      )
    })()
  }, [index])

  const onSetEnabled = useCallback(
    (id: string, enabled: boolean) => {
      const next = setPackEnabled(index, id, enabled)
      if (isRefuse(next)) {
        setStatusMessage(next.reason)
        return
      }
      const bridge = window.chipblocks
      void (async () => {
        if (bridge) {
          const saved = await persistIndex(bridge, next)
          if (!saved) {
            setStatusMessage('Could not save enable/disable to the install index.')
            return
          }
          await applyEnabledPacks(bridge, next)
        } else if (!enabled) {
          clearCommunityPackParts(id)
        }
        setIndex(next)
        setStatusMessage(enabled ? `Enabled "${id}".` : `Disabled "${id}" (pack stays on disk).`)
      })()
    },
    [index],
  )

  const onUninstall = useCallback(
    (id: string) => {
      const next = uninstallPack(index, id)
      if (isRefuse(next)) {
        setStatusMessage(next.reason)
        return
      }
      const bridge = window.chipblocks
      void (async () => {
        clearCommunityPackParts(id)
        if (bridge?.removeContentPack !== undefined) {
          const removed = await bridge.removeContentPack(id)
          if (!removed.ok) {
            setStatusMessage(removed.reason ?? `Could not remove ~/.chipblocks/libraries/${id}/.`)
            return
          }
        }
        if (bridge) {
          const saved = await persistIndex(bridge, next)
          if (!saved) {
            setStatusMessage('Pack directory removed, but the install index could not be saved.')
            return
          }
        }
        setIndex(next)
        setStatusMessage(`Uninstalled "${id}".`)
      })()
    },
    [index],
  )

  const panel = isOpen ? (
    <ContentManagerPanel
      index={index}
      statusMessage={statusMessage}
      light={light}
      onClose={() => setIsOpen(false)}
      onInstallLocal={onInstallLocal}
      onSetEnabled={onSetEnabled}
      onUninstall={onUninstall}
    />
  ) : null

  return { isOpen, panel }
}
