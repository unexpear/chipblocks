# CRUMB Audit

## Audit status

**Complete.** This is a read-only audit of the installed CRUMB build. No ChipBlocks application source or documentation was edited for this audit.

## Audit scope

The audit inspected the installed Windows build at:

- `D:\SteamLibrary\steamapps\common\CRUMB`
- Unity version: `2022.1.16f1 (7321c9670bc2)`
- Executable: `D:\SteamLibrary\steamapps\common\CRUMB\CRUMB.exe`
- Native game assembly: `D:\SteamLibrary\steamapps\common\CRUMB\GameAssembly.dll`
- IL2CPP metadata: `D:\SteamLibrary\steamapps\common\CRUMB\CRUMB_Data\il2cpp_data\Metadata\global-metadata.dat`

The build is IL2CPP-only; it does not contain a normal `CRUMB_Data\Managed` directory.

## Provenance and recovery

The files were fingerprinted before analysis:

- `CRUMB.exe` SHA-256: `7F3023AC0C8D0A5A976BC7E1A31AA480B964CEE8B19A959B8CB77A69CA0819E0`
- `GameAssembly.dll` SHA-256: `D97ECD5FB0568C8A658E3136B4F27A1DB7259100D7764AD8264E73949C056B02`
- `global-metadata.dat` SHA-256: `7B701888CCB03539A06255294325E2DAC6B6BD496D52BBD9E26687E9F0286750`

