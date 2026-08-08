import type { SurveyPoint } from './types'

/**
 * Automatic routing of the outdoor water network.
 *
 * SP RK 4.01-101-2012 requires looped mains for settlement networks; dead
 * ends are allowed only for minor branches, which is exactly what building
 * service connections are. The produced layout:
 *
 *  - a looped ring main around the development: the convex hull of the
 *    buildings, offset outward (the street side), densified with junction
 *    nodes so hydrants and valves can be placed along it later;
 *  - an internal cross main when inner buildings are too far from the ring
 *    (routed along a street gap between building rows), which turns the
 *    single loop into a meshed two loop scheme;
 *  - a supply main from the source to the nearest ring node;
 *  - a dead end service connection from the nearest main node to every
 *    building.
 *
 * Node ground elevations are interpolated from the survey (inverse distance
 * weighting over the nearest points), so profiles and hydraulics see the
 * terrain. The function is pure and fully deterministic.
 */

export interface TraceBuildingInput {
  id: string
  x: number
  y: number
}

export interface TraceSourceInput {
  x: number
  y: number
}

export interface TraceOptions {
  /** Outward offset of the ring from the building hull, m. */
  ringOffsetM?: number
  /** Maximum spacing between ring junction nodes, m. */
  maxRingSpacingM?: number
  /** Add a cross main when a building is farther than this from the mains, m. */
  crossThresholdM?: number
}

/**
 * Persisted engineering node types.
 *
 * The first five values are retained for water-network compatibility.  Sewer
 * and storm projects must use the explicit engineering values: in particular
 * a facility inflow, an LNS and an outlet are not interchangeable generic
 * "junctions".
 */
export type NetworkNodeKind =
  | 'source'
  | 'ring'
  | 'cross'
  | 'junction'
  | 'building'
  | 'facility_inflow'
  | 'lns_inlet'
  | 'lns_outlet'
  | 'outlet'
  | 'manhole'
  | 'terrain_break'
  | 'treatment_facility'
  | 'pumping_station'
  | 'gravity_inlet'
  | 'pressure_outlet'
  | 'chamber'
  | 'outfall'
  | 'crossing'
  | 'transition'
  | 'inspection_node'

/** Explicit hydraulic purpose of a persisted pipe section. */
export type NetworkPipeKind =
  | 'supply'
  | 'ring'
  | 'cross'
  | 'main'
  | 'service'
  | 'gravity_collector'
  | 'inlet'
  | 'pressure_main'
  | 'discharge'
  | 'casing'
  | 'existing'
  | 'tentative'
  | 'gravity_main'
  | 'parallel_pressure_main'
  | 'facility_connection'
  | 'crossing_section'
  | 'temporary_or_optional'

export type HydraulicSystemType = 'gravity' | 'pressure' | 'non_hydraulic'

export interface NetworkCoordinate {
  x: number
  y: number
}

export interface NetworkNode {
  id: string
  kind: NetworkNodeKind
  label?: string
  x: number
  y: number
  groundElevation: number
  /**
   * Отметка земли не определена, а поле заполнено нулём.
   *
   * Ноль — законная отметка (уровень моря), поэтому «не определено» нельзя
   * выразить значением: только отдельным признаком. Без него профиль по
   * ул. Станкевича считал уклон местности, нехватку падения и глубину
   * заложения от нулевой земли — и каждое из этих чисел было ложью,
   * неотличимой от расчёта.
   *
   * Ставится там, где съёмки нет или узел лежит за её контуром.
   */
  groundElevationMissing?: boolean
  buildingId?: string
  /** Design inflow entering the system at this node, L/s. */
  designFlowLps?: number
  invertElevationM?: number
  systemType?: HydraulicSystemType
  sourceEntity?: string
  dataSource?: string
}

export interface NetworkPipe {
  id: string
  kind: NetworkPipeKind
  fromNode: string
  toNode: string
  lengthM: number
  diameterMm?: number
  material?: string
  parallelCount?: number
  systemType?: HydraulicSystemType
  /** Full plan alignment. Straight endpoints are used when omitted. */
  alignment?: NetworkCoordinate[]
  sourceLayer?: string
  sourceEntity?: string
  flowDirection?: 'from_to' | 'to_from' | 'unknown'
  innerDiameterMm?: number
  sdr?: number
  sn?: number
  pn?: number
  roughnessMm?: number
  slope?: number
  startInvertM?: number
  endInvertM?: number
  coverM?: number
  designFlowLps?: number
  velocityMs?: number
  fillingRatio?: number
  pressureM?: number
  calculationStatus?: 'unverified' | 'preliminary' | 'calculated' | 'blocked'
  dataSource?: string
}

export interface TracedNetwork {
  nodes: NetworkNode[]
  pipes: NetworkPipe[]
  totalLengthM: number
}

const DEFAULT_OPTIONS: Required<TraceOptions> = {
  ringOffsetM: 15,
  maxRingSpacingM: 110,
  crossThresholdM: 60,
}

