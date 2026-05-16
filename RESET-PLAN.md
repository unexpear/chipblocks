# ChipBlocks reset plan — preservation + ground-up restart

> **Status:** Draft for review (2026-05-16). No code changes have been made yet. This document is the plan that gets approved BEFORE any irreversible action. Read top-to-bottom, push back, iterate. When approved, this file becomes the execution checklist.
>
> **Naming note:** This is a *reset*, not a *migration*. The current direction is preserved with full integrity in a frozen branch; the new direction starts from a clean main. Nothing is mutated; nothing is deleted; nothing is lost.

---

## What this is

ChipBlocks v0.1.x was a visual chip-design tool focused on audio synthesis. Through ~24 sprints, it grew a working alpha at v0.1.0-alpha.9 with 48 blocks, 22 example graphs, FPGA + Tiny Tapeout build paths, AI consultant, and 549 tests. The direction was: digital RTL → Yosys → bitstream / GDS.

The new ChipBlocks is a **ground-up electronics design system**. The conceptual floor is materials and geometry; everything (resistor, capacitor, LED, circuit, chip, board, full device) is built from real lower-level definitions. The deterministic engine validates against physics; the AI assists with synthesis tasks; the user approves. The output is an editable project plus a manufacturing-ready ZIP. This is a different product, not an evolution.

The new direction is sufficiently different from the old that evolving the old codebase in place would create constant drag — the schema is wrong, the synthesis pipeline assumes digital RTL, the palette communicates the wrong identity. The cleanest path is to **preserve the old direction with full dignity and restart the main path from the ground layer.**

This plan does not delete anything.

---

## Repository topology after the reset

```
Repository (same GitHub repo, same URL, same star count):

├── Branch: legacy/audio-synth-direction
│   └── Frozen at v0.1.0-alpha.9-final tag.
│       Contains: 48 blocks, 22 examples, Amaranth synthesis pipeline,
│                 all 24 sprint retros, all 4 existing ADRs (001/002/003/005),
│                 all 8 fab manifests, all 549 tests, all alpha.x release docs.
│       Status: never merged forward, never receives new commits.
│
└── Branch: main
    └── Reset to a near-empty state, then built up from Layer 0.
        Starts with extracted infrastructure (Electron + React + TS shell,
        AI chat scaffold, CI workflows, license).
        Grows the new ChipBlocks from materials → shapes → interfaces →
        behaviors → devices → circuits → assemblies → boards → systems.

Tags preserved on GitHub:
   v0.1.0-alpha, alpha.1 ... alpha.9   (still downloadable from Releases page)
   v0.1.0-alpha.9-final                 (the freeze marker, added during reset)

Future tags on main:
   v0.2.0-alpha-preview                 (first new-direction demo: ~week 8-10)
   v0.2.0-alpha.1                       (first real new-direction alpha: TBD)
```

The old direction is **always reachable** — anyone clones the repo, checks out `legacy/audio-synth-direction`, runs the alpha.9 audio-synth tool. The new direction lives on main and represents the project's forward identity.

---

## What gets preserved (frozen on `legacy/audio-synth-direction`)

Everything currently on master, exactly as it is at the reset moment. No file moves, no deletions, no rewrites. The branch is a literal snapshot.

| Category | Specific items |
|---|---|
| Block library | `blocks.yaml` (48 rows); 48 `*Node.tsx` + 48 `<name>.py` Elaboratables |
| Bundled examples | 22 `examples/*.json` files + `examples/README.md` |
| Backend synthesis | `backend/synth.py`, `backend/build.py`, `backend/tinytapeout.py`, `backend/blocks/`, `backend/shuttles/` |
| Fab manifests | `shuttles.yaml`, `pdks.yaml`, `packages.yaml`, `flows.yaml`, + 4 empty deferred manifests + 8 schemas |
| ADRs | ADR-001 (bus types), ADR-002 (CPU primitives), ADR-003 (block manifest), ADR-005 (modular fab platform), ADR-005 implementation docs |
| Sprint retros | SPRINT-1.md through SPRINT-22.md, SPRINT-23.md, SPRINT-24.md (24 total; no SPRINT-15.md by historical renumbering) |
| Tests | 549 tests across pytest + vitest |
| Docs | CLAUDE.md (audio-synth flavor), ROADMAP.md, PRD.md, ARCHITECTURE.md, CONTRIBUTING.md, BLOCKS.md, BLOCKS-COOKBOOK.md, KNOWN-ISSUES.md, CREDITS.md, README.md, ACCESSIBILITY-AUDIT files, FINAL-STATE-VISION.md |
| Release artifacts | Cross-platform installer builds, release notes |
| Visual / UX | All current React Flow node components, palette layout, App.css, settings/help/about modals |
| AI prompt | Current STATIC_SYSTEM with all 48 block descriptions + Block library prose |
| Codegen | `scripts/codegen-frontend.mjs`, `scripts/codegen-backend.py`, `scripts/codegen-shuttles-backend.py` |
| CI/CD | `.github/workflows/ci.yml`, `.github/workflows/release.yml` (the cross-platform installer build) |

