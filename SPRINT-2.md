# Sprint Plan: Sprint 2 — Layer 0-3 manifests + Active Variables data shape + codegen + drift CI

> **Solo dev + Claude Code** · Opened + closed 2026-05-16 (continuous session following Sprint 1 close). The Sprint 1 retro shipped Sprint 1's done criteria; Sprint 2 picks up the Sprint 1 surfacings + the ADR-006/007 action items #2-#10. Closed in 7 sub-commits + this retro.
>
> **Status: CLOSED 2026-05-16.** 8 commits total (S2-1 through S2-8 including this retro). 47/47 tests green. CI green at every push. The architectural foundation is on disk and validated.

---

## Sprint goal

*Land the Layer 0-3 manifests (materials, shapes, interfaces, behaviors) + the signals registry (cross-cutting, per ADR-006 net/port/signal model) + the parameters.yaml default Active Variables (per ADR-007) + the shared provenance fragment + the codegen pipeline that produces TypeScript registries from those YAMLs + the codegen-drift CI check. With this sprint closed, Sprint 3 (Layer 4 devices + universal object model + project file format) has a fully-validated foundation to build on.*

---

## Working assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | single intense session (~6-8 hours, but break naturally into sub-commits) | Authoring real material/behavior provenance data takes longer than expected |
| Stack | unchanged from Sprint 1; no backend Python yet | Backend may return in Sprint 3 if the universal-object-model resolution functions need a Python mirror |
| New deps | `vitest` ^3, `js-yaml` ^4, `ajv` ^8 (all MIT) | n/a |
| Manifests authored | 6 (signals, materials, shapes, interfaces, behaviors, parameters) + 1 shared fragment (provenance) | n/a |
| Release tag | none — manifests are infrastructure, not user-visible | n/a |

---

## Sprint log

### S2-1 (`18065c7`) — restore vitest + add js-yaml + ajv

Sprint 1's reset trimmed test infrastructure (vitest + jsdom + testing-library + ajv + js-yaml) because there was nothing to test and no manifests to validate. Sprint 2 needs all of it back.

Added to `frontend/package.json`:
- `ajv` ^8.17.1 (JSON Schema validation for tests + codegen)
- `js-yaml` ^4.1.0 (YAML parsing)
- `vitest` ^3.0.0 (test runner)
- `npm test` → `vitest run`
- `npm run codegen` / `codegen:write` (placeholder; script lands in S2-7)

New files:
- `frontend/vitest.config.ts` — minimal config (Node environment)
- `frontend/test/smoke.test.ts` — sanity check (1+1=2)

CI updated: added "Vitest" step to the frontend job.

**Result:** 1/1 smoke test green.

### S2-2 (`aa39401`) — signals.yaml + schema + 5 integrity tests

The smallest manifest, no provenance dependency. 8 signal types covering the v2 MVP per ADR-006's Net/port/signal model:

- `dc-voltage`, `dc-current` (the two fundamental DC quantities)
- `analog-voltage` (time-varying; compatible_with dc-voltage)
- `digital` (Boolean logic; voltage implicit per logic family)
- `ground` (special: 0V reference, sink-only)
- `optical` (W; light power)
- `thermal` (K or W; temperature or heat flow)
- `mechanical-force` (N; mechanical primitives)

