import type {
  RouteConstraintInput,
  SewerSchedule,
  TracedNetwork,
  WorkingDrawingSet,
  WorkingDrawingSheet,
} from '@aquascheme/engine'

export interface PlanPipeDesign {
  diameterMm: number
  slope?: number
  lengthM?: number
  flowLps?: number
  velocityMs?: number
  fillRatio?: number
}

export interface PlanScenePoint {
  x: number
  y: number
}

export interface PlanScenePathPoint extends PlanScenePoint {
  chainageM: number
}

export interface PlanScenePipe {
  pipeId: string
  fragments: PlanScenePoint[][]
  active: boolean
  diameterMm?: number
  slope?: number
  lengthM?: number
  labelPoint: PlanScenePoint
  labelAngleDeg: number
  label: string
}

export interface PlanSceneNode extends PlanScenePoint {
  id: string
  kind: string
  label: string
}

export interface PlanSceneStation extends PlanScenePathPoint {
  label: string
  boundary: boolean
}

export interface PlanSheetScene {
  sourcePath: PlanScenePathPoint[]
  selectedPath: PlanScenePathPoint[]
  pipes: PlanScenePipe[]
  nodes: PlanSceneNode[]
  stations: PlanSceneStation[]
  contextFeatureCount: number
  hasPlanContext: boolean
}

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

function pointAt(path: PlanScenePathPoint[], chainageM: number): PlanScenePathPoint {
  if (path.length === 0) return { x: 0, y: 0, chainageM }
  if (chainageM <= path[0].chainageM) return { ...path[0], chainageM }
  for (let index = 1; index < path.length; index++) {
    const b = path[index]
    if (b.chainageM < chainageM) continue
    const a = path[index - 1]
    const ratio = (chainageM - a.chainageM) / Math.max(b.chainageM - a.chainageM, 1e-9)
    return {
      x: a.x + (b.x - a.x) * ratio,
      y: a.y + (b.y - a.y) * ratio,
      chainageM,
    }
  }
  return { ...path[path.length - 1], chainageM }
}

export function planPathSlice(
  path: PlanScenePathPoint[],
  fromM: number,
  toM: number,
): PlanScenePathPoint[] {
  return [
    pointAt(path, fromM),
    ...path.filter((point) => point.chainageM > fromM && point.chainageM < toM),
    pointAt(path, toM),
  ]
}

export function formatPlanPicket(chainageM: number): string {
  const pk = Math.floor(chainageM / 100)
  const rest = Math.round((chainageM - pk * 100) * 100) / 100
  return rest === 0 ? `ПК${pk}` : `ПК${pk}+${rest}`
}

function clipSegment(
  a: PlanScenePoint,
  b: PlanScenePoint,
  bounds: Bounds,
): [PlanScenePoint, PlanScenePoint] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  const tests: Array<[number, number]> = [
    [-dx, a.x - bounds.minX],
    [dx, bounds.maxX - a.x],
    [-dy, a.y - bounds.minY],
    [dy, bounds.maxY - a.y],
  ]
  for (const [p, q] of tests) {
    if (Math.abs(p) <= 1e-12) {
      if (q < 0) return null
      continue
    }
    const ratio = q / p
    if (p < 0) t0 = Math.max(t0, ratio)
    else t1 = Math.min(t1, ratio)
    if (t0 > t1) return null
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ]
}

export function clipPlanPolyline(points: PlanScenePoint[], bounds: Bounds): PlanScenePoint[][] {
  const fragments: PlanScenePoint[][] = []
  let current: PlanScenePoint[] = []
  for (let index = 1; index < points.length; index++) {
    const clipped = clipSegment(points[index - 1], points[index], bounds)
    if (!clipped) {
      if (current.length > 1) fragments.push(current)
      current = []
      continue
    }
    const [start, end] = clipped
    const tail = current.at(-1)
    if (!tail || Math.hypot(tail.x - start.x, tail.y - start.y) > 1e-7) {
      if (current.length > 1) fragments.push(current)
      current = [start, end]
    } else {
      current.push(end)
    }
  }
  if (current.length > 1) fragments.push(current)
  return fragments
}

function polylineLength(points: PlanScenePoint[]): number {
  let length = 0
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
  }
  return length
}

function polylineMidpoint(points: PlanScenePoint[]): PlanScenePoint & { dx: number; dy: number } {
  const total = polylineLength(points)
  const target = total / 2
  let walked = 0
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]
    const b = points[index]
    const segment = Math.hypot(b.x - a.x, b.y - a.y)
    if (walked + segment >= target) {
      const ratio = segment > 1e-9 ? (target - walked) / segment : 0
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio, dx: b.x - a.x, dy: b.y - a.y }
    }
    walked += segment
  }
  const a = points.at(-2) ?? points[0]
  const b = points.at(-1) ?? a
  return { x: b.x, y: b.y, dx: b.x - a.x, dy: b.y - a.y }
}

