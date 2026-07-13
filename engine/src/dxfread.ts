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
}

export interface DxfNetworkData {
  segments: ImportSegment[]
  points: Array<ImportPoint & { z?: number; layer?: string }>
  layers: DxfLayerInfo[]
  ok: boolean
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
  const stats = new Map<string, { segments: number; points: number }>()
  const bump = (layer: string, kind: 'segments' | 'points') => {
    const entry = stats.get(layer) ?? { segments: 0, points: 0 }
    entry[kind]++
    stats.set(layer, entry)
  }
  const toPoints = (vertices: DxfVertex[] | undefined): ImportPoint[] =>
    (vertices ?? [])
      .filter((v) => typeof v.x === 'number' && typeof v.y === 'number')
      .map((v) => ({ x: v.x as number, y: v.y as number }))

  for (const entity of entities) {
    const layer = typeof entity.layer === 'string' && entity.layer !== '' ? entity.layer : '0'
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
        segments.push({ points: needsClosing ? [...pts, { ...first }] : pts, layer })
        bump(layer, 'segments')
      }
    } else if (entity.type === 'POINT' || entity.type === 'INSERT') {
      const position = entity.position
      if (position && typeof position.x === 'number' && typeof position.y === 'number') {
        const marker: ImportPoint & { z?: number; layer?: string } = { x: position.x, y: position.y, layer }
        if (typeof position.z === 'number' && Number.isFinite(position.z)) marker.z = position.z
        points.push(marker)
        bump(layer, 'points')
      }
    }
  }

  const layers: DxfLayerInfo[] = [...stats.entries()]
    .map(([name, s]) => ({ name, segments: s.segments, points: s.points }))
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
  const points: SurveyPoint[] = []
  const issues: ParseIssue[] = []
  data.points.forEach((p, index) => {
    if (!hasElevations) {
      issues.push({ row: index + 1, kind: 'missingZ' })
      return
    }
    points.push({ x: p.x, y: p.y, z: typeof p.z === 'number' ? p.z : 0 })
  })
  return { points, issues, total: data.points.length }
}
