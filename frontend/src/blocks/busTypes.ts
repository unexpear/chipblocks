// Multi-bit bus type system. Implements ADR-001
// (../../../ADR-001-multi-bit-bus-types.md).
//
// Every block port declares a BusType so the renderer can:
//   - Reject incompatible connections at drag time (App.tsx
//     isValidConnection — Sprint 16 S16-2)
//   - Reject malformed graphs at Load time (App.tsx
//     validateLoadedGraph — Sprint 16 S16-5)
//   - Style handles by width (App.css — Sprint 16 S16-3)
//
// This file is the single source of truth for "which bus type does
// node.<type>.<handleId> carry?" — the registry below.
//
// Connection-compatibility rules (per ADR-001 §"Connection rules");
// the helper that implements them lands in Sprint 16 S16-2.

// ---------------------------------------------------------------------------
// BusType enum — 53 members
// ---------------------------------------------------------------------------
//
// Naming convention:
//   <semantic>-<sign?><width>
//
// Generic: data-uN / data-sN / addr-uN
// Semantic: gate-1 / audio-s8 / pixel-u10 (preserved from pre-ADR-001
// implicit conventions)
//
// Address-bus aliases only for practically-useful sizes (4/5/6/8/12/16
// — what real CPUs actually use). Other widths are data-uN.
// Signed-1-bit omitted: -0..0 is just 0; gate-1 covers the 1-bit case.

export type BusType =
  // 1-bit
  | 'gate-1'         // SEMANTIC: gate / clock / sync / pulse / 1-bit color channel
  | 'data-u1'        // GENERIC 1-bit. Compatible with gate-1.

  // 2-bit
  | 'data-u2' | 'data-s2' | 'addr-u2'

  // 3-bit
  | 'data-u3' | 'data-s3' | 'addr-u3'

  // 4-bit (nibble)
  | 'data-u4' | 'data-s4' | 'addr-u4'

  // 5-bit
  | 'data-u5' | 'data-s5' | 'addr-u5'

  // 6-bit
  | 'data-u6' | 'data-s6' | 'addr-u6'

  // 7-bit
  | 'data-u7' | 'data-s7'

  // 8-bit (byte)
  | 'audio-s8'       // SEMANTIC: 8-bit signed audio sample
  | 'data-u8' | 'data-s8' | 'addr-u8'

  // 9-bit (carry-out from 8-bit add)
  | 'data-u9' | 'data-s9'

  // 10-bit
  | 'pixel-u10'      // SEMANTIC: VGA pixel coordinate
  | 'data-u10' | 'data-s10'

  // 11-bit
  | 'data-u11' | 'data-s11'

  // 12-bit (DAC, 4 KB address)
  | 'data-u12' | 'data-s12' | 'addr-u12'

  // 13-bit
  | 'data-u13' | 'data-s13'

  // 14-bit
  | 'data-u14' | 'data-s14'

  // 15-bit
  | 'data-u15' | 'data-s15'

  // 16-bit (word)
  | 'data-u16' | 'data-s16' | 'addr-u16'

// ---------------------------------------------------------------------------
// Width extraction — derived from the BusType string at runtime
// ---------------------------------------------------------------------------
// Used by handle-styling rules (Sprint 16 S16-3) and the compatibility
// helper. Parsing the trailing digits is cheaper than maintaining a
// second BusType -> width table that has to stay in sync with the union.

export function busWidth(t: BusType): number {
  // Trailing digits are the bus width for every BusType in the union.
  const m = t.match(/(\d+)$/)
  if (!m) throw new Error(`BusType missing width: ${t}`)
  return parseInt(m[1], 10)
}

// ---------------------------------------------------------------------------
// BLOCK_PORT_TYPES — single source of truth for every handle's BusType
// ---------------------------------------------------------------------------
// Outer key is the block's React Flow `node.type` (matches the keys in
// frontend/src/blocks/index.ts nodeTypes). Inner key is the React Flow
// `handle.id` string (matches the `id` prop on each <Handle/> element
// in the corresponding *Node.tsx component).
//
// Adding a new block: add an entry here in the same commit that adds
// the .tsx component + the backend block + the registry entries. The
// renderer's validateLoadedGraph (Sprint 16 S16-5) will reject any
// edge referencing a (node.type, handle.id) pair not listed here.

