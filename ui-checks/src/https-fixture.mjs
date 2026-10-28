// A local https content registry for a test, with a self-signed certificate made at test time.
// The certificate is built here with node:crypto alone (a P-256 key and a minimal X.509 v3 DER
// encoding: subject/issuer CN=localhost, SAN localhost + 127.0.0.1, CA:true), so nothing is
// installed, downloaded, or added to any certificate store. The private key stays in memory; only
// the public certificate is written, inside the test sandbox, for the one Electron process that
// is told to trust it (NODE_EXTRA_CA_CERTS on that spawned process only; see run.mjs).
// The server listens on 127.0.0.1 only, on a free port, and is closed when the workflow ends.
import crypto from 'node:crypto'
import https from 'node:https'
import { makePack } from './pack-fixture.mjs'

// ---- minimal DER ----
const len = (n) => {
  if (n < 0x80) return Buffer.from([n])
  const bytes = []
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body])
const seq = (...items) => tlv(0x30, Buffer.concat(items))
const set = (...items) => tlv(0x31, Buffer.concat(items))
const oid = (dotted) => {
  const [a, b, ...rest] = dotted.split('.').map(Number)
  const out = [40 * a + b]
  for (const v of rest) {
    const groups = []
    let x = v
    do {
      groups.unshift(x & 0x7f)
      x = Math.floor(x / 128)
    } while (x > 0)
    for (let i = 0; i < groups.length - 1; i++) groups[i] |= 0x80
    out.push(...groups)
  }
  return tlv(0x06, Buffer.from(out))
}
const int = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf)
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'))
const utcTime = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  return tlv(0x17, Buffer.from(s, 'ascii'))
}
const explicit = (n, body) => tlv(0xa0 + n, body)
const octets = (body) => tlv(0x04, body)
const bits = (body) => tlv(0x03, Buffer.concat([Buffer.from([0]), body]))
const pem = (label, der) =>
  `-----BEGIN ${label}-----\n${der
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n')}\n-----END ${label}-----\n`

/** A fresh self-signed certificate for localhost / 127.0.0.1, valid from 1 hour ago for 1 day. */
export function makeSelfSignedCert({
  cn = 'localhost',
  dns = ['localhost'],
  ips = ['127.0.0.1'],
} = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'))
  const name = seq(set(seq(oid('2.5.4.3'), utf8(cn))))
  const now = Date.now()
  const san = seq(
    ...dns.map((d) => tlv(0x82, Buffer.from(d, 'ascii'))),
    ...ips.map((ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number)))),
  )
  const extensions = seq(
    seq(
      oid('2.5.29.19'),
      tlv(0x01, Buffer.from([0xff])),
      octets(seq(tlv(0x01, Buffer.from([0xff])))),
    ),
    seq(oid('2.5.29.17'), octets(san)),
  )
  const serial = crypto.randomBytes(16)
  serial[0] &= 0x7f
  const tbs = seq(
    explicit(0, int(Buffer.from([2]))),
    int(serial),
    ecdsaSha256,
    name,
    seq(utcTime(new Date(now - 3600_000)), utcTime(new Date(now + 86400_000))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, extensions),
  )
  const signature = crypto.sign('sha256', tbs, privateKey)
  const der = seq(tbs, ecdsaSha256, bits(signature))
  const certPem = pem('CERTIFICATE', der)
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  // Parse it back: a malformed certificate should fail here, not as a confusing TLS error later.
  const parsed = new crypto.X509Certificate(certPem)
  if (!parsed.verify(publicKey)) throw new Error('makeSelfSignedCert: signature does not verify')
  return { certPem, keyPem }
}

/**
 * Start a registry over https on 127.0.0.1 (free port). `packs`: [{ id, name, mode }] where mode is
 *  - 'good'  served as listed
 *  - 'drop'  headers + the first half of the bytes, then the socket is destroyed mid-download
 *  - 'sha'   the index's sha256 is not the hash of the bytes served
 * Two indexes are served: /index.json (every pack, https downloads) and /index-file-download.json
 * (one entry whose downloadUrl is file://, which an https index may not list).
 */
export async function startHttpsRegistry({ packs, certPem, keyPem, fileDownloadUrl }) {
  const served = new Map()
  const log = []
  const server = https.createServer({ cert: certPem, key: keyPem }, (req, res) => {
    const url = new URL(req.url, 'https://127.0.0.1')
    log.push(`${req.method} ${url.pathname}`)
    const body = served.get(url.pathname)
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.bytes.length })
    if (body.mode === 'drop') {
      res.write(body.bytes.subarray(0, Math.floor(body.bytes.length / 2)), () => {
        setTimeout(() => req.socket.destroy(), 50)
      })
      return
    }
    res.end(body.bytes)
  })
  const sockets = new Set()
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = `https://127.0.0.1:${server.address().port}`
  const entries = []
  for (const p of packs) {
    const { text } = makePack({ id: p.id, name: p.name, packVersion: p.version ?? '1.0.0' })
    const bytes = Buffer.from(text, 'utf8')
    const route = `/packs/${p.id}.json`
    served.set(route, { bytes, mode: p.mode ?? 'good' })
    let sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    if (p.mode === 'sha')
      sha256 = crypto
        .createHash('sha256')
        .update(Buffer.concat([bytes, Buffer.from('\n')]))
        .digest('hex')
    entries.push({
      id: p.id,
      name: p.name,
      version: p.version ?? '1.0.0',
      downloadUrl: `${origin}${route}`,
      size: bytes.byteLength,
      sha256,
      signature: JSON.parse(text).signature,
    })
  }
  const index = (list) =>
    Buffer.from(
      JSON.stringify(
        { format: 'chipblocks-content-registry-index', version: 1, packs: list },
        null,
        2,
      ),
      'utf8',
    )
  served.set('/index.json', { bytes: index(entries), mode: 'good' })
  if (fileDownloadUrl && entries.length)
    served.set('/index-file-download.json', {
      bytes: index([{ ...entries[0], id: `${entries[0].id}_file`, downloadUrl: fileDownloadUrl }]),
      mode: 'good',
    })
  return {
    origin,
    indexUrl: `${origin}/index.json`,
    fileIndexUrl: `${origin}/index-file-download.json`,
    log,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      }),
  }
}
