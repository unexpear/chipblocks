/**
 * Unit tests for the backend-error classifier.
 *
 * The classifier is a pure string-matching helper that lives outside
 * Electron, so we exercise it directly rather than going through the
 * IPC handler. Each known failure pattern gets one positive case and
 * the suite ends with a negative case to make sure unrelated stderr
 * doesn't accidentally collapse into a friendly message.
 */

import { describe, expect, it } from 'vitest'
import { classifyBackendError } from '../electron/main/classify-backend-error'

describe('classifyBackendError', () => {
  describe('backend_deps_missing', () => {
    it('matches a `ModuleNotFoundError: No module named amaranth` traceback', () => {
      const stderr = [
        'Traceback (most recent call last):',
        '  File "/mnt/c/Users/micha/Desktop/chipzzzd/backend/synth.py", line 5, in <module>',
        "    from amaranth.hdl import Module",
        "ModuleNotFoundError: No module named 'amaranth'",
      ].join('\n')
      const result = classifyBackendError(stderr, '')
      expect(result).not.toBeNull()
      expect(result?.type).toBe('backend_deps_missing')
      // The message must include the setup command in backticks so the
      // renderer's toast-body splitter can highlight it as <code>.
      expect(result?.message).toContain('cd backend && bash setup.sh')
      expect(result?.message).toMatch(/`[^`]+`/)
    })

    it('matches the `amaranth_yosys` variant', () => {
      const stderr = "ModuleNotFoundError: No module named 'amaranth_yosys'"
      const result = classifyBackendError(stderr, '')
      expect(result?.type).toBe('backend_deps_missing')
    })

    it('matches the `yaml` variant', () => {
      const stderr = "ModuleNotFoundError: No module named 'yaml'"
      const result = classifyBackendError(stderr, '')
      expect(result?.type).toBe('backend_deps_missing')
    })

    it('also matches when stderr uses double-quoted module name', () => {
      // Some Python versions / wrapper layers re-emit the error with
      // double quotes; tolerate either flavour.
      const stderr = 'ModuleNotFoundError: No module named "amaranth"'
      const result = classifyBackendError(stderr, '')
      expect(result?.type).toBe('backend_deps_missing')
    })

    it('does NOT classify a missing third-party module as backend_deps_missing', () => {
      // A user-authored block that imports something exotic shouldn't
      // get the "run setup.sh" message — that would mislead. Only the
      // core deps in the allowlist get classified.
      const stderr = "ModuleNotFoundError: No module named 'numpy_quantum'"
      const result = classifyBackendError(stderr, '')
      expect(result).toBeNull()
    })
  })

  describe('wsl_missing', () => {
    it('matches the spawn ENOENT form (Node`s proc.on(\'error\') message)', () => {
      const synthesized = 'spawn wsl.exe spawn wsl.exe ENOENT'
      const result = classifyBackendError(synthesized, '')
      expect(result?.type).toBe('wsl_missing')
      expect(result?.message).toContain('wsl --install')
    })

    it('matches the cmd.exe "is not recognized" message', () => {
      // If wsl.exe vanishes from PATH but Node still finds something,
      // the friendliest signal we can latch onto is the literal cmd
      // shell string.
      const stderr =
        "'wsl.exe' is not recognized as an internal or external command,\n" +
        'operable program or batch file.'
      const result = classifyBackendError(stderr, '')
      expect(result?.type).toBe('wsl_missing')
    })
  })

  describe('oss_cad_suite_missing', () => {
    it('matches `yosys: command not found` from the wrapper', () => {
      const stderr = '/home/user/run.sh: line 12: yosys: command not found'
      const result = classifyBackendError(stderr, '')
      expect(result?.type).toBe('oss_cad_suite_missing')
      expect(result?.message).toContain('OSS CAD Suite')
    })

    it('matches `nextpnr-ice40: command not found`', () => {
      const stderr = 'bash: nextpnr-ice40: command not found'
      const result = classifyBackendError(stderr, '')
      expect(result?.type).toBe('oss_cad_suite_missing')
    })

    it('matches the Python FileNotFoundError variant', () => {
      // build.py uses subprocess.run('yosys', ...) under the hood; if
      // the env wasn`t sourced the kernel surfaces FileNotFoundError
      // rather than a shell command-not-found.
      const stderr =
        "FileNotFoundError: [Errno 2] No such file or directory: 'yosys'"
      const result = classifyBackendError(stderr, '')
      expect(result?.type).toBe('oss_cad_suite_missing')
    })
  })

  describe('fallthrough', () => {
    it('returns null for an unrelated Python error', () => {
      const stderr =
        'Traceback (most recent call last):\n' +
        '  File "synth.py", line 99, in <module>\n' +
        '    raise ValueError("graph contained a feedback loop")\n' +
        'ValueError: graph contained a feedback loop'
      expect(classifyBackendError(stderr, '')).toBeNull()
    })

    it('returns null for empty stderr', () => {
      expect(classifyBackendError('', '')).toBeNull()
    })

    it('also scans stdout — backends that print errors there', () => {
      // Some build.py paths route diagnostic info through stdout (the
      // `[bundle]` marker, etc). The classifier searches both streams.
      const stdout = "ModuleNotFoundError: No module named 'amaranth'"
      const result = classifyBackendError('', stdout)
      expect(result?.type).toBe('backend_deps_missing')
    })
  })

  describe('priority', () => {
    it('prefers backend_deps_missing over oss_cad_suite_missing when both are present', () => {
      // If python3 itself blew up before reaching the yosys subprocess
      // call, the deps-missing message is the actionable one. Order of
      // the if-blocks in classifyBackendError encodes this priority.
      const stderr = [
        "ModuleNotFoundError: No module named 'amaranth'",
        'bash: yosys: command not found',
      ].join('\n')
      const result = classifyBackendError(stderr, '')
      expect(result?.type).toBe('backend_deps_missing')
    })
  })
})