Recovery used the documented workflows for [Il2CppDumper](https://github.com/Perfare/Il2CppDumper) and [Cpp2IL](https://github.com/SamboyCoding/Cpp2IL/blob/development/README.md):

- Il2CppDumper output: `C:\Users\micha\Desktop\crumb-il2cpp-dump`
- Cpp2IL fast output: `C:\Users\micha\Desktop\crumb-cpp2il-out`
- Cpp2IL detailed analysis: `C:\Users\micha\Desktop\crumb-cpp2il-analysis`
- ILSpy C#-like output: `C:\Users\micha\Desktop\crumb-cpp2il-decompile`

Il2CppDumper identified metadata version 29.1 and the code/metadata registration addresses. Cpp2IL recovered 61 assemblies; its `Assembly-CSharp` output contained 980 types and 7,327 methods. The detailed analysis recovered 6,508 of 7,328 methods, approximately 88%. ILSpy produced 686 C#-like files from the recovered `Assembly-CSharp.dll`.

These are recovered representations, not the original CRUMB source. Several methods involving Unity `NativeArray` state, Burst/native helpers, and generic code did not decompile completely. Exact equations are only reported below where the recovered structure, method dump, or native assembly supports the conclusion.

## Verified architecture

### Circuit solver

The recovered `Simulation.Circuit` and `Simulation.ICircuitModel` types show a component-oriented matrix solver:

- Components expose a lifecycle including matrix initialization, unknown definition, matrix-pointer setup, timestep initialization, stepping, current calculation, convergence checking, and reset.
- The circuit owns node lists, voltage sources, matrix/right-side storage, nonlinear bookkeeping, permutation/scaling data, lead voltages, and sparse-solver helpers.
- Stamping methods include resistor, conductance, current-source, voltage-controlled/current-controlled source, matrix, right-side, and nonlinear-marker operations.
- The solver includes KLU/native sparse-solve paths and a transient tick path. Some matrix-array loop bodies are not fully recoverable because of `NativeArray` and Burst/native code.

Relevant recovered files include:

- `C:\Users\micha\Desktop\crumb-cpp2il-decompile\Simulation\Circuit.cs`
- `C:\Users\micha\Desktop\crumb-cpp2il-decompile\Simulation\CircuitModel.cs`
- `C:\Users\micha\Desktop\crumb-cpp2il-decompile\Simulation\CircuitSimulation.cs`
- `C:\Users\micha\Desktop\crumb-il2cpp-dump\dump.cs`

The detailed `Circuit.StampResistor` dump confirms that the resistor parameter is converted to conductance as `1 / resistance` before the matrix is stamped. The exact individual matrix-sign pseudocode is not treated as authoritative because Cpp2IL mangles some native-array operands.

### Time, frequency, and instrumentation

`Simulation.CircuitSimulation` contains frequency and timestep state, update methods, and a transient tick loop. `Simulation.Circuit.Watch` maintains a per-component `scopeMap` of `ScopeFrame` samples.

`Simulation.ScopeFrame` stores time, current, and voltage. `Simulation.ICircuitComponentExtensions` exposes formatted current and voltage readings using SI-unit normalization. `Simulation.Probe` is a measurement element with input/output leads and connection-state behavior.

This verifies that CRUMB treats observability as part of the simulation model rather than as a separate UI-only feature.

### Capacitor and inductor models

`Simulation.Capacitor` and `Simulation.Inductor` contain companion-model state, including equivalent resistance/conductance, history/current-source values, voltage deltas, and right-side pointers. Their lifecycle methods initialize a companion representation, preserve history between steps, stamp the current-step contribution, and calculate component current.

The recovered method bodies are incomplete in places, so this audit confirms the companion-model structure and state flow, not every numerical branch of the original implementation.

### Transformer model

`Simulation.Transformer` is a four-lead coupled-inductor model. Recovered fields include inductance, turns ratio, coupling coefficient, trapezoidal-mode state, winding-current history, coupled coefficients, and history-source values. Its matrix initialization uses conductance and controlled-source stamps; its step method stamps current sources from history; its current calculation uses winding voltage differences and the coefficient state.

The recovered class has no fields or references for core-loss resistance, winding resistance, or a changing-flux core-loss branch. Therefore CRUMB's recovered transformer model should be described as a coupled inductive model, not as a complete transformer-loss model. The detailed native dump shows coupled-coefficient algebra involving inductance, ratio, coupling, square-root terms, and a denominator related to the `1 - k^2` boundary, but the exact original equation mapping is not claimed here.

### MOSFET and JFET models

`Simulation.MOSFET` is a nonlinear, quasi-static transistor model. Recovered state includes threshold, polarity, prior voltages, drain/source current (`_ids`), operating mode, transconductance (`_gm`), and voltage state. Its matrix/step methods use nonlinear markers and linearized matrix/right-side stamps.

The recovered `Simulation` code contains no gate-capacitance fields or references such as `Cgs`, `Cgd`, `Ciss`, `Coss`, or `Crss` in the MOSFET/JFET path. This is a verified limitation of the inspected build: its recovered MOSFET/JFET engine is not a high-frequency gate-capacitance model.

### Arduino and controller integration

`MicroController` contains an interpreter/machine, power and running state, pins, reference voltage, interrupt state, serial state, and Arduino-like operations including `DigitalRead`, `DigitalWrite`, `PinMode`, `AnalogRead`, `AnalogWrite`, `Tone`, delay/timing calls, SPI, and serial methods.

This verifies a code-driven controller path coupled to simulated circuit pins. It is useful as an interaction and integration reference; it is not evidence that every electrical behavior is physically complete.

## ChipBlocks comparison

The current ChipBlocks source was checked after the earlier audit findings. The old findings must not be carried forward unchanged:

- The current transformer transient solver no longer stamps core loss as a fixed resistor directly across the copper terminals. `C:\Users\micha\Desktop\chipzzzd\src\transient-solver.ts:1885` and `C:\Users\micha\Desktop\chipzzzd\src\transient-solver.ts:1928` use augmented companion systems with a changing-flux/core-loss branch. The stamping path is at `C:\Users\micha\Desktop\chipzzzd\src\transient-solver.ts:2395`.
- The current transformer transient resolver accepts `k = 1` when the physical circuit is otherwise well-posed. The current AC analysis also handles the boundary through its branch-current formulation at `C:\Users\micha\Desktop\chipzzzd\src\ac-analysis.ts:238`.
- The current AC MOSFET/JFET path includes the declared lumped gate capacitance at `C:\Users\micha\Desktop\chipzzzd\src\ac-analysis.ts:1124`. The device-side small-signal structure reads it at `C:\Users\micha\Desktop\chipzzzd\src\small-signal.ts:104`.

The comparison is therefore:

- CRUMB validates the usefulness of explicit component lifecycle methods, solver instrumentation, probes, scope traces, and controller-to-circuit integration.
- Current ChipBlocks is more explicit than the recovered CRUMB model about transformer winding resistance, changing-flux core loss, saturation/flux state, and AC MOSFET/JFET gate capacitance.
- CRUMB's recovered transformer and transistor structures should not be used as proof that those physical effects are unnecessary. They identify implementation patterns and product behavior, not authoritative physics.

## Findings for ChipBlocks

1. **Borrow observability.** Keep the component-to-scope path visible: show time, voltage, current, selected component state, and the reason a value changed.
2. **Borrow inspectable solver state.** Expose node/lead mapping, convergence state, nonlinear participation, and source/measurement relationships where the UI can explain them.
3. **Borrow controller integration.** Treat programmable blocks and circuit pins as one traceable system, with timing and power state visible.
4. **Do not copy recovered limitations.** CRUMB's transformer has no verified core-loss/winding-loss fields, and its MOSFET/JFET path has no verified gate-capacitance model.
5. **Keep physics evidence separate from UX references.** Real-world correctness should continue to come from equations, tests, and authoritative electronics references rather than from a game's implementation.

## Conclusion

The installed CRUMB build was inspected through its IL2CPP metadata, recovered assemblies, C#-like output, detailed method dumps, and native structure where recovery was incomplete. The audit confirms that CRUMB is a strong reference for component instrumentation, probes, scopes, companion-model organization, and controller integration. It is not a stronger physics authority than the current ChipBlocks implementation for the transformer-loss, transformer-boundary, and AC gate-capacitance findings checked here.

No ChipBlocks application code or documentation was edited.
