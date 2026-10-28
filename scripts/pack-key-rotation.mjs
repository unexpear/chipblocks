#!/usr/bin/env node
// Publisher tool for ChipBlocks content packs: make ed25519 keys, sign a pack, and move a pack to a
// new signing key with a key rotation statement that the old key signs (and the new key
// countersigns). Node only (node:crypto), no network. Private keys are PKCS#8 PEM files you keep;
// this tool never prints them.
//
//   node scripts/pack-key-rotation.mjs keygen --out new-key.pem
//   node scripts/pack-key-rotation.mjs sign --key new-key.pem --pack pack.json [--out signed.json]
//   node scripts/pack-key-rotation.mjs create --old-key old-key.pem --new-key new-key.pem \
//        --pack-id my-pack [--pack-id other-pack] --sequence 1 [--issued-at 2026-10-27T20:00:00Z] \
//        [--out rotation.json]
//   node scripts/pack-key-rotation.mjs attach --pack signed.json --rotation rotation.json \
//        [--rotation next-rotation.json] [--out signed-with-rotation.json]
//
// The statement format and its signing text must match src/renderer/key-rotation.ts; a vitest
// (tests/key-rotation.test.ts) checks this script's output with the app's verifier.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const KEY_ROTATION_FORMAT = 'chipblocks-key-rotation'
export const KEY_ROTATION_DOMAIN = 'chipblocks-key-rotation-v1\n'

export function rotationSigningText({ oldKey, newKey, packIds, sequence, issuedAt }) {
  return `${KEY_ROTATION_DOMAIN}${JSON.stringify({
    format: KEY_ROTATION_FORMAT,
    version: 1,
    oldKey,
    newKey,
    packIds: [...new Set(packIds)].sort(),
    sequence,
    issuedAt,
  })}`
}

/** Raw 32-byte ed25519 public key, lowercase hex, from a private or public KeyObject. */
export function rawPublicKeyHex(key) {
  const pub = key.type === 'private' ? crypto.createPublicKey(key) : key
  return Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url').toString('hex')
}

/** The pack body the app signs and hashes: top-level integrity and signature removed. */
export function canonicalPackBody(pack) {
  const copy = { ...pack }
  delete copy.integrity
  delete copy.signature
  return JSON.stringify(copy, null, 2)
}

export function createRotation({ oldPrivateKey, newPrivateKey, packIds, sequence, issuedAt }) {
  if (!Array.isArray(packIds) || packIds.length === 0 || packIds.some((id) => !id)) {
    throw new Error('Give at least one pack id the rotation covers.')
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(
      'The sequence must be a whole number of 1 or more, higher than any earlier rotation from this old key.',
    )
  }
  const at = issuedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(at)) {
    throw new Error('issued-at must be an ISO 8601 UTC time such as 2026-10-27T20:00:00Z.')
  }
  const statement = {
    format: KEY_ROTATION_FORMAT,
    version: 1,
    oldKey: rawPublicKeyHex(oldPrivateKey),
    newKey: rawPublicKeyHex(newPrivateKey),
    packIds: [...new Set(packIds)].sort(),
    sequence,
    issuedAt: at,
  }
  if (statement.oldKey === statement.newKey)
    throw new Error('The old and new keys are the same key.')
  const text = Buffer.from(rotationSigningText(statement), 'utf8')
  return {
    ...statement,
    sig: crypto.sign(null, text, oldPrivateKey).toString('hex'),
    newKeySig: crypto.sign(null, text, newPrivateKey).toString('hex'),
  }
}

/** Sign (or re-sign) a pack with `privateKey`; keeps a declared sha256 integrity hash current. */
export function signPackText(packText, privateKey) {
  const pack = JSON.parse(packText)
  const body = canonicalPackBody(pack)
  const rotations = pack.signature?.rotations
  pack.signature = {
    alg: 'ed25519',
    publicKey: rawPublicKeyHex(privateKey),
    sig: crypto.sign(null, Buffer.from(body, 'utf8'), privateKey).toString('hex'),
    ...(rotations !== undefined ? { rotations } : {}),
  }
  if (pack.integrity !== undefined) {
    pack.integrity = {
      alg: 'sha256',
      hash: crypto.createHash('sha256').update(body, 'utf8').digest('hex'),
    }
  }
  return JSON.stringify(pack, null, 2)
}

