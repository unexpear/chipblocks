# Alchemy Factory Deep-Dive Audit

**Audit date:** 2026-09-14  
**Scope:** Installed Windows build, IoStore container metadata, selected cooked Blueprint/data assets, the global Unreal reflection table, and comparison with the current ChipBlocks implementation.  
**Change control:** No ChipBlocks source, tests, fixtures, or existing documentation were edited for this audit. This file is the only repository artifact added by this audit.

## Executive verdict

Alchemy Factory is a strong reference for factory-flow and network observability, but it is not a source of electrical or physical correctness. The installed build is an Unreal Engine 5.7 packaged game whose recoverable gameplay surface includes:

- a native `BeltTD` gameplay module with building, inventory, crafting, pipeline, belt, track, supply, liquid, steam, and network classes;
- data-driven building, workbench, recipe, item, skill, quest, and contract configuration;
- discrete item/cargo movement through inventories, belts, tracks, portals, and pipelines;
- explicit splitter, merger, filter, priority, uploader, downloader, and transfer components;
- rate- and percentage-oriented queries such as output rate, production progress, boiling percentage, and generating percentage;
- factory error enums, facility-error queries, inspection widgets, and notification/status panels;
- in-world grid building, reusable blueprint packaging, filters, and configuration panels rather than a circuit-style node graph.

The most useful ChipBlocks lesson is to make large connected systems inspectable at the network level: show endpoint roles, filters, queues, rates, limits, error states, and the causal path from a source to a blocked or under-served destination. Alchemy Factory has strong evidence of those concepts in its runtime classes and UI assets. It does **not** provide recoverable evidence for the underlying equations, so its names must not be treated as physics authority.

## Evidence and provenance

### Installed build

- Steam AppID: `3669570` (`Alchemy Factory`).
- Steam build ID: `25267026`.
- Install directory: `D:\SteamLibrary\steamapps\common\Alchemy Factory`.
- Shipping executable: `D:\SteamLibrary\steamapps\common\Alchemy Factory\AlchemyFactory\Binaries\Win64\AlchemyFactory-Win64-Shipping.exe`.
- Executable size: `155,609,600` bytes.
- Shipping executable SHA-256: `D7F36125D6E72A3D1236A070645AF57472FB0879B97E924FD105148A29C13AFA`.
- Executable version string: `++UE5+Release-5.7-CL-51494982`.
- Product/company metadata: `AlchemyFactory` / `D5 Copperhead`.
- The executable is a native PE32+ x86-64 binary with no CLR header. Its meaningful source-path strings are Unreal Engine paths; no game `.cpp`, `.h`, PDB, map, project, or plugin source files are installed.

### IoStore containers

- Main container index: `D:\SteamLibrary\steamapps\common\Alchemy Factory\AlchemyFactory\Content\Paks\AlchemyFactory-Windows.utoc`.
- Main data container: `D:\SteamLibrary\steamapps\common\Alchemy Factory\AlchemyFactory\Content\Paks\AlchemyFactory-Windows.ucas`.
- Main container metadata reported by `retoc 0.1.5`:
  - container: `AlchemyFactory-Windows`;
  - version: `ReplaceIoChunkHashWithIoHash`;
  - flags: `Compressed | Indexed`;
  - compression: `Oodle`;
  - chunks: `11,620`;
  - packages: `6,560`;
  - mount point: `../../../`.
- Global reflection container: `D:\SteamLibrary\steamapps\common\Alchemy Factory\AlchemyFactory\Content\Paks\global.utoc` / `global.ucas`.
- Global container contains one `ScriptObjects` chunk of `3,023,959` bytes.
- `retoc verify` completed successfully for the main container.

### Recovery method

The following externally generated evidence files were used:

