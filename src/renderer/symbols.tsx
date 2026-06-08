import { Handle, type NodeProps, Position, useUpdateNodeInternals } from '@xyflow/react'
import { Fragment, useContext, useEffect } from 'react'
import './canvas-animations.css'
import { HealthContext } from './health.ts'
import { type Parameters, primaryValue, switchClosed } from './part-defaults.ts'

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

// switch_spst_toggle is intentionally absent — DeviceGlyph renders it specially
// (it needs the open/closed state, unlike these stateless one-shot glyphs).
const GLYPHS: Record<string, () => React.JSX.Element> = {
  resistor: ResistorGlyph,
  power_source: BatteryGlyph,
  led: LedGlyph,
  led_uv_algan: LedGlyph,
  ground: GroundGlyph,
  wire: WireGlyph,
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
const TERMINALS: Record<string, { id: string; position: Position }[]> = {
  resistor: TWO('terminal_a', 'terminal_b'),
  capacitor: TWO('terminal_a', 'terminal_b'),
  power_source: TWO('terminal_positive', 'terminal_negative'),
  led: TWO('anode', 'cathode'),
  led_uv_algan: TWO('anode', 'cathode'),
  diode_silicon_rectifier: TWO('anode', 'cathode'),
  diode_schottky_al_si: TWO('anode', 'cathode'),
  diode_zener_silicon: TWO('anode', 'cathode'),
  switch_spst_toggle: TWO('terminal_in', 'terminal_out'),
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

/** The terminals (handle id + side) for a device definition. */
export function terminalsOf(definition: string): { id: string; position: Position }[] {
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
      <div
        style={{ position: 'relative', width: W, height: H, transform: `rotate(${rotation}deg)` }}
      >
        {/* One handle per terminal; id = terminal name. connectionMode="loose"
            (App) lets any terminal wire to any terminal. Ground = one top stem. */}
        {terminalsOf(definition).map((t) => {
          const polarity = TERMINAL_POLARITY[t.id]
          const onSide = t.position === Position.Left || t.position === Position.Right
          return (
            <Fragment key={t.id}>
              <Handle
                id={t.id}
                type="source"
                position={t.position}
                style={{
                  background: polarity === '+' ? '#e0594f' : polarity === '−' ? '#5a86d8' : '#888',
                  width: polarity ? 9 : undefined,
                  height: polarity ? 9 : undefined,
                  ...(onSide ? { top: MID } : {}),
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
        {health?.failed ? (
          <span title={health.note} style={{ marginLeft: 5 }}>
            💥
          </span>
        ) : null}
      </div>
    </div>
  )
}

export const nodeTypes = { device: DeviceNode }
