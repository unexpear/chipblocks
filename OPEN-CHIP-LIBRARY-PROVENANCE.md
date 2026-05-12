# Open Chip Library — Provenance & Legal Status

> Date: 2026-05-12 · Companion to `OPEN-CHIP-LIBRARY-RESEARCH.md`. This document confirms the citation chain and shipping-license posture for the 5 starter chip designs that will ship as bundled `examples/*.json` graphs in ChipBlocks (MIT-licensed product).
>
> Scope: per-design provenance (where the idea was first published), legal status (who owns what, what's expired, what's permissive), the technical recipe in ChipBlocks's block vocabulary, and implementation-time estimate.
>
> Headline verdict: **All 5 are safe to ship.** Two require an attribution line in `CREDITS.md` (Karplus-Strong and Mims); two are basic textbook material (divider tree, hi-hat); one is a well-documented patent-expired technique (Chowning FM). One surprise: the basic Karplus-Strong algorithm *was* patented (US 4,649,783, 1987) but expired March 17, 2004 — earlier research called it "never patented," which is incorrect. The conclusion is the same (free to use today), but the citation chain must say "patent expired" rather than "never patented."

---

## 1. Atari Punk Console (Stepped Tone Generator)

### Provenance

- **Original publication:** Forrest M. Mims III, *Engineer's Notebook: Integrated Circuit Applications*, Radio Shack, **1980**. Re-issued as part of *Engineer's Mini-Notebook: 555 Timer IC Circuits* (Radio Shack, 1984). Mims titled the circuit "Sound Synthesizer" in the 1980 edition and "Stepped-Tone Generator" in the 1984 555-Timer mini-notebook.
- **Verification sources:**
  - Wikipedia, "Atari Punk Console" — confirms Mims authorship, 1980/1984 publication, "Kaustic Machines" coined the alias: https://en.wikipedia.org/wiki/Atari_Punk_Console
  - Internet Archive scan of the 555-Timer mini-notebook (uploaded by Folkscanomy community): https://archive.org/details/electronics_-_Forrest_Mims-engineers_mini-notebook_555_timer_circuits_radio_sha
  - Wikipedia, "Forrest Mims" — confirms Mims wrote 36 books for Radio Shack between 1972 and 2003: https://en.wikipedia.org/wiki/Forrest_Mims
- **Confidence: HIGH** — Mims's authorship is universally credited; the circuit is one of the most-built DIY synth circuits of the past 45 years; multiple independent secondary sources corroborate the 1980/1984 dates.

### Legal status

- **Status:** *We are reproducing the circuit topology, not Mims's schematic drawing.* Under US copyright law, **circuit topology is not copyrightable** — only the specific drawing is. Confirmed by industry consensus (multiple DIY-electronics forums, Lexology IP analysis): "A schematic drawing can be copyrighted, but the copyright protects the drawing itself from copying or distribution without permission, and provides no protection whatsoever for the circuit depicted therein." Source: https://www.lexology.com/library/detail.aspx?g=ecbb24af-4a0a-4971-9022-2edfeac253eb
- **Patent status:** The 555 timer chip itself (US 3,602,752, Hans Camenzind/Signetics, filed 1971) expired in **1988**. The "two-555s-chained" topology was never patented separately.
- **Attribution requirements:** **Yes, light credit recommended in `CREDITS.md`.** We don't *need* to credit (the topology isn't copyrightable), but it's customary and ethical to acknowledge the originator of an iconic circuit. Suggested credit: "Atari Punk Console (Stepped Tone Generator): topology originally published by Forrest M. Mims III in *Engineer's Notebook: Integrated Circuit Applications* (Radio Shack, 1980)."
- **Caveats:**
  - We must NOT reproduce Mims's hand-drawn schematic (his drawing is © Mims).
  - "Atari Punk Console" is a community nickname, not an Atari trademark. Atari, Inc. holds no rights in this name. Safe to use.
  - "Forrest Mims" is not a trademark.

### Technical recipe (ChipBlocks blocks)

The 555-pair behavior in our digital model:

