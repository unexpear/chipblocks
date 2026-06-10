/**
 * Keyboard shortcuts (S19-v3-62) — one place that DEFINES every binding, so
 * the Shortcuts panel can show everything and the user can change anything.
 *
 *  - Rebindable actions live in `Keybinds` (a flat action → key-combo map).
 *    Canvas keys may be bare ('R'); menu accelerators must carry a modifier
 *    (a bare-letter global accelerator would steal that letter from typing).
 *  - Fixed mouse/tool gestures are listed in FIXED_CONTROLS so the panel is
 *    COMPLETE — every control in the app appears there, changeable or not.
 *  - Pure functions only (normalizing, matching, validating) — unit-tested;
 *    the Electron main process imports the same module for menu accelerators.
 */

export type KeybindAction =
  | 'rotate'
  | 'delete'
  | 'deleteAlt'
  | 'cancelWire'
  | 'selectAll'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'openCircuit'
  | 'saveCircuit'
  | 'saveCircuitAs'
  | 'shortcutsPanel'

export type Keybinds = Record<KeybindAction, string>

export const DEFAULT_KEYBINDS: Keybinds = {
  rotate: 'R',
  delete: 'Delete',
  deleteAlt: 'Backspace',
  cancelWire: 'Escape',
  selectAll: 'Ctrl+Shift+A',
  copy: 'Ctrl+C',
  cut: 'Ctrl+X',
  paste: 'Ctrl+V',
  openCircuit: 'Ctrl+O',
  saveCircuit: 'Ctrl+S',
  saveCircuitAs: 'Ctrl+Shift+S',
  shortcutsPanel: 'Ctrl+K',
}

export const KEYBIND_LABELS: Record<KeybindAction, string> = {
  rotate: 'Rotate the selected part 90°',
  delete: 'Delete the selected part or wire',
  deleteAlt: 'Delete (second key)',
  cancelWire: 'Abandon the wire being drawn',
  selectAll: 'Select every part on the canvas (then Group can block them)',
  copy: 'Copy the selected parts (the clipboard keeps the last 15 copies)',
  cut: 'Cut the selected parts (one cut at a time — pasting brings them back)',
  paste: 'Paste the newest clipboard item at the mouse position',
  openCircuit: 'Open a circuit file',
  saveCircuit: 'Save the circuit',
  saveCircuitAs: 'Save the circuit as…',
  shortcutsPanel: 'Open this shortcuts panel',
}

/** Menu accelerators fire app-wide, so they must carry Ctrl or Alt. */
export const MENU_ACTIONS: ReadonlySet<KeybindAction> = new Set([
  'openCircuit',
  'saveCircuit',
  'saveCircuitAs',
  'shortcutsPanel',
])

const ACTIONS = Object.keys(DEFAULT_KEYBINDS) as KeybindAction[]

