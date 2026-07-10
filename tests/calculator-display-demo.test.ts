/**
 * The calculator's answer APPEARS on the display — the full chain, end to end: the 4-bit
 * adder/subtractor's output bits feed the binary→seven-segment decoder (the chip inside a real
 * digital clock), whose segment lines drive a real LED display. Every stage is real parts (the calc
 * and decoder are gates that flatten to transistors; the display is real LEDs + resistors), so this
 * runs the full mixed-signal path: the fast logic engine computes the sum, the co-sim drives the
 * decoder's segment outputs into the analog LED world, and the digit is read from which LEDs are
 * genuinely LIT in the solved circuit — 5 + 3 lights an "8", 9 − 4 lights a "5". Nothing is drawn
 * from a lookup: if any stage were wrong, the wrong LEDs would light.
 */
import type { Edge, Node } from '@xyflow/react'
import { describe, expect, test } from 'vitest'
import { BUILTIN_BLOCKS } from '../src/renderer/builtin-blocks.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const

/** Standard 7-segment patterns (common digital-clock font): which segments light per digit. */
const DIGIT_SEGS: Record<number, string> = {
  5: 'acdfg',
  8: 'abcdefg',
}

const blockNode = (id: string, key: string, x: number): Node =>
  ({
    id,
    type: 'block',
    position: { x, y: 200 },
    data: { definition: 'block', label: id, block: BUILTIN_BLOCKS[key] },
  }) as unknown as Node

/** The wired chain: a and b (4-bit each) + sub into the Calc±, s0..s3 → decoder → display. */
const buildCanvas = (a: number, b: number, sub: boolean): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [
    {
      id: 'v1',
      type: 'device',
      position: { x: 40, y: 200 },
      data: {
        definition: 'power_source',
        label: 'v1',
        parameters: {
          nominal_voltage: scalar(5, 'volt'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
    } as unknown as Node,
    {
      id: 'gnd',
      type: 'device',
      position: { x: 40, y: 420 },
      data: { definition: 'ground', label: 'gnd' },
    } as unknown as Node,
    blockNode('CALC', 'logic_calculator_4bit', 300),
    blockNode('DEC', 'logic_decoder_7seg', 640),
    blockNode('DISP', 'display_seven_segment', 980),
  ]
  const edges: Edge[] = []
  const wire = (s: string, sh: string, t: string, th: string) =>
    edges.push({
      id: `w${edges.length}`,
      source: s,
      sourceHandle: sh,
      target: t,
      targetHandle: th,
    } as unknown as Edge)
  // ground reference + rails
  wire('gnd', 'reference_terminal', 'v1', 'terminal_negative')
  for (const blk of ['CALC', 'DEC']) {
    wire('v1', 'terminal_positive', blk, 'v_dd')
    wire(blk, 'gnd', 'v1', 'terminal_negative')
  }
  // the operands, bit by bit: each input pin tied HIGH (v+) or LOW (v−)
  for (let i = 0; i < 4; i++) {
    wire('v1', (a >> i) & 1 ? 'terminal_positive' : 'terminal_negative', 'CALC', `a${i}`)
    wire('v1', (b >> i) & 1 ? 'terminal_positive' : 'terminal_negative', 'CALC', `b${i}`)
  }
  wire('v1', sub ? 'terminal_positive' : 'terminal_negative', 'CALC', 'sub')
  // the answer bits into the decoder
  for (let i = 0; i < 4; i++) wire('CALC', `s${i}`, 'DEC', `d${i}`)
  // the segment lines into the display, and its common return
  for (const seg of SEGS) wire('DEC', `seg_${seg}`, 'DISP', `seg_${seg}`)
  wire('DISP', 'common', 'gnd', 'reference_terminal')
  return { nodes, edges }
}

/** Which digit the display is showing, read from the LEDs that are GENUINELY lit in the solve. */
const litSegments = (result: ReturnType<typeof solveCanvasDispatch>): string =>
  SEGS.filter((seg) => result.health.get(`DISP.core.led_${seg}`)?.lit === true).join('')

describe('calculator → decoder → display: the answer appears, for real', () => {
  test('5 + 3 lights all seven segments — the display shows "8"', () => {
    const { nodes, edges } = buildCanvas(5, 3, false)
    const result = solveCanvasDispatch(nodes, edges)
    expect(litSegments(result)).toBe(DIGIT_SEGS[8])
  })

  test('9 − 4 lights exactly the "5" segments (b and e stay dark)', () => {
    const { nodes, edges } = buildCanvas(9, 4, true)
    const result = solveCanvasDispatch(nodes, edges)
    expect(litSegments(result)).toBe(DIGIT_SEGS[5])
  })
})
