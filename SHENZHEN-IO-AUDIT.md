# SHENZHEN I/O Deep-Dive Audit

**Audit date:** 2026-09-14  
**Scope:** Installed Windows build, recovered executable structure and code, installed English manual, and comparison with the current ChipBlocks implementation.  
**Change control:** No ChipBlocks source, tests, fixtures, or existing documentation were edited for this audit. This file is the only repository artifact added by this audit.

## Executive verdict

SHENZHEN I/O is a strong reference for ChipBlocks' digital and programmable-control layers, not for continuous electronics physics. The installed build contains a deterministic, discrete simulation engine with:

- typed terminal domains (`Digital`, `Analog`, `Audio`, `XBus`, `NonBlockingXBus`, and `Display`);
- geometric board traces that are flood-filled into connected nets;
- datasheet-defined chip dimensions, pins, registers, program limits, and terminal behavior;
- a small instruction set with bounded integer arithmetic and explicit blocking/sleep semantics;
- cycle-indexed timing diagrams, auxiliary traces, LCD state, and exact expected-vs-actual comparison;
- a custom-level compiler that loads puzzle specifications and test data from Lua tables;
- a code editor with explicit caret/selection state and keyboard editing behavior.

The most useful lesson for ChipBlocks is observability: make each programmable or digital block explain its pin contract, timing contract, test waveform, state changes, and failure location. The game's integer signal model must not replace ChipBlocks' voltage, current, charge, thermal, magnetic, and frequency-domain models.

## Evidence and provenance

### Installed build

- Install directory: `D:\SteamLibrary\steamapps\common\SHENZHEN IO`
- Main executable: `D:\SteamLibrary\steamapps\common\SHENZHEN IO\Shenzhen.exe`
- Executable type: 32-bit managed PE/.NET assembly; imports `mscoree.dll:_CorExeMain`.
- Main executable SHA-256: `A0DFE8E1E91B6633C3BA00210762EC0D7E6786AB9C2C7912D9C9AFDD654D98F9`
- Main managed dependency: `D:\SteamLibrary\steamapps\common\SHENZHEN IO\MoonSharp.Interpreter.dll`
- MoonSharp SHA-256: `1DB76110F21698639F55D28E21BDDB536C0C497CEB741DEE49FEDCCA9BCD1588`
- Installed manual: `D:\SteamLibrary\steamapps\common\SHENZHEN IO\Content\SHENZHEN IO Manual (English).pdf`
- Extracted manual text used for checking: `C:\Users\micha\Desktop\shenzhen-manual.txt`

### Recovery method

The executable was decompiled with ILSpy command-line 11.0.0.9375 into:

`C:\Users\micha\Desktop\shenzhen-decompile-20260914`

The decompiler produced 235 files. Many internal identifiers remain obfuscated, so this report treats the output as a recovered representation of the installed build, not as the original source. Claims below are limited to behavior directly visible in the recovered code or installed manual.

## Recovered architecture

### Board, chips, pins, and nets

`Chip.cs:1-241` stores a chip's type, board position, pins, program/data state, and diagnostic/runtime state. `ChipType.cs:1-94` and `ChipTypes.cs:256-1724` define built-in chip metadata, including dimensions, pin properties, registers, and type-specific limits. The recovered static table contains 66 built-in type slots (`ChipTypes.cs:1711-1722`).

`TerminalType.cs` defines six terminal domains:

```text
Digital
Analog
Audio
XBus
NonBlockingXBus
Display
```

`TerminalDirection.cs` defines `Input` and `Output`. The manual gives the user-facing distinction for the two microcontroller interfaces:

- simple I/O: continuous levels from 0 to 100;
- XBus: discrete packets from -999 to 999;
- simple I/O reads and writes do not wait for the other side;
- XBus transfers only when a reader and writer are both attempting the operation; otherwise the operation blocks.

`Trace.cs` is a flags enum with `Right`, `Up`, `Left`, `Down`, and `Exists`. `TraceNet.cs:1-45` stores the connected pins, board trace cells, and net state. `Simulation.cs:321-418` builds nets, maps pins, and checks invalid connections, same-chip shorts, and mixed input/output conditions. `Simulation.cs:564-630` performs the grid flood fill, following directional trace bits and special vertically aligned board paths.

This is a physical board-routing model rather than a generic named-wire graph. A connection exists because board cells and chip pin locations are connected by trace geometry.

### Discrete simulation engine

`Simulation.cs:259-425` initializes a solution, maps puzzle terminals to actual pins, creates missing terminal chips, builds trace nets, validates the board, compiles programmable chips, and initializes runtime state.

`Simulation.cs:632-767` transfers puzzle input timing data into input pins, propagates output values into output timing diagrams, and records display/LCD state. `Simulation.cs:769-1104` evaluates built-in chip behaviors and terminal values.

The programmable-chip interpreter is in `Simulation.cs:1105-1437`. The recovered implementation includes:

