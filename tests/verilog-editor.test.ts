import { describe, expect, it } from 'vitest'
import {
  completionsFor,
  prefixBefore,
  STARTER_VERILOG,
  type Tok,
  tokenize,
} from '../src/renderer/verilog-editor.tsx'

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

describe('verilog editor autocomplete', () => {
  it('reads the identifier prefix immediately before the caret', () => {
    expect(prefixBefore('assign co', 9)).toBe('co')
    expect(prefixBefore('assign co = a & b', 9)).toBe('co') // caret mid-line, not end
    expect(prefixBefore('a + ', 4)).toBe('') // caret after an operator/space → no prefix
    expect(prefixBefore('wire [3:0] q', 12)).toBe('q')
    expect(prefixBefore('2bad', 4)).toBe('bad') // a prefix can't start with a digit
  })

  it('completes language keywords by prefix', () => {
    const c = completionsFor('mod', '')
    expect(c).toContain('module')
    expect(c.every((w) => w.toLowerCase().startsWith('mod'))).toBe(true)
  })

  it("completes a module's own declared signals once they've been named", () => {
    const src = 'module m(input clk, input reset, output ready); wire count_next;'
    // typing "re" should offer the declared reset/ready, not just keywords
    const c = completionsFor('re', src)
    expect(c).toContain('reset')
    expect(c).toContain('ready')
    expect(c).toContain('reg') // and the keyword still
    // typing "count" offers the internal wire
    expect(completionsFor('count', src)).toContain('count_next')
  })

  it('excludes the exact word already typed and is case-insensitive', () => {
    expect(completionsFor('module', '')).not.toContain('module') // exact match is not a suggestion
    expect(completionsFor('MOD', '')).toContain('module') // case-insensitive prefix
  })

  it('offers nothing for an unknown prefix with no matching identifiers', () => {
    expect(completionsFor('zzq', 'module m(); endmodule')).toEqual([])
  })
})
