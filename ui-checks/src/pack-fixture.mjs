// Builds a content-pack fixture at test time: a fresh ed25519 key per call, held in memory only and
// never written anywhere (no private key is ever committed or left on disk). The signature and the
// sha256 integrity hash cover the same canonical body the app checks: the pack JSON with the
// top-level `integrity` and `signature` fields removed, JSON.stringify(…, null, 2).
import crypto from 'node:crypto'

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
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    publicKeyHex = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex')
    const sig = crypto.sign(null, Buffer.from(canonical(pack), 'utf8'), privateKey)
    pack.signature = { alg: 'ed25519', publicKey: publicKeyHex, sig: sig.toString('hex') }
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