**Critical guarantee:** the legacy branch never receives a forward merge or amendment. If a user runs `git checkout legacy/audio-synth-direction && npm run dev`, they get exactly the alpha.9 experience. If we discover a security issue in a shipped dependency on the legacy branch, we document but do not patch — security updates apply only to main.

This branch may later be extracted into a separate `chipblocks-audio` repository if the community wants to continue developing the audio-synth direction independently. That decision is post-reset.

---

## What gets extracted into the new main

These are the parts that genuinely survive — patterns and infrastructure, not product shape.

### Direct port (copy verbatim into new main)

| Item | Path | Why |
|---|---|---|
| `LICENSE` | repo root | MIT license posture is unchanged |
| `.gitignore` | repo root | Build outputs and secrets handling carry over |
| `.github/workflows/ci.yml` | minus the codegen-drift-block sections | The CI shape is correct; just shrink to what the new minimal repo needs |
| `frontend/electron/` shell (main + preload) | thin and unchanged | The Electron host process design is correct (BYOK key storage, IPC contracts, sandboxed renderer) |
| `frontend/vite.config.ts` | direct copy | The Vite + React + TS toolchain works |
| `frontend/package.json` deps | minus the legacy-specific blocks/manifests scripts | npm packages list survives; specific scripts get rewritten |

### Pattern extract (rewrite, but pattern is right)

| Pattern | Where it comes from | What gets rewritten |
|---|---|---|
| Manifest + JSON Schema + codegen | ADR-003 + `blocks.yaml` system | Becomes `materials.yaml` / `shapes.yaml` / `interfaces.yaml` / `behaviors.yaml` / `devices.yaml`, each with sibling schema and codegen. Same discipline; different content. |
| `@begin codegen` / `@end codegen` marker comments | `scripts/codegen-*` | Same marker shape, new generated targets |
| Manifest-integrity tests | `backend/tests/test_manifest.py`, `frontend/test/manifest.test.ts` | Same dynamic test shape; one set per new manifest |
| BYOK + safeStorage for AI keys | `frontend/electron/main/ipc.ts` | Becomes multi-provider (Anthropic + OpenAI + offline at v1); same security pattern |
| Agentic AI loop (max iterations, tool-call validation) | `frontend/src/Chat.tsx` | Same loop architecture, multi-provider adapter added; tool definitions completely replaced |
| ADR pattern (numbered ADRs at repo root) | ADR-001/002/003/005 | New ADR series starting from ADR-006 (or ADR-001 of v2 — naming TBD) |
| Sprint retro format (SPRINT-N.md with plan + log + retro) | All 24 existing sprint files | Same format, new sprint sequence |
| Codegen-drift CI check | `.github/workflows/ci.yml` | Same CI design, new generated targets |
| TypeScript IPC contract centralization | `frontend/src/types/ipc.ts` | Same approach, new IPC channels |
| Pytest + vitest + ~110s pytest target | Whole test infrastructure | Same tooling; new test suite |

### Concept-only extract (lesson learned, not code reused)

| Concept | Lesson it carries |
|---|---|
| Typed bus system (ADR-001) | Multi-domain signal typing (DC voltage, current, light, mechanical, thermal) is the right discipline. New direction adopts the principle, not the specific 53-bus-type enum which was digital-only. |
| AI prompt structure (sections, codegen for the block reference) | The "static system prompt + per-turn canvas state + tool definitions" structure is right. The actual prompt content is entirely rewritten. |
| Cookbook discipline (BLOCKS-COOKBOOK.md, step-by-step block authoring) | Captured into a new `DEVICES-COOKBOOK.md` for adding L4 primitive devices. |
| "Always check, never assume" discipline | Hard project rule. Carries into the new direction's docs. |
| "Fine taking time" + "no fake blocks" + "modular fab platform" core constraints | All three project principles from the audio direction carry into the new identity. |

