import { Handle, type NodeProps, Position, useUpdateNodeInternals } from '@xyflow/react'
import { Fragment, useContext, useEffect } from 'react'
import './canvas-animations.css'
import { BlockNode } from './block-node.tsx'
import { HealthContext } from './health.ts'
import { LensContext, powerColor, temperatureColor } from './lens.ts'
import {
  type Parameters,
  primaryValue,
  sourceIsAc,
  sourceIsSquare,
  switchClosed,
} from './part-defaults.ts'
import { formatEng } from './units.ts'

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
      <title>DC source</title>
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

/** AC source — IEC 60617: a circle with one sine period inside. */
function AcSourceGlyph() {
  return (
    <svg width={W} height={H}>
      <title>AC source</title>
      {lead(0, 26)}
      <circle cx={40} cy={MID} r={14} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <path d="M31 22 q4.5 -9 9 0 q4.5 9 9 0" fill="none" stroke={STROKE} strokeWidth={1.3} />
      {lead(54, W)}
    </svg>
  )
}

/** Square-wave clock source — the generator circle with a square-wave trace. */
function SquareSourceGlyph() {
  return (
    <svg width={W} height={H}>
      <title>square-wave clock source</title>
      {lead(0, 26)}
      <circle cx={40} cy={MID} r={14} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <path
        d="M31 26 L31 18 L40 18 L40 26 L49 26 L49 18"
        fill="none"
        stroke={STROKE}
        strokeWidth={1.3}
      />
      {lead(54, W)}
    </svg>
  )
}

/** Rectifier diode — IEEE 315: triangle (anode) pointing at the cathode bar. */
function DiodeGlyph() {
  return (
    <svg width={W} height={H}>
      <title>diode</title>
      {lead(0, 26)}
      <polygon points="26,12 26,32 44,22" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={12} x2={44} y2={32} stroke={STROKE} strokeWidth={1.5} />
      {lead(44, W)}
    </svg>
  )
}

