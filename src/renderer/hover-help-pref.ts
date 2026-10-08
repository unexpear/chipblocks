/**
 * How much hover help to show. Saved in localStorage, the same place the colour theme
 * is remembered, so the choice survives a reload in the browser and in the desktop app.
 * The native Settings menu writes through here too.
 */

export type HoverHelpMode = 'full' | 'brief' | 'off'

const STORAGE_KEY = 'chipblocks.hoverHelp'

const MODES: readonly HoverHelpMode[] = ['full', 'brief', 'off']

type Listener = (mode: HoverHelpMode) => void

let mode: HoverHelpMode | null = null
const listeners = new Set<Listener>()

export function loadHoverHelpMode(): HoverHelpMode {
  if (typeof localStorage === 'undefined') return 'full'
  const saved = localStorage.getItem(STORAGE_KEY)
  return MODES.includes(saved as HoverHelpMode) ? (saved as HoverHelpMode) : 'full'
}

export function getHoverHelpMode(): HoverHelpMode {
  if (mode === null) mode = loadHoverHelpMode()
  return mode
}

export function subscribeHoverHelp(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setHoverHelpMode(next: HoverHelpMode): void {
  mode = next
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next)
  for (const listener of listeners) listener(next)
}

/** Tests call this so one case cannot leak a mode or a listener into the next. */
export function resetHoverHelpStore(): void {
  mode = 'full'
  listeners.clear()
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
}
