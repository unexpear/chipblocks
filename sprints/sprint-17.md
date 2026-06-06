# v3 Sprint 17 — Terminal-name validation

> **Status:** Sprint plan, opened 2026-06-06 against master tip `b14d4ac`.
> **Predecessor:** Sprint 16 closed the nonlinear DC solver (§20, Shockley + Newton-Raphson + pnjlim). 227 tests. A placeholder/deferred audit then surfaced terminal-name validation as the highest-value now-fillable §15 row: the solver leans hard on terminal names (`anode`, `terminal_a`, `reference_terminal`, …) but they're declared nowhere, so a typo'd terminal silently breaks the solve.
> **Scope:** Devices declare their named terminals; cross-FK validates that every `connects[].terminal` (on instances) and every `members[].terminal` (on nets) references a real terminal on the relevant device. Closes the §15 "Terminal-name validation" row.

---

## Sprint 17 goal in plain English

Right now, a resistor instance can say `connects: [{terminal: "terminal_a"}]` (typo) and nothing complains — until the DC solver silently fails to stamp it because `stampResistor` looks for `terminal_a` and doesn't find it. The circuit then solves wrong (or singular) with no clear error.

After this sprint, devices declare their terminals (`resistor` has `terminal_a` + `terminal_b`; `led` has `anode` + `cathode`; `ground` has `reference_terminal`), and the cross-FK validator catches any `connects:` or net `members:` entry that references a terminal the device doesn't have — **before** the solver ever runs. The typo becomes a clear `unknown-terminal` error pointing at the exact instance and bad name.

This is the structural backstop the solver's terminal conventions have needed since Sprint 14. The terminal names already exist as a convention used by the stamp functions; Sprint 17 makes them a declared, validated part of the catalog.

---

## After this sprint

