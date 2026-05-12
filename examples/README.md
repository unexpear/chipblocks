# Example graphs

Drop these files onto **Load → Examples** in the ChipBlocks toolbar to try them (or use the toolbar menu directly — every file in this directory mirrors an entry in `frontend/src/examples.ts`). All examples use the v1 ChipBlocks save format (`{ version, app, savedAt, viewport, nodes, edges }`) and are regular JSON — open in any text editor to inspect.

## How to read this index

The table is grouped by what each example demonstrates. Each row links to the `.json` file and (where applicable) cites the historical chip or synthesis technique it's based on. Provenance + licensing for the historical designs lives in [../OPEN-CHIP-LIBRARY-PROVENANCE.md](../OPEN-CHIP-LIBRARY-PROVENANCE.md); attribution lines for those examples appear in [../CREDITS.md](../CREDITS.md).

## Audio demos (basic synthesis)

| File | What you'll hear | Demonstrates |
|---|---|---|
| [`two-osc-mix.json`](two-osc-mix.json) | A 440 Hz square + 660 Hz sawtooth averaged through a mixer — bright, slightly dissonant chiptune chord. | Oscillator + Sawtooth + Mixer + Output (the simplest 4-block composition) |
| [`adsr-pulse.json`](adsr-pulse.json) | A 440 Hz tone pulsing 4 times per second, shaped by an ADSR envelope (20 ms attack, 80 ms decay, sustain at 80, 150 ms release). | Gate + ADSR composition — the building block of every drum / pluck / lead patch |
| [`bass-lead.json`](bass-lead.json) | A 110 Hz sawtooth low-pass filtered then gated — punchy bass line. | Sawtooth + Low-pass + Gate + ADSR — classic subtractive bass-synth chain |
| [`lofi-pad.json`](lofi-pad.json) | Two triangles a major-third apart (220 + 277 Hz), mixed and softly low-passed — sustained drone. | Mixer + Low-pass — multi-voice composition without a polyphony block |
| [`arpeggio.json`](arpeggio.json) | A slow 4 Hz sawtooth sampled by an 8 Hz clock — sample-and-hold turns the ramp into a quantized note sequence. | Sample-and-Hold + Gate — the classic stair-stepped arpeggiator |
| [`vibrato.json`](vibrato.json) | A 440 Hz square wave whose pitch wobbles ±15 Hz at a 20 Hz rate. | Sine LFO + VCO — demonstrates the Sprint 24 VCO block's audio-rate frequency modulation |

## Audio demos (percussion)

| File | What you'll hear | Demonstrates |
|---|---|---|
| [`kick-drum.json`](kick-drum.json) | A 60 Hz sine pulsed by a fast-decay envelope — short low-frequency thump. | Sine + ADSR with `decay_ms=80, sustain=0` — the canonical kick pattern |
| [`snare-drum.json`](snare-drum.json) | A noise burst gated by a fast-decay envelope — classic snare crack. | Noise + ADSR — same shape as the kick, different source |

## Audio demos (effects)

| File | What you'll hear | Demonstrates |
|---|---|---|
| [`echo.json`](echo.json) | Direct signal + a delayed copy mixed at half-amplitude. | Delay + Multiply (by 64) + Mixer composition — effects-routing pattern |
| [`lofi-crunch.json`](lofi-crunch.json) | A 220 Hz sawtooth bit-crushed to 3 effective bits, then softened with a 2 kHz low-pass — gritty retro tone. | Bitcrusher + Low-pass — the lo-fi 8-bit aesthetic in two blocks |

## Visual demos (VGA on iCEBreaker)

Visual examples need a 🔧 Build → iCEBreaker + flashing to the board to see anything — ▶ Play renders audio only. Plug a $8 VGA-PMOD into PMOD1B, connect a monitor.

| File | What you'll see | Demonstrates |
|---|---|---|
| [`color-bars.json`](color-bars.json) | 8 SMPTE color bars across the screen — the canonical first-visual-chip demo. | VGA Timing + Color Bars + VGA Output (the visual chain) |
| [`vga-stripe.json`](vga-stripe.json) | A vertical white stripe between x=100 and x=200 on a black background. | VGA Timing + Pixel Range + VGA Output — windowed comparator on a coordinate |

## CPU demos (data-path primitives)

