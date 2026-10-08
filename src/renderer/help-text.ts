/**
 * Every hover-help sentence, in one place. Ids are stable: the screen says
 * `helpId="toolbar.wire"`, and the words live here. A part id is `part.<definition>`.
 * Read the control before changing a sentence — the line has to match what the
 * code actually does.
 */
import type { KeybindAction } from './keybinds.ts'
import { categoryLabelOf } from './part-categories.ts'

export type HelpEntry = {
  name: string
  summary: string
  detail?: string
  shortcut?: KeybindAction
  shortcutText?: string
}

export const HELP: Record<string, HelpEntry> = {
  'tool.wire': {
    name: 'Wire',
    summary: 'Draw a connection: click to start, click to turn a corner, click a dot to finish.',
    detail: 'Double-click empty space to end the wire there. Escape abandons it.',
    shortcut: 'cancelWire',
  },
  'tool.connect': {
    name: 'Connect',
    summary: 'Click two dots and the app draws the wire between them for you.',
    detail: 'Single lays each wire as you pick it. Batch waits until you press Route all.',
    shortcut: 'cancelWire',
  },
  'tool.lasso': {
    name: 'Lasso',
    summary: 'Draw any shape around parts to select the ones whose middle sits inside it.',
    detail:
      'A plain drag on empty sheet still box-selects. The lasso is for shapes a box cannot make.',
  },
  'tool.meter': {
    name: 'Meter',
    summary:
      'Probe the circuit like a handheld meter: red lead, then black, or clamp a wire for amps.',
    detail: 'The dial on the readout picks volts, ohms, diode test, capacitance, or temperature.',
  },
  'toolbar.solve': {
    name: 'Solve',
    summary: 'Run the physics now and refresh every current, voltage, and wire reading.',
    detail:
      'Use this after you turn Always on off, so a big edit does not recompute on every move.',
  },
  'toolbar.alwaysOn': {
    name: 'Always on',
    summary: 'Recompute the circuit on every change.',
    detail: 'Turn it off on a large sheet, edit, then press Solve once.',
  },
  'toolbar.ambient': {
    name: 'Ambient temperature',
    summary: 'The air temperature around the whole board, in degrees Celsius.',
    detail: 'A bench is 25 °C. Parts use this unless you set their own ambient temperature.',
  },
  'toolbar.ambientPreset': {
    name: 'Temperature preset',
    summary: 'Jump to a standard environment: bench, cold, industrial, or automotive.',
    detail: 'A number that is not on the list shows as Custom.',
  },
  'toolbar.addPart': {
    name: 'Add Part',
    summary: 'Open a searchable list of every part and drop the one you pick onto the sheet.',
    detail: 'The part lands in the middle of the view. Drag it where you want it.',
  },
  'toolbar.newPart': {
    name: 'New Part',
    summary: 'Make your own part: a name, pins, and optional starting values.',
    detail: 'It joins the parts list and places like any built-in part.',
  },
  'toolbar.newFootprint': {
    name: 'New Footprint',
    summary: 'Draw the copper pads and body a part solders onto.',
    detail: 'Once saved, you can assign that package so the part can land on a board.',
  },
  'toolbar.scope': {
    name: 'Scope',
    summary: 'Run the circuit through time and plot the voltages you probe.',
  },
  'toolbar.timeline': {
    name: 'Timeline',
    summary: 'Play the same time-domain result back on the sheet, without solving again.',
    detail: 'Scrub or step to watch currents build, reverse, and settle.',
  },
  'toolbar.bode': {
    name: 'Bode',
    summary: 'Plot gain and phase against frequency between a source and a node.',
  },
  'toolbar.reflection': {
    name: 'Reflection',
    summary: 'Show how much of a signal a port reflects, as return loss and VSWR.',
    detail: 'Pick a Port and a reference impedance. Peaks are frequencies that match well.',
  },
  'toolbar.distortion': {
    name: 'Distortion',
    summary: 'Drive a stage hard and read compression and harmonics from a real time-domain run.',
    detail: 'This is the large-signal view. Bode and Reflection stay small-signal.',
  },
  'toolbar.sparam': {
    name: 'S-parameters',
    summary: 'Plot the two-port scattering matrix against frequency at a reference impedance.',
    detail: 'Transmission is how much gets through. Match is how much each port reflects.',
  },
  'toolbar.pcb': {
    name: 'PCB',
    summary: 'Open the board panel: placed parts, routing, the design-rule check, and export.',
  },
  'toolbar.plan': {
    name: 'Plan',
    summary: 'The checklist of board rules still being brought in line with a real fab.',
  },
  'toolbar.verilog': {
    name: 'Verilog',
    summary: 'Write Verilog and synthesize the gates and flip-flops it can build onto the sheet.',
  },
  'toolbar.trace': {
    name: 'Run-trace',
    summary: 'Clock a digital block for many cycles and flag cycles that never settle or glitch.',
  },
  'toolbar.stress': {
    name: 'Stress',
    summary: 'Sweep temperature, supply, or a part value and show where each part gives out.',
  },
  'toolbar.workspace': {
    name: 'Board view',
    summary: 'Fill the window with the physical board instead of the schematic.',
    detail: 'The schematic stays put underneath. Use the breadcrumb to come back.',
  },
  'toolbar.group': {
    name: 'Group',
    summary: 'Turn the selected parts into one block. The solver still sees the parts inside.',
    detail:
      'Wires that cross the selection become the block’s pins. Double-click the block to look inside.',
  },
  'toolbar.clipboard': {
    name: 'Clipboard',
    summary: 'Open the last copies and the one cut, and click one to paste it.',
    shortcut: 'paste',
  },
  'toolbar.math': {
    name: 'Math',
    summary:
      'Show each part’s law with the numbers from this solve, and re-add the currents at every net.',
  },
  'toolbar.margins': {
    name: 'Margins',
    summary:
      'Show how close each part is to its limit, including tolerance and a Monte-Carlo spread.',
  },
  'toolbar.tests': {
    name: 'Tests and preflight',
    summary: 'Save a check and run it on a copy of the circuit, leaving the sheet unchanged.',
  },
  'lens.menu': {
    name: 'Lenses',
    summary: 'Colour the solved sheet by voltage, power, temperature, magnetic field, or energy.',
    detail: 'One colour view at a time. Flow can run on top of any of them.',
  },
  'lens.off': {
    name: 'Lens off',
    summary: 'Clear the colour overlay and show the sheet in its normal colours.',
  },
  'lens.voltage': {
    name: 'Voltage',
    summary: 'Colour each wire by its solved voltage, from low to high.',
  },
  'lens.power': {
    name: 'Power',
    summary: 'Colour each part by the watts it is actually dissipating.',
  },
  'lens.temp': {
    name: 'Temperature',
    summary: 'Colour each part by its solved temperature.',
  },
  'lens.field': {
    name: 'Magnetic field',
    summary: 'Draw the magnetic field around wires that are carrying current.',
  },
  'lens.energy': {
    name: 'Energy flow',
    summary: 'Show which way energy is moving through the solved circuit.',
  },
  'lens.flow': {
    name: 'Flow',
    summary: 'March dashes along each wire in the direction of the solved current.',
    detail: 'Speed follows how much current is flowing. It can sit on top of a colour lens.',
  },
  'wire.straight': {
    name: 'Sharp corners',
    summary: 'Keep the wire’s corners square. Its resistance follows the length you draw.',
  },
  'wire.curve': {
    name: 'Rounded corners',
    summary:
      'Round the corners. The wire is a little shorter, so its resistance is a little lower.',
    detail: 'Radio reflections and high-voltage crowding at a sharp point are not in this solve.',
  },
  'wire.curveSize': {
    name: 'Corner radius',
    summary: 'How soon the wire starts bending before each corner.',
    detail: 'A larger sweep cuts more of the corner. Each wire keeps the size it was drawn with.',
  },
  'wire.gauge': {
    name: 'Wire gauge',
    summary: 'The thickness of wires you draw from now on.',
    detail:
      'Thinner wire is more resistance and more heat. A wire you already drew keeps its own gauge.',
  },
  'connect.single': {
    name: 'Single',
    summary: 'Lay each wire as soon as you pick its two ends.',
  },
  'connect.batch': {
    name: 'Batch',
    summary: 'Mark several pairs first, then route them together.',
    detail: 'Nothing is drawn until you press Route all, so the paths can avoid each other.',
  },
  'connect.routeAll': {
    name: 'Route all',
    summary: 'Draw every queued pair in one pass.',
  },
  'connect.clear': {
    name: 'Clear queue',
    summary: 'Forget the pairs you marked, without drawing them.',
  },
  'status.components': {
    name: 'Components',
    summary: 'How many parts are on this sheet, not counting the wires between them.',
  },
  'status.wires': {
    name: 'Wires',
    summary: 'How many connections are drawn on this sheet.',
  },
  'status.gestures': {
    name: 'Editing',
    summary: 'Click a part to select it. The key shown turns it. Delete removes it.',
    detail: 'Double-click a switch to open or close it.',
    shortcut: 'rotate',
  },
  'status.wireTool': {
    name: 'Wire tool',
    summary: 'Click to start, click corners, click a dot to finish. Escape cancels.',
    shortcut: 'cancelWire',
  },
  'status.lassoTool': {
    name: 'Lasso',
    summary: 'Press and draw around parts, then release to select them.',
  },
  'status.connectTool': {
    name: 'Connect tool',
    summary: 'Click a start dot, then an end dot. Escape cancels a half-made connection.',
    shortcut: 'cancelWire',
  },
  'status.paused': {
    name: 'Physics paused',
    summary:
      'The circuit is not recomputing on each edit. Press Solve when you want a fresh answer.',
  },
  'crumb.circuit': {
    name: 'Circuit',
    summary: 'The schematic: parts and the wires between them.',
  },
  'crumb.board': {
    name: 'Board',
    summary: 'The physical board for this same design: footprints, copper, and the outline.',
  },
  'crumb.chip': {
    name: 'Chip',
    summary: 'The chip floorplan for this design.',
  },
  'crumb.system': {
    name: 'System',
    summary: 'A whole product made of boards. This level is not in the app yet.',
    detail: 'The button stays off until that level exists.',
  },
  'dock.move': {
    name: 'Move panel',
    summary:
      'Drag the grip to snap this panel to a screen edge, or drop it onto another panel to stack them.',
  },
  'dock.tab': {
    name: 'Panel tab',
    summary: 'Click to show this panel. Drag the tab out to an edge to give it its own frame.',
  },
  'palette.search': {
    name: 'Search parts',
    summary: 'Narrow the list by a part’s name or its id. An empty box shows everything.',
  },
  'palette.section.catalog': {
    name: 'Catalog',
    summary: 'Purchasable parts with real pinouts, such as the regulator, clock, flash, and FPGA.',
    detail: 'What is inside those chips is not simulated. They are a black box at their pins.',
  },
  'palette.section.yours': {
    name: 'Your parts',
    summary: 'Parts you made with New Part. Drag one onto the sheet to place it.',
  },
  'palette.section.library': {
    name: 'Library',
    summary: 'Parts from an installed content pack. They place and wire like a built-in part.',
  },
  'palette.section.blocks': {
    name: 'Blocks',
    summary: 'Blocks already on this sheet. Drag one to drop an independent copy.',
  },
  'palette.blockCopy': {
    name: 'Block',
    summary: 'Places another copy of this block, with its own parts inside.',
    detail: 'Delete the last copy and the block leaves the list with it.',
  },
  'picker.search': {
    name: 'Search',
    summary: 'Type to rank parts. Arrow keys move, Enter places the highlighted one.',
    detail: 'Escape clears the text first, then closes the window.',
  },
  'picker.clear': {
    name: 'Clear search',
    summary: 'Empty the search box and show the sections again.',
  },
  'picker.place': {
    name: 'Place',
    summary: 'Drop the highlighted part in the middle of the view.',
    detail: 'Enter and a double-click do the same thing.',
  },
  'picker.cancel': {
    name: 'Cancel',
    summary: 'Close this list without placing a part.',
  },
  'math.close': {
    name: 'Close math',
    summary: 'Hide the equations. The solve on the sheet stays as it is.',
  },
  'math.how': {
    name: 'How it solves',
    summary: 'The method this answer used, in the same words the engine reports.',
  },
  'math.laws': {
    name: 'Each part’s law',
    summary: 'The equation for that part with this solve’s numbers filled in.',
  },
  'math.kcl': {
    name: 'Current law',
    summary: 'Every current at a junction is added again. The sum has to be zero.',
    detail: 'The check mark is that sum, not a label we assumed.',
  },
  'math.balanced': {
    name: 'Balanced',
    summary: 'The currents at this net add to about zero, so charge is not piling up here.',
  },
  'math.unbalanced': {
    name: 'Not balanced',
    summary:
      'The currents at this net do not add to zero. The solve does not satisfy current law here.',
  },
  'tests.close': {
    name: 'Close tests',
    summary: 'Hide the test bench. Saved checks stay with the project.',
  },
  'tests.analysis': {
    name: 'Analysis',
    summary: 'Which solver the check uses: steady, time, frequency, or digital cycles.',
    detail:
      'Electrical checks expand blocks and use the named solver, not the live logic shortcut.',
  },
  'tests.save': {
    name: 'Save check',
    summary: 'Keep this expectation with the project. It does not run until you press Run.',
  },
  'tests.run': {
    name: 'Run',
    summary: 'Run this check on a copy of the circuit. The sheet you are editing is not changed.',
  },
  'tests.advanced': {
    name: 'Advanced definition',
    summary: 'Open the check as text so you can edit windows, tolerances, and extra assertions.',
  },
  'tests.remove': {
    name: 'Remove',
    summary: 'Delete this saved check from the project.',
  },
  'tests.saveDefinition': {
    name: 'Save definition',
    summary: 'Replace the check with the text, if the text is a valid definition.',
  },
  'tests.cancelEdit': {
    name: 'Cancel edit',
    summary: 'Throw away the text edits and keep the saved check.',
  },
  'tests.selectAffected': {
    name: 'Select affected parts',
    summary: 'Select the parts this finding names, so you can see them on the sheet.',
  },
  'tests.importWaveform': {
    name: 'Import waveform',
    summary:
      'Copy a block’s saved waveform into this list. The original block test is left as it is.',
  },
  'pcb.placed': {
    name: 'Placed',
    summary: 'How many parts have a footprint on the board.',
  },
  'pcb.boardSize': {
    name: 'Board size',
    summary: 'The board outline, width by height, in millimetres.',
  },
  'pcb.routed': {
    name: 'Routed',
    summary: 'How many of the board’s connections have copper between their pads.',
    detail: 'Export stays off while any connection is still unrouted.',
  },
  'pcb.vias': {
    name: 'Vias',
    summary: 'Plated holes that carry a net from one copper layer to the other.',
  },
  'pcb.offBoard': {
    name: 'Not on the board',
    summary: 'Wired pins that have no footprint here yet, so they cannot be routed.',
    detail: 'Export stays off until every wired pin is on the board.',
  },
  'pcb.drcClean': {
    name: 'DRC clean',
    summary: 'The design-rule check found no spacing, width, or clearance problem on this board.',
  },
  'pcb.drcViolations': {
    name: 'DRC violations',
    summary: 'The design-rule check found problems. Export stays off until they are gone.',
  },
  'pcb.overCurrent': {
    name: 'Over-current not checked',
    summary: 'Trace current was not checked, because this board has no solved currents.',
    detail: 'A digital board, or a circuit that has not been solved, is not reported as clean.',
  },
  'pcb.exportZip': {
    name: 'Export ZIP',
    summary:
      'Save the manufacturing files: Gerbers, drill, parts list, placement, and a check report.',
    detail:
      'Available once parts are placed, every connection is routed, and the design-rule check is clean.',
  },
  'pcb.checkGerbers': {
    name: 'Check Gerbers',
    summary:
      'Plot the Gerber and drill files this export would write, read back from those strings.',
    detail: 'This is the file picture, not the board view. ChipBlocks output only.',
  },
  'pcb.close': {
    name: 'Close',
    summary: 'Hide the board panel. The board itself is unchanged.',
  },
  'pcb.viewFlat': {
    name: 'Flat',
    summary: 'Look straight down at the board, all layers drawn together.',
  },
  'pcb.viewLayers': {
    name: 'Layers',
    summary: 'Step through the stack one sheet at a time.',
  },
  'pcb.view3d': {
    name: '3D',
    summary: 'Pull the layers apart in space so you can see the stack and the via barrels.',
  },
  'pcb.layerUp': {
    name: 'Up a layer',
    summary: 'Show the next sheet toward the top of the stack.',
  },
  'pcb.layerDown': {
    name: 'Down a layer',
    summary: 'Show the next sheet toward the bottom of the stack.',
  },
  'pcb.copperCount': {
    name: 'Copper layers',
    summary: 'How many copper sheets the board has. Two is an ordinary board.',
    detail:
      'Four and six add buried inner planes for the 3D view. The exported files stay two-layer.',
  },
  'pcb.thickness': {
    name: 'Board thickness',
    summary: 'The finished board thickness, in millimetres.',
  },
  'pcb.copperWeight': {
    name: 'Copper weight',
    summary: 'How thick the outer copper is, in ounces per square foot.',
  },
  'pcb.finish': {
    name: 'Surface finish',
    summary: 'The coating on the exposed copper pads.',
  },
  'pcb.vscore': {
    name: 'V-score',
    summary: 'A snap-groove edge needs more copper clearance than a routed edge.',
    detail: 'V-score uses 0.4 mm. A routed edge uses 0.3 mm. Click a side to switch it.',
  },
  'pcb.impedance': {
    name: 'Trace impedance',
    summary: 'A rough single-trace impedance over the nearest plane, from the IPC-2141 formula.',
    detail: 'It is an approximation. A fab’s field solver is the number to build to.',
  },
  'pcb.cavity': {
    name: 'Add cavity',
    summary: 'Mill a pocket into the middle of the board. Open the 3D view to see it.',
    detail:
      'A controlled-depth recess cannot go in the manufacturing ZIP yet, so export stays off.',
  },
  'pcb.step': {
    name: 'Add step',
    summary: 'Mill a recess that runs out to the board edge, a thinner card edge.',
    detail:
      'A controlled-depth recess cannot go in the manufacturing ZIP yet, so export stays off.',
  },
  'pcb.recessDepth': {
    name: 'Recess depth',
    summary: 'How deep this pocket is milled, in millimetres.',
  },
  'pcb.recessFace': {
    name: 'Milled face',
    summary: 'Which side of the board the pocket is cut into.',
  },
  'pcb.recessRemove': {
    name: 'Remove recess',
    summary: 'Delete this pocket from the board.',
  },
  'pcb.dragHint': {
    name: 'Move a part',
    summary: 'Drag a footprint to move it. Click it, then press the rotate key to turn it.',
    shortcut: 'rotate',
  },
  'board.route': {
    name: 'Route',
    summary: 'Click a pad, click corners, then click a pad on the same net to lay copper.',
    detail:
      'The copper is real: it is checked and it ships in the Gerbers. It works in the flat view and in 3D.',
  },
  'board.via': {
    name: 'Via',
    summary: 'Click copper to drop a plated hole that carries the net to the other copper layer.',
  },
  'board.measure': {
    name: 'Measure',
    summary: 'Click two points to read the distance. Clicks snap to pad centres.',
    detail: 'This is a ruler. The meter tool is the one that reads volts and amps.',
  },
  'board.outline': {
    name: 'Outline',
    summary: 'Drag a corner of the board edge to reshape it.',
    detail: 'The edge-cut file and the clearance checks follow the new shape.',
  },
  'board.measureUnit': {
    name: 'Measurement unit',
    summary: 'The unit the ruler prints: millimetres, centimetres, inches, mils, or micrometres.',
  },
  'board.clearMeasures': {
    name: 'Clear measurements',
    summary: 'Remove every ruler mark from the board.',
  },
  'board.copperLayer': {
    name: 'Copper layer',
    summary: 'New traces from the Route tool land on this copper sheet.',
  },
  'board.overCurrent': {
    name: 'Over-current not checked',
    summary: 'Trace current was not checked, because this board’s currents were not solved.',
    detail: 'It is not reported as clean.',
  },
  'gerber.stack': {
    name: 'Stack',
    summary: 'Draw every plotted layer in one shared frame, looking down from the top.',
  },
  'gerber.zoomOut': {
    name: 'Zoom out',
    summary: 'Show more of the board in the plot.',
  },
  'gerber.zoomIn': {
    name: 'Zoom in',
    summary: 'Enlarge the plot.',
  },
  'gerber.fit': {
    name: 'Fit',
    summary: 'Scale the plot so the whole board fits in the frame.',
  },
  'gerber.zoomThin': {
    name: 'Zoom to thinnest line',
    summary: 'Enlarge until the narrowest stroke in view is wide enough to see.',
  },
  'content.close': {
    name: 'Close',
    summary: 'Close the content manager.',
  },
  'content.install': {
    name: 'Install from local pack',
    summary: 'Install a content pack from a file on this computer.',
    detail:
      'The file is checked for format and a permissive license. This button does not download anything. Install from registry is the download, and it writes a pack only after the checks pass.',
  },
  'content.registry.url': {
    name: 'Registry index URL',
    summary:
      'The address of a content registry you choose. Typing here does not download anything.',
    detail:
      'No registry ships with the app. A real index uses https. A file address is only for a local test.',
  },
  'content.registry.save': {
    name: 'Save registry URL',
    summary: 'Remember this address on this computer. Saving does not download or install a pack.',
  },
  'content.registry.load': {
    name: 'Load registry index',
    summary: 'Download the index at the saved address and list its packs.',
    detail:
      'Nothing is installed by loading. A download that is too large, too slow, or not https is refused.',
  },
  'content.registry.pack': {
    name: 'Pack in the index',
    summary: 'Choose which pack from the loaded index to install.',
    detail: 'The list stays empty until an index has been loaded.',
  },
  'content.registry.install': {
    name: 'Install from registry',
    summary:
      'Download the chosen pack and install it only after the size, hash, and signature match the index.',
    detail:
      'If a check fails, nothing is written. A newer version stays uninstalled until you choose it.',
  },
  'content.update': {
    name: 'Update available',
    summary: 'The registry lists a newer version of a pack you already installed.',
    detail: 'The installed version stays until you install the newer one.',
  },
  'content.fingerprint': {
    name: 'Publisher fingerprint',
    summary: 'The SHA-256 of this pack’s raw public key, so you can tell keys apart.',
    detail:
      'It names the key. It is not a certificate, and it does not by itself mean you trust the publisher.',
  },
  'content.trust.pin': {
    name: 'Trust this publisher',
    summary: 'Ask to pin this public key on this computer.',
    detail:
      'You confirm before anything is written. The pin is a key you choose, not a certificate authority. Other packs signed by the same key count as pinned too.',
  },
  'content.trust.unpin': {
    name: 'Stop trusting this publisher',
    summary: 'Ask to remove this public key from the pins on this computer.',
    detail: 'Other packs signed by the same key stop counting as pinned too.',
  },
  'content.trust.confirmPin': {
    name: 'Confirm trust',
    summary: 'Write this public key into the trusted-publishers file on this computer.',
  },
  'content.trust.confirmUnpin': {
    name: 'Confirm untrust',
    summary: 'Remove this public key from the trusted-publishers file on this computer.',
  },
  'content.trust.cancel': {
    name: 'Cancel',
    summary: 'Leave the trusted-publishers file as it is.',
  },
  'content.enable': {
    name: 'Enable',
    summary: 'Turn this pack on so its parts can be placed.',
  },
  'content.disable': {
    name: 'Disable',
    summary: 'Turn this pack off. Its parts leave the lists until you enable it again.',
  },
  'content.uninstall': {
    name: 'Uninstall',
    summary: 'Remove this pack from this computer after you confirm.',
  },
  'content.confirmUninstall': {
    name: 'Confirm uninstall',
    summary: 'Delete the pack’s files from your libraries folder.',
  },
  'content.cancelUninstall': {
    name: 'Cancel',
    summary: 'Keep the pack installed.',
  },
  'content.badge.enabled': {
    name: 'Enabled',
    summary: 'This pack is on and its parts were loaded.',
  },
  'content.badge.notLoaded': {
    name: 'Enabled, not loaded',
    summary: 'The pack is still switched on, but its parts were not registered.',
    detail: 'Read the line under the name for why the load was blocked.',
  },
  'content.badge.disabled': {
    name: 'Disabled',
    summary: 'This pack is installed but switched off, so its parts are not offered.',
  },
  'content.badge.planned': {
    name: 'Planned, not installed',
    summary:
      'This library is only a citation. Nothing is installed, and the app will not download it.',
    detail: 'To use one, obtain a local pack and choose Install from local pack.',
  },
  'content.trust.untrusted': {
    name: 'Valid, not pinned',
    summary:
      'The signature matches the key printed in the pack, and that key is not one you pinned.',
    detail:
      'That proves the file matches an author-chosen key. It does not prove you trust that author.',
  },
  'content.trust.trusted': {
    name: 'Valid, pinned',
    summary: 'The signature matches a public key you pinned in your trusted-publishers list.',
    detail: 'Trust is only as strong as that pin. There is no certificate authority behind it.',
  },
  'content.trust.none': {
    name: 'No publisher signature',
    summary: 'This pack did not declare a signature, so the app cannot say who produced it.',
    detail:
      'A content hash, when the pack has one, only says the bytes were not changed. It is not a signature.',
  },
  'shortcuts.close': {
    name: 'Close',
    summary: 'Close this panel. A change is already saved when you press the new key.',
  },
  'shortcuts.change': {
    name: 'Change',
    summary: 'Click, then press the new key. Escape cancels the change.',
    detail: 'Menu shortcuts need Ctrl or Alt. Two actions cannot share one combo.',
  },
  'shortcuts.reset': {
    name: 'Reset all',
    summary: 'Put every shortcut back to the keys the app shipped with.',
  },
}