/** A keyboard event (or its shape) → our 'Ctrl+Shift+S' style combo string. */
export function bindingFromEvent(event: {
  key: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}): string | null {
  const key = normalizeKey(event.key)
  if (key === null) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

/** Pure-modifier presses (Ctrl alone, …) are not a binding. */
function normalizeKey(raw: string): string | null {
  if (raw === 'Control' || raw === 'Shift' || raw === 'Alt' || raw === 'Meta') return null
  if (raw === ' ') return 'Space'
  if (raw.length === 1) return raw.toUpperCase()
  return raw // named keys: Delete, Escape, Backspace, F2, ArrowUp, …
}

/** Does a live keyboard event match a stored combo string? */
export function eventMatchesBinding(
  event: { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean },
  binding: string,
): boolean {
  const pressed = bindingFromEvent(event)
  return pressed !== null && pressed === binding
}

/**
 * Saved keybinds (from disk / IPC, shape unknown) → a complete, valid map.
 * Unknown actions are dropped, missing or invalid entries fall back to the
 * default — a broken file degrades honestly instead of breaking input.
 */
export function mergeKeybinds(saved: unknown): Keybinds {
  const merged: Keybinds = { ...DEFAULT_KEYBINDS }
  if (typeof saved !== 'object' || saved === null) return merged
  const record = saved as Record<string, unknown>
  for (const action of ACTIONS) {
    const value = record[action]
    if (typeof value === 'string' && value.length > 0) merged[action] = value
  }
  return merged
}

/**
 * Why a proposed binding for an action is not allowed (null = fine):
 * menu accelerators need a modifier; no two actions may share a combo.
 */
export function bindingProblem(
  binds: Keybinds,
  action: KeybindAction,
  combo: string,
): string | null {
  if (MENU_ACTIONS.has(action) && !combo.includes('Ctrl') && !combo.includes('Alt')) {
    return 'Menu shortcuts need Ctrl or Alt — a bare key would steal typing.'
  }
  for (const other of ACTIONS) {
    if (other !== action && binds[other] === combo) {
      return `Already used by “${KEYBIND_LABELS[other]}”.`
    }
  }
  return null
}

/**
 * Every NON-keyboard control in the app — the mouse gestures and tool buttons —
 * so the Shortcuts panel shows the complete picture. These are how the tools
 * work, not rebindable keys.
 */
export const FIXED_CONTROLS: { group: string; control: string; does: string }[] = [
  { group: 'Canvas', control: 'Click a part', does: 'Select it (Properties panel shows it)' },
  {
    group: 'Canvas',
    control: 'Drag a part',
    does: 'Move it — every selected part moves along (wires re-route and re-solve)',
  },
  { group: 'Canvas', control: 'Drag from the palette', does: 'Place a new part where you drop it' },
  { group: 'Canvas', control: 'Double-click a switch', does: 'Flip it open / closed' },
  {
    group: 'Canvas',
    control: 'Drag empty canvas',
    does: 'Box-select: everything the box touches is selected together (like desktop icons)',
  },
  {
    group: 'Canvas',
    control: 'Lasso tool: draw around parts',
    does: 'Freeform select — any shape you draw; parts whose middle is inside get selected',
  },
  {
    group: 'Canvas',
    control: 'Ctrl+click parts',
    does: 'Add parts to the selection one by one',
  },
  {
    group: 'Canvas',
    control: 'Double-click a block',
    does: 'Descend into it — see the real circuit inside (Ungroup there to edit)',
  },
  {
    group: 'Canvas',
    control: 'Middle-drag or right-drag',
    does: 'Pan the view (left-drag is box-select now)',
  },
  { group: 'Canvas', control: 'Scroll wheel', does: 'Zoom in / out' },
  {
    group: 'Clipboard',
    control: '📋 Clipboard button',
    does: 'Open the clipboard panel: the last 15 copies + the one cut — click any to paste it',
  },
  {
    group: 'Wire tool',
    control: 'Click anywhere',
    does: 'Start a wire — a terminal dot, or open space (a junction dot is made there)',
  },
  {
    group: 'Wire tool',
    control: 'Click empty canvas',
    does: 'Drop a corner the wire routes through',
  },
  { group: 'Wire tool', control: 'Click a terminal dot', does: 'Finish the wire there' },
  {
    group: 'Wire tool',
    control: 'Double-click empty canvas',
    does: 'End the wire there (a junction dot is made)',
  },
  {
    group: 'Wire tool',
    control: 'Click the starting dot again',
    does: 'Abandon the wire being drawn',
  },
  { group: 'Wire tool', control: 'Drag dot to dot', does: 'Draw a wire the old way (still works)' },
  {
    group: 'Wire tool',
    control: 'Line / Curve buttons',
    does: 'Sharp corners, or rounded fillets (the wire’s real length follows the shape)',
  },
  {
    group: 'Wires',
    control: 'Hover a wire',
    does: 'Readout: current, length, resistance, drop — and the voltage at the exact point under the cursor',
  },
  { group: 'Wires', control: 'Double-click a wire', does: 'Add a routing corner to it' },
  { group: 'Wires', control: 'Drag a corner dot', does: 'Move that corner' },
  {
    group: 'Wires',
    control: 'Hover a terminal dot',
    does: 'Shows which terminal it is (and its polarity)',
  },
  {
    group: 'Meter tool',
    control: 'Click a terminal dot',
    does: 'Place the red probe (first click) then the black (second)',
  },
  { group: 'Meter tool', control: 'Third click on a dot', does: 'Restart probing from there' },
  {
    group: 'Meter tool',
    control: 'Click a wire',
    does: 'Clamp onto it and read its current (nothing inserted)',
  },
  {
    group: 'Meter tool',
    control: 'Click empty canvas',
    does: 'Lift the probes / release the clamp',
  },
  {
    group: 'Meter tool',
    control: 'V⎓ V~ Ω ⏵ ⊣⊢ buttons',
    does: 'The mode dial: DC volts, AC volts, resistance, diode test, capacitance',
  },
  {
    group: 'Meter tool',
    control: 'HOLD button',
    does: 'Freeze the reading to compare; click again to release',
  },
  { group: 'Toolbar', control: 'Solve button', does: 'Run the physics now (with Always-on off)' },
  {
    group: 'Toolbar',
    control: 'Group button',
    does: 'Turn the selected parts into ONE reusable block — ports come from the wires crossing the selection; the solver still computes the real parts inside',
  },
  {
    group: 'Toolbar',
    control: 'Scope button',
    does: 'Run the circuit through time and plot every voltage',
  },
  {
    group: 'Toolbar',
    control: 'Lens buttons',
    does: 'Voltage / Power / Temp / Field overlays + Flow animation',
  },
  {
    group: 'Menus',
    control: 'View menu',
    does: 'Window zoom, full screen, reload (standard shortcuts shown in the menu)',
  },
  { group: 'Menus', control: 'Settings menu', does: 'Light mode and grid color' },
]
