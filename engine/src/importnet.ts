import type { SurveyPoint } from './types'
import { interpolateElevation } from './trace'
import type { NetworkNode, NetworkPipe, TracedNetwork } from './trace'
import { lonLatToLocal } from './geo'

/**
 * Import of a ready made network route (requirements update 1, the PRIMARY
 * working mode): polylines become pipe segments, their endpoints are
 * stitched into nodes with a tolerance, the graph is checked for
 * connectivity from the source, duplicates and self intersections are
 * detected and reported in a human friendly way. Auto tracing (trace.ts)
 * remains as the fallback mode.
 */

export interface ImportPoint {
  x: number
  y: number
}

export interface ImportSegment {
  points: ImportPoint[]
  layer?: string
  /** True when the source entity is a closed polygon (DXF flag 70 / GeoJSON ring). */
  closed?: boolean
}

export interface ImportBuildingInput {
  id: string
  x: number
  y: number
}

export interface ImportOptions {
  /** Vertex stitching tolerance, m. */
  snapToleranceM?: number
}

export interface ImportReport {
  nodes: number
  pipes: number
  totalLengthM: number
  snappedVertices: number
  duplicatesRemoved: number
  zeroLengthRemoved: number
  selfIntersections: number
  crossingsWithoutNode: number
  unreachableNodes: string[]
  unreachablePipes: number
}

const DEFAULT_OPTIONS: Required<ImportOptions> = { snapToleranceM: 0.5 }

function dist(a: ImportPoint, b: ImportPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function polylineLength(points: ImportPoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i])
  return total
}

