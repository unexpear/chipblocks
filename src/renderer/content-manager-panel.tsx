import { type CSSProperties, useEffect, useState } from 'react'
import type { ContentCatalogEntry } from './content-catalog.ts'
import {
  type ContentIndex,
  type InstalledPackRecord,
  installedPackStatusLabel,
  type ManagerRow,
  managerRows,
  type PackLoadIssue,
} from './content-manager.ts'
import { THEME } from './theme.ts'

/**
 * What the panel claims about install trust. Kept as a constant so a test can lock the wording:
 * a declared ed25519 signature IS checked, and a bad content hash is refused rather than ignored.
 */
export const CONTENT_MANAGER_INTRO =
  'Browse planned community libraries (cited from FINAL-STATE-VISION.md) and manage packs you install from a local file. Not a marketplace — ChipBlocks does not download arbitrary remote code. Install validates format + permissive license, checks an optional declared SHA-256 content hash (a malformed or non-sha256 declaration is refused, not treated as "no hash"), and records a file hash for reload tamper-evidence. A declared ed25519 signature is checked: invalid signatures are refused; a valid signature is self-declared integrity under the key in the pack, not a certificate authority. This screen does not load ~/.chipblocks/trusted-publishers.json, so it cannot mark a key as one you pinned. Undeclared is not verified.'

/**
 * Plugin & Content Manager panel — browse the cited community catalog, install a local pack,
 * enable/disable/uninstall. Opened from Tools → Plugin & Content Manager. Not a marketplace;
 * remote downloads are refused by the engine (see content-manager.ts).
 */

