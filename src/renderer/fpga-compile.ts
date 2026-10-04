/**
 * Near-term iCE40 compile — report only.
 *
 * Canvas gates go through the real engines already in the tree:
 *   compileLogic → coverToLuts(k = 4) → autoPlace(device, layout, luts, cellPool)
 * autoPlace synthesizes each candidate (synthesizeBitstream) and the report reads those fields.
 * Nothing here writes a .bin. The CRAM image, when one is produced, stays inside the library result.
 *
 * The cell pool is the caller's. The UI and the tests pass ICE40_ONE_TILE_POOL: one logic tile,
 * eight cells, not the chip. The search budget defaults to ICE40_COMPILE_BUDGET (20_000), the same
 * cap autoPlace documents — past it, a miss is a truncated search, not a proof the design is unroutable.
 */
import type { CanvasEdgeLike, CanvasNodeLike } from './blocks.ts'
import { coverToLuts, type KLut } from './fpga-fabric.ts'
import { parseIceboxChipdb } from './fpga-icebox.ts'
import { type AutoPlaceResult, autoPlace, type Cell } from './fpga-icebox-autoplace.ts'
import { parseLogicTileBits } from './fpga-icebox-logic.ts'
import { compileLogic, isOutputPort, POWER_PORT_IDS } from './logic-sim.ts'

/** Candidate cap for the near-term compile. Matches autoPlace's own default, declared here so the UI does not drift. */
export const ICE40_COMPILE_BUDGET = 20_000

/**
 * The declared near-term pool: logic tile (1, 1), cells 0..7. That tile is a logic tile on the vendored
 * iCE40 384 chipdb. It is one tile, not the device.
 */
export const ICE40_ONE_TILE_POOL: readonly Cell[] = Array.from({ length: 8 }, (_, cell) => ({
  x: 1,
  y: 1,
  cell,
}))

/**
 * Limits the engines already document. Always returned, whether or not a placement was found —
 * a clean-looking report must not read as a loadable chip.
 */
export const FPGA_COMPILE_HONESTY: readonly string[] = [
  'IO, clock, and reset are not routed to pads.',
  'Flip-flops are forced off.',
  'The CRAM image is in the library; it is not a loadable .bin.',
  'Timing is not modeled.',
  'The cell pool is one logic tile, not the chip.',
  'A truncated search is not proof the design is unroutable.',
]

export type FpgaCompileResult = {
  luts: KLut[]
  autoPlace: AutoPlaceResult
  honesty: string[]
}

/** The icebox chipdb among description files the existing fpga:chip-description IPC returned, if one is there. */
export function chipdbTextOf(files: readonly { text: string }[]): string | null {
  const withBits = files.find(
    (file) => file.text.includes('.device ') && file.text.includes('.logic_tile_bits'),
  )
  if (withBits !== undefined) return withBits.text
  const deviceOnly = files.find((file) => file.text.includes('.device '))
  return deviceOnly?.text ?? null
}

function outputNets(
  nodes: readonly CanvasNodeLike[],
  portNet: (nodeId: string, handle: string) => string,
): string[] {
  const nets: string[] = []
  for (const node of nodes) {
    const block = node.data.block
    if (block === undefined) continue
    for (const port of block.ports) {
      if (POWER_PORT_IDS.has(port.id.toLowerCase())) continue
      if (!isOutputPort(port)) continue
      nets.push(portNet(node.id, port.id))
    }
  }
  return nets
}

/**
 * Compile the canvas onto the declared cell pool and return the LUT cover, the auto-place result,
 * and the fixed honesty lines. Report only — does not write a bitstream file.
 */
export function compileToIce40(
  nodes: readonly CanvasNodeLike[],
  edges: readonly CanvasEdgeLike[],
  chipdbText: string,
  cellPool: readonly Cell[],
  options: { maxCandidates?: number } = {},
): FpgaCompileResult {
  const compiled = compileLogic([...nodes], [...edges])
  const luts = coverToLuts(compiled, outputNets(nodes, compiled.portNet), 4)
  const device = parseIceboxChipdb(chipdbText)
  const layout = parseLogicTileBits(chipdbText)
  const placed = autoPlace(device, layout, luts, cellPool, {
    maxCandidates: options.maxCandidates ?? ICE40_COMPILE_BUDGET,
  })
  return { luts, autoPlace: placed, honesty: [...FPGA_COMPILE_HONESTY] }
}
