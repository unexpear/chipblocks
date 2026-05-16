# ChipBlocks Roadmap (v2)

> **Last reviewed:** 2026-05-16 (post-reset) · **Format:** Now / Next / Later · **Cadence:** revisit at the end of each sprint.
>
> This is the operational "what's next" document for the ground-up restart. The strategic vision lives in [PRD.md](PRD.md); the full reset history lives in [RESET-PLAN.md](RESET-PLAN.md); the destination lives in [FINAL-STATE-VISION.md](FINAL-STATE-VISION.md). Per-sprint plans + retrospectives will live in `SPRINT-N.md` files as those sprints land.
>
> The previous v1 roadmap (with 24 closed sprints documenting the audio-synth direction) is preserved on the `legacy/audio-synth-direction` branch.

## Snapshot — where we actually are (2026-05-16)

- **Sprint 0 (reset) just executed.** Master is now the new direction; legacy branch preserves v1.
- **Sprint 1 in flight.** Goal: legacy preservation verified, master reset, extracted infrastructure operational, new project identity in docs, ADR-006 drafted.
- **Block count:** 0 (the new direction's primitive library starts empty; v1's 48 audio blocks live on the legacy branch).
- **Tests:** ~0 (TS check is the only CI gate at the reset). Test surface grows back as features land.
- **Manifests:** none yet (Layer 0-4 manifests land in Sprint 2-3).
- **Working tree:** minimal Electron + React + TS shell. Launches a window saying "ChipBlocks v2 (ground-up restart) — initializing."

## Now — Sprint 1 (reset week 1-2)

| Pri | Item | Owner | Effort | Why |
|---|---|---|---|---|
| **P0** | Verify legacy branch preserves alpha.9 cleanly. `git checkout legacy/audio-synth-direction && npm run dev` reproduces the v1 audio-synth tool. | Manual / Claude | 30 min | The "preservation" half of the reset must be verified, not assumed |
| **P0** | Verify new main launches: `npm install && npm run dev` opens the empty shell window | Manual | 10 min | The reset is incomplete until the shell launches without errors |
| **P0** ✅ | [ADR-006](ADR-006-universal-object-model.md) drafted — the 9-layer hierarchy + the universal object model spec + the AI authority split + project file format + signal types. Awaiting user review. | Claude | done | Locks in the design before Sprint 2's manifest authoring |
| **P0** | Verify CI green on the new minimal master | Claude | 5 min | Don't proceed if CI is broken on the reset commit |

**Done criteria:** legacy verified, new shell launches, ADR-006 drafted, CI green.

**Sprint 1 estimated completion:** end of week 2.

## Next — Sprints 2-6 (reset week 3-10)

| Sprint | Theme | New artifacts | Estimated duration |
|---|---|---|---|
| **S2** | Layer 0-3 manifests + Active Variables data shape | `materials.yaml` + schema (~10 materials); `shapes.yaml` + schema; `interfaces.yaml` + schema; `behaviors.yaml` + schema; `signals.yaml` + schema (8 signal types); `parameters.yaml` + schema covering the `variables` section per [ADR-007](ADR-007-active-variables.md). All with codegen + validation tests. | 1 week |
| **S3** | Layer 4 devices + universal object model + project file format | `devices.yaml` + schema (~8 devices); universal object model spec; `MyProject.chipblocks/` folder format spec; save/load roundtrip test | 1 week |
| **S4** | Canvas v1 | Palette listing the 8 devices; drag-drop to canvas; wire-drawing between terminals; property inspector; undo/redo; save/load. **5 essentials enforced:** smooth drag, clean wires, undo/redo, inspector, click-back-to-warning (deferred to S5 if needed). | 2 weeks |
| **S5** | Steady-state validator | KCL/KVL solver; Ohm; Joule; LED forward-voltage check; switch state machine; failure-mode evaluator; bottom-panel warning list with click-to-locate | 1 week |
| **S6** | AI + manufacturing skeleton + first demo | Multi-provider AI adapter (No-AI required + Anthropic + OpenAI); BYOK via safeStorage; agentic loop with tool definitions; manufacturing release ZIP skeleton (BOM + schematic SVG + README); `v0.2.0-alpha-preview` tag | 2-3 weeks |

**Done criteria for Sprint 6 (the first new-direction demo):**

- User drags battery + switch + resistor + LED, wires them, hits Validate, hits Release
- Validator catches "LED will burn out without resistor"
- AI consultant (with API key) explains why; without API key, design still works in No-AI mode
- Manufacturing ZIP contains correct BOM + correct schematic
- Project saves as `MyProject.chipblocks/`
- Another user clones the project, opens it, sees the same design