- `C:\Users\micha\Desktop\alchemy-factory-list.txt` — full IoStore directory listing with chunk IDs, types, sizes, and paths.
- `C:\Users\micha\Desktop\alchemy-factory-manifest.txt` — extracted container manifest.
- `C:\Users\micha\Desktop\alchemy-factory-utoc-strings.txt` — low-level string recovery from the `.utoc`.
- `C:\Users\micha\Desktop\alchemy-factory-script-objects.txt` — global Unreal reflection names from `retoc print-script-objects`.
- `C:\Users\micha\Desktop\alchemy-factory-beltTD-objects.txt` — extracted `/Script/BeltTD` reflection section.
- `C:\Users\micha\Desktop\alchemy-factory-selected-list.txt` — selected package list.
- `C:\Users\micha\Desktop\alchemy-factory-selected-map.csv` — selected package-to-chunk mapping.
- `C:\Users\micha\Desktop\alchemy-factory-selected` — 98 selected cooked `.uasset` payloads, totaling `917,860` bytes.

The selected extraction covered production buildings, splitters/mergers, portals, track components, workbench and recipe widgets, inventory-related UI, and data tables. It did not unpack the full multi-gigabyte content container.

The installed Unreal Engine 5.5 `UnrealPak.exe` was also tested, but it rejected the game container with `Invalid pak file version (12)`. That is a tool/version mismatch, not evidence that the package is invalid. The successful `retoc` extraction is the authoritative recovery path used here. Epic documents `.utoc` as the IoStore metadata/index and `.ucas` as the data container in its [Zen Loader documentation](https://dev.epicgames.com/documentation/unreal-engine/zen-loader-in-unreal-engine). The recovery CLI and its supported commands are documented in the [`retoc` README](https://github.com/trumank/retoc).

## Recovered package inventory

The verified directory listing contains:

- `6,560` `ExportBundleData` records;
- `6,555` `.uasset` packages and `5` `.umap` packages;
- `648` packages under Blueprint paths;
- `210` packages under widget (`WBP`) paths;
- `148` building Blueprint packages;
- `55` data-table packages;
- `449` packages under the main gameplay/core/building/widget paths.

The production catalog is visibly data-driven. The building table includes names such as `Assembler`, `Processor`, `Blender`, `Athanor`, `Extractor`, `SteamBoiler`, `ThermalExtractor`, `Hopper`, `Filter`, `Splitter`, `Merger`, `Portal`, `Railroad`, `TrackTransfer`, `TrackUploader`, `TrackDownloader`, and `SmartHopper`. This is package evidence, not an inference from marketing text.

## Recovered architecture

### Native gameplay/reflection layer

The global `ScriptObjects` table contains a custom `/Script/BeltTD` module. The recovered names are not source code, but they identify the runtime boundaries and callable contracts exposed to cooked Blueprints.

The core application classes include:

- `BeltTDGameModeBase`, `BeltTDGameStateBase`, `BeltTDGameInstance`, `BeltTDPlayerController`, `BeltTDPlayerState`, and `BeltTDHUD`;
- `BeltTDBuildingConfig`, `BeltTDCraftingConfig`, `BeltTDItemData`, `BeltTDLiquidData`, `BeltTDLevelConfig`, `BeltTDIngredientCount`, and `BeltTDInventory`;
- `BeltTDBlueprintFunctionLibrary` and its configuration/query functions;
- `EBeltTDConfigType`, `EBeltTDCraftType`, `EBeltTDNetworkRole`, and `EBeltTDFactoryErrorMsg`.

The function library exposes names including `GetBuildingConfigTable`, `GetCraftingRecipeList`, `GetSupplyOrderList`, `GetFilterItemList`, `GetItemTotalProduce`, `GetItemTotalStock`, `GetItemTotalSell`, `GetItemUnlockLevel`, `DoesRecipeTypeNeedHeat`, `DoesRecipeTypeOutputLiquid`, `GetIsItemLiquid`, and `GetFacilityErrorMsg`. These names confirm configuration and status-query surfaces; they do not reveal the equations behind rates or resource consumption.

### Facilities and component contracts

The reflection table includes separate runtime components for different facility behaviors:

- `BuildingComponentBase`, `BuildingFacilityComponent`, `BuildingConsumeComponent`, and `BuildingProduceComponent`;
- `CraftFacilityComponent`, with `GetAvailableRecipeNames`, `GetCraftingPercentage`, `GetProducingRecipe`, `SetRecipeName`, `NetCommandSetRecipeName`, and `OnRep_RecipeUpdate`;
- `LiquidContainerComponent`, with recipe and liquid update events;
- `SupplyFacilityComponent`, with `CollectAvailableOutputs`, `GetOutputRateInSeconds`, `NetCommandSetOutputSpeed`, and `NetCommandSetSupplyItemName`;
- `SteamBoilerComponent`, with `GetBoilerHeatConsumeSpeed`, `GetBoilingPercentage`, `NetCommandSetBoilingPower`, and a power-change delegate;
- `FilterSplitterComponent`, `PrioritySplitterComponent`, and `PriorityMergerComponent`;
- `InventoryComponent`/`InventoryInstance` helpers for accepting, moving, filtering, splitting, restocking, and removing items.

Selected cooked Blueprints corroborate the separation. For example:

- `BP_Assembler.uasset`, `BP_Processor.uasset`, `BP_Blender.uasset`, `BP_Athanor.uasset`, and `BP_Extractor.uasset` contain `CraftFacility`, `CraftFacilityComponent`-style class references and component-specific visual behavior.
- `BP_FilterSplitter.uasset` identifies a `FilterSplitter` class; `BP_PrioritySplitter.uasset` identifies `PrioritySplitter`; `BP_PriorityMerger.uasset` identifies `PriorityMerger`.
- `BP_InputPortal.uasset` and `BP_OutputPortal.uasset` contain `Port0`, `Port1`, `PortConnectedEvent`, door update functions, and integer port switching. This is direct evidence of configurable multi-port facilities.
- `BP_Assembler.uasset` and `BP_Processor.uasset` expose Blueprint tick/gear/rotation behavior separately from the production component contract, showing that presentation and production logic are not the same layer.

### Pipelines, belts, and network movement

The custom reflection table includes explicit pipeline entities and link points:

- `PipelineConnect`;
- `PipelineEntity`;
- `PipelineLinkPoint`;
- `PipelinesBuildingSystem`;
- `PipelineSystem`;
- `PipelineTimeLegacy`;
- `NetSyncPipelinePackage`.

The same module contains a separate track/cargo family:

- `TrackStartComponent`, `TrackEndComponent`, `TrackFilterComponent`, `TrackMergerComponent`, `TrackTransferComponent`, `TrackUploaderComponent`, and `TrackDownloaderComponent`;
- `TrackFilterSettings`, `TrackFilterCargoRule`, `TrackFilterColorRule`, `TrackFilterTagRule`, and `TrackFilterRuleOptions`;
- `GetFilterSettings`, `IsFilterSettingsValid`, `TryGetWaitingCargo`, `TryGetReadyCargo`, `GetLoadFilterSettings`, `GetUnloadFilterSettings`, `NetCommandSetRequireFullCargo`, and `NetCommandSetTrackStartSettings`;
- `GetGeneratngPercentage` on the track-start component and `TrackStartSettings`/`TrackTransferFilterSettings` data structures.

This is stronger evidence than a list of mesh names: the runtime has distinct network objects, connection/link concepts, endpoint filters, readiness checks, cargo waiting, and replicated configuration commands. The recovered reflection table still does not disclose whether a given transport uses a fixed tick, a queue model, a distance model, or another rate calculation.

### Recipes, throughput, and data-driven configuration

The selected data tables and widgets expose the user-facing production contract:

- `DT_Buildings.uasset` contains a large building catalog, localization references, building categories, and names for production/logistics facilities.
- `DT_Workbench.uasset` contains unlockable/craftable equipment names and tier labels.
- `WBP_RecipeInfoPanel.uasset` contains `IngredientList`, `Product1`, `Product2`, `FailRate1`, `FailRate2`, `SuccessRate`, `CraftingTime`, `RecipeType`, `FactoryName`, and `GetDataTableRowFromName` calls.
- `WBP_WorkbenchPanel.uasset` contains `CanCraftGear`, `CanUnlockWorkbenchOption`, `GetNextTierGearList`, `GetWorkbenchOptionUnlockCost`, `CraftHolding`, `CraftHoldTime`, `CraftTotalTime`, `UnlockHolding`, `UnlockHoldTime`, `UnlockTotalTime`, and material-list update paths.
- `WBP_RecipeInfoPanel.uasset` also calls `GetCraftTypeFactoryName`, formats craft time, displays ingredients/products, and shows success/failure information.
- `SupplyFacilityComponent` exposes an explicit output-rate query and output-speed command.

Therefore the game is demonstrably rate- and recipe-aware. It is not correct to turn those names into an equation such as `items / second = speed / distance` without recovering the native implementation or measuring the running game.

### Editor, construction, and reuse interaction

The inspected build is not a node-based circuit editor. Its authoring model is spatial construction plus configurable building components.

Verified interaction surfaces include:

- building Blueprint packages with grid/preview/snap concepts in the recovered content catalog;
- `WBP_WorkbenchPanel` list selection, hold-to-craft, hold-to-unlock, costs, tier lists, and item inspection;
- `WBP_PackBlueprint.uasset` references to selection, folders, edit/clone behavior, `PackToBlueprint`, blueprint directories, and upload/reupload paths;
- filter settings for belts/tracks and port-connected events for input/output portals;
- `BeltTDInventoryInstance` methods for smart movement, item filters, restocking, and cross-inventory transfer.

This suggests a reusable factory-section/template workflow, but the installed package evidence does not prove that it behaves like ChipBlocks' reusable digital block graph. The appropriate lesson is serialized subassembly and inspectable configuration, not visual node syntax.

### Debugging and observability

The build has status and inspection infrastructure, but the recovered evidence does not show a causal debugger comparable to ChipBlocks' replay/trace tools.

Confirmed status/inspection evidence includes:

- `EBeltTDFactoryErrorMsg` and `GetFacilityErrorMsg`;
- `DebugItemToolTipRefChain`;
- `WBP_ErrorInfo`, `WBP_GameStateData`, `WBP_ItemInspection`, `WBP_QueuedNotifyMsg`, `WBP_RecipeInfoPanel`, and `WBP_TemperatureTile` asset names;
- inventory inspection and item-count queries;
- filter validity, cargo readiness/waiting, output-rate, production-percentage, boiling-percentage, and facility-error query names.

The evidence supports “inspect current state and show errors.” It does not support claiming a formal signal trace, source-to-destination causal replay, breakpoint, stepper, waveform comparison, or timing analyzer. `FatalErrorCrash` is present in the reflection table, but that is not a debugger.

## Comparison with current ChipBlocks

### Where ChipBlocks already matches or exceeds this reference

- `C:\Users\micha\Desktop\chipzzzd\src\renderer\net-inspector.ts` already reports drivers, loads, passives, unknown endpoints, contention, undriven nets, current, voltage drop, wire length, and resistance.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\causal-replay.ts` already maps digital transitions and transient net/current changes to source blocks, terminals, nets, and diagnostics. This is more explicit causal instrumentation than the recovered Alchemy assets prove.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\run-trace.ts` already stores per-cycle values, settling, gate sweeps, register changes, and anomalies.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\block-tests.ts` already supports deterministic cycle tests and expected output arrays.
- `C:\Users\micha\Desktop\chipzzzd\src\renderer\timing-panel.tsx` and `C:\Users\micha\Desktop\chipzzzd\src\static-timing.ts` already provide critical-path, logic-depth, clock, setup-slack, and hold-violation analysis.
- ChipBlocks has a materially broader physical scope: DC, transient, AC, device models, electro-thermal feedback, magnetic components, scopes, meters, math views, PCB, and FPGA tooling. Alchemy Factory's recovered contracts do not replace any of those physics models.

### High-value lessons to borrow

1. **Network-level inspection:** Give every connected domain an inspectable summary: endpoints, roles, selected filters, queues, rates, capacity, readiness, errors, and the first blocked hop.
2. **Endpoint configuration as a first-class contract:** Alchemy exposes filter settings, priority split/merge behavior, supply-item selection, full-cargo requirements, and recipe selection. ChipBlocks should keep equivalent pin/net/block settings visible in one place.
3. **Resource-domain separation:** Alchemy has distinct class families for item inventories, liquids, pipelines, tracks, steam, and facilities. ChipBlocks can use the same UX idea for electrical, thermal, magnetic, mechanical, and control domains without conflating their units.
4. **Rate and progress inspection:** Expose unit-bearing throughput, queue age, utilization, capacity, and progress at the endpoint and network level. Do not copy Alchemy's unknown formulas; copy the visibility.
5. **Data-driven component catalogs:** Keep a block's pin contract, legal configuration, recipe/model parameters, and inspection view together, similar to the relationship between `DT_Buildings`, `DT_Workbench`, `WBP_RecipeInfoPanel`, and facility components.
6. **Reusable subassemblies:** Investigate a ChipBlocks equivalent of packable factory blueprints for reusable block groups, while preserving typed ports, parameter overrides, and electrical-domain validation.

### What not to copy

- Do not treat `GetOutputRateInSeconds`, `GetCraftingPercentage`, or `GetBoilingPercentage` as real-world physical equations; only the names and UI contracts were recovered.
- Do not equate factory cargo throughput with current, charge flow, voltage, or power without a domain-specific model and units.
- Do not use a factory network's discrete item movement to model analog signal propagation, fluid pressure, magnetic flux, thermal diffusion, or AC phase.
- Do not infer a causal debugger from status widgets, `FatalErrorCrash`, or error enums.
- Do not replace ChipBlocks' existing causal replay, net diagnostics, and solver tests with a purely visual network map.

## Audit findings

### Confirmed strengths

- The installed build is a functioning UE5.7 packaged application with a large, verified IoStore content set; it is not merely a set of screenshots or static meshes.
- The global reflection data confirms a custom `BeltTD` runtime with separate building, inventory, recipe, facility, pipeline, belt, track, liquid, steam, and network concepts.
- Selected cooked assets confirm configurable splitters/mergers, multi-port portals, production facilities, recipe panels, workbench progression, inventory movement, and reusable blueprint packaging.
- The strongest transferable idea is observability for large connected systems: endpoint settings, readiness, capacity, rates, and errors should be visible without requiring users to guess which connection is responsible.

### Limits and uncertainty

- No original game source was recovered. Native `BeltTD` function bodies are not present in the install, and the shipping executable has no game PDB or source files.
- Cooked Blueprint string recovery exposes class/property/function names and some serialized references, but it does not reconstruct complete Blueprint graphs or native implementation logic.
- No equation-level claims are made about factory speed, transport timing, queue scheduling, inventory limits, pipeline behavior, steam behavior, or temperature behavior.
- The audit did not patch or instrument the executable, inject code, or alter game data.
- The UnrealPak extraction attempt used an incompatible installed UE5.5 tool and was rejected by the UE5.7 package version; successful recovery used `retoc` instead.
- No ChipBlocks source or existing documentation was changed beyond this audit file.

## Bottom line

Alchemy Factory is useful for ChipBlocks at the **network UX, inspection, configuration, reusable-subassembly, and bottleneck-visibility** layers. It is not useful as authority for circuit physics. The current ChipBlocks implementation already has stronger causal and electrical diagnostics; the next useful step would be to make those diagnostics read more like an inspectable network control panel: identify the responsible source, show every hop and endpoint contract, quantify the limiting resource in correct units, and state whether the result is driven, floating, contended, overloaded, unsupported, or merely waiting.
