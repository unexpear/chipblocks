# Kerbal Space Program Deep-Dive Audit

**Audit date:** 2026-09-14
**Scope:** Installed Windows build, managed `Assembly-CSharp.dll`, stock part/resource configuration, physics database, targeted decompilation, and comparison with the current ChipBlocks implementation.
**Change control:** No ChipBlocks source, tests, fixtures, or existing documentation were edited for this audit. This file is the only repository artifact added by this audit.

## Executive verdict

Kerbal Space Program is a strong reference for **modular assembly, typed connection points, staged topology, resource routing, derived performance calculations, and inspectable failure explanations**. It is also unusually useful for this audit because the installed build contains the complete managed game assembly rather than only native machine code.

The recovered code shows two distinct systems:

- a Unity rigidbody/joint system for physical part assembly, docking, forces, torque, and breakage;
- a discrete resource-flow graph for fuel, oxidizer, electricity, air, ore, and other resources, with flow modes, crossfeed sets, priorities, simulation copies, and reachability checks.

The propulsion and orbital calculations contain recognizable real equations: exhaust velocity from specific impulse, thrust from mass flow, the ideal rocket equation, vis-viva orbital speed, orbital energy, eccentricity vectors, and Kepler anomaly solving. Other behavior is intentionally game-specific: resource movement is not fluid dynamics, engine performance comes from hand-authored curves, atmospheric/aero behavior uses tuned curves and drag-cube data, and the orbital model is analytic two-body/patched-conic rather than an N-body simulation.

For ChipBlocks, the highest-value lesson is not to copy KSP's physics. It is to make **component ports, graph membership, routing policy, derived calculations, simulation previews, and first-failure diagnostics explicit and inspectable**.

## Evidence and provenance

### Installed build

- Steam AppID: `220200` (`Kerbal Space Program`).
- Steam build ID: `10132464`.
- Install directory: `D:\SteamLibrary\steamapps\common\Kerbal Space Program`.
- Unity game executable: `D:\SteamLibrary\steamapps\common\Kerbal Space Program\KSP_x64.exe`.
- Executable size: `661,336` bytes.
- Executable SHA-256: `7F9F43C8CD831F91992AA88D77EA78FAB39BC339BB42F2D19B3874CEE28C82D5`.
- Unity version reported by the executable and `UnityPlayer.dll`: `2019.4.18.3346596`.
- Managed gameplay assembly: `D:\SteamLibrary\steamapps\common\Kerbal Space Program\KSP_x64_Data\Managed\Assembly-CSharp.dll`.
- Assembly size: `10,790,912` bytes.
- Assembly SHA-256: `D9E42483F25EE80A9C11D6C1C0A0D29B4EC78C1E08D76C971B71580C9CCE51E4`.
- `buildID64.txt` identifies stock build `03190`, dated `2022.12.12`, Steam distribution, English locale.

The assembly is managed .NET/Mono code and was decompiled with `ilspycmd 11.0.0.9375`. This recovers readable control flow and formulas, but decompiler artifacts remain in some methods; the conclusions below rely on repeated method/type evidence and the shipped configuration rather than treating generated source as the original source tree.

### Generated evidence

- `C:\Users\micha\Desktop\ksp-assembly-types.txt` — 4,560 recovered class/type entries.
- `C:\Users\micha\Desktop\ksp-decompiled-targets` — targeted decompilation of construction, resource, propulsion, staging, docking, orbital, and physics types.
- `D:\SteamLibrary\steamapps\common\Kerbal Space Program\Physics.cfg` — shipped physics and thermal/aero parameters.
- `D:\SteamLibrary\steamapps\common\Kerbal Space Program\GameData\Squad\Parts` — stock part definitions.
- `D:\SteamLibrary\steamapps\common\Kerbal Space Program\GameData\Squad\Resources` — stock resource definitions and planetary resource configuration.

## Stock content inventory

The stock `GameData\Squad\Parts` tree contains:

- `359` `.cfg` part files;
- `1,342` `MODULE` block occurrences;
- `238` `RESOURCE` block occurrences;
- `72` `PROPELLANT` block occurrences;
- `478` `node_stack` declarations and `230` `node_attach` declarations;
- `6` `ModuleDockingNode` declarations;
- `15` decoupling-module declarations;
- `41` engine-module declarations;
- `10` resource-converter-module declarations;
- `103` `fuelCrossFeed = True` declarations.

