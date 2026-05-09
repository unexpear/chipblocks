// Translate raw Python / WSL stderr from the backend subprocesses into
// a friendlier, actionable message. The renderer switches on the
// `type` field to render an inline affordance (e.g. "How to fix") next
// to the toast, so any new pattern added here also needs a switch arm
// in App.tsx if a tailored UI is desired. A null return falls through
// to the existing `friendlyError` path that surfaces raw stderr.
//
// Why this lives in its own file: ipc.ts imports `electron`, which
// can't be loaded by Vitest's renderer-flavoured jsdom environment.
// Keeping the classifier dependency-free means we can unit-test it
// directly without spinning up a full Electron context.
export interface BackendErrorClassification {
  type: BackendErrorType
  message: string
}

export type BackendErrorType =
  | 'backend_deps_missing'
  | 'wsl_missing'
  | 'oss_cad_suite_missing'

const BACKEND_DEPS_MESSAGE =
  "ChipBlocks's Python backend isn't installed yet. Open WSL2 Ubuntu and run: `cd backend && bash setup.sh` (one-time setup; takes ~30 seconds)."

const WSL_MISSING_MESSAGE =
  "WSL2 (Windows Subsystem for Linux) isn't installed. ChipBlocks's backend runs in WSL2 Ubuntu. Install via: `wsl --install` from PowerShell (admin), reboot, then run `bash backend/setup.sh` in WSL2."

const OSS_CAD_SUITE_MESSAGE =
  "The OSS CAD Suite (Yosys + nextpnr + icepack) isn't installed in WSL2. Required for FPGA builds. Download from https://github.com/YosysHQ/oss-cad-suite-build/releases and extract to ~/oss-cad-suite/ in WSL2."

// Python's ModuleNotFoundError text is stable across CPython versions.
// We match a small allowlist of module names rather than any missing
// module, so a user-authored block that imports something exotic
// doesn't get mis-classified as the global "backend not installed"
// failure. Add new core deps here if backend/setup.sh starts pulling
// them in.
const BACKEND_DEP_MODULES = ['amaranth', 'amaranth_yosys', 'yaml']

const OSS_CAD_TOOLS = ['yosys', 'nextpnr-ice40', 'nextpnr', 'icepack']

export function classifyBackendError(
  stderr: string,
  stdout: string,
): BackendErrorClassification | null {
  const haystack = `${stderr}\n${stdout}`

  // 1. Backend Python deps missing.
  // Match e.g. `ModuleNotFoundError: No module named 'amaranth'`
  // (single or double quotes — be lenient on the quoting style).
  for (const mod of BACKEND_DEP_MODULES) {
    const pattern = new RegExp(
      `ModuleNotFoundError:\\s*No module named\\s*['"]${escapeRegex(mod)}['"]`,
    )
    if (pattern.test(haystack)) {
      return { type: 'backend_deps_missing', message: BACKEND_DEPS_MESSAGE }
    }
  }

  // 2. WSL itself missing. We can see this in two flavours:
  //    a) Spawn-level: Node's `proc.on('error')` fires with a message
  //       like "spawn wsl.exe ENOENT" — handled by the IPC handler
  //       calling classifyBackendError on the synthesized stderr too.
  //    b) Stderr from cmd: "'wsl.exe' is not recognized as an internal..."
  if (
    /spawn\s+wsl(?:\.exe)?\s+ENOENT/i.test(haystack) ||
    /'wsl(?:\.exe)?' is not recognized/i.test(haystack) ||
    /wsl(?:\.exe)?:?\s+command not found/i.test(haystack)
  ) {
    return { type: 'wsl_missing', message: WSL_MISSING_MESSAGE }
  }

  // 3. OSS CAD Suite tools missing. The wrapper script sources the
  // env file before calling python3, so when the env is absent the
  // FPGA invocation surfaces something like
  // `bash: yosys: command not found` or a Python subprocess error
  // wrapping the same. Match the bare command-not-found form.
  for (const tool of OSS_CAD_TOOLS) {
    const patterns = [
      new RegExp(`${escapeRegex(tool)}:\\s*command not found`, 'i'),
      // The Python build pipeline can also re-emit the failure as
      // "FileNotFoundError: [Errno 2] No such file or directory: 'yosys'"
      // when using subprocess.run directly.
      new RegExp(
        `FileNotFoundError:[^\\n]*['"]${escapeRegex(tool)}['"]`,
        'i',
      ),
    ]
    for (const p of patterns) {
      if (p.test(haystack)) {
        return { type: 'oss_cad_suite_missing', message: OSS_CAD_SUITE_MESSAGE }
      }
    }
  }

  return null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
