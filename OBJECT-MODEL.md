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
| **What it is** | Reusable truth ("what a wire is") | Project-specific use ("this 20cm copper wire connecting resistor_3 to led_1") |
| **Lives in** | Manifests (YAML files at any origin) | Project files (`project` origin only) |
| **Authored by** | Library or pack authors | Project users |
| **Allowed origins** | builtin / community / user_local / project | project only |
| **Provenance required?** | Yes, for builtin and community physical values | No |
| **Reusable?** | Yes, across many projects | No, scoped to one project |
| **Carries `ref:`?** | Never | Only on parameter values |
| **Carries `default:`?** | Yes (cited defaults for parameter slots) | No |

### Example pair

```yaml
# Definition — wire (lives in a manifest; generic, no material baked in)
kind: primitive_device
id: wire
origin: builtin
layer: primitive_device
name: Wire
description: A conductive physical path connecting two or more electrical interfaces.
composition:
  requires:                              # role-based, not exact (see Section 6)
    conductor_material: { kind: material, must_enable: [electrical_conduction] }
    geometry: { kind: shape, must_enable: [path_role] }
    endpoints: { kind: interface, min_count: 2 }
behaviors:
  - conducts_current
  - has_resistance
  - produces_joule_heat
parameters:
  conductor_material:
    type: material_ref
    satisfies_role: conductor_material   # fills the requires role; see Section 6
    required: true
  geometry:
    type: shape_ref
    satisfies_role: geometry
    required: true
    default: { value: path }             # explicit role fill, not implied by dimensions
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
# Instance — wire_001 (lives in a project file; a specific copper wire)
kind_ref: primitive_device
definition: wire
id: wire_001
origin: project
parameters:
  conductor_material:
    value: copper                        # material_ref → id of a material definition
  geometry:
    value: path                          # shape_ref → explicit geometry, not implied by dimensions
  length:
    value: { kind: scalar, amount: 0.2, unit: m }
  cross_section_area:
    ref: project_default_wire_area       # `ref:` legal here; forbidden on definitions
connects:
  - { net: net_5, terminal: terminal_a, of: resistor_3 }
  - { net: net_5, terminal: terminal_b, of: led_1 }
```

"Copper wire" is therefore an *instance* (or, later, a named preset) that picks `conductor_material: copper` — never a baked-in device definition. The same `wire` definition serves copper, aluminum, nichrome, or any material that enables electrical conduction.

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

- `instance.name` defaults to `"<definition.name> #<n>"` (e.g., `"Wire #1"` for the first `wire` instance)
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

### Geometry and mechanical scope

ChipBlocks is **not a 3D CAD tool.** The geometry model is **layered 2D / 2.5D electronics geometry**: it understands physical stack order, layer thickness, package/body dimensions, component height, clearances, pad/footprint dimensions, via depth, and fit constraints — but only where those facts affect electronics, manufacturability, thermal behavior, or reliability.

**The `shape` layer means primitive electronics-relevant geometry only:** path, region, plate, film, gap, hole, layer, junction, surface, cross-section. It is not a CAD canvas. CAD-like freeform custom-shape authoring is deferred and belongs to higher-level tooling above the foundation — if it ever arrives at all.

**Mechanical is support data, not a primary domain.** Model mechanical facts only when they affect electronics behavior, manufacturability, fit, reliability, safety, or thermal behavior.

- In scope: dimensions, clearances, stackup, package sizes, bend radius, vibration/environment conditions, solder-joint reliability warnings.
- Out of scope: full mechanical stress/strain, FEA, gears, hinges, bearings, robot mechanisms, enclosure CAD, fluid dynamics, moving mechanisms.

**Construction is a device/structure concern, not a shape-layer concern.** A wire's construction (`solid_core`, `stranded`, `braided`, `litz`, `ribbon`) is an option/property of the wire *device* or preset — it does not turn the bottom `shape` layer into CAD. Exact representation deferred.

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
| device and up | `behaviors` | wire has behaviors `conducts_current`, `has_resistance`, `produces_joule_heat` |

### The emergence rule (current form)

For now, **device definitions explicitly adopt the behaviors they participate in.** Future work may derive behaviors from a device's composition (material × shape × interface → behaviors), but Sprint 1 of v3 does not commit to that derivation; explicit adoption is the rule.

This makes the model:
- **Honest** — no fake "emergent" behaviors with no defined source
- **Inspectable** — anyone reading a device definition sees exactly which behaviors it claims
- **Bounded** — the validator only checks behaviors the device explicitly carries

When derivation becomes a feature, the schema will gain a `derived_behaviors:` field separate from the explicit `behaviors:` list; explicit adoption stays as the floor.

### Composition: `uses` vs `requires`

A definition declares what it is built from in one of two forms:

