# ChipBlocks — final-state vision after all proposed changes land

> **Status:** Draft for direction review (2026-05-16). Not a commitment. Captures what ChipBlocks looks like *if* the post-Sprint-24 strategic pivot, ADR-005 (modular fab platform), and the new ADR-006 + ADR-007 (hierarchical block model + core-vs-community split) all land. Sits alongside [PRD.md](PRD.md) as a forward-looking complement.
>
> Read this top-to-bottom to validate direction. The "Verified current state" section is real; the "Final-state" sections are aspirational. The journey-from-here-to-there section ties them together.

---

## Verified current state (real, not aspirational)

Auditor's snapshot as of master `788079c` (2026-05-16):

| Dimension | Value | Source |
|---|---|---|
| Master tip | `788079c` | `git log` |
| Latest tag | `v0.1.0-alpha.9` | `git describe` |
| Sprints closed | 23 (S1-S22 + S23) | SPRINT-*.md files; SPRINT-24 in flight |
| Sprint in flight | S24 (at S24-12 sync-lead example) + S25 (at S25-2a backend codegen) | git log + SPRINT-24.md |
| Block count | **48** | `grep -c "^- type:" blocks.yaml` |
| Bundled examples | **22** | `ls examples/*.json \| wc -l` |
| Backend pytest | **227 + 2 skipped** | `pytest backend/tests/` (94 s) |
| Frontend vitest | **322** | `npm test` (10 s) |
| TypeScript | clean (`tsc --noEmit`) | verified |
| Codegen | clean (frontend + backend + shuttles) | verified |
| CI | green on master | gh run list |
| ADRs landed | 4 (001/002/003/005 — note 004 reserved but not yet drafted) | `ls ADR-*.md` |
| Fab manifests | 4 active (shuttles/pdks/packages/flows with rows) + 4 empty (cpu-cores/radios/buses/memories) | `grep -c "^- " *.yaml` |
| Working tree | clean | `git status` |

**Current 48 blocks by category (the inaugural starter library, in the new model):**

| Category | Count | Members |
|---|---:|---|
| **source** | 10 | oscillator, triangle, sawtooth, sine, vco, hardsync, lfo, wavetable, noise, constant |
| **computation** | 10 | adder, subtractor, shifter, comparator, mux, register, ram, registerfile, rom, byteconstant |
| **modulation** | 5 | adsr, gate, samplehold, multiply, fm |
| **logic** | 5 | and, or, xor, not, counter |
| **filter** | 4 | lowpass, highpass, bandpass, vcf |
| **visual** | 5 | vgatiming, colorbars, pixelrange, solidcolor, vgaoutput |
| **effect** | 3 | bitcrusher, delay, distortion |
| **bus** | 3 | bussplit, busjoin, reinterpret |
| **routing** | 3 | mixer, audiosum, output |

Of the 48: **46 are real synthesizable Amaranth HDL**; **2 (output, vgaoutput) have empty `elaborate()` bodies** and are reclassified as I/O markers in BLOCKS.md.

---

## Final-state — what ChipBlocks IS after the changes

### One-sentence identity

A free, open-source, hierarchical chip-design platform that ships **standard cells as the bottom-level primitives** + **graph editor** + **synthesis pipeline** + **modular fab targets**, with a community-curated library of higher-level block groups that users compose to design real fabricable chips at any scale from a single OOK transmitter to a smartwatch SoC.

### What the project ships (the "core")

