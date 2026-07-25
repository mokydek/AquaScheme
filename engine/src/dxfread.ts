import DxfParser from 'dxf-parser'
import type { ImportPoint, ImportSegment } from './importnet'
import type { ParseIssue, TopoParseResult } from './topography'
import type { SurveyPoint } from './types'

/**
 * Reads an AutoCAD DXF drawing into network import geometry (requirements
 * update 1): LINE / LWPOLYLINE / POLYLINE entities become route segments,
 * POINT and INSERT (block references) become node markers. Entities are
 * grouped by layer so the import dialog can let the user pick which layers
 * carry the network. Heavy dependency (dxf-parser), therefore exported as
 * the subpath @aquascheme/engine/dxfread.
 */

export interface DxfLayerInfo {
  name: string
  segments: number
  points: number
  closedSegments?: number
  entityTypes?: Record<string, number>
  zMin?: number
  zMax?: number
  textSamples?: string[]
}

export interface DxfNetworkData {
  segments: ImportSegment[]
  points: Array<ImportPoint & { z?: number; layer?: string }>
  layers: DxfLayerInfo[]
  ok: boolean
}

export type DxfLayerRole =
  | 'corridor'
  | 'redLine'
  | 'utility'
  | 'road'
  | 'hydrography'
  | 'terrain'
  | 'candidateRoute'
  | 'building'
  | 'protectionZone'
  | 'parcel'
  | 'other'

export interface DxfConstraintData {
  /** Closed boundaries in which a designed route is allowed to run. */
  corridorRings: ImportPoint[][]
  /** Open linework from the corridor layer, retained for diagnostics only. */
  corridorLinework: ImportSegment[]
  redLines: ImportSegment[]
  utilityLines: ImportSegment[]
  roadLines: ImportSegment[]
  hydrography: ImportSegment[]
  terrainLines: ImportSegment[]
  candidateRoute: ImportSegment[]
  buildingFootprints: ImportPoint[][]
  protectionZoneRings: ImportPoint[][]
  parcelRings: ImportPoint[][]
  roles: Record<string, DxfLayerRole>
  surveyPoints: SurveyPoint[]
  rejectedSurveyPoints: number
}

const normalizedLayer = (name: string): string => name.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')

function pointSegmentDistance(point: ImportPoint, a: ImportPoint, b: ImportPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return Math.hypot(point.x - a.x, point.y - a.y)
  const ratio = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2))
  return Math.hypot(point.x - (a.x + ratio * dx), point.y - (a.y + ratio * dy))
}

/** Douglas-Peucker removes millimetric CAD vertices and narrow backtracking
 * spikes that make an otherwise valid right-of-way polygon self-intersect. */
function simplifyPolyline(points: ImportPoint[], toleranceM: number): ImportPoint[] {
  if (points.length <= 2) return points
  let farthestIndex = -1
  let farthestDistance = 0
  for (let index = 1; index < points.length - 1; index++) {
    const distance = pointSegmentDistance(points[index], points[0], points[points.length - 1])
    if (distance > farthestDistance) {
      farthestDistance = distance
      farthestIndex = index
    }
  }
  if (farthestDistance <= toleranceM || farthestIndex < 0) return [points[0], points[points.length - 1]]
  const left = simplifyPolyline(points.slice(0, farthestIndex + 1), toleranceM)
  const right = simplifyPolyline(points.slice(farthestIndex), toleranceM)
  return [...left.slice(0, -1), ...right]
}

/**
 * Classifies a complete topographic/master-plan DXF. This is deliberately
 * separate from parseDxfNetwork: a red line, contour or cable must never be
 * imported as a sewer pipe merely because it is a polyline.
 */