**`uses`** — exact dependency on specific lower-layer objects by id. Used when composition is genuinely fixed:

```yaml
composition:
  uses: [specific_object_a, specific_object_b]
```

**`requires`** — role-based dependency by kind + capability. Used for reusable, configurable definitions:

```yaml
composition:
  requires:
    conductor_material:
      kind: material
      must_enable: [electrical_conduction]
    geometry:
      kind: shape
      must_enable: [path_role]
    endpoints:
      kind: interface
      min_count: 2
```

| Form | Meaning |
|---|---|
| `uses` | Exact lower-layer dependency — this object is made of exactly these things |
| `requires` | Role-based dependency by kind/capability — this object needs *a* conductor, *a* path, *2+* endpoints |

`requires` is what lets a `wire` definition stay generic while still grounded in real material/shape/interface requirements: it requires *a* conductor material (any material that enables electrical conduction), not one specific material. `must_enable` ties directly to the capabilities (the `enables` field) declared by materials, shapes, and interfaces above. The actual material is chosen at instance time via a `material_ref` parameter.

### Roles and the parameters that fill them

`composition.requires` declares required composition *roles*. `parameters` declares user-settable *values*. These are different concerns — but they describe the same thing when the required lower-layer object is **user-selectable**.

The rule: **a role in `composition.requires` may be satisfied by a parameter slot when the required lower-layer object is user-selectable. In that case, the parameter must declare `satisfies_role: <role_id>`.** The role defines *what kind of object is acceptable*; the parameter defines *how the instance supplies the choice*.

```yaml
composition:
  requires:
    conductor_material:
      kind: material
      must_enable: [electrical_conduction]

parameters:
  conductor_material:
    type: material_ref
    satisfies_role: conductor_material   # ← links the parameter to the role
    required: true
```

This is not duplication — it is *role* (the constraint) plus *fill mechanism* (how the instance chooses). The validator uses the role to check that whatever the instance picks actually satisfies the constraint (see §15, role-satisfaction validation).

Not every required role is filled by a parameter. User-selectable roles use `satisfies_role` parameters; structural roles may be satisfied by other object sections. For example, a wire's `endpoints` role is satisfied by the future net/connectivity model (see §15, net model), not by a normal parameter.

