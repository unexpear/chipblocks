# ChipBlocks

A free, open-source, ground-up electronics builder. Real physical blocks all the way down — materials, geometry, electrical behavior — composing into devices, circuits, chips, boards, and full electronic systems. Every block can be traced down to first principles.

**Status:** ground-up restart in progress (post-2026-05-16). The first new-direction working slice — drag battery + switch + resistor + LED, validate, generate a release ZIP — is the Sprint 6 target. Earlier sprints lay the foundation (project file format, materials manifest, behaviors, validator). See [RESET-PLAN.md](RESET-PLAN.md) for the full plan.

## Vision in one sentence

ChipBlocks is a ground-up electronics design system where every block is physically defined, behavior is checked against real physical/electrical rules, AI helps explain and generate support files, and finished designs export as both editable projects and manufacturing-ready ZIP packages.

The three load-bearing principles:

1. **AI assists. ChipBlocks validates. The user approves.** The deterministic engine owns physics, units, netlist correctness, and the manufacturing-package contents. AI helps with docs, code, suggestions, explanations — but never produces the deliverable artifacts that go to a fab.

2. **Real blocks all the way down.** Every block in the library traces to materials + geometry + interfaces + behaviors. A resistor isn't a magic icon; it's a resistive material in a specific shape with two terminals adopting Ohm + Joule + heating behaviors. The user can use it as a single block, or descend into the definition.

3. **Free and open-source, no paid tier ever.** MIT-licensed, permissive dependencies only, BYOK AI (no inference fees passed through to users), all toolchain components either bundled or open-source. A No-AI mode is required so the app works fully without any model.

## Previous direction (audio-synth chip designer)

The original ChipBlocks (v0.1.0-alpha.x) was a visual chip-design tool focused on audio synthesis. It shipped 48 blocks, 22 example graphs, and 4 silicon targets (3 iCE40 FPGA boards + Tiny Tapeout submission).

**That work is preserved with full integrity.** It is not deleted; it has been formally handed off:

- **Branch:** `legacy/audio-synth-direction` — a snapshot of the v0.1.0-alpha.9 state. Clone the repo and `git checkout legacy/audio-synth-direction` to get the audio-synth tool intact.
- **Tag:** `v0.1.0-alpha.9-final` marks the formal handoff point.
- **GitHub Releases:** every alpha.x installer remains downloadable.

The reset changes the active product direction. It does not change the value of the old work. The legacy direction may later be extracted into a separate `chipblocks-audio` repository and continued independently.

## Repo layout (post-reset, minimal)

```
chipblocks/
├── README.md            this file
├── CLAUDE.md            project brief for Claude Code; the development companion
├── PRD.md               product requirements (revised for the ground-up direction)
├── ROADMAP.md           sprint plan
├── RESET-PLAN.md        full reset history + Sprint 1-6 detailed plan
├── FINAL-STATE-VISION.md  what the final ChipBlocks looks like
├── LICENSE              MIT
├── CLA.md               contributor license agreement (kept from v1 for back-compat)
└── frontend/            Electron + React + TypeScript shell
    ├── package.json
    ├── electron/        main + preload
    ├── src/             React renderer (empty shell today)
    ├── index.html       Vite entry
    ├── tsconfig.json
    ├── vite.config.ts
    └── electron-builder.json
```

Backend (Python + Amaranth for chip-side later) and example designs will be added as the appropriate sprint reaches them.

## Building / running (when the shell is up)

```bash
cd frontend
npm install
npm run dev        # launches Electron with Vite dev server hot-reload
```

The shell launches with an "initializing" message. No real functionality lands until later sprints — see ROADMAP.md.

## Contributing

The project is in active restart. Issues and discussions are welcome. PRs are best deferred until Sprint 1 (the reset itself) is closed and the first manifests + canvas are in place.

## License

[MIT](LICENSE). Every dependency must be permissively licensed (MIT, Apache 2.0, BSD, ISC, CC0). No GPL or AGPL in the shipped product.