export const BLOCK_PORT_TYPES: Record<string, Record<string, BusType>> = {
  // ─── Audio sources (8 blocks, 1 source handle each) ──────────────
  oscillator:  { 'audio-out': 'audio-s8' },
  triangle:    { 'audio-out': 'audio-s8' },
  sawtooth:    { 'audio-out': 'audio-s8' },
  sine:        { 'audio-out': 'audio-s8' },
  wavetable:   { 'audio-out': 'audio-s8' },
  noise:       { 'audio-out': 'audio-s8' },
  constant:    { 'audio-out': 'audio-s8' },
  fm:          { 'audio-out': 'audio-s8' },

  // ─── Modulation / control ───────────────────────────────────────
  gate:        { 'gate-out':  'gate-1'  },
  adsr:        { 'gate':      'gate-1',
                 'audio-in':  'audio-s8',
                 'audio-out': 'audio-s8' },
  samplehold:  { 'audio-in':  'audio-s8',
                 'clock':     'gate-1',
                 'audio-out': 'audio-s8' },
  multiply:    { 'in-1':      'audio-s8',
                 'in-2':      'audio-s8',
                 'audio-out': 'audio-s8' },

  // ─── Filters ────────────────────────────────────────────────────
  lowpass:     { 'audio-in': 'audio-s8', 'audio-out': 'audio-s8' },
  highpass:    { 'audio-in': 'audio-s8', 'audio-out': 'audio-s8' },
  bandpass:    { 'audio-in': 'audio-s8', 'audio-out': 'audio-s8' },

  // ─── Effects ────────────────────────────────────────────────────
  bitcrusher:  { 'audio-in': 'audio-s8', 'audio-out': 'audio-s8' },
  delay:       { 'audio-in': 'audio-s8', 'audio-out': 'audio-s8' },
  distortion:  { 'audio-in': 'audio-s8', 'audio-out': 'audio-s8' },

  // ─── Logic (boolean gates + clocked counter) ───────────────────
  and:         { 'in-1': 'gate-1', 'in-2': 'gate-1', 'gate-out': 'gate-1' },
  or:          { 'in-1': 'gate-1', 'in-2': 'gate-1', 'gate-out': 'gate-1' },
  xor:         { 'in-1': 'gate-1', 'in-2': 'gate-1', 'gate-out': 'gate-1' },
  not:         { 'gate-in': 'gate-1', 'gate-out': 'gate-1' },
  // Counter is a logic block but exposes two outputs: a centred 8-bit
  // signed audio sample (composes with audio-domain blocks; the original
  // S15 shape) and a raw 4-bit unsigned address (Sprint 17, ADR-002, so
  // the counter can drive RAM/ROM addresses without a bus-conversion
  // chain). The audio-out is a documented semantic crossing — see
  // KNOWN-ISSUES under "Counter outputs audio-out despite being a logic
  // block." Intentional, not a bug.
  counter:     { 'clock':     'gate-1',
                 'audio-out': 'audio-s8',
                 'addr-out':  'addr-u4' },

  // ─── Mixing / routing ──────────────────────────────────────────
  mixer:       { 'in-1': 'audio-s8', 'in-2': 'audio-s8', 'mix-out': 'audio-s8' },
  output:      { 'audio-in': 'audio-s8' },

  // ─── Visual ────────────────────────────────────────────────────
  vgatiming:   { 'hsync':   'gate-1',
                 'vsync':   'gate-1',
                 'visible': 'gate-1',
                 'x':       'pixel-u10',
                 'y':       'pixel-u10' },
  colorbars:   { 'x':       'pixel-u10',
                 'visible': 'gate-1',
                 'r':       'gate-1',
                 'g':       'gate-1',
                 'b':       'gate-1' },
  vgaoutput:   { 'r':     'gate-1',
                 'g':     'gate-1',
                 'b':     'gate-1',
                 'hsync': 'gate-1',
                 'vsync': 'gate-1' },
  pixelrange:  { 'pixel':  'pixel-u10', 'inside': 'gate-1' },
  solidcolor:  { 'r': 'gate-1', 'g': 'gate-1', 'b': 'gate-1' },

  // ─── Bus (cross-width composition — Sprint 16) ─────────────────
  // v0.1 fixes the width at 8 bits; configurable widths are roadmap.
  bussplit:    { 'bus-in': 'data-u8',
                 'bit-0':  'data-u1', 'bit-1':  'data-u1',
                 'bit-2':  'data-u1', 'bit-3':  'data-u1',
                 'bit-4':  'data-u1', 'bit-5':  'data-u1',
                 'bit-6':  'data-u1', 'bit-7':  'data-u1' },
  busjoin:     { 'bit-0':  'data-u1', 'bit-1':  'data-u1',
                 'bit-2':  'data-u1', 'bit-3':  'data-u1',
                 'bit-4':  'data-u1', 'bit-5':  'data-u1',
                 'bit-6':  'data-u1', 'bit-7':  'data-u1',
                 'bus-out': 'data-u8' },

  // ─── Computation / CPU primitives (Sprint 17, ADR-002) ─────────
  // 8-bit unsigned data path + 4-bit unsigned address. Adder's split
  // sum-out/carry-out shape is documented in adder.py (deviation from
  // the ADR's single 9-bit sum-out).
  adder:       { 'in-a':         'data-u8',
                 'in-b':         'data-u8',
                 'sum-out':      'data-u8',
                 'carry-out':    'gate-1' },
  register:    { 'data-in':      'data-u8',
                 'write-enable': 'gate-1',
                 'data-out':     'data-u8' },
  ram:         { 'addr':         'addr-u4',
                 'data-in':      'data-u8',
                 'write-enable': 'gate-1',
                 'data-out':     'data-u8' },
  // Register File: independent read and write addresses (Sprint 20).
  // The architectural distinction from RAM — real CPU instruction sets
  // pick a destination register and one or two source registers from
  // the same file in one cycle.
  registerfile:{ 'read-addr':    'addr-u4',
                 'write-addr':   'addr-u4',
                 'data-in':      'data-u8',
                 'write-enable': 'gate-1',
                 'data-out':     'data-u8' },
  rom:         { 'addr':         'addr-u4',
                 'data-out':     'data-u8' },

  // ─── Computation / branching (Sprint 18) ───────────────────────
  // Subtractor mirrors Adder's split shape (data-u8 diff + gate-1
  // borrow). Comparator emits three flag projections of the same
  // compare. Mux picks between two 8-bit data values per a 1-bit
  // select. All combinational; pair Comparator + Mux for branching
  // without a state machine.
  subtractor:  { 'in-a':         'data-u8',
                 'in-b':         'data-u8',
                 'diff-out':     'data-u8',
                 'borrow-out':   'gate-1' },
  comparator:  { 'in-a':         'data-u8',
                 'in-b':         'data-u8',
                 'eq-out':       'gate-1',
                 'lt-out':       'gate-1',
                 'gt-out':       'gate-1' },
  mux:         { 'in-a':         'data-u8',
                 'in-b':         'data-u8',
                 'select':       'gate-1',
                 'data-out':     'data-u8' },
  // ByteConstant — fixed 8-bit unsigned value (0..255). CPU-domain
  // counterpart to Constant (audio-s8). Useful as a literal in CPU
  // graphs: a single byte hard-wired into the data path.
  byteconstant: { 'data-out':    'data-u8' },

  // ─── Bus (Sprint 18 addition: Reinterpret) ─────────────────────
  // The explicit data-u8 → audio-s8 bridge. Same 8 bits on the wire,
  // different sign interpretation. The validator correctly rejects an
  // implicit cross between sign classes (per ADR-001); this block is
  // the user-flagged "yes, I want that bit-level reinterpretation"
  // escape hatch, counterpart to BusSplit/BusJoin for cross-width
  // composition.
  reinterpret: { 'data-in':      'data-u8',
                 'audio-out':    'audio-s8' },
}

