# v3 Sprint 5 — Active Variables proper schema

> **Status:** Sprint plan, opened 2026-06-03 against master tip `8a08d6f`.
> **Predecessor:** v3 Sprint 4 stress-tested the foundation with 7 new materials, 1 new interface kind, 3 new primitive devices, and 4 new instances. Test count grew 17 → 36. The foundation held without schema changes — all gaps either resolved cleanly or were captured as §15 deferred rows.
> **Scope:** add the project-level Active Variables (AV) registry. The `ref:` mechanism in instances exists today but doesn't resolve anywhere. Sprint 5 adds the schema + validator extension so `ref: default_solder_alloy` actually resolves through a registered AV to a real material value, with type-checking end-to-end.

---

## Sprint goal

Today the `ref:` mechanism is half-finished. `instance.schema.json` accepts `parameters.<x>.ref: <id>` as a string, but:

- No registry holds the AV definition + its value
- The cross-FK validator doesn't check that `ref` resolves anywhere
- No type-checking that the resolved AV value matches the consuming parameter's type

Sprint 5 closes the loop. After this sprint:

1. A project declares `active-var-default-solder-alloy.yaml` with `value: solder_sac305` (cited if relevant; user-set is also OK at project origin).
2. An instance with `parameters.solder_material.ref: default_solder_alloy` resolves through the registry to `solder_sac305` (the material).
3. The cross-FK validator confirms the full chain: AV exists → AV's `parameter_type` matches the consumer's type → the resolved material satisfies the consuming role's `must_enable` constraints.
4. Per-instance overrides work: replace `ref:` with explicit `value:` on a single instance to break out of the project default.

This is the foundation the auto-solder UX pattern (OBJECT-MODEL.md §15) is built on. After Sprint 5, the canvas sprint can implement snap-create + project-default + right-click-override using real-data primitives that already work.

---

## Non-goals (explicit)

- **No AV → AV chains.** An AV's value must be a direct value (or string id for ref types) — not another `ref:`. Chain resolution adds complexity (cycle detection, depth limits); deferred until a real use case demands it.
- **No community-pack AVs.** Sprint 5 limits AV origin to `project` or `user_local`. Community packs may suggest AVs in the future; that's a cross-pack-dependency question (§15).
- **No AV evaluator.** AVs that compute their value from other variables (e.g., "default_PCB_thickness = function of default_layer_count and default_dielectric_per_layer") are out of scope.
- **No default-resolution path.** When an instance omits a parameter and the definition's `default.value` kicks in, role-satisfaction still skips it — this is the existing §15 deferred item, unchanged by Sprint 5.
- **No multi-version AVs** — same as multi-version definitions, deferred per §15.
- **No UI, canvas, or visual editor.**
- **No physics engine.**

---

## Locked toolchain (inherited from Sprints 2-4)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict. No new dev dependencies expected.

---

## Deliverables

