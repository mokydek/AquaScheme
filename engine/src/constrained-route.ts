import type { SurveyPoint } from './types'
import { interpolateElevation } from './trace'
import type { NetworkNode, NetworkPipe, TracedNetwork } from './trace'

export interface RoutePoint { x: number; y: number }
export interface RouteSegment {
  points: RoutePoint[]
  layer?: string
  sourceType?: string
  sourceHandle?: string
  colorNumber?: number
  lineType?: string
}
export interface RouteTextEntity extends RoutePoint {
  text: string
  layer?: string
  sourceType?: 'TEXT' | 'MTEXT' | string
  sourceHandle?: string
  height?: number
  rotationDeg?: number
  colorNumber?: number
}
export interface RouteBlockEntity extends RoutePoint {
  name: string
  layer?: string
  sourceHandle?: string
  rotationDeg?: number
  scaleX?: number
  scaleY?: number
  colorNumber?: number
}
export interface RouteTerminal extends RoutePoint { id: string; buildingId?: string }

export type RouteGeoreference =
  | {
    kind: 'affine_bounds'
    westX: number
    eastX: number
    northY: number
    southY: number
    westLon: number
    eastLon: number
    northLat: number
    southLat: number
    source: string
  }
  | { kind: 'local_anchor'; anchor?: { lon: number; lat: number }; source: string }
  /**
   * Координатная сетка самого чертежа: подписанные линии доказывают метрику,
   * масштаб, отсутствие разворота и дают начало координат.
   *
   * Отдельный вид, а не `local_anchor`, потому что датум из сетки не следует.
   * У `local_anchor` без якоря перевод в градусы молча берёт запасной якорь
   * (Астана), и объект в Алматы оказался бы на карте за тысячу километров от
   * своего места. Чертежи с такой привязкой выпускать можно — они несут
   * сетку, — а подложку OSM под них подкладывать нельзя.
   */
  | { kind: 'survey_grid'; pitchM?: number; source: string }
  | { kind: 'unreferenced'; source: string }

export interface RouteConstraintInput {
  corridorRings: RoutePoint[][]
  /** Approved or manually confirmed centre/guide lines inside the corridor. */
  guideLines?: RouteSegment[]
  /** Required for a real basemap overlay; it does not affect route geometry. */
  georeference?: RouteGeoreference
  redLines?: RouteSegment[]
  utilityLines?: RouteSegment[]
  roadLines?: RouteSegment[]
  waterLines?: RouteSegment[]
  /** Imported terrain contours/breaklines. Retained as vector CAD context. */
  terrainLines?: RouteSegment[]
  /** Complete source linework, drawn as a neutral underlay behind semantic layers. */
  cadContextLines?: RouteSegment[]
  /** Source DXF annotations kept as text, never as a raster screenshot. */
  cadTextEntities?: RouteTextEntity[]
  /** Source DXF INSERT references represented by their insertion marker and name. */
  cadBlockEntities?: RouteBlockEntity[]
  /** Closed water boundaries. They are passable only inside an approved crossing. */
  waterRings?: RoutePoint[][]
  hardObstacles?: RouteSegment[]
  /** Closed building/structure footprints that routing may never enter. */
  hardObstacleRings?: RoutePoint[][]
  /** Explicit alias used by master-plan importers. */
  buildingPolygons?: RoutePoint[][]
  /** Land parcel boundaries retained for audit; access policy is separate. */
  parcelRings?: RoutePoint[][]
  /** Additional legally or technically forbidden areas. */
  forbiddenRings?: RoutePoint[][]
  /** Protective zones are hard barriers outside explicitly approved crossings. */
  protectionZoneRings?: RoutePoint[][]
  protectionZones?: RoutePoint[][]
  /** Explicitly approved crossing windows for water/protected obstacles. */
  approvedCrossingRings?: RoutePoint[][]
  approvedCrossingZones?: RoutePoint[][]
  surveyPoints?: SurveyPoint[]
  /** Layers that have not yet been classified or explicitly ignored. */
  unresolvedLayers?: string[]
  /** An empty source group is safe only when a competent user confirmed absence. */
  sourceDeclarations?: Partial<Record<
    'buildings' | 'utilities' | 'roads' | 'hydrography' | 'parcels' | 'protectionZones',
    'present' | 'confirmed_absent' | 'unknown'
  >>
}

export interface ConstrainedRouteOptions {
  gridSizeM?: number
  boundaryPenalty?: number
  utilityClearanceM?: number
  utilityCrossingPenalty?: number
  redLineCrossingPenalty?: number
  roadCrossingPenalty?: number
  waterCrossingPenalty?: number
  waterInteriorPenalty?: number
  /** Maximum distance from a folded DWG corridor boundary that may be routed. */
  corridorBoundaryBandM?: number
  /** Cost of one metre of ground rise while travelling towards the outlet. */
  uphillPenaltyPerM?: number
  turnPenalty?: number
  /** Cost per grid step for moving away from a confirmed master-plan guide. */
  guideDistancePenalty?: number
  /** Distance to a guide at which the attraction penalty reaches its cap. */
  guideAttractionM?: number
  corridorSnapToleranceM?: number
  maxGridCells?: number
  /** When true, a water-line crossing is impossible outside an approved window. */
  requireApprovedWaterCrossings?: boolean
}

