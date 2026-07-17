import type { Board } from './pcb-board.ts'
import { isoWithOffset } from './pcb-gerber.ts'
import type { RouteClass } from './pcb-route.ts'
import type { Stackup } from './pcb-stackup.ts'

/**
 * The Gerber Job File (.gbrjob) — the JSON manifest a fab loads alongside the Gerbers so it knows, in
 * one step, which file is which layer, how many copper layers the board has, its finished thickness,
 * surface finish, and material stack. Without it a fab has to guess a layer's role from the file name;
 * with it the whole job loads unambiguously. This is a JSON companion to the Gerber set, defined by the
 * same Ucamco Gerber format spec (§ Gerber Job File). Structure + field names ground-truthed against
 * KiCad 10.0.4's own `kicad-cli pcb export gerbers` output (Header / GeneralSpecs / DesignRules /
 * FilesAttributes / MaterialStackup).
 *
 * The job file's FileFunction reuses the SAME canonical vocabulary as the Gerber %TF.FileFunction%
 * attribute (Ucamco Gerber Job File spec §2.7: FileFunction "has the same interpretation and can take
 * the same values as the .FileFunction X2 attribute") — `Soldermask` / `Paste` / `Profile,NP`, exactly
 * what the sibling Gerbers embed. The caller (pcb-fab.ts) passes those canonical strings, so a CAM tool
 * that cross-checks the manifest against each Gerber's own attribute sees them agree.
 */

