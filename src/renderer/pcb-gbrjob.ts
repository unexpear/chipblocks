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
 * IMPORTANT casing quirk (verified against KiCad's output): the Gerber file ATTRIBUTE %TF.FileFunction%
 * uses `Soldermask` / `Paste` / `Profile,NP`, but the JOB FILE's FileFunction uses `SolderMask` /
 * `SolderPaste` / `Profile` — two different vocabularies in the same standard. Our Gerbers already emit
 * the attribute spelling (ground-truthed earlier); this file emits the job-file spelling, so both match
 * KiCad exactly.
 */

/** One entry in the job's FilesAttributes — a Gerber file's path, its job-file FileFunction, polarity. */
export type GbrjobFileAttr = {
  path: string
  function: string
  polarity: 'Positive' | 'Negative'
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** The Gerber Job File "Finish" value for our surface finish — KiCad's board-finish vocabulary verbatim
 *  (hot-air levelling is "HAL" / "HAL lead-free", immersion is "Immersion <metal>"; ground-truthed from
 *  the installed KiCad demo boards' stack-up settings, e.g. "HAL lead-free", "ENIG", "Immersion tin"). */
function jobFinish(stackup: Stackup): string {
  switch (stackup.surfaceFinish) {
    case 'hasl':
      return 'HAL'
    case 'hasl_lead_free':
      return 'HAL lead-free'
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

/** A DETERMINISTIC project GUID formatted as a UUID — the project name's bytes packed into the 16
 *  bytes (the name is visible in the hex, KiCad-style), so the same project always yields the same id
 *  (the manufacturing output is byte-deterministic; a random UUID would break that). */
function projectGuid(name: string): string {
  const bytes = new Array<number>(16).fill(0)
  for (let i = 0; i < name.length && i < 16; i++) bytes[i] = name.charCodeAt(i) & 0xff
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** The board's full cross-section as the job file's MaterialStackup (top → bottom): the outer process
 *  layers (silk / paste) wrap the physical stack-up (mask / copper / dielectric / …). */
function materialStackup(stackup: Stackup): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [
    { Type: 'Legend', Color: 'White', Name: 'Top Silk Screen' },
    { Type: 'SolderPaste', Name: 'Top Solder Paste' },
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
  out.push(
    { Type: 'SolderPaste', Name: 'Bottom Solder Paste' },
    { Type: 'Legend', Color: 'White', Name: 'Bottom Silk Screen' },
  )
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