These are configuration occurrences, not a count of unique runtime objects. The stock resource catalog includes `LiquidFuel`, `Oxidizer`, `SolidFuel`, `MonoPropellant`, `XenonGas`, `ElectricCharge`, `IntakeAir`, `Ore`, and `Ablator`, each with density, heat capacity or related fields, transfer rules, and a resource-flow mode.

Representative shipped definitions:

- `liquidEngineLV-T45_v2.cfg` defines stack nodes, mass, `ModuleEngines`, `maxThrust = 215`, LiquidFuel/Oxidizer ratios, and an `atmosphereCurve` with `Isp` keys at pressure values `0`, `1`, and `6`.
- `LFO_long.cfg` defines stack and surface nodes, mass, breaking force/torque, `fuelCrossFeed = True`, and LiquidFuel/Oxidizer tank contents.
- `Decoupler_0.cfg` defines stack nodes, breaking force/torque, stage offsets, `ModuleDecouple`, and a toggleable crossfeed module.

The part files are data-driven contracts layered on top of the managed `Part`/`PartModule` runtime.

## Recovered runtime architecture

### Parts, ports, and physical assembly

`Part` is the central component object. It owns modules, parent/child relationships, attach nodes, rigidbody state, resources, stage indices, and crossfeed-set references. `PartModule` provides the extensible module contract used by engines, tanks, decouplers, docking nodes, converters, wheels, sensors, and UI actions.

`AttachNode` is a real connection-point data structure with:

- an ID and node type (`Stack`, `Surface`, or `Dock`);
- local position, orientation, secondary axis, radius, size, and contact area;
- attached-part and opposing-node references;
- attach method, rigid flag, crossfeed flag, one-way crossfeed flag, and break-related values;
- node transforms and persistent attached-part IDs.

`Part` parses `node_stack`, `node_attach`, and related configuration into these objects. `FindAttachNodeByPart`, `FindPartThroughNodes`, `CreateAttachJoint`, `onAttach`, `Couple`, and `Undock` maintain the assembly graph.

### Joint and break behavior

`PartJoint.Create` selects the relevant node and creates one or more Unity `ConfigurableJoint` objects. `SetupJoint` sets:

- host and connected rigidbodies;
- local anchors, primary axes, and secondary axes;
- stack/surface stiffness based on node size, attachment mode, and global stiffness factors;
- linear and angular motion constraints;
- target position/rotation and joint drives;
- breaking force and torque derived from the weaker attached part and node scaling.

The code initially uses infinite Unity break thresholds during setup, then `SetUnbreakable`/`SetBreakingForces` applies the configured thresholds and global `PhysicsGlobals` factors. `OnJointBreak` emits a game event, destroys internal joints, and updates the part/vessel topology.

This matches the role of Unity's `ConfigurableJoint`: Unity documents `breakForce` and `breakTorque` as the thresholds that permanently break the joint, while the game supplies its own anchors, drives, limits, stiffness, and tuned factors. See the [Unity ConfigurableJoint manual](https://docs.unity3d.com/es/2019.4/Manual/class-ConfigurableJoint.html).

### Docking state machine

`ModuleDockingNode` is a stateful port module rather than a simple Boolean connection. It has states and events for ready, acquire, docked, disengage, pre-attached, same-vessel docking, undocking, and node approach/distance.

`CheckDockContact` requires:

- node distance below the capture range;
- opposing forward vectors aligned by a dot-product threshold;
- roll alignment by an up-vector dot product, with optional snap rotation and snap offset.

`DockToVessel` aligns vessel rotations and positions, couples the part graphs, updates persistent IDs, and fires docking events. `Undock` separates the topology and applies equal half ejection forces to the two sides. This is a useful reference for connection handshakes and state transitions, not for electrical pin semantics.

### Resource-flow graph

The most transferable KSP architecture is the resource graph. `RUI.Algorithms.SCCFlowGraph` builds separate request and delivery graphs over the parts. It computes strongly connected component sets, indexes each part into a graph node, and exposes:

- `GetAllRequests(Part)`;
- `GetAllDeliveries(Part)`;
- connected request and delivery components;
- a `StackFlowGraph` with dependency and transform-guide data.

`SCCFlowGraphUCFinder` indexes resource entry points and exposes `GetUnreachableFuelRequests` and `GetUnreachableFuelDeliveries`. Those methods return the specific affected parts, not merely a global failure flag.

