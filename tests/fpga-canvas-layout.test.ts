import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import { lowerNetlistToCanvas } from '../src/renderer/fpga-icebox-canvas.ts'
import { loadIce40Bitstream } from '../src/renderer/fpga-icebox-load.ts'
import { parseLogicTileBits } from '../src/renderer/fpga-icebox-logic.ts'
import { openFpgaDesign } from '../src/renderer/fpga-open.ts'

/**
 * A DESIGN YOU CANNOT SEE IS NOT A FEATURE.
 *
 * The recovered design used to be laid out as one endless row: the smallest iCE40 chip there is, carrying 72
 * logic parts, came out 35,758 canvas units wide and 1,134 tall. Fitted into the canvas pane that is a 33-to-1
 * hairline, and a single gate is drawn about two pixels across — the card said "286 pieces you can open and
 * run" over something nobody could read.
 *
 * These are the properties that stop that coming back. They are about SHAPE and SIZE ON SCREEN, not about
 * exact coordinates, so the layout can be improved without rewriting the tests.
 */

const FIXTURES = new URL('../fixtures/', import.meta.url)
const bytes = (name: string) => new Uint8Array(readFileSync(new URL(name, FIXTURES)))
const text = (name: string) => readFileSync(new URL(name, FIXTURES), 'utf8')

/** The app draws a logic gate 76 across and 54 down (gate-symbol.tsx) and a power source's box 80 by 44. */
const GATE_WIDTH = 76
const NODE_WIDTH = 80
const NODE_HEIGHT = 54

/**
 * The canvas pane, measured in the running app at its default window size (1051 × 545): the drawing area is
 * 783 × 397 CSS pixels, with the palette to its left and the toolbar above.
 */
const PANE_WIDTH = 783
const PANE_HEIGHT = 397

const chipdb = (device: string) => ({
  name: `chipdb-${device}.txt`,
  text: text(`icebox-ice40-${device}-chipdb.txt`),
})

function circuitOf(device: string, file: string) {
  const result = openFpgaDesign(bytes(file), [chipdb(device)])
  if (!result.ok) throw new Error(result.reason)
  return result
}

function loweredOf(device: string, file: string) {
  const description = text(`icebox-ice40-${device}-chipdb.txt`)
  const loaded = loadIce40Bitstream(bytes(file), {
    [device]: { device: parseIceboxChipdb(description), layout: parseLogicTileBits(description) },
  })
  if (!loaded.ok) throw new Error(loaded.reason)
  return lowerNetlistToCanvas(loaded.netlist)
}

/** The whole design's box, counting the room each node's drawing actually takes. */
function extentOf(nodes: readonly { x: number; y: number }[]) {
  const left = Math.min(...nodes.map((node) => node.x))
  const top = Math.min(...nodes.map((node) => node.y))
  const width = Math.max(...nodes.map((node) => node.x)) - left + NODE_WIDTH
  const height = Math.max(...nodes.map((node) => node.y)) - top + NODE_HEIGHT
  return { width, height }
}

/** How wide one gate comes out on screen once the whole design is fitted into the pane. */
const gateWidthOnScreen = (extent: { width: number; height: number }) =>
  GATE_WIDTH * Math.min(PANE_WIDTH / extent.width, PANE_HEIGHT / extent.height)

/**
 * The room one node needs including the channel its wires run in — the lowering's own lane pitch.
 *
 * How many of these the whole design spends per node is the size measure that does not depend on how many
 * nodes there are: a big design is legitimately big, but it should not be EMPTY. The old layout spent about
 * fifteen of them per node, all of it in one endless horizontal run.
 */
const LANE_AREA = 120 * 80

const DESIGNS: { name: string; device: string; file: string }[] = [
  { name: 'the smallest chip, densely filled', device: '384', file: 'icebox-ice40-384-dense.bin' },
  { name: 'a vendor design', device: '384', file: 'icebox-ice40-384-vendor-xor5.bin' },
  { name: 'a design with flip-flops', device: '1k', file: 'icebox-ice40-1k-blockram.bin' },
  { name: 'a design with carry parts', device: '1k', file: 'icebox-ice40-1k-carry-add4.bin' },
]

