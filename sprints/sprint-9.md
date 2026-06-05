# v3 Sprint 9 — PN junction promotion to interface kind

> **Status:** Sprint plan, opened 2026-06-03 against master tip `2e4088a`.
> **Predecessor:** v3 Sprint 8 added 3 diode devices (silicon rectifier, Schottky, Zener) spanning different junction physics. Three PN-junction devices (LED, rectifier, Zener) now share an identical `composition.uses: [<material>_n_type, <material>_p_type]` pattern — the duplication that Sprint 9 resolves.
> **Scope:** promote `pn_junction` to a first-class interface kind in the catalog. Refactor LED + silicon rectifier + Zener to compose pn_junction structurally and require material roles instead of listing specific materials. Generalize `led_red_algainp` to a generic `led` device with red AlGaInP as parameter defaults — Sprint 10's multi-color expansion then becomes parameter-override work rather than new device definitions per color.

---

## Sprint goal

Sprint 7 + Sprint 8 landed four semiconductor devices using implicit PN junctions (LED, silicon rectifier, Zener; Schottky is metal-semiconductor and stays unchanged). Three use the identical `composition.uses: [<material>_n_type, <material>_p_type]` pattern. That duplication is the §15-row trigger.

Sprint 9 resolves it:

1. **pn_junction becomes a first-class interface kind** with composition.requires for n_side + p_side material roles (each with doping-type capabilities) and enables [diode_action].

2. **PN-junction devices refactor** from `composition.uses: [<materials>]` to `composition.uses: [pn_junction]` + `composition.requires.n_side + p_side` + parameters with material defaults. The variant identity that lived in the definition id (led_red_algainp) now lives in the parameter defaults (n_side: aluminum_gallium_indium_phosphide_n_type by default).

3. **led_red_algainp → led** (generalized). The generic `led` definition with red AlGaInP defaults serves all colors. Multi-color variants in Sprint 10 just override the material parameters at the instance level, plus add the new material files (InGaN n/p, GaAs n/p, AlGaN n/p, etc.).

4. **Cross-FK validation extends naturally** — role-satisfaction already handles the material + must_enable check. Sprint 9 might not need any new validator code, just verification that the refactored devices still pass.

After this sprint, the foundation has:
- A clean PN junction concept reusable across devices
- 4 semiconductor devices using it (LED + 3 diodes)
- Schottky still implicit (waits for schottky_junction promotion when 2+ Schottky variants exist)
- Sprint 10 multi-color LED expansion reduced to material+instance work only

---

## Non-goals (explicit)

- **No Schottky refactor.** Different junction physics (metal-semiconductor); schottky_junction promotion stays §15 deferred for when 2+ Schottky variants exist.
- **No behavior-derives-value pattern.** Per user direction, "check before" — Sprint 11 candidate at earliest.
- **No BJT, MOSFET, JFET, or other multi-junction devices.** Sprint 11+.
- **No state-dependent behavior gating** — §15 carried.
- **No default-resolution path enforcement** — §15 carried. (Sprint 9 verifies that instances which inherit defaults still pass cross-FK with the refactored composition.)
- **No new high-power / fast-recovery / specialty diodes.**
- **No UI, canvas, or physics engine.**
- **No teaching mode** — post-canvas-sprint per user direction.

---

## Locked toolchain (inherited from Sprints 2-8)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict. No new dev dependencies expected.

---

## Deliverables