---

## What gets written from scratch on the new main

Nothing in this list survives from legacy. These are the genuinely-new components that define the new ChipBlocks identity.

| New artifact | What it is | Sprint when it lands |
|---|---|---|
| `materials.yaml` + schema | Layer 0: 5-15 materials with electrical / thermal / mechanical properties (copper, silicon, FR4, polyimide, air, solder, ceramic, ferrite, etc.) | Reset Sprint 2 |
| `shapes.yaml` + schema | Layer 1: geometric primitives (solid_region, thin_film, wire_path, plate, gap, layer, hole, junction) | Reset Sprint 2 |
| `interfaces.yaml` + schema | Layer 2: interface kinds (terminal, contact, solder_joint, via, bond_wire, connector_pin) | Reset Sprint 2 |
| `behaviors.yaml` + schema | Layer 3: abstract physical laws (conducts, resists, stores_charge, stores_magnetic_energy, switches, insulates, heats) | Reset Sprint 2 |
| `devices.yaml` + schema | Layer 4: primitive devices (wire, resistor, capacitor, inductor, diode, LED, switch, power_source) composed from L0-L3 | Reset Sprint 3 |
| Universal object model spec | The canonical block shape: id / layer / type / label / parent / position / ports / parameters / internal / behavior / validation / notes | Reset Sprint 3 |
| Project file format | `MyProject.chipblocks/` folder layout: project.yaml + design.yaml + parameters.yaml + verification/ + exports/ + releases/ + docs/ + .chipblocks/ | Reset Sprint 3 |
| Canvas v1 | React Flow palette + drag-drop + wire-drawing + terminal-snap + property inspector + bottom-panel checks. Five essentials enforced. | Reset Sprint 4 |
| Steady-state validator | KCL + KVL + Ohm + Joule + switch state machine + LED forward-voltage check + failure-mode evaluation | Reset Sprint 5 |
| Multi-provider AI adapter | No-AI (required) + Anthropic + OpenAI + interface for local/Gemini later. BYOK with safeStorage. | Reset Sprint 6 |
| Manufacturing package skeleton | BOM CSV + schematic SVG. No Gerbers, no GDS — those come in later sprints. | Reset Sprint 6 |
| New CLAUDE.md | New project identity, new core constraints, new sprint cadence | Reset Sprint 1 |
| New README.md | Public-facing: explains ChipBlocks v2 vision; links to legacy branch for v1 | Reset Sprint 1 |
| New PRD.md | Updated product vision (ground-up electronics builder; not chip-only) | Reset Sprint 1 |
| New ROADMAP.md | Phased: Layer 0-4 first; Layer 5-7 later; community libraries on top | Reset Sprint 1 |
| ADR-006 (or ADR-001-v2) | The universal object model + 9-layer stack + AI authority split | Reset Sprint 1-2 |

---

## First 6 sprints in detail

Realistic staging per the conversation: 2-3 weeks to schemas + empty canvas; 4-6 weeks to basic drag/drop/wiring/save/check loop; 6-10 weeks to "feels like the new ChipBlocks."

### Reset Sprint 1 (week 1-2): Preservation + reset + infrastructure

**Goal:** legacy branch frozen with dignity; main reset; extracted infrastructure operational; new project identity in docs.

**Deliverables:**
- `legacy/audio-synth-direction` branch created from current master; pushed to origin; README badge added
- `v0.1.0-alpha.9-final` tag applied (same SHA as alpha.9, ceremonial marker)
- Main branch reset to near-empty state:
  - Repo root: LICENSE, README.md (new content), CLAUDE.md (new content), PRD.md (rewritten), ROADMAP.md (new), .gitignore
  - `frontend/` minimal: Electron shell, React app skeleton that renders "ChipBlocks v2 (ground-up restart) — initializing"
  - `.github/workflows/` minimal CI that runs `npm install && npm run lint && npm test` (passes against the skeleton)
  - `scripts/` empty (codegen scripts will arrive in sprint 2 with the first manifest)
