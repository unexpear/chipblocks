# ChipBlocks

A free, open-source, ground-up electronics builder. Real physical blocks all the way down — materials, geometry, electrical behavior — composing into devices, circuits, chips, boards, and full electronic systems. Every block can be traced down to first principles.

**Status:** Foundation-spec phase. **There is nothing runnable yet.** Master is markdown only — no frontend, no schemas, no manifests, no validator, no app shell. We're actively writing the canonical object model spec ([OBJECT-MODEL.md](OBJECT-MODEL.md)) before any code returns. The shape of the work: spec the foundation → write schemas → build the validator → build the canvas → ship the first working slice. We're at step 1.

If you want a working app, this isn't it yet. If you want to follow the design discussion, the docs in this repo are the current work.

## Vision in one sentence

ChipBlocks is a ground-up electronics design system where every block is physically defined, behavior is checked against real physical/electrical rules, AI helps explain and generate support files, and finished designs export as both editable projects and manufacturing-ready ZIP packages.

The three load-bearing principles:

1. **AI assists. ChipBlocks validates. The user approves.** The deterministic engine owns physics, units, netlist correctness, and the manufacturing-package contents. AI helps with docs, code, suggestions, explanations — but never produces the deliverable artifacts that go to a fab.

2. **Real blocks all the way down.** Every block in the library traces to materials + geometry + interfaces + behaviors. A resistor isn't a magic icon; it's a resistive material in a specific shape with two terminals adopting Ohm + Joule + heating behaviors. The user can use it as a single block, or descend into the definition.

3. **Free and open-source, no paid tier ever.** MIT-licensed, permissive dependencies only, BYOK AI (no inference fees passed through to users), all toolchain components either bundled or open-source. A No-AI mode is required so the app works fully without any model.

## Visual approach (eventual canvas)

When the canvas exists, ChipBlocks will use **standard schematic shorthand** — the symbols people already draw on paper and that KiCad uses. Standardized in **IEC 60617** (international graphical symbols for diagrams) and **IEEE 315** (the US convention KiCad's defaults derive from). Custom icons would be anti-usability for an audience that already reads zigzag = resistor, triangle + bar = diode, two parallel lines = capacitor.

See [SCHEMATIC-SYMBOLS.md](SCHEMATIC-SYMBOLS.md) for the symbol inventory and the IEC vs IEEE differences. The exact mechanism — likely an optional `symbol:` field on device definitions pointing at a standard symbol id — is deferred until canvas work begins; see [OBJECT-MODEL.md](OBJECT-MODEL.md) §15 for the deferred design question.

## Previous direction (audio-synth chip designer)

The original ChipBlocks (v0.1.0-alpha.x) was a visual chip-design tool focused on audio synthesis. It shipped 48 blocks, 22 example graphs, and 4 silicon targets (3 iCE40 FPGA boards + Tiny Tapeout submission).

**That work is preserved with full integrity.** It is not deleted; it has been formally handed off:

- **Branch:** `legacy/audio-synth-direction` — a snapshot of the v0.1.0-alpha.9 state. Clone the repo and `git checkout legacy/audio-synth-direction` to get the audio-synth tool intact.
- **Tag:** `v0.1.0-alpha.9-final` marks the formal handoff point.
- **GitHub Releases:** every alpha.x installer remains downloadable.

The reset changes the active product direction. It does not change the value of the old work. The legacy direction may later be extracted into a separate `chipblocks-audio` repository and continued independently.

## Current repo state (docs only)

```
chipblocks/
├── OBJECT-MODEL.md             canonical v3 foundation spec
├── README.md                   this file
├── CLAUDE.md                   development companion for Claude Code
├── PRD.md                      product requirements
├── MATERIAL-SOURCES.md         Layer 0 sourcing reference
├── PHYSICS-COVERAGE-MAP.md     long-horizon physics roadmap
├── OPEN-HARDWARE-ECOSYSTEM.md  open-hardware ecosystem notes
├── TOOLING-RESEARCH-2026-05.md research notes on the eventual toolchain
├── LICENSE                     MIT
├── CLA.md                      contributor license agreement
└── (historical, banner-marked) ADR-006, ADR-007, ROADMAP,
                                RESET-PLAN, FINAL-STATE-VISION,
                                SPRINT-1, SPRINT-2, SPRINT-3
```

Frontend / schemas / manifests / codegen / tests / CI all return as v3 sprints rebuild them. The first code to return is `schemas/object.schema.json` in v3 Sprint 2 — only after the object model spec clears review.

## Contributing

ChipBlocks is in active foundation-spec work. Issues and discussions on the canonical object model ([OBJECT-MODEL.md](OBJECT-MODEL.md)) are welcome. PRs are best deferred until the spec clears review and the first schema lands. The legacy audio-synth branch (`legacy/audio-synth-direction`) is preserved but not the current direction.

## License

[MIT](LICENSE). Every dependency must be permissively licensed (MIT, Apache 2.0, BSD, ISC, CC0). No GPL or AGPL in the shipped product.