function orientation(a: ImportPoint, b: ImportPoint, c: ImportPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/** Strict interior crossing of two segments (shared endpoints excluded). */
function segmentsCross(p1: ImportPoint, p2: ImportPoint, p3: ImportPoint, p4: ImportPoint): boolean {
  const eps = 1e-9
  const d1 = orientation(p3, p4, p1)
  const d2 = orientation(p3, p4, p2)
  const d3 = orientation(p1, p2, p3)
  const d4 = orientation(p1, p2, p4)
  return (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  )
}

export function importNetwork(
  segments: ImportSegment[],
  buildings: ImportBuildingInput[],
  source: ImportPoint,
  surveyPoints: SurveyPoint[],
  options: ImportOptions = {},
): { network: TracedNetwork; report: ImportReport } {
  const opt = { ...DEFAULT_OPTIONS, ...options }
  const elevation = (x: number, y: number) => interpolateElevation(surveyPoints, x, y)

  let zeroLengthRemoved = 0
  let selfIntersections = 0

  // 1. Clean polylines: drop repeated vertices and degenerate segments.
  const cleaned: ImportPoint[][] = []
  for (const seg of segments) {
    const pts: ImportPoint[] = []
    for (const p of seg.points) {
      const prev = pts[pts.length - 1]
      if (!prev || dist(prev, p) > 1e-9) pts.push({ x: p.x, y: p.y })
    }
    if (pts.length < 2 || polylineLength(pts) < opt.snapToleranceM) {
      zeroLengthRemoved++
      continue
    }
    const closed = dist(pts[0], pts[pts.length - 1]) <= opt.snapToleranceM
    let selfCross = false
    for (let i = 0; i < pts.length - 1 && !selfCross; i++) {
      for (let j = i + 2; j < pts.length - 1; j++) {
        if (closed && i === 0 && j === pts.length - 2) continue // closing pair of a loop
        if (segmentsCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) {
          selfCross = true
          break
        }
      }
    }
    if (selfCross) selfIntersections++
    cleaned.push(pts)
  }

  // 2. Stitch endpoints into node clusters with the tolerance.
  const clusters: ImportPoint[] = []
  let snappedVertices = 0
  const clusterOf = (p: ImportPoint): number => {
    for (let i = 0; i < clusters.length; i++) {
      if (dist(clusters[i], p) <= opt.snapToleranceM) {
        snappedVertices++
        return i
      }
    }
    clusters.push({ x: p.x, y: p.y })
    return clusters.length - 1
  }

  // 3. Raw pipes between clusters. A closed polyline (a ring drawn as one
  //    entity) is split at intermediate vertices into three edges so the
  //    loop survives deduplication and stays a real loop in the graph.
  interface RawPipe {
    a: number
    b: number
    lengthM: number
  }
  const raw: RawPipe[] = []
  for (const pts of cleaned) {
    const aIdx = clusterOf(pts[0])
    const bIdx = clusterOf(pts[pts.length - 1])
    if (aIdx !== bIdx) {
      raw.push({ a: aIdx, b: bIdx, lengthM: polylineLength(pts) })
      continue
    }
    const last = pts.length - 1
    const i1 = Math.max(1, Math.floor(last / 3))
    const i2 = Math.min(last - 1, Math.floor((2 * last) / 3))
    if (last < 2) {
      zeroLengthRemoved++
    } else if (i2 > i1) {
      const q1 = clusterOf(pts[i1])
      const q2 = clusterOf(pts[i2])
      raw.push({ a: aIdx, b: q1, lengthM: polylineLength(pts.slice(0, i1 + 1)) })
      raw.push({ a: q1, b: q2, lengthM: polylineLength(pts.slice(i1, i2 + 1)) })
      raw.push({ a: q2, b: bIdx, lengthM: polylineLength(pts.slice(i2)) })
    } else {
      const mIdx = clusterOf(pts[i1])
      raw.push({ a: aIdx, b: mIdx, lengthM: polylineLength(pts.slice(0, i1 + 1)) })
      raw.push({ a: mIdx, b: bIdx, lengthM: polylineLength(pts.slice(i1)) })
    }
  }

  // 4. Duplicates: same node pair with a similar length.
  let duplicatesRemoved = 0
  const seen = new Map<string, number>()
  const mains: RawPipe[] = []
  for (const pipe of raw) {
    const key = pipe.a < pipe.b ? `${pipe.a}-${pipe.b}` : `${pipe.b}-${pipe.a}`
    const existing = seen.get(key)
    if (existing !== undefined && Math.abs(existing - pipe.lengthM) <= Math.max(1, existing * 0.02)) {
      duplicatesRemoved++
      continue
    }
    seen.set(key, pipe.lengthM)
    mains.push(pipe)
  }

  // 5. Interior crossings between different polylines without a shared node.
  let crossingsWithoutNode = 0
  if (cleaned.length <= 300) {
    for (let a = 0; a < cleaned.length; a++) {
      for (let b = a + 1; b < cleaned.length; b++) {
        let crossed = false
        for (let i = 0; i < cleaned[a].length - 1 && !crossed; i++) {
          for (let j = 0; j < cleaned[b].length - 1; j++) {
            if (segmentsCross(cleaned[a][i], cleaned[a][i + 1], cleaned[b][j], cleaned[b][j + 1])) {
              crossed = true
              break
            }
          }
        }
        if (crossed) crossingsWithoutNode++
      }
    }
  }

  // 6. Nodes and the source connection.
  const nodes: NetworkNode[] = []
  const pipes: NetworkPipe[] = []
  let pipeSeq = 0
  const addPipe = (kind: NetworkPipe['kind'], fromNode: string, toNode: string, lengthM: number) => {
    pipeSeq++
    pipes.push({ id: `P${pipeSeq}`, kind, fromNode, toNode, lengthM: round2(lengthM) })
  }

  const sourceNode: NetworkNode = {
    id: 'SRC',
    kind: 'source',
    x: round2(source.x),
    y: round2(source.y),
    groundElevation: elevation(source.x, source.y),
  }
  nodes.push(sourceNode)

  const junctionId = (index: number) => `J${index + 1}`
  const junctionNodes: NetworkNode[] = clusters.map((c, i) => ({
    id: junctionId(i),
    kind: 'junction',
    x: round2(c.x),
    y: round2(c.y),
    groundElevation: elevation(c.x, c.y),
  }))

  const emptyReport: ImportReport = {
    nodes: 1,
    pipes: 0,
    totalLengthM: 0,
    snappedVertices,
    duplicatesRemoved,
    zeroLengthRemoved,
    selfIntersections,
    crossingsWithoutNode,
    unreachableNodes: [],
    unreachablePipes: 0,
  }
  if (clusters.length === 0 || mains.length === 0) {
    return { network: { nodes, pipes: [], totalLengthM: 0 }, report: emptyReport }
  }

  // Supply main from the source to the nearest cluster.
  let nearestIdx = 0
  let nearestD = Number.POSITIVE_INFINITY
  clusters.forEach((c, i) => {
    const d = dist(c, source)
    if (d < nearestD) {
      nearestD = d
      nearestIdx = i
    }
  })

  // 7. Connectivity from the source over the mains.
  const adjacency = new Map<number, Array<number>>()
  for (const pipe of mains) {
    adjacency.set(pipe.a, [...(adjacency.get(pipe.a) ?? []), pipe.b])
    adjacency.set(pipe.b, [...(adjacency.get(pipe.b) ?? []), pipe.a])
  }
  const reachable = new Set<number>([nearestIdx])
  const queue = [nearestIdx]
  while (queue.length > 0) {
    const current = queue.shift() as number
    for (const next of adjacency.get(current) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next)
        queue.push(next)
      }
    }
  }
  const unreachableNodes = junctionNodes.filter((_, i) => !reachable.has(i)).map((n) => n.id)
  const reachableMains = mains.filter((p) => reachable.has(p.a) && reachable.has(p.b))
  const unreachablePipes = mains.length - reachableMains.length

  // 8. Assemble: reachable junctions, mains, supply and building services.
  const keptJunctions = junctionNodes.filter((_, i) => reachable.has(i))
  nodes.push(...keptJunctions)
  addPipe('supply', 'SRC', junctionId(nearestIdx), Math.max(nearestD, 0.5))
  for (const pipe of reachableMains) {
    addPipe('main', junctionId(pipe.a), junctionId(pipe.b), pipe.lengthM)
  }

  buildings.forEach((b, i) => {
    const bNode: NetworkNode = {
      id: `B${i + 1}`,
      kind: 'building',
      x: round2(b.x),
      y: round2(b.y),
      groundElevation: elevation(b.x, b.y),
      buildingId: b.id,
    }
    let best = keptJunctions[0]
    let bestD = Number.POSITIVE_INFINITY
    for (const j of keptJunctions) {
      const d = Math.hypot(j.x - b.x, j.y - b.y)
      if (d < bestD) {
        bestD = d
        best = j
      }
    }
    if (!best) return
    nodes.push(bNode)
    addPipe('service', best.id, bNode.id, Math.max(bestD, 0.5))
  })

  const totalLengthM = round2(pipes.reduce((sum, p) => sum + p.lengthM, 0))
  return {
    network: { nodes, pipes, totalLengthM },
    report: {
      nodes: nodes.length,
      pipes: pipes.length,
      totalLengthM,
      snappedVertices,
      duplicatesRemoved,
      zeroLengthRemoved,
      selfIntersections,
      crossingsWithoutNode,
      unreachableNodes,
      unreachablePipes,
    },
  }
}

