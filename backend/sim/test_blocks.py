"""
test_blocks.py — verify each block in the library compiles and runs in
an Amaranth simulation. Smoke test only; no pytest needed.

Run from WSL2:
    cd /mnt/c/Users/micha/Desktop/chipzzzd/backend
    python3 sim/test_blocks.py
"""

import sys
from pathlib import Path

# Make the parent directory importable so `from blocks import ...` works
# whether the script is run from backend/ or backend/sim/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from amaranth.sim import Simulator
from blocks import Oscillator, Mixer, Output


def test_oscillator() -> bool:
    """Run the Oscillator for ~one full period and confirm it toggles."""
    osc = Oscillator(freq_hz=440, sample_rate=44100)
    sim = Simulator(osc)
    sim.add_clock(1e-6)

    samples: list[int] = []

    async def process(ctx):
        for _ in range(200):
            samples.append(ctx.get(osc.audio_out))
            await ctx.tick()

    sim.add_testbench(process)
    sim.run()

    transitions = sum(1 for i in range(1, len(samples)) if samples[i] != samples[i - 1])
    print(f"Oscillator: {len(samples)} samples, {transitions} transitions")
    print(f"  First 100 samples: {''.join(str(s) for s in samples[:100])}")
    # 440 Hz at 44100 Hz sample rate -> period 100 -> ~4 transitions per 200 samples
    return transitions >= 2


def test_mixer() -> bool:
    """Run the XOR truth table through the Mixer.

    Mixer is purely combinational, so there's no `sync` domain. Use
    `ctx.delay()` to advance the event queue instead of `ctx.tick()`.
    """
    mix = Mixer()
    sim = Simulator(mix)

    truth: list[tuple[int, int, int]] = []

    async def process(ctx):
        for a in (0, 1):
            for b in (0, 1):
                ctx.set(mix.in_1, a)
                ctx.set(mix.in_2, b)
                # Tiny delay to let combinational logic settle.
                await ctx.delay(1e-9)
                truth.append((a, b, ctx.get(mix.mix_out)))

    sim.add_testbench(process)
    sim.run()

    expected = [(0, 0, 0), (0, 1, 1), (1, 0, 1), (1, 1, 0)]
    print(f"Mixer truth table: {truth}")
    print(f"  Matches XOR? {truth == expected}")
    return truth == expected


def test_output() -> bool:
    """Drive Output's audio_in and confirm it round-trips back via ctx.get.

    Output has no internal logic at all — same combinational story.
    """
    out = Output()
    sim = Simulator(out)

    captured: list[int] = []

    async def process(ctx):
        for v in (0, 1, 0, 1, 1, 0):
            ctx.set(out.audio_in, v)
            await ctx.delay(1e-9)
            captured.append(ctx.get(out.audio_in))

    sim.add_testbench(process)
    sim.run()

    print(f"Output captured: {captured}")
    return captured == [0, 1, 0, 1, 1, 0]


if __name__ == "__main__":
    results = {
        "Oscillator": test_oscillator(),
        "Mixer": test_mixer(),
        "Output": test_output(),
    }
    print()
    print("=== Summary ===")
    for name, ok in results.items():
        print(f"  {name}: {'PASS' if ok else 'FAIL'}")

    sys.exit(0 if all(results.values()) else 1)
