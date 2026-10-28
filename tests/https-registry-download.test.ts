/**
 * The registry's https download path against a real local TLS server with a self-signed certificate
 * made at test time (ui-checks/src/https-fixture.mjs). The production path (downloadBounded with no
 * overrides: Node's fetch, default certificate verification) must refuse a certificate nobody chose
 * to trust; the test-only trust used by the Electron workflow (NODE_EXTRA_CA_CERTS on one spawned
 * process) never reaches shipping code. Servers listen on 127.0.0.1 only and are closed after each
 * test; nothing is installed in any certificate store and nothing touches the network.
 */
import { X509Certificate } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import {
  describeNetworkError,
  downloadBounded,
  readHttpsBounded,
} from '../electron/registry-download.ts'

type Registry = {
  origin: string
  indexUrl: string
  log: string[]
  close: () => Promise<void>
}
type Fixture = {
  makeSelfSignedCert: () => { certPem: string; keyPem: string }
  startHttpsRegistry: (o: {
    packs: { id: string; name: string; mode?: 'good' | 'drop' | 'sha' }[]
    certPem: string
    keyPem: string
  }) => Promise<Registry>
}
const load = async <T>(rel: string): Promise<T> =>
  (await import(pathToFileURL(resolve(rel)).href)) as T

const scratch = mkdtempSync(join(tmpdir(), 'cb-https-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const LIMIT = { maxBytes: 1_000_000, timeoutMs: 10_000 }

describe('test certificate', () => {
  test('is a valid self-signed certificate for localhost and 127.0.0.1', async () => {
    const { makeSelfSignedCert } = await load<Fixture>('ui-checks/src/https-fixture.mjs')
    const { certPem } = makeSelfSignedCert()
    const cert = new X509Certificate(certPem)
    expect(cert.subject).toBe('CN=localhost')
    expect(cert.issuer).toBe('CN=localhost')
    expect(cert.subjectAltName).toContain('DNS:localhost')
    expect(cert.subjectAltName).toContain('IP Address:127.0.0.1')
    expect(cert.checkHost('localhost')).toBe('localhost')
    expect(cert.checkIP('127.0.0.1')).toBe('127.0.0.1')
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('production https path', () => {
  test('no TLS override is active in this process (otherwise the next test proves nothing)', () => {
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe('0')
  })

  test('refuses a self-signed certificate nobody trusted: honest reason, nothing served', async () => {
    const { makeSelfSignedCert, startHttpsRegistry } = await load<Fixture>(
      'ui-checks/src/https-fixture.mjs',
    )
    const tls = makeSelfSignedCert()
    const reg = await startHttpsRegistry({ packs: [{ id: 'p', name: 'P' }], ...tls })
    try {
      const res = await downloadBounded(reg.indexUrl, LIMIT)
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.reason).toMatch(
        /^The registry server's certificate was not accepted \(fetch failed: self-signed certificate.*\[DEPTH_ZERO_SELF_SIGNED_CERT\]\)\. Nothing was downloaded\.$/,
      )
      // the TLS handshake failed, so the server never saw an HTTP request
      expect(reg.log).toEqual([])

      // Control: the same server and certificate work when the certificate is explicitly trusted,
      // so the refusal above is about trust, not a broken certificate or server.
      const status = await new Promise<number | string>((done) => {
        https
          .get(reg.indexUrl, { ca: tls.certPem }, (r) => {
            r.resume()
            r.on('end', () => done(r.statusCode ?? 0))
          })
          .on('error', (e) => done(e.message))
      })
      expect(status).toBe(200)
      expect(reg.log).toEqual(['GET /index.json'])
    } finally {
      await reg.close()
    }
  })

  test('the underlying error names the certificate problem', async () => {
    const { makeSelfSignedCert, startHttpsRegistry } = await load<Fixture>(
      'ui-checks/src/https-fixture.mjs',
    )
    const reg = await startHttpsRegistry({ packs: [], ...makeSelfSignedCert() })
    try {
      const err = await fetch(reg.indexUrl).then(
        () => null,
        (e: unknown) => e as { cause?: { code?: string } },
      )
      expect(err?.cause?.code).toBe('DEPTH_ZERO_SELF_SIGNED_CERT')
    } finally {
      await reg.close()
    }
  })

  test('shipping code never disables or widens certificate checks', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) files.push(p)
      }
    }
    walk(resolve('electron'))
    walk(resolve('src'))
    expect(files.length).toBeGreaterThan(10)
    const banned =
      /rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|setDefaultCACertificates|checkServerIdentity|ignore-certificate-errors|setCertificateVerifyProc|certificate-error/
    const hits = files.filter((f) => banned.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})

describe('a connection dropped mid-download', () => {
  // Plain http on 127.0.0.1 stands in for the transport here (the fetch is redirected to it), so the
  // stream-error handling of readHttpsBounded is exercised without trusting a certificate in this
  // process. The Electron workflow electron-https-registry-live covers the same drop over real TLS.
  test('gives an honest refusal and no bytes', async () => {
    const body = Buffer.from('x'.repeat(4000))
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-length': body.length })
      res.write(body.subarray(0, 1000), () => setTimeout(() => req.socket.destroy(), 30))
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const port = (server.address() as { port: number }).port
    try {
      const res = await readHttpsBounded(
        'https://127.0.0.1/pack.json',
        new AbortController().signal,
        1_000_000,
        (_url, init) => fetch(`http://127.0.0.1:${port}/pack.json`, init),
      )
      expect(res).toEqual({
        ok: false,
        reason: expect.stringMatching(
          /^The download did not complete \(terminated: .+\)\. Nothing was kept\.$/,
        ),
      })
    } finally {
      server.closeAllConnections()
      await new Promise((done) => server.close(done))
    }
  })
})

describe('ui-checks harness', () => {
  test('refuses a test CA file outside the workflow sandbox', async () => {
    const { ElectronSession } = await load<{
      ElectronSession: new (o: Record<string, unknown>) => unknown
    }>('ui-checks/src/electron.mjs')
    const sandbox = { root: join(scratch, 'sandbox') }
    expect(
      () =>
        new ElectronSession({ repo: resolve('.'), sandbox, testCaFile: join(scratch, 'ca.pem') }),
    ).toThrow(/outside the sandbox/)
    expect(
      () =>
        new ElectronSession({
          repo: resolve('.'),
          sandbox,
          testCaFile: join(sandbox.root, 'test-ca.pem'),
        }),
    ).not.toThrow()
  })
})

describe('describeNetworkError', () => {
  test('walks the cause chain and flags certificate failures', () => {
    const cert = Object.assign(new Error('unable to verify the first certificate'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    })
    expect(describeNetworkError(new TypeError('fetch failed', { cause: cert }))).toEqual({
      detail:
        'fetch failed: unable to verify the first certificate [UNABLE_TO_VERIFY_LEAF_SIGNATURE]',
      tls: true,
    })
    const closed = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
    expect(describeNetworkError(new TypeError('terminated', { cause: closed }))).toEqual({
      detail: 'terminated: other side closed [UND_ERR_SOCKET]',
      tls: false,
    })
    expect(describeNetworkError('boom')).toEqual({ detail: 'boom', tls: false })
  })
})
