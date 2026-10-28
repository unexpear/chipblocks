/**
 * One writer at a time for the installed packs and the publisher pins, across every ChipBlocks
 * process on this computer.
 *
 * Why it is needed: each ChipBlocks process has one window, and the tabs inside it share one
 * renderer, whose writes are already queued one after another. But nothing stops a second copy of
 * the app (a second window) from running against the same ~/.chipblocks. Its install, enable, or
 * pin change is a read-modify-write of index.json / trusted-publishers.json, so two windows
 * changing packs at the same moment could each write over the other's change.
 *
 * How: a lock file (~/.chipblocks/content.lock) created with exclusive-create (`wx`), so exactly
 * one process can hold it. It names its owner (pid, host, token) and its mtime is refreshed while
 * held. A lock is stale, and taken over, when its owner on this host is no longer running, or
 * when it has not been refreshed for `staleMs` (a crashed or hung owner, or a lock from another
 * host). Inside one process a queue hands the lock to one holder at a time; a holder that never
 * releases loses it after its lease.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, rm, stat, utimes } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname } from 'node:path'

export type LockOwner = { pid: number; host: string; token: string; acquiredAt: number }

export type LockFs = {
  /** Create `path` with `text`, failing with EEXIST when it is already there. */
  create: (path: string, text: string) => Promise<void>
  read: (path: string) => Promise<string>
  mtimeMs: (path: string) => Promise<number>
  touch: (path: string, at: number) => Promise<void>
  remove: (path: string) => Promise<void>
}

export type LockOptions = {
  /** How long to wait for another holder before giving up. */
  timeoutMs?: number
  /** A lock not refreshed for this long is stale. */
  staleMs?: number
  retryMs?: number
  pid?: number
  host?: string
  isAlive?: (pid: number) => boolean
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  fs?: Partial<LockFs>
}

export type HeldFileLock = {
  owner: LockOwner
  refresh: () => Promise<void>
  release: () => Promise<void>
}

export type LockResult =
  | { ok: true; lock: HeldFileLock }
  | { ok: false; reason: string; owner?: LockOwner }

const code = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined

const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY'])

const realLockFs: LockFs = {
  create: async (path, text) => {
    await mkdir(dirname(path), { recursive: true })
    const handle = await open(path, 'wx')
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  read: (path) => readFile(path, 'utf8'),
  mtimeMs: async (path) => (await stat(path)).mtimeMs,
  touch: (path, at) => utimes(path, at / 1000, at / 1000),
  remove: (path) => rm(path, { force: true }),
}

/** Is a process with this pid running? EPERM means it runs under another account. */
export function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return code(error) === 'EPERM'
  }
}

function parseOwner(text: string): LockOwner | null {
  try {
    const raw = JSON.parse(text) as Partial<LockOwner>
    if (
      typeof raw.pid === 'number' &&
      typeof raw.host === 'string' &&
      typeof raw.token === 'string' &&
      typeof raw.acquiredAt === 'number'
    ) {
      return { pid: raw.pid, host: raw.host, token: raw.token, acquiredAt: raw.acquiredAt }
    }
  } catch {
    // An unparseable lock is judged by its age alone.
  }
  return null
}