interface Point {
  x: number
  y: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function nearest<T extends Point>(candidates: T[], target: Point): T {
  let best = candidates[0]
  let bestD = Number.POSITIVE_INFINITY
  for (const c of candidates) {
    const d = dist(c, target)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/**
 * Ground elevation at (x, y): inverse distance weighting over the k nearest
 * survey points. Returns the exact z when the point coincides with a survey
 * point; 0 when there is no survey at all.
 */
/**
 * Отметка поверхности в точке по ближайшим точкам съёмки.
 *
 * Возвращает `null`, когда съёмки нет вовсе. Раньше здесь стоял `return 0`, и
 * это была тихая подстановка худшего рода: ноль неотличим от вычисленной
 * отметки, а дальше по конвейеру от него считались уклон местности, нехватка
 * падения и глубина заложения — три числа, каждое из которых ложь. На проекте
 * по ул. Станкевича профиль так и рисовал «Земля 0.00» у всех колодцев при
 * четырнадцати точках съёмки с отметками 685…688 м в том же проекте.
 *
 * Ноль как отметка — величина законная (уровень моря), поэтому отличить
 * «не определено» от «ровно ноль» можно только типом, а не значением.
 */
export function interpolateElevation(points: SurveyPoint[], x: number, y: number, k = 4): number | null {
  if (points.length === 0) return null
  const limit = Math.max(1, k)
  const ranked: Array<{ p: SurveyPoint; d2: number }> = []
  // Keep only the k nearest candidates while scanning. Sorting all 3–5k
  // survey points for every routing grid cell made a full DWG calculation
  // take more than a minute; this produces the same stable nearest set in
  // O(n·k), with k=4 by default.
  for (const p of points) {
    const candidate = { p, d2: (p.x - x) ** 2 + (p.y - y) ** 2 }
    if (ranked.length === limit && candidate.d2 >= ranked[ranked.length - 1].d2) continue
    const insertion = ranked.findIndex((item) => item.d2 > candidate.d2)
    ranked.splice(insertion < 0 ? ranked.length : insertion, 0, candidate)
    if (ranked.length > limit) ranked.pop()
  }
  if (ranked[0].d2 < 1e-6) return ranked[0].p.z
  let num = 0
  let den = 0
  for (const { p, d2 } of ranked) {
    const w = 1 / d2
    num += w * p.z
    den += w
  }
  return round2(num / den)
}

/**
 * Накрывает ли съёмка точку.
 *
 * Обратно-взвешенное расстояние даёт число где угодно — хоть в километре от
 * крайней точки съёмки, — и это число выглядит как отметка. Поэтому запрос вне
 * контура съёмки обязан получать отказ, а не экстраполяцию: за контуром
 * поверхности нет, и «примерно 686» там значит «неизвестно».
 *
 * Контур — выпуклая оболочка точек, тот же приём, что и у покрытия трассы
 * геологией.
 */
export function surveyCovers(points: SurveyPoint[], x: number, y: number): boolean {
  if (points.length < 3) return false
  const hull = convexHull(points.map((point) => ({ x: point.x, y: point.y })))
  if (hull.length < 3) return false
  // Точка внутри выпуклого контура, если она с одной стороны от всех рёбер.
  let sign = 0
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)
    if (Math.abs(cross) < 1e-9) continue
    const current = cross > 0 ? 1 : -1
    if (sign === 0) sign = current
    else if (sign !== current) return false
  }
  return true
}

/**
 * Отметка поверхности только там, где съёмка её действительно описывает.
 *
 * Именно эту функцию следует звать, назначая отметку узлу сети: она отвечает
 * `null` и на отсутствие съёмки, и на точку за её контуром.
 */
export function elevationWithinSurvey(points: SurveyPoint[], x: number, y: number): number | null {
  if (!surveyCovers(points, x, y)) return null
  return interpolateElevation(points, x, y)
}

/** Andrew's monotone chain; returns the hull counterclockwise. */
function convexHull(input: Point[]): Point[] {
  const points = [...input].sort((a, b) => a.x - b.x || a.y - b.y)
  if (points.length <= 2) return points
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

/**
 * Y coordinate for the internal cross main: the middle of the widest street
 * gap between building rows nearest to the centroid, so the main does not
 * run through buildings.
 */
function crossLineY(buildings: Point[], centroidY: number): number {
  const ys = [...new Set(buildings.map((b) => Math.round(b.y)))].sort((a, b) => a - b)
  if (ys.length < 2) return centroidY
  let bestMid = centroidY
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < ys.length - 1; i++) {
    const gap = ys[i + 1] - ys[i]
    if (gap < 20) continue
    const mid = (ys[i] + ys[i + 1]) / 2
    const d = Math.abs(mid - centroidY)
    if (d < bestDist) {
      bestDist = d
      bestMid = mid
    }
  }
  return bestMid
}

export function traceNetwork(
  buildings: TraceBuildingInput[],
  source: TraceSourceInput,
  surveyPoints: SurveyPoint[],
  options: TraceOptions = {},
): TracedNetwork {
  const opt = { ...DEFAULT_OPTIONS, ...options }
  const nodes: NetworkNode[] = []
  const pipes: NetworkPipe[] = []
  /** Отметка узла и признак «не определена»: ноль здесь заполнитель, не значение. */
  const ground = (x: number, y: number) => {
    const found = elevationWithinSurvey(surveyPoints, x, y)
    return found === null
      ? { groundElevation: 0, groundElevationMissing: true }
      : { groundElevation: found }
  }
  const elevation = (x: number, y: number) => elevationWithinSurvey(surveyPoints, x, y) ?? 0

  let pipeSeq = 0
  const addPipe = (kind: NetworkPipeKind, from: NetworkNode, to: NetworkNode) => {
    pipeSeq++
    pipes.push({ id: `P${pipeSeq}`, kind, fromNode: from.id, toNode: to.id, lengthM: round2(dist(from, to)) })
  }
  const finish = (): TracedNetwork => ({
    nodes,
    pipes,
    totalLengthM: round2(pipes.reduce((sum, p) => sum + p.lengthM, 0)),
  })

  const sourceNode: NetworkNode = {
    id: 'SRC',
    kind: 'source',
    x: round2(source.x),
    y: round2(source.y),
    ...ground(source.x, source.y),
  }
  nodes.push(sourceNode)

  const buildingNodes: NetworkNode[] = buildings.map((b, i) => ({
    id: `B${i + 1}`,
    kind: 'building',
    x: round2(b.x),
    y: round2(b.y),
    ...ground(b.x, b.y),
    buildingId: b.id,
  }))

  if (buildings.length === 0) return finish()

  if (buildings.length < 3) {
    // Too few consumers for a loop: dead end mains straight from the source.
    for (const bNode of buildingNodes) {
      nodes.push(bNode)
      addPipe('supply', sourceNode, bNode)
    }
    return finish()
  }

  // 1. Ring main around the development.
  const hull = convexHull(buildings)
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length
  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length
  const ringVertices = hull.map((v) => {
    const dx = v.x - cx
    const dy = v.y - cy
    const len = Math.hypot(dx, dy) || 1
    return { x: v.x + (dx / len) * opt.ringOffsetM, y: v.y + (dy / len) * opt.ringOffsetM }
  })

  const ringPoints: Point[] = []
  for (let i = 0; i < ringVertices.length; i++) {
    const a = ringVertices[i]
    const b = ringVertices[(i + 1) % ringVertices.length]
    const segments = Math.max(1, Math.ceil(dist(a, b) / opt.maxRingSpacingM))
    for (let s = 0; s < segments; s++) {
      ringPoints.push({
        x: a.x + ((b.x - a.x) * s) / segments,
        y: a.y + ((b.y - a.y) * s) / segments,
      })
    }
  }

  // Number ring nodes starting from the one nearest to the source.
  let startIndex = 0
  let bestD = Number.POSITIVE_INFINITY
  ringPoints.forEach((p, i) => {
    const d = dist(p, source)
    if (d < bestD) {
      bestD = d
      startIndex = i
    }
  })
  const orderedRing = [...ringPoints.slice(startIndex), ...ringPoints.slice(0, startIndex)]
  const ringNodes: NetworkNode[] = orderedRing.map((p, i) => ({
    id: `R${i + 1}`,
    kind: 'ring',
    x: round2(p.x),
    y: round2(p.y),
    groundElevation: elevation(p.x, p.y),
  }))
  nodes.push(...ringNodes)
  for (let i = 0; i < ringNodes.length; i++) {
    addPipe('ring', ringNodes[i], ringNodes[(i + 1) % ringNodes.length])
  }

  // 2. Supply main from the source.
  addPipe('supply', sourceNode, ringNodes[0])

  // 3. Cross main when inner buildings are far from the ring.
  const mains: NetworkNode[] = [...ringNodes]
  const needsCross = buildings.some((b) => dist(nearest(mains, b), b) > opt.crossThresholdM)
  if (needsCross) {
    const y0 = crossLineY(buildings, cy)
    const minX = Math.min(...ringNodes.map((n) => n.x))
    const maxX = Math.max(...ringNodes.map((n) => n.x))
    const west = nearest(ringNodes, { x: minX, y: y0 })
    const east = nearest(ringNodes, { x: maxX, y: y0 })
    if (west.id !== east.id) {
      const segments = Math.max(1, Math.ceil(dist(west, east) / opt.maxRingSpacingM))
      let prev: NetworkNode = west
      for (let s = 1; s < segments; s++) {
        const node: NetworkNode = {
          id: `C${s}`,
          kind: 'cross',
          x: round2(west.x + ((east.x - west.x) * s) / segments),
          y: round2(west.y + ((east.y - west.y) * s) / segments),
          groundElevation: 0,
        }
        Object.assign(node, ground(node.x, node.y))
        nodes.push(node)
        mains.push(node)
        addPipe('cross', prev, node)
        prev = node
      }
      addPipe('cross', prev, east)
    }
  }

  // 4. Service connection to every building.
  for (const bNode of buildingNodes) {
    nodes.push(bNode)
    addPipe('service', nearest(mains, bNode), bNode)
  }

  return finish()
}
