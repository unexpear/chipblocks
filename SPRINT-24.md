# Sprint Plan: Sprint 24 — Audio-modulation block family + sub-Hz LFO + hard sync

> **Solo dev + Claude Code** · Opened 2026-05-12 (same-day rollover from Sprint 23). **In flight** as of 2026-05-12. Successor to [SPRINT-23.md](SPRINT-23.md). 11 sub-sprints landed across 11 commits + 1 example uncommitted (sync-lead.json). Block library 43 → 48 (5 new blocks); bundled examples 18 → 21 + 1 uncommitted.

**Status:** **In flight, retro pending.** Strategic pivot mid-sprint to the phone-class roadmap — see the "Mid-sprint pivot" section below. The S24-1..S24-11 block + example work continues to land; the close-out retro will document both the work and the strategic direction shift.

**Sprint Goal:** *Expand the audio-modulation block family — the canonical analog-synth primitives that make the example library richer (VCO, LFO, AudioSum, VCF), plus the polish items that fall out (sub-Hz LFO, hard-sync oscillator). Each block individually small; collectively they unlock vibrato, tremolo, drone sweeps, hard-sync leads, and proper Karplus-Strong decay.*

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | rolling sub-sprints rather than fixed 2-week window | n/a — flexes with user direction |
| Stack | unchanged from S23 | n/a |
| Block count | 43 → 48 (+5: VCO, LFO, AudioSum, VCF, HardSync) | n/a |
| New deps | none | n/a |
| Release tag | none (alpha.9 stays current) | n/a — close-out may bump to alpha.10 |

---

## Sprint Log

**2026-05-12** — Sprint opens immediately after Sprint 23 closes.

- **S24-1 ✅** Commit `b0f97fe`. **VCO** block added — voltage-controlled oscillator (square wave, audio-rate FM input). 32-bit phase accumulator with per-sample step modulation: `freq = base_freq + (freq_in × range / 128)`. Unlocks vibrato via slow-LFO → VCO.freq-in, pitch bend, audio-rate FM as an alternative to the dedicated `fm` block. Block count 43 → 44.

- **S24-2 ✅** Commit `7cbaf23`. **Vibrato example** added — slow LFO sine (5 Hz) → VCO.freq-in (range=10) → Output. Canonical singing-pitch wobble. First example demonstrating the new VCO block. Bundled examples 18 → 19.

- **S24-3 ✅** Commit `7663327`. **LFO** block added — low-frequency oscillator (1-30 Hz at first ship; widened to 0.001-30 Hz in S24-10). 32-bit phase accumulator wider than the audio oscillators' 16-bit; per-step resolution musical down to ~0.01 Hz. Four shapes (sine / triangle / square / sawtooth). Output is audio-s8 so it composes with everything. Block count 44 → 45.

- **S24-4 ✅** Commit `471414c`. **Revised vibrato + Atari Punk Console examples** to use the LFO block instead of fudging slow modulation via wavetable-at-low-freq tricks. Two bundled-example file rewrites; no new blocks. Bundled examples count unchanged.

- **S24-5 ✅** Commit `2f819a5`. **Audio Sum** block added — saturating sum (no averaging). Closes the Karplus-Strong decay artefact flagged in S23-4: a feedback loop with Mixer averages by ½ per cycle (~60 ms decay = click); AudioSum + a constant-126 feedback multiply gives ~0.977 per cycle = canonical ~500 ms ringing decay. Block count 45 → 46.

- **S24-6 + S24-7 ✅** Commit `52de331`. Two examples in one commit: **Karplus-Strong revised** to use AudioSum in the feedback loop (now sounds canonical), and **divider clock tree** added — the textbook 74HC4040 binary-ripple-counter topology, deferred from Sprint 23 because it needed AudioSum first. Bundled examples 19 → 20.

- **S24-8 ✅** Commit `22d70b3`. **VCF** block added — voltage-controlled low-pass filter. Same 1-pole IIR shape as the static `lowpass`, but cutoff modulated by an audio-rate input via a precomputed 256-entry lookup table mapping every possible cutoff_in value to its filter coefficient. The filter half of the Sprint 24 audio-modulation family (VCO controls pitch, VCF controls cutoff). Block count 46 → 47.

- **S24-9 ✅** Commit `d069697`. **Filter sweep example** added — LFO (sine, 1 Hz) → VCF.cutoff-in; sawtooth → VCF.audio-in. The canonical drone-music "wow" sound. First example demonstrating the new VCF. Bundled examples 20 → 21.

