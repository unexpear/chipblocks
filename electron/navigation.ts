/**
 * The will-navigate guard's decision (electron/main.ts → hardenNavigation): is a
 * navigation target our OWN renderer, safe to allow? Everything else is blocked, so a
 * stray or injected link can't move the window — and the `chipblocks` IPC bridge — to a
 * remote page.
 *
 * Compares ORIGINS, not string prefixes, because a prefix match has real bypasses:
 *  - navigationUrl.startsWith(devUrl) waves through http://localhost:5173@evil.com (its
 *    origin is evil.com — the userinfo before @ is parsed as user:password), and a longer
 *    port like http://localhost:51730;
 *  - startsWith('file://') waves through a UNC path file://host/share, which Windows
 *    resolves over SMB to a REMOTE host.
 *
 *  - dev (devUrl set — the Vite dev server): allow only the SAME origin as devUrl.
 *  - packaged (devUrl undefined — renderer loaded from a local file): allow only a file:
 *    URL with NO host (a UNC path has a host and could be remote).
 * Anything unparseable is treated as not-ours and blocked.
 */
export function isInternalNavigation(navigationUrl: string, devUrl: string | undefined): boolean {
  let target: URL
  try {
    target = new URL(navigationUrl)
  } catch {
    return false // unparseable → not ours → block
  }
  if (devUrl !== undefined) {
    try {
      return target.origin === new URL(devUrl).origin
    } catch {
      return false // a malformed devUrl can't match anything safely
    }
  }
  return target.protocol === 'file:' && target.host === ''
}
