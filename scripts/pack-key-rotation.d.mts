// Types for scripts/pack-key-rotation.mjs (the publisher key rotation tool), for the tests.
import type { KeyObject } from 'node:crypto'

export type RotationStatement = {
  format: 'chipblocks-key-rotation'
  version: 1
  oldKey: string
  newKey: string
  packIds: string[]
  sequence: number
  issuedAt: string
  sig: string
  newKeySig: string
}

export const KEY_ROTATION_FORMAT: 'chipblocks-key-rotation'
export const KEY_ROTATION_DOMAIN: string
export function rotationSigningText(s: {
  oldKey: string
  newKey: string
  packIds: readonly string[]
  sequence: number
  issuedAt: string
}): string
export function rawPublicKeyHex(key: KeyObject): string
export function canonicalPackBody(pack: Record<string, unknown>): string
export function createRotation(args: {
  oldPrivateKey: KeyObject
  newPrivateKey: KeyObject
  packIds: string[]
  sequence: number
  issuedAt?: string
}): RotationStatement
export function signPackText(packText: string, privateKey: KeyObject): string
export function attachRotations(packText: string, statements: readonly unknown[]): string
export function main(argv: string[]): void