- README clearly explains: "v0.1.0-alpha.9 was the audio-synth direction; it's preserved on the `legacy/audio-synth-direction` branch. The new direction starts here."
- ADR-006 drafted: the universal object model + 9-layer stack + AI authority split (no implementation yet, just the design)

**Done criteria:**
- Anyone clones the repo, runs `git checkout legacy/audio-synth-direction`, gets the working alpha.9 experience
- Anyone clones the repo, stays on main, runs `npm install && npm run dev`, gets the empty new-direction shell
- CI green on both branches
- All previous alpha releases still downloadable from GitHub Releases page
- ADR-006 readable, internally consistent

**Estimated time:** 1-2 weeks

### Reset Sprint 2 (week 3): Layer 0-3 manifests

**Goal:** the ground physics is on disk and validated against schemas.

**Deliverables:**
- `materials.yaml` (~10 materials: copper, silicon_intrinsic, silicon_n_doped, silicon_p_doped, FR4, polyimide, air, solder_sn63pb37, ceramic_alumina, ferrite) + `materials.schema.json`
- `shapes.yaml` (~5 shape primitives: solid_region, thin_film, wire_path, plate, gap) + `shapes.schema.json`
- `interfaces.yaml` (~5 interface kinds: terminal, contact, solder_joint, via, connector_pin) + `interfaces.schema.json`
- `behaviors.yaml` (~7 behaviors: conducts, resists, stores_charge, stores_magnetic_energy, switches, insulates, heats) + `behaviors.schema.json`
- 4 codegen scripts (one per manifest) producing Python + TypeScript registries
- Validation tests: each manifest validates against its schema; cross-manifest FK rules (e.g., shapes reference real materials)
- Each material value has a citable source (`source:` field with NIST or PDK reference)

**Done criteria:**
- `npm run codegen --check` passes
- `pytest backend/tests/test_layer_*_manifest.py` passes
- Every property in every material has units and a source citation
- New CLAUDE.md updated with the 4 manifests in the key-documents list

**Estimated time:** 1 week

### Reset Sprint 3 (week 4): Layer 4 devices + universal object model + project file format

**Goal:** the first primitive devices exist; the design file format is defined.

**Deliverables:**
- `devices.yaml` (8 devices: wire, resistor, capacitor, inductor, diode, LED, switch, power_source) + `devices.schema.json`
- Each device row composes from L0-L3 manifest references (no implementation magic; every device is provable from the ground up)
- Codegen script for devices manifest
- Universal object model spec written as a separate document (`OBJECT-MODEL.md`)
- Project file format spec written (`PROJECT-FORMAT.md`)
- Save-load roundtrip test: write an empty project file, load it, write again, byte-identical

**Done criteria:**
- All 8 devices in `devices.yaml` cite specific material + shape + interface + behavior references that exist in lower-layer manifests
- An empty `MyProject.chipblocks/` folder can be created, parsed, and re-serialized
- New project file is git-friendly (YAML at top level, generated artifacts in subfolders)

**Estimated time:** 1 week

### Reset Sprint 4 (week 5-6): Canvas v1 — the visual editor's first usable form

**Goal:** the user can drag, drop, wire, save. Not pretty yet, but functional and the five essentials are met.

**Deliverables:**
- Palette UI listing the 8 L4 devices, grouped by category, with one-line descriptions
- React Flow canvas with custom node components for each L4 device, showing terminals
- Drag-drop from palette to canvas — smooth, responsive (≤16ms frame time per drag for ≤100 nodes)
- Wire-drawing between compatible terminals — curved bezier paths, real-time validity highlighting
- Property inspector right-panel — selected block's parameters editable inline, type-validated
- Undo/redo (Ctrl+Z / Ctrl+Y) for every action — 50-step buffer
- Bottom-panel checks placeholder (warnings list, empty until Sprint 5 validator lands)
- "Save Project" action: writes the current canvas as `MyProject.chipblocks/design.yaml`
- "Load Project" action: opens a project folder, restores the canvas

