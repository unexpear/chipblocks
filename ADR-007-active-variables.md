# ADR-007: Active Variables — typed project-scoped values blocks reference

**Status:** Draft (2026-05-16) · For Sprint 2-3 implementation · **Deciders:** solo dev + Claude Code · Second ADR of the v2 ground-up direction; extends ADR-006's universal object model with a named-reference mechanism for block parameters.

> **Read order.** ADR-006 first (the universal object model + 9-layer hierarchy + AI authority split). This ADR adds one concept on top: any block parameter can be either a literal value or a reference to a project-scoped named variable. Everything else follows from that.

---

## Context

ADR-006 locked the universal object model — every block has parameters, each parameter has `value` + `units`. That works for the trivial case: drop a resistor on the canvas, set resistance to 470 Ω.

The case it doesn't handle well is the common one: **a value that appears in many places in the design.** Consider:

- The battery voltage feeds the resistor's voltage-divider calculation, the LED's forward-current check, the trace's IR-drop estimate, the BOM's recommended fuse rating, the manufacturing release's compatibility-statement docs, and the simulation's input. Hardcoding 9 V in six places means changing the battery to 12 V requires editing six places. Forget one, the validator silently passes the wrong design.

- The ambient operating temperature affects every device's failure-mode evaluation (resistor power rating at temp, LED max current at temp, electrolytic capacitor lifetime). Hardcoding 25 °C in every block means a "what if this runs at 60 °C?" question is impossible without rewriting the design.

- The target market and manufacturing volume affect BOM choices (industrial-grade vs consumer-grade resistors), package preferences (DIP vs SMD), assembly notes, regulatory disclosure. Hardcoding these per-block scatters them.

Every real EDA tool solves this. Cadence has *design variables*. KiCad has *design rules + symbolic values*. Verilog has `parameter`. SystemVerilog has `parameter` + `localparam`. The pattern is universal: name a value once at the project level, reference it by name everywhere it's used, and changing the source updates everything.

**Why this matters to the user.** A non-technical user dropping a battery + LED + resistor + switch on the canvas should be able to ask: "What if the battery is 12 V instead?" and get an immediate answer — without learning what `parameter` means or hunting through every block's properties panel. The Active Variables concept makes that question one-click.

This ADR locks the data model + scope semantics + UX direction for the concept. Implementation lands across Sprints 2 (data model in `parameters.yaml`), 3 (validator integration), and 4+ (the Active Variables Bar UI).

---

## Decision

**Adopt Active Variables as named, typed, scoped project-level values that any block parameter can reference instead of carrying a literal value.**

The shape, in one sentence: a block parameter is either `{ value, units }` (a literal) or `{ ref: <variable-name> }` (a reference into `parameters.yaml`). Schema enforces these are mutually exclusive.

The user-facing concept: drop a variable onto the canvas's Active Variables Bar; give it a name + value + units + scope; any block parameter can then reference it by name. Change the variable once; everything that references it re-validates immediately.

