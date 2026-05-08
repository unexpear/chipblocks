# ChipBlocks

> Visual chip design for everyone. Drag blocks, wire them together, hear the chip — then build a real FPGA bitstream.

**Status:** v0.1.0-alpha. Visual editor, AI consultant, simulated audio output, and iCE40 FPGA bitstream output all working end-to-end. Public alpha.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What it is

ChipBlocks is a free, open-source desktop app that lets **non-technical people design custom silicon chips** by wiring visual blocks together. Drop an oscillator on the canvas, connect it to a mixer, connect that to an output, press Play — hear the chip you just designed simulate through your speakers. Click 🔧 Build for FPGA — get back a real iCE40 bitstream you can flash to a $30 dev board.

The first flagship domain is **audio / synth / retro-game chips**. The architecture extends to custom microcontrollers, sensor pre-processors, PCBs, motherboards, and other digital chip categories in later phases.

## What it does today

```
 ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
 │ Visual editor    │ →  │ Block library    │ →  │ ▶ Play           │
 │ (React Flow)     │    │ (Amaranth HDL)   │ →  │ 🔧 Build for FPGA│
 └──────────────────┘    └──────────────────┘    └──────────────────┘
                                                          ↓
                                                 ┌──────────────────┐
                                                 │ .wav (sim audio) │
                                                 │ + .bin (iCE40)   │
                                                 └──────────────────┘
```

- **Block library**: oscillator (square / triangle / saw), mixer, ADSR envelope, gate, low-pass filter, sample-and-hold, output. Drag from the side palette onto the canvas.
- **Visual wiring**: edges enforce port directionality. Nodes have parameter editors (frequency, cutoff, attack/decay/sustain/release, etc.).
- **▶ Play**: Python backend simulates the design in [Amaranth](https://github.com/amaranth-lang/amaranth), produces a 16-bit WAV at 44.1 kHz, and the app plays it.
- **🔧 Build for FPGA**: same backend translates the graph to Verilog, runs it through Yosys → nextpnr-ice40 → icepack, and hands you a zip with a flashable `.bin` for the Lattice iCEstick (~$30). Wire one resistor + one cap + a speaker and your chip is on real silicon.
- **AI consultant** (BYOK): bring an Anthropic API key and chat with Claude about the design. The consultant can read the canvas, suggest blocks, even add or wire blocks for you (with a preview-and-confirm step before destructive edits).
- **Save / load**: graphs are versioned JSON. The repo includes example graphs you can open from `examples/`.

## Quick start (end user)

> *The unsigned alpha will trigger a Windows SmartScreen warning the first time you run it: click "More info → Run anyway."*

1. Download the latest installer from [Releases](https://github.com/unexpear/chipblocks/releases).
2. Double-click `ChipBlocks_0.1.0.exe` and click through the installer.
3. Launch ChipBlocks from the Start Menu.
4. **For ▶ Play (audio simulation)**: install [WSL2 Ubuntu](https://learn.microsoft.com/en-us/windows/wsl/install) + Python 3.12 + the backend deps. Run `bash backend/setup.sh` from a WSL2 terminal one time. (Backend setup details: [backend/README.md](backend/README.md).)
5. **For 🔧 Build for FPGA (real silicon bitstream)**: also install the [YosysHQ OSS CAD Suite](https://github.com/YosysHQ/oss-cad-suite-build/releases) at `~/oss-cad-suite/` in WSL2.

The installer ships the GUI and the backend Python scripts. WSL2 + the OSS CAD Suite are external because they're large (the toolchain is ~2.4 GB) and many users only want the simulator.

## Quick start (developer)

Requirements: **Node 20+** on Windows, **WSL2 Ubuntu** with **Python 3.12+** for the backend.

```bash
# One-time backend setup (in WSL2):
cd backend && bash setup.sh

# Frontend (Windows side):
cd frontend
npm install
npm run dev      # Hot-reload Electron dev mode
npm run build    # Build the Windows installer (release/0.1.0/ChipBlocks_0.1.0.exe)
```

Click **▶ Play** in the running app to hear the default Oscillator → Mixer → Output graph render to audio. Click **🔧 Build for FPGA** to get an iCE40 bitstream zip.

## Roadmap

- ✅ **Sprint 1** — Foundations: Electron + React + TypeScript, React Flow node-graph editor, Migen-driven simulation producing a playable WAV.
- ✅ **Sprint 2** — Integration: Electron ↔ WSL2 ↔ Python IPC, real graph → Amaranth translator, end-to-end Play button. ([retro](SPRINT-2.md))
- ✅ **Sprint 3** — Block library expansion (triangle, saw, ADSR, filter), block-parameter editing, project save/load, AI consultant chat sidebar (BYOK Anthropic). ([retro](SPRINT-3.md))
- ✅ **Sprint 4** — Block palette + drag-to-canvas, low-pass filter, sample-and-hold, AI tool-calling so the consultant can edit the canvas, model picker. ([retro](SPRINT-4.md))
- ✅ **Sprint 5** — Multi-step agentic AI loop, smarter node placement, preview-and-apply for destructive AI tool calls. ([retro](SPRINT-5.md))
- ✅ **Sprint 6** — FPGA bitstream output: graph → Verilog → Yosys → nextpnr-ice40 → icepack → `.bin` for Lattice iCEstick. ([retro](SPRINT-6.md))
- ✅ **Sprint 7** — First public alpha: dependency upgrades, packaged Windows installer, this README, [v0.1.0-alpha](https://github.com/unexpear/chipblocks/releases) tagged. ([retro](SPRINT-7.md))
- 📋 **Future** — Tiny Tapeout submission package (real ASIC silicon), Mac/Linux installers, signed binaries, more DSP blocks, PCBs, motherboards.

See [PRD.md](PRD.md) for the full vision.

## Project documents

| Document | What's in it |
|---|---|
| [PRD.md](PRD.md) | Full product vision, goals, non-goals, target users, requirements, success metrics |
| [SPRINT-1.md](SPRINT-1.md) … [SPRINT-7.md](SPRINT-7.md) | Per-sprint plan + log + retrospective |
| [CLAUDE.md](CLAUDE.md) | Project brief for AI dev tools — vision, tech stack, conventions |
| [CREDITS.md](CREDITS.md) | Open-source attributions and licensing policy |
| [KNOWN-ISSUES.md](KNOWN-ISSUES.md) | Tracked deferred issues |
| [LICENSE](LICENSE) | MIT |
| [CLA.md](CLA.md) | Contributor License Agreement |

## License

MIT. See [LICENSE](LICENSE) for details. ChipBlocks ships only permissively-licensed code (MIT / Apache 2.0 / BSD / ISC / PSF). Copyleft tools (GPL, AGPL, LGPL, MPL, EUPL) are never bundled — see [CREDITS.md](CREDITS.md) for the full policy and the explicit list of GPL/EUPL tools we considered and dropped.

## Contributing

Outside contributions are welcome. Please:

1. Read [CLA.md](CLA.md) before submitting a pull request.
2. Sign your commits with `git commit -s` (signifies your CLA agreement).
3. Open an issue first for anything beyond a typo fix or small bug.

This is a solo-developer project at a "fine taking time" pace. Issue triage and PR review may take a few days.

---

**Built with [Claude Code](https://claude.com/claude-code) by a non-technical solo developer.** The whole point of the project is to make custom chip design accessible to people like that — eat your own dog food.
