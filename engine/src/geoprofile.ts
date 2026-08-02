import { geologyCoverageAt, type GeoCoverage } from './geocoverage'
import type { Aggressiveness, Borehole, GeologyAttributes } from './geology'
import type { Basis } from './normregistry'

/**
 * Geology along the route (requirements update 3, change 1, G3). Geology is
 * applied per station, not as one value for the whole project: values are
 * interpolated between boreholes along the trace. The interpolation and the
 * design influences it drives are pure and unit tested here; every influence
 * is tied to a norm registry entry (unverified until confirmed).
 */

export interface GeoAtPoint {
  /** Groundwater table depth below the surface, m (IDW); null if unreported. */
  waterDepthM: number | null
  /** Worst aggressiveness among the nearest boreholes; null if unreported. */
  aggressiveness: Aggressiveness | null
  /** Soil at the given depth from the nearest borehole. */
  soilName: string | null
  igeCode: string | null
  /** Reliability of the values, present when an offset limit was applied. */
  coverage?: GeoCoverage
}

export interface GeoInterpolationOptions {
  /**
   * Confirmed maximum perpendicular offset of a borehole from the axis, m.
   * Boreholes beyond it are not used at all: interpolating from them projects
   * an unrelated borehole onto the profile as if it described the route
   * (missing-data report, M09). Without the limit the previous behaviour is
   * kept, so existing callers are unaffected.
   */
  maxOffsetM?: number
}

const AGG_RANK: Record<Aggressiveness, number> = { low: 0, medium: 1, high: 2 }
const AGG_BY_RANK: Aggressiveness[] = ['low', 'medium', 'high']

function worst(a: Aggressiveness | null, b: Aggressiveness | null): Aggressiveness | null {
  if (a === null) return b
  if (b === null) return a
  return AGG_RANK[a] >= AGG_RANK[b] ? a : b
}

function boreholeAggressiveness(b: Borehole): Aggressiveness | null {
  return [b.water.aggressivenessSteel, b.water.aggressivenessConcrete, b.water.aggressivenessPe].reduce<Aggressiveness | null>(
    (acc, v) => worst(acc, v ?? null),
    null,
  )
}

function soilAtDepth(b: Borehole, depthM: number): { soilName: string | null; igeCode: string | null } {
  if (b.layers.length === 0) return { soilName: null, igeCode: null }
  const hit = b.layers.find((l) => depthM >= l.topDepthM && depthM < l.bottomDepthM)
  const layer = hit ?? b.layers[b.layers.length - 1]
  return { soilName: layer.soilName ?? null, igeCode: layer.igeCode ?? null }
}

/**
 * Interpolate geology at a point (inverse distance weighting for the water
 * table; worst aggressiveness and nearest soil for the categorical values —
 * conservative for design). depthM is the depth of interest (pipe bottom).
 */
export function interpolateGeologyAt(
  boreholes: Borehole[],
  x: number,
  y: number,
  depthM = 2,
  options: GeoInterpolationOptions = {},
): GeoAtPoint {
  const empty: GeoAtPoint = { waterDepthM: null, aggressiveness: null, soilName: null, igeCode: null }
  const coverage = options.maxOffsetM === undefined
    ? undefined
    : geologyCoverageAt(boreholes, x, y, options.maxOffsetM)

  const located = boreholes.filter((b) => b.x !== undefined && b.y !== undefined)
  if (located.length === 0) return coverage ? { ...empty, coverage } : empty

  const withDistAll = located
    .map((b) => ({ b, d: Math.hypot((b.x as number) - x, (b.y as number) - y) }))
    .sort((p, q) => p.d - q.d)

  // Beyond the confirmed offset a borehole says nothing about this station, so
  // it is dropped rather than smoothed in.
  const withDist = options.maxOffsetM === undefined
    ? withDistAll
    : withDistAll.filter((p) => p.d <= (options.maxOffsetM as number))
  if (withDist.length === 0) return coverage ? { ...empty, coverage } : empty

  // Water table: IDW over boreholes that report it (exact hit wins).
  let waterDepthM: number | null = null
  const withWater = withDist.filter((p) => p.b.water.depthM !== undefined)
  if (withWater.length > 0) {
    const exact = withWater.find((p) => p.d < 1e-6)
    if (exact) {
      waterDepthM = exact.b.water.depthM as number
    } else {
      let num = 0
      let den = 0
      for (const { b, d } of withWater) {
        const w = 1 / (d * d)
        num += w * (b.water.depthM as number)
        den += w
      }
      waterDepthM = num / den
    }
  }

  // Aggressiveness: worst among the nearest two boreholes that report it.
  let aggressiveness: Aggressiveness | null = null
  let counted = 0
  for (const { b } of withDist) {
    const a = boreholeAggressiveness(b)
    if (a !== null) {
      aggressiveness = worst(aggressiveness, a)
      counted++
      if (counted >= 2) break
    }
  }

  // Soil: nearest borehole, at the depth of interest.
  const { soilName, igeCode } = soilAtDepth(withDist[0].b, depthM)
  const result: GeoAtPoint = { waterDepthM, aggressiveness, soilName, igeCode }
  return coverage ? { ...result, coverage } : result
}

