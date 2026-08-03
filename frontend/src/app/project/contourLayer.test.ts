import { describe, expect, it } from 'vitest'
import { contoursFromSurvey } from '@aquascheme/engine'
import type { ContourResult } from '@aquascheme/engine'
import { CONTOUR_LABEL_LIMIT, CONTOUR_LABEL_MIN_POINTS, contourMapShapes } from './contourLayer'

/** Ровный скат: отметка растёт вдоль X, поперёк постоянна. */
function slope(): ContourResult {
  const points = []
  for (let x = 0; x <= 200; x += 10) {
    for (let y = 0; y <= 200; y += 10) points.push({ x, y, z: x * 0.1 })
  }
  return contoursFromSurvey(points)
}

const identity = (point: { x: number; y: number }) => point

describe('горизонтали на карте', () => {
  it('кладутся той же проекцией, что и остальные слои', () => {
    // Проекция карты — единственный перевод координат. Если бы горизонтали
    // переводились отдельно, у непривязанного чертежа они разошлись бы с сетью.
    const relief = slope()
    const shifted = contourMapShapes(relief, (point) => ({ x: point.x + 1000, y: point.y }))
    expect(shifted.lines.length).toBeGreaterThan(0)
    for (const line of shifted.lines) {
      for (const point of line.points) expect(point.x).toBeGreaterThanOrEqual(1000)
    }
  })

  it('утолщает каждую пятую горизонталь и подписывает только её', () => {
    const shapes = contourMapShapes(slope(), identity)
    const thick = shapes.lines.filter((line) => line.index)
    expect(thick.length).toBeGreaterThan(0)
    expect(thick.length).toBeLessThan(shapes.lines.length)
    for (const line of shapes.lines) {
      expect(line.weight).toBe(line.index ? 1.6 : 0.8)
    }
    const levels = new Set(shapes.lines.filter((line) => line.index).map((line) => line.levelM.toFixed(0)))
    expect(shapes.labels.length).toBeGreaterThan(0)
    for (const label of shapes.labels) expect(levels.has(label.text)).toBe(true)
  })

  it('подписей не больше предела, каким бы длинным ни был участок', () => {
    const lines = Array.from({ length: 400 }, (_, index) => ({
      levelM: index,
      index: true,
      closed: false,
      points: Array.from({ length: CONTOUR_LABEL_MIN_POINTS }, (_, step) => ({ x: step, y: index })),
    }))
    const shapes = contourMapShapes(
      { lines, stepM: 1, zMinM: 0, zMaxM: 399, triangles: 0, skippedTriangles: 0, maxEdgeM: 0, reason: '' },
      identity,
    )
    expect(shapes.lines).toHaveLength(400)
    expect(shapes.labels).toHaveLength(CONTOUR_LABEL_LIMIT)
  })

  it('короткий обрывок линии не подписывается', () => {
    const shapes = contourMapShapes(
      {
        lines: [{
          levelM: 12,
          index: true,
          closed: false,
          points: Array.from({ length: CONTOUR_LABEL_MIN_POINTS - 1 }, (_, step) => ({ x: step, y: 0 })),
        }],
        stepM: 1, zMinM: 0, zMaxM: 20, triangles: 0, skippedTriangles: 0, maxEdgeM: 0, reason: '',
      },
      identity,
    )
    expect(shapes.lines).toHaveLength(1)
    expect(shapes.labels).toHaveLength(0)
  })

  it('шаг мельче метра подписывается с десятыми, иначе отметки слились бы', () => {
    const line = {
      index: true,
      closed: false,
      points: Array.from({ length: CONTOUR_LABEL_MIN_POINTS }, (_, step) => ({ x: step, y: 0 })),
    }
    const half = contourMapShapes(
      {
        lines: [{ ...line, levelM: 12.5 }, { ...line, levelM: 13 }],
        stepM: 0.5, zMinM: 12, zMaxM: 13, triangles: 0, skippedTriangles: 0, maxEdgeM: 0, reason: '',
      },
      identity,
    )
    expect(half.labels.map((label) => label.text)).toEqual(['12.5', '13.0'])
  })

  it('без съёмки не рисуется ничего и не падает', () => {
    expect(contourMapShapes(null, identity)).toEqual({ lines: [], labels: [] })
    expect(contourMapShapes(contoursFromSurvey([]), identity)).toEqual({ lines: [], labels: [] })
  })
})
