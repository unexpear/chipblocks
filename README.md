# ChipBlocks

A free, open-source, ground-up electronics builder. Real physical blocks all the way down — materials, geometry, electrical behavior — composing into devices, circuits, chips, boards, and full electronic systems. Every block can be traced down to first principles.

> ⚠️ **Important disclaimer.** I'm not an electrical engineer. I built this because the problem space is interesting. ChipBlocks's validation is best-effort built on cited references (NIST, IEC, IEEE, IPC, Sze, Schubert, etc.) and structural cross-checks — but I could have missed things, and AI (Claude) + iterative "vibe coding" did much of the drafting. **Don't put full trust in the output.** Good for learning, hobbyist projects, and design starting points; **NOT for safety-critical work** (medical, automotive, aerospace, etc. — see [DISCLAIMER.md](DISCLAIMER.md) for the full picture). The app is free forever; files you create with it are yours to keep, share, or sell (see [CREDITS.md](CREDITS.md) commercial-use posture).
>
> **Errors may exist.** Cited values can have transcription errors, datasheet errata, or condition-dependent variation. Found something wrong? Open an issue or submit a PR with the corrected value and a source citation — community-curated errata is how data quality improves over time (same model KiCad uses).

**Status:** A working desktop app lives on `master` — Electron + React + TypeScript. What's shipped: a fully-cited, JSON-Schema-validated catalog (19 materials, 13 behaviors, 28 primitive-device definitions — diodes, LEDs, BJTs, MOSFETs, transformers, plus switches, potentiometer, relay, fuse, thermistor, photodiode/phototransistor and more — with 17 example instances) checked by a cross-reference validator; **two physics solvers** — DC (Modified Nodal Analysis + Newton–Raphson, with electro-thermal feedback) and transient/time-domain (backward-Euler); a **full interactive schematic editor** (standard IEC 60617 / IEEE 315 symbols, CAD-style wiring, selection, undo/redo, reusable circuit blocks); a **multimeter** and a **complete oscilloscope + curve tracer**; a Math panel, failure-mode checks, five visualization lenses, and circuit Save/Load. The digital chapter — logic gates built from real transistors → adders → flip-flops and a 4-bit register — is in. Nine JSON schemas; **947 tests** plus type-check, lint, and build gate every commit. Through Sprint 21.

This is a working tool, not a finished product — heed the disclaimer above. The docs in this repo track the design and the reasoning behind it.

## Vision in one sentence

ChipBlocks is a ground-up electronics design system where every block is physically defined, behavior is checked against real physical/electrical rules, AI helps explain and generate support files, and finished designs export as both editable projects and manufacturing-ready ZIP packages.

The three load-bearing principles:

1. **AI assists. ChipBlocks validates. The user approves.** The deterministic engine owns physics, units, netlist correctness, and the manufacturing-package contents. AI helps with docs, code, suggestions, explanations — but never produces the deliverable artifacts that go to a fab.

2. **Real blocks all the way down.** Every block in the library traces to materials + geometry + interfaces + behaviors. A resistor isn't a magic icon; it's a resistive material in a specific shape with two terminals adopting Ohm + Joule + heating behaviors. The user can use it as a single block, or descend into the definition.

3. **Free and open-source, no paid tier ever.** MIT-licensed, permissive dependencies only, BYOK AI (no inference fees passed through to users), all toolchain components either bundled or open-source. A No-AI mode is required so the app works fully without any model.

## Visual approach

ChipBlocks uses **standard schematic shorthand** — the symbols people already draw on paper and that KiCad uses. Standardized in **IEC 60617** (international graphical symbols for diagrams) and **IEEE 315** (the US convention KiCad's defaults derive from). Custom icons would be anti-usability for an audience that already reads zigzag = resistor, triangle + bar = diode, two parallel lines = capacitor.

See [SCHEMATIC-SYMBOLS.md](SCHEMATIC-SYMBOLS.md) for the symbol inventory and the IEC vs IEEE differences. The exact mechanism — likely an optional `symbol:` field on device definitions pointing at a standard symbol id — is deferred until canvas work begins; see [OBJECT-MODEL.md](OBJECT-MODEL.md) §15 for the deferred design question.

## Previous direction (audio-synth chip designer)

The original ChipBlocks (v0.1.0-alpha.x) was a visual chip-design tool focused on audio synthesis. It shipped 48 blocks, 22 example graphs, and 4 silicon targets (3 iCE40 FPGA boards + Tiny Tapeout submission).

**That work is preserved with full integrity.** It is not deleted; it has been formally handed off:

- **Branch:** `legacy/audio-synth-direction` — a snapshot of the v0.1.0-alpha.9 state. Clone the repo and `git checkout legacy/audio-synth-direction` to get the audio-synth tool intact.
- **Tag:** `v0.1.0-alpha.9-final` marks the formal handoff point.
- **GitHub Releases:** every alpha.x installer remains downloadable.

The reset changes the active product direction. It does not change the value of the old work. The legacy direction may later be extracted into a separate `chipblocks-audio` repository and continued independently.

## Current repo state

```
chipblocks/
├── src/                        physics solvers + React renderer (editor, scope, meter, lenses)
├── electron/                   main process (native menu, Save/Load) + preload bridge
├── schemas/                    nine JSON Schemas (definition, instance, behavior, net, …)
├── fixtures/valid/             the cited catalog (materials, behaviors, devices, instances, nets)
├── tests/                      918 Vitest tests
├── sprints/                    sprint plans + close-outs (sprint-2 … sprint-21)
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

Build and run it with `npm install`, then `npm run dev` (Electron dev app) or `npm run build`.

## Contributing

ChipBlocks is in active development. Issues, corrections to cited values (with a source), and discussion on the canonical object model ([OBJECT-MODEL.md](OBJECT-MODEL.md)) are welcome. The legacy audio-synth branch (`legacy/audio-synth-direction`) is preserved but is not the current direction.

## License

[MIT](LICENSE). Every dependency must be permissively licensed (MIT, Apache 2.0, BSD, ISC, CC0, MPL-2.0). No GPL or AGPL bundled in the shipped product. MPL-2.0 is file-level copyleft (Mozilla's license) — its obligations stay scoped to MPL-licensed files themselves, so it's safe alongside permissive code.