```
schemas/
├── active-variable.schema.json         NEW — registry-entry shape for an AV
└── identity.schema.json                UPDATE — add 'active_variable' to the kind enum

src/
└── cross-fk-validator.ts               EXTEND — resolve ref: through AV registry; two new error codes

fixtures/valid/
├── active-var-default-solder-alloy.yaml          NEW — material_ref-typed AV; value: solder_sac305
├── active-var-default-resistor-tolerance.yaml    NEW — quantity-typed AV; value: 5 percent
├── instance-solder-joint-001.yaml                 UPDATE — switch value: solder_sac305 to ref: default_solder_alloy
└── instance-solder-joint-002.yaml                 NEW — demonstrates per-joint override (value: solder_sn63pb37)

fixtures/invalid/
├── instance-ref-to-nonexistent-av.yaml            NEW — must fire 'unknown-active-variable'
└── av-type-mismatch.yaml                          NEW — quantity-typed AV consumed by material_ref slot, must fire 'active-variable-type-mismatch'

tests/
├── schema.test.ts                       UPDATE — add active_variable validator path
└── cross-fk.test.ts                     EXTEND — add must-fail tests for the two new error codes; existing valid-world test must still pass with the updated solder_joint_001 (now ref:-based)
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S5-v3-1** | `sprints/sprint-5.md` | This plan. |
| **S5-v3-2** | `active-variable.schema.json` + identity kind enum update | New schema composes identity/quantity/provenance/support-status. Fields: id, kind (const "active_variable"), origin (enum: [project, user_local]), layer (const "cross_layer"), parameter_type (same enum as definition.parameters.x.type), units / allowed (conditional), value (param_value), optional provenance, support, extensions. Identity schema kind enum gains 'active_variable'. tests/schema.test.ts picks active_variable validator by kind. |
| **S5-v3-3** | 2 valid AV fixtures (material_ref + quantity types) | active-var-default-solder-alloy (material_ref, value: solder_sac305) + active-var-default-resistor-tolerance (quantity, value: 5 percent). Stress-tests both AV value patterns. Both validate against active-variable.schema.json. |
| **S5-v3-4** | Convert solder_joint_001 to use `ref:` + add override fixture | instance-solder-joint-001 switches `parameters.solder_material.value: solder_sac305` to `parameters.solder_material.ref: default_solder_alloy`. New fixture instance-solder-joint-002 demonstrates per-joint override (explicit `value: solder_sn63pb37` for a single joint that needs leaded solder despite project-wide default). |
| **S5-v3-5** | Cross-FK validator extension — resolve refs + new error codes | Two new CrossFkError discriminated codes: `unknown-active-variable` (ref points at a missing AV) and `active-variable-type-mismatch` (AV's parameter_type doesn't match the consuming parameter's type). For material_ref / shape_ref AVs: chase through to the resolved object and recurse the kind-mismatch + role-satisfaction checks. Valid-world test must still report zero errors. |
| **S5-v3-6** | Invalid AV fixtures + must-fail tests | One fixture per new error code. cross-fk.test.ts extends with two new must-fail tests, programmatic mutation pattern matches Sprint 3 retro lesson #4. |
| **S5-v3-7** | Sprint 5 retro | Sub-commit log, lessons surfaced, new §15 rows if any. |

---

## Verification discipline (zero-trust, same as Sprints 2-4)

- Every JSON Schema 2020-12 keyword verified against the spec, not from memory.
- Every cross-FK validator behavior verified by an actual test fixture before claiming it works.
- No "validator catches X" claim without a fixture that triggers X and a test that asserts the error.
- All three gates (`npm test`, `npx tsc --noEmit`, `npx biome check .`) must be green before each sub-commit.
- YAML descriptions containing `:` get defensively wrapped in double quotes (Sprint 4 gotcha returned for the second time).

---

## Done criteria

- [ ] `active-variable.schema.json` exists, compiles in Ajv, validates the 2 new AV fixtures
- [ ] `identity.schema.json` kind enum includes `active_variable`
- [ ] 2 valid AV fixtures (material_ref + quantity types) validate cleanly
- [ ] `instance-solder-joint-001.yaml` is updated to use `ref: default_solder_alloy` and the cross-FK validator confirms the chain end-to-end (AV → solder_sac305 → role-satisfaction passes)
- [ ] `instance-solder-joint-002.yaml` demonstrates explicit value override; cross-FK confirms zero errors
- [ ] 2 invalid fixtures fire the two new error codes (unknown-active-variable, active-variable-type-mismatch)
- [ ] `npm test` shows all schema + cross-FK tests passing (count grows from 36)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written

---

## Open questions deferred to Sprint 6+ (or later)

Carried from earlier sprints + Sprint 4 retro:

- **Switch / stateful devices** — state machines, relays, MOSFETs (Sprint 6 candidate).
- **LED + semiconductor physics** — doped silicon variants + PN junction + photon emission.
- **Net model formalization** — `connects:` stays ad-hoc; nets become first-class.
- **`property_definition` registry shape.**
- **Preset/template model** — packaged components, specific battery chemistries.
- **Stackup model** — board-level concern.
- **Visual symbol library** — canvas sprint.
- **Auto-created interface UX pattern** — canvas sprint (now half-real after Sprint 5).
- **Alloy composition-by-weight schema field** — added in Sprint 4 retro.
- **Behavior-derives-value pattern** — added in Sprint 4 retro.
- **`min_count` enforcement in cross-FK** — added in Sprint 4 retro.
- **Default-resolution path** — when an instance omits a parameter, role-satisfaction should still check the default.

Potentially surfaced by Sprint 5:

- **AV → AV chains.** Sprint 5 forbids them. If pain surfaces (e.g., wanting `default_pcb_substrate: { ref: default_substrate_for_consumer_grade }`), capture as §15.
- **AV resolution depth limits** — moot if chains are forbidden.
- **Community-pack AVs** — Sprint 6+ when packs land.

---

## Sprint 5 opens here

Master tip when opened: `8a08d6f`. Sprint 4's catalog (8 materials, 2 shapes, 6 behaviors, 1 interface kind, 4 primitive devices, 5 instances) is the content Sprint 5 builds AVs ON TOP OF. Every new entry and every modified instance runs through schema validation + cross-FK before landing. Any gap surfaced is either fixed in-sprint with a new sub-commit, or recorded as a §15 deferred question with a documented fallback.
