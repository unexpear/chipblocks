import type { BlockData, BlockInnerNode } from './blocks.ts'
import { defaultParameters } from './part-defaults.ts'
import { paramMin } from './part-inspector.tsx'

export type BlockScalar = { kind: 'scalar'; amount: number; unit: string }
export type BlockParameter = {
  key: string
  value: BlockScalar
  origin: 'instance' | 'catalog-default'
}

export function blockNodeAt(block: BlockData, path: readonly string[]): BlockInnerNode | undefined {
  let current = block
  for (const [index, id] of path.entries()) {
    const node = current.nodes.find((candidate) => candidate.id === id)
    if (!node) return undefined
    if (index === path.length - 1) return node
    if (!node.block) return undefined
    current = node.block
  }
  return undefined
}

export function blockScalarParameters(node: BlockInnerNode): BlockParameter[] {
  if (node.block) return []
  const parameters = { ...defaultParameters(node.definition), ...node.parameters }
  return Object.entries(parameters).flatMap(([key, entry]) => {
    if (key === 'terminal_count' || key === 'incident_illuminance') return []
    const value = entry?.value
    if (typeof value !== 'object' || value === null) return []
    const scalar = value as Partial<BlockScalar>
    return scalar.kind === 'scalar' &&
      typeof scalar.amount === 'number' &&
      Number.isFinite(scalar.amount) &&
      typeof scalar.unit === 'string'
      ? [
          {
            key,
            value: { kind: 'scalar' as const, amount: scalar.amount, unit: scalar.unit },
            origin: Object.hasOwn(node.parameters ?? {}, key)
              ? ('instance' as const)
              : ('catalog-default' as const),
          },
        ]
      : []
  })
}

export function overrideBlockParameter(
  block: BlockData,
  path: readonly string[],
  key: string,
  amount: number,
  unit: string,
): { ok: true; block: BlockData } | { ok: false; reason: string } {
  if (path.length === 0 || path.length > 64)
    return { ok: false, reason: 'Choose an internal part within 64 hierarchy levels.' }
  const target = blockNodeAt(block, path)
  if (!target) return { ok: false, reason: 'The internal part no longer exists. Select it again.' }
  const parameter = blockScalarParameters(target).find((candidate) => candidate.key === key)
  if (!parameter)
    return {
      ok: false,
      reason:
        'This is not an editable scalar parameter. Structural and derived values cannot be overridden here.',
    }
  if (!Number.isFinite(amount)) return { ok: false, reason: 'Enter a finite number.' }
  const minimum = paramMin(key, parameter.value.unit)
  if (minimum !== undefined && amount < minimum)
    return {
      ok: false,
      reason: `This parameter must be at least ${minimum}, as in the part inspector.`,
    }
  if (parameter.value.unit !== unit)
    return {
      ok: false,
      reason: `Use the declared unit ${parameter.value.unit}; implicit conversion is not supported.`,
    }
  const replace = (current: BlockData, depth: number): BlockData => ({
    ...current,
    nodes: current.nodes.map((node) => {
      if (node.id !== path[depth]) return node
      if (depth === path.length - 1) {
        return {
          ...node,
          parameters: { ...node.parameters, [key]: { value: { kind: 'scalar', amount, unit } } },
        }
      }
      return node.block ? { ...node, block: replace(node.block, depth + 1) } : node
    }),
  })
  return { ok: true, block: replace(block, 0) }
}