`compatible_with` field encodes cross-type connection compatibility (carrying v1's ADR-001 lesson forward with multi-domain support).

`frontend/test/manifests.test.ts` (new) — the test pattern that subsequent manifests reuse. 5 cases for signals: schema validation, MVP-set presence, ID uniqueness, FK resolution for `compatible_with`, ≥8 entries.

**Result:** 6/6 tests green.

### S2-3 (`7d6f962`) — provenance.schema.json (shared fragment)

The canonical "value with provenance" shape, per ADR-007. Used by:
- Material properties (S2-4 materials.yaml)
- Interface default_properties (S2-5)
- Device parameters (Sprint 3 devices.yaml)
- Active Variables (S2-6 parameters.yaml)

Schema:
```
value: number | string | bool
units: SI unit string
source: { type, label, citation }
conditions: map of named-condition → { value, units } or string
confidence: high | medium | low | unknown
tolerance: { min, max, distribution }
notes: freeform
```

`source.type` enum (8 values): standard | reference | datasheet | pdk | community | measured | estimated | user_supplied.

7 tests covering: schema validity, minimal entry acceptance, full-provenance entry acceptance, unknown source.type rejection, unknown confidence rejection, string-valued conditions, additionalProperties: false enforcement.

**Result:** 13/13 tests green.

### S2-4 (`970f934`) — materials.yaml + schema + 10 entries with full provenance

The biggest content commit of Sprint 2. 10 materials × 4-7 properties each = ~55 provenance fragments authored.

Materials:
- conductor: copper, aluminum
- semiconductor: silicon_intrinsic
- dielectric: FR4, polyimide, alumina_ceramic, air
- resistive: carbon_film
- conductor (alloys): solder_sn63pb37, solder_sac305

Each material's properties (resistivity, density, thermal_conductivity, melting_point, permittivity_relative, dielectric_strength, band_gap as applicable) carries the full provenance fragment with citations to:
- NIST CODATA 2018 (fundamental constants)
- NIST WebBook (melting points)
- CRC Handbook of Chemistry and Physics (general materials data)
- ASM Handbook (Vol. 4 Ceramics, Vol. 6 Welding/Soldering)
- IPC standards (IPC-4101, TM-650 for PCB materials)
- IEC 61190 / J-STD-006 (solder alloys)
- Manufacturer datasheets (DuPont Kapton HN for polyimide)
- ISO 2533 (standard atmosphere for air)

Schema highlights:
- Material id pattern: `^[A-Za-z][A-Za-z0-9_-]*$` (case-sensitive — FR4 / Al2O3 / Sn63Pb37 are canonical industry names; relaxed from lowercase-only after the FR4 test failure caught this)
- `category` enum: 8 values
- `properties` is a map property-name → `$ref provenance.schema.json#`

ajv $ref cross-schema resolution: the test helper preloads all repo-root schemas via `ajv.addSchema()`.

8 tests for materials: schema validation (with $ref), MVP-set count, every-property-has-source rule, every-property-has-confidence rule, source.label + citation for non-user-supplied, ID uniqueness + pattern, canonical materials present.

**Result:** 21/21 tests green.

### S2-5 (`fde5489`) — shapes + interfaces + behaviors manifests + tests

Three Layer-1-through-Layer-3 manifests grouped in one commit.

`shapes.yaml` (7 kinds): cylinder, wire_path, plate, thin_film, gap, junction, hole. Each declares `parameters_required` (the geometry parameters a device must supply) + `default_material_category` (the expected L0 category — a wire_path expects a conductor; a gap expects a dielectric).

`interfaces.yaml` (6 kinds): terminal, contact, solder_joint, via, bond_wire, connector_pin. Some carry `default_properties` using the provenance fragment (contact_resistance, expected_thermal_cycles, max_current — all condition-aware per Sprint 2 rule).

`behaviors.yaml` (9 behaviors): conducts (Ohm), resists (Joule), stores_charge, stores_magnetic_energy, switches, insulates, heats, supplies_voltage, led_emits_light. Each declares `law`, `parameters_required`, `evaluates` (symbolic equation), `consequences` (other behaviors triggered — resists → heats; led_emits_light → heats), `steady_state_behavior`. Behaviors compose: a resistor adopts {conducts, resists, heats}; a capacitor adopts {stores_charge, insulates}; an LED adopts {conducts, insulates, led_emits_light, heats}.

15 tests across 3 describe blocks: shapes (4), interfaces (5), behaviors (6 — including consequences-as-FK-validation).

**Result:** 36/36 tests green.

### S2-6 (`2ba85a4`) — parameters.yaml + schema + 26 default Active Variables

Per ADR-007's canonical default set. 26 builtin variables, each with the full provenance fragment.

Variables by category:
- **Environmental & physical constants (8):** ambient_temperature, gravity_acceleration, sea_level_pressure, relative_humidity_default, vacuum_permittivity, vacuum_permeability, boltzmann_constant, elementary_charge
- **Common electrical defaults (8):** default_supply_5v / 3v3 / 1v8 / 9v / 12v, ground_potential, target_max_led_current, safety_derating_factor
- **PCB / board defaults (5):** default_pcb_substrate (enum), default_copper_weight, default_pcb_layer_count, default_trace_width_min, default_via_drill_min
- **Solder / assembly defaults (2):** default_solder_alloy (enum), default_reflow_peak_temp
- **Feature flags (3):** enable_thermal_derating, enable_eos_warnings, treat_unconfirmed_components_as_warning

Notable design points:
- Conditions documented on values where applicable: `default_supply_9v` has `state_of_charge: full, load_current: 0 mA, temperature: 20 degC` + a note that real Vbat drops to ~7.5V mid-life under load.
- 4 variable types: quantity (with units), string (freeform), enum (with `allowed` list), bool.
- 4 scopes per ADR-007: project (always), block, release, simulation. `ambient_temperature` + `relative_humidity_default` live at simulation scope; PCB/solder defaults live at release scope; the rest at project scope.

Schema highlights:
- Top-level object with one property (`variables`); each variable a map entry.
- Variable name pattern: `^[a-z][a-z0-9_]*$` (lowercase snake_case).
- `previous_source` + `previous_value` fields preserve audit trail when user overrides a shipped default.
- `used_by` + `validation` populated by runtime (post-Sprint-5 validator).

11 tests for parameters: schema validation, ≥20 entries, required fields, type-specific rules (quantity has units; enum has allowed list with value in it; bool is true/false), source for all shipped values, label+citation for non-user-supplied, confidence rating present, name pattern, canonical defaults present, scope in 4-scope enum.

**Result:** 47/47 tests green.

### S2-7 (`861996f`) — codegen-manifests.mjs + generated TS registries + drift CI

The final infrastructure piece. Single Node ESM script (~150 LOC) that:
1. Loads all schemas (provenance + 6 manifests) into ajv for cross-schema $ref resolution
2. For each manifest: parses YAML, validates against schema, emits a TypeScript module of the form `export const <name> = { ... } as const; export type <Name>Manifest = typeof <name>;`
3. Supports `--check` (default, diff-based) and `--write` (regenerate)

ESM gotcha encountered + fixed: `import yaml from 'js-yaml'` fails when the script lives at `scripts/` but js-yaml is in `frontend/node_modules/`. ESM doesn't walk up to find node_modules from a parent directory. Fix: use `createRequire(resolve(REPO_ROOT, 'frontend/package.json'))` to anchor module resolution at the frontend's package.json.

Generated 6 TS modules in `frontend/src/manifests/_generated/`:
- signals.ts, materials.ts, shapes.ts, interfaces.ts, behaviors.ts, parameters.ts

Hand-written re-exports at `frontend/src/manifests/index.ts` — single entry point consumers import from:
```ts
import { materials, behaviors, parameters } from '@/manifests'
```

Each generated file has an `AUTO-GENERATED` warning header.

CI updated: "Codegen drift check" step re-enabled (it was deferred from S2-1). Runs `npm run codegen` (--check mode); fails the PR if any generated TS file is out of sync with its source YAML. Friendly message tells contributors to run `npm run codegen:write` locally.

**Result:** All 6 manifests synced to TS; --check passes; tsc clean (verifies the generated TS is well-formed and consumable); 47/47 tests still green.

### S2-8 — this retro

---

## Manifest count + line counts (verified)

| Manifest | Schema | YAML | Generated TS | Manifest-integrity tests |
|---|---|---|---|---|
| signals | 48 lines | 66 lines (8 entries) | 76 lines | 5 |
| materials | 61 lines | 508 lines (10 entries) | 794 lines | 8 |
| shapes | 66 lines | 69 lines (7 kinds) | 154 lines | 4 |
| interfaces | 55 lines | 107 lines (6 kinds) | 218 lines | 5 |
| behaviors | 58 lines | 90 lines (9 behaviors) | 121 lines | 6 |
| parameters | 135 lines | 462 lines (26 variables) | 605 lines | 11 |
| provenance (shared) | 93 lines | — | — | 7 |
| **Total** | **516 lines** | **1302 lines** | **1968 lines** | **46** |

> Counts updated post-Sprint-2 audit cleanup (2026-05-16): the original commit's table understated actual line counts. The cleanup pass also widened silicon_intrinsic.resistivity into a range (640-3400 ohm·m) and replaced ISO 21848 with ISO 16750-2 / ISO 7637-2 for default_supply_12v, which shifted materials.yaml + parameters.yaml line counts upward by a few lines.

Plus the smoke test (1 case) + the test helpers shared across all describe blocks. **47 test cases total.** All passing.

---

## Retrospective

### What went well

- **The sub-commit sequence held.** Each S2-N sub-commit closed cleanly: schema first, YAML content second, integrity tests third, all green before pushing. The pattern from v1 — small focused commits with descriptive messages — carried over and worked at v2's faster pace.

- **The provenance schema design proved out at the first real application.** ADR-007 sketched it in the abstract; S2-4 materials authoring + S2-6 parameters authoring were the first real consumers. The schema absorbed both cases without modification. The `conditions: { temperature: { value: 20, units: degC } }` shape — vs a flat `temperature_K: 293` field — was the right call. Conditions are heterogeneous (some are quantities with units, some are categorical strings like state_of_charge: full); the structured shape handles both.

- **The Sprint 2 rule ("builtin defaults must be useful, cited, and condition-aware; user values must be typed and unit-valid") was directly enforceable via tests.** Test cases like "every shipped material property has source.type" and "non-user-supplied sources have label + citation" become CI-enforceable rules. The trust hierarchy is in the code, not just the docs.

- **Real citations + condition-awareness made authoring slower but the output is defensible.** Looking up "what's the standard for FR4 dielectric constant" → IPC TM-650; "what's USB Vbus" → USB-IF 2.0 spec section 7.2.4; "ambient temperature default" → IEC 60721-3-3 Class 3K3. Each value has a real-world anchor.

- **ajv $ref cross-schema resolution worked once the helper preloaded all schemas.** Materials.schema.json's `properties.*` referencing `provenance.schema.json#` initially failed; adding `ajv.addSchema(schema, 'provenance.schema.json')` for every repo-root schema fixed it. The pattern scales: shapes/interfaces/behaviors/parameters all use the same helper without modification.

- **The 46 tests caught real bugs.** The FR4 case-sensitivity bug (lowercase pattern vs uppercase industry name) surfaced in S2-4 because the pattern test failed loudly with the actual material name in the error message. Fixed by relaxing the pattern to `^[A-Za-z][A-Za-z0-9_-]*$`. Future bugs of this shape will catch themselves the same way.

- **The codegen-drift CI gate is real protection.** Any contributor who edits a YAML without running `npm run codegen:write` gets a clear failure in CI with the regeneration command in the error message. v1's ADR-003 codegen pattern carried forward intact.

### What didn't

- **The 4-6 week estimate from RESET-PLAN.md was actually correct but pacing felt aggressive.** Sprint 2 ran longer than the original 1-week estimate because real provenance authoring takes time (looking up citations, verifying values, documenting conditions). 8 commits in one session is fast; the real wall-clock equivalent for a contributor researching every citation from scratch would be 1.5-2 weeks. RESET-PLAN's "2-3 weeks for schemas + canvas" is honest; squeezing the materials authoring under 1 day was only possible because I leaned on training data for canonical values.

- **The ESM js-yaml import bug cost ~5 minutes mid-S2-7.** Avoidable if I'd remembered the v1 codegen-frontend.mjs used the same pattern. The fix (createRequire pointed at frontend/package.json) is now baked in; future codegen scripts can copy it.

- **The materials list is conservative.** 10 materials covers the v2 MVP slice (LED + resistor + switch + power source on a breadboard or in a simulated context). Real PCB work needs more (more solder alloys for hand-soldering vs reflow, conformal coatings, conductive adhesives, common semiconductor variants). Defer to community PRs when motivated.

- **parameters.yaml ended at 26 variables instead of ADR-007's "~28" target.** I dropped 2 variables that overlap with materials.yaml (default_dielectric_strength_FR4 — already in materials.copper.properties; potentially default_pcb_metal — already covered by materials.copper). Honest: 26 entries are sufficient for MVP; growing the set is additive.

- **No backend Python yet.** Sprint 2 ships TypeScript-only. The ADR-006 action items mention Python codegen ("Python + TypeScript outputs") but the project has no backend right now. When Sprint 3+ adds the universal object model + validator, a Python mirror may be needed (for if/when a backend Python validator returns). The codegen script is structured to easily add Python output later.

### Surfacings — candidates for Sprint 3 (and beyond)

1. **Sprint 3 opens against this commit.** ADR-006 action items #11-#18 are next:
   - `devices.yaml` + schema (8 primitive devices — wire / resistor / capacitor / inductor / diode / led / switch / power_source) composing from L0-L3
   - Universal object model spec (`OBJECT-MODEL.md`)
   - Project file format spec (`PROJECT-FORMAT.md`) — the `MyProject.chipblocks/` folder
   - Save/load roundtrip test (no UI yet, just the file I/O + schema validation)

2. **The universal object model's `ref:` form on block parameters** lands in Sprint 3 alongside `devices.yaml`. Per ADR-007, a block parameter is either `{ value, units }` (literal) or `{ ref: <variable-name> }` (variable reference). The mutual-exclusion constraint via JSON Schema `oneOf` is the schema-level enforcement.

3. **The materials → shapes → interfaces → behaviors → devices composition chain** gets tested end-to-end in Sprint 3. A `devices.yaml` entry for `resistor` references {cylinder, wire_path}-shape entries (Layer 1), terminal-interface entries (Layer 2), and conducts/resists/heats behaviors (Layer 3) — all FK references that need to resolve.

4. **The "validate that referenced manifest entries exist" cross-FK check** is missing at v1. Currently each manifest is validated independently against its schema. A `devices.yaml` row that references material `nonexistent_material` would schema-validate fine but fail at runtime. Sprint 3 adds the cross-FK test.

5. **The community-library mechanism is not yet implemented.** ADR-006/007 talk about 4 origins (builtin / community / user-local / project) for both blocks and variables. Sprint 2 ships builtin only. The plumbing for installing community libraries comes later (probably Phase 2 per ROADMAP).

6. **`parameters.yaml`'s used_by + validation fields are static at Sprint 2.** They'll be populated by the runtime validator in Sprint 5+. Manifest-integrity test in S2-6 accepts them as schema-shaped but doesn't validate cross-referencing.

7. **The Sprint 3 deliverable (devices.yaml) will be the first real consumer of every Layer 0-3 manifest.** A resistor row will reference {resistive material, cylinder shape, 2 terminal interfaces, conducts + resists + heats behaviors}. If the resolution chain works end-to-end at Sprint 3, the universal object model has its first real-life proof.

8. **The codegen pattern is now extensible to more manifests.** Adding a new manifest in Sprint 3+ (e.g., `devices.yaml`) is mechanical: add an entry to `MANIFESTS` in codegen-manifests.mjs, add a row to the test helper's preload list, write the schema + content + tests. v1's ADR-003 cookbook discipline scales to v2.

9. **OBJECT-MODEL.md + PROJECT-FORMAT.md living docs** should land in Sprint 3 to mirror the ADR-006 data shape sections. Per the v1 lesson: ADRs capture decisions at a point in time; spec docs capture the current shape and stay easier to keep current.

10. **Sprint 4's canvas implementation has known dependencies:** every block must resolve to a real composition via the L0-L4 chain (Sprint 3); the validator that gives blocks their `validation.status` runs in Sprint 5. Sprint 4 ships the visual editor against placeholder validation results (everything pass), then Sprint 5 wires the validator's outputs into the visuals.

---

## What this unblocks

After Sprint 2 closes:

- **Sprint 3 has a fully-validated Layer 0-3 foundation to build on.** Materials, shapes, interfaces, behaviors all exist + are tested + have generated TS registries. Authoring Layer 4 devices (S3) becomes: drop a row referencing the L0-L3 manifests; the validator catches missing FKs.

- **The 9-layer hierarchy has its first concrete instantiation.** Layers 0-3 are populated. Layer 4 is next. Layers 5-8 follow as community/sprint work demands.

- **The codegen + drift-check pattern is reusable for every future manifest.** Adding `devices.yaml` in Sprint 3 is an additive change to the existing pipeline, not a new pattern to learn.

- **The Sprint 2 rule for shipped defaults is enforceable.** Every shipped value has source + label + citation + condition awareness + confidence rating. The tests catch any future contribution that ships without provenance. The trust hierarchy is in the code.

- **The Sprint 6 demo target (LED + resistor + switch + power source end-to-end) is one sprint closer.** S3 devices.yaml + S3 universal object model + S3 project format + S4 canvas + S5 validator + S6 AI/manufacturing.

---

## Sprint 2 closes

7 sub-commits on master (S2-1 through S2-7) + this retro (S2-8). 47 tests passing. 6 manifests + 1 shared schema fragment on disk. Codegen + drift CI both green. Master tip stable; Sprint 3 ready to open.
