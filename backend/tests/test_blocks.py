"""
Per-block smoke tests.

Each test wires a tiny graph that exercises one block, runs it through
the full synth pipeline, and asserts a gross property of the resulting
WAV (zero-crossing count, peak amplitude, silence vs non-silence, etc.).

These tests deliberately do not introspect Amaranth internals — they
verify that each block, plugged into a graph, produces audio that looks
right. Internal implementation can change freely as long as these
properties still hold.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# Small helpers used by multiple tests.
# ---------------------------------------------------------------------------
def _count_zero_crossings(samples: list[int]) -> int:
    """Count sign changes (negative <-> non-negative) between consecutive samples."""
    count = 0
    for a, b in zip(samples, samples[1:]):
        if (a < 0) != (b < 0):
            count += 1
    return count


def _output_node(node_id: str = "out") -> dict:
    return {"id": node_id, "type": "output", "data": {}}


def _edge(eid: str, src: str, tgt: str, src_handle: str, tgt_handle: str) -> dict:
    return {
        "id": eid,
        "source": src,
        "target": tgt,
        "sourceHandle": src_handle,
        "targetHandle": tgt_handle,
    }


# ---------------------------------------------------------------------------
# Source-block tests — oscillator family.
# ---------------------------------------------------------------------------
def test_oscillator_440hz_zero_crossings(run_synth, wav_samples):
    graph = {
        "nodes": [
            {"id": "osc", "type": "oscillator", "data": {"freq": 440}},
            _output_node(),
        ],
        "edges": [_edge("e1", "osc", "out", "audio-out", "audio-in")],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    crossings = _count_zero_crossings(samples)
    expected = 2 * 440  # two crossings per cycle
    assert abs(crossings - expected) < expected * 0.10, (
        f"Square 440 Hz: expected ~{expected} crossings, got {crossings}"
    )


def test_triangle_440hz_zero_crossings_and_range(run_synth, wav_samples):
    graph = {
        "nodes": [
            {"id": "tri", "type": "triangle", "data": {"freq": 440}},
            _output_node(),
        ],
        "edges": [_edge("e1", "tri", "out", "audio-out", "audio-in")],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    crossings = _count_zero_crossings(samples)
    expected = 2 * 440
    assert abs(crossings - expected) < expected * 0.10, (
        f"Triangle 440 Hz: expected ~{expected} crossings, got {crossings}"
    )
    # 8-bit signed range times the WAV SCALE=64: -128*64 = -8192, 127*64 = 8128.
    assert min(samples) >= -128 * 64
    assert max(samples) <= 127 * 64


def test_sawtooth_440hz_zero_crossings(run_synth, wav_samples):
    graph = {
        "nodes": [
            {"id": "saw", "type": "sawtooth", "data": {"freq": 440}},
            _output_node(),
        ],
        "edges": [_edge("e1", "saw", "out", "audio-out", "audio-in")],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    crossings = _count_zero_crossings(samples)
    expected = 2 * 440
    assert abs(crossings - expected) < expected * 0.10, (
        f"Sawtooth 440 Hz: expected ~{expected} crossings, got {crossings}"
    )


def test_sine_440hz_zero_crossings_and_peak(run_synth, wav_samples):
    graph = {
        "nodes": [
            {"id": "sin", "type": "sine", "data": {"freq": 440}},
            _output_node(),
        ],
        "edges": [_edge("e1", "sin", "out", "audio-out", "audio-in")],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    crossings = _count_zero_crossings(samples)
    expected = 2 * 440
    assert abs(crossings - expected) < expected * 0.10, (
        f"Sine 440 Hz: expected ~{expected} crossings, got {crossings}"
    )
    # Synth.write_wav scales 8-bit samples by 64. Sine's int8 peak is ±127,
    # so 16-bit peak is ~±127*64 = ±8128. Allow some slack for LUT
    # quantization.
    peak = max(abs(min(samples)), abs(max(samples)))
    assert peak >= 127 * 64 * 0.9, (
        f"Sine peak amplitude looks too low: {peak} (expected ~{127 * 64})"
    )


def test_noise_is_non_silent_and_aperiodic(run_synth, wav_samples):
    graph = {
        "nodes": [
            {"id": "n", "type": "noise", "data": {}},
            _output_node(),
        ],
        "edges": [_edge("e1", "n", "out", "audio-out", "audio-in")],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    # Not all silence.
    assert any(s != 0 for s in samples), "Noise output is all zeros"
    # Average abs-difference between consecutive samples should be high
    # for noise — much higher than for a smoothly-varying waveform.
    diffs = [abs(b - a) for a, b in zip(samples, samples[1:])]
    avg_diff = sum(diffs) / len(diffs)
    # 16-bit-promoted noise should jump by thousands sample-to-sample.
    assert avg_diff > 1000, (
        f"Noise samples don't fluctuate enough — avg |Δ| = {avg_diff}"
    )


def test_constant_value_64(run_synth, wav_samples):
    # Constant is purely combinational, but Amaranth's simulator needs a
    # `sync` domain to schedule a clock — so we include an unconnected
    # Gate alongside Constant->Output to give the sim something to clock.
    graph = {
        "nodes": [
            {"id": "c", "type": "constant", "data": {"value": 64}},
            {"id": "g", "type": "gate", "data": {"rate_hz": 1, "duty_pct": 50}},
            _output_node(),
        ],
        "edges": [_edge("e1", "c", "out", "audio-out", "audio-in")],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    expected = 64 * 64  # 4096 (8-bit value 64 × 16-bit WAV-promotion factor 64).
    assert all(s == expected for s in samples), (
        f"Constant block output isn't a flat {expected}: "
        f"min={min(samples)}, max={max(samples)}"
    )


# ---------------------------------------------------------------------------
# Combinator-block tests — mixer, output (silent), multiply.
# ---------------------------------------------------------------------------
def test_mixer_two_oscillators(run_synth, wav_samples):
    graph = {
        "nodes": [
            {"id": "a", "type": "oscillator", "data": {"freq": 440}},
            {"id": "b", "type": "oscillator", "data": {"freq": 660}},
            {"id": "mix", "type": "mixer", "data": {}},
            _output_node(),
        ],
        "edges": [
            _edge("e1", "a", "mix", "audio-out", "in-1"),
            _edge("e2", "b", "mix", "audio-out", "in-2"),
            _edge("e3", "mix", "out", "mix-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    assert any(s != 0 for s in samples), "Mixer output is silent"
    # Should still be in 8-bit-signed range times WAV SCALE.
    assert min(samples) >= -128 * 64
    assert max(samples) <= 127 * 64


def test_output_alone_is_silent(run_synth, wav_samples):
    # Output is just a passthrough — no `m.d.sync` of its own. The
    # simulator needs at least one synchronous block to register a `sync`
    # domain, so we drop in an unconnected Gate alongside it.
    graph = {
        "nodes": [
            _output_node(),
            {"id": "g", "type": "gate", "data": {"rate_hz": 1, "duty_pct": 50}},
        ],
        "edges": [],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    assert all(s == 0 for s in samples), (
        f"Output with no input should be silent; got non-zero samples: "
        f"min={min(samples)}, max={max(samples)}"
    )


def test_multiply_two_oscillators(run_synth, wav_samples):
    graph = {
        "nodes": [
            {"id": "a", "type": "oscillator", "data": {"freq": 440}},
            {"id": "b", "type": "oscillator", "data": {"freq": 110}},
            {"id": "mul", "type": "multiply", "data": {}},
            _output_node(),
        ],
        "edges": [
            _edge("e1", "a", "mul", "audio-out", "in-1"),
            _edge("e2", "b", "mul", "audio-out", "in-2"),
            _edge("e3", "mul", "out", "audio-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    assert any(s != 0 for s in samples), "Multiply output is silent"
    # Multiply uses (in_1 * in_2) >> 7 — bounded inside int8 range.
    assert min(samples) >= -128 * 64
    assert max(samples) <= 127 * 64


# ---------------------------------------------------------------------------
# Envelope / gate tests.
# ---------------------------------------------------------------------------
def test_adsr_with_gate_and_constant_audio(run_synth, wav_samples):
    """ADSR shapes a steady audio source. The envelope starts at zero, so
    the very first output sample is zero; then the envelope rises through
    attack toward the sustain level and the output amplitude follows it."""
    graph = {
        "nodes": [
            {"id": "g", "type": "gate", "data": {"rate_hz": 4, "duty_pct": 50}},
            {"id": "src", "type": "constant", "data": {"value": 127}},
            {
                "id": "env",
                "type": "adsr",
                "data": {
                    "attack_ms": 10,
                    "decay_ms": 50,
                    "sustain_level": 80,
                    "release_ms": 100,
                },
            },
            _output_node(),
        ],
        "edges": [
            _edge("e1", "src", "env", "audio-out", "audio-in"),
            _edge("e2", "g", "env", "gate-out", "gate"),
            _edge("e3", "env", "out", "audio-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    # Envelope-shaped audio is positive throughout (Constant at +127 ×
    # nonneg envelope = nonneg output).
    assert any(s > 0 for s in samples), "ADSR output never goes positive"
    # First sample should be zero — the envelope starts in IDLE with
    # envelope=0, so the multiplied output is 0 regardless of audio_in.
    assert samples[0] == 0, (
        f"ADSR's very first sample should be 0; got {samples[0]}"
    )
    # And the envelope must rise — peak amplitude later in the buffer
    # should exceed the early portion.
    early_peak = max(samples[:200])
    later_peak = max(samples[1000:5000])
    assert later_peak > early_peak, (
        f"ADSR envelope didn't rise past the first 200 samples: "
        f"early peak={early_peak}, later peak={later_peak}"
    )


def test_gate_into_adsr_builds_cleanly(run_synth, wav_samples):
    """Gate has no audio output of its own, so test it indirectly by
    feeding it into an ADSR. If the graph builds and produces non-silence,
    Gate is doing its job."""
    graph = {
        "nodes": [
            {"id": "g", "type": "gate", "data": {"rate_hz": 4, "duty_pct": 50}},
            {"id": "src", "type": "oscillator", "data": {"freq": 440}},
            {
                "id": "env",
                "type": "adsr",
                "data": {
                    "attack_ms": 5,
                    "decay_ms": 20,
                    "sustain_level": 100,
                    "release_ms": 50,
                },
            },
            _output_node(),
        ],
        "edges": [
            _edge("e1", "src", "env", "audio-out", "audio-in"),
            _edge("e2", "g", "env", "gate-out", "gate"),
            _edge("e3", "env", "out", "audio-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    assert any(s != 0 for s in samples), "Gate->ADSR->Output produced silence"


# ---------------------------------------------------------------------------
# Filter / sample-and-hold / FM / wavetable tests.
# ---------------------------------------------------------------------------
def test_lowpass_attenuates_high_frequency(run_synth, wav_samples):
    """A 5 kHz oscillator routed through a 200 Hz cutoff lowpass should
    have lower amplitude than the same source through a 20 kHz cutoff."""

    def make_graph(cutoff_hz: int) -> dict:
        return {
            "nodes": [
                {"id": "src", "type": "oscillator", "data": {"freq": 5000}},
                {"id": "lpf", "type": "lowpass", "data": {"cutoff_hz": cutoff_hz}},
                _output_node(),
            ],
            "edges": [
                _edge("e1", "src", "lpf", "audio-out", "audio-in"),
                _edge("e2", "lpf", "out", "audio-out", "audio-in"),
            ],
        }

    quiet = wav_samples(run_synth(make_graph(200), duration_s=1))
    loud = wav_samples(run_synth(make_graph(20000), duration_s=1))

    quiet_peak = max(abs(s) for s in quiet)
    loud_peak = max(abs(s) for s in loud)

    # The 200-Hz-cutoff path should be at least 2x quieter than the
    # 20-kHz-cutoff path against a 5-kHz source.
    assert quiet_peak * 2 < loud_peak, (
        f"Lowpass doesn't attenuate enough: cutoff=200 Hz peak={quiet_peak}, "
        f"cutoff=20 kHz peak={loud_peak}"
    )


def test_highpass_attenuates_low_frequency(run_synth, wav_samples):
    """A constant +127 (pure DC, the lowest possible 'frequency') routed
    through a HP at cutoff=2000 Hz should be attenuated way more than
    the same DC through a HP at cutoff=10 Hz. The HP is 'input minus
    lowpass-of-input', so a higher cutoff means the lowpass tracks DC
    less aggressively and the difference is smaller — i.e. the steady-
    state output approaches zero from above."""

    def make_graph(cutoff_hz: int) -> dict:
        return {
            "nodes": [
                {"id": "src", "type": "constant", "data": {"value": 127}},
                {"id": "hpf", "type": "highpass", "data": {"cutoff_hz": cutoff_hz}},
                # Unconnected gate so the simulator has a sync domain.
                {"id": "g", "type": "gate", "data": {"rate_hz": 1, "duty_pct": 50}},
                _output_node(),
            ],
            "edges": [
                _edge("e1", "src", "hpf", "audio-out", "audio-in"),
                _edge("e2", "hpf", "out", "audio-out", "audio-in"),
            ],
        }

    # Skip the very first samples while the internal lowpass settles —
    # at startup lp_state is 0, so the HP momentarily passes the full
    # DC value through, which is exactly the spike we'd want a real HP
    # to remove. The settled steady-state response is the interesting
    # property to test.
    SETTLE_SAMPLES = 2000
    quiet = wav_samples(run_synth(make_graph(2000), duration_s=1))[SETTLE_SAMPLES:]
    loud = wav_samples(run_synth(make_graph(10), duration_s=1))[SETTLE_SAMPLES:]

    quiet_peak = max(abs(s) for s in quiet)
    loud_peak = max(abs(s) for s in loud)

    # The 2 kHz-cutoff path should be at least 2x quieter than the
    # 10 Hz-cutoff path against a DC source: a high cutoff smooths the
    # internal lowpass quickly toward the DC, leaving little residue;
    # a low cutoff leaves a slow-tracking lowpass and a larger residue.
    assert quiet_peak * 2 < loud_peak, (
        f"Highpass doesn't attenuate DC enough: cutoff=2000 Hz peak={quiet_peak}, "
        f"cutoff=10 Hz peak={loud_peak}"
    )


def test_bandpass_rejects_out_of_band_frequency(run_synth, wav_samples):
    """A pure 5 kHz sine (one frequency, no harmonics to confuse the
    comparison) routed through a BP centered at 200 Hz (way out of
    band) should be substantially quieter than the same source through
    a BP centered at 5000 Hz (in band)."""

    def make_graph(center_hz: int) -> dict:
        return {
            "nodes": [
                {"id": "src", "type": "sine", "data": {"freq": 5000}},
                {"id": "bpf", "type": "bandpass", "data": {"center_hz": center_hz}},
                _output_node(),
            ],
            "edges": [
                _edge("e1", "src", "bpf", "audio-out", "audio-in"),
                _edge("e2", "bpf", "out", "audio-out", "audio-in"),
            ],
        }

    # Skip the first ~50 ms so the 2-stage filter's internal state has
    # settled past the startup transient (which momentarily passes the
    # full input through while lp_state is 0).
    SETTLE_SAMPLES = 2200
    out_of_band = wav_samples(run_synth(make_graph(200), duration_s=1))[SETTLE_SAMPLES:]
    in_band = wav_samples(run_synth(make_graph(5000), duration_s=1))[SETTLE_SAMPLES:]

    out_peak = max(abs(s) for s in out_of_band)
    in_peak = max(abs(s) for s in in_band)

    # 5 kHz sine through a BP centered at 200 Hz should be at least 2x
    # quieter than the same tone through a BP centered at 5 kHz. The
    # out-of-band cutoff (high = 200 * sqrt(2) ≈ 283 Hz) leaves the
    # 5 kHz tone ~17.7 octaves above the LP corner; the in-band cutoff
    # (high ≈ 7071 Hz) lets it through largely intact.
    assert out_peak * 2 < in_peak, (
        f"Bandpass doesn't reject out-of-band content enough: "
        f"center=200 Hz peak={out_peak}, center=5000 Hz peak={in_peak}"
    )


def test_samplehold_holds_between_clock_edges(run_synth, wav_samples):
    """Sample-and-hold sampling a sawtooth at a slow gate clock should
    produce piecewise-constant output: between rising edges of the clock,
    consecutive samples are equal."""
    graph = {
        "nodes": [
            {"id": "src", "type": "sawtooth", "data": {"freq": 220}},
            {"id": "g", "type": "gate", "data": {"rate_hz": 50, "duty_pct": 50}},
            {"id": "sh", "type": "samplehold", "data": {}},
            _output_node(),
        ],
        "edges": [
            _edge("e1", "src", "sh", "audio-out", "audio-in"),
            _edge("e2", "g", "sh", "gate-out", "clock"),
            _edge("e3", "sh", "out", "audio-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    # Count consecutive-sample changes; for a 50 Hz clock over 1 second we
    # expect roughly 50 distinct hold values, so no more than ~150 changes
    # (tolerating clock-edge transitions and startup). A bare sawtooth
    # would change every sample (44099 changes).
    changes = sum(1 for a, b in zip(samples, samples[1:]) if a != b)
    assert changes < 500, (
        f"Sample-and-hold not holding values — {changes} consecutive-sample changes"
    )
    # Output should still be non-silent.
    assert any(s != 0 for s in samples), "Sample-and-hold output is silent"


def test_fm_voice_has_modulated_spectrum(run_synth, wav_samples):
    """FM at carrier=440 Hz with modulator=110 Hz produces inharmonic
    sidebands. The zero-crossing rate won't match a clean 880/sec, and
    the audio is non-silent."""
    fm_graph = {
        "nodes": [
            {
                "id": "fm",
                "type": "fm",
                "data": {"carrier_freq": 440, "modulator_freq": 110, "mod_depth": 64},
            },
            _output_node(),
        ],
        "edges": [_edge("e1", "fm", "out", "audio-out", "audio-in")],
    }
    samples = wav_samples(run_synth(fm_graph, duration_s=1))
    assert any(s != 0 for s in samples), "FM output is silent"
    fm_crossings = _count_zero_crossings(samples)

    plain_graph = {
        "nodes": [
            {"id": "osc", "type": "oscillator", "data": {"freq": 440}},
            _output_node(),
        ],
        "edges": [_edge("e1", "osc", "out", "audio-out", "audio-in")],
    }
    plain_samples = wav_samples(run_synth(plain_graph, duration_s=1))
    plain_crossings = _count_zero_crossings(plain_samples)

    # FM modulates the carrier phase, so its zero-crossing count
    # differs noticeably from a pure 440 Hz square. Tolerate the case
    # where mod_depth happens to land near a multiple of the carrier
    # period — but typically they should differ by more than ~5%.
    assert fm_crossings != plain_crossings, (
        f"FM's zero-crossing count matches a plain 440 Hz square exactly "
        f"({fm_crossings}); modulation isn't taking effect"
    )


def test_wavetable_sine_matches_sine_block(run_synth, wav_samples):
    graph = {
        "nodes": [
            {
                "id": "wt",
                "type": "wavetable",
                "data": {"freq": 440, "shape": "sine"},
            },
            _output_node(),
        ],
        "edges": [_edge("e1", "wt", "out", "audio-out", "audio-in")],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    crossings = _count_zero_crossings(samples)
    expected = 2 * 440
    assert abs(crossings - expected) < expected * 0.10, (
        f"Wavetable(sine) at 440 Hz: expected ~{expected} crossings, got {crossings}"
    )


def test_bitcrusher_1bit_squares_a_sine(run_synth, wav_samples):
    """At bits=1 only the sign bit survives, so any input collapses to a
    2-level square wave at the input's fundamental. Feeding a 440 Hz sine
    yields a 440 Hz square — matched zero-crossing count, but the output
    sits at exactly two values (0 for nonneg input, -128 for negative)."""
    graph = {
        "nodes": [
            {"id": "src", "type": "sine", "data": {"freq": 440}},
            {"id": "bc", "type": "bitcrusher", "data": {"bits": 1}},
            _output_node(),
        ],
        "edges": [
            _edge("e1", "src", "bc", "audio-out", "audio-in"),
            _edge("e2", "bc", "out", "audio-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    crossings = _count_zero_crossings(samples)
    expected = 2 * 440
    assert abs(crossings - expected) < expected * 0.10, (
        f"Bitcrusher(bits=1) on 440 Hz sine: expected ~{expected} crossings, "
        f"got {crossings}"
    )
    # At bits=1 the int8 output can only be 0 (nonneg input) or -128 (neg
    # input). After WAV scaling those become 0 and -128*64 = -8192.
    distinct = set(samples)
    assert distinct.issubset({0, -8192}), (
        f"Bitcrusher(bits=1) output should only contain 0 or -8192; "
        f"saw {sorted(distinct)}"
    )


def test_distortion_clips_a_constant_to_full_scale(run_synth, wav_samples):
    """Constant +64 fed through Distortion(threshold=32) should clip
    above the threshold and rescale to ±127. Specifically, +64 saturates
    to +32, then × 127 // 32 = 127 — the full positive rail. After WAV
    scaling that's 127*64 = 8128.

    The pipeline also includes the small "no implicit sync domain"
    workaround: Distortion is purely combinational, so we add an
    unconnected Gate to give the simulator a sync domain to clock.
    """
    graph = {
        "nodes": [
            {"id": "src", "type": "constant", "data": {"value": 64}},
            {"id": "dst", "type": "distortion", "data": {"threshold": 32}},
            {"id": "g", "type": "gate", "data": {"rate_hz": 1, "duty_pct": 50}},
            _output_node(),
        ],
        "edges": [
            _edge("e1", "src", "dst", "audio-out", "audio-in"),
            _edge("e2", "dst", "out", "audio-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    expected = 127 * 64
    assert all(s == expected for s in samples), (
        f"Distortion(threshold=32) on Constant(64) should clip-and-rescale "
        f"to {expected}; got min={min(samples)}, max={max(samples)}"
    )


def test_delay_holds_silence_then_passes_input(run_synth, wav_samples):
    """A delay of 10 samples means the first 10 output samples are 0 (the
    buffer's reset state) and subsequent samples are the input from 10
    samples ago. We feed a Constant +64 through and check both ends."""
    graph = {
        "nodes": [
            {"id": "src", "type": "constant", "data": {"value": 64}},
            {"id": "dl", "type": "delay", "data": {"delay_samples": 10}},
            # Unconnected gate so the simulator has a sync domain.
            {"id": "g", "type": "gate", "data": {"rate_hz": 1, "duty_pct": 50}},
            _output_node(),
        ],
        "edges": [
            _edge("e1", "src", "dl", "audio-out", "audio-in"),
            _edge("e2", "dl", "out", "audio-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    # First 10 samples should be the buffer's reset value (0).
    SCALED = 64 * 64  # 8-bit value 64 × WAV SCALE 64 = 4096.
    assert all(s == 0 for s in samples[:10]), (
        f"Delay's first 10 samples should be 0 (buffer reset); got "
        f"{samples[:10]}"
    )
    # After the delay, samples should match the (constant) input.
    assert all(s == SCALED for s in samples[10:200]), (
        f"Delay should pass through Constant(64) after 10 samples; got "
        f"min={min(samples[10:200])}, max={max(samples[10:200])}"
    )


# ---------------------------------------------------------------------------
# Logic-block tests — AND, OR, XOR, NOT, Counter.
#
# The boolean gates output 1-bit signals on `gate-out`. We wire them
# straight to the Output block's `audio-in` (which is signed 8-bit);
# Amaranth zero-extends, so the WAV ends up as 0 (gate low) or +64
# (gate high, after the WAV scale factor of 64). That gives a clean
# proportion-of-high-samples check per block.
# ---------------------------------------------------------------------------
def test_and_gate_combines_two_clocks(run_synth, wav_samples):
    """AND of a 4 Hz / 50% gate and a 2 Hz / 50% gate should be high
    only when both are high — the same proportion as the slower gate's
    duty when their phases align (here both start at t=0 with high)."""
    graph = {
        "nodes": [
            {"id": "g1", "type": "gate", "data": {"rate_hz": 4, "duty_pct": 50}},
            {"id": "g2", "type": "gate", "data": {"rate_hz": 2, "duty_pct": 50}},
            {"id": "a", "type": "and", "data": {}},
            _output_node(),
        ],
        "edges": [
            _edge("e1", "g1", "a", "gate-out", "in-1"),
            _edge("e2", "g2", "a", "gate-out", "in-2"),
            _edge("e3", "a", "out", "gate-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    # Output should only ever be 0 or +64 (1-bit zero-extended × WAV scale 64).
    distinct = set(samples)
    assert distinct.issubset({0, 64}), (
        f"AND output should only contain 0 or 64; got {sorted(distinct)}"
    )
    # Both gates start high; the AND is high while both are high. Over
    # 1 second the high-fraction is roughly the slower gate's high-fraction
    # intersected with the faster — about 25% (two 50%s overlap a quarter
    # of the time on average).
    high = sum(1 for s in samples if s != 0)
    fraction = high / len(samples)
    assert 0.15 < fraction < 0.40, (
        f"AND high-fraction should be ~25%, got {fraction:.3f}"
    )


def test_or_gate_combines_two_clocks(run_synth, wav_samples):
    """OR of two 50%-duty gates at different rates should be high about
    75% of the time (both off only ~25%)."""
    graph = {
        "nodes": [
            {"id": "g1", "type": "gate", "data": {"rate_hz": 4, "duty_pct": 50}},
            {"id": "g2", "type": "gate", "data": {"rate_hz": 2, "duty_pct": 50}},
            {"id": "o", "type": "or", "data": {}},
            _output_node(),
        ],
        "edges": [
            _edge("e1", "g1", "o", "gate-out", "in-1"),
            _edge("e2", "g2", "o", "gate-out", "in-2"),
            _edge("e3", "o", "out", "gate-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    high = sum(1 for s in samples if s != 0)
    fraction = high / len(samples)
    assert 0.60 < fraction < 0.90, (
        f"OR high-fraction should be ~75%, got {fraction:.3f}"
    )


def test_xor_gate_differs_from_or(run_synth, wav_samples):
    """XOR of the same two gates as the OR test should be high about 50%
    of the time (each gate is on 50%, XOR is on whenever they differ —
    which for two independent-phase 50% gates averages to 50%)."""
    graph = {
        "nodes": [
            {"id": "g1", "type": "gate", "data": {"rate_hz": 4, "duty_pct": 50}},
            {"id": "g2", "type": "gate", "data": {"rate_hz": 2, "duty_pct": 50}},
            {"id": "x", "type": "xor", "data": {}},
            _output_node(),
        ],
        "edges": [
            _edge("e1", "g1", "x", "gate-out", "in-1"),
            _edge("e2", "g2", "x", "gate-out", "in-2"),
            _edge("e3", "x", "out", "gate-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    high = sum(1 for s in samples if s != 0)
    fraction = high / len(samples)
    # XOR of two independent 50%-duty signals averages to 50% high.
    assert 0.35 < fraction < 0.65, (
        f"XOR high-fraction should be ~50%, got {fraction:.3f}"
    )


def test_not_gate_inverts_a_clock(run_synth, wav_samples):
    """NOT of a 4 Hz / 50% gate should be high while the source is low —
    i.e. the inverted output's high-fraction equals 1 minus the source's
    high-fraction (~50% in, ~50% out, but the phase is flipped)."""
    inv_graph = {
        "nodes": [
            {"id": "g", "type": "gate", "data": {"rate_hz": 4, "duty_pct": 50}},
            {"id": "n", "type": "not", "data": {}},
            _output_node(),
        ],
        "edges": [
            _edge("e1", "g", "n", "gate-out", "gate-in"),
            _edge("e2", "n", "out", "gate-out", "audio-in"),
        ],
    }
    inv_samples = wav_samples(run_synth(inv_graph, duration_s=1))
    inv_high = sum(1 for s in inv_samples if s != 0)
    inv_fraction = inv_high / len(inv_samples)
    # Source gate is high 50% of the time; NOT should also land near 50%
    # (the on / off durations are equal at 50% duty), but the very first
    # sample should be low — the source gate starts high.
    assert 0.45 < inv_fraction < 0.55, (
        f"NOT high-fraction should be ~50% for a 50%-duty source, got {inv_fraction:.3f}"
    )
    # First sample: source gate is high at t=0, so NOT output is low.
    assert inv_samples[0] == 0, (
        f"NOT's first sample should be 0 (source gate starts high); got {inv_samples[0]}"
    )


def test_counter_cycles_through_values(run_synth, wav_samples):
    """A 4 Hz gate clocking a Counter(max_value=8) should produce 4
    distinct counter values per second on average (one per rising
    edge). Output is `count - 64`, so values land in {-64, -63, ..., -57}."""
    graph = {
        "nodes": [
            {"id": "g", "type": "gate", "data": {"rate_hz": 4, "duty_pct": 50}},
            {"id": "c", "type": "counter", "data": {"max_value": 8}},
            _output_node(),
        ],
        "edges": [
            _edge("e1", "g", "c", "gate-out", "clock"),
            _edge("e2", "c", "out", "audio-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=2))
    # Expected distinct values: 0..7 minus 64 = -64..-57, scaled by 64 in
    # the WAV writer. So {-64, -63, -62, -61, -60, -59, -58, -57} × 64.
    distinct = set(samples)
    expected = {(v - 64) * 64 for v in range(8)}
    # Over 2 seconds at 4 Hz we get 8 rising edges — exactly enough to
    # visit all 8 counter states. The very first sample sits at -64*64
    # (count == 0 before the first edge), so {-64..-57}*64 should appear.
    assert distinct == expected, (
        f"Counter should produce all 8 distinct values × 64; got {sorted(distinct)}"
    )


def test_counter_addr_out_emits_low_4_bits():
    """Sprint 17 extension: Counter now exposes a raw `addr-out` port
    carrying the low 4 bits of the internal count. Drive a Counter
    directly under the simulator with a hand-pulsed clock and verify
    addr-out walks 1..15, wraps to 0, and audio-out tracks count - 64.
    """
    from amaranth import Module, Signal
    from amaranth.sim import Simulator
    from blocks.counter import Counter

    block = Counter(max_value=16)
    m = Module()
    m.submodules.b = block
    # Anchor the sync domain (Counter has its own sync logic but we
    # mirror the visual-block tests' boilerplate for consistency).
    _anchor = Signal()
    m.d.sync += _anchor.eq(~_anchor)
    sim = Simulator(m)
    sim.add_clock(1e-6)

    captured: list[tuple[int, int]] = []

    async def process(ctx):
        # Toggle the clock-input pin to generate rising edges. Each
        # rising edge advances the counter by 1; max_value=16 wraps at 16.
        ctx.set(block.clock_in, 0)
        for _step in range(20):  # 20 edges: walk 1..15, wrap, walk 0..4
            ctx.set(block.clock_in, 1)
            await ctx.tick()
            await ctx.tick()  # let comb propagation settle
            captured.append((ctx.get(block.addr_out), ctx.get(block.audio_out)))
            ctx.set(block.clock_in, 0)
            await ctx.tick()

    sim.add_testbench(process)
    sim.run()

    addr_values = [a for a, _audio in captured]
    audio_values = [aud for _a, aud in captured]
    expected_addr = list(range(1, 16)) + [0, 1, 2, 3, 4]
    assert addr_values == expected_addr, (
        f"Counter.addr-out should walk 1..15, wrap to 0, continue; got {addr_values}"
    )
    # audio-out is count - 64 (signed-8).
    expected_audio = [v - 64 for v in expected_addr]
    assert audio_values == expected_audio, (
        f"Counter.audio-out should track count - 64; got {audio_values}"
    )


# ---------------------------------------------------------------------------
# Visual-block tests — VGA Timing, Color Bars, VGA Output.
#
# These don't go through synth.py (which is audio-only by design). They
# instantiate the block directly under an Amaranth Simulator and look at
# the signals each block exposes.
# ---------------------------------------------------------------------------
def _run_block_sim(block, signal_specs, ticks):
    """Step `block` through `ticks` clock cycles; return a dict of
    {name: list[int]} sampled per cycle from `signal_specs`.

    `signal_specs` is a dict {name: signal_attribute_path}, where the
    path is a sequence of attribute names off the block (e.g. for a
    nested submodule). We resolve each path and sample with ctx.get()
    every cycle. Mirrors the per-tick loop synth.synthesize uses.

    A dummy sync flop is added to the host module so the simulator has
    a `sync` domain to attach a clock to — needed for combinational
    blocks that don't have any `m.d.sync` of their own.
    """
    from amaranth import Module, Signal
    from amaranth.sim import Simulator

    m = Module()
    m.submodules.b = block
    # Anchor the sync domain — combinational blocks (Color Bars,
    # VGA Output, the boolean gates) have no internal flip-flops and
    # the simulator refuses to add a clock to a domain that doesn't
    # exist. One unused flop is the cheapest fix.
    _anchor = Signal()
    m.d.sync += _anchor.eq(~_anchor)
    sim = Simulator(m)
    sim.add_clock(1e-6)

    samples: dict[str, list[int]] = {name: [] for name in signal_specs}

    async def process(ctx):
        for _ in range(ticks):
            for name, sig in signal_specs.items():
                samples[name].append(ctx.get(sig))
            await ctx.tick()

    sim.add_testbench(process)
    sim.run()
    return samples


def test_vga_timing_produces_640x480_60hz_signals():
    """Run the VGA timing block for one full frame; assert the visible-
    high cycle count matches 640 × 480 = 307_200 and that hsync / vsync
    are active LOW (default high, brief LOW pulses) with the right
    number of pulses per frame."""
    from blocks.vga_timing import VgaTiming, H_TOTAL, V_TOTAL

    block = VgaTiming()
    # One full frame = H_TOTAL × V_TOTAL ticks (800 × 525 = 420_000).
    ticks = H_TOTAL * V_TOTAL
    samples = _run_block_sim(
        block,
        {
            "hsync": block.hsync,
            "vsync": block.vsync,
            "visible": block.visible,
        },
        ticks,
    )

    visible_high = sum(samples["visible"])
    assert visible_high == 640 * 480, (
        f"VGA Timing: expected 640*480 = {640 * 480} visible-high ticks "
        f"per frame; got {visible_high}"
    )

    # HSYNC is active LOW, normally high. One LOW window per scan line —
    # 525 scan lines per frame, so we should see 525 high→low transitions.
    h_falling = sum(
        1 for a, b in zip(samples["hsync"], samples["hsync"][1:]) if a == 1 and b == 0
    )
    assert h_falling == V_TOTAL, (
        f"VGA Timing: expected {V_TOTAL} HSYNC falling edges per frame; "
        f"got {h_falling}"
    )

    # VSYNC is active LOW; exactly ONE LOW window per frame.
    v_falling = sum(
        1 for a, b in zip(samples["vsync"], samples["vsync"][1:]) if a == 1 and b == 0
    )
    assert v_falling == 1, (
        f"VGA Timing: expected exactly 1 VSYNC falling edge per frame; "
        f"got {v_falling}"
    )


def test_color_bars_8_vertical_stripes():
    """Drive the Color Bars block with hand-set x values that fall in
    the middle of each of the 8 bars; assert the SMPTE 1-bit-per-channel
    palette comes out as expected.

    SMPTE bar order (left → right): white, yellow, cyan, green, magenta,
    red, blue, black. Each bar is 64 pixels wide (chosen so the bar
    index is x[6:9] — a free bit-slice, cheaper than an x/80 ladder).
    Sampling at the centre of each bar (32, 96, 160, ...) lets us
    verify the index → palette mapping precisely.
    """
    from amaranth import Module, Signal
    from amaranth.sim import Simulator
    from blocks.color_bars import ColorBars

    block = ColorBars()
    m = Module()
    m.submodules.b = block
    # Anchor sync (the block is purely combinational).
    _anchor = Signal()
    m.d.sync += _anchor.eq(~_anchor)
    sim = Simulator(m)
    sim.add_clock(1e-6)

    # Expected (R, G, B) per SMPTE bar (bars 0..7).
    expected = [
        (1, 1, 1),  # 0 white
        (1, 1, 0),  # 1 yellow
        (0, 1, 1),  # 2 cyan
        (0, 1, 0),  # 3 green
        (1, 0, 1),  # 4 magenta
        (1, 0, 0),  # 5 red
        (0, 0, 1),  # 6 blue
        (0, 0, 0),  # 7 black
    ]

    captured: list[tuple[int, int, int]] = []

    async def process(ctx):
        # Force visible high; sweep x through the centre of each bar.
        ctx.set(block.visible, 1)
        for bar_index in range(8):
            ctx.set(block.x, bar_index * 64 + 32)  # centre of the bar
            await ctx.tick()
            # Outputs are combinational; read them on the next tick so
            # the simulator has propagated `x` through the comb chain.
            await ctx.tick()
            captured.append(
                (ctx.get(block.r), ctx.get(block.g), ctx.get(block.b))
            )

        # Force visible LOW: all channels must be 0 regardless of x.
        ctx.set(block.visible, 0)
        ctx.set(block.x, 100)
        await ctx.tick()
        await ctx.tick()
        captured.append(
            (ctx.get(block.r), ctx.get(block.g), ctx.get(block.b))
        )

    sim.add_testbench(process)
    sim.run()

    for i, exp in enumerate(expected):
        assert captured[i] == exp, (
            f"Color Bars bar {i}: expected RGB={exp}, got {captured[i]}"
        )
    # Last sample is the visible=0 case: black on every channel.
    assert captured[-1] == (0, 0, 0), (
        f"Color Bars during blanking should be all-zero RGB; got {captured[-1]}"
    )


def test_vga_output_pass_through():
    """VGA Output is a pin-routing sink — no internal logic. Just
    verify it instantiates with the expected port set; the build.py
    wrapper is what actually wires them to physical pins."""
    from blocks.vga_output import VgaOutput

    block = VgaOutput()
    # 5 inputs, 0 outputs.
    assert set(block.input_ports.keys()) == {"r", "g", "b", "hsync", "vsync"}
    assert block.output_ports == {}
    # The block must elaborate without raising — even with no edges
    # wired to its inputs.
    from amaranth import Module, Signal
    from amaranth.sim import Simulator

    m = Module()
    m.submodules.b = block
    # Anchor sync (the block has no internal state).
    _anchor = Signal()
    m.d.sync += _anchor.eq(~_anchor)
    sim = Simulator(m)
    sim.add_clock(1e-6)

    async def process(ctx):
        # Drive each input to a known value, confirm the signal
        # carries it (the block is purely combinational so the
        # internal Signal IS the pin).
        ctx.set(block.r, 1)
        ctx.set(block.g, 0)
        ctx.set(block.b, 1)
        ctx.set(block.hsync, 0)
        ctx.set(block.vsync, 1)
        await ctx.tick()
        assert ctx.get(block.r) == 1
        assert ctx.get(block.g) == 0
        assert ctx.get(block.b) == 1
        assert ctx.get(block.hsync) == 0
        assert ctx.get(block.vsync) == 1

    sim.add_testbench(process)
    sim.run()


def test_pixel_range_window_comparator():
    """PixelRange(start=100, end=200) should output `inside`=1 only for
    pixel coordinates in [100, 200], and 0 elsewhere. We sweep a few
    representative coordinates and verify the boundary behavior is
    inclusive on both ends."""
    from amaranth import Module, Signal
    from amaranth.sim import Simulator
    from blocks.pixel_range import PixelRange

    block = PixelRange(start=100, end=200)
    m = Module()
    m.submodules.b = block
    # Anchor sync (the block is purely combinational).
    _anchor = Signal()
    m.d.sync += _anchor.eq(~_anchor)
    sim = Simulator(m)
    sim.add_clock(1e-6)

    # (pixel, expected_inside)
    cases = [
        (0, 0),
        (50, 0),
        (99, 0),
        (100, 1),  # inclusive lower bound
        (150, 1),
        (200, 1),  # inclusive upper bound
        (201, 0),
        (300, 0),
        (639, 0),
    ]
    captured: list[tuple[int, int]] = []

    async def process(ctx):
        for pixel, _expected in cases:
            ctx.set(block.pixel, pixel)
            await ctx.tick()
            await ctx.tick()
            captured.append((pixel, ctx.get(block.inside)))

    sim.add_testbench(process)
    sim.run()

    for (pixel, expected), (_p, got) in zip(cases, captured):
        assert got == expected, (
            f"PixelRange(start=100, end=200): pixel={pixel} expected "
            f"inside={expected}, got {got}"
        )


def test_solid_color_blue_drives_only_b():
    """SolidColor('blue') should hold r=0, g=0, b=1 forever — pure blue
    on the SMPTE 1-bit-per-channel palette. We tick a few cycles and
    verify all three channels stay at the expected constants."""
    from amaranth import Module, Signal
    from amaranth.sim import Simulator
    from blocks.solid_color import SolidColor

    block = SolidColor(color="blue")
    m = Module()
    m.submodules.b = block
    # Anchor sync (the block is purely combinational, no internal state).
    _anchor = Signal()
    m.d.sync += _anchor.eq(~_anchor)
    sim = Simulator(m)
    sim.add_clock(1e-6)

    captured: list[tuple[int, int, int]] = []

    async def process(ctx):
        for _ in range(5):
            await ctx.tick()
            captured.append(
                (ctx.get(block.r), ctx.get(block.g), ctx.get(block.b))
            )

    sim.add_testbench(process)
    sim.run()

    for sample in captured:
        assert sample == (0, 0, 1), (
            f"SolidColor('blue') should hold (R,G,B)=(0,0,1); got {sample}"
        )


def test_bus_split_breaks_8bit_value_into_bits():
    """Drive bus-in with 0b10101010 (170) and verify each output bit
    matches the expected position. bit-0 is the LSB (0), bit-1 is 1,
    bit-2 is 0, ... — alternating LSB-first per the binary layout."""
    from amaranth import Module, Signal
    from amaranth.sim import Simulator
    from blocks.bus_split import BusSplit

    block = BusSplit()
    m = Module()
    m.submodules.b = block
    # Anchor sync (the block is purely combinational).
    _anchor = Signal()
    m.d.sync += _anchor.eq(~_anchor)
    sim = Simulator(m)
    sim.add_clock(1e-6)

    captured: list[int] = []

    async def process(ctx):
        ctx.set(block.bus_in, 0b10101010)  # 170 — alternating from LSB up
        await ctx.tick()
        await ctx.tick()
        for i in range(8):
            captured.append(ctx.get(block.bits[i]))

    sim.add_testbench(process)
    sim.run()

    expected = [0, 1, 0, 1, 0, 1, 0, 1]
    assert captured == expected, (
        f"BusSplit on 0b10101010: expected {expected} (LSB-first); got {captured}"
    )


def test_bus_join_concats_bits_into_8bit_value():
    """Set bit-0=1, bit-2=1, bit-5=1 (all others 0) and verify the
    output is 0b00100101 = 37 (LSB-first concat). bit-0 → output[0]
    matches BusSplit's ordering exactly."""
    from amaranth import Module, Signal
    from amaranth.sim import Simulator
    from blocks.bus_join import BusJoin

    block = BusJoin()
    m = Module()
    m.submodules.b = block
    # Anchor sync (the block is purely combinational).
    _anchor = Signal()
    m.d.sync += _anchor.eq(~_anchor)
    sim = Simulator(m)
    sim.add_clock(1e-6)

    captured: list[int] = []

    async def process(ctx):
        # Bit pattern: bit-0 + bit-2 + bit-5 = 0b00100101 = 37.
        ctx.set(block.bits[0], 1)
        ctx.set(block.bits[1], 0)
        ctx.set(block.bits[2], 1)
        ctx.set(block.bits[3], 0)
        ctx.set(block.bits[4], 0)
        ctx.set(block.bits[5], 1)
        ctx.set(block.bits[6], 0)
        ctx.set(block.bits[7], 0)
        await ctx.tick()
        await ctx.tick()
        captured.append(ctx.get(block.bus_out))

        # Flip to all-ones — output should be 255.
        for i in range(8):
            ctx.set(block.bits[i], 1)
        await ctx.tick()
        await ctx.tick()
        captured.append(ctx.get(block.bus_out))

    sim.add_testbench(process)
    sim.run()

    assert captured[0] == 0b00100101, (
        f"BusJoin LSB-first: expected 0b00100101 (37); got {captured[0]}"
    )
    assert captured[1] == 0xFF, (
        f"BusJoin all-ones: expected 255; got {captured[1]}"
    )


def test_counter_smoke_through_full_pipeline(run_synth, wav_samples):
    """End-to-end: drive the new logic blocks together (Gate → AND with
    a NOT-ed copy of itself = always-low; Counter → Output), confirm the
    full pipeline runs and produces a non-empty WAV without errors."""
    graph = {
        "nodes": [
            {"id": "g", "type": "gate", "data": {"rate_hz": 4, "duty_pct": 50}},
            {"id": "n", "type": "not", "data": {}},
            {"id": "a", "type": "and", "data": {}},
            {"id": "c", "type": "counter", "data": {"max_value": 4}},
            _output_node(),
        ],
        "edges": [
            # Always-low signal: g AND (NOT g) = 0.
            _edge("e1", "g", "n", "gate-out", "gate-in"),
            _edge("e2", "g", "a", "gate-out", "in-1"),
            _edge("e3", "n", "a", "gate-out", "in-2"),
            # AND output ignored — Counter drives the audio bus.
            _edge("e4", "g", "c", "gate-out", "clock"),
            _edge("e5", "c", "out", "audio-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    # Counter(max_value=4) at 4 Hz over 1 s visits 4 states in the
    # range 0..3, so the audio output should sit at {-64, -63, -62, -61}*64.
    distinct = set(samples)
    expected = {(v - 64) * 64 for v in range(4)}
    assert distinct == expected, (
        f"Mixed logic graph: counter should cycle through 4 values × 64; "
        f"got {sorted(distinct)}"
    )


# ---------------------------------------------------------------------------
# CPU primitive tests — Adder, Register, RAM, ROM (Sprint 17, ADR-002).
#
# These blocks operate on 8-bit unsigned data + 4-bit unsigned addresses
# rather than 8-bit signed audio, so they don't compose cleanly with the
# audio-bus Output block (a Sprint 18 "Reinterpret" block could bridge
# the two). Tests drive each block directly under an Amaranth Simulator
# and check the combinational / synchronous behavior in isolation.
# ---------------------------------------------------------------------------
def test_adder_100_plus_50_is_150_with_carry_clear():
    """Adder is combinational. Hand-drive in-a=100, in-b=50; expect
    sum-out=150, carry-out=0. Then drive 200+100 = 300 (overflow);
    expect sum-out=44 (300 mod 256), carry-out=1."""
    from amaranth import Module, Signal
    from amaranth.sim import Simulator
    from blocks.adder import Adder

    block = Adder()
    m = Module()
    m.submodules.b = block
    _anchor = Signal()
    m.d.sync += _anchor.eq(~_anchor)
    sim = Simulator(m)
    sim.add_clock(1e-6)

    captured: list[tuple[int, int]] = []

    async def process(ctx):
        ctx.set(block.in_a, 100)
        ctx.set(block.in_b, 50)
        await ctx.tick()
        await ctx.tick()
        captured.append((ctx.get(block.sum_out), ctx.get(block.carry_out)))
        # Overflow case: 200 + 100 = 300 → sum_out=44, carry_out=1.
        ctx.set(block.in_a, 200)
        ctx.set(block.in_b, 100)
        await ctx.tick()
        await ctx.tick()
        captured.append((ctx.get(block.sum_out), ctx.get(block.carry_out)))

    sim.add_testbench(process)
    sim.run()

    assert captured[0] == (150, 0), (
        f"Adder(100, 50): expected sum=150, carry=0; got {captured[0]}"
    )
    assert captured[1] == (44, 1), (
        f"Adder(200, 100): expected sum=44 (300 mod 256), carry=1; got {captured[1]}"
    )


def test_register_latches_on_write_enable_edge():
    """Drive data-in=42 with write-enable high for one clock — the next
    cycle, data-out should read 42 and continue reading 42 even after
    write-enable drops low and a new (ignored) data-in is presented."""
    from amaranth import Module, Signal
    from amaranth.sim import Simulator
    from blocks.register import Register

    block = Register()
    m = Module()
    m.submodules.b = block
    sim = Simulator(m)
    sim.add_clock(1e-6)

    captured: list[int] = []

    async def process(ctx):
        # Pre-state: write-enable low, data-out should be 0 (reset).
        ctx.set(block.write_enable, 0)
        ctx.set(block.data_in, 0)
        await ctx.tick()
        captured.append(ctx.get(block.data_out))  # 0
        # Pulse write-enable for one clock with data-in=42.
        ctx.set(block.data_in, 42)
        ctx.set(block.write_enable, 1)
        await ctx.tick()
        # Latch settles the next cycle.
        await ctx.tick()
        captured.append(ctx.get(block.data_out))  # 42
        # Drop write-enable, change data-in to 99 — data-out must stay 42.
        ctx.set(block.write_enable, 0)
        ctx.set(block.data_in, 99)
        await ctx.tick()
        await ctx.tick()
        captured.append(ctx.get(block.data_out))  # 42 still
        # Latch a new value (99) to confirm the gate still works.
        ctx.set(block.write_enable, 1)
        await ctx.tick()
        await ctx.tick()
        captured.append(ctx.get(block.data_out))  # 99

    sim.add_testbench(process)
    sim.run()

    assert captured[0] == 0, f"Register pre-reset: expected 0; got {captured[0]}"
    assert captured[1] == 42, f"Register after write-enable=1, data=42: expected 42; got {captured[1]}"
    assert captured[2] == 42, f"Register holds value when write-enable is low: expected 42; got {captured[2]}"
    assert captured[3] == 99, f"Register latches new value 99 on next write-enable: got {captured[3]}"


def test_ram_round_trip_at_address_5():
    """Write 99 to RAM cell 5 with write-enable=1, then read it back
    with write-enable=0 and a fresh data-in (which must be ignored).
    Verify a different cell (3) still reads zero — proves the address
    decode worked rather than every cell getting the value."""
    from amaranth import Module, Signal
    from amaranth.sim import Simulator
    from blocks.ram import RAM

    block = RAM()
    m = Module()
    m.submodules.b = block
    sim = Simulator(m)
    sim.add_clock(1e-6)

    captured: dict[str, int] = {}

    async def process(ctx):
        # Write 99 to cell 5.
        ctx.set(block.addr, 5)
        ctx.set(block.data_in, 99)
        ctx.set(block.write_enable, 1)
        await ctx.tick()
        await ctx.tick()
        # Drop write-enable, present a different data-in to make sure
        # the readback isn't just echoing the current input.
        ctx.set(block.write_enable, 0)
        ctx.set(block.data_in, 7)
        await ctx.tick()
        await ctx.tick()
        captured["cell_5"] = ctx.get(block.data_out)
        # Read a cell we never wrote — should still be the initial 0.
        ctx.set(block.addr, 3)
        await ctx.tick()
        await ctx.tick()
        captured["cell_3"] = ctx.get(block.data_out)

    sim.add_testbench(process)
    sim.run()

    assert captured["cell_5"] == 99, (
        f"RAM cell 5 should read back 99 after write; got {captured['cell_5']}"
    )
    assert captured["cell_3"] == 0, (
        f"RAM cell 3 (never written) should read 0; got {captured['cell_3']}"
    )


def test_rom_returns_initialised_contents_at_each_address():
    """Instantiate ROM with the first 8 Fibonacci numbers (padded with
    zeros to 16 entries). Sweep the address through all 16 entries and
    verify each readback matches the stored contents."""
    from amaranth import Module, Signal
    from amaranth.sim import Simulator
    from blocks.rom import ROM

    program = [1, 1, 2, 3, 5, 8, 13, 21]  # padded inside ROM to 16
    block = ROM(contents=program)
    m = Module()
    m.submodules.b = block
    _anchor = Signal()
    m.d.sync += _anchor.eq(~_anchor)
    sim = Simulator(m)
    sim.add_clock(1e-6)

    captured: list[int] = []

    async def process(ctx):
        for addr in range(16):
            ctx.set(block.addr, addr)
            await ctx.tick()
            await ctx.tick()
            captured.append(ctx.get(block.data_out))

    sim.add_testbench(process)
    sim.run()

    expected = program + [0] * (16 - len(program))
    assert captured == expected, (
        f"ROM contents readback mismatch: expected {expected}, got {captured}"
    )


def test_rom_clamps_oversize_values_to_byte_range():
    """ROM's constructor should clamp each entry to 0..255 (defensive
    against renderer-side validation gaps) and pad with zeros. We
    inspect the normalised contents attribute directly rather than
    elaborating the block — the test is about the constructor's input
    sanitiser, not the synthesised memory."""
    from blocks.rom import ROM

    # Allocate-and-discard pattern fires Amaranth's UnusedElaboratable
    # warning by default. Suppressing locally rather than instantiating
    # an enclosing Module just for the assertion.
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=Warning)
        block = ROM(contents=[300, -5, 200])
        assert block.contents == [255, 0, 200] + [0] * 13, (
            f"ROM should clamp 300→255, -5→0, and pad to 16 entries; got {block.contents}"
        )


def test_cpu_accumulator_pipeline_runs(run_synth, wav_samples):
    """End-to-end smoke: drive a ROM-fed accumulator alongside an idle
    audio path so the four new primitives elaborate together through the
    full synth pipeline.

    Layout:
        Counter.addr-out → ROM.addr
        ROM.data-out     → Adder.in-a       (per-cycle increment)
        Register.data-out → Adder.in-b      (running sum)
        Adder.sum-out    → Register.data-in
        Gate.gate-out    → Register.write-enable
        Gate.gate-out    → Counter.clock
        RAM (unconnected accumulator scratch, also drives the build path)
        Constant(value=0) → Output.audio-in  (silence — accumulator is
                                              CPU-domain, no audio path)

    Per-block correctness is asserted by the individual tests above;
    this test only verifies "all 4 new primitives + the Counter
    extension instantiate, wire, and run through synth.py without
    raising." Sample assertion is just "WAV is the expected silence."
    """
    graph = {
        "nodes": [
            {"id": "g", "type": "gate", "data": {"rate_hz": 100, "duty_pct": 50}},
            {"id": "cnt", "type": "counter", "data": {"max_value": 16}},
            {"id": "rom", "type": "rom", "data": {"contents": [1] * 16}},
            {"id": "add", "type": "adder", "data": {}},
            {"id": "reg", "type": "register", "data": {}},
            {"id": "ram", "type": "ram", "data": {}},
            {"id": "k_audio", "type": "constant", "data": {"value": 0}},
            _output_node(),
        ],
        "edges": [
            _edge("e1", "g", "cnt", "gate-out", "clock"),
            _edge("e2", "cnt", "rom", "addr-out", "addr"),
            _edge("e3", "rom", "add", "data-out", "in-a"),
            _edge("e4", "reg", "add", "data-out", "in-b"),
            _edge("e5", "add", "reg", "sum-out", "data-in"),
            _edge("e6", "g", "reg", "gate-out", "write-enable"),
            # RAM in the same graph so the build path elaborates all 4
            # new primitives. Wire it to the accumulator's output so it
            # can store the running sum at address 0.
            _edge("e7", "cnt", "ram", "addr-out", "addr"),
            _edge("e8", "reg", "ram", "data-out", "data-in"),
            _edge("e9", "g", "ram", "gate-out", "write-enable"),
            # Silent audio path so the synth pipeline has an Output sink.
            _edge("e10", "k_audio", "out", "audio-out", "audio-in"),
        ],
    }
    samples = wav_samples(run_synth(graph, duration_s=1))
    assert all(s == 0 for s in samples), (
        f"CPU primitives pipeline shouldn't disturb the silent audio path; "
        f"got non-zero samples: min={min(samples)}, max={max(samples)}"
    )
