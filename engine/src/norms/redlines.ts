import type { Justified } from '../normregistry'
import { justified } from '../normregistry'
import { pointInPolygon, segmentCrossesPolygon } from '../parcels'
import type { Vec2 } from '../parcels'

/**
 * Mandatory corridor check (ТЗ п.6.1): the storm collector must be laid
 * within the red lines / the land-allocation corridor of the ПДП and the
 * route selection act. The corridor arrives as one or more polygons (drawn
 * or imported through the parcels module as «полоса отвода»); the check
 * reports every route vertex outside all corridor rings and every segment
 * that crosses a corridor boundary, so the violation can be shown at its
 * chainage. Nothing is auto-fixed: the route is the engineer's decision.
 */

export interface CorridorViolation {
  /** Vertex index in the route (segment violations point at the start vertex). */
  index: number
  stationM: number
  x: number
  y: number
  kind: 'vertexOutside' | 'segmentCrossesBoundary'
}

export interface CorridorCheck {
  inside: Justified<boolean>
  violations: CorridorViolation[]
  /** Vertices checked (2+ for a real route). */
  checked: number
}

export function checkRouteInCorridor(route: Vec2[], corridorRings: Vec2[][]): CorridorCheck {
  const violations: CorridorViolation[] = []
  const rings = corridorRings.filter((r) => r.length >= 3)
  const insideAny = (p: Vec2) => rings.some((ring) => pointInPolygon(p, ring))

  let chain = 0
  for (let i = 0; i < route.length; i++) {
    if (i > 0) chain += Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y)
    if (rings.length > 0 && !insideAny(route[i])) {
      violations.push({ index: i, stationM: chain, x: route[i].x, y: route[i].y, kind: 'vertexOutside' })
    }
  }

  // A segment with both ends inside can still slip across a concave boundary.
  let chain2 = 0
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]
    const b = route[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    const bothInside = insideAny(a) && insideAny(b)
    if (bothInside && rings.some((ring) => segmentCrossesPolygon(a, b, ring))) {
      violations.push({ index: i - 1, stationM: chain2, x: a.x, y: a.y, kind: 'segmentCrossesBoundary' })
    }
    chain2 += seg
  }

  return {
    inside: justified(rings.length > 0 && violations.length === 0, ['route.redLines']),
    violations,
    checked: route.length,
  }
}