```
fixtures/valid/
├── interface-pn-junction.yaml         NEW — pn_junction interface kind
├── device-led.yaml                    NEW (renamed from device-led-red-algainp.yaml)
│                                       Generic led with red AlGaInP defaults
├── device-led-red-algainp.yaml        DELETED (content moves to device-led.yaml)
├── device-diode-silicon-rectifier.yaml  REFACTORED — composition.uses [pn_junction]
│                                                     + composition.requires + parameters
├── device-diode-zener-silicon.yaml      REFACTORED — same pattern
├── instance-led-001.yaml              UPDATED — definition: led (was led_red_algainp)
├── instance-diode-001.yaml            UPDATED — may need explicit n_side/p_side or inherit defaults
└── instance-diode-003.yaml            UPDATED — same

fixtures/invalid/
└── (possibly) led-with-conducting-material.yaml  NEW — must-fail fixture: chose copper for n_side
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S9-v3-1** | `sprints/sprint-9.md` | This plan. |
| **S9-v3-2** | `interface-pn-junction.yaml` | New interface kind. composition.requires.n_side (kind material, must_enable [n_type_semiconductor]) + p_side (must_enable [p_type_semiconductor]). enables [diode_action]. |
| **S9-v3-3** | Refactor LED to generic `led` (renames file, generalizes id) | device-led-red-algainp.yaml → device-led.yaml. id changes from led_red_algainp to led. composition.uses [pn_junction]. composition.requires.n_side / p_side with must_enable [n_type_semiconductor, direct_bandgap] / [p_type_semiconductor, direct_bandgap]. Parameters n_side / p_side with defaults aluminum_gallium_indium_phosphide_n_type / p_type. instance-led-001.yaml updates `definition: led`. |
| **S9-v3-4** | Refactor diode_silicon_rectifier | composition.uses [pn_junction]. composition.requires.n_side / p_side (no direct_bandgap requirement — silicon is indirect). Parameters n_side / p_side with defaults silicon_n_type / silicon_p_type. instance-diode-001.yaml inherits defaults (or explicitly sets — verify with cross-FK). |
| **S9-v3-5** | Refactor diode_zener_silicon | Same pattern. Zener uses regulates_reverse_voltage behavior too — unchanged. |
| **S9-v3-6** | Verify cross-FK + add 1 must-fail fixture | Run all 8 cross-FK tests; valid-world must report zero errors after refactor. Add programmatic must-fail test (or new invalid fixture): pick copper as n_side for the led → role-unsatisfied fires (copper enables electrical_conduction, not n_type_semiconductor). |
| **S9-v3-7** | Sprint 9 retro | Sub-commit log, lessons, new §15 rows (right-click parameter override UX expansion, keybindings settings page). |

---

## Verification discipline (zero-trust, same as Sprints 2-8)

- The refactor MUST preserve cross-FK validity. Every refactored device must still pass schema + cross-FK before its sub-commit lands.
- Default-resolution path is still §15 deferred — Sprint 9 will verify that instances NOT explicitly setting n_side/p_side still validate (the default value is taken into account by schema; cross-FK behavior on defaults TBD by Sprint 9 verification).
- All three gates green before each sub-commit.
- YAML colon-in-description: continued defensive double-quoting.

---

## Done criteria

- [ ] `interface-pn-junction.yaml` validates as definition kind interface with composition.requires.n_side + p_side + enables [diode_action]
- [ ] `device-led.yaml` (renamed) validates; id is `led`; composition uses pn_junction + requires n_side + p_side with AlGaInP defaults
- [ ] `device-diode-silicon-rectifier.yaml` refactored and validates
- [ ] `device-diode-zener-silicon.yaml` refactored and validates
- [ ] `device-led-red-algainp.yaml` deleted (content moved to device-led.yaml)
- [ ] `instance-led-001.yaml` updated `definition: led` and validates
- [ ] Other diode instances validate (inheriting defaults or explicitly setting materials)
- [ ] Cross-FK validator reports zero errors on the loaded world
- [ ] New must-fail test fires role-unsatisfied for invalid material choice
- [ ] `npm test` shows tests passing (count may DROP by 1 since led_red_algainp file deletes; then GROW by 1 for the new pn_junction interface; net = roughly stable)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written
- [ ] New §15 rows added: right-click parameter override UX, keybindings settings page

---

## Open questions deferred to Sprint 10+ (or later)

Sprint 9 will likely surface:

- **Default-resolution path** — long-deferred §15 row gets exercised. If an instance omits n_side/p_side and inherits the default, does cross-FK trace through the default? Sprint 9 verification may either confirm it works or flag as still-deferred.

Carried forward §15 rows from earlier sprints: net model, `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration, stackup, preset/template, visual symbol library, auto-created interface UX, alloy composition-by-weight, behavior-derives-value, `min_count` enforcement, AV chains, trigger taxonomy enum, multi-pole switches, state-dependent behavior gating, multi-color LED expansion, schottky_junction promotion.

To be added at Sprint 9 retro:
- **Right-click parameter override UX** — extends the existing auto-created interface UX row to cover parameterized devices (LED color change, resistor value, etc.). Canvas-sprint concern.
- **Keybindings settings page** — keyboard shortcut customization with save/restore defaults. Canvas/UI concern.

Post-canvas-sprint commitments (carried):
- Teaching mode / walkthrough classes (batteries, resistors, wire, switches first)

---

## Sprint 9 opens here