The behavior the deterministic engine enforces:
- Variable changes propagate to every block that references the variable (directly or transitively)
- Validation re-runs against the changed values
- BOM, schematic, docs, and manufacturing release all regenerate against the new values
- AI never modifies variables silently (per ADR-006's authority split)
- The user is always the one who edits a variable's value

---

## Data shape

### Variable definition in `parameters.yaml`

```yaml
variables:
  battery_voltage:
    type: quantity                # one of: quantity | string | enum | bool
    domain: electrical            # one of: electrical | thermal | mechanical |
                                  # optical | mechanical-positional |
                                  # manufacturing | regulatory | meta
    value: 9
    units: V                      # required for type=quantity
    scope: project                # one of: project | block | release |
                                  # simulation
    active: true                  # default true; false = defined but inert
    description: "Source voltage for the design."  # user-supplied
    used_by:                      # populated by the validator on each run;
                                  # not user-editable
      - power_source_1.voltage
      - led_check_1.supply_voltage
      - resistor_2.voltage_drop_check
    validation:                   # bubble-up like every other object
      status: pass
      issues: []
    notes: ""                     # freeform user notes

  ambient_temperature:
    type: quantity
    domain: thermal
    value: 25
    units: degC
    scope: simulation
    active: true
    description: "Operating temperature for thermal checks."
    used_by:
      - resistor_2.power_rating_at_temp
      - led_check_1.junction_temp
      - capacitor_3.electrolyte_lifetime
    validation: { status: pass, issues: [] }

  pcb_manufacturer:
    type: enum
    domain: manufacturing
    value: generic_2_layer
    allowed: [generic_2_layer, generic_4_layer, jlcpcb_2_layer, oshpark_2_layer]
    scope: release
    active: true
    description: "Target PCB fab profile; affects design-rule choices."
    used_by:
      - design.trace_width_min
      - design.via_drill_min
    validation: { status: pass, issues: [] }

  enable_thermal_derating:
    type: bool
    domain: meta
    value: true
    scope: project
    active: true
    description: "If true, all parts get 80% derating headroom check."
    used_by: [resistor_2.derate, capacitor_3.derate]
    validation: { status: pass, issues: [] }
```

### Block parameter shape extension (in `design.yaml`)

ADR-006 specified block parameters as `{ value, units, tolerance, source }`. This ADR adds the alternative `{ ref }` form:

```yaml
# Literal value (unchanged from ADR-006):
parameters:
  voltage:
    value: 9
    units: V
    tolerance_pct: 5
    source: user

# Variable reference (new):
parameters:
  voltage:
    ref: battery_voltage           # name lookup in parameters.yaml + scope chain
```

**Schema enforcement:** `value` and `ref` are mutually exclusive. A parameter with both → schema validation fail. A parameter with neither → schema validation fail.

**Type compatibility on resolution:** when a block declares a parameter type (e.g., `voltage` must be a `quantity` in volts), the referenced variable must match. A `voltage` parameter cannot reference a `pcb_manufacturer` enum variable. The schema + validator both enforce this.

---

## Scope semantics

Four scopes, each with a precise meaning:

| Scope | When the variable is active | Example use |
|---|---|---|
| **`project`** | Always — applies to every block, every validation run, every release | `battery_voltage`, `board_material`, `target_max_current` |
| **`block`** | Only inside the named composite block (lexical scope). Defined as a child of that block. | A `voltage_divider` block group's internal `R_ratio` that doesn't leak to siblings |
| **`release`** | Only when generating a specific manufacturing release profile | `pcb_manufacturer`, `assembly_notes_language`, `regulatory_certifications_required` |
| **`simulation`** | Only when running a specific verification scenario | `ambient_temperature` (at 25°C vs 60°C for stress test), `supply_voltage_brownout` |

### Resolution order

When a block references a variable by name (`voltage: { ref: battery_voltage }`), the resolver walks scopes from innermost to outermost:

1. **Block scope** of the referencing block (and its composite-block ancestors, walking up the `parent` chain) — `block`-scoped variables found first
2. **Active release scope** — if a release profile is currently selected, its `release`-scoped variables are next
3. **Active simulation scope** — if a simulation is currently running, its `simulation`-scoped variables are next
4. **Project scope** — `project`-scoped variables (always last but always available)
5. **Unresolved** — error: "variable X not found in any active scope; check parameters.yaml or define it"

This is lexical scoping, same model as every programming language since LISP. Inner wins.

### Scope conflicts

If two variables of the same name exist in different scopes (e.g., a project `voltage` AND a release `voltage`), the inner scope's value resolves. The other definition is *shadowed*, not invalid. The UI displays both in the Active Variables Bar with a "shadowing" indicator so the user knows.

### Switching active scopes

The user can switch the active release profile from a dropdown in the UI. Switching from `pcb_manufacturer = generic_2_layer` to `pcb_manufacturer = jlcpcb_2_layer` triggers full validator re-run + BOM regeneration. Same for switching simulations.

Only one release profile and one simulation can be "active" at any moment. Multiple of each may be defined; the user picks.

---

## The `active` flag

Variables have `active: true` (default) or `active: false`. The semantics:

- **`active: true`** — variable participates in resolution. Used as documented.
- **`active: false`** — variable exists in `parameters.yaml` for reference but is invisible to the resolver. Blocks referencing it via `ref:` get a "variable inactive" validation warning (not an error — the user might be A/B testing).

Use cases for `active: false`:
- A/B testing: define two `battery_voltage` variables (one at 9 V, one at 12 V); flip `active` to switch
- Documenting alternatives: keep "if we went with the alternate part, this would be the value"
- Temporarily disable a variable without deleting + losing its `used_by` history

The UI distinguishes active vs inactive variables visually in the Active Variables Bar.

---

## `used_by` traceability

Every variable has a `used_by` array populated by the validator on each run. Entries are dotted paths into the block graph: `block_id.parameter_id`.

This is the bidirectional half of the variable system: from a variable, see everything that references it. From a block, see (via its parameters) every variable it references.

**Why it matters:**
- The UI can show "battery_voltage is used in 6 places" + clickable links to those blocks
- The user changing `battery_voltage` from 9 V to 12 V gets a confirmation dialog: "This will affect 6 blocks: power_source_1, led_check_1, resistor_2, ..."
- The validator can warn about unused variables (defined but `used_by: []` — probably a typo or stale reference)
- The release manifest includes the `used_by` map so a downstream reader knows the variable-flow graph

**Not user-editable.** `used_by` is regenerated by the validator on every run. If a user edits it manually, the next validator run overwrites their edit. This is intentional — `used_by` is a derived view, not source state.

---

## Variable types

v1 supports four variable types. More can be added later (additive, no schema break).

### `quantity`
A numeric value with units. The most common type.
```yaml
voltage:
  type: quantity
  value: 9
  units: V
```
Units are validated against the parameter's declared unit-class (e.g., a parameter expecting volts cannot bind to a variable in amperes; dimensional analysis enforces).

### `string`
Free-form text.
```yaml
manufacturer_name:
  type: string
  value: "ACME Electronics"
```
No unit field. Used for human-readable metadata, doc inserts, regulatory disclosures.

### `enum`
Fixed set of allowed string values.
```yaml
pcb_manufacturer:
  type: enum
  value: generic_2_layer
  allowed: [generic_2_layer, generic_4_layer, jlcpcb_2_layer]
```
Schema enforces `value ∈ allowed`. Used for release profiles, manufacturing options, regulatory certifications.

### `bool`
A boolean flag.
```yaml
enable_thermal_derating:
  type: bool
  value: true
```
Used for feature flags affecting validation behavior.

### Future types (anticipated, not built at v1)

- `expression` — a computed value based on other variables. E.g., `total_power: { expression: "battery_voltage * target_max_current" }`. Useful for derived design metrics. Deferred to a later sprint; v1 keeps everything literal.
- `array` — list of values. Useful for sweeps and corner analysis. Deferred similarly.
- `reference` — pointer to another variable. Useful for aliases. Probably overlap with `expression`; defer.

---

## UI implications

This section is design-direction, not lock-in. The exact UX lands in Sprint 4 (canvas) and may evolve.

### Active Variables Bar

A horizontal bar at the top of the canvas, beneath the toolbar, showing all currently-active variables. Each variable rendered as a chip:

```
[ battery_voltage: 9 V ▾ ] [ ambient_temp: 25 °C (sim) ▾ ] [ board_material: FR4 ▾ ]
+ Add Variable
```

Hover any chip → shows `used_by` count + scope + description.
Click any chip → opens an inline editor for value + units + scope + active flag.
Click the `▾` arrow → opens a popup with all the chip's properties + the `used_by` list with clickable links to each referencing block.

The bar groups variables by scope visually:
- Project scope chips on the left (always present)
- Active release scope chips next, with a release-profile selector dropdown
- Active simulation scope chips next, with a simulation selector
- Inactive variables hidden by default; a "show inactive" toggle exposes them

### Drop-in mechanism

The user drops a "Variable" block onto the canvas from the palette. A dialog asks for name + type + scope + initial value + units (if quantity). Submit → the variable is added to `parameters.yaml` + the Active Variables Bar updates.

Alternative: a "+ Add Variable" button on the bar itself, opening the same dialog without requiring a canvas drop.

Both UX paths exist for discoverability.

### Block parameter inspector

When the user clicks a block to edit its parameters in the inspector panel:
- Each numeric parameter has a "🔗 Use variable" affordance next to the value field
- Click it → autocomplete dropdown of compatible variables (filtered by type + units)
- Select a variable → the parameter becomes `{ ref: <name> }`; the inspector shows the resolved value with a "🔗 battery_voltage" badge
- Click the badge → opens the variable in the Active Variables Bar's editor
- To unlink → click the badge's "× unlink" → parameter becomes literal again (with the last-resolved value as the new literal)

This makes the relationship discoverable + reversible.

### Validation feedback

When the user changes a variable's value:
- Spinner appears on the variable's chip while the validator re-runs
- Status indicators on affected blocks update in place (green check → yellow warning → red fail)
- If any block now fails, a toast appears: "battery_voltage changed to 12 V — LED current now 35 mA (exceeds 20 mA rating). Click to fix."
- The user clicks → canvas navigates to the affected block → inspector shows the failing parameter + the resistance change needed

---

## Authority split (per ADR-006)

Variables follow the same three-way authority split locked in ADR-006:

| Role | Owns |
|---|---|
| **User** | Variable creation, naming, value, scope, active/inactive, deletion. The user is the source of truth. |
| **Deterministic engine** | Resolution (which variable a `ref:` points to). Validation propagation (re-validate every block in `used_by` when a variable changes). Unit checking (a `quantity` in volts cannot bind to a parameter expecting amperes). `used_by` array population. |
| **AI consultant** | Suggesting variable usage (e.g., "you have 9 V hardcoded in 3 places; want to extract to a variable?"). Drafting variable descriptions for `parameters.yaml`'s `description` field. Explaining what a variable is when the user asks. **Never** modifying a variable's value, scope, or active flag silently. **Never** creating a variable without explicit user confirmation. |

The AI can *suggest* "extract this hardcoded 9 V into a variable" via a tool call. The user reviews + clicks Approve. The tool call's effect is bounded: it can propose a parameters.yaml edit + the affected block edits, but the user reviews the diff before commit.

Concretely, the AI tool definitions include:
- `propose_variable_extraction(value, occurrences[]) → diff_for_review` — proposes hoisting a hardcoded value to a variable; returns a diff the user approves
- `explain_variable(name) → text` — read-only; produces an explanation
- `suggest_variable_value(name, context) → suggested_value + rationale` — read-only; user applies manually or via approve
- **NOT** `set_variable_value(name, value)` — no direct mutation
- **NOT** `delete_variable(name)` — no direct mutation
- **NOT** `set_variable_active(name, active)` — no direct mutation

---

## Implementation phasing

### Sprint 2 (Layer 0-3 manifests) — minimal data shape support

- `parameters.schema.json` defines the `variables` section's shape
- Empty `parameters.yaml` ships as the project file format default (the universal object model spec gains the `variables` top-level section)
- No UI yet; no validator integration yet
- The schema is complete + tested via the existing manifest-integrity tests

### Sprint 3 (Layer 4 devices + universal object model + project file format) — schema integration

- Block parameter schema gains the `ref` field
- Resolution function lands in the engine: `resolve_parameter(block_id, param_id, scope_context) → value`
- Unit-class compatibility check between parameter declared type + referenced variable
- Save/load roundtrip preserves variables + refs
- 5-10 manifest-integrity tests covering: variable validates against schema, ref resolves, unit class matches, used_by is populated

### Sprint 4 (Canvas v1) — basic UI

- Active Variables Bar above the canvas
- Variable creation via drop or "+ Add Variable" button
- Block parameter inspector gains the "🔗 Use variable" affordance
- Linking + unlinking
- Visual indicator: variable chips, link badges on parameters
- **No** scope-switching dropdowns yet (only project scope active at v1)

### Sprint 5 (Steady-state validator) — full validation propagation

- Variable change re-validates every block in `used_by`
- `used_by` populated by validator on every run
- Validation warnings for unused variables
- UI status indicators update in place
- Click-back-to-affected-block navigation

### Sprint 6 (AI + manufacturing skeleton) — AI proposes, user approves

- AI tool definitions land: `propose_variable_extraction`, `explain_variable`, `suggest_variable_value`
- The "extract hardcoded value to variable" suggestion appears in the AI consultant's repertoire
- Release ZIP contents include variable resolution snapshots so the manufacturing record is reproducible

### Phase 2+ (post-Sprint-6) — full scope semantics

- Release scope + simulation scope dropdowns
- Multiple release profiles defined per project
- Sweep / corner analysis (probably its own ADR when motivated)
- Expression-type variables (computed from other variables; needs an expression evaluator)

---

## Validation behavior

When a variable changes (value, scope, active flag):

1. **The validator marks every block in `used_by` as `validation.status: unknown`**
2. **The validator re-runs against those blocks**, computing new status (pass/warning/fail) based on the new variable value
3. **Bubble-up**: any composite-block ancestor of an affected block also re-validates (its summary status may change)
4. **The UI updates the status indicators in place** — green check / yellow warning / red fail
5. **Any new warnings or fails surface in the bottom panel** with click-to-locate

If the validator detects a circular reference (variable A's value computed from variable B, B's from A — only possible once expression-type variables exist), it fails with a friendly error pointing at the cycle.

If a variable is referenced (`ref: x`) but `x` doesn't exist in any active scope, the validator emits an error on the referencing parameter: "variable `x` not found in any active scope; check parameters.yaml or define it."

If a variable's type doesn't match the parameter's declared type (e.g., parameter expects `quantity:V`, variable is `enum:pcb_manufacturer`), the validator emits an error on the parameter: "parameter `voltage` expects a quantity in volts; referenced variable `pcb_manufacturer` is an enum. Unlink and try a different variable."

---

## Consequences

**Becomes easier:**
- **Changing a design value once updates everything.** The 9 V → 12 V example: one edit; six blocks re-validate; manufacturing release regenerates against new values. Zero hunt-and-replace.
- **"What if" analysis is built in.** Operating at 25 °C vs 60 °C? Switch the simulation profile; the validator re-runs. Building for JLCPCB vs OSHPark? Switch the release profile; the BOM updates.
- **Documentation reflects intent, not values.** A variable named `target_max_current` with value 18 mA reads as engineering intent. A hardcoded 18 mA reads as a magic number.
- **The AI consultant's "what could go wrong?" answers are higher-quality** because it can reference named variables in explanations: "if battery_voltage drops to 7 V, R1's power dissipation drops below rating, but LED forward current also drops below visibility threshold — consider adding a buck converter."
- **Manufacturing release ZIPs are reproducible.** The release captures the variable snapshot at release time; a downstream reader sees both the released design + the design knobs that produced it.

**Becomes harder:**
- **One more concept the user has to learn.** Casual users dragging a battery + LED don't need to know about variables. Power users will love them. The UI has to make the simple case (no variables) work without friction while exposing variables when they're useful. The "🔗 Use variable" affordance is the bridge.
- **Validator state management is more complex.** Variable changes cascade through `used_by`. The validator has to be incremental enough that a single variable change doesn't trigger a full-design re-run. v1 implementation: full re-run is fine (designs are small at v1); incremental validation is a Phase 2 optimization.
- **The schema gets more complex.** `parameters.yaml` is no longer a simple key-value file; it has a structured `variables` section. The schema is more complex. Mitigation: the schema is small (~50 lines); the validator emits friendly errors; the user rarely edits `parameters.yaml` by hand (the UI does most of it).
- **Save format compatibility.** A v2 save without `parameters.yaml` should still load (every parameter is a literal). v2 saves WITH variables require v2.x readers. Forward compatibility is preserved via the additive change.

**To revisit when:**
- **Expression-type variables are needed** (e.g., derived metrics like `total_power = battery_voltage * target_max_current`). Requires an expression evaluator. New ADR.
- **Sweep / corner analysis** is needed (e.g., simulate at 25°C AND 60°C AND -20°C in one run, compare results). Could either be many simulations scoped differently, or a parameter sweep mechanism. New ADR.
- **Inter-project variable sharing** is needed (e.g., a shared variable library across multiple projects). Probably never; project files are the unit of portability.
- **Variables with side effects** are needed (e.g., a variable that triggers a code generation when changed). Avoid — this is a slippery slope away from the "explicit, named, typed" principle.

---

## Alternatives considered

### Option A — Don't have variables; let users edit each block individually

Status quo per ADR-006. Every parameter is a literal.

**Reject:** the use cases are real and common. EDA tools that don't have design variables either have terrible UX or push users into spreadsheet workarounds.

### Option B — Variables as freeform substitution strings (Jinja-like templating)

Instead of `{ ref: battery_voltage }`, use `{ value: "{{ battery_voltage }}V" }`. Treat values as strings; do template substitution at validation time.

**Reject:** loses type safety. Loses unit checking. Loses `used_by` traceability (you'd have to grep all parameters for `{{ name }}` substrings). The structured approach (named refs, schema-validated, dimensionally checked) is strictly safer.

### Option C — Variables only at one scope (project), no scoping system

Simpler.

**Reject:** the simulation + release scopes are the actually valuable use cases. The user wrote it themselves: "design might pass at 25 °C but warn at 60 °C" — that requires scope-switchable variables. Cutting scope semantics now means rebuilding when they're needed; better to lock the model now even if v1 only implements project scope (release + simulation defer to Phase 2).

### Option D — Implicit variables (any literal becomes a variable automatically)

Every literal value with the same number gets auto-grouped into a "shared value" the user could later promote.

**Reject:** magic. Two `9 V` values in unrelated parts of the design may coincidentally have the same value; auto-grouping them creates false links. The user has to be the source of truth for "these things are the same."

### Option E — AI-controlled variables (AI extracts, names, manages)

Let the AI decide what's a variable and what's literal.

**Reject:** violates the AI authority split. Per ADR-006: AI assists, ChipBlocks validates, the user approves. AI silently editing variables → user can't trust the design state.

The AI can *suggest* variable extraction via tool calls. The user approves. That's the safe shape.

---

## Action items — Sprint 2-6

### Sprint 2 (Layer 0-3 manifests)

1. [ ] Author `parameters.schema.json` covering the `variables` section. ~80 lines.
2. [ ] Update the universal object model schema (separate from `parameters.yaml`) to support the `ref:` form on block parameters as an alternative to `value:`. Mutually-exclusive constraint enforced via JSON Schema's `oneOf`.
3. [ ] Update the project file format spec (`PROJECT-FORMAT.md` when it lands in Sprint 3) to document the `parameters.yaml` shape.
4. [ ] Manifest-integrity test: a `parameters.yaml` with sample variables validates against schema; sample block with `ref:` validates against the block schema.

### Sprint 3 (devices + universal object model + project file format)

5. [ ] Implement the resolution function `resolve_parameter(block_id, param_id, scope_context) → value` in TypeScript (renderer-side) + a mirror later in Python (backend-side, when added).
6. [ ] Implement scope-walk: start at block, walk up parent chain, then check active release scope, then active simulation scope, then project scope.
7. [ ] Implement unit-class compatibility check during resolution.
8. [ ] Implement `used_by` population during validation.
9. [ ] Save/load roundtrip test covering variables + refs (write project with variables, read, write, byte-identical).

### Sprint 4 (canvas)

10. [ ] Active Variables Bar component above the canvas (project scope only at v1; UI for release + simulation scopes deferred to Phase 2).
11. [ ] Variable creation dialog (name + type + scope + initial value + units).
12. [ ] Block parameter inspector "🔗 Use variable" affordance + autocomplete dropdown of compatible variables.
13. [ ] Link badge rendering on parameters using a `ref:`.
14. [ ] Unlink affordance (parameter reverts to literal with last-resolved value).
15. [ ] Visual styling for `active: false` variables (greyed-out chip).

### Sprint 5 (validator)

16. [ ] Validator re-runs on variable change for every block in the variable's `used_by`.
17. [ ] Bubble-up to composite-block ancestors.
18. [ ] Bottom-panel warnings/errors with click-to-locate for variable-related issues.
19. [ ] Unused-variable warning ("variable defined but never referenced — typo?").

### Sprint 6 (AI integration)

20. [ ] AI tool definitions: `propose_variable_extraction`, `explain_variable`, `suggest_variable_value`.
21. [ ] AI system prompt instruction: never directly mutate variables; always propose.
22. [ ] Manufacturing release ZIP includes a variable-snapshot file (`variables-at-release.yaml`) so the released design is reproducible from variables.

### Phase 2+ (post Sprint 6)

23. [ ] Release scope + simulation scope UI (dropdowns, multi-profile management).
24. [ ] Expression-type variables (separate ADR).
25. [ ] Variable sweep / corner analysis (separate ADR).

---

## What this ADR does NOT lock

- **Specific UI styling.** The Active Variables Bar's visual design is for Sprint 4's canvas implementation.
- **The exact JSON Schema for parameters.yaml.** Sprint 2 authors this; the shape in this ADR is the guide.
- **Validator incremental re-run performance.** v1 implementation may be a full re-run; incremental is Phase 2 optimization.
- **Cross-project variable libraries.** Out of scope; the project file is the unit of variable storage.
- **Variable migration when types change.** If a user changes a variable from `quantity:V` to `quantity:mV`, what happens to existing references? Probably: validator warns, user re-confirms. Detail in Sprint 5.

---

## What this unblocks

- **Single-source-of-truth for design knobs.** Every value the user wants to vary across the design has a named home.
- **"What if" analysis becomes built-in.** Switch simulation profile, see results.
- **AI consultant can suggest extraction without authoring.** The AI proposes; the user approves. Authority split preserved.
- **Release ZIPs are reproducible from variables alone.** The variable snapshot at release time + the design's structure = the entire spec for that release.
- **Future scope expansion is additive.** New variable types, new scopes, new resolution rules all extend without breaking v1 saves.
