# Research Notes: LiteX Audio Starting Point (for Sprint 1 Item 6)

> Generated: 2026-05-07 · For SPRINT-1.md Item 6 ("LiteX audio simulation → WAV")

## TL;DR

**Sprint 1 Item 6 is a ~40-line Python script. No Verilator. No FPGA. No I2S codec.**

Use [`litex-hub/fpga_101/lab004/pwm.py`](https://github.com/litex-hub/fpga_101/blob/master/lab004/pwm.py) as the starting design. It's a tiny Migen PWM module with an existing simulation testbench. PWM toggling at audio rate IS a square wave. The work is: replace the testbench's VCD dump with a Python `wave`-module post-processor that captures samples and writes a `.wav` file the user can play.

## Ranked options

### 1. (Recommended) `litex-hub/fpga_101/lab004/pwm.py`
- URL: https://github.com/litex-hub/fpga_101/blob/master/lab004/pwm.py
- Tiny self-contained Migen `PWM` module with a CSR interface
- Existing testbench harness uses `run_simulation` and dumps VCD
- PWM = square wave, so the design is essentially done
- Closest "official" LiteX tutorial to what we want

### 2. (Fallback) Bare Migen counter + Python `wave` module
- ~30 lines of Migen for a `SquareWave` module (counter + comparator)
- Drive with `migen.sim.run_simulation`
- No LiteX SoC required, no Verilator required
- Only dependency: `pip3 install migen`

### 3. (Avoid for Sprint 1) Real I2S cores
- `litex/litex/soc/cores/i2s.py` and `antmicro/litex-vexriscv-i2s-demo`
- Assume an Arty FPGA + a CODEC chip
- Overkill for proving the concept; partially impossible in pure simulation

## How option #1 works (3 lines)

The `_PWM` class is a counter that compares against `width` and `period`; output is high while `count < width`. The `PWM` wrapper exposes `enable`/`width`/`period` as CSRs. The included testbench calls `run_simulation(dut, generator, vcd_name=...)`, advances clocks with `yield`, and reads `dut.pwm` each cycle.

## What we need to add (Sprint 1 Item 6)

1. **Replace** the VCD dump in the testbench with a Python list: each clock cycle, `sample = (yield dut.pwm)` and append.
2. **Decimate** from sim clock (e.g. 1 MHz) down to 44100 Hz by sampling every Nth cycle. Or pick a sim clock that divides evenly into 44100.
3. **Write** samples to disk with stdlib `wave` + `struct.pack('<h', ...)`. No extra dependencies.
4. **Configure** `width = period/2` for a clean 50%-duty square wave. (For sine, replace the comparator with a small `Memory` ROM lookup. Out of scope for Sprint 1.)

Final deliverable: a `.wav` file the user can play in any media player.

## Gotchas

- **No FPGA target needed.** `run_simulation` is pure Python — no Verilator, no Vivado, no toolchain pain. This is the killer reason to pick #1 or #2 over `litex_sim`.
- `litex_sim` (the SoC simulator) requires Verilator installed in WSL2 (`apt install verilator`) and can be fiddly. **Skip for Sprint 1.**
- LiteX install on WSL2: `pip3 install migen` is the only dep for option #2; for option #1, use the official `litex_setup.py` script. Works fine on Ubuntu/WSL2.
- Don't `yield` inside a tight Python loop without cycle ticks — it'll hang the simulator.

## Implication for SPRINT-1.md

- **Item 5 ("LiteX install + Hello World")** can stay but is simpler than I originally estimated (~1–3 hrs) since we know exactly what to install and what example to run.
- **Item 6 ("LiteX audio simulation → WAV")** is dramatically simpler than I estimated (~2–4 hrs instead of 4–6) because the design is already written and the testbench harness is in place. Just gut-and-replace the output side.
- **Could even skip Item 5** entirely and use option #2 (bare Migen) — buys ~2 hrs but moves us further from the "real" tech stack. Not recommended; better to install LiteX now since we'll need it eventually.

## Sources
- [fpga_101 PWM lab](https://github.com/litex-hub/fpga_101/blob/master/lab004/pwm.py)
- [Migen simulation docs](https://github.com/m-labs/migen/blob/master/doc/simulation.rst)
- [LiteX SoC Simulator wiki](https://github.com/enjoy-digital/litex/wiki/SoC-Simulator)
- [LiteX I2S core (reference only — too complex for Sprint 1)](https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/i2s.py)
- [antmicro litex-vexriscv-i2s-demo (reference only)](https://github.com/antmicro/litex-vexriscv-i2s-demo)
