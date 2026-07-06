import { Handle, type NodeProps, Position, useUpdateNodeInternals } from '@xyflow/react'
import { Fragment, useContext, useEffect } from 'react'
import { SymbolStyleContext } from './symbol-style.tsx'
import { THEME } from './theme.ts'
import './canvas-animations.css'
import { thermalSeverity } from '../thermal-model.ts'
import { BlockNode } from './block-node.tsx'
import { CrtScreenContext, HealthContext } from './health.ts'
import {
  ENERGY_COLOR,
  FIELD_COLOR,
  LensContext,
  powerColor,
  thermalHotspotColor,
  thermalWarmthTint,
} from './lens.ts'
import { FrontContext } from './net-edge.tsx'
import {
  ANNOTATION_DEFINITIONS,
  fuseIntact,
  type Parameters,
  primaryValue,
  relayEnergized,
  sourceIsAc,
  sourceTerminalCount,
  sourceWaveform,
  spdtOnA,
  switchClosed,
  wiperFraction,
} from './part-defaults.ts'
import { formatEng } from './units.ts'
import {
  getUserPart,
  type PinElectrical,
  type UserPart,
  userPartGeometry,
  userPartTerminals,
} from './user-parts.ts'

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

const STROKE = THEME.textPrimary
const W = 80
const H = 44
const MID = H / 2

const lead = (x1: number, x2: number) => (
  <line x1={x1} y1={MID} x2={x2} y2={MID} stroke={STROKE} strokeWidth={1.5} />
)

// Resistor colour-code (IEC 60062): the digit colours 0–9, plus gold / silver for the small
// multipliers and the tolerance band.
const BAND_COLORS = [
  '#2b2b2b', // 0 black
  '#7a4a2a', // 1 brown
  '#d23b2a', // 2 red
  '#e0852a', // 3 orange
  '#e6c92e', // 4 yellow
  '#3a9a4a', // 5 green
  '#3a6ad2', // 6 blue
  '#9a4ad2', // 7 violet
  '#9a9a9a', // 8 grey
  '#f0f0f0', // 9 white
]
const GOLD = '#c9a24a'
const SILVER = '#c4c4c4'

/** The real 4-band colour code (digit, digit, ×multiplier, tolerance) for a resistance + tolerance —
 *  so 1 kΩ reads brown-black-red-gold, exactly like the physical part. Exported for the regression
 *  test that proves every resistor value gets its own correct, independent code. */
export function resistorBands(ohms: number, tolerancePercent: number): string[] {
  if (!Number.isFinite(ohms) || ohms <= 0) return []
  let exponent = Math.floor(Math.log10(ohms)) - 1
  let digits = Math.round(ohms / 10 ** exponent)
  if (digits >= 100) {
    digits = Math.round(digits / 10)
    exponent += 1
  }
  const color = (i: number): string => BAND_COLORS[i] ?? '#2b2b2b'
  const mult = exponent === -1 ? GOLD : exponent === -2 ? SILVER : color(exponent)
  const tol =
    tolerancePercent <= 1
      ? color(1)
      : tolerancePercent <= 2
        ? color(2)
        : tolerancePercent <= 5
          ? GOLD
          : SILVER
  return [color(Math.floor(digits / 10)), color(digits % 10), mult, tol]
}

const scalarAmount = (parameters: Parameters | undefined, key: string): number | undefined =>
  (parameters as Record<string, { value?: { amount?: number } }> | undefined)?.[key]?.value?.amount

const stringValue = (parameters: Parameters | undefined, key: string): string | undefined => {
  const value = (parameters as Record<string, { value?: unknown }> | undefined)?.[key]?.value
  return typeof value === 'string' ? value : undefined
}

/** The shared IEEE 315 zigzag resistor track (two leads + the zigzag body). Used
 *  by the resistor and every resistor-family part (potentiometer, thermistor,
 *  LDR) so the whole family reads as one symbol under the adopted US/IEEE-315
 *  standard — change the body here and they all follow. */
const ResistorTrack = () => {
  const style = useContext(SymbolStyleContext)
  return (
    <>
      {lead(0, 18)}
      {style === 'iec' ? (
        <rect x={18} y={14} width={44} height={16} fill="none" stroke={STROKE} strokeWidth={1.5} />
      ) : (
        <polyline
          points="18,22 23,12 31,32 39,12 47,32 55,12 62,22"
          fill="none"
          stroke={STROKE}
          strokeWidth={1.5}
        />
      )}
      {lead(62, W)}
    </>
  )
}

/** Resistor — IEEE 315 zigzag, or (in IEC mode) the rectangle body painted with its real colour-code
 *  bands, computed from the resistance + tolerance so it reads like the physical part. */
function ResistorGlyph({
  resistanceOhms,
  tolerancePercent = 5,
}: {
  resistanceOhms?: number | undefined
  tolerancePercent?: number | undefined
} = {}) {
  const style = useContext(SymbolStyleContext)
  // A placed part passes its real resistance; the palette preview (no value) shows the 470 Ω default.
  const bands = style === 'iec' ? resistorBands(resistanceOhms ?? 470, tolerancePercent) : []
  return (
    <svg width={W} height={H}>
      <title>resistor</title>
      <ResistorTrack />
      {(bands.length === 4
        ? [
            { k: 'd1', x: 24, c: bands[0] },
            { k: 'd2', x: 30, c: bands[1] },
            { k: 'mult', x: 36, c: bands[2] },
            { k: 'tol', x: 52, c: bands[3] },
          ]
        : []
      ).map((b) => (
        <rect
          key={b.k}
          x={b.x}
          y={15}
          width={4}
          height={14}
          fill={b.c}
          stroke="#00000088"
          strokeWidth={0.3}
        />
      ))}
    </svg>
  )
}

/**
 * DC source — the generic IEC source circle with the DC sign inside (a solid
 * line over a dashed one), matching the AC and clock circles so every source
 * is the same shape and the mark inside says WHICH it is. The voltage (or an
 * AC source's swing + frequency) prints under the part; polarity lives on the
 * handle badges, which always track the real terminals. The mark inside
 * counter-rotates so it reads upright however the part is turned — the
 * circle is symmetric, only the label needs to stay readable.
 */
function DcSourceGlyph({ rotation = 0 }: { rotation?: number }) {
  return (
    <svg width={W} height={H}>
      <title>DC source</title>
      {lead(0, 26)}
      <circle cx={40} cy={MID} r={14} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <g transform={`rotate(${-rotation} 40 ${MID})`}>
        <line x1={33} y1={MID - 3} x2={47} y2={MID - 3} stroke={STROKE} strokeWidth={1.5} />
        <line
          x1={33}
          y1={MID + 3}
          x2={47}
          y2={MID + 3}
          stroke={STROKE}
          strokeWidth={1.5}
          strokeDasharray="3 2"
        />
      </g>
      {lead(54, W)}
    </svg>
  )
}

/** AC source — IEC 60617: a circle with one sine period inside (kept upright). */
function AcSourceGlyph({ rotation = 0 }: { rotation?: number }) {
  return (
    <svg width={W} height={H}>
      <title>AC source</title>
      {lead(0, 26)}
      <circle cx={40} cy={MID} r={14} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <g transform={`rotate(${-rotation} 40 ${MID})`}>
        <path d="M31 22 q4.5 -9 9 0 q4.5 9 9 0" fill="none" stroke={STROKE} strokeWidth={1.3} />
      </g>
      {lead(54, W)}
    </svg>
  )
}

/** Square-wave clock source — the generator circle with its trace (kept upright). */
function SquareSourceGlyph({ rotation = 0 }: { rotation?: number }) {
  return (
    <svg width={W} height={H}>
      <title>square-wave clock source</title>
      {lead(0, 26)}
      <circle cx={40} cy={MID} r={14} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <g transform={`rotate(${-rotation} 40 ${MID})`}>
        <path
          d="M31 26 L31 18 L40 18 L40 26 L49 26 L49 18"
          fill="none"
          stroke={STROKE}
          strokeWidth={1.3}
        />
      </g>
      {lead(54, W)}
    </svg>
  )
}

/** Triangle-wave source — the generator circle with its ramp-up/ramp-down trace (kept upright). */
function TriangleSourceGlyph({ rotation = 0 }: { rotation?: number }) {
  return (
    <svg width={W} height={H}>
      <title>triangle-wave source</title>
      {lead(0, 26)}
      <circle cx={40} cy={MID} r={14} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <g transform={`rotate(${-rotation} 40 ${MID})`}>
        <path d="M31 26 L36 18 L45 26 L49 19" fill="none" stroke={STROKE} strokeWidth={1.3} />
      </g>
      {lead(54, W)}
    </svg>
  )
}

/** Sawtooth source — the generator circle with the ramp-and-retrace sweep trace (kept upright). */
function SawtoothSourceGlyph({ rotation = 0 }: { rotation?: number }) {
  return (
    <svg width={W} height={H}>
      <title>sawtooth sweep source</title>
      {lead(0, 26)}
      <circle cx={40} cy={MID} r={14} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <g transform={`rotate(${-rotation} 40 ${MID})`}>
        <path d="M31 26 L40 18 L40 26 L49 18" fill="none" stroke={STROKE} strokeWidth={1.3} />
      </g>
      {lead(54, W)}
    </svg>
  )
}

