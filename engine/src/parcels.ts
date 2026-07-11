/**
 * Land parcels (requirements update 1, change 5). Every building has its own
 * plot; the route has a right of way strip. The street network must keep to
 * streets and the right of way, and a service line may only enter the
 * building's own parcel. Foreign parcel crossings are violations.
 *
 * Pure geometry in local project coordinates (meters).
 */

export interface Vec2 {
  x: number
  y: number
}

export type ParcelKind = 'parcel' | 'right_of_way'

export interface ParcelPolygon {
  id: string
  kind: ParcelKind
  /** Building this parcel belongs to (for kind 'parcel'). */
  buildingId?: string
  /** Outer ring, local meters. First and last vertex may repeat. */
  ring: Vec2[]
}

/** Normalize a ring: drop a trailing vertex equal to the first. */
function openRing(ring: Vec2[]): Vec2[] {
  if (ring.length < 2) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  return Math.hypot(first.x - last.x, first.y - last.y) < 1e-9 ? ring.slice(0, -1) : ring
}

/** Ray casting point in polygon test on the outer ring. */
export function pointInPolygon(p: Vec2, ring: Vec2[]): boolean {
  const r = openRing(ring)
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const yi = r[i].y
    const yj = r[j].y
    const xi = r[i].x
    const xj = r[j].x
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/** Do segments p1p2 and p3p4 intersect (including touching)? */
function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = orient(p3, p4, p1)
  const d2 = orient(p3, p4, p2)
  const d3 = orient(p1, p2, p3)
  const d4 = orient(p1, p2, p4)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  const onSeg = (a: Vec2, b: Vec2, c: Vec2) =>
    Math.min(a.x, b.x) - 1e-9 <= c.x &&
    c.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= c.y &&
    c.y <= Math.max(a.y, b.y) + 1e-9
  if (Math.abs(d1) < 1e-9 && onSeg(p3, p4, p1)) return true
  if (Math.abs(d2) < 1e-9 && onSeg(p3, p4, p2)) return true
  if (Math.abs(d3) < 1e-9 && onSeg(p1, p2, p3)) return true
  if (Math.abs(d4) < 1e-9 && onSeg(p1, p2, p4)) return true
  return false
}

/** True when the segment ab crosses the polygon boundary. */
export function segmentCrossesPolygon(a: Vec2, b: Vec2, ring: Vec2[]): boolean {
  const r = openRing(ring)
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (segmentsIntersect(a, b, r[j], r[i])) return true
  }
  return false
}

/**
 * Assigns each building to the first 'parcel' polygon that contains it.
 * Returns a map buildingId -> parcelId (only buildings that landed inside a
 * parcel appear).
 */
export function assignBuildingsToParcels(
  buildings: Array<{ id: string; x: number; y: number }>,
  parcels: ParcelPolygon[],
): Map<string, string> {
  const plots = parcels.filter((p) => p.kind === 'parcel')
  const result = new Map<string, string>()
  for (const building of buildings) {
    const plot = plots.find((p) => pointInPolygon({ x: building.x, y: building.y }, p.ring))
    if (plot) result.set(building.id, plot.id)
  }
  return result
}

export interface ViolationPipe {
  id: string
  kind: string
  a: Vec2
  b: Vec2
  /** Building served (for service pipes). */
  buildingId?: string
}

export interface ParcelViolation {
  pipeId: string
  parcelId: string
}

/**
 * Finds pipes that cross a foreign land parcel. A pipe may cross the right of
 * way freely, and a service line may enter its own building's parcel; any
 * other parcel intersection (boundary crossing or lying inside) is a
 * violation.
 */
export function analyzeParcelViolations(
  pipes: ViolationPipe[],
  parcels: ParcelPolygon[],
): ParcelViolation[] {
  const plots = parcels.filter((p) => p.kind === 'parcel')
  const violations: ParcelViolation[] = []
  for (const pipe of pipes) {
    for (const plot of plots) {
      if (pipe.buildingId && plot.buildingId === pipe.buildingId) continue
      const mid = { x: (pipe.a.x + pipe.b.x) / 2, y: (pipe.a.y + pipe.b.y) / 2 }
      const crosses =
        segmentCrossesPolygon(pipe.a, pipe.b, plot.ring) ||
        pointInPolygon(mid, plot.ring) ||
        pointInPolygon(pipe.a, plot.ring) ||
        pointInPolygon(pipe.b, plot.ring)
      if (crosses) violations.push({ pipeId: pipe.id, parcelId: plot.id })
    }
  }
  return violations
}

/** Extract the outer ring of a GeoJSON Polygon or Feature into local points. */
export function ringFromGeoJsonGeometry(geometry: unknown): Vec2[] | null {
  const g = geometry as { type?: string; coordinates?: unknown } | null
  if (!g) return null
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    const outer = g.coordinates[0]
    if (!Array.isArray(outer)) return null
    const ring = outer
      .filter((c): c is [number, number] => Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number')
      .map((c) => ({ x: c[0], y: c[1] }))
    return ring.length >= 3 ? ring : null
  }
  return null
}
