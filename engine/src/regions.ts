/**
 * Regions of Kazakhstan with regional design parameters (requirements
 * update 3, change 3): seismic intensity per the SP RK 2.03-30 zoning maps,
 * design freezing depth, rain parameters (for the future storm module) and
 * the hazards characteristic for the region.
 *
 * CRITICAL: the normative values are NOT invented. Every region ships with
 * null values and an empty hazard list, status 'unverified', until the user
 * supplies the official figures (seismic zoning maps, climatology tables).
 * Only the region names, kinds and administrative center coordinates are
 * general geographic knowledge and are filled in — they drive the pick list
 * and the nearest-region auto detection, not engineering decisions.
 * The app mirrors this list into the regions DB table (like the norm
 * registry); the code stays the source of truth.
 */

export type HazardKind =
  | 'earthquake'
  | 'flood'
  | 'mudflow'
  | 'landslide'
  | 'subsidence'
  | 'karst'
  | 'high_groundwater'

export const HAZARD_KINDS: HazardKind[] = [
  'earthquake',
  'flood',
  'mudflow',
  'landslide',
  'subsidence',
  'karst',
  'high_groundwater',
]

export interface RainParams {
  /** q20 — rain intensity, l/s per ha (metod of limit intensities, K2). */
  q20?: number
  /** Exponent n of the intensity formula. */
  n?: number
}

export interface RegionInfo {
  /** Stable slug id, also the DB primary key. */
  id: string
  name: string
  kind: 'oblast' | 'city'
  /** Administrative center, for the nearest-region auto detection. */
  center: { lon: number; lat: number }
  /** Seismic intensity, points (SP RK 2.03-30 maps). null = TODO official value. */
  seismicPoints: number | null
  /** Design freezing depth, m. null = TODO official value. */
  freezingDepthM: number | null
  /** Rain parameters for the storm module (K2). null = TODO official values. */
  rainParams: RainParams | null
  /** Hazards characteristic for the region. Empty = TODO official list. */
  hazards: HazardKind[]
  status: 'verified' | 'unverified'
}

function region(id: string, name: string, kind: 'oblast' | 'city', lon: number, lat: number): RegionInfo {
  return {
    id,
    name,
    kind,
    center: { lon, lat },
    seismicPoints: null,
    freezingDepthM: null,
    rainParams: null,
    hazards: [],
    status: 'unverified',
  }
}

/** 17 oblasts (after the 2022 reform) plus the 3 cities of republican significance. */
export const REGIONS_KZ: RegionInfo[] = [
  region('astana', 'г. Астана', 'city', 71.43, 51.13),
  region('almaty-city', 'г. Алматы', 'city', 76.95, 43.24),
  region('shymkent', 'г. Шымкент', 'city', 69.59, 42.32),
  region('abay', 'Абайская область', 'oblast', 80.25, 50.41),
  region('akmola', 'Акмолинская область', 'oblast', 69.39, 53.28),
  region('aktobe', 'Актюбинская область', 'oblast', 57.17, 50.28),
  region('almaty-oblast', 'Алматинская область', 'oblast', 77.06, 43.87),
  region('atyrau', 'Атырауская область', 'oblast', 51.92, 47.09),
  region('east-kazakhstan', 'Восточно-Казахстанская область', 'oblast', 82.61, 49.95),
  region('zhambyl', 'Жамбылская область', 'oblast', 71.37, 42.9),
  region('zhetysu', 'Жетысуская область', 'oblast', 78.37, 45.02),
  region('west-kazakhstan', 'Западно-Казахстанская область', 'oblast', 51.37, 51.23),
  region('karaganda', 'Карагандинская область', 'oblast', 73.09, 49.8),
  region('kostanay', 'Костанайская область', 'oblast', 63.62, 53.21),
  region('kyzylorda', 'Кызылординская область', 'oblast', 65.51, 44.85),
  region('mangystau', 'Мангистауская область', 'oblast', 51.17, 43.65),
  region('pavlodar', 'Павлодарская область', 'oblast', 76.95, 52.29),
  region('north-kazakhstan', 'Северо-Казахстанская область', 'oblast', 69.15, 54.87),
  region('turkestan', 'Туркестанская область', 'oblast', 68.25, 43.3),
  region('ulytau', 'Улытауская область', 'oblast', 67.71, 47.78),
]

const REGION_BY_ID = new Map(REGIONS_KZ.map((r) => [r.id, r]))

export function getRegion(id: string): RegionInfo | undefined {
  return REGION_BY_ID.get(id)
}

/**
 * Nearest region by its administrative center (planar approximation with
 * latitude correction — sufficient at country scale). Cities win over their
 * surrounding oblast when the site is closer to the city center.
 */
export function nearestRegion(lon: number, lat: number, regions: RegionInfo[] = REGIONS_KZ): RegionInfo | null {
  let best: RegionInfo | null = null
  let bestDist = Number.POSITIVE_INFINITY
  const cosLat = Math.cos((lat * Math.PI) / 180)
  for (const r of regions) {
    const dx = (r.center.lon - lon) * cosLat
    const dy = r.center.lat - lat
    const d = dx * dx + dy * dy
    if (d < bestDist) {
      bestDist = d
      best = r
    }
  }
  return best
}