| Layer | Contents | Owner |
|---|---|---|
| **Primitives** (the floor) | ~70 sky130_fd_sc_hd standard cells (`nand2_1`, `nor2_1`, `dff_1`, `mux2_1`, `clkbuf_1`, etc.) wrapped as Amaranth modules. Plus the ~10 most foundational block groups built from those (basic gates, half/full adder, latch, decoder) so newcomers aren't staring at 70 nameless cells. | ChipBlocks core |
| **Infrastructure** | Graph editor (React Flow), hierarchical save format v2, lazy template expansion, synthesis pipeline (Amaranth → Yosys → fab target), validator, AI consultant, BYOK chat surface. | ChipBlocks core |
| **Modular fab platform** | 8 manifests at repo root — `shuttles.yaml` (fab targets), `pdks.yaml` (process nodes), `cpu-cores.yaml`, `radios.yaml`, `buses.yaml`, `memories.yaml`, `packages.yaml`, `flows.yaml`. Each addable as 1 row + 1 adapter. Third-party tools (eFabless Caravel, OpenLane, SkyWater MPW) are plumbing, swappable. | ChipBlocks core |
| **Block-group manifest system** | Schema + loader + lazy renderer that lets community libraries plug in. Each block group declares its external ports + abstraction level + subgraph + parameters. Versioned so saved graphs reference specific block-group versions and can't silently break. | ChipBlocks core |
| **Build targets** | Currently 4 (icestick, tinyfpga-bx, icebreaker, tt-pico). Future tiers (cb-mini, cb-standard, cb-macro) slot in as `shuttles.yaml` rows when MPW logistics arrange. | ChipBlocks core |

### What the community provides (separate from core)

| Library | Contents | Repo | Maintainers |
|---|---|---|---|
| **chipblocks-audio** | The current 48 blocks repackaged as block groups (oscillator, ADSR, filters, etc.) — the inaugural starter library, the seed of the community-driven model. Demos the audio-domain composition story. | `chipblocks-audio` (separate GitHub repo, MIT-licensed) | Bootstrapped by us, accepts community PRs after first cut |
| **chipblocks-peripherals** | SPI master, I²C master, UART, GPIO, PWM, ST7789 LCD driver, button matrix scanner, FT6236 touch, PWM audio out, LED driver, vibration motor driver, interrupt controller, timer, reset/clock manager. The phone-class roadmap's deliverables — but as community block groups, not core blocks. | `chipblocks-peripherals` | Community-driven from day one |
| **chipblocks-cpus** | Packaged CPU cores: picorv32 (first), VexRiscv, NeoRV32, possibly MOS 6502 and Z80 for retro builds. Each conforms to `chipblocks-cpu-socket-v1`. | `chipblocks-cpus` | Community-driven |
| **chipblocks-radios** | OOK transmitter, audio-FSK modem (Bell 202), LoRa-style CSS, future ASK/BPSK variants. Each conforms to `chipblocks-radio-socket-v1`. | `chipblocks-radios` | Community-driven |
| **chipblocks-video** | Sprite engine, framebuffer, character generator, HDMI / DVI output, etc. Future. | `chipblocks-video` | Community-driven |
| **chipblocks-experimental** | A grab bag — neural net accelerators, signal processing, sensor interfaces, anything the community wants to try. No quality bar; install at your own risk. | `chipblocks-experimental` | Anyone |

Users install libraries from a per-user directory (`~/.chipblocks/libraries/<name>/block-groups.yaml`). The app picks up installed libraries on startup. **Zero hosting cost** — GitHub-backed, no central server.

### Block model (hierarchical, lazy)

Every "block" in the user's graph is one of three things:

1. **Primitive** — a standard cell or fundamental Amaranth Elaboratable. Atom; nothing inside.
2. **Block group** — a graph of primitives + other block groups, packaged into a single canvas node with external ports. Composable to any depth.
3. **Pad / I/O marker** — declares a top-level chip pin. Successor to today's `output` and `vgaoutput` blocks, reclassified out of `blocks.yaml` and into a dedicated concept.

**Lazy expansion is the headline feature:** placing a CPU block group on the canvas shows **one node** with its external ports. The 1,000 internal sub-nodes don't render. The graph editor only renders what's at the current zoom/abstraction level. Computer doesn't melt rendering a million primitives.

User can double-click any block group to "descend" into its subgraph, edit there, ascend back. Standard hierarchical file-manager UX.

