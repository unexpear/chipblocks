/**
 * FPGA fabric — Stage 3a: parse a WHOLE vendor `.bin` bitstream file (fpga-icebox-bin.ts).
 *
 * The headline test parses `fixtures/icebox-ice40-384-onebit.bin` — a GENUINE file produced by the real Project
 * IceStorm `icepack` tool (not hand-crafted) — recovering its device, dimensions, four CRAM banks, and a verified
 * CRC. It was generated (reproducibly) by:
 *     printf '.comment\nchipblocks test bin\n.device 384\n.logic_tile 1 1\n' > t.asc
 *     printf '010000...(16 rows × 54 cols, one bit set)...\n' >> t.asc
 *     icepack t.asc icebox-ice40-384-onebit.bin
 * and real `icepack -u` reports "CRC Check OK / Chip type is '384'" for it. Because the file is authentic, a
 * passing parse proves the format transcription (frame commands + CRC-16) is correct against the real tool. The
 * remaining tests prove the writer is byte-identical to icepack (parse → serialize reproduces the file exactly),
 * writer↔parser symmetry on arbitrary data, CRC-failure reporting, BRAM recovery, and malformed-input handling.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  type BinBanks,
  type BinConfig,
  crc16Update,
  parseBinFile,
  serializeBinFile,
} from '../src/renderer/fpga-icebox-bin.ts'

const REAL = new Uint8Array(
  readFileSync(new URL('../fixtures/icebox-ice40-384-onebit.bin', import.meta.url)),
)

const countSet = (banks: BinBanks): number =>
  banks.reduce((n, bank) => n + bank.reduce((m, col) => m + col.filter(Boolean).length, 0), 0)

describe('parseBinFile — a real icepack-produced .bin', () => {
  const parsed = parseBinFile(REAL)

  test('recovers the device, dimensions, and container metadata', () => {
    expect(parsed.device).toBe('384')
    expect([parsed.cramWidth, parsed.cramHeight]).toEqual([182, 80])
    expect(parsed.comment).toBe('chipblocks test bin')
    expect(parsed.freqrange).toBe('low')
    expect(parsed.warmboot).toBe('enabled')
    expect(parsed.nosleep).toBe('disabled')
  })

  test('the CRC over the real data verifies (proves the frame + CRC transcription is correct)', () => {
    expect(parsed.crcChecks).toBe(1)
    expect(parsed.crcOk).toBe(true)
  })

  test('recovers four CRAM banks of the right shape, and the design is not empty', () => {
    expect(parsed.cram).toHaveLength(4)
    for (const bank of parsed.cram) {
      expect(bank).toHaveLength(182)
      for (const col of bank) expect(col).toHaveLength(80)
    }
    expect(countSet(parsed.cram)).toBeGreaterThan(0) // the one-bit design set real CRAM bits
    expect(parsed.bramWidth).toBe(0) // this design carries no BRAM
    expect(parsed.bram).toEqual([])
  })
})

describe('serializeBinFile — byte-identical to icepack', () => {
  test('parse → serialize reproduces the real file exactly, byte for byte', () => {
    const parsed = parseBinFile(REAL)
    const cfg: BinConfig = {
      comment: parsed.comment,
      cramWidth: parsed.cramWidth,
      cramHeight: parsed.cramHeight,
      cram: parsed.cram,
    }
    if (parsed.freqrange) cfg.freqrange = parsed.freqrange
    if (parsed.warmboot) cfg.warmboot = parsed.warmboot
    if (parsed.nosleep) cfg.nosleep = parsed.nosleep
    const rebuilt = serializeBinFile(cfg)
    expect(rebuilt.length).toBe(REAL.length)
    expect(Array.from(rebuilt)).toEqual(Array.from(REAL)) // identical to the genuine icepack output
  })
})

describe('serializeBinFile ⟷ parseBinFile — round-trip on arbitrary data', () => {
  // A tiny synthetic device (16 × 8 = 128 bits per bank) with a distinct bit set in each bank.
  const W = 16
  const H = 8
  const makeCram = (): BinBanks =>
    Array.from({ length: 4 }, (_, bank) =>
      Array.from(
        { length: W },
        (_, x) => Array.from({ length: H }, (_, y) => x === bank && y === bank), // bit (bank,bank) set in bank
      ),
    )

  test('a written bitstream parses back to the same banks + metadata, CRC OK', () => {
    const cram = makeCram()
    const bytes = serializeBinFile({
      comment: 'rt',
      freqrange: 'high',
      warmboot: 'disabled',
      nosleep: 'enabled',
      cramWidth: W,
      cramHeight: H,
      cram,
    })
    const parsed = parseBinFile(bytes)
    expect(parsed.crcChecks).toBe(1)
    expect(parsed.crcOk).toBe(true) // the writer's CRC is the one the reader recomputes to zero
    expect(parsed.comment).toBe('rt')
    expect(parsed.freqrange).toBe('high')
    expect(parsed.warmboot).toBe('disabled')
    expect(parsed.nosleep).toBe('enabled')
    expect([parsed.cramWidth, parsed.cramHeight]).toEqual([W, H])
    expect(parsed.device).toBeNull() // 16×8 is not a real chip size
    expect(parsed.cram).toEqual(cram) // every bank bit recovered exactly
  })

  test('a corrupted data byte is reported as a CRC failure, not thrown', () => {
    const bytes = serializeBinFile({ cramWidth: W, cramHeight: H, cram: makeCram() })
    // flip a bit inside bank 0's CRAM data (header is ~24 bytes; bank-0 data spans ~24..39, end token at 40..41)
    const corrupt = Uint8Array.from(bytes)
    corrupt[30] = (bytes[30] as number) ^ 0x01
    const parsed = parseBinFile(corrupt)
    expect(parsed.crcChecks).toBe(1)
    expect(parsed.crcOk).toBe(false) // structural parse still succeeds; the CRC catches the corruption
  })

  test("freqrange 'medium' round-trips (the untested middle value, payload 1)", () => {
    const bytes = serializeBinFile({
      freqrange: 'medium',
      cramWidth: W,
      cramHeight: H,
      cram: makeCram(),
    })
    expect(parseBinFile(bytes).freqrange).toBe('medium')
  })

  test('warmboot/nosleep both-disabled (payload 0) and both-enabled (payload 33) round-trip', () => {
    const off = parseBinFile(
      serializeBinFile({
        warmboot: 'disabled',
        nosleep: 'disabled',
        cramWidth: W,
        cramHeight: H,
        cram: makeCram(),
      }),
    )
    expect([off.warmboot, off.nosleep]).toEqual(['disabled', 'disabled'])
    const on = parseBinFile(
      serializeBinFile({
        warmboot: 'enabled',
        nosleep: 'enabled',
        cramWidth: W,
        cramHeight: H,
        cram: makeCram(),
      }),
    )
    expect([on.warmboot, on.nosleep]).toEqual(['enabled', 'enabled'])
  })
})

describe('parseBinFile — BRAM data and malformed input', () => {
  test('recovers BRAM bank bits from a BRAM data command', () => {
    // Hand-assembled minimal bin: preamble, width 8 / height 8 / offset 0 / bank 0, one BRAM data block, wakeup.
    // width=8 ⇒ each data byte is one row y (x = MSB..LSB). byte0=0x80 ⇒ (0,0); byte1=0x01 ⇒ (7,1).
    const bram = [0x80, 0x01, 0, 0, 0, 0, 0, 0]
    const bytes = Uint8Array.from([
      0x7e,
      0xaa,
      0x99,
      0x7e, // preamble
      0x62,
      0x00,
      0x07, // width - 1 = 7 ⇒ 8
      0x72,
      0x00,
      0x08, // height = 8
      0x82,
      0x00,
      0x00, // offset = 0
      0x11,
      0x00, // bank 0
      0x01,
      0x03, // BRAM data
      ...bram,
      0x00,
      0x00, // end token
      0x01,
      0x06, // wakeup
    ])
    const parsed = parseBinFile(bytes)
    expect([parsed.bramWidth, parsed.bramHeight]).toEqual([8, 8])
    expect(parsed.bram[0]?.[0]?.[0]).toBe(true) // byte0 MSB
    expect(parsed.bram[0]?.[7]?.[1]).toBe(true) // byte1 LSB, row 1
    expect(parsed.bram[0]?.[1]?.[0]).toBe(false) // an unset bit
    expect(parsed.cram).toEqual([]) // no CRAM in this file
  })

  test('a file with no preamble (runs to 0xffffffff) throws', () => {
    // reading four 0xff bytes drives the rolling preamble to 0xffffffff → the explicit "no preamble" error
    expect(() => parseBinFile(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff]))).toThrow(/preamble/)
  })

  test('a truncated file (preamble then nothing) throws', () => {
    expect(() => parseBinFile(Uint8Array.from([0x7e, 0xaa, 0x99, 0x7e]))).toThrow(/end of .bin/)
  })

  test('recovers BRAM across MULTIPLE offset chunks, preserving earlier chunks (the real multi-chunk path)', () => {
    // Two BRAM data blocks into bank 0 (width 8, height 8) at offsets 0 and 8 ⇒ bramHeight grows to 16 and the
    // second chunk must NOT clobber the first. chunk0 byte0=0x80 ⇒ (0,0); chunk1 byte1=0x01 ⇒ (7, 8+1=9).
    const bytes = Uint8Array.from([
      0x7e,
      0xaa,
      0x99,
      0x7e, // preamble
      0x62,
      0x00,
      0x07, // width 8
      0x72,
      0x00,
      0x08, // height 8
      0x11,
      0x00, // bank 0
      0x82,
      0x00,
      0x00, // offset 0
      0x01,
      0x03,
      0x80,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0x00,
      0x00, // BRAM chunk @ offset 0
      0x82,
      0x00,
      0x08, // offset 8
      0x01,
      0x03,
      0,
      0x01,
      0,
      0,
      0,
      0,
      0,
      0,
      0x00,
      0x00, // BRAM chunk @ offset 8
      0x01,
      0x06, // wakeup
    ])
    const parsed = parseBinFile(bytes)
    expect([parsed.bramWidth, parsed.bramHeight]).toEqual([8, 16]) // max(0+8, 8+8)
    expect(parsed.bram[0]?.[0]?.[0]).toBe(true) // chunk 0 — still set after chunk 1 grew the bank
    expect(parsed.bram[0]?.[7]?.[9]).toBe(true) // chunk 1, placed at offset 8 (y = 9, not 1)
    expect(parsed.bram[0]?.[0]?.[8]).toBe(false) // chunk 1's byte0 was 0
  })

  const P = [0x7e, 0xaa, 0x99, 0x7e] // preamble prefix for the structural-fault cases
  test('a nonzero end token after bank data throws', () => {
    // width 8 / height 8 / bank 0 / offset 0 / CRAM data (8 bytes) / end token 0x0001 (nonzero)
    const bytes = Uint8Array.from([
      ...P,
      0x62,
      0x00,
      0x07,
      0x72,
      0x00,
      0x08,
      0x11,
      0x00,
      0x82,
      0x00,
      0x00,
      0x01,
      0x01,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0x00,
      0x01,
    ])
    expect(() => parseBinFile(bytes)).toThrow(/0x0000 after bank data/)
  })
  test('an unknown command byte throws', () => {
    expect(() => parseBinFile(Uint8Array.from([...P, 0x40]))).toThrow(/Unknown command/)
  })
  test('an unknown 0x00-family payload throws', () => {
    expect(() => parseBinFile(Uint8Array.from([...P, 0x01, 0x99]))).toThrow(
      /Unknown 0x00 command payload/,
    )
  })
  test('an unknown freqrange payload throws', () => {
    expect(() => parseBinFile(Uint8Array.from([...P, 0x51, 0x99]))).toThrow(/Unknown freqrange/)
  })
  test('an unknown warmboot/nosleep payload throws', () => {
    expect(() => parseBinFile(Uint8Array.from([...P, 0x92, 0x00, 0x99]))).toThrow(
      /Unknown warmboot/,
    )
  })
})

describe('crc16Update — matches icepack CRC-16-CCITT', () => {
  test('is the poly-0x1021 MSB-first update (a known vector from 0xFFFF over "123456789")', () => {
    // CRC-16/CCITT-FALSE (init 0xFFFF, poly 0x1021, no reflection): "123456789" → 0x29B1.
    let crc = 0xffff
    for (const ch of '123456789') crc = crc16Update(crc, ch.charCodeAt(0))
    expect(crc).toBe(0x29b1)
  })
})

describe('serializeBinFile — rejects the 5k device (asymmetric per-bank framing unsupported)', () => {
  test('throws on 5k CRAM dimensions rather than silently emit a structurally-wrong file', () => {
    // 692×336 is the 5k CRAM size; the guard fires before touching cram, so a minimal cram is fine.
    expect(() => serializeBinFile({ cramWidth: 692, cramHeight: 336, cram: [] })).toThrow(/5k/)
  })
})

describe('parseBinFile — crcOk aggregation across multiple CRC-check segments', () => {
  test('a failing check followed by a passing check reports crcOk=false (sticky, not overwritten)', () => {
    // check #1 (0x20) runs while crc≠0 (accumulated over the preamble) ⇒ FAILS; then reset (0x01 0x05) and a
    // VALID check #2 (0x22 + the correct CRC of the 0x22 byte) ⇒ PASSES. A per-check overwrite would mask #1.
    const c = crc16Update(0xffff, 0x22) // crc after the reset (0xffff) then reading the 0x22 command byte
    const bytes = Uint8Array.from([
      0x7e,
      0xaa,
      0x99,
      0x7e, // preamble (leaves crc ≠ 0)
      0x20, // CRC check #1 → crc ≠ 0 → FAILS
      0x01,
      0x05, // reset CRC to 0xffff
      0x22,
      c >> 8,
      c & 0xff, // CRC check #2 → valid → PASSES
      0x01,
      0x06, // wakeup
    ])
    const parsed = parseBinFile(bytes)
    expect(parsed.crcChecks).toBe(2)
    expect(parsed.crcOk).toBe(false) // #1's failure is not masked by #2's pass
  })
})
