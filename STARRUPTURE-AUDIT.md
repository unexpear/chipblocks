# StarRupture Deep-Dive Audit

**Audit date:** 2026-09-14
**Scope:** Installed Windows build, Unreal IoStore metadata, selected cooked assets, native PDB symbols/source paths, the global Unreal reflection table, and comparison with the current ChipBlocks implementation.
**Change control:** No ChipBlocks source, tests, fixtures, or existing documentation were edited for this audit. This file is the only repository artifact added by this audit.

## Executive verdict

StarRupture is a useful reference for scalable, inspectable **discrete power and logistics networks**. It is not a source of real electrical equations. The installed build exposes a much stronger recoverable architecture than a normal packaged game because it includes a 2.53 GB native PDB. That PDB provides custom C++ symbol names, module names, object/source paths, and UHT-related metadata, but not the original function bodies or the original source files.

The strongest verified lessons for ChipBlocks are:

- model each connected domain as an inspectable graph or subgraph;
- expose produced power, consumed power, surplus, state, and connection changes as first-class diagnostics;
- distinguish topology failures from resource failures and device-state failures;
- show request lifecycle, reachability, waiting, priority, thresholds, and first blocked hop;
- use scalable aggregation and dedicated debug visualization for large networks;
- persist and reload network state deliberately rather than treating connectivity as invisible editor state.

StarRupture's `Electricity` names indicate a game-level power-network abstraction. The recovered evidence does not establish voltage, current, impedance, phase, Kirchhoff solving, magnetic flux, thermal equations, or any other physical circuit model. ChipBlocks must continue to use its own cited equations and solver tests for those domains.

## Evidence and provenance

### Installed build

