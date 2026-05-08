"""
test_blocks.py — verify each block in the library compiles and runs in
an Amaranth simulation. Smoke test only; no pytest needed.

Run from WSL2:
    cd /mnt/c/Users/micha/Desktop/chipzzzd/backend
    python3 sim/test_blocks.py
"""

import sys
from pathlib import Path

# Make `from blocks import ...` work whether the script is run from
# backend/ or backend/sim/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from amaranth.sim import Simulator
from blocks import Oscillator, Triangle, Sawtooth, Mixer, Output


def _transitions(samples: list[int]) -> int:
    return sum(1 for i in range(1, len(samples)) if samples[i] != samples[i - 1])


def test_oscillator() -> bool:
    """Oscillator should emit ±127 / -128 alternations at the configured
    frequency. With 16-bit phase accumulator at 440 Hz / 44.1 kHz, we
    expect ~880 transitions per second of audio.
    """
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

    transitions = _transitions(samples)
    distinct_values = sorted(set(samples))
    print(f"Oscillator: {len(samples)} samples, {transitions} transitions, distinct values: {distinct_values}")
    # Expected: only +127 and -128 in distinct_values; ~4 transitions in 200 samples
    return transitions >= 2 and set(distinct_values).issubset({-128, 127})


def test_triangle() -> bool:
    """Triangle should ramp through many distinct values over one period."""
    tri = Triangle(freq_hz=440, sample_rate=44100)
    sim = Simulator(tri)
    sim.add_clock(1e-6)

    samples: list[int] = []

    async def process(ctx):
        for _ in range(400):  # ~4 periods at 440 Hz / 44.1 kHz
            samples.append(ctx.get(tri.audio_out))
            await ctx.tick()

    sim.add_testbench(process)
    sim.run()

    distinct = len(set(samples))
    sample_min = min(samples)
    sample_max = max(samples)
    print(f"Triangle: {len(samples)} samples, {distinct} distinct values, range [{sample_min}, {sample_max}]")
    # A real triangle should produce many distinct values across the full -128..+127 range
    return distinct >= 32 and sample_min < -64 and sample_max > 64


def test_sawtooth() -> bool:
    """Sawtooth should ramp from -128 to +127 then snap back."""
    saw = Sawtooth(freq_hz=440, sample_rate=44100)
    sim = Simulator(saw)
    sim.add_clock(1e-6)

    samples: list[int] = []

    async def process(ctx):
        for _ in range(400):
            samples.append(ctx.get(saw.audio_out))
            await ctx.tick()

    sim.add_testbench(process)
    sim.run()

    distinct = len(set(samples))
    sample_min = min(samples)
    sample_max = max(samples)
    print(f"Sawtooth: {len(samples)} samples, {distinct} distinct values, range [{sample_min}, {sample_max}]")
    return distinct >= 32 and sample_min < -64 and sample_max > 64


def test_mixer() -> bool:
    """Mixer averages two 8-bit signed inputs; (a + b) >> 1.

    Mixer is purely combinational, so there's no `sync` domain. Use
    `ctx.delay()` to advance the event queue instead of `ctx.tick()`.
    """
    mix = Mixer()
    sim = Simulator(mix)

    truth: list[tuple[int, int, int]] = []

    async def process(ctx):
        for a, b in [
            (0, 0),
            (0, 100),
            (100, 0),
            (100, 100),
            (-50, 50),
            (-128, 127),
            (-100, -100),
        ]:
            ctx.set(mix.in_1, a)
            ctx.set(mix.in_2, b)
            await ctx.delay(1e-9)
            truth.append((a, b, ctx.get(mix.mix_out)))

    sim.add_testbench(process)
    sim.run()

    expected = [(a, b, (a + b) >> 1) for (a, b, _out) in truth]
    print(f"Mixer (avg): {truth}")
    print(f"  Expected:  {expected}")
    return truth == expected


def test_output() -> bool:
    """Output passes through whatever signed-8 value is on audio_in."""
    out = Output()
    sim = Simulator(out)

    captured: list[int] = []

    async def process(ctx):
        for v in (-128, -50, 0, 1, 100, 127):
            ctx.set(out.audio_in, v)
            await ctx.delay(1e-9)
            captured.append(ctx.get(out.audio_in))

    sim.add_testbench(process)
    sim.run()

    print(f"Output captured: {captured}")
    return captured == [-128, -50, 0, 1, 100, 127]


if __name__ == "__main__":
    results = {
        "Oscillator": test_oscillator(),
        "Triangle": test_triangle(),
        "Sawtooth": test_sawtooth(),
        "Mixer": test_mixer(),
        "Output": test_output(),
    }
    print()
    print("=== Summary ===")
    for name, ok in results.items():
        print(f"  {name}: {'PASS' if ok else 'FAIL'}")

    sys.exit(0 if all(results.values()) else 1)