export interface ConstrainedRouteReport {
  ok: boolean
  gridSizeM: number
  evaluatedCells: number
  routedTerminals: number
  unroutedTerminals: string[]
  redLineCrossings: number
  utilityCrossings: number
  roadCrossings: number
  waterCrossings: number
  outsideCorridorSegments: number
  warnings: string[]
}

export interface ConstrainedRouteResult {
  network: TracedNetwork
  report: ConstrainedRouteReport
  paths: Array<{ terminalId: string; points: RoutePoint[] }>
}

export interface RouteBenchmark {
  referenceCoveragePct: number
  routeCoveragePct: number
  meanDeviationM: number
  maximumDeviationM: number
  /** Symmetric sampled Hausdorff distance, m. */
  hausdorffDeviationM: number
  sampledPoints: number
}

const DEFAULTS: Required<ConstrainedRouteOptions> = {
  gridSizeM: 15,
  boundaryPenalty: 18,
  utilityClearanceM: 5,
  utilityCrossingPenalty: 25,
  redLineCrossingPenalty: 60,
  roadCrossingPenalty: 4,
  waterCrossingPenalty: 80,
  waterInteriorPenalty: 35,
  corridorBoundaryBandM: 45,
  uphillPenaltyPerM: 2.5,
  turnPenalty: 0.35,
  guideDistancePenalty: 1.5,
  guideAttractionM: 75,
  corridorSnapToleranceM: 50,
  maxGridCells: 450_000,
  requireApprovedWaterCrossings: true,
}

const round2 = (value: number) => Math.round(value * 100) / 100
const distance = (a: RoutePoint, b: RoutePoint) => Math.hypot(a.x - b.x, a.y - b.y)

function pointInRing(point: RoutePoint, ring: RoutePoint[]): boolean {
  // Non-zero winding is intentional: master-plan corridor polylines may touch
  // themselves at branch junctions. Even/odd ray casting cancels overlapping
  // traversals and incorrectly disconnects valid branches.
  let winding = 0
  const side = (a: RoutePoint, b: RoutePoint) =>
    (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y)
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (a.y <= point.y) {
      if (b.y > point.y && side(a, b) > 0) winding++
    } else if (b.y <= point.y && side(a, b) < 0) winding--
  }
  return winding !== 0
}

function pointSegmentDistance(point: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return distance(point, a)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2))
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

function distanceToSegments(point: RoutePoint, segments: RouteSegment[]): number {
  let best = Number.POSITIVE_INFINITY
  for (const segment of segments) {
    for (let i = 1; i < segment.points.length; i++) {
      best = Math.min(best, pointSegmentDistance(point, segment.points[i - 1], segment.points[i]))
    }
  }
  return best
}

function distanceToRings(point: RoutePoint, rings: RoutePoint[][]): number {
  return distanceToSegments(point, rings.map((points) => ({ points: [...points, points[0]] })))
}

function characteristicRingWidth(ring: RoutePoint[]): number {
  let doubleArea = 0
  let perimeter = 0
  for (let index = 0; index < ring.length; index++) {
    const point = ring[index]
    const next = ring[(index + 1) % ring.length]
    doubleArea += point.x * next.y - next.x * point.y
    perimeter += distance(point, next)
  }
  return perimeter > 0 ? Math.abs(doubleArea) / perimeter : 0
}