function contextFeatureCount(constraints?: RouteConstraintInput | null): number {
  if (!constraints) return 0
  return [
    constraints.cadContextLines,
    constraints.terrainLines,
    constraints.cadTextEntities,
    constraints.cadBlockEntities,
    constraints.hardObstacleRings,
    constraints.buildingPolygons,
    constraints.parcelRings,
    constraints.forbiddenRings,
    constraints.protectionZoneRings,
    constraints.protectionZones,
    constraints.approvedCrossingRings,
    constraints.approvedCrossingZones,
    constraints.waterRings,
    constraints.corridorRings,
    constraints.roadLines,
    constraints.waterLines,
    constraints.utilityLines,
    constraints.redLines,
    constraints.guideLines,
    constraints.hardObstacles,
  ].reduce((total, collection) => total + (collection?.length ?? 0), 0)
}

export function buildPlanSheetScene(input: {
  sheet: WorkingDrawingSheet
  drawingSet: WorkingDrawingSet
  network: TracedNetwork
  schedule?: SewerSchedule | null
  pipeDiameterMm?: Map<string, number>
  pipeDesign?: Map<string, PlanPipeDesign>
  buildingLabels?: Map<string, string>
  constraints?: RouteConstraintInput | null
  surveyPointCountInWindow?: number
}): PlanSheetScene | null {
  const { sheet, drawingSet } = input
  const window = sheet.window
  if (!window) return null
  const planPath = sheet.planPathId
    ? drawingSet.planPaths.find((path) => path.id === sheet.planPathId)
    : drawingSet.planPaths[0]
  const sourcePath = planPath?.points ?? drawingSet.mainPath
  if (sourcePath.length < 2) return null
  const selectedPath = planPathSlice(sourcePath, window.fromM, window.toM)
  const activePipeIds = new Set(planPath?.pipeIds ?? [])
  const pipeById = new Map(input.network.pipes.map((pipe) => [pipe.id, pipe]))
  const pipes = drawingSet.networkPaths.flatMap((path): PlanScenePipe[] => {
    const fragments = clipPlanPolyline(path.points, window)
    if (fragments.length === 0) return []
    const longest = [...fragments].sort((left, right) => polylineLength(right) - polylineLength(left))[0]
    const middle = polylineMidpoint(longest)
    const design = input.pipeDesign?.get(path.pipeId)
    const networkPipe = pipeById.get(path.pipeId)
    const diameterMm = design?.diameterMm ?? input.pipeDiameterMm?.get(path.pipeId) ?? networkPipe?.diameterMm
    const slope = design?.slope ?? networkPipe?.slope
    const lengthM = design?.lengthM ?? networkPipe?.lengthM
    const label = [
      diameterMm ? `Ø${diameterMm}` : path.pipeId,
      Number.isFinite(slope) ? `i=${(slope! * 1000).toFixed(2)}‰` : null,
      Number.isFinite(lengthM) ? `L=${lengthM!.toFixed(1)} м` : null,
    ].filter(Boolean).join(' · ')
    let labelAngleDeg = Math.atan2(middle.dy, middle.dx) * 180 / Math.PI
    if (labelAngleDeg > 90 || labelAngleDeg < -90) labelAngleDeg += 180
    return [{
      pipeId: path.pipeId,
      fragments,
      active: activePipeIds.size === 0 || activePipeIds.has(path.pipeId),
      diameterMm,
      slope,
      lengthM,
      labelPoint: { x: middle.x, y: middle.y },
      labelAngleDeg,
      label,
    }]
  })

  const scheduleLabelByNode = new Map(
    (input.schedule?.manholes ?? []).flatMap((row) => row.nodeId ? [[row.nodeId, row.label] as const] : []),
  )
  const nodes = input.network.nodes
    .filter((node) => node.x >= window.minX && node.x <= window.maxX && node.y >= window.minY && node.y <= window.maxY)
    .map((node): PlanSceneNode => ({
      id: node.id,
      kind: node.kind,
      x: node.x,
      y: node.y,
      label: scheduleLabelByNode.get(node.id)
        ?? (node.kind === 'source' ? 'Вып.' : undefined)
        ?? (node.buildingId ? input.buildingLabels?.get(node.buildingId) : undefined)
        ?? node.label
        ?? node.id,
    }))

  const stationChainages = new Set<number>([window.fromM, window.toM])
  const firstHundred = Math.ceil(window.fromM / 100) * 100
  for (let chainageM = firstHundred; chainageM < window.toM - 1e-7; chainageM += 100) {
    stationChainages.add(chainageM)
  }
  for (const chainageM of planPath?.stationChainagesM ?? []) {
    if (chainageM > window.fromM + 1e-7 && chainageM < window.toM - 1e-7) stationChainages.add(chainageM)
  }
  const stations = [...stationChainages]
    .sort((left, right) => left - right)
    .map((chainageM): PlanSceneStation => ({
      ...pointAt(sourcePath, chainageM),
      label: formatPlanPicket(chainageM),
      boundary: Math.abs(chainageM - window.fromM) <= 1e-7 || Math.abs(chainageM - window.toM) <= 1e-7,
    }))

  const features = contextFeatureCount(input.constraints)
  return {
    sourcePath,
    selectedPath,
    pipes,
    nodes,
    stations,
    contextFeatureCount: features,
    // Spot elevations alone do not form a plan underlay: buildings, roads,
    // boundaries and existing utilities must remain visible source geometry.
    hasPlanContext: features > 0,
  }
}
