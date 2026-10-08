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
import { type LivePublisherTrust, publisherTrustLabel } from './content-pack-signature.ts'
import type { RegistryPackEntry, RegistryUpdate } from './content-registry.ts'
import { THEME } from './theme.ts'
import { HelpTip } from './tooltip.tsx'

/**
 * What the panel claims about install trust. Kept as a constant so a test can lock the wording:
 * a declared ed25519 signature IS checked, and a bad content hash is refused rather than ignored.
 * No publisher key and no registry URL ship with the app.
 */
export const CONTENT_MANAGER_INTRO =
  'Browse planned community libraries (cited from FINAL-STATE-VISION.md) and manage packs you install from a local file or from a content registry whose index URL you set. Not a marketplace — ChipBlocks does not download arbitrary remote code, and it does not ship a registry URL because no public registry exists. Install validates format + permissive license, checks an optional declared SHA-256 content hash (a malformed or non-sha256 declaration is refused, not treated as "no hash"), and records a file hash for reload tamper-evidence. A declared ed25519 signature is checked: invalid signatures are refused; a valid signature is self-declared integrity under the key in the pack, not a certificate authority. The desktop app reads ~/.chipblocks/trusted-publishers.json. No publisher keys ship as trusted. A valid signature is treated as trusted only when that key is pinned in the file. A missing file means no key is pinned. Undeclared is not verified.'

export type PublisherCard = {
  publicKeyHex: string
  fingerprint: string
  trust: LivePublisherTrust
}

/**
 * Plugin & Content Manager panel — browse the cited community catalog, install a local pack
 * or a pack from a registry you configured, enable/disable/uninstall, pin a publisher key.
 * Opened from Tools → Plugin & Content Manager. Not a marketplace. No registry URL is built in.
 */