export function ContentManagerPanel({
  index,
  statusMessage,
  loadIssues,
  light,
  onClose,
  onInstallLocal,
  onSetEnabled,
  onUninstall,
}: {
  index: ContentIndex
  statusMessage: string | null
  loadIssues?: ReadonlyMap<string, PackLoadIssue>
  light: boolean
  onClose: () => void
  onInstallLocal: () => void
  onSetEnabled: (id: string, enabled: boolean) => void
  onUninstall: (id: string) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const border = light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderSubtle}`
  const textColor = light ? THEME.borderSubtle : THEME.textPrimary
  const dimColor = light ? THEME.textFaint : THEME.textMuted
  const rows = managerRows(index)

  return (
    <>
      <button
        type="button"
        aria-label="Close content manager backdrop"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2099,
          border: 'none',
          background: 'rgba(0,0,0,0.45)',
          cursor: 'default',
        }}
      />
      <div
        role="dialog"
        aria-label="Plugin and Content Manager"
        data-modal="content-manager"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 2100,
          width: 640,
          maxHeight: 'calc(100% - 48px)',
          overflowY: 'auto',
          background: light ? THEME.textBright : THEME.surfaceBase,
          border,
          borderRadius: 8,
          boxShadow: '0 10px 32px rgba(0,0,0,0.5)',
          padding: '12px 16px 16px',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 12,
          color: textColor,
        }}
        className="nodrag nopan cb-hide-scrollbar"
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Plugin & Content Manager</div>
          <button
            type="button"
            onClick={onClose}
            style={{ ...chipButton(light), marginLeft: 'auto' }}
          >
            Close
          </button>
        </div>

        <p style={{ margin: '0 0 10px', color: dimColor, lineHeight: 1.45 }}>
          {CONTENT_MANAGER_INTRO}
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button type="button" onClick={onInstallLocal} style={primaryButton(light)}>
            Install from local pack…
          </button>
        </div>

        {statusMessage !== null ? (
          <div
            data-testid="content-manager-status"
            style={{
              marginBottom: 10,
              padding: '8px 10px',
              borderRadius: 4,
              background: light ? '#f3f0e8' : THEME.surfaceRaised,
              border: light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderStrong}`,
              color: textColor,
              whiteSpace: 'pre-wrap',
            }}
          >
            {statusMessage}
          </div>
        ) : null}

        <div style={{ fontWeight: 700, color: dimColor, margin: '4px 0 6px' }}>
          Installed & catalog
        </div>

        {rows.length === 0 ? (
          <div style={{ color: dimColor }}>No catalog entries.</div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((row) => {
              if (row.kind !== 'installed') {
                return (
                  <li key={rowKey(row)} style={{ marginBottom: 8 }}>
                    <CatalogCard entry={row.entry} light={light} />
                  </li>
                )
              }
              const loadIssue = loadIssues?.get(row.record.id)
              return (
                <li key={rowKey(row)} style={{ marginBottom: 8 }}>
                  <InstalledCard
                    record={row.record}
                    {...(row.catalog !== undefined ? { catalog: row.catalog } : {})}
                    {...(loadIssue !== undefined ? { loadIssue } : {})}
                    light={light}
                    onSetEnabled={onSetEnabled}
                    onUninstall={onUninstall}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

function rowKey(row: ManagerRow): string {
  return row.kind === 'installed' ? `installed:${row.record.id}` : `catalog:${row.entry.id}`
}

function InstalledCard({
  record,
  catalog,
  loadIssue,
  light,
  onSetEnabled,
  onUninstall,
}: {
  record: InstalledPackRecord
  catalog?: ContentCatalogEntry
  loadIssue?: PackLoadIssue
  light: boolean
  onSetEnabled: (id: string, enabled: boolean) => void
  onUninstall: (id: string) => void
}) {
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const dim = light ? THEME.textFaint : THEME.textMuted
  const blocked = loadIssue?.blocked === true
  return (
    <div style={cardStyle(light)}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong>{record.name}</strong>
        <span style={{ color: dim }}>v{record.packVersion}</span>
        <span style={{ color: dim }}>{record.license}</span>
        <span
          data-testid="content-manager-badge"
          data-pack={record.id}
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            fontWeight: 700,
            color: record.enabled && !blocked ? THEME.accentLime : dim,
          }}
        >
          {installedPackStatusLabel(record.enabled, blocked)}
        </span>
      </div>
      <div style={{ color: dim, marginTop: 4 }}>
        {record.description ?? catalog?.description ?? 'Local community pack.'}
      </div>
      <div style={{ color: dim, marginTop: 4, fontSize: 11 }}>
        {record.partCount} part{record.partCount === 1 ? '' : 's'}
        {record.footprintCount > 0
          ? ` · ${record.footprintCount} footprint${record.footprintCount === 1 ? '' : 's'}`
          : ''}{' '}
        · source: local pack
      </div>
      {loadIssue !== undefined ? (
        <div style={{ color: dim, marginTop: 4, fontSize: 10, lineHeight: 1.4 }}>
          {loadIssue.reason}
        </div>
      ) : null}
      {blocked ? null : (
        <div style={{ color: dim, marginTop: 4, fontSize: 10, lineHeight: 1.4 }}>
          {record.integrityStatus === 'match'
            ? 'Integrity: declared content hash matched. '
            : record.integrityStatus === 'undeclared'
              ? 'Integrity: no declared content hash. '
              : ''}
          {record.trustNote}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => onSetEnabled(record.id, !record.enabled)}
          style={chipButton(light)}
        >
          {record.enabled ? 'Disable' : 'Enable'}
        </button>
        {confirmUninstall ? (
          <>
            <button
              type="button"
              onClick={() => {
                setConfirmUninstall(false)
                onUninstall(record.id)
              }}
              style={dangerButton(light)}
            >
              Confirm uninstall
            </button>
            <button
              type="button"
              onClick={() => setConfirmUninstall(false)}
              style={chipButton(light)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmUninstall(true)} style={chipButton(light)}>
            Uninstall…
          </button>
        )}
      </div>
    </div>
  )
}

function CatalogCard({ entry, light }: { entry: ContentCatalogEntry; light: boolean }) {
  const dim = light ? THEME.textFaint : THEME.textMuted
  return (
    <div style={cardStyle(light)}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong>{entry.name}</strong>
        <span style={{ color: dim, fontSize: 10, fontWeight: 700 }}>PLANNED · NOT INSTALLED</span>
      </div>
      <div style={{ color: dim, marginTop: 4 }}>{entry.description}</div>
      <div style={{ color: dim, marginTop: 4, fontSize: 10 }}>
        Cited: {entry.citation}. Suggested license: {entry.suggestedLicense}. Not available as an
        in-app download — author or obtain a local pack and use Install from local pack…
      </div>
    </div>
  )
}

function cardStyle(light: boolean): CSSProperties {
  return {
    padding: '10px 12px',
    borderRadius: 6,
    background: light ? '#f7f5f0' : THEME.surfaceRaised,
    border: light ? `1px solid ${THEME.textPrimary}` : `1px solid ${THEME.borderStrong}`,
  }
}

function chipButton(light: boolean): CSSProperties {
  return {
    background: light ? THEME.white : THEME.surfaceInput,
    border: `1px solid ${light ? THEME.textPrimary : THEME.borderStrong}`,
    color: light ? THEME.borderSubtle : THEME.textPrimary,
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 11,
    cursor: 'pointer',
  }
}

function primaryButton(light: boolean): CSSProperties {
  return {
    ...chipButton(light),
    fontWeight: 700,
    padding: '6px 10px',
  }
}

function dangerButton(light: boolean): CSSProperties {
  return {
    ...chipButton(light),
    border: '1px solid #a04a5a',
    color: light ? '#7a2030' : '#e8a0a8',
    fontWeight: 700,
  }
}
