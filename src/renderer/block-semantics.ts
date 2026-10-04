import { portContractProblems } from './block-contracts.ts'
import { blockStructureError } from './block-validation.ts'
import type { BlockData, BlockPort } from './blocks.ts'
import { buildNets, endpointKey, handleOfEndpoint, nodeOfEndpoint } from './output-contention.ts'
import { defaultParameters } from './part-defaults.ts'
import { hasTerminalDefinition, terminalsOf } from './symbols.tsx'

function contractMismatch(left: BlockPort, right: BlockPort): string | null {
  if (left.domain && right.domain && left.domain !== right.domain)
    return `domain ${left.domain} cannot connect directly to ${right.domain}`
  if (
    left.unit &&
    right.unit &&
    left.unit !== 'unknown' &&
    right.unit !== 'unknown' &&
    left.unit !== right.unit
  )
    return `unit ${left.unit} cannot connect directly to ${right.unit}`
  return null
}

export function blockConnectionProblems(
  nodes: readonly { id: string; block?: BlockData | undefined }[],
  edges: Parameters<typeof buildNets>[0],
): string[] {
  const ports = new Map(
    nodes.flatMap((node) =>
      (node.block?.ports ?? []).map((port) => [endpointKey(node.id, port.id), port] as const),
    ),
  )
  const problems: string[] = []
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const identities = new Set<string>()
  const visit = (node: { id: string; block?: BlockData | undefined }, prefix: string) => {
    const identity = `${prefix}${node.id}`
    if (identities.has(identity)) problems.push(`Ambiguous flattened identifier: ${identity}.`)
    identities.add(identity)
    for (const child of node.block?.nodes ?? []) visit(child, `${identity}.`)
  }
  for (const node of nodes) visit(node, '')
  for (const edge of edges) {
    for (const [nodeId, handle] of [
      [edge.source, edge.sourceHandle],
      [edge.target, edge.targetHandle],
    ] as const) {
      if (nodeById.get(nodeId)?.block && !ports.has(endpointKey(nodeId, handle ?? '')))
        problems.push(
          `${nodeId}/${handle ?? '(missing)'}: wire references a nonexistent block port.`,
        )
    }
  }
  for (const group of buildNets(edges).groups) {
    const declared = group.flatMap((key) => {
      const port = ports.get(key)
      return port ? [{ key, port }] : []
    })
    for (let index = 0; index < declared.length; index++) {
      const left = declared[index]
      if (!left) continue
      for (const right of declared.slice(index + 1)) {
        const mismatch = contractMismatch(left.port, right.port)
        if (mismatch)
          problems.push(
            `${nodeOfEndpoint(left.key)}/${handleOfEndpoint(left.key)} ↔ ${nodeOfEndpoint(right.key)}/${handleOfEndpoint(right.key)}: ${mismatch}.`,
          )
      }
    }
  }
  return problems
}

export function blockSemanticProblems(block: BlockData, path: string): string[] {
  const structural = blockStructureError(block, path)
  if (structural) return [structural]
  const problems: string[] = []
  const visit = (current: BlockData, parent: string) => {
    const terminals = new Map<string, Set<string>>()
    for (const node of current.nodes) {
      const defaults = defaultParameters(node.definition)
      for (const [key, entry] of Object.entries(node.parameters ?? {})) {
        const expected = defaults[key]?.value
        const actual = entry.value
        if (expected && typeof expected === 'object' && actual && typeof actual === 'object') {
          const expectedUnit = (expected as { unit?: string }).unit
          const actualUnit = (actual as { unit?: string }).unit
          if (expectedUnit && actualUnit !== expectedUnit)
            problems.push(
              `${parent}/${node.id}: parameter ${key} requires ${expectedUnit}, not ${actualUnit}. Implicit conversion is not supported.`,
            )
        } else if (expected !== undefined && typeof actual !== typeof expected) {
          problems.push(
            `${parent}/${node.id}: parameter ${key} has a different value type from its device definition.`,
          )
        }
      }
      if (node.block) {
        terminals.set(node.id, new Set(node.block.ports.map((port) => port.id)))
        visit(node.block, `${parent}/${node.id}`)
      } else if (hasTerminalDefinition(node.definition)) {
        terminals.set(
          node.id,
          new Set(terminalsOf(node.definition, node.parameters).map((port) => port.id)),
        )
      } else {
        problems.push(
          `${parent}/${node.id}: terminal definition ${node.definition} is unavailable; fallback drawing pins do not validate a model.`,
        )
      }
    }
    const check = (nodeId: string, handle: string | null, location: string) => {
      if (!terminals.get(nodeId)?.has(handle ?? ''))
        problems.push(`${parent}/${location}: unknown terminal ${nodeId}/${handle ?? '(missing)'}.`)
    }
    for (const edge of current.edges) {
      check(edge.source, edge.sourceHandle, edge.id)
      check(edge.target, edge.targetHandle, edge.id)
    }
    for (const port of current.ports) {
      check(port.inner.nodeId, port.inner.handleId, port.id)
      for (const problem of portContractProblems(port))
        problems.push(`${parent}/${port.id}: ${problem}`)
      if (port.domain && !['electrical', 'digital', 'control'].includes(port.domain))
        problems.push(
          `${parent}/${port.id}: ${port.domain} ports are not supported by the electrical block connection model.`,
        )
      const inner = current.nodes
        .find((node) => node.id === port.inner.nodeId)
        ?.block?.ports.find((candidate) => candidate.id === port.inner.handleId)
      const mismatch = inner ? contractMismatch(port, inner) : null
      if (mismatch) problems.push(`${parent}/${port.id}: exposed nested port ${mismatch}.`)
    }
    problems.push(
      ...blockConnectionProblems(current.nodes, current.edges).map(
        (problem) => `${parent}: ${problem}`,
      ),
    )
  }
  visit(block, path)
  return problems
}
