/**
 * A hand-authored DRAWN symbol shared by the drawn-symbol tests: an op-amp drawn the IEEE-315 way — a
 * triangle pointing along the signal, both inputs on the left, the output at the tip on the right, the
 * supplies top and bottom. Every tip sits on the 20 px grid and on the edge its pin points out of: the
 * inputs at x = -40, the output at x = 80, V+ at y = -60, V- at y = 60. The triangle spans x -20…60,
 * y -40…40, and each supply pin is exactly as long as it takes to reach the triangle's slanted side.
 */
import type { DrawnSymbol } from '../src/renderer/symbol-geometry.ts'
import type { UserPart } from '../src/renderer/user-parts.ts'

export const OPAMP_SYMBOL: DrawnSymbol = {
  graphics: [
    {
      kind: 'polyline',
      points: [
        { x: -20, y: -40 },
        { x: 60, y: 0 },
        { x: -20, y: 40 },
        { x: -20, y: -40 },
      ],
      strokeWidth: 1.6,
      fill: 'background',
    },
    { kind: 'text', at: { x: -12, y: -20 }, text: '−', size: 12 },
    { kind: 'text', at: { x: -12, y: 20 }, text: '+', size: 12 },
  ],
  pins: [
    { pin: 'in_minus', at: { x: -40, y: -20 }, length: 20, style: 'line', hideName: true },
    { pin: 'in_plus', at: { x: -40, y: 20 }, length: 20, style: 'line', hideName: true },
    { pin: 'out', at: { x: 80, y: 0 }, length: 20, style: 'line', hideName: true },
    { pin: 'v_pos', at: { x: 0, y: -60 }, length: 30, style: 'line', hideName: true },
    { pin: 'v_neg', at: { x: 0, y: 60 }, length: 30, style: 'line', hideName: true },
  ],
  fields: {
    reference: { at: { x: 30, y: -45 }, visible: true },
    value: { at: { x: 30, y: 45 }, visible: true },
    footprint: { at: { x: 0, y: 80 }, visible: false },
    datasheet: { at: { x: 0, y: 95 }, visible: false },
  },
}

/** The op-amp as a part. Pin ORDER is the contract (pad mapping keys off it), so it is not the drawing's. */
export function opampPart(over: Partial<UserPart> = {}): UserPart {
  return {
    id: 'my_opamp',
    name: 'My Op-Amp',
    designatorPrefix: 'U',
    pins: [
      { id: 'out', name: 'OUT', side: 'right', electrical: 'output' },
      { id: 'in_minus', name: 'IN-', side: 'left', electrical: 'input' },
      { id: 'in_plus', name: 'IN+', side: 'left', electrical: 'input' },
      { id: 'v_neg', name: 'V-', side: 'bottom', electrical: 'power_in' },
      { id: 'v_pos', name: 'V+', side: 'top', electrical: 'power_in' },
    ],
    symbol: OPAMP_SYMBOL,
    ...over,
  }
}

/** The same part with no drawing at all — the plain labelled box every part had before drawings. */
export function plainOpampPart(over: Partial<UserPart> = {}): UserPart {
  const { symbol: _none, ...part } = opampPart(over)
  return part
}
