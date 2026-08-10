/**
 * FPGA fabric — Lattice Nexus (LIFCL): the logic tile's own wiring, and where a clock branch reaches.
 *
 * A FASM file lists only the routing the design SWITCHED ON. That is not all the wiring a logic tile has, and
 * the difference is not cosmetic — without the rest, a lookup table's inputs and a carry chain's links simply
 * are not there and the design comes back as disconnected fragments. Two kinds of wiring are missing from a
 * FASM file and both are supplied here, verbatim from Project Oxide's device database:
 *
 *   FIXED CONNECTIONS (`conns`)      permanent wire-to-wire links with no configuration bit at all — the slice
 *                                    input `JA0_SLICEB` IS the tile wire `JA2`, the carry input of slice B IS
 *                                    the carry output of slice A, and a tile's carry comes in from the tile one
 *                                    column to its WEST (`HFIE0000 <- W1:JFCOUT`).
 *   ALWAYS-ON PIPS (`alwaysOnPips`)  routing multiplexer choices whose bit list is EMPTY, i.e. the choice a
 *                                    blank device already makes. `JF2 <- JF0_SLICEB` needs no bits, so a
 *                                    bitstream that wants it writes nothing and the unpacker prints nothing.
 *                                    Two of them are load-bearing in a way that is easy to miss: `JCE0` and
 *                                    `JLSR0` are tied to `G:VCC`, so an unrouted clock-enable is permanently
 *                                    ENABLED and an unrouted set/reset line is permanently HIGH — which is why
 *                                    a design with no reset still sets `LSRMUX` to invert it.
 *
 * A relative prefix (`W1:`, `E1:`, `N1:` …) names a wire belonging to a neighbouring tile, the same signed tile
 * offset the routing wires use.
 *
 * SOURCE: `prjoxide-db` (github.com/gatecat/prjoxide-db), file `LIFCL/tiletypes/PLC.ron`, released under
 * CC0 1.0 — a dedication to the public domain. `fixtures/oxide-nexus-plc-fabric.json` holds the same two lists
 * extracted verbatim, and a test compares this table against it so a transcription slip cannot pass.
 */

/** One permanent link: `[destination, source]`, in the database's own wire names. */
export type NexusPlcLink = readonly [string, string]

/**
 * Routing choices a blank device already makes, so a bitstream never has to say them.
 *
 * These MUST be applied before the FASM's own pips and MUST lose to them: a mux destination listed here can
 * also be driven by a bit-carrying pip, and when the design switched that pip on it is the one that wins.
 */
export const NEXUS_PLC_ALWAYS_ON_PIPS: readonly NexusPlcLink[] = [
  ['H00L0000', 'WBOUNCE'],
  ['H00L0100', 'WBOUNCE'],
  ['H00R0000', 'EBOUNCE'],
  ['H00R0100', 'EBOUNCE'],
  ['JCE0', 'G:VCC'],
  ['JCE1', 'G:VCC'],
  ['JDI0_DIMUX', 'JM0_DIMUX'],
  ['JDI0_SLICEA', 'JF0_SLICEA'],
  ['JDI0_SLICEB', 'JF0_SLICEB'],
  ['JDI0_SLICEC', 'JF0_SLICEC'],
  ['JDI0_SLICED', 'JF0_SLICED'],
  ['JDI1_DIMUX', 'JM1_DIMUX'],
  ['JDI2_DIMUX', 'JM2_DIMUX'],
  ['JDI3_DIMUX', 'JM3_DIMUX'],
  ['JDI4_DIMUX', 'JM4_DIMUX'],
  ['JDI5_DIMUX', 'JM5_DIMUX'],
  ['JDI6_DIMUX', 'JM6_DIMUX'],
  ['JDI7_DIMUX', 'JM7_DIMUX'],
  ['JDL0_DRMUX', 'JD0_DRMUX'],
  ['JDL1_DRMUX', 'JD1_DRMUX'],
  ['JDL2_DRMUX', 'JD2_DRMUX'],
  ['JDL3_DRMUX', 'JD3_DRMUX'],
  ['JDL4_DRMUX', 'JD4_DRMUX'],
  ['JDL5_DRMUX', 'JD5_DRMUX'],
  ['JDL6_DRMUX', 'JD6_DRMUX'],
  ['JDL7_DRMUX', 'JD7_DRMUX'],
  ['JF0', 'JF0_SLICEA'],
  ['JF2', 'JF0_SLICEB'],
  ['JF4', 'JF0_SLICEC'],
  ['JF6', 'JF0_SLICED'],
  ['JLSR0', 'G:VCC'],
  ['JLSR1', 'G:VCC'],
  ['V00B0000', 'SBOUNCE'],
  ['V00B0100', 'SBOUNCE'],
  ['V00T0000', 'NBOUNCE'],
  ['V00T0100', 'NBOUNCE'],
]

