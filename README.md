# ChipBlocks

> Visual chip design for everyone. Drag blocks, wire them together, hear the chip.

**Status:** Early development. Sprints 1 + 2 complete — proof-of-concept pipeline runs end-to-end. Public beta TBD.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What it is

ChipBlocks is a free, open-source desktop app that lets **non-technical people design custom silicon chips** by wiring visual blocks together. Drop an oscillator on the canvas, connect it to a mixer, connect that to an output, press Play — hear the chip you just designed simulate through your speakers.

The first flagship domain is **audio / synth / retro-game chips**. The architecture extends to custom microcontrollers, sensor pre-processors, and other digital chip categories in later sprints.

## How it works today

```
 ┌─────────────────────┐    ┌────────────────┐    ┌────────────────────┐    ┌────────────────┐
 │ Visual node-graph   │ →  │  Translator    │ →  │ Amaranth simulator │ →  │ Playable WAV   │
 │  (React Flow)       │    │  (Python)      │    │  (pip install)     │    │  (stdlib wave) │
 └─────────────────────┘    └────────────────┘    └────────────────────┘    └────────────────┘
```

The graph you build in the UI is parsed, blocks are instantiated from a Python registry, edges are wired as combinational connections, and the design is run in Amaranth's simulator. Output is a 16-bit mono WAV at 44.1 kHz that plays through your speakers — no FPGA, no fab needed for the v1 demo loop.

## Roadmap

- ✅ **Sprint 1** — Foundations: Electron + React + TypeScript desktop shell, React Flow node-graph editor, LiteX-driven simulation producing a playable WAV.
- ✅ **Sprint 2** — Integration: Electron ↔ WSL2 ↔ Python IPC bridge, real graph → Amaranth translator, end-to-end Play button. ([retrospective](SPRINT-2.md))
- ⏭️ **Sprint 3** — AI consultant integration, broader block library (triangle, saw, ADSR, filter), block-parameter editing, project save/load.
- 📋 **Future** — FPGA bitstream output, ASIC tape-out package generation (Tiny Tapeout / OpenLane / LibreLane), and eventually a full general-purpose PCB / motherboard design tool.

See [PRD.md](PRD.md) for the full vision.

## Quick start (developer)

Requirements: **Node 20+** on the Windows side, **WSL2 Ubuntu** with **Python 3.12+** for the backend. The frontend is an Electron app; the backend is a Python pipeline that runs inside WSL2 and is invoked over IPC.

```bash
# One-time backend setup (in WSL2):
cd backend
bash setup.sh

# Frontend (Windows side):
cd frontend
npm install
npm run dev
```

Press the **▶ Play** button in the running app to hear the default Oscillator → Mixer → Output graph render to audio.

## Project documents

| Document | What's in it |
|---|---|
| [PRD.md](PRD.md) | Full product vision, goals, non-goals, target users, requirements, success metrics |
| [SPRINT-1.md](SPRINT-1.md) | Sprint 1 plan + log + retrospective (closed) |
| [SPRINT-2.md](SPRINT-2.md) | Sprint 2 plan + log + retrospective (closed) |
| [CLAUDE.md](CLAUDE.md) | Project brief for AI dev tools — vision, tech stack, conventions |
| [CREDITS.md](CREDITS.md) | Open-source attributions and licensing policy |
| [LICENSE](LICENSE) | MIT |
| [CLA.md](CLA.md) | Contributor License Agreement |

## License

MIT. See [LICENSE](LICENSE) for details. ChipBlocks ships only permissively-licensed code (MIT / Apache 2.0 / BSD / ISC / PSF). Copyleft tools (GPL, AGPL, LGPL, MPL, EUPL) are never bundled — see [CREDITS.md](CREDITS.md) for the full policy.

## Contributing

Outside contributions are welcome. Please:

1. Read [CLA.md](CLA.md) before submitting a pull request
2. Sign your commits with `git commit -s` (this signifies your agreement to the CLA)
3. Open an issue first to discuss anything beyond a typo fix or small bug

This is a solo-developer project at a "fine taking time" pace. Issue triage and PR review may take a few days.

---

**Built with [Claude Code](https://claude.com/claude-code) by a non-technical solo developer.** The whole point of the project is to make custom chip design accessible to people like that — eat your own dog food.