1. **`oscillator`** (square wave, ~150-300 Hz) — emulates the astable 555 driving the audio rate.
2. **`oscillator`** (square wave, ~5-30 Hz) — emulates the monostable retrigger / pulse-width modulator. In Mims's analog circuit the second 555 is a monostable; in our discrete-time model a slower square-wave gating signal captures the same stepped-tone character.
3. **`multiply`** — combines the two square waves (logical AND of the bipolar signals creates the stepped pulse-density texture).
4. **`output`** — DAC sink.
5. Optional **`lowpass`** at ~3 kHz to soften the click artifacts (Mims's original had no filter; the bare square-wave-of-square-waves is the canonical "punk" sound).

Parameters Mims specified: audio-osc 150 Hz to 5 kHz potentiometer-swept; gating-osc 1 Hz to 30 Hz. Our defaults: 220 Hz audio, 12 Hz gating — sits in the "musical stepped warble" range.

### Implementation notes

- **Estimated authoring time: 20-30 minutes.** Smallest of the 5 starter graphs.
- **Constraints to document:** "Inspired by Forrest Mims's 1980 Stepped Tone Generator. The original is an analog 555-timer circuit; ChipBlocks reproduces the *topology* (two square waves multiplied together) digitally at 44.1 kHz."

---

## 2. Karplus-Strong plucked string

### Provenance

- **Original publication:** Kevin Karplus and Alex Strong, "Digital Synthesis of Plucked-String and Drum Timbres," *Computer Music Journal*, **Vol. 7, No. 2, Summer 1983, pp. 43-55**. MIT Press. DOI: 10.2307/3680062.
- **Verification sources:**
  - Wikipedia, "Karplus-Strong string synthesis" (citation header): https://en.wikipedia.org/wiki/Karplus%E2%80%93Strong_string_synthesis
  - Kevin Karplus's personal Digitar page at UCSC (first-person account from one of the authors): https://users.soe.ucsc.edu/~karplus/digitar.html
  - JSTOR record (paywalled but citation-verifiable): https://www.jstor.org/stable/3680062
  - Author's institutional PDF: https://users.soe.ucsc.edu/~karplus/papers/digitar.pdf
- **Confidence: HIGH** — both authors are alive and have publicly documented their work; the paper is in MIT Press's flagship computer-music journal; the algorithm has 40+ years of independent academic citation.

### Legal status

- **The algorithm WAS patented.** *Important correction to prior research, which stated "no patent was ever filed."* Two relevant Stanford patents:
  1. **US 4,649,783** — "Wavetable-modification instrument and method for generating musical sound," Strong & Karplus, assigned to Stanford. Filed May 24, 1984. Priority date Feb 2, 1983. Granted March 17, 1987. **Anticipated expiration: March 17, 2004 — expired.** Source: https://patents.google.com/patent/US4649783A/en
  2. **US 4,622,877** — "Independently controlled wavetable-modification instrument and method for generating musical sound," Strong alone, assigned to Stanford. Filed June 11, 1985. Granted November 18, 1986. **Anticipated expiration: June 11, 2005 — expired.** Source: https://patents.google.com/patent/US4622877A/en
- **Status today (2026):** Both Stanford patents expired over 20 years ago. The algorithm is now freely usable. Karplus himself acknowledges the patenting on his Digitar page ("The technique was granted US patent number 4,649,783") and confirms Stanford licensed it (first to Mattel Electronics, eventually to Yamaha as part of the Sondius package). No further patents are believed to encumber the basic algorithm.
- **The 1983 CMJ paper itself:** Copyrighted by MIT Press (the journal publisher). We must NOT reproduce paper figures, prose, or pseudocode verbatim. Re-implementing the algorithm from the description is unambiguously legal — copyright protects expression, not the mathematical idea.
- **Attribution requirements:** **Yes — Karplus & Strong must be credited in `CREDITS.md`.** Suggested: "Karplus-Strong plucked-string algorithm — published by Kevin Karplus and Alex Strong, *Computer Music Journal* Vol. 7 No. 2 (1983). US patents 4,649,783 and 4,622,877 (assigned to Stanford) expired March 2004 / June 2005."
- **Caveats:**
  - "Karplus-Strong" is the names of two living authors; standard attribution etiquette applies. No trademark concern.
  - Wikipedia's prose is CC-BY-SA — we can cite Wikipedia URLs but cannot copy substantial Wikipedia prose into ChipBlocks docs.

### Technical recipe (ChipBlocks blocks)

The basic 1983 algorithm — burst of noise into a feedback delay loop with one-pole averaging filter:

1. **`noise`** — initial burst (random-init of the delay line). ChipBlocks's noise block uses a 16-bit Galois LFSR, which matches the spirit of the paper's white-noise excitation.
2. **`gate`** (very short, low duty) — pluck trigger; turns the noise burst on for ~1 sample period at the start of each note.
3. **`delay`** — the loop's storage element. Delay length L sets the pitch: f = fs / L. For 220 Hz at 44.1 kHz, L = 200 samples. (Our default `delay` max is 1024 samples = 23 ms = ~43 Hz pitch floor.)
4. **`lowpass`** — the "averaging two adjacent samples" filter (the paper's simplest case). Provides the per-cycle damping that makes the string-pluck decay sound natural.
5. **`multiply`** — feedback-gain shrinker (constant < 127, typically ~120/127) to ensure the loop decays rather than self-oscillating.
6. **`mixer`** — sums the new pluck excitation with the recirculating delayed signal.
7. **`output`** — DAC.

Parameter values from the paper for a 220-Hz pluck: L=200 samples, two-tap averaging filter (the famous "shift and add only, no multiplier" property), feedback gain near unity.

### Implementation notes

- **Estimated authoring time: 45-60 minutes** — the feedback loop has the most edges of any starter graph and needs careful gain-staging in the JSON.
- **Constraints to document:** "Pitch range constrained by our 1024-sample max delay → ~43 Hz floor. For lower bass notes, a longer-delay variant would be needed (future block). At 44.1 kHz the algorithm is rich and audibly indistinguishable from a guitar string at higher pitches."

---

## 3. Two-operator FM bell tone

### Provenance

- **Original publication:** John M. Chowning, "The Synthesis of Complex Audio Spectra by Means of Frequency Modulation," *Journal of the Audio Engineering Society*, Vol. 21, No. 7, **September 1973**, pp. 526-534. The patent application followed in 1975.
- **US Patent:** **US 4,018,121** — "Method of synthesizing a musical sound," John M. Chowning, assigned to Leland Stanford Junior University. Filed **May 2, 1975**. Granted **April 19, 1977**. **Anticipated expiration: April 19, 1994 — expired** (the patent record at Google Patents shows "Expired - Lifetime, Anticipated expiration 1994-04-19"). Source: https://patents.google.com/patent/US4018121A/en
- **Verification sources:**
  - US patent record: https://patents.google.com/patent/US4018121A/en
  - Wikipedia "Frequency modulation synthesis" — confirms 1995 industry-wide statement that "digital FM synthesis can now be implemented freely": https://en.wikipedia.org/wiki/Frequency_modulation_synthesis
- **Confidence: HIGH** — the patent record itself is a primary public-domain source; the algorithm is in every audio-DSP textbook.

### Legal status

- **Patent expired April 19, 1994** (the patent record's anticipated expiration date). Industry-wide treatment from 1995 onward has been that FM is freely usable. (Some secondary sources say "1995" colloquially because that was the year the major commercial implications kicked in; the patent expiration itself is the 1994 date in the USPTO record. Conservative phrasing: "expired by 1995.")
- **Status today (2026):** Free to use. The Chowning patent is over 30 years expired.
- **Stanford-Yamaha exclusive license:** Stanford had an exclusive license deal with Yamaha (which paid $22.9 million in royalties over the patent's life, per Wikipedia). That license also lapsed at patent expiration.
- **Patent text itself:** Public domain by USPTO statute. We can quote the patent's claims directly if useful.
- **Attribution requirements:** **Not strictly required, but recommended.** Suggested: "Two-operator FM synthesis — algorithm published by John M. Chowning (Stanford CCRMA), AES Journal 1973. US patent 4,018,121 (Stanford) expired April 1994."
- **Caveats:**
  - "DX7" is a Yamaha trademark; **don't call our bell preset "DX7 bell."** Generic terms like "FM bell" or "two-operator FM" are fine.
  - "FM synthesis" itself is not a trademark.
  - The patent covered FM-as-musical-synthesis as a method. The mathematical concept of frequency modulation (Armstrong, 1933) was never patentable as a musical technique by anyone but Chowning, and that grant is long expired.

### Technical recipe (ChipBlocks blocks)

ChipBlocks already has an `fm` block, which encapsulates the entire two-operator topology. The bell graph is therefore minimal:

1. **`gate`** — trigger pulse (~1 sample-wide rising edge at note-on).
2. **`adsr`** — envelope. Bell-tone parameters: attack=0 (instant), decay=200ms, sustain=0, release=2000ms. The long release is what makes a bell ring.
3. **`fm`** — the two-operator FM voice. Carrier 440 Hz, modulator at the carrier × non-integer ratio (e.g., 1.4) for inharmonic bell-like spectrum. Modulation index ~4-6 for a bright bell.
4. **`multiply`** — VCA: applies the envelope to the FM voice.
5. **`output`** — DAC.

The famous "DX7 electric piano" preset is a different patch (carrier:mod ratio 1:1, lower modulation index, faster decay). Our bell is the iconic inharmonic-ratio version.

### Implementation notes

- **Estimated authoring time: 15-20 minutes.** Smallest of the 5 starter graphs because the `fm` block does the heavy lifting.
- **Constraints to document:** "Recognizable bell character depends on the carrier:modulator ratio being non-integer (musically, that means inharmonic partials). Integer ratios give harmonic bell-like tones; 1.4 or 1.618 give the characteristic 'metal struck' character."

---

## 4. Frequency-divider clock tree

### Provenance

- **Original publication:** No single canonical source — this is textbook material from the dawn of digital electronics. The binary ripple counter (cascaded toggle flip-flops) appears in virtually every digital-logic textbook from the 1960s onward.
- **Canonical commercial implementations:**
  - **74HC4040** — 12-stage binary ripple counter, originally a Texas Instruments / Motorola CMOS part from the 1970s (CD4040 was the original RCA part c. 1971), part of the JEDEC 4000-series standard. Datasheet: https://www.nexperia.com/products/analog-logic-ics/synchronous-interface-logic/counters-frequency-dividers/binary-counters-timers/series/74HC4040-74HCT4040.html
  - **74HC93** / **74LS93** — 4-bit binary ripple counter, originally a Texas Instruments part from the 1970s.
- **Verification sources:**
  - Nexperia 74HC4040 datasheet (manufacturer canonical reference for current production part): https://www.nexperia.com/products/analog-logic-ics/synchronous-interface-logic/counters-frequency-dividers/binary-counters-timers/series/74HC4040-74HCT4040.html
- **Confidence: MEDIUM-HIGH** — the *technique* (cascade D flip-flops to divide a clock) is so old and so widely documented that no single "original" source can be honestly cited. We mark this MEDIUM per the brief's guidance for "standard textbook technique."

### Legal status

- **Status: Standard textbook technique. No specific authorship to credit.**
- **Patents:** The 74xx-series chips themselves are commodity logic; their original patents (all from the 1960s-1970s) are decades-expired. Texas Instruments, RCA, Motorola, and other vendors second-sourced the parts industry-wide from the 1970s onward.
- **Attribution requirements:** **None required.** The binary ripple counter is the textbook example for "how a digital clock divider works." We may mention "the 74HC4040 12-stage ripple counter is the canonical commercial implementation" in our docs without attribution requirements.
- **Caveats:**
  - "74HC4040," "74HC93" etc. are JEDEC part-number conventions, not trademarks owned by any single manufacturer.
  - Manufacturer datasheets are © the manufacturer; do not copy datasheet text or figures verbatim.

### Technical recipe (ChipBlocks blocks)

The divider tree is naturally expressed in ChipBlocks's `counter` block (which is already a multi-bit binary ripple counter):

1. **`gate`** (fast, ~880 Hz to put the audible divisions in musical range) — the master clock.
2. **`counter`** — accumulates clock edges. Its `addr-out` bus carries the running count.
3. **`bus-split`** — peels off individual bit lines (LSB = ÷2, bit 1 = ÷4, bit 2 = ÷8, ...).
4. **`bus-join`** + **`reinterpret`** — for the audio variant, gather the bits back into a stepped signal.
5. **`output`** — DAC plays the descending-octave stack as a tone.

For the visual variant (also worth bundling as `divider-stripes.json`):

1-3. As above.
4. **`pixelrange`** — gates regions of the screen by counter-bit state.
5. **`vga timing`** + **`vga output`** — paint the result. Result: VGA stripes whose widths halve at each successive divider stage.

### Implementation notes

- **Estimated authoring time: 30-45 minutes** for the audio version, +30 min for the VGA version. Two-stage divider chain has 4-5 blocks; longer chains scale linearly.
- **Constraints to document:** "Every digital chip on Earth uses divider chains to derive slower clocks from a fast crystal. This is the most fundamental digital-electronics primitive after the AND gate."

---

## 5. Hi-hat percussion (filtered noise + ADSR)

### Provenance

- **Original publication:** No single canonical source. The technique "white-noise into bandpass/highpass filter, gated by fast-decay envelope" is **standard subtractive-synthesis** dating to the analog modular synthesizers of the late 1960s (Buchla, Moog, ARP). The Roland TR-808 (1980) used a more complex 6-oscillator architecture but the noise-plus-filter approach is older and more general.
- **Closest "named" reference:** The TR-808's hi-hat circuit (1980) is the most-documented commercial implementation — bandpass filters at 7100 Hz and 3440 Hz, modulated by decaying envelopes. (TR-808 schematics circulate widely as scanned service manuals; full reverse-engineering is publicly documented at https://www.baratatronix.com/blog/cascadia-808-cymbal-hi-hat-synthesis among others.)
- **Verification sources:**
  - Joe Sulli, "Synthesizing Hi-Hats with Web Audio" (developer-friendly walkthrough): http://joesul.li/van/synthesizing-hi-hats/
  - Baratatronix, "Roland TR-808 Cymbal & Hi-Hat Synthesis" (reverse-engineered circuit analysis): https://www.baratatronix.com/blog/cascadia-808-cymbal-hi-hat-synthesis
- **Confidence: MEDIUM** — per the brief's instruction to flag "standard textbook technique" as MEDIUM rather than HIGH. There's no single source we can point to as "the original" because the technique predates the consumer-electronics era. But the technique is unambiguously in the public domain by long convention.

### Legal status

- **Status: Standard textbook subtractive-synthesis technique. No specific authorship to credit.**
- **Patents:** The basic noise-source + bandpass + VCA + envelope approach is so general it predates patentable specificity. No patent is known to cover the basic hi-hat-from-noise approach.
- **TR-808 caveat:** Roland's TR-808 *specific implementation* (6-oscillator metallic-noise source, specific filter cutoffs and Q values) was patented by Roland in 1980 but those patents expired ~2000. We aren't copying the TR-808 — we're using the older, more general "white-noise-plus-filter" approach, which has no patent overlay.
- **Attribution requirements:** **None required.** No specific author or manufacturer can claim the technique. We may note "inspired by classic analog drum machines" in docs.
- **Caveats:**
  - "TR-808" and "Roland" are Roland trademarks; **don't market our hi-hat preset as "TR-808 hi-hat."** Generic terms like "hi-hat" or "filtered-noise hi-hat" are fine.
  - "Hi-hat" is a generic drum-kit term, not a trademark.

### Technical recipe (ChipBlocks blocks)

The minimum-viable hi-hat:

1. **`noise`** — white noise source (16-bit LFSR).
2. **`bandpass`** — center frequency ~6000-8000 Hz, narrow Q. This shapes the noise into the metallic "tsss" character.
3. **`gate`** — trigger (rising edge fires the envelope).
4. **`adsr`** — envelope. Hi-hat parameters: attack=1ms (immediate), decay=30-50ms (the "closed hat" decay), sustain=0, release=10ms. For an "open hat," extend decay to 200ms+.
5. **`multiply`** — VCA: applies the envelope to the filtered noise.
6. **`output`** — DAC.

Typical TR-808-inspired parameters from the reference sources: bandpass center 7100 Hz, Q ~5, ADSR (1, 50, 0, 10). Our `bandpass` block's defaults work directly.

### Implementation notes

- **Estimated authoring time: 25-35 minutes.** Completes the percussion trilogy (kick + snare are already bundled).
- **Constraints to document:** "Combined with the existing `kick-drum.json` and `snare-drum.json`, this gives the user a 3-part rhythm pattern by chaining 3 gate blocks. The classic kick-snare-hat triangle is the foundation of nearly all rhythm-based music."

---

## Summary table

| # | Design                      | Original source                                      | Year | Legal basis                                          | Confidence | Attribution required? |
|---|-----------------------------|------------------------------------------------------|------|------------------------------------------------------|------------|-----------------------|
| 1 | Atari Punk Console          | Mims, *Engineer's Notebook*, Radio Shack            | 1980 | Circuit topology not copyrightable; no patent       | HIGH       | Recommended            |
| 2 | Karplus-Strong              | Karplus & Strong, *Computer Music Journal* 7(2)     | 1983 | US 4,649,783 expired Mar 2004; US 4,622,877 expired Jun 2005 | HIGH       | **Yes**               |
| 3 | Two-operator FM bell        | Chowning, *JAES* 21(7)                              | 1973 | US 4,018,121 expired Apr 1994                       | HIGH       | Recommended            |
| 4 | Frequency-divider clock tree | Textbook (74HC4040 family, 1970s)                   | n/a  | Standard textbook technique; no IP overlay          | MEDIUM     | No                    |
| 5 | Hi-hat (noise+filter+ADSR)  | Generic analog modular technique, c. 1968+          | n/a  | Standard textbook technique; no IP overlay          | MEDIUM     | No                    |

## Final shipping verdict

**All 5 designs are safe to ship in an MIT-licensed product.** The required additions to `CREDITS.md`:

```
## Starter chip designs (examples/)

The bundled example graphs in `examples/` reproduce well-known circuit topologies
and synthesis algorithms. None of the underlying ideas are encumbered by active
patent or copyright restrictions. Credits where appropriate:

- examples/atari-punk-console.json — Inspired by the "Stepped Tone Generator"
  circuit originally published by Forrest M. Mims III in *Engineer's Notebook:
  Integrated Circuit Applications* (Radio Shack, 1980). ChipBlocks reproduces
  the topology only; Mims's original schematic drawing is not included.

- examples/karplus-strong.json — Implements the Karplus-Strong plucked-string
  synthesis algorithm published by Kevin Karplus and Alex Strong in
  *Computer Music Journal*, Vol. 7, No. 2 (1983). US patents 4,649,783 and
  4,622,877 (Leland Stanford Junior University) expired in March 2004 and
  June 2005 respectively. The algorithm is now freely usable.

- examples/fm-bell.json — Two-operator FM synthesis as published by John M.
  Chowning in the *Journal of the Audio Engineering Society* Vol. 21 No. 7
  (1973). US patent 4,018,121 (Leland Stanford Junior University, exclusively
  licensed to Yamaha) expired in April 1994. The algorithm is now freely
  usable. (Not affiliated with or endorsed by Yamaha.)

- examples/divider-clock-tree.json — Standard binary-ripple-counter topology
  (textbook material; canonical commercial implementations include the
  74HC4040 12-stage counter family). No specific authorship to credit.

- examples/hihat.json — Standard subtractive-synthesis hi-hat (filtered noise
  + fast envelope). No specific authorship to credit. (Not affiliated with or
  endorsed by Roland Corporation or any drum-machine manufacturer.)
```

Total expected `CREDITS.md` addition: ~25 lines.
