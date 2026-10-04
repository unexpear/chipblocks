import type { BlockData, BlockTestCase } from './blocks.ts'

export const BLOCK_FORMAT_VERSION = 1
export const BLOCK_TEST_MAX_CYCLES = 256

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const unsigned = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function readSavedBlockTests(raw: unknown): BlockTestCase[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 256) return null
  const ids = new Set<string>()
  const tests: BlockTestCase[] = []
  for (const candidate of raw) {
    if (
      !record(candidate) ||
      typeof candidate.id !== 'string' ||
      !candidate.id.trim() ||
      ids.has(candidate.id)
    )
      return null
    if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null
    if (
      !unsigned(candidate.cycles) ||
      candidate.cycles < 1 ||
      candidate.cycles > BLOCK_TEST_MAX_CYCLES
    )
      return null
    if (!record(candidate.inputs) || !record(candidate.expected)) return null
    if (
      Object.keys(candidate.inputs).length > 1024 ||
      Object.keys(candidate.expected).length === 0 ||
      Object.keys(candidate.expected).length > 1024
    )
      return null
    const inputs: [string, number][] = []
    const expected: [string, number[]][] = []
    for (const [name, value] of Object.entries(candidate.inputs)) {
      if (!name.trim() || !unsigned(value)) return null
      inputs.push([name, value])
    }
    for (const [name, values] of Object.entries(candidate.expected)) {
      if (
        !name.trim() ||
        !Array.isArray(values) ||
        values.length !== candidate.cycles ||
        !values.every(unsigned)
      )
        return null
      expected.push([name, [...values]])
    }
    ids.add(candidate.id)
    tests.push({
      id: candidate.id,
      name: candidate.name,
      cycles: candidate.cycles,
      inputs: Object.fromEntries(inputs),
      expected: Object.fromEntries(expected),
    })
  }
  return tests
}

export function versionedBlockData(block: BlockData, depth = 0): BlockData {
  if (depth >= 64) throw new Error('Block hierarchy exceeds the supported save depth (64).')
  if (block.version !== undefined && block.version !== BLOCK_FORMAT_VERSION)
    throw new Error('Unsupported block format version; refusing to downgrade it.')
  const tests = readSavedBlockTests(block.tests)
  if (tests === null) throw new Error(`Block ${block.name} has malformed saved tests.`)
  return {
    ...block,
    version: BLOCK_FORMAT_VERSION,
    ...(block.tests === undefined ? {} : { tests }),
    nodes: block.nodes.map((node) =>
      node.block ? { ...node, block: versionedBlockData(node.block, depth + 1) } : { ...node },
    ),
  }
}