- **S24-10 ✅** Commit `06474e6`. **LFO extended with sub-1-Hz support** via a `rate_millihz` field (0-999 mHz added on top of the integer `rate` Hz). New range 0.001-30 Hz; at the minimum non-zero setting (1 mHz) one cycle takes 1000 seconds. Closes the long-standing 1-Hz floor — the LFO comment block already advertised "0.5 Hz drone-music filter sweeps" as a use case but the integer parameter prevented it. Existing 19 example graphs using the LFO stay byte-identical because `rate_millihz` defaults to 0.

- **S24-11 ✅** Commit `d4d3da9`. **HardSync** block added — slave sawtooth whose phase resets on rising zero-crossings of a `sync-in` master signal. Classic analog-synth "hard sync" trick: master at 440 Hz square + HardSync at 660 Hz produces the harmonically-rich "sync lead" sound used in 1980s prog-rock / synthwave records (Van Halen *Jump*, The Cars *Let's Go*). Block count 47 → 48.

- **S24-12 sync-lead example** — written to disk at `examples/sync-lead.json`, uncommitted. Bundled examples would jump 21 → 22 on commit. Demo-grade graph showing the canonical 440 Hz square master → HardSync (660 Hz) → Output chain. The file synth-pipelines cleanly; the commit is queued behind the strategic pivot below.

**Block count:** 43 → 48 (+5: VCO, LFO, AudioSum, VCF, HardSync).
**Bundled examples:** 18 → 21 in-tree, +1 uncommitted = 22 if shipped.
**Tests:** vitest 314 → 321 (+7: HardSync rendering + manifest-integrity); pytest 205+2 → 217+2 skipped (+12 across the dynamic manifest collection + new behavioral tests for the 5 new blocks).
**Working tree as of pivot:** clean on origin/master = `d4d3da9`, plus `examples/sync-lead.json` untracked.

---

## Mid-sprint pivot — phone-class roadmap + modular fab platform direction

After S24-11 the user re-framed the project's north star: ChipBlocks should be able to design a phone-shaped device, and the fab target the app emits to should be a **modular in-house platform** — not just "Tiny Tapeout slot" forever. Two new principles fell out and have to be captured in the docs before any more work lands.

### Principle 1: No fake blocks

Every block in `blocks.yaml` must elaborate to real synthesizable Amaranth HDL. No black-box placeholders, no `pass` Elaboratables, no "icon on the canvas with no implementation." If something can't be fabricated, it isn't a block — it's either a chip pad (external device connection point) or it doesn't exist yet. The "Black box system diagram" approach explored mid-sprint was rejected for being precisely the kind of fakery this principle is named against.

Consequences:
- External physical devices (display panels, speakers, antennas, batteries) are **chip pads / terminals**, not blocks. We make controllers/drivers that live on our silicon, not the external thing itself.
- "Display block" → no. "ST7789 LCD driver block" → yes (a real SPI state machine).
- "Speaker block" → no. "PWM audio out + class-D driver block" → yes.
- "Battery block" → no, it's a power pin on the package.
- "Modem block" → no black-box; we pick a real modulation (OOK, audio-FSK, LoRa-style CSS) and ship a synthesizable digital part.

### Principle 2: Modular fab platform (ADR-005, draft pending)

ADR-003 made block-addition a 3-file job by putting cross-cutting metadata in `blocks.yaml` + 2 codegen scripts. Apply that same pattern to the **fab target** itself. Eight extension points, each manifest-driven, each codegen-validated, each addable without touching unrelated code:

| Manifest | Domain | Adding new = |
|---|---|---|
| `shuttles.yaml` | Fab targets (Pico / Mini / Standard / Macro) | 1 row + a flow adapter |
| `pdks.yaml` | Process node + cell library (sky130A, gf180mcuB, ihp-sg13g2, future open PDKs) | 1 row + OpenLane/LibreLane config |
| `cpu-cores.yaml` | Packaged CPU cores (picorv32, VexRiscv, NeoRV32, 6502, in-house) | 1 row + a wrapper conforming to the CPU socket interface |
| `radios.yaml` | Radio modulation schemes (OOK, audio-FSK, BPSK, LoRa-CSS, future) | 1 row + an Amaranth modulator block conforming to the Radio socket |
| `buses.yaml` | On-chip bus protocols (Wishbone, AXI-lite, APB, custom minimal) | 1 row + master/slave adapter blocks |
| `memories.yaml` | Memory backends (BRAM, SRAM macro, register file, ext SPI flash, ext SPI DRAM) | 1 row + controller block + memory-socket wrapper |
| `packages.yaml` | Physical packaging (DIP-40, QFN-32, BGA, bare die, Caravel wrapper) | 1 row + pin-map config |
| `flows.yaml` | Build flow toolchains (OpenLane, LibreLane, Edalize, Yosys-only, custom) | 1 row + a flow adapter |

The "in-house" framing means **we** own the manifest schemas, the socket contracts, the codegen, and the flow adapters. Third-party tools (eFabless Caravel, OpenLane, SkyWater MPW) are plumbing we call via adapters — they're not in our trust boundary, they're swappable.

### Phone-class target

The target device is a **smartwatch-tier / 2005-feature-phone equivalent**, not a 2026 smartphone. Achievable on iCE40 + a handful of external chips (~$30 in parts). Buildable as a single Standard tile or as a small set of chained Mini tiles. Specs:
- ~320×240 LCD display (driven over SPI from a real ST7789 controller chip)
- Capacitive touch (over I²C from an FT6236 or equivalent)
- PWM audio out via class-D
- A few hardware buttons + a vibration motor
- An in-house CPU (block-primitives composed via blocks.yaml, or a packaged picorv32 via cpu-cores.yaml — both are tier-1 options per ADR-004)
- A few KB of state in BRAM
- A custom radio modem for SMS-class text comms (OOK by default; LoRa-CSS path open)

What's deliberately out of scope: voice calls, broadband data, integrated WiFi/BT, GPS, cameras, ISPs, AMOLED, LPDDR. These are real-phone-scale, not toy-phone-scale.

### Future ADR slots

- **ADR-004 — Packaged CPU representation.** How does ChipBlocks represent a CPU as a single block on the canvas vs. as a graph of primitives? Open question; deferred until first concrete need (likely Sprint 28-ish).
- **ADR-005 — ChipBlocks Shuttle (in-house modular fab platform).** The 8-manifest extension model above. Drafting first; implementation begins with `shuttles.yaml` materialised against the existing `tt-pico` target as a single row, proving the pattern end-to-end before any new shuttle tier ships.

### Updated sprint roadmap (S25 onward)

| Sprint | Theme | New blocks / manifests | Notes |
|---|---|---|---|
| S25 | ADR-005 draft + `shuttles.yaml` materialisation | `shuttles.yaml` with `tt-pico` as row 1 | Validates the modular-fab pattern end-to-end on a target we already have, before any new shuttle tier |
| S26 | Bus protocols | SPI master, I²C master, UART, GPIO, PWM | First wave of synthesizable peripherals |
| S27 | Display + input | ST7789 LCD driver, button matrix scanner, capacitive touch protocol | Smartwatch-class display path |
| S28 | Audio out + haptics | PWM audio out (real silicon), LED driver, vibration motor driver | Output side |
| S29 | ADR-004 packaged CPU + picorv32 + `cpu-cores.yaml` | `cpu-cores.yaml` first row | The big one |
| S30 | System glue | Interrupt controller, timer, reset/clock manager | |
| S31 | Radio | OOK transmitter, audio-FSK modem, optional LoRa-style CSS | Default modem is OOK per the post-S24 pivot |
| S32 | Toy-phone integration | Example graph wiring all of the above into one fab-able design | First Standard-tile design |

7 sprints to a fab-able toy phone. Every block on the list is real silicon — no fakery.

---

## Retrospective (pending — sprint not yet closed)

To be written when S24 closes. Candidate items:
- Audio-modulation family lands cleanly through the manifest workflow — five new blocks in eleven sub-sprints with no surprises.
- Sub-Hz LFO surfaces the parameter-type gap: `blocks.yaml` only supports `int` / `string` / `intArray`, no `float`. Worked around with `rate_millihz`. Probably fine; revisit if a second block needs sub-integer precision.
- HardSync's sign-bit-transition trigger pattern is reusable for any "edge detector" block (rising/falling on data-u8 or audio-s8). Worth extracting if a second block needs it.
- The mid-sprint principle clarification (no fake blocks + modular fab) is exactly the kind of strategic moment the retro is for. The roadmap update is real work, not paperwork.
- `examples/sync-lead.json` is uncommitted on the working tree at retro-write time. Should land in the close-out commit or be explicitly carried into Sprint 25.
