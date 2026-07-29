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
  /** Source CAD elevation when the entity carries one; planar consumers may ignore it. */
  z?: number
}

export interface ImportSegment {
  points: ImportPoint[]
  layer?: string
  /** True when the source entity is a closed polygon (DXF flag 70 / GeoJSON ring). */
  closed?: boolean
  sourceType?: string
  sourceHandle?: string
  /** Block definition and INSERT reference that produced expanded geometry. */
  sourceBlock?: string
  sourceInsertHandle?: string
  colorNumber?: number
  lineType?: string
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

function importDataSource(segment: ImportSegment): string {
  const values: Array<[string, string | number | undefined]> = [
    ['type', segment.sourceType],
    ['layer', segment.layer],
    ['handle', segment.sourceHandle],
    ['block', segment.sourceBlock],
    ['insert', segment.sourceInsertHandle],
    ['color', segment.colorNumber],
    ['linetype', segment.lineType],
  ]
  const metadata = values
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && String(entry[1]).trim().length > 0)
    .map(([key, value]) => `${key}=${String(value)}`)
  return ['imported-polyline', ...metadata].join('|')
}

/**
 * Tie a factual source polyline to the clustered graph without replacing its
 * intermediate vertices. The endpoint comparison also makes this safe when
 * graph construction chooses the opposite direction to the source entity.
 */