function segmentIntersection(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint): boolean {
  const cross = (p: RoutePoint, q: RoutePoint, r: RoutePoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const c1 = cross(a, b, c)
  const c2 = cross(a, b, d)
  const c3 = cross(c, d, a)
  const c4 = cross(c, d, b)
  const epsilon = 1e-9
  const opposite = (left: number, right: number) =>
    (left > epsilon && right < -epsilon) || (left < -epsilon && right > epsilon)
  if (opposite(c1, c2) && opposite(c3, c4)) return true
  const onSegment = (p: RoutePoint, q: RoutePoint, r: RoutePoint) =>
    Math.abs(cross(p, q, r)) <= epsilon
    && r.x >= Math.min(p.x, q.x) - epsilon
    && r.x <= Math.max(p.x, q.x) + epsilon
    && r.y >= Math.min(p.y, q.y) - epsilon
    && r.y <= Math.max(p.y, q.y) + epsilon
  // Touching a protected line at a grid vertex is still a crossing candidate;
  // otherwise A* can bypass an approval rule by stepping exactly onto it.
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
}

function countCrossings(path: RoutePoint[], segments: RouteSegment[]): number {
  let count = 0
  for (let i = 1; i < path.length; i++) {
    for (const segment of segments) {
      for (let j = 1; j < segment.points.length; j++) {
        if (segmentIntersection(path[i - 1], path[i], segment.points[j - 1], segment.points[j])) count++
      }
    }
  }
  return count
}

function edgeCrossings(a: RoutePoint, b: RoutePoint, segments: RouteSegment[]): number {
  let count = 0
  for (const segment of segments) {
    for (let index = 1; index < segment.points.length; index++) {
      if (segmentIntersection(a, b, segment.points[index - 1], segment.points[index])) count++
    }
  }
  return count
}

/**
 * Validation only: compares a generated route to an independently accepted
 * alignment. The reference is never fed back into route generation.
 */
export function compareRouteToReference(
  paths: Array<{ points: RoutePoint[] }>,
  reference: RoutePoint[],
  toleranceM = 25,
  sampleStepM = 10,
): RouteBenchmark {
  const routeSegments = paths.flatMap((path) =>
    path.points.slice(1).map((point, index) => [path.points[index], point] as const),
  )
  const sampleLine = (line: RoutePoint[]): RoutePoint[] => {
    const result: RoutePoint[] = []
    for (let index = 1; index < line.length; index++) {
      const a = line[index - 1]
      const b = line[index]
      const count = Math.max(1, Math.ceil(distance(a, b) / sampleStepM))
      for (let step = 0; step < count; step++) {
        const ratio = step / count
        result.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio })
      }
    }
    if (line.length > 0) result.push(line[line.length - 1])
    return result
  }
  const samples = sampleLine(reference)
  const routeSamples = paths.flatMap((path) => sampleLine(path.points))
  const referenceSegments = reference.slice(1).map((point, index) => [reference[index], point] as const)
  if (samples.length === 0 || routeSegments.length === 0) {
    return {
      referenceCoveragePct: 0,
      routeCoveragePct: 0,
      meanDeviationM: Number.POSITIVE_INFINITY,
      maximumDeviationM: Number.POSITIVE_INFINITY,
      hausdorffDeviationM: Number.POSITIVE_INFINITY,
      sampledPoints: samples.length,
    }
  }
  const deviations = samples.map((point) =>
    Math.min(...routeSegments.map(([a, b]) => pointSegmentDistance(point, a, b))),
  )
  const reverseDeviations = referenceSegments.length === 0
    ? [Number.POSITIVE_INFINITY]
    : routeSamples.map((point) => Math.min(...referenceSegments.map(([a, b]) => pointSegmentDistance(point, a, b))))
  return {
    referenceCoveragePct: round2(100 * deviations.filter((value) => value <= toleranceM).length / deviations.length),
    routeCoveragePct: round2(100 * reverseDeviations.filter((value) => value <= toleranceM).length / reverseDeviations.length),
    meanDeviationM: round2(deviations.reduce((sum, value) => sum + value, 0) / deviations.length),
    maximumDeviationM: round2(Math.max(...deviations)),
    hausdorffDeviationM: round2(Math.max(Math.max(...deviations), Math.max(...reverseDeviations))),
    sampledPoints: samples.length,
  }
}

interface GridCell {
  col: number
  row: number
  point: RoutePoint
  boundaryDistance: number
  utilityDistance: number
  guideDistance: number
  surfaceElevation: number
  insideWater: boolean
}