export function classifyDxfConstraints(data: DxfNetworkData): DxfConstraintData {
  const roles: Record<string, DxfLayerRole> = {}
  const roleOf = (layer: string): DxfLayerRole => {
    const name = normalizedLayer(layer)
    if (/коридор.*инженер|инженер.*коридор/.test(name)) return 'corridor'
    if (/красн.*лин|крассн.*лин/.test(name)) return 'redLine'
    if (/проезж|тротуар|дорог|улиц|road/.test(name)) return 'road'
    if (/гидрограф|водоем|водоём|река|канал|озер|озёр/.test(name) && !/канализ/.test(name)) return 'hydrography'
    if (/рельеф|горизонтал|отметк|grade|elevation|survey|точк.*высот/.test(name)) return 'terrain'
    if (/охран.*зон|санитар.*зон|защит.*зон|protection/.test(name)) return 'protectionZone'
    if (/здани|сооруж|строени|контур.*объект|building/.test(name)) return 'building'
    if (/участ|землеотвод|границ.*зем|parcel/.test(name)) return 'parcel'
    if (/трубопровод|водопровод|канализ|ливнев|дренаж|кабел|газоснаб|теплосет|электро|связи/.test(name)) return 'utility'
    if (/проект.*(трас|осев|коллектор)|(^|[_ -])к2([_ -]|$)/.test(name)) return 'candidateRoute'
    return 'other'
  }

  for (const layer of data.layers) roles[layer.name] = roleOf(layer.name)
  const byRole = (role: DxfLayerRole) => data.segments.filter((segment) => roles[segment.layer ?? '0'] === role)
  const closedRings = (role: DxfLayerRole) => byRole(role)
    .filter((segment) => segment.closed && segment.points.length >= 4)
    .map((segment) => {
      const points = [...segment.points]
      const first = points[0]
      const last = points[points.length - 1]
      if (first.x === last.x && first.y === last.y) points.pop()
      return simplifyPolyline(points, 0.25)
    })
  const corridor = byRole('corridor')
  const rawCorridorRings = corridor
    .filter((segment) => segment.closed && segment.points.length >= 4)
    .map((segment) => {
      const points = [...segment.points]
      const first = points[0]
      const last = points[points.length - 1]
      if (first.x === last.x && first.y === last.y) points.pop()
      // 5 m is below normal corridor width but removes doubled CAD strokes.
      return simplifyPolyline(points, 5)
    })
    // The source drawing contains small closed symbols on the same layer.
    // Keep only spatially meaningful right-of-way polygons.
    .filter((ring) => {
      const xs = ring.map((point) => point.x)
      const ys = ring.map((point) => point.y)
      return Math.max(...xs) - Math.min(...xs) >= 30 && Math.max(...ys) - Math.min(...ys) >= 30
    })
  const ringArea = (ring: ImportPoint[]) => Math.abs(ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2)
  const fingerprints = new Set<string>()
  const corridorRings = rawCorridorRings
    .sort((a, b) => ringArea(b) - ringArea(a))
    .filter((ring) => {
      const fingerprint = ring.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(';')
      if (fingerprints.has(fingerprint)) return false
      fingerprints.add(fingerprint)
      return true
    })

  const rawSurveyPoints = data.points
    .filter((point) => typeof point.z === 'number' && Number.isFinite(point.z) && point.z !== 0)
    .map((point) => ({ x: point.x, y: point.y, z: point.z as number }))
  const sortedElevations = rawSurveyPoints.map((point) => point.z).sort((a, b) => a - b)
  const median = sortedElevations[Math.floor(sortedElevations.length / 2)] ?? 0
  const deviations = sortedElevations.map((z) => Math.abs(z - median)).sort((a, b) => a - b)
  const medianDeviation = deviations[Math.floor(deviations.length / 2)] ?? 0
  const elevationLimit = Math.max(50, medianDeviation * 8)
  const surveyPoints = rawSurveyPoints.filter((point) => Math.abs(point.z - median) <= elevationLimit)

  return {
    corridorRings,
    corridorLinework: corridor.filter((segment) => !segment.closed),
    redLines: byRole('redLine'),
    utilityLines: byRole('utility'),
    roadLines: byRole('road'),
    hydrography: byRole('hydrography'),
    terrainLines: byRole('terrain'),
    candidateRoute: byRole('candidateRoute'),
    buildingFootprints: closedRings('building'),
    protectionZoneRings: closedRings('protectionZone'),
    parcelRings: closedRings('parcel'),
    roles,
    surveyPoints,
    rejectedSurveyPoints: rawSurveyPoints.length - surveyPoints.length,
  }
}

interface DxfVertex {
  x?: number
  y?: number
  z?: number
}

interface DxfEntity {
  type?: string
  layer?: string
  shape?: boolean
  vertices?: DxfVertex[]
  position?: DxfVertex
  text?: string
  name?: string
}