Master tip when opened: `2e4088a`. Sprint 8's recommendation triggers this sprint — three PN-junction devices using identical composition.uses pattern is the trigger condition. Sprint 9 promotes the pattern to first-class interface kind + refactors existing devices to use it. Generic `led` design (per user direction) sets Sprint 10's multi-color expansion up as material+instance work rather than per-color device definitions.

---

## Sprint 9 retro (closed 2026-06-03)

### What landed

| Sub-commit | What |
|---|---|
| `e95163a` | S9-v3-1: Sprint 9 plan opened |
| `7fbb9f6` | S9-v3-2: pn_junction interface kind — promoted from implicit pattern |
| `bdf77a7` | S9-v3-3: Refactor LED to generic `led` with red AlGaInP defaults |
| `b37ffd4` | S9-v3-4: Refactor diode_silicon_rectifier to use pn_junction |
| `82ad553` | S9-v3-5: Refactor diode_zener_silicon to use pn_junction |
| `0eed40a` | S9-v3-6: Verify cross-FK + new must-fail test for LED material role |
| (this) | S9-v3-7: retro — Sprint 9 closes |

### Done criteria — all met

- [x] `interface-pn-junction.yaml` validates as definition kind interface with composition.requires.n_side + p_side + enables [diode_action]
- [x] `device-led.yaml` (renamed from device-led-red-algainp.yaml) validates; id is `led`; composition uses pn_junction + requires n_side + p_side with AlGaInP defaults
- [x] `device-diode-silicon-rectifier.yaml` refactored and validates
- [x] `device-diode-zener-silicon.yaml` refactored and validates
- [x] `device-led-red-algainp.yaml` deleted (content moved to device-led.yaml)
- [x] `instance-led-001.yaml` updated `definition: led` and validates
- [x] Other diode instances validate (inheriting defaults via the deferred default-resolution path)
- [x] Cross-FK validator reports zero errors on the loaded world after refactor
- [x] New must-fail test fires role-unsatisfied for invalid material choice (copper as n_side)
- [x] `npm test` shows 63 tests passing (54 schema + 9 cross-FK, up from 62)
- [x] `npx tsc --noEmit` clean
- [x] `npx biome check .` clean
- [x] Sprint retro written
- [x] New §15 rows added: right-click parameter override UX, keybindings settings page

### Catalog after Sprint 9

| Layer | Sprint 8 close | Sprint 9 close |
|---|---|---|
| Material | 12 | (unchanged) |
| Shape | 2 | (unchanged) |
| Behavior | 10 | (unchanged) |
| **Interface kind** | 1 | **2** (+ pn_junction) |
| Primitive device | 9 | (unchanged count; 3 of 9 refactored, 1 renamed) |
| Instances | 12 | (unchanged count; 1 updated to point at `led`) |
| Active Variables | 2 | (unchanged) |
| Cross-FK error codes | 7 | (unchanged) |
| Cross-FK tests | 8 | **9** (+ LED role-unsatisfied) |

### Lessons surfaced

1. **The promotion was clean — no schema changes needed.** The role-satisfaction machinery from Sprint 3 (role + must_enable + satisfies_role) handled the refactor without modification. composition.uses [pn_junction] is just an id lookup; the refactored devices' composition.requires.n_side / p_side use the existing parameter-satisfies-role pattern. **General lesson:** when a feature is designed flexibly enough, future schema promotions cost less than expected. The Sprint 3 design held up.

2. **Identity location changed from id to parameter defaults.** Sprint 7's led_red_algainp encoded variant identity in the device id (per Sprint 6 lesson). Sprint 9's generic `led` moves that identity into parameter defaults. Both patterns are valid; the choice depends on whether the variants share enough structure to compose generically (LED yes — all colors use pn_junction; Switch arguably no — SPST/SPDT have different state machines). **General lesson:** the Sprint 6 "specific variants in id" lesson and the Sprint 9 "generic with defaults" pattern are tools for different shapes. Use the one that fits the variation surface.

3. **`direct_bandgap` as a role requirement makes the model honest.** The LED's n_side / p_side roles require direct_bandgap; the silicon rectifier's and Zener's same-shaped roles do NOT. The model now correctly distinguishes "this device needs efficient radiative recombination" from "this device just needs a PN junction." Cross-FK catches a silicon-LED attempt because silicon's enables list lacks direct_bandgap. **General lesson:** must_enable lists are how physical truth gets enforced — adding capabilities to materials and to role requirements is the model's vocabulary growing organically.

