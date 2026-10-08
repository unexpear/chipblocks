# Content registry index (version 1)

ChipBlocks can install a community pack from a **registry index you configure**. No registry URL is built in, because no ChipBlocks registry exists. An empty Content Manager is the honest state: nothing is downloaded until you set an index URL and choose a pack.

The index is JSON matching [`content-registry-index.schema.json`](content-registry-index.schema.json) (`format` `chipblocks-content-registry-index`, `version` `1`).

```json
{
  "format": "chipblocks-content-registry-index",
  "version": 1,
  "packs": [
    {
      "id": "demo_pack",
      "name": "Demo pack",
      "version": "1.0.0",
      "downloadUrl": "https://example.invalid/demo_pack.json",
      "size": 1234,
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "signature": {
        "alg": "ed25519",
        "publicKey": "<32-byte ed25519 public key, hex or base64>",
        "sig": "<64-byte ed25519 signature, hex or base64>"
      }
    }
  ]
}
```

The `example.invalid` URL above is a shape sample. It is not a registry ChipBlocks contacts.

## What each field means

| Field | Rule |
|---|---|
| `id` | Snake-case pack id. Must equal `id` inside the pack file. |
| `version` | Must equal the pack file's `packVersion` string. `1.2` and `1.2.0` are not the same string. |
| `downloadUrl` | `https://` only, except `file://` for a local test or dev index. `http://` and any other scheme are refused. Redirects are not followed. |
| `size` | Exact byte length of that file. Larger than 2,097,152 bytes is refused. |
| `sha256` | SHA-256 of the **exact downloaded bytes** (the whole file, including its `integrity` and `signature` fields). |
| `signature` | The same ed25519 key and signature the pack file declares. Checked over the canonical pack body (top-level `integrity` and `signature` removed, then `JSON.stringify` with two-space indent) before install. |

`name` is optional and is only a label.

## What happens on install

1. You save an index URL (`https`, or `file://` in a test). It is stored in `~/.chipblocks/content-registry.json` (`format` `chipblocks-content-registry-settings`, `version` `1`, field `indexUrl`). A missing file means no registry is configured.
2. **Load registry index** downloads that index in the desktop app (size cap 512 KiB, timeout 15 s) and checks this schema. A bad index is shown and not used. No pack is downloaded by loading the index.
3. **Install from registry** downloads the one pack you picked (size cap 2 MiB, timeout 20 s) into memory. It then checks, in order: declared size, the 2 MiB cap, SHA-256, UTF-8, the registry signature against the pack's signature, the ed25519 verify, the pack's own format and license, and any content hash declared inside the pack. The pack id and `packVersion` must match the index row.
4. Only after those checks does install use the same write as **Install from local pack**: `~/.chipblocks/libraries/<id>/pack.json` and `libraries/index.json`.

A mismatch stops before that write. If the index row is an update of a pack already on disk and the index file cannot be saved afterward, the previous `pack.json` is put back when it can be read. A new pack whose index row cannot be saved has its directory removed. The message says what was left.

## Updates

If an installed pack's id is in the index and the index `version` is a newer `major.minor.patch` number, the panel says **update available**. Versions that are not plain numbers (for example `1.0.0-beta`) are not called newer. Nothing is downloaded or replaced until you install that pack yourself.

## Trusted publishers

A separate file, `~/.chipblocks/trusted-publishers.json`, matches [`trusted-publishers.schema.json`](trusted-publishers.schema.json). The desktop app loads it through the preload bridge. No keys are included with the app. A valid pack signature whose key is in that file is **valid-trusted**. The same valid signature with no pin is **valid-untrusted** (the author put their own key in the pack). A file that is not valid JSON, the wrong format or version, or has a bad key entry is reported in the Content Manager and treated as **no trusted keys**. It is not overwritten.

Trust and untrust are buttons on a signed pack. The confirm step shows the key fingerprint: SHA-256 of the raw 32-byte public key, as hex. The write re-reads the pin file first. If that read throws, or the file does not parse, nothing is written.

The fingerprint and the pin are not a certificate authority.
