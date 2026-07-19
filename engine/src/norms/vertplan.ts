import type { SurveyPoint } from '../types'

/**
 * Vertical planning surface (схема вертикальной планировки). Urban linear
 * projects are designed against the PLANNED ground surface, not only the
 * existing terrain: the master plan / vertical planning sheets carry design
 * elevations at street intersections, and burial depths and profiles must be
 * computed from them where they exist. This module blends the two surfaces:
 * design elevations win inside their influence radius, the existing survey
 * is the fallback elsewhere, and a linear cross-fade near the boundary avoids
 * artificial steps in the profile.
 */

export interface DesignElevationPoint {
  x: number
  y: number
  /** Planned (design) surface elevation, m. */
  z: number
}

export interface BlendOptions {
  /** Radius within which a design point fully defines the surface, m. */
  fullRadiusM?: number
  /** Beyond this distance the design point has no influence, m. */
  zeroRadiusM?: number
  /** IDW power for combining several design points. */
  power?: number
}

const DEFAULTS: Required<BlendOptions> = { fullRadiusM: 30, zeroRadiusM: 120, power: 2 }

function idw(points: Array<{ z: number; d: number }>, power: number): number {
  const exact = points.find((p) => p.d < 1e-6)
  if (exact) return exact.z
  let num = 0
  let den = 0
  for (const p of points) {
    const w = 1 / Math.pow(p.d, power)
    num += w * p.z
    den += w
  }
  return num / den
}

export interface BlendedElevation {
  z: number
  /** 0 — existing terrain only, 1 — design surface only. */
  designWeight: number
  source: 'design' | 'existing' | 'blend'
}

/**
 * Elevation of the planned surface at (x, y): design elevations inside their
 * influence, existing survey (IDW over nearest points) outside, cross-faded
 * in between. Returns null when neither surface has data.
 */
export function plannedElevationAt(
  x: number,
  y: number,
  design: DesignElevationPoint[],
  existing: SurveyPoint[],
  options: BlendOptions = {},
): BlendedElevation | null {
  const opt = { ...DEFAULTS, ...options }

  const designWithD = design
    .map((p) => ({ z: p.z, d: Math.hypot(p.x - x, p.y - y) }))
    .filter((p) => p.d <= opt.zeroRadiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, 6)

  const existingWithD = existing
    .map((p) => ({ z: p.z, d: Math.hypot(p.x - x, p.y - y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6)

  const hasDesign = designWithD.length > 0
  const hasExisting = existingWithD.length > 0
  if (!hasDesign && !hasExisting) return null

  if (!hasDesign) {
    return { z: idw(existingWithD, opt.power), designWeight: 0, source: 'existing' }
  }

  const nearest = designWithD[0].d
  const designZ = idw(designWithD, opt.power)
  if (nearest <= opt.fullRadiusM || !hasExisting) {
    return { z: designZ, designWeight: 1, source: 'design' }
  }

  // Linear cross-fade between the full and zero influence radii.
  const t = 1 - (nearest - opt.fullRadiusM) / (opt.zeroRadiusM - opt.fullRadiusM)
  const existingZ = idw(existingWithD, opt.power)
  return { z: t * designZ + (1 - t) * existingZ, designWeight: t, source: 'blend' }
}

/**
 * Planned surface along a route path: elevation per vertex with chainage.
 * Feeds the longitudinal profile and burial depth checks — depths are taken
 * from the planned surface where vertical planning data exists.
 */
export function plannedSurfaceAlong(
  path: Array<{ x: number; y: number }>,
  design: DesignElevationPoint[],
  existing: SurveyPoint[],
  options: BlendOptions = {},
): Array<{ stationM: number; x: number; y: number; elevation: BlendedElevation | null }> {
  const out: Array<{ stationM: number; x: number; y: number; elevation: BlendedElevation | null }> = []
  let chain = 0
  for (let i = 0; i < path.length; i++) {
    if (i > 0) chain += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
    out.push({
      stationM: chain,
      x: path[i].x,
      y: path[i].y,
      elevation: plannedElevationAt(path[i].x, path[i].y, design, existing, options),
    })
  }
  return out
}
