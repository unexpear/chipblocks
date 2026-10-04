# Saved simulation tests

Open **Tools → Tests and preflight** in a circuit project. Tests run on private
copies; their results never replace the live canvas simulation.

## Make and rerun a check

1. Choose an analysis and a device terminal (or a digital block and output).
2. Enter the expected value, its absolute tolerance, and a reference or formula.
   For time response, choose the duration, step, and exact sample time. For AC,
   choose the input source and frequency. Digital checks use whole cycles.
3. Save the check, then press its **Run** button. Saving does not certify a result.
4. Inspect expected versus actual, the requested coordinate, measurement formula,
   input provenance, warnings, and affected parts. **Select affected parts** returns
   to the relevant canvas objects.
5. Save the project normally to keep its test definitions. Reopening retains the
   inputs and expectations, not a cached PASS. Rerun against the reopened design.

Circuit and expectation changes make an existing report stale. Merely selecting
an object does not. Voltage and AC output probes follow saved terminal identities,
not regenerated internal net numbers; deleting a probed terminal requires repairing
the check rather than silently pointing it somewhere else.

## Existing digital waveforms

Tests captured in the Trace inspector appear under **Existing block waveforms**.
Import copies every output/cycle into the unified suite and leaves the original
unchanged. Reimport replaces the same imported definition instead of making duplicates.
Incomplete waveforms, extra cycles, unknown signals, and values outside unsigned input
widths are refused. Legacy expectations are marked as not independently validated;
matching a captured answer is a regression check, not proof of physical correctness.

## Advanced checks

**Advanced definition** edits the validated saved definition. Start with a quick
check to obtain the correct signal and stable terminal probe, then adjust its
assertions. Each assertion has its own expected value/range and provenance.

| Check | Measurement | Expected unit |
| --- | --- | --- |
| Waveform samples | Several `point` assertions at explicit coordinates | Signal unit |
| Sampled limits | `minimum` or `maximum`, with `from` and `to` | Signal unit |
| Rising/falling threshold | `crossing`, window, `threshold`, `direction` | `second` or `hertz` |
| Settling | `settling`, window, `finalValue`, absolute `band` | `second` |
| Signed energy | `integral` of a `power:DEVICE` signal over a time window | `joule` |
| Net current balance | `kcl` quick check, optionally a bounded window | `ampere` |
| Total terminal power balance | `power-balance` transient signal | `watt` (or `joule` when integrated) |
| Thermal limit | DC temperature quick check, range expectation | `degree_celsius` |
| AC amplitude / dB / phase | `gain:NET`, `gainDb:NET`, or `phaseDeg:NET`, AC output probe | `dimensionless`, `decibel`, or `degree` |

A near expectation uses `absolute + relative * abs(expected)` as its tolerance.
A range uses inclusive `minimum` and `maximum`. Phase near-comparisons use the
shortest angular difference. Waveform/window endpoints must be recorded exactly:
there is no silent extrapolation. Crossing interpolation reports its bracket.
Sampled extrema do not certify hidden between-sample peaks. Settling certifies only
the observed window and requires samples after entry into the band.

Signed device power is the sum of terminal voltage times current **into** each
terminal. Missing currents invalidate the check; they are never treated as zero.
Source delivery is negative. A near-zero summed terminal-power residual is not,
by itself, an independent validation of capacitor/inductor stored energy. Use an
independent energy formula/reference as well. Integration uses signed trapezoidal
quadrature, with an explicit tolerance for the chosen sampling and solver step.

## What a result certifies

- DC/AC/transient tests expand circuit blocks into their physical components and
  use the existing named electrical engines. They include drawn-wire geometry and
  the existing light-casting calculation. They do not replay the live mixed-signal
  dispatcher or certify mixed-signal timing.
- Digital tests isolate the selected block, hold the saved inputs, and start
  registers low before clocking. Missing held inputs default to zero, as in Trace.
  Power-up-dependence and settlement warnings remain visible.
- Preflight checks reference nets, terminal membership, identities, connectivity,
  and direct source shorts. A structural connection is not proof of conduction or
  electrical safety. Solver/support checks are still required.
- Unsupported or incomplete analyses cannot pass. AC reports ignored declared
  values, including source internal resistance. The transient capacitor model does
  not read declared ESR/dissipation factor; such tests are refused with repair
  guidance. Do not delete real loss just to make a check pass. A known constant ESR
  may instead be represented by an explicit series resistor; frequency-dependent
  loss needs a suitable model/analysis, not an arbitrary constant.
- AC discloses its 1 nS numerical ground shunt. Zero gain has no defined phase or
  finite decibel value, so those checks remain unavailable.
- Saved suites are limited to 256 tests, 1,024 assertions per test, 256 digital cycles,
  and 512 explicit AC frequencies. Electrical runs use existing solver size/time
  limits. AC checks deadlines between synchronous matrix solves, not mid-solve;
  this is not a hard real-time responsiveness guarantee.

No game implementation is used as an authority for equations. Expected values
should come from cited device data, independent derivations, measurements with
stated uncertainty, or a clearly labeled regression capture.

Implementation and verification evidence: [Phase 4 record](PHASE-4-TESTING-PLAN.md).