**Done criteria — the 5 essentials are met:**
1. Drag feels smooth (subjective; user tests on a Windows laptop and confirms)
2. Wire drawing feels clean (curved, not jagged; terminal snap works)
3. Undo / redo works for create, delete, move, wire, parameter edit
4. Property inspector works for the 8 device types
5. (Warnings click back to bad part — deferred to Sprint 5 when validator exists)

**Estimated time:** 2 weeks (the 5 essentials are tight; canvas tuning eats time)

### Reset Sprint 5 (week 7): Steady-state validator

**Goal:** the engine can answer "will this circuit work?"

**Deliverables:**
- Net detection: walk the wires, identify nets (groups of terminals connected via wires)
- KCL solver: assign currents to wires such that current in = current out at every node
- KVL solver: assign voltages such that loop sums = 0
- Ohm's law for resistors: V = I × R
- Joule's law for power dissipation: P = I² × R
- LED forward-voltage check: if I > 0, V across LED ≥ forward_voltage; if I > max_forward_current, flag failure
- Switch state machine: open / closed; both states validatable
- Failure-mode evaluator: per-block trigger rules evaluated against the solved circuit state
- Validator output displayed in bottom panel as a clickable warning list
- Clicking a warning navigates the canvas to the offending block (the 5th essential)

**Done criteria:**
- Drag battery + wire + resistor + wire + LED + wire back to battery
- Set switch closed; click Validate
- Output: "✅ valid; LED runs at 18mA (within 20mA rating); resistor dissipates 0.15W (within 0.25W rating)"
- Change resistor to 100Ω; re-validate
- Output: "❌ LED current 80mA exceeds 20mA rating; will burn out"
- Click the warning; canvas focuses the LED

**Estimated time:** 1 week

### Reset Sprint 6 (week 8-10): AI integration + manufacturing skeleton + first demo

**Goal:** the loop closes. Project can be saved, validated, and exported. AI helps without owning.

**Deliverables:**
- Multi-provider AI adapter: No-AI (required), Anthropic, OpenAI selectable in settings
- BYOK key storage via safeStorage (one key per provider)
- Agentic chat loop with tool definitions reflecting the new direction (add_device, add_wire, set_parameter, suggest_resistance_for_led, explain_warning)
- "No-AI mode" is functionally complete: the entire app works with zero AI calls — validator is deterministic, save/load works, manufacturing skeleton generates
- Manufacturing package skeleton: when user clicks "Release," produces:
  - `MyProject_Manufacturing_Release_v0.1.zip` containing:
    - `bom.csv` (parts list)
    - `schematic.svg` (auto-generated 2D schematic)
    - `README.md` (project description; AI-drafted, user-editable)
    - `validation-report.txt` (deterministic-engine output)
- Documentation: README walkthrough, "Hello, ChipBlocks" demo screencast
- `v0.2.0-alpha-preview` tag

**Done criteria — "the new ChipBlocks works":**
- New user opens the app, drags 4 blocks, wires them, hits Validate, hits Release
- The release ZIP contains a correct BOM and a correct schematic
- The AI consultant (with API key) can explain "why is the LED burning out?" pointing at the resistance calculation, but it never modifies the design without user approval
- No-AI mode works fully — the user can never have configured an API key and still produce a release ZIP
- A second user clones the project, opens it in the app, sees the same design

**Estimated time:** 2-3 weeks (AI multi-provider has unknowns)

### Total estimated timeline

| Phase | Weeks | Deliverable |
|---|---|---|
| Sprint 1 — preservation + reset | 1-2 | Legacy branch frozen; new main with infrastructure |
| Sprints 2-3 — manifests + universal object model | 2-3 | Layer 0-4 manifests + project file format |
| Sprints 4-5 — canvas + validator | 3-5 | Working drag/drop/wire/save/validate loop |
| Sprint 6 — AI + manufacturing + demo | 2-3 | First end-to-end demo at v0.2.0-alpha-preview |
| **Total to first new-direction demo** | **8-13 weeks (2-3 months)** | "Feels like the new ChipBlocks" |

Per your pushback on my optimistic 4-6-week estimate: this is wider but more honest. The canvas tuning + AI multi-provider work both have unknowns.

---

## Done criteria for the reset overall

The reset is complete when:

