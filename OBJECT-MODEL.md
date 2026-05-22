# OBJECT-MODEL.md

> **Status:** Canonical v3 foundation spec — drafted 2026-05-20.
> **Scope:** Defines the ground-truth object model for ChipBlocks before schemas, UI, solvers, devices, or manufacturing output.
> **Supersedes:** ADR-006, ADR-007 implementation paths, and the v2 Sprint 3 primitive-device plan for active planning.

## Axiom

> **ChipBlocks may define real phenomena before it can solve them. It may not fake values, fake physics, fake sources, or mark unsupported behavior as passing.**

The whole rest of this document is mechanism in service of this single rule.

---

## Design priority

ChipBlocks prioritizes correctness and depth before immediate usability.

The foundation may be harder to use at first if that is required to keep the model physically honest. However, the model must not ignore usability entirely. Some choices become expensive to change later, especially object identity, definition/instance separation, provenance, units, parameter references, layering, and override rules.

The rule:

> **Design for correctness now, but preserve a path to usability later.**

This means:

- no fake simplifications just to make the UI easy
- no hidden magic values
- no unsupported physics marked as passing
- no schema shortcuts that block future visual editing
- no object shapes that only make sense to experts
- no field names that are mathematically correct but unreadable to users unless there is a user-facing label/description layer

### Priority order

```
1. Physical correctness
2. Depth / extensibility
3. Explicit unsupported status
4. Future usability hooks
5. Polished usability
```

Not the reverse:

```
1. Easy UI
2. Fake simplified model
3. Patch correctness later   ← exactly the path we're avoiding
```

### Usability hooks to preserve from day one

These are not UI polish. They are future-usability infrastructure. Leaving them out now makes the later usability pass painful or impossible.

- `name` (human-readable label) on every definition
- `description` (one-to-three sentence prose) on every definition
- units on every quantity
- conditions on every condition-bound value
- provenance on every builtin/community physical value
- support status (model_status × solver_status) on every object that gets solved
- cited `default:` values on definition parameter slots where real
- `ref:` on instance parameter values for cross-instance reuse
- extension rules (overridable, user_extensible, allowed_origins)
- worked examples in this document and (eventually) `CONTRIBUTING.md`

### Do not weaken these for usability

These are structural. If they're wrong, future usability is fake usability.

- definition vs instance
- capabilities vs behaviors
- origin rules
- provenance for builtins / community
- real units
- condition-bound values
- support status enum
- anti-placeholder rules

### Can wait for a future usability pass

These sit above the model. They should not reshape the foundation too early.

- canvas layout and visual editing
- beginner-friendly block names and grouping
- guided questions and AI-driven explanations
- beginner mode and progressive disclosure
- automatic simplification of complex models
- tutorial examples and onboarding flows
- manufacturing wizards

### In one sentence

**Correctness-first, usability-aware.** ChipBlocks starts by modeling reality honestly, even when that makes the early system harder to use. Usability is still a design constraint: foundational choices must preserve a future path to a clear visual editor, beginner-friendly explanations, and safe project workflows.

---

## 1. Status and scope

This document is the canonical specification for ChipBlocks's universal object model. It describes the shape every "thing" in ChipBlocks takes — material, shape, interface, behavior, device, circuit, board, chip, system — and the rules that govern how those things are authored, validated, and composed.

It is **not** a schema (those come in v3 Sprint 2), a UI (that comes much later), a solver (later still), or a sprint plan (the new sprint cadence lives elsewhere).

It is the answer to the question: **what is a "thing" in ChipBlocks?**

Reviewers should hold every claim below up to the axiom. Anything that lets fake values, fake physics, or unmarked unsupported behavior slip through is a bug in this document.

---

## 2. Definition vs Instance

The single most load-bearing distinction in the entire model.