/** Append rotation statements (oldest first) to a signed pack's signature.rotations. */
export function attachRotations(packText, statements) {
  const pack = JSON.parse(packText)
  const signature = pack.signature
  if (
    typeof signature !== 'object' ||
    signature === null ||
    typeof signature.publicKey !== 'string'
  ) {
    throw new Error('The pack has no publisher signature. Sign it with the new key first.')
  }
  const chain = [...(Array.isArray(signature.rotations) ? signature.rotations : []), ...statements]
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].oldKey !== chain[i - 1].newKey) {
      throw new Error(`Rotation ${i + 1} does not start at the key rotation ${i} moved to.`)
    }
  }
  const last = chain[chain.length - 1]
  if (last !== undefined && last.newKey !== signature.publicKey.toLowerCase()) {
    throw new Error('The last rotation does not end at the key that signed this pack.')
  }
  if (last !== undefined) {
    for (const s of chain) {
      if (!s.packIds.includes(pack.id)) {
        throw new Error(`A rotation covers ${s.packIds.join(', ')}, not this pack (${pack.id}).`)
      }
    }
  }
  signature.rotations = chain
  return JSON.stringify(pack, null, 2)
}

const readKey = (file) => crypto.createPrivateKey(fs.readFileSync(file, 'utf8'))

function parseArgs(argv) {
  const opts = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      opts._.push(a)
      continue
    }
    const name = a.slice(2)
    const value = argv[++i]
    if (value === undefined) throw new Error(`--${name} needs a value.`)
    if (name === 'pack-id' || name === 'rotation') {
      opts[name] ??= []
      opts[name].push(value)
    } else opts[name] = value
  }
  return opts
}

function output(opts, text) {
  if (opts.out) {
    fs.writeFileSync(opts.out, `${text}\n`)
    console.error(`Wrote ${opts.out}`)
  } else process.stdout.write(`${text}\n`)
}

export function main(argv) {
  const [command, ...rest] = argv
  const opts = parseArgs(rest)
  if (command === 'keygen') {
    if (!opts.out)
      throw new Error('keygen needs --out <file.pem> (the private key stays with you).')
    if (fs.existsSync(opts.out)) throw new Error(`${opts.out} already exists; not overwritten.`)
    const { privateKey } = crypto.generateKeyPairSync('ed25519')
    fs.writeFileSync(opts.out, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
    console.log(
      `Private key written to ${opts.out}. Public key (hex): ${rawPublicKeyHex(privateKey)}`,
    )
    return
  }
  if (command === 'sign') {
    if (!opts.key || !opts.pack) throw new Error('sign needs --key <file.pem> --pack <pack.json>.')
    output(opts, signPackText(fs.readFileSync(opts.pack, 'utf8'), readKey(opts.key)))
    return
  }
  if (command === 'create') {
    if (!opts['old-key'] || !opts['new-key'] || !opts['pack-id'] || !opts.sequence) {
      throw new Error('create needs --old-key, --new-key, --pack-id (one or more) and --sequence.')
    }
    const statement = createRotation({
      oldPrivateKey: readKey(opts['old-key']),
      newPrivateKey: readKey(opts['new-key']),
      packIds: opts['pack-id'],
      sequence: Number(opts.sequence),
      issuedAt: opts['issued-at'],
    })
    output(opts, JSON.stringify(statement, null, 2))
    return
  }
  if (command === 'attach') {
    if (!opts.pack || !opts.rotation) throw new Error('attach needs --pack and --rotation.')
    const statements = opts.rotation.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))
    output(opts, attachRotations(fs.readFileSync(opts.pack, 'utf8'), statements))
    return
  }
  throw new Error(
    'Commands: keygen, sign, create, attach. See the header of scripts/pack-key-rotation.mjs or PACK-KEY-ROTATION.md.',
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