1. **Legacy preservation verified:** `git checkout legacy/audio-synth-direction && npm run dev` produces the working alpha.9 audio-synth tool. Tested manually.
2. **New main running:** `git checkout main && npm run dev` produces the new-direction app at its current sprint state.
3. **GitHub Releases page:** all alpha.x releases still downloadable. `v0.1.0-alpha.9-final` tag visible.
4. **CI green on both branches.**
5. **Documentation honest:** README clearly explains the two directions; new user knows where to look for what.

That's the bar.

The first sprint of new-direction work is complete when:

1. ADR-006 readable and approved
2. Empty new-main shell launches without errors
3. README explains the situation accurately

The first new-direction *demo* is complete (≈ sprint 6) when:

1. The LED + resistor + switch + power source slice works end-to-end
2. Validator catches "LED burns out without resistor"
3. Manufacturing ZIP contains a correct BOM
4. AI consultant works in multi-provider mode
5. No-AI mode is fully functional
6. v0.2.0-alpha-preview tag pushed

---

## Open questions to resolve BEFORE starting Sprint 1

Five questions that shape Sprint 1's actual execution. None block this plan from being approved, but they need answers before any code lands.

### 1. Branch name confirmation

Proposed: `legacy/audio-synth-direction`. Alternatives: `legacy/v1-audio-synth`, `archive/audio-direction`, `audio-synth-archive`. My lean: `legacy/audio-synth-direction` (descriptive, signals "older version" clearly).

### 2. Tag name for the freeze marker

Proposed: `v0.1.0-alpha.9-final`. Alternatives: `legacy-final`, `v0.1.0-end-of-line`. My lean: `v0.1.0-alpha.9-final` (semver-respecting; clear meaning).

### 3. New ADR numbering — continue from ADR-006 or restart at ADR-001-v2?

If we continue: ADR-006 is the universal object model; ADR-007 is the AI authority split. The numbering stays continuous; the legacy branch has ADRs 001-005, main has 006+.

If we restart: ADR-001 (new) is the universal object model; ADR-002 (new) is the AI split. Numbering restarts at 1 to signal a clean break.

My lean: **continue from ADR-006**. Continuous numbering is simpler and respects the work already done. The "new direction" framing comes through in the ADR content, not the number.

### 4. New CLAUDE.md and PRD — full rewrite or extension?

The current CLAUDE.md is 156 lines of mostly-legacy content. The current PRD is 227 lines, mostly still valid (the problem statement, the persona definitions, the goals, the non-goals all still apply).

My lean:
- CLAUDE.md: **full rewrite** — the project identity changed
- PRD.md: **substantial revision** — keep the problem statement and persona definitions; rewrite the requirements and the phasing
- README.md: **full rewrite** — public-facing identity is new
- ROADMAP.md: **full rewrite** — sprint history goes to legacy; new roadmap starts fresh

### 5. What goes in the very first commit on the reset main?

Options:
- (a) Single commit with all the extracted infrastructure + new docs at once
- (b) Multiple atomic commits: one for the empty shell, one for new docs, one for CI workflow, etc.

My lean: **(b)** — multiple atomic commits in Sprint 1, each pushable independently. Lets the user review each piece without a giant diff. Estimated 5-10 small commits in Sprint 1.

---

## What this plan does NOT decide

Deliberately deferred — not because they don't matter, but because they're better decided as we approach them.

1. **The exact list of materials in Layer 0.** Sprint 2 will pick ~10 materials. The exact list shapes during authoring.
2. **The exact failure modes per device.** Sprint 3 will enumerate the ones the LED+R+switch demo needs; more added as needed per device.
3. **Whether Layer 0 includes thermal / mechanical properties at v1.** Probably yes for thermal_conductivity (heat dissipation is part of MVP), no for mechanical strength (no PCB layout in MVP).
4. **PCB tooling integration (KiCad).** Layer 7 work — months out. Not decided here.
5. **Mechanical / 3D design (FreeCAD).** Layer 8 work — explicit non-goal for v1.
6. **The PRD's Phase 5 / Phase 6 (general-purpose PCB and motherboard tools).** Stay in PRD as long-term direction; not in v1 scope.
7. **Specific AI providers' API contracts** beyond Anthropic + OpenAI for v1.
8. **Community library hosting model** beyond "GitHub repos under the same org or related orgs."
9. **The exact 5 visual-editor essentials.** Sprint 4 may discover that "click-back-to-warning" requires the validator first (which is Sprint 5), in which case it's deferred to Sprint 5's done criteria.

