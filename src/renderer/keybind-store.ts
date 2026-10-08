/**
 * One shared copy of the keyboard shortcuts.
 *
 * The home screen and every project tab stay mounted, and each one used to read the saved
 * bindings once into its own state. A rebind then updated only that screen — the others kept
 * showing the old key until the app was restarted. Subscribers here all see the same map, so a
 * change applies everywhere immediately. The desktop bridge still writes the file.
 */
import { DEFAULT_KEYBINDS, type Keybinds, mergeKeybinds } from './keybinds.ts'

type Listener = (binds: Keybinds) => void

let current: Keybinds = { ...DEFAULT_KEYBINDS }
const listeners = new Set<Listener>()
let loadPromise: Promise<void> | null = null
let revision = 0

export function getKeybinds(): Keybinds {
  return current
}

export function subscribeKeybinds(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publish(next: Keybinds): void {
  revision += 1
  current = next
  for (const listener of listeners) listener(current)
}

/** Apply an edit to every screen now, then persist it. A load still in flight will not overwrite this. */
export function commitKeybinds(next: Keybinds): void {
  publish(next)
  const persist = window.chipblocks?.setKeybinds
  if (persist !== undefined) void persist(next)
}

/**
 * Read the saved bindings once per session. Every screen shares the result. A rebind that lands
 * while the read is in flight is kept — the late file contents are the keys from before the edit.
 */
export function ensureKeybindsLoaded(): void {
  if (loadPromise !== null) return
  const read = window.chipblocks?.getKeybinds
  if (read === undefined) {
    loadPromise = Promise.resolve()
    return
  }
  const revisionAtStart = revision
  loadPromise = read()
    .then((saved) => {
      if (revision !== revisionAtStart) return
      publish(mergeKeybinds(saved))
    })
    .catch(() => {
      // The defaults stay in place. Typing must not depend on the file read succeeding.
    })
}

/** Put the in-memory map back to the defaults. Tests call this so one case cannot leak into the next. */
export function resetKeybindStore(): void {
  revision += 1
  current = { ...DEFAULT_KEYBINDS }
  loadPromise = null
  listeners.clear()
}
