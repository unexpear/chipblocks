/**
 * Download a registry index or pack into memory. Nothing here writes the packs directory.
 * https only; file:// is for a local test or dev index. Redirects are not followed.
 */
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { classifyRegistryUrl } from '../src/renderer/content-registry.ts'

export type DownloadResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: string }

export async function collectBounded(
  pull: () => Promise<Uint8Array | null>,
  maxBytes: number,
): Promise<DownloadResult> {
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const chunk = await pull()
    if (chunk === null) break
    total += chunk.byteLength
    if (total > maxBytes) {
      return {
        ok: false,
        reason: `Download exceeded the ${maxBytes} byte limit (stopped at ${total} bytes). Nothing was kept.`,
      }
    }
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes }
}

export async function readHttpsBounded(
  url: string,
  signal: AbortSignal,
  maxBytes: number,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<DownloadResult> {
  let response: Response
  try {
    response = await fetchImpl(url, { signal, redirect: 'manual' })
  } catch (error) {
    if (signal.aborted) {
      return { ok: false, reason: 'The download timed out. Nothing was kept.' }
    }
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: `The download did not complete (${detail}). Nothing was kept.` }
  }
  if (response.status >= 300 && response.status < 400) {
    return {
      ok: false,
      reason: `The registry URL redirected (HTTP ${response.status}). Redirects are not followed. Nothing was downloaded.`,
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: `The download returned HTTP ${response.status}. Nothing was kept.`,
    }
  }
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const size = Number(declared)
    if (Number.isFinite(size) && size > maxBytes) {
      return {
        ok: false,
        reason: `The download declares ${size} bytes, over the ${maxBytes} byte limit. Nothing was kept.`,
      }
    }
  }
  if (response.body === null) {
    return { ok: false, reason: 'The download had no body. Nothing was kept.' }
  }
  const reader = response.body.getReader()
  return collectBounded(async () => {
    const step = await reader.read()
    if (step.done) return null
    return step.value
  }, maxBytes)
}

export async function readFileUrlBounded(url: URL, maxBytes: number): Promise<DownloadResult> {
  let path: string
  try {
    path = fileURLToPath(url)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: `That file URL is not a local path (${detail}). Nothing was read.` }
  }
  try {
    const info = await stat(path)
    if (!info.isFile()) {
      return { ok: false, reason: 'That file URL is not a file. Nothing was read.' }
    }
    if (info.size > maxBytes) {
      return {
        ok: false,
        reason: `The file is ${info.size} bytes, over the ${maxBytes} byte limit. Nothing was kept.`,
      }
    }
    const buf = await readFile(path)
    return { ok: true, bytes: new Uint8Array(buf) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: `That file URL could not be read (${detail}). Nothing was kept.` }
  }
}

export async function downloadBounded(
  rawUrl: string,
  opts: {
    maxBytes: number
    timeoutMs: number
    httpsGet?: (url: string, signal: AbortSignal, maxBytes: number) => Promise<DownloadResult>
  },
): Promise<DownloadResult> {
  const scheme = classifyRegistryUrl(rawUrl)
  if (!scheme.ok) return scheme
  if (!Number.isInteger(opts.maxBytes) || opts.maxBytes < 1) {
    return { ok: false, reason: 'Download size limit is missing. Nothing was downloaded.' }
  }
  if (scheme.scheme === 'file') return readFileUrlBounded(scheme.url, opts.maxBytes)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs)
  try {
    const get =
      opts.httpsGet ?? ((url, signal, maxBytes) => readHttpsBounded(url, signal, maxBytes))
    const result = await get(rawUrl, ctrl.signal, opts.maxBytes)
    if (ctrl.signal.aborted) {
      return {
        ok: false,
        reason: `The download timed out after ${opts.timeoutMs} ms. Nothing was kept.`,
      }
    }
    return result
  } catch (error) {
    if (ctrl.signal.aborted) {
      return {
        ok: false,
        reason: `The download timed out after ${opts.timeoutMs} ms. Nothing was kept.`,
      }
    }
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: `The download did not complete (${detail}). Nothing was kept.` }
  } finally {
    clearTimeout(timer)
  }
}
