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
  // Counter is a logic block but its output is multi-bit (centred 8-bit
  // signed audio) so it composes with audio-domain blocks. Documented in
  // KNOWN-ISSUES under "Counter outputs audio-out despite being a logic
  // block — semantic crossing." Intentional, not a bug.
  counter:     { 'clock': 'gate-1', 'audio-out': 'audio-s8' },

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
