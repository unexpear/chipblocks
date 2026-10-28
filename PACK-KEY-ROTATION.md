# Publisher key rotation for content packs

A ChipBlocks user can pin your publisher key (Content Manager → *Trust this publisher…*). After that,
ChipBlocks refuses to install your pack over itself when the new file is signed by a different key,
because a different key could be anyone reusing your pack id. When you really move to a new key,
you sign the change with the old key: a **key rotation statement**. ChipBlocks then installs the
update, but it never pins the new key on its own. The user sees *Publisher key changed:
&lt;old fingerprint&gt; → &lt;new fingerprint&gt;, signed by your pinned key* and decides.

## The tool

`scripts/pack-key-rotation.mjs` (Node 22+, `node:crypto` only, no network). Private keys are
PKCS#8 PEM files that you keep; the tool never prints them.

```sh
# 1. Make the new key (prints its public key in hex).
node scripts/pack-key-rotation.mjs keygen --out new-key.pem

# 2. Sign the new pack version with the new key.
node scripts/pack-key-rotation.mjs sign --key new-key.pem --pack my-pack.json --out my-pack.signed.json

# 3. Sign the hand-over with the old key (the new key countersigns it).
node scripts/pack-key-rotation.mjs create --old-key old-key.pem --new-key new-key.pem \
  --pack-id my_pack --sequence 1 --out rotation-1.json

# 4. Attach it to the signed pack, and ship that file.
node scripts/pack-key-rotation.mjs attach --pack my-pack.signed.json --rotation rotation-1.json \
  --out my-pack.json
```

Keep shipping the rotation with later versions signed by the new key, so users who skipped a
version can still follow it. Rotating again (new key → newer key) appends a second statement:
`attach --rotation rotation-1.json --rotation rotation-2.json` (oldest first). At most 8 are read.

## Format

The statements go in the pack's `signature.rotations` array, oldest first. The `signature` object
is outside both the signed pack body and the content hash, so attaching a rotation changes
neither.

```json
{
  "format": "chipblocks-key-rotation",
  "version": 1,
  "oldKey": "<64 hex: raw ed25519 public key being retired>",
  "newKey": "<64 hex: raw ed25519 public key taking over>",
  "packIds": ["my_pack"],
  "sequence": 1,
  "issuedAt": "2026-10-27T20:00:00Z",
  "sig": "<128 hex: ed25519 signature by oldKey>",
  "newKeySig": "<128 hex: ed25519 signature by newKey>"
}
```

Both signatures cover the same text: `chipblocks-key-rotation-v1\n` followed by
`JSON.stringify({format, version, oldKey, newKey, packIds, sequence, issuedAt})`, with `packIds`
sorted and de-duplicated, in that key order, with no spaces. The domain prefix keeps a rotation
signature from being read as a pack signature or anything else.

* `packIds` is the scope: a statement only counts for the packs it names.
* `sequence` rises with every rotation the same old key signs. ChipBlocks remembers the highest one
  it accepted from each key, so an older or reused statement is refused.
* `issuedAt` may not be more than 5 minutes ahead of the user's clock, and dates must not go
  backwards along a chain.

## What ChipBlocks checks

A rotation is accepted only when all of these hold. Otherwise the install is refused with the
reason, and nothing is written.

1. Every statement is well formed, signed by its `oldKey` and countersigned by its `newKey`
   (forged or edited statements fail here).
2. The pack id is in every statement's `packIds`.
3. The chain connects (each `oldKey` is the previous `newKey`), never returns to a key earlier in
   the chain, and ends at the key that signed the pack.
4. It starts at a key the user pinned. When the pack being replaced was installed from a pinned
   key, the chain must start at that key.
5. It does not move to a key the user already rotated away from, and its sequence is higher than
   any rotation already accepted from that key.

With no rotation at all, the existing refusal for a different key is unchanged.

## What the user sees

The update installs as *valid, not pinned*. The pack's row shows the key change with both
fingerprints and a *Trust the new key…* button; the plain *Trust this publisher…* button is hidden
for that pack. The card stays (also after a relaunch) until the user confirms. Confirming:

* pins the new key;
* removes the old key, unless another installed pack is still signed by it (the message says
  which);
* records the retired key and the accepted sequence in the sealed `~/.chipblocks/trust-seal.json`,
  in the same write as the pins.

The check is repeated from the signed pack file on every load, against the pins the seal vouches
for. Nothing about a rotation is taken from `index.json`.

## Limits

* A rotation proves that whoever held the old key approved the new one. If the old key was stolen,
  the thief can sign a rotation too. The user still has to confirm, and should compare
  fingerprints with you through another channel when it matters.
* There is no revocation list. A key is "retired" only on a computer where the user confirmed a
  rotation away from it.