**Synthesis is recursive:** the synth pipeline expands all block groups depth-first, flattens to standard cells, hands to Yosys / OpenLane / fab flow. The user never sees the flattened netlist (unless they're a power user who opens the Verilog logs).

### Save format v2

```json
{
  "version": 2,
  "app": "ChipBlocks",
  "savedAt": "...",
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "pads": [
    { "id": "audio_out", "type": "pad-audio-s8", "position": {...} }
  ],
  "nodes": [
    { "id": "cpu1", "type": "block-group:chipblocks-cpus/picorv32@1.0.0",
      "position": {...}, "data": { "params": {...} } },
    { "id": "spi1", "type": "block-group:chipblocks-peripherals/spi-master@1.2.1",
      "position": {...}, "data": {...} },
    { "id": "and1", "type": "primitive:and2_1", "position": {...}, "data": {} }
  ],
  "edges": [...]
}
```

The `type` field is the new strong-id format:
- `primitive:<cell-name>` for standard cells
- `block-group:<library>/<id>@<version>` for community block groups
- `pad-<bus-type>` for I/O markers

Versions are pinned so a community library can update without silently breaking saved graphs. Loader migrates v1 saves to v2 automatically (the 48 existing blocks become `block-group:chipblocks-audio/<id>@1.0.0` references).

### Multi-abstraction-level navigation

In the editor, the user can build at any level and see only that level:

| Level | What's primitive at this level | Example design |
|---|---|---|
| **Standard cells** | `nand2_1`, `dff_1`, `mux2_1` | Build a half-adder from 2 NAND2 + 1 INV |
| **Basic logic** | AND, OR, XOR, NOT (block groups built from standard cells) | Build a full-adder from gates |
| **Datapath** | Half-adder, full-adder, 4-bit adder, register, mux (block groups) | Build a 16-bit ALU |
| **Subsystem** | ALU, register file, decoder, instruction memory | Build a simple CPU |
| **SoC** | CPU + SPI master + UART + GPIO + memory controller | Build a toy phone |

At any level, lower-level groups are *one node*; the user can descend into them when needed. Same UX metaphor as a file-system hierarchy.

### Modular fab platform (the 8 manifests)

Status of each manifest in the final state:

| Manifest | Phase-0 (today) | Final state |
|---|---|---|
| `shuttles.yaml` | 4 rows (3 FPGA + tt-pico) | 4-12+ rows including `cb-mini`, `cb-standard`, `cb-macro` in-house tiers; possibly an ECP5 board |
| `pdks.yaml` | 1 row (sky130A) | 2-4 rows: sky130A + gf180mcuB + ihp-sg13g2 |
| `cpu-cores.yaml` | empty | 2-5 rows: picorv32 + VexRiscv + possibly NeoRV32 + retro options |
| `radios.yaml` | empty | 2-4 rows: ook-433mhz + audio-fsk-bell-202 + lora-css + maybe ask/bpsk variants |
| `buses.yaml` | empty | 2-3 rows: wishbone-classic + apb + maybe axi-lite |
| `memories.yaml` | empty | 4-6 rows: ice40-bram + sky130-sram + register-file + external-spi-flash + external-spi-dram |
| `packages.yaml` | 1 row (caravel-mux) | 4-6 rows: caravel-mux + QFN-32 + DIP-40 + BGA-100 + bare-die |
| `flows.yaml` | 2 rows | 4-5 rows: existing two + libralane + edalize + yosys-only |

Each new entry = 1 manifest row + 1 adapter. No code-path changes elsewhere.

### Build target experience

User picks `--target <id>` from the dropdown. The dropdown is data-driven from `shuttles.yaml`. Click → app reads the shuttle row → invokes the flow adapter → produces the deliverable:

| Tier | Deliverable | Cost | Time |
|---|---|---|---|
| **FPGA** (any iCE40 board) | Flashable bitstream zip + flash instructions | $30-70 dev board + a few $ in passives | ~30-60s build |
| **tt-pico** (Tiny Tapeout slot, sky130) | Verilog submission package for TT portal | Free for open-source (Open Shuttle Program) | ~5s package; weeks to months to fab |
| **cb-mini** (in-house, sky130, 500×500 µm) | Submission package for ChipBlocks Shuttle | ~$1500 estimated | Quarterly MPW runs |
| **cb-standard** (in-house, sky130, 1×1 mm) | Same | ~$5000 estimated | Same |
| **cb-macro** (multi-tile chained) | Multi-tile submission package | Variable | Same |

Everything routes through eFabless / OpenLane / SkyWater MPW infrastructure — we don't run our own fab.

### AI consultant role

The AI consultant in the final state:

- **Aware of installed libraries** — knows what block groups are available across core + installed community libraries
- **Recommends block groups by abstraction level** — if a user says "I want an SPI master," the AI suggests installing `chipblocks-peripherals` first if it's not installed, then how to wire the SPI master block group
- **Composes when needed** — if no block group fits, the AI can generate a composition of primitives or lower-level block groups
- **Explains hierarchically** — "this CPU is a picorv32; here's what's inside if you want to descend"
- **Aware of fab targets** — answers "can my design fit on tt-pico?" by reading `shuttles.yaml` and estimating from the block-group size hints
- **Still BYOK** — user's API key, no project-paid inference

### What the project does NOT ship in the final state

- **No audio-domain blocks in core.** Oscillators, filters, ADSR, etc. ship via `chipblocks-audio` library. Installing it is a 1-click affair.
- **No phone-class peripherals in core.** SPI master, ST7789, OOK transmitter ship via `chipblocks-peripherals` / `chipblocks-radios`.
- **No CPU cores in core.** Ship via `chipblocks-cpus`.
- **No paid services.** No cloud compute, no AI inference on us, no hosted block marketplace requiring login.
- **No copyleft dependencies.** Everything MIT / Apache 2.0 / BSD / ISC / CC0. Per the existing core constraint.
- **No transistor-level layout for v1.** Standard cells are the floor; transistor-level (analog, SPICE-based) is a v2+ ambition.

---

## Deltas from today to final state

### What changes

| Today | Final state |
|---|---|
| 48 blocks live in `blocks.yaml`, all shipped with the core | ~70 standard cells + ~10 foundational block groups in core; 48 blocks reclassified into `chipblocks-audio` and `chipblocks-video` community libraries |
| `Output` + `VgaOutput` are blocks with empty `elaborate()` | Both retired in favor of the new `pad-<bus-type>` concept; v1 saves auto-migrate to use pads |
| Save format v1 (flat node list) | Save format v2 (hierarchical, with primitive/group/pad node kinds, versioned library references) |
| Block graphs are flat in React Flow; all nodes render simultaneously | Block groups are lazy: one canvas node per group; double-click to descend; renders only the current level |
| Adding peripheral blocks = sprint of core work | Peripheral blocks = community PR or user-local additions, no core sprint required |
| Phone-class S26-S31 plan = 17 new core blocks | Phone-class = community contributions to `chipblocks-peripherals` + `chipblocks-cpus` + `chipblocks-radios`; core sprints focus on infrastructure |
| `build.py` hardcodes 4 fab targets | `build.py` reads from `shuttles.yaml`; 4 in-house tiers + community board adapters slot in as rows |
| AI consultant knows about 48 hardcoded blocks | AI knows about whatever libraries are installed; recommends installation of missing ones |

### What stays the same

- The product identity ("free chip-design app for non-technical people")
- The MIT license + permissive-only dependency posture
- BYOK AI integration
- The Electron + React + TypeScript + Python + Amaranth stack
- Solo-dev + Claude-Code authoring model (with community PRs incoming for libraries)
- 4 silicon paths working today (icestick / tinyfpga-bx / icebreaker / tt) — these expand, never shrink
- Tests + CI + codegen-drift discipline

### What we lose (and how to mitigate)

| Loss | Mitigation |
|---|---|
| Out-of-the-box "drag an oscillator → click play → hear sound" demo experience | `chipblocks-audio` ships pre-installed in the desktop app's first-run setup (or shipped as a bundled-but-removable library). New users hit a working demo in 1 click. |
| Curated "we picked these 48 blocks for you" simplicity | Library installation UX is a 1-click affair; core ships with 1-2 starter libraries pre-bundled so the experience matches today's |
| ~10 sprints of audio-block work feeling "demoted" | The 48 blocks become the *first* community library — the inaugural example, the reference implementation, the seed catalog. They're more visible in the new model, not less |
| Single source of truth for "what blocks exist" | The graph editor's palette shows installed libraries as collapsible sections; the AI knows which libraries exist |

### What we don't lose

- Any working example. `chipblocks-audio` ships preloaded; all 22 example graphs continue to play.
- Any synthesis path. Everything still builds for iCEstick / TinyFPGA BX / iCEBreaker / Tiny Tapeout.
- Any test. The existing 227+322 = 549 tests stay green; the migration is structural, not functional.
- Any user. v0.1.0-alpha.9 users' saved graphs auto-migrate to v2 on first load.

---

## Sprint sequence — getting from today to final state

| Sprint | Theme | Key deliverable | Duration |
|---|---|---|---|
| **S25 (remainder)** | Finish ADR-005 Phase 0 | S25-2b: frontend shuttles codegen. S25-3: `build.py` + `tinytapeout.py` migration to read from manifests. S25-4: sprint retro. | 0.5-1 sprint |
| **S26** | **ADR-006 draft + Phase 0 implementation** | Hierarchical block model + save format v2 + lazy template expansion. New `block-groups.yaml` manifest. React Flow lazy-render plumbing. Migration: v1 saves auto-upgrade to v2. | 1-1.5 sprints |
| **S27** | **ADR-007 draft + Phase 0 implementation** | Core-vs-community split. Reclassify the 48 blocks into a `chipblocks-audio` + `chipblocks-video` library structure. Bundle 1 library pre-installed for demo UX. AI prompt updated to know about libraries. | 1 sprint |
| **S28** | **Standard cells as primitives** | Author ~70 sky130_fd_sc_hd cells as Amaranth modules. Add ~10 foundational block groups (basic gates, half/full adder, latch, decoder) built from them. New cookbook entry: "designing at the standard-cell level." | 1-1.5 sprints |
| **S29+** | **Resumed phone-class as community work** | SPI master, I²C master, UART, GPIO, PWM, ST7789 LCD driver, button matrix scanner, FT6236 touch protocol, PWM audio out, etc. — all land as PRs to `chipblocks-peripherals`. Picorv32 lands in `chipblocks-cpus` per ADR-004 (drafted same sprint as the picorv32 PR). | Variable — community-paced |
| **S30+** | **In-house shuttle tiers** | When eFabless / SkyWater MPW arrangements solidify: cb-mini, cb-standard, cb-macro added to `shuttles.yaml`. Each = 1 row. Toy-phone integration example graph (S32 candidate). | When logistics allow |

**Total project sprints to final state (excluding community-paced work):** 5-6 sprints. Realistic time horizon: 2-3 months at the current cadence.

After S28 lands, the project's *core* work shifts from "add more blocks" to "improve the platform" — better editor, better synthesis, better fab targets, better community tooling. The block library grows via community, not via core sprints.

---

## Open questions for direction validation

Read these and tell me where you want to push back. None block anything — they shape the next ADR drafts.

### Strategic

1. **Floor = standard cells, or stop at basic logic gates?** Standard cells are what real fabs see (LSI's standard cell library is what every chip uses). My lean: standard cells. The user can still work at the gate level by ignoring the standard-cell primitives and using the gate block groups. Confirms?

2. **What goes in `chipblocks-audio` vs core?** My lean: ALL 48 current blocks become `chipblocks-audio` + a small subset (Output, VGA Output, basic memory) move to a `chipblocks-io` library. Core ships only standard cells + ~10 foundational gates/adders. Confirms?

3. **First-run UX: bundled vs pure-empty?** A new user opening ChipBlocks for the first time. Option (a): empty palette, "install a library to start" — feels professional but high friction; Option (b): `chipblocks-audio` pre-installed, full palette out of the box — feels easy but contradicts the "core is small" framing. My lean: (b) ships pre-installed because non-technical users need the "drag a thing and hear sound" path to be 1 click. Power users uninstall it.

4. **Community contribution model — PR + review, or anything-goes?** My lean: **tiered**. `chipblocks-*` core libraries (audio / peripherals / cpus / radios / video) accept PRs with review; `chipblocks-experimental` and user-published libraries are anything-goes. Two tiers.

5. **Library versioning — strict semver, or git-sha?** Saved graphs reference `chipblocks-audio/oscillator@1.0.0`. Strict semver means breaking changes bump major; users can upgrade safely. My lean: semver. Auto-pin on save, manual upgrade via a "review changes" dialog.

### Tactical

6. **Standard cells: vendor-canonical names (sky130_fd_sc_hd__nand2_1) or our own renamed (nand2)?** My lean: keep vendor names. They're long but they're what Yosys/OpenLane use; renaming them adds another mapping layer.

7. **Cross-PDK standard-cell support — same block ids for sky130 vs gf180?** Probably yes — `nand2_1` exists in both PDKs even though the underlying cell is different. The PDK choice in `shuttles.yaml` resolves which physical cell gets used. My lean: yes, unified naming with PDK resolution.

8. **Block-group serialization — store the subgraph inline, or by file reference?** My lean: file reference. `chipblocks-audio/oscillator.yaml` declares the block group; the subgraph (if it has one) lives in `chipblocks-audio/oscillator-subgraph.json`. Keeps the manifest readable.

9. **Pads / I/O markers — separate manifest, or inline in shuttles.yaml?** Today Output and VgaOutput are blocks. In the final state they're "pads." Should `pads.yaml` exist as a 9th manifest? Or are pads declared per-shuttle (since the I/O surface differs per shuttle)? My lean: declared **per-shuttle** in `shuttles.yaml` rows (each shuttle exposes its pad shape: audio-pin / VGA-pins / GPIO array / etc.). No 9th manifest.

10. **AI consultant prompt size:** with libraries, the prompt could explode (one section per installed library). My lean: codegen produces a compact "installed libraries summary" with one-line descriptions; the AI can ask for detail on a specific library when needed. Keeps the prompt cache friendly.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Existing user saves break despite migration** | Medium-High | Auto-migration code unit-tested against every shipped example graph; v1→v2 migration is a one-shot conversion at first load. Save the v1 file with `.v1` extension as backup. |
| **Newcomer UX worsens** if `chipblocks-audio` isn't bundled by default | Medium | Pre-bundle it for the first release; users uninstall if they want a leaner experience. |
| **Community libraries fragment quality** — five different "SPI master" implementations with different conformance | Medium | Tiered model: core libraries (`chipblocks-*`) have a quality bar; community experimental is anything-goes. AI consultant recommends from core libraries first. |
| **Block-group versioning bugs** — a library update silently breaks someone's saved chip | Medium | Pin versions in saves; load-time validation; explicit "library X was updated; review changes?" dialog. |
| **Solo-dev burnout from the scope of S26-S28** | Medium | These three sprints are the biggest refactor since the project began. Pace honestly; "fine taking time" remains a core constraint. |
| **Phone-class roadmap slips** because community libraries don't materialize | Low-Medium | Worst case: we author the first 5-10 phone-class block groups ourselves to demo the model; community fills in the rest organically. Even pessimistic case is no worse than the current "all core" plan. |
| **Standard-cell library is too low for non-technical users to start from** | Low | The bundled foundational block groups (basic gates, adders) bridge the gap. Non-technical user starts at the AND-gate level, not the NAND2_1 level. |

---

## Next concrete steps if you green-light the direction

1. **Draft ADR-006** (hierarchical block model + save format v2 + lazy template expansion). Estimated ~600 lines, similar to ADR-005's shape. 1-2 hours.
2. **Draft ADR-007** (core-vs-community split + standard cells as floor). Estimated ~400 lines. 1 hour.
3. **Finish S25-2b + S25-3** to close out the ADR-005 work cleanly. Estimated 1 sprint.
4. **Land ADR-006 implementation** as S26. Estimated 1-1.5 sprints.
5. **Land ADR-007 implementation** as S27. Estimated 1 sprint.
6. **Standard cells as S28.** Estimated 1-1.5 sprints.
7. Resume community-paced phone-class work from S29 onward.

Status check: this doc is ~700 lines. Read it through, push back where I missed the spirit, and we'll iterate the open questions before the ADR drafts.