/** One entry in the job's FilesAttributes — a Gerber file's path, its job-file FileFunction, polarity. */
export type GbrjobFileAttr = {
  path: string
  function: string
  polarity: 'Positive' | 'Negative'
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** The Gerber Job File "Finish" value for our surface finish — the Ucamco Gerber Job File spec §2.4
 *  enumeration (HASL SnPb | HASL lead-free | Immersion tin/nickel/silver | ENIG | ENEPIG | OSP | …). The
 *  spec deprecated the older "HAL" spelling in favour of "HASL" (rev 2019.09), so we emit "HASL SnPb" /
 *  "HASL lead-free"; the immersion + ENIG/ENEPIG/OSP values already match the enumeration. */
function jobFinish(stackup: Stackup): string {
  switch (stackup.surfaceFinish) {
    case 'hasl':
      return 'HASL SnPb'
    case 'hasl_lead_free':
      return 'HASL lead-free'
    case 'enig':
      return 'ENIG'
    case 'enepig':
      return 'ENEPIG'
    case 'osp':
      return 'OSP'
    case 'immersion_silver':
      return 'Immersion silver'
    case 'immersion_tin':
      return 'Immersion tin'
  }
}

/** SHA-1 of a byte array → 20 bytes (pure JS, no Web-Crypto async). Used only to derive the project
 *  GUID below as a name-based UUID, so the manufacturing output stays byte-reproducible. Exported for a
 *  known-answer test. */
export function sha1Bytes(bytes: number[]): number[] {
  const msg = bytes.slice()
  const ml = bytes.length * 8
  msg.push(0x80)
  while (msg.length % 64 !== 56) msg.push(0)
  msg.push(0, 0, 0, 0, (ml >>> 24) & 0xff, (ml >>> 16) & 0xff, (ml >>> 8) & 0xff, ml & 0xff)
  const rotl = (n: number, c: number) => ((n << c) | (n >>> (32 - c))) >>> 0
  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Array<number>(80).fill(0)
  for (let i = 0; i < msg.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      const p = i + j * 4
      w[j] =
        (((msg[p] ?? 0) << 24) |
          ((msg[p + 1] ?? 0) << 16) |
          ((msg[p + 2] ?? 0) << 8) |
          (msg[p + 3] ?? 0)) >>>
        0
    }
    for (let j = 16; j < 80; j++) {
      w[j] = rotl((w[j - 3] ?? 0) ^ (w[j - 8] ?? 0) ^ (w[j - 14] ?? 0) ^ (w[j - 16] ?? 0), 1)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let j = 0; j < 80; j++) {
      let f: number
      let k: number
      if (j < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (j < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const t = (rotl(a, 5) + f + e + k + (w[j] ?? 0)) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = t
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  const out: number[] = []
  for (const h of [h0, h1, h2, h3, h4]) {
    out.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff)
  }
  return out
}

/** A fixed ChipBlocks namespace UUID (bytes) for the name-based project GUID below. */
const CHIPBLOCKS_NAMESPACE = [
  0x0f, 0x9c, 0x11, 0x2a, 0x6b, 0x3d, 0x4e, 0x57, 0x8a, 0x1c, 0x2d, 0x3e, 0x4f, 0x50, 0x61, 0x72,
]

/** A DETERMINISTIC, RFC-4122-valid project GUID: a version-5 (name-based, SHA-1) UUID over a fixed
 *  ChipBlocks namespace + the project name. The same project name always yields the same id, so the
 *  manufacturing output stays byte-reproducible (a random v4 would break that), while being a
 *  structurally valid UUID (correct version + variant fields) that a CAM tool accepts. Hashing the FULL
 *  name avoids the collisions the old 16-char-truncation packing could produce. */
function projectGuid(name: string): string {
  const b = sha1Bytes([
    ...CHIPBLOCKS_NAMESPACE,
    ...Array.from(new TextEncoder().encode(name)),
  ]).slice(0, 16)
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50 // version 5
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80 // variant 10xx (RFC 4122)
  const hex = b.map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** The board's full cross-section as the job file's MaterialStackup (top → bottom): the fabricated
 *  layers of the FINISHED PCB — legend (silkscreen ink) / mask / copper / dielectric. Solder paste is
 *  NOT listed: it is a stencil/assembly artifact applied later, not a layer of the finished board, so
 *  including it would misrepresent the build (per the spec's "and only those materials" rule). */
function materialStackup(stackup: Stackup): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [
    { Type: 'Legend', Color: 'White', Name: 'Top Silk Screen' },
  ]
  let maskSeen = 0
  for (const layer of stackup.layers) {
    if (layer.type === 'solder_mask') {
      const side = maskSeen === 0 ? 'Top' : 'Bottom'
      maskSeen += 1
      out.push({
        Type: 'SolderMask',
        Color: 'Green',
        Thickness: round3(layer.thicknessMm),
        Name: `${side} Solder Mask`,
      })
    } else if (layer.type === 'copper') {
      out.push({ Type: 'Copper', Thickness: round3(layer.thicknessMm), Name: layer.name })
    } else {
      out.push({
        Type: 'Dielectric',
        Thickness: round3(layer.thicknessMm),
        Material: layer.material ?? 'FR4',
        Name: layer.name,
      })
    }
  }
  out.push({ Type: 'Legend', Color: 'White', Name: 'Bottom Silk Screen' })
  return out
}

/**
 * Build the .gbrjob manifest text for a board. `files` is the exact Gerber set the ZIP contains (the
 * caller owns the file names + layer numbers), each with its job-file FileFunction; the drill file is
 * NOT listed here (it's Excellon, not Gerber — matching KiCad, which keeps the drill separate).
 */
export function gerberJobFile(opts: {
  board: Board
  stackup: Stackup
  cls: RouteClass
  when: Date
  files: readonly GbrjobFileAttr[]
  projectName?: string
}): string {
  const { board, stackup, cls, when, files } = opts
  const name = opts.projectName ?? 'board'
  const job = {
    Header: {
      GenerationSoftware: { Vendor: 'ChipBlocks', Application: 'BoardExport', Version: '1' },
      CreationDate: isoWithOffset(when),
    },
    GeneralSpecs: {
      ProjectId: { Name: name, GUID: projectGuid(name), Revision: '1' },
      Size: { X: round3(board.outline.w), Y: round3(board.outline.h) },
      LayerNumber: stackup.copperLayers,
      BoardThickness: round3(stackup.thicknessMm),
      Finish: jobFinish(stackup),
    },
    DesignRules: [
      {
        Layers: 'Outer',
        PadToPad: round3(cls.clearanceMm),
        PadToTrack: round3(cls.clearanceMm),
        TrackToTrack: round3(cls.clearanceMm),
        MinLineWidth: round3(cls.traceWidthMm),
      },
    ],
    FilesAttributes: files.map((f) => ({
      Path: f.path,
      FileFunction: f.function,
      FilePolarity: f.polarity,
    })),
    MaterialStackup: materialStackup(stackup),
  }
  return JSON.stringify(job, null, 2)
}