- register reads/writes for `NULL`, `X0-X3`, `P0-P1`, `ACC`, and `DAT`;
- `MOV`, `ADD`, `SUB`, `MUL`, `DGT`, `DST`, and `NOT`;
- label jumps with `JMP`;
- conditional tests `TEQ`, `TGT`, `TLT`, and `TCP`;
- `SLP` time-unit sleeping;
- `SLX` waiting for external XBus data;
- `GEN` timing/clock generation behavior;
- blocked reads/writes and per-chip execution state;
- integer saturation through the allowed `-999` to `999` range.

`Simulation.cs:1419-1437` determines when all programmable chips are sleeping and no test/clock condition remains active. `Simulation.cs:1454-1623` contains the register and pin access helpers and label resolution.

### Compiler and language contract

`Compiler.cs:81-149` contains the instruction descriptor table. The recovered instruction set is:

```text
NOP  MOV  ADD  SUB  MUL  DST  DGT  NOT
JMP  TEQ  TGT  TLT  TCP  SLP  SLX  GEN
```

`Compiler.cs:153-165` maps register names to the register enum. `Compiler.cs:168-433` parses source lines, strips `#` comments, recognizes labels, validates label characters and duplicate labels, handles `+`, `-`, and `@` prefixes, parses operands, checks register availability, and parses invariant-culture integers.

The installed manual independently confirms the language contract:

- labels come first and end with `:`;
- comments begin with `#`;
- `+` and `-` conditionally enable or disable instructions after a test;
- instructions with no prefix always execute;
- integer operands are bounded to `-999` through `999`;
- `ACC` is the arithmetic target;
- `DAT`, pin registers, and `NULL` are model-dependent;
- arithmetic saturates rather than wrapping;
- sleeping consumes no power, and active instruction execution contributes to power use.

### Timing diagrams and tests

`TimingDiagram.cs:27-47` stores a fixed cycle count, primary `short[]` values, auxiliary per-cycle `Dictionary<int, short[]>` traces, and per-cycle `LcdState` values.

`TimingDiagram.cs:64-122` appends digital levels, generated analog-like waveforms, and LCD state over time. `TimingDiagram.cs:142-165` stores auxiliary trace values with a maximum trace length of 74 samples. `TimingDiagram.cs:167-199` compares two diagrams by:

1. requiring equal cycle lengths;
2. comparing the primary value at each compared cycle;
3. comparing every auxiliary trace array and its length;
4. comparing LCD state when both sides provide it.

`Simulation.cs:512-520` creates the output timing diagrams from puzzle specifications. `Simulation.cs:632-767` fills them while the simulation runs. `Puzzles.cs` contains many generated, deterministic timing specifications, including square waves, periodic patterns, threshold tests, and multi-output relationships.

`CustomLevelCompiler.cs:430-656` loads custom level specifications through MoonSharp. `CustomLevelCompiler.cs:658-694` converts Lua tables into 60-cycle `TimingDiagram` objects for digital or non-digital terminal types. The level data model contains terminals, parts, code, timing diagrams, descriptions, and metadata (`CustomLevelCompiler.cs:244-263`).

This is a real test contract rather than a visual-only waveform: the expected timing data is part of the puzzle specification and is compared by the simulation.

### Editor and debugging behavior

The code editor is implemented in `CodeEditorWidget.cs`.

- `CodeEditorWidget.cs:14-93` maintains two caret positions, selection state, and a timed cursor state.
- `CodeEditorWidget.cs:110-123` exposes the editor input path.
- `CodeEditorWidget.cs:123-609` handles text insertion, deletion, selection, cursor movement, line navigation, indentation-related editing, and keyboard modifiers through SDL input state.
- `CodeEditorWidget.cs:609-667` contains cursor rendering helpers and text-position conversion.
- `CodeEditorWidget.cs:662-667` exposes selection/cursor state to the game layer.

`GameLogic.cs:2275-2290`, `GameLogic.cs:2912-2924`, and `GameLogic.cs:3042-3051` connect the editor to chip source text, compilation, and simulation state. `GameLogic.cs:1274-1300` rebuilds trace visualizations from `TraceNet` state and uses the simulation's pin/net state to show active connectivity.

I found evidence for source editing, selection, compilation feedback, active runtime state, and trace visualization. I did **not** find a stable recovered API proving a conventional breakpoint or step-over debugger, so this report does not claim that SHENZHEN I/O provides one.

### Solution persistence and scoring

`Solution.cs:66-112` stores puzzle identity, board state, trace grid, chips, nets, undo history, and solution metrics. `Solution.cs:191-230` constructs a solution from puzzle parts and trace cells; `Solution.cs:207-247` loads serialized solutions; `Solution.cs:247-360` serializes board and chip data.

The solution object exposes aggregate metrics over chip type properties, program/data storage, non-empty program lines, and non-programmable parts (`Solution.cs:129-189`). The exact metric labels are obfuscated in this recovered build, so the report does not assign user-facing names to those fields.

`ScoreManager.cs` uses Steam leaderboards with a keep-best upload policy. This is a progression/benchmark layer above the deterministic simulation and does not change circuit semantics.