/** Staircase source — the generator circle with the stepped-sweep trace (kept upright). */
function StaircaseSourceGlyph({ rotation = 0 }: { rotation?: number }) {
  return (
    <svg width={W} height={H}>
      <title>staircase stepped-sweep source</title>
      {lead(0, 26)}
      <circle cx={40} cy={MID} r={14} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <g transform={`rotate(${-rotation} 40 ${MID})`}>
        <path
          d="M31 26 L36 26 L36 22 L41 22 L41 18 L46 18"
          fill="none"
          stroke={STROKE}
          strokeWidth={1.3}
        />
      </g>
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

/** Zener diode — the diode triangle + a cathode bar with the bent (Z) ends. */
function ZenerGlyph() {
  return (
    <svg width={W} height={H}>
      <title>Zener diode</title>
      {lead(0, 26)}
      <polygon points="26,12 26,32 44,22" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <path d="M40 8 L44 12 L44 32 L48 36" fill="none" stroke={STROKE} strokeWidth={1.5} />
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

/** Laser diode — the LED's emitting junction, but the two arrows are PARALLEL (a coherent,
 *  collimated beam) rather than the LED's divergent rays. */
function LaserDiodeGlyph() {
  return (
    <svg width={W} height={H}>
      <title>laser diode</title>
      {lead(0, 26)}
      <polygon points="26,12 26,32 44,22" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={12} x2={44} y2={32} stroke={STROKE} strokeWidth={1.5} />
      {lead(44, W)}
      <g stroke={STROKE} strokeWidth={1.2}>
        <line x1={33} y1={10} x2={33} y2={0} />
        <polyline points="30,3 33,0 36,3" fill="none" />
        <line x1={41} y1={10} x2={41} y2={0} />
        <polyline points="38,3 41,0 44,3" fill="none" />
      </g>
    </svg>
  )
}

/** Tunnel (Esaki) diode — the rectifier triangle, with the cathode bar drawn as a bracket
 *  (short serifs off both ends toward the anode), the standard tunnel-diode mark. */
function TunnelDiodeGlyph() {
  return (
    <svg width={W} height={H}>
      <title>tunnel diode</title>
      {lead(0, 26)}
      <polygon points="26,12 26,32 44,22" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={12} x2={44} y2={32} stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={12} x2={39} y2={12} stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={32} x2={39} y2={32} stroke={STROKE} strokeWidth={1.5} />
      {lead(44, W)}
    </svg>
  )
}

/** Shockley 4-layer diode — a latching trigger diode: the rectifier shape with a FILLED triangle
 *  (the trigger/switching-diode convention), distinct from the open-triangle rectifier. */
function ShockleyDiodeGlyph() {
  return (
    <svg width={W} height={H}>
      <title>Shockley 4-layer diode</title>
      {lead(0, 26)}
      <polygon points="26,12 26,32 44,22" fill={STROKE} stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={12} x2={44} y2={32} stroke={STROKE} strokeWidth={1.5} />
      {lead(44, W)}
    </svg>
  )
}

/** Varactor (varicap) diode — the rectifier triangle with a SECOND cathode bar (a capacitor
 *  plate): a diode deliberately used as a voltage-controlled capacitor. */
function VaractorGlyph() {
  return (
    <svg width={W} height={H}>
      <title>varactor diode</title>
      {lead(0, 26)}
      <polygon points="26,12 26,32 44,22" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={12} x2={44} y2={32} stroke={STROKE} strokeWidth={1.5} />
      <line x1={48} y1={12} x2={48} y2={32} stroke={STROKE} strokeWidth={1.5} />
      {lead(48, W)}
    </svg>
  )
}

/** SCR (silicon controlled rectifier) — a rectifier diode with a GATE lead off the cathode side. */
function ScrGlyph() {
  return (
    <svg width={W} height={H}>
      <title>SCR (silicon controlled rectifier)</title>
      {lead(0, 26)}
      <polygon points="26,12 26,32 44,22" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={12} x2={44} y2={32} stroke={STROKE} strokeWidth={1.5} />
      {lead(44, W)}
      <line x1={44} y1={30} x2={32} y2={44} stroke={STROKE} strokeWidth={1.2} />
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

/** SPST momentary push button — two contacts bridged by a plunger-driven bar;
 *  pressed = bar down on the contacts, open = bar lifted with a gap. */
function PushButtonGlyph({ closed }: { closed: boolean }) {
  const barY = closed ? MID - 4 : MID - 12
  return (
    <svg width={W} height={H}>
      <title>{closed ? 'push button (pressed)' : 'push button (open)'}</title>
      {lead(0, 26)}
      {lead(54, W)}
      {/* the two fixed contacts the bar lands on when pressed */}
      <line x1={26} y1={MID} x2={26} y2={MID - 4} stroke={STROKE} strokeWidth={1.5} />
      <line x1={54} y1={MID} x2={54} y2={MID - 4} stroke={STROKE} strokeWidth={1.5} />
      {/* the moving contact bar */}
      <line x1={24} y1={barY} x2={56} y2={barY} stroke={STROKE} strokeWidth={1.5} />
      {/* the plunger stem and button cap */}
      <line x1={40} y1={barY} x2={40} y2={barY - 7} stroke={STROKE} strokeWidth={1.5} />
      <line x1={33} y1={barY - 7} x2={47} y2={barY - 7} stroke={STROKE} strokeWidth={2.5} />
    </svg>
  )
}

/** SPDT selector — a common pivot whose lever throws to the upper (A) or
 *  lower (B) contact; the unselected throw stays an open contact. */
function SpdtGlyph({ onA }: { onA: boolean }) {
  return (
    <svg width={W} height={H}>
      <title>{onA ? 'SPDT switch (common → A)' : 'SPDT switch (common → B)'}</title>
      <line x1={0} y1={MID} x2={26} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      <circle cx={28} cy={MID} r={2.5} fill="none" stroke={STROKE} />
      <line x1={56} y1={12} x2={W} y2={12} stroke={STROKE} strokeWidth={1.5} />
      <circle cx={54} cy={12} r={2.5} fill="none" stroke={STROKE} />
      <line x1={56} y1={32} x2={W} y2={32} stroke={STROKE} strokeWidth={1.5} />
      <circle cx={54} cy={32} r={2.5} fill="none" stroke={STROKE} />
      {/* the lever from the pivot to the selected throw */}
      <line x1={28} y1={MID} x2={52} y2={onA ? 13 : 31} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** Potentiometer — IEEE 315: a resistor body (the full track) with a wiper
 *  arrow tapping a point along it. The arrow slides with the wiper position so
 *  the symbol shows where the tap sits between the two ends. */
function PotentiometerGlyph({ position }: { position: number }) {
  const p = Math.min(Math.max(position, 0), 1)
  const wiperX = 18 + 44 * p
  return (
    <svg width={W} height={H}>
      <title>{`potentiometer (wiper ${Math.round(p * 100)}%)`}</title>
      <ResistorTrack />
      {/* the wiper: a stem from the top tapping the track with an arrowhead */}
      <line x1={wiperX} y1={1} x2={wiperX} y2={14} stroke={STROKE} strokeWidth={1.5} />
      <polygon
        points={`${wiperX},21 ${wiperX - 3.5},13 ${wiperX + 3.5},13`}
        fill={STROKE}
        stroke={STROKE}
      />
    </svg>
  )
}

/** Fuse — IEC 60617: a rectangular body with the fusible element drawn through
 *  it. Intact = the element is a whole line lead-to-lead; blown = the line has
 *  a melted gap in the middle, so a dead fuse reads as a dead fuse at a glance. */
function FuseGlyph({ intact }: { intact: boolean }) {
  return (
    <svg width={W} height={H}>
      <title>{intact ? 'fuse' : 'fuse (blown)'}</title>
      {lead(0, 22)}
      <rect
        x={22}
        y={MID - 7}
        width={36}
        height={14}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      {intact ? (
        <line x1={22} y1={MID} x2={58} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      ) : (
        // the melted element: two stubs retracting from a gap in the middle
        <>
          <line x1={22} y1={MID} x2={35} y2={MID} stroke={STROKE} strokeWidth={1.5} />
          <line x1={45} y1={MID} x2={58} y2={MID} stroke={STROKE} strokeWidth={1.5} />
          <line x1={35} y1={MID - 2} x2={37} y2={MID + 2} stroke={STROKE} strokeWidth={1.2} />
          <line x1={45} y1={MID - 2} x2={43} y2={MID + 2} stroke={STROKE} strokeWidth={1.2} />
        </>
      )}
      {lead(58, W)}
    </svg>
  )
}

/** Thermistor — IEEE 315: a resistor (zigzag) body crossed by a diagonal line
 *  with a small foot, the standard mark for a temperature-dependent resistance
 *  (an NTC's resistance falls as it warms). */
function ThermistorGlyph() {
  return (
    <svg width={W} height={H}>
      <title>thermistor (NTC)</title>
      <ResistorTrack />
      {/* the diagonal dependence line + the small foot that marks 't°' */}
      <line x1={20} y1={MID + 11} x2={58} y2={MID - 11} stroke={STROKE} strokeWidth={1.5} />
      <line x1={20} y1={MID + 11} x2={27} y2={MID + 11} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** Photoresistor (LDR) — IEEE 315: a resistor (zigzag) body struck by two arrows
 *  (light falling IN — the mirror of the LED's two arrows radiating OUT). Its
 *  resistance falls as the incident light rises. */
function PhotoresistorGlyph() {
  return (
    <svg width={W} height={H}>
      <title>photoresistor (LDR)</title>
      <ResistorTrack />
      {/* two arrows striking the body — incident light (heads at the zigzag) */}
      <g stroke={STROKE} strokeWidth={1.2}>
        <line x1={28} y1={3} x2={37} y2={12} />
        <polyline points="37,7 37,12 32,12" fill="none" />
        <line x1={38} y1={3} x2={47} y2={12} />
        <polyline points="47,7 47,12 42,12" fill="none" />
      </g>
    </svg>
  )
}

/** Incandescent bulb — IEC 60617: a circle (the glass envelope) with an internal
 *  cross, the standard mark for an illuminating lamp. A two-terminal in-line part. */
function IncandescentBulbGlyph() {
  return (
    <svg width={W} height={H}>
      <title>incandescent bulb</title>
      {lead(0, 28)}
      <circle cx={40} cy={MID} r={12} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={31.5} y1={MID - 8.5} x2={48.5} y2={MID + 8.5} stroke={STROKE} strokeWidth={1.5} />
      <line x1={31.5} y1={MID + 8.5} x2={48.5} y2={MID - 8.5} stroke={STROKE} strokeWidth={1.5} />
      {lead(52, W)}
    </svg>
  )
}

/** Light source (lamp) — a sun: a bulb radiating rays in every direction. The
 *  emitter that casts the light an LDR's arrows receive. Environmental, no leads. */
function LightSourceGlyph() {
  const cx = W / 2
  const cy = MID
  const rayAngles = [0, 45, 90, 135, 180, 225, 270, 315]
  return (
    <svg width={W} height={H}>
      <title>light source (lamp)</title>
      <circle cx={cx} cy={cy} r={7} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <g stroke={STROKE} strokeWidth={1.2}>
        {rayAngles.map((deg) => {
          const a = (deg * Math.PI) / 180
          return (
            <line
              key={deg}
              x1={cx + Math.cos(a) * 10}
              y1={cy + Math.sin(a) * 10}
              x2={cx + Math.cos(a) * 16}
              y2={cy + Math.sin(a) * 16}
            />
          )
        })}
      </g>
    </svg>
  )
}

/** Relay — IEC: a coil box (the electromagnet) mechanically linked (the dashed
 *  armature) to an SPDT contact. Energized, the common arm throws up to
 *  normally_open; at rest a spring holds it down on normally_closed. The arm
 *  position shows the state at a glance. coil_a/coil_b left, common right,
 *  normally_open top, normally_closed bottom. */
function RelayGlyph({ energized }: { energized: boolean }) {
  const armTipY = energized ? 11 : 33
  return (
    <svg width={W} height={H}>
      <title>{energized ? 'relay (energized)' : 'relay (at rest)'}</title>
      {/* coil: two leads + the box on the left */}
      <line x1={0} y1={13} x2={12} y2={13} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={31} x2={12} y2={31} stroke={STROKE} strokeWidth={1.5} />
      <rect x={12} y={11} width={14} height={22} fill="none" stroke={STROKE} strokeWidth={1.5} />
      {/* the mechanical link (armature) from the coil to the contact pivot */}
      <line
        x1={26}
        y1={MID}
        x2={56}
        y2={MID}
        stroke={STROKE}
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      {/* common pole: the pivot + its lead out to the right edge */}
      <circle cx={58} cy={MID} r={2} fill={STROKE} stroke={STROKE} />
      <line x1={58} y1={MID} x2={W} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      {/* the swinging arm — up to NO when energized, down to NC at rest */}
      <line x1={58} y1={MID} x2={40} y2={armTipY} stroke={STROKE} strokeWidth={1.5} />
      {/* normally_open contact (top) + lead to the top edge */}
      <circle cx={40} cy={11} r={2} fill="none" stroke={STROKE} />
      <line x1={40} y1={9} x2={40} y2={0} stroke={STROKE} strokeWidth={1.5} />
      {/* normally_closed contact (bottom) + lead to the bottom edge */}
      <circle cx={40} cy={33} r={2} fill="none" stroke={STROKE} />
      <line x1={40} y1={35} x2={40} y2={H} stroke={STROKE} strokeWidth={1.5} />
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

/** Electromagnet — the inductor coil wound on an iron CORE: the same coil humps plus
 *  the two parallel core lines (the IEC iron-core marking) the field concentrates in. */
function ElectromagnetGlyph() {
  return (
    <svg width={W} height={H}>
      <title>electromagnet</title>
      {lead(0, 18)}
      <path
        d="M18 22 A5.5 5.5 0 0 1 29 22 A5.5 5.5 0 0 1 40 22 A5.5 5.5 0 0 1 51 22 A5.5 5.5 0 0 1 62 22"
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      {lead(62, W)}
      <line x1={18} y1={27} x2={62} y2={27} stroke={STROKE} strokeWidth={1.4} />
      <line x1={18} y1={29.5} x2={62} y2={29.5} stroke={STROKE} strokeWidth={1.4} />
    </svg>
  )
}

/** DC motor — the standard circle with "M" (IEC), a lead on each side (+ left, − right). */
function MotorGlyph() {
  return (
    <svg width={W} height={H}>
      <title>DC motor</title>
      {lead(0, 24)}
      <circle cx={40} cy={MID} r={16} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <text
        x={40}
        y={MID}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={15}
        fontWeight={700}
        fill={STROKE}
        fontFamily="system-ui, sans-serif"
      >
        M
      </text>
      {lead(56, W)}
    </svg>
  )
}

/** DC generator (dynamo) — the standard circle with "G" (IEC), a lead each side (+ left,
 *  − right). The dual of the motor's "M": the same machine, driven the other way. */
function GeneratorGlyph() {
  return (
    <svg width={W} height={H}>
      <title>DC generator</title>
      {lead(0, 24)}
      <circle cx={40} cy={MID} r={16} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <text
        x={40}
        y={MID}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={15}
        fontWeight={700}
        fill={STROKE}
        fontFamily="system-ui, sans-serif"
      >
        G
      </text>
      {lead(56, W)}
    </svg>
  )
}

/** Alternator (AC generator) — IEC: the machine circle with "G" over "~". */
function AlternatorGlyph() {
  return (
    <svg width={W} height={H}>
      <title>alternator (AC generator)</title>
      {lead(0, 24)}
      <circle cx={40} cy={MID} r={16} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <text
        x={40}
        y={MID - 4}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={700}
        fill={STROKE}
        fontFamily="system-ui, sans-serif"
      >
        G
      </text>
      <path d="M33 27 q3.5 -6 7 0 q3.5 6 7 0" fill="none" stroke={STROKE} strokeWidth={1.2} />
      {lead(56, W)}
    </svg>
  )
}

/** Three-phase alternator — IEC: the machine circle with "G" over "3~"; the neutral leads out the
 *  left, the three phase leads fan out the right (their handles sit on the node's right edge). */
function ThreePhaseAlternatorGlyph() {
  return (
    <svg width={W} height={H}>
      <title>three-phase alternator</title>
      {lead(0, 24)}
      <circle cx={40} cy={MID} r={16} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <text
        x={37}
        y={MID - 4}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={700}
        fill={STROKE}
        fontFamily="system-ui, sans-serif"
      >
        G
      </text>
      <text
        x={40}
        y={MID + 7}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={9}
        fill={STROKE}
        fontFamily="system-ui, sans-serif"
      >
        3~
      </text>
      {/* the three phase leads fanning to the right edge, meeting their handles at y 8/22/36 */}
      <path d="M56 22 L80 8" fill="none" stroke={STROKE} strokeWidth={1.4} />
      <path d="M56 22 L80 22" fill="none" stroke={STROKE} strokeWidth={1.4} />
      <path d="M56 22 L80 36" fill="none" stroke={STROKE} strokeWidth={1.4} />
    </svg>
  )
}

/** Three-phase induction (AC) motor — IEC: the machine circle with "M" over "3~" (3-phase AC),
 *  distinguishing it from the DC motor's plain "M". A lead each side. */
function InductionMotorGlyph() {
  return (
    <svg width={W} height={H}>
      <title>AC induction motor</title>
      {lead(0, 24)}
      <circle cx={40} cy={MID} r={16} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <text
        x={40}
        y={MID - 4}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={700}
        fill={STROKE}
        fontFamily="system-ui, sans-serif"
      >
        M
      </text>
      <text
        x={40}
        y={MID + 7}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={8}
        fill={STROKE}
        fontFamily="system-ui, sans-serif"
      >
        3~
      </text>
      {lead(56, W)}
    </svg>
  )
}

/** Carbon arc lamp — two electrode rods facing across a small gap with the arc (a jagged spark)
 *  striking between them. A lead out each side (anode + / cathode −). */
function ArcLampGlyph() {
  return (
    <svg width={W} height={H}>
      <title>arc lamp</title>
      {lead(0, 26)}
      <line x1={26} y1={MID} x2={37} y2={MID} stroke={STROKE} strokeWidth={3} />
      <line x1={43} y1={MID} x2={54} y2={MID} stroke={STROKE} strokeWidth={3} />
      <polyline
        points={`37,${MID} 39,${MID - 5} 40.5,${MID + 4} 42,${MID - 4} 43,${MID}`}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.2}
      />
      {lead(54, W)}
    </svg>
  )
}

/** Neon / gas-discharge lamp — IEC: the gas-filled envelope (circle) with two electrodes and a
 *  dot for the gas glow. A fluorescent tube is the same discharge plus a phosphor coating. */
function NeonLampGlyph() {
  return (
    <svg width={W} height={H}>
      <title>neon lamp</title>
      {lead(0, 26)}
      <circle cx={40} cy={MID} r={14} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={35} y1={MID - 7} x2={35} y2={MID + 7} stroke={STROKE} strokeWidth={1.5} />
      <line x1={45} y1={MID - 7} x2={45} y2={MID + 7} stroke={STROKE} strokeWidth={1.5} />
      <circle cx={40} cy={MID} r={2} fill={STROKE} stroke={STROKE} />
      {lead(54, W)}
    </svg>
  )
}

/** Cathode-ray tube — the electron gun at the narrow neck (left, cathode + anode leads) widening to
 *  the phosphor screen face (right), with the X/Y deflection inputs out the right. */
function CrtGlyph() {
  return (
    <svg width={W} height={H}>
      <title>cathode-ray tube</title>
      <line x1={0} y1={14} x2={16} y2={14} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={30} x2={16} y2={30} stroke={STROKE} strokeWidth={1.5} />
      <path d="M16 14 L16 30 L62 38 L62 6 Z" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={62} y1={14} x2={W} y2={14} stroke={STROKE} strokeWidth={1.5} />
      <line x1={62} y1={30} x2={W} y2={30} stroke={STROKE} strokeWidth={1.5} />
      <line x1={11} y1={MID - 4} x2={11} y2={MID + 4} stroke={STROKE} strokeWidth={2} />
    </svg>
  )
}

/**
 * A live CRT phosphor SCREEN, drawn from the REAL solved beam. `spot` is the DC landing point and
 * `trace` is the beam's locus over a transient run (both screen-fractions −1..1, straight out of
 * crtSpotTrace / the deflection law). Green phosphor with a real glow; the whole swept path stays lit
 * (long-persistence phosphor) with the live spot brightest. Nothing is painted that the real
 * deflection voltages didn't put there — wire a sweep + a signal and it draws that signal.
 */
export function CrtScreen({
  w,
  h,
  spot,
  brightness,
  trace,
}: {
  w: number
  h: number
  spot: { x: number; y: number }
  brightness: number
  trace?: readonly { x: number; y: number; i: number }[]
}) {
  const cx = w / 2
  const cy = h / 2
  const sx = (w / 2) * 0.84
  const sy = (h / 2) * 0.84
  const px = (fx: number) => cx + fx * sx
  const py = (fy: number) => cy - fy * sy
  const phosphor = THEME.accentLime
  const glow = (blurPx: number) => ({ filter: `drop-shadow(0 0 ${blurPx}px ${phosphor})` })
  // Raster (a TV) vs vector (a scope): if the beam INTENSITY is modulated over the run — a video on
  // the grid — paint the picture point-by-point; if it is ~constant, draw the connected trace.
  let iMin = 1
  let iMax = 0
  if (trace) {
    for (const p of trace) {
      if (p.i < iMin) iMin = p.i
      if (p.i > iMax) iMax = p.i
    }
  }
  const raster = trace !== undefined && trace.length > 1 && iMax - iMin > 0.15
  const dot = Math.max(1.3, h * 0.02)
  const last = trace && trace.length > 0 ? trace[trace.length - 1] : undefined
  const beam = last ?? { x: spot.x, y: spot.y }
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: the screen is decorative; the CRT node carries the label
    <svg width={w} height={h} aria-hidden style={{ display: 'block' }}>
      <rect
        x={0.5}
        y={0.5}
        width={w - 1}
        height={h - 1}
        rx={Math.min(10, h * 0.12)}
        fill={THEME.surfaceDeep}
        stroke={THEME.borderStrong}
      />
      {raster ? (
        // The TV picture: every beam sample lit by its REAL intensity (the grid video paints it as
        // the beam scans). Dark samples (beam blanked) are skipped, so the lit pixels form the image.
        trace?.map((p, idx) =>
          p.i > 0.06 ? (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-order beam-sample sequence
              key={idx}
              x={px(p.x) - dot / 2}
              y={py(p.y) - dot / 2}
              width={dot}
              height={dot}
              fill={phosphor}
              opacity={p.i}
            />
          ) : null,
        )
      ) : (
        <>
          <line
            x1={cx}
            y1={h * 0.08}
            x2={cx}
            y2={h * 0.92}
            stroke={THEME.borderSubtle}
            strokeWidth={0.5}
          />
          <line
            x1={w * 0.08}
            y1={cy}
            x2={w * 0.92}
            y2={cy}
            stroke={THEME.borderSubtle}
            strokeWidth={0.5}
          />
          {trace && trace.length > 1 ? (
            <polyline
              points={trace.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')}
              fill="none"
              stroke={phosphor}
              strokeWidth={1.4}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={Math.max(0.25, brightness * 0.85)}
              style={glow(2)}
            />
          ) : null}
          <circle
            cx={px(beam.x)}
            cy={py(beam.y)}
            r={Math.max(2, h * 0.04)}
            fill={phosphor}
            opacity={Math.max(0.3, brightness)}
            style={glow(4)}
          />
        </>
      )}
    </svg>
  )
}

/** Transmission line — a conductor PAIR (the two lines) in a box, with the near pair on
 *  the left and the far pair on the right; Z₀ marks the characteristic impedance. */
function TransmissionLineGlyph() {
  return (
    <svg width={W} height={H}>
      <title>transmission line</title>
      <rect
        x={18}
        y={9}
        width={44}
        height={26}
        rx={3}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <line x1={0} y1={14} x2={18} y2={14} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={30} x2={18} y2={30} stroke={STROKE} strokeWidth={1.5} />
      <line x1={62} y1={14} x2={W} y2={14} stroke={STROKE} strokeWidth={1.5} />
      <line x1={62} y1={30} x2={W} y2={30} stroke={STROKE} strokeWidth={1.5} />
      <line x1={18} y1={14} x2={62} y2={14} stroke={STROKE} strokeWidth={1.2} />
      <line x1={18} y1={30} x2={62} y2={30} stroke={STROKE} strokeWidth={1.2} />
      <text
        x={40}
        y={22}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={9}
        fill={STROKE}
        fontFamily="system-ui, sans-serif"
      >
        Z₀
      </text>
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

/** Net label / power port — a named tag on a short stalk down to its single terminal. Every
 *  label sharing a name is the SAME net (a teleporting rail), so +5V here ties to +5V there
 *  with no drawn wire. The name on the tag is the net; the dedicated Ground part stays the 0 V
 *  reference (a label is pure connectivity, not a voltage source). */
function NetLabelGlyph({ name }: { name: string }) {
  const text = name.length > 7 ? `${name.slice(0, 6)}…` : name
  return (
    <svg width={W} height={H}>
      <title>net label</title>
      <rect
        x={W / 2 - 24}
        y={5}
        width={48}
        height={20}
        rx={4}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <text
        x={W / 2}
        y={19}
        textAnchor="middle"
        fontSize={11}
        fill={STROKE}
        fontFamily="system-ui, sans-serif"
      >
        {text}
      </text>
      <line x1={W / 2} y1={25} x2={W / 2} y2={40} stroke={STROKE} strokeWidth={1.5} />
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

/** Op-amp — the standard amplifier triangle pointing at the output, two inputs on the
 * left marked + (non-inverting) and − (inverting). On the canvas it is a block; this
 * glyph is just its palette face. */
/** Vacuum diode (Fleming valve) — the glass envelope (circle) with a plate (anode)
 *  bar up top and a heated-filament cathode (inverted V) below; plate lead out the
 *  top, cathode lead out the bottom. The first electronic component. */
function VacuumDiodeGlyph() {
  return (
    <svg width={W} height={H}>
      <title>vacuum diode (Fleming valve)</title>
      <circle cx={40} cy={MID} r={14} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={0} x2={40} y2={14} stroke={STROKE} strokeWidth={1.5} />
      <line x1={31} y1={14} x2={49} y2={14} stroke={STROKE} strokeWidth={1.5} />
      <polyline points="34,31 40,24 46,31" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={31} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** Triode (de Forest's Audion) — the vacuum diode plus a control GRID: a dashed line
 *  across the middle (grid lead out the left) between the plate and the cathode. The
 *  first amplifier. */
function VacuumTriodeGlyph() {
  return (
    <svg width={W} height={H}>
      <title>triode (Audion)</title>
      <circle cx={40} cy={MID} r={15} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={0} x2={40} y2={13} stroke={STROKE} strokeWidth={1.5} />
      <line x1={32} y1={13} x2={48} y2={13} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={MID} x2={26} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      <line
        x1={28}
        y1={MID}
        x2={52}
        y2={MID}
        stroke={STROKE}
        strokeWidth={1.4}
        strokeDasharray="3 2.5"
      />
      <polyline points="34,32 40,26 46,32" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={32} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** Tetrode — the triode plus a SCREEN grid: two dashed grids inside the envelope (the
 *  control grid g1 out the left, the screen grid g2 out the right), between plate and
 *  cathode. The screen flattens the plate characteristic. */
function TetrodeGlyph() {
  return (
    <svg width={W} height={H}>
      <title>tetrode (screen-grid tube)</title>
      <circle cx={40} cy={MID} r={15} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={0} x2={40} y2={11} stroke={STROKE} strokeWidth={1.5} />
      <line x1={32} y1={11} x2={48} y2={11} stroke={STROKE} strokeWidth={1.5} />
      <line
        x1={28}
        y1={17}
        x2={52}
        y2={17}
        stroke={STROKE}
        strokeWidth={1.3}
        strokeDasharray="3 2.5"
      />
      <line x1={52} y1={17} x2={W} y2={17} stroke={STROKE} strokeWidth={1.5} />
      <line
        x1={28}
        y1={26}
        x2={52}
        y2={26}
        stroke={STROKE}
        strokeWidth={1.3}
        strokeDasharray="3 2.5"
      />
      <line x1={0} y1={26} x2={28} y2={26} stroke={STROKE} strokeWidth={1.5} />
      <polyline points="34,34 40,29 46,34" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={34} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** Pentode — the tetrode plus a third grid: the SUPPRESSOR (g3, between the screen and
 *  the plate, usually tied to the cathode), which returns secondary electrons and so
 *  removes the tetrode kink. Three dashed grids inside the envelope. */
function PentodeGlyph() {
  return (
    <svg width={W} height={H}>
      <title>pentode</title>
      <circle cx={40} cy={MID} r={16} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={0} x2={40} y2={8} stroke={STROKE} strokeWidth={1.5} />
      <line x1={32} y1={8} x2={48} y2={8} stroke={STROKE} strokeWidth={1.5} />
      <line
        x1={28}
        y1={13}
        x2={52}
        y2={13}
        stroke={STROKE}
        strokeWidth={1.2}
        strokeDasharray="3 2.5"
      />
      <line x1={0} y1={13} x2={28} y2={13} stroke={STROKE} strokeWidth={1.5} />
      <line
        x1={28}
        y1={20}
        x2={52}
        y2={20}
        stroke={STROKE}
        strokeWidth={1.2}
        strokeDasharray="3 2.5"
      />
      <line x1={52} y1={20} x2={W} y2={20} stroke={STROKE} strokeWidth={1.5} />
      <line
        x1={28}
        y1={27}
        x2={52}
        y2={27}
        stroke={STROKE}
        strokeWidth={1.2}
        strokeDasharray="3 2.5"
      />
      <line x1={0} y1={27} x2={28} y2={27} stroke={STROKE} strokeWidth={1.5} />
      <polyline points="34,35 40,30 46,35" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={35} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

function OpAmpGlyph() {
  return (
    <svg width={W} height={H}>
      <title>op-amp</title>
      <line x1={0} y1={MID - 7} x2={25} y2={MID - 7} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={MID + 7} x2={25} y2={MID + 7} stroke={STROKE} strokeWidth={1.5} />
      <polygon
        points={`25,${MID - 15} 25,${MID + 15} 58,${MID}`}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <line x1={58} y1={MID} x2={80} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      {/* + on the non-inverting input, − on the inverting */}
      <line x1={29} y1={MID - 7} x2={35} y2={MID - 7} stroke={STROKE} strokeWidth={1} />
      <line x1={32} y1={MID - 10} x2={32} y2={MID - 4} stroke={STROKE} strokeWidth={1} />
      <line x1={29} y1={MID + 7} x2={35} y2={MID + 7} stroke={STROKE} strokeWidth={1} />
    </svg>
  )
}

/** A dependent (controlled) source — a diamond (vs the circle of an independent source) with the
 *  current-source arrow: control sense leads on the left, the controlled output on the right. The
 *  letter marks which control: 'g' = transconductance (VCCS, I = g·V), 'f' = current gain (CCCS,
 *  I = f·I). 4 terminals: control_positive/negative (left), output_positive/negative (right). */
function DependentCurrentGlyph({ label }: { label: string }) {
  return (
    <svg width={W} height={H}>
      <title>{label === 'g' ? 'VCCS' : 'CCCS'}</title>
      <line x1={0} y1={14} x2={23} y2={20} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={30} x2={23} y2={24} stroke={STROKE} strokeWidth={1.5} />
      <line x1={57} y1={20} x2={80} y2={14} stroke={STROKE} strokeWidth={1.5} />
      <line x1={57} y1={24} x2={80} y2={30} stroke={STROKE} strokeWidth={1.5} />
      <polygon points="40,7 57,22 40,37 23,22" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={32} x2={40} y2={14} stroke={STROKE} strokeWidth={1.3} />
      <polyline points="36,19 40,13 44,19" fill="none" stroke={STROKE} strokeWidth={1.3} />
      <text x={7} y={13} fontSize={9} fill={STROKE} fontFamily="system-ui, sans-serif">
        {label}
      </text>
    </svg>
  )
}
function VccsGlyph() {
  return <DependentCurrentGlyph label="g" />
}
function CccsGlyph() {
  return <DependentCurrentGlyph label="f" />
}

/** NOT gate (CMOS inverter) — the standard triangle with the inversion bubble at its tip.
 *  On the canvas it is a block; this glyph is its palette face. */
function NotGateGlyph() {
  return (
    <svg width={W} height={H}>
      <title>NOT gate (inverter)</title>
      <line x1={0} y1={MID} x2={20} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      <polygon
        points={`20,${MID - 14} 20,${MID + 14} 50,${MID}`}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <circle cx={54} cy={MID} r={4} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={58} y1={MID} x2={80} y2={MID} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** NAND gate — the AND D-shape (flat back, round front) with the inversion bubble. */
function NandGateGlyph() {
  return (
    <svg width={W} height={H}>
      <title>NAND gate</title>
      <line x1={0} y1={MID - 7} x2={18} y2={MID - 7} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={MID + 7} x2={18} y2={MID + 7} stroke={STROKE} strokeWidth={1.5} />
      <path
        d={`M 18 ${MID - 14} L 38 ${MID - 14} A 14 14 0 0 1 38 ${MID + 14} L 18 ${MID + 14} Z`}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <circle cx={56} cy={MID} r={4} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={60} y1={MID} x2={80} y2={MID} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** NOR gate — the OR shield (curved back, pointed front) with the inversion bubble. */
function NorGateGlyph() {
  return (
    <svg width={W} height={H}>
      <title>NOR gate</title>
      <line x1={0} y1={MID - 7} x2={18} y2={MID - 7} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={MID + 7} x2={18} y2={MID + 7} stroke={STROKE} strokeWidth={1.5} />
      <path
        d={`M 16 ${MID - 14} Q 34 ${MID - 14} 50 ${MID} Q 34 ${MID + 14} 16 ${MID + 14} Q 25 ${MID} 16 ${MID - 14} Z`}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <circle cx={54} cy={MID} r={4} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={58} y1={MID} x2={80} y2={MID} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** AND gate — the D-shape (flat back, round front), no bubble. */
function AndGateGlyph() {
  return (
    <svg width={W} height={H}>
      <title>AND gate</title>
      <line x1={0} y1={MID - 7} x2={18} y2={MID - 7} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={MID + 7} x2={18} y2={MID + 7} stroke={STROKE} strokeWidth={1.5} />
      <path
        d={`M 18 ${MID - 14} L 38 ${MID - 14} A 14 14 0 0 1 38 ${MID + 14} L 18 ${MID + 14} Z`}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <line x1={52} y1={MID} x2={80} y2={MID} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** OR gate — the shield (curved back, pointed front), no bubble. */
function OrGateGlyph() {
  return (
    <svg width={W} height={H}>
      <title>OR gate</title>
      <line x1={0} y1={MID - 7} x2={18} y2={MID - 7} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={MID + 7} x2={18} y2={MID + 7} stroke={STROKE} strokeWidth={1.5} />
      <path
        d={`M 16 ${MID - 14} Q 34 ${MID - 14} 50 ${MID} Q 34 ${MID + 14} 16 ${MID + 14} Q 25 ${MID} 16 ${MID - 14} Z`}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <line x1={50} y1={MID} x2={80} y2={MID} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** XOR gate — the OR shield with the extra back-curve that marks exclusive-or, no bubble. */
function XorGateGlyph() {
  return (
    <svg width={W} height={H}>
      <title>XOR gate</title>
      <line x1={0} y1={MID - 7} x2={14} y2={MID - 7} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={MID + 7} x2={14} y2={MID + 7} stroke={STROKE} strokeWidth={1.5} />
      <path
        d={`M 12 ${MID - 14} Q 21 ${MID} 12 ${MID + 14}`}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <path
        d={`M 18 ${MID - 14} Q 36 ${MID - 14} 52 ${MID} Q 36 ${MID + 14} 18 ${MID + 14} Q 27 ${MID} 18 ${MID - 14} Z`}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <line x1={52} y1={MID} x2={80} y2={MID} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** XNOR gate — the XOR shield with the inversion bubble (HIGH when the inputs match). */
function XnorGateGlyph() {
  return (
    <svg width={W} height={H}>
      <title>XNOR gate</title>
      <line x1={0} y1={MID - 7} x2={14} y2={MID - 7} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={MID + 7} x2={14} y2={MID + 7} stroke={STROKE} strokeWidth={1.5} />
      <path
        d={`M 12 ${MID - 14} Q 21 ${MID} 12 ${MID + 14}`}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <path
        d={`M 18 ${MID - 14} Q 36 ${MID - 14} 52 ${MID} Q 36 ${MID + 14} 18 ${MID + 14} Q 27 ${MID} 18 ${MID - 14} Z`}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <circle cx={56} cy={MID} r={4} fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={60} y1={MID} x2={80} y2={MID} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** Buffer — the amplifier triangle, no bubble (a non-inverting gate: out follows in). */
function BufferGlyph() {
  return (
    <svg width={W} height={H}>
      <title>buffer</title>
      <line x1={0} y1={MID} x2={20} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      <polygon
        points={`20,${MID - 14} 20,${MID + 14} 50,${MID}`}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <line x1={50} y1={MID} x2={80} y2={MID} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** Darlington pair — an NPN transistor with TWO emitter arrows, the compact mark for two BJTs
 *  cascaded into one very-high-gain composite. Base in from the left, collector up, emitter
 *  down. */
function DarlingtonGlyph() {
  return (
    <svg width={W} height={H}>
      <title>Darlington transistor</title>
      <circle cx={37} cy={MID} r={16} fill="none" stroke={STROKE} strokeWidth={1} />
      <line x1={0} y1={MID} x2={30} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      <line x1={30} y1={12} x2={30} y2={32} stroke={STROKE} strokeWidth={2} />
      {/* collector: bar → up to the top handle */}
      <line x1={30} y1={17} x2={40} y2={8} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={8} x2={40} y2={0} stroke={STROKE} strokeWidth={1.5} />
      {/* two out-pointing emitter arrows — the cascaded pair */}
      <line x1={30} y1={23} x2={40} y2={31} stroke={STROKE} strokeWidth={1.5} />
      <polygon points="40,31 34.6,30 37,26.2" fill={STROKE} stroke={STROKE} strokeWidth={0.5} />
      <line x1={30} y1={28} x2={40} y2={37} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={37} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
      <polygon points="40,37 34.6,36 37,32.2" fill={STROKE} stroke={STROKE} strokeWidth={0.5} />
    </svg>
  )
}

/** Photo-Darlington — the Darlington pair with two incident-light arrows: light is the input
 *  (no base lead), a phototransistor stage driving a second BJT for very high light gain. */
function PhotoDarlingtonGlyph() {
  return (
    <svg width={W} height={H}>
      <title>photo-Darlington</title>
      <circle cx={37} cy={MID} r={16} fill="none" stroke={STROKE} strokeWidth={1} />
      <line x1={30} y1={12} x2={30} y2={32} stroke={STROKE} strokeWidth={2} />
      <line x1={30} y1={17} x2={40} y2={8} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={8} x2={40} y2={0} stroke={STROKE} strokeWidth={1.5} />
      <line x1={30} y1={23} x2={40} y2={31} stroke={STROKE} strokeWidth={1.5} />
      <polygon points="40,31 34.6,30 37,26.2" fill={STROKE} stroke={STROKE} strokeWidth={0.5} />
      <line x1={30} y1={28} x2={40} y2={37} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={37} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
      <polygon points="40,37 34.6,36 37,32.2" fill={STROKE} stroke={STROKE} strokeWidth={0.5} />
      {/* two arrows striking the device — incident light (heads toward the base bar) */}
      <g stroke={STROKE} strokeWidth={1.2}>
        <line x1={4} y1={8} x2={16} y2={17} />
        <polyline points="16,12 16,17 11,17" fill="none" />
        <line x1={10} y1={4} x2={22} y2={13} />
        <polyline points="22,8 22,13 17,13" fill="none" />
      </g>
    </svg>
  )
}

/** N-channel JFET — IEEE 315: a vertical channel (drain top, source bottom) with the gate
 *  arrow pointing INTO the channel (N-channel). A depletion device — on at V_GS = 0. */
function JfetNGlyph() {
  return (
    <svg width={W} height={H}>
      <title>N-channel JFET</title>
      <circle cx={37} cy={MID} r={16} fill="none" stroke={STROKE} strokeWidth={1} />
      <line x1={40} y1={0} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={10} x2={40} y2={34} stroke={STROKE} strokeWidth={2.5} />
      <line x1={0} y1={MID} x2={32} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      <polygon points="40,22 32,18.5 32,25.5" fill={STROKE} stroke={STROKE} strokeWidth={0.5} />
    </svg>
  )
}

/** P-channel JFET — the mirror: the gate arrow points OUT of the channel. */
function JfetPGlyph() {
  return (
    <svg width={W} height={H}>
      <title>P-channel JFET</title>
      <circle cx={37} cy={MID} r={16} fill="none" stroke={STROKE} strokeWidth={1} />
      <line x1={40} y1={0} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={10} x2={40} y2={34} stroke={STROKE} strokeWidth={2.5} />
      <line x1={0} y1={MID} x2={40} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      <polygon points="31,22 39,18.5 39,25.5" fill={STROKE} stroke={STROKE} strokeWidth={0.5} />
    </svg>
  )
}

/** Constant-current diode (current-limiting diode) — the rectifier triangle + cathode bar
 *  with short serifs off the bar ends, the standard current-regulator mark. */
function ConstantCurrentDiodeGlyph() {
  return (
    <svg width={W} height={H}>
      <title>constant-current diode</title>
      {lead(0, 26)}
      <polygon points="26,12 26,32 44,22" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={12} x2={44} y2={32} stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={12} x2={49} y2={12} stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={32} x2={49} y2={32} stroke={STROKE} strokeWidth={1.5} />
      {lead(44, W)}
    </svg>
  )
}

/** Adder — a labelled IC block with a '+' inside; the palette face for the half and full
 *  adders (on the canvas they are blocks showing their names). */
function AdderGlyph() {
  return (
    <svg width={W} height={H}>
      <title>adder</title>
      <line x1={0} y1={MID - 8} x2={22} y2={MID - 8} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={MID + 8} x2={22} y2={MID + 8} stroke={STROKE} strokeWidth={1.5} />
      <rect
        x={22}
        y={MID - 16}
        width={36}
        height={32}
        rx={3}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <line x1={40} y1={MID - 8} x2={40} y2={MID + 8} stroke={STROKE} strokeWidth={1.5} />
      <line x1={32} y1={MID} x2={48} y2={MID} stroke={STROKE} strokeWidth={1.5} />
      <line x1={58} y1={MID} x2={80} y2={MID} stroke={STROKE} strokeWidth={1.5} />
    </svg>
  )
}

/** Latch — an IC block with two inputs and two outputs (the cross-coupled pair inside); the
 *  palette face for the SR latch. On the canvas it is a block showing its name. */
function LatchGlyph() {
  return (
    <svg width={W} height={H}>
      <title>latch</title>
      <line x1={0} y1={MID - 8} x2={24} y2={MID - 8} stroke={STROKE} strokeWidth={1.5} />
      <line x1={0} y1={MID + 8} x2={24} y2={MID + 8} stroke={STROKE} strokeWidth={1.5} />
      <rect
        x={24}
        y={MID - 16}
        width={32}
        height={32}
        rx={3}
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
      />
      <line x1={56} y1={MID - 8} x2={80} y2={MID - 8} stroke={STROKE} strokeWidth={1.5} />
      <line x1={56} y1={MID + 8} x2={80} y2={MID + 8} stroke={STROKE} strokeWidth={1.5} />
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

/** Photodiode — a diode struck by two arrows (light received, like the LDR). Its
 *  reverse photocurrent flows cathode→anode; normally reverse-biased. */
function PhotodiodeGlyph() {
  return (
    <svg width={W} height={H}>
      <title>photodiode</title>
      {lead(0, 26)}
      <polygon points="26,12 26,32 44,22" fill="none" stroke={STROKE} strokeWidth={1.5} />
      <line x1={44} y1={12} x2={44} y2={32} stroke={STROKE} strokeWidth={1.5} />
      {lead(44, W)}
      <g stroke={STROKE} strokeWidth={1.2}>
        <line x1={20} y1={2} x2={29} y2={11} />
        <polyline points="29,6 29,11 24,11" fill="none" />
        <line x1={30} y1={2} x2={39} y2={11} />
        <polyline points="39,6 39,11 34,11" fill="none" />
      </g>
    </svg>
  )
}

/** Phototransistor — an NPN struck by light at its base (NO base lead — the base
 *  IS the light input). Collector top, emitter bottom with the NPN out-arrow. */
function PhototransistorGlyph() {
  return (
    <svg width={W} height={H}>
      <title>phototransistor</title>
      <circle cx={37} cy={MID} r={15} fill="none" stroke={STROKE} strokeWidth={1} />
      <line x1={32} y1={13} x2={32} y2={31} stroke={STROKE} strokeWidth={2} />
      <line x1={32} y1={18} x2={40} y2={8} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={8} x2={40} y2={0} stroke={STROKE} strokeWidth={1.5} />
      <line x1={32} y1={26} x2={40} y2={36} stroke={STROKE} strokeWidth={1.5} />
      <line x1={40} y1={36} x2={40} y2={44} stroke={STROKE} strokeWidth={1.5} />
      <polygon points="40,36 34.5,34 37.5,30" fill={STROKE} stroke={STROKE} strokeWidth={0.5} />
      {/* light striking the base from the left */}
      <g stroke={STROKE} strokeWidth={1.2}>
        <line x1={6} y1={16} x2={18} y2={16} />
        <polyline points="14,13 18,16 14,19" fill="none" />
        <line x1={6} y1={28} x2={18} y2={28} />
        <polyline points="14,25 18,28 14,31" fill="none" />
      </g>
    </svg>
  )
}

// switch_spst_toggle is intentionally absent — DeviceGlyph renders it specially
// (it needs the open/closed state, unlike these stateless one-shot glyphs).
const GLYPHS: Record<string, () => React.JSX.Element> = {
  resistor: ResistorGlyph,
  thermistor: ThermistorGlyph,
  photoresistor: PhotoresistorGlyph,
  photodiode: PhotodiodeGlyph,
  phototransistor: PhototransistorGlyph,
  light_source: LightSourceGlyph,
  capacitor: CapacitorGlyph,
  inductor: InductorGlyph,
  electromagnet: ElectromagnetGlyph,
  dc_motor: MotorGlyph,
  generator: GeneratorGlyph,
  alternator: AlternatorGlyph,
  alternator_three_phase: ThreePhaseAlternatorGlyph,
  induction_motor: InductionMotorGlyph,
  transmission_line: TransmissionLineGlyph,
  led: LedGlyph,
  arc_lamp: ArcLampGlyph,
  neon_lamp: NeonLampGlyph,
  crt: CrtGlyph,
  led_uv_algan: LedGlyph,
  incandescent_bulb: IncandescentBulbGlyph,
  diode_laser: LaserDiodeGlyph,
  diode_tunnel: TunnelDiodeGlyph,
  diode_shockley: ShockleyDiodeGlyph,
  diode_varactor: VaractorGlyph,
  scr: ScrGlyph,
  diode_silicon_rectifier: DiodeGlyph,
  diode_schottky_al_si: SchottkyGlyph,
  diode_zener_silicon: ZenerGlyph,
  diode_constant_current: ConstantCurrentDiodeGlyph,
  vacuum_diode: VacuumDiodeGlyph,
  triode: VacuumTriodeGlyph,
  tetrode: TetrodeGlyph,
  pentode: PentodeGlyph,
  ground: GroundGlyph,
  wire: WireGlyph,
  transistor_bjt_npn: BjtNpnGlyph,
  transistor_bjt_pnp: BjtPnpGlyph,
  darlington_npn: DarlingtonGlyph,
  photo_darlington: PhotoDarlingtonGlyph,
  transistor_mosfet_nmos: MosfetNmosGlyph,
  transistor_mosfet_pmos: MosfetPmosGlyph,
  transistor_jfet_n_channel: JfetNGlyph,
  transistor_jfet_p_channel: JfetPGlyph,
  op_amp: OpAmpGlyph,
  vccs: VccsGlyph,
  cccs: CccsGlyph,
  logic_not: NotGateGlyph,
  logic_nand: NandGateGlyph,
  logic_nor: NorGateGlyph,
  logic_and: AndGateGlyph,
  logic_or: OrGateGlyph,
  logic_xor: XorGateGlyph,
  logic_xnor: XnorGateGlyph,
  logic_buffer: BufferGlyph,
  logic_half_adder: AdderGlyph,
  logic_full_adder: AdderGlyph,
  logic_adder_2bit: AdderGlyph,
  logic_adder_4bit: AdderGlyph,
  logic_sr_latch: LatchGlyph,
  logic_d_latch: LatchGlyph,
  logic_d_flipflop: LatchGlyph,
  logic_register_4bit: LatchGlyph,
  logic_register_bcd: LatchGlyph,
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
  thermistor: TWO('terminal_a', 'terminal_b'),
  incandescent_bulb: TWO('terminal_a', 'terminal_b'),
  photoresistor: TWO('terminal_a', 'terminal_b'),
  // Photodiode: a polar diode (anode left, cathode right). Phototransistor: an
  // NPN with the base as its light input, so just collector (top) + emitter (bottom).
  photodiode: TWO('anode', 'cathode'),
  phototransistor: [
    { id: 'collector', position: Position.Top },
    { id: 'emitter', position: Position.Bottom },
  ],
  // A light source is environmental — no electrical terminals to wire.
  light_source: [],
  capacitor: TWO('terminal_a', 'terminal_b'),
  inductor: TWO('terminal_a', 'terminal_b'),
  electromagnet: TWO('terminal_a', 'terminal_b'),
  dc_motor: TWO('terminal_positive', 'terminal_negative'),
  generator: TWO('terminal_positive', 'terminal_negative'),
  alternator: TWO('terminal_positive', 'terminal_negative'),
  // Three-phase alternator: the three phase leads spread down the right side (A top → C bottom),
  // the wye neutral out of the left — wire loads phase → neutral (single-phase taps) or phase →
  // phase (line-to-line).
  alternator_three_phase: [
    { id: 'neutral', position: Position.Left },
    { id: 'phase_a', position: Position.Right, offset: 8 },
    { id: 'phase_b', position: Position.Right, offset: 22 },
    { id: 'phase_c', position: Position.Right, offset: 36 },
  ],
  induction_motor: TWO('terminal_a', 'terminal_b'),
  arc_lamp: TWO('anode', 'cathode'),
  neon_lamp: TWO('anode', 'cathode'),
  // A CRT: the electron gun (cathode + anode) on the left, the X/Y deflection inputs on the right.
  crt: [
    // Spread down the screen's two side edges (the CRT renders as a 124×88 screen, not the 80×44 box).
    { id: 'cathode', position: Position.Left, offset: 24 },
    { id: 'anode', position: Position.Left, offset: 62 },
    { id: 'x_deflect', position: Position.Right, offset: 24 },
    { id: 'y_deflect', position: Position.Right, offset: 62 },
    // The grid (video / Z-axis) enters from the bottom — the TV's brightness/video input.
    { id: 'grid', position: Position.Bottom, offset: 62 },
  ],
  // A transmission line: the near pair on the left, the far pair on the right.
  transmission_line: [
    { id: 'near_a', position: Position.Left, offset: 14 },
    { id: 'near_b', position: Position.Left, offset: 30 },
    { id: 'far_a', position: Position.Right, offset: 14 },
    { id: 'far_b', position: Position.Right, offset: 30 },
  ],
  power_source: TWO('terminal_positive', 'terminal_negative'),
  // Dependent sources — control sense on the left (offsets 14/30), the controlled output on the
  // right (14/30): a 4-terminal part you wire the control across (VCCS) or in series with (CCCS).
  vccs: [
    { id: 'control_positive', position: Position.Left, offset: 14 },
    { id: 'control_negative', position: Position.Left, offset: 30 },
    { id: 'output_positive', position: Position.Right, offset: 14 },
    { id: 'output_negative', position: Position.Right, offset: 30 },
  ],
  cccs: [
    { id: 'control_positive', position: Position.Left, offset: 14 },
    { id: 'control_negative', position: Position.Left, offset: 30 },
    { id: 'output_positive', position: Position.Right, offset: 14 },
    { id: 'output_negative', position: Position.Right, offset: 30 },
  ],
  led: TWO('anode', 'cathode'),
  led_uv_algan: TWO('anode', 'cathode'),
  diode_laser: TWO('anode', 'cathode'),
  diode_tunnel: TWO('anode', 'cathode'),
  diode_shockley: TWO('anode', 'cathode'),
  diode_varactor: TWO('anode', 'cathode'),
  scr: [
    { id: 'anode', position: Position.Left },
    { id: 'cathode', position: Position.Right },
    { id: 'gate', position: Position.Bottom },
  ],
  diode_silicon_rectifier: TWO('anode', 'cathode'),
  diode_schottky_al_si: TWO('anode', 'cathode'),
  diode_zener_silicon: TWO('anode', 'cathode'),
  diode_constant_current: TWO('anode', 'cathode'),
  // Vacuum diode: plate (anode) up top, the heated cathode below — a vertical valve.
  vacuum_diode: [
    { id: 'plate', position: Position.Top },
    { id: 'cathode', position: Position.Bottom },
  ],
  // Triode: plate up top, the control grid in from the left, the cathode below.
  triode: [
    { id: 'plate', position: Position.Top },
    { id: 'grid', position: Position.Left },
    { id: 'cathode', position: Position.Bottom },
  ],
  // Tetrode: plate up top, control grid (g1) from the left, screen grid (g2) from the
  // right, cathode below — the offsets line the side handles up with the two grids.
  tetrode: [
    { id: 'plate', position: Position.Top },
    { id: 'grid', position: Position.Left, offset: 26 },
    { id: 'screen_grid', position: Position.Right, offset: 17 },
    { id: 'cathode', position: Position.Bottom },
  ],
  // Pentode: three grids — control (g1) + suppressor (g3) out the left, screen (g2) out
  // the right — between plate (top) and cathode (bottom), offsets matching the glyph.
  pentode: [
    { id: 'plate', position: Position.Top },
    { id: 'suppressor_grid', position: Position.Left, offset: 13 },
    { id: 'screen_grid', position: Position.Right, offset: 20 },
    { id: 'grid', position: Position.Left, offset: 27 },
    { id: 'cathode', position: Position.Bottom },
  ],
  switch_spst_toggle: TWO('terminal_in', 'terminal_out'),
  switch_spst_momentary: TWO('terminal_in', 'terminal_out'),
  switch_spdt: [
    { id: 'common', position: Position.Left, offset: 22 },
    { id: 'throw_a', position: Position.Right, offset: 12 },
    { id: 'throw_b', position: Position.Right, offset: 32 },
  ],
  // The wiper taps the track from the top; the two ends span the full track.
  potentiometer: [
    { id: 'terminal_a', position: Position.Left },
    { id: 'wiper', position: Position.Top },
    { id: 'terminal_b', position: Position.Right },
  ],
  fuse: TWO('terminal_a', 'terminal_b'),
  // Coil on the left, the SPDT contact on the right/top/bottom.
  relay: [
    { id: 'coil_a', position: Position.Left, offset: 13 },
    { id: 'coil_b', position: Position.Left, offset: 31 },
    { id: 'common', position: Position.Right, offset: 22 },
    { id: 'normally_open', position: Position.Top },
    { id: 'normally_closed', position: Position.Bottom },
  ],
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
  transistor_jfet_n_channel: [
    { id: 'gate', position: Position.Left },
    { id: 'drain', position: Position.Top },
    { id: 'source', position: Position.Bottom },
  ],
  transistor_jfet_p_channel: [
    { id: 'gate', position: Position.Left },
    { id: 'drain', position: Position.Top },
    { id: 'source', position: Position.Bottom },
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
  // The tag sits up top; its single terminal hangs below on the stalk, where a wire joins it.
  net_label: [{ id: 'reference_terminal', position: Position.Bottom }],
}
const FALLBACK_TERMINALS = TWO('terminal_a', 'terminal_b')

/**
 * Polarity marker drawn at a terminal's handle, ONLY for parts that wear a +/− marking IN REAL LIFE:
 * a battery / supply / motor (its marked + and − terminals) and the polarized aluminum electrolytic
 * capacitor. Every other part shows its polarity through the SYMBOL itself — a diode's bar, an LED's
 * flat, a vacuum tube's named electrodes (plate / grid / cathode), an SCR's anode/cathode — so it gets
 * NO +/− label, exactly as the real component is unmarked. (Marking anode/cathode/plate put a stray,
 * sometimes mispositioned +/− on parts that never carry one.)
 */
const TERMINAL_POLARITY: Record<string, '+' | '−'> = {
  terminal_positive: '+',
  terminal_negative: '−',
}

/**
 * Polarity for a terminal on a specific device. The global map covers the named +/− terminals
 * (terminal_positive / terminal_negative — a battery / supply / motor). The aluminum electrolytic
 * capacitor is polarized per-device: its terminal_a is the + lead and terminal_b the − (reversing one
 * is a real failure mode, checked by the failure detector).
 */
function polarityOf(definition: string, terminalId: string): '+' | '−' | undefined {
  if (definition === 'capacitor') {
    if (terminalId === 'terminal_a') return '+'
    if (terminalId === 'terminal_b') return '−'
  }
  // An alternator's output ALTERNATES — its terminal names reuse the machine family's
  // positive/negative, but a real AC generator wears no +/− markings (the real-markings rule).
  if (definition === 'alternator') return undefined
  return TERMINAL_POLARITY[terminalId]
}

/** The source circle's geometry — shared by the glyph, taps, and stubs. */
const SOURCE_CX = 40
const SOURCE_R = 14
/** Tap leads sit a short stub OUTSIDE the rim, on the circle's lower arc. */
const SOURCE_TAP_R = 21

/**
 * The terminals (handle id + side + optional placement) for a device
 * definition. `offset` is vertical px for a Left/Right handle; `at` is an
 * exact point in the node box. A source's set is DYNAMIC (S19-v3-74): its
 * Properties choose 1–6 leads — + on the left, − on the right, and taps
 * popping out radially around the circle's lower rim, tap_1 nearest the +
 * and sweeping toward the − in stack order.
 */
export function terminalsOf(
  definition: string,
  parameters?: Parameters,
): { id: string; position: Position; offset?: number; at?: { x: number; y: number } }[] {
  // Annotations (text, box, line, rect, circle) are pure drawings — no terminals, nothing to wire to.
  if (ANNOTATION_DEFINITIONS.has(definition)) return []
  if (definition === 'power_source') {
    const count = sourceTerminalCount(parameters)
    if (count === 1) return [{ id: 'terminal_positive', position: Position.Left }]
    if (count > 2) {
      const tapCount = count - 2
      const taps = Array.from({ length: tapCount }, (_, i) => {
        // Sweep the lower arc from the + side (180°) toward the − side (0°),
        // evenly spaced — y grows downward in SVG, so sin > 0 is the bottom.
        const angle = (Math.PI * (tapCount - i)) / (tapCount + 1)
        return {
          id: `tap_${i + 1}`,
          position: Position.Bottom,
          at: {
            x: SOURCE_CX + SOURCE_TAP_R * Math.cos(angle),
            y: MID + SOURCE_TAP_R * Math.sin(angle),
          },
        }
      })
      return [
        { id: 'terminal_positive', position: Position.Left },
        ...taps,
        { id: 'terminal_negative', position: Position.Right },
      ]
    }
  }
  // A user-authored part draws its terminals from its pin spec (a labelled box), not a hardcoded map.
  const userPart = getUserPart(definition)
  if (userPart !== undefined) return userPartTerminals(userPart)
  return TERMINALS[definition] ?? FALLBACK_TERMINALS
}

/** Simulation fidelity for a block (the complexity-layer system). 'transistor' = the full analog
 *  per-MOSFET solve (default); 'logic' = the fast 0/1 logic engine. A generated 'behaviour' model is a
 *  later layer. The block is the SAME circuit either way — this only picks how detailed the math runs. */
export type Fidelity = 'transistor' | 'logic' | 'behaviour'

export type DeviceNodeData = {
  definition: string
  label: string
  rotation?: number
  parameters?: Parameters
  /** The physical package the user chose for this part on the board (a footprint id, e.g. an 0805 or a
   *  TO-92). Absent ⇒ the part's default footprint. Validated against the part's options on use. */
  footprintId?: string
  /** Which engine simulates this block; absent ⇒ 'transistor'. */
  fidelity?: Fidelity
  /** Calculator keypad button: the key this switch types ('0'..'9', '+', '-', '*', '/', '=', 'C', '±').
   *  Clicking the switch feeds this key to the calculator's control unit. */
  calcKey?: string
}

// A user-authored part's electrical roles that get a filled pin dot (a source of drive), vs the hollow
// dot every passive/input/bidirectional pin wears — a subtle read of which pins push current out.
const DRIVING_PINS: ReadonlySet<PinElectrical> = new Set(['output', 'power_out'])

/**
 * A user-authored part's symbol — a labelled box with a pin stub + name at each pin, drawn straight
 * from its pin spec (userPartGeometry). No hand-coded picture: a part that isn't in the code still
 * renders here, and because the glyph and the wire handles (userPartTerminals) read the SAME geometry
 * in the SAME node-box coordinate space, every handle lands exactly on its drawn pin tip.
 */
export function UserPartGlyph({ part }: { part: UserPart }) {
  const { width, height, body, pins } = userPartGeometry(part)
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <rect
        x={body.x}
        y={body.y}
        width={body.width}
        height={body.height}
        rx={3}
        fill={THEME.surfaceRaised}
        stroke={STROKE}
        strokeWidth={1.6}
      />
      <text
        x={body.x + body.width / 2}
        y={body.y + body.height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={12}
        fontFamily="system-ui, sans-serif"
        fontWeight={600}
        fill={STROKE}
        // Squeeze an over-long name to fit the body (never stretch a short one) so it can't spill past
        // the box — the box-width heuristic can under-guess a wide all-caps name.
        {...(part.name.length * 8 > body.width - 12
          ? { textLength: body.width - 12, lengthAdjust: 'spacingAndGlyphs' as const }
          : {})}
      >
        {part.name}
      </text>
      {pins.map((p) => {
        // The name label tucks just INSIDE the body next to the pin root.
        const label =
          p.side === 'left'
            ? { x: p.rootX + 4, y: p.rootY, anchor: 'start' as const }
            : p.side === 'right'
              ? { x: p.rootX - 4, y: p.rootY, anchor: 'end' as const }
              : p.side === 'top'
                ? { x: p.rootX, y: p.rootY + 9, anchor: 'middle' as const }
                : { x: p.rootX, y: p.rootY - 9, anchor: 'middle' as const }
        const driving = DRIVING_PINS.has(p.electrical)
        return (
          <Fragment key={p.id}>
            <line
              x1={p.rootX}
              y1={p.rootY}
              x2={p.tipX}
              y2={p.tipY}
              stroke={STROKE}
              strokeWidth={1.4}
            />
            <circle
              cx={p.tipX}
              cy={p.tipY}
              r={2.4}
              fill={driving ? STROKE : THEME.surfaceRaised}
              stroke={STROKE}
              strokeWidth={1.2}
            />
            {p.name && (
              <text
                x={label.x}
                y={label.y}
                textAnchor={label.anchor}
                dominantBaseline="central"
                fontSize={9}
                fontFamily="system-ui, sans-serif"
                fill={THEME.textFaint}
              >
                {p.name}
              </text>
            )}
          </Fragment>
        )
      })}
    </svg>
  )
}

/**
 * The bare schematic symbol for a device definition (or a labeled fallback box
 * for kinds without a symbol yet), with no handles — shared by the canvas node
 * and the parts palette so both draw a part the same way.
 */
export function DeviceGlyph({
  definition,
  parameters,
  rotation = 0,
}: {
  definition: string
  parameters?: Parameters
  /** The node's rotation — source circles counter-rotate their inner mark. */
  rotation?: number
}) {
  // The text note is an annotation, not a device: its glyph IS its text (multi-line), edited via
  // the note_text parameter in the Properties panel — the same string-parameter plumbing the net
  // label's name uses, so saving/copying/undo all just work.
  if (definition === 'text_note' || definition === 'text_box') {
    return (
      <div
        style={{
          // Size to the text itself (the device-node wrapper would otherwise squeeze it to symbol width).
          width: 'max-content',
          minWidth: 40,
          maxWidth: 420,
          padding: definition === 'text_box' ? '5px 9px' : '2px 6px',
          whiteSpace: 'pre-wrap',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
          lineHeight: 1.35,
          color: STROKE,
          textAlign: 'left',
          // The text box wears KiCad's frame; the bare note stays frameless.
          ...(definition === 'text_box'
            ? { border: `1.5px solid ${STROKE}`, borderRadius: 2 }
            : {}),
        }}
      >
        {stringValue(parameters, 'note_text') || 'Text'}
      </div>
    )
  }
  // Graphic drawing items (KiCad's line / rectangle / circle) — real millimetres at the drawing
  // sheet's 4-units-per-mm scale. Rotate a line with R like any part.
  if (definition === 'graphic_line') {
    const w = (scalarAmount(parameters, 'length') ?? 40) * 4
    return (
      <svg width={Math.max(8, w)} height={8} aria-hidden="true" style={{ display: 'block' }}>
        <line x1={0} y1={4} x2={w} y2={4} stroke={STROKE} strokeWidth={1.6} />
      </svg>
    )
  }
  if (definition === 'graphic_rect') {
    const w = (scalarAmount(parameters, 'width') ?? 40) * 4
    const h = (scalarAmount(parameters, 'height') ?? 25) * 4
    return (
      <svg width={w} height={h} aria-hidden="true" style={{ display: 'block' }}>
        <rect
          x={1}
          y={1}
          width={w - 2}
          height={h - 2}
          fill="none"
          stroke={STROKE}
          strokeWidth={1.6}
        />
      </svg>
    )
  }
  if (definition === 'graphic_circle') {
    const d = (scalarAmount(parameters, 'diameter') ?? 20) * 4
    return (
      <svg width={d} height={d} aria-hidden="true" style={{ display: 'block' }}>
        <circle cx={d / 2} cy={d / 2} r={d / 2 - 1} fill="none" stroke={STROKE} strokeWidth={1.6} />
      </svg>
    )
  }
  // The switch is state-dependent: render its blade open or closed.
  if (definition === 'switch_spst_toggle') return <SwitchGlyph closed={switchClosed(parameters)} />
  if (definition === 'switch_spst_momentary')
    return <PushButtonGlyph closed={switchClosed(parameters)} />
  if (definition === 'switch_spdt') return <SpdtGlyph onA={spdtOnA(parameters)} />
  // The potentiometer's wiper arrow slides to where the tap sits on the track.
  if (definition === 'potentiometer')
    return <PotentiometerGlyph position={wiperFraction(parameters)} />
  // The fuse is state-dependent: a whole element vs a melted, broken one.
  if (definition === 'fuse') return <FuseGlyph intact={fuseIntact(parameters)} />
  // The relay's arm shows whether the coil is energized (the solve resolves it).
  if (definition === 'relay') return <RelayGlyph energized={relayEnergized(parameters)} />
  // Every source is the same IEC circle; the mark inside says which kind —
  // DC bars or the waveform trace it generates — and stays upright at any rotation.
  if (definition === 'power_source') {
    if (sourceIsAc(parameters)) {
      const shape = sourceWaveform(parameters)
      return shape === 'square' ? (
        <SquareSourceGlyph rotation={rotation} />
      ) : shape === 'triangle' ? (
        <TriangleSourceGlyph rotation={rotation} />
      ) : shape === 'sawtooth' ? (
        <SawtoothSourceGlyph rotation={rotation} />
      ) : shape === 'staircase' ? (
        <StaircaseSourceGlyph rotation={rotation} />
      ) : (
        <AcSourceGlyph rotation={rotation} />
      )
    }
    return <DcSourceGlyph rotation={rotation} />
  }
  // The resistor (IEC mode) paints its real colour-code bands from its resistance + tolerance.
  if (definition === 'resistor') {
    return (
      <ResistorGlyph
        resistanceOhms={scalarAmount(parameters, 'resistance')}
        tolerancePercent={scalarAmount(parameters, 'tolerance_percent')}
      />
    )
  }
  // A net label shows its net name on the tag (the palette preview, with no value, shows the default).
  if (definition === 'net_label') {
    return <NetLabelGlyph name={stringValue(parameters, 'net_name') ?? '+5V'} />
  }
  const Glyph = GLYPHS[definition]
  if (Glyph) return <Glyph />
  // A user-authored part draws its own labelled box from its pin spec (matching terminalsOf's handles),
  // so a definition that isn't hardcoded here still renders instead of falling back to a bare name box.
  const userPart = getUserPart(definition)
  if (userPart !== undefined) return <UserPartGlyph part={userPart} />
  return (
    <div
      style={{
        width: W,
        height: H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${THEME.textFaint}`,
        borderRadius: 4,
        color: STROKE,
        fontSize: 10,
      }}
    >
      {definition}
    </div>
  )
}

const ENERGY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

/**
 * Energy-flow lens halo — gold arrows of energy streaming from the surrounding fields
 * (the Poynting picture): INWARD onto a load (it absorbs energy out of the fields around
 * it, not down the wire) and OUTWARD from a source. More power → bigger, brighter arrows.
 */
function EnergyFlowHalo({ fraction, into }: { fraction: number; into: boolean }) {
  const pad = 24
  const w = W + 2 * pad
  const h = H + 2 * pad
  const cx = w / 2
  const cy = h / 2
  const head = 5
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative energy-flow overlay, hidden from the accessibility tree
    <svg
      aria-hidden
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{
        position: 'absolute',
        inset: -pad,
        pointerEvents: 'none',
        opacity: 0.3 + 0.5 * fraction,
      }}
    >
      {ENERGY_ANGLES.map((deg) => {
        const a = (deg * Math.PI) / 180
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        const pOut = { x: cx + 62 * ca, y: cy + 42 * sa }
        const pIn = { x: cx + 48 * ca, y: cy + 30 * sa }
        const tip = into ? pIn : pOut
        const tail = into ? pOut : pIn
        const dx = tip.x - tail.x
        const dy = tip.y - tail.y
        const len = Math.hypot(dx, dy) || 1
        const ux = (dx / len) * head
        const uy = (dy / len) * head
        const rot = (vx: number, vy: number, ang: number) => ({
          x: vx * Math.cos(ang) - vy * Math.sin(ang),
          y: vx * Math.sin(ang) + vy * Math.cos(ang),
        })
        const b1 = rot(-ux, -uy, 0.5)
        const b2 = rot(-ux, -uy, -0.5)
        return (
          <g key={deg} stroke={ENERGY_COLOR} strokeWidth={1.6} strokeLinecap="round" fill="none">
            <line x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} />
            <line x1={tip.x} y1={tip.y} x2={tip.x + b1.x} y2={tip.y + b1.y} />
            <line x1={tip.x} y1={tip.y} x2={tip.x + b2.x} y2={tip.y + b2.y} />
          </g>
        )
      })}
    </svg>
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
  // A CRT renders as a real phosphor SCREEN on the canvas (not the tiny tube glyph): a wide TV face
  // showing its solved beam locus (crtScreen.trace) + the live spot, read from CrtScreenContext. The
  // 5:2-ish width gives a raster enough horizontal room to resolve text (a row of characters).
  const crtScreen = useContext(CrtScreenContext).get(id)
  const isCrtScreen = definition === 'crt'
  // A user-authored part sizes its box to its own pin-spec geometry, so the fixed W×H symbol box
  // becomes a labelled pin box exactly as wide/tall as the drawn glyph (handles share its space).
  const userPartDef = getUserPart(definition)
  const userGeom = userPartDef ? userPartGeometry(userPartDef) : undefined
  const boxW = isCrtScreen ? 240 : (userGeom?.width ?? W)
  const boxH = isCrtScreen ? 88 : (userGeom?.height ?? H)
  const lensState = useContext(LensContext)
  // Travelling-charge front: dim the part until the wave reaches it, so it lights up in turn
  // (the far bulb last). partArrival is its earliest terminal-arrival time; null = not in front mode.
  const front = useContext(FrontContext)
  const frontArrival = front?.partArrival.get(id)
  const frontDimmed =
    front !== null &&
    (frontArrival === undefined || !Number.isFinite(frontArrival) || front.time < frontArrival)
  // Power lens: halo each part by its REAL dissipated watts (against the
  // circuit's hottest part). Temp lens: by how close its REAL temperature
  // (25 °C + P·θ_JA) sits to its OWN rated maximum — normal until the derating
  // margin, yellow approaching the limit, red over it — so the part actually at
  // fault stands out, not just the relatively-warmest one. Below that margin a
  // faint warmth tint still shows the heat SPREAD (rise vs the hottest part), so a
  // healthy board isn't blank. The number shows under the label either way.
  const watts = lensState.power.get(id)
  const tempC = lensState.temp.get(id)
  const ratingValue = parameters?.max_operating_temperature?.value
  const maxRatingC =
    ratingValue && typeof ratingValue === 'object' && 'amount' in ratingValue
      ? (ratingValue as { amount: number }).amount
      : undefined
  const heat =
    lensState.lens === 'power' && watts !== undefined
      ? powerColor(watts, lensState.pMax)
      : lensState.lens === 'temp' && tempC !== undefined
        ? ((maxRatingC !== undefined
            ? thermalHotspotColor(thermalSeverity(tempC, maxRatingC))
            : null) ?? thermalWarmthTint(tempC, lensState.tMaxC, lensState.ambientC))
        : null
  // Field lens: an electromagnet concentrates a strong field in its core — show that as
  // a field-colored glow scaled toward iron saturation (~2 T). The field is mostly
  // INSIDE the core (the external field is a weak dipole), so this marks where the field
  // concentrates; the exact tesla is in the part reading, not a giant external contour.
  const coilField = lensState.lens === 'field' ? lensState.coilFieldTesla.get(id) : undefined
  const coilFieldFraction = coilField !== undefined ? Math.min(1, coilField / 2.0) : 0
  // Energy-flow lens: the part's power, drawn as energy entering (a load) or leaving (a
  // source) through the surrounding fields — the Poynting picture. Reuses the power map.
  const energyW = lensState.lens === 'energy' ? lensState.power.get(id) : undefined
  const energyFraction =
    energyW !== undefined && lensState.pMax > 0 ? Math.min(1, energyW / lensState.pMax) : 0
  const terminals = terminalsOf(definition, parameters)
  const updateNodeInternals = useUpdateNodeInternals()
  // After a rotation — or a lead-count change (a source's terminals are
  // parameter-driven) — re-measure the handles so wires follow the terminals.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rotation + the terminal count are intentional re-run triggers — the effect must re-measure when they change, though it doesn't read them
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, rotation, terminals.length, updateNodeInternals])
  // The node box IS the glyph (W×H); handles sit on the glyph's lead line
  // (left/right ends at the vertical midline), so a wire connects at the symbol's
  // own drawn terminal — not at an offset box edge. The glyph + handles rotate
  // together; the id label stays upright below the box (never rotates/widens it).
  return (
    <div
      className={health?.failed ? 'cb-shake' : undefined}
      style={{
        position: 'relative',
        width: boxW,
        height: boxH,
        fontFamily: 'system-ui, sans-serif',
        opacity: frontDimmed ? 0.25 : 1,
        transition: 'opacity 0.1s linear',
      }}
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
      {coilField !== undefined ? (
        <div
          aria-hidden
          title={`Magnetic field ${coilField < 1 ? `${(coilField * 1000).toFixed(0)} mT` : `${coilField.toFixed(2)} T`} in the core`}
          style={{
            position: 'absolute',
            inset: -(6 + 22 * coilFieldFraction),
            borderRadius: '50%',
            background: `radial-gradient(circle, ${FIELD_COLOR} 0%, transparent 68%)`,
            opacity: 0.18 + 0.34 * coilFieldFraction,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {energyW !== undefined && energyW > 0 ? (
        <EnergyFlowHalo fraction={energyFraction} into={definition !== 'power_source'} />
      ) : null}
      <div
        style={{
          position: 'relative',
          width: boxW,
          height: boxH,
          transform: `rotate(${rotation}deg)`,
        }}
      >
        {/* One handle per terminal; id = terminal name. connectionMode="loose"
            (App) lets any terminal wire to any terminal. Ground = one top stem. */}
        {terminals.map((t) => {
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
                  background:
                    polarity === '+'
                      ? THEME.statusDanger
                      : polarity === '−'
                        ? THEME.accentBlueDeep
                        : THEME.textMuted,
                  width: polarity ? 9 : undefined,
                  height: polarity ? 9 : undefined,
                  ...(t.at !== undefined
                    ? { left: t.at.x, top: t.at.y, transform: 'translate(-50%, -50%)' }
                    : onSide
                      ? { top: t.offset ?? MID }
                      : t.offset !== undefined
                        ? { left: t.offset }
                        : {}),
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
                    color: polarity === '+' ? THEME.statusDanger : THEME.accentBlueSoft,
                    pointerEvents: 'none',
                  }}
                >
                  {polarity}
                </div>
              ) : null}
            </Fragment>
          )
        })}
        {isCrtScreen ? (
          <CrtScreen
            w={boxW}
            h={boxH}
            spot={crtScreen?.spot ?? { x: 0, y: 0 }}
            brightness={crtScreen?.brightness ?? 0}
            {...(crtScreen?.trace ? { trace: crtScreen.trace } : {})}
          />
        ) : (
          <DeviceGlyph
            definition={definition}
            rotation={rotation}
            {...(parameters ? { parameters } : {})}
          />
        )}
        {/* Tap stubs (S19-v3-74): each tap lead pops radially out of the
            circle's rim to its dot, so the extra terminals read as part of
            the symbol. A 1-lead source marks its hidden return-through-ground. */}
        {definition === 'power_source' && terminals.some((t) => t.at !== undefined) ? (
          // biome-ignore lint/a11y/noSvgWithoutTitle: decorative tap-stub overlay, hidden from the accessibility tree
          <svg
            aria-hidden
            width={W}
            height={H}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            {terminals
              .filter((t) => t.at !== undefined)
              .map((t) => {
                const at = t.at as { x: number; y: number }
                const dx = at.x - SOURCE_CX
                const dy = at.y - MID
                const len = Math.hypot(dx, dy) || 1
                return (
                  <line
                    key={`stub-${t.id}`}
                    x1={SOURCE_CX + (dx / len) * SOURCE_R}
                    y1={MID + (dy / len) * SOURCE_R}
                    x2={at.x}
                    y2={at.y}
                    stroke={STROKE}
                    strokeWidth={1.5}
                  />
                )
              })}
          </svg>
        ) : null}
        {definition === 'power_source' && terminals.length === 1 ? (
          <div
            title="1-lead source: the return path is bonded to the circuit's ground inside"
            style={{
              position: 'absolute',
              right: 2,
              top: MID + 2,
              fontSize: 10,
              color: THEME.textMuted,
              pointerEvents: 'none',
            }}
          >
            ⏚
          </div>
        ) : null}
      </div>
      {/* An annotation is its own drawing — no id caption underneath (it would read as part of it). */}
      {ANNOTATION_DEFINITIONS.has(definition) ? null : (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            color: THEME.textMuted,
            fontSize: 9,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {label}
          {value ? <span style={{ color: THEME.accentBlue, marginLeft: 5 }}>{value}</span> : null}
          {lensState.lens === 'power' && watts !== undefined && watts > 0 ? (
            <span style={{ color: THEME.lensTemp, marginLeft: 5 }}>{formatEng(watts, 'W')}</span>
          ) : null}
          {lensState.lens === 'temp' && tempC !== undefined ? (
            <span style={{ color: THEME.lensTemp, marginLeft: 5 }}>{tempC.toFixed(1)} °C</span>
          ) : null}
          {lensState.lens === 'energy' && energyW !== undefined && energyW > 0 ? (
            <span style={{ color: THEME.lensEnergy, marginLeft: 5 }}>
              {formatEng(energyW, 'W')}
            </span>
          ) : null}
          {lensState.lens === 'field' && coilField !== undefined ? (
            <span style={{ color: THEME.lensField, marginLeft: 5 }}>
              {coilField < 1 ? `${(coilField * 1000).toFixed(0)} mT` : `${coilField.toFixed(2)} T`}
            </span>
          ) : null}
          {health?.failed ? (
            <span title={health.note} style={{ marginLeft: 5 }}>
              💥
            </span>
          ) : null}
        </div>
      )}
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
          background: THEME.textPrimary,
          border: `1px solid ${THEME.textFaint}`,
        }}
      />
    </div>
  )
}

/** A calculator KEYCAP — a real, labeled push-key you click to type. Not part of the solved circuit (no
 *  terminals); clicking it feeds its key to the control unit (App's onNodeClick reads data.calcKey). It is
 *  placed non-draggable so a click presses it instead of moving it. */
function KeycapNode({ data }: NodeProps) {
  const d = data as DeviceNodeData
  const isOp = d.calcKey !== undefined && ['+', '-', '*', '/', '='].includes(d.calcKey)
  return (
    <div
      className="cb-keycap"
      title={`Calculator key ${d.label ?? ''} — click to press`}
      style={{
        width: 60,
        height: 60,
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 28,
        fontWeight: 700,
        lineHeight: 1,
        color: isOp ? THEME.surfaceDeep : THEME.textBright,
        background: isOp ? THEME.accentBlue : THEME.surfaceRaised,
        border: `2px solid ${isOp ? THEME.accentBlueDeep : THEME.borderStrong}`,
        boxShadow: `0 4px 0 ${isOp ? THEME.accentBlueDeep : THEME.borderStrong}`,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {d.label}
    </div>
  )
}

export const nodeTypes = {
  device: DeviceNode,
  junction: JunctionNode,
  block: BlockNode,
  keycap: KeycapNode,
}
