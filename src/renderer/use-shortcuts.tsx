import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import {
  commitKeybinds,
  ensureKeybindsLoaded,
  getKeybinds,
  subscribeKeybinds,
} from './keybind-store.ts'
import type { Keybinds } from './keybinds.ts'
import { ShortcutsPanel } from './shortcuts-panel.tsx'

/**
 * The keybinds + the Shortcuts panel. The editor matches keys from here; the project browser
 * only needs the panel. Both call this so Settings ▸ Shortcuts works on every screen.
 *
 * The home tab and every project tab stay mounted and all hear the same window event (main.tsx).
 * Only the active screen opens its panel — a background tab must not grow a second copy that
 * stays open after the visible one is closed. The bindings themselves are one shared store, so
 * a rebind updates every screen immediately and still persists through the desktop bridge.
 */
export function useShortcuts(
  light: boolean,
  active = true,
): {
  keybinds: Keybinds
  isOpen: boolean
  panel: ReactNode
} {
  const [keybinds, setKeybinds] = useState<Keybinds>(getKeybinds)
  const [isOpen, setIsOpen] = useState(false)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (!active) setIsOpen(false)
  }, [active])

  useEffect(() => {
    const unsubscribe = subscribeKeybinds(setKeybinds)
    ensureKeybindsLoaded()
    const open = () => {
      if (!activeRef.current) return
      setIsOpen(true)
    }
    window.addEventListener('chipblocks:shortcuts', open)
    return () => {
      unsubscribe()
      window.removeEventListener('chipblocks:shortcuts', open)
    }
  }, [])

  const applyKeybinds = useCallback((next: Keybinds) => {
    commitKeybinds(next)
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
