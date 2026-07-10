import * as turf from '@turf/turf'
import type { FeatureCollection } from 'geojson'
import type { SurveyPoint } from './types'
import { DEFAULT_ANCHOR, localToLonLat } from './geo'
import type { GeoAnchor } from './geo'

/**
 * Digital terrain model for the map: a TIN mesh and elevation contours.
 * Contour interval follows the elevation range (0.5 / 1 / 2 m), which
 * matches the usual intervals of 1:500 and 1:1000 survey plans.
 *
 * Heavy: intended to run inside a Web Worker.
 */

export interface TerrainGeo {
  tin: FeatureCollection
  contours: FeatureCollection
  /** [lonMin, latMin, lonMax, latMax] of the survey. */
  bbox: [number, number, number, number]
  zMin: number
  zMax: number
  contourStep: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function contourStepFor(range: number): number {
  if (range > 20) return 2
  if (range > 8) return 1
  return 0.5
}

export function buildTerrain(points: SurveyPoint[], anchor: GeoAnchor = DEFAULT_ANCHOR): TerrainGeo {
  const features = turf.featureCollection(
    points.map((p) => turf.point(localToLonLat(p.x, p.y, anchor), { z: p.z })),
  )

  const tin = turf.tin(features, 'z')

  const zs = points.map((p) => p.z)
  const zMin = Math.min(...zs)
  const zMax = Math.max(...zs)
  const step = contourStepFor(zMax - zMin)

  const breaks: number[] = []
  for (let level = Math.ceil(zMin / step) * step; level < zMax; level += step) {
    breaks.push(round2(level))
  }

  let contours: FeatureCollection = turf.featureCollection([])
  if (breaks.length > 0 && points.length >= 3) {
    // IDW interpolation onto a regular grid, then isolines over the grid.
    const grid = turf.interpolate(features, 0.015, {
      gridType: 'point',
      property: 'z',
      units: 'kilometers',
      weight: 2,
    })
    contours = turf.isolines(grid, breaks, { zProperty: 'z' })
  }

  return {
    tin,
    contours,
    bbox: turf.bbox(features) as [number, number, number, number],
    zMin,
    zMax,
    contourStep: step,
  }
}