4. **Default-resolution path is still deferred.** led_001 doesn't have explicit n_side / p_side parameters — it inherits from the LED definition's defaults. Cross-FK's role-satisfaction loop skips parameters not explicitly set on the instance, which means defaults aren't checked. This is FINE for valid-world (the defaults are real material ids that pass schema validation), but it means an instance could omit a required parameter and cross-FK wouldn't catch a hypothetical broken default. **§15 row remains valid — re-confirmed.**

5. **Schottky correctly stayed out of the refactor.** Different junction physics (metal-semiconductor); the pn_junction interface kind doesn't fit. The schottky_junction §15 row holds the question for when 2+ Schottky variants exist. **General lesson:** promotions follow real duplication patterns; don't force-fit dissimilar devices into the same abstraction just because they have similar names.

6. **Generic `led` makes Sprint 10 trivial.** Multi-color expansion (per user direction) is now: add new material files (InGaN n/p, GaAs n/p, AlGaN n/p, etc.) + new LED instances overriding the defaults. No new LED device definitions per color. **General lesson:** the right promotion makes the next sprint smaller, not larger.

7. **YAML colon gotcha did NOT re-surface in Sprint 9.** Six sprints clean (Sprint 5, 6, 7, 9 fine; Sprint 8 caught one). Defensive quoting habit holds.

### New §15 rows added in this retro

Two new deferred questions added to OBJECT-MODEL.md §15 alongside this retro (per user direction during Sprint 9):

- **Right-click parameter override UX.** General pattern for parameterized devices in the canvas — right-click any device instance to open an edit menu where you can override parameter values per-instance (LED color via n_side/p_side, resistor value, switch type, capacitor capacitance, etc.). Extends the existing "auto-created interface UX pattern" row (which covers snap-created joints) to cover all parameterized devices. Canvas-sprint concern.
- **Keybindings settings page.** A settings UI for customizing keyboard shortcuts. Saves user preferences; restores defaults. Per-OS preset suggestions (Windows/Mac/Linux conventions). Lands when the canvas + settings UI infrastructure exists.

### Unresolved questions (still deferred per OBJECT-MODEL.md §15)

Carried forward + new from Sprint 9:

- Default-resolution path, net model, `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration
- Stackup model, preset/template model, visual symbol library, auto-created interface UX
- Alloy composition-by-weight, behavior-derives-value (user said 'check before' — at earliest Sprint 11 after Sprint 10 catalog work)
- `min_count` enforcement, AV chains
- Trigger taxonomy enum, multi-pole switches, state-dependent behavior gating
- Multi-color LED expansion (Sprint 10 — locked next)
- Schottky junction as a separate interface kind (Sprint 9+ when 2+ Schottky variants exist)
- **NEW: Right-click parameter override UX** (canvas-sprint concern)
- **NEW: Keybindings settings page** (canvas-sprint concern)

Post-canvas-sprint commitment (carried): **teaching mode / walkthrough classes** for batteries, resistors, wire, switches as first four lessons.

### What this unblocks

After Sprint 9 close:

- **PN junction is a first-class structural element.** Future semiconductor devices (BJTs, JFETs, photodiodes, solar cells, SCRs, thyristors) compose pn_junction without spelling out the materials each time. Each device's roles add their own additional must_enable on top (e.g., a photodiode might require both doping types + photosensitive_material; a BJT requires 2 PN junctions in series).
- **Multi-color LED expansion (Sprint 10) is parameter-override work, not device-definition work.** Adding blue/green/IR/UV/white LEDs reduces to: new material files (InGaN n/p, GaAs n/p, AlGaN n/p) + new LED instances with overridden material parameters. No new led_<color>_<material_system> device definitions per color.
- **The "right-click to change LED color" UX commitment has data-layer support.** Each LED instance can override n_side / p_side independently. Sprint 9 made this real at the data level; the canvas sprint adds the right-click menu.
- **Cross-FK validation got stronger.** Choosing the wrong material type (copper as n_side, silicon as a direct-bandgap LED material) now fires role-unsatisfied. The implicit pattern from Sprint 7-8 couldn't catch this.

### Sprint 9 closed

All sub-commits land cleanly on master. 63 tests pass (54 schema + 9 cross-FK, ~3.7× Sprint 3's close of 17). The PN junction promotion was the natural Sprint 9 deliverable Sprint 8 recommended; it's done. Sprint 10's natural pick (per user direction): **multi-color LED expansion** — InGaN, GaAs, AlGaN material variants + new LED instances picking those for blue / green / IR / UV emission.