/** Schottky diode — the cathode bar grows the standard S-hooks. */
function SchottkyGlyph() {
  return (
    <svg width={W} height={H}>
      <title>Schottky diode</title>
      {lead(0, 26)}
      <polygon points="26,12 26,32 44,22" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <path
        d="M40 15 L40 12 L44 12 L44 32 L48 32 L48 29"
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      {lead(44, W)}
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

/** SPST switch — a hinged blade: closed rests on the far contact, open lifts away. */
function SwitchGlyph({ closed }: { closed: boolean }) {
  return (
    <svg width={W} height={H}>
      <title>{closed ? 'SPST switch (closed)' : 'SPST switch (open)'}</title>
      {lead(0, 26)}
      <circle cx={28} cy={MID} r={2.5} fill="none" stroke={STROKE} />
      {/* blade: down onto the far contact when closed, lifted with a gap when open */}
      <line
        x1={28}
        y1={MID}
        x2={closed ? 52 : 50}
        y2={closed ? MID : 10}
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <circle cx={52} cy={MID} r={2.5} fill="none" stroke={STROKE} />
      {lead(54, W)}
    </svg>
  )
}

/** Inductor — IEEE 315: a row of winding humps. */
function InductorGlyph() {
  return (
    <svg width={W} height={H}>
      <title>inductor</title>
      {lead(0, 18)}
      <path
        d="M18 22 A5.5 5.5 0 0 1 29 22 A5.5 5.5 0 0 1 40 22 A5.5 5.5 0 0 1 51 22 A5.5 5.5 0 0 1 62 22"
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      {lead(62, W)}
    </svg>
  )
}

/** Transformer — two facing winding columns with core lines between (IEC). */
function TransformerGlyph() {
  return (
    <svg width={W} height={H}>
      <title>transformer</title>
      {/* primary leads (left, top + bottom rows) */}
      <line x1={0} y1={10} x2={33} y2={10} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={34} x2={33} y2={34} stroke={STROKE} strokeWidth={1.5} />
      {/* primary winding: humps bulging left */}
      <path
        d="M33 10 A6 6 0 0 0 33 22 A6 6 0 0 0 33 34"
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      {/* core */}
      <line x1={38} y1={8} x2={38} y2={36} stroke={STROKE} strokeWidth={1.2} />
      <line x1={42} y1={8} x2={42} y2={36} stroke={STROKE} strokeWidth={1.2} />
      {/* secondary winding: humps bulging right */}
      <path
        d="M47 10 A6 6 0 0 1 47 22 A6 6 0 0 1 47 34"
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      {/* secondary leads (right, top + bottom rows) */}
      <line x1={47} y1={10} x2={W} y2={10} stroke={STROKE} strokeWidth={1.5} />
      <line x1={47} y1={34} x2={W} y2={34} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** Center-tapped transformer — the two-winding symbol plus a midpoint tap lead. */
function CtTransformerGlyph() {
  return (
    <svg width={W} height={H}>
      <title>center-tapped transformer</title>
      <line x1={0} y1={10} x2={33} y2={10} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={34} x2={33} y2={34} stroke={STROKE} strokeWidth={1.5} />
      {/* center tap: out of the primary winding's midpoint */}
      <line x1={0} y1={22} x2={28} y2={22} stroke={STROKE} strokeWidth={1.5} />
      <path
        d="M33 10 A6 6 0 0 0 33 22 A6 6 0 0 0 33 34"
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <line x1={38} y1={8} x2={38} y2={36} stroke={STROKE} strokeWidth={1.2} />
      <line x1={42} y1={8} x2={42} y2={36} stroke={STROKE} strokeWidth={1.2} />
      <path
        d="M47 10 A6 6 0 0 1 47 22 A6 6 0 0 1 47 34"
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <line x1={47} y1={10} x2={W} y2={10} stroke={STROKE} strokeWidth={1.5} />
      <line x1={47} y1={34} x2={W} y2={34} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** Capacitor — IEC 60617: two parallel plates with a gap. */
function CapacitorGlyph() {
  return (
    <svg width={W} height={H}>
      <title>capacitor</title>
      {lead(0, 36)}
      <line x1={36} y1={12} x2={36} y2={32} stroke={STROKE} strokeWidth={2} />
      <line x1={44} y1={12} x2={44} y2={32} stroke={STROKE} strokeWidth={2} />
      {lead(44, W)}
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

/** NPN BJT — IEEE 315: base bar, collector up, emitter down with the out-pointing
 * arrow (NPN: "Not Pointing iN"), enclosed in a circle. Base in from the left. */
function BjtNpnGlyph() {
  return (
    <svg width={W} height={H}>
      <title>NPN transistor</title>
      <circle cx={37} cy={MID} r={15} fill="none" stroke={STROKE} strokeWidth={1} />
      {/* base lead + the vertical base bar */}
      <line x1={0} y1={MID} x2={32} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      <line x1={32} y1={13} x2={32} y2={31} stroke={STROKE} strokeWidth={2} />
      {/* collector: bar → up to the top-center handle */}
      <line x1={32} y1={18} x2={40} y2={8} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={8} x2={40} y2={0} stroke={STROKE} strokeWidth={1.5} />
      {/* emitter: bar → down to the bottom-center handle, arrow pointing out (NPN) */}
      <line x1={32} y1={26} x2={40} y2={36} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={36} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
      <polygon points="40,36 34.5,34 37.5,30" fill={STROKE} stroke={STROKE} strokeWidth={0.5} />
    </svg>
  )
}

/** PNP BJT — IEEE 315: same shape as the NPN, but the emitter arrow Points iN
 * Permanently (toward the base bar). Base in from the left. */
function BjtPnpGlyph() {
  return (
    <svg width={W} height={H}>
      <title>PNP transistor</title>
      <circle cx={37} cy={MID} r={15} fill="none" stroke={STROKE} strokeWidth={1} />
      <line x1={0} y1={MID} x2={32} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      <line x1={32} y1={13} x2={32} y2={31} stroke={STROKE} strokeWidth={2} />
      {/* collector: bar → up to the top-center handle */}
      <line x1={32} y1={18} x2={40} y2={8} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={8} x2={40} y2={0} stroke={STROKE} strokeWidth={1.5} />
      {/* emitter: bar → down to the bottom-center handle, arrow pointing IN (PNP) */}
      <line x1={32} y1={26} x2={40} y2={36} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={36} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
      <polygon points="32,26 37.5,28 34.5,32" fill={STROKE} stroke={STROKE} strokeWidth={0.5} />
    </svg>
  )
}

/** N-channel enhancement MOSFET — insulated gate bar (the gap IS the oxide),
 * channel bar, drain up, source down with the inward arrow. Gate from the left. */
function MosfetNmosGlyph() {
  return (
    <svg width={W} height={H}>
      <title>NMOS transistor</title>
      {/* gate lead + the gate bar — separated from the channel: the insulator */}
      <line x1={0} y1={MID} x2={30} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      <line x1={30} y1={14} x2={30} y2={30} stroke={STROKE} strokeWidth={2} />
      <line x1={34} y1={12} x2={34} y2={32} stroke={STROKE} strokeWidth={2} />
      {/* drain: channel top → up to the top-center handle */}
      <line x1={34} y1={15} x2={40} y2={15} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={15} x2={40} y2={0} stroke={STROKE} strokeWidth={1.5} />
      {/* source: channel bottom → down, arrow pointing IN toward the channel */}
      <line x1={34} y1={29} x2={40} y2={29} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={29} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
      <polygon
        points="34.5,29 39.5,26.8 39.5,31.2"
        fill={STROKE}
        stroke={STROKE}
        strokeWidth={0.4}
      />
    </svg>
  )
}

/** P-channel enhancement MOSFET — the mirror: source UP (toward the supply,
 * as wired in CMOS), drain down, arrow pointing OUT away from the channel. */
function MosfetPmosGlyph() {
  return (
    <svg width={W} height={H}>
      <title>PMOS transistor</title>
      <line x1={0} y1={MID} x2={30} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      <line x1={30} y1={14} x2={30} y2={30} stroke={STROKE} strokeWidth={2} />
      <line x1={34} y1={12} x2={34} y2={32} stroke={STROKE} strokeWidth={2} />
      {/* source: channel top → up to the top-center handle, arrow pointing OUT */}
      <line x1={34} y1={15} x2={40} y2={15} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={15} x2={40} y2={0} stroke={STROKE} strokeWidth={1.5} />
      <polygon
        points="39.5,15 34.5,12.8 34.5,17.2"
        fill={STROKE}
        stroke={STROKE}
        strokeWidth={0.4}
      />
      {/* drain: channel bottom → down to the bottom-center handle */}
      <line x1={34} y1={29} x2={40} y2={29} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={29} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

// switch_spst_toggle is intentionally absent — DeviceGlyph renders it specially
// (it needs the open/closed state, unlike these stateless one-shot glyphs).
const GLYPHS: Record<string, () => React.JSX.Element> = {
  resistor: ResistorGlyph,
  capacitor: CapacitorGlyph,
  inductor: InductorGlyph,
  power_source: BatteryGlyph,
  led: LedGlyph,
  led_uv_algan: LedGlyph,
  diode_silicon_rectifier: DiodeGlyph,
  diode_schottky_al_si: SchottkyGlyph,
  ground: GroundGlyph,
  wire: WireGlyph,
  transistor_bjt_npn: BjtNpnGlyph,
  transistor_bjt_pnp: BjtPnpGlyph,
  transistor_mosfet_nmos: MosfetNmosGlyph,
  transistor_mosfet_pmos: MosfetPmosGlyph,
  transformer: TransformerGlyph,
  transformer_center_tapped: CtTransformerGlyph,
}

/**
 * Connection terminals per device — a handle's id IS the terminal name, so a
 * wire the user draws carries which terminals it joins (read by canvas→World for
 * the live re-solve). Names match the catalog fixtures + what the solver looks
 * up (battery terminal_positive/negative, LED anode/cathode, switch in/out).
 * All handles are `source`; App uses connectionMode="loose" so any terminal can
 * wire to any terminal.
 */
const TWO = (a: string, b: string) => [
  { id: a, position: Position.Left },
  { id: b, position: Position.Right },
]
/** `offset` = vertical px for a side handle (default MID) — multi-winding parts. */
const TERMINALS: Record<string, { id: string; position: Position; offset?: number }[]> = {
  resistor: TWO('terminal_a', 'terminal_b'),
  capacitor: TWO('terminal_a', 'terminal_b'),
  inductor: TWO('terminal_a', 'terminal_b'),
  power_source: TWO('terminal_positive', 'terminal_negative'),
  led: TWO('anode', 'cathode'),
  led_uv_algan: TWO('anode', 'cathode'),
  diode_silicon_rectifier: TWO('anode', 'cathode'),
  diode_schottky_al_si: TWO('anode', 'cathode'),
  diode_zener_silicon: TWO('anode', 'cathode'),
  switch_spst_toggle: TWO('terminal_in', 'terminal_out'),
  transistor_bjt_npn: [
    { id: 'base', position: Position.Left },
    { id: 'collector', position: Position.Top },
    { id: 'emitter', position: Position.Bottom },
  ],
  transistor_bjt_pnp: [
    { id: 'base', position: Position.Left },
    { id: 'collector', position: Position.Top },
    { id: 'emitter', position: Position.Bottom },
  ],
  transistor_mosfet_nmos: [
    { id: 'gate', position: Position.Left },
    { id: 'drain', position: Position.Top },
    { id: 'source', position: Position.Bottom },
  ],
  // PMOS source sits on TOP — toward the supply, the way CMOS wires it.
  transistor_mosfet_pmos: [
    { id: 'gate', position: Position.Left },
    { id: 'source', position: Position.Top },
    { id: 'drain', position: Position.Bottom },
  ],
  transformer: [
    { id: 'primary_a', position: Position.Left, offset: 10 },
    { id: 'primary_b', position: Position.Left, offset: 34 },
    { id: 'secondary_a', position: Position.Right, offset: 10 },
    { id: 'secondary_b', position: Position.Right, offset: 34 },
  ],
  transformer_center_tapped: [
    { id: 'primary_a', position: Position.Left, offset: 10 },
    { id: 'primary_ct', position: Position.Left, offset: 22 },
    { id: 'primary_b', position: Position.Left, offset: 34 },
    { id: 'secondary_a', position: Position.Right, offset: 10 },
    { id: 'secondary_b', position: Position.Right, offset: 34 },
  ],
  ground: [{ id: 'reference_terminal', position: Position.Top }],
}
const FALLBACK_TERMINALS = TWO('terminal_a', 'terminal_b')

/**
 * Polarity marker drawn at a terminal's handle, so a polarized part's + / − (or
 * an LED/diode's anode/cathode, where anode is the + side) is obvious when
 * wiring — otherwise both handles are identical dots and the loop is easy to wire
 * backwards or leave open.
 */
const TERMINAL_POLARITY: Record<string, '+' | '−'> = {
  terminal_positive: '+',
  anode: '+',
  terminal_negative: '−',
  cathode: '−',
}

/**
 * Polarity for a terminal on a specific device. The global map covers terminals
 * whose NAME carries polarity (anode, terminal_positive, …); the capacitor is
 * polarized per-device — the canvas part is a real aluminum electrolytic, whose
 * terminal_a is the + lead and terminal_b the − (reversing one is a real failure
 * mode, checked by the failure detector).
 */
function polarityOf(definition: string, terminalId: string): '+' | '−' | undefined {
  if (definition === 'capacitor') {
    if (terminalId === 'terminal_a') return '+'
    if (terminalId === 'terminal_b') return '−'
  }
  return TERMINAL_POLARITY[terminalId]
}

/** The terminals (handle id + side + optional vertical offset) for a device definition. */
export function terminalsOf(
  definition: string,
): { id: string; position: Position; offset?: number }[] {
  return TERMINALS[definition] ?? FALLBACK_TERMINALS
}

export type DeviceNodeData = {
  definition: string
  label: string
  rotation?: number
  parameters?: Parameters
}

/**
 * The bare schematic symbol for a device definition (or a labeled fallback box
 * for kinds without a symbol yet), with no handles — shared by the canvas node
 * and the parts palette so both draw a part the same way.
 */
export function DeviceGlyph({
  definition,
  parameters,
}: {
  definition: string
  parameters?: Parameters
}) {
  // The switch is state-dependent: render its blade open or closed.
  if (definition === 'switch_spst_toggle') return <SwitchGlyph closed={switchClosed(parameters)} />
  // A source with an AC component renders the IEC circle-sine, not battery
  // plates — and a square-wave (clock) source shows its square trace.
  if (definition === 'power_source' && sourceIsAc(parameters)) {
    return sourceIsSquare(parameters) ? <SquareSourceGlyph /> : <AcSourceGlyph />
  }
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
  const { definition, label, rotation = 0, parameters } = data as DeviceNodeData
  const value = primaryValue(definition, parameters)
  const health = useContext(HealthContext).get(id)
  const lensState = useContext(LensContext)
  // Power lens: halo each part by its REAL dissipated watts; Temp lens: by its
  // computed temperature (25 °C + P·θ_JA) — both heat-colored against the
  // circuit's hottest part, with the number shown under the label.
  const watts = lensState.power.get(id)
  const tempC = lensState.temp.get(id)
  const heat =
    lensState.lens === 'power' && watts !== undefined
      ? powerColor(watts, lensState.pMax)
      : lensState.lens === 'temp' && tempC !== undefined
        ? temperatureColor(tempC, lensState.tMaxC)
        : null
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
    <div
      className={health?.failed ? 'cb-shake' : undefined}
      style={{ position: 'relative', width: W, height: H, fontFamily: 'system-ui, sans-serif' }}
    >
      {/* Success / failure feedback (health.ts): a lit LED glows warm; an
          overstressed part bursts once + keeps a danger ring. Behind the symbol
          so it stays legible. */}
      {health?.lit ? (
        <div
          className="cb-glow"
          style={{
            background: `radial-gradient(circle, ${health.glow ?? 'rgb(255, 211, 92)'} 0%, transparent 72%)`,
          }}
        />
      ) : null}
      {health?.failed ? (
        <>
          <div className="cb-danger" />
          <div className="cb-burst" />
        </>
      ) : null}
      {heat ? (
        <div
          style={{
            position: 'absolute',
            inset: -5,
            borderRadius: 8,
            background: heat,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <div
        style={{ position: 'relative', width: W, height: H, transform: `rotate(${rotation}deg)` }}
      >
        {/* One handle per terminal; id = terminal name. connectionMode="loose"
            (App) lets any terminal wire to any terminal. Ground = one top stem. */}
        {terminalsOf(definition).map((t) => {
          const polarity = polarityOf(definition, t.id)
          const onSide = t.position === Position.Left || t.position === Position.Right
          // Hover any terminal dot to see which spot it is (like the wire probe):
          // the terminal's name, plus its polarity where one applies.
          const hoverLabel = t.id.replace(/_/g, ' ') + (polarity ? ` (${polarity})` : '')
          return (
            <Fragment key={t.id}>
              <Handle
                id={t.id}
                type="source"
                position={t.position}
                title={hoverLabel}
                style={{
                  background: polarity === '+' ? '#e0594f' : polarity === '−' ? '#5a86d8' : '#888',
                  width: polarity ? 9 : undefined,
                  height: polarity ? 9 : undefined,
                  ...(onSide ? { top: t.offset ?? MID } : {}),
                }}
              />
              {polarity ? (
                <div
                  style={{
                    position: 'absolute',
                    top: MID - 14,
                    ...(t.position === Position.Left ? { left: 2 } : { right: 2 }),
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1,
                    color: polarity === '+' ? '#ef6a55' : '#7fa6e6',
                    pointerEvents: 'none',
                  }}
                >
                  {polarity}
                </div>
              ) : null}
            </Fragment>
          )
        })}
        <DeviceGlyph definition={definition} {...(parameters ? { parameters } : {})} />
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
        {value ? <span style={{ color: '#7ab8ff', marginLeft: 5 }}>{value}</span> : null}
        {lensState.lens === 'power' && watts !== undefined && watts > 0 ? (
          <span style={{ color: '#e0a050', marginLeft: 5 }}>{formatEng(watts, 'W')}</span>
        ) : null}
        {lensState.lens === 'temp' && tempC !== undefined ? (
          <span style={{ color: '#e0a050', marginLeft: 5 }}>{tempC.toFixed(1)} °C</span>
        ) : null}
        {health?.failed ? (
          <span title={health.note} style={{ marginLeft: 5 }}>
            💥
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * A junction — the IEEE schematic junction dot: a tie point where wires meet.
 * Every wire attached to its single handle shares one net (canvasToWorld merges
 * them), so it carries no element of its own — it IS just a point in the
 * circuit graph. Created by starting or ending a wire in open space.
 */
function JunctionNode() {
  return (
    <div
      title="junction — wires meeting here are connected"
      style={{ position: 'relative', width: 14, height: 14 }}
    >
      <Handle
        id="tie"
        type="source"
        position={Position.Top}
        style={{
          left: 7,
          top: 7,
          width: 9,
          height: 9,
          background: '#cdd6e0',
          border: '1px solid #555',
        }}
      />
    </div>
  )
}

export const nodeTypes = { device: DeviceNode, junction: JunctionNode, block: BlockNode }
