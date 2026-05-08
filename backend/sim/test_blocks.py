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
from blocks import Oscillator, Triangle, Sawtooth, Mixer, Output, ADSR, Gate


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


def test_gate() -> bool:
    """Gate produces a periodic 1-bit pulse at the configured rate."""
    g = Gate(rate_hz=441, duty_pct=50, sample_rate=44100)  # 441 Hz keeps the test fast
    sim = Simulator(g)
    sim.add_clock(1e-6)

    samples: list[int] = []

    async def process(ctx):
        for _ in range(400):
            samples.append(ctx.get(g.gate_out))
            await ctx.tick()

    sim.add_testbench(process)
    sim.run()

    transitions = _transitions(samples)
    high_count = sum(samples)
    low_count = len(samples) - high_count
    print(f"Gate (441Hz, 50% duty): {len(samples)} samples, {transitions} transitions, high={high_count}, low={low_count}")
    # 441 Hz at 44100 sample rate = period 100. 4 periods in 400 samples = 8 edges.
    return transitions >= 4 and abs(high_count - low_count) < 50


def test_adsr() -> bool:
    """ADSR produces an envelope that ramps up on gate-rising and down on gate-falling.

    Drive a constant audio_in (full +127), pulse gate high for a while then
    low, and verify audio_out follows the envelope shape: starts near 0,
    ramps up, sustains, ramps back to 0.
    """
    env = ADSR(attack_ms=2, decay_ms=4, sustain_level=80, release_ms=4, sample_rate=44100)
    sim = Simulator(env)
    sim.add_clock(1e-6)

    captured: list[int] = []

    async def process(ctx):
        # Constant max-positive audio in.
        ctx.set(env.audio_in, 127)
        # Gate low for a few ticks (idle).
        ctx.set(env.gate, 0)
        for _ in range(20):
            captured.append(ctx.get(env.audio_out))
            await ctx.tick()
        # Gate high — attack, decay, sustain.
        ctx.set(env.gate, 1)
        for _ in range(800):  # plenty for 2ms attack + 4ms decay + sustain at 44.1kHz
            captured.append(ctx.get(env.audio_out))
            await ctx.tick()
        # Gate low — release.
        ctx.set(env.gate, 0)
        for _ in range(400):  # plenty for 4ms release
            captured.append(ctx.get(env.audio_out))
            await ctx.tick()

    sim.add_testbench(process)
    sim.run()

    pre_gate = captured[:20]
    during_gate = captured[20:820]
    post_gate = captured[820:]

    pre_max = max(pre_gate)
    during_max = max(during_gate)
    post_min_after_release = min(post_gate[-50:])
    distinct = len(set(captured))

    print(f"ADSR: pre-gate max={pre_max}, during-gate max={during_max}, post-release tail min={post_min_after_release}, distinct values={distinct}")
    # Pre-gate: idle, output 0
    # During gate: should reach near +127 (audio_in * envelope at peak)
    # After release: should be back to 0
    # Distinct values: many (envelope ramps)
    return pre_max == 0 and during_max > 100 and post_min_after_release == 0 and distinct >= 30


if __name__ == "__main__":
    results = {
        "Oscillator": test_oscillator(),
        "Triangle": test_triangle(),
        "Sawtooth": test_sawtooth(),
        "Mixer": test_mixer(),
        "Output": test_output(),
        "Gate": test_gate(),
        "ADSR": test_adsr(),
    }
    print()
    print("=== Summary ===")
    for name, ok in results.items():
        print(f"  {name}: {'PASS' if ok else 'FAIL'}")

    sys.exit(0 if all(results.values()) else 1)
