# v3 Sprint 13 — Net model formalization (Stage 1 of the simulation arc)

> **Status:** Sprint plan, opened 2026-06-05 against master tip `92d4703`.
> **Predecessor:** Sprint 12 closed the equation value kind (§16) — the behavior-derives-value pattern formalized end-to-end (schema + evaluator + dimensional checking + cross-FK conflict detection). 120 tests, 8 cross-FK error codes. Sprint 13 picks up Stage 1 of the simulation+visualization arc per [SIMULATION-AND-VISUALIZATION-ARC.md](../SIMULATION-AND-VISUALIZATION-ARC.md).
> **Scope:** Promote `connects:` from ad-hoc syntax to first-class **nets** — their own object kind, their own schema, validated cross-references, bidirectional membership consistency. No physics yet (that's Sprint 14 DC solver); no canvas (that's the canvas sprint); no terminal-name validation (separate §15 row).

---

## Sprint 13 goal in plain English

Today instances declare `connects: [{net: 'net_resistor_led', terminal: 'anode', of: 'led_001'}]` — but `net_resistor_led` is just an ad-hoc string. The validator can't tell whether two instances think they're on the same net, whether a referenced net actually exists anywhere, or whether a net has fewer than two terminals (a net with one terminal can't form a circuit).

After this sprint, nets are **first-class objects**. Each net has its own fixture file, its own id, its own member list, and its own schema. The validator verifies:

- Every `connects[].net` reference resolves to a real net (`unknown-net`)
- Every net has at least 2 members (`net-underpopulated`)
- A net's `members:` list agrees with the instances' `connects:` entries — both directions (`net-membership-mismatch`)

The catalog can now describe "what's connected to what" with the same rigor it describes "what's made of what." This is the foundation Sprint 14's DC solver consumes to know which currents flow where.

---

## After this sprint

1. New top-level object kind: `net`. Validates against new `schemas/net.schema.json`.
2. Net schema: id (string), kind (`"net"`), origin, type (enum), description (optional), members (array of `{instance, terminal}`, min 2), extensions.
3. **6 explicit net fixtures** for the educational anchor circuit (battery → wire → switch → resistor → LED → return):
   - `net-battery-pos.yaml`
   - `net-wire1-switch.yaml`
   - `net-switch-resistor.yaml`
   - `net-resistor-led.yaml`
   - `net-led-wire2.yaml`
   - `net-battery-neg.yaml`
4. Existing instance `connects:` entries unchanged in shape — they continue to reference nets by id. Schema enforces only that net references exist.
5. Cross-FK validator extends with 3 new error codes:
   - `unknown-net` — `connects[].net` references a nonexistent net id
   - `net-underpopulated` — net has fewer than 2 members
   - `net-membership-mismatch` — net.members and instance.connects disagree (a net lists an instance but the instance doesn't reference the net, or vice versa)
6. OBJECT-MODEL.md gains §17 formalizing the net model; the §15 "Net model" deferred row marked ✅ CLOSED with §17 pointer.

---

## Non-goals (explicit, with reasons)

- **No terminal-name validation.** Terminals stay free strings on the `connects:` side. For the validator to verify that `terminal: 'anode'` is a real terminal, every device definition would need to declare its terminal taxonomy — touching every device fixture and surfacing real design questions (polarity-aware terminals on diodes? multi-die packages?). That's its own sprint with its own design discussion. **New §15 row** captures this in the retro.
- **No net physics (KVL, KCL, electrical-consistency).** Sum-of-voltages-around-a-loop and sum-of-currents-at-a-node enforcement IS the DC solver — there's no halfway. Sprint 14.
- **No buses, hierarchical nets, or sub-nets.** Real expressiveness but no fixture today demands it. Wait for empirical pressure.
- **No min_count enforcement abstraction.** Sprint 13 enforces "net has ≥2 members" via a direct check; the §15 row about composition-role `min_count` is a different mechanism. Unifying them now is premature abstraction.
- **No net-level Active Variables.** Net-level "default impedance budget" / "default termination" only matters at larger design scales. Today's 5-instance circuits have no diversity to abstract over.
- **No net visualization.** Needs the canvas (deferred in §15). The visualization lens naturally lands when the canvas does.
- **No new UI / canvas / physics engine.**
- **No multi-version nets.** Single-version per net for now.

---

## Locked toolchain (inherited from Sprints 2-12)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict + mathjs 15.2.0. No new dev dependencies.

---

## Deliverables

```
OBJECT-MODEL.md
├── §17 NEW — Net model: first-class objects                spec; placed after §16
└── §15 deferred row "Net model"                            marked ✅ CLOSED, pointer to §17

schemas/
└── net.schema.json                                          NEW — full net shape

src/
└── cross-fk-validator.ts                                    EXTENDED — net checks + 3 new error codes

tests/
├── net-schema.test.ts                                       NEW — valid/invalid net shapes
└── cross-fk.test.ts                                         EXTENDED — 3 new error-code tests

fixtures/valid/
├── net-battery-pos.yaml                                     NEW
├── net-wire1-switch.yaml                                    NEW
├── net-switch-resistor.yaml                                 NEW
├── net-resistor-led.yaml                                    NEW
├── net-led-wire2.yaml                                       NEW
└── net-battery-neg.yaml                                     NEW
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S13-v3-1** | `sprints/sprint-13.md` | This plan. |
| **S13-v3-2** | OBJECT-MODEL.md §17 spec + §15 row closure | Full spec for the net model: kind, schema fields, member shape, type enum, cross-FK invariants, anti-placeholder compatibility (Rule 1 doesn't bind nets since they don't carry physical values), relation to §15. Closes the §15 "Net model" deferred row with ✅ CLOSED + §17 pointer. |
| **S13-v3-3** | `schemas/net.schema.json` + schema tests | Net schema with required `id`, `kind: "net"`, `origin`, `members` (array, minItems: 2, each `{instance, terminal}`), and optional `type` (enum: signal / power / ground / analog / digital), `description`, `extensions`. New `tests/net-schema.test.ts` covers valid shapes and required-field violations. |
| **S13-v3-4** | 6 explicit net fixtures for the educational anchor circuit | Convert each implicit net into its own fixture file. Each net declares its 2 members (instance + terminal) plus type + description. Validates against net.schema.json. |
| **S13-v3-5** | Cross-FK net validation — 3 new error codes | Extend `cross-fk-validator.ts`: walk `world.nets` (new World field) checking minimum member count; walk every instance's `connects:` verifying net ids resolve; cross-check bidirectional membership consistency. New error codes documented in the CrossFkError discriminated union. Test file `cross-fk.test.ts` gains 3 mutation-pattern tests (one per code). |
| **S13-v3-6** | Sprint 13 retro + new §15 row | Sub-commit log, lessons, formal closure of §15 "Net model" row, new §15 row for terminal-name validation (devices declare their named terminals — promoted from this sprint's non-goal). |

---

## Verification discipline (zero-trust, per Sprint 12 pattern)

- **Net schema design verified against EDA tradition.** KiCad's `net` concept, SPICE's `.nodelist` syntax, and common netlist formats (e.g., Spectre, EDIF) define nets as named groups of terminals. ChipBlocks's design mirrors this established practice rather than inventing a new convention.
- **Member shape verified against industry usage.** `{instance: id, terminal: string}` matches the structure of net entries in every netlist format checked. Differing only in the YAML envelope, not the semantics.
- **Type enum verified against EDA conventions.** signal / power / ground / analog / digital match the standard net classes in KiCad and most commercial EDA tools.
- **All three gates green** (`npm test`, `npx tsc --noEmit`, `npx biome check .`) before each sub-commit.
- **YAML colon gotcha** — defensive double-quoting on any description with a colon. (12 sprints clean since Sprint 8 last surfacing.)
- **No silent regressions.** The valid-world cross-FK test continues to pass — meaning the new checks don't false-positive on existing fixtures, and the new explicit net definitions are bidirectionally consistent with the existing `connects:` entries.

---

## Done criteria

- [ ] OBJECT-MODEL.md §17 lands with the full net model spec
- [ ] §15 "Net model" deferred row marked ✅ CLOSED with §17 pointer
- [ ] `schemas/net.schema.json` accepts valid net shapes; rejects required-field violations + min-2-members violations
- [ ] 6 net fixtures (battery_pos / wire1_switch / switch_resistor / resistor_led / led_wire2 / battery_neg) validate against net.schema.json
- [ ] Cross-FK validator catches `unknown-net`, `net-underpopulated`, `net-membership-mismatch` — each with a documented error structure
- [ ] World loader recognizes net fixtures and populates `world.nets` map
- [ ] All tests pass (count grows from 120)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written
- [ ] New §15 row added: terminal-name validation (devices declare their named terminals — future sprint)

---

## Risks called out

1. **`connects:` entries today may not all reference internally-consistent nets.** Building the explicit net fixtures may surface latent bugs: e.g., two instances claiming to be on `net_resistor_led` but only one actually wires up. The audit during S13-v3-4 will catch these; expect 0-2 fixture fixes as a side-effect.
2. **Net type enum is best-guess at the spec layer.** The signal/power/ground/analog/digital initial enum is verified against KiCad and standard EDA usage. If a real fixture in a later sprint needs another class (mixed-signal? differential pair? clock?), the enum extends — but the foundation enum should hold for typical hobbyist designs.
3. **Membership-mismatch check has a subtle bidirectional edge case.** A net lists 3 members but only 2 instances reference it → underpopulated *and* mismatched. The error reporting should distinguish (or surface both errors honestly).
4. **World loader changes.** The existing `loadWorld` walks definitions, instances, behaviors, AVs. Adding nets means a new map + the loader recognizing `kind: net`. Touches both `cross-fk.test.ts`'s loader and any schema-test pickValidator logic. The change is mechanical but real.

---

## Open questions deferred to later sprints

Carried forward from Sprint 12 close + new from Sprint 13 design:

- Default-resolution path, `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration
- Stackup model, preset/template model, visual symbol library, auto-created interface UX, right-click parameter override UX, keybindings settings page
- Alloy composition-by-weight, `min_count` enforcement (composition-role version, distinct from net's min-2-members check), AV chains
- Trigger taxonomy enum, multi-pole switches, state-dependent behavior gating
- Schottky junction promotion
- White LED, heterostructure / QW active-layer modeling, laser diodes
- Parametric equation evaluation with `input_variable`, device-level defaults-vs-rating check, geometry properties on shape definitions (Sprint 12 retro additions)
- **NEW from Sprint 13 design:** terminal-name validation (devices declare named terminals — needed for `connects[].terminal` FK validation); bus / hierarchical / sub-net model; net-level Active Variables; net behaviors / physics (lands with DC solver — Sprint 14)

Background-knowledge claims still flagged for verification (carried from Sprint 10/11):
- IEC 62471 risk-group classifications
- SPICE LED diode-model specifics
- KiCad single-LED-symbol count

---

## Sprint 13 opens here

Master tip when opened: `92d4703` (post-Sprint-12 audit with mathjs NOTICE verbatim match). The 120 tests from Sprint 12 close are the floor; expect ~140-160 when Sprint 13 closes (~6 net-fixture schema tests + ~6 net-schema invalid-shape tests + 3 cross-FK net tests + likely some new equation-evaluator-net interaction edge tests if they surface).

Trigger to begin: user approval of this plan (already received: 2026-06-05 — "no you were right go ahead").