`PartSet` then builds the usable resource sets. It maintains separate real and simulation sets, creates pull/push priority lists, groups resources by `Part.GetResourcePriority()`, and transfers requested amounts through `Part.TransferResource`. `BuildPartSets` starts from the flow graph's request closures and stores the resulting sets on each vessel/part. `BuildPartSimulationSets` creates an independent simulation topology for planning and delta-v calculations.

The available `ResourceFlowMode` branches are explicit in `Part.requestResource` and `GetConnectedResourceTotals`:

- `NO_FLOW`;
- `ALL_VESSEL` and `ALL_VESSEL_BALANCE`;
- `STAGE_PRIORITY_FLOW` and `STAGE_PRIORITY_FLOW_BALANCE`;
- `STACK_PRIORITY_SEARCH`, `STAGE_STACK_FLOW`, and `STAGE_STACK_FLOW_BALANCE`.

For priority modes, `PartSet.ProcessRequest` first aggregates the available or empty capacity in a priority group. It proportionally scales transfers when a group cannot satisfy the full demand, then falls back to individual transfers and returns the amount actually delivered. This is a deterministic routing/allocation algorithm over a connectivity graph, not pressure-driven fluid flow.

`ResourceBroker` provides a stable request facade with `AmountAvailable`, `RequestResource`, `StorageAvailable`, and `StoreResource`. It treats `ElectricCharge` specially for time-step scaling, while the general flow semantics remain discrete resource accounting.

`PartResource` stores amount, maximum amount, flow state, flow mode, and current flow direction. `ModuleResource` adds `currentRequest`, `currentAmount`, rate display, and `IsDeprived`, giving the UI an inspectable consumer state.

### Engines and propulsion math

`ModuleEngines` recovers an explicit propulsion pipeline:

1. Read throttle, atmospheric pressure, atmospheric density, velocity/Mach, and engine curves.
2. Compute `realIsp` from the atmosphere curve, optional throttle-Isp curve, optional atmospheric-density curve, and optional velocity curve.
3. Compute requested mass flow as `maxFuelFlow * throttle`, then apply flow modifiers.
4. Compute exhaust velocity as `Isp * g`, where the engine uses `g = 9.80665`.
5. Compute thrust as `mass flow * exhaust velocity`.
6. Request the propellant mixture through the part resource graph.
7. Scale thrust if the requested mixture is only partially available; flame out below the configured threshold.
8. Apply the resulting thrust with `Rigidbody.AddForceAtPosition` at each thrust transform and add thermal flux.

The decompiled methods make the core relationships explicit:

- `getExhaustVelocity(float isp)` returns `isp * g`;
- `GetEngineThrust(float isp, float throttle)` returns interpolated fuel flow times exhaust velocity;
- `RequiredPropellantMass` sets requested mass flow and resulting thrust;
- `RequestPropellant` requests each propellant by configured ratio and handles starvation;
- `ThrustUpdate` applies force at the engine transforms and adds heat.

`DeltaVEngineInfo.CalculateBurn` uses the simulation resource set, calculates per-propellant demand for a time step, checks time-to-depletion, reduces the step near starvation, and applies the simulated burn. `DeltaVStageInfo.SimulateDeltaV` repeats that process across active engines and stage separation rules.

### Staging and derived performance

`VesselDeltaV` subscribes to resource-list, crossfeed, priority, fuel-flow, docking, undocking, stage, and throttle events. It tracks total vacuum, sea-level, and actual delta-v, burn time, engine information, stage information, separation indices, and part-level calculations.

`DeltaVStageInfo` calculates:

- stage start/end mass and fuel mass;
- engine thrust vectors and total vectored thrust;
- effective specific impulse from total thrust divided by the sum of `thrust / Isp` across engines;
- thrust-to-weight ratio using thrust divided by mass times local body gravity;
- stage delta-v by accumulating the simulation's incremental calculations;
- time-step changes when propellant depletion is imminent.

