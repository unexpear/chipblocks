/**
 * The Gerber Job File (.gbrjob). Jobs: it's valid JSON with the five sections a fab reads (Header,
 * GeneralSpecs, DesignRules, FilesAttributes, MaterialStackup); the general specs match the board
 * (layer count, finished thickness, finish); the FilesAttributes carry the JOB-FILE FileFunction
 * spelling (SolderMask / SolderPaste / Profile — distinct from the Gerber attribute spelling); the
 * material stack runs top → bottom; and the same board always yields the same manifest (deterministic).
 * Structure ground-truthed against KiCad 10.0.4's own kicad-cli output.
 */
import { describe, expect, test } from 'vitest'
import { deriveBoard } from '../src/renderer/pcb-board.ts'
import { type GbrjobFileAttr, gerberJobFile } from '../src/renderer/pcb-gbrjob.ts'
import { DEFAULT_ROUTE_CLASS } from '../src/renderer/pcb-route.ts'
import { buildStackup, defaultStackup } from '../src/renderer/pcb-stackup.ts'

const WHEN = new Date(2026, 6, 6, 12, 0, 0)
const board = deriveBoard([
  { id: 'R1', definition: 'resistor' },
  { id: 'R2', definition: 'resistor' },
])
const files2: GbrjobFileAttr[] = [
  { path: 'board-F_Cu.gtl', function: 'Copper,L1,Top', polarity: 'Positive' },
  { path: 'board-B_Cu.gbl', function: 'Copper,L2,Bot', polarity: 'Positive' },
  { path: 'board-F_Mask.gts', function: 'SolderMask,Top', polarity: 'Negative' },
  { path: 'board-Edge_Cuts.gm1', function: 'Profile', polarity: 'Positive' },
]

// biome-ignore lint/suspicious/noExplicitAny: parsing an arbitrary JSON structure for assertions
const parse = (stackup = defaultStackup(), files = files2): any =>
  JSON.parse(gerberJobFile({ board, stackup, cls: DEFAULT_ROUTE_CLASS, when: WHEN, files }))

describe('gerberJobFile', () => {
  test('is valid JSON with the five KiCad job-file sections', () => {
    const job = parse()
    for (const key of [
      'Header',
      'GeneralSpecs',
      'DesignRules',
      'FilesAttributes',
      'MaterialStackup',
    ]) {
      expect(job[key]).toBeDefined()
    }
    expect(job.Header.GenerationSoftware.Vendor).toBe('ChipBlocks')
    expect(typeof job.Header.CreationDate).toBe('string')
  })

  test('GeneralSpecs match the board — layer count, finished thickness, finish, size', () => {
    const job = parse()
    expect(job.GeneralSpecs.LayerNumber).toBe(2)
    expect(job.GeneralSpecs.BoardThickness).toBe(1.6)
    expect(job.GeneralSpecs.Finish).toBe('HAL') // default is HASL — KiCad's job-file term is "HAL"
    expect(job.GeneralSpecs.Size.X).toBeCloseTo(board.outline.w, 3)
    expect(job.GeneralSpecs.Size.Y).toBeCloseTo(board.outline.h, 3)
    expect(job.GeneralSpecs.ProjectId.GUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/) // a UUID-format id
  })

  test('DesignRules carry the net class clearance + minimum line width', () => {
    const [rule] = parse().DesignRules
    expect(rule.TrackToTrack).toBe(DEFAULT_ROUTE_CLASS.clearanceMm)
    expect(rule.PadToPad).toBe(DEFAULT_ROUTE_CLASS.clearanceMm)
    expect(rule.MinLineWidth).toBe(DEFAULT_ROUTE_CLASS.traceWidthMm)
  })

  test('FilesAttributes carry the JOB-FILE FileFunction spelling + polarity, path-for-path', () => {
    const attrs = parse().FilesAttributes
    expect(attrs.map((a: { Path: string }) => a.Path)).toEqual(files2.map((f) => f.path))
    const mask = attrs.find((a: { Path: string }) => a.Path === 'board-F_Mask.gts')
    expect(mask.FileFunction).toBe('SolderMask,Top') // job-file spelling (Gerber attr is "Soldermask")
    expect(mask.FilePolarity).toBe('Negative')
    const edge = attrs.find((a: { Path: string }) => a.Path === 'board-Edge_Cuts.gm1')
    expect(edge.FileFunction).toBe('Profile') // job-file spelling (Gerber attr is "Profile,NP")
  })

  test('MaterialStackup runs top → bottom: silk, paste, mask, copper, dielectric, copper, mask, paste, silk', () => {
    const types = parse().MaterialStackup.map((m: { Type: string }) => m.Type)
    expect(types).toEqual([
      'Legend',
      'SolderPaste',
      'SolderMask',
      'Copper',
      'Dielectric',
      'Copper',
      'SolderMask',
      'SolderPaste',
      'Legend',
    ])
    const fr4 = parse().MaterialStackup.find((m: { Type: string }) => m.Type === 'Dielectric')
    expect(fr4.Material).toBe('FR4')
  })

  test('a 4-layer stack-up reports 4 layers + the ENIG finish', () => {
    const stack4 = buildStackup({
      thicknessMm: 1.6,
      copperWeight: 'one_oz',
      surfaceFinish: 'enig',
      copperLayers: 4,
    })
    const job = parse(stack4)
    expect(job.GeneralSpecs.LayerNumber).toBe(4)
    expect(job.GeneralSpecs.Finish).toBe('ENIG')
    // the physical stack now has 4 copper + 3 dielectric sheets between the outer masks
    const copper = job.MaterialStackup.filter((m: { Type: string }) => m.Type === 'Copper')
    expect(copper).toHaveLength(4)
  })

  test('the added finishes map to their KiCad job-file names (ENEPIG / Immersion tin)', () => {
    const opt = (surfaceFinish: 'enepig' | 'immersion_tin') =>
      buildStackup({ thicknessMm: 1.6, copperWeight: 'one_oz', surfaceFinish })
    expect(parse(opt('enepig')).GeneralSpecs.Finish).toBe('ENEPIG')
    expect(parse(opt('immersion_tin')).GeneralSpecs.Finish).toBe('Immersion tin')
  })

  test('deterministic — the same board always yields the same manifest text', () => {
    const a = gerberJobFile({
      board,
      stackup: defaultStackup(),
      cls: DEFAULT_ROUTE_CLASS,
      when: WHEN,
      files: files2,
    })
    const b = gerberJobFile({
      board,
      stackup: defaultStackup(),
      cls: DEFAULT_ROUTE_CLASS,
      when: WHEN,
      files: files2,
    })
    expect(a).toBe(b)
  })
})