describe('a recovered design is laid out to be looked at', () => {
  for (const { name, device, file } of DESIGNS) {
    test(`${name} comes out roughly as wide as it is tall`, () => {
      const extent = extentOf(circuitOf(device, file).circuit.nodes)
      const ratio = extent.width / extent.height
      expect(ratio).toBeGreaterThan(0.5)
      expect(ratio).toBeLessThan(3)
    })

    test(`${name} spends its room on parts rather than on emptiness`, () => {
      const nodes = circuitOf(device, file).circuit.nodes
      const extent = extentOf(nodes)
      const perNode = (extent.width * extent.height) / nodes.length
      // Measured with this layout: 21,800 to 35,800 per node across these four designs. The old one spent
      // 141,800 per node on the densely-filled 384, which is the emptiness this pins down.
      expect(perNode).toBeLessThan(5 * LANE_AREA)
    })

    test(`${name} draws no two parts on top of each other`, () => {
      const nodes = circuitOf(device, file).circuit.nodes
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i] as (typeof nodes)[number]
          const b = nodes[j] as (typeof nodes)[number]
          const clear = Math.abs(a.x - b.x) >= NODE_WIDTH || Math.abs(a.y - b.y) >= NODE_HEIGHT
          if (!clear) throw new Error(`${a.id} and ${b.id} overlap at (${a.x}, ${a.y})`)
        }
    })
  }

  test('the design the defect was reported against is drawn, not reduced to a hairline', () => {
    // fixtures/icebox-ice40-384-dense.bin: the SMALLEST iCE40 there is, 72 logic parts, 286 canvas pieces.
    // Fitted into the pane it used to draw a gate 1.75 px across, in a box 33 times wider than it was tall.
    const extent = extentOf(circuitOf('384', 'icebox-ice40-384-dense.bin').circuit.nodes)
    expect(gateWidthOnScreen(extent)).toBeGreaterThan(10)
  })

  test('the parts are placed in the chip’s own order, wrapped into rows', () => {
    const lowered = loweredOf('384', 'icebox-ice40-384-dense.bin')
    const corners = [...lowered.cellNodes.entries()].map(([key, ids]) => {
      const owned = ids.flatMap((id) => lowered.nodes.filter((node) => node.id === id))
      const [x, y, cell] = key.split('_').map(Number)
      return {
        chip: [x as number, y as number, cell as number] as const,
        x: Math.min(...owned.map((node) => node.position.x)),
        y: Math.min(...owned.map((node) => node.position.y)),
      }
    })
    const inChipOrder = [...corners].sort(
      (a, b) => a.chip[0] - b.chip[0] || a.chip[1] - b.chip[1] || a.chip[2] - b.chip[2],
    )
    for (let i = 1; i < inChipOrder.length; i++) {
      const previous = inChipOrder[i - 1] as (typeof inChipOrder)[number]
      const current = inChipOrder[i] as (typeof inChipOrder)[number]
      const laterRow = current.y > previous.y
      const furtherAlong = current.y === previous.y && current.x > previous.x
      if (!laterRow && !furtherAlong)
        throw new Error(
          `${current.chip.join(',')} is placed before ${previous.chip.join(',')} at (${current.x}, ${current.y})`,
        )
    }
  })

  test('a part’s own gates leave no empty lane where a stage it skipped would have been', () => {
    // Most recovered parts use only some of the dataflow stages. If the columns were fixed, every simple part
    // would carry the width of the widest one — which is most of the wasted room the old layout had.
    const lowered = loweredOf('384', 'icebox-ice40-384-dense.bin')
    const positionOf = new Map(lowered.nodes.map((node) => [node.id, node.position]))
    let checked = 0
    for (const ids of lowered.cellNodes.values()) {
      const columns = [
        ...new Set(ids.flatMap((id) => (positionOf.get(id) ? [positionOf.get(id)?.x] : []))),
      ]
        .filter((x): x is number => x !== undefined)
        .sort((a, b) => a - b)
      if (columns.length < 2) continue
      const pitch = (columns[1] as number) - (columns[0] as number)
      for (let i = 1; i < columns.length; i++)
        expect((columns[i] as number) - (columns[i - 1] as number)).toBe(pitch)
      checked++
    }
    expect(checked).toBeGreaterThan(10)
  })

  test('the chip’s inputs stand to the left of every part they drive', () => {
    const lowered = loweredOf('1k', 'icebox-ice40-1k-blockram.bin')
    const inputIds = new Set(lowered.inputNodes.values())
    const partIds = new Set([...lowered.cellNodes.values()].flat())
    const inputs = lowered.nodes.filter((node) => inputIds.has(node.id))
    const parts = lowered.nodes.filter((node) => partIds.has(node.id))
    expect(inputs.length).toBeGreaterThan(0)
    expect(parts.length).toBeGreaterThan(0)
    const rightmostInput = Math.max(...inputs.map((node) => node.position.x))
    const leftmostPart = Math.min(...parts.map((node) => node.position.x))
    expect(rightmostInput).toBeLessThan(leftmostPart)
  })
})