const PART_HELP: Record<string, HelpEntry> = {
  power_source: {
    name: 'Source',
    summary: 'A voltage source. It starts as a 9 V battery you can edit.',
    detail: 'Set an AC amplitude and frequency when you want a sine on top of the DC.',
  },
  resistor: {
    name: 'Resistor',
    summary: 'A resistor. It starts at 470 Ω, 5%, a quarter watt.',
  },
  potentiometer: {
    name: 'Potentiometer',
    summary: 'A three-terminal resistor you divide with the wiper.',
  },
  thermistor: {
    name: 'Thermistor',
    summary: 'A resistor whose value moves with temperature.',
  },
  photoresistor: {
    name: 'Photoresistor',
    summary: 'A resistor whose value moves with the light falling on it.',
  },
  photodiode: {
    name: 'Photodiode',
    summary: 'A diode that leaks a current set by the light on it.',
  },
  phototransistor: {
    name: 'Phototransistor',
    summary: 'A transistor whose base current comes from light instead of a wire.',
  },
  light_source: {
    name: 'Light',
    summary: 'A small lamp the sensors can see. It starts near 10 candela.',
    detail: 'Move a sensor closer or farther and the light follows the inverse square.',
  },
  capacitor: {
    name: 'Capacitor',
    summary: 'A capacitor. It starts at 100 µF, rated 16 V.',
  },
  inductor: {
    name: 'Inductor',
    summary: 'An inductor. It starts at 10 mH, with the winding resistance of that choke.',
  },
  electromagnet: {
    name: 'Electromagnet',
    summary: 'A coil that pulls while current flows in it.',
  },
  dc_motor: {
    name: 'DC motor',
    summary: 'A brushed DC motor: voltage on the terminals, torque and speed out.',
  },
  generator: {
    name: 'Generator',
    summary: 'A machine that turns mechanical drive into a DC voltage.',
  },
  alternator: {
    name: 'Alternator',
    summary: 'A machine that turns mechanical drive into AC.',
  },
  alternator_three_phase: {
    name: 'Three-phase alternator',
    summary: 'An alternator with three AC outputs, 120 degrees apart.',
  },
  induction_motor: {
    name: 'AC motor',
    summary: 'An induction motor that runs from an AC supply.',
  },
  induction_motor_three_phase: {
    name: 'Three-phase motor',
    summary: 'An induction motor fed from three phases.',
  },
  induction_motor_single_phase: {
    name: 'Single-phase motor',
    summary: 'An induction motor that runs from one AC phase.',
  },
  induction_motor_shaded_pole: {
    name: 'Shaded-pole motor',
    summary: 'A small single-phase induction motor with a shading turn for starting.',
  },
  transmission_line: {
    name: 'Transmission line',
    summary: 'A wire long enough that the signal takes time to travel along it.',
  },
  reference_port: {
    name: 'Port',
    summary: 'An RF port. Reflection and S-parameters measure at a port like this.',
  },
  transformer: {
    name: 'Transformer',
    summary: 'Two coupled windings. AC on one side appears, scaled, on the other.',
  },
  transformer_center_tapped: {
    name: 'Center-tapped transformer',
    summary: 'A transformer whose secondary has a tap in the middle.',
  },
  diode_silicon_rectifier: {
    name: 'Diode',
    summary: 'A silicon diode. It conducts one way and blocks the other.',
  },
  diode_schottky_al_si: {
    name: 'Schottky diode',
    summary: 'A diode with a lower forward drop than an ordinary silicon rectifier.',
  },
  diode_zener_silicon: {
    name: 'Zener diode',
    summary: 'A diode that holds a voltage when driven backwards, used as a reference.',
  },
  diode_constant_current: {
    name: 'Current-regulator diode',
    summary: 'A diode that holds a roughly steady current once it is conducting.',
  },
  led: {
    name: 'LED',
    summary: 'A light-emitting diode. It starts as a red LED, about 2 V at up to 20 mA.',
  },
  led_uv_algan: {
    name: 'UV LED',
    summary: 'An ultraviolet LED. It needs a higher forward voltage than a red one.',
  },
  incandescent_bulb: {
    name: 'Bulb',
    summary: 'A filament lamp. It lights from the current through the filament.',
  },
  arc_lamp: {
    name: 'Arc lamp',
    summary: 'A lamp that lights from an arc once the gas breaks down.',
  },
  neon_lamp: {
    name: 'Neon lamp',
    summary: 'A small gas lamp that glows once the voltage across it is high enough.',
  },
  diode_laser: {
    name: 'Laser diode',
    summary: 'A diode that emits a laser beam once it is driven past threshold.',
  },
  diode_tunnel: {
    name: 'Tunnel diode',
    summary: 'A diode with a region where more voltage means less current.',
  },
  diode_shockley: {
    name: 'Shockley diode',
    summary: 'A four-layer diode that switches on once the voltage reaches its breakover.',
  },
  diode_varactor: {
    name: 'Varactor',
    summary: 'A diode used as a capacitor whose value follows the reverse voltage.',
  },
  scr: {
    name: 'SCR',
    summary: 'A thyristor. A gate pulse turns it on, and it stays on until the current falls.',
  },
  vacuum_diode: {
    name: 'Vacuum diode',
    summary: 'A tube with a heated cathode and a plate. Current flows only plate-ward.',
  },
  triode: {
    name: 'Triode',
    summary: 'A three-electrode tube. The grid voltage controls the plate current.',
  },
  tetrode: {
    name: 'Tetrode',
    summary: 'A tube with a screen grid as well as the control grid.',
  },
  pentode: {
    name: 'Pentode',
    summary:
      'A tube with a suppressor grid, so the plate can swing without the screen fighting it.',
  },
  crt: {
    name: 'CRT',
    summary: 'A cathode-ray tube: an electron beam steered onto a screen.',
  },
  transistor_bjt_npn: {
    name: 'NPN transistor',
    summary: 'An NPN bipolar transistor. A small base current controls a larger collector current.',
  },
  transistor_bjt_pnp: {
    name: 'PNP transistor',
    summary:
      'A PNP bipolar transistor. Current is controlled at the base, and the polarities are reversed from an NPN.',
  },
  transistor_mosfet_nmos: {
    name: 'NMOS',
    summary: 'An N-channel MOSFET. Voltage on the gate lets current flow from drain to source.',
  },
  transistor_mosfet_pmos: {
    name: 'PMOS',
    summary: 'A P-channel MOSFET. A gate voltage below the source turns it on.',
  },
  transistor_jfet_n_channel: {
    name: 'N-channel JFET',
    summary: 'A junction FET that conducts until a reverse gate voltage pinches it off.',
  },
  transistor_jfet_p_channel: {
    name: 'P-channel JFET',
    summary: 'A P-channel junction FET. The gate is reverse-biased to pinch the channel off.',
  },
  darlington_npn: {
    name: 'Darlington',
    summary:
      'Two NPN transistors in one package, so a tiny base current controls a large collector current.',
  },
  photo_darlington: {
    name: 'Photo-Darlington',
    summary: 'A Darlington whose first base is driven by light.',
  },
  op_amp: {
    name: 'Op-amp',
    summary: 'An amplifier block built from transistors. Descend into it to see them.',
  },
  block_divider: {
    name: 'Divider',
    summary: 'Two resistors already wired as a voltage divider. Descend to edit them.',
  },
  block_led_r: {
    name: 'LED and resistor',
    summary: 'An LED with its series resistor already in the block.',
  },
  block_rc_lowpass: {
    name: 'RC low-pass',
    summary: 'A resistor and capacitor wired as a low-pass filter.',
  },
  block_ce_amp: {
    name: 'Common-emitter amp',
    summary: 'A single-transistor amplifier, emitter on the low side.',
  },
  block_bridge: {
    name: 'Bridge rectifier',
    summary: 'Four diodes that turn AC into pulsating DC.',
  },
  block_noninv_amp: {
    name: 'Non-inverting amp',
    summary: 'An op-amp wired so the output moves the same way as the input, only larger.',
  },
  vccs: {
    name: 'Voltage-controlled current source',
    summary: 'A current source whose output current follows a voltage you pick.',
  },
  cccs: {
    name: 'Current-controlled current source',
    summary: 'A current source whose output is a gain times a current you pick.',
  },
  logic_not: {
    name: 'NOT',
    summary: 'A logic inverter built from transistors. The output is the opposite of the input.',
  },
  logic_nand: {
    name: 'NAND',
    summary: 'A NAND gate built from transistors. The output is low only when every input is high.',
  },
  logic_nor: {
    name: 'NOR',
    summary: 'A NOR gate built from transistors. The output is high only when every input is low.',
  },
  logic_and: {
    name: 'AND',
    summary:
      'An AND gate built from transistors. The output is high only when every input is high.',
  },
  logic_or: {
    name: 'OR',
    summary: 'An OR gate built from transistors. The output is high when any input is high.',
  },
  logic_xor: {
    name: 'XOR',
    summary: 'An exclusive-OR gate. The output is high when the inputs differ.',
  },
  logic_xnor: {
    name: 'XNOR',
    summary: 'An exclusive-NOR gate. The output is high when the inputs match.',
  },
  logic_buffer: {
    name: 'Buffer',
    summary: 'A gate that copies its input to the output, built from transistors.',
  },
  logic_half_adder: {
    name: 'Half adder',
    summary: 'Adds two bits and gives a sum and a carry. It does not take a carry in.',
  },
  logic_full_adder: {
    name: 'Full adder',
    summary: 'Adds two bits plus a carry in, and gives a sum and a carry out.',
  },
  logic_adder_2bit: {
    name: '2-bit adder',
    summary: 'Two full adders rippled together, so they add a pair of 2-bit numbers.',
  },
  logic_adder_4bit: {
    name: '4-bit adder',
    summary: 'Four full adders rippled together, so they add a pair of 4-bit numbers.',
  },
  logic_calculator_4bit: {
    name: '4-bit add or subtract',
    summary: 'A 4-bit adder that can subtract. The subtract pin picks which.',
  },
  logic_decoder_2_4: {
    name: '2-to-4 decoder',
    summary: 'Turns a 2-bit number into one of four output lines.',
  },
  logic_decoder_3_8: {
    name: '3-to-8 decoder',
    summary: 'Turns a 3-bit number into one of eight output lines.',
  },
  logic_encoder_4_2: {
    name: '4-to-2 encoder',
    summary: 'Turns one of four input lines into a 2-bit number.',
  },
  logic_encoder_8_3: {
    name: '8-to-3 encoder',
    summary: 'Turns one of eight input lines into a 3-bit number.',
  },
  logic_decoder_7seg: {
    name: 'Seven-segment decoder',
    summary: 'Turns a 4-bit number into the segment lines of a digit.',
  },
  display_seven_segment: {
    name: 'Seven-segment',
    summary: 'One LED digit with a series resistor on each segment.',
  },
  display_seven_segment_bare: {
    name: 'Bare seven-segment',
    summary: 'One LED digit with the segment LEDs only, no series resistors.',
  },
  display_separator: {
    name: 'Separator',
    summary: 'A colon or point between digits, made of LEDs.',
  },
  dot_matrix_5x7: {
    name: '5×7 dot matrix',
    summary: 'A grid of LEDs, five across and seven down, for one character.',
  },
  dot_matrix_mux_8x8: {
    name: '8×8 LED matrix',
    summary: 'An 8 by 8 LED grid scanned a row at a time.',
  },
  dot_matrix_mux_16x16: {
    name: '16×16 LED matrix',
    summary: 'A 16 by 16 LED grid scanned a row at a time.',
  },
  dot_matrix_rgb_7x7: {
    name: '7×7 RGB matrix',
    summary: 'A 7 by 7 grid of red, green, and blue LEDs.',
  },
  glyph_rom_5x7: {
    name: 'Glyph ROM',
    summary: 'A stored table of 5×7 character shapes the matrix can look up.',
  },
  active_matrix_pixel: {
    name: 'Active-matrix pixel',
    summary: 'One pixel with its own transistor, so it holds its level between scans.',
  },
  row_scanner_8: {
    name: '8-row scanner',
    summary: 'Walks an enable across 8 rows so a matrix can be lit one row at a time.',
  },
  row_scanner_16: {
    name: '16-row scanner',
    summary: 'Walks an enable across 16 rows so a matrix can be lit one row at a time.',
  },
  row_scanner_32: {
    name: '32-row scanner',
    summary: 'Walks an enable across 32 rows so a matrix can be lit one row at a time.',
  },
  logic_sr_latch: {
    name: 'SR latch',
    summary: 'A latch that sets or resets and then holds that level.',
  },
  logic_d_latch: {
    name: 'D latch',
    summary:
      'A latch that copies its data input while enable is on, and holds it when enable drops.',
  },
  logic_d_flipflop: {
    name: 'D flip-flop',
    summary:
      'Copies its data input onto the output on the clock edge, and holds it until the next edge.',
  },
  logic_register_4bit: {
    name: '4-bit register',
    summary: 'Four flip-flops that store a 4-bit word on the clock.',
  },
  logic_register_bcd: {
    name: 'BCD register',
    summary: 'Flip-flops that store one decimal digit as four bits.',
  },
  logic_bcd_adder: {
    name: 'BCD adder',
    summary: 'Adds two decimal digits, each written as four bits, plus a carry.',
  },
  logic_bcd_adder_10: {
    name: '10-digit BCD adder',
    summary: 'Adds two 10-digit decimal numbers.',
  },
  logic_bcd_complementer: {
    name: 'Nine’s complement',
    summary:
      'Turns a decimal digit into its nine’s complement, the step a decimal subtractor needs.',
  },
  logic_bcd_alu_cell: {
    name: 'BCD ALU cell',
    summary: 'One decimal digit of the calculator: complement, then add.',
  },
  logic_bcd_alu_10: {
    name: '10-digit BCD ALU',
    summary: 'Adds or subtracts two 10-digit decimal numbers. The subtract line picks which.',
  },
  logic_bcd_decoder_10: {
    name: '10-digit decoder',
    summary: 'Turns ten decimal digits into the segment lines for a 10-digit display.',
  },
  calculator: {
    name: 'Calculator',
    summary: 'A 10-digit decimal calculator built from the BCD blocks, with a keypad and digits.',
    detail: 'Descend into it to see the real gates. It is not a picture of a calculator.',
  },
  cpu_fetch_engine: {
    name: 'CPU fetch',
    summary: 'The piece of a small CPU that steps the address and fetches the next instruction.',
  },
  cpu_4bit: {
    name: '4-bit CPU',
    summary: 'A small CPU built from the logic blocks. Descend into it to see the gates.',
  },
  verilog_cpu: {
    name: 'Verilog CPU',
    summary: 'Places a small CPU described in Verilog, plus the readouts and controls around it.',
  },
  verilog_cpu8: {
    name: '8-bit Verilog CPU',
    summary: 'Places an 8-bit CPU described in Verilog, plus the readouts and controls around it.',
  },
  cpu_data_ram: {
    name: 'Data RAM',
    summary: 'A small memory the CPU can read and write.',
  },
  memory_sram_cell: {
    name: 'SRAM cell',
    summary: 'One static memory bit, a pair of inverters that hold a 0 or a 1.',
  },
  memory_sram_word_4bit: {
    name: '4-bit SRAM',
    summary: 'Four SRAM cells that store one 4-bit word.',
  },
  switch_spst_toggle: {
    name: 'Switch',
    summary: 'A switch that stays where you leave it. Double-click it to open or close it.',
  },
  switch_spst_momentary: {
    name: 'Button',
    summary: 'A pushbutton. Double-click it on the sheet to open or close it.',
  },
  switch_spdt: {
    name: 'SPDT switch',
    summary: 'A switch with two throws. Double-click it to swap which throw is connected.',
  },
  fuse: {
    name: 'Fuse',
    summary: 'Opens the circuit if too much current flows.',
    detail: 'Double-click a blown fuse to fit a new one. An intact fuse does not toggle.',
  },
  relay: {
    name: 'Relay',
    summary: 'A switch thrown by a coil. Current in the coil changes the contacts.',
  },
  ground: {
    name: 'Ground',
    summary: 'The 0 V reference the rest of the circuit is measured from.',
  },
  net_label: {
    name: 'Net label',
    summary: 'A name that joins separated wires into one net, so you do not have to draw the wire.',
  },
  text_note: {
    name: 'Text note',
    summary: 'A note on the sheet. It is not part of the circuit, and the solver skips it.',
  },
  text_box: {
    name: 'Text box',
    summary: 'A boxed note on the sheet. It has no pins and the solver skips it.',
  },
  graphic_line: {
    name: 'Line',
    summary: 'A drawn line on the sheet. It is not a wire and it carries no current.',
  },
  graphic_rect: {
    name: 'Rectangle',
    summary: 'A drawn rectangle on the sheet. It is not part of the circuit.',
  },
  graphic_circle: {
    name: 'Circle',
    summary: 'A drawn circle on the sheet. It is not part of the circuit.',
  },
  catalog_ap2112k_33: {
    name: '3.3 V regulator',
    summary:
      'A Diodes AP2112K-3.3 in SOT-25, 600 mA. It is not simulated; it is a real pinout you can place.',
  },
  catalog_ase_12mhz: {
    name: '12 MHz oscillator',
    summary:
      'An Abracon 12 MHz clock in a 3.2×2.5 mm can. It is not simulated; it is a real pinout you can place.',
  },
  catalog_w25q32jv: {
    name: 'SPI flash',
    summary:
      'A Winbond 32 Mbit SPI flash in SOIC-8. It is not simulated; it is a real pinout you can place.',
  },
  catalog_ice40up5k_sg48: {
    name: 'iCE40 FPGA',
    summary:
      'A Lattice iCE40UP5K in QFN-48. What it does is the bitstream, so here it is a pinout you can place.',
  },
}

