/**
 * Cited community-library catalog — the entries the Content Manager browses.
 *
 * These are NOT a live marketplace and NOT downloadable from the app. They are the planned
 * community libraries named in FINAL-STATE-VISION.md (chipblocks-audio, peripherals, cpus,
 * radios, video, experimental), shown so a user can see what the product plans for and how
 * those relate to a local pack they install. Status is always cite-only / planned until a
 * real published pack exists; the install path remains "Install from local pack…".
 */

export type CatalogEntryStatus = 'planned' | 'local-only'

export type ContentCatalogEntry = {
  id: string
  name: string
  description: string
  status: CatalogEntryStatus
  /** Where this catalog entry is cited from (project doc, not a download URL). */
  citation: string
  /** Suggested SPDX license when someone authors a pack for this id. */
  suggestedLicense: string
}

/**
 * The seed catalog. Ids match FINAL-STATE-VISION.md library table. Keep descriptions honest:
 * none of these are fetched or auto-installed by ChipBlocks today.
 */
export const CITED_CONTENT_CATALOG: readonly ContentCatalogEntry[] = [
  {
    id: 'chipblocks_audio',
    name: 'chipblocks-audio',
    description:
      'Inaugural starter library: audio-domain block groups (oscillators, filters, ADSR, etc.). Planned community pack — not shipped as an in-app download.',
    status: 'planned',
    citation: 'FINAL-STATE-VISION.md § community libraries table',
    suggestedLicense: 'MIT',
  },
  {
    id: 'chipblocks_peripherals',
    name: 'chipblocks-peripherals',
    description:
      'SPI / I²C / UART / GPIO / PWM and phone-class peripheral block groups. Community-driven; install from a local pack when available.',
    status: 'planned',
    citation: 'FINAL-STATE-VISION.md § community libraries table',
    suggestedLicense: 'MIT',
  },
  {
    id: 'chipblocks_cpus',
    name: 'chipblocks-cpus',
    description:
      'Packaged CPU cores (picorv32 first) conforming to a chipblocks CPU socket. Planned — not auto-downloaded.',
    status: 'planned',
    citation: 'FINAL-STATE-VISION.md § community libraries table',
    suggestedLicense: 'Apache-2.0',
  },
  {
    id: 'chipblocks_radios',
    name: 'chipblocks-radios',
    description: 'OOK / audio-FSK / LoRa-style radio block groups. Planned community pack.',
    status: 'planned',
    citation: 'FINAL-STATE-VISION.md § community libraries table',
    suggestedLicense: 'MIT',
  },
  {
    id: 'chipblocks_video',
    name: 'chipblocks-video',
    description:
      'Sprite engine, framebuffer, character generator, HDMI/DVI outputs. Future community pack.',
    status: 'planned',
    citation: 'FINAL-STATE-VISION.md § community libraries table',
    suggestedLicense: 'MIT',
  },
  {
    id: 'chipblocks_experimental',
    name: 'chipblocks-experimental',
    description:
      'Anything-goes experimental grab bag. Install at your own risk — still requires a declared permissive license and local validation.',
    status: 'planned',
    citation: 'FINAL-STATE-VISION.md § community libraries table',
    suggestedLicense: 'MIT',
  },
]

export function catalogEntryById(id: string): ContentCatalogEntry | undefined {
  return CITED_CONTENT_CATALOG.find((e) => e.id === id)
}
