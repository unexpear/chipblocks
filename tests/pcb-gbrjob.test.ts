/**
 * The Gerber Job File (.gbrjob). Jobs: it's valid JSON with the five sections a fab reads (Header,
 * GeneralSpecs, DesignRules, FilesAttributes, MaterialStackup); the general specs match the board
 * (layer count, finished thickness, finish); the FilesAttributes carry the SAME canonical FileFunction
 * the sibling Gerbers embed (Soldermask / Paste / Profile,NP); the material stack lists only fabricated
 * layers top → bottom (no solder paste); the finish is the spec's HASL spelling; the project GUID is a
 * valid RFC-4122 v5 UUID; and the same board always yields the same manifest (deterministic).
 * Structure ground-truthed against KiCad 10.0.4's own kicad-cli output.
 */
import { describe, expect, test } from 'vitest'
import { deriveBoard } from '../src/renderer/pcb-board.ts'
import { type GbrjobFileAttr, gerberJobFile, sha1Bytes } from '../src/renderer/pcb-gbrjob.ts'
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
  { path: 'board-F_Mask.gts', function: 'Soldermask,Top', polarity: 'Negative' },
  { path: 'board-Edge_Cuts.gm1', function: 'Profile,NP', polarity: 'Positive' },
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
    expect(job.GeneralSpecs.Finish).toBe('HASL SnPb') // the spec's canonical finish (deprecated "HAL")
    expect(job.GeneralSpecs.Size.X).toBeCloseTo(board.outline.w, 3)
    expect(job.GeneralSpecs.Size.Y).toBeCloseTo(board.outline.h, 3)
    // a valid RFC-4122 version-5 UUID: version nibble 5, variant nibble 8/9/a/b
    expect(job.GeneralSpecs.ProjectId.GUID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  test('DesignRules carry the net class clearance + minimum line width', () => {
    const [rule] = parse().DesignRules
    expect(rule.TrackToTrack).toBe(DEFAULT_ROUTE_CLASS.clearanceMm)
    expect(rule.PadToPad).toBe(DEFAULT_ROUTE_CLASS.clearanceMm)
    expect(rule.MinLineWidth).toBe(DEFAULT_ROUTE_CLASS.traceWidthMm)
  })

  test('FilesAttributes carry the canonical FileFunction + polarity, path-for-path', () => {
    const attrs = parse().FilesAttributes
    expect(attrs.map((a: { Path: string }) => a.Path)).toEqual(files2.map((f) => f.path))
    const mask = attrs.find((a: { Path: string }) => a.Path === 'board-F_Mask.gts')
    expect(mask.FileFunction).toBe('Soldermask,Top') // same as the Gerber's own %TF.FileFunction
    expect(mask.FilePolarity).toBe('Negative')
    const edge = attrs.find((a: { Path: string }) => a.Path === 'board-Edge_Cuts.gm1')
    expect(edge.FileFunction).toBe('Profile,NP') // the plating-span suffix the Gerber carries too
  })

  test('MaterialStackup lists only fabricated layers top → bottom (no solder paste)', () => {
    const types = parse().MaterialStackup.map((m: { Type: string }) => m.Type)
    expect(types).toEqual([
      'Legend',
      'SolderMask',
      'Copper',
      'Dielectric',
      'Copper',
      'SolderMask',
      'Legend',
    ])
    // solder paste is an assembly stencil, not a layer of the finished board — never listed
    expect(types).not.toContain('SolderPaste')
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

describe('project GUID — a deterministic, valid RFC-4122 v5 UUID', () => {
  const guid = (name: string) =>
    JSON.parse(
      gerberJobFile({
        board,
        stackup: defaultStackup(),
        cls: DEFAULT_ROUTE_CLASS,
        when: WHEN,
        files: files2,
        projectName: name,
      }),
    ).GeneralSpecs.ProjectId.GUID

  test('the SHA-1 matches the standard known-answer vector for "abc"', () => {
    const hex = sha1Bytes([...'abc'].map((c) => c.charCodeAt(0)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    expect(hex).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  test('same name → same GUID; distinct names → distinct GUIDs', () => {
    expect(guid('MyBoard')).toBe(guid('MyBoard'))
    expect(guid('MyBoard')).not.toBe(guid('OtherBoard'))
  })

  test('names sharing the first 16 chars do NOT collide (the old-truncation bug)', () => {
    expect(guid('ThisIsALongName_A')).not.toBe(guid('ThisIsALongName_B'))
  })
})