// ---------------------------------------------------------------------------
// Lookup helper
// ---------------------------------------------------------------------------
// Returns undefined if either the block type or the handle id is unknown.
// Callers (isValidConnection, validateLoadedGraph) treat undefined as a
// rejection — bus types must be declared.

export function getPortBusType(
  nodeType: string | undefined,
  handleId: string | null | undefined,
): BusType | undefined {
  if (!nodeType || !handleId) return undefined
  return BLOCK_PORT_TYPES[nodeType]?.[handleId]
}

// ---------------------------------------------------------------------------
// Compatibility helper — implements the connection rules from ADR-001
// ---------------------------------------------------------------------------
//
// Returns:
//   'compatible'     - Edge draws normally. Same name on both sides, OR
//                      generic-to-generic with matching width and sign,
//                      OR the gate-1 ↔ data-u1 special case (both are
//                      1-bit unsigned and functionally interchangeable).
//
//   'semantic-cross' - Edge is allowed but the renderer should style it
//                      dashed (Sprint 16 S16-3). One side is a semantic
//                      type (audio-s8 / pixel-u10) and the other is the
//                      generic equivalent (data-s8 / data-u10) — usually
//                      intentional but worth flagging. Also covers
//                      address-bus aliases: addr-uN ↔ data-uN at the
//                      same width is semantic-cross.
//
//   'incompatible'   - Edge is rejected. Width mismatch, sign mismatch,
//                      or no overlap between the two types' meanings.
//
// React Flow's isValidConnection callback (App.tsx S16-2) treats
// 'incompatible' as a hard reject and surfaces a friendly toast.
// 'compatible' and 'semantic-cross' both let the edge through; the
// visual distinction lands in S16-3.

