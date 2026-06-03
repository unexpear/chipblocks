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

---

## Sprint 6 retro (closed 2026-06-03)

### What landed

| Sub-commit | What |
|---|---|
| `738f2e9` | S6-v3-1: Sprint 6 plan opened |
| `1922c94` | S6-v3-2: state_machine schema field on definition.schema.json + OBJECT-MODEL.md §6.5 |
| `424483a` | S6-v3-3: switches_circuit behavior registry entry |
| `9fef17e` | S6-v3-4: switch_spst_toggle device — first stateful primitive (renamed from generic 'switch') |
| `3d2c291` | S6-v3-5: switch_001 instance — panel-mount SPST toggle with copper contacts |
| `b1276b7` | S6-v3-6: Cross-FK extension — state-machine-invalid-transition error code + must-fail test |
| (this) | S6-v3-7: retro — Sprint 6 closes |

### Done criteria — all met

- [x] `definition.schema.json` accepts an optional `state_machine` block; existing devices without state machines still validate (resistor, capacitor, power_source, wire — all confirmed by the 36-fixture schema suite)
- [x] OBJECT-MODEL.md §6.5 describes the state-machine pattern and how it differs from capabilities + behaviors
- [x] `behavior-switches-circuit.yaml` validates against behavior.schema.json
- [x] `device-switch-spst-toggle.yaml` validates against definition.schema.json with state_machine populated (initial_state: open; states: open + closed; one transition each direction triggered by 'actuated')
- [x] `instance-switch-001.yaml` validates; cross-FK confirms zero errors (copper enables electrical_conduction → contact_material role satisfied)
- [x] Cross-FK validator emits `state-machine-invalid-transition` when a transition references an undeclared state; programmatic must-fail test fires correctly
- [x] `npm test` shows 45 tests passing (37 schema + 8 cross-FK, up from 41 at Sprint 5 close)
- [x] `npx tsc --noEmit` clean
- [x] `npx biome check .` clean
- [x] Sprint retro written

### Catalog after Sprint 6

| Layer | Count | Entries |
|---|---|---|
| Material | 8 | (unchanged) |
| Shape | 2 | (unchanged) |
| Behavior | **7** | + switches_circuit |
| Interface kind | 1 | (unchanged) |
| Primitive device | **5** | + switch_spst_toggle |
| Instances | **7** | + switch_001 |
| Active Variables | 2 | (unchanged) |
| **Cross-FK error codes** | **7** | + state-machine-invalid-transition |

### Lessons surfaced

1. **The schema-validator-test triple is fully reproducible.** Sprint 6 added a new schema FIELD (rather than a new kind, which Sprint 5 did) but the pattern was identical: extend schema → add cross-FK validation → add device using the field → add must-fail test → retro. Six sub-commits, no surprises, all gates green throughout. **General lesson:** the recipe scales whether you're adding a kind or extending an existing schema.