| Aspect | Definition | Instance |
|---|---|---|
| **What it is** | Reusable truth ("what a copper wire is") | Project-specific use ("this 20cm copper wire connecting resistor_3 to led_1") |
| **Lives in** | Manifests (YAML files at any origin) | Project files (`project` origin only) |
| **Authored by** | Library or pack authors | Project users |
| **Allowed origins** | builtin / community / user_local / project | project only |
| **Provenance required?** | Yes, for builtin and community physical values | No |
| **Reusable?** | Yes, across many projects | No, scoped to one project |
| **Carries `ref:`?** | Never | Only on parameter values |
| **Carries `default:`?** | Yes (cited defaults for parameter slots) | No |

### Example pair

```yaml
# Definition — copper_wire (lives in manifest)
kind: primitive_device
id: copper_wire
origin: builtin
layer: primitive_device
name: Copper wire
description: A length of copper drawn into a path with two terminals.
composition:
  uses: [copper, path, terminal]
behaviors:
  - conducts_current
  - has_resistance
  - produces_joule_heat
parameters:
  length:
    type: quantity
    units: m
    required: true
  cross_section_area:
    type: quantity
    units: m2
    required: true
  # no `value:` or `ref:` here — definitions declare slots, not values
support:
  model_status: defined
  solver_status: builtin_simple
extensions:
  overridable: true
  user_extensible: true
  allowed_origins: [builtin, community, user_local, project]
```

```yaml
# Instance — wire_001 (lives in a project file)
kind_ref: primitive_device
definition: copper_wire
id: wire_001
origin: project
parameters:
  length:
    value: { kind: scalar, amount: 0.2, unit: m }
  cross_section_area:
    ref: project_default_wire_area   # legal here; forbidden on definitions
connects:
  - { net: net_5, terminal: terminal_a, of: resistor_3 }
  - { net: net_5, terminal: terminal_b, of: led_1 }
```

### The two halves of the schema

Two YAML shapes, validated by two schemas with shared fragments. The shared fragments (identity, provenance, quantity values, support status) get `$ref`'d into both. Schema details land in v3 Sprint 2.

---

## 3. Identity

Every object — definition or instance — carries these identity fields:

| Field | Definitions | Instances | What it is |
|---|:---:|:---:|---|
| `id` | ✓ required | ✓ required | Unique within origin scope. `snake_case`. Stable across edits. |
| `name` | ✓ required | optional | Human-readable label. Free-form. |
| `description` | ✓ required | optional | One-to-three sentence prose summary. |
| `kind` (definitions) / `kind_ref` (instances) | ✓ required | ✓ required | What kind of thing this is. Enum (see Section 4). |
| `origin` | ✓ required | ✓ required | Where this object came from. Enum: `builtin / community / user_local / project`. |

### Why name and description are asymmetric

Definitions **require** `name` and `description` — they are the load-bearing human-readable usability hooks (per the Design priority section). A material or device definition that ships without a human label or summary is anti-usability.

Instances **default** rather than require:

- `instance.name` defaults to `"<definition.name> #<n>"` (e.g., `"Copper wire #1"` for the first `copper_wire` instance)
- `instance.description` defaults to the definition's `description`

This preserves usability without forcing the user to hand-label hundreds of project instances. An instance may override either field when a specific human label adds value (e.g., naming a wire `"VCC rail to MCU pin 13"`).

Identity fields **do not require provenance** — they're the object's self-identification, not citable physical claims.

---

## 4. Named layers and the kind taxonomy

Layers are named, not numbered. Renumbering breaks references; renaming requires intent.

| Layer name | Position in stack | What lives here |
|---|---|---|
| `material` | bottom | Substances (copper, silicon, FR4) |
| `shape` | | Geometric forms (path, plate, gap) |
| `interface` | | Connection points (terminal, contact, via) |
| `behavior` | | Physics laws (conducts, resists, joule_heating) |
| `primitive_device` | | First composable things (wire, resistor, LED, switch) |
| `circuit` | | Composed circuits (divider, filter, oscillator) |
| `assembly` | | Functional blocks (IC, sensor module) |
| `board_or_chip` | | PCBs, ASICs, MCU boards |
| `system` | top | Phones, watches, robots, full devices |

