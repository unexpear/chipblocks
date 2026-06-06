import { Handle, type NodeProps, Position, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect } from 'react'

/**
 * Standard schematic symbols (Sprint 18 S18-v3-5) — IEC 60617 / IEEE 315
 * conventions per SCHEMATIC-SYMBOLS.md, NOT invented icons. One symbol per
 * connectable device kind the educational anchor circuit uses. Each symbol is
 * a small SVG; the DeviceNode wrapper adds left/right connection handles + the
 * instance id label.
 *
 * Precise terminal-accurate handle placement (anode vs cathode, +/-) is a
 * refinement for the interactivity sprint; the MVP uses left=target /
 * right=source handles so edges attach cleanly.
 */

const STROKE = '#d0d0d0'
const W = 80
const H = 44
const MID = H / 2

const lead = (x1: number, x2: number) => (
  <line x1={x1} y1={MID} x2={x2} y2={MID} stroke={STROKE} strokeWidth={1.5} />
)

/** Resistor — IEEE 315 zigzag. */
function ResistorGlyph() {
  return (
    <svg width={W} height={H}>
      <title>resistor</title>
      {lead(0, 18)}
      <polyline
        points="18,22 23,12 31,32 39,12 47,32 55,12 62,22"
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      {lead(62, W)}
    </svg>
  )
}

/** Battery / DC source — IEC 60617: alternating long (+) / short (−) plates. */
function BatteryGlyph() {
  return (
    <svg width={W} height={H}>
      <title>battery</title>
      {lead(0, 26)}
      {/* long plate (+) */}
      <line x1={30} y1={10} x2={30} y2={34} stroke={STROKE} strokeWidth={1.5} />
      {/* short plate (−) */}
      <line x1={38} y1={17} x2={38} y2={27} stroke={STROKE} strokeWidth={3} />
      {/* second cell */}
      <line x1={46} y1={10} x2={46} y2={34} stroke={STROKE} strokeWidth={1.5} />
      <line x1={54} y1={17} x2={54} y2={27} stroke={STROKE} strokeWidth={3} />
      {lead(54, W)}
      <text x={28} y={8} fill={STROKE} fontSize={9}>
        +
      </text>
    </svg>
  )
}

/** LED — diode triangle + cathode bar + two emission arrows. */
function LedGlyph() {
  return (
    <svg width={W} height={H}>
      <title>LED</title>
      {lead(0, 26)}
      <polygon points="26,12 26,32 44,22" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={12} x2={44} y2={32} stroke={STROKE} strokeWidth={1.5} />
      {lead(44, W)}
      {/* emission arrows */}
      <g stroke={STROKE} strokeWidth={1.2}>
        <line x1={34} y1={8} x2={42} y2={0} />
        <polyline points="38,0 42,0 42,4" fill="none" />
        <line x1={42} y1={10} x2={50} y2={2} />
        <polyline points="46,2 50,2 50,6" fill="none" />
      </g>
    </svg>
  )
}

/** SPST switch — a hinged contact with a break. */
function SwitchGlyph() {
  return (
    <svg width={W} height={H}>
      <title>SPST switch</title>
      {lead(0, 26)}
      <circle cx={28} cy={MID} r={2.5} fill="none" stroke={STROKE} />
      {/* open hinged blade */}
      <line x1={28} y1={MID} x2={50} y2={10} stroke={STROKE} strokeWidth={1.5} />
      <circle cx={52} cy={MID} r={2.5} fill="none" stroke={STROKE} />
      {lead(54, W)}
    </svg>
  )
}

/** Ground — stacked horizontal lines decreasing downward. */
function GroundGlyph() {
  return (
    <svg width={W} height={H}>
      <title>ground</title>
      <line x1={W / 2} y1={6} x2={W / 2} y2={20} stroke={STROKE} strokeWidth={1.5} />
      <line x1={W / 2 - 14} y1={20} x2={W / 2 + 14} y2={20} stroke={STROKE} strokeWidth={1.5} />
      <line x1={W / 2 - 9} y1={26} x2={W / 2 + 9} y2={26} stroke={STROKE} strokeWidth={1.5} />
      <line x1={W / 2 - 4} y1={32} x2={W / 2 + 4} y2={32} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** Wire — a plain connecting line. */
function WireGlyph() {
  return (
    <svg width={W} height={H}>
      <title>wire</title>
      {lead(0, W)}
    </svg>
  )
}

const GLYPHS: Record<string, () => React.JSX.Element> = {
  resistor: ResistorGlyph,
  power_source: BatteryGlyph,
  led: LedGlyph,
  led_uv_algan: LedGlyph,
  switch_spst_toggle: SwitchGlyph,
  ground: GroundGlyph,
  wire: WireGlyph,
}

export type DeviceNodeData = { definition: string; label: string; rotation?: number }

/**
 * The bare schematic symbol for a device definition (or a labeled fallback box
 * for kinds without a symbol yet), with no handles — shared by the canvas node
 * and the parts palette so both draw a part the same way.
 */
export function DeviceGlyph({ definition }: { definition: string }) {
  const Glyph = GLYPHS[definition]
  if (Glyph) return <Glyph />
  return (
    <div
      style={{
        width: W,
        height: H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid #555',
        borderRadius: 4,
        color: STROKE,
        fontSize: 10,
      }}
    >
      {definition}
    </div>
  )
}

/**
 * React Flow custom node: renders the standard symbol for the device kind (or
 * a labeled fallback box for kinds without a symbol yet) + left/right handles
 * + the instance id.
 */
export function DeviceNode({ id, data }: NodeProps) {
  const { definition, label, rotation = 0 } = data as DeviceNodeData
  const updateNodeInternals = useUpdateNodeInternals()
  // After a rotation, re-measure the handles so wires follow the rotated terminals.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rotation` is an intentional re-run trigger — the effect must re-measure when the node rotates, though it isn't read in the body
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, rotation, updateNodeInternals])
  // The node box IS the glyph (W×H); handles sit on the glyph's lead line
  // (left/right ends at the vertical midline), so a wire connects at the symbol's
  // own drawn terminal — not at an offset box edge. The glyph + handles rotate
  // together; the id label stays upright below the box (never rotates/widens it).
  return (
    <div style={{ position: 'relative', width: W, height: H, fontFamily: 'system-ui, sans-serif' }}>
      <div
        style={{ position: 'relative', width: W, height: H, transform: `rotate(${rotation}deg)` }}
      >
        <Handle type="target" position={Position.Left} style={{ background: '#888', top: MID }} />
        <DeviceGlyph definition={definition} />
        <Handle type="source" position={Position.Right} style={{ background: '#888', top: MID }} />
      </div>
      <div
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          color: '#999',
          fontSize: 9,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {label}
      </div>
    </div>
  )
}

export const nodeTypes = { device: DeviceNode }
