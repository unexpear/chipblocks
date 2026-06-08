/**
 * Material-role capability filtering (Sprint 19 S19-v3-34).
 *
 * A device's composition.requires declares, per material role, the capabilities a
 * material MUST enable — e.g. an LED's n_side must_enable [n_type_semiconductor,
 * direct_bandgap]; a resistor's resistive_material must_enable
 * [electrical_conduction]. The Properties panel uses this to offer only valid
 * materials in each dropdown, so you can't pick copper as an LED's semiconductor
 * (silicon, being indirect-bandgap, is correctly excluded too).
 *
 * must_enable is the model's MINIMUM. On top of it, for usability, a role that
 * doesn't call for a semiconductor won't list the specialized LED/diode
 * semiconductors — a resistor body or switch contact is a metal/alloy, not InGaN.
 * So the resistor + switch dropdowns show conductive metals/alloys; only the LED
 * (which requires a semiconductor) shows them.
 *
 * Sourced from the declared model — no hardcoded role→capability table. Pure +
 * unit-tested.
 */

type DefinitionLike = {
  id: string
  kind?: unknown
  enables?: unknown
  composition?: unknown
}

type RequiresMap = Record<string, { kind?: unknown; must_enable?: unknown }>

/** Capabilities that mark a role as specifically wanting a semiconductor. */
const SEMICONDUCTOR_CAPABILITIES = new Set([
  'semiconductor',
  'n_type_semiconductor',
  'p_type_semiconductor',
  'direct_bandgap',
])

/** Material id → the set of capabilities it enables (catalog materials only). */
export function materialCapabilities(
  definitions: Iterable<DefinitionLike>,
): Map<string, Set<string>> {
  const caps = new Map<string, Set<string>>()
  for (const def of definitions) {
    if (def.kind !== 'material') continue
    const enables = Array.isArray(def.enables) ? (def.enables as string[]) : []
    caps.set(def.id, new Set(enables))
  }
  return caps
}

/**
 * For each material role a device requires, the sorted catalog material ids that
 * satisfy it (capabilities ⊇ the role's must_enable). Returns {} for a definition
 * with no material roles.
 */
export function validMaterialsByRole(
  definition: DefinitionLike | undefined,
  capabilities: Map<string, Set<string>>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const composition = definition?.composition as { requires?: RequiresMap } | undefined
  const requires = composition?.requires
  if (!requires) return result

  for (const [roleKey, spec] of Object.entries(requires)) {
    if (spec?.kind !== 'material') continue
    const required = Array.isArray(spec.must_enable) ? (spec.must_enable as string[]) : []
    const roleWantsSemiconductor = required.some((cap) => SEMICONDUCTOR_CAPABILITIES.has(cap))
    result[roleKey] = [...capabilities.entries()]
      .filter(
        ([, capSet]) =>
          required.every((cap) => capSet.has(cap)) &&
          // Hide specialized semiconductors from roles that don't ask for one.
          (roleWantsSemiconductor || !capSet.has('semiconductor')),
      )
      .map(([id]) => id)
      .sort()
  }
  return result
}