const PICKER_SECTION_SUMMARY: Record<string, string> = {
  ics: 'Purchasable chips with real pinouts. What is inside them is not simulated.',
  sources: 'Where energy or a signal enters: batteries, generators, a port, and ground.',
  passives: 'Resistors, capacitors, inductors, and the other parts that do not amplify.',
  diodes: 'Diodes, LEDs, and the lamps that light from a current.',
  transistors: 'Bipolar transistors, MOSFETs, and JFETs.',
  tubes: 'Vacuum tubes, from a diode up to a picture tube.',
  analog: 'Op-amps and small analog circuits that are already wired inside a block.',
  logic_gates: 'The basic gates, each one built from transistors.',
  logic_blocks: 'Adders, latches, registers, memory, and the calculator and CPU built from them.',
  displays: 'LED digits, matrices, and the scanners that walk their rows.',
  switches: 'Switches, a relay, and a fuse.',
  machines: 'Motors and an electromagnet.',
  my_parts: 'Parts you made yourself.',
  annotations: 'Names, notes, and drawing shapes. Notes and shapes are not part of the circuit.',
}

const GERBER_ROLE_HELP: Record<string, HelpEntry> = {
  'copper-top': {
    name: 'Top copper',
    summary: 'The copper on the top of the board: pads and traces the parts solder to.',
  },
  'copper-bottom': {
    name: 'Bottom copper',
    summary: 'The copper on the underside of the board.',
  },
  'copper-inner': {
    name: 'Inner copper',
    summary: 'A copper sheet buried inside the board, between the outer layers.',
  },
  'mask-top': {
    name: 'Top solder mask',
    summary: 'The green film on top. Openings in it are where pads stay bare for solder.',
  },
  'mask-bottom': {
    name: 'Bottom solder mask',
    summary: 'The solder-mask film on the underside. Openings are bare pads.',
  },
  'paste-top': {
    name: 'Top solder paste',
    summary: 'Where solder paste is printed on the top pads before the parts are placed.',
  },
  'paste-bottom': {
    name: 'Bottom solder paste',
    summary: 'Where solder paste is printed on the bottom pads.',
  },
  'silk-top': {
    name: 'Top silkscreen',
    summary: 'The white ink on top: outlines and names that help you stuff the board.',
  },
  'silk-bottom': {
    name: 'Bottom silkscreen',
    summary: 'The white ink on the underside.',
  },
  fab: {
    name: 'Fabrication drawing',
    summary: 'A drawing for the people building the board, not a copper layer.',
  },
  edge: {
    name: 'Board outline',
    summary: 'The cut that sets the board’s shape. The fab follows the centre of this stroke.',
  },
  drill: {
    name: 'Plated drills',
    summary: 'Holes with copper plated through them, including the vias that join layers.',
  },
  'drill-npth': {
    name: 'Non-plated drills',
    summary: 'Holes with no plated copper, such as mounting holes.',
  },
  other: {
    name: 'Other file',
    summary:
      'A manufacturing file this view does not file under copper, mask, paste, silk, drill, or outline.',
  },
}