- Steam AppID: `1631270` (`StarRupture`).
- Steam build ID: `25118010`.
- Install directory: `D:\SteamLibrary\steamapps\common\StarRupture`.
- Game root: `D:\SteamLibrary\steamapps\common\StarRupture\StarRupture`.
- Shipping executable: `D:\SteamLibrary\steamapps\common\StarRupture\StarRupture\Binaries\Win64\StarRuptureGameSteam-Win64-Shipping.exe`.
- Executable size: `250,479,176` bytes.
- Executable SHA-256: `EBCD47D619BDCB68177456C668717855345359217086925EA774CE6BC55CAC53`.
- Installed PDB: `D:\SteamLibrary\steamapps\common\StarRupture\StarRupture\Binaries\Win64\StarRuptureGameSteam-Win64-Shipping.pdb`.
- PDB size: `2,532,741,120` bytes.
- The PDB is a Microsoft C/C++ MSF 7.00 file and contains source/object paths rooted at `D:\Perforce\P_Neon-Final\Chimera\`.

The source paths are provenance and symbol evidence only. The Perforce source tree itself is not installed, so no original `.cpp` or `.h` implementation was recovered.

### IoStore containers

- Main index: `D:\SteamLibrary\steamapps\common\StarRupture\StarRupture\Content\Paks\pakchunk0-Windows.utoc`.
- Main data container: `D:\SteamLibrary\steamapps\common\StarRupture\StarRupture\Content\Paks\pakchunk0-Windows.ucas`.
- Global reflection container: `D:\SteamLibrary\steamapps\common\StarRupture\StarRupture\Content\Paks\global.utoc` / `global.ucas`.
- `retoc 0.1.5` reports the main container as `Indexed`, version `ReplaceIoChunkHashWithIoHash`, mount point `../../../`, with `68,460` chunks and `51,917` packages.
- The main container reports `SoftPackageReferencesOffset` and no listed compression methods.
- `retoc verify` completed successfully for the global container.
- The full main data container was not unpacked; targeted chunks were extracted from the main index.

The recovery tools were `C:\Users\micha\.cargo\bin\retoc.exe` and `C:\msys64\ucrt64\bin\strings.exe`. Epic documents the `.utoc`/`.ucas` IoStore relationship in [Zen Loader documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/zen-loader-in-unreal-engine), and the recovery command behavior is documented in the [`retoc` README](https://github.com/trumank/retoc).

### Generated evidence files

- `C:\Users\micha\Desktop\starrupture-list.txt` — full IoStore listing, `68,460` lines.
- `C:\Users\micha\Desktop\starrupture-script-objects.txt` — global Unreal reflection names, `243,824` lines.
- `C:\Users\micha\Desktop\starrupture-network-script-evidence.txt` — filtered custom electricity, logistics, building, crafting, and UI names.
- `C:\Users\micha\Desktop\starrupture-pdb-object-paths.txt` — `1,135` unique PDB object paths.
- `C:\Users\micha\Desktop\starrupture-pdb-custom-strings.txt` — extracted custom source paths and native symbol strings.
- `C:\Users\micha\Desktop\starrupture-asset-samples` — targeted cooked asset extractions used for package confirmation.

## Recovered package inventory

The verified package listing contains:

- `42,608` `.uasset` entries;
- `9,309` `.umap` entries;
- `9,310` entries under `/Buildings/`;
- `807` entries under `/Buildings/DroneConnections/`;
- `479` entries under `/Crafting/`;
- `2,145` entries under `/UI/`;
- `48` entries whose package path contains `electric`;
- `1,641` entries whose package path contains `logistic`, `drone`, `rail`, or `junction`.

The listing includes concrete assets such as `BD_StorageDepot`, `BP_DronePole`, `BP_DroneVerticalConnector`, `CR_RTSCGenerator`, `CR_BasicElectronics`, `WBP_BuildingInventory`, and `WBP_BuildingLogisticsInfo`.

Targeted extraction confirmed the following serialized references:

- `BD_StorageDepot.uasset` references storage-depot data, a building variant, modular sockets, placement conditions, inventory materials, and localization keys.
- `BP_DronePole.uasset` references drone-rail sockets, building placement, cable/rail-related components, and the pole mesh/data.
- `BP_DroneVerticalConnector.uasset` references drone entries, rail caps, pole/rail meshes, rail sockets, tier changes, and placement helpers.
- `CR_RTSCGenerator.uasset` references generator and RTSC item data, an icon, and localized item text.
- `CR_BasicElectronics.uasset` references electronics, wolfram materials, and item localization.
- `WBP_BuildingInventory.uasset` contains a building inventory widget tree and crafting-status/item-container references.
- `WBP_BuildingLogisticsInfo.uasset` contains high/medium/low logistics-priority controls and a `DronePriorityText` reference.

These are cooked package references, not reconstructed Blueprint graphs or source code.

## Recovered native architecture

### Electricity and powered-device graph

The PDB and reflection data identify a custom `Chimera` electricity subsystem with graph and subgraph concepts. Recovered native names include:

- `UCrElectricityGraphSubsystem::ConnectEntities` and `DisconnectEntities`;
- `FindEntitiesInBounds`, `FindSubgraphsInBounds`, `GetElectricityInBounds`, and `GetElectricityInRadius`;
- `GetElectricityForSubgraphsInRadius` and `GetDebugTextForSubgraph`;
- `GetSubgraphElectricityDataMutable`;
- `GetSubgraphPotentialConsumedPower` and `GetSubgraphPotentialProducedPower`;
- `GetSubgraphElectricitySurplus`;
- `LoadElectricityState`, `SaveElectricityState`, and grid/entity state-change handlers;
- `UpdateGridStateOnEntityChange`, `UpdatePowerEventValues`, and `ShouldSwapWhenConnecting`.

The reflected custom types include `CrElectricityGraphSubsystem`, `CrElectricitySubgraphData`, `CrElectricityGraphSubsystemSaveData`, `CrElectricitySubgraphDataReplicator`, `CrElectricitySubgraphDataSerializer`, `CrElectricityConnectionHelper`, `CrElectricityParameters`, `CrElectricityFragment`, `CrElectricityTrait`, and `ECrElectricitySubgraphState`.

Separate powered-device names include `UCrPoweredDeviceSubsystem`, `AddPoweredDevice`, `GetPoweredDeviceState`, `SetPoweredDeviceState`, `CrPoweredDeviceTrait`, `CrPoweredDeviceConsumerTrait`, and `CrPoweredDeviceTag`. `UCrEnergyLogicComponent` exposes current-energy and regeneration operations. The PDB also contains signal processors for electricity, conductors, entity state, and multipliers.

This is direct evidence of a graph-based, aggregated power system with device state and persisted graph state. It is not evidence of a continuous electrical field or circuit solver.

### Signals and state transitions

The PDB exposes `CrMassSignals` for observable state changes including:

- `ElectricityGridChanged` and `ElectricityGridPowerStateChanged`;
- `ElectricityEntityEnabled`, `ElectricityEntityDisabled`, and `ElectricityEntityStateDirty`;
- `ElectricityMultiplierEntityChanged` and `PoweredDeviceStateChanged`;
- `BuildingStateChanged` and `BuildingWorkingStateChanged`;
- `TemperatureChanged`, `TemperatureWithinRange`, and `TemperatureOutsideRange`;
- `InventoryChanged` and `InventorySizeChanged`.

The recovered UI names include `CrUW_EnergyHud`, `CrUW_PowerGenerator`, and generator functions such as `UpdateGridPower`, `RefreshLines`, `SetupVisuals`, and `SetStateColor`. This supports a user-facing model where network totals and state changes are surfaced visually rather than left entirely implicit.

### Logistics graph and request lifecycle

The native symbols and reflection table identify a separate logistics graph and simulation family:

- `CrLogisticsNavGraphSubsystem`, `CrLogisticsNavSubGraph`, `CrLogisticsGraphData`, `CrLogisticsGraphConnectionData`, and `CrLogisticsGraphDataHandle`;
- `CrLogisticsRequestSubsystem`, `CrLogisticsRequestSubsystemState`, `CrLogisticsRequestRuntimeData`, and `CrLogisticsRequestHandlingStage`;
- path and visualization types including `CrLogisticsPathSearchResultData`, `CrLogisticsPathSegmentData`, and `CrLogisticsPathVisualizationTrait`;
- movement processors for agents, lines, intersections, roundabouts, and vertical connectors;
- simulation state types for lines, intersections, roundabouts, vertical connectors, and waiting items;
- `CrLogisticsAgentDebugVisualizationProcessor` and `CrLogisticsUnreachableInputItemDetectionSignalProcessor`.

The signal names expose a concrete request/error vocabulary:

- `LogisticsRequestCreated`, `LogisticsRequestStarted`, and `LogisticsRequestDestroyed`;
- `LogisticsSubgraphChanged` and `LogisticsPriorityUpdateNeeded`;
- `LogisticsRequestFilterChanged` and `LogisticsThresholdChanged`;
- `LogisticsMalfunctionUnreachableInputStart` / `Stop`;
- `LogisticsInventoryEmptyStart` / `Stop`;
- `LogisticsTransportConnectionSet` / `NotSet`;
- `LogisticsAgentSegmentChanged`;
- `LogisticsSocketConnectionChanged` and `LogisticsSocketTypeChanged`.

The reflected enums include request priority, request state, request type, agent state, operation type, socket behavior, socket type, and logistics type. This is strong evidence for explicit topology, request, and failure-state modeling rather than a single opaque “network broken” flag.

### Buildings, placement, inventory, and crafting

Recovered building and placement names include `AuBuildingGridSubsystem`, `AuActorPlacementSocketsComponent`, `AuAPGridSettings`, `CrBuildingActorBase`, `CrBuildingComponent`, `CrBuildingData`, `CrBuildingState`, `CrBuildingGraphData`, `CrBuildingSocketSubsystem`, and `CrBuildingSocketData`.

Storage and item names include `CrBuildingInputStorageComponent`, `CrBuildingMainStorageComponent`, `CrBuildingItemStorageComponent`, `CrBuildingDroneStorageComponent`, `CrItemsStorageContainer`, `CrInventoryComponent`, `CrInventoryComponentState`, `CrInventoryFragment`, `CrInventorySlot`, `CrResourceItemBase`, `CrResourceRequirements`, `CrStorage`, `CrSharedStorage`, `CrStorageAsBuilding`, `CrStorageBox`, and `CrStorageItem`.

Crafting names include `CrBuildingCraftingTrait`, `CrCrafter`, `CrCrafterQueueEntry`, `CrCraftingComponent`, `CrCraftingProcessor`, `CrCraftingRecipeOwner`, `CrCraftingReverseLookupSubsystem`, `CrCraftingSignalProcessor`, and `CrCraftingVisualizationProcessor`. `AuItemRecipeData` exposes `GetNeededResources`, `GetOutputItem`, and `GetOutputItems`.

This indicates separate contracts for placement, building sockets, storage, inventory, recipe requirements, crafting queues, and visualization. It is a useful architecture reference for inspectable block metadata and domain separation, but it does not disclose the exact scheduling or throughput equations.

### Debugging and scale

The recovered build contains dedicated debug and visualization types including `CrGameplayDebuggerMassData`, `CrBuildingStateDebugProcessor`, `CrLogisticsAgentDebugVisualizationProcessor`, `CrMassBuildingGridSubsystem`, `CrGenericMassGraphSubsystem`, and grid/entity subsystems. The PDB also exposes test-oriented names such as `CrDroneSystemTestCrafterItem`, `CrDroneSystemTestCrafterResource`, `CrDroneSystemTestExtractorResource`, `CrDroneSystemTestHarvesterResource`, `CrInventoryTestActor`, and `CrInventoryViewModelTestActor`.

These names support a deliberate debugging and testability layer for large networks. They do not prove the existence of a user-facing stepper, waveform trace, deterministic replay, or formal causal explanation system.

## Comparison with current ChipBlocks

### Where ChipBlocks already matches or exceeds this reference

- `C:\Users\micha\Desktop\chipzzzd\src\renderer\net-inspector.ts` already reports drivers, loads, passives, unknown endpoints, contention, undriven nets, current, voltage drop, wire length, and resistance.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\causal-replay.ts` maps digital transitions and transient net/current changes to source blocks, terminals, nets, and diagnostics.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\run-trace.ts` records per-cycle values, settling, gate sweeps, register changes, and anomalies.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\block-tests.ts` supports deterministic cycle tests and expected output arrays.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\timing-panel.tsx` and `C:\Users\micha\Desktop\chipzzzd\src\static-timing.ts` provide critical-path, logic-depth, clock, setup-slack, and hold-violation analysis.
- ChipBlocks has actual DC, transient, AC, device, electro-thermal, magnetic, scope, meter, PCB, and FPGA tooling. The recovered StarRupture contracts do not replace those physics models.

### High-value lessons to borrow

1. **Named network subgraphs:** Give electrical, thermal, magnetic, mechanical, and control domains inspectable graph summaries with stable IDs, endpoints, state, and membership.
2. **Power balance as a diagnostic:** Expose potential produced power, potential consumed power, surplus/deficit, enabled/disabled device state, and the transition that changed the balance. Keep this separate from voltage/current physics.
3. **Topology-aware connection diagnostics:** Show socket/pin compatibility, connection changes, disconnected segments, and the first unreachable hop.
4. **Failure taxonomy:** Distinguish floating/undriven, shorted, contended, overloaded, unsupported, missing resource, unreachable input, full output, missing transport, and disabled-device failures.
5. **Request and trace lifecycle:** Represent creation, start, waiting, blocked, completion, and destruction for higher-level block tests or resource flows, with priority/filter/threshold context.
6. **Scale-aware visualization:** Use aggregated graph views, radius/bounds queries, debug overlays, and path highlighting for large designs while preserving drill-down to individual nets and devices.
7. **Persistent network state:** Make save/load behavior explicit for reusable designs, block settings, and derived connectivity, with validation after reload.
8. **Reusable assembly configuration:** Borrow the building/grid/socket/template mindset for reusable ChipBlocks subgraphs, but preserve typed ports, parameter overrides, and domain validation.

### What not to copy

- Do not interpret StarRupture's `Electricity` subsystem as proof of real voltage, current, impedance, phase, or power-flow equations.
- Do not replace ChipBlocks' solver-backed net diagnostics with a purely visual graph or a scalar power budget.
- Do not use game logistics movement as a model for analog propagation, charge flow, magnetic flux, thermal diffusion, or AC behavior.
- Do not infer causal replay, waveform comparison, or formal timing analysis from debug visualization or signal names alone.
- Do not copy hidden connectivity. StarRupture's own graph/debug surface is evidence that large connected systems require explicit inspection tools.

## Audit findings

### Confirmed strengths

- The installed build is a functioning UE packaged application with a large indexed IoStore container and recoverable global reflection data.
- The unusually large PDB exposes the custom native architecture, including electricity subgraphs, powered devices, logistics graphs, request state, building sockets, inventory, crafting, debug processors, and test-oriented types.
- The package index and extracted cooked assets independently confirm storage, drone-rail topology, vertical connectors, generator/recipe data, inventory UI, and logistics-priority UI.
- The best transferable idea is observability at network scale: named subgraphs, balance summaries, connection state, request lifecycle, first blocked hop, and explicit state-change signals.

### Limits and uncertainty

- The original Perforce source tree is not installed. PDB symbols and source paths do not provide the native function bodies.
- Cooked Blueprint/data assets expose serialized references and names, not complete Blueprint graphs or all runtime implementation details.
- No exact power, energy, transport, inventory, crafting, temperature, or scheduling equation was recovered.
- The audit did not attach a debugger, inject code, patch the game, or instrument a live session.
- The 45.5 GB main `.ucas` was not fully extracted; the conclusions use the verified index, targeted package extraction, reflection data, and PDB evidence.

## Final recommendation

Use StarRupture as a reference for **network architecture, observability, scalability, and failure explanation**. Prioritize those lessons after the current physics corrections, but do not import its discrete power abstraction into ChipBlocks' physical solver. The next implementation-oriented audit should turn the verified concepts above into a small, testable ChipBlocks observability checklist rather than adding unvalidated physics behavior.