Plus one **cross-layer** value:

| `cross_layer` | spans all layers | Property definitions (the concept of "resistance" as a quantity) |

### Kind taxonomy

The `kind` field on a definition (or `kind_ref` on an instance) is one of:

| Kind | Layer | Instantiable? | Field for behaviors |
|---|---|:---:|---|
| `material` | material | rarely | `enables` |
| `shape` | shape | rarely | `enables` |
| `interface` | interface | ✓ | `enables` |
| `behavior` | behavior | ✗ (registry only) | n/a |
| `property_definition` | cross_layer | ✗ (registry only) | n/a |
| `primitive_device` | primitive_device | ✓ | `behaviors` |
| `circuit` | circuit | ✓ | `behaviors` |
| `assembly` | assembly | ✓ | `behaviors` |
| `board_or_chip` | board_or_chip | ✓ | `behaviors` |
| `system` | system | ✓ | `behaviors` |

The schema enforces: behaviors and property_definitions cannot have instances.

---

## 5. Origins

The four-origins model. Same schema validates all four; resolution order determines precedence.

| Origin | Lives in | Purpose | Provenance required (physical values)? |
|---|---|---|:---:|
| `builtin` | ChipBlocks app itself | Ships with the application | ✓ |
| `community` | Installed packs (e.g., `chipblocks-rf`) | Domain-specific libraries | ✓ |
| `user_local` | `~/.chipblocks/` | Personal definitions across projects | Recommended, not required |
| `project` | `MyProject.chipblocks/` | Project-specific definitions and all instances | Recommended, not required |

### Resolution order

When the same `id` exists in multiple origins, the innermost wins:

```
project → user_local → community → builtin
```

A shadowed entry must surface a UI warning when noticed. No silent override.

### Per-object extension control

Every definition declares which origins are allowed to override or extend it (see Section 11).

---

## 6. Capabilities vs Behaviors

The emergence rule. Materials, shapes, and interfaces have **capabilities** — latent properties that *enable* behaviors when combined with other layers. Devices and up have **behaviors** — actual physics they participate in once wired.

### Per-kind field name

| Layer | Field name | Example |
|---|---|---|
| material | `enables` | copper enables `electrical_conduction`, `thermal_conduction` |
| shape | `enables` | path enables `path_role` (cross-section integration) |
| interface | `enables` | terminal enables `external_connection` |
| behavior | n/a | the behavior itself |
| device and up | `behaviors` | copper_wire has behaviors `conducts_current`, `has_resistance`, `produces_joule_heat` |

### The emergence rule (current form)

For now, **device definitions explicitly adopt the behaviors they participate in.** Future work may derive behaviors from a device's composition (material × shape × interface → behaviors), but Sprint 1 of v3 does not commit to that derivation; explicit adoption is the rule.

This makes the model:
- **Honest** — no fake "emergent" behaviors with no defined source
- **Inspectable** — anyone reading a device definition sees exactly which behaviors it claims
- **Bounded** — the validator only checks behaviors the device explicitly carries

When derivation becomes a feature, the schema will gain a `derived_behaviors:` field separate from the explicit `behaviors:` list; explicit adoption stays as the floor.

---

## 7. Property value kinds

Property values are polymorphic from day one. A property carries a `value` block whose shape depends on its `kind`.

