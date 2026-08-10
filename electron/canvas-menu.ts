/**
 * The File items that put a design ON the circuit canvas — the one decision, on its own so it can be tested.
 *
 * All three read a file the user picks and hand it to the canvas. Without a canvas on screen there is nothing
 * listening, and what happens then is nothing at all: measured in the running app, picking "Read an FPGA Chip
 * File…" from the My Projects launcher opened the file chooser, read the file, and showed the user no design,
 * no card and no message. So they are unavailable until there is somewhere for the file to go.
 *
 * Kept as one list because they must not drift apart: an item added here without an `enabled` is an item that
 * silently does nothing again.
 */

export const CANVAS_LOADING_ITEMS = [
  { id: 'open-circuit', label: 'Open Circuit…' },
  { id: 'import-netlist', label: 'Import Netlist / Schematic / Verilog…' },
  { id: 'read-fpga-chip-file', label: 'Read an FPGA Chip File…' },
] as const

export type CanvasLoadingItemId = (typeof CANVAS_LOADING_ITEMS)[number]['id']

export type CanvasLoadingItem = { id: CanvasLoadingItemId; label: string; enabled: boolean }

/** The three items as the menu wants them, given whether a circuit canvas is on screen to receive a file. */
export const canvasLoadingItems = (circuitCanvasOpen: boolean): CanvasLoadingItem[] =>
  CANVAS_LOADING_ITEMS.map((item) => ({ ...item, enabled: circuitCanvasOpen }))