2. **State machines as declarative descriptions felt right.** The schema captures the FSM; the validator checks internal consistency (transitions reference declared states); future simulators read it for evaluation. Same honesty rule as behaviors (declare the law, don't evaluate). The pattern is consistent and the schema doesn't claim more than it can prove. **General lesson:** when adding new model concepts, follow the existing declare-don't-evaluate pattern.

3. **Naming refined from plan-to-execution.** Plan said `device-switch.yaml` for `id: switch`. Execution landed `device-switch-spst-toggle.yaml` for `id: switch_spst_toggle` — because the state_machine IS part of the definition, and SPDT will need its own definition with its own state machine. Generic `switch` was the wrong abstraction. **General lesson:** when a definition has identity-defining content (state machine, fixed parameters, fixed structure), the id should name the specific variant, not a generic class.

4. **Listing 4 behaviors alongside switches_circuit is the honest minimum.** switch_spst_toggle's behaviors are [switches_circuit, conducts_current, has_resistance, produces_joule_heat]. The switch IS a conductor when closed, with measurable resistance and Joule heating — those behaviors are legitimately present. The state-dependent gating (only fire when state=closed) is the future work — captured in a new §15 row below.

5. **The state-machine pattern WILL extend cleanly to relays/MOSFETs/flip-flops.** Relays add one extra state (coil energized vs de-energized driving the contacts), MOSFETs add gate-voltage triggers, latches add edge-triggered transitions. None of these need a different schema shape — just different states + transitions populated. **General lesson:** Sprint 6's pattern is the contract; Sprint 7+ instantiate it.

6. **YAML colon gotcha did NOT re-surface.** Sprint 4 retro flagged it; Sprint 5 didn't trigger it; Sprint 6 also clean. The defensive habit (quote descriptions with colons) is being followed. **Worth documenting** in CLAUDE.md or contributor docs when those exist.

### New §15 rows added in this retro

Three deferred questions surfaced during Sprint 6, all added to OBJECT-MODEL.md §15 alongside this retro:

- **Trigger taxonomy as enum.** Sprint 6 left `trigger:` as a free string. Hardens to an enum once 3-4 stateful device types exist (likely after Sprint 7's relay and Sprint 8+'s MOSFET land).
- **Multi-pole switches (SPDT, DPDT, 4PDT).** Need state-dependent connection topology — which terminal pairs are connected per state. Sprint 7+ explores whether the existing state_machine + composition shape can express this or needs an extension.
- **State-dependent behavior gating.** Stateful devices list behaviors that may only fire in certain states. switch_spst_toggle's conducts_current/has_resistance/produces_joule_heat ought to gate on state=closed. Today the model has no formal linkage between FSM states and active behaviors. Future work: extend behaviors with optional state predicates, or extend state_machine to declare which behaviors fire per state.

### Unresolved questions (still deferred per OBJECT-MODEL.md §15)

Carried forward from earlier sprints + Sprint 6 additions:

- Default-resolution path, net model, `property_definition` registry shape, multi-version definitions, cross-pack dependencies, schema migration story
- Stackup model, preset/template model, visual symbol library, auto-created interface UX pattern (canvas)
- Alloy composition-by-weight schema field, behavior-derives-value pattern, `min_count` enforcement, AV → AV chains
- LED + semiconductor physics (Sprint 7+)
- **NEW: Trigger taxonomy as enum** (Sprint 7+)
- **NEW: Multi-pole switches (SPDT/DPDT/4PDT)** (Sprint 7+)
- **NEW: State-dependent behavior gating** (paired with behavior-derives-value, lands when simulator engine needs it)

### What this unblocks

After Sprint 6 close:

- **The state-machine pattern is a contract that future stateful devices inherit.** Relay, MOSFET, latch, flip-flop, multiplexer — all use the same declarative `state_machine` block with their own states + transitions. The schema is the contract; the cross-FK validator is the enforcer.
- **The educational anchor circuit (battery → wire → switch → resistor → LED → wire → battery_terminal) is now ~80% buildable.** Only LED is missing. Once LED lands in Sprint 7, the foundation can model the first-circuit-everyone-builds with real cited values from materials all the way up.
- **Cross-FK error codes total 8.** unknown-reference, kind-mismatch, unknown-behavior, role-unsatisfied, unknown-active-variable, active-variable-type-mismatch, state-machine-invalid-transition. Every code has a programmatic must-fail test proving it fires.
- **The honest-declaration discipline is durable.** Sprint 6 added a state_machine field knowing the simulator that uses it doesn't exist. That's fine — the model declares; future sprints solve. Same as how Sprint 3 added the behavior registry before any solver could evaluate Ohm's law.

### Sprint 6 closed

All sub-commits land cleanly on master. 45 tests pass (37 schema + 8 cross-FK, more than 2.5× Sprint 3's close). The first stateful primitive joins the catalog without disturbing the static ones. Sprint 7's natural pick is LED + semiconductor physics — the last piece for the canonical first-circuit.