function orderedSnappedAlignment(
  points: ImportPoint[],
  from: ImportPoint,
  to: ImportPoint,
): ImportPoint[] {
  const last = points.length - 1
  const forward = dist(points[0], from) + dist(points[last], to)
  const reverse = dist(points[0], to) + dist(points[last], from)
  const alignment = (reverse < forward ? [...points].reverse() : [...points]).map((point) => ({ ...point }))
  alignment[0] = { ...alignment[0], x: from.x, y: from.y }
  alignment[alignment.length - 1] = { ...alignment[alignment.length - 1], x: to.x, y: to.y }
  return alignment
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
  const cleaned: ImportSegment[] = []
  for (const seg of segments) {
    const pts: ImportPoint[] = []
    for (const p of seg.points) {
      const prev = pts[pts.length - 1]
      if (!prev || dist(prev, p) > 1e-9) pts.push({ ...p })
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
    cleaned.push({ ...seg, points: pts })
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
    /** Full, source-derived plan geometry; never an endpoint chord. */
    alignment: ImportPoint[]
    source: ImportSegment
  }
  const raw: RawPipe[] = []
  const addRawPipe = (a: number, b: number, points: ImportPoint[], sourceSegment: ImportSegment) => {
    const alignment = orderedSnappedAlignment(points, clusters[a], clusters[b])
    raw.push({ a, b, lengthM: polylineLength(alignment), alignment, source: sourceSegment })
  }
  for (const segment of cleaned) {
    const pts = segment.points
    const aIdx = clusterOf(pts[0])
    const bIdx = clusterOf(pts[pts.length - 1])
    if (aIdx !== bIdx) {
      addRawPipe(aIdx, bIdx, pts, segment)
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
      addRawPipe(aIdx, q1, pts.slice(0, i1 + 1), segment)
      addRawPipe(q1, q2, pts.slice(i1, i2 + 1), segment)
      addRawPipe(q2, bIdx, pts.slice(i2), segment)
    } else {
      const mIdx = clusterOf(pts[i1])
      addRawPipe(aIdx, mIdx, pts.slice(0, i1 + 1), segment)
      addRawPipe(mIdx, bIdx, pts.slice(i1), segment)
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
        for (let i = 0; i < cleaned[a].points.length - 1 && !crossed; i++) {
          for (let j = 0; j < cleaned[b].points.length - 1; j++) {
            if (segmentsCross(cleaned[a].points[i], cleaned[a].points[i + 1], cleaned[b].points[j], cleaned[b].points[j + 1])) {
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
  const nodeById = new Map<string, NetworkNode>()
  const pipes: NetworkPipe[] = []
  let pipeSeq = 0
  const addPipe = (
    kind: NetworkPipe['kind'],
    fromNode: string,
    toNode: string,
    alignment: ImportPoint[],
    sourceSegment?: ImportSegment,
    dataSource?: string,
  ) => {
    pipeSeq++
    const from = nodeById.get(fromNode)
    const to = nodeById.get(toNode)
    const ordered = from && to
      ? orderedSnappedAlignment(alignment, from, to)
      : alignment.map(({ x, y }) => ({ x, y }))
    pipes.push({
      id: `P${pipeSeq}`,
      kind,
      fromNode,
      toNode,
      lengthM: round2(polylineLength(ordered)),
      alignment: ordered.map(({ x, y }) => ({ x, y })),
      sourceLayer: sourceSegment?.layer,
      sourceEntity: sourceSegment?.sourceHandle ?? sourceSegment?.sourceType,
      dataSource: dataSource ?? (sourceSegment ? importDataSource(sourceSegment) : undefined),
    })
  }

  const sourceNode: NetworkNode = {
    id: 'SRC',
    kind: 'source',
    x: round2(source.x),
    y: round2(source.y),
    groundElevation: elevation(source.x, source.y),
  }
  nodes.push(sourceNode)
  nodeById.set(sourceNode.id, sourceNode)

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
  const graphDepth = new Map<number, number>([[nearestIdx, 0]])
  const queue = [nearestIdx]
  while (queue.length > 0) {
    const current = queue.shift() as number
    for (const next of adjacency.get(current) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next)
        graphDepth.set(next, (graphDepth.get(current) ?? 0) + 1)
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
  keptJunctions.forEach((node) => nodeById.set(node.id, node))
  addPipe(
    'supply',
    'SRC',
    junctionId(nearestIdx),
    [source, clusters[nearestIdx]],
    undefined,
    'derived:source-connection',
  )
  for (const pipe of reachableMains) {
    // Give every imported edge a deterministic graph direction away from the
    // selected source. orderedSnappedAlignment reverses the source polyline
    // when necessary, while retaining every intermediate CAD/GIS vertex.
    const depthA = graphDepth.get(pipe.a) ?? Number.POSITIVE_INFINITY
    const depthB = graphDepth.get(pipe.b) ?? Number.POSITIVE_INFINITY
    const from = depthA < depthB || (depthA === depthB && pipe.a <= pipe.b) ? pipe.a : pipe.b
    const to = from === pipe.a ? pipe.b : pipe.a
    addPipe('main', junctionId(from), junctionId(to), pipe.alignment, pipe.source)
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
    nodeById.set(bNode.id, bNode)
    addPipe(
      'service',
      best.id,
      bNode.id,
      [{ x: best.x, y: best.y }, { x: bNode.x, y: bNode.y }],
      undefined,
      'derived:building-service',
    )
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
  const fc = parsed as {
    type?: string
    features?: Array<{
      id?: string | number
      geometry?: { type?: string; coordinates?: unknown }
      properties?: { layer?: string }
    }>
  }
  const features = fc?.features
  if (!Array.isArray(features)) return invalid

  const segments: ImportSegment[] = []
  const points: ImportPoint[] = []
  const toPoint = (c: unknown): ImportPoint | null => {
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null
    return { x: c[0], y: c[1], z: typeof c[2] === 'number' ? c[2] : undefined }
  }

  for (const [featureIndex, feature] of features.entries()) {
    const geometry = feature?.geometry
    const layer = feature?.properties?.layer
    const featureHandle = String(feature.id ?? `feature-${featureIndex + 1}`)
    if (!geometry) continue
    if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
      const pts = geometry.coordinates.map(toPoint).filter((p): p is ImportPoint => p !== null)
      if (pts.length >= 2) segments.push({
        points: pts,
        layer,
        sourceType: 'GeoJSON:LineString',
        sourceHandle: featureHandle,
      })
    } else if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
      for (const [lineIndex, line] of geometry.coordinates.entries()) {
        if (!Array.isArray(line)) continue
        const pts = line.map(toPoint).filter((p): p is ImportPoint => p !== null)
        if (pts.length >= 2) segments.push({
          points: pts,
          layer,
          sourceType: 'GeoJSON:MultiLineString',
          sourceHandle: `${featureHandle}:${lineIndex + 1}`,
        })
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
    return { x, y, z: p.z }
  }

  return {
    segments: segments.map((s) => ({ ...s, points: s.points.map(convert) })),
    points: points.map(convert),
    treatedAsLonLat,
    invalid: false,
  }
}