/** Parsed GeoJSON network geometry. */
export interface ParsedGeoNetwork {
  segments: ImportSegment[]
  points: ImportPoint[]
  treatedAsLonLat: boolean
  invalid: boolean
}

/**
 * Reads LineString / MultiLineString features as route segments and Point
 * features as node markers. When every coordinate fits the lon/lat ranges
 * and the extent is small in degrees, coordinates are treated as WGS84 and
 * converted to the local meter system (reported via treatedAsLonLat).
 */
export function parseGeoJsonNetwork(text: string): ParsedGeoNetwork {
  const invalid: ParsedGeoNetwork = { segments: [], points: [], treatedAsLonLat: false, invalid: true }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return invalid
  }
  const fc = parsed as { type?: string; features?: Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: { layer?: string } }> }
  const features = fc?.features
  if (!Array.isArray(features)) return invalid

  const segments: ImportSegment[] = []
  const points: ImportPoint[] = []
  const toPoint = (c: unknown): ImportPoint | null => {
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null
    return { x: c[0], y: c[1] }
  }

  for (const feature of features) {
    const geometry = feature?.geometry
    const layer = feature?.properties?.layer
    if (!geometry) continue
    if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
      const pts = geometry.coordinates.map(toPoint).filter((p): p is ImportPoint => p !== null)
      if (pts.length >= 2) segments.push({ points: pts, layer })
    } else if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
      for (const line of geometry.coordinates) {
        if (!Array.isArray(line)) continue
        const pts = line.map(toPoint).filter((p): p is ImportPoint => p !== null)
        if (pts.length >= 2) segments.push({ points: pts, layer })
      }
    } else if (geometry.type === 'Point') {
      const p = toPoint(geometry.coordinates)
      if (p) points.push(p)
    }
  }

  if (segments.length === 0 && points.length === 0) return invalid

  const all = [...points, ...segments.flatMap((s) => s.points)]
  const xs = all.map((p) => p.x)
  const ys = all.map((p) => p.y)
  const inLonLatRange = all.every((p) => Math.abs(p.x) <= 180 && Math.abs(p.y) <= 90)
  const spanSmall = Math.max(...xs) - Math.min(...xs) < 5 && Math.max(...ys) - Math.min(...ys) < 5
  const treatedAsLonLat = inLonLatRange && spanSmall

  const convert = (p: ImportPoint): ImportPoint => {
    if (!treatedAsLonLat) return p
    const { x, y } = lonLatToLocal(p.x, p.y)
    return { x, y }
  }

  return {
    segments: segments.map((s) => ({ layer: s.layer, points: s.points.map(convert) })),
    points: points.map(convert),
    treatedAsLonLat,
    invalid: false,
  }
}
