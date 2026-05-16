// ChipBlocks v2 — ground-up restart.
//
// This is the empty shell after the reset described in RESET-PLAN.md.
// Sprint 1 of the new direction lands the project identity in docs +
// a launchable Electron window. Sprint 2 starts authoring Layer 0
// (materials) + Layer 1 (shapes) + Layer 2 (interfaces) + Layer 3
// (behaviors) manifests. Sprint 3 adds Layer 4 (primitive devices)
// and the universal object model.
//
// The legacy audio-synth direction lives on the
// legacy/audio-synth-direction branch and remains fully accessible.

export function App(): JSX.Element {
  return (
    <div className="app-shell">
      <header>
        <h1>ChipBlocks v2</h1>
        <p className="subtitle">
          Free, open-source, ground-up electronics builder
        </p>
      </header>
      <main>
        <section className="status-card">
          <h2>Initializing</h2>
          <p>
            The project has been reset to its ground-up direction. The
            empty shell launches; the canvas and the first primitive
            devices arrive in upcoming sprints.
          </p>
          <p>
            See <code>RESET-PLAN.md</code> for the full plan and
            <code> legacy/audio-synth-direction</code> for the
            previous direction&apos;s code.
          </p>
        </section>
      </main>
      <footer>
        <small>
          ChipBlocks v2 ground-up restart · MIT license · BYOK AI (not
          yet wired) · open-source forever
        </small>
      </footer>
    </div>
  )
}
