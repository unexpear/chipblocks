/**
 * Prototype-pollution regression net. A `.chipblocks` file's node definitions, part footprint ids,
 * block port sides, and parameter keys are all UNTRUSTED strings — deserializeCircuit only type-checks
 * them as strings, never against a whitelist. Every lookup that reads one against a plain-object map
 * must use Object.hasOwn (not `map[key]` / `key in map`), or an inherited-member name like 'constructor'
 * / '__proto__' / 'toString' returns the Object constructor (truthy, not undefined) and the code either
 * crashes dereferencing it or uses the wrong value. Each case below WOULD crash / misbehave before the
 * hasOwn guards. Keep this list in sync when adding a new definition/key-driven map lookup.
 */
import { describe, expect, test } from 'vitest'
import { type BlockPort, blockLayout } from '../src/renderer/blocks.ts'
import type { CircuitFile } from '../src/renderer/circuit-file.ts'
import { footprintForPart } from '../src/renderer/footprint-assignment.ts'
import { defaultParameters } from '../src/renderer/part-defaults.ts'
import { serializeSpiceNetlist } from '../src/renderer/spice-netlist.ts'
import { terminalsOf } from '../src/renderer/symbols.tsx'

const POISON = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']

describe('prototype-member keys are handled safely across the definition/key-driven lookups', () => {
  test('defaultParameters(poison) does not crash (was JSON.parse(undefined) → SyntaxError)', () => {
    for (const def of POISON) {
      expect(() => defaultParameters(def)).not.toThrow()
      expect(typeof defaultParameters(def)).toBe('object')
    }
  })

  test('footprintForPart(poison) is undefined, not the Object ctor (was entry.options.includes crash)', () => {
    for (const def of POISON) expect(footprintForPart(def)).toBeUndefined()
  })

  test('terminalsOf(poison) falls back to the 2-terminal default (was the ctor via ??)', () => {
    for (const def of POISON) {
      const t = terminalsOf(def)
      expect(t.map((x) => x.id)).toEqual(['terminal_a', 'terminal_b'])
    }
  })

  test('blockLayout with a poison-sided port does not crash (was bySide[side].push not a function)', () => {
    for (const side of POISON) {
      expect(() =>
        blockLayout([{ id: 'p1', label: 'P', side } as unknown as BlockPort]),
      ).not.toThrow()
    }
  })

  test('a SPICE export of a poison-definition node reports it unsupported, no crash (was card.terminals.map)', () => {
    for (const def of POISON) {
      const circuit: CircuitFile = {
        format: 'chipblocks-circuit',
        version: 1,
        nodes: [{ id: 'x1', definition: def, x: 0, y: 0 }],
        wires: [],
      }
      let result: ReturnType<typeof serializeSpiceNetlist> | undefined
      expect(() => {
        result = serializeSpiceNetlist(circuit)
      }).not.toThrow()
      expect(result?.unsupported.some((u) => u.includes(def))).toBe(true)
    }
  })
})
