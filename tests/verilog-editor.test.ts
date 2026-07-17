import { describe, expect, it } from 'vitest'
import { STARTER_VERILOG, type Tok, tokenize } from '../src/renderer/verilog-editor.tsx'

/** The one property the highlight overlay depends on: the token stream is a character-for-character copy of
 *  the source. If tokenize ever drops, reorders, or invents a character, the coloured <pre> layer slides out
 *  of alignment with the <textarea> and the highlighting lands on the wrong glyphs. */
function roundTrips(src: string): boolean {
  return (
    tokenize(src)
      .map((t) => t.text)
      .join('') === src
  )
}

const kinds = (src: string): Array<[Tok['type'], string]> =>
  tokenize(src).map((t) => [t.type, t.text])

describe('verilog editor tokenizer', () => {
  it('reconstructs the source exactly (overlay alignment)', () => {
    expect(roundTrips(STARTER_VERILOG)).toBe(true)
    expect(roundTrips('module m(input a, output y); assign y = ~a; endmodule')).toBe(true)
    expect(roundTrips("wire [7:0] rom; assign rom = 8'hA5;")).toBe(true)
    expect(roundTrips('')).toBe(true)
    expect(roundTrips('\n\n  \t')).toBe(true)
    expect(roundTrips('/* block\n   comment */ // line\nx')).toBe(true)
  })

  it('classifies keywords, gate primitives, identifiers', () => {
    const k = kinds('module and2 endmodule')
    expect(k).toContainEqual(['keyword', 'module'])
    expect(k).toContainEqual(['keyword', 'endmodule'])
    // "and2" is an identifier, not the `and` primitive — word boundary, not prefix.
    expect(k).toContainEqual(['ident', 'and2'])
  })

  it('recognizes the `and` gate primitive as its own token class', () => {
    expect(kinds('and g(y, a, b);')).toContainEqual(['gate', 'and'])
  })

  it('colours based literals and plain numbers as one number token', () => {
    expect(kinds("4'd12")).toContainEqual(['number', "4'd12"])
    expect(kinds("8'hFF")).toContainEqual(['number', "8'hFF"])
    expect(kinds("1'b0")).toContainEqual(['number', "1'b0"])
    expect(kinds('42')).toContainEqual(['number', '42'])
  })

  it('treats // and /* */ as comments', () => {
    expect(kinds('// hi\n')).toContainEqual(['comment', '// hi'])
    expect(kinds('/* hi */')).toContainEqual(['comment', '/* hi */'])
  })

  it('does not misread a bare tick-number at the start of an expression', () => {
    // Context-less based literal (e.g. `'d5`) still round-trips and lands as a number.
    expect(roundTrips("x = 'd5;")).toBe(true)
    expect(kinds("'d5")).toContainEqual(['number', "'d5"])
  })
})
