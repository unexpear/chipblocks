// Re-exports the codegen'd registries for the six v2 manifests.
// Hand-written; the underlying _generated/*.ts files are produced by
// scripts/codegen-manifests.mjs from the YAML manifests at repo root.

export { signals } from './_generated/signals'
export { materials } from './_generated/materials'
export { shapes } from './_generated/shapes'
export { interfaces } from './_generated/interfaces'
export { behaviors } from './_generated/behaviors'
export { parameters } from './_generated/parameters'

export type { SignalsManifest } from './_generated/signals'
export type { MaterialsManifest } from './_generated/materials'
export type { ShapesManifest } from './_generated/shapes'
export type { InterfacesManifest } from './_generated/interfaces'
export type { BehaviorsManifest } from './_generated/behaviors'
export type { ParametersManifest } from './_generated/parameters'