| Value kind | Shape | When used |
|---|---|---|
| `scalar` | single `amount` + `unit` | Constants, single-point properties |
| `range` | `min`, `max`, optional `typical`, optional `distribution` | Manufacturing tolerance spread |
| `condition_bound` | `amount` + `unit` + `conditions` block | Temperature-dependent, frequency-dependent values |
| `equation` | symbolic expression + named inputs | Closed-form models (Ohm's law, Caughey-Thomas) |
| `curve` | parameterized function shape (e.g., Arrhenius, exponential) | Temperature curves, aging curves |
| `lookup_table` | array of `{conditions, value}` rows + interpolation rule | Empirical data with no clean formula |
| `unknown_user_supplied` | user-typed amount + unit, no provenance | **Restricted: user_local and project only** |

### Examples per kind

```yaml
# scalar
value: { kind: scalar, amount: 1.68e-8, unit: ohm_meter }

# range
value:
  kind: range
  min: 1.65e-8
  max: 1.72e-8
  unit: ohm_meter
  distribution: normal

# condition_bound
value:
  kind: condition_bound
  amount: 1.68e-8
  unit: ohm_meter
  conditions:
    temperature: { amount: 20, unit: degC }

# equation
value:
  kind: equation
  expression: "rho_0 * (1 + alpha * (T - T_0))"
  inputs:
    rho_0: { amount: 1.68e-8, unit: ohm_meter }
    alpha: { amount: 0.00393, unit: per_kelvin }
    T_0: { amount: 293.15, unit: kelvin }
    T: { kind: input_variable, unit: kelvin }
  output_unit: ohm_meter

# curve (sketch — exact form TBD in v3 Sprint 2 schema)
value:
  kind: curve
  curve_type: caughey_thomas
  parameters: { mu_min: 68.5, mu_max: 1414, N_ref: 9.2e16, alpha: 0.711 }
  unit: cm2_per_volt_second

# lookup_table
value:
  kind: lookup_table
  interpolation: linear
  points:
    - { conditions: { temperature: { amount: 0, unit: degC } }, amount: 1.55e-8 }
    - { conditions: { temperature: { amount: 20, unit: degC } }, amount: 1.68e-8 }
    - { conditions: { temperature: { amount: 100, unit: degC } }, amount: 2.21e-8 }
  unit: ohm_meter

# unknown_user_supplied (user_local or project only)
value:
  kind: unknown_user_supplied
  amount: 4700
  unit: ohm
  note: "Measured with my multimeter, no datasheet handy"
```

The schema enforces: `unknown_user_supplied` is rejected at validation time if `origin` is `builtin` or `community`.

---

## 8. Conditions

Conditions attach to property values, not to objects themselves. They describe under what assumptions a value holds.

### Standard condition keys

| Condition | Unit example | When relevant |
|---|---|---|
| `temperature` | `degC`, `kelvin` | Almost everything physical |
| `frequency` | `Hz`, `kHz`, `MHz`, `GHz` | Capacitance, dielectric, impedance |
| `pressure` | `Pa`, `atm` | Gases, mechanical |
| `humidity` (relative) | `pct` | Dielectrics, surface conduction |
| `bias_voltage` | `V` | Semiconductor properties |
| `current_density` | `A_per_m2` | Electromigration, mobility |
| `state_of_charge` | `pct` | Battery voltages |
| `mechanical_stress` | `Pa` | Strain-coupled effects |
| `irradiation` | `Gy`, `n_per_cm2` | Radiation-hardened parts |

### Composition

Multiple conditions can attach to one value:

```yaml
value:
  kind: condition_bound
  amount: 4.4
  unit: dimensionless
  conditions:
    temperature: { amount: 20, unit: degC }
    frequency: { amount: 1, unit: GHz }
    humidity: { amount: 50, unit: pct }
```

Not every property needs every condition. The schema does not require any specific condition; conditions are declarative documentation of which assumptions the value depends on.

---

## 9. Provenance

Required for builtin and community physical values. Not required for identity, not required for user_local or project values (but recommended).

### Provenance fragment shape

```yaml
provenance:
  source_type: standard       # one of: standard | reference | datasheet | community | user_supplied
  title: "Copper resistivity, annealed, at 20 C"
  citation: "NIST CODATA 2018; IEC 60028 international annealed copper standard"
  url: "https://physics.nist.gov/cuu/Constants/"   # optional
  date_accessed: "2026-05-18"                        # optional but recommended
  confidence: high                                   # one of: high | medium | low | unknown
```

### Multi-source citations

Multiple sources today: semicolon-separated string in the `citation` field. A future schema enhancement will upgrade to `sources: [...]` as an array; the semicolon convention is a temporary encoding pattern, not a placeholder per the axiom (placeholders fake values; this encodes real values in a transitional shape).

See [MATERIAL-SOURCES.md](MATERIAL-SOURCES.md) for the per-category canonical sources contributors should cite from.

### Conceptual reference

The provenance shape is informed by W3C PROV-O (Entity, wasDerivedFrom, wasAttributedTo). ChipBlocks does not import PROV-O directly — full PROV-O is RDF/OWL — but the conceptual model is taken from it.

---

## 10. Support status

Two orthogonal axes, both required on definitions of kinds that get solved (devices, circuits, behaviors, etc.). Materials and shapes typically use `not_applicable` on solver_status.

```yaml
support:
  model_status: defined
  solver_status: builtin_simple
```

### `model_status` enum

| Value | Meaning |
|---|---|
| `defined` | Complete entry with all required fields and provenance |
| `partial_but_real` | Some fields filled with cited values; others honestly absent |
| `needs_more_sources` | Values present but only one citation; cross-reference pending |
| `deprecated` | Was once the canonical entry; superseded by another |

### `solver_status` enum

| Value | Meaning |
|---|---|
| `not_applicable` | This kind isn't a thing-that-gets-solved (materials, shapes) |
| `defined_not_solved` | Known phenomenon; no solver implementation yet. **The honesty mechanism.** |
| `builtin_simple` | Validator computes directly (Ohm, KVL, Joule heating) |
| `builtin_approximation` | Validator runs rule-of-thumb estimate; confidence: medium |
| `warning_only` | Validator detects when phenomenon may matter; warns; does not compute |
| `external_solver` | Routes to ngspice / Yosys / specialist tool |
| `research_future` | Known phenomenon; not yet supported at any level |

`defined_not_solved` is the load-bearing case. It says: *this physics is real, ChipBlocks knows about it, the solver does not handle it yet.* That is not a placeholder.

---

## 11. Extension / override rules

Every object declares its own extensibility:

```yaml
extensions:
  overridable: true              # can a higher-precedence origin override this?
  user_extensible: true          # can users add new instances of this kind?
  allowed_origins: [builtin, community, user_local, project]
```

### Resolution

When `overridable: true` and a higher-precedence origin defines an entry with the same `id`, the higher-precedence wins. The shadowed entry must surface a UI warning.

When `overridable: false`, the entry cannot be shadowed. Attempting to shadow it is a hard error at load time.

When `user_extensible: false`, instances of this kind cannot be created in `user_local` or `project` origins. Used for foundational definitions that must remain canonical.

`allowed_origins` restricts which origins this *kind* can appear in at all. A `material` kind with `allowed_origins: [builtin]` means only the app itself can define materials of this category — useful for reserved namespaces.

---

## 12. Anti-placeholder rules

The five hard rules. The schema enforces each.

**Rule 1 — Builtin physical values require structured value + provenance.**
Every entry in a definition's `properties.*` block at `origin: builtin` must have a `value` block whose `kind` is one of `scalar / range / condition_bound / equation / curve / lookup_table` AND a non-empty `provenance` block.

**Rule 2 — `unknown_user_supplied` is restricted.**
Value kind `unknown_user_supplied` is rejected at validation time when origin is `builtin` or `community`. Allowed only in `user_local` and `project`.

**Rule 3 — No fake, dummy, or temporary values.**
The schema cannot detect intent, but the principle holds in review: any value introduced as a placeholder for "we'll fix this later" fails the axiom. The model has `defined_not_solved` for honest absence; use it.

**Rule 4 — No "pass by absence."**
Unsupported behavior cannot silently pass validation. Every behavior an object claims must have a `solver_status`. If the solver can't compute it, the status must be one of `defined_not_solved`, `warning_only`, `external_solver`, or `research_future`. The validator's report must surface the status; passing-by-default is forbidden.

**Rule 5 — `defined_not_solved` is the honest absence, not a placeholder.**
A definition saying `solver_status: defined_not_solved` is *not* a placeholder. It is an honest claim: *the model knows this phenomenon exists and has defined it; the solver does not implement it yet.* This is the difference between an axiom-respecting absence and a fake.

---

## 13. Active Variables as instance references

Project-scoped named values (per the original ADR-007 idea) survive as the standard mechanism for parameter reuse across instances *within a project*. They land as `ref:` on instance parameter values.

### The `ref:` shape (instance-only)

```yaml
# Instance parameter via direct value
parameters:
  voltage:
    value: { kind: scalar, amount: 5.0, unit: V }

# Instance parameter via Active Variable ref
parameters:
  voltage:
    ref: project_default_supply_5v
```

### The `default:` shape (definition-only)

A definition may carry a cited default value for any parameter slot. Instances accept it by omission, override it with their own value, or override it with a `ref:`.

```yaml
# Definition
parameters:
  forward_voltage:
    type: quantity
    units: V
    required: false
    default:
      value: { kind: scalar, amount: 2.0, unit: V }
      provenance:
        source_type: datasheet
        citation: "Kingbright L-7113ID red LED datasheet, Vf @ 20 mA"
        confidence: medium
```

### Hard rules

- `ref:` is **forbidden** on definitions. Definitions are self-contained and portable across projects.
- `default:` is **forbidden** on instances. Instances supply concrete values, not new defaults.
- A parameter value carries exactly one of: `value:`, `ref:`, or omission (accepting the definition's `default:`). The schema enforces mutual exclusion.
- A `ref:` must resolve at instance-load time to an Active Variable in the same project. Unresolved refs are a hard error.
- The referenced Active Variable's `type` and `units` must match the parameter's declared `type` and `units`. Mismatch is a hard error.

### Why definitions can't `ref:`

If a builtin or community definition references a project-scoped variable, the definition stops being portable. The four-origins model collapses (a community pack would only work in projects that happened to define the right variables). Definitions are self-contained; instances are project-contextual.

---

## 14. Examples

> **Example-data note:** The examples below use real cited values so the object shape is shown honestly, not with fake placeholders. These examples are illustrative. They are not the canonical material/device database. When `materials.yaml`, `devices.yaml`, or other authored registries exist, those files are authoritative for shipped values. If a future registry entry differs from an example here, the registry wins and this document should be updated or simplified to avoid drift.

### Example A — A material definition (no instance side)

```yaml
kind: material
id: copper
origin: builtin
layer: material
name: Copper (Cu)
description: Electrically and thermally conductive metallic element. Standard conductor for wires, traces, contacts.
composition:
  uses: []                                  # ground-layer: no lower-layer dependencies
enables:
  - electrical_conduction
  - thermal_conduction
properties:
  resistivity:
    value:
      kind: condition_bound
      amount: 1.68e-8
      unit: ohm_meter
      conditions:
        temperature: { amount: 20, unit: degC }
    provenance:
      source_type: standard
      title: Copper resistivity, annealed, at 20 C
      citation: "NIST CODATA 2018; IEC 60028 international annealed copper standard"
      confidence: high
    support:
      model_status: defined
      solver_status: not_applicable
  density:
    value:
      kind: condition_bound
      amount: 8960
      unit: kg_per_m3
      conditions:
        temperature: { amount: 20, unit: degC }
    provenance:
      source_type: reference
      title: Copper density at 20 C
      citation: "CRC Handbook of Chemistry and Physics, 102nd ed."
      confidence: high
    support:
      model_status: defined
      solver_status: not_applicable
support:
  model_status: defined
  solver_status: not_applicable
extensions:
  overridable: true
  user_extensible: true
  allowed_origins: [builtin, community, user_local, project]
```

### Example B — A device definition + a matching instance

```yaml
# DEFINITION
kind: primitive_device
id: copper_wire
origin: builtin
layer: primitive_device
name: Copper wire
description: A length of copper drawn into a path with two terminals.
composition:
  uses: [copper, path, terminal]
behaviors:
  - conducts_current
  - has_resistance
  - produces_joule_heat
parameters:
  length:
    type: quantity
    units: m
    required: true
    description: Path length end-to-end.
  cross_section_area:
    type: quantity
    units: m2
    required: true
    description: Conductive cross-section.
  temperature:
    type: quantity
    units: degC
    required: false
    default:
      value: { kind: scalar, amount: 20, unit: degC }
      provenance:
        source_type: standard
        citation: "Standard ambient assumption per IEC 60721-3-3 Class 3K3"
        confidence: high
support:
  model_status: defined
  solver_status: builtin_simple
extensions:
  overridable: true
  user_extensible: true
  allowed_origins: [builtin, community, user_local, project]
```

```yaml
# INSTANCE (in a project file)
kind_ref: primitive_device
definition: copper_wire
id: wire_001
origin: project
parameters:
  length:
    value: { kind: scalar, amount: 0.2, unit: m }
  cross_section_area:
    value: { kind: scalar, amount: 1.0e-7, unit: m2 }
  # temperature omitted → accepts the definition's cited default
connects:
  - { net: net_signal, terminal: terminal_a, of: resistor_3 }
  - { net: net_signal, terminal: terminal_b, of: led_1 }
```

---

## 15. Deferred questions

Surfaced now so they can't accidentally be answered by side effect later.

| Deferred question | Likely owner |
|---|---|
| **Capability → behavior emergence rule.** Today devices explicitly adopt behaviors. A future feature may derive behaviors from material × shape × interface composition. | v3 Sprint 5+ |
| **Net model.** Instances above currently use ad-hoc `connects:` syntax. EDA tradition has explicit *nets* as first-class objects spanning N terminals. The full net model needs its own design pass. | v3 Sprint 3 |
| **Project file format.** What does a `MyProject.chipblocks/` folder actually contain? Schema for project files lives separately from object-model schemas. | v3 Sprint 2 or 3 |
| **`property_definition` registry shape.** The cross-layer registry of property concepts (what "resistance" means, what units, what behaviors produce it) needs its own concrete schema. | v3 Sprint 2 |
| **`behavior` registry shape.** Same — the registry of named physics laws (`conducts_current`, `joule_heating`, etc.) with their parameter requirements and emergence preconditions. | v3 Sprint 2 |
| **Multi-version definitions.** When a community pack publishes copper_wire@1.2.0 and a project depends on @1.1.0, version resolution is its own problem. | Sprint 7+ |
| **Cross-pack dependency declarations.** A `chipblocks-power` pack uses things from `chipblocks-passive`; how is the dependency expressed and enforced? | Sprint 8+ |
| **Schema migration story.** When this very model changes (it will), how do old project files keep loading? | After v3 Sprint 2 |
| **v3 Usability Review.** A dedicated future pass to evaluate the foundation against real user tasks: visual-editor candidacy, terminology audit, beginner-friendly explanations, progressive-disclosure design, default-value rationalization, accessibility (keyboard nav, screen-reader support, status-by-text-not-color-only), and safe workflow design. Naming it now preserves the commitment that usability gets deliberate review after the foundation is deep enough to evaluate. | Future v3 sprint |

These deferrals are explicit. They do not get answered by code accident in the meantime.

---

## How this doc evolves

This is a v3 Sprint 1 deliverable. Two outcomes are possible:

1. **The doc survives review.** It locks. v3 Sprint 2 writes `schemas/object.schema.json` (or split definition/instance schemas) that implements every claim above. Any tension between the schema and this doc gets resolved by editing the doc, not by drifting the schema.

2. **The doc fails review.** Specific sections get revised; the doc reopens for another pass. The schema does not begin until the doc settles.

When a future v3 sprint touches anything in this doc — adding a value kind, refining a support_status enum value, etc. — the change lands as an edit to this file, dated, with a one-line "Revised YYYY-MM-DD" note. ADRs may eventually pin specific sub-decisions; this doc remains the canonical synthesis.
