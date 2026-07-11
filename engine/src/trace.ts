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

/** 'junction' nodes and 'main' pipes come from imported routes (importnet). */
export type NetworkNodeKind = 'source' | 'ring' | 'cross' | 'junction' | 'building'
export type NetworkPipeKind = 'supply' | 'ring' | 'cross' | 'main' | 'service'

export interface NetworkNode {
  id: string
  kind: NetworkNodeKind
  x: number
  y: number
  groundElevation: number
  buildingId?: string
}

export interface NetworkPipe {
  id: string
  kind: NetworkPipeKind
  fromNode: string
  toNode: string
  lengthM: number
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
export function interpolateElevation(points: SurveyPoint[], x: number, y: number, k = 4): number {
  if (points.length === 0) return 0
  const ranked = points
    .map((p) => ({ p, d2: (p.x - x) ** 2 + (p.y - y) ** 2 }))
    .sort((a, b) => a.d2 - b.d2)
    .slice(0, Math.max(1, k))
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
  const elevation = (x: number, y: number) => interpolateElevation(surveyPoints, x, y)

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
    groundElevation: elevation(source.x, source.y),
  }
  nodes.push(sourceNode)

  const buildingNodes: NetworkNode[] = buildings.map((b, i) => ({
    id: `B${i + 1}`,
    kind: 'building',
    x: round2(b.x),
    y: round2(b.y),
    groundElevation: elevation(b.x, b.y),
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
        node.groundElevation = elevation(node.x, node.y)
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