export function ContentManagerPanel({
  index,
  statusMessage,
  loadIssues,
  light,
  trustedStatus,
  registryUrl,
  registryStatus,
  registryPacks,
  registrySelection,
  updates,
  publisherByPack,
  onClose,
  onInstallLocal,
  onSetEnabled,
  onUninstall,
  onRegistryUrlChange,
  onSaveRegistryUrl,
  onLoadRegistry,
  onRegistrySelection,
  onInstallFromRegistry,
  onTrustPublisher,
}: {
  index: ContentIndex
  statusMessage: string | null
  loadIssues?: ReadonlyMap<string, PackLoadIssue>
  light: boolean
  trustedStatus: string
  registryUrl: string
  registryStatus: string
  registryPacks: readonly RegistryPackEntry[]
  registrySelection: string
  updates: readonly RegistryUpdate[]
  publisherByPack: Readonly<Record<string, PublisherCard>>
  onClose: () => void
  onInstallLocal: () => void
  onSetEnabled: (id: string, enabled: boolean) => void
  onUninstall: (id: string) => void
  onRegistryUrlChange: (url: string) => void
  onSaveRegistryUrl: () => void
  onLoadRegistry: () => void
  onRegistrySelection: (id: string) => void
  onInstallFromRegistry: () => void
  onTrustPublisher: (publicKeyHex: string, trust: boolean, packId: string) => void
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
          width: 720,
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
          <HelpTip helpId="content.close">
            <button
              type="button"
              onClick={onClose}
              style={{ ...chipButton(light), marginLeft: 'auto' }}
            >
              Close
            </button>
          </HelpTip>
        </div>

        <p style={{ margin: '0 0 10px', color: dimColor, lineHeight: 1.45 }}>
          {CONTENT_MANAGER_INTRO}
        </p>

        <div
          data-testid="content-manager-trusted-status"
          style={{ margin: '0 0 10px', color: dimColor, lineHeight: 1.45 }}
        >
          {trustedStatus}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, color: dimColor, margin: '4px 0 6px' }}>
            Content registry
          </div>
          <div
            data-testid="content-manager-registry-status"
            style={{ color: dimColor, lineHeight: 1.45, marginBottom: 8 }}
          >
            {registryStatus}
          </div>
          <label style={{ display: 'block', color: dimColor, marginBottom: 4 }}>
            Registry index URL
            <HelpTip helpId="content.registry.url">
              <input
                data-testid="content-manager-registry-url"
                aria-label="Content registry index URL"
                value={registryUrl}
                onChange={(event) => onRegistryUrlChange(event.target.value)}
                spellCheck={false}
                style={{
                  display: 'block',
                  width: '100%',
                  boxSizing: 'border-box',
                  marginTop: 4,
                  padding: '6px 8px',
                  borderRadius: 4,
                  border: light
                    ? `1px solid ${THEME.textPrimary}`
                    : `1px solid ${THEME.borderStrong}`,
                  background: light ? THEME.white : THEME.surfaceInput,
                  color: textColor,
                  fontSize: 12,
                }}
              />
            </HelpTip>
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <HelpTip helpId="content.registry.save">
              <button
                type="button"
                data-testid="content-manager-registry-save"
                onClick={onSaveRegistryUrl}
                style={chipButton(light)}
              >
                Save registry URL
              </button>
            </HelpTip>
            <HelpTip helpId="content.registry.load">
              <button
                type="button"
                data-testid="content-manager-registry-load"
                onClick={onLoadRegistry}
                style={chipButton(light)}
              >
                Load registry index
              </button>
            </HelpTip>
          </div>
          <label style={{ display: 'block', color: dimColor, marginTop: 8 }}>
            Pack in the loaded index
            <HelpTip helpId="content.registry.pack">
              <select
                data-testid="content-manager-registry-pack"
                aria-label="Pack in the loaded index"
                value={registrySelection}
                onChange={(event) => onRegistrySelection(event.target.value)}
                style={{
                  display: 'block',
                  marginTop: 4,
                  maxWidth: '100%',
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: light
                    ? `1px solid ${THEME.textPrimary}`
                    : `1px solid ${THEME.borderStrong}`,
                  background: light ? THEME.white : THEME.surfaceInput,
                  color: textColor,
                }}
              >
                <option value="">No pack chosen</option>
                {registryPacks.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {`${pack.name ?? pack.id} ${pack.version}`}
                  </option>
                ))}
              </select>
            </HelpTip>
          </label>
          <HelpTip helpId="content.registry.install">
            <button
              type="button"
              data-testid="content-manager-install-from-registry"
              onClick={onInstallFromRegistry}
              style={{ ...primaryButton(light), marginTop: 8 }}
            >
              Install from registry
            </button>
          </HelpTip>
          {updates.map((update) => (
            <HelpTip key={update.id} helpId="content.update">
              <div
                data-testid="content-manager-update-available"
                data-pack={update.id}
                style={{ color: dimColor, marginTop: 8, lineHeight: 1.4 }}
              >
                Update available for {update.name}: installed {update.installed}, registry has{' '}
                {update.offered}. It stays on the installed version until you install this one.
              </div>
            </HelpTip>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <HelpTip helpId="content.install">
            <button type="button" onClick={onInstallLocal} style={primaryButton(light)}>
              Install from local pack…
            </button>
          </HelpTip>
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
              const publisher = publisherByPack[row.record.id]
              return (
                <li key={rowKey(row)} style={{ marginBottom: 8 }}>
                  <InstalledCard
                    record={row.record}
                    {...(row.catalog !== undefined ? { catalog: row.catalog } : {})}
                    {...(loadIssue !== undefined ? { loadIssue } : {})}
                    {...(publisher !== undefined ? { publisher } : {})}
                    light={light}
                    onSetEnabled={onSetEnabled}
                    onUninstall={onUninstall}
                    onTrustPublisher={onTrustPublisher}
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
  publisher,
  light,
  onSetEnabled,
  onUninstall,
  onTrustPublisher,
}: {
  record: InstalledPackRecord
  catalog?: ContentCatalogEntry
  loadIssue?: PackLoadIssue
  publisher?: PublisherCard
  light: boolean
  onSetEnabled: (id: string, enabled: boolean) => void
  onUninstall: (id: string) => void
  onTrustPublisher: (publicKeyHex: string, trust: boolean, packId: string) => void
}) {
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const [confirmTrust, setConfirmTrust] = useState(false)
  const dim = light ? THEME.textFaint : THEME.textMuted
  const blocked = loadIssue?.blocked === true
  return (
    <div style={cardStyle(light)}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong>{record.name}</strong>
        <span style={{ color: dim }}>v{record.packVersion}</span>
        <span style={{ color: dim }}>{record.license}</span>
        <HelpTip
          helpId={
            !record.enabled
              ? 'content.badge.disabled'
              : blocked
                ? 'content.badge.notLoaded'
                : 'content.badge.enabled'
          }
        >
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
        </HelpTip>
      </div>
      <div style={{ color: dim, marginTop: 4 }}>
        {record.description ?? catalog?.description ?? 'Local community pack.'}
      </div>
      <div style={{ color: dim, marginTop: 4, fontSize: 11 }}>
        {record.partCount} part{record.partCount === 1 ? '' : 's'}
        {record.footprintCount > 0
          ? ` · ${record.footprintCount} footprint${record.footprintCount === 1 ? '' : 's'}`
          : ''}{' '}
        · source: {record.acquiredFrom === 'registry' ? 'content registry' : 'local pack'}
      </div>
      {loadIssue !== undefined ? (
        <div style={{ color: dim, marginTop: 4, fontSize: 10, lineHeight: 1.4 }}>
          {loadIssue.reason}
        </div>
      ) : null}
      {blocked ? null : (
        <HelpTip
          helpId={
            record.signatureStatus === 'valid-trusted'
              ? 'content.trust.trusted'
              : record.signatureStatus === 'valid-untrusted'
                ? 'content.trust.untrusted'
                : 'content.trust.none'
          }
        >
          <div style={{ color: dim, marginTop: 4, fontSize: 10, lineHeight: 1.4 }}>
            {record.integrityStatus === 'match'
              ? 'Integrity: declared content hash matched. '
              : record.integrityStatus === 'undeclared'
                ? 'Integrity: no declared content hash. '
                : ''}
            {record.trustNote}
          </div>
        </HelpTip>
      )}
      {publisher !== undefined ? (
        <PublisherTrust
          packId={record.id}
          publisher={publisher}
          confirmTrust={confirmTrust}
          light={light}
          onAsk={() => setConfirmTrust(true)}
          onCancel={() => setConfirmTrust(false)}
          onConfirm={() => {
            setConfirmTrust(false)
            onTrustPublisher(publisher.publicKeyHex, publisher.trust !== 'valid-trusted', record.id)
          }}
        />
      ) : record.signatureStatus === 'valid-trusted' ||
        record.signatureStatus === 'valid-untrusted' ? (
        <div style={{ color: dim, marginTop: 4, fontSize: 10, lineHeight: 1.4 }}>
          This pack was installed before its publisher key was recorded. Install it again to see the
          fingerprint and to pin the key.
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <HelpTip helpId={record.enabled ? 'content.disable' : 'content.enable'}>
          <button
            type="button"
            onClick={() => onSetEnabled(record.id, !record.enabled)}
            style={chipButton(light)}
          >
            {record.enabled ? 'Disable' : 'Enable'}
          </button>
        </HelpTip>
        {confirmUninstall ? (
          <>
            <HelpTip helpId="content.confirmUninstall">
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
            </HelpTip>
            <HelpTip helpId="content.cancelUninstall">
              <button
                type="button"
                onClick={() => setConfirmUninstall(false)}
                style={chipButton(light)}
              >
                Cancel
              </button>
            </HelpTip>
          </>
        ) : (
          <HelpTip helpId="content.uninstall">
            <button
              type="button"
              onClick={() => setConfirmUninstall(true)}
              style={chipButton(light)}
            >
              Uninstall…
            </button>
          </HelpTip>
        )}
      </div>
    </div>
  )
}

function PublisherTrust({
  packId,
  publisher,
  confirmTrust,
  light,
  onAsk,
  onCancel,
  onConfirm,
}: {
  packId: string
  publisher: PublisherCard
  confirmTrust: boolean
  light: boolean
  onAsk: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const dim = light ? THEME.textFaint : THEME.textMuted
  const trusting = publisher.trust !== 'valid-trusted'
  return (
    <div style={{ marginTop: 6 }}>
      <HelpTip helpId="content.fingerprint">
        <div
          data-testid="content-manager-publisher-fingerprint"
          data-pack={packId}
          style={{
            color: dim,
            fontSize: 10,
            lineHeight: 1.4,
            fontFamily: 'ui-monospace, monospace',
            overflowWrap: 'anywhere',
          }}
        >
          Publisher key fingerprint (SHA-256 of the raw ed25519 public key):{' '}
          {publisher.fingerprint || 'still computing'}
        </div>
      </HelpTip>
      <div
        data-testid="content-manager-trust-state"
        data-pack={packId}
        data-trust={publisher.trust}
        style={{ color: dim, marginTop: 4, fontSize: 10, lineHeight: 1.4 }}
      >
        {publisherTrustLabel(publisher.trust)}
      </div>
      {confirmTrust ? (
        <div
          data-testid="content-manager-trust-confirm"
          data-pack={packId}
          style={{ marginTop: 6 }}
        >
          <div style={{ color: dim, fontSize: 11, lineHeight: 1.4 }}>
            {trusting
              ? `Pin this publisher key in ~/.chipblocks/trusted-publishers.json? Fingerprint ${publisher.fingerprint}. This writes a key you choose on this computer. It is not a certificate authority. Other packs signed by this same key will count as pinned too.`
              : `Remove this publisher key from ~/.chipblocks/trusted-publishers.json? Fingerprint ${publisher.fingerprint}. Other packs signed by this same key will also stop counting as pinned.`}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <HelpTip helpId={trusting ? 'content.trust.confirmPin' : 'content.trust.confirmUnpin'}>
              <button
                type="button"
                data-testid="content-manager-trust-confirm-yes"
                onClick={onConfirm}
                style={primaryButton(light)}
                disabled={publisher.fingerprint === ''}
              >
                {trusting ? 'Confirm trust' : 'Confirm untrust'}
              </button>
            </HelpTip>
            <HelpTip helpId="content.trust.cancel">
              <button type="button" onClick={onCancel} style={chipButton(light)}>
                Cancel
              </button>
            </HelpTip>
          </div>
        </div>
      ) : (
        <HelpTip helpId={trusting ? 'content.trust.pin' : 'content.trust.unpin'}>
          <button
            type="button"
            data-testid="content-manager-trust-toggle"
            data-pack={packId}
            onClick={onAsk}
            style={{ ...chipButton(light), marginTop: 6 }}
            disabled={publisher.fingerprint === ''}
          >
            {trusting ? 'Trust this publisher…' : 'Stop trusting this publisher…'}
          </button>
        </HelpTip>
      )}
    </div>
  )
}

function CatalogCard({ entry, light }: { entry: ContentCatalogEntry; light: boolean }) {
  const dim = light ? THEME.textFaint : THEME.textMuted
  return (
    <div style={cardStyle(light)}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong>{entry.name}</strong>
        <HelpTip helpId="content.badge.planned">
          <span style={{ color: dim, fontSize: 10, fontWeight: 700 }}>PLANNED · NOT INSTALLED</span>
        </HelpTip>
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
