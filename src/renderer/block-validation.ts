import { BLOCK_FORMAT_VERSION, readSavedBlockTests } from './block-persistence.ts'
import type { BlockPort } from './blocks.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const finite = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export const BLOCK_PORT_ENUMS: Record<string, readonly string[]> = {
  side: ['left', 'right', 'top', 'bottom'],
  kind: ['signal', 'power_positive', 'power_negative'],
  drive: ['input', 'push_pull', 'open_collector', 'tristate'],
  domain: ['electrical', 'thermal', 'magnetic', 'mechanical', 'control', 'digital'],
  direction: ['input', 'output', 'bidirectional', 'unknown'],
  role: ['source', 'load', 'passive', 'unknown'],
  unit: [
    'unknown',
    'boolean',
    'dimensionless',
    'volt',
    'ampere',
    'ohm',
    'watt',
    'farad',
    'henry',
    'second',
    'hertz',
    'degree_celsius',
  ],
}

export type BlockPortContract = Pick<
  BlockPort,
  'kind' | 'drive' | 'domain' | 'direction' | 'role' | 'unit' | 'enable'
>

export function copyBlockPortContract(port: BlockPortContract): BlockPortContract {
  return {
    ...(port.kind === undefined ? {} : { kind: port.kind }),
    ...(port.drive === undefined ? {} : { drive: port.drive }),
    ...(port.domain === undefined ? {} : { domain: port.domain }),
    ...(port.direction === undefined ? {} : { direction: port.direction }),
    ...(port.role === undefined ? {} : { role: port.role }),
    ...(port.unit === undefined ? {} : { unit: port.unit }),
    ...(port.enable === undefined ? {} : { enable: { ...port.enable } }),
  }
}

export function readBlockPortContract(raw: Record<string, unknown>): BlockPortContract | null {
  const contract: Record<string, unknown> = {}
  for (const key of ['kind', 'drive', 'domain', 'direction', 'role', 'unit']) {
    const value = raw[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || !BLOCK_PORT_ENUMS[key]?.includes(value)) return null
    contract[key] = value
  }
  if (raw.enable !== undefined) {
    if (
      !isRecord(raw.enable) ||
      !nonempty(raw.enable.pin) ||
      typeof raw.enable.activeHigh !== 'boolean'
    )
      return null
    contract.enable = { pin: raw.enable.pin, activeHigh: raw.enable.activeHigh }
  }
  return contract as BlockPortContract
}

export function blockStructureError(raw: unknown, path: string, depth = 0): string | null {
  const fail = (message: string) => `Block ${path}: ${message}`
  if (depth >= 64) return fail('hierarchy exceeds the supported validation depth (64).')
  if (!isRecord(raw)) return fail('expected a circuit block object.')
  if (raw.version !== undefined && raw.version !== BLOCK_FORMAT_VERSION)
    return fail(
      `unsupported format version ${String(raw.version)}; this build reads version ${BLOCK_FORMAT_VERSION} or unversioned legacy blocks.`,
    )
  if (readSavedBlockTests(raw.tests) === null)
    return fail('saved tests are malformed or exceed the supported limits.')
  if (typeof raw.name !== 'string') return fail('missing block name.')
  if (!isRecord(raw.origin) || !finite(raw.origin.x) || !finite(raw.origin.y))
    return fail('origin must contain finite coordinates.')
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || !Array.isArray(raw.ports))
    return fail('missing nodes, edges, or ports list.')

  const nodes = new Map<string, Record<string, unknown>>()
  for (const node of raw.nodes) {
    if (!isRecord(node) || !nonempty(node.id) || nodes.has(node.id))
      return fail('internal node ids must be nonempty and unique.')
    if (!nonempty(node.definition) || !finite(node.x) || !finite(node.y))
      return fail(`node ${node.id} has an invalid definition or position.`)
    if (node.rotation !== undefined && !finite(node.rotation))
      return fail(`node ${node.id} has an invalid rotation.`)
    if (node.parameters !== undefined) {
      if (!isRecord(node.parameters)) return fail(`node ${node.id} has invalid parameters.`)
      for (const [key, entry] of Object.entries(node.parameters)) {
        if (!nonempty(key) || !isRecord(entry))
          return fail(`node ${node.id} has an invalid parameter ${key}.`)
        const value = entry.value
        if (typeof value === 'string') continue
        if (
          !isRecord(value) ||
          value.kind !== 'scalar' ||
          !finite(value.amount) ||
          !nonempty(value.unit)
        )
          return fail(
            `node ${node.id} parameter ${key} must be a finite scalar with a unit or a named value.`,
          )
      }
    }
    nodes.set(node.id, node)
    if (node.block !== undefined) {
      const error = blockStructureError(node.block, `${path}/${node.id}`, depth + 1)
      if (error) return error
    }
  }

  const endpointError = (nodeId: unknown, handleId: unknown): boolean => {
    if (!nonempty(nodeId) || !nodes.has(nodeId)) return true
    if (handleId !== null && !nonempty(handleId)) return true
    const nested = nodes.get(nodeId)?.block
    if (isRecord(nested) && Array.isArray(nested.ports))
      return !nested.ports.some((port: unknown) => isRecord(port) && port.id === handleId)
    return false
  }
  const edgeIds = new Set<string>()
  for (const edge of raw.edges) {
    if (!isRecord(edge) || !nonempty(edge.id) || edgeIds.has(edge.id))
      return fail('internal wire ids must be nonempty and unique.')
    edgeIds.add(edge.id)
    if (
      endpointError(edge.source, edge.sourceHandle) ||
      endpointError(edge.target, edge.targetHandle)
    )
      return fail(`wire ${edge.id} has a missing node or invalid nested port.`)
  }
  const portIds = new Set<string>()
  for (const port of raw.ports) {
    if (!isRecord(port) || !nonempty(port.id) || portIds.has(port.id))
      return fail('port ids must be nonempty and unique.')
    portIds.add(port.id)
    if (typeof port.label !== 'string' || typeof port.side !== 'string')
      return fail(`port ${port.id} is missing its label or side.`)
    for (const [key, allowed] of Object.entries(BLOCK_PORT_ENUMS)) {
      if (
        port[key] !== undefined &&
        (typeof port[key] !== 'string' || !allowed.includes(port[key]))
      )
        return fail(`port ${port.id} has an invalid ${key}.`)
    }
    if (
      !isRecord(port.inner) ||
      !nonempty(port.inner.handleId) ||
      endpointError(port.inner.nodeId, port.inner.handleId)
    )
      return fail(`port ${port.id} does not expose an existing internal node or nested port.`)
  }
  for (const port of raw.ports) {
    if (!isRecord(port) || port.enable === undefined) continue
    if (
      !isRecord(port.enable) ||
      !nonempty(port.enable.pin) ||
      !portIds.has(port.enable.pin) ||
      typeof port.enable.activeHigh !== 'boolean'
    )
      return fail(`port ${String(port.id)} has an invalid enable pin contract.`)
  }
  return null
}
