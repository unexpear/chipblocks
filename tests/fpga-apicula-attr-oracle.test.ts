/**
 * FPGA fabric — Gowin: the attribute engine checked directly against Apicula's own.
 *
 * `fixtures/gowin-gw1n1-attr-reference.json` is the output of Apicula's `parse_attrvals` run over all five real
 * bitstreams, for every logic-cell and I/O-buffer table it decodes non-empty — 793 tables in all.
 *
 * This exists to settle a question an audit raised and could not answer. The engine's second pass drops a row
 * whose attribute has already been set; removing that guard changes 101 of 4740 tables, both adding attributes
 * and altering values. Which behaviour is RIGHT cannot be reasoned out — it needs the reference implementation,
 * which is what this compares against. Reasoning about it, or "fixing" it to match an intuition, would have
 * moved the decoder away from the only oracle available.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  decodeAttributeTable,
  GOWIN_IOB_FAMILY,
  GOWIN_SLICE_FAMILY,
  type GowinAttributeDatabase,
  parseGowinAttributeDatabase,
} from '../src/renderer/fpga-apicula-attributes.ts'
import {
  extractGowinTileBits,
  type GowinChipdb,
  parseGowinChipdb,
} from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'

const db: GowinChipdb = parseGowinChipdb(
  readFileSync(new URL('../fixtures/gowin-gw1n1-chipdb.json', import.meta.url), 'utf8'),
)
const attributes: GowinAttributeDatabase = parseGowinAttributeDatabase(
  readFileSync(new URL('../fixtures/gowin-gw1n1-attributes.json', import.meta.url), 'utf8'),
)

type Row = {
  design: string
  row: number
  col: number
  ttyp: number
  table: string
  attrs: Record<string, number>
}
const REFERENCE: Row[] = JSON.parse(
  readFileSync(new URL('../fixtures/gowin-gw1n1-attr-reference.json', import.meta.url), 'utf8'),
)

const FILES: Record<string, string> = {
  'xnor-dff': 'gowin-gw1n1-xnor-dff.fs',
  adder4: 'gowin-gw1n1-adder4.fs',
  bram1k: 'gowin-gw1n1-bram1k.fs',
  ffvariants: 'gowin-gw1n1-ffvariants.fs',
  adder16: 'gowin-gw1n1-adder16.fs',
}
const frames = new Map<string, boolean[][]>()
for (const [design, file] of Object.entries(FILES))
  frames.set(
    design,
    parseGowinBitstream(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8'))
      .frames,
  )

describe('decodeAttributeTable — against the reference implementation', () => {
  test('the reference really covers all five designs and both table families', () => {
    // Guards the comparison from being narrow: if it only held logic tables, or one design, agreeing would say
    // much less than it appears to.
    expect(REFERENCE.length).toBeGreaterThan(700)
    expect(new Set(REFERENCE.map((r) => r.design)).size).toBe(5)
    expect(new Set(REFERENCE.map((r) => r.table))).toEqual(
      new Set(['CLS0', 'CLS1', 'CLS2', 'IOBA', 'IOBB']),
    )
  })

  test('every LOGIC-CELL table decodes to exactly what Apicula decodes', () => {
    // 273 of them, across all five designs. This is the half the audit could not settle by reasoning: the
    // engine's second pass drops a row whose attribute is already set, and removing that guard changes output.
    // Apicula agrees with the guard, exactly, on every logic table — so the guard is right.
    let compared = 0
    for (const reference of REFERENCE) {
      if (!reference.table.startsWith('CLS')) continue
      const bits = extractGowinTileBits(
        frames.get(reference.design) as boolean[][],
        db,
        reference.row,
        reference.col,
      ) as boolean[][]
      const mine = decodeAttributeTable(
        bits,
        attributes,
        reference.ttyp,
        reference.table,
        GOWIN_SLICE_FAMILY,
      )
      expect(
        Object.fromEntries([...mine].sort()),
        `${reference.design} R${reference.row}C${reference.col} ${reference.table}`,
      ).toEqual(reference.attrs)
      compared++
    }
    expect(compared).toBe(273)
  })

  test('I/O tables do NOT yet match — 97 of 520 differ, and that is measured, not assumed', () => {
    // The other half of the same question, and the answer is the opposite one. Logic tables agree perfectly
    // while I/O tables do not, so the fault is not the disputed guard — it is something specific to the I/O
    // path, whose tables come from a different part of the database (`longval`, not `shortval`).
    //
    // Two shapes of disagreement, both visible in the first failing tile: an attribute Apicula reports and we
    // omit entirely (`PADDI`), and one where we both report an attribute but pick a different value
    // (`IO_TYPE` 31 where Apicula says 75). Anything reading recovered I/O settings is reading some wrong ones.
    //
    // Pinned as an exact count so it cannot drift unnoticed, and so a fix shows up here as a number going down.
    let agree = 0
    let differ = 0
    for (const reference of REFERENCE) {
      if (reference.table.startsWith('CLS')) continue
      const bits = extractGowinTileBits(
        frames.get(reference.design) as boolean[][],
        db,
        reference.row,
        reference.col,
      ) as boolean[][]
      const mine = decodeAttributeTable(
        bits,
        attributes,
        reference.ttyp,
        reference.table,
        GOWIN_IOB_FAMILY,
      )
      const same =
        JSON.stringify(Object.fromEntries([...mine].sort())) === JSON.stringify(reference.attrs)
      if (same) agree++
      else differ++
    }
    expect([agree, differ]).toEqual([423, 97])
  })

  test('the I/O tables really do carry the attributes the audit named', () => {
    // `PADDI` and `IO_TYPE` are the two the guard was said to drop. They appear in the reference — so if our
    // guard dropped them wrongly, the comparison above would fail on those rows rather than pass vacuously.
    const io = REFERENCE.filter((r) => r.table.startsWith('IOB'))
    expect(io.length).toBeGreaterThan(0)
    const names = new Set(io.flatMap((r) => Object.keys(r.attrs)))
    expect(names.has('IO_TYPE')).toBe(true)
    expect(names.has('PADDI')).toBe(true)
  })
})
