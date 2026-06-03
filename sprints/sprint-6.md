# v3 Sprint 6 — Switch + stateful devices (state-machine pattern)

> **Status:** Sprint plan, opened 2026-06-03 against master tip `03e7f40`.
> **Predecessor:** v3 Sprint 5 delivered the Active Variable registry — `ref:` resolves end-to-end through the cross-FK validator. Test count grew 36 → 41. The motivating §15 row (auto-created interface UX) now has working machinery underneath.
> **Scope:** add the first stateful primitive — a switch. Sprint 6 designs how state is *declared* at the model level (not simulated — that's a far-future canvas/simulator concern), lands a SPST switch with state machine, and locks the pattern that relays / latches / MOSFETs will reuse.

---

## Sprint goal

Today's catalog has no stateful devices. A wire, resistor, capacitor, and power source are all static — their values don't change because of internal state. A switch is different: it has discrete states (open, closed) and rules for transitioning between them. Sprint 6 introduces the **state-machine pattern** as a declarative description in device definitions.

Crucially: Sprint 6 *does not* simulate the FSM. The state machine is **descriptive only** — like a behavior is a description of a physics law without evaluating it. The schema captures "a SPST toggle switch has two states (open, closed) and one transition (actuated toggles between them)" as machine-readable documentation. Future sprints (canvas, simulator) read this machine to render UI, drive simulation, and let users actuate switches.

The pattern is consistent with how `behaviors:` works — declare the law, don't evaluate. Both are honest about absence: the model says what's true without faking solving.

After this sprint:

1. The schema gains an optional `state_machine` block on device definitions.
2. The cross-FK validator gains one new error code (`state-machine-invalid-transition`) checking that transitions reference declared states.
3. A SPST toggle switch primitive device + first instance land in the catalog.
4. The pattern is set: future stateful devices (SPDT switches, relays, MOSFETs, flip-flops) attach their own state_machine using the same shape.

---

## Non-goals (explicit)

- **No runtime state tracking.** The model declares the FSM; nothing tracks "which state is solder_joint_017 currently in." That's a canvas/simulator concern.
- **No multi-pole switches (SPDT, DPDT, 4PDT).** SPDT brings state-dependent connection topology (which throw is wired through), which is a richer schema question deferred to Sprint 7+ once the simple case is proven.
- **No relays.** Relays use the same FSM pattern but bring coil/armature/contact modeling that's substantial. Sprint 7+.
- **No MOSFETs.** Same — gate-drive + drain-source state + threshold-voltage parameter set; Sprint 8+.
- **No latches / flip-flops.** Multi-input FSMs with edge triggers; Sprint 9+.
- **No state-dependent values.** A switch in `open` state has different resistance (∞) than `closed` (~0). Linking state to property values needs the behavior-derives-value pattern first (still §15 deferred).
- **No formal trigger taxonomy.** Trigger remains a free string in Sprint 6. The enum hardens when 3-4 stateful device types exist (relay + MOSFET + switch + flip-flop) and the actual trigger types are knowable. Captured as §15 when needed.
- **No UI, canvas, or physics engine.**

---

## Locked toolchain (inherited from Sprints 2-5)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict. No new dev dependencies expected.

---

## Deliverables

```
schemas/
└── definition.schema.json              UPDATE — add optional state_machine field

src/
└── cross-fk-validator.ts               EXTEND — state-machine-invalid-transition error code

fixtures/valid/
├── behavior-switches-circuit.yaml      NEW — behavior registry entry
├── device-switch.yaml                  NEW — SPST toggle switch with state_machine
└── instance-switch-001.yaml            NEW — a specific panel-mount toggle instance

tests/
└── cross-fk.test.ts                    EXTEND — one new must-fail test for the new error code

OBJECT-MODEL.md                          UPDATE — new §6.5 "State machines as declarative description"
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S6-v3-1** | `sprints/sprint-6.md` | This plan. |
| **S6-v3-2** | Schema extension + OBJECT-MODEL.md §6.5 | Add optional `state_machine` field to definition.schema.json with `initial_state` (string), `states` (object keyed by state id), `transitions` (array). Add §6.5 "State machines as declarative description" to OBJECT-MODEL.md describing the pattern, when devices need it, and how it relates to behaviors. |
| **S6-v3-3** | `behavior-switches-circuit.yaml` | New behavior registry entry — switches_circuit. Parameters_required: state (enum: open, closed). Evaluates: descriptive (resistance is ∞ when open, ~0 when closed); the actual derived-value linkage is §15 deferred. |
| **S6-v3-4** | `device-switch.yaml` — SPST toggle | First stateful device. Composition.requires: contact_material (kind material, must_enable electrical_conduction) + endpoints (kind interface, min_count 2). State_machine: states open + closed, initial_state open, single transition (actuated toggles). Behaviors include switches_circuit. |
| **S6-v3-5** | `instance-switch-001.yaml` | A specific SPST panel-mount toggle, copper contacts. |
| **S6-v3-6** | Cross-FK extension — state-machine validity check | New error code `state-machine-invalid-transition`. Verifies every transition's `from:` and `to:` reference a declared state, and that `initial_state` is declared. Programmatic must-fail test added. |
| **S6-v3-7** | Sprint 6 retro | Sub-commit log, lessons, any new §15 rows surfaced (e.g., trigger taxonomy if it bites; multi-pole switches; runtime state tracking). |

---

## Verification discipline (zero-trust, same as Sprints 2-5)

- Every JSON Schema 2020-12 keyword verified against the spec, not from memory.
- Every cross-FK validator behavior verified by an actual test fixture before claiming it works.
- No "validator catches X" claim without a fixture that triggers X and a test that asserts the error.
- All three gates (`npm test`, `npx tsc --noEmit`, `npx biome check .`) must be green before each sub-commit.
- YAML descriptions containing `:` get defensively wrapped in double quotes — Sprint 2 + Sprint 4 gotcha that keeps re-surfacing.

---

## Done criteria

- [ ] `definition.schema.json` accepts an optional `state_machine` block; existing devices without state machines still validate (resistor, capacitor, power_source, wire, etc.)
- [ ] OBJECT-MODEL.md §6.5 describes the state-machine pattern and how it differs from capabilities + behaviors
- [ ] `behavior-switches-circuit.yaml` validates against behavior.schema.json
- [ ] `device-switch.yaml` validates against definition.schema.json with state_machine populated
- [ ] `instance-switch-001.yaml` validates against instance.schema.json; cross-FK confirms zero errors (copper enables electrical_conduction → contact_material role satisfied)
- [ ] Cross-FK validator emits `state-machine-invalid-transition` when a transition references an undeclared state; programmatic must-fail test fires
- [ ] `npm test` shows all tests passing (count grows from 41)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written

---

## Open questions deferred to Sprint 7+ (or later)

Carried from earlier sprints + likely Sprint 6 surfacers:

- **Per-instance runtime state.** Which state is a given switch instance currently in? Canvas/simulator sprint concern.
- **Multi-pole switches (SPDT, DPDT, 4PDT).** Needs state-dependent connection topology — Sprint 7+.
- **Relays.** Coil + armature + contact pole-throw config — Sprint 7+.
- **MOSFETs.** Gate-drive + threshold voltage + drain-source state — Sprint 8+.
- **Latches / flip-flops.** Edge-triggered FSMs with set/reset/clock — Sprint 9+.
- **State-dependent property values.** Resistance, leakage current, etc. that vary by state — needs behavior-derives-value pattern first.
- **Trigger taxonomy as enum.** Sprint 6 leaves trigger as a free string. Locks to enum when 3-4 stateful device types are in the catalog.
- **LED + semiconductor physics.** Sprint 7+ once the educational anchor circuit (battery → switch → resistor → LED) becomes possible.

Plus all carried-forward §15 rows (default-resolution, net model, preset/template, alloy composition, behavior-derives-value, min_count enforcement, AV chains, canvas UX patterns).

---

## Sprint 6 opens here

Master tip when opened: `03e7f40`. Sprint 5's Active Variables work (the schema-validator-test triple for a new kind) is the immediate precedent — Sprint 6 follows the same recipe but extends an existing schema (definition) rather than adding a new kind. The state_machine block is optional on definitions; existing static devices stay unchanged. Any gap surfaced is either fixed in-sprint or recorded as a §15 deferred question.