export function traceConstrainedNetwork(
  terminals: RouteTerminal[],
  source: RoutePoint,
  constraints: RouteConstraintInput,
  options: ConstrainedRouteOptions = {},
): ConstrainedRouteResult {
  const opt = { ...DEFAULTS, ...options }
  const warnings: string[] = []
  const empty = (message: string): ConstrainedRouteResult => ({
    network: { nodes: [], pipes: [], totalLengthM: 0 },
    paths: [],
    report: {
      ok: false, gridSizeM: opt.gridSizeM, evaluatedCells: 0, routedTerminals: 0,
      unroutedTerminals: terminals.map((terminal) => terminal.id), redLineCrossings: 0,
      utilityCrossings: 0, roadCrossings: 0, waterCrossings: 0,
      outsideCorridorSegments: 0, warnings: [message],
    },
  })
  const rings = constraints.corridorRings.filter((ring) => ring.length >= 3)
  if (rings.length === 0) return empty('Нет замкнутого инженерного коридора: окончательная трасса не строится.')

  const all = rings.flat()
  const minX = Math.min(...all.map((point) => point.x)) - opt.gridSizeM
  const minY = Math.min(...all.map((point) => point.y)) - opt.gridSizeM
  const maxX = Math.max(...all.map((point) => point.x)) + opt.gridSizeM
  const maxY = Math.max(...all.map((point) => point.y)) + opt.gridSizeM
  const cols = Math.ceil((maxX - minX) / opt.gridSizeM) + 1
  const rows = Math.ceil((maxY - minY) / opt.gridSizeM) + 1
  if (cols * rows > opt.maxGridCells) return empty(`Сетка ${cols}×${rows} превышает безопасный предел.`)

  const utilities = constraints.utilityLines ?? []
  const guides = constraints.guideLines ?? []
  const redLines = constraints.redLines ?? []
  const roads = constraints.roadLines ?? []
  const water = constraints.waterLines ?? []
  const waterRings = (constraints.waterRings ?? []).filter((ring) => ring.length >= 3)
  const hard = constraints.hardObstacles ?? []
  const hardRings = [...(constraints.hardObstacleRings ?? []), ...(constraints.buildingPolygons ?? []), ...(constraints.forbiddenRings ?? [])]
    .filter((ring) => ring.length >= 3)
  const protectionRings = [...(constraints.protectionZoneRings ?? []), ...(constraints.protectionZones ?? [])].filter((ring) => ring.length >= 3)
  const approvedCrossings = [...(constraints.approvedCrossingRings ?? []), ...(constraints.approvedCrossingZones ?? [])].filter((ring) => ring.length >= 3)
  const survey = constraints.surveyPoints ?? []
  const cells = new Map<string, GridCell>()
  const key = (col: number, row: number) => `${col}:${row}`
  // A master-plan "corridor" is often a single folded boundary polyline. If
  // it is treated as a conventional filled polygon, the large void between
  // branches becomes falsely available and A* draws impossible straight
  // chords through lakes and parcels. Keep only the engineering band next to
  // the supplied boundary; a normal 15-25 m corridor remains fully available.
  const ringRules = rings.map((ring) => ({
    ring,
    // For a long thin polygon, 2A/P approximates its physical width. A very
    // low A/P value compared with its overall bounds identifies the folded
    // master-plan corridor used by this project. Wide, ordinary parcels keep
    // their complete interior and are not hollowed out by this safeguard.
    restrictToBoundaryBand: characteristicRingWidth(ring) <= opt.corridorBoundaryBandM,
  }))
  const isNavigable = (point: RoutePoint) => ringRules.some(({ ring, restrictToBoundaryBand }) =>
    pointInRing(point, ring)
      && (!restrictToBoundaryBand || distanceToRings(point, [ring]) <= opt.corridorBoundaryBandM),
  )
  const isApprovedCrossing = (point: RoutePoint) => approvedCrossings.some((ring) => pointInRing(point, ring))
  const isForbiddenEnvironmentalPoint = (point: RoutePoint) => {
    if (isApprovedCrossing(point)) return false
    return waterRings.some((ring) => pointInRing(point, ring))
      || protectionRings.some((ring) => pointInRing(point, ring))
  }
  const segmentIsNavigable = (a: RoutePoint, b: RoutePoint) => {
    const samples = Math.max(1, Math.ceil(distance(a, b) / (opt.gridSizeM * 0.5)))
    if (opt.requireApprovedWaterCrossings && edgeCrossings(a, b, water) > 0) {
      const hasApprovedWindow = Array.from({ length: samples + 1 }, (_, index) => {
        const ratio = index / samples
        return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }
      }).some(isApprovedCrossing)
      if (!hasApprovedWindow) return false
    }
    for (let sample = 1; sample < samples; sample++) {
      const ratio = sample / samples
      const point = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }
      if (!isNavigable(point)) return false
      if (hard.length > 0 && distanceToSegments(point, hard) < opt.gridSizeM * 0.55) return false
      if (hardRings.some((ring) => pointInRing(point, ring))) return false
      if (isForbiddenEnvironmentalPoint(point)) return false
    }
    return true
  }
  const simplifyNavigablePath = (points: RoutePoint[]) => {
    if (points.length < 3) return points
    const crossingGroups = [utilities, redLines, roads, water]
    const crossingPrefixes = crossingGroups.map((segments) => {
      const prefix = [0]
      for (let index = 1; index < points.length; index++) {
        prefix[index] = prefix[index - 1] + edgeCrossings(points[index - 1], points[index], segments)
      }
      return prefix
    })
    const utilityClearances = utilities.length > 0
      ? points.map((point) => distanceToSegments(point, utilities))
      : points.map(() => Number.POSITIVE_INFINITY)
    const guideClearances = guides.length > 0
      ? points.map((point) => distanceToSegments(point, guides))
      : points.map(() => 0)
    const surfaceElevations = survey.length > 0
      ? points.map((point) => interpolateElevation(survey, point.x, point.y))
      : points.map(() => 0)
    const touchesWater = points.map((point) => waterRings.some((ring) => pointInRing(point, ring)))
    const result = [points[0]]
    let anchor = 0
    while (anchor < points.length - 1) {
      let furthest = anchor + 1
      let originalUtilityClearance = Math.min(utilityClearances[anchor], utilityClearances[furthest])
      let originalTouchesWater = touchesWater[anchor] || touchesWater[furthest]
      while (furthest + 1 < points.length) {
        const candidateIndex = furthest + 1
        const candidate = points[candidateIndex]
        if (!segmentIsNavigable(points[anchor], candidate)) break
        const doesNotAddCrossings = crossingGroups.every((segments, groupIndex) =>
          edgeCrossings(points[anchor], candidate, segments)
            <= crossingPrefixes[groupIndex][candidateIndex] - crossingPrefixes[groupIndex][anchor],
        )
        if (!doesNotAddCrossings) break
        const nextOriginalUtilityClearance = Math.min(originalUtilityClearance, utilityClearances[candidateIndex])
        const candidateSampleCount = Math.max(2, Math.ceil(distance(points[anchor], candidate) / opt.gridSizeM))
        const candidateSamples = Array.from({ length: candidateSampleCount }, (_, index) => {
          const ratio = index / (candidateSampleCount - 1)
          return { x: points[anchor].x + (candidate.x - points[anchor].x) * ratio, y: points[anchor].y + (candidate.y - points[anchor].y) * ratio }
        })
        const candidateUtilityClearance = utilities.length > 0
          ? Math.min(...candidateSamples.map((point) => distanceToSegments(point, utilities)))
          : Number.POSITIVE_INFINITY
        if (candidateUtilityClearance + 1e-6 < Math.min(nextOriginalUtilityClearance, opt.utilityClearanceM)) break
        if (guides.length > 0) {
          const originalGuideMean = guideClearances.slice(anchor, candidateIndex + 1)
            .reduce((sum, value) => sum + value, 0) / (candidateIndex - anchor + 1)
          const candidateGuideMean = candidateSamples
            .reduce((sum, point) => sum + distanceToSegments(point, guides), 0) / candidateSamples.length
          if (candidateGuideMean > originalGuideMean + opt.gridSizeM * 0.25) break
        }
        if (survey.length > 0) {
          const originalUphill = surfaceElevations.slice(anchor, candidateIndex + 1).slice(1)
            .reduce((sum, value, index) => sum + Math.max(0, value - surfaceElevations[anchor + index]), 0)
          const candidateElevations = candidateSamples.map((point) => interpolateElevation(survey, point.x, point.y))
          const candidateUphill = candidateElevations.slice(1)
            .reduce((sum, value, index) => sum + Math.max(0, value - candidateElevations[index]), 0)
          if (candidateUphill > originalUphill + 0.1) break
        }
        const nextOriginalTouchesWater = originalTouchesWater || touchesWater[candidateIndex]
        const candidateTouchesWater = candidateSamples.some((point) => waterRings.some((ring) => pointInRing(point, ring)))
        if (candidateTouchesWater && !nextOriginalTouchesWater) break
        originalUtilityClearance = nextOriginalUtilityClearance
        originalTouchesWater = nextOriginalTouchesWater
        furthest++
      }
      result.push(points[furthest])
      anchor = furthest
    }
    return result
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const point = { x: minX + col * opt.gridSizeM, y: minY + row * opt.gridSizeM }
      if (!isNavigable(point)) continue
      if (hard.length > 0 && distanceToSegments(point, hard) < opt.gridSizeM * 0.55) continue
      if (hardRings.some((ring) => pointInRing(point, ring))) continue
      if (isForbiddenEnvironmentalPoint(point)) continue
      cells.set(key(col, row), {
        col, row, point,
        boundaryDistance: distanceToRings(point, rings),
        utilityDistance: utilities.length > 0 ? distanceToSegments(point, utilities) : Number.POSITIVE_INFINITY,
        guideDistance: guides.length > 0 ? distanceToSegments(point, guides) : 0,
        surfaceElevation: survey.length > 0 ? interpolateElevation(survey, point.x, point.y) : 0,
        insideWater: waterRings.some((ring) => pointInRing(point, ring)),
      })
    }
  }
  if (cells.size === 0) return empty('Инженерный коридор уже шага расчётной сетки или имеет некорректную геометрию.')

  const nearestCell = (point: RoutePoint): { cell: GridCell; distanceM: number } => {
    let best: GridCell | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (const cell of cells.values()) {
      const d = distance(point, cell.point)
      if (d < bestDistance) { best = cell; bestDistance = d }
    }
    return { cell: best as GridCell, distanceM: bestDistance }
  }

  const sourceMatch = nearestCell(source)
  if (sourceMatch.distanceM > opt.corridorSnapToleranceM) {
    return empty(`Выпуск находится в ${Math.round(sourceMatch.distanceM)} м от инженерного коридора; требуется корректная система координат или коридор.`)
  }
  const sourceCell = sourceMatch.cell
  if (sourceMatch.distanceM > 1e-6 && !segmentIsNavigable(source, sourceCell.point)) {
    return empty('Выпуск невозможно соединить с инженерным коридором без пересечения запретной зоны или выхода за допустимую область.')
  }
  const tree = new Set<string>([key(sourceCell.col, sourceCell.row)])
  const treeEdges = new Map<string, [RoutePoint, RoutePoint]>()
  const terminalCellById = new Map<string, string>()
  const paths: Array<{ terminalId: string; points: RoutePoint[] }> = []
  const unrouted: string[] = []
  const terminalOrder = [...terminals].sort((a, b) => distance(a, source) - distance(b, source))
  const directions = [
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
  ] as const

  for (const terminal of terminalOrder) {
    const startMatch = nearestCell(terminal)
    if (startMatch.distanceM > opt.corridorSnapToleranceM) {
      unrouted.push(terminal.id)
      continue
    }
    const start = startMatch.cell
    if (startMatch.distanceM > 1e-6 && !segmentIsNavigable(terminal, start.point)) {
      unrouted.push(terminal.id)
      continue
    }
    const startKey = key(start.col, start.row)
    const open = new Set<string>([startKey])
    const cameFrom = new Map<string, string>()
    const gScore = new Map<string, number>([[startKey, 0]])
    const heading = new Map<string, string>()
    let reached: string | null = tree.has(startKey) ? startKey : null

    while (open.size > 0 && !reached) {
      let current = ''
      let currentScore = Number.POSITIVE_INFINITY
      for (const candidate of open) {
        const cell = cells.get(candidate) as GridCell
        let heuristic = Number.POSITIVE_INFINITY
        for (const treeKey of tree) heuristic = Math.min(heuristic, distance(cell.point, (cells.get(treeKey) as GridCell).point))
        const score = (gScore.get(candidate) ?? Number.POSITIVE_INFINITY) + heuristic / opt.gridSizeM
        if (score < currentScore) { current = candidate; currentScore = score }
      }
      open.delete(current)
      const cell = cells.get(current) as GridCell
      for (const [dx, dy] of directions) {
        const nextKey = key(cell.col + dx, cell.row + dy)
        const next = cells.get(nextKey)
        if (!next) continue
        const edgeInside = [0.25, 0.5, 0.75].every((ratio) => isNavigable({
          x: cell.point.x + (next.point.x - cell.point.x) * ratio,
          y: cell.point.y + (next.point.y - cell.point.y) * ratio,
        }))
        if (!edgeInside) continue
        const direction = `${dx},${dy}`
        const step = Math.hypot(dx, dy)
        const boundaryCost = opt.boundaryPenalty / Math.max(next.boundaryDistance, opt.gridSizeM * 0.25)
        const utilityCost = next.utilityDistance < opt.utilityClearanceM ? opt.utilityCrossingPenalty : 0
        const crossingCost = edgeCrossings(cell.point, next.point, utilities) * opt.utilityCrossingPenalty
          + edgeCrossings(cell.point, next.point, redLines) * opt.redLineCrossingPenalty
          + edgeCrossings(cell.point, next.point, roads) * opt.roadCrossingPenalty
          + edgeCrossings(cell.point, next.point, water) * opt.waterCrossingPenalty
        const midpoint = { x: (cell.point.x + next.point.x) / 2, y: (cell.point.y + next.point.y) / 2 }
        const inApprovedCrossing = approvedCrossings.some((ring) => pointInRing(midpoint, ring))
        const waterEdgeCrossings = edgeCrossings(cell.point, next.point, water)
        if (opt.requireApprovedWaterCrossings && waterEdgeCrossings > 0 && !inApprovedCrossing) continue
        const guideCost = guides.length > 0
          ? Math.min(1, next.guideDistance / Math.max(1, opt.guideAttractionM)) * opt.guideDistancePenalty
          : 0
        const waterInteriorCost = next.insideWater ? opt.waterInteriorPenalty : 0
        // Search direction is terminal -> outlet/tree. A rising surface in
        // that direction normally increases excavation depth for a gravity
        // collector, so prefer naturally descending terrain when alternatives
        // exist inside the same approved corridor.
        const uphillCost = Math.max(0, next.surfaceElevation - cell.surfaceElevation) * opt.uphillPenaltyPerM
        const turnCost = heading.get(current) && heading.get(current) !== direction ? opt.turnPenalty : 0
        const tentative = (gScore.get(current) ?? 0) + step + boundaryCost + utilityCost
          + crossingCost + guideCost + waterInteriorCost + uphillCost + turnCost
        if (tentative >= (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue
        cameFrom.set(nextKey, current)
        gScore.set(nextKey, tentative)
        heading.set(nextKey, direction)
        if (tree.has(nextKey)) { reached = nextKey; break }
        open.add(nextKey)
      }
    }

    if (!reached) { unrouted.push(terminal.id); continue }
    const gridPath: RoutePoint[] = []
    let cursor = reached
    gridPath.push((cells.get(cursor) as GridCell).point)
    while (cursor !== startKey) {
      const previous = cameFrom.get(cursor)
      if (!previous) break
      cursor = previous
      gridPath.push((cells.get(cursor) as GridCell).point)
    }
    gridPath.reverse()
    const path = [terminal, ...simplifyNavigablePath(gridPath), ...(tree.size === 1 ? [source] : [])]
    paths.push({ terminalId: terminal.id, points: path })
    terminalCellById.set(terminal.id, startKey)
    for (let i = 1; i < gridPath.length; i++) {
      const a = gridPath[i - 1]
      const b = gridPath[i]
      const aKey = key(Math.round((a.x - minX) / opt.gridSizeM), Math.round((a.y - minY) / opt.gridSizeM))
      const bKey = key(Math.round((b.x - minX) / opt.gridSizeM), Math.round((b.y - minY) / opt.gridSizeM))
      tree.add(aKey); tree.add(bKey)
      const edgeKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
      treeEdges.set(edgeKey, [a, b])
    }
  }

  if (survey.length === 0) warnings.push('Нет высотных отметок топосъёмки: план построен, но продольный профиль и глубины требуют исходных данных.')
  const elevation = (point: RoutePoint) => interpolateElevation(survey, point.x, point.y)
  const routeDecision = (a: RoutePoint, b: RoutePoint, choice: 'main' | 'facility-lead' | 'outlet-lead') => {
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    return [
      'derived:constrained-route',
      `choice=${choice}`,
      'search=deterministic-a-star',
      'corridor=validated',
      `guideDistanceM=${guides.length ? round2(distanceToSegments(midpoint, guides)) : 'none'}`,
      `utilityCrossings=${edgeCrossings(a, b, utilities)}`,
      `roadCrossings=${edgeCrossings(a, b, roads)}`,
      `redLineCrossings=${edgeCrossings(a, b, redLines)}`,
      `waterCrossings=${edgeCrossings(a, b, water)}`,
      `surfaceDeltaM=${survey.length ? round2(elevation(b) - elevation(a)) : 'unknown'}`,
      'simplification=revalidated',
    ].join('|')
  }
  const nodes: NetworkNode[] = [{ id: 'SRC', kind: 'source', x: round2(source.x), y: round2(source.y), groundElevation: elevation(source) }]
  const pipes: NetworkPipe[] = []
  const nodeIdByCoord = new Map<string, string>()
  const coordKey = (point: RoutePoint) => `${round2(point.x)},${round2(point.y)}`
  const getNode = (point: RoutePoint): string => {
    const coordinate = coordKey(point)
    const found = nodeIdByCoord.get(coordinate)
    if (found) return found
    const id = `J${nodeIdByCoord.size + 1}`
    nodeIdByCoord.set(coordinate, id)
    nodes.push({ id, kind: 'junction', x: round2(point.x), y: round2(point.y), groundElevation: elevation(point) })
    return id
  }
  const alignmentForNodes = (fromNode: string, toNode: string): [RoutePoint, RoutePoint] => {
    const from = nodes.find((node) => node.id === fromNode)
    const to = nodes.find((node) => node.id === toNode)
    if (!from || !to) throw new Error(`Network alignment references missing nodes: ${fromNode} -> ${toNode}`)
    return [{ x: from.x, y: from.y }, { x: to.x, y: to.y }]
  }
  let pipeSeq = 0

  // Collapse the raster tree into engineering sections. A 15 m search cell is
  // not a manhole. First split at real topological junctions, then retain only
  // the bends needed to keep each displayed chord inside the DWG corridor.
  const adjacency = new Map<string, Set<string>>()
  const pointByKey = new Map<string, RoutePoint>()
  const addNeighbour = (from: string, to: string) => {
    if (!adjacency.has(from)) adjacency.set(from, new Set())
    adjacency.get(from)!.add(to)
  }
  for (const [a, b] of treeEdges.values()) {
    const aKey = key(Math.round((a.x - minX) / opt.gridSizeM), Math.round((a.y - minY) / opt.gridSizeM))
    const bKey = key(Math.round((b.x - minX) / opt.gridSizeM), Math.round((b.y - minY) / opt.gridSizeM))
    pointByKey.set(aKey, a)
    pointByKey.set(bKey, b)
    addNeighbour(aKey, bKey)
    addNeighbour(bKey, aKey)
  }
  const sourceKey = key(sourceCell.col, sourceCell.row)
  pointByKey.set(sourceKey, sourceCell.point)
  const anchors = new Set<string>([sourceKey, ...terminalCellById.values()])
  for (const [cellKey, neighbours] of adjacency) {
    if (neighbours.size !== 2) anchors.add(cellKey)
  }
  const visitedEdges = new Set<string>()
  const edgeId = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`
  for (const anchor of anchors) {
    for (const neighbour of adjacency.get(anchor) ?? []) {
      if (visitedEdges.has(edgeId(anchor, neighbour))) continue
      let previous = anchor
      let current = neighbour
      const chain = [pointByKey.get(previous)!, pointByKey.get(current)!]
      visitedEdges.add(edgeId(previous, current))
      while (!anchors.has(current)) {
        const next = [...(adjacency.get(current) ?? [])].find((candidate) => candidate !== previous)
        if (!next) break
        previous = current
        current = next
        visitedEdges.add(edgeId(previous, current))
        chain.push(pointByKey.get(current)!)
      }
      const engineeringPoints = simplifyNavigablePath(chain)
      for (let index = 1; index < engineeringPoints.length; index++) {
        const from = getNode(engineeringPoints[index - 1])
        const to = getNode(engineeringPoints[index])
        const alignment = alignmentForNodes(from, to)
        pipes.push({
          id: `P${++pipeSeq}`,
          kind: 'main',
          fromNode: from,
          toNode: to,
          lengthM: round2(distance(alignment[0], alignment[1])),
          alignment,
          dataSource: routeDecision(engineeringPoints[index - 1], engineeringPoints[index], 'main'),
        })
      }
    }
  }
  const sourceJunction = getNode(sourceCell.point)
  const sourceAlignment = alignmentForNodes(sourceJunction, 'SRC')
  pipes.push({ id: `P${++pipeSeq}`, kind: 'supply', fromNode: sourceJunction, toNode: 'SRC', lengthM: round2(distance(sourceAlignment[0], sourceAlignment[1])), alignment: sourceAlignment, dataSource: routeDecision(sourceCell.point, source, 'outlet-lead') })
  for (const terminal of terminals) {
    const terminalCell = terminalCellById.get(terminal.id)
    if (!terminalCell) continue
    const firstGridPoint = pointByKey.get(terminalCell) ?? sourceCell.point
    const buildingNodeId = `B${nodes.filter((node) => node.kind === 'building').length + 1}`
    nodes.push({ id: buildingNodeId, kind: 'building', x: round2(terminal.x), y: round2(terminal.y), groundElevation: elevation(terminal), buildingId: terminal.buildingId ?? terminal.id })
    const firstGridNodeId = getNode(firstGridPoint)
    const serviceAlignment = alignmentForNodes(buildingNodeId, firstGridNodeId)
    pipes.push({ id: `P${++pipeSeq}`, kind: 'service', fromNode: buildingNodeId, toNode: firstGridNodeId, lengthM: round2(distance(serviceAlignment[0], serviceAlignment[1])), alignment: serviceAlignment, dataSource: routeDecision(terminal, firstGridPoint, 'facility-lead') })
  }

  const redLineCrossings = paths.reduce((sum, path) => sum + countCrossings(path.points, redLines), 0)
  const utilityCrossings = paths.reduce((sum, path) => sum + countCrossings(path.points, utilities), 0)
  const roadCrossings = paths.reduce((sum, path) => sum + countCrossings(path.points, roads), 0)
  const waterCrossings = paths.reduce((sum, path) => sum + countCrossings(path.points, water), 0)
  const outsideCorridorSegments = paths.reduce((sum, path) => sum + path.points.slice(1).filter((point, index) => {
    const previous = path.points[index]
    // Endpoint leads connect an OS/outlet situated on the corridor boundary;
    // the corridor check applies to the designed collector between those leads.
    if (index === 0 || distance(point, source) < 1e-6 || distance(previous, source) < 1e-6) return false
    return !segmentIsNavigable(previous, point)
  }).length, 0)
  if (unrouted.length > 0) warnings.push(`Не проложены подключения: ${unrouted.join(', ')}.`)
  if (utilityCrossings > 0) warnings.push(`Пересечения существующих коммуникаций: ${utilityCrossings}; требуется высотная проверка.`)
  if (redLineCrossings > 0) warnings.push(`Пересечения красных линий: ${redLineCrossings}; требуется согласование.`)
  if (waterCrossings > 0) warnings.push(`Пересечения водных объектов: ${waterCrossings}; требуется отдельное решение перехода.`)
  if (outsideCorridorSegments > 0) warnings.push(`Участки вне инженерного коридора: ${outsideCorridorSegments}; требуется корректировка исходных точек или границы.`)
  const totalLengthM = round2(pipes.reduce((sum, pipe) => sum + pipe.lengthM, 0))
  return {
    network: { nodes, pipes, totalLengthM }, paths,
    report: {
      ok: unrouted.length === 0,
      gridSizeM: opt.gridSizeM,
      evaluatedCells: cells.size,
      routedTerminals: paths.length,
      unroutedTerminals: unrouted,
      redLineCrossings,
      utilityCrossings,
      roadCrossings,
      waterCrossings,
      outsideCorridorSegments,
      warnings,
    },
  }
}
