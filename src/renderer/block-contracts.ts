import type { BlockPort } from './blocks.ts'

export type BlockPortPatch = {
  [Key in
    | 'name'
    | 'kind'
    | 'side'
    | 'drive'
    | 'enable'
    | 'domain'
    | 'direction'
    | 'role'
    | 'unit']?: BlockPort[Key] | undefined
}

export function patchBlockPort(port: BlockPort, patch: BlockPortPatch): BlockPort {
  const next = { ...port }
  for (const key of Object.keys(patch) as (keyof BlockPortPatch)[]) {
    const value = patch[key]
    if (value === undefined) delete next[key]
    else Object.assign(next, { [key]: value })
  }
  if (next.enable?.pin === '') delete next.enable
  return next
}

export function portContractProblems(port: BlockPort): string[] {
  const problems: string[] = []
  if (
    (port.direction === 'input' && port.drive !== undefined && port.drive !== 'input') ||
    (port.direction === 'output' && port.drive === 'input')
  ) {
    problems.push(
      'Direction conflicts with the declared drive type. Correct one before using this contract.',
    )
  }
  if (port.enable && port.drive !== 'tristate') {
    problems.push('An enable pin is declared but this port is not a tri-state output.')
  }
  return problems
}

export function removeBlockPort(ports: readonly BlockPort[], portId: string): BlockPort[] {
  return ports
    .filter((port) => port.id !== portId)
    .map((port) =>
      port.enable?.pin === portId ? patchBlockPort(port, { enable: undefined }) : port,
    )
}
