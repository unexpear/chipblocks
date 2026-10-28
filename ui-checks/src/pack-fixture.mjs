// Builds a content-pack fixture at test time: a fresh ed25519 key per call, held in memory only and
// never written anywhere (no private key is ever committed or left on disk). The signature and the
// sha256 integrity hash cover the same canonical body the app checks: the pack JSON with the
// top-level `integrity` and `signature` fields removed, JSON.stringify(…, null, 2).
import crypto from 'node:crypto'
import { createRotation } from '../../scripts/pack-key-rotation.mjs'

const canonical = (pack) => {
  const copy = { ...pack }
  delete copy.integrity
  delete copy.signature
  return JSON.stringify(copy, null, 2)
}

export function makePack({
  id,
  name,
  packVersion = '1.0.0',
  license = 'MIT',
  description = 'ui-checks test pack (generated at test time).',
  parts,
  sign = true,
  integrity = true,
  editAfterSigning = false,
  keyPair = null,
  rotations = null,
}) {
  const pack = {
    format: 'chipblocks-content-pack',
    version: 1,
    id,
    name,
    packVersion,
    license,
    description,
    parts: parts ?? [
      {
        id: `${id}_buffer`,
        name: `${name} Buffer`,
        designatorPrefix: 'U',
        description: 'A two-pin test part from a ui-checks pack.',
        pins: [
          { id: 'a', name: 'A', side: 'left', electrical: 'input' },
          { id: 'y', name: 'Y', side: 'right', electrical: 'output' },
        ],
      },
    ],
  }
  let publicKeyHex = null
  if (sign) {
    // keyPair: sign several versions with one throwaway key (held in memory by the engine).
    const { publicKey, privateKey } = keyPair ?? crypto.generateKeyPairSync('ed25519')
    publicKeyHex = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex')
    const sig = crypto.sign(null, Buffer.from(canonical(pack), 'utf8'), privateKey)
    pack.signature = { alg: 'ed25519', publicKey: publicKeyHex, sig: sig.toString('hex') }
    // Key rotation statements ride inside the signature object, outside the signed body.
    if (rotations) pack.signature.rotations = rotations
  }
  // Change the body after signing: the signature no longer verifies, while a freshly computed
  // integrity hash still matches — so the signature check is the one that has to refuse it.
  if (editAfterSigning) pack.description = `${pack.description} Edited after signing.`
  if (integrity) {
    pack.integrity = {
      alg: 'sha256',
      hash: crypto.createHash('sha256').update(canonical(pack), 'utf8').digest('hex'),
    }
  }
  return { text: JSON.stringify(pack, null, 2), publicKeyHex }
}

/**
 * A local content registry for a test: pack files + a chipblocks-content-registry-index, written
 * under `dir` (inside the Electron sandbox) and addressed by file:// URLs, which the app accepts
 * only for a local test or dev index. Nothing touches the network. Every pack gets its own
 * throwaway ed25519 key, held in memory only. `fault` makes one entry wrong on purpose:
 *  - 'sha'    the index's sha256 is not the hash of the bytes served
 *  - 'sig'    the pack body was edited after signing (hash + size in the index still match)
 *  - 'key'    the index names a different publisher key than the one that signed the pack
 */
export function makeRegistry({ dir, packs, writeFile, fileUrl }) {
  const entries = []
  for (const p of packs) {
    const { text, publicKeyHex } = makePack({
      id: p.id,
      name: p.name,
      packVersion: p.version ?? '1.0.0',
      editAfterSigning: p.fault === 'sig',
    })
    const file = `${dir}/packs/${p.id}.json`
    writeFile(file, text)
    const bytes = Buffer.from(text, 'utf8')
    const declared = JSON.parse(text).signature
    let sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    if (p.fault === 'sha')
      sha256 = crypto
        .createHash('sha256')
        .update(Buffer.concat([bytes, Buffer.from('\n')]))
        .digest('hex')
    let publicKey = publicKeyHex
    if (p.fault === 'key') {
      const other = crypto.generateKeyPairSync('ed25519').publicKey
      publicKey = Buffer.from(other.export({ format: 'jwk' }).x, 'base64url').toString('hex')
    }
    entries.push({
      id: p.id,
      name: p.name,
      version: p.version ?? '1.0.0',
      downloadUrl: fileUrl(file),
      size: bytes.byteLength,
      sha256,
      signature: { alg: 'ed25519', publicKey, sig: declared.sig },
    })
  }
  const indexFile = `${dir}/index.json`
  writeFile(
    indexFile,
    JSON.stringify(
      { format: 'chipblocks-content-registry-index', version: 1, packs: entries },
      null,
      2,
    ),
  )
  return { indexUrl: fileUrl(indexFile), entries }
}

/**
 * Key rotation statements for a test pack, made with scripts/pack-key-rotation.mjs (the publisher
 * tool) from named in-memory keys. Each spec: { from, to, sequence?, packIds?, issuedAt?, tamper? }.
 * tamper 'scope' adds a pack id after signing (the old key's signature no longer verifies);
 * 'countersign' replaces the new key's countersignature with one by an unrelated key.
 */
export function rotationsFor(specs, packId, keyFor) {
  return specs.map((r) => {
    const statement = createRotation({
      oldPrivateKey: keyFor(r.from).privateKey,
      newPrivateKey: keyFor(r.to).privateKey,
      packIds: r.packIds ?? [packId],
      sequence: r.sequence ?? 1,
      issuedAt: r.issuedAt ?? '2026-10-01T12:00:00Z',
    })
    if (r.tamper === 'scope') statement.packIds = [...statement.packIds, 'another_pack'].sort()
    if (r.tamper === 'countersign') {
      const stranger = crypto.generateKeyPairSync('ed25519').privateKey
      statement.newKeySig = crypto.sign(null, Buffer.from('x'), stranger).toString('hex')
    }
    return statement
  })
}
