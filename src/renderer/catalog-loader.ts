/**
 * Browser catalog loader (Sprint 18 S18-v3-3).
 *
 * Loads the fixture YAML into the same `World` shape the tests + solver use.
 * The renderer is a sandboxed page (no node:fs), so the fixtures are bundled
 * at build time via Vite's import.meta.glob (?raw) and parsed with the `yaml`
 * package. No second source of truth for "what a world is" — this produces the
 * identical World shape `loadWorld` produces from disk in the tests.
 */

import { parse as parseYAML } from 'yaml'
import type {
  ActiveVariableEntry,
  BehaviorEntry,
  Definition,
  Instance,
  Net,
  World,
} from '../cross-fk-validator.ts'

// Vite bundles every valid fixture as a raw string at build time.
const fixtureFiles = import.meta.glob('../../fixtures/valid/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Parse the bundled fixtures into a World, sorting each by kind. */
export function loadCatalogWorld(): World {
  const definitions = new Map<string, Definition>()
  const instances = new Map<string, Instance>()
  const behaviors = new Map<string, BehaviorEntry>()
  const activeVariables = new Map<string, ActiveVariableEntry>()
  const nets = new Map<string, Net>()

  for (const raw of Object.values(fixtureFiles)) {
    const data = parseYAML(raw) as Record<string, unknown>
    const id = typeof data.id === 'string' ? data.id : undefined
    if (id === undefined) continue

    if (data.kind === 'behavior') behaviors.set(id, data as unknown as BehaviorEntry)
    else if (data.kind === 'active_variable')
      activeVariables.set(id, data as unknown as ActiveVariableEntry)
    else if (data.kind === 'net') nets.set(id, data as unknown as Net)
    else if ('kind' in data) definitions.set(id, data as unknown as Definition)
    else if ('kind_ref' in data) instances.set(id, data as unknown as Instance)
  }

  return { definitions, instances, behaviors, activeVariables, nets }
}