---

## Operational mechanics — how to execute the reset

When this plan is approved, the steps to execute Sprint 1 are, in order:

1. **Verify clean working tree** on master (`git status` returns clean).
2. **Verify CI green** on the most recent master commit.
3. **Create the freeze tag:** `git tag v0.1.0-alpha.9-final` at the current master HEAD; push to origin.
4. **Create the legacy branch:** `git branch legacy/audio-synth-direction master`; push to origin. Do NOT check it out.
5. **Verify legacy branch checkable:** in a separate terminal, `git checkout legacy/audio-synth-direction` and confirm the alpha.9 state is intact; checkout back to master.
6. **Reset master:**
   - In a fresh branch off master called `main-reset-staging`, delete everything in the working tree EXCEPT what gets directly extracted (per the "Direct port" table above).
   - Verify the directory contents match expected.
   - Run `npm install && npm run dev` to confirm the shell launches.
   - Commit "Reset main: preserve infrastructure, drop legacy content (see RESET-PLAN.md)" — large diff, single commit, clearly described.
   - After review + approval, force-push to master (or fast-forward merge `main-reset-staging` → master).
7. **Add new docs:**
   - Write new README.md, new CLAUDE.md, new PRD.md, new ROADMAP.md.
   - Atomic commits, one per file (or grouped by purpose).
   - Push.
8. **Draft ADR-006:**
   - Write `ADR-006-universal-object-model.md` at repo root.
   - Push.
9. **Add CI for the reset main:**
   - `.github/workflows/ci.yml` updated to reflect the smaller test surface.
   - Push and verify green.

After step 9: Sprint 1 done. Sprint 2 can begin.

The only **destructive** action in this list is step 6 (the master reset). Before step 6:
- Legacy branch is on origin
- Freeze tag is on origin
- Verification confirms legacy is checkable
- The reset is staged on a separate branch for review

Even step 6 isn't truly destructive — the legacy branch is the full history; nothing is lost.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Force-push to master alarms anyone watching the repo | Low (no external users) | Pre-announce in README and commit message |
| The 5 visual-editor essentials feel undefined / subjective | Medium | Sprint 4 writes a user-test checklist; subjective "feels good" gets converted to measurable criteria |
| AI multi-provider abstraction has unforeseen complexity | Medium | Sprint 6 starts with Anthropic-only adapter (proven path); OpenAI added next; abstraction layer designed to absorb both without rewrite |
| Sprint 2-3 schema authoring takes longer than expected | Medium | Allowed up to 2 weeks per sprint instead of 1; honest "fine taking time" applies |
| The PRD rewrite is harder than expected because the old PRD has good content | Low | Don't fight it; keep the problem statement and personas verbatim; rewrite only what's stale |
| Solo-dev burnout from a 2-3-month restart | Medium | "Fine taking time" core constraint applies; weekly check-ins (with self, or with this AI) to assess pace honestly |
| Confusion: which branch is "real" / which is "ChipBlocks" | Low-Medium | README clarity, README, README; banner on the legacy branch's README; clear naming |

---

## What I want you to push back on before approving this plan

Five places I'd specifically welcome pushback:

1. **The 6-sprint structure.** Are these the right milestones? Should Sprint 1 be smaller? Should Sprint 6 be split?
2. **The done-criteria for Sprint 6** (the demo bar). Is LED + resistor + switch + power source the right "first thing"? Or do you want different devices?
3. **The 5-essentials list for the canvas in Sprint 4.** Is one wrong? Should one be added?
4. **The branch naming + freeze tag naming.**
5. **Whether to continue ADR numbering or restart.**

Everything else I have leans on. Push back where needed; otherwise I carry the leans forward.

---

## What happens next

You read this. You push back. We iterate the plan until you're satisfied. Then — and only then — Sprint 1 begins with the operational mechanics above. **No code changes until this plan is approved.**

The first concrete code change after approval will be `git tag v0.1.0-alpha.9-final` at the current HEAD. That single command is the point of no return for the reset — and even then, the legacy branch preserves everything so it's not truly destructive.

The estimated wall-clock time from "plan approved" to "first new-direction demo" is 2-3 months, working at the project's "fine taking time" cadence.
