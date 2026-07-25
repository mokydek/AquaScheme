import type { SurveyPoint } from './types'
import { interpolateElevation } from './trace'
import type { NetworkNode, NetworkPipe, TracedNetwork } from './trace'

export interface RoutePoint { x: number; y: number }
export interface RouteSegment { points: RoutePoint[]; layer?: string }
export interface RouteTerminal extends RoutePoint { id: string; buildingId?: string }

export interface RouteConstraintInput {
  corridorRings: RoutePoint[][]
  redLines?: RouteSegment[]
  utilityLines?: RouteSegment[]
  roadLines?: RouteSegment[]
  waterLines?: RouteSegment[]
  /** Closed water boundaries. They remain passable only as a last resort. */
  waterRings?: RoutePoint[][]
  hardObstacles?: RouteSegment[]
  surveyPoints?: SurveyPoint[]
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
  corridorSnapToleranceM?: number
  maxGridCells?: number
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
  meanDeviationM: number
  maximumDeviationM: number
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
  corridorSnapToleranceM: 50,
  maxGridCells: 450_000,
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
  return ((c1 > 0 && c2 < 0) || (c1 < 0 && c2 > 0))
    && ((c3 > 0 && c4 < 0) || (c3 < 0 && c4 > 0))
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
  const samples: RoutePoint[] = []
  for (let index = 1; index < reference.length; index++) {
    const a = reference[index - 1]
    const b = reference[index]
    const count = Math.max(1, Math.ceil(distance(a, b) / sampleStepM))
    for (let step = 0; step < count; step++) {
      const ratio = step / count
      samples.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio })
    }
  }
  if (reference.length > 0) samples.push(reference[reference.length - 1])
  if (samples.length === 0 || routeSegments.length === 0) {
    return { referenceCoveragePct: 0, meanDeviationM: Number.POSITIVE_INFINITY, maximumDeviationM: Number.POSITIVE_INFINITY, sampledPoints: samples.length }
  }
  const deviations = samples.map((point) =>
    Math.min(...routeSegments.map(([a, b]) => pointSegmentDistance(point, a, b))),
  )
  return {
    referenceCoveragePct: round2(100 * deviations.filter((value) => value <= toleranceM).length / deviations.length),
    meanDeviationM: round2(deviations.reduce((sum, value) => sum + value, 0) / deviations.length),
    maximumDeviationM: round2(Math.max(...deviations)),
    sampledPoints: samples.length,
  }
}

interface GridCell {
  col: number
  row: number
  point: RoutePoint
  boundaryDistance: number
  utilityDistance: number
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
  const redLines = constraints.redLines ?? []
  const roads = constraints.roadLines ?? []
  const water = constraints.waterLines ?? []
  const waterRings = (constraints.waterRings ?? []).filter((ring) => ring.length >= 3)
  const hard = constraints.hardObstacles ?? []
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
  const segmentIsNavigable = (a: RoutePoint, b: RoutePoint) => {
    const samples = Math.max(1, Math.ceil(distance(a, b) / (opt.gridSizeM * 0.5)))
    for (let sample = 1; sample < samples; sample++) {
      const ratio = sample / samples
      if (!isNavigable({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio })) return false
    }
    return true
  }
  const simplifyNavigablePath = (points: RoutePoint[]) => {
    if (points.length < 3) return points
    const result = [points[0]]
    let anchor = 0
    while (anchor < points.length - 1) {
      let furthest = anchor + 1
      while (furthest + 1 < points.length && segmentIsNavigable(points[anchor], points[furthest + 1])) furthest++
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
      cells.set(key(col, row), {
        col, row, point,
        boundaryDistance: distanceToRings(point, rings),
        utilityDistance: utilities.length > 0 ? distanceToSegments(point, utilities) : Number.POSITIVE_INFINITY,
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
        const waterInteriorCost = next.insideWater ? opt.waterInteriorPenalty : 0
        // Search direction is terminal -> outlet/tree. A rising surface in
        // that direction normally increases excavation depth for a gravity
        // collector, so prefer naturally descending terrain when alternatives
        // exist inside the same approved corridor.
        const uphillCost = Math.max(0, next.surfaceElevation - cell.surfaceElevation) * opt.uphillPenaltyPerM
        const turnCost = heading.get(current) && heading.get(current) !== direction ? opt.turnPenalty : 0
        const tentative = (gScore.get(current) ?? 0) + step + boundaryCost + utilityCost
          + crossingCost + waterInteriorCost + uphillCost + turnCost
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
        pipes.push({ id: `P${++pipeSeq}`, kind: 'main', fromNode: from, toNode: to, lengthM: round2(distance(engineeringPoints[index - 1], engineeringPoints[index])) })
      }
    }
  }
  const sourceJunction = getNode(sourceCell.point)
  pipes.push({ id: `P${++pipeSeq}`, kind: 'supply', fromNode: sourceJunction, toNode: 'SRC', lengthM: round2(distance(sourceCell.point, source)) })
  for (const terminal of terminals) {
    const terminalCell = terminalCellById.get(terminal.id)
    if (!terminalCell) continue
    const firstGridPoint = pointByKey.get(terminalCell) ?? sourceCell.point
    const buildingNodeId = `B${nodes.filter((node) => node.kind === 'building').length + 1}`
    nodes.push({ id: buildingNodeId, kind: 'building', x: round2(terminal.x), y: round2(terminal.y), groundElevation: elevation(terminal), buildingId: terminal.buildingId ?? terminal.id })
    pipes.push({ id: `P${++pipeSeq}`, kind: 'service', fromNode: buildingNodeId, toNode: getNode(firstGridPoint), lengthM: round2(distance(terminal, firstGridPoint)) })
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