export type CompatResult = 'compatible' | 'semantic-cross' | 'incompatible'

// Sign extraction. Used internally to compare two BusTypes.
//   gate-1 -> 'g' (1-bit gate; functionally unsigned but tagged distinctly)
//   data-uN / pixel-u10 / addr-uN -> 'u'
//   data-sN / audio-s8 -> 's'
function busSign(t: BusType): 'g' | 'u' | 's' {
  if (t === 'gate-1') return 'g'
  // The character before the trailing digits is the sign marker.
  const m = t.match(/([usg])(\d+)$/)
  if (!m) throw new Error(`BusType missing sign: ${t}`)
  const ch = m[1]
  return ch === 's' ? 's' : 'u'
}

// Is this a semantic (domain-tagged) type, or a generic data/addr/gate?
function isSemantic(t: BusType): boolean {
  return t === 'gate-1' || t === 'audio-s8' || t === 'pixel-u10'
}

export function arePortTypesCompatible(source: BusType, target: BusType): CompatResult {
  if (source === target) return 'compatible'

  // gate-1 ↔ data-u1 special case: both are 1-bit unsigned and
  // functionally interchangeable. Treat as fully compatible (not
  // semantic-cross — the gate semantic doesn't add information at
  // 1-bit beyond what data-u1 already carries).
  if (
    (source === 'gate-1' && target === 'data-u1') ||
    (source === 'data-u1' && target === 'gate-1')
  ) {
    return 'compatible'
  }

  // Width mismatch is always incompatible. Use BusSplit / BusJoin.
  if (busWidth(source) !== busWidth(target)) return 'incompatible'

  // Sign-class mismatch is incompatible — different number ranges.
  if (busSign(source) !== busSign(target)) return 'incompatible'

  // Same width + same sign-class. If neither side is semantic, the two
  // generics are interchangeable — clean compatible.
  if (!isSemantic(source) && !isSemantic(target)) return 'compatible'

  // One side is semantic, one is generic. Allowed but flagged so the
  // renderer can dash the edge as a soft "are you sure?" cue.
  return 'semantic-cross'
}
