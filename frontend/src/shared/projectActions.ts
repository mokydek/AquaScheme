import { syntheticBasisArtifact } from './basisDemo'

export type ProjectPipelineMode = 'pressure' | 'gravity'
export type SyntheticDemoTarget = 'empty' | 'synthetic' | 'real'

type JsonObject = Record<string, unknown>

function objectValue(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

/** Selects the calculation family behind the shared "Calculate all" CTA. */
export function projectPipelineMode(systemType: string | null | undefined): ProjectPipelineMode {
  return systemType === 'sewer' || systemType === 'storm' ? 'gravity' : 'pressure'
}

function hasRealBasisFiles(content: unknown): boolean {
  const basis = objectValue(content)
  const references = Array.isArray(basis.referenceFiles) ? basis.referenceFiles : []
  const files = objectValue(basis.files)
  if (references.length > 0) return true
  if (Object.keys(files).length === 0) return false
  if (basis.mode !== 'synthetic') return true
  return !Object.entries(files).every(([itemId, fileName]) => (
    typeof fileName === 'string' && syntheticBasisArtifact(itemId, fileName) !== null
  ))
}

/**
 * A demo may be refreshed in an empty or already-synthetic project. Real input
 * is never overwritten because the current Supabase schema has no transaction
 * that spans datasets, buildings, parcels and catalogs.
 */
export function classifySyntheticDemoTarget(input: {
  routeReport?: unknown
  routeStatus?: string | null
  basisContent?: unknown
  datasetKinds: readonly string[]
  buildingCount: number
  nodeCount: number
  pipeCount: number
  parcelCount: number
  catalogCount: number
  boreholeCount: number
}): SyntheticDemoTarget {
  const hasData = input.datasetKinds.some((kind) => kind !== 'region')
    || input.buildingCount > 0
    || input.nodeCount > 0
    || input.pipeCount > 0
    || input.parcelCount > 0
    || input.catalogCount > 0
    || input.boreholeCount > 0
  if (!hasData) return 'empty'

  const routeReport = objectValue(input.routeReport)
  const knownSyntheticState = input.routeStatus === 'preliminary' || routeReport.seedReady === false
  if (routeReport.synthetic === true && knownSyntheticState && !hasRealBasisFiles(input.basisContent)) return 'synthetic'
  return 'real'
}