1. **New `terminals:` field on device definitions** — an object keyed by terminal name (matching the `parameters:` style), each entry carrying an optional description. Optional field (materials/shapes/behaviors don't have terminals).
2. **All 11 connectable primitive devices declare their terminals:**
   - `resistor`, `capacitor`, `wire` → `terminal_a`, `terminal_b`
   - `led`, `led_uv_algan`, `diode_schottky_al_si`, `diode_silicon_rectifier`, `diode_zener_silicon` → `anode`, `cathode`
   - `power_source` → `terminal_positive`, `terminal_negative`
   - `switch_spst_toggle` → `terminal_in`, `terminal_out`
   - `ground` → `reference_terminal`
3. **Cross-FK `unknown-terminal` check** — fires when an instance's `connects[].terminal`, or a net's `members[].terminal`, names a terminal the relevant device doesn't declare. Both directions covered.
4. **JSON schema** — `terminals` added to `definition.schema.json` (optional, patternProperties keyed by name).
5. **OBJECT-MODEL.md §21** — terminal taxonomy spec; closes the §15 "Terminal-name validation" row.

---

## Non-goals (explicit, with reasons)

- **No solver change.** The DC solver keeps its hardcoded terminal conventions (`stampResistor` looks for `terminal_a`/`terminal_b`, etc.). Sprint 17 is about VALIDATION, not refactoring the solver to read declared terminals. Making the solver consume the declared terminal taxonomy (and a polarity/role hint) is a clean follow-on — a §15 row.
- **No terminal polarity / semantic role field (yet).** A terminal could declare `role: anode` or `polarity: positive` for the solver to eventually read. Sprint 17 declares names + descriptions only; the polarity hint is deferred to the solver-reads-terminals sprint, so we don't design a field nothing consumes yet.
- **No terminal counting against composition roles.** The `endpoints` interface role (min_count: 2) and the named terminals are related but distinct. Sprint 17 doesn't try to cross-check "2 terminals declared == endpoints.min_count" — that's the separate `min_count` enforcement §15 row.
- **No multi-die / shared-signal terminals.** Packages where one physical pin carries multiple internal signals are out — single flat terminal list per device.
- **No required terminals.** A device declares its terminals, but Sprint 17 doesn't enforce "every declared terminal must be connected" — an unconnected terminal is legal (a floating pin). Enforcing full connectivity is a net-completeness concern, separate.
- **No schema/fixture changes to instances or nets.** Their `connects:` / `members:` terminal strings stay as-is — Sprint 13 designed them forward-compatible. Sprint 17 only adds `terminals:` to devices + the cross-FK check; existing terminal strings already match the conventions (verified during planning: the 9 terminal names in use are exactly the device conventions).

---

## Locked toolchain (inherited from Sprints 2-16)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict + mathjs 15.2.0. **No new dev dependencies.**

---

## Deliverables

```
OBJECT-MODEL.md
├── §21 NEW — Terminal taxonomy             spec; placed after §20
└── §15 deferred row "Terminal-name          ✅ CLOSED — pointer to §21
     validation"

schemas/
└── definition.schema.json                  terminals field (optional)

src/
└── cross-fk-validator.ts                    unknown-terminal check + Definition.terminals

tests/
├── cross-fk.test.ts                         unknown-terminal tests (connects + members)
└── (schema test auto-covers the device fixtures)

fixtures/valid/
├── device-resistor.yaml                     + terminals
├── device-capacitor.yaml                    + terminals
├── device-wire.yaml                          + terminals
├── device-led.yaml                           + terminals
├── device-led-uv-algan.yaml                  + terminals
├── device-diode-schottky-al-si.yaml          + terminals
├── device-diode-silicon-rectifier.yaml       + terminals
├── device-diode-zener-silicon.yaml           + terminals
├── device-power-source.yaml                  + terminals
├── device-switch-spst-toggle.yaml            + terminals
└── device-ground.yaml                        + terminals
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S17-v3-1** | `sprints/sprint-17.md` | This plan. |
| **S17-v3-2** | OBJECT-MODEL.md §21 spec | Terminal taxonomy: the `terminals:` field shape, the relationship to composition interface roles (named pins vs structural requirement), the `unknown-terminal` cross-FK invariant (both connects + members directions), the optional-field rule (only connectable devices declare terminals), forward-compat note, and the deferred polarity/role hint. Closes the §15 row with a §21 pointer. |
| **S17-v3-3** | JSON schema `terminals` field | Add `terminals` to `definition.schema.json` — optional object, patternProperties `^[a-z][a-z0-9_]*$` → `{ description?: string }`, additionalProperties false. Schema tests cover a device with terminals (valid) + bad terminal shapes (invalid). |
| **S17-v3-4** | Declare terminals on all 11 connectable devices | Add the `terminals:` block to each device fixture per the inventory above. Each terminal gets a one-line description. The schema test auto-validates them; the existing connects/members strings already match (verified in planning). |
| **S17-v3-5** | Cross-FK `unknown-terminal` check | Extend `cross-fk-validator.ts`: `Definition.terminals` type; for each instance, every `connects[].terminal` must be a declared terminal on the instance's device (when the device declares terminals); for each net, every `members[].terminal` must be a declared terminal on the referenced instance's device. New `unknown-terminal` error code. Mutation-pattern tests (typo a terminal on connects → fires; typo on a net member → fires; device without terminals → skips). |
| **S17-v3-6** | Sprint 17 retro + §15 closure | Sub-commit log, lessons, formal closure of the §15 "Terminal-name validation" row, new §15 row (solver-reads-declared-terminals + polarity hint — remove the hardcoded conventions from the stamp functions). |

---

## Verification discipline (zero-trust, per Sprint 12-16 pattern)

- **The valid world stays clean.** Adding `terminals:` to devices + the `unknown-terminal` check must produce ZERO new errors on the existing fixtures — because the terminal strings already in use are exactly the conventions being declared. If any fixture's terminal doesn't match its device's declared terminals, that's a real latent bug the check just found; fix the fixture (or the declaration) and note it.
- **Both directions tested.** `unknown-terminal` fires for a bad `connects[].terminal` AND a bad net `members[].terminal`. Mutation-pattern tests cover each.
- **Devices-without-terminals skip cleanly.** A definition that doesn't declare `terminals:` (or a non-device kind) causes the check to skip — no false positive. Sprint 17 doesn't force every device to declare terminals in one go, though all 11 connectable ones do.
- **Bidirectional consistency still holds.** The §17 net-membership check and the new terminal check are independent; both must pass on the valid world.
- **All three gates green** before each sub-commit. No NUL-byte cruft. Mid-Sprint check before/after the cross-FK code.

---

## Done criteria

- [ ] OBJECT-MODEL.md §21 lands with the terminal-taxonomy spec
- [ ] §15 "Terminal-name validation" row marked ✅ CLOSED with §21 pointer
- [ ] `definition.schema.json` accepts the `terminals:` field; rejects malformed terminal shapes
- [ ] All 11 connectable devices declare their terminals; the valid world still validates
- [ ] Cross-FK `unknown-terminal` fires for a bad `connects[].terminal` and a bad net `members[].terminal`
- [ ] Devices without declared terminals skip the check (no false positive)
- [ ] The valid-world cross-FK test still reports zero errors
- [ ] All tests pass (count grows from 227)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written
- [ ] New §15 row added (solver reads declared terminals + polarity hint, removing the hardcoded stamp-function conventions)

---

## Risks called out

1. **A latent terminal-name bug might surface.** If any existing fixture has a terminal that doesn't match its device's convention, the new check will catch it. That's the point — but it means S17-v3-5 could require a fixture fix. Planning already cross-checked the 9 terminal names in use against the device conventions; they match, so this is low risk. If something surfaces, fix it and document.
2. **The terminals-vs-roles relationship could confuse.** A device has both `composition.requires.endpoints` (interface role, min_count 2) and `terminals` (named pins). The spec must be clear they're complementary: the role is the structural requirement ("needs 2 connection interfaces"); the terminals name them ("terminal_a, terminal_b"). §21 documents this explicitly.
3. **Capacitor / diode devices have no instances yet.** They declare terminals but no instance exercises the check. That's fine — the declaration is forward-looking, and the schema test validates the device shape. The cross-FK check is exercised by the devices that DO have instances (resistor, led, power_source, switch, wire, ground).

---

## Open questions deferred to later sprints

Carried forward from Sprint 16 close + new from Sprint 17 design:

- (all prior open §15 rows)
- **NEW from Sprint 17 design:** solver reads declared terminals + a polarity/role hint (`role: anode` / `polarity: positive`) so the stamp functions stop hardcoding terminal-name conventions — the natural follow-on once terminals are declared + validated.

---

## Sprint 17 opens here

Master tip when opened: `b14d4ac` (post-Sprint-16 + the §15 accuracy corrections). The 227 tests from Sprint 16 close are the floor; expect ~240-250 when Sprint 17 closes (~6 schema tests + ~6 cross-FK unknown-terminal tests + the 11 device fixtures auto-validating).

**Why this sprint matters:** it's a contained, high-value backstop after the heavy nonlinear-solver sprint. The terminal names the solver depends on become declared and validated, closing a real bug class (typo'd terminal → silent solve failure) with structural validation that runs before the solver. It also lays the groundwork for the solver to eventually read terminals instead of hardcoding them.

Trigger to begin: user approval of this plan.