export async function acquireFileLock(path: string, opts: LockOptions = {}): Promise<LockResult> {
  const io: LockFs = { ...realLockFs, ...opts.fs }
  const timeoutMs = opts.timeoutMs ?? 5000
  const staleMs = opts.staleMs ?? 30_000
  const retryMs = opts.retryMs ?? 50
  const pid = opts.pid ?? process.pid
  const host = opts.host ?? hostname()
  const isAlive = opts.isAlive ?? processIsAlive
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const deadline = now() + timeoutMs
  let lastOwner: LockOwner | undefined
  for (;;) {
    const owner: LockOwner = {
      pid,
      host,
      token: randomBytes(12).toString('hex'),
      acquiredAt: now(),
    }
    const text = JSON.stringify(owner)
    try {
      await io.create(path, text)
      return { ok: true, lock: heldLock(path, owner, io, now) }
    } catch (error) {
      const c = code(error)
      // Windows answers EPERM / EACCES / EBUSY while another process is deleting the lock file.
      if (c !== undefined && TRANSIENT.has(c) && now() < deadline) {
        await sleep(retryMs)
        continue
      }
      if (c !== 'EEXIST') {
        return { ok: false, reason: `The content lock could not be created (${String(error)}).` }
      }
    }
    // Someone holds it. Is it stale?
    let seen: string
    let mtime: number
    try {
      seen = await io.read(path)
      mtime = await io.mtimeMs(path)
    } catch (error) {
      const c = code(error)
      if (c === 'ENOENT') continue // released between our create and read
      if (c !== undefined && TRANSIENT.has(c) && now() < deadline) {
        await sleep(retryMs)
        continue
      }
      return { ok: false, reason: `The content lock could not be read (${String(error)}).` }
    }
    const holder = parseOwner(seen)
    if (holder !== null) lastOwner = holder
    const age = now() - mtime
    // Our own pid can only be a leftover: inside this process the queue never asks while holding.
    const ownerGone =
      holder !== null && holder.host === host && (holder.pid === pid || !isAlive(holder.pid))
    if (ownerGone || age > staleMs) {
      // Take it over only if it is still the same stale lock (not one a third process just made).
      try {
        if ((await io.read(path)) === seen) await io.remove(path)
      } catch (error) {
        const c = code(error)
        if (c !== undefined && TRANSIENT.has(c) && now() < deadline) {
          await sleep(retryMs)
          continue
        }
        if (c !== 'ENOENT') {
          return {
            ok: false,
            reason: `A stale content lock could not be removed (${String(error)}).`,
          }
        }
      }
      continue
    }
    if (now() >= deadline) {
      const who =
        holder === null
          ? 'another ChipBlocks window'
          : `another ChipBlocks window (process ${holder.pid}${holder.host === host ? '' : ` on ${holder.host}`})`
      return {
        ok: false,
        reason: `${who.charAt(0).toUpperCase()}${who.slice(1)} is changing installed packs or publisher pins right now. Nothing was written. Try again in a moment.`,
        ...(lastOwner !== undefined ? { owner: lastOwner } : {}),
      }
    }
    await sleep(retryMs)
  }
}

function heldLock(path: string, owner: LockOwner, io: LockFs, now: () => number): HeldFileLock {
  const mine = JSON.stringify(owner)
  return {
    owner,
    refresh: async () => {
      await io.touch(path, now()).catch(() => undefined)
    },
    release: async () => {
      // Remove it only while it is still ours: after a takeover it belongs to someone else.
      try {
        if ((await io.read(path)) === mine) await io.remove(path)
      } catch {
        // Already gone.
      }
    },
  }
}

/**
 * The lock as one process uses it: a queue so one holder at a time, a heartbeat while held, and a
 * lease so a holder that never releases (a renderer that crashed mid-change) frees it.
 */
export class ContentLock {
  private busy = false
  private waiters: (() => void)[] = []
  private held: {
    token: string
    file: HeldFileLock
    heartbeat: ReturnType<typeof setInterval>
    lease: ReturnType<typeof setTimeout>
  } | null = null

  private readonly path: () => string
  private readonly opts: LockOptions & { leaseMs?: number; heartbeatMs?: number }

  constructor(
    path: () => string,
    opts: LockOptions & { leaseMs?: number; heartbeatMs?: number } = {},
  ) {
    this.path = path
    this.opts = opts
  }

  get isHeld(): boolean {
    return this.held !== null
  }

  private async enter(): Promise<void> {
    if (!this.busy) {
      this.busy = true
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
  }

  private leave(): void {
    const next = this.waiters.shift()
    if (next !== undefined) next()
    else this.busy = false
  }

  async acquire(): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
    await this.enter()
    const got = await acquireFileLock(this.path(), this.opts)
    if (!got.ok) {
      this.leave()
      return { ok: false, reason: got.reason }
    }
    const token = got.lock.owner.token
    const heartbeat = setInterval(() => void got.lock.refresh(), this.opts.heartbeatMs ?? 5000)
    const lease = setTimeout(() => void this.release(token), this.opts.leaseMs ?? 60_000)
    heartbeat.unref?.()
    lease.unref?.()
    this.held = { token, file: got.lock, heartbeat, lease }
    return { ok: true, token }
  }

  async release(token: string): Promise<boolean> {
    const held = this.held
    if (held === null || held.token !== token) return false
    this.held = null
    clearInterval(held.heartbeat)
    clearTimeout(held.lease)
    await held.file.release()
    this.leave()
    return true
  }

  /** Release whatever is held (window closed, app quitting). */
  async releaseAll(): Promise<void> {
    if (this.held !== null) await this.release(this.held.token)
  }

  /**
   * Run one write under the lock. When the renderer already holds it for a whole change, the write
   * is part of that change and runs as is; otherwise the write takes the lock for itself.
   */
  async guard<T>(
    fn: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    if (this.held !== null) return { ok: true, value: await fn() }
    const got = await this.acquire()
    if (!got.ok) return got
    try {
      return { ok: true, value: await fn() }
    } finally {
      await this.release(got.token)
    }
  }
}