function partEntry(definition: string): HelpEntry | undefined {
  const found = PART_HELP[definition]
  if (found) return found
  const multi = /^display_seven_segment(?:_bare)?_(\d+)$/.exec(definition)
  if (multi === null) return undefined
  const count = multi[1] ?? ''
  if (definition.includes('_bare_')) {
    return {
      name: `${count}-digit bare display`,
      summary: `A row of ${count} seven-segment digits with the LEDs only, no series resistors of their own.`,
    }
  }
  return {
    name: `${count}-digit display`,
    summary: `A row of ${count} seven-segment digits, each with its series resistors already in the block.`,
  }
}

function sectionSummary(categoryId: string): string | undefined {
  if (categoryId.startsWith('library:')) {
    return 'Parts from an installed content pack. They place and wire like a built-in part.'
  }
  return PICKER_SECTION_SUMMARY[categoryId]
}

export function partHelpId(definition: string): string {
  return `part.${definition}`
}

export function gerberRoleHelpId(role: string): string {
  return `gerber.role.${role}`
}

export function pickerSectionHelpId(categoryId: string): string {
  return `picker.section.${categoryId}`
}

/** True when this definition has its own sentence, not the generic “a part you added” line. */
export function hasSpecificPartHelp(definition: string): boolean {
  return partEntry(definition) !== undefined
}

export function resolveHelp(id: string, name?: string): HelpEntry | undefined {
  if (id.startsWith('part.')) {
    const found = partEntry(id.slice('part.'.length))
    if (found) return found
    if (name === undefined) return undefined
    return {
      name,
      summary: 'A part you added. Drag it onto the sheet to place it.',
    }
  }
  if (id.startsWith('gerber.role.')) {
    const found = GERBER_ROLE_HELP[id.slice('gerber.role.'.length)]
    if (found === undefined) return undefined
    return name === undefined ? found : { ...found, name }
  }
  if (id.startsWith('picker.section.')) {
    const categoryId = id.slice('picker.section.'.length)
    const summary = sectionSummary(categoryId)
    if (summary === undefined) return undefined
    return { name: name ?? categoryLabelOf(categoryId), summary }
  }
  const found = HELP[id]
  if (found === undefined) return undefined
  return name === undefined ? found : { ...found, name }
}
