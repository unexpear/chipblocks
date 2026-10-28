/**
 * Tell the window when installed packs or pins change on disk: written by this process, by a
 * second ChipBlocks window (another process), or by hand. Every tab then re-reads, instead of
 * waiting until its Content Manager is opened again.
 */
import { type FSWatcher, watch } from 'node:fs'

const IGNORED = /(\.tmp$|content\.lock$|\.stale$)/

export type WatchImpl = (
  dir: string,
  options: { recursive: boolean },
  listener: (event: string, filename: string | Buffer | null) => void,
) => FSWatcher

export function createChangeNotifier(send: () => void, debounceMs = 100) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    notify(): void {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        send()
      }, debounceMs)
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}

/**
 * Watch `dir` (recursively where the platform can) and call `onChange` for files that matter.
 * Returns null when the folder is not there yet; the caller tries again after its first write.
 */
export function watchContentHome(
  dir: string,
  onChange: () => void,
  watchImpl: WatchImpl = watch as unknown as WatchImpl,
): { close: () => void } | null {
  const listener = (_event: string, filename: string | Buffer | null) => {
    const name = filename === null ? '' : String(filename)
    if (name !== '' && IGNORED.test(name)) return
    onChange()
  }
  let watcher: FSWatcher
  try {
    watcher = watchImpl(dir, { recursive: true }, listener)
  } catch {
    try {
      watcher = watchImpl(dir, { recursive: false }, listener)
    } catch {
      return null
    }
  }
  watcher.on('error', () => watcher.close())
  return { close: () => watcher.close() }
}