/** Permanent wire-to-wire links inside a `PLC` tile (and to its neighbours), with no configuration bit. */
export const NEXUS_PLC_CONNS: readonly NexusPlcLink[] = [
  ['E1:HFIE0000', 'JFCOUT'],
  ['HFIE0000', 'W1:JFCOUT'],
  ['JA0_SLICEA', 'JA0'],
  ['JA0_SLICEB', 'JA2'],
  ['JA0_SLICEC', 'JA4'],
  ['JA0_SLICED', 'JA6'],
  ['JA1_SLICEA', 'JA1'],
  ['JA1_SLICEB', 'JA3'],
  ['JA1_SLICEC', 'JA5'],
  ['JA1_SLICED', 'JA7'],
  ['JB0_SLICEA', 'JB0'],
  ['JB0_SLICEB', 'JB2'],
  ['JB0_SLICEC', 'JB4'],
  ['JB0_SLICED', 'JB6'],
  ['JB1_SLICEA', 'JB1'],
  ['JB1_SLICEB', 'JB3'],
  ['JB1_SLICEC', 'JB5'],
  ['JB1_SLICED', 'JB7'],
  ['JC0_DRMUX', 'JC0'],
  ['JC0_SLICEA', 'JCOUT0_CDMUX'],
  ['JC0_SLICEB', 'JCOUT2_CDMUX'],
  ['JC0_SLICEC', 'JCOUT4_CDMUX'],
  ['JC0_SLICED', 'JCOUT6_CDMUX'],
  ['JC1_DRMUX', 'JC1'],
  ['JC1_SLICEA', 'JCOUT1_CDMUX'],
  ['JC1_SLICEB', 'JCOUT3_CDMUX'],
  ['JC1_SLICEC', 'JCOUT5_CDMUX'],
  ['JC1_SLICED', 'JCOUT7_CDMUX'],
  ['JC2_DRMUX', 'JC2'],
  ['JC3_DRMUX', 'JC3'],
  ['JC4_DRMUX', 'JC4'],
  ['JC5_DRMUX', 'JC5'],
  ['JC6_DRMUX', 'JC6'],
  ['JC7_DRMUX', 'JC7'],
  ['JCE_SLICEA', 'JCE0'],
  ['JCE_SLICEB', 'JCE0'],
  ['JCE_SLICEC', 'JCE1'],
  ['JCE_SLICED', 'JCE1'],
  ['JCIN0_CDMUX', 'JC0'],
  ['JCIN1_CDMUX', 'JC1'],
  ['JCIN2_CDMUX', 'JC2'],
  ['JCIN3_CDMUX', 'JC3'],
  ['JCIN4_CDMUX', 'JC4'],
  ['JCIN5_CDMUX', 'JC5'],
  ['JCIN6_CDMUX', 'JC6'],
  ['JCIN7_CDMUX', 'JC7'],
  ['JCLK_SLICEA', 'JCLK0'],
  ['JCLK_SLICEB', 'JCLK0'],
  ['JCLK_SLICEC', 'JCLK1'],
  ['JCLK_SLICED', 'JCLK1'],
  ['JCOUT0_CDMUX', 'JCIN0_CDMUX'],
  ['JCOUT1_CDMUX', 'JCIN1_CDMUX'],
  ['JCOUT2_CDMUX', 'JCIN2_CDMUX'],
  ['JCOUT3_CDMUX', 'JCIN3_CDMUX'],
  ['JCOUT4_CDMUX', 'JCIN4_CDMUX'],
  ['JCOUT5_CDMUX', 'JCIN5_CDMUX'],
  ['JCOUT6_CDMUX', 'JCIN6_CDMUX'],
  ['JCOUT7_CDMUX', 'JCIN7_CDMUX'],
  ['JD0_DIMUX', 'JD0'],
  ['JD0_DRMUX', 'JD0'],
  ['JD0_SLICEA', 'JDL0_DRMUX'],
  ['JD0_SLICEB', 'JDL2_DRMUX'],
  ['JD0_SLICEC', 'JDL4_DRMUX'],
  ['JD0_SLICED', 'JDL6_DRMUX'],
  ['JD1_DIMUX', 'JD1'],
  ['JD1_DRMUX', 'JD1'],
  ['JD1_SLICEA', 'JDL1_DRMUX'],
  ['JD1_SLICEB', 'JDL3_DRMUX'],
  ['JD1_SLICEC', 'JDL5_DRMUX'],
  ['JD1_SLICED', 'JDL7_DRMUX'],
  ['JD2_DIMUX', 'JD2'],
  ['JD2_DRMUX', 'JD2'],
  ['JD3_DIMUX', 'JD3'],
  ['JD3_DRMUX', 'JD3'],
  ['JD4_DIMUX', 'JD4'],
  ['JD4_DRMUX', 'JD4'],
  ['JD5_DIMUX', 'JD5'],
  ['JD5_DRMUX', 'JD5'],
  ['JD6_DIMUX', 'JD6'],
  ['JD6_DRMUX', 'JD6'],
  ['JD7_DIMUX', 'JD7'],
  ['JD7_DRMUX', 'JD7'],
  ['JDI1_SLICEA', 'JF1_SLICEA'],
  ['JDI1_SLICEB', 'JF1_SLICEB'],
  ['JDI1_SLICEC', 'JF1_SLICEC'],
  ['JDI1_SLICED', 'JF1_SLICED'],
  ['JF1', 'JF1_SLICEA'],
  ['JF1_DRMUX', 'JF1_SLICEA'],
  ['JF3', 'JF1_SLICEB'],
  ['JF3_DRMUX', 'JF1_SLICEB'],
  ['JF5', 'JF1_SLICEC'],
  ['JF5_DRMUX', 'JF1_SLICEC'],
  ['JF7', 'JF1_SLICED'],
  ['JF7_DRMUX', 'JF1_SLICED'],
  ['JFCIN', 'HFIE0000'],
  ['JFCI_SLICEA', 'JFCIN'],
  ['JFCI_SLICEB', 'JFCO_SLICEA'],
  ['JFCI_SLICEC', 'JFCO_SLICEB'],
  ['JFCI_SLICED', 'JFCO_SLICEC'],
  ['JFCOUT', 'JFCO_SLICED'],
  ['JLSR_SLICEA', 'JLSR0'],
  ['JLSR_SLICEB', 'JLSR0'],
  ['JLSR_SLICEC', 'JLSR1'],
  ['JLSR_SLICED', 'JLSR1'],
  ['JM0_DIMUX', 'JM0'],
  ['JM0_SLICEA', 'JDI0_DIMUX'],
  ['JM0_SLICEB', 'JDI2_DIMUX'],
  ['JM0_SLICEC', 'JDI4_DIMUX'],
  ['JM0_SLICED', 'JDI6_DIMUX'],
  ['JM1_DIMUX', 'JM1'],
  ['JM1_SLICEA', 'JDI1_DIMUX'],
  ['JM1_SLICEB', 'JDI3_DIMUX'],
  ['JM1_SLICEC', 'JDI5_DIMUX'],
  ['JM1_SLICED', 'JDI7_DIMUX'],
  ['JM2_DIMUX', 'JM2'],
  ['JM3_DIMUX', 'JM3'],
  ['JM4_DIMUX', 'JM4'],
  ['JM5_DIMUX', 'JM5'],
  ['JM6_DIMUX', 'JM6'],
  ['JM7_DIMUX', 'JM7'],
  ['JQ0', 'JQ0_SLICEA'],
  ['JQ1', 'JQ1_SLICEA'],
  ['JQ2', 'JQ0_SLICEB'],
  ['JQ3', 'JQ1_SLICEB'],
  ['JQ4', 'JQ0_SLICEC'],
  ['JQ5', 'JQ1_SLICEC'],
  ['JQ6', 'JQ0_SLICED'],
  ['JQ7', 'JQ1_SLICED'],
  ['JSEL_SLICEA', 'JM0'],
  ['JSEL_SLICEB', 'JM2'],
  ['JSEL_SLICEC', 'JM4'],
  ['JSEL_SLICED', 'JM6'],
  ['JWAD0_SLICEA', 'JWADO0_SLICEC'],
  ['JWAD0_SLICEB', 'JWADO0_SLICEC'],
  ['JWAD1_SLICEA', 'JWADO1_SLICEC'],
  ['JWAD1_SLICEB', 'JWADO1_SLICEC'],
  ['JWAD2_SLICEA', 'JWADO2_SLICEC'],
  ['JWAD2_SLICEB', 'JWADO2_SLICEC'],
  ['JWAD3_SLICEA', 'JWADO3_SLICEC'],
  ['JWAD3_SLICEB', 'JWADO3_SLICEC'],
  ['JWCK_SLICEA', 'JWCKO_SLICEC'],
  ['JWCK_SLICEB', 'JWCKO_SLICEC'],
  ['JWDI0_SLICEA', 'JWDO0_SLICEC'],
  ['JWDI0_SLICEB', 'JWDO2_SLICEC'],
  ['JWDI1_SLICEA', 'JWDO1_SLICEC'],
  ['JWDI1_SLICEB', 'JWDO3_SLICEC'],
  ['JWRE_SLICEA', 'JWREO_SLICEC'],
  ['JWRE_SLICEB', 'JWREO_SLICEC'],
]