| File | What you'll hear | Demonstrates |
|---|---|---|
| [`cpu-accumulator.json`](cpu-accumulator.json) | A running Fibonacci sum audible as rhythmic crackle through Reinterpret. | Counter → ROM → Adder → Register loop + parallel RAM logger — full CPU data-path |
| [`cpu-counter-with-branch.json`](cpu-counter-with-branch.json) | A counter that resets at 7 every cycle — audible as a saw-shaped buzz. | Comparator + Mux for branching without a state machine. Refactored in Sprint 20 to use ByteConstants instead of 3 single-value ROMs (4 fewer blocks; same behavior) |
| [`cpu-multiregister.json`](cpu-multiregister.json) | A 4-step ramp followed by 12 zero cells at ~12 Hz — the Register File's read sweep over a sparsely-written file. | Sprint 20 Register File with independent read / write addresses. Compare to `cpu-accumulator` (RAM with one shared address port) — same shape, different IP model |

## Historical chip designs

These reproduce well-known circuit topologies and synthesis algorithms from the open literature. Provenance + licensing diligence lives in [../OPEN-CHIP-LIBRARY-PROVENANCE.md](../OPEN-CHIP-LIBRARY-PROVENANCE.md); attribution lines for the historical material live in [../CREDITS.md](../CREDITS.md).

| File | What you'll hear / see | Historical source |
|---|---|---|
| [`atari-punk-console.json`](atari-punk-console.json) | A rhythmic burbling tone from two interacting square-wave oscillators — the canonical DIY-synth-101 sound. | Forrest M. Mims III, *Engineer's Notebook: Integrated Circuit Applications* (Radio Shack, 1980). 555-timer topology; underlying 555 patent expired 1988. |
| [`fm-bell.json`](fm-bell.json) | A 1980s bell / electric-piano tone with a long ringing decay — the sound of the FM-synth era. | Chowning, *Journal of the Audio Engineering Society* Vol. 21 No. 7 (1973). US patent 4,018,121 (Stanford) expired April 1994. |
| [`hihat.json`](hihat.json) | A short hi-hat tick — completes the kick + snare + hat drum trilogy. | Standard analog-modular subtractive-synthesis (filtered noise + fast envelope), predating consumer electronics. |
| [`karplus-strong.json`](karplus-strong.json) | A 110 Hz plucked-string-like pluck (short percussive decay — see note below). | Karplus & Strong, *Computer Music Journal* Vol. 7 No. 2 (1983). US patents 4,649,783 + 4,622,877 (Stanford) expired 2004 / 2005. |

> **Karplus-Strong note:** the bundled implementation produces a short percussive pluck (~60 ms decay) rather than the canonical ringing-string sound. Our `mixer` block averages two inputs ((a+b)/2), which halves the feedback-loop amplitude each cycle. A future "audio summer without averaging" block (Sprint 24+ candidate) would unlock the full ringing-string variant. The algorithm topology (noise burst → feedback delay loop + one-pole damping filter) is faithful to the 1983 paper.

### Deferred starter design

| File | What it would do | Why deferred |
|---|---|---|
| `divider-clock-tree.json` | A descending cascade of slower-and-slower clock ticks audible as a polyrhythmic drum line. | The textbook recipe wants to peel off individual bits of a free-running counter and visualize them as independent square waves at half-rate, quarter-rate, etc. Our current blocks can't connect `counter.addr-out` (an `addr-u4` 4-bit bus) into `bussplit.bus-in` (which expects `data-u8`), and there's no `audio-to-gate` block to feed audio-rate oscillator pulses into `counter.clock`. Either widening `bussplit` to accept addr-u4 OR adding a 1-bit-comparator block unblocks this. Logged as a Sprint 24+ candidate. |

## Adding your own examples

Press **Save graph** in the running app to download the current canvas as a JSON file. Drop it back via **Load graph** any time. Save files are forward-compatible — newer versions of ChipBlocks should still load older saves, with the load dialog warning you if a save was made by a newer version.

**Contributing an example to this directory?** See *"Contributing a bundled example"* in [../BLOCKS-COOKBOOK.md](../BLOCKS-COOKBOOK.md) — it covers what licenses are acceptable for historical-design provenance, where to add attribution, and the pre-shipping checklist. The short version: if your example is based on a specific published circuit or algorithm, the underlying material must be permissively licensed (MIT / Apache 2.0 / BSD / ISC / CC0), patent-expired, or generic textbook material with no specific authorship to credit.

## Schema reference

Every example file conforms to:

```json
{
  "version": 1,
  "app": "ChipBlocks",
  "savedAt": "ISO 8601 timestamp",
  "viewport": { "x": number, "y": number, "zoom": number },
  "nodes": [ { "id": string, "type": <block-type>, "position": {"x": number, "y": number}, "data": {...} }, ... ],
  "edges": [ { "id": string, "source": <node-id>, "target": <node-id>, "sourceHandle": <port-id>, "targetHandle": <port-id> }, ... ]
}
```

Block types come from [`blocks.yaml`](../blocks.yaml). Port handle ids are documented in [BLOCKS.md](../BLOCKS.md) per-block.
