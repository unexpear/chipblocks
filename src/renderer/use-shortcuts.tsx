import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { DEFAULT_KEYBINDS, type Keybinds, mergeKeybinds } from './keybinds.ts'
import { ShortcutsPanel } from './shortcuts-panel.tsx'

/**
 * The keybinds + the Shortcuts panel in one place. The editor needs the keybinds (it matches
 * them on keydown) AND the panel; the project browser needs only the panel. Both call this so
 * Settings ▸ Shortcuts works on every screen — the native menu's open request is broadcast as a
 * window event (main.tsx) that every mounted screen hears. Edits persist via the main process.
 */
export function useShortcuts(light: boolean): {
  keybinds: Keybinds
  isOpen: boolean
  panel: ReactNode
} {
  const [keybinds, setKeybinds] = useState<Keybinds>(DEFAULT_KEYBINDS)
  const [isOpen, setIsOpen] = useState(false)
  useEffect(() => {
    const bridge = window.chipblocks
    if (bridge?.getKeybinds !== undefined) {
      void bridge.getKeybinds().then((saved) => setKeybinds(mergeKeybinds(saved)))
    }
    const open = () => setIsOpen(true)
    window.addEventListener('chipblocks:shortcuts', open)
    return () => window.removeEventListener('chipblocks:shortcuts', open)
  }, [])
  // Panel edits apply immediately + persist via the main process (which re-installs the menu so
  // its accelerators show the new keys). Without the bridge (dev preview) they apply for the session.
  const applyKeybinds = useCallback((next: Keybinds) => {
    setKeybinds(next)
    void window.chipblocks?.setKeybinds?.(next)
  }, [])
  const panel = isOpen ? (
    <ShortcutsPanel
      binds={keybinds}
      onChange={applyKeybinds}
      onClose={() => setIsOpen(false)}
      light={light}
    />
  ) : null
  return { keybinds, isOpen, panel }
}