/**
 * One segment of a LIFCL-40 clock branch: the columns a `BRANCH` wire reaches, and the tap tile that drives it.
 *
 * WHY THIS EXISTS: a clock branch wire is called `HPBX0000` in every tile it touches, all over the die. Reading
 * that name as a chip-wide identity merges clocks that are not the same clock — a two-clock design built through
 * the real toolchain uses `HPBX0000` for BOTH, and tells them apart only by which part of the die they run in.
 *
 * SOURCE: `prjoxide bba-export LIFCL <constids.inc> out.bba`, label `d0_branches` — the device database's own
 * clock-region table, read out with the vendor-side tool rather than guessed. Cross-check: the tap columns below
 * are exactly the columns at which the LIFCL-40 tile grid places its `TAP_PLC` tiles.
 *
 * HONEST LIMIT: only the BRANCH level is pinned. The SPINE and HROW levels above it are in the same database,
 * but the correspondence between their listed columns and the tile grid's `SPINE` tiles rests on one design, so
 * nothing here scopes a spine — see `nexusClockScope`, which stops at the branch.
 */
export type NexusBranchSegment = {
  /** the first column the branch reaches. */
  fromCol: number
  /** the last column the branch reaches. */
  toCol: number
  /** the column of the `TAP_PLC` tile that drives this segment. */
  tapCol: number
  /** which side of that tap tile this segment lies on. */
  tapSide: 'L' | 'R'
}