The source also contains an ideal-rocket-equation inversion using an exponential mass ratio when estimating time for a requested delta-v. NASA describes the same ideal relationship as `Delta-v = Isp * g0 * ln(mi / mf)` in its [rocket-equation reference](https://science.nasa.gov/learn/basics-of-space-flight/chapter3-2/) and [ideal rocket equation reference](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/ideal-rocket-equation/).

### Orbital math

`Orbit` is an analytic orbital-state implementation. The recovered code contains:

- reference-body gravitational parameter `mu`;
- mean motion `sqrt(mu / abs(a)^3)`;
- orbital energy `v^2 / 2 - mu / r`;
- eccentricity vector from position and velocity;
- semi-major axis from orbital energy;
- semi-latus rectum and radius `p / (1 + e cos(trueAnomaly))`;
- vis-viva speed `sqrt(mu * (2 / r - 1 / a))`;
- elliptic, parabolic, and hyperbolic anomaly conversions;
- Newton-style eccentric-anomaly solvers;
- state vectors, closest approach, sphere-of-influence, and next/previous orbit patches.

The recovered `getOrbitalSpeedAtDistance` method directly implements the vis-viva form. NASA's orbital-mechanics material gives the same relationship, `v^2 = mu(2/r - 1/a)`, in its [JPL orbital mechanics chapter](https://spsweb.fltops.jpl.nasa.gov/portaldataops/mpg/MPG_Docs/MPG%20Book/Release/Chapter7-OrbitalMechanics.pdf). The implementation is therefore recognizable two-body orbital mechanics, with KSP's own patched-conic and coordinate-frame conventions around it rather than a full N-body integrator.

### Aero, thermal, and configuration realism

`PhysicsGlobals` and `Physics.cfg` expose real physical constants and explicit tuning parameters:

- `GravitationalAcceleration = 9.80665`;
- ideal-gas, Boltzmann, Stefan-Boltzmann, and Avogadro constants;
- space temperature, solar flux, radiation, conduction, convection, drag, lift, and thermal-integration settings;
- RK2/Heun thermal integration limits and analytic thermal lerp settings;
- Newtonian and Mach convection exponents;
- drag-cube, lift, and Mach-dependent curves.

The stock configuration comments document lift as coefficient × Mach multiplier × dynamic pressure × area, and drag as drag-cube coefficient curves with Mach and pseudo-Reynolds multipliers. That is physically motivated but heavily parameterized. The engine atmosphere curves and part drag cubes are data tables, not a first-principles nozzle or CFD model.

## Inspection and debugging behavior

KSP has several strong observability patterns:

- `PreFlightTests.ResourceConsumersReachable` reports resource consumers that cannot reach a valid provider and returns affected parts.
- `PreFlightTests.ResourceContainersReachable` reports unreachable resource containers and affected parts.
- `EngineersReport` owns the SCC flow-graph finder used by those checks.
- `FuelFlowOverlay` classifies selected parts as consumers/providers, draws dependency lines, distinguishes flow paths with colors, and displays resource priority text such as `p3`.
- `VesselDeltaV` exposes total delta-v, burn time, stage data, per-engine information, resource availability, and depletion time.
- `PartResource` and `ModuleResource` expose current amount, maximum amount, flow state, current request, current amount, and deprivation state.
- `ModuleDockingNode` logs state transitions and events for approach, acquire, docking, disengage, and undocking.

This is close to the kind of “why did this fail?” surface ChipBlocks needs: topology, role, routing policy, affected element, and a derived calculation are all inspectable in context.

## Real-physics cross-check

### Matches standard physics concepts

- `Isp * g0` as effective exhaust velocity is standard specific-impulse usage.
- Thrust as mass-flow times effective exhaust velocity is standard rocket momentum accounting.
- Delta-v mass-ratio behavior matches the ideal Tsiolkovsky rocket equation.
- Vis-viva, orbital energy, eccentricity-vector, and Kepler-anomaly calculations match standard two-body orbital mechanics.
- Unity joint break thresholds are used in the way documented by Unity, with KSP-specific joint setup and tuning layered on top.

### Deliberate game abstractions

- KSP resources have discrete inventories and graph routing modes, not pressure, viscosity, pipe friction, compressibility, or hydraulic/electrical potential.
- `ElectricCharge` is a resource budget with staged flow rules, not a circuit with voltage, current, impedance, or Kirchhoff constraints.
- Propellant mixture ratios, engine atmosphere curves, flow modifiers, and flameout thresholds are authored part data, not complete combustion/nozzle thermodynamics.
- Aero behavior uses drag cubes, coefficient curves, tuned multipliers, and rigidbody forces; it is not a full CFD solution.
- Orbit propagation is analytic two-body/patched-conic behavior around reference bodies, not mutual N-body gravity.
- Part masses, densities, volumes, breaking forces, and thermal parameters are game data and should not be treated as universal real-hardware values.

## Comparison with current ChipBlocks

### Where ChipBlocks already matches or exceeds KSP

- `C:\Users\micha\Desktop\chipzzzd\src\renderer\net-inspector.ts` already exposes drivers, loads, passives, unknown endpoints, contention, undriven nets, current, voltage drop, wire length, and resistance.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\causal-replay.ts` maps digital transitions and transient net/current changes to source blocks, terminals, nets, and diagnostics.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\run-trace.ts` records per-cycle values, settling, gate sweeps, register changes, and anomalies.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\block-tests.ts` supports deterministic cycle tests and expected output arrays.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\timing-panel.tsx` and `C:\Users\micha\Desktop\chipzzzd\src\static-timing.ts` provide critical-path, logic-depth, clock, setup-slack, and hold-violation analysis.
- ChipBlocks has actual DC, transient, AC, device, electro-thermal, magnetic, scope, meter, PCB, and FPGA tooling. KSP's game-level resource/electricity abstraction is not a replacement for those solvers.

### High-value lessons to borrow

1. **Port contracts:** Give each block terminal a stable ID, type, direction, connection policy, size/capability, orientation, and domain-specific compatibility rules.
2. **Logical versus physical graphs:** Keep the editor connectivity graph, solver net graph, and simulation-copy graph explicit and inspectable instead of deriving them invisibly in multiple places.
3. **Routing policy as data:** Make priority, one-way behavior, crossfeed enablement, source/sink role, and resource-domain rules visible next to the connection.
4. **Affected-element diagnostics:** Return the exact blocks/nets/terminals that cannot reach a source or satisfy a demand, not only a top-level error.
5. **Simulation previews:** Maintain real and simulation copies so delta-v-style planning, timing analysis, or block tests cannot mutate live state.
6. **Derived metrics with provenance:** Show the formula inputs and source elements for power, timing, thermal, magnetic, and resource summaries, similar to KSP's per-stage delta-v and burn-time breakdown.
7. **Connection state machines:** For interactive blocks, represent attach, lock, acquire, valid, invalid, disconnect, and fault states explicitly rather than treating every connection as a static edge.
8. **Network overlays:** Provide an optional graph overlay with provider/consumer roles, path direction, priority labels, and the first unreachable or blocked element.
9. **Preflight checks:** Run design-time checks before simulation and identify affected elements, severity, and a concrete repair hint.

### What not to copy

- Do not model voltage/current/power by copying KSP's `ElectricCharge` resource flow.
- Do not use inventory priority allocation as a substitute for conservation-law-based electrical, thermal, magnetic, or fluid solvers.
- Do not treat KSP's hand-authored curves as universal real-world component models.
- Do not copy patched-conic orbital simplifications into ChipBlocks' physical domains.
- Do not replace ChipBlocks' causal replay and waveform/debug tools with only a colored connectivity overlay; KSP's strongest lesson is that the overlay works because it is backed by explicit graph and state data.

## Audit findings

### Confirmed strengths

- KSP ships a recoverable managed runtime with actual source-level class/method names and formulas for the relevant systems.
- Attach nodes and part modules provide a clear data-driven model for typed ports and modular composition.
- `SCCFlowGraph`, `PartSet`, resource-flow modes, priority lists, and simulation sets form a mature graph-based routing architecture.
- Propulsion and orbital code includes recognizable standard equations while clearly isolating game-tuned curves and resource abstractions.
- Preflight reachability, fuel-flow overlays, deprivation state, delta-v breakdowns, and docking FSMs are strong examples of inspectable system state.

### Limits and uncertainty

- The decompiled output is not the original source tree and contains control-flow artifacts in some methods.
- Unity's internal PhysX solver behavior is not recovered from `Assembly-CSharp.dll`; KSP configures joints and forces but does not contain the entire physics engine.
- The audit did not execute a controlled flight experiment, compare numerical trajectories against a reference propagator, or attach a debugger to the running game.
- Stock part configuration counts are token/block occurrence counts, not unique runtime-instance counts.
- No ChipBlocks implementation files were edited.

## Final recommendation

Use KSP as the strongest reference so far for **modular composition, port metadata, graph-based resource routing, staging/simulation separation, preflight diagnostics, and derived-metric provenance**. For ChipBlocks, the next useful design work is an observability contract for every domain: endpoints, graph membership, policy, solver state, derived values, affected elements, and repair hints. Keep the KSP-inspired UX and graph architecture separate from the real equations already required by ChipBlocks' electrical and physical solvers.
