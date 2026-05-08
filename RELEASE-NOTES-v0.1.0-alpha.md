# ChipBlocks v0.1.0-alpha

ChipBlocks is a free, open-source desktop app that lets non-technical people design custom chips by wiring visual blocks — drag an oscillator, connect it to a mixer and an output, hear it through your speakers, then build a real iCE40 FPGA bitstream for a $30 dev board. This first alpha is for hobbyist synth builders, FPGA tinkerers, and anyone curious about silicon who doesn't want to learn Verilog first.

## What's in the alpha

- Visual node-graph editor with drag-from-palette, port-directional wiring, per-block parameter editors.
- 11 audio blocks: Oscillator (square / triangle / saw), Mixer, ADSR Envelope, Gate, Low-Pass Filter, Sample-and-Hold, Output, Noise, Constant.
- AI consultant in a chat sidebar — BYOK Anthropic. Reads the canvas, suggests blocks, can add or wire blocks for you with a preview-and-confirm step before destructive edits.
- ▶ Play: simulates the design via Amaranth, produces a 16-bit 44.1 kHz WAV that the app plays.
- 🔧 Build for FPGA: runs the graph through Yosys, nextpnr-ice40, and icepack into a flashable `.bin` for the Lattice iCEstick.
- Project save / load (versioned JSON), Examples menu, Help → About, and a default starter graph on first launch so the canvas is never empty.

## Install

1. Download `ChipBlocks_0.1.0.exe` from the release assets below.
2. Double-click and click through the installer.
3. Launch ChipBlocks from the Start Menu.

Windows will warn "Windows protected your PC". Click "More info" → "Run anyway". The installer is unsigned because we don't have a code-signing certificate yet — see [KNOWN-ISSUES.md](KNOWN-ISSUES.md) for context.

## Backend setup

▶ Play and 🔧 Build for FPGA run a Python backend in WSL2. Setup is in [backend/README.md](backend/README.md). For the FPGA path you'll also need the [YosysHQ OSS CAD Suite](https://github.com/YosysHQ/oss-cad-suite-build/releases) at `~/oss-cad-suite/` in WSL2 (~2.4 GB; kept external since most users only want the simulator).

## Not in this release

- No polyphony, no MIDI, no reverb / delay / wavetable / FM blocks.
- Windows only — no Mac or Linux installers.
- No code-signed binaries (hence the SmartScreen warning).
- No auto-update.

## Coming next

Full plan in [ROADMAP.md](ROADMAP.md). Highest-leverage Next items: MIDI + polyphony, Mac/Linux installer builds via cross-platform CI, more DSP blocks (wavetable, FM, delay).

## Help and discussion

[GitHub Discussions](https://github.com/unexpear/chipblocks/discussions) for questions, bug reports, or sharing what you build.

## License and credits

MIT. Ships only permissively-licensed code. Full attributions and policy in [CREDITS.md](CREDITS.md).
