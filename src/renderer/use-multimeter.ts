import type { Edge } from '@xyflow/react'
import {
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { World } from '../cross-fk-validator.ts'
import {
  AMMETER_JACKS,
  type AmmeterJack,
  acVoltsRms,
  CONTINUITY_OHMS,
  capacitanceTest,
  dcExtremes,
  diodeTest,
  displayCounts,
  equivalentResistance,
  groundNetOf,
  type ProbeRef,
  seriesAmmeter,
  voltmeterSolve,
} from './meter.tsx'
import { THEME } from './theme.ts'
import type { Tool } from './toolbar.tsx'
import { formatEng } from './units.ts'

/**
 * The multimeter's state machine + measurements, lifted out of the Canvas component (S19-v3-53/54,
 * S20-v3-11..16). In meter mode, touching terminal dots places the red then the black probe — the
 * readout shows the live value between them per the mode dial. Touching a WIRE clamps onto it and
 * reads its current without breaking the circuit. Clicking empty canvas lifts everything; leaving the
 * tool clears it; the dial position survives tool switches, like a real meter left on a setting.
 * A⎓ jack selection + per-jack blowable fuses, REL/zero, MIN/MAX, and HOLD all behave like the real
 * buttons. Everything moved here VERBATIM; its couplings to the canvas — the active tool, the wires,
 * the terminal→net lookup, the warm solved world, the live readings, and the project ambient — are
 * injected, so behaviour is unchanged.
 */
export function useMultimeter(deps: {
  tool: Tool
  edges: Edge[]
  probeNets: ReadonlyMap<string, string>
  solvedWorld: World
  terminalVolts: ReadonlyMap<string, number>
  readings: ReadonlyMap<
    string,
    { temperatureC?: number; maxTemperatureC?: number; current?: number }
  >
  projectAmbientRef: MutableRefObject<number>
}) {
  const { tool, edges, probeNets, solvedWorld, terminalVolts, readings, projectAmbientRef } = deps
  const [redProbe, setRedProbe] = useState<ProbeRef | undefined>(undefined)
  const [blackProbe, setBlackProbe] = useState<ProbeRef | undefined>(undefined)
  const [meterMode, setMeterMode] = useState<
    'volts' | 'acvolts' | 'ohms' | 'diode' | 'cap' | 'amps' | 'tempc'
  >('volts')
  // A⎓ jack selection + per-jack fuse state (S20-v3-11). A blown fuse stores
  // the current that killed it — the display keeps telling the story until
  // the fuse is replaced, and the meter is an OPEN circuit meanwhile.
  const [meterJack, setMeterJack] = useState<AmmeterJack>('milliamp')
  const [blownFuses, setBlownFuses] = useState<{ milliamp: number | null; amp: number | null }>({
    milliamp: null,
    amp: null,
  })
  // REL/zero (S20-v3-13): the stored Ω offset the display subtracts — short
  // the probes (they read the leads' 0.2 Ω), press REL, measure relative.
  // MIN/MAX (S20-v3-14): V⎓ shows the record's extremes instead of one value.
  // Both drop on a dial change, like the real buttons.
  const [relOhms, setRelOhms] = useState<number | null>(null)
  const [minMaxOn, setMinMaxOn] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: meterMode is the intentional trigger — turning the dial drops REL and MIN/MAX like a real meter
  useEffect(() => {
    setRelOhms(null)
    setMinMaxOn(false)
  }, [meterMode])
  // HOLD: freeze the current reading on the display (probe elsewhere, compare),
  // exactly the bench move. Measurement continues underneath, like a real meter.
  const [heldReadout, setHeldReadout] = useState<{
    icon: string
    iconColor: string
    text: string
  } | null>(null)
  const [clampWire, setClampWire] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (tool !== 'meter') {
      setRedProbe(undefined)
      setBlackProbe(undefined)
      setClampWire(undefined)
      setHeldReadout(null)
    }
  }, [tool])
  // If the clamped wire is deleted, the clamp comes off with it.
  useEffect(() => {
    if (clampWire !== undefined && !edges.some((e) => e.id === clampWire)) {
      setClampWire(undefined)
    }
  }, [clampWire, edges])
  const onMeterClick = useCallback(
    (event: ReactMouseEvent) => {
      if (tool !== 'meter') return
      const target = event.target as Element
      if (target.closest?.('.cb-meter-chip') !== null) return
      const handleEl = target.closest?.('.react-flow__handle') as HTMLElement | null
      if (handleEl !== null) {
        const nodeId = handleEl.dataset.nodeid
        const handleId = handleEl.dataset.handleid
        if (nodeId === undefined || handleId === undefined) return
        const probe: ProbeRef = { nodeId, handleId }
        setClampWire(undefined)
        if (redProbe === undefined) setRedProbe(probe)
        else if (blackProbe === undefined) setBlackProbe(probe)
        else {
          setRedProbe(probe)
          setBlackProbe(undefined)
        }
        return
      }
      const edgeEl = target.closest?.('.react-flow__edge')
      if (edgeEl !== null && edgeEl !== undefined) {
        const dataId = edgeEl.getAttribute('data-id')
        const testId = edgeEl.getAttribute('data-testid')
        const wireId = dataId ?? (testId?.startsWith('rf__edge-') ? testId.slice(9) : null)
        if (wireId !== null) {
          setClampWire(wireId)
          setRedProbe(undefined)
          setBlackProbe(undefined)
          return
        }
      }
      setRedProbe(undefined)
      setBlackProbe(undefined)
      setClampWire(undefined)
    },
    [tool, redProbe, blackProbe],
  )
  // Ω measurement — its own memo because TWO consumers need the raw number:
  // the readout and the REL button (which stores it as the zero offset).
  const ohmsReading = useMemo(() => {
    if (tool !== 'meter' || meterMode !== 'ohms' || clampWire !== undefined) return null
    if (redProbe === undefined || blackProbe === undefined) return null
    const netRed = probeNets.get(`${redProbe.nodeId}/${redProbe.handleId}`)
    const netBlack = probeNets.get(`${blackProbe.nodeId}/${blackProbe.handleId}`)
    if (netRed === undefined || netBlack === undefined) return null
    return equivalentResistance(solvedWorld, netRed, netBlack, projectAmbientRef.current)
  }, [tool, meterMode, clampWire, redProbe, blackProbe, probeNets, solvedWorld, projectAmbientRef])

  // A⎓ measurement (S20-v3-11) — its own memo so the fuse-blow EFFECT below
  // can watch it (a memo must not set state). Runs only with the dial on A,
  // both probes on wired dots, and the selected jack's fuse intact.
  const ammeterReading = useMemo(() => {
    if (tool !== 'meter' || meterMode !== 'amps' || clampWire !== undefined) return null
    if (redProbe === undefined || blackProbe === undefined) return null
    if (blownFuses[meterJack] !== null) return null
    const netRed = probeNets.get(`${redProbe.nodeId}/${redProbe.handleId}`)
    const netBlack = probeNets.get(`${blackProbe.nodeId}/${blackProbe.handleId}`)
    if (netRed === undefined || netBlack === undefined) return null
    return seriesAmmeter(solvedWorld, netRed, netBlack, meterJack, projectAmbientRef.current)
  }, [
    tool,
    meterMode,
    clampWire,
    redProbe,
    blackProbe,
    blownFuses,
    meterJack,
    probeNets,
    solvedWorld,
    projectAmbientRef,
  ])

  // The pop: a blow result marks the jack's fuse dead, storing the killing
  // current so the display keeps telling the story until 'replace fuse'.
  useEffect(() => {
    if (ammeterReading?.status === 'blew') {
      setBlownFuses((fuses) => ({ ...fuses, [meterJack]: Math.abs(ammeterReading.amps) }))
    }
  }, [ammeterReading, meterJack])

  // The meter's display — live solved values; unwired points say so. The clamp
  // (when set) wins regardless of the dial: it reads amps, not the dial quantity.
  const meterReadout = useMemo(() => {
    if (tool !== 'meter') return null
    if (clampWire !== undefined) {
      const amps = edges.find((e) => e.id === clampWire)?.data?.amps
      return {
        icon: 'Ⓐ',
        iconColor: THEME.accentBlue,
        text:
          typeof amps === 'number'
            ? `Clamp on wire: ${formatEng(amps, 'A')}`
            : 'Clamp on wire: no current flowing',
      }
    }
    const voltsAt = (probe: ProbeRef | undefined) =>
      probe ? terminalVolts.get(`${probe.nodeId}/${probe.handleId}`) : undefined
    // V~ / Ω / ⏵ all read strictly between the two leads — the shared preamble.
    const bothProbeNets = (): { netRed: string; netBlack: string } | string => {
      if (redProbe === undefined) return 'Touch a terminal dot to place the red probe'
      if (blackProbe === undefined) {
        return 'This mode needs both probes — touch another dot for the black probe'
      }
      const netRed = probeNets.get(`${redProbe.nodeId}/${redProbe.handleId}`)
      const netBlack = probeNets.get(`${blackProbe.nodeId}/${blackProbe.handleId}`)
      if (netRed === undefined || netBlack === undefined) {
        return 'One probe is on an unwired dot — no reading'
      }
      return { netRed, netBlack }
    }
    if (meterMode === 'ohms') {
      const ohmsChip = (text: string) => ({ icon: 'Ω', iconColor: THEME.statusWarn, text })
      const nets = bothProbeNets()
      if (typeof nets === 'string') return ohmsChip(nets)
      if (ohmsReading === null) return ohmsChip('Resistance: OL — no conductive path (open loop)')
      const continuity = ohmsReading < CONTINUITY_OHMS ? ' · ● continuity' : ''
      if (relOhms !== null) {
        return ohmsChip(
          `Δ ${displayCounts(ohmsReading - relOhms, 'Ω')} (REL zeroed at ${displayCounts(relOhms, 'Ω')})${continuity}`,
        )
      }
      return ohmsChip(`Resistance: ${displayCounts(ohmsReading, 'Ω')}${continuity}`)
    }
    if (meterMode === 'acvolts') {
      const acChip = (text: string) => ({ icon: '∿', iconColor: THEME.accentBlueDeep, text })
      const nets = bothProbeNets()
      if (typeof nets === 'string') return acChip(nets)
      const ac = acVoltsRms(solvedWorld, nets.netRed, nets.netBlack, projectAmbientRef.current)
      if (ac === 'span-too-wide') {
        return acChip('V~: source frequencies are too far apart to resolve in one pass')
      }
      if (ac === null) return acChip("V~ can't run a time pass on this circuit — no reading")
      const hzText = ac.hz !== null ? ` · ${formatEng(ac.hz, 'Hz')}` : ''
      // Duty (S20-v3-16) rides the counted frequency — the fraction of each
      // cycle the waveform spends above its midline, from the shared module.
      const dutyText =
        ac.hz !== null && ac.duty !== null ? ` · duty ${(ac.duty * 100).toFixed(1)} %` : ''
      // Sub-µV residue is solver float noise, not signal — floor the display
      // like a real meter's resolution floor instead of printing femtovolts.
      const shownRms = ac.rms < 1e-6 ? 0 : ac.rms
      return acChip(`V~ (red − black): ${displayCounts(shownRms, 'V')} rms${hzText}${dutyText}`)
    }
    if (meterMode === 'diode') {
      const diodeChip = (text: string) => ({ icon: '⏵', iconColor: THEME.statusOk, text })
      const nets = bothProbeNets()
      if (typeof nets === 'string') return diodeChip(nets)
      const result = diodeTest(solvedWorld, nets.netRed, nets.netBlack)
      if (result === null) {
        return diodeChip(
          'Diode test: OL — no conduction (reversed probes, open junction, or forward voltage above the 3 V test)',
        )
      }
      return diodeChip(
        `Diode test: ${formatEng(result.volts, 'V')} forward at ${formatEng(result.amps, 'A')}`,
      )
    }
    if (meterMode === 'cap') {
      const capChip = (text: string) => ({ icon: '⊣⊢', iconColor: THEME.accentPurple, text })
      const nets = bothProbeNets()
      if (typeof nets === 'string') return capChip(nets)
      const result = capacitanceTest(solvedWorld, nets.netRed, nets.netBlack)
      if (result.status === 'measured') {
        return capChip(`Capacitance: ${formatEng(result.farads, 'F')}`)
      }
      if (result.status === 'parallel-leak') {
        return capChip(
          "Capacitance: can't measure — a resistive path is in parallel (free one leg of the cap, like a real meter)",
        )
      }
      if (result.status === 'over-range') {
        return capChip('Capacitance: over range — still charging past the 100 s test window')
      }
      if (result.status === 'open') {
        return capChip('Capacitance: under 1 pF — nothing measurable between the probes')
      }
      return capChip("Capacitance test can't run on this circuit")
    }
    if (meterMode === 'amps') {
      const spec = AMMETER_JACKS[meterJack]
      const ampChip = (text: string) => ({ icon: 'A⎓', iconColor: THEME.accentBlue, text })
      const blownAt = blownFuses[meterJack]
      if (blownAt !== null) {
        return ampChip(
          `${spec.label} jack FUSE BLOWN — ${formatEng(blownAt, 'A')} through the ${formatEng(spec.fuseAmps, 'A')} fuse. The meter reads nothing until you replace it.`,
        )
      }
      const nets = bothProbeNets()
      if (typeof nets === 'string') return ampChip(nets)
      if (ammeterReading === null || ammeterReading.status === 'failed') {
        return ampChip("A⎓ can't solve this circuit — no reading")
      }
      if (ammeterReading.status === 'blew') {
        return ampChip(
          `POP — ${formatEng(Math.abs(ammeterReading.amps), 'A')} through the ${formatEng(spec.fuseAmps, 'A')} fuse`,
        )
      }
      return ampChip(
        `A⎓ (red → black): ${displayCounts(ammeterReading.amps, 'A')} · burden ${displayCounts(Math.abs(ammeterReading.burdenVolts), 'V')}`,
      )
    }
    if (meterMode === 'tempc') {
      const tempChip = (text: string) => ({ icon: '°C', iconColor: THEME.statusWarn, text })
      if (redProbe === undefined) {
        return tempChip('Touch any terminal of a part with the red probe — it is the thermocouple')
      }
      const reading = readings.get(redProbe.nodeId)
      if (reading?.temperatureC !== undefined) {
        const max =
          reading.maxTemperatureC !== undefined ? ` · max ${reading.maxTemperatureC} °C` : ''
        return tempChip(
          `${redProbe.nodeId}: ${reading.temperatureC.toFixed(1)} °C — its real junction temperature, from its own dissipation${max}`,
        )
      }
      return tempChip(
        `${redProbe.nodeId}: 25.0 °C — ambient (no thermal rating declared on this part, so the model holds it at room temperature)`,
      )
    }
    const voltChip = (text: string) => ({ icon: 'Ⓥ', iconColor: THEME.statusDanger, text })
    if (redProbe === undefined) return voltChip('Touch a terminal dot to place the red probe')
    const vRed = voltsAt(redProbe)
    const netRed = probeNets.get(`${redProbe.nodeId}/${redProbe.handleId}`)
    // The loading note (S20-v3-12): when the meter's own 10 MΩ visibly bends
    // the point it measures, say so and show what the point sits at unprobed.
    const loadNote = (shown: number, unloaded: number) =>
      Math.abs(shown - unloaded) > Math.max(1e-3, 0.005 * Math.abs(unloaded))
        ? ` · your meter's 10 MΩ input is loading this point (it sits at ${displayCounts(unloaded, 'V')} unprobed)`
        : ''
    if (blackProbe === undefined) {
      if (vRed === undefined || netRed === undefined) {
        return voltChip('Red probe: not wired (no circuit at that dot)')
      }
      const groundNet = groundNetOf(solvedWorld)
      const loaded =
        groundNet !== undefined && groundNet !== netRed
          ? voltmeterSolve(solvedWorld, netRed, groundNet, projectAmbientRef.current)
          : null
      const shown = loaded !== null ? (loaded.nodes.get(netRed) ?? vRed) : vRed
      return voltChip(
        `Red vs ground: ${displayCounts(shown, 'V')}${loadNote(shown, vRed)} — touch another dot for the black probe`,
      )
    }
    const vBlack = voltsAt(blackProbe)
    const netBlack = probeNets.get(`${blackProbe.nodeId}/${blackProbe.handleId}`)
    if (
      vRed === undefined ||
      vBlack === undefined ||
      netRed === undefined ||
      netBlack === undefined
    ) {
      return voltChip('One probe is on an unwired dot — no reading')
    }
    // MIN/MAX/AVG (S20-v3-14): the settled record's extremes instead of the
    // single operating-point number — what the real button records.
    if (minMaxOn) {
      const extremes = dcExtremes(solvedWorld, netRed, netBlack, projectAmbientRef.current)
      if (extremes === 'span-too-wide') {
        return voltChip('MIN/MAX: source frequencies are too far apart to resolve in one pass')
      }
      if (extremes === null) {
        return voltChip("MIN/MAX can't run a time pass on this circuit — no reading")
      }
      return voltChip(
        `MIN ${displayCounts(extremes.min, 'V')} · MAX ${displayCounts(extremes.max, 'V')} · AVG ${displayCounts(extremes.avg, 'V')}`,
      )
    }
    const loaded =
      netRed === netBlack
        ? null
        : voltmeterSolve(solvedWorld, netRed, netBlack, projectAmbientRef.current)
    const unloadedDiff = vRed - vBlack
    const shown =
      loaded !== null
        ? (loaded.nodes.get(netRed) ?? 0) - (loaded.nodes.get(netBlack) ?? 0)
        : unloadedDiff
    let text = `V (red − black): ${displayCounts(shown, 'V')}${loadNote(shown, unloadedDiff)}`
    if (redProbe.nodeId === blackProbe.nodeId && redProbe.handleId !== blackProbe.handleId) {
      const through =
        loaded !== null
          ? Math.abs(loaded.branches.get(redProbe.nodeId) ?? Number.NaN)
          : readings.get(redProbe.nodeId)?.current
      if (through !== undefined && Number.isFinite(through)) {
        text += ` · through ${redProbe.nodeId}: ${displayCounts(through, 'A')}`
      }
    }
    return voltChip(text)
  }, [
    tool,
    meterMode,
    meterJack,
    blownFuses,
    ammeterReading,
    ohmsReading,
    relOhms,
    minMaxOn,
    clampWire,
    edges,
    redProbe,
    blackProbe,
    terminalVolts,
    readings,
    probeNets,
    solvedWorld,
    projectAmbientRef,
  ])

  return {
    redProbe,
    blackProbe,
    meterMode,
    setMeterMode,
    meterJack,
    setMeterJack,
    blownFuses,
    setBlownFuses,
    relOhms,
    setRelOhms,
    minMaxOn,
    setMinMaxOn,
    heldReadout,
    setHeldReadout,
    ohmsReading,
    meterReadout,
    onMeterClick,
  }
}
