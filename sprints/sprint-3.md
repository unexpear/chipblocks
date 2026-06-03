# v3 Sprint 3 — Behavior registry + cross-FK validator

> **Status:** Sprint plan, opened 2026-05-20 against master tip `49758b0`.
> **Predecessor:** v3 Sprint 2 delivered 6 schemas + 8 fixtures + Vitest test runner; the object model is machine-checkable, the anti-placeholder rules are enforced.
> **Scope:** add the behavior registry (a new schema kind + first concrete behavior entries) and a cross-FK validator that walks references between objects and proves the role-satisfaction constraints actually hold. No UI, no physics engine, no devices.yaml content beyond what's needed to exercise cross-FK.

---

## Sprint goal

Two things, both load-bearing for everything above the foundation:

1. **Behavior registry.** Behaviors (`conducts_current`, `has_resistance`, `joule_heating`, etc.) are currently named in OBJECT-MODEL.md but don't have a concrete shape or any entries. Sprint 3 defines their schema and lands the first few entries the wire definition references.

2. **Cross-FK validator.** JSON Schema can't verify cross-references — e.g., when a wire instance picks `conductor_material: copper`, JSON Schema can't check that copper actually `enables: [electrical_conduction]`. Sprint 3 adds a separate validator pass (a TS module) that walks the loaded "world" (set of definitions + instances + registry entries), resolves every reference, and verifies the role-satisfaction constraints from OBJECT-MODEL.md §6.

After this sprint, a YAML file that says `behaviors: [conducts_current]` is checked against a real behavior registry — typos and unknown behaviors fail. A `wire_001` that picks `conductor_material: pretend_metal` fails because pretend_metal isn't defined. A `wire_001` that picks `conductor_material: insulator_material` (something that exists but doesn't enable electrical conduction) fails because the role constraint isn't satisfied.

---

## Non-goals (explicit)

- **No UI / canvas / visual editor** (still Sprint 4+ territory)
- **No physics engine** — cross-FK validation only checks *that* references resolve and constraints hold, not *what* the values compute to. Ohm's law evaluation comes later.
- **No `devices.yaml` content registry** beyond the wire definition (which already exists as a fixture). Sprint 3 keeps content minimal; the real content registries come later.
- **No `materials.yaml` content registry** beyond the copper definition (same).
- **No `property_definition` registry** — separate registry kind; deferred per OBJECT-MODEL.md §15.
- **No net model formalization** — `connects:` stays ad-hoc; deferred per §15.
- **No CI return** (per the standing user call).

---

## Locked toolchain (inherited from Sprint 2)

Sprint 2 settled the picks: Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 with strict flags. Sprint 3 inherits. No new dev dependencies expected unless the cross-FK validator surfaces a need.

---

## Deliverables

