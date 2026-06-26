import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from './blocks.ts'

/**
 * Scale-up tiling — stamp a reusable CELL N times in a row and wire only the REPEATING connections, so a
 * regular array (the calculator's per-digit ALU cell ×10, a register's bit-cells, …) becomes N clean
 * local cells instead of one mega-block with a fan-out of wires. "Duplicate the single version when the
 * scale-up isn't wholly different." Two kinds of repeating wire:
 *   • chain — cell[i-1].from → cell[i].to (the ripple, e.g. carry cout → cin), short hops down the row.
 *   • bus   — one shared net touched by every cell (sub, V+, GND): cell[0].p wired out to each cell[i].p.
 * Returns the cell nodes + those edges; the caller still wires each cell's OWN I/O (its A/B in, its sum
 * out to a display). `idAt(i)` is cell i's node id, so the caller can address each stamp.
 */
export function tileRow(opts: {
  cell: BlockData
  count: number
  prefix: string
  x0: number
  y0: number
  pitch: number
  chain?: { from: string; to: string }[]
  bus?: string[]
}): { nodes: CanvasNodeLike[]; edges: CanvasEdgeLike[]; idAt: (i: number) => string } {
  const { cell, count, prefix, x0, y0, pitch, chain = [], bus = [] } = opts
  const idAt = (i: number) => `${prefix}${i}`
  const nodes: CanvasNodeLike[] = []
  const edges: CanvasEdgeLike[] = []
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: idAt(i),
      type: 'block',
      position: { x: x0 + i * pitch, y: y0 },
      data: { definition: 'block', label: `${cell.name} ${i}`, block: cell },
    })
    if (i === 0) continue
    for (const c of chain) {
      edges.push({
        id: `${prefix}ch_${c.from}_${i}`,
        source: idAt(i - 1),
        sourceHandle: c.from,
        target: idAt(i),
        targetHandle: c.to,
      })
    }
    for (const p of bus) {
      edges.push({
        id: `${prefix}bus_${p}_${i}`,
        source: idAt(0),
        sourceHandle: p,
        target: idAt(i),
        targetHandle: p,
      })
    }
  }
  return { nodes, edges, idAt }
}
