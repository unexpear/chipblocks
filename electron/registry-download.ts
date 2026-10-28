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

/**
 * Node's fetch reports every network failure as "fetch failed" or "terminated" and keeps the real
 * reason (an untrusted certificate, a closed socket) in `cause`. Walk that chain so the refusal
 * says what happened. `tls` is true when the cause is a certificate or TLS failure.
 */
export function describeNetworkError(error: unknown): { detail: string; tls: boolean } {
  const parts: string[] = []
  let tls = false
  let e: unknown = error
  for (let depth = 0; depth < 4 && e !== undefined && e !== null; depth++) {
    if (!(e instanceof Error)) {
      parts.push(String(e))
      break
    }
    const code = (e as { code?: unknown }).code
    const text =
      typeof code === 'string' && !e.message.includes(code) ? `${e.message} [${code}]` : e.message
    if (text && !parts.includes(text)) parts.push(text)
    if (
      typeof code === 'string' &&
      /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ERR_TLS|ERR_SSL/.test(code)
    )
      tls = true
    e = (e as { cause?: unknown }).cause
  }
  return { detail: parts.join(': ') || 'unknown error', tls }
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
    const { detail, tls } = describeNetworkError(error)
    if (tls) {
      return {
        ok: false,
        reason: `The registry server's certificate was not accepted (${detail}). Nothing was downloaded.`,
      }
    }
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
  try {
    const collected = await collectBounded(async () => {
      const step = await reader.read()
      if (step.done) return null
      return step.value
    }, maxBytes)
    // Stop the connection once the limit is hit instead of draining the rest.
    if (!collected.ok) await reader.cancel().catch(() => undefined)
    return collected
  } catch (error) {
    if (signal.aborted) {
      return { ok: false, reason: 'The download timed out. Nothing was kept.' }
    }
    // The connection broke after the headers (server closed or reset it mid-body).
    const { detail } = describeNetworkError(error)
    return { ok: false, reason: `The download did not complete (${detail}). Nothing was kept.` }
  }
}

export async function readFileUrlBounded(url: URL, maxBytes: number): Promise<DownloadResult> {
  let path: string
  try {
    path = fileURLToPath(url)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: `That file URL is not a local path (${detail}). Nothing was read.` }
  }
  // \\server\share or //server/share: opening it would sign this computer in to that server.
  if (path.startsWith('\\\\') || path.startsWith('//')) {
    return {
      ok: false,
      reason: 'That file URL points at a network share, not this computer. Nothing was read.',
    }
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