## Comparison with current ChipBlocks

### Where ChipBlocks already matches or exceeds SHENZHEN I/O

- `src\renderer\blocks.ts:22-107` already models reusable circuit blocks, external ports, power-pin roles, and drive kinds including push-pull, open-collector, and tri-state.
- `src\renderer\block-tests.ts:20-80` already runs digital blocks for a fixed number of cycles, compares expected output arrays, and reports failures by cycle and signal.
- `src\renderer\run-trace.ts:1-257` already records per-cycle values, settle status, gate-sweep depth, register changes, and anomalies such as oscillation, slow paths, pulses, and power-up dependence.
- `src\renderer\causal-replay.ts:1-260` already maps digital transitions and transient net/current transitions back to source blocks, terminals, nets, and diagnostics.
- `src\renderer\net-inspector.ts:10-171` already identifies drivers, loads, passives, contention, undriven nets, current, voltage drop, wire length, and resistance.
- `src\renderer\timing-panel.tsx:8-90` already reports critical paths, logic depth, maximum clock frequency, setup slack, and hold violations.
- ChipBlocks has a materially broader physical scope: DC MNA/Newton solving, backward-Euler transients, AC analysis, device models, electro-thermal feedback, magnetic components, scopes, meters, math views, and PCB/FPGA tooling. SHENZHEN I/O does not provide a continuous voltage/current/charge/temperature/frequency-domain authority for those phenomena.

### Where SHENZHEN I/O is still a useful reference

1. **Pin contracts:** Add a datasheet-style view for each digital or programmable block showing domain, direction, drive behavior, units/range, timing behavior, and unavailable registers/features.
2. **Protocol typing:** Make incompatible digital domains and handshake requirements explicit. ChipBlocks has pin drive roles, but the inspected block model does not expose one unified SHENZHEN-like contract for value domain plus blocking/non-blocking transfer semantics.
3. **Expected waveforms:** Extend the existing block-test UI toward a compact input/actual/expected waveform table with the first failing cycle highlighted. Keep exact integer comparison for digital blocks and use physically appropriate tolerances/units for analog and transient tests.
4. **State visibility:** Surface register/state changes beside output transitions. The existing `run-trace` and `causal-replay` data already contains the needed structure; the SHENZHEN lesson is to make it the primary debugging view.
5. **Datasheet-authored tests:** Treat a block's pin contract, legal values, timing limits, and test vectors as one inspectable artifact instead of scattering them across editor panels and test files.
6. **Control-flow editor, if added later:** Borrow SHENZHEN's small language, explicit operand rules, selection/caret behavior, and compiler diagnostics only for programmable control blocks. Do not use its discrete integer runtime as a substitute for ChipBlocks' analog solver.

### What not to copy

- Do not reinterpret SHENZHEN's `0-100` simple I/O levels as volts.
- Do not replace physical nets with generic signal names where wire geometry, impedance, current, or voltage drop matter.
- Do not make analog tests compare integer arrays when the correct contract is a solver status, unit-bearing waveform, tolerance, or energy/conservation check.
- Do not use game score metrics as a proxy for electrical correctness.
- Do not infer real component equations from SHENZHEN's discrete chip behaviors; use cited electronics references and ChipBlocks' own solver tests.

## Audit findings

### Confirmed strengths

- The reference is not merely a visual block editor; the installed executable contains a functioning compiler, discrete runtime, geometric connectivity engine, timing-diagram comparator, and data-driven level compiler.
- The manual and recovered code agree on the important programming semantics: typed interfaces, bounded values, conditional execution, sleep/blocking, arithmetic saturation, and datasheet-dependent resources.
- Timing tests are deterministic and include more than a single output bit: auxiliary traces and LCD state are part of comparison.
- The design intentionally couples editor, datasheet, puzzle specification, simulator, and scoring around a small inspectable machine model.

### Limits and uncertainty

- The build is obfuscated; internal method names and some numeric chip-type IDs are not reliable user-facing names.
- The report does not claim the original source code was recovered.
- Some editor rendering and UI labels are routed through hashed/localized string lookups; behavior was reported only where control flow and data structures made it unambiguous.
- No executable modification, patching, or runtime instrumentation was performed.
- No ChipBlocks source or existing documentation was changed.

## Recovered files

Primary decompilation evidence:

- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\Simulation.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\Compiler.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\Chip.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\ChipType.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\ChipTypes.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\Pin.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\Trace.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\TraceNet.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\TimingDiagram.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\Solution.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\CustomLevelCompiler.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\CodeEditorWidget.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\GameLogic.cs`
- `C:\Users\micha\Desktop\shenzhen-decompile-20260914\ScoreManager.cs`

Reference material:

- `D:\SteamLibrary\steamapps\common\SHENZHEN IO\Content\SHENZHEN IO Manual (English).pdf`
- `D:\SteamLibrary\steamapps\common\SHENZHEN IO\Content\strings.csv`

