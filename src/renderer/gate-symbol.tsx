import type { BlockPort, GateSymbol, PlacedPort } from './blocks.ts'
import { THEME } from './theme.ts'

/**
 * Standard logic-gate symbols (IEEE 91 distinctive shapes) for the gate BLOCKS. The block is still a
 * real circuit underneath — descend and you reach the transistors + resistors — but on the canvas it
 * wears the canonical gate shape, because the SHAPE is the logic abstraction (an OR can be built many
 * ways; the symbol says "OR", the descend shows which way). We draw our own SVG, not a copied glyph.
 *
 * Geometry: a fixed box, body in the middle, inputs entering on the LEFT, output leaving on the RIGHT
 * (with the inverting bubble for NOT/NAND/NOR/XNOR), V+/GND stubs top/bottom. Leads overshoot INTO the
 * body and the filled body is drawn on top, so every lead meets the shape cleanly whatever its outline.
 */

const W = 76
const H = 54
const BL = 16 // body left edge
const BR = 58 // body right extent (before the bubble)
const BT = 10 // body top
const BB = 44 // body bottom
const CY = H / 2 // 27 — the centre line (output + body axis)
const BHALF = (BB - BT) / 2 // 17 — the AND semicircle radius
const BUBBLE_R = 4

/** Canonical gate pin layout: inputs spread on the LEFT, output centred on the RIGHT, V+ on TOP, GND on
 *  BOTTOM — the standard symbol arrangement, independent of the block's hand-laid port offsets. */
export function gateLayout(ports: BlockPort[]): {
  width: number
  height: number
  placed: PlacedPort[]
} {
  const inputs = ports.filter((p) => p.id !== 'out' && p.id !== 'v_dd' && p.id !== 'gnd')
  const placed: PlacedPort[] = []
  inputs.forEach((port, i) => {
    placed.push({ port, side: 'left', coord: CY + (i - (inputs.length - 1) / 2) * 20 })
  })
  const out = ports.find((p) => p.id === 'out')
  const vdd = ports.find((p) => p.id === 'v_dd')
  const gnd = ports.find((p) => p.id === 'gnd')
  if (out) placed.push({ port: out, side: 'right', coord: CY })
  if (vdd) placed.push({ port: vdd, side: 'top', coord: W / 2 })
  if (gnd) placed.push({ port: gnd, side: 'bottom', coord: W / 2 })
  return { width: W, height: H, placed }
}

const INVERTING: Record<GateSymbol, boolean> = {
  not: true,
  nand: true,
  nor: true,
  xnor: true,
  buffer: false,
  and: false,
  or: false,
  xor: false,
}
const EXCLUSIVE: Record<GateSymbol, boolean> = {
  xor: true,
  xnor: true,
  not: false,
  buffer: false,
  and: false,
  nand: false,
  or: false,
  nor: false,
}

/** The distinctive-shape body outline for each gate family, drawn in the W×H box. */
function bodyPath(symbol: GateSymbol): string {
  if (symbol === 'not' || symbol === 'buffer') {
    return `M ${BL} ${BT} L ${BL} ${BB} L ${BR} ${CY} Z`
  }
  if (symbol === 'and' || symbol === 'nand') {
    return `M ${BL} ${BT} L ${BR - BHALF} ${BT} A ${BHALF} ${BHALF} 0 0 1 ${BR - BHALF} ${BB} L ${BL} ${BB} Z`
  }
  // or / nor / xor / xnor — the OR shield: two sides sweeping to a point, a concave back
  return `M ${BL} ${BT} C ${BL + 26} ${BT} ${BR - 12} ${CY - 12} ${BR} ${CY} C ${BR - 12} ${CY + 12} ${BL + 26} ${BB} ${BL} ${BB} Q ${BL + 10} ${CY} ${BL} ${BT} Z`
}

/** The gate body + leads, sized to the gateLayout box. inputCoords are the y of each input pin (left). */
export function GateFace({
  symbol,
  inputCoords,
  stroke,
}: {
  symbol: GateSymbol
  inputCoords: number[]
  stroke: string
}) {
  const bubble = INVERTING[symbol]
  const outStart = bubble ? BR + BUBBLE_R * 2 : BR
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative gate symbol, hidden from the accessibility tree
    <svg
      aria-hidden
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
    >
      {/* leads first — they overshoot into the body and the filled body (drawn last) hides the overshoot */}
      {inputCoords.map((y) => (
        <line key={`in${y}`} x1={0} y1={y} x2={BL + 10} y2={y} stroke={stroke} strokeWidth={1.6} />
      ))}
      <line x1={outStart} y1={CY} x2={W} y2={CY} stroke={stroke} strokeWidth={1.6} />
      <line x1={W / 2} y1={0} x2={W / 2} y2={BT + 8} stroke={stroke} strokeWidth={1.6} />
      <line x1={W / 2} y1={H} x2={W / 2} y2={BB - 8} stroke={stroke} strokeWidth={1.6} />
      {EXCLUSIVE[symbol] ? (
        <path
          d={`M ${BL - 6} ${BB} Q ${BL + 4} ${CY} ${BL - 6} ${BT}`}
          fill="none"
          stroke={stroke}
          strokeWidth={1.6}
        />
      ) : null}
      <path
        d={bodyPath(symbol)}
        fill={THEME.surfacePanel}
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      {bubble ? (
        <circle
          cx={BR + BUBBLE_R}
          cy={CY}
          r={BUBBLE_R}
          fill={THEME.surfacePanel}
          stroke={stroke}
          strokeWidth={1.6}
        />
      ) : null}
    </svg>
  )
}
