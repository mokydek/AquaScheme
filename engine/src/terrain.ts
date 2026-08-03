import * as turf from '@turf/turf'
import type { FeatureCollection } from 'geojson'
import type { SurveyPoint } from './types'
import { DEFAULT_ANCHOR, localToLonLat } from './geo'
import type { GeoAnchor } from './geo'
import { contourStepFor, contoursFromSurvey, triangulateSurvey } from './contours'

/**
 * Цифровая модель рельефа для карты: сетка треугольников и горизонтали.
 *
 * Считает всё `./contours` в местных метрах, здесь только перевод в градусы.
 * Раньше горизонтали строились интерполяцией на регулярную сетку
 * (turf.interpolate + turf.isolines). Это заполняло рельефом весь габаритный
 * прямоугольник, включая места, где съёмки не было, и на коридоре 3,5 × 10 км
 * занимало полторы минуты. По треугольникам съёмки то же самое считается за
 * доли секунды и за снятую площадь не выходит.
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

export { contourStepFor }

export function buildTerrain(points: SurveyPoint[], anchor: GeoAnchor = DEFAULT_ANCHOR): TerrainGeo {
  const at = (i: number) => localToLonLat(points[i].x, points[i].y, anchor)

  const tin = turf.featureCollection(
    triangulateSurvey(points).map((t) =>
      turf.polygon([[at(t.a), at(t.b), at(t.c), at(t.a)]], {
        a: points[t.a].z,
        b: points[t.b].z,
        c: points[t.c].z,
      })),
  )

  const relief = contoursFromSurvey(points)
  const contours = turf.featureCollection(
    relief.lines.map((line) =>
      turf.lineString(line.points.map((p) => localToLonLat(p.x, p.y, anchor)), {
        z: line.levelM,
        index: line.index,
        closed: line.closed,
      })),
  )

  const bbox: [number, number, number, number] = points.length === 0
    ? [0, 0, 0, 0]
    : turf.bbox(turf.featureCollection(
        points.map((p) => turf.point(localToLonLat(p.x, p.y, anchor))),
      )) as [number, number, number, number]

  return {
    tin,
    contours,
    bbox,
    zMin: relief.zMinM,
    zMax: relief.zMaxM,
    contourStep: relief.stepM,
  }
}
