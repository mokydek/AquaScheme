import type { Justified } from '../normregistry'
import { justified } from '../normregistry'

/**
 * Route structures required by the design task (ТЗ п.6.1) for a storm trunk:
 * casings under existing and planned roads, protective grilles with an
 * anti-corrosion coating in the inspection manholes, and a lift pumping
 * station (подкачивающая НС) without an above-ground part where gravity flow
 * alone cannot continue. Pure geometry/rules; the UI supplies the road lines
 * (from the ПДП or the survey base) and the route.
 */

export interface Polyline {
  id: string
  points: Array<{ x: number; y: number }>
  /** Road width, m, when known — defines the casing length. */
  widthM?: number
}

export interface RoadCrossing {
  roadId: string
  /** Chainage of the crossing along the route, m. */
  stationM: number
  x: number
  y: number
  /** Recommended casing length, m: road width + allowance each side. */
  casingLengthM: Justified<number>
}

export interface CrossingOptions {
  /** Casing continues this far beyond each road edge, m. */
  allowanceM?: number
  /** Assumed road width when the road line carries none, m. */
  defaultRoadWidthM?: number
}

const CROSSING_DEFAULTS: Required<CrossingOptions> = { allowanceM: 5, defaultRoadWidthM: 20 }

function segmentIntersection(
  a1: { x: number; y: number }, a2: { x: number; y: number },
  b1: { x: number; y: number }, b2: { x: number; y: number },
): { x: number; y: number; t: number } | null {
  const dax = a2.x - a1.x
  const day = a2.y - a1.y
  const dbx = b2.x - b1.x
  const dby = b2.y - b1.y
  const den = dax * dby - day * dbx
  if (Math.abs(den) < 1e-12) return null
  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / den
  const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: a1.x + t * dax, y: a1.y + t * day, t }
}

/**
 * Crossings of the route with road axis lines. Each crossing carries the
 * chainage and a justified casing length (ТЗ: переходы через существующие и
 * проектируемые дороги выполнить в футляре).
 */
export function findRoadCrossings(
  route: Array<{ x: number; y: number }>,
  roads: Polyline[],
  options: CrossingOptions = {},
): RoadCrossing[] {
  const opt = { ...CROSSING_DEFAULTS, ...options }
  const crossings: RoadCrossing[] = []
  let chain = 0
  for (let i = 1; i < route.length; i++) {
    const a1 = route[i - 1]
    const a2 = route[i]
    const segLen = Math.hypot(a2.x - a1.x, a2.y - a1.y)
    for (const road of roads) {
      for (let j = 1; j < road.points.length; j++) {
        const hit = segmentIntersection(a1, a2, road.points[j - 1], road.points[j])
        if (!hit) continue
        const width = road.widthM ?? opt.defaultRoadWidthM
        crossings.push({
          roadId: road.id,
          stationM: chain + hit.t * segLen,
          x: hit.x,
          y: hit.y,
          casingLengthM: justified(width + 2 * opt.allowanceM, ['crossing.casing']),
        })
      }
    }
    chain += segLen
  }
  return crossings.sort((p, q) => p.stationM - q.stationM)
}

/**
 * Protective grilles with an anti-corrosion coating for inspection manholes
 * (ТЗ п.6.1; эталон держит для них отдельный лист). One per manhole.
 */
export function protectiveGrilles(manholeCount: number): Justified<number> {
  return justified(Math.max(0, Math.round(manholeCount)), ['manhole.grille'])
}

export interface LiftStationAssessment {
  needed: Justified<boolean>
  /** Depth that triggered the station, m below the surface; null when not needed. */
  atDepthM: number | null
  /** ТЗ constraints for the station design, to print next to the decision. */
  constraints: string[]
}

/**
 * Whether a lift pumping station is needed: gravity burial depth grows along
 * the profile and beyond maxDepthM further gravity flow is uneconomical /
 * unbuildable, so the ТЗ rule kicks in — подкачивающая НС без надземной
 * части, работающая автоматически в максимальный дождь через аварийный
 * перелив, без перекачки максимальных расходов насосами.
 */
export function assessLiftStationNeed(
  profileDepthsM: number[],
  maxDepthM = 8,
): LiftStationAssessment {
  const over = profileDepthsM.find((d) => d > maxDepthM)
  const needed = over !== undefined
  return {
    needed: justified(needed, ['pump.liftStation']),
    atDepthM: needed ? over : null,
    constraints: needed
      ? [
          'без надземной части',
          'автоматический режим в период максимального дождя',
          'аварийный перелив подводящего коллектора в отводящий',
          'без перекачки максимальных расходов насосами',
        ]
      : [],
  }
}
