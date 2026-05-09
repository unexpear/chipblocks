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
