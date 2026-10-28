/**
 * The main-process side of installed packs and publisher pins: every write runs under the
 * cross-process content lock, updates the trust seal, and announces the change.
 * Kept out of main.ts so it can be tested on a temp folder with a stand-in for safeStorage.
 */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { mergeRotationState, type RotationState } from '../src/renderer/rotation-state.ts'
import { writeFileAtomic } from './atomic-write.ts'
import type { ContentLock } from './home-lock.ts'
import { isMissingFile } from './missing-file.ts'
import {
  basePayload,
  floorsAfterIndexWrite,
  floorsFromIndex,
  type SealCrypto,
  type SealPayload,
  sealText,
  sealView,
  sha256Text,
  type TrustSealView,
} from './trust-seal.ts'

export type ContentStorePaths = {
  /** ~/.chipblocks */
  root: () => string
}

export const contentPaths = (root: string) => ({
  libraries: join(root, 'libraries'),
  index: join(root, 'libraries', 'index.json'),
  pack: (id: string) => join(root, 'libraries', id, 'pack.json'),
  packDir: (id: string) => join(root, 'libraries', id),
  pins: join(root, 'trusted-publishers.json'),
  seal: join(root, 'trust-seal.json'),
  lock: join(root, 'content.lock'),
})

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
}

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, text)
}

export type StoreWrite = { ok: true; path: string } | { ok: false; reason: string }

export function createContentStore(opts: {
  root: () => string
  crypto: SealCrypto
  lock: ContentLock
  /** Called after a write ChipBlocks made itself succeeded. */
  onChanged?: () => void
}) {
  const paths = () => contentPaths(opts.root())
  // Seal read-modify-writes in this process, one after another.
  let sealChain: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = sealChain.then(fn, fn)
    sealChain = run.catch(() => undefined)
    return run
  }

  async function currentPayload(): Promise<{ payload: SealPayload; trusted: boolean }> {
    const p = paths()
    const sealOnDisk = await readOrNull(p.seal).catch(() => null)
    const base = basePayload(sealOnDisk, opts.crypto)
    if (base !== null) return { payload: base, trusted: true }
    // Missing or untrusted seal: vouch for no pins, and start the floors from index.json as it is.
    const index = await readOrNull(p.index).catch(() => null)
    return { payload: { pinsSha256: null, floors: floorsFromIndex(index) }, trusted: false }
  }

  const changed = () => opts.onChanged?.()

  async function guarded(fn: () => Promise<StoreWrite>): Promise<StoreWrite> {
    const result = await opts.lock.guard(fn)
    if (!result.ok) return result
    if (result.value.ok) changed()
    return result.value
  }

  return {
    paths,

    async writeIndex(text: string): Promise<StoreWrite> {
      return guarded(() =>
        serial(async () => {
          const p = paths()
          try {
            await writeText(p.index, text)
          } catch (error) {
            return { ok: false, reason: `Writing failed: ${String(error)}` }
          }
          // Raise the rollback floors to what was just installed. A failure here leaves the
          // older floors, which only weakens the rollback check; it is not a failed write.
          try {
            const { payload } = await currentPayload()
            const next = { ...payload, floors: floorsAfterIndexWrite(payload.floors, text) }
            await writeText(p.seal, sealText(next, opts.crypto))
          } catch {
            // see above
          }
          return { ok: true, path: p.index }
        }),
      )
    },

    async writePack(id: string, text: string): Promise<StoreWrite> {
      return guarded(async () => {
        const path = paths().pack(id)
        try {
          await writeText(path, text)
          return { ok: true, path }
        } catch (error) {
          return { ok: false, reason: `Writing pack failed: ${String(error)}` }
        }
      })
    },

    async removePack(id: string): Promise<StoreWrite> {
      return guarded(async () => {
        const dir = paths().packDir(id)
        try {
          await rm(dir, { recursive: true, force: true })
          return { ok: true, path: dir }
        } catch (error) {
          return { ok: false, reason: `Removing pack failed: ${String(error)}` }
        }
      })
    },

    /**
     * Seal first, then the pin list. If the pin write fails, the seal no longer matches the old
     * list and the pins read as untrusted, never the other way round. The old seal is put back
     * when it can be. `rotation` (a confirmed key rotation) is merged into the seal in the same
     * write, so the new pin and the retired key are saved together or not at all.
     */
    async writePins(text: string, rotation?: RotationState): Promise<StoreWrite> {
      return guarded(() =>
        serial(async () => {
          const p = paths()
          const oldSeal = await readOrNull(p.seal).catch(() => null)
          try {
            const { payload } = await currentPayload()
            const next: SealPayload = { ...payload, pinsSha256: sha256Text(text) }
            // A confirmed key rotation only adds to what the seal remembers.
            if (rotation !== undefined) {
              next.rotation = mergeRotationState(payload.rotation ?? null, rotation)
            }
            await writeText(p.seal, sealText(next, opts.crypto))
          } catch (error) {
            return { ok: false, reason: `Sealing the pin list failed: ${String(error)}` }
          }
          try {
            await writeText(p.pins, text)
          } catch (error) {
            if (oldSeal !== null) await writeText(p.seal, oldSeal).catch(() => undefined)
            return { ok: false, reason: `Writing failed: ${String(error)}` }
          }
          return { ok: true, path: p.pins }
        }),
      )
    },

    /** The pin list and what the seal says about it, read together. */
    async readTrustSeal(): Promise<TrustSealView> {
      const p = paths()
      let pinsText: string | null = null
      let pinsError: string | undefined
      try {
        pinsText = await readOrNull(p.pins)
      } catch (error) {
        pinsError = String(error)
      }
      let sealOnDisk: string | null = null
      try {
        sealOnDisk = await readOrNull(p.seal)
      } catch {
        sealOnDisk = '' // unreadable reads as a broken seal, never as a missing one
      }
      return sealView(sealOnDisk, pinsText, opts.crypto, pinsError)
    },
  }
}

export type ContentStore = ReturnType<typeof createContentStore>
