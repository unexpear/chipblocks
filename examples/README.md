# Example graphs

Drop these files onto **Load graph** in the ChipBlocks toolbar to try them.

| File | What you'll hear |
|---|---|
| [`adsr-pulse.json`](adsr-pulse.json) | A 440 Hz tone pulsing 4 times per second, shaped by an ADSR envelope (20 ms attack, 80 ms decay, sustain at 80, 150 ms release). Shows ADSR + Gate working together. |
| [`two-osc-mix.json`](two-osc-mix.json) | A 440 Hz square wave mixed with a 660 Hz sawtooth — bright, slightly dissonant chiptune chord. |

These files use the v1 ChipBlocks save format (`{ version, app, savedAt, viewport, nodes, edges }`). You can open and edit them in any text editor; they're regular JSON.

## Adding your own

Press **Save graph** in the running app to download the current canvas as a JSON file. Drop it back via **Load graph** at any time. Save files are forward-compatible — newer versions of ChipBlocks should still load older saves, with the load dialog warning you if a save was made by a newer version.