export function parseDxfNetwork(text: string): DxfNetworkData {
  const empty: DxfNetworkData = { segments: [], points: [], layers: [], ok: false }
  let entities: DxfEntity[]
  try {
    const parsed = new DxfParser().parseSync(text) as { entities?: DxfEntity[] } | null
    if (!parsed?.entities) return empty
    entities = parsed.entities
  } catch {
    return empty
  }

  const segments: ImportSegment[] = []
  const points: Array<ImportPoint & { layer?: string }> = []
  const stats = new Map<string, {
    segments: number
    points: number
    closedSegments: number
    entityTypes: Record<string, number>
    zMin?: number
    zMax?: number
    textSamples: string[]
  }>()
  const bump = (layer: string, kind: 'segments' | 'points') => {
    const entry = stats.get(layer) ?? { segments: 0, points: 0, closedSegments: 0, entityTypes: {}, textSamples: [] }
    entry[kind]++
    stats.set(layer, entry)
  }
  const toPoints = (vertices: DxfVertex[] | undefined): ImportPoint[] =>
    (vertices ?? [])
      .filter((v) => typeof v.x === 'number' && typeof v.y === 'number')
      .map((v) => ({ x: v.x as number, y: v.y as number }))

  for (const entity of entities) {
    const layer = typeof entity.layer === 'string' && entity.layer !== '' ? entity.layer : '0'
    const entry = stats.get(layer) ?? { segments: 0, points: 0, closedSegments: 0, entityTypes: {}, textSamples: [] }
    const entityType = entity.type ?? 'UNKNOWN'
    entry.entityTypes[entityType] = (entry.entityTypes[entityType] ?? 0) + 1
    const text = typeof entity.text === 'string' ? entity.text.trim() : ''
    const blockName = entity.type === 'INSERT' && typeof entity.name === 'string' ? `[BLOCK] ${entity.name}` : ''
    const sample = text || blockName
    if (sample && entry.textSamples.length < 20 && !entry.textSamples.includes(sample)) entry.textSamples.push(sample)
    stats.set(layer, entry)
    if (entity.type === 'LINE') {
      const pts = toPoints(entity.vertices)
      if (pts.length >= 2) {
        segments.push({ points: pts.slice(0, 2), layer })
        bump(layer, 'segments')
      }
    } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
      const pts = toPoints(entity.vertices)
      if (pts.length >= 2) {
        const closed = entity.shape === true
        const first = pts[0]
        const last = pts[pts.length - 1]
        const needsClosing = closed && Math.hypot(first.x - last.x, first.y - last.y) > 1e-9
        segments.push({ points: needsClosing ? [...pts, { ...first }] : pts, layer, closed })
        bump(layer, 'segments')
        if (closed) (stats.get(layer) as NonNullable<ReturnType<typeof stats.get>>).closedSegments++
      }
    } else if (entity.type === 'POINT' || entity.type === 'INSERT') {
      const position = entity.position
      if (position && typeof position.x === 'number' && typeof position.y === 'number') {
        const marker: ImportPoint & { z?: number; layer?: string } = { x: position.x, y: position.y, layer }
        if (typeof position.z === 'number' && Number.isFinite(position.z)) marker.z = position.z
        points.push(marker)
        bump(layer, 'points')
        if (marker.z != null) {
          const layerStats = stats.get(layer) as NonNullable<ReturnType<typeof stats.get>>
          layerStats.zMin = Math.min(layerStats.zMin ?? marker.z, marker.z)
          layerStats.zMax = Math.max(layerStats.zMax ?? marker.z, marker.z)
        }
      }
    }
  }

  const layers: DxfLayerInfo[] = [...stats.entries()]
    .map(([name, s]) => ({
      name,
      segments: s.segments,
      points: s.points,
      closedSegments: s.closedSegments,
      entityTypes: s.entityTypes,
      zMin: s.zMin,
      zMax: s.zMax,
      textSamples: s.textSamples,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { segments, points, layers, ok: segments.length > 0 || points.length > 0 }
}

/**
 * Survey points from a DXF/DWG topographic base (requirements update 3,
 * change 2: drawing sources are accepted in both DWG and DXF). POINT and
 * INSERT entities carry x, y and the elevation in z (group code 30). A DXF
 * point without an explicit elevation reads as z = 0, so a file where every
 * point sits at zero is treated as having no elevations at all and reported
 * honestly instead of producing a silently flat terrain.
 */
export function parseTopographyDxf(text: string): TopoParseResult {
  const data = parseDxfNetwork(text)
  if (!data.ok || data.points.length === 0) {
    return { points: [], issues: [{ row: 0, kind: 'invalidFormat' }], total: 0 }
  }
  const hasElevations = data.points.some((p) => typeof p.z === 'number' && p.z !== 0)
  const issues: ParseIssue[] = []
  if (!hasElevations) {
    data.points.forEach((_point, index) => issues.push({ row: index + 1, kind: 'missingZ' }))
    return { points: [], issues, total: data.points.length }
  }
  const classified = classifyDxfConstraints(data)
  data.points.forEach((point, index) => {
    if (typeof point.z !== 'number' || point.z === 0) issues.push({ row: index + 1, kind: 'missingZ' })
  })
  for (let index = 0; index < classified.rejectedSurveyPoints; index++) {
    issues.push({ row: data.points.length + index + 1, kind: 'badNumber' })
  }
  return { points: classified.surveyPoints, issues, total: data.points.length }
}
