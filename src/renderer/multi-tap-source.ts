import type { CanvasEdgeLike, CanvasNodeLike } from './blocks.ts'
import type { Parameters } from './part-defaults.ts'
import { sourceTerminalCount } from './part-defaults.ts'

/**
 * Multi-lead sources (S19-v3-74) — a source whose Properties say "N leads"
 * expands, BEFORE every solve, into what it physically is:
 *
 *  - N = 2: the plain two-lead source. Untouched.
 *  - N ≥ 3: a TAPPED STACK — (N−1) real two-lead sections in series (each one
 *    nominal_voltage behind internal_resistance, the cell being stacked), with
 *    a junction brought out at every internal seam. tap_1 sits just under the
 *    + lead; each step down drops one section. This is how real tapped packs
 *    and dual-rail supplies are built — the solver only ever sees real
 *    two-lead sources, never a "multi-lead" model (the blocks rule).
 *  - N = 1: a RAIL LEAD — the + is brought out and the return is bonded to
 *    the circuit's ground inside. Expansion adds that bond as an internal
 *    0 Ω connection to the first ground part. No ground on the canvas → no
 *    return path → the source honestly sits idle (the solver's grounded-
 *    component rule already handles a floating section).
 *
 * Internal seams are marked `internalBond` so the canvas wire model gives
 * them ZERO length/resistance — they are inside the pack, not drawn wires;
 * inventing resistance for them would be inventing physics.
 *
 * Section ids are `${source}.sec1` …: the existing dot-namespace rule means a
 * failing section bubbles up to mark the source node, exactly like a part
 * inside a block. `aliases` route the original leads (`source/tap_1` …) to
 * the expanded terminals so the multimeter probes read the real nets.
 */

export type LeadAlias = { outer: string; inner: string }

/**
 * The probe aliases a multi-lead source's ORIGINAL leads resolve to after
 * expansion — pure naming, derivable from the node alone, so the meter's net
 * lookup can use it without re-running the expansion. (Two-lead and one-lead
 * sources keep their own terminals — no aliases.)
 */
export function multiLeadAliases(nodes: CanvasNodeLike[]): LeadAlias[] {
  const aliases: LeadAlias[] = []
  for (const node of nodes) {
    if (node.data.definition !== 'power_source') continue
    const count = sourceTerminalCount(node.data.parameters)
    if (count < 3) continue
    aliases.push({
      outer: `${node.id}/terminal_positive`,
      inner: `${node.id}.sec1/terminal_positive`,
    })
    aliases.push({
      outer: `${node.id}/terminal_negative`,
      inner: `${node.id}.sec${count - 1}/terminal_negative`,
    })
    for (let k = 1; k <= count - 2; k++) {
      // The tap junction itself is a pure tie point (not a world instance), so
      // the probe alias lands on the section terminal at the same seam — the
      // seam is a zero-ohm internal bond, so the potential is identical.
      aliases.push({
        outer: `${node.id}/tap_${k}`,
        inner: `${node.id}.sec${k}/terminal_negative`,
      })
    }
  }
  return aliases
}

export function expandMultiLeadSources(
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
): { nodes: CanvasNodeLike[]; edges: CanvasEdgeLike[]; aliases: LeadAlias[] } {
  const outNodes: CanvasNodeLike[] = []
  const outEdges: CanvasEdgeLike[] = [...edges]
  const aliases: LeadAlias[] = multiLeadAliases(nodes)
  const groundId = nodes.find((n) => n.data.definition === 'ground')?.id

  // edge endpoint rewrites: `${nodeId}/${handleId}` → { node, handle }
  const rewrites = new Map<string, { node: string; handle: string }>()

  for (const node of nodes) {
    if (node.data.definition !== 'power_source') {
      outNodes.push(node)
      continue
    }
    const count = sourceTerminalCount(node.data.parameters)
    if (count === 2) {
      outNodes.push(node)
      continue
    }

    if (count === 1) {
      // The rail lead: the source itself stays; its hidden − side bonds to
      // ground (when there is one — otherwise it is honestly floating).
      outNodes.push(node)
      if (groundId !== undefined && groundId !== node.id) {
        outEdges.push({
          id: `${node.id}.rail_return`,
          source: node.id,
          sourceHandle: 'terminal_negative',
          target: groundId,
          targetHandle: 'reference_terminal',
          data: { internalBond: true },
        } as CanvasEdgeLike)
      }
      continue
    }

    // N ≥ 3: the tapped stack. Section parameters are the SAME cell spec —
    // terminal_count removed so a section can never recurse.
    const sectionParams = (): Parameters | undefined => {
      if (node.data.parameters === undefined) return undefined
      const copy = JSON.parse(JSON.stringify(node.data.parameters)) as Parameters
      delete copy.terminal_count
      return copy
    }
    const sections = count - 1
    const sectionId = (i: number) => `${node.id}.sec${i}`
    for (let i = 1; i <= sections; i++) {
      const params = sectionParams()
      outNodes.push({
        id: sectionId(i),
        type: 'device',
        position: { x: node.position.x, y: node.position.y + (i - 1) * 4 },
        data: { definition: 'power_source', ...(params ? { parameters: params } : {}) },
      })
    }
    for (let k = 1; k <= count - 2; k++) {
      const tapId = `${node.id}.tap${k}`
      outNodes.push({
        id: tapId,
        type: 'junction',
        position: { x: node.position.x, y: node.position.y + k * 4 },
        data: { definition: 'junction' },
      })
      // The seam: section k's − and section k+1's + meet at the tap. Inside
      // the pack — zero length, zero resistance.
      outEdges.push({
        id: `${node.id}.seam${k}a`,
        source: sectionId(k),
        sourceHandle: 'terminal_negative',
        target: tapId,
        targetHandle: 'tie',
        data: { internalBond: true },
      } as CanvasEdgeLike)
      outEdges.push({
        id: `${node.id}.seam${k}b`,
        source: tapId,
        sourceHandle: 'tie',
        target: sectionId(k + 1),
        targetHandle: 'terminal_positive',
        data: { internalBond: true },
      } as CanvasEdgeLike)
      rewrites.set(`${node.id}/tap_${k}`, { node: tapId, handle: 'tie' })
    }
    rewrites.set(`${node.id}/terminal_positive`, {
      node: sectionId(1),
      handle: 'terminal_positive',
    })
    rewrites.set(`${node.id}/terminal_negative`, {
      node: sectionId(sections),
      handle: 'terminal_negative',
    })
  }

  const rewritten = outEdges.map((edge) => {
    const source = rewrites.get(`${edge.source}/${edge.sourceHandle ?? ''}`)
    const target = rewrites.get(`${edge.target}/${edge.targetHandle ?? ''}`)
    if (source === undefined && target === undefined) return edge
    return {
      ...edge,
      ...(source !== undefined ? { source: source.node, sourceHandle: source.handle } : {}),
      ...(target !== undefined ? { target: target.node, targetHandle: target.handle } : {}),
    }
  })

  return { nodes: outNodes, edges: rewritten, aliases }
}
