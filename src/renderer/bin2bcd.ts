/**
 * Binary → decimal (BCD) converter, built as a REAL gate circuit by synthesizing the double-dabble algorithm
 * from Verilog. The rest of the app only had a 4-bit HEX display decoder, so a byte like 120 could only show
 * as "78"; this turns an 8-bit value into three decimal digits (hundreds / tens / ones), each 0-9, so a normal
 * 7-segment decoder shows it as "120". It lives here (not in builtin-blocks.ts) because synthesizing at load
 * there would form an import cycle with the synthesizer — this module imports the synthesizer, one direction.
 *
 * Double-dabble (shift-and-add-3), unrolled to pure combinational logic: keep a BCD scratch, and for each input
 * bit MSB-first, add 3 to any BCD digit ≥ 5, then shift the whole thing left and bring the input bit in. After
 * 8 shifts the scratch holds the decimal digits. The "add 3 if ≥ 5" step uses the increment-6 `>=` and `+`
 * operators, so this doubles as a real-circuit exercise of them.
 */

import { type BlockData, cloneBlockData } from './blocks.ts'
import { importVerilog } from './verilog-import.ts'

/** The double-dabble converter as Verilog text: 8-bit `b` → `hundreds`/`tens`/`ones` (each a BCD digit 0-9). */
export function bin2bcdVerilog(): string {
  const add3 = (d: string) => `(${d} >= 4'd5 ? ${d} + 4'd3 : ${d})`
  const wires: string[] = []
  for (let k = 0; k <= 8; k++) wires.push(`s${k}`)
  for (let k = 0; k < 8; k++) wires.push(`adj${k}`)
  let body = `      wire [11:0] ${wires.join(', ')};\n      assign s0 = 12'd0;\n`
  for (let k = 0; k < 8; k++) {
    const s = `s${k}`
    body += `      assign adj${k} = { ${add3(`${s}[11:8]`)}, ${add3(`${s}[7:4]`)}, ${add3(`${s}[3:0]`)} };\n`
    body += `      assign s${k + 1} = { adj${k}[10:0], b[${7 - k}] };\n`
  }
  body +=
    '      assign ones = s8[3:0];\n      assign tens = s8[7:4];\n      assign hundreds = s8[11:8];\n'
  return `module bin2bcd(input [7:0] b, output [3:0] ones, output [3:0] tens, output [3:0] hundreds);\n${body}    endmodule`
}

/** Build the binary→BCD converter block (real gates, synthesized). `idSuffix` keeps node ids unique on a canvas. */
export function binaryToBcd8(idSuffix = 'b2b'): BlockData | null {
  const { block } = importVerilog(bin2bcdVerilog())
  return block === null ? null : cloneBlockData(block, idSuffix)
}