```
schemas/
└── behavior.schema.json           NEW — shape for behavior registry entries

fixtures/
├── valid/
│   ├── behavior-conducts-current.yaml      NEW — the conducts_current behavior entry
│   ├── behavior-has-resistance.yaml         NEW — the has_resistance behavior entry
│   ├── behavior-produces-joule-heat.yaml    NEW — produces_joule_heat (consequence of has_resistance)
│   └── (3 existing valid fixtures stay)
└── invalid/
    ├── (5 existing invalid fixtures stay)
    └── (cross-FK invalid fixtures land in a sub-folder or new files; see below)

fixtures/cross-fk/                  NEW — fixtures for cross-FK validator
├── valid/
│   └── world-wire-with-copper.yaml         a complete world: copper material + wire device + wire_001 instance
└── invalid/
    ├── unknown-conductor-material.yaml     wire_001 picks a material id that doesn't exist in the world
    ├── conductor-doesnt-enable.yaml         wire_001 picks a material that exists but doesn't enable electrical_conduction
    ├── unknown-behavior-claim.yaml          a device claims a behavior id that isn't in the registry
    └── (more as discovered)

src/cross-fk-validator.ts           NEW — the cross-FK validator function (loads a world, returns error list)

tests/
├── schema.test.ts                  EXTEND — also validate the 3 new behavior fixtures
└── cross-fk.test.ts                NEW — tests for the cross-FK validator
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S3-v3-1** | `behavior.schema.json` | New schema for the behavior registry kind. Identity + parameters_required (input contract) + evaluates (symbolic equation) + consequences (cascading behavior ids) + law (FK to future code impl) + support + extensions. Composes shared fragments via `$ref`. |
| **S3-v3-2** | 3 valid behavior fixtures | conducts_current (law: ohm), has_resistance (law: joule, consequences: [produces_joule_heat]), produces_joule_heat (law: thermal). All carry support.solver_status (no pass by absence). Tests/schema.test.ts validates them against behavior.schema.json. |
| **S3-v3-3** | `src/cross-fk-validator.ts` | New TS module. Function signature: `validateWorld(world: World): CrossFkError[]`. World = collection of definitions + instances + registry entries indexed by id + kind. Walks every reference (composition.uses ids, instance.definition link, conductor_material values, behavior list entries, etc.) and verifies each resolves to an object of the right kind. |
| **S3-v3-4** | Role-satisfaction check | Extend the cross-FK validator to handle `composition.requires.<>.must_enable` constraints. When an instance parameter has `satisfies_role: conductor_material`, the validator looks at the chosen material's `enables` list and verifies it covers every entry in `must_enable`. This is what OBJECT-MODEL.md §15 calls "role-satisfaction validation." |
| **S3-v3-5** | Valid cross-FK fixture + test | One complete "world" YAML containing copper + wire definition + wire_001 instance + the 3 behaviors. Test asserts the cross-FK validator returns zero errors. |
| **S3-v3-6** | Invalid cross-FK fixtures + must-fail tests | At least 3 invalid worlds: (a) wire_001 picks a material id that doesn't exist; (b) wire_001 picks a material that exists but doesn't enable electrical_conduction; (c) a device claims a behavior id that isn't in the registry. Tests assert the validator returns a specific error type for each. |
| **S3-v3-7** | Sprint retro | Sub-commit log, lessons, deferred questions still outstanding. |

---

## Verification discipline (zero-trust, same as Sprint 2)

- Every JSON Schema 2020-12 keyword verified against the spec, not from memory.
- Every cross-FK validator behavior verified by an actual test fixture before claiming it works.
- No "validator catches X" claim without a fixture that triggers X and a test that asserts the error.
- All three gates (`npm test`, `npx tsc --noEmit`, `npx biome check .`) must be green before each sub-commit.

---

## Done criteria

- [ ] `behavior.schema.json` exists, compiles in Ajv, validates the 3 new behavior fixtures
- [ ] Three behavior registry entries (conducts_current, has_resistance, produces_joule_heat) are well-formed YAML and validate
- [ ] `src/cross-fk-validator.ts` exports a function that loads a world and returns a structured error list
- [ ] Valid world fixture passes cross-FK validation (zero errors)
- [ ] 3+ invalid world fixtures fail cross-FK validation with specific, identifiable errors
- [ ] `npm test` shows all schema + cross-FK tests passing
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written

---

## Open questions deferred to Sprint 4+ (or later)

- **Net model** — still ad-hoc. The cross-FK validator handles ref-style relationships (parameter values pointing at materials, etc.) but not net topology. Net traversal lands when the validator engine needs it.
- **Project file format** — what does a `MyProject.chipblocks/` folder look like as a coherent collection of YAML files? Sprint 3 uses "world" as an in-memory test concept; the on-disk format is separate work.
- **Behavior emergence** — devices currently *explicitly* claim behaviors. Deriving behaviors from material × shape × interface is a different problem, deferred per §15.
- **`property_definition` registry** — same shape problem as behavior but for property concepts (what "resistance" means as a quantity). Probably Sprint 4.
- **Schema migration story** — when behavior.schema.json's shape changes later, how do old behavior YAML files keep loading? Defer until there's actually a v2 of any schema.

---

## Sprint 3 opens here

Master tip when opened: `49758b0`. Sprint 2's 6 schemas + 8 fixtures + test runner are the contract Sprint 3 builds on. The cross-FK validator runs *after* schema validation; both layers must pass for a world to be considered well-formed.

---

## Sprint 3 retro (closed 2026-05-20)

### What landed

| Sub-commit | What |
|---|---|
| `00d2231` | Sprint plan opened |
| `b1cba97` | S3-v3-1: behavior.schema.json — registry shape for named physical laws |
| `1c52254` | S3-v3-2: first 3 behavior registry entries (conducts_current, has_resistance, produces_joule_heat) + test runner extension |
| `f988e1f` | S3-v3-3: cross-FK validator skeleton (unknown-reference, kind-mismatch, unknown-behavior) |
| `0f85fdc` | S3-v3-4: role-satisfaction check (the role-unsatisfied error code) |
| `0193e48` | S3-v3-5: valid world fixture (added shape-path) + first cross-FK test (zero errors on valid world) |
| `7f8f484` | S3-v3-6: invalid world tests — all four CrossFkError codes fire |
| (this) | S3-v3-7: retro — Sprint 3 closes |

### Done criteria — all met

- [x] `behavior.schema.json` exists, compiles in Ajv, validates the 3 new behavior fixtures
- [x] Three behavior registry entries (conducts_current, has_resistance, produces_joule_heat) are well-formed YAML and validate
- [x] `src/cross-fk-validator.ts` exports a function that loads a world and returns a structured error list
- [x] Valid world fixture passes cross-FK validation (zero errors)
- [x] 4 invalid world tests fail with specific, identifiable errors (one per error code)
- [x] `npm test` shows 17 tests passing (12 schema + 5 cross-FK)
- [x] `npx tsc --noEmit` clean
- [x] `npx biome check .` clean
- [x] Sprint retro written

### Lessons surfaced

1. **The wire example surfaced a real fixture dependency.** The wire instance references `geometry: path`, but no path shape existed in `fixtures/valid/`. Cross-FK would have unknown-reference'd it. Added `shape-path.yaml` to complete the valid world. **General lesson:** when a definition declares a `composition.requires` role and a parameter satisfies it with a ref-type, the *referenced object's definition* must also be in the world. Cross-FK exposes these missing pieces — that's the point.

2. **`composition.requires` without a `satisfies_role` parameter is OK.** The wire's `endpoints` role has no parameter pointing at it (interface roles are satisfied by the future net model). The role-satisfaction check correctly skips it. **General lesson:** not every required role needs a parameter; structural roles (like endpoints satisfied by `connects:`) are legitimately skipped by parameter-driven validation. The net model is the future home for that check.

3. **Discriminated-union error codes made tests precise.** Each must-fail test asserts a specific code AND specific field values (not just "validation failed"). This is what catches *schema drift*: if a future change accidentally relaxes a rule, the test that depended on the strict version fails AND points at the exact constraint that stopped firing. **General lesson:** structured errors beat string-matching for testing validators.

4. **Programmatic world mutation beat fixture directories.** Sprint plan considered separate fixture directories for each invalid case. Switched to programmatic mutation in the test (load valid world → tweak one thing → run validator → assert specific error). Cleaner, less duplication, easier to maintain. **General lesson:** when testing "what happens when one thing is wrong," it's often cleaner to mutate from a known-good baseline than to maintain N parallel fixture sets.

5. **Biome's `useLiteralKeys` interacts with `noUncheckedIndexedAccess`.** Auto-fix marked "unsafe" because both index forms are equivalent under strict, but the lint still prefers dot notation. Applied manually. **General lesson:** TS strict's index-access discipline and Biome's dot-notation preference are compatible but the auto-fix is conservative about them.

6. **Default-resolution path is deferred — explicit only for now.** Role-satisfaction only checks parameters where the instance supplied an explicit value. If the instance omits a parameter and the definition's `default.value` is used, that default isn't checked yet. **General lesson:** Sprint 3's role-satisfaction is a real check on explicit choices; default-resolution validation needs the default-resolution path to be wired first.

### Unresolved questions (still deferred per OBJECT-MODEL.md §15)

- Default-resolution path — when an instance omits a parameter, the definition's default kicks in; role-satisfaction should still check the default. Currently skipped.
- Net model — `connects:` syntax stays ad-hoc; the cross-FK validator doesn't traverse net topology yet.
- `property_definition` registry shape — same as the behavior registry but for property concepts.
- Multi-version definitions (Sprint 7+).
- Cross-pack dependency declarations (Sprint 8+).
- Schema migration story.
- Visual symbol library (canvas sprint).
- Stackup model (board/chip-level concern).
- Preset/template model (packaged components like `0603 resistor`).

### What this unblocks

After Sprint 3 close:
- **Cross-references are honest.** A wire instance that picks an insulator material gets `role-unsatisfied` at validation time. The model can't lie by accident.
- **Behavior registry is real.** When a future device claims `behaviors: [conducts_current]`, the validator confirms `conducts_current` exists with its parameter_required list and solver_status declared.
- **Real content authoring becomes possible.** v3 Sprint 4 (whatever its scope) can start filling out `fixtures/valid/` or a `data/` directory with real materials/devices/behaviors without invented values — every entry runs through schema + cross-FK.
- **The validator's vocabulary is locked.** Four error codes (`unknown-reference` / `kind-mismatch` / `unknown-behavior` / `role-unsatisfied`) cover the load-bearing relationship checks. Future checks (default-satisfaction, net-topology, behavior-input-compatibility) get added as new codes alongside, not as breaking changes.

### Sprint 3 closed

All sub-commits land cleanly on master. 17 tests pass. The object model now has both shape-validation AND relationship-validation; the gap between "schema says it's well-formed" and "cross-FK says it actually means what it claims" is closed.