Optional roles (e.g., a wire's `insulation_material`, which is not a required role) — whether they appear in `requires` marked optional, or only as plain parameters — is deferred to v3 Sprint 2.

### Materials are a reusable database, not trapped in device IDs

Materials must stay reusable across many objects — wire, PCB trace, via plating, pad, connector contact, bond wire, busbar, coil winding, shielding, heat spreader, and more. A material is defined once (e.g., `copper`) and referenced by role wherever a conductor is needed.

**Do not trap material choices inside device IDs.** `copper_wire` as a *base device definition* is the anti-pattern this rule corrects — it bakes a material into a device. The correct shape is a generic `wire` device that `requires` a conductor material, plus instances (or presets) that pick `conductor_material: copper`. Device definitions refer to material *roles* or material *references*, never hardcoded material-specific names — unless the object truly is material-specific.

---

## 6.5 State machines as declarative description

Some devices are inherently stateful — a switch is open or closed; a relay's coil is energized or de-energized; a MOSFET conducts or not depending on gate state; a flip-flop holds a 0 or 1. These states are neither physics laws (those are §6 behaviors) nor latent capabilities (those are §6 capabilities). They are **discrete configurations** the device can be in, with rules for transitioning between them.

The model captures these as **declarative state machines** on device definitions. A state machine describes:

- Which **states** the device can occupy (e.g., `open`, `closed`)
- Which state the device **starts in** (`initial_state`)
- Which **transitions** are allowed, and what **triggers** each

### Descriptive, not evaluative

State machines are described in the schema, **not simulated**. The model says "here's the FSM"; nothing tracks "this specific switch is currently closed." That's a canvas/simulator concern, the same way Ohm's law lives in the behavior registry but is not actually solved by the validator. Both follow the same honesty rule: declare what's true without faking solving.

### Example: SPST toggle switch

```yaml
state_machine:
  initial_state: open
  states:
    open:
      description: Contacts separated; no current flows.
    closed:
      description: Contacts touching; current flows freely.
  transitions:
    - from: open
      to: closed
      trigger: actuated
      description: User flips the switch; contacts make.
    - from: closed
      to: open
      trigger: actuated
      description: User flips the switch again; contacts break.
```

### Internal consistency

The cross-FK validator enforces:

- Every transition's `from:` and `to:` must reference a state declared in `states`.
- `initial_state` must reference a declared state.

These checks fire as the `state-machine-invalid-transition` error code introduced in v3 Sprint 6.

### When devices need a state machine

Add `state_machine` only when the device has **discrete states** that matter to its behavior. Resistor, capacitor, power_source, and wire do NOT have state machines — their behavior is fully captured by parameters and behaviors. Switches, relays, MOSFETs, latches, flip-flops, and multiplexers DO.

### Trigger taxonomy

Sprint 6 leaves `trigger:` as a free string with examples (`actuated`, `actuated_while_held`, `released`, `current_through_coil`, `gate_voltage_above_threshold`, `external_event`). The formal enum is deferred until 3-4 stateful device types exist in the catalog and the actual set of trigger types is knowable.

### Out of scope for the foundation

- **Runtime state tracking** (which state is *this* switch in *right now*) — canvas/simulator concern.
- **State-dependent property values** (a switch's resistance is ∞ when open, ~0 when closed) — needs the behavior-derives-value pattern first; §15 deferred.
- **Multi-pole switches with state-dependent connection topology** (SPDT routes signal through different terminals per state) — Sprint 7+.

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

`required: true` with a `default:` means the parameter must resolve to a value, but an instance may omit it and accept the definition's cited default.

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

The device is a *generic* `wire` — it does not bake in a specific conductor. Composition uses the role-based `requires` form (Section 6); the material is chosen at instance time via a `material_ref` parameter.

```yaml
# DEFINITION — generic wire (no material baked in)
kind: primitive_device
id: wire
origin: builtin
layer: primitive_device
name: Wire
description: A conductive physical path connecting two or more electrical interfaces.
composition:
  requires:
    conductor_material:
      kind: material
      must_enable: [electrical_conduction]
    geometry:
      kind: shape
      must_enable: [path_role]
    endpoints:
      kind: interface
      min_count: 2
parameters:
  conductor_material:
    type: material_ref            # exact value shape + resolution deferred to v3 Sprint 2
    satisfies_role: conductor_material
    required: true
    # deliberately no default — the instance picks the material, which avoids
    # baking weak-source default data into the spec example
  geometry:
    type: shape_ref
    satisfies_role: geometry      # explicit role fill; geometry is NOT implied by dimensions
    required: true
    default:
      value: path
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
  construction:                   # device/structure-level, not shape-layer geometry
    type: enum
    required: false
    allowed: [solid_core, stranded, braided, litz, ribbon]
  insulation_material:            # optional add-on, not a requires role (Section 6)
    type: material_ref
    required: false
behaviors:
  - conducts_current
  - has_resistance
  - produces_joule_heat
support:
  model_status: defined
  solver_status: builtin_simple
extensions:
  overridable: true
  user_extensible: true
  allowed_origins: [builtin, community, user_local, project]
```

```yaml
# INSTANCE (in a project file) — a specific copper wire
kind_ref: primitive_device
definition: wire
id: wire_001
origin: project
parameters:
  conductor_material:
    value: copper                 # material_ref → id of a material definition
  geometry:
    value: path                   # shape_ref → explicit geometry, not implied by dimensions
  length:
    value: { kind: scalar, amount: 0.2, unit: m }
  cross_section_area:
    value: { kind: scalar, amount: 1.0e-7, unit: m2 }
  construction:
    value: stranded
connects:
  - { net: net_signal, terminal: terminal_a, of: resistor_3 }
  - { net: net_signal, terminal: terminal_b, of: led_1 }
```

The same `wire` definition serves any conductor: an aluminum-wire instance differs only by `conductor_material: aluminum`. "Copper wire" is an instance or preset, never a base definition.

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
| **Multi-version definitions.** When a community pack publishes wire@1.2.0 and a project depends on @1.1.0, version resolution is its own problem. | Sprint 7+ |
| **Cross-pack dependency declarations.** A `chipblocks-power` pack uses things from `chipblocks-passive`; how is the dependency expressed and enforced? | Sprint 8+ |
| **Schema migration story.** When this very model changes (it will), how do old project files keep loading? | After v3 Sprint 2 |
| **v3 Usability Review.** A dedicated future pass to evaluate the foundation against real user tasks: visual-editor candidacy, terminology audit, beginner-friendly explanations, progressive-disclosure design, default-value rationalization, accessibility (keyboard nav, screen-reader support, status-by-text-not-color-only), and safe workflow design. Naming it now preserves the commitment that usability gets deliberate review after the foundation is deep enough to evaluate. | Future v3 sprint |
| **`material_ref` / `shape_ref` parameter types + full parameter taxonomy.** Definitions declare slots like `conductor_material: { type: material_ref }` or `geometry: { type: shape_ref }`; instances fill them with a material or shape id (`copper`, `path`). The full parameter-type set (quantity / string / enum / bool / material_ref / shape_ref / object_ref / …) and the exact value shape + resolution rules are reserved here but not designed yet. | v3 Sprint 2 |
| **Wire (and general) construction representation.** Construction options (`solid_core`, `stranded`, `braided`, `litz`, `ribbon`) are device/structure-level choices, not shape-layer geometry. Exact representation (enum parameter? sub-structure object?) deferred. | v3 Sprint 2+ |
| **CAD-like shape authoring.** Freeform custom-shape geometry is out of foundation scope. The `shape` layer stays primitive electronics geometry (path, region, plate, film, gap, hole, layer, junction, surface, cross-section). If freeform geometry ever arrives, it belongs to higher-level tooling above the `shape` layer. | Deferred / possibly never |
| **Preset/template model.** A preset is neither a pure definition nor a concrete instance: it is a partially configured definition, such as "22 AWG stranded copper wire," that fixes some parameters while leaving others open. The model must decide whether presets are definitions, templates, or a separate kind. It must also cover packaged components such as `0603 resistor`, `QFN-32`, and `SOT-23 MOSFET`, where a reusable electrical/device definition is paired with physical package dimensions, pad layout, and default parameters. | v3 Sprint 2+ |
| **Role-satisfaction validation.** When an instance fills a `composition.requires` role through a parameter (via `satisfies_role`), the validator must prove the selected object satisfies the role constraints — e.g., `copper` actually enables `electrical_conduction`. This is stricter than simple foreign-key existence. | v3 Sprint 2 |
| **Stackup model.** Boards and chips need ordered physical layer stacks: material, thickness, vertical order, and role. The model must later decide whether stackup is a structured property of a `board_or_chip`, its own definition kind, or a composition pattern using shape/material entries. | Future board/chip modeling |
| **Visual symbol library.** When the canvas eventually renders devices, the visual layer should use standard schematic shorthand — **IEC 60617** (international graphical symbols for diagrams) and/or **IEEE 315** (the US convention KiCad uses) — not invented icons. Standard symbols are what electrical engineers already read at a glance (zigzag = resistor, triangle+bar = diode, etc.). Devices may carry an optional `symbol:` field referencing a standard symbol identifier (e.g., `iec_60617:resistor`); exact schema deferred until canvas work begins. See [SCHEMATIC-SYMBOLS.md](SCHEMATIC-SYMBOLS.md) for the symbol inventory and IEC vs IEEE differences. | v3 canvas sprint |
| **Auto-created interface UX pattern.** Solder joints, bond wires, vias, and similar connection interfaces are auto-instantiated when two terminals snap together. The chosen material defaults to a project-scope Active Variable (e.g., `solder_material: { ref: default_solder_alloy }`) so a one-line project setting governs every joint. Right-click on a joint opens an edit menu for per-instance overrides (replace `ref:` with an explicit `value:` for that joint only — alloy choice, parameters, provenance view, delete). **Lock is opt-in** (right-click → Lock), position-only by default; freezing parameters is a separate, later option. **Canvas-only state** (position, lock flag, color hints, group membership) lives in a separate `canvas/layout.yaml`, NOT on the instance — toggling it must not trigger physics revalidation, and the same instance data must remain portable across canvas backends. A visual hint should distinguish joints whose alloy diverges from the project default. | v3 canvas sprint |
| **Alloy composition-by-weight as a structured field.** Solder alloys (Sn63Pb37 = 63% Sn / 37% Pb, SAC305 = 96.5% Sn / 3.0% Ag / 0.5% Cu) and resistive alloys (Nichrome 80/20 = 80% Ni / 20% Cr) currently carry composition in `description` + `notes` only. A structured representation (e.g., `alloy_composition: { tin: 0.63, lead: 0.37 }` summing to 1.0 with validator check) would let consumers query composition programmatically and let regulatory pipelines (RoHS/REACH compliance) inspect ratios. Surfaced in Sprint 4 retro; no fixture needed it for behavior calculation, so the current workaround held. Lands when a downstream consumer (regulatory check, fab-tool integration, materials cross-reference UI) actually needs composition data. | Sprint 5+ or when first composition-consumer lands |
| ~~**Behavior-derives-value pattern.** Resistor's resistance and capacitor's capacitance can be DECLARED (parameter value) or DERIVED from geometry (R = ρ × L / A; C = ε × A / d).~~ ✅ **CLOSED in Sprint 12** — see §16 below. Third path taken: neither (a) `evaluates:` on behaviors nor (b) a separate `derives:` field, but rather full specification of §7's existing `kind: equation` value-polymorphism. Inputs reference properties via dotted paths; mathjs handles dimensional checking; per-instance evaluation lets the cross-FK validator compare against declared ratings (`max_X`, `min_X`, `nominal_X`). The §16 spec is the canonical reference. | ✅ Closed Sprint 12 |
| **`min_count` enforcement in cross-FK.** Schema declares `composition.requires.<role>.min_count: 2` (e.g., capacitor's two plates), but the cross-FK validator's role-satisfaction loop only checks `must_enable` — it does not count the structural satisfiers. This is honest absence: the constraint is declared but not yet enforced. Full count enforcement requires net-model awareness (an interface with min_count: 2 needs the net topology to show at least 2 distinct shapes attached). Lands together with the net model. | v3 net-model sprint |
| **AV → AV chains and cycle detection.** Sprint 5 forbids `ref:` inside an Active Variable's value — AVs hold direct values (or string ids for ref types) only. The validator's resolution is flat: one hop from `instance.parameters.<x>.ref → AV → resolved object`. Chains of `ref: → AV → ref: → AV → value` could let a user express "the default_pcb_substrate for consumer-grade designs" pointing at "the default substrate" pointing at FR4. Allowing chains brings cycle detection (A points at B points at A) + depth limits (don't follow indefinite chains) as required complexity. Lands when a real use case demands chains. | Sprint 6+ when a chain use case lands |
| **Trigger taxonomy as enum.** Sprint 6's `state_machine.transitions[].trigger` is a free string with documented examples (`actuated`, `actuated_while_held`, `released`, `current_through_coil`, `gate_voltage_above_threshold`, `external_event`). The formal enum is deferred until 3-4 stateful device types exist in the catalog (likely after relay + MOSFET + flip-flop sprints), so the actual set of triggers is knowable from real data rather than guessed up front. Until then, free strings let new device types describe their triggers without schema changes. | Sprint 8+ once 3-4 stateful device types are catalogued |
| **Multi-pole switches (SPDT, DPDT, 4PDT).** Sprint 6 landed SPST only. Multi-pole switches add state-dependent connection topology — in position_1, terminal A connects to B; in position_2, terminal A connects to C. The state_machine shape from Sprint 6 expresses states + transitions but not which terminals are connected per state. Sprint 7+ explores whether composition.requires can carry per-state terminal mappings, or whether a new schema field is needed. | Sprint 7+ |
| **State-dependent behavior gating.** A stateful device's behaviors may only fire in certain states (a switch conducts current only when state=closed; a MOSFET's drain-source resistance changes between cutoff/triode/saturation). Today switch_spst_toggle lists [switches_circuit, conducts_current, has_resistance, produces_joule_heat] as honest claims — but conducts_current is FALSE when the switch is open. The model has no formal linkage between FSM states and active behaviors. Future work: extend behaviors with optional state predicates (`active_in_states: [closed]`), or extend state_machine to declare which behaviors fire per state (`states.open.behaviors_inactive: [conducts_current]`), or design a separate gating layer. Pairs with the behavior-derives-value pattern; lands when the simulator engine needs it. | When simulator engine evaluates state-dependent behavior |
| **PN junction as a separate interface kind.** Sprint 7's LED uses implicit PN junction via `composition.uses` listing both doped semiconductor materials directly. This works while only one semiconductor device exists. When Sprint 8+ adds Schottky diodes, silicon rectifiers, Zener diodes, BJTs, and MOSFETs — all of which have PN junctions — promoting `pn_junction` to a first-class interface kind (composition.requires n_side + p_side material roles + must_enable [n_type_semiconductor] and [p_type_semiconductor]) would reduce duplication and make the junction's role explicit. Until then, listing the doped materials per-device is the simpler path. | Sprint 8+ when 2+ semiconductor devices exist |
| **Multi-color LED catalog expansion.** Sprint 7 landed red AlGaInP only. ~~Sprint 11 closed this row by adding blue InGaN, green InGaN, IR GaAs as instances of generic `led`, plus UV AlGaN as a separate `led_uv_algan` device.~~ ✅ **CLOSED in Sprint 11.** White LED (phosphor-converted) split out as its own §15 row below; heterostructure modeling and laser diodes also have their own rows below. | ✅ Closed Sprint 11 |
| **White LED (phosphor-converted device).** White LEDs are not single PN-junction devices — they are blue InGaN LEDs with a yellow/red phosphor coating (typically YAG:Ce or rare-earth phosphor mixes) that down-converts some blue emission to longer wavelengths; the combined spectrum appears white. Requires modeling the phosphor coating as a material layer with its own absorption/re-emission spectrum, plus a composition pattern for the coating-on-chip structure. Will be a separate device definition (`led_white_phosphor_converted` or similar) rather than an instance of generic `led`. CCT (correlated color temperature) and CRI (color rendering index) become first-class parameters. | When phosphor materials and coating-composition patterns land |
| **Heterostructure / QW active-layer modeling.** Real LEDs are multi-layer heterostructures (n-side cladding + thin active layer / quantum well + p-side cladding), not simple PN junctions. ChipBlocks's current PN-junction model is industry-standard at the SPICE/EDA circuit layer (verified Sprint 10 against Wikipedia LED article) but glosses over the active-layer composition that actually determines emission wavelength + efficiency. TCAD tools (Synopsys Sentaurus, Silvaco ATLAS) model this depth. Requires schema for multi-layer composition (n-side, active-layer, p-side) and probably new behaviors for layer-specific effects (active-layer recombination, carrier injection, polarization-induced fields / QCSE). Major upgrade path for device-physics-level educational depth. | Future — when device-physics-level depth is the goal |
| **Laser diodes.** Laser diodes use stimulated emission via an optical cavity (Fabry-Perot, VCSEL, etc.) rather than the spontaneous emission of LEDs. They have threshold current behavior, produce coherent light, and need their own parameter set (threshold current, slope efficiency, beam divergence, mode count, side-mode suppression ratio). Not "led with a laser mode" — a different device kind. Also: applications cover bar-code scanners, optical disc drives (legacy), fiber-optic telecom, free-space optical comms, range-finders / LiDAR, laser pointers, surgical lasers. | Future device-kind addition |
| **Schottky junction as a separate interface kind.** Mirror of the PN junction row above but for metal-semiconductor junctions. Schottky physics is fundamentally different from PN junction (barrier set by metal-semiconductor work-function difference, not bandgap; majority-carrier-only conduction; no minority-carrier recombination). When 2+ Schottky devices exist in the catalog (Sprint 9 brings the first formalization candidate once high-voltage SiC Schottky, RF Schottky on GaAs, or platinum-silicide Schottky variants land), schottky_junction promotes alongside pn_junction with distinct metal_side and semiconductor_side roles + appropriate must_enable constraints (metal_side enables electrical_conduction; semiconductor_side enables n_type_semiconductor or p_type_semiconductor). | Sprint 9+ when 2+ Schottky variants exist |
| **Right-click parameter override UX.** General pattern for parameterized devices in the canvas: right-click any device instance to open an edit menu where you can override parameter values per-instance — LED color (n_side / p_side material), resistor resistance, switch state-machine variant, capacitor capacitance, battery chemistry, etc. Per-instance overrides displace project-level defaults (the same value-vs-ref XOR mechanism the auto-solder pattern uses). Extends the existing auto-created interface UX row (which covers snap-created joints) to cover all parameterized devices. The Sprint 9 LED refactor made this real at the data layer (every LED instance can independently override its n_side / p_side); the canvas sprint adds the right-click menu UI. | v3 canvas sprint |
| **Keybindings settings page.** A settings UI for customizing keyboard shortcuts. Save user preferences; restore defaults; per-OS preset suggestions (Windows / Mac / Linux conventions); export/import for sharing between machines. Need this when the canvas accumulates enough shortcuts (place component, rotate, connect, zoom, pan, snap toggle, etc.) that users want to remap. Lands when canvas + general UI infrastructure exists. | v3 canvas sprint or shortly after |

These deferrals are explicit. They do not get answered by code accident in the meantime.

---

## 16. Equation value kind: full specification

> Adopted in v3 Sprint 12. Formalizes the `kind: equation` value introduced as one of §7's value kinds — schema, evaluation semantics, dimensional checking, conflict-detection rule. Closes the §15 "behavior-derives-value pattern" deferred row.

### 16.1 Purpose

A property's value can be either a number you write down (with a citation) or a formula that computes the number from other inputs. The classic case — a resistor's resistance R isn't an arbitrary number; it's:

> R = ρ × L / A

where ρ is the conductor material's resistivity, L is the conductor's length, and A is its cross-section area. The catalog ships the formula; the validator evaluates it per-instance using the instance's actual material and geometry.

### 16.2 The equation block — full schema

A value of `kind: equation` carries:

| Field | Required | Type | Purpose |
|---|---|---|---|
| `kind` | ✓ | string `"equation"` | Value-kind discriminator (§7) |
| `expression` | ✓ | string | Math expression in mathjs syntax |
| `inputs` | ✓ | object | Map of `input-name → input-spec` (§16.3) |
| `output_unit` | ✓ | string | Declared output unit (mathjs unit name) |
| `constants_used` | optional | string[] | Named physical constants the expression binds (§16.4) |
| `conditions` | optional | conditions block | Under what assumptions the formula holds (§8) |
| `notes` | optional | string | Human explanation |

**Provenance for the formula lives at the property level**, not inside the equation block — same pattern as scalar/range/etc. values. The property holding an equation-valued `value:` carries a sibling `provenance:` field citing the formula's source (textbook, standard, etc.). This keeps the value-block schema consistent across all kinds; see §16.8 for the anti-placeholder Rule 1 implications.

### 16.3 Input specifications

Each `inputs.<name>` entry is one of three shapes, discriminated by `kind`:

- **constant** — value baked into the formula. Rarely used; usually a real catalog property is the right source.
  ```yaml
  rho_ref: { kind: constant, amount: 1.68e-8, unit: ohm_meter }
  ```

- **property_ref** — pull from a property elsewhere in the same instance: its material, its geometry, or another role in its composition. Path syntax is dotted, resolved against the instance's composition graph.
  ```yaml
  rho: { kind: property_ref, path: "resistive_material.resistivity" }
  L:   { kind: property_ref, path: "geometry.length" }
  A:   { kind: property_ref, path: "geometry.cross_section_area" }
  ```
  **Path-root convention: the bare name of any `composition.requires.<role>` role, resolved per the instance's filled-in role.** Examples from real catalog fixtures:
  - `resistive_material.resistivity` (resistor's `resistive_material` role)
  - `dielectric.relative_permittivity` and `dielectric.thickness` (capacitor's `dielectric` role)
  - `plates.area` (capacitor's `plates` role)
  - `n_side.bandgap_energy` (LED's `n_side` role)
  - `geometry.length`, `geometry.cross_section_area` (any device whose role is literally named `geometry`)

  `parameters.<name>` references another parameter on the same device. `composition.<role>.<property>` is the long-form equivalent of the bare-name root when explicit disambiguation is needed.

- **input_variable** — supplied by a caller at evaluation time. Used for parametric values like ρ(T). Recognized in the schema; **evaluation is deferred to a later sprint** (Sprint 14+ when the DC solver provides callers that can pass T, frequency, etc.).
  ```yaml
  T: { kind: input_variable, unit: kelvin }
  ```

**Dimensionless inputs.** Properties whose values are dimensionless (relative permittivity, refractive index, external quantum efficiency, doping fraction, etc.) declare `unit: '1'` or `unit: 'dimensionless'` — the schema requires `minLength: 1` on unit strings, so the empty string is not a valid catalog form. The evaluator additionally accepts `''`, `'1'`, and `'dimensionless'` interchangeably at runtime (defensive against catalog inconsistency), binding all three as bare numbers; mathjs's unit arithmetic handles `number × Unit → Unit` correctly.

### 16.4 Physical constants

The evaluator binds these by name, sourced from NIST CODATA 2022 (verified at physics.nist.gov 2026-06-05). Declaring them in `constants_used: [...]` makes the dependency explicit.

| Name | Value | Units | Notes |
|---|---|---|---|
| `h` | 6.62607015 × 10⁻³⁴ | J·s | Planck constant, exact |
| `c` | 2.99792458 × 10⁸ | m/s | Speed of light in vacuum, exact |
| `e` | 1.602176634 × 10⁻¹⁹ | C | Elementary charge, exact |
| `k_B` | 1.380649 × 10⁻²³ | J/K | Boltzmann constant, exact |
| `epsilon_0` | 8.8541878128 × 10⁻¹² | F/m | Vacuum permittivity |
| `mu_0` | 1.25663706212 × 10⁻⁶ | H/m | Vacuum permeability |
| `N_A` | 6.02214076 × 10²³ | /mol | Avogadro constant, exact |

Sprint 12 binds at minimum `h`, `c`, `epsilon_0` (the three first concrete cases need them). Additional constants land as catalog formulas demand.

### 16.5 Evaluation semantics

When the validator loads an instance with an equation-valued property:

1. Resolve every `inputs.*.path` against the instance's composition graph. Each input must reduce to a concrete `{ amount, unit }`. An `input_variable` input causes Sprint 12 to skip evaluation and mark the property as "deferred-evaluation" (without erroring).
2. Substitute resolved values + their units into the expression.
3. Evaluate with mathjs's unit-aware arithmetic.
4. Compare the result's units to `output_unit`. Mismatch surfaces error code `derives-unit-mismatch`.
5. The resulting `{ amount, unit }` is the property's evaluated value for that instance, available to downstream consumers (rating checks now, simulation later).

**Per-instance.** Equations evaluate against the instance's actual property values, not the device's defaults. Different instances with different geometry get different computed values.

### 16.6 Dimensional analysis — worked example

```yaml
# device-resistor.yaml (excerpt)
properties:
  resistance:
    value:
      kind: equation
      expression: "rho * L / A"
      inputs:
        rho: { kind: property_ref, path: "resistive_material.resistivity" } # ohm·m
        L:   { kind: property_ref, path: "geometry.length" }                # m
        A:   { kind: property_ref, path: "geometry.cross_section_area" }    # m²
      output_unit: "ohm"
    provenance:
      source_type: reference
      title: "Standard resistor equation R = ρL/A"
      citation: "Sze and Ng, Physics of Semiconductor Devices, 3rd ed., ISBN 978-0-471-14323-9, §1.6"
      confidence: high
```

mathjs computes `ohm·m × m / m² = ohm`. Matches `output_unit: "ohm"`. ✓

If the formula were mistakenly `rho * L * A`, mathjs would produce `ohm·m × m × m² = ohm·m⁴` — mismatch against declared `output_unit: "ohm"`. Validation fails with `derives-unit-mismatch` and the maintainer fixes the formula before bad spec ships.

### 16.7 Conflict detection: equation value vs declared rating

When an instance has property X declared as `kind: equation` AND a rating declared on the same property name (`max_X`, `min_X`, `nominal_X`), the cross-FK validator:

1. Evaluates the equation to get `computed_X`.
2. Compares to the declared rating(s):
   - `computed_X > max_X` → violation
   - `computed_X < min_X` → violation
   - `|computed_X − nominal_X| / nominal_X > tolerance` (default 20%) → warning
3. Violations surface error code `derives-violates-rating`.

**Per-instance scope.** The check uses the instance's actual resolved property values. Device-level "what would the device's defaults compute vs the rating" check is deferred — useful only when device defaults are guaranteed meaningful, which is not universally true today.

### 16.8 Anti-placeholder compatibility (§12)

§12 Rule 1 requires builtin physical values have a structured `value` block AND a `provenance` block. Equation kind satisfies both at the property level — `kind: equation` is in §7's permitted set, and the **sibling `provenance:` field** on the same property cites the formula's source.

**Formulas CAN be derived; the formula's citation cannot.** Every equation-valued property must cite the source of its formula (Sze textbook, IEC standard, NIST CODATA for constants, etc.) the same way every scalar value cites its measurement. The provenance sits next to `value:`, not inside it — same pattern as every other value kind.

### 16.9 Constraints

1. **Catalog-shipped only.** Equation values live at `origin: builtin` or `community`. End users do not author formulas; user-authored properties stay `kind: scalar` or `kind: unknown_user_supplied`. The schema enforces this via origin gating.
2. **No circular references.** An equation's inputs cannot transitively reference the property the equation is computing. The validator detects cycles and rejects.
3. **No cross-instance dependencies in Sprint 12.** Inputs resolve within the instance's own context. Cross-instance computation (e.g., "this LED's brightness depends on the previous component's output current") needs the net model + DC solver and is deferred to Sprint 13/14+.
4. **No bulk replacement.** Adding `kind: equation` to a property is a deliberate choice per device, not a sweeping migration. Most catalog properties remain `kind: scalar` until the physics is captured for them.

### 16.10 First concrete cases (v3 Sprint 12)

Three first cases ship with Sprint 12, each fully specified per the above:

**Resistor: R = ρ × L / A**
- inputs: `material.resistivity` (ohm·m) + `geometry.length` (m) + `geometry.cross_section_area` (m²)
- output_unit: ohm
- Source: Sze (Physics of Semiconductor Devices) + CRC Handbook

**LED peak wavelength: λ = h × c / E_g**
- constants_used: [h, c]
- inputs: `composition.<active-material>.bandgap_energy` (eV; mathjs handles eV ↔ J conversion)
- output_unit: m (downstream conversion to nm for display)
- Source: Planck-Einstein relation; Schubert, *Light-Emitting Diodes* §1.2

**Capacitor: C = ε₀ × ε_r × A / d**
- constants_used: [epsilon_0]
- inputs: `composition.dielectric.relative_permittivity` (dimensionless) + `geometry.plate_area` (m²) + `geometry.plate_separation` (m)
- output_unit: F
- Source: Standard parallel-plate capacitor; Sze textbook + CRC Handbook

### 16.11 Relation to §15

This section closes the §15 deferred row "Behavior-derives-value pattern." That row anticipated two design directions ((a) richer `evaluates:` parsing on behaviors, or (b) a separate `derives:` field on parameters); §16 takes a cleaner third path that already fits §7's value-kind polymorphism: equation kind, attached to a property's value, evaluated per-instance, dimensionally checked, with rating-conflict detection on top.

The §15 row is marked ✅ CLOSED with a pointer here.

---

## How this doc evolves

This is a v3 Sprint 1 deliverable. Two outcomes are possible:

1. **The doc survives review.** It locks. v3 Sprint 2 writes `schemas/object.schema.json` (or split definition/instance schemas) that implements every claim above. Any tension between the schema and this doc gets resolved by editing the doc, not by drifting the schema.

2. **The doc fails review.** Specific sections get revised; the doc reopens for another pass. The schema does not begin until the doc settles.

When a future v3 sprint touches anything in this doc — adding a value kind, refining a support_status enum value, etc. — the change lands as an edit to this file, dated, with a one-line "Revised YYYY-MM-DD" note. ADRs may eventually pin specific sub-decisions; this doc remains the canonical synthesis.