export interface GeoStation {
  /** Chainage along the route, m. */
  stationM: number
  x: number
  y: number
  geo: GeoAtPoint
}

/**
 * Sample interpolated geology at each vertex of a route path. depthM is the
 * depth of interest for the soil/water (pipe bottom, i.e. the burial depth).
 */
export function sampleGeoAlong(
  boreholes: Borehole[],
  path: Array<{ x: number; y: number }>,
  depthM = 2,
  options: GeoInterpolationOptions = {},
): GeoStation[] {
  const stations: GeoStation[] = []
  let chain = 0
  for (let i = 0; i < path.length; i++) {
    if (i > 0) chain += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
    stations.push({
      stationM: chain,
      x: path[i].x,
      y: path[i].y,
      geo: interpolateGeologyAt(boreholes, path[i].x, path[i].y, depthM, options),
    })
  }
  return stations
}

export type GeoInfluenceCode = 'corrosion' | 'bedding' | 'dewatering' | 'subsidence' | 'heaving'

export interface GeoInfluence {
  code: GeoInfluenceCode
  severity: 'measure' | 'warning'
  refs: string[]
  basis: Basis
  /** Optional context for the note (soil, aggressiveness, depths). */
  detail?: string
}

/**
 * Design influences of the geology (requirements update 3, change 1, G3).
 * Each influence carries the norm registry ids that justify it; the material
 * itself is chosen elsewhere (selectMaterials), this documents the geology
 * driven decisions with their basis.
 */
export function assessGeologyInfluences(input: {
  maxAggressiveness: Aggressiveness | null
  minWaterDepthM: number | null
  burialDepthM: number
  dominantSoil?: string | null
  attributes?: Partial<GeologyAttributes>
}): GeoInfluence[] {
  const influences: GeoInfluence[] = []

  if (input.maxAggressiveness && AGG_RANK[input.maxAggressiveness] >= AGG_RANK.medium) {
    influences.push({
      code: 'corrosion',
      severity: 'measure',
      refs: ['geology.corrosion'],
      basis: 'engineering',
      detail: input.maxAggressiveness,
    })
  }

  influences.push({
    code: 'bedding',
    severity: 'measure',
    refs: ['geology.bedding'],
    basis: 'engineering',
    detail: input.dominantSoil ?? undefined,
  })

  if (input.minWaterDepthM !== null && input.minWaterDepthM < input.burialDepthM) {
    influences.push({
      code: 'dewatering',
      severity: 'warning',
      refs: ['geology.dewatering'],
      basis: 'normative',
      detail: `УГВ ${input.minWaterDepthM.toFixed(1)} м выше дна траншеи ${input.burialDepthM.toFixed(1)} м`,
    })
  }

  if (input.attributes?.subsidenceType) {
    influences.push({
      code: 'subsidence',
      severity: 'measure',
      refs: ['geology.bedding'],
      basis: 'engineering',
      detail: `тип ${input.attributes.subsidenceType}`,
    })
  }
  if (input.attributes?.heaving) {
    influences.push({ code: 'heaving', severity: 'measure', refs: ['geology.bedding'], basis: 'engineering' })
  }

  return influences
}

export { AGG_BY_RANK }