**Estimated v0.2.0-alpha-preview ship date:** end of week 10 (2-3 months from reset).

## Later — Phase 2+ (post-Sprint-6)

After v0.2.0-alpha-preview ships:

### Phase 2 — Expand foundation (months 3-6)

- **Layer 5 (Circuits):** voltage divider, RC filter, oscillator, basic logic gates, voltage regulator — as block groups composed from L4 primitives
- **Community library scaffolding:** `chipblocks-audio` library extracted from the legacy branch as the inaugural community library; `chipblocks-peripherals` started with SPI master / I²C master / UART / GPIO / PWM
- **More AI providers:** Gemini, Ollama (local), custom endpoint
- **First fab path beyond simulation:** KiCad PCB export — designs can be sent to a real PCB fab
- **Discrete-time validator extension:** time-domain analysis for circuits with stored-energy elements (capacitors, inductors)
- **Anomaly database scaffolding:** framework + first 5-10 entries (ESD, thermal runaway, ringing, etc.)

### Phase 3 — Chip side restored (months 6-12)

- **Layer 6 (Assemblies / ICs):** packaged CPU cores (picorv32 as first), small SoCs
- **Chip fab path:** Tiny Tapeout submission as a `shuttles.yaml` row; eFabless ChipIgnite as another; potentially in-house ChipBlocks Shuttle tiers
- **Standard cells from PDKs:** sky130_fd_sc_hd brought back as a Layer-1+2+3+4 composition (since these cells are themselves transistor-and-geometry compositions from the user's perspective)
- **ngspice integration:** continuous-time transient simulation for analog/mixed-signal work

### Phase 4 — System side (year 2+)

- **Layer 7 (Boards / chips):** PCB layout in-app (or via KiCad backend); motherboard primitives
- **Layer 8 (Systems):** full devices — phones, robots, controllers
- **Real chips fabricated by external users via the platform**
- **Real PCBs assembled from ChipBlocks-generated Gerbers**

### Phase 5 — Web version (year 2+)

- Browser-only ChipBlocks with cloud workers for heavy synthesis
- Same desktop power, no install
- Still BYOK AI

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Visual editor doesn't feel good** and users abandon | **High** | Sprint 4 enforces the 5 canvas essentials; ship later rather than janky |
| **Physics correctness gap** — design simulates fine but doesn't work in real life | **High** | Stop at DC steady-state at v1; expand only when motivated; integrate ngspice when transient analysis is needed (not before) |
| **Scope creep** — every new ambition triggers more new ambitions | **High** | Sprint discipline; "fine taking time"; one demonstrable capability per sprint |
| **Solo-dev burnout** across a 12+ month restart | **High** | Plan for sustainability; "fine taking time"; weekly check-ins on pace |
| **AI vendor disappears or breaks API** mid-project | **Medium** | Multi-provider AI adapter from Sprint 6; No-AI mode required at v1 means the app is never blocked on any one provider |
| **Community libraries don't materialize** | **Medium** | Worst case: we author the first ~5 libraries ourselves to demo the model; if no PRs follow, the value is still delivered at v1 |
| **The 48 audio blocks feel "wasted"** because they're on a frozen branch | **Low** | Frame as graduating to v2 community library; preserve all code; honor the work; potentially extract to `chipblocks-audio` repo when relevant |

## Decision log

### 2026-05-16 — Project reset to ground-up direction

Captured in detail in [RESET-PLAN.md](RESET-PLAN.md):

- Audio-synth direction (24 sprints, 48 blocks, 22 examples) preserved as `legacy/audio-synth-direction` branch + `v0.1.0-alpha.9-final` tag
- New direction starts on master from a near-empty shell
- 9-layer abstraction model adopted
- AI authority split locked: AI assists; ChipBlocks validates; user approves
- Two-deliverables model locked: editable project + manufacturing ZIP
- Multi-provider AI with No-AI required at v1
- First end-to-end demo target: LED + resistor + switch + power source
- Estimated 2-3 months from reset to v0.2.0-alpha-preview

## How to update this doc

- **End of each sprint:** revisit Now/Next/Later; move completed Now items to that sprint's `SPRINT-N.md` retro; pull the next-most-valuable item from Next into Now
- **When something material changes** (user feedback, dependency slip, sprint retro surfaces something): update Risks + the relevant bucket; note in Decision log
- **Don't change for every piece of new info.** Have a threshold. Aim for one update per sprint
- **Keep the format stable.** Now / Next / Later + Risks + Decision log
- **When PRD and this doc disagree** at the strategic level, update PRD too. Don't drift
