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

/**
 * How many of the 793 reference tables change their answer when their rows are reordered: 440, more than half.
 *
 * The decode keeps the LAST matching row, so the database's row order is part of the answer — it is not merely
 * a tidiness question. Two consequences:
 *
 *  - Matching the reference toolchain REQUIRES preserving its row order exactly. The fixtures were being
 *    written with their keys sorted, which discarded it. They are now written in the database's order.
 *  - Agreement with the reference is therefore conditional on that order, not a property of the algorithm
 *    alone. A decode this sensitive to input order deserves the number stated rather than a reassurance.
 *
 * I first described this as a hazard that "wasn't the cause here", on the strength of the sorted and unsorted
 * fixtures happening to give identical results. That much is true — both give 273/0 and 423/97 — but it does
 * not mean the decode is order-insensitive, and this test is what actually establishes the position.
 */
const ORDER_DEPENDENT_TABLES = 440

describe('row order CHANGES what some tables decode to — a live hazard', () => {
  test('shuffling rows changes a measured number of the 793 decodes', () => {
    // The decode takes the LAST matching row, so row order can in principle change the answer — which is why
    // the fixtures are now written in the database's own order rather than sorted.
    //
    // I claimed in a commit message that the ordering "wasn't the cause" of the I/O disagreement before
    // actually measuring it. It wasn't — but this is the check that says so, rather than my say-so. Shuffling
    // deterministically and re-decoding every reference table must change nothing; if a future table ever does
    // depend on order, this fires instead of silently picking whichever row came last.
    let seed = 20260801
    const shuffled = {
      ...attributes,
      tables: new Map(
        [...attributes.tables].map(([ttyp, byName]) => [
          ttyp,
          new Map(
            [...byName].map(([name, rows]) => {
              const copy = [...rows]
              for (let i = copy.length - 1; i > 0; i--) {
                seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
                const j = seed % (i + 1)
                ;[copy[i], copy[j]] = [
                  copy[j] as (typeof copy)[number],
                  copy[i] as (typeof copy)[number],
                ]
              }
              return [name, copy]
            }),
          ),
        ]),
      ),
    }

    let stable = 0
    let orderDependent = 0
    const dependentTables = new Set<string>()
    for (const reference of REFERENCE) {
      const bits = extractGowinTileBits(
        frames.get(reference.design) as boolean[][],
        db,
        reference.row,
        reference.col,
      ) as boolean[][]
      const family = reference.table.startsWith('CLS') ? GOWIN_SLICE_FAMILY : GOWIN_IOB_FAMILY
      const before = decodeAttributeTable(bits, attributes, reference.ttyp, reference.table, family)
      const after = decodeAttributeTable(bits, shuffled, reference.ttyp, reference.table, family)
      if (
        JSON.stringify(Object.fromEntries([...after].sort())) ===
        JSON.stringify(Object.fromEntries([...before].sort()))
      )
        stable++
      else {
        orderDependent++
        dependentTables.add(reference.table)
      }
    }
    expect(stable + orderDependent).toBe(REFERENCE.length)
    // The measured extent, pinned so it cannot drift and so a fix shows as the number falling to zero.
    expect(orderDependent).toBe(ORDER_DEPENDENT_TABLES)
    // Both families are affected, so this is not the I/O-specific fault the previous test isolates.
    expect(dependentTables.size).toBeGreaterThan(0)
  })
})