/**
 * One half of the LIFCL-40 clock network: a horizontal row, and the vertical spines it feeds.
 *
 * WHY THIS EXISTS: scoping a clock to its BRANCH alone is not enough, and the failure runs the OTHER way from
 * the one branches fix. A branch is one row wide, so a single clock driving registers on eleven rows arrives on
 * eleven branches and gets counted as eleven clocks — an ordinary design of any size is misreported. What joins
 * those branches is the spine above them, and what joins two spines is the horizontal row above that.
 *
 * SOURCE: `prjoxide bba-export LIFCL <constids.inc> out.bba`, labels `d0_hrows` / `d0_hr0_sc` / `d0_hr1_sc` —
 * two horizontal rows, at columns 31 and 61, feeding spine columns [13, 37] and [61, 73]. `d0_spines` is a
 * single entry (rows 1 to 55), so one spine covers the whole die height and a spine is named by its COLUMN
 * alone, with no row in its identity.
 *
 * Cross-check, from the vendor's own naming rather than from this table: a LIFCL-40 FASM file calls the spine
 * tile at column 13 `SPINE_L1` and the one at column 37 `SPINE_L0`, and the one at column 62 `SPINE_R0` — the
 * same left/right split, written out by the toolchain. A test asserts the two agree on every fixture.
 *
 * HONEST LIMIT: this is as far up as anything here is scoped. Above a horizontal row sits the trunk
 * (`G__LHPRX4`) and the clock multiplexer, and the wire that joins them to a horizontal row is named
 * differently at each end with no pip in between to say they are one — so a clock spread across BOTH horizontal
 * rows of one half is still counted twice. See `nexusClockScope`.
 */
export type NexusClockHalf = {
  /** the side of the die, as the vendor's own `SPINE_L*` / `SPINE_R*` tile names write it. */
  side: 'L' | 'R'
  /** the column of the horizontal row that feeds this half's spines. */
  hrowCol: number
  /** the columns of the spines that horizontal row feeds. */
  spineCols: readonly number[]
}

/** The two halves of the LIFCL-40 clock network. */
export const LIFCL40_CLOCK_HALVES: readonly NexusClockHalf[] = [
  { side: 'L', hrowCol: 31, spineCols: [13, 37] },
  { side: 'R', hrowCol: 61, spineCols: [61, 73] },
]

/** The LIFCL-40 clock branch segments, left to right. */
export const LIFCL40_BRANCH_SEGMENTS: readonly NexusBranchSegment[] = [
  { fromCol: 1, toCol: 13, tapCol: 14, tapSide: 'L' },
  { fromCol: 14, toCol: 25, tapCol: 14, tapSide: 'R' },
  { fromCol: 26, toCol: 37, tapCol: 38, tapSide: 'L' },
  { fromCol: 38, toCol: 49, tapCol: 38, tapSide: 'R' },
  { fromCol: 50, toCol: 61, tapCol: 62, tapSide: 'L' },
  { fromCol: 62, toCol: 73, tapCol: 62, tapSide: 'R' },
  { fromCol: 74, toCol: 86, tapCol: 74, tapSide: 'R' },
]
